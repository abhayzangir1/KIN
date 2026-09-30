import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('KIN Phase 0: Storage & Persistence Engine', () => {
  let db: KinDatabase;
  let tempDbPath: string;

  beforeEach(() => {
    // Create an isolated temp DB on disk to verify WAL mode and file operations
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-test-'));
    tempDbPath = path.join(tempDir, 'kin_test.sqlite');
    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();
  });

  afterEach(() => {
    db.close();
    try {
      const dir = path.dirname(tempDbPath);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows file lock release delays
    }
  });

  it('initializes all 22 authoritative tables and passes PRAGMA integrity_check', () => {
    const integrity = db.queryOne<{ integrity_check: string }>('PRAGMA integrity_check;');
    expect(integrity?.integrity_check).toBe('ok');

    const tables = db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';"
    ).map((r) => r.name);

    expect(tables).toHaveLength(22);
    expect(tables).toContain('workspaces');
    expect(tables).toContain('agent_identities');
    expect(tables).toContain('agent_runs');
    expect(tables).toContain('messages');
    expect(tables).toContain('tasks');
    expect(tables).toContain('memories');
    expect(tables).toContain('skills');
    expect(tables).toContain('event_journal');
    expect(tables).toContain('checkpoints');
  });

  it('enforces foreign key constraints strictly', () => {
    // 1. Attempting to insert an agent identity referencing a non-existent workspace must fail
    expect(() => {
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, definition_id, display_name, active_model_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'agent-1',
        'non-existent-workspace',
        'non-existent-def',
        'Agent Alpha',
        'ollama/llama3.1',
        Date.now(),
        Date.now()
      );
    }).toThrow();

    // 2. Insert valid workspace and definition
    const now = Date.now();
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ws-1',
      'Primary Workspace',
      '/workspace',
      'AUTO',
      now,
      now
    );

    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'def-backend',
      'Backend Lead',
      'Architect',
      'You are a backend architect.',
      'claude-3-5-sonnet',
      now
    );

    // 3. Insert agent identity with valid references -> succeeds
    const result = db.execute(
      `INSERT INTO agent_identities (id, workspace_id, definition_id, display_name, active_model_id, fallback_model_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'agent-1',
      'ws-1',
      'def-backend',
      '@BackendLead',
      'claude-3-5-sonnet',
      'gpt-4o',
      now,
      now
    );
    expect(result.changes).toBe(1);

    // 4. Verify ON DELETE CASCADE: deleting the workspace deletes the agent identity
    db.execute('DELETE FROM workspaces WHERE id = ?', 'ws-1');
    const agent = db.queryOne('SELECT * FROM agent_identities WHERE id = ?', 'agent-1');
    expect(agent).toBeUndefined();
  });

  it('enforces check constraints on autonomy modes and message sender types', () => {
    const now = Date.now();
    // Invalid autonomy mode must fail
    expect(() => {
      db.execute(
        `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        'ws-invalid',
        'Bad WS',
        '/ws',
        'INVALID_MODE',
        now,
        now
      );
    }).toThrow();
  });

  it('handles serialized concurrent write transactions without SQLITE_BUSY', async () => {
    const now = Date.now();
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ws-concurrent',
      'Concurrent Workspace',
      '/ws',
      'AUTO',
      now,
      now
    );

    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'proj-1',
      'ws-concurrent',
      'Project Alpha',
      '/repo',
      now,
      now
    );

    db.execute(
      `INSERT INTO channels (id, project_id, name, topic, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      'chan-general',
      'proj-1',
      'general',
      'Main channel',
      now
    );

    // Concurrently fire 20 asynchronous write transactions
    const writes = Array.from({ length: 20 }, (_, i) => {
      return db.transactionAsync(() => {
        db.execute(
          `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          `msg-${i}`,
          'chan-general',
          'user-1',
          'human',
          `Concurrent message #${i}`,
          Date.now()
        );
      });
    });

    await Promise.all(writes);

    const messageCount = db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM messages WHERE channel_id = ?',
      'chan-general'
    );
    expect(messageCount?.count).toBe(20);
  });

  it('enforces Optimistic Concurrency Control (OCC) versioning in memories table', () => {
    const now = Date.now();
    // 1. Initial write with version 1
    db.execute(
      `INSERT INTO memories (id, scope, scope_id, type, key, value_json, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      'mem-1',
      'project',
      'proj-1',
      'decision',
      'api_style',
      JSON.stringify({ format: 'REST' }),
      now,
      now
    );

    // 2. Agent A reads version 1 and updates to version 2
    const updateA = db.execute(
      `UPDATE memories SET value_json = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
      JSON.stringify({ format: 'GraphQL' }),
      now + 10,
      'mem-1',
      1
    );
    expect(updateA.changes).toBe(1);

    // 3. Agent B attempts update with stale version 1 -> 0 changes affected (conflict detected!)
    const updateB = db.execute(
      `UPDATE memories SET value_json = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
      JSON.stringify({ format: 'gRPC' }),
      now + 20,
      'mem-1',
      1
    );
    expect(updateB.changes).toBe(0);

    // Current value must be Agent A's update
    const current = db.queryOne<{ version: number; value_json: string }>(
      'SELECT version, value_json FROM memories WHERE id = ?',
      'mem-1'
    );
    expect(current?.version).toBe(2);
    expect(JSON.parse(current!.value_json)).toEqual({ format: 'GraphQL' });
  });
});
