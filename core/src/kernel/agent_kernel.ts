// ============================================================================
// KIN AGENT KERNEL & RUN STATE MACHINE
// Execution lifecycle, 15-second heartbeat leases, stale crash recovery,
// and hard swarm quota enforcement.
// ============================================================================

import { KinDatabase } from '../storage/db.js';
import { AgentRun, RunState } from '../domain/types.js';
import { v4 as uuidv4 } from 'uuid';

export interface SpawnRunParams {
  agentId: string;
  projectId?: string;
  parentRunId?: string;
  taskId?: string;
  allocatedTokens?: number;
}

export interface DelegationParams {
  parentRunId: string;
  childAgentId: string;
  taskId: string;
  objective: string;
  constraints: string[];
}

export class AgentKernel {
  private db: KinDatabase;
  private readonly maxDelegationDepth: number = 3;
  private readonly maxActiveConcurrentRuns: number = 8;
  private readonly maxTotalDescendants: number = 15;

  constructor(db: KinDatabase) {
    this.db = db;
  }

  /**
   * Spawns an execution run with quota checks and initial heartbeat.
   */
  public spawnRun(params: SpawnRunParams): AgentRun {
    // 1. Concurrency quota check
    const activeCount = this.getActiveRunCount();
    if (activeCount >= this.maxActiveConcurrentRuns) {
      throw new Error(
        `QUOTA EXCEEDED: Maximum active concurrent runs (${this.maxActiveConcurrentRuns}) reached. Run queued.`
      );
    }

    // 2. Delegation depth & descendant quota checks
    if (params.parentRunId) {
      const depth = this.calculateDelegationDepth(params.parentRunId);
      if (depth >= this.maxDelegationDepth) {
        throw new Error(
          `QUOTA EXCEEDED: Maximum delegation depth (${this.maxDelegationDepth}) reached. Cannot swarm further subagents.`
        );
      }

      const totalDescendants = this.countDescendants(params.parentRunId);
      if (totalDescendants >= this.maxTotalDescendants) {
        throw new Error(
          `QUOTA EXCEEDED: Maximum goal descendants (${this.maxTotalDescendants}) reached for parent run ${params.parentRunId}.`
        );
      }
    }

    const id = uuidv4();
    const now = Date.now();

    const run: AgentRun = {
      id,
      agentId: params.agentId,
      projectId: params.projectId,
      parentRunId: params.parentRunId,
      taskId: params.taskId,
      state: 'running',
      heartbeatAt: now,
      allocatedTokens: params.allocatedTokens ?? 100000,
      usedTokens: 0,
      createdAt: now,
    };

    this.db.execute(
      `INSERT INTO agent_runs (id, agent_id, project_id, parent_run_id, task_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      run.id,
      run.agentId,
      run.projectId ?? null,
      run.parentRunId ?? null,
      run.taskId ?? null,
      run.state,
      run.heartbeatAt,
      run.allocatedTokens,
      run.usedTokens,
      run.createdAt
    );

    this.recordEvent('agent.run.started', 'agent_run', run.id, { agentId: run.agentId, taskId: run.taskId });

    return run;
  }

  public getRun(id: string): AgentRun | undefined {
    const row = this.db.queryOne<{
      id: string;
      agent_id: string;
      project_id: string | null;
      parent_run_id: string | null;
      task_id: string | null;
      state: string;
      worktree_path: string | null;
      heartbeat_at: number;
      allocated_tokens: number;
      used_tokens: number;
      created_at: number;
      completed_at: number | null;
    }>('SELECT * FROM agent_runs WHERE id = ?', id);

    if (!row) return undefined;

    return {
      id: row.id,
      agentId: row.agent_id,
      projectId: row.project_id ?? undefined,
      parentRunId: row.parent_run_id ?? undefined,
      taskId: row.task_id ?? undefined,
      state: row.state as RunState,
      worktreePath: row.worktree_path ?? undefined,
      heartbeatAt: row.heartbeat_at,
      allocatedTokens: row.allocated_tokens,
      usedTokens: row.used_tokens,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  /**
   * Updates heartbeat timestamp to maintain active lease.
   */
  public heartbeat(runId: string): void {
    this.db.execute(
      `UPDATE agent_runs SET heartbeat_at = ? WHERE id = ? AND state = 'running'`,
      Date.now(),
      runId
    );
  }

  /**
   * State transitions with terminal state validation.
   */
  public transitionState(runId: string, newState: RunState, reason?: string): void {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run '${runId}' not found.`);

    if (run.state === 'completed' || run.state === 'failed' || run.state === 'cancelled') {
      throw new Error(`Cannot transition run from terminal state '${run.state}' to '${newState}'.`);
    }

    const now = Date.now();
    const completedAt = (newState === 'completed' || newState === 'failed' || newState === 'cancelled') ? now : null;

    this.db.execute(
      `UPDATE agent_runs SET state = ?, completed_at = ?, heartbeat_at = ? WHERE id = ?`,
      newState,
      completedAt,
      now,
      runId
    );

    this.recordEvent(`agent.run.${newState}`, 'agent_run', runId, { previousState: run.state, reason });
  }

  /**
   * Stale lease recovery on application restart.
   * Finds runs that were 'running' when the app terminated and transitions them to 'recovering'.
   */
  public recoverStaleRuns(staleThresholdMs: number = 45000): string[] {
    const cutoff = Date.now() - staleThresholdMs;

    const staleRuns = this.db.query<{ id: string }>(
      `SELECT id FROM agent_runs WHERE state = 'running' AND heartbeat_at < ?`,
      cutoff
    );

    const recoveredIds: string[] = [];

    for (const row of staleRuns) {
      this.db.execute(
        `UPDATE agent_runs SET state = 'recovering', heartbeat_at = ? WHERE id = ?`,
        Date.now(),
        row.id
      );
      this.recordEvent('agent.run.recovering', 'agent_run', row.id, { reason: 'stale_heartbeat_lease_detected' });
      recoveredIds.push(row.id);
    }

    return recoveredIds;
  }

  public getActiveRunCount(): number {
    const row = this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM agent_runs WHERE state IN ('running', 'waiting_for_tool', 'waiting_for_approval', 'waiting_for_agent', 'waiting_for_model')`
    );
    return row?.count ?? 0;
  }

  public calculateDelegationDepth(runId: string): number {
    let depth = 1;
    let currentRun = this.getRun(runId);

    while (currentRun && currentRun.parentRunId) {
      depth++;
      currentRun = this.getRun(currentRun.parentRunId);
    }

    return depth;
  }

  private countDescendants(parentRunId: string): number {
    const row = this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM agent_runs WHERE parent_run_id = ?`,
      parentRunId
    );
    return row?.count ?? 0;
  }

  private recordEvent(eventType: string, entityType: string, entityId: string, payload: Record<string, unknown>): void {
    this.db.execute(
      `INSERT INTO event_journal (event_type, entity_type, entity_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      eventType,
      entityType,
      entityId,
      JSON.stringify(payload),
      Date.now()
    );
  }
}
