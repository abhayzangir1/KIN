// ============================================================================
// EMPIRICAL CHALLENGER M1 ROUND 2: STORAGE, PERSISTENCE & CONCURRENCY ORACLE
// Rigorous adversarial stress testing of Milestone 1 Storage Guarantees:
// Target 1: Foreign key integrity during schema migration under active dependent rows
// Target 2: Nested savepoints under concurrent async transactions with rapid rollbacks/commits
// Target 3: 4-tier memory OCC versioning collisions under concurrent updates
// Target 4: 2KB output spiller exact boundary, multi-byte UTF-8, and traversal rejection
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { MemoryRepository, OCCConflictError } from '../src/domain/memory_repository.js';
import { OutputSpiller } from '../src/context/output_spiller.js';
import { MemoryScope } from '../src/domain/types.js';

describe('Milestone 1 Storage Empirical Challenger Round 2', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-chal-storage-r2-'));
    dbPath = path.join(tempDir, 'chal_storage_r2.sqlite');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows file lock cleanup delays
    }
  });

  // ==========================================================================
  // TARGET 1: Foreign Key Integrity During Schema Migration Under Active Dependent Rows
  // ==========================================================================
  describe('Target 1: Foreign Key Integrity During Schema Migration', () => {
    it('preserves 100% of child rows across multi-table foreign key dependencies during migration of legacy providers and agent_runs', () => {
      const db = new KinDatabase(dbPath);
      const rawDb = db.getRawDb();
      rawDb.exec('PRAGMA foreign_keys = ON;');

      // 1. Setup legacy schema containing BOTH legacy providers AND legacy agent_runs
      rawDb.exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL,
          default_autonomy_mode TEXT NOT NULL DEFAULT 'AUTO',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          name TEXT NOT NULL,
          repo_path TEXT NOT NULL,
          settings_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE agent_definitions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          system_prompt TEXT NOT NULL,
          default_model_id TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE agent_identities (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          definition_id TEXT NOT NULL REFERENCES agent_definitions(id),
          display_name TEXT NOT NULL,
          active_model_id TEXT,
          is_orchestrator BOOLEAN NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE channels (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          topic TEXT,
          created_at INTEGER NOT NULL
        );
        -- Legacy providers table (lacks 'xai' and 'azure' in CHECK constraint)
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'openrouter', 'together', 'deepinfra', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'vllm', 'openai_compatible', 'custom')),
          base_url TEXT,
          api_key_ref TEXT,
          is_active BOOLEAN NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        -- Child table referencing providers
        CREATE TABLE models (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          context_window INTEGER NOT NULL DEFAULT 8192,
          max_output_tokens INTEGER NOT NULL DEFAULT 2048,
          supports_tools BOOLEAN NOT NULL DEFAULT 1,
          supports_vision BOOLEAN NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        -- Legacy agent_runs table (lacks 'quota_paused' in CHECK constraint)
        CREATE TABLE agent_runs (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
          task_id TEXT,
          channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
          trigger_message_id TEXT,
          state TEXT NOT NULL CHECK (state IN ('created', 'queued', 'running', 'waiting_for_tool', 'waiting_for_approval', 'waiting_for_agent', 'waiting_for_model', 'resuming', 'recovering', 'paused', 'completed', 'failed', 'cancelled')),
          worktree_path TEXT,
          heartbeat_at INTEGER NOT NULL,
          allocated_tokens INTEGER NOT NULL DEFAULT 0,
          used_tokens INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE TABLE goals (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          acceptance_criteria_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'failed', 'cancelled')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          assigned_agent_id TEXT REFERENCES agent_identities(id) ON DELETE SET NULL,
          status TEXT NOT NULL CHECK (status IN ('backlog', 'ready', 'assigned', 'running', 'blocked', 'review', 'completed', 'failed', 'cancelled')),
          verification_spec_json TEXT NOT NULL DEFAULT '{}',
          evidence_bundle_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        -- Child tables referencing agent_runs
        CREATE TABLE checkpoints (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          turn_index INTEGER NOT NULL,
          state_snapshot_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE evidence (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('test_output', 'build_log', 'artifact_hash', 'human_signoff')),
          content_uri TEXT NOT NULL,
          verified BOOLEAN NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      `);

      const now = Date.now();
      // Seed parent entities
      rawDb.exec(`
        INSERT INTO workspaces VALUES ('ws-r2', 'R2 Workspace', '/tmp', 'AUTO', ${now}, ${now});
        INSERT INTO projects VALUES ('proj-kin', 'ws-r2', 'KIN Project', '/tmp', '{}', ${now}, ${now});
        INSERT INTO agent_definitions VALUES ('def-lead', 'Lead', 'orchestrator', 'Lead prompt', NULL, ${now});
        INSERT INTO agent_identities VALUES ('agent-lead', 'ws-r2', 'proj-kin', 'def-lead', 'Lead Agent', NULL, 1, ${now}, ${now});
        INSERT INTO channels VALUES ('chan-general', 'proj-kin', 'general', 'General discussion', ${now});
      `);

      // Seed 3 legacy providers and 6 referencing models
      for (let p = 1; p <= 3; p++) {
        rawDb.exec(`
          INSERT INTO providers VALUES ('prov-${p}', 'Provider ${p}', 'ollama', 'http://localhost:11434', NULL, 1, ${now});
          INSERT INTO models VALUES ('mod-${p}-a', 'prov-${p}', 'model-${p}-a', 8192, 2048, 1, 0, ${now});
          INSERT INTO models VALUES ('mod-${p}-b', 'prov-${p}', 'model-${p}-b', 16384, 4096, 1, 1, ${now});
        `);
      }

      // Seed a goal and task
      rawDb.exec(`
        INSERT INTO goals VALUES ('goal-1', 'proj-kin', 'Goal 1', 'Goal desc', '[]', 'active', ${now}, ${now});
        INSERT INTO tasks VALUES ('task-1', 'goal-1', 'Task 1', 'Test task', NULL, 'backlog', '{}', NULL, ${now}, ${now});
      `);

      // Seed 2 legacy agent_runs and child checkpoints + evidence
      for (let r = 1; r <= 2; r++) {
        rawDb.exec(`
          INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
          VALUES ('run-${r}', 'agent-lead', 'proj-kin', 'running', ${now}, 1000, 200, ${now});
          INSERT INTO checkpoints VALUES ('cp-${r}-1', 'run-${r}', 1, '{"turn":1}', ${now});
          INSERT INTO checkpoints VALUES ('cp-${r}-2', 'run-${r}', 2, '{"turn":2}', ${now});
          INSERT INTO evidence VALUES ('ev-${r}-1', 'task-1', 'run-${r}', 'test_output', 'file:///tmp/ev.log', 0, ${now});
        `);
      }

      // Verify baseline counts before migration
      expect(rawDb.prepare('SELECT count(*) as count FROM providers;').get() as any).toEqual({ count: 3 });
      expect(rawDb.prepare('SELECT count(*) as count FROM models;').get() as any).toEqual({ count: 6 });
      expect(rawDb.prepare('SELECT count(*) as count FROM agent_runs;').get() as any).toEqual({ count: 2 });
      expect(rawDb.prepare('SELECT count(*) as count FROM checkpoints;').get() as any).toEqual({ count: 4 });
      expect(rawDb.prepare('SELECT count(*) as count FROM evidence;').get() as any).toEqual({ count: 2 });

      // Run authoritative MigrationRunner
      const runner = new MigrationRunner(db);
      const res = runner.runMigrations();
      expect(res.success).toBe(true);
      expect(res.integrityCheck).toBe('ok');

      // STRICT ORACLE VERIFICATION:
      // 1. Providers: 100% preservation (all 3 survive)
      const postProviders = db.query<{ id: string }>('SELECT id FROM providers ORDER BY id ASC;');
      expect(postProviders).toHaveLength(3);
      expect(postProviders.map((p) => p.id)).toEqual(['prov-1', 'prov-2', 'prov-3']);

      // 2. Models: 100% preservation (all 6 survive, ZERO cascade loss)
      const postModels = db.query<{ id: string; provider_id: string }>('SELECT id, provider_id FROM models ORDER BY id ASC;');
      expect(postModels).toHaveLength(6);
      expect(postModels.map((m) => m.id)).toEqual([
        'mod-1-a', 'mod-1-b',
        'mod-2-a', 'mod-2-b',
        'mod-3-a', 'mod-3-b',
      ]);

      // 3. Agent Runs: 100% preservation (all 2 survive)
      const postRuns = db.query<{ id: string }>('SELECT id FROM agent_runs ORDER BY id ASC;');
      expect(postRuns).toHaveLength(2);

      // 4. Checkpoints & Evidence: 100% preservation
      const postCheckpoints = db.query<{ id: string }>('SELECT id FROM checkpoints ORDER BY id ASC;');
      expect(postCheckpoints).toHaveLength(4);
      const postEvidence = db.query<{ id: string }>('SELECT id FROM evidence ORDER BY id ASC;');
      expect(postEvidence).toHaveLength(2);

      // 5. Zero foreign key violations across the entire database
      const violations = db.query<{ table: string }>('PRAGMA foreign_key_check;');
      expect(violations).toHaveLength(0);

      // 6. Foreign key enforcement is strictly ON post-migration
      const fkStatus = db.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys;');
      expect(fkStatus?.foreign_keys).toBe(1);

      // 7. Migrated table accepts 'xai' and 'azure' as valid provider_types
      db.execute(
        `INSERT INTO providers (id, name, provider_type, base_url, is_active, created_at)
         VALUES ('prov-xai', 'xAI Grok', 'xai', 'https://api.x.ai', 1, ?)`,
        Date.now()
      );
      db.execute(
        `INSERT INTO providers (id, name, provider_type, base_url, is_active, created_at)
         VALUES ('prov-azure', 'Azure OpenAI', 'azure', 'https://azure.openai.com', 1, ?)`,
        Date.now()
      );
      const xaiProv = db.queryOne<{ id: string }>('SELECT id FROM providers WHERE id = ?;', 'prov-xai');
      expect(xaiProv?.id).toBe('prov-xai');

      db.close();
    });

    it('rejects schema migration when pre-existing foreign key violations corrupt the database', () => {
      const db = new KinDatabase(dbPath);
      const rawDb = db.getRawDb();

      // Intentionally disable foreign keys to create corrupt orphan row in legacy DB
      rawDb.exec('PRAGMA foreign_keys = OFF;');
      rawDb.exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL,
          default_autonomy_mode TEXT NOT NULL DEFAULT 'AUTO',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          name TEXT NOT NULL,
          repo_path TEXT NOT NULL,
          settings_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider_type TEXT NOT NULL,
          base_url TEXT,
          api_key_ref TEXT,
          is_active BOOLEAN NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE models (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          context_window INTEGER NOT NULL DEFAULT 8192,
          max_output_tokens INTEGER NOT NULL DEFAULT 2048,
          supports_tools BOOLEAN NOT NULL DEFAULT 1,
          supports_vision BOOLEAN NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        INSERT INTO workspaces VALUES ('ws-c', 'Corrupt WS', '.', 'AUTO', 1, 1);
        INSERT INTO projects VALUES ('proj-kin', 'ws-c', 'Default', '.', '{}', 1, 1);
        -- Insert an orphan model with NO parent provider!
        INSERT INTO models VALUES ('mod-orphan-1', 'non-existent-prov', 'orphan-model', 8192, 2048, 1, 0, 1);
      `);

      // Migration must fail with explicit Foreign key integrity check failed error
      const runner = new MigrationRunner(db);
      expect(() => runner.runMigrations()).toThrow(/Foreign key integrity check failed after migration/i);

      db.close();
    });

    it('enforces foreign key constraints strictly post-migration (rejects orphan inserts and enforces cascade deletes)', () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();

      const now = Date.now();
      // 1. Attempt inserting orphan model referencing non-existent provider
      expect(() => {
        db.execute(
          `INSERT INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
           VALUES ('mod-orphan', 'prov-ghost', 'Ghost Model', 8192, 2048, 1, 0, ?);`,
          now
        );
      }).toThrow(/FOREIGN KEY constraint failed/i);

      // 2. Insert valid provider and dependent model
      db.execute(
        `INSERT INTO providers (id, name, provider_type, base_url, is_active, created_at)
         VALUES ('prov-cascade-test', 'Cascade Test', 'ollama', NULL, 1, ?);`,
        now
      );
      db.execute(
        `INSERT INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
         VALUES ('mod-cascade-test', 'prov-cascade-test', 'Dependent Model', 8192, 2048, 1, 0, ?);`,
        now
      );

      // Verify insertion succeeded
      const modelRow = db.queryOne<{ id: string }>('SELECT id FROM models WHERE id = ?;', 'mod-cascade-test');
      expect(modelRow?.id).toBe('mod-cascade-test');

      // 3. Delete parent provider and verify CASCADE deletion strictly executes under foreign keys ON
      db.execute('DELETE FROM providers WHERE id = ?;', 'prov-cascade-test');
      const cascadedModel = db.queryOne<{ id: string }>('SELECT id FROM models WHERE id = ?;', 'mod-cascade-test');
      expect(cascadedModel).toBeUndefined();

      db.close();
    });
  });

  // ==========================================================================
  // TARGET 2: Nested Savepoint Concurrency & Rollback Combinations
  // ==========================================================================
  describe('Target 2: Nested Savepoint Concurrency & Rollback Combinations', () => {
    it('handles deeply nested savepoints (depth 5) with interleaved partial rollbacks and outer commit', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();

      db.exec(`
        CREATE TABLE deep_tx_ledger (
          id TEXT PRIMARY KEY,
          depth INTEGER NOT NULL,
          status TEXT NOT NULL
        );
      `);

      // Deeply nested tree:
      // Depth 0: ok
      //   -> Depth 1: ok
      //        -> Depth 2: fail (rolled back)
      //        -> Depth 2: ok
      //             -> Depth 3: ok
      //                  -> Depth 4: fail (rolled back)
      //                  -> Depth 4: ok
      //                       -> Depth 5: fail (rolled back)
      //                       -> Depth 5: ok
      await db.transactionAsync(async () => {
        db.execute("INSERT INTO deep_tx_ledger VALUES ('d0-ok', 0, 'ok');");

        await db.transactionAsync(async () => {
          db.execute("INSERT INTO deep_tx_ledger VALUES ('d1-ok', 1, 'ok');");

          // Depth 2 failure
          try {
            await db.transactionAsync(async () => {
              db.execute("INSERT INTO deep_tx_ledger VALUES ('d2-fail', 2, 'fail');");
              throw new Error('D2_FAIL');
            });
          } catch (e: any) {
            expect(e.message).toBe('D2_FAIL');
          }

          // Depth 2 ok
          await db.transactionAsync(async () => {
            db.execute("INSERT INTO deep_tx_ledger VALUES ('d2-ok', 2, 'ok');");

            await db.transactionAsync(async () => {
              db.execute("INSERT INTO deep_tx_ledger VALUES ('d3-ok', 3, 'ok');");

              // Depth 4 failure
              try {
                await db.transactionAsync(async () => {
                  db.execute("INSERT INTO deep_tx_ledger VALUES ('d4-fail', 4, 'fail');");
                  throw new Error('D4_FAIL');
                });
              } catch (e: any) {
                expect(e.message).toBe('D4_FAIL');
              }

              // Depth 4 ok
              await db.transactionAsync(async () => {
                db.execute("INSERT INTO deep_tx_ledger VALUES ('d4-ok', 4, 'ok');");

                // Depth 5 failure
                try {
                  await db.transactionAsync(async () => {
                    db.execute("INSERT INTO deep_tx_ledger VALUES ('d5-fail', 5, 'fail');");
                    throw new Error('D5_FAIL');
                  });
                } catch (e: any) {
                  expect(e.message).toBe('D5_FAIL');
                }

                // Depth 5 ok
                await db.transactionAsync(async () => {
                  db.execute("INSERT INTO deep_tx_ledger VALUES ('d5-ok', 5, 'ok');");
                });
              });
            });
          });
        });
      });

      // Oracle verification of surviving records
      const surviving = db.query<{ id: string }>('SELECT id FROM deep_tx_ledger ORDER BY depth ASC, id ASC;');
      const survivingIds = surviving.map((r) => r.id);

      expect(survivingIds).toEqual(['d0-ok', 'd1-ok', 'd2-ok', 'd3-ok', 'd4-ok', 'd5-ok']);
      expect(survivingIds).not.toContain('d2-fail');
      expect(survivingIds).not.toContain('d4-fail');
      expect(survivingIds).not.toContain('d5-fail');

      expect(db.isTransactionActive).toBe(false);
      db.close();
    });

    it('seamlessly nests transactionSync inside transactionAsync and transactionAsync inside transactionSync', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();

      db.exec(`
        CREATE TABLE tx_hybrid_nesting (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL
        );
      `);

      // transactionAsync -> transactionSync -> rollback inner transactionSync
      await db.transactionAsync(async () => {
        db.execute("INSERT INTO tx_hybrid_nesting VALUES ('row-async-root', 'async');");

        // Sync savepoint
        db.transactionSync(() => {
          db.execute("INSERT INTO tx_hybrid_nesting VALUES ('row-sync-inner-1', 'sync');");
        });

        // Sync savepoint with intentional failure
        try {
          db.transactionSync(() => {
            db.execute("INSERT INTO tx_hybrid_nesting VALUES ('row-sync-inner-failed', 'sync');");
            throw new Error('SYNC_FAIL');
          });
        } catch (err: any) {
          expect(err.message).toBe('SYNC_FAIL');
        }

        db.execute("INSERT INTO tx_hybrid_nesting VALUES ('row-async-tail', 'async');");
      });

      const records = db.query<{ id: string }>('SELECT id FROM tx_hybrid_nesting ORDER BY id ASC;');
      expect(records.map((r) => r.id)).toEqual(['row-async-root', 'row-async-tail', 'row-sync-inner-1']);
      expect(records.map((r) => r.id)).not.toContain('row-sync-inner-failed');

      expect(db.isTransactionActive).toBe(false);
      db.close();
    });

    it('stresses 75 concurrent async transactions with mixed commit/rollback and zero SQLITE_BUSY leaks', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();

      db.exec(`
        CREATE TABLE stress_tx_75 (
          id TEXT PRIMARY KEY,
          worker_id INTEGER NOT NULL,
          kind TEXT NOT NULL
        );
      `);

      const CONCURRENCY = 75;
      let committedCount = 0;

      const tasks = Array.from({ length: CONCURRENCY }, async (_, workerId) => {
        const willCommit = workerId % 2 === 0;

        try {
          await db.transactionAsync(async () => {
            db.execute(
              'INSERT INTO stress_tx_75 VALUES (?, ?, ?);',
              `worker-${workerId}-root`,
              workerId,
              'root'
            );

            // Nested savepoint that always fails
            try {
              await db.transactionAsync(async () => {
                db.execute(
                  'INSERT INTO stress_tx_75 VALUES (?, ?, ?);',
                  `worker-${workerId}-dirty`,
                  workerId,
                  'dirty'
                );
                throw new Error('DIRTY_ABORT');
              });
            } catch (dErr: any) {
              expect(dErr.message).toBe('DIRTY_ABORT');
            }

            // Nested savepoint that succeeds
            await db.transactionAsync(async () => {
              db.execute(
                'INSERT INTO stress_tx_75 VALUES (?, ?, ?);',
                `worker-${workerId}-clean`,
                workerId,
                'clean'
              );
            });

            if (!willCommit) {
              throw new Error(`WORKER_INTENTIONAL_ABORT_${workerId}`);
            }
          });
          committedCount++;
        } catch (outerErr: any) {
          if (!outerErr.message.startsWith('WORKER_INTENTIONAL_ABORT_')) {
            throw outerErr;
          }
        }
      });

      await Promise.all(tasks);

      // Verify exact consistency:
      // 1. None of the dirty records survived
      const dirties = db.query<{ id: string }>("SELECT id FROM stress_tx_75 WHERE kind = 'dirty';");
      expect(dirties).toHaveLength(0);

      // 2. Exact match on committed roots and cleans
      const roots = db.query<{ id: string }>("SELECT id FROM stress_tx_75 WHERE kind = 'root';");
      expect(roots).toHaveLength(committedCount);

      const cleans = db.query<{ id: string }>("SELECT id FROM stress_tx_75 WHERE kind = 'clean';");
      expect(cleans).toHaveLength(committedCount);

      expect(db.isTransactionActive).toBe(false);
      db.close();
    });
  });

  // ==========================================================================
  // TARGET 3: 4-Tier Memory Fabric & OCC Versioning
  // ==========================================================================
  describe('Target 3: 4-Tier Memory Fabric & OCC Versioning', () => {
    it('strictly fences 50 concurrent updates racing on expectedVersion = 1 to exactly 1 winner and 49 OCCConflictErrors', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();
      const memRepo = new MemoryRepository(db);

      // Seed initial record at version 1
      const seed = memRepo.setMemory({
        scope: 'channel',
        scopeId: 'chan-race',
        type: 'semantic',
        key: 'concurrent_hotspot',
        value: { counter: 0, winner: 'initial' },
        expectedVersion: 0,
      });
      expect(seed.version).toBe(1);

      // 50 concurrent workers all attempting to advance version 1 -> version 2
      const WORKERS = 50;
      const promises = Array.from({ length: WORKERS }, async (_, idx) => {
        return memRepo.setMemory({
          scope: 'channel',
          scopeId: 'chan-race',
          type: 'semantic',
          key: 'concurrent_hotspot',
          value: { counter: idx + 1, winner: `worker-${idx}` },
          expectedVersion: 1, // All race on expectedVersion = 1
        });
      });

      const settled = await Promise.allSettled(promises);
      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      const rejected = settled.filter((s) => s.status === 'rejected');

      // STRICT ORACLE: Exactly 1 winner, exactly 49 rejected
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(WORKERS - 1);

      for (const rej of rejected) {
        expect((rej as PromiseRejectedResult).reason).toBeInstanceOf(OCCConflictError);
        expect((rej as PromiseRejectedResult).reason.message).toContain('OCC CONFLICT');
      }

      // Final version in database is strictly 2
      const current = memRepo.getMemory('channel', 'chan-race', 'concurrent_hotspot');
      expect(current?.version).toBe(2);

      // Version history contains exactly version 1 snapshot
      const hist = memRepo.getVersionHistory(current!.id);
      expect(hist).toHaveLength(1);
      expect(hist[0].version).toBe(1);

      db.close();
    });

    it('reaches exact convergence across all 4 memory scopes under a 20-worker retry-on-conflict stress loop', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();
      const memRepo = new MemoryRepository(db);

      const scopes: MemoryScope[] = ['project', 'channel', 'agent_private', 'workspace'];
      const WORKERS_PER_SCOPE = 15;

      for (const scope of scopes) {
        const scopeId = `scope-${scope}-converge`;
        const key = `shared_counter`;

        memRepo.setMemory({
          scope,
          scopeId,
          type: 'procedural',
          key,
          value: { total: 0 },
        });

        // 15 workers concurrently incrementing the counter with backoff retry
        const workers = Array.from({ length: WORKERS_PER_SCOPE }, async (_, wId) => {
          let updated = false;
          let retries = 0;
          while (!updated && retries < 150) {
            retries++;
            const mem = memRepo.getMemory(scope, scopeId, key)!;
            const currentTotal = (mem.value as { total: number }).total;
            try {
              memRepo.setMemory({
                scope,
                scopeId,
                type: 'procedural',
                key,
                value: { total: currentTotal + 1, lastWorker: wId },
                expectedVersion: mem.version,
              });
              updated = true;
            } catch (e) {
              if (e instanceof OCCConflictError) {
                await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8) + 2));
                continue;
              }
              throw e;
            }
          }
          expect(updated).toBe(true);
        });

        await Promise.all(workers);

        // Oracle verification
        const finalMemory = memRepo.getMemory(scope, scopeId, key);
        expect((finalMemory?.value as any).total).toBe(WORKERS_PER_SCOPE);
        expect(finalMemory?.version).toBe(WORKERS_PER_SCOPE + 1);

        const history = memRepo.getVersionHistory(finalMemory!.id);
        expect(history).toHaveLength(WORKERS_PER_SCOPE);
        const versions = history.map((h) => h.version).sort((a, b) => a - b);
        expect(versions).toEqual(Array.from({ length: WORKERS_PER_SCOPE }, (_, i) => i + 1));
      }

      db.close();
    });
  });

  // ==========================================================================
  // TARGET 4: Output Spiller Boundaries, UTF-8 Multi-Byte & Traversal Defenses
  // ==========================================================================
  describe('Target 4: Output Spiller Boundaries, Multi-Byte UTF-8 & Traversal Rejection', () => {
    let spillerDir: string;
    let spiller: OutputSpiller;

    beforeEach(() => {
      spillerDir = path.join(tempDir, 'spill_r2');
      spiller = new OutputSpiller({ spillDir: spillerDir, thresholdBytes: 2048 });
    });

    it('enforces exact byte-level boundary across ASCII, 2-byte, 3-byte, and 4-byte UTF-8 inputs', () => {
      // 1. ASCII: 2048 bytes (inline) vs 2049 bytes (spilled)
      const ascii2048 = 'x'.repeat(2048);
      const resA2048 = spiller.processOutput(ascii2048);
      expect(resA2048.isSpilled).toBe(false);
      expect(resA2048.originalBytes).toBe(2048);

      const ascii2049 = 'x'.repeat(2049);
      const resA2049 = spiller.processOutput(ascii2049);
      expect(resA2049.isSpilled).toBe(true);
      expect(resA2049.originalBytes).toBe(2049);

      // 2. 2-byte UTF-8 ('é', 2 bytes per char): 1024 chars = 2048 bytes vs 1025 chars = 2050 bytes
      const chars2b_1024 = 'é'.repeat(1024);
      expect(Buffer.byteLength(chars2b_1024, 'utf-8')).toBe(2048);
      const res2b_1024 = spiller.processOutput(chars2b_1024);
      expect(res2b_1024.isSpilled).toBe(false);

      const chars2b_1025 = 'é'.repeat(1025);
      expect(Buffer.byteLength(chars2b_1025, 'utf-8')).toBe(2050);
      const res2b_1025 = spiller.processOutput(chars2b_1025);
      expect(res2b_1025.isSpilled).toBe(true);

      // 3. 3-byte UTF-8 ('中', 3 bytes per char): 682 chars = 2046 bytes (inline) vs 683 chars = 2049 bytes (spilled)
      const chars3b_682 = '中'.repeat(682);
      expect(Buffer.byteLength(chars3b_682, 'utf-8')).toBe(2046);
      const res3b_682 = spiller.processOutput(chars3b_682);
      expect(res3b_682.isSpilled).toBe(false);

      const chars3b_683 = '中'.repeat(683);
      expect(Buffer.byteLength(chars3b_683, 'utf-8')).toBe(2049);
      const res3b_683 = spiller.processOutput(chars3b_683);
      expect(res3b_683.isSpilled).toBe(true);

      // 4. 4-byte UTF-8 ('🎉', 4 bytes per char): 512 chars = 2048 bytes (inline) vs 513 chars = 2052 bytes (spilled)
      const chars4b_512 = '🎉'.repeat(512);
      expect(Buffer.byteLength(chars4b_512, 'utf-8')).toBe(2048);
      const res4b_512 = spiller.processOutput(chars4b_512);
      expect(res4b_512.isSpilled).toBe(false);

      const chars4b_513 = '🎉'.repeat(513);
      expect(Buffer.byteLength(chars4b_513, 'utf-8')).toBe(2052);
      const res4b_513 = spiller.processOutput(chars4b_513);
      expect(res4b_513.isSpilled).toBe(true);
    });

    it('demonstrates content-addressed deduplication integrity under 30 concurrent duplicate spills', async () => {
      const payload = 'CONCURRENT_SPILL_BURST_'.repeat(150); // > 2KB
      expect(Buffer.byteLength(payload, 'utf-8')).toBeGreaterThan(2048);

      // Process 30 concurrent spills of identical payload
      const tasks = Array.from({ length: 30 }, async () => {
        return spiller.processOutput(payload, 'test_cmd');
      });

      const results = await Promise.all(tasks);
      const firstHash = results[0].hash;

      for (const r of results) {
        expect(r.isSpilled).toBe(true);
        expect(r.hash).toBe(firstHash);
      }

      // Exactly ONE file on disk for all 30 duplicate requests
      const diskFiles = fs.readdirSync(spillerDir);
      expect(diskFiles).toHaveLength(1);
      expect(diskFiles[0]).toBe(`${firstHash}.log`);

      // Read back matches exactly
      const content = spiller.readSpillFile(firstHash!);
      expect(content).toBe(payload);
    });

    it('strictly repels path traversal attacks and non-hex formats on readSpillFile', () => {
      const attackVectors = [
        '../passwd',
        '..\\windows\\system32',
        '....//test',
        'a'.repeat(63),          // Too short (63 chars)
        'a'.repeat(65),          // Too long (65 chars)
        'z'.repeat(64),          // Invalid hex char 'z'
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeG', // Non-hex capital G
        '../../../../../../etc/shadow',
        'C:\\boot.ini',
        '\\\\attacker\\share\\payload.log',
      ];

      for (const vector of attackVectors) {
        expect(() => spiller.readSpillFile(vector)).toThrow(/Invalid spill hash/i);
      }
    });
  });
});
