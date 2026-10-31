import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import { EventLedger } from '../src/security/event_ledger.js';

describe('Phase 3 Concurrency: Anti-Starvation Queue Aging', () => {
  let db: KinDatabase;
  let kernel: AgentKernel;

  beforeEach(() => {
    db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    EventLedger.initialize(db);

    const now = Date.now();
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ws-test',
      'Test WS',
      '.',
      'AUTO',
      now,
      now
    );
    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'proj-test',
      'ws-test',
      'Test Proj',
      '.',
      '{}',
      now,
      now
    );
    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'def-test',
      'Worker',
      'Tester',
      'You test.',
      'gpt-4o',
      now
    );
    db.execute(
      `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'agent-test',
      'ws-test',
      'proj-test',
      'def-test',
      'Agent 1',
      'gpt-4o',
      now,
      now
    );

    kernel = new AgentKernel(db, { maxActiveConcurrentRuns: 1 });
  });

  afterEach(() => {
    db.close();
  });

  it('admits higher priority runs first when created at similar times', () => {
    const now = Date.now();

    // Insert low priority run (P3 Cron, priority 20)
    db.execute(
      `INSERT INTO agent_runs (id, agent_id, state, heartbeat_at, priority, created_at)
       VALUES (?, ?, 'queued', ?, 20, ?)`,
      'run-low',
      'agent-test',
      now,
      now
    );

    // Insert high priority run (P1 Human Interactive, priority 100) created 1ms later
    db.execute(
      `INSERT INTO agent_runs (id, agent_id, state, heartbeat_at, priority, created_at)
       VALUES (?, ?, 'queued', ?, 100, ?)`,
      'run-high',
      'agent-test',
      now,
      now + 1
    );

    const admitted = kernel.admitNextQueuedRun();
    expect(admitted?.id).toBe('run-high');
  });

  it('prevents starvation by aging low priority runs past high priority runs after sufficient wait time', () => {
    const now = Date.now();

    // Insert an old low-priority run (priority 20, created 60 seconds ago => +100 bonus => effective 120)
    db.execute(
      `INSERT INTO agent_runs (id, agent_id, state, heartbeat_at, priority, created_at)
       VALUES (?, ?, 'queued', ?, 20, ?)`,
      'run-old-cron',
      'agent-test',
      now,
      now - 60000
    );

    // Insert a fresh high-priority run (priority 100, created right now => +0 bonus => effective 100)
    db.execute(
      `INSERT INTO agent_runs (id, agent_id, state, heartbeat_at, priority, created_at)
       VALUES (?, ?, 'queued', ?, 100, ?)`,
      'run-fresh-user',
      'agent-test',
      now,
      now
    );

    // The older background run must be admitted first due to aging bonus (120 > 100)
    const admitted = kernel.admitNextQueuedRun();
    expect(admitted?.id).toBe('run-old-cron');
  });
});
