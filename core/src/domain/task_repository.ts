import { KinDatabase } from '../storage/db.js';
import { Goal, Task, TaskStatus } from './types.js';

export class TaskRepository {
  private db: KinDatabase;

  constructor(db: KinDatabase) {
    this.db = db;
  }

  public createGoal(goal: Goal): void {
    this.db.execute(
      `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      goal.id,
      goal.projectId,
      goal.title,
      goal.description,
      JSON.stringify(goal.acceptanceCriteria),
      goal.status,
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
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM goals WHERE id = ?', id);

    if (!row) return undefined;

    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      acceptanceCriteria: JSON.parse(row.acceptance_criteria_json),
      status: row.status as Goal['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public createTask(task: Task, dependsOnTaskIds: string[] = []): void {
    this.db.transactionSync(() => {
      this.db.execute(
        `INSERT INTO tasks (id, goal_id, title, description, assigned_agent_id, status, verification_spec_json, evidence_bundle_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        task.id,
        task.goalId,
        task.title,
        task.description,
        task.assignedAgentId ?? null,
        task.status,
        JSON.stringify(task.verificationSpec),
        task.evidenceBundleId ?? null,
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
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM tasks WHERE id = ?', id);

    if (!row) return undefined;

    return {
      id: row.id,
      goalId: row.goal_id,
      title: row.title,
      description: row.description,
      assignedAgentId: row.assigned_agent_id ?? undefined,
      status: row.status as TaskStatus,
      verificationSpec: JSON.parse(row.verification_spec_json),
      evidenceBundleId: row.evidence_bundle_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Atomic task claim.
   * Guarantees that only one agent claims a ready task.
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
   * A task CANNOT complete without an evidence record.
   */
  public completeTask(taskId: string, evidenceBundleId: string): void {
    const result = this.db.execute(
      `UPDATE tasks
       SET status = 'completed', evidence_bundle_id = ?, updated_at = ?
       WHERE id = ? AND status IN ('running', 'review')`,
      evidenceBundleId,
      Date.now(),
      taskId
    );

    if (Number(result.changes) === 0) {
      throw new Error(`Failed to complete task '${taskId}': Task is not in running/review status.`);
    }

    // Check if dependent tasks can now transition from 'backlog' to 'ready'
    this.checkAndPromoteReadyTasks(taskId);
  }

  private checkAndPromoteReadyTasks(completedTaskId: string): void {
    const dependentTaskIds = this.db.query<{ task_id: string }>(
      `SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?`,
      completedTaskId
    ).map((r) => r.task_id);

    for (const depTaskId of dependentTaskIds) {
      // Check if all dependencies of depTaskId are completed
      const incompleteDeps = this.db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM task_dependencies td
         JOIN tasks t ON td.depends_on_task_id = t.id
         WHERE td.task_id = ? AND t.status != 'completed'`,
        depTaskId
      );

      if (incompleteDeps[0]?.count === 0) {
        this.db.execute(
          `UPDATE tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'backlog'`,
          Date.now(),
          depTaskId
        );
      }
    }
  }
}
