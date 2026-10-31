import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';

describe('Phase 1 Storage Optimization: High-Performance Composite Indexes', () => {
  let db: KinDatabase;
  let runner: MigrationRunner;

  beforeEach(() => {
    db = new KinDatabase(':memory:');
    runner = new MigrationRunner(db);
    runner.runMigrations();
  });

  afterEach(() => {
    db.close();
  });

  it('creates all 13 high-performance composite indexes during migration', () => {
    const indexes = db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%';"
    ).map((r) => r.name);

    const expectedIndexes = [
      'idx_agent_runs_state_created',
      'idx_agent_runs_task_created',
      'idx_agent_runs_state_quota',
      'idx_tasks_status_lease',
      'idx_tasks_goal_created',
      'idx_projects_workspace_created',
      'idx_messages_chan_sender_time',
      'idx_events_run_time',
      'idx_events_entity_schedule',
      'idx_memory_versions_mem_ver',
      'idx_decisions_project_created',
      'idx_goals_proj_updated',
      'idx_agent_identities_def',
    ];

    for (const expected of expectedIndexes) {
      expect(indexes).toContain(expected);
    }
  });

  it('uses composite index idx_agent_runs_state_created for state queries', () => {
    const plan = db.query<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT * FROM agent_runs WHERE state = 'running' ORDER BY created_at ASC;"
    );
    const planDetails = plan.map((p) => p.detail).join(' ');
    expect(planDetails).toContain('idx_agent_runs_state_created');
  });

  it('uses composite index idx_tasks_goal_created for goal queries', () => {
    const plan = db.query<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE goal_id = 'goal-1' ORDER BY created_at ASC;"
    );
    const planDetails = plan.map((p) => p.detail).join(' ');
    expect(planDetails).toContain('idx_tasks_goal_created');
  });

  it('uses composite index idx_messages_chan_sender_time for message queries', () => {
    const plan = db.query<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT * FROM messages WHERE channel_id = 'chan-1' AND sender_id = 'agent-1' ORDER BY created_at ASC;"
    );
    const planDetails = plan.map((p) => p.detail).join(' ');
    expect(planDetails).toContain('idx_messages_chan_sender_time');
  });
});
