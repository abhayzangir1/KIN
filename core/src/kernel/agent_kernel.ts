// ============================================================================
// KIN AGENT KERNEL & RUN STATE MACHINE
// Execution lifecycle, 15-second heartbeat leases, stale crash recovery,
// and hard swarm quota enforcement.
// ============================================================================

import { KinDatabase } from '../storage/db.js';
import { AgentRun, RunState } from '../domain/types.js';
import { EventLedger } from '../security/event_ledger.js';
import { SecretBroker } from '../security/secret_broker.js';
import { v4 as uuidv4 } from 'uuid';

export interface SpawnRunParams {
  agentId: string;
  projectId?: string;
  parentRunId?: string;
  taskId?: string;
  allocatedTokens?: number;
  channelId?: string;
  triggerMessageId?: string;
  queueIfExceeded?: boolean;
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
    const shouldQueue = activeCount >= this.maxActiveConcurrentRuns;
    if (shouldQueue && !params.queueIfExceeded) {
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

    let allocatedTokens = params.allocatedTokens;
    if (params.parentRunId) {
      const parentRun = this.getRun(params.parentRunId);
      if (allocatedTokens === undefined && parentRun) {
        // Inherit remaining token budget from parent run
        const remainingBudget = Math.max(1000, parentRun.allocatedTokens - parentRun.usedTokens);
        allocatedTokens = remainingBudget;
      }
    }
    if (allocatedTokens === undefined) {
      allocatedTokens = 100000;
    }

    const runState: RunState = shouldQueue ? 'queued' : 'running';

    const run: AgentRun = {
      id,
      agentId: params.agentId,
      projectId: params.projectId,
      parentRunId: params.parentRunId,
      taskId: params.taskId,
      channelId: params.channelId,
      triggerMessageId: params.triggerMessageId,
      state: runState,
      heartbeatAt: now,
      allocatedTokens,
      usedTokens: 0,
      createdAt: now,
    };

    this.db.execute(
      `INSERT INTO agent_runs (id, agent_id, project_id, parent_run_id, task_id, channel_id, trigger_message_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      run.id,
      run.agentId,
      run.projectId ?? null,
      run.parentRunId ?? null,
      run.taskId ?? null,
      run.channelId ?? null,
      run.triggerMessageId ?? null,
      run.state,
      run.heartbeatAt,
      run.allocatedTokens,
      run.usedTokens,
      run.createdAt
    );

    if (runState === 'queued') {
      this.recordEvent('agent.run.queued', 'agent_run', run.id, { agentId: run.agentId, taskId: run.taskId });
    } else {
      this.recordEvent('agent.run.started', 'agent_run', run.id, { agentId: run.agentId, taskId: run.taskId });
    }

    return run;
  }

  public queueRun(params: SpawnRunParams): AgentRun {
    return this.spawnRun({ ...params, queueIfExceeded: true });
  }

  public admitNextQueuedRun(): AgentRun | undefined {
    const activeCount = this.getActiveRunCount();
    if (activeCount >= this.maxActiveConcurrentRuns) {
      return undefined;
    }
    const nextQueued = this.db.queryOne<{ id: string }>(
      `SELECT id FROM agent_runs WHERE state = 'queued' ORDER BY created_at ASC LIMIT 1`
    );
    if (!nextQueued) return undefined;
    this.transitionState(nextQueued.id, 'running', 'Admitted from persistent run queue');
    return this.getRun(nextQueued.id);
  }

  public admitAllQueuedRuns(): AgentRun[] {
    const admitted: AgentRun[] = [];
    while (this.getActiveRunCount() < this.maxActiveConcurrentRuns) {
      const next = this.admitNextQueuedRun();
      if (!next) break;
      admitted.push(next);
    }
    return admitted;
  }

  public getRun(id: string): AgentRun | undefined {
    const row = this.db.queryOne<{
      id: string;
      agent_id: string;
      project_id: string | null;
      parent_run_id: string | null;
      task_id: string | null;
      channel_id: string | null;
      trigger_message_id: string | null;
      state: string;
      worktree_path: string | null;
      heartbeat_at: number;
      allocated_tokens: number;
      used_tokens: number;
      quota_resets_at?: number | null;
      interrupted_turn?: number | null;
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
      channelId: row.channel_id ?? undefined,
      triggerMessageId: row.trigger_message_id ?? undefined,
      state: row.state as RunState,
      worktreePath: row.worktree_path ?? undefined,
      heartbeatAt: row.heartbeat_at,
      allocatedTokens: row.allocated_tokens,
      usedTokens: row.used_tokens,
      quotaResetsAt: row.quota_resets_at !== undefined ? row.quota_resets_at : null,
      interruptedTurn: row.interrupted_turn !== undefined ? row.interrupted_turn : null,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  /**
   * Transitions a run into quota_paused state with backoff reset timestamp.
   */
  public pauseForQuota(runId: string, resetWindowMs: number = 900000): void {
    const now = Date.now();
    const quotaResetsAt = now + resetWindowMs;

    this.db.execute(
      `UPDATE agent_runs
       SET state = 'quota_paused',
           quota_resets_at = ?,
           heartbeat_at = ?
       WHERE id = ?`,
      quotaResetsAt,
      now,
      runId
    );

    this.recordEvent('agent.run.quota_paused', 'agent_run', runId, { quotaResetsAt });
  }

  /**
   * Resumes an execution run from paused or quota_paused state.
   */
  public resumeRun(runId: string): void {
    const now = Date.now();

    this.db.execute(
      `UPDATE agent_runs
       SET state = 'running',
           quota_resets_at = NULL,
           heartbeat_at = ?
       WHERE id = ?`,
      now,
      runId
    );

    this.recordEvent('agent.run.resumed', 'agent_run', runId, { resumedAt: now });
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
   * Associates an isolated git worktree path with an active agent run.
   */
  public updateWorktreePath(runId: string, worktreePath: string): void {
    this.db.execute(
      `UPDATE agent_runs SET worktree_path = ? WHERE id = ?`,
      worktreePath,
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
   * Persists a turn checkpoint snapshot into the checkpoints table.
   */
  public saveCheckpoint(runId: string, snapshot: any, worktreeCommitSha?: string): string {
    const id = `chk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.db.execute(
      `INSERT INTO checkpoints (id, run_id, snapshot_json, worktree_commit_sha, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      runId,
      typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot),
      worktreeCommitSha || null,
      Date.now()
    );
    return id;
  }

  /**
   * Stale lease recovery on application restart or watchdog inspection.
   * Finds runs that were 'running' when the app terminated or crashed and transitions them to 'recovering'.
   * Retrieves the latest turn checkpoint snapshot if available.
   */
  public recoverStaleRunsDetailed(staleThresholdMs: number = 45000): Array<{
    id: string;
    agentId: string;
    projectId?: string;
    taskId?: string;
    interruptedTurn?: number;
    checkpoint?: {
      snapshotJson: string;
      createdAt: number;
    };
  }> {
    const cutoff = Date.now() - staleThresholdMs;
    const approvalCutoff = staleThresholdMs === 0 ? Date.now() : Date.now() - 24 * 60 * 60 * 1000;

    const staleRuns = this.db.query<{
      id: string;
      agent_id: string;
      project_id: string | null;
      task_id: string | null;
      interrupted_turn: number | null;
    }>(
      `SELECT id, agent_id, project_id, task_id, interrupted_turn FROM agent_runs
       WHERE (state IN ('running', 'waiting_for_tool', 'waiting_for_agent', 'waiting_for_model') AND heartbeat_at < ?)
          OR (state = 'waiting_for_approval' AND heartbeat_at < ?)`,
      cutoff,
      approvalCutoff
    );

    const recovered: Array<{
      id: string;
      agentId: string;
      projectId?: string;
      taskId?: string;
      interruptedTurn?: number;
      checkpoint?: {
        snapshotJson: string;
        createdAt: number;
      };
    }> = [];

    for (const row of staleRuns) {
      this.db.execute(
        `UPDATE agent_runs SET state = 'recovering', heartbeat_at = ? WHERE id = ?`,
        Date.now(),
        row.id
      );
      this.recordEvent('agent.run.recovering', 'agent_run', row.id, { reason: 'stale_heartbeat_lease_detected' });

      const latestCp = this.db.queryOne<{ snapshot_json: string; created_at: number }>(
        `SELECT snapshot_json, created_at FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
        row.id
      );

      recovered.push({
        id: row.id,
        agentId: row.agent_id,
        projectId: row.project_id || undefined,
        taskId: row.task_id || undefined,
        interruptedTurn: row.interrupted_turn ?? undefined,
        checkpoint: latestCp ? {
          snapshotJson: latestCp.snapshot_json,
          createdAt: latestCp.created_at,
        } : undefined,
      });
    }

    return recovered;
  }

