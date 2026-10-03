// ============================================================================
// KIN IN-APP SCHEDULER & TIMED AUTONOMY ENGINE
// Durable Antigravity-style scheduler: one-shot timers & recurring cron.
// Agents sleep rather than busy-polling; wakes agents without GPU looping.
// ============================================================================

import { KinDatabase } from '../storage/db.js';
import { Schedule, ScheduleType, ScheduleStatus } from '../domain/types.js';
import { v4 as uuidv4 } from 'uuid';

export interface CreateOneShotParams {
  projectId: string;
  channelId: string;
  targetAgentId?: string;
  prompt: string;
  durationSeconds: number;
  timerCondition?: string;
}

export interface CreateCronParams {
  projectId: string;
  channelId: string;
  targetAgentId?: string;
  prompt: string;
  cronExpression: string;
  maxIterations?: number;
}

export type ScheduleFireCallback = (schedule: Schedule) => Promise<void> | void;

export class SchedulerService {
  private db: KinDatabase;
  private timerHandle: NodeJS.Timeout | null = null;
  private onFireCallback: ScheduleFireCallback | null = null;
  private isEvaluating: boolean = false;

  constructor(db: KinDatabase) {
    this.db = db;
  }

  /**
   * Registers callback invoked when a timer or cron trigger fires.
   */
  public onScheduleFired(cb: ScheduleFireCallback): void {
    this.onFireCallback = cb;
  }

  /**
   * Starts background evaluation loop (ticks every 1000ms).
   */
  public start(): void {
    if (this.timerHandle) return;
    this.timerHandle = setInterval(() => {
      if (this.db.closed) return;
      this.evaluatePendingSchedules().catch((err) => {
        if (!this.db.closed) {
          console.error('[KIN SCHEDULER] Evaluation error:', err);
        }
      });
    }, 1000);
  }

