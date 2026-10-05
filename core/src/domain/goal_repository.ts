import { KinDatabase } from '../storage/db.js';
import { Goal, GoalStatus } from './types.js';

export class GoalRepository {
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
      status: row.status as GoalStatus,
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
        status: r.status as GoalStatus,
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

  public deleteGoal(id: string): void {
    this.db.transactionSync(() => {
      this.db.execute('DELETE FROM tasks WHERE goal_id = ?', id);
      this.db.execute('DELETE FROM goals WHERE id = ?', id);
    });
  }

  public proposeReplanning(goalId: string, replanningProposal: any): void {
    this.db.execute(
      'UPDATE goals SET proposed_replanning_json = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(replanningProposal),
      Date.now(),
      goalId
    );
  }

  public applyReplanning(goalId: string, acceptedProposal: any): void {
    const existing = this.getGoal(goalId);
    if (!existing) throw new Error(`Goal ${goalId} not found`);

    const updatedTitle = acceptedProposal.title || existing.title;
    const updatedDesc = acceptedProposal.description || existing.description;
    const updatedCriteria = acceptedProposal.acceptanceCriteria || existing.acceptanceCriteria;

    this.db.execute(
      `UPDATE goals
       SET title = ?,
           description = ?,
           acceptance_criteria_json = ?,
           proposed_replanning_json = NULL,
           updated_at = ?
       WHERE id = ?`,
      updatedTitle,
      updatedDesc,
      JSON.stringify(updatedCriteria),
      Date.now(),
      goalId
    );
  }

  public updateGoalProgress(goalId: string, progressSummary: string, blockedState?: string): void {
    this.db.execute(
      'UPDATE goals SET progress_summary = ?, blocked_state = ?, updated_at = ? WHERE id = ?',
      progressSummary,
      blockedState ?? null,
      Date.now(),
      goalId
    );
  }

  public listGoalsByOriginChannel(originChannelId: string): Goal[] {
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
    }>('SELECT * FROM goals WHERE origin_channel_id = ? ORDER BY created_at DESC', originChannelId);

    return rows.map((r) => {
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
        status: r.status as GoalStatus,
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
  }
}
