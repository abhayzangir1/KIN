import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { ComputerSupervisor } from '../src/computer/computer_supervisor.js';
import { ToolGateway, StaleWriteConflictError } from '../src/execution/tool_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import { AgentLoopRunner } from '../src/kernel/agent_loop.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

describe('KIN Dynamic Computer & Systems Upgrade (Round 14)', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-upgrade-test-'));
    dbPath = path.join(tempDir, 'test_storage.sqlite');
    db = new KinDatabase({ dbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    const now = Date.now();
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-test', 'Test WS', ?, 'AUTO', ?, ?)`,
      tempDir,
      now,
      now
    );
    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('proj-kin', 'ws-test', 'KIN Test', ?, '{}', ?, ?)`,
      tempDir,
      now,
      now
    );
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Storage Schema & Migrations', () => {
    it('verifies action_records and file_revisions tables and agent_runs bindings', () => {
      const tables = db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';"
      ).map((r) => r.name);

      expect(tables).toContain('action_records');
      expect(tables).toContain('file_revisions');

      const runCols = db.query<{ name: string }>("PRAGMA table_info(agent_runs);").map((c) => c.name);
      expect(runCols).toContain('channel_id');
      expect(runCols).toContain('trigger_message_id');
    });
  });

  describe('2. Dynamic Computer Supervisor & Hardware Governor', () => {
    it('evaluates host memory and returns concurrency governor limits', () => {
      const supervisor = new ComputerSupervisor({ baseProfileDir: path.join(tempDir, 'profiles') });
      const gov = supervisor.getGovernorStatus();

      expect(gov.freeMemGB).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(gov.tier);
      expect(gov.maxBrowserContexts).toBeGreaterThanOrEqual(1);
      expect(gov.maxShellProcesses).toBeGreaterThanOrEqual(1);

      supervisor.shutdown();
    });

    it('enforces DesktopLock mutual exclusion between agents', async () => {
      const supervisor = new ComputerSupervisor({ baseProfileDir: path.join(tempDir, 'profiles') });

      // Agent 1 acquires lock
      const acquired1 = await supervisor.acquireDesktopLock('agent-qa', 5000);
      expect(acquired1).toBe(true);
      expect(supervisor.isDesktopLocked()).toBe(true);
      expect(supervisor.getDesktopLockOwner()).toBe('agent-qa');
      expect(supervisor.getAgentComputerTier('agent-qa')).toBe('TIER_2');

      // Agent 2 attempts to acquire lock (short timeout should fail while locked)
      const acquired2 = await supervisor.acquireDesktopLock('agent-dev', 200);
      expect(acquired2).toBe(false);

      // Agent 1 releases lock
      const released = supervisor.releaseDesktopLock('agent-qa');
      expect(released).toBe(true);
      expect(supervisor.isDesktopLocked()).toBe(false);
      expect(supervisor.getDesktopLockOwner()).toBeNull();

      await supervisor.shutdown();
    });

    it('scans and evicts idle agent contexts past threshold', async () => {
      const supervisor = new ComputerSupervisor({
        baseProfileDir: path.join(tempDir, 'profiles'),
        idleThresholdMs: 100, // 100ms threshold for test
      });

      // No active sessions initially
      const evicted = await supervisor.evictIdleSessions(100);
      expect(Array.isArray(evicted)).toBe(true);

      await supervisor.shutdown();
    });
  });

  describe('3. ToolGateway: Granular Permissions & OCC Stale-Write Protection', () => {
    it('enforces granular capability tags and rejects unauthorized tools', async () => {
      const gateway = new ToolGateway({ db });

      // 1. Agent has only fs:read capability, attempts to execute shell -> REJECTED
      const shellRes = await gateway.executeTool(
        'executeShell',
        { command: 'echo "hello"' },
        {
          runId: 'run-test-1',
          agentId: 'agent-restricted',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: ['fs:read'],
        }
      );

      expect(shellRes.success).toBe(false);
      expect(shellRes.error).toContain('FORBIDDEN');
      expect(shellRes.error).toContain('shell:exec');

      // 2. Agent with shell:exec (or alias shell) -> SUCCEEDS
      const validRes = await gateway.executeTool(
        'executeShell',
        { command: 'echo "permitted"' },
        {
          runId: 'run-test-1',
          agentId: 'agent-restricted',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: ['shell:exec'],
        }
      );
      expect(validRes.success).toBe(true);
    });

    it('enforces OCC stale-write protection when expected hash does not match disk', async () => {
      const gateway = new ToolGateway({ db });
      const testFile = 'stale_test.txt';
      const fullPath = path.join(tempDir, testFile);

      // 1. Write initial file
      fs.writeFileSync(fullPath, 'version 1 content', 'utf-8');
      const hash1 = crypto.createHash('sha256').update('version 1 content').digest('hex');

      // 2. External edit modifies file
      fs.writeFileSync(fullPath, 'external conflicting content', 'utf-8');

      // 3. Agent attempts to write assuming expectedHash = hash1 -> REJECTS with StaleWriteConflictError
      const staleWriteRes = await gateway.executeTool(
        'writeFile',
        { path: testFile, content: 'version 2 content' },
        {
          runId: 'run-test-occ',
          agentId: 'agent-writer',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: ['fs:write'],
          expectedHash: hash1, // Stale!
        }
      );

      expect(staleWriteRes.success).toBe(false);
      expect(staleWriteRes.error).toContain('STALE_WRITE_CONFLICT');

      // 4. Force write or correct expected hash succeeds
      const correctHash = crypto.createHash('sha256').update('external conflicting content').digest('hex');
      const validWriteRes = await gateway.executeTool(
        'writeFile',
        { path: testFile, content: 'version 2 content' },
        {
          runId: 'run-test-occ',
          agentId: 'agent-writer',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: ['fs:write'],
          expectedHash: correctHash,
        }
      );

      expect(validWriteRes.success).toBe(true);
    });

    it('respects AbortSignal for immediate hard cancellation', async () => {
      const gateway = new ToolGateway({ db });
      const controller = new AbortController();
      controller.abort(); // already aborted

      const res = await gateway.executeTool(
        'executeShell',
        { command: 'echo "should not run"' },
        {
          runId: 'run-abort',
          agentId: 'agent-abort',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: ['*'],
          abortSignal: controller.signal,
        }
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('ABORTED');
    });

    it('durably records tool executions into action_records table', async () => {
      const gateway = new ToolGateway({ db });

      await gateway.executeTool(
        'writeFile',
        { path: 'audit_test.txt', content: 'audit logged' },
        {
          runId: 'run-audit-1',
          agentId: 'agent-auditor',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: ['fs:write'],
        }
      );

      const records = db.query<{ id: string; tool_name: string; status: string; agent_id: string }>(
        `SELECT * FROM action_records WHERE agent_id = 'agent-auditor'`
      );

      expect(records.length).toBeGreaterThan(0);
      expect(records[0].tool_name).toBe('writeFile');
      expect(records[0].status).toBe('success');
    });
  });

  describe('4. System Health Diagnostics & Fail-Fast API', () => {
    let server: CoreServer;
    let serverPort: number;

    beforeEach(async () => {
      server = new CoreServer({ port: 0, dbPath });
      serverPort = await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    it('GET /api/system/health returns comprehensive diagnostics with checks and memory limits', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/system/health`);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data).toHaveProperty('status');
      expect(['healthy', 'degraded']).toContain(data.status);
      expect(data.components).toHaveProperty('ollama');
      expect(data.components).toHaveProperty('chromium');
      expect(data.components).toHaveProperty('git');
      expect(data.components).toHaveProperty('sqlite');
      expect(data.components).toHaveProperty('memory');
      expect(data.components.sqlite.status).toBe('ok');

      // Verify UI-consumed properties
      expect(data).toHaveProperty('checks');
      expect(data).toHaveProperty('memory');
      expect(data.memory).toHaveProperty('freeMb');
      expect(data.memory).toHaveProperty('totalMb');
      expect(data).toHaveProperty('limits');
      expect(data.limits).toHaveProperty('maxConcurrentShell');
      expect(data.limits).toHaveProperty('maxConcurrentBrowser');
      expect(Array.isArray(data.activeAlerts)).toBe(true);
    });

    it('POST /api/automations registers new schedule via unified route', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/automations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'one_shot',
          durationSeconds: 30,
          prompt: 'Execute automated regression check',
          channelId: 'chan-general',
        }),
      });

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.schedule).toBeDefined();
      expect(data.schedule.prompt).toBe('Execute automated regression check');
    });

    it('GET /api/system/governor returns dynamic memory limits', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/system/governor`);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data).toHaveProperty('freeMemGB');
      expect(data).toHaveProperty('tier');
      expect(data).toHaveProperty('maxBrowserContexts');
      expect(data).toHaveProperty('maxShellProcesses');
    });

    it('GET /api/system/actions returns audited action records', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/system/actions?limit=10`);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(Array.isArray(data.actions)).toBe(true);
    });

    it('GET /api/automations returns enriched schedules', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/automations`);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(Array.isArray(data.automations)).toBe(true);
    });

    it('POST /api/channels/:id/messages with /plan /boost /teamwork-preview initiates compound pipeline', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '/plan /boost /teamwork-preview Autonomous Multi-Agent Upgrades',
          senderType: 'human',
        }),
      });

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data).toHaveProperty('message');

      // Allow background agent reply creation
      let compoundCard: any;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const msgRes = await fetch(`http://127.0.0.1:${serverPort}/api/channels/chan-general/messages`);
        const msgData: any = await msgRes.json();
        const messages = msgData.messages || [];
        compoundCard = messages.find((m: any) => m.content && m.content.includes('Compound Pipeline Engaged'));
        if (compoundCard) break;
      }

      // Verify compound card and matrix was created in channel
      expect(compoundCard).toBeDefined();
      expect(compoundCard.content).toContain('Workforce Collaboration Matrix');
      expect(compoundCard.content).toContain('Milestone Breakdown DAG');
      expect(compoundCard.content).toContain('Boost');

      // Verify Goal and Tasks were registered in SQLite
      const stateRes = await fetch(`http://127.0.0.1:${serverPort}/api/state?projectId=proj-kin`);
      const stateData: any = await stateRes.json();
      expect(stateData.goals.some((g: any) => g.title.includes('Autonomous Multi-Agent Upgrades'))).toBe(true);
      expect(stateData.tasks.length).toBeGreaterThanOrEqual(3);
    });

    it('POST /api/channels/:id/messages with /plan /boost /teamwork-preview /goal parses pipe criteria and distributes specialist tasks', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '/plan /boost /teamwork-preview /goal Hardened Sovereign Core | Enterprise resilience & contracts | Contract verification, 100% tests pass',
          senderType: 'human',
        }),
      });

      expect(res.status).toBe(201);

      // Allow background agent reply creation
      let compoundCard: any;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const msgRes = await fetch(`http://127.0.0.1:${serverPort}/api/channels/chan-general/messages`);
        const msgData: any = await msgRes.json();
        const messages = msgData.messages || [];
        compoundCard = messages.find((m: any) => m.senderType === 'agent' && m.content && m.content.includes('Hardened Sovereign Core'));
        if (compoundCard) break;
      }
      expect(compoundCard).toBeDefined();
      expect(compoundCard.content).toContain('Goal Milestone');
      expect(compoundCard.content).toContain('Teamwork Preview');
      expect(compoundCard.content).toContain('Plan DAG');
      expect(compoundCard.content).toContain('Boost Autonomy');

      // Verify Goal registered with parsed acceptance criteria
      const stateRes = await fetch(`http://127.0.0.1:${serverPort}/api/state?projectId=proj-kin`);
      const stateData: any = await stateRes.json();
      const goal = stateData.goals.find((g: any) => g.title.includes('Hardened Sovereign Core'));
      expect(goal).toBeDefined();
      expect(goal.description).toBe('Enterprise resilience & contracts');
      expect(goal.acceptanceCriteria).toContain('Contract verification');
      expect(goal.acceptanceCriteria).toContain('100% tests pass');

      // Verify tasks exist and first task is running
      const goalTasks = stateData.tasks.filter((t: any) => t.goalId === goal.id);
      expect(goalTasks.length).toBe(3);
      expect(goalTasks[0].status).toBe('running');
      expect(goalTasks[1].status).toBe('ready');
      expect(goalTasks[2].status).toBe('ready');
    });
  });

  describe('5. Advanced Concurrency & OCC End-to-End Protections', () => {
    it('automatically records baseline hash on readFile and detects external changes on writeFile', async () => {
      const gateway = new ToolGateway({ db });
      const testFile = 'occ_read_baseline.txt';
      const fullPath = path.join(tempDir, testFile);

      // Step 1: File exists on disk prior to agent run (e.g. user created)
      fs.writeFileSync(fullPath, 'initial baseline text', 'utf-8');

      // Step 2: Agent reads file
      const readRes = await gateway.executeTool(
        'readFile',
        { filePath: testFile },
        {
          runId: 'run-read-1',
          agentId: 'agent-reader',
          projectId: 'proj-kin',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: ['fs:read'],
        }
      );
      expect(readRes.success).toBe(true);

      // Verify baseline hash was recorded into file_revisions table
      const rev = db.queryOne<{ content_hash: string }>(
        `SELECT content_hash FROM file_revisions WHERE project_id = ? AND file_path = ?`,
        'proj-kin',
        testFile
      );
      expect(rev).toBeDefined();

      // Step 3: External editor modifies the file
      fs.writeFileSync(fullPath, 'concurrent external modification', 'utf-8');

      // Step 4: Agent tries to write file without knowledge of external edit -> StaleWriteConflictError
      const writeRes = await gateway.executeTool(
        'writeFile',
        { filePath: testFile, content: 'agent overwrite attempt' },
        {
          runId: 'run-write-1',
          agentId: 'agent-writer',
          projectId: 'proj-kin',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: ['fs:write'],
        }
      );
      expect(writeRes.success).toBe(false);
      expect(writeRes.error).toContain('STALE_WRITE_CONFLICT');

      // Step 5: Force write bypasses conflict check
      const forceRes = await gateway.executeTool(
        'writeFile',
        { filePath: testFile, content: 'agent resolved merge' },
        {
          runId: 'run-write-2',
          agentId: 'agent-writer',
          projectId: 'proj-kin',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: ['fs:write'],
          forceWrite: true,
        }
      );
      expect(forceRes.success).toBe(true);
      expect(fs.readFileSync(fullPath, 'utf-8')).toBe('agent resolved merge');
    });

    it('enforces hardware governor slot acquisition during executeShell', async () => {
      const supervisor = new ComputerSupervisor({ baseProfileDir: path.join(tempDir, 'profiles') });
      const gateway = new ToolGateway({ db, computerSupervisor: supervisor });

      // Run multiple shell commands concurrently through gateway
      const promises = [1, 2, 3, 4].map((i) =>
        gateway.executeTool(
          'executeShell',
          { command: `echo "shell task ${i}"` },
          {
            runId: `run-shell-${i}`,
            agentId: `agent-${i}`,
            projectId: 'proj-kin',
            worktreeRoot: tempDir,
            autonomyMode: 'AUTO',
            allowedCapabilities: ['shell:exec'],
          }
        )
      );

      const results = await Promise.all(promises);
      expect(results.every((r) => r.success)).toBe(true);

      // Confirm slots were all returned
      const gov = supervisor.getGovernorStatus();
      expect(gov.activeShellProcesses).toBe(0);
      expect(gov.queuedShellRequests).toBe(0);

      await supervisor.shutdown();
    });

    it('throttles multi-browser and shell requests when host memory is in low tier', async () => {
      const supervisor = new ComputerSupervisor({ baseProfileDir: path.join(tempDir, 'profiles') });

      try {
        // Simulate low memory tier (< 2.5 GB free)
        supervisor.setMockFreeMemBytes(1.5 * 1024 * 1024 * 1024);
        const status = supervisor.getGovernorStatus();
        expect(status.tier).toBe('low');
        expect(status.maxShellProcesses).toBe(1);
        expect(status.maxBrowserContexts).toBe(1);

        // 1. Shell concurrency throttle test
        const releaseShell1 = await supervisor.acquireShellSlot(5000);
        expect(supervisor.getGovernorStatus().activeShellProcesses).toBe(1);

        let shell2Granted = false;
        const shell2Promise = supervisor.acquireShellSlot(5000).then((rel) => {
          shell2Granted = true;
          return rel;
        });

        await new Promise((r) => setTimeout(r, 60));
        expect(shell2Granted).toBe(false);
        expect(supervisor.getGovernorStatus().queuedShellRequests).toBe(1);

        // Release slot 1 -> slot 2 should unblock
        releaseShell1();
        const releaseShell2 = await shell2Promise;
        expect(shell2Granted).toBe(true);
        expect(supervisor.getGovernorStatus().activeShellProcesses).toBe(1);
        expect(supervisor.getGovernorStatus().queuedShellRequests).toBe(0);
        releaseShell2();
        expect(supervisor.getGovernorStatus().activeShellProcesses).toBe(0);

        // 2. Browser context concurrency throttle test
        const releaseBrowser1 = await supervisor.acquireBrowserSlot('agent-low-1', 5000);

        let browser2Granted = false;
        const browser2Promise = supervisor.acquireBrowserSlot('agent-low-2', 5000).then((rel) => {
          browser2Granted = true;
          return rel;
        });

        await new Promise((r) => setTimeout(r, 60));
        expect(browser2Granted).toBe(false);
        expect(supervisor.getGovernorStatus().queuedBrowserRequests).toBe(1);

        releaseBrowser1();
        const releaseBrowser2 = await browser2Promise;
        expect(browser2Granted).toBe(true);
        expect(supervisor.getGovernorStatus().queuedBrowserRequests).toBe(0);
        releaseBrowser2();
      } finally {
        await supervisor.shutdown();
      }
    });
  });

  describe('6. Resilient Tool Call Extraction & Routine Duration Parsing', () => {
    it('extracts tool calls from raw JSON without <tool_call> tags', () => {
      const rawJson = '{"name": "readFile", "parameters": {"filePath": "D:\\\\KIN\\\\core\\\\docs\\\\server.md"}}';
      const extracted = AgentLoopRunner.extractToolCall(rawJson);
      expect(extracted).not.toBeNull();
      expect(extracted?.name).toBe('readFile');
      expect(extracted?.params.filePath).toBe('D:/KIN/core/docs/server.md');
    });

    it('extracts tool calls from markdown code fences', () => {
      const fenced = '```json\n{"name": "writeFile", "parameters": {"filePath": "src/index.ts", "content": "hello"}}\n```';
      const extracted = AgentLoopRunner.extractToolCall(fenced);
      expect(extracted).not.toBeNull();
      expect(extracted?.name).toBe('writeFile');
      expect(extracted?.params.content).toBe('hello');
    });

    it('extracts tool calls from classic <tool_call> tags with backslash path normalization', () => {
      const tagged = '<tool_call>\n{"name": "listDirectory", "parameters": {"dirPath": "core\\\\src"}}\n</tool_call>';
      const extracted = AgentLoopRunner.extractToolCall(tagged);
      expect(extracted).not.toBeNull();
      expect(extracted?.name).toBe('listDirectory');
      expect(extracted?.params.dirPath).toBe('core/src');
    });

    it('extracts tool calls when parameters appear before name in raw JSON with surrounding text', () => {
      const content = 'I will read it: {"parameters": {"path": "test.txt"}, "name": "readFile"}';
      const extracted = AgentLoopRunner.extractToolCall(content);
      expect(extracted).not.toBeNull();
      expect(extracted?.name).toBe('readFile');
      expect(extracted?.params.path).toBe('test.txt');
    });

    it('extracts tool calls with raw physical newlines inside JSON string parameters', () => {
      const content = '<tool_call>\n{"name": "writeFile", "parameters": {"path": "test.txt", "content": "line 1\nline 2"}}\n</tool_call>';
      const extracted = AgentLoopRunner.extractToolCall(content);
      expect(extracted).not.toBeNull();
      expect(extracted?.name).toBe('writeFile');
      expect(extracted?.params.content).toBe('line 1\nline 2');
    });

    it('extracts tool calls from single-quoted JSON dicts', () => {
      const content = "{'name': 'readFile', 'parameters': {'path': 'test.txt'}}";
      const extracted = AgentLoopRunner.extractToolCall(content);
      expect(extracted).not.toBeNull();
      expect(extracted?.name).toBe('readFile');
      expect(extracted?.params.path).toBe('test.txt');
    });

    it('extracts tool calls with nested objects inside parameters surrounded by text', () => {
      const content = 'Here is the action:\n{"name": "executeAction", "parameters": {"config": {"timeout": 5000, "retries": 3}, "action": "run"}}\nDone.';
      const extracted = AgentLoopRunner.extractToolCall(content);
      expect(extracted).not.toBeNull();
      expect(extracted?.name).toBe('executeAction');
      expect(extracted?.params.config.timeout).toBe(5000);
      expect(extracted?.params.action).toBe('run');
    });

    it('extracts tool calls from <function_call> and <tool> tags', () => {
      const fCall = '<function_call>{"name": "desktopScreenshot", "parameters": {}}</function_call>';
      const extracted1 = AgentLoopRunner.extractToolCall(fCall);
      expect(extracted1?.name).toBe('desktopScreenshot');

      const toolTag = '<tool>{"name": "browserClose", "parameters": {}}</tool>';
      const extracted2 = AgentLoopRunner.extractToolCall(toolTag);
      expect(extracted2?.name).toBe('browserClose');
    });

    it('parses diverse routine duration units correctly via parseScheduleDurationAndPrompt', () => {
      const server = new CoreServer({ port: 0, dbPath });
      
      const p1 = server.parseScheduleDurationAndPrompt('30s Check active tasks');
      expect(p1?.durationSeconds).toBe(30);
      expect(p1?.prompt).toBe('Check active tasks');

      const p2 = server.parseScheduleDurationAndPrompt('5m Deep repository audit');
      expect(p2?.durationSeconds).toBe(300);
      expect(p2?.prompt).toBe('Deep repository audit');

      const p3 = server.parseScheduleDurationAndPrompt('1h 30m Daily operations briefing');
      expect(p3?.durationSeconds).toBe(5400);
      expect(p3?.prompt).toBe('Daily operations briefing');
    });
  });

  describe('7. Authoritative Resource Lifecycle: Channels, Goals, Tasks Deletion & Terminology Sanitization', () => {
    let server: CoreServer;
    let serverPort: number;
    let suite7Dir: string;
    let suite7DbPath: string;

    beforeAll(async () => {
      suite7Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-lifecycle-test-'));
      suite7DbPath = path.join(suite7Dir, 'lifecycle_storage.sqlite');
      const suite7Db = new KinDatabase({ dbPath: suite7DbPath });
      new MigrationRunner(suite7Db).runMigrations();
      suite7Db.close();

      server = new CoreServer({ port: 0, dbPath: suite7DbPath });
      serverPort = await server.start();
    });

    afterAll(async () => {
      await server.stop();
      try {
        fs.rmSync(suite7Dir, { recursive: true, force: true });
      } catch {}
    });

    it('creates and deletes a channel via DELETE /api/channels/:id (protecting chan-general)', async () => {
      const createRes = await fetch(`http://127.0.0.1:${serverPort}/api/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'temp-cleanup-channel', topic: 'Testing channel deletion' }),
      });
      expect(createRes.status).toBe(201);
      const { channel } = await createRes.json();

      // Protect general channel
      const generalDel = await fetch(`http://127.0.0.1:${serverPort}/api/channels/chan-general`, { method: 'DELETE' });
      expect(generalDel.status).toBe(400);

      // Delete created channel
      const delRes = await fetch(`http://127.0.0.1:${serverPort}/api/channels/${channel.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(200);
      const delData = await delRes.json();
      expect(delData.success).toBe(true);

      // Verify channel is gone
      const verifyRes = await fetch(`http://127.0.0.1:${serverPort}/api/channels/${channel.id}`, { method: 'DELETE' });
      expect(verifyRes.status).toBe(404);
    });

    it('creates and deletes goals and individual tasks via DELETE endpoints', async () => {
      const goalRes = await fetch(`http://127.0.0.1:${serverPort}/api/projects/proj-kin/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Temporary Verification Goal' }),
      });
      expect(goalRes.status).toBe(201);
      const { goal } = await goalRes.json();

      // Create a second task
      const taskRes = await fetch(`http://127.0.0.1:${serverPort}/api/goals/${goal.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Temporary Subtask' }),
      });
      expect(taskRes.status).toBe(201);
      const { task: secondTask } = await taskRes.json();

      // Delete single task
      const delTaskRes = await fetch(`http://127.0.0.1:${serverPort}/api/tasks/${secondTask.id}`, { method: 'DELETE' });
      expect(delTaskRes.status).toBe(200);

      // Delete goal (which cascades to remaining tasks)
      const delGoalRes = await fetch(`http://127.0.0.1:${serverPort}/api/goals/${goal.id}`, { method: 'DELETE' });
      expect(delGoalRes.status).toBe(200);
    });

    it('sanitizes forbidden terminology correctly', () => {
      const sanitized = server.sanitizeTerminology('Welcome to the KIN OS and KIN Operating System runtime on this operating system.');
      expect(sanitized).not.toContain('KIN OS');
      expect(sanitized).not.toContain('KIN Operating System');
      expect(sanitized).not.toContain('operating system');
      expect(sanitized).toBe('Welcome to the KIN Platform and KIN Platform runtime on this platform runtime.');
    });
  });
});