  public recoverStaleRuns(staleThresholdMs: number = 45000): string[] {
    return this.recoverStaleRunsDetailed(staleThresholdMs).map((r) => r.id);
  }

  public getActiveRunCount(): number {
    const freshCutoff = Date.now() - 60000;
    const row = this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM agent_runs 
       WHERE state IN ('running', 'waiting_for_tool', 'waiting_for_agent', 'waiting_for_model') 
         AND heartbeat_at >= ?`,
      freshCutoff
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

  public countDescendants(parentRunId: string): number {
    const row = this.db.queryOne<{ count: number }>(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM agent_runs WHERE parent_run_id = ?
         UNION ALL
         SELECT r.id FROM agent_runs r
         JOIN descendants d ON r.parent_run_id = d.id
       )
       SELECT COUNT(*) as count FROM descendants`,
      parentRunId
    );
    return row?.count ?? 0;
  }

  /**
   * Increments agent_runs.used_tokens by turn usage and checks hard budget limit.
   */
  public recordTokenUsage(runId: string, tokens: number): { usedTokens: number; allocatedTokens: number; exceeded: boolean } {
    this.db.execute(
      `UPDATE agent_runs SET used_tokens = used_tokens + ? WHERE id = ?`,
      tokens,
      runId
    );
    const run = this.getRun(runId);
    const usedTokens = run?.usedTokens ?? 0;
    const allocatedTokens = run?.allocatedTokens ?? 100000;
    const exceeded = usedTokens >= allocatedTokens;

    if (exceeded && run && run.state === 'running') {
      this.transitionState(runId, 'failed', `Hard token budget exceeded: ${usedTokens}/${allocatedTokens} tokens used.`);
    }

    return {
      usedTokens,
      allocatedTokens,
      exceeded,
    };
  }

  private recordEvent(eventType: string, entityType: string, entityId: string, payload: Record<string, unknown>, runId?: string): void {
    try {
      const ledger = EventLedger.ensureInitialized(this.db);
      ledger.record({
        eventType,
        entityType,
        entityId,
        runId,
        payload,
      });
    } catch (err) {
      console.warn('[AGENT KERNEL] EventLedger recording failure:', err);
    }
  }
}
