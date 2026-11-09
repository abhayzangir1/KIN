// ============================================================================
// EMPIRICAL CHALLENGER M1 1: STORAGE, PERSISTENCE & CONCURRENCY SUITE
// Rigorous adversarial stress testing of Milestone 1 Storage Guarantees:
// 1. Foreign key integrity during schema migration under active dependent rows
// 2. Nested savepoints under concurrent async transactions with rapid rollbacks/commits
// 3. 4-tier memory OCC versioning collisions under concurrent updates
// 4. 2KB output spiller exact boundary and UTF-8 multi-byte stress
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
import { MemoryScope, MemoryType } from '../src/domain/types.js';

describe('Milestone 1 Empirical Challenger: Storage, Persistence & Concurrency Guarantees', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-chal-storage-'));
    dbPath = path.join(tempDir, 'chal_storage.sqlite');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows cleanup lock delays
    }
  });

  // ==========================================================================
  // CHALLENGE 1: Foreign Key Integrity During Schema Migration Under Active Dependent Rows
  // ==========================================================================
  describe('Challenge 1: Foreign Key Integrity During Schema Migration Under Active Dependent Rows', () => {
    it('verifies remediation: migration_runner preserves dependent models when migrating legacy providers table', () => {
      // 1. Establish a legacy SQLite database mimicking pre-migration state where:
      // - providers table lacks 'xai' and 'azure' in provider_type CHECK constraint
      // - models table has an active foreign key referencing providers(id) ON DELETE CASCADE
      const db = new KinDatabase(dbPath);
      const rawDb = db.getRawDb();

      rawDb.exec('PRAGMA foreign_keys = ON;');

      // Seed foundational workspace and project tables first
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
        INSERT INTO workspaces VALUES ('ws-1', 'Default WS', '/tmp', 'AUTO', 1000, 1000);
        INSERT INTO projects VALUES ('proj-kin', 'ws-1', 'Default Proj', '/tmp', '{}', 1000, 1000);
      `);

      // Create legacy providers table WITHOUT 'xai' or 'azure'
      rawDb.exec(`
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'openrouter', 'together', 'deepinfra', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'vllm', 'openai_compatible', 'custom')),
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
      `);

      // Insert active provider and active dependent model rows
      const now = Date.now();
      rawDb.exec(`
        INSERT INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
        VALUES ('prov-active-1', 'Active Ollama', 'ollama', 'http://localhost:11434', NULL, 1, ${now});
        INSERT INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
        VALUES ('prov-active-2', 'Active Anthropic', 'anthropic', NULL, 'sec-1', 1, ${now});

        INSERT INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
        VALUES ('mod-dep-1', 'prov-active-1', 'llama3.1', 128000, 4096, 1, 0, ${now});
        INSERT INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
        VALUES ('mod-dep-2', 'prov-active-2', 'claude-3-5-sonnet', 200000, 8192, 1, 1, ${now});
      `);

      // Run current MigrationRunner
      const runner = new MigrationRunner(db);
      const result = runner.runMigrations();
      expect(result.success).toBe(true);

      // VERIFY REMEDIATION:
      // In remediated migration_runner.ts, PRAGMA foreign_keys = OFF is called before transactionSync.
      // Thus, DROP TABLE providers does NOT trigger cascade deletion, preserving all dependent models!
      const modelsCount = db.queryOne<{ count: number }>('SELECT count(*) as count FROM models;');
      // Dependent models are preserved (count is 2)!
      expect(modelsCount?.count).toBe(2);

      // Providers table exists with 2 rows, and all dependent models are preserved
      const providersCount = db.queryOne<{ count: number }>('SELECT count(*) as count FROM providers;');
      expect(providersCount?.count).toBe(2);

      db.close();
    });

    it('proves remediation: disabling foreign keys outside transactionSync preserves all dependent rows with zero violations', () => {
      const fixedDbPath = path.join(tempDir, 'chal_fixed.sqlite');
      const db = new KinDatabase(fixedDbPath);
      const rawDb = db.getRawDb();

      rawDb.exec('PRAGMA foreign_keys = ON;');

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
        INSERT INTO workspaces VALUES ('ws-1', 'Default WS', '/tmp', 'AUTO', 1000, 1000);
        INSERT INTO projects VALUES ('proj-kin', 'ws-1', 'Default Proj', '/tmp', '{}', 1000, 1000);
      `);

      rawDb.exec(`
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'openrouter', 'together', 'deepinfra', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'vllm', 'openai_compatible', 'custom')),
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
      `);

      const now = Date.now();
      rawDb.exec(`
        INSERT INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
        VALUES ('prov-active-1', 'Active Ollama', 'ollama', 'http://localhost:11434', NULL, 1, ${now});
        INSERT INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
        VALUES ('prov-active-2', 'Active Anthropic', 'anthropic', NULL, 'sec-1', 1, ${now});

        INSERT INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
        VALUES ('mod-dep-1', 'prov-active-1', 'llama3.1', 128000, 4096, 1, 0, ${now});
        INSERT INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
        VALUES ('mod-dep-2', 'prov-active-2', 'claude-3-5-sonnet', 200000, 8192, 1, 1, ${now});
      `);

      // Remediation pattern:
      // Toggling PRAGMA foreign_keys = OFF BEFORE opening transactionSync
      db.exec('PRAGMA foreign_keys = OFF;');
      try {
        db.transactionSync(() => {
          rawDb.exec(`
            CREATE TABLE providers_dg_tmp (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'xai', 'azure', 'openrouter', 'together', 'deepinfra', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'vllm', 'openai_compatible', 'custom')),
              base_url TEXT,
              api_key_ref TEXT,
              is_active BOOLEAN NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL
            );
            INSERT INTO providers_dg_tmp (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
            SELECT id, name, provider_type, base_url, api_key_ref, is_active, created_at FROM providers;
            DROP TABLE providers;
            ALTER TABLE providers_dg_tmp RENAME TO providers;
          `);
        });
      } finally {
        db.exec('PRAGMA foreign_keys = ON;');
      }

      // Assert that models are 100% PRESERVED
      const modelsCount = db.queryOne<{ count: number }>('SELECT count(*) as count FROM models;');
      expect(modelsCount?.count).toBe(2);

      const providersCount = db.queryOne<{ count: number }>('SELECT count(*) as count FROM providers;');
      expect(providersCount?.count).toBe(2);

      // Verify PRAGMA foreign_key_check passes with zero violations
      const violations = db.query<{ table: string }>('PRAGMA foreign_key_check;');
      expect(violations).toHaveLength(0);

      db.close();
    });

    it('enforces foreign key constraints strictly after migrations (rejects orphaned inserts)', () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();

      // Attempt inserting a model with a non-existent provider_id
      expect(() => {
        db.execute(
          `INSERT INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
           VALUES ('mod-orphan', 'prov-nonexistent', 'orphan-model', 8192, 2048, 1, 0, ?)`,
          Date.now()
        );
      }).toThrow(/FOREIGN KEY constraint failed/i);

      db.close();
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Nested Savepoints Under Concurrent Async Transactions
  // ==========================================================================
  describe('Challenge 2: Nested Savepoints Under Concurrent Async Transactions', () => {
    it('correctly handles multi-level nested savepoints with partial rollbacks and outer commits', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();

      // Helper table for transaction ledger
      db.exec(`
        CREATE TABLE tx_test_ledger (
          id TEXT PRIMARY KEY,
          step TEXT NOT NULL,
          level INTEGER NOT NULL,
          val INTEGER NOT NULL
        );
      `);

      // Outer async transaction
      await db.transactionAsync(async () => {
        db.execute("INSERT INTO tx_test_ledger VALUES ('row-outer-1', 'outer_init', 0, 100);");

        // Level 1 nested savepoint: COMMITTED
        await db.transactionAsync(async () => {
          db.execute("INSERT INTO tx_test_ledger VALUES ('row-nested-1', 'level_1_ok', 1, 200);");

          // Level 2 nested savepoint: ROLLED BACK
          try {
            await db.transactionAsync(async () => {
              db.execute("INSERT INTO tx_test_ledger VALUES ('row-nested-2-fail', 'level_2_fail', 2, 300);");
              throw new Error('INTENTIONAL_LEVEL_2_ROLLBACK');
            });
          } catch (err: any) {
            expect(err.message).toBe('INTENTIONAL_LEVEL_2_ROLLBACK');
          }

          // Level 2 nested savepoint: COMMITTED
          await db.transactionAsync(async () => {
            db.execute("INSERT INTO tx_test_ledger VALUES ('row-nested-2-ok', 'level_2_ok', 2, 400);");
          });
        });

        // Level 1 nested savepoint: ROLLED BACK
        try {
          await db.transactionAsync(async () => {
            db.execute("INSERT INTO tx_test_ledger VALUES ('row-nested-1-fail', 'level_1_fail', 1, 500);");
            throw new Error('INTENTIONAL_LEVEL_1_ROLLBACK');
          });
        } catch (err: any) {
          expect(err.message).toBe('INTENTIONAL_LEVEL_1_ROLLBACK');
        }

        db.execute("INSERT INTO tx_test_ledger VALUES ('row-outer-2', 'outer_final', 0, 600);");
      });

      // Verify final ledger state
      const rows = db.query<{ id: string; step: string; level: number; val: number }>(
        'SELECT * FROM tx_test_ledger ORDER BY val ASC;'
      );

      // Successfully committed rows: outer-1 (100), nested-1 (200), nested-2-ok (400), outer-2 (600)
      // Rolled back rows: nested-2-fail (300) and nested-1-fail (500) must NOT exist
      const rowIds = rows.map((r) => r.id);
      expect(rowIds).toEqual(['row-outer-1', 'row-nested-1', 'row-nested-2-ok', 'row-outer-2']);
      expect(rowIds).not.toContain('row-nested-2-fail');
      expect(rowIds).not.toContain('row-nested-1-fail');

      db.close();
    });

    it('rolls back all nested levels if the outermost transaction fails', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();

      db.exec(`
        CREATE TABLE tx_atomic_test (
          id TEXT PRIMARY KEY,
          val TEXT NOT NULL
        );
      `);

      let errorCaught = false;
      try {
        await db.transactionAsync(async () => {
          db.execute("INSERT INTO tx_atomic_test VALUES ('r-0', 'outer');");

          await db.transactionAsync(async () => {
            db.execute("INSERT INTO tx_atomic_test VALUES ('r-1', 'nested-1');");

            await db.transactionAsync(async () => {
              db.execute("INSERT INTO tx_atomic_test VALUES ('r-2', 'nested-2');");
            });
          });

          // Outer abort
          throw new Error('OUTER_ABORT');
        });
      } catch (err: any) {
        expect(err.message).toBe('OUTER_ABORT');
        errorCaught = true;
      }

      expect(errorCaught).toBe(true);

      // Verify that ZERO records were committed
      const count = db.queryOne<{ count: number }>('SELECT count(*) as count FROM tx_atomic_test;');
      expect(count?.count).toBe(0);

      db.close();
    });

    it('stresses 50 concurrent async transactions with random commits and rollbacks without corruption', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();

      db.exec(`
        CREATE TABLE concurrent_tx_stress (
          id TEXT PRIMARY KEY,
          tx_index INTEGER NOT NULL,
          status TEXT NOT NULL,
          payload TEXT NOT NULL
        );
      `);

      const TOTAL_CONCURRENT = 50;
      let expectedCommittedCount = 0;

      // Run 50 concurrent tasks
      const tasks = Array.from({ length: TOTAL_CONCURRENT }, async (_, i) => {
        const shouldCommitOuter = i % 3 !== 0; // 2 out of 3 commit outer

        try {
          await db.transactionAsync(async () => {
            db.execute(
              'INSERT INTO concurrent_tx_stress VALUES (?, ?, ?, ?);',
              `tx-${i}-main`,
              i,
              'main_step',
              `payload-${i}`
            );

            // Nested savepoint 1: always rolls back
            try {
              await db.transactionAsync(async () => {
                db.execute(
                  'INSERT INTO concurrent_tx_stress VALUES (?, ?, ?, ?);',
                  `tx-${i}-sp1-fail`,
                  i,
                  'sp1_fail',
                  'dirty'
                );
                throw new Error('SP1_ROLLBACK');
              });
            } catch (spErr: any) {
              expect(spErr.message).toBe('SP1_ROLLBACK');
            }

            // Nested savepoint 2: commits
            await db.transactionAsync(async () => {
              db.execute(
                'INSERT INTO concurrent_tx_stress VALUES (?, ?, ?, ?);',
                `tx-${i}-sp2-ok`,
                i,
                'sp2_ok',
                'clean'
              );
            });

            if (!shouldCommitOuter) {
              throw new Error(`ABORT_OUTER_${i}`);
            }
          });

          expectedCommittedCount++;
        } catch (err: any) {
          if (!err.message.startsWith('ABORT_OUTER_')) {
            throw err;
          }
        }
      });

      await Promise.all(tasks);

      // Verify database consistency
      // 1. None of the sp1-fail records exist
      const sp1Fails = db.query<{ id: string }>(
        "SELECT id FROM concurrent_tx_stress WHERE status = 'sp1_fail';"
      );
      expect(sp1Fails).toHaveLength(0);

      // 2. Exactly expectedCommittedCount outer transactions committed
      const committedMains = db.query<{ id: string }>(
        "SELECT id FROM concurrent_tx_stress WHERE status = 'main_step';"
      );
      expect(committedMains).toHaveLength(expectedCommittedCount);

      // 3. For each committed outer transaction, exactly one sp2_ok row exists
      const committedSp2s = db.query<{ id: string }>(
        "SELECT id FROM concurrent_tx_stress WHERE status = 'sp2_ok';"
      );
      expect(committedSp2s).toHaveLength(expectedCommittedCount);

      // 4. Verify no transaction remains active
      expect(db.isTransactionActive).toBe(false);

      db.close();
    });
  });

  // ==========================================================================
  // CHALLENGE 3: 4-Tier Memory Fabric & OCC Versioning Stress
  // ==========================================================================
  describe('Challenge 3: 4-Tier Memory Fabric & OCC Versioning Collisions', () => {
    it('enforces OCC version collision rejection when 25 concurrent updates race on the same key', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();
      const memRepo = new MemoryRepository(db);

      // 1. Initialize root memory in project scope
      const initial = memRepo.setMemory({
        scope: 'project',
        scopeId: 'proj-kin',
        type: 'semantic',
        key: 'hot_shared_config',
        value: { counter: 0, lastWorker: 'init' },
        expectedVersion: 0,
      });

      expect(initial.version).toBe(1);

      // 2. Simulate 25 workers reading initial.version (v1) and trying to write concurrently with expectedVersion = 1
      const WORKER_COUNT = 25;
      let successCount = 0;
      let conflictCount = 0;

      const results = await Promise.allSettled(
        Array.from({ length: WORKER_COUNT }, async (_, i) => {
          return memRepo.setMemory({
            scope: 'project',
            scopeId: 'proj-kin',
            type: 'semantic',
            key: 'hot_shared_config',
            value: { counter: 1, lastWorker: `worker_${i}` },
            expectedVersion: 1, // All expect version 1!
          });
        })
      );

      for (const res of results) {
        if (res.status === 'fulfilled') {
          successCount++;
        } else {
          expect(res.reason).toBeInstanceOf(OCCConflictError);
          conflictCount++;
        }
      }

      // Exactly ONE worker must succeed and 24 must be rejected with OCCConflictError
      expect(successCount).toBe(1);
      expect(conflictCount).toBe(WORKER_COUNT - 1);

      // Current memory version must be exactly 2
      const updated = memRepo.getMemory('project', 'proj-kin', 'hot_shared_config');
      expect(updated?.version).toBe(2);

      // Version history must contain the initial snapshot
      const history = memRepo.getVersionHistory(updated!.id);
      expect(history).toHaveLength(1);
      expect(history[0].version).toBe(1);

      db.close();
    });

    it('supports safe retry-on-conflict loops across all 4 memory scopes', async () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();
      const memRepo = new MemoryRepository(db);

      const scopes: MemoryScope[] = ['project', 'channel', 'agent_private', 'workspace'];

      for (const scope of scopes) {
        const scopeId = `scope_${scope}_1`;
        const key = `convergent_counter_${scope}`;

        // Seed initial memory
        memRepo.setMemory({
          scope,
          scopeId,
          type: 'episodic',
          key,
          value: { count: 0 },
        });

        // 10 concurrent workers incrementing the counter with OCC retry loop
        const NUM_WORKERS = 10;
        const workerTasks = Array.from({ length: NUM_WORKERS }, async (_, wId) => {
          let updated = false;
          let attempts = 0;
          while (!updated && attempts < 100) {
            attempts++;
            const current = memRepo.getMemory(scope, scopeId, key)!;
            const currentVal = current.value as { count: number };
            try {
              memRepo.setMemory({
                scope,
                scopeId,
                type: 'episodic',
                key,
                value: { count: currentVal.count + 1, lastBy: wId },
                expectedVersion: current.version,
              });
              updated = true;
            } catch (err) {
              if (err instanceof OCCConflictError) {
                // Backoff jitter and retry
                await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10)));
                continue;
              }
              throw err;
            }
          }
          expect(updated).toBe(true);
        });

        await Promise.all(workerTasks);

        // Final count must be exactly 10, version must be 1 + 10 = 11
        const finalMem = memRepo.getMemory(scope, scopeId, key);
        expect(finalMem?.version).toBe(11);
        expect((finalMem?.value as any).count).toBe(10);

        // Version history must contain exactly 10 historical snapshots (v1 through v10)
        const hist = memRepo.getVersionHistory(finalMem!.id);
        expect(hist).toHaveLength(10);
        const versions = hist.map((h) => h.version).sort((a, b) => a - b);
        expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      }

      db.close();
    });

    it('rejects unexpected version on non-existent memory and rejects zero on existing memory', () => {
      const db = new KinDatabase(dbPath);
      new MigrationRunner(db).runMigrations();
      const memRepo = new MemoryRepository(db);

      // Non-existent key with expectedVersion = 5 -> fails
      expect(() => {
        memRepo.setMemory({
          scope: 'project',
          scopeId: 'proj-1',
          type: 'procedural',
          key: 'ghost_key',
          value: 'value',
          expectedVersion: 5,
        });
      }).toThrow(/does not exist \(expected version 5\)/);

      // Create initial
      memRepo.setMemory({
        scope: 'project',
        scopeId: 'proj-1',
        type: 'procedural',
        key: 'existing_key',
        value: 'initial',
      });

      // Existing key with expectedVersion = 0 -> fails
      expect(() => {
        memRepo.setMemory({
          scope: 'project',
          scopeId: 'proj-1',
          type: 'procedural',
          key: 'existing_key',
          value: 'should_fail',
          expectedVersion: 0,
        });
      }).toThrow(/version mismatch \(expected 0, got 1\)/);

      db.close();
    });
  });

  // ==========================================================================
  // CHALLENGE 4: 2KB Output Spiller Boundaries
  // ==========================================================================
  describe('Challenge 4: 2KB Output Spiller Boundaries (>2048 spilled vs <=2048 inline)', () => {
    let spillerDir: string;
    let spiller: OutputSpiller;

    beforeEach(() => {
      spillerDir = path.join(tempDir, 'spill_test');
      spiller = new OutputSpiller({ spillDir: spillerDir, thresholdBytes: 2048 });
    });

    it('preserves exact boundary: <=2048 bytes stays inline without disk spill', () => {
      // 1. Exact 2048 ASCII bytes
      const exact2048 = 'A'.repeat(2048);
      const res2048 = spiller.processOutput(exact2048);
      expect(res2048.isSpilled).toBe(false);
      expect(res2048.originalBytes).toBe(2048);
      expect(res2048.content).toBe(exact2048);
      expect(res2048.spillUri).toBeUndefined();

      // Zero files written to spill directory
      const files = fs.readdirSync(spillerDir);
      expect(files).toHaveLength(0);

      // 2. Exact 2047 ASCII bytes
      const exact2047 = 'B'.repeat(2047);
      const res2047 = spiller.processOutput(exact2047);
      expect(res2047.isSpilled).toBe(false);
      expect(res2047.originalBytes).toBe(2047);
      expect(res2047.content).toBe(exact2047);

      // 3. Empty string (0 bytes)
      const resEmpty = spiller.processOutput('');
      expect(resEmpty.isSpilled).toBe(false);
      expect(resEmpty.originalBytes).toBe(0);
      expect(resEmpty.content).toBe('');
    });

    it('spills exact boundary: 2049 bytes (>2048) persists to disk with SHA-256 deduplication and preview', () => {
      // Exact 2049 ASCII bytes (2048 + 1)
      const exact2049 = 'C'.repeat(2049);
      const res2049 = spiller.processOutput(exact2049, 'npm list');

      expect(res2049.isSpilled).toBe(true);
      expect(res2049.originalBytes).toBe(2049);
      expect(res2049.hash).toBeDefined();
      expect(res2049.spillUri).toBeDefined();

      // Verify file exists on disk with exact byte length
      const expectedFileName = `${res2049.hash}.log`;
      const diskPath = path.join(spillerDir, expectedFileName);
      expect(fs.existsSync(diskPath)).toBe(true);
      const diskContent = fs.readFileSync(diskPath, 'utf-8');
      expect(Buffer.byteLength(diskContent, 'utf-8')).toBe(2049);
      expect(diskContent).toBe(exact2049);

      // Verify readSpillFile retrieves the exact raw content
      const readBack = spiller.readSpillFile(res2049.hash!);
      expect(readBack).toBe(exact2049);

      // Verify idempotency / deduplication: processing identical payload does not crash or duplicate files
      const secondProcess = spiller.processOutput(exact2049, 'npm list');
      expect(secondProcess.hash).toBe(res2049.hash);
      const allFiles = fs.readdirSync(spillerDir);
      expect(allFiles).toHaveLength(1);
    });

    it('correctly calculates byte length for multi-byte UTF-8 Unicode characters (stressing string length vs byte length)', () => {
      // Emoji '🚀' is 2 UTF-16 code units (str.length = 2), but 4 UTF-8 bytes!
      // 512 emojis: str.length = 1024, but byteLength = 512 * 4 = 2048 bytes!
      const emojis512 = '🚀'.repeat(512);
      expect(emojis512.length).toBe(1024);
      expect(Buffer.byteLength(emojis512, 'utf-8')).toBe(2048);

      // 2048 bytes -> MUST NOT spill!
      const res512 = spiller.processOutput(emojis512);
      expect(res512.isSpilled).toBe(false);
      expect(res512.originalBytes).toBe(2048);

      // 513 emojis: str.length = 1026, byteLength = 513 * 4 = 2052 bytes (> 2048)!
      const emojis513 = '🚀'.repeat(513);
      expect(Buffer.byteLength(emojis513, 'utf-8')).toBe(2052);

      // 2052 bytes -> MUST spill!
      const res513 = spiller.processOutput(emojis513);
      expect(res513.isSpilled).toBe(true);
      expect(res513.originalBytes).toBe(2052);

      // Verify content read back matches emojis
      const readBack = spiller.readSpillFile(res513.hash!);
      expect(readBack).toBe(emojis513);
    });

    it('enforces directory traversal and path format security on readSpillFile', () => {
      // 1. Invalid hash formats
      expect(() => spiller.readSpillFile('../../etc/passwd')).toThrow(/Invalid spill hash/);
      expect(() => spiller.readSpillFile('..\\..\\windows\\win.ini')).toThrow(/Invalid spill hash/);
      expect(() => spiller.readSpillFile('invalid-hash-too-short')).toThrow(/Invalid spill hash/);
      expect(() => spiller.readSpillFile('g'.repeat(64))).toThrow(/Invalid spill hash/); // Non-hex

      // 2. Valid hex 64 hash that does not exist on disk
      const nonExistentHash = crypto.createHash('sha256').update('nonexistent').digest('hex');
      expect(() => spiller.readSpillFile(nonExistentHash)).toThrow(/Spill file not found/);
    });

    it('handles massive 1MB multi-line output with head/tail excerpt generation', () => {
      const lineCount = 10000;
      const lines = Array.from({ length: lineCount }, (_, i) => `Log line #${i}: status code 200 OK data payload`);
      const massiveOutput = lines.join('\n');
      const totalBytes = Buffer.byteLength(massiveOutput, 'utf-8');
      expect(totalBytes).toBeGreaterThan(400000);

      const res = spiller.processOutput(massiveOutput, 'docker logs');
      expect(res.isSpilled).toBe(true);
      expect(res.originalBytes).toBe(totalBytes);

      // Preview should contain the first line and last line
      expect(res.content).toContain('Log line #0:');
      expect(res.content).toContain(`Log line #${lineCount - 1}:`);
      expect(res.content).toContain(`spilled to disk`);
      expect(res.content).toContain(`invoke tool 'read_spill' with hash "${res.hash}"`);

      // Verify full read back from disk is 100% faithful
      const fullText = spiller.readSpillFile(res.hash!);
      expect(fullText.length).toBe(massiveOutput.length);
      expect(fullText).toBe(massiveOutput);
    });
  });
});
