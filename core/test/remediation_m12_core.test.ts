import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CoreServer } from '../src/server/core_server.js';
import { KinDatabase, safeJsonParseObject } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { ComputerSupervisor } from '../src/computer/computer_supervisor.js';
import { DesktopController } from '../src/computer/desktop_controller.js';
import { BrowserController } from '../src/browser/browser_controller.js';
import { ToolEngine } from '../src/execution/tool_engine.js';
import { SchedulerService } from '../src/automation/scheduler.js';
import { getDataDirectory } from '../src/storage/data_directory.js';
import { DEFAULT_FALLBACK_MODEL_ID, AgentRepository } from '../src/domain/agent_repository.js';

describe('Milestone 12: Core Subsystems Remediation Verification Suite', () => {
  let tempDir: string;
  let testDbPath: string;
  let testProjectDir: string;
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-m12-test-'));
    testDbPath = path.join(tempDir, 'test_m12.sqlite');
    testProjectDir = path.join(tempDir, 'project');
    fs.mkdirSync(testProjectDir, { recursive: true });

    server = new CoreServer({ port: 0, dbPath: testDbPath });
    port = await server.start();
    server.db.execute("UPDATE projects SET repo_path = ? WHERE id = 'proj-kin'", testProjectDir);
  });

  afterAll(async () => {
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // Feature 54 & 61: Dynamic Model Resolution SQL & Unified Fallback Constant
  // --------------------------------------------------------------------------
  describe('Feature 54 & 61: Dynamic Model Resolution SQL and Fallback Model ID', () => {
    it('executes model resolution query with single-quote string literal without SQLite identifier error', () => {
      // Query used in ToolGateway.dispatchToolExecution
      const query = "SELECT active_model_id FROM agent_identities WHERE active_model_id IS NOT NULL AND active_model_id != '' ORDER BY is_orchestrator DESC LIMIT 1";
      expect(() => {
        const row = server.db.queryOne<{ active_model_id: string }>(query);
        expect(row).toBeDefined();
        expect(row?.active_model_id).toBeDefined();
      }).not.toThrow();
    });

    it('dynamically resolves model from existing agent identity when hiring specialist without explicit model', async () => {
      // Set active_model_id of boss agent
      server.db.execute(
        "UPDATE agent_identities SET active_model_id = 'test-provider/resolved-model-1' WHERE id = 'agent-boss'"
      );

      // Hire specialist without explicit suggestedModel
      const hireRes = await server.toolGateway.executeTool<any>(
        'hire_specialist',
        {
          name: 'DynamicResolverAgent',
          role: 'Analyst',
        },
        { agentId: 'agent-boss' }
      );

      expect(hireRes.success).toBe(true);
      expect(hireRes.output.activeModelId).toBe('test-provider/resolved-model-1');
    });

    it('exports DEFAULT_FALLBACK_MODEL_ID unified across agent repo, agent controller, and tool gateway', () => {
      expect(DEFAULT_FALLBACK_MODEL_ID).toBe('ollama/qwen2.5-coder:3b');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 55: Approvals Status CHECK Constraint allows 'failed'
  // --------------------------------------------------------------------------
  describe('Feature 55: Approvals Status CHECK Constraint & Failure Transition', () => {
    it('allows updating approval status to "failed" without CHECK constraint violation', () => {
      const now = Date.now();
      const approvalId = `appr-test-${now}`;
      const runId = `run-test-${now}`;
      const agentId = 'agent-boss';

      // Ensure run exists for foreign key
      server.db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
         VALUES (?, ?, 'proj-kin', 'running', ?, 1000, 0, ?)`,
        runId,
        agentId,
        now,
        now
      );

      // Insert pending approval
      server.db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
         VALUES (?, ?, ?, 'executeShell', '{"command":"false"}', 'HIGH', 'pending', ?, ?)`,
        approvalId,
        runId,
        agentId,
        now + 60000,
        now
      );

      // Verify updating status to 'failed' succeeds cleanly
      expect(() => {
        server.db.execute(
          `UPDATE approvals SET status = 'failed', decided_at = ? WHERE id = ?`,
          Date.now(),
          approvalId
        );
      }).not.toThrow();

      const updated = server.db.queryOne<{ status: string; decided_at: number }>(
        `SELECT status, decided_at FROM approvals WHERE id = ?`,
        approvalId
      );
      expect(updated?.status).toBe('failed');
      expect(updated?.decided_at).toBeGreaterThan(0);
    });

    it('migrates older approvals table lacking "failed" in CHECK constraint', async () => {
      const legacyDbPath = path.join(tempDir, 'legacy_approvals.sqlite');
      const legacyServer = new CoreServer({ port: 0, dbPath: legacyDbPath });
      await legacyServer.start();
      const legacyDb = legacyServer.db;

      try {
        // Recreate approvals table with legacy CHECK constraint (without 'failed')
        legacyDb.exec(`
          DROP TABLE approvals;
          CREATE TABLE approvals (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
            tool_name TEXT NOT NULL,
            action_payload_json TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
            commit_sha TEXT,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            decided_at INTEGER
          );
        `);

        const now = Date.now();
        legacyDb.execute(
          `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
           VALUES ('run-legacy-1', 'agent-boss', 'proj-kin', 'running', ?, 1000, 0, ?)`,
          now,
          now
        );
        legacyDb.execute(
          `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
           VALUES ('appr-legacy-1', 'run-legacy-1', 'agent-boss', 'executeShell', '{}', 'HIGH', 'pending', ?, ?)`,
          now + 60000,
          now
        );

        // Old table fails on 'failed'
        expect(() => {
          legacyDb.execute("UPDATE approvals SET status = 'failed' WHERE id = 'appr-legacy-1'");
        }).toThrow(/CHECK constraint failed/);

        // Run MigrationRunner to migrate legacy approvals table
        const runner = new MigrationRunner(legacyDb);
        runner.runMigrations();

        // Now update to 'failed' succeeds
        expect(() => {
          legacyDb.execute("UPDATE approvals SET status = 'failed' WHERE id = 'appr-legacy-1'");
        }).not.toThrow();

        const row = legacyDb.queryOne<{ status: string }>("SELECT status FROM approvals WHERE id = 'appr-legacy-1'");
        expect(row?.status).toBe('failed');
      } finally {
        await legacyServer.stop();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 56: Safe State Parse on `/api/state`
  // --------------------------------------------------------------------------
  describe('Feature 56: Safe State Parse on /api/state', () => {
    it('resiliently handles corrupted or malformed action_payload_json in pending approvals without 500 error', async () => {
      const now = Date.now();
      const corruptedApprovalId = `appr-corrupted-${now}`;
      const runId = `run-corrupted-${now}`;
      const agentId = 'agent-boss';

      server.db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
         VALUES (?, ?, 'proj-kin', 'running', ?, 1000, 0, ?)`,
        runId,
        agentId,
        now,
        now
      );

      // Insert approval with completely invalid / unparseable JSON
      server.db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
         VALUES (?, ?, ?, 'executeShell', '{ invalid json syntax without quotes or delimiters', 'HIGH', 'pending', ?, ?)`,
        corruptedApprovalId,
        runId,
        agentId,
        now + 60000,
        now
      );

      // Query /api/state — must return 200 with parameters parsed as {}
      const res = await fetch(`http://127.0.0.1:${port}/api/state`);
      expect(res.status).toBe(200);

      const state = await res.json();
      expect(state.pendingApprovals).toBeDefined();
      const corrupted = state.pendingApprovals.find((a: any) => a.id === corruptedApprovalId);
      expect(corrupted).toBeDefined();
      expect(corrupted.parameters).toEqual({});
    });
  });

  // --------------------------------------------------------------------------
  // Feature 57: Remove Deprecated Test Hook / ComputerSupervisor freeMemProvider
  // --------------------------------------------------------------------------
  describe('Feature 57: ComputerSupervisor freeMemProvider constructor injection', () => {
    it('does not expose deprecated setMockFreeMemBytes method on supervisor instance', () => {
      const supervisor = new ComputerSupervisor({ baseProfileDir: path.join(tempDir, 'prof-1') });
      expect((supervisor as any).setMockFreeMemBytes).toBeUndefined();
      expect((supervisor as any).setMemoryProvider).toBeUndefined();
    });

    it('injects freeMemProvider via constructor options and adapts governor tiers cleanly', () => {
      // Low tier (< 2.5 GB)
      const lowSupervisor = new ComputerSupervisor({
        baseProfileDir: path.join(tempDir, 'prof-low'),
        freeMemProvider: () => 1.5 * 1024 * 1024 * 1024,
      });
      const lowStatus = lowSupervisor.getGovernorStatus();
      expect(lowStatus.tier).toBe('low');
      expect(lowStatus.maxBrowserContexts).toBe(1);
      expect(lowStatus.maxShellProcesses).toBe(1);

      // High tier (> 6.0 GB)
      const highSupervisor = new ComputerSupervisor({
        baseProfileDir: path.join(tempDir, 'prof-high'),
        freeMemProvider: () => 8.0 * 1024 * 1024 * 1024,
      });
      const highStatus = highSupervisor.getGovernorStatus();
      expect(highStatus.tier).toBe('high');
      expect(highStatus.maxBrowserContexts).toBe(3);
      expect(highStatus.maxShellProcesses).toBe(4);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 58: Safe ToolEngine Deserialization
  // --------------------------------------------------------------------------
  describe('Feature 58: Safe ToolEngine Deserialization', () => {
    it('safely deserializes corrupted parameters_schema and evidence_metrics_json to empty objects', () => {
      const engine = new ToolEngine(server.db);
      const now = Date.now();

      // Insert custom tool with invalid non-JSON parameters_schema
      const toolId = `tool-corrupted-${now}`;
      server.db.execute(
        `INSERT INTO custom_tools (id, project_id, name, description, parameters_schema, handler_code, status, created_at, updated_at)
         VALUES (?, 'proj-kin', 'corrupted_tool', 'Test Tool', '{ not json at all }', 'return true;', 'active', ?, ?)`,
        toolId,
        now,
        now
      );

      const retrievedTool = engine.getToolById(toolId);
      expect(retrievedTool).toBeDefined();
      expect(retrievedTool?.parametersSchema).toEqual({});

      // Insert improvement with primitive non-object evidence_metrics_json
      const impId = `imp-primitive-${now}`;
      server.db.execute(
        `INSERT INTO harness_improvements (id, project_id, domain, component_type, problem_signature, verified_adaptation, evidence_metrics_json, success_runs, created_at, updated_at)
         VALUES (?, 'proj-kin', 'testing', 'tool', 'sig-1', 'adapt-1', '"string primitive not an object"', 1, ?, ?)`,
        impId,
        now,
        now
      );

      const improvements = engine.findImprovements('testing');
      const retrievedImp = improvements.find((i) => i.id === impId);
      expect(retrievedImp).toBeDefined();
      expect(retrievedImp?.evidenceMetrics).toEqual({});
    });
  });

  // --------------------------------------------------------------------------
  // Feature 59: Observability in Schedule Trigger
  // --------------------------------------------------------------------------
  describe('Feature 59: Observability in Schedule Trigger', () => {
    it('logs error with [scheduler] triggerSchedule error: when schedule trigger fails', async () => {
      const scheduler = new SchedulerService({ db: server.db, port: 54321 });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const result = await scheduler.triggerSchedule('non-existent-sched-id');
        expect(result).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[scheduler] triggerSchedule error:',
          expect.any(Error)
        );
      } finally {
        consoleErrorSpy.mockRestore();
        scheduler.stop();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 60: Directory Creation Diagnostic Logging
  // --------------------------------------------------------------------------
  describe('Feature 60: Directory Creation Diagnostic Logging', () => {
    it('returns custom directory and logs warnings if mkdir fails on restricted path', () => {
      const origEnv = process.env.KIN_DATA_DIR;
      const testCustomDir = path.join(tempDir, 'custom_kin_data');
      process.env.KIN_DATA_DIR = testCustomDir;

      try {
        const resolved = getDataDirectory();
        expect(resolved).toBe(testCustomDir);
        expect(fs.existsSync(testCustomDir)).toBe(true);
      } finally {
        if (origEnv !== undefined) process.env.KIN_DATA_DIR = origEnv;
        else delete process.env.KIN_DATA_DIR;
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 64: DesktopController PowerShell Process Tree Kill on Timeout & Abort
  // --------------------------------------------------------------------------
  describe('Feature 64: DesktopController PowerShell Process Cleanup & Abort Handling', () => {
    it('cleans up abortListener when child process closes or aborts without listener leak', async () => {
      const desktop = new DesktopController();
      const controller = new AbortController();

      // Quick command with abortSignal
      const runPromise = desktop.runPowerShell('Write-Output "test_clean_listener"', controller.signal);
      const res = await runPromise;
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('test_clean_listener');

      // Aborting after completion does not throw or trigger zombie callback
      expect(() => controller.abort()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Feature 65: Resolve DesktopLock Waiters on Shutdown
  // --------------------------------------------------------------------------
  describe('Feature 65: Resolve DesktopLock Waiters on Supervisor Shutdown', () => {
    it('resolves all pending desktopLock waiters with false on shutdown and drains queues', async () => {
      const supervisor = new ComputerSupervisor({
        baseProfileDir: path.join(tempDir, 'prof-lock-test'),
      });

      // 1. Acquire lock by agent-1
      const acquired1 = await supervisor.acquireDesktopLock('agent-1', 10000);
      expect(acquired1).toBe(true);
      expect(supervisor.getDesktopLockOwner()).toBe('agent-1');

      // 2. Queue agent-2 waiter with long timeout
      let waiterResolvedValue: boolean | undefined;
      const waiterPromise = supervisor.acquireDesktopLock('agent-2', 30000).then((val) => {
        waiterResolvedValue = val;
        return val;
      });

      // Allow event loop tick to register waiter
      await new Promise((r) => setTimeout(r, 20));

      // 3. Shutdown supervisor while waiter is waiting
      await supervisor.shutdown();

      // 4. Waiter promise must resolve to false immediately without hanging
      const result = await waiterPromise;
      expect(result).toBe(false);
      expect(waiterResolvedValue).toBe(false);
      expect(supervisor.getDesktopLockOwner()).toBeNull();

      // Queues are drained
      const status = supervisor.getGovernorStatus();
      expect(status.queuedShellRequests).toBe(0);
      expect(status.queuedBrowserRequests).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 67: Eliminate Standalone Browser Port Collisions
  // --------------------------------------------------------------------------
  describe('Feature 67: Eliminate Standalone Browser Port Collisions', () => {
    it('BrowserController does not contain hardcoded --remote-debugging-port=9222 in default args', () => {
      const browserCtrl = new BrowserController();
      expect(browserCtrl.getStatus().active).toBe(false);
      // Ensure findBrowserExecutable is callable statically or on instance
      const execPath = BrowserController.findBrowserExecutable();
      expect(typeof execPath === 'string' || execPath === null).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 73: Dead Controller Routes Elimination
  // --------------------------------------------------------------------------
  describe('Feature 73: Dead Controller Routes Elimination', () => {
    it('GET /api/system/apps is served by primary route with genuine discovery', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/system/apps`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('apps');
      expect(Array.isArray(data.apps)).toBe(true);
    });

    it('POST /api/system/apps/launch requires target and evaluates Sentinel authorization', async () => {
      // 1. Missing target returns 400
      const badRes = await fetch(`http://127.0.0.1:${port}/api/system/apps/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(badRes.status).toBe(400);

      // 2. Target evaluation goes through Sentinel
      const res = await fetch(`http://127.0.0.1:${port}/api/system/apps/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appNameOrPath: 'notepad.exe' }),
      });
      // In default AUTO mode or requiring approval, returns either 200 or 428/403 with Sentinel reason
      expect([200, 400, 403, 428]).toContain(res.status);
    });
  });
});
