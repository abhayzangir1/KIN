// ============================================================================
// KIN IN-APP SCHEDULER & TIMED AUTONOMY ENGINE
// Durable Antigravity-style scheduler: one-shot timers & recurring cron.
// Agents sleep rather than busy-polling; wakes agents without GPU looping.
// ============================================================================

import { KinDatabase } from '../storage/db.js';
import { Schedule, ScheduleType, ScheduleStatus, ScheduleAttempt } from '../domain/types.js';
import { validateCronExpression, getNextCronOccurrence } from './cron_calendar.js';
import { v4 as uuidv4 } from 'uuid';
import { SecretBroker } from '../security/secret_broker.js';

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
   * Creates a recurring cron schedule with real calendar validation and scheduling.
   */
  public createCronSchedule(params: CreateCronParams): Schedule {
    const validation = validateCronExpression(params.cronExpression);
    if (!validation.valid) {
      throw new Error(`Invalid cron expression '${params.cronExpression}': ${validation.error}`);
    }

    const id = `sched-${uuidv4()}`;
    const now = Date.now();
    const nextRunDate = getNextCronOccurrence(params.cronExpression, now);
    const nextRunAt = nextRunDate.getTime();

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
    const rows = this.db.query<any>(
      `SELECT * FROM schedules WHERE project_id = ? ORDER BY created_at DESC`,
      projectId
    );

    return rows.map((r) => this.mapRowToSchedule(r));
  }

  /**
   * Lists all schedules across all projects.
   */
  public listAllSchedules(): Schedule[] {
    const rows = this.db.query<any>(
      `SELECT * FROM schedules ORDER BY created_at DESC`
    );

    return rows.map((r) => this.mapRowToSchedule(r));
  }

  public getSchedule(id: string): Schedule | undefined {
    const row = this.db.queryOne<any>(
      `SELECT * FROM schedules WHERE id = ?`,
      id
    );

    return row ? this.mapRowToSchedule(row) : undefined;
  }

  /**
   * Manually fires a schedule immediately.
   */
  public async triggerSchedule(id: string): Promise<boolean> {
    try {
      const res = await this.triggerScheduleNow(id);
      return !!res;
    } catch {
      return false;
    }
  }

  /**
   * Returns active timers/cron for a project.
   */
  public getActiveSchedules(projectId: string): Schedule[] {
    const rows = this.db.query<any>(
      `SELECT * FROM schedules WHERE project_id = ? AND status = 'active' ORDER BY next_run_at ASC`,
      projectId
    );

    return rows.map((r) => this.mapRowToSchedule(r));
  }

  /**
   * Evaluates and fires any schedules whose nextRunAt timestamp has arrived.
   */
  public async evaluatePendingSchedules(): Promise<Schedule[]> {
    if (this.isEvaluating || this.db.closed) return [];
    this.isEvaluating = true;
    try {
      const now = Date.now();
      const rows = this.db.query<any>(
        `SELECT * FROM schedules WHERE status = 'active' AND next_run_at <= ? ORDER BY next_run_at ASC`,
        now
      );

      const fired: Schedule[] = [];

      for (const row of rows) {
        const schedule = this.mapRowToSchedule(row);

        // Check timerCondition for one-shot timers (early cancel if condition was met)
        if (schedule.type === 'one_shot' && this.shouldCancelTimerCondition(schedule)) {
          this.db.execute(
            `UPDATE schedules SET status = 'cancelled', updated_at = ? WHERE id = ?`,
            now,
            schedule.id
          );
          continue;
        }

        const attemptNumber = (schedule.currentIterations ?? 0) + 1;
        let dispatchError: Error | null = null;

        // Await dispatch callback BEFORE marking completed or advancing iterations
        if (this.onFireCallback) {
          try {
            await this.onFireCallback(schedule);
          } catch (err: any) {
            dispatchError = err instanceof Error ? err : new Error(String(err));
            console.error(`[KIN SCHEDULER] Error firing schedule ${schedule.id}:`, err);
          }
        }

        if (dispatchError) {
          // Record failed attempt in durable audit history
          this.recordAttempt(schedule.id, attemptNumber, 'failure', dispatchError.message, now);

          if (schedule.type === 'one_shot') {
            // Leave one-shot in 'failed' status for explicit failure tracking and retry
            this.db.execute(
              `UPDATE schedules SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`,
              dispatchError.message,
              now,
              schedule.id
            );
            schedule.status = 'failed';
            schedule.lastError = dispatchError.message;
          } else {
            // For recurring cron, record failure and error, do not increment iterations, advance next run
            const nextRunDate = getNextCronOccurrence(schedule.cronExpression || '*/1 * * * *', now);
            const nextRun = nextRunDate.getTime();
            this.db.execute(
              `UPDATE schedules SET next_run_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
              nextRun,
              dispatchError.message,
              now,
              schedule.id
            );
            schedule.nextRunAt = nextRun;
            schedule.lastError = dispatchError.message;
          }
          continue;
        }

        // Dispatch succeeded! Record attempt and advance state
        this.recordAttempt(schedule.id, attemptNumber, 'success', undefined, now);
        const newIterations = attemptNumber;

        if (schedule.type === 'one_shot') {
          this.db.execute(
            `UPDATE schedules SET status = 'completed', current_iterations = ?, last_run_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
            newIterations,
            now,
            now,
            schedule.id
          );
          schedule.status = 'completed';
          schedule.currentIterations = newIterations;
          schedule.lastRunAt = now;
          schedule.lastError = undefined;
        } else {
          // Recurring cron
          const hasReachedLimit = schedule.maxIterations !== undefined && newIterations >= schedule.maxIterations;
          const newStatus: ScheduleStatus = hasReachedLimit ? 'completed' : 'active';
          const nextRunDate = getNextCronOccurrence(schedule.cronExpression || '*/1 * * * *', now);
          const nextRun = hasReachedLimit ? now : nextRunDate.getTime();

          this.db.execute(
            `UPDATE schedules SET status = ?, current_iterations = ?, last_run_at = ?, next_run_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
            newStatus,
            newIterations,
            now,
            nextRun,
            now,
            schedule.id
          );
          schedule.status = newStatus;
          schedule.currentIterations = newIterations;
          schedule.lastRunAt = now;
          schedule.nextRunAt = nextRun;
          schedule.lastError = undefined;
        }

        fired.push(schedule);
      }

      return fired;
    } finally {
      this.isEvaluating = false;
    }
  }

  public shouldCancelTimerCondition(schedule: Schedule): boolean {
    if (!schedule.timerCondition || schedule.timerCondition === 'never') return false;
    const condition = schedule.timerCondition.trim();
    if (condition === 'any') {
      const recent = this.db.queryOne<{ id: string }>(
        `SELECT id FROM messages WHERE channel_id = ? AND created_at > ? LIMIT 1`,
        schedule.channelId,
        schedule.createdAt
      );
      return !!recent;
    } else {
      const senderMatch = this.db.queryOne<{ id: string }>(
        `SELECT id FROM messages WHERE channel_id = ? AND sender_id = ? AND created_at > ? LIMIT 1`,
        schedule.channelId,
        condition,
        schedule.createdAt
      );
      return !!senderMatch;
    }
  }

  /**
   * Retained for backward-compatibility with interval helper tests.
   */
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
   * Manually triggers an active schedule immediately without waiting for nextRunAt.
   * Enforces that the schedule is active and has not reached its maxIterations limit.
   */
  public async triggerScheduleNow(id: string): Promise<Schedule | null> {
    const row = this.db.queryOne<any>(`SELECT * FROM schedules WHERE id = ?`, id);
    if (!row) return null;
    const schedule = this.mapRowToSchedule(row);

    // Verify schedule is active
    if (schedule.status !== 'active') {
      throw new Error(`Cannot trigger schedule '${id}': status is '${schedule.status}', expected 'active'.`);
    }

    // Enforce maxIterations limit
    if (schedule.maxIterations !== undefined && (schedule.currentIterations ?? 0) >= schedule.maxIterations) {
      throw new Error(`Cannot trigger schedule '${id}': maxIterations limit of ${schedule.maxIterations} reached.`);
    }

    const now = Date.now();
    const attemptNumber = (schedule.currentIterations ?? 0) + 1;

    let dispatchError: Error | null = null;
    if (this.onFireCallback) {
      try {
        await this.onFireCallback(schedule);
      } catch (err: any) {
        dispatchError = err instanceof Error ? err : new Error(String(err));
        console.error(`[KIN SCHEDULER] Error manually triggering schedule ${schedule.id}:`, err);
      }
    }

    if (dispatchError) {
      this.recordAttempt(schedule.id, attemptNumber, 'failure', dispatchError.message, now);
      if (schedule.type === 'one_shot') {
        this.db.execute(
          `UPDATE schedules SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`,
          dispatchError.message,
          now,
          schedule.id
        );
        schedule.status = 'failed';
        schedule.lastError = dispatchError.message;
      } else {
        this.db.execute(
          `UPDATE schedules SET last_error = ?, updated_at = ? WHERE id = ?`,
          dispatchError.message,
          now,
          schedule.id
        );
        schedule.lastError = dispatchError.message;
      }
      throw dispatchError;
    }

    // Dispatch succeeded!
    this.recordAttempt(schedule.id, attemptNumber, 'success', undefined, now);
    const newIterations = attemptNumber;

    if (schedule.type === 'one_shot') {
      this.db.execute(
        `UPDATE schedules SET status = 'completed', current_iterations = ?, last_run_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
        newIterations,
        now,
        now,
        schedule.id
      );
      schedule.status = 'completed';
      schedule.currentIterations = newIterations;
      schedule.lastRunAt = now;
      schedule.lastError = undefined;
    } else {
      const hasReachedLimit = schedule.maxIterations !== undefined && newIterations >= schedule.maxIterations;
      const newStatus: ScheduleStatus = hasReachedLimit ? 'completed' : 'active';
      const nextRunDate = getNextCronOccurrence(schedule.cronExpression || '*/1 * * * *', now);
      const nextRun = hasReachedLimit ? now : nextRunDate.getTime();

      this.db.execute(
        `UPDATE schedules SET status = ?, current_iterations = ?, last_run_at = ?, next_run_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
        newStatus,
        newIterations,
        now,
        nextRun,
        now,
        schedule.id
      );
      schedule.status = newStatus;
      schedule.currentIterations = newIterations;
      schedule.lastRunAt = now;
      schedule.nextRunAt = nextRun;
      schedule.lastError = undefined;
    }

    return schedule;
  }

  /**
   * Explicitly retries a failed schedule by resetting status to active and triggering it immediately.
   */
  public async retrySchedule(id: string): Promise<Schedule | null> {
    const row = this.db.queryOne<any>(`SELECT * FROM schedules WHERE id = ?`, id);
    if (!row) return null;
    const schedule = this.mapRowToSchedule(row);
    if (schedule.status !== 'failed') {
      throw new Error(`Cannot retry schedule '${id}': status is '${schedule.status}', expected 'failed'.`);
    }

    const now = Date.now();
    this.db.execute(
      `UPDATE schedules SET status = 'active', last_error = NULL, updated_at = ? WHERE id = ?`,
      now,
      id
    );
    return await this.triggerScheduleNow(id);
  }

  /**
   * Records a durable attempt record in SQLite event_journal.
   */
  private recordAttempt(
    scheduleId: string,
    attemptNumber: number,
    status: 'success' | 'failure',
    errorMessage: string | undefined,
    executedAt: number
  ): void {
    try {
      const sanitizedError = errorMessage ? SecretBroker.getInstance(this.db).redactSecrets(errorMessage) : undefined;
      const rawPayload = { attemptNumber, status, errorMessage: sanitizedError };
      const sanitizedPayload = SecretBroker.getInstance(this.db).sanitizePayload(rawPayload);
      const payload = JSON.stringify(sanitizedPayload);
      this.db.execute(
        `INSERT INTO event_journal (event_type, entity_type, entity_id, run_id, payload_json, created_at)
         VALUES ('schedule_attempt', 'schedule', ?, NULL, ?, ?)`,
        scheduleId,
        payload,
        executedAt
      );
    } catch (err) {
      console.warn('[KIN SCHEDULER] Failed to record schedule attempt:', err);
    }
  }

  /**
   * Retrieves durable attempt execution history for a schedule from event_journal.
   */
  public getScheduleAttempts(scheduleId: string): ScheduleAttempt[] {
    try {
      const rows = this.db.query<{
        id: number;
        payload_json: string;
        created_at: number;
      }>(
        `SELECT id, payload_json, created_at FROM event_journal WHERE entity_type = 'schedule' AND entity_id = ? AND event_type = 'schedule_attempt' ORDER BY id ASC`,
        scheduleId
      );
      return rows.map((r) => {
        let payload: any = {};
        try {
          payload = JSON.parse(r.payload_json);
        } catch {}
        return {
          id: `att-${r.id}`,
          scheduleId,
          attemptNumber: payload.attemptNumber ?? 1,
          status: (payload.status as 'success' | 'failure') ?? 'failure',
          errorMessage: payload.errorMessage ?? undefined,
          executedAt: r.created_at,
        };
      });
    } catch {
      return [];
    }
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
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