  /**
   * Stops background evaluation loop.
   */
  public stop(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /**
   * Creates an Antigravity-style one-shot timer that fires once after DurationSeconds.
   */
  public createOneShotTimer(params: CreateOneShotParams): Schedule {
    const id = `sched-${uuidv4()}`;
    const now = Date.now();
    const durationSec = Math.max(1, params.durationSeconds);
    const nextRunAt = now + durationSec * 1000;

    const schedule: Schedule = {
      id,
      projectId: params.projectId,
      channelId: params.channelId,
      targetAgentId: params.targetAgentId,
      type: 'one_shot',
      prompt: params.prompt,
      durationSeconds: durationSec,
      timerCondition: params.timerCondition || 'never',
      currentIterations: 0,
      status: 'active',
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    };

    this.db.execute(
      `INSERT INTO schedules (id, project_id, channel_id, target_agent_id, type, prompt, duration_seconds, cron_expression, timer_condition, max_iterations, current_iterations, status, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, 'active', ?, ?, ?)`,
      schedule.id,
      schedule.projectId,
      schedule.channelId,
      schedule.targetAgentId ?? null,
      schedule.type,
      schedule.prompt,
      schedule.durationSeconds ?? null,
      schedule.timerCondition ?? 'never',
      schedule.nextRunAt,
      schedule.createdAt,
      schedule.updatedAt
    );

    return schedule;
  }

  /**
   * Creates a recurring cron schedule.
   */
  public createCronSchedule(params: CreateCronParams): Schedule {
    const id = `sched-${uuidv4()}`;
    const now = Date.now();
    // Simple interval parser: */N * * * * or fallback to 60s
    const intervalSec = this.parseCronIntervalSeconds(params.cronExpression);
    const nextRunAt = now + intervalSec * 1000;

    const schedule: Schedule = {
      id,
      projectId: params.projectId,
      channelId: params.channelId,
      targetAgentId: params.targetAgentId,
      type: 'cron',
      prompt: params.prompt,
      cronExpression: params.cronExpression,
      maxIterations: params.maxIterations,
      currentIterations: 0,
      status: 'active',
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    };

    this.db.execute(
      `INSERT INTO schedules (id, project_id, channel_id, target_agent_id, type, prompt, duration_seconds, cron_expression, timer_condition, max_iterations, current_iterations, status, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'never', ?, 0, 'active', ?, ?, ?)`,
      schedule.id,
      schedule.projectId,
      schedule.channelId,
      schedule.targetAgentId ?? null,
      schedule.type,
      schedule.prompt,
      schedule.cronExpression ?? null,
      schedule.maxIterations ?? null,
      schedule.nextRunAt,
      schedule.createdAt,
      schedule.updatedAt
    );

    return schedule;
  }

  /**
   * Cancels an active schedule.
   */
  public cancelSchedule(id: string): boolean {
    const row = this.db.queryOne<{ id: string }>(`SELECT id FROM schedules WHERE id = ? AND status = 'active'`, id);
    if (!row) return false;

    this.db.execute(`UPDATE schedules SET status = 'cancelled', updated_at = ? WHERE id = ?`, Date.now(), id);
    return true;
  }

  /**
   * Lists all schedules for a project.
   */
  public listSchedules(projectId: string): Schedule[] {
    const rows = this.db.query<{
      id: string;
      project_id: string;
      channel_id: string;
      target_agent_id: string | null;
      type: string;
      prompt: string;
      duration_seconds: number | null;
      cron_expression: string | null;
      timer_condition: string | null;
      max_iterations: number | null;
      current_iterations: number;
      status: string;
      next_run_at: number;
      last_run_at: number | null;
      created_at: number;
      updated_at: number;
    }>(
      `SELECT * FROM schedules WHERE project_id = ? ORDER BY created_at DESC`,
      projectId
    );

    return rows.map(this.mapRowToSchedule);
  }

  /**
   * Lists all schedules across all projects.
   */
  public listAllSchedules(): Schedule[] {
    const rows = this.db.query<{
      id: string;
      project_id: string;
      channel_id: string;
      target_agent_id: string | null;
      type: string;
      prompt: string;
      duration_seconds: number | null;
      cron_expression: string | null;
      timer_condition: string | null;
      max_iterations: number | null;
      current_iterations: number;
      status: string;
      next_run_at: number;
      last_run_at: number | null;
      created_at: number;
      updated_at: number;
    }>(
      `SELECT * FROM schedules ORDER BY created_at DESC`
    );

    return rows.map(this.mapRowToSchedule);
  }

  public getSchedule(id: string): Schedule | undefined {
    const row = this.db.queryOne<{
      id: string;
      project_id: string;
      channel_id: string;
      target_agent_id: string | null;
      type: string;
      prompt: string;
      duration_seconds: number | null;
      cron_expression: string | null;
      timer_condition: string | null;
      max_iterations: number | null;
      current_iterations: number;
      status: string;
      next_run_at: number;
      last_run_at: number | null;
      created_at: number;
      updated_at: number;
    }>(
      `SELECT * FROM schedules WHERE id = ?`,
      id
    );

    return row ? this.mapRowToSchedule(row) : undefined;
  }

  /**
   * Manually fires a schedule immediately.
   */
  public async triggerSchedule(id: string): Promise<boolean> {
    const res = await this.triggerScheduleNow(id);
    return !!res;
  }

  /**
   * Returns active timers/cron for a project.
   */
  public getActiveSchedules(projectId: string): Schedule[] {
    const rows = this.db.query<{
      id: string;
      project_id: string;
      channel_id: string;
      target_agent_id: string | null;
      type: string;
      prompt: string;
      duration_seconds: number | null;
      cron_expression: string | null;
      timer_condition: string | null;
      max_iterations: number | null;
      current_iterations: number;
      status: string;
      next_run_at: number;
      last_run_at: number | null;
      created_at: number;
      updated_at: number;
    }>(
      `SELECT * FROM schedules WHERE project_id = ? AND status = 'active' ORDER BY next_run_at ASC`,
      projectId
    );

    return rows.map(this.mapRowToSchedule);
  }

  /**
   * Evaluates and fires any schedules whose nextRunAt timestamp has arrived.
   */
  public async evaluatePendingSchedules(): Promise<Schedule[]> {
    if (this.isEvaluating || this.db.closed) return [];
    this.isEvaluating = true;
    try {
      const now = Date.now();
      const rows = this.db.query<{
        id: string;
        project_id: string;
        channel_id: string;
        target_agent_id: string | null;
        type: string;
        prompt: string;
        duration_seconds: number | null;
        cron_expression: string | null;
        timer_condition: string | null;
        max_iterations: number | null;
        current_iterations: number;
        status: string;
        next_run_at: number;
        last_run_at: number | null;
        created_at: number;
        updated_at: number;
      }>(
        `SELECT * FROM schedules WHERE status = 'active' AND next_run_at <= ? ORDER BY next_run_at ASC`,
        now
      );

      const fired: Schedule[] = [];

      for (const row of rows) {
        const schedule = this.mapRowToSchedule(row);
        const newIterations = (schedule.currentIterations ?? 0) + 1;

        if (schedule.type === 'one_shot') {
          this.db.execute(
            `UPDATE schedules SET status = 'completed', current_iterations = ?, last_run_at = ?, updated_at = ? WHERE id = ?`,
            newIterations,
            now,
            now,
            schedule.id
          );
        } else {
          // Recurring cron
          const hasReachedLimit = schedule.maxIterations && newIterations >= schedule.maxIterations;
          const newStatus = hasReachedLimit ? 'completed' : 'active';
          const intervalSec = this.parseCronIntervalSeconds(schedule.cronExpression || '*/1 * * * *');
          const nextRun = hasReachedLimit ? now : now + intervalSec * 1000;

          this.db.execute(
            `UPDATE schedules SET status = ?, current_iterations = ?, last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
            newStatus,
            newIterations,
            now,
            nextRun,
            now,
            schedule.id
          );
        }

        fired.push(schedule);

        if (this.onFireCallback) {
          try {
            await this.onFireCallback(schedule);
          } catch (err) {
            console.error(`[KIN SCHEDULER] Error firing schedule ${schedule.id}:`, err);
          }
        }
      }

      return fired;
    } finally {
      this.isEvaluating = false;
    }
  }

  public parseCronIntervalSeconds(expr: string): number {
    const trimmed = expr.trim();
    // Bare seconds or seconds notation: '30', '30s', '45s', '*/30s', or '*/30'
    const secMatch = trimmed.match(/^(\*\/)?(\d+)\s*s?$/i);
    if (secMatch) {
      return Math.max(5, parseInt(secMatch[2], 10));
    }

    // Minute intervals: '*/5 * * * *'
    const minMatch = trimmed.match(/^\*\/(\d+)/);
    if (minMatch) {
      const minutes = parseInt(minMatch[1], 10);
      return Math.max(10, minutes * 60);
    }

    // Daily: '0 0 * * *' or '30 2 * * *'
    if (/^\d+\s+\d+\s+\*\s+\*\s+\*/.test(trimmed)) {
      return 86400;
    }

    // Hourly with interval: '0 */2 * * *'
    const hourIntervalMatch = trimmed.match(/^\d+\s+\*\/(\d+)\s+\*\s+\*\s+\*/);
    if (hourIntervalMatch) {
      const hours = parseInt(hourIntervalMatch[1], 10);
      return Math.max(3600, hours * 3600);
    }

    // Hourly: '0 * * * *'
    if (trimmed.startsWith('0 *')) return 3600;

    // Every minute: '* * * * *' or fallback
    return 60;
  }

  /**
   * Manually triggers an active or existing schedule immediately without waiting for nextRunAt.
   */
  public async triggerScheduleNow(id: string): Promise<Schedule | null> {
    const row = this.db.queryOne<any>(`SELECT * FROM schedules WHERE id = ?`, id);
    if (!row) return null;
    const schedule = this.mapRowToSchedule(row);
    const now = Date.now();
    const newIterations = (schedule.currentIterations ?? 0) + 1;

    if (schedule.type === 'one_shot') {
      this.db.execute(
        `UPDATE schedules SET status = 'completed', current_iterations = ?, last_run_at = ?, updated_at = ? WHERE id = ?`,
        newIterations,
        now,
        now,
        schedule.id
      );
      schedule.status = 'completed';
    } else {
      const intervalSec = this.parseCronIntervalSeconds(schedule.cronExpression || '*/1 * * * *');
      const nextRun = now + intervalSec * 1000;
      this.db.execute(
        `UPDATE schedules SET current_iterations = ?, last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
        newIterations,
        now,
        nextRun,
        now,
        schedule.id
      );
      schedule.nextRunAt = nextRun;
    }
    schedule.lastRunAt = now;
    schedule.currentIterations = newIterations;

    if (this.onFireCallback) {
      try {
        await this.onFireCallback(schedule);
      } catch (err) {
        console.error(`[KIN SCHEDULER] Error manually triggering schedule ${schedule.id}:`, err);
      }
    }
    return schedule;
  }

  private mapRowToSchedule(row: any): Schedule {
    return {
      id: row.id,
      projectId: row.project_id,
      channelId: row.channel_id,
      targetAgentId: row.target_agent_id ?? undefined,
      type: row.type as ScheduleType,
      prompt: row.prompt,
      durationSeconds: row.duration_seconds ?? undefined,
      cronExpression: row.cron_expression ?? undefined,
      timerCondition: row.timer_condition ?? 'never',
      maxIterations: row.max_iterations ?? undefined,
      currentIterations: row.current_iterations,
      status: row.status as ScheduleStatus,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
