import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as child_process from 'node:child_process';
import { KinDatabase } from '../storage/db.js';
import { Goal, Task, TaskStatus, Decision, DecisionStatus } from './types.js';

export class TaskRepository {
  private db: KinDatabase;

  constructor(db: KinDatabase) {
    this.db = db;
  }

  public createGoal(goal: Goal): void {
    this.db.execute(
      `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, deadline, check_in_policy, progress_summary, blocked_state, proposed_replanning_json, origin_channel_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      goal.id,
      goal.projectId,
      goal.title,
      goal.description,
      JSON.stringify(goal.acceptanceCriteria || []),
      goal.status,
      goal.deadline ?? null,
      goal.checkInPolicy ?? null,
      goal.progressSummary ?? null,
      goal.blockedState ?? null,
      goal.proposedReplanning ? JSON.stringify(goal.proposedReplanning) : null,
      goal.originChannelId ?? null,
      goal.createdAt,
      goal.updatedAt
    );
  }

  public getGoal(id: string): Goal | undefined {
    const row = this.db.queryOne<{
      id: string;
      project_id: string;
      title: string;
      description: string;
      acceptance_criteria_json: string;
      status: string;
      deadline: number | null;
      check_in_policy: string | null;
      progress_summary: string | null;
      blocked_state: string | null;
      proposed_replanning_json: string | null;
      origin_channel_id: string | null;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM goals WHERE id = ?', id);

    if (!row) return undefined;

    let acceptanceCriteria: string[] = [];
    try {
      acceptanceCriteria = JSON.parse(row.acceptance_criteria_json || '[]');
    } catch {
      acceptanceCriteria = [];
    }

    let proposedReplanning: any = undefined;
    if (row.proposed_replanning_json) {
      try {
        proposedReplanning = JSON.parse(row.proposed_replanning_json);
      } catch {}
    }

    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      acceptanceCriteria,
      status: row.status as Goal['status'],
      deadline: row.deadline ?? undefined,
      checkInPolicy: row.check_in_policy ?? undefined,
      progressSummary: row.progress_summary ?? undefined,
      blockedState: row.blocked_state ?? undefined,
      proposedReplanning,
      originChannelId: row.origin_channel_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public createTask(task: Task, dependsOnTaskIds: string[] = []): void {
    this.db.transactionSync(() => {
      this.db.execute(
        `INSERT INTO tasks (id, goal_id, title, description, assigned_agent_id, status, verification_spec_json, evidence_bundle_id, claimed_by_run_id, lease_expires_at, retry_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        task.id,
        task.goalId ?? null,
        task.title,
        task.description ?? '',
        task.assignedAgentId ?? null,
        task.status,
        task.verificationSpec ? JSON.stringify(task.verificationSpec) : '{}',
        task.evidenceBundleId ?? null,
        task.claimedByRunId ?? null,
        task.leaseExpiresAt ?? null,
        task.retryCount ?? 0,
        task.createdAt,
        task.updatedAt
      );

      for (const depId of dependsOnTaskIds) {
        this.db.execute(
          `INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`,
          task.id,
          depId
        );
      }
    });
  }

  public getTask(id: string): Task | undefined {
    const row = this.db.queryOne<{
      id: string;
      goal_id: string;
      title: string;
      description: string;
      assigned_agent_id: string | null;
      status: string;
      verification_spec_json: string;
      evidence_bundle_id: string | null;
      claimed_by_run_id: string | null;
      lease_expires_at: number | null;
      retry_count: number | null;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM tasks WHERE id = ?', id);

    if (!row) return undefined;

    let verificationSpec: Record<string, unknown> = {};
    try {
      verificationSpec = JSON.parse(row.verification_spec_json || '{}');
    } catch {
      verificationSpec = {};
    }

    return {
      id: row.id,
      goalId: row.goal_id,
      title: row.title,
      description: row.description,
      assignedAgentId: row.assigned_agent_id ?? undefined,
      status: row.status as TaskStatus,
      verificationSpec,
      evidenceBundleId: row.evidence_bundle_id ?? undefined,
      claimedByRunId: row.claimed_by_run_id ?? undefined,
      leaseExpiresAt: row.lease_expires_at ?? undefined,
      retryCount: row.retry_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Atomic task claim.
   * Ensures that only one agent claims a ready task.
   */
  public claimTask(taskId: string, agentId: string): boolean {
    const result = this.db.execute(
      `UPDATE tasks
       SET status = 'assigned', assigned_agent_id = ?, updated_at = ?
       WHERE id = ? AND status = 'ready'`,
      agentId,
      Date.now(),
      taskId
    );

    return Number(result.changes) > 0;
  }

  /**
   * Atomic task lease claim.
   * Ensures that only one agent run claims a task with a timed lease.
   * Allows reclaiming expired leases from stalled/crashed runs.
   */
  public claimTaskWithLease(taskId: string, agentId: string, runId: string, leaseDurationMs: number = 300000): boolean {
    const now = Date.now();
    const leaseExpiresAt = now + leaseDurationMs;

    if (runId) {
      try {
        const existingRun = this.db.queryOne('SELECT id FROM agent_runs WHERE id = ?', runId);
        if (!existingRun) {
          this.db.execute(
            `INSERT INTO agent_runs (id, agent_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
             VALUES (?, ?, 'running', ?, 50000, 0, ?)`,
            runId,
            agentId,
            now,
            now
          );
        }
      } catch (e) {
        console.warn('[TASK_REPO] Notice ensuring agent run record:', e);
      }
    }

    const result = this.db.execute(
      `UPDATE tasks
       SET status = 'running',
           assigned_agent_id = ?,
           claimed_by_run_id = ?,
           lease_expires_at = ?,
           updated_at = ?
       WHERE id = ?
         AND (status IN ('ready', 'backlog') OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ?)))`,
      agentId,
      runId,
      leaseExpiresAt,
      now,
      taskId,
      now
    );

    return Number(result.changes) > 0;
  }

  /**
   * Renews the active lease for a running task.
   */
  public renewTaskLease(taskId: string, runId: string, extensionMs: number = 300000): boolean {
    const now = Date.now();
    const leaseExpiresAt = now + extensionMs;

    const result = this.db.execute(
      `UPDATE tasks
       SET lease_expires_at = ?,
           updated_at = ?
       WHERE id = ? AND claimed_by_run_id = ? AND status = 'running'`,
      leaseExpiresAt,
      now,
      taskId,
      runId
    );

    return Number(result.changes) > 0;
  }

  /**
   * Releases an active lease on task completion or failure.
   */
  public releaseTaskLease(taskId: string, runId: string, markFailed: boolean = false): void {
    const now = Date.now();
    const current = this.getTask(taskId);
    let newStatus: TaskStatus = markFailed ? 'failed' : 'ready';
    if (current && (current.status === 'blocked' || current.status === 'review' || current.status === 'completed')) {
      newStatus = current.status;
    }

    this.db.execute(
      `UPDATE tasks
       SET status = ?,
           claimed_by_run_id = NULL,
           lease_expires_at = NULL,
           retry_count = retry_count + ?,
           updated_at = ?
       WHERE id = ? AND claimed_by_run_id = ?`,
      newStatus,
      markFailed ? 1 : 0,
      now,
      taskId,
      runId
    );
  }

  /**
   * Scans for tasks with expired leases and safely resets them to 'ready' for other agents.
   */
  public reclaimExpiredTaskLeases(): string[] {
    const now = Date.now();
    const expired = this.db.query<{ id: string }>(
      `SELECT t.id FROM tasks t
       LEFT JOIN agent_runs r ON t.claimed_by_run_id = r.id
       WHERE t.status = 'running'
         AND t.lease_expires_at IS NOT NULL
         AND (
           (t.lease_expires_at < ? AND (r.state IS NULL OR r.state != 'waiting_for_approval'))
           OR
           (r.state = 'waiting_for_approval' AND t.lease_expires_at + 86400000 < ?)
         )`,
      now,
      now
    );

    if (expired.length === 0) return [];

    const reclaimedIds: string[] = [];
    this.db.transactionSync(() => {
      for (const row of expired) {
        this.db.execute(
          `UPDATE tasks
           SET status = 'ready',
               claimed_by_run_id = NULL,
               lease_expires_at = NULL,
               retry_count = retry_count + 1,
               updated_at = ?
           WHERE id = ?`,
          now,
          row.id
        );
        reclaimedIds.push(row.id);
      }
    });

    return reclaimedIds;
  }

  public findExpiredLeases(): string[] {
    return this.reclaimExpiredTaskLeases();
  }

  public updateTaskStatus(taskId: string, status: TaskStatus): void {
    this.db.execute(
      `UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`,
      status,
      Date.now(),
      taskId
    );
  }

  /**
   * Evidence-gated task completion.
   * A task CANNOT complete without a valid verified evidence record in the evidence table.
   * Atomically clears claimed_by_run_id and lease_expires_at while preserving 'running' status for verification.
   */
  public completeTask(
    taskId: string,
    evidenceBundleId: string,
    expectedRunId?: string
  ): string[] {
    const evidenceRecord = this.db.queryOne<{
      id: string;
      task_id: string;
      run_id: string;
      type: string;
      content_uri: string;
      verified: number | boolean;
    }>(
      'SELECT id, task_id, run_id, type, content_uri, verified FROM evidence WHERE id = ?',
      evidenceBundleId
    );
    if (!evidenceRecord) {
      this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
      throw new Error(`Cannot complete task '${taskId}': Evidence record '${evidenceBundleId}' not found in database. Task remains in review.`);
    }

    if (evidenceRecord.task_id !== taskId) {
      this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
      throw new Error(`Cannot complete task '${taskId}': Evidence record '${evidenceBundleId}' belongs to task '${evidenceRecord.task_id}', not '${taskId}'. Task remains in review.`);
    }

    if (expectedRunId && (!evidenceRecord.run_id || evidenceRecord.run_id !== expectedRunId)) {
      this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
      throw new Error(`Cannot complete task '${taskId}': Evidence record '${evidenceBundleId}' belongs to run '${evidenceRecord.run_id || 'unassigned'}', not expected run '${expectedRunId}'. Task remains in review.`);
    }

    const isVerified = evidenceRecord.verified === 1 || evidenceRecord.verified === true || String(evidenceRecord.verified) === '1';
    if (!isVerified) {
      this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
      throw new Error(`Cannot complete task '${taskId}': Evidence record '${evidenceBundleId}' is unverified (verified = 0). Task remains in review.`);
    }

    const uri = (evidenceRecord.content_uri || '').trim();
    if (!uri) {
      this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
      throw new Error(`Cannot complete task '${taskId}': Evidence record '${evidenceBundleId}' has empty content_uri proof. Task remains in review.`);
    }

    // Resolve project repo path for verifying repository and disk artifacts
    const projectRow = this.db.queryOne<{ repo_path: string }>(
      `SELECT p.repo_path
       FROM tasks t
       LEFT JOIN goals g ON t.goal_id = g.id
       LEFT JOIN projects p ON g.project_id = p.id
       WHERE t.id = ?`,
      taskId
    );
    const repoPath = (projectRow?.repo_path && projectRow.repo_path !== '.') ? path.resolve(process.cwd(), projectRow.repo_path) : process.cwd();

    // Verifiable Artifact Grounding: Prove the artifact actually exists and matches
    if (evidenceRecord.type === 'artifact_hash') {
      if (uri.startsWith('git://commit/')) {
        const commitSha = uri.replace('git://commit/', '').trim();
        if (!/^[0-9a-fA-F]{7,40}$/.test(commitSha)) {
          this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
          throw new Error(`Cannot complete task '${taskId}': Malformed git commit SHA '${commitSha}'. Task remains in review.`);
        }
        let isCommit = false;
        try {
          const objType = child_process.execSync(`git cat-file -t ${commitSha}`, {
            cwd: repoPath,
            stdio: 'pipe',
            timeout: 5000,
          }).toString().trim();
          if (objType === 'commit') {
            isCommit = true;
          }
        } catch {
          try {
            const objType = child_process.execSync(`git cat-file -t ${commitSha}`, {
              cwd: process.cwd(),
              stdio: 'pipe',
              timeout: 5000,
            }).toString().trim();
            if (objType === 'commit') {
              isCommit = true;
            }
          } catch {}
        }
        if (!isCommit) {
          this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
          throw new Error(`Cannot complete task '${taskId}': Git commit '${commitSha}' does not exist in repository '${repoPath}'. Task remains in review.`);
        }
      } else if (uri.startsWith('file://')) {
        let filePath = uri.replace(/^file:\/\//, '');
        let expectedSha: string | null = null;
        if (filePath.includes('?sha256=')) {
          const parts = filePath.split('?sha256=');
          filePath = parts[0];
          expectedSha = parts[1];
        } else if (filePath.includes('?')) {
          filePath = filePath.split('?')[0];
        }
        try { filePath = decodeURIComponent(filePath); } catch {}
        if (process.platform === 'win32' && filePath.startsWith('/') && filePath.length > 2 && filePath[2] === ':') {
          filePath = filePath.slice(1);
        }
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(repoPath, filePath);
        if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
          this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
          throw new Error(`Cannot complete task '${taskId}': Evidence artifact file '${resolvedPath}' does not exist on disk. Task remains in review.`);
        }
        if (expectedSha) {
          const actualHash = crypto.createHash('sha256').update(fs.readFileSync(resolvedPath)).digest('hex');
          if (actualHash.toLowerCase() !== expectedSha.toLowerCase()) {
            this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
            throw new Error(`Cannot complete task '${taskId}': Artifact file '${resolvedPath}' SHA256 '${actualHash}' does not match expected '${expectedSha}'. Task remains in review.`);
          }
        }
      } else {
        const resolvedPath = path.isAbsolute(uri) ? uri : path.resolve(repoPath, uri);
        if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
          this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
          throw new Error(`Cannot complete task '${taskId}': Evidence record '${evidenceBundleId}' contains invalid artifact proof URI '${uri}' that does not resolve to an existing artifact. Task remains in review.`);
        }
      }
    } else if (evidenceRecord.type === 'human_signoff') {
      const isOperatorSignoff = uri.startsWith('operator://signoff/') && uri.replace('operator://signoff/', '').trim().length > 0;
      if (uri.startsWith('file://')) {
        let filePath = uri.replace(/^file:\/\//, '');
        if (filePath.includes('?')) {
          filePath = filePath.split('?')[0];
        }
        try { filePath = decodeURIComponent(filePath); } catch {}
        if (process.platform === 'win32' && filePath.startsWith('/') && filePath.length > 2 && filePath[2] === ':') {
          filePath = filePath.slice(1);
        }
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(repoPath, filePath);
        if (!fs.existsSync(resolvedPath)) {
          this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
          throw new Error(`Cannot complete task '${taskId}': Human signoff file '${resolvedPath}' does not exist on disk. Task remains in review.`);
        }
      } else if (!isOperatorSignoff) {
        this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
        throw new Error(`Cannot complete task '${taskId}': Evidence record '${evidenceBundleId}' contains invalid human_signoff URI '${uri}'. Task remains in review.`);
      }
    } else if (evidenceRecord.type === 'test_output' || evidenceRecord.type === 'build_log') {
      if (uri.startsWith('file://')) {
        let filePath = uri.replace(/^file:\/\//, '');
        let expectedSha: string | null = null;
        if (filePath.includes('?sha256=')) {
          const parts = filePath.split('?sha256=');
          filePath = parts[0];
          expectedSha = parts[1];
        } else if (filePath.includes('?')) {
          filePath = filePath.split('?')[0];
        }
        try { filePath = decodeURIComponent(filePath); } catch {}
        if (process.platform === 'win32' && filePath.startsWith('/') && filePath.length > 2 && filePath[2] === ':') {
          filePath = filePath.slice(1);
        }
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(repoPath, filePath);
        if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
          this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
          throw new Error(`Cannot complete task '${taskId}': ${evidenceRecord.type} file '${resolvedPath}' does not exist on disk. Task remains in review.`);
        }
        if (expectedSha) {
          const actualHash = crypto.createHash('sha256').update(fs.readFileSync(resolvedPath)).digest('hex');
          if (actualHash.toLowerCase() !== expectedSha.toLowerCase()) {
            this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
            throw new Error(`Cannot complete task '${taskId}': ${evidenceRecord.type} file '${resolvedPath}' SHA256 '${actualHash}' does not match expected '${expectedSha}'. Task remains in review.`);
          }
        }
      } else if (uri.startsWith('git://commit/')) {
        const commitSha = uri.replace('git://commit/', '').trim();
        if (!/^[0-9a-fA-F]{7,40}$/.test(commitSha)) {
          this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
          throw new Error(`Cannot complete task '${taskId}': Malformed git commit SHA '${commitSha}'. Task remains in review.`);
        }
        let isCommit = false;
        try {
          const objType = child_process.execSync(`git cat-file -t ${commitSha}`, { cwd: repoPath, stdio: 'pipe' }).toString().trim();
          if (objType === 'commit') isCommit = true;
        } catch {
          try {
            const objType = child_process.execSync(`git cat-file -t ${commitSha}`, { cwd: process.cwd(), stdio: 'pipe' }).toString().trim();
            if (objType === 'commit') isCommit = true;
          } catch {}
        }
        if (!isCommit) {
          this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
          throw new Error(`Cannot complete task '${taskId}': Git commit '${commitSha}' does not exist in repository. Task remains in review.`);
        }
      } else {
        const resolvedPath = path.isAbsolute(uri) ? uri : path.resolve(repoPath, uri);
        if (!fs.existsSync(resolvedPath)) {
          this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
          throw new Error(`Cannot complete task '${taskId}': Evidence record '${evidenceBundleId}' contains insufficient test/build proof or nonexistent file. Task remains in review.`);
        }
      }
    } else {
      this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
      throw new Error(`Cannot complete task '${taskId}': Evidence record '${evidenceBundleId}' has unrecognized evidence type '${evidenceRecord.type}'. Task remains in review.`);
    }

    const task = this.getTask(taskId);
    if (task?.verificationSpec?.expectedArtifactType && evidenceRecord.type !== task.verificationSpec.expectedArtifactType) {
      this.db.execute(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?`, Date.now(), taskId);
      throw new Error(`Cannot complete task '${taskId}': Evidence type '${evidenceRecord.type}' does not match expected artifact type '${task.verificationSpec.expectedArtifactType}'. Task remains in review.`);
    }

    const result = this.db.execute(
      `UPDATE tasks
       SET status = 'completed', evidence_bundle_id = ?, claimed_by_run_id = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND status IN ('running', 'review')`,
      evidenceBundleId,
      Date.now(),
      taskId
    );

    if (Number(result.changes) === 0) {
      throw new Error(`Failed to complete task '${taskId}': Task is not in running/review status.`);
    }

    // Check if dependent tasks can now transition from 'backlog' to 'ready'
    return this.promoteDependentTasks(taskId);
  }

  public promoteDependentTasks(completedTaskId: string): string[] {
    const dependentTaskIds = this.db.query<{ task_id: string }>(
      `SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?`,
      completedTaskId
    ).map((r) => r.task_id);

    const promotedTaskIds: string[] = [];

    for (const depTaskId of dependentTaskIds) {
      // Check if all dependencies of depTaskId are completed
      const incompleteDeps = this.db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM task_dependencies td
         JOIN tasks t ON td.depends_on_task_id = t.id
         WHERE td.task_id = ? AND t.status != 'completed'`,
        depTaskId
      );

      if (incompleteDeps[0]?.count === 0) {
        const res = this.db.execute(
          `UPDATE tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'backlog'`,
          Date.now(),
          depTaskId
        );
        if (Number(res.changes) > 0) {
          promotedTaskIds.push(depTaskId);
        }
      }
    }

    return promotedTaskIds;
  }

  public listGoals(projectId: string, deduplicate: boolean = true): Goal[] {
    const rows = this.db.query<{
      id: string;
      project_id: string;
      title: string;
      description: string;
      acceptance_criteria_json: string;
      status: string;
      deadline: number | null;
      check_in_policy: string | null;
      progress_summary: string | null;
      blocked_state: string | null;
      proposed_replanning_json: string | null;
      origin_channel_id: string | null;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM goals WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC', projectId);

    const goals = rows.map((r) => {
      let proposedReplanning: any = undefined;
      if (r.proposed_replanning_json) {
        try {
          proposedReplanning = JSON.parse(r.proposed_replanning_json);
        } catch {}
      }
      return {
        id: r.id,
        projectId: r.project_id,
        title: r.title,
        description: r.description,
        acceptanceCriteria: JSON.parse(r.acceptance_criteria_json || '[]'),
        status: r.status as Goal['status'],
        deadline: r.deadline ?? undefined,
        checkInPolicy: r.check_in_policy ?? undefined,
        progressSummary: r.progress_summary ?? undefined,
        blockedState: r.blocked_state ?? undefined,
        proposedReplanning,
        originChannelId: r.origin_channel_id ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    if (!deduplicate) return goals;

    const seen = new Set<string>();
    return goals.filter((g) => {
      const key = g.title.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Prunes duplicate goals with the same title from the SQLite database, preserving the latest updated row.
   */
  public pruneDuplicateGoals(projectId: string): number {
    const all = this.listGoals(projectId, false);
    const seen = new Map<string, string>(); // title -> keptId
    const toDelete: string[] = [];

    for (const g of all) {
      const key = g.title.toLowerCase().trim();
      if (seen.has(key)) {
        toDelete.push(g.id);
      } else {
        seen.set(key, g.id);
      }
    }

    if (toDelete.length > 0) {
      this.db.transactionSync(() => {
        for (const id of toDelete) {
          this.db.execute('DELETE FROM goals WHERE id = ?', id);
        }
      });
    }

    return toDelete.length;
  }

  public listTasksByGoal(goalId: string): Task[] {
    const rows = this.db.query<{
      id: string;
      goal_id: string;
      title: string;
      description: string;
      assigned_agent_id: string | null;
      status: string;
      verification_spec_json: string;
      evidence_bundle_id: string | null;
      claimed_by_run_id: string | null;
      lease_expires_at: number | null;
      retry_count: number | null;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM tasks WHERE goal_id = ? ORDER BY created_at ASC', goalId);

    return rows.map((r) => ({
      id: r.id,
      goalId: r.goal_id,
      title: r.title,
      description: r.description,
      assignedAgentId: r.assigned_agent_id ?? undefined,
      status: r.status as TaskStatus,
      verificationSpec: JSON.parse(r.verification_spec_json || '{}'),
      evidenceBundleId: r.evidence_bundle_id ?? undefined,
      claimedByRunId: r.claimed_by_run_id ?? undefined,
      leaseExpiresAt: r.lease_expires_at ?? undefined,
      retryCount: r.retry_count ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public listTasksByProject(projectId: string): Task[] {
    const rows = this.db.query<{
      id: string;
      goal_id: string;
      title: string;
      description: string;
      assigned_agent_id: string | null;
      status: string;
      verification_spec_json: string;
      evidence_bundle_id: string | null;
      claimed_by_run_id: string | null;
      lease_expires_at: number | null;
      retry_count: number | null;
      created_at: number;
      updated_at: number;
    }>(
      `SELECT t.* FROM tasks t
       JOIN goals g ON t.goal_id = g.id
       WHERE g.project_id = ?
       ORDER BY t.created_at ASC`,
      projectId
    );

    return rows.map((r) => ({
      id: r.id,
      goalId: r.goal_id,
      title: r.title,
      description: r.description,
      assignedAgentId: r.assigned_agent_id ?? undefined,
      status: r.status as TaskStatus,
      verificationSpec: JSON.parse(r.verification_spec_json || '{}'),
      evidenceBundleId: r.evidence_bundle_id ?? undefined,
      claimedByRunId: r.claimed_by_run_id ?? undefined,
      leaseExpiresAt: r.lease_expires_at ?? undefined,
      retryCount: r.retry_count ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public updateGoal(goal: Goal): void {
    this.db.execute(
      `UPDATE goals
       SET title = ?,
           description = ?,
           acceptance_criteria_json = ?,
           status = ?,
           deadline = ?,
           check_in_policy = ?,
           progress_summary = ?,
           blocked_state = ?,
           proposed_replanning_json = ?,
           origin_channel_id = ?,
           updated_at = ?
       WHERE id = ?`,
      goal.title,
      goal.description,
      JSON.stringify(goal.acceptanceCriteria || []),
      goal.status,
      goal.deadline ?? null,
      goal.checkInPolicy ?? null,
      goal.progressSummary ?? null,
      goal.blockedState ?? null,
      goal.proposedReplanning ? JSON.stringify(goal.proposedReplanning) : null,
      goal.originChannelId ?? null,
      goal.updatedAt || Date.now(),
      goal.id
    );
  }

  public deleteTasksByGoal(goalId: string): void {
    this.db.execute('DELETE FROM tasks WHERE goal_id = ?', goalId);
  }

  public deleteGoal(id: string): void {
    this.db.transactionSync(() => {
      this.db.execute('DELETE FROM tasks WHERE goal_id = ?', id);
      this.db.execute('DELETE FROM goals WHERE id = ?', id);
    });
  }

  public deleteTask(id: string): void {
    this.db.transactionSync(() => {
      this.db.execute('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?', id, id);
      this.db.execute('DELETE FROM tasks WHERE id = ?', id);
    });
  }

  public createDecision(decision: Decision): void {
    this.db.execute(
      `INSERT INTO decisions (id, project_id, task_id, decided_by_id, title, rationale, alternatives_considered_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      decision.id,
      decision.projectId,
      decision.taskId ?? null,
      decision.decidedById,
      decision.title,
      decision.rationale,
      JSON.stringify(decision.alternativesConsidered || []),
      decision.status,
      decision.createdAt
    );
  }

  public getDecision(id: string): Decision | undefined {
    const row = this.db.queryOne<{
      id: string;
      project_id: string;
      task_id: string | null;
      decided_by_id: string;
      title: string;
      rationale: string;
      alternatives_considered_json: string;
      status: string;
      created_at: number;
    }>('SELECT * FROM decisions WHERE id = ?', id);

    if (!row) return undefined;

    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id ?? undefined,
      decidedById: row.decided_by_id,
      title: row.title,
      rationale: row.rationale,
      alternativesConsidered: JSON.parse(row.alternatives_considered_json || '[]'),
      status: row.status as DecisionStatus,
      createdAt: row.created_at,
    };
  }

  public listDecisionsByProject(projectId: string): Decision[] {
    const rows = this.db.query<{
      id: string;
      project_id: string;
      task_id: string | null;
      decided_by_id: string;
      title: string;
      rationale: string;
      alternatives_considered_json: string;
      status: string;
      created_at: number;
    }>('SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC', projectId);

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      taskId: r.task_id ?? undefined,
      decidedById: r.decided_by_id,
      title: r.title,
      rationale: r.rationale,
      alternativesConsidered: JSON.parse(r.alternatives_considered_json || '[]'),
      status: r.status as DecisionStatus,
      createdAt: r.created_at,
    }));
  }

  public listDecisions(projectId: string = 'proj-kin'): Decision[] {
    return this.listDecisionsByProject(projectId);
  }

  public listAllDecisions(): Decision[] {
    const rows = this.db.query<{
      id: string;
      project_id: string;
      task_id: string | null;
      decided_by_id: string;
      title: string;
      rationale: string;
      alternatives_considered_json: string;
      status: string;
      created_at: number;
    }>('SELECT * FROM decisions ORDER BY created_at DESC');

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      taskId: r.task_id ?? undefined,
      decidedById: r.decided_by_id,
      title: r.title,
      rationale: r.rationale,
      alternativesConsidered: JSON.parse(r.alternatives_considered_json || '[]'),
      status: r.status as DecisionStatus,
      createdAt: r.created_at,
    }));
  }

  public updateDecisionStatus(id: string, status: DecisionStatus): void {
    this.db.execute('UPDATE decisions SET status = ? WHERE id = ?', status, id);
  }

  public deleteDecision(id: string): void {
    this.db.execute('DELETE FROM decisions WHERE id = ?', id);
  }
}

