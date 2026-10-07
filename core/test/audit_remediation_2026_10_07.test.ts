import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { Sentinel } from '../src/security/sentinel.js';
import { SecretBroker } from '../src/security/secret_broker.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { ModelGateway } from '../src/execution/model_gateway.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as nodeOs from 'node:os';

describe('KIN Audit Remediation Suite (2026-10-07 Findings Verification)', () => {
  let db: KinDatabase;
  let dbPath: string;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    dbPath = path.join(nodeOs.tmpdir(), `kin_audit_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.sqlite`);
    db = new KinDatabase(dbPath);
    const migrator = new MigrationRunner(db);
    migrator.runMigrations();
    taskRepo = new TaskRepository(db);

    // Seed workspace, project, goal, agent identity and seed runs
    db.execute(`INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-audit', 'Audit WS', '.', 'AUTO', 1, 1)`);
    db.execute(`INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-kin', 'ws-audit', 'Default Project', '.', 1, 1)`);
    db.execute(`INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-audit', 'ws-audit', 'Audit Project', '.', 1, 1)`);
    db.execute(`INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at) VALUES ('goal-audit', 'proj-audit', 'Audit Goal', 'Goal Desc', '[]', 'active', 1, 1)`);
    db.execute(`INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-audit', 'Audit Agent', 'Tester', 'Prompt', 'ollama/test', 1)`);
    db.execute(`INSERT INTO agent_identities (id, workspace_id, definition_id, project_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at) VALUES ('ag-audit', 'ws-audit', 'def-audit', 'proj-audit', 'Audit Identity', 'ollama/test', 0, 0, 1, 1)`);
    db.execute(`INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at) VALUES ('run-1', 'ag-audit', 'proj-audit', 'running', 1, 1)`);
    db.execute(`INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at) VALUES ('run-6', 'ag-audit', 'proj-audit', 'running', 1, 1)`);
    db.execute(`INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at) VALUES ('run-expected-99', 'ag-audit', 'proj-audit', 'running', 1, 1)`);
    db.execute(`INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at) VALUES ('run-different-12', 'ag-audit', 'proj-audit', 'running', 1, 1)`);
  });

  afterEach(() => {
    if (db && !db.closed) {
      db.close();
    }
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    } catch {}
  });

  // NEW-01: Task completion accepting unverified evidence
  describe('NEW-01: Verifiable Evidence Gate on Task Completion', () => {
    it('rejects task completion when evidence record does not exist', () => {
      taskRepo.createTask({
        id: 't-test-1',
        goalId: 'goal-audit',
        title: 'Task 1',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      expect(() => {
        taskRepo.completeTask('t-test-1', 'ev-non-existent');
      }).toThrow(/Evidence record 'ev-non-existent' not found/);
    });

    it('rejects task completion when evidence record is unverified (verified = 0)', () => {
      taskRepo.createTask({
        id: 't-test-2',
        goalId: 'goal-audit',
        title: 'Task 2',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-unverified', 't-test-2', 'run-1', 'artifact_hash', 'sha256:abcdef0123456789', 0, ?)`,
        Date.now()
      );

      expect(() => {
        taskRepo.completeTask('t-test-2', 'ev-unverified');
      }).toThrow(/is unverified \(verified = 0\)/);
    });

    it('rejects task completion when evidence record belongs to a different task', () => {
      taskRepo.createTask({
        id: 't-test-3',
        goalId: 'goal-audit',
        title: 'Task 3',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      taskRepo.createTask({
        id: 't-other-task',
        goalId: 'goal-audit',
        title: 'Other Task',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-diff-task', 't-other-task', 'run-1', 'artifact_hash', 'sha256:abcdef0123456789', 1, ?)`,
        Date.now()
      );

      expect(() => {
        taskRepo.completeTask('t-test-3', 'ev-diff-task');
      }).toThrow(/belongs to task 't-other-task', not 't-test-3'/);
    });

    it('rejects task completion when evidence record run_id does not match expected run_id', () => {
      taskRepo.createTask({
        id: 't-test-4',
        goalId: 'goal-audit',
        title: 'Task 4',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-diff-run', 't-test-4', 'run-expected-99', 'artifact_hash', 'sha256:abcdef0123456789', 1, ?)`,
        Date.now()
      );

      expect(() => {
        taskRepo.completeTask('t-test-4', 'ev-diff-run', 'run-different-12');
      }).toThrow(/belongs to run 'run-expected-99', not expected run 'run-different-12'/);
    });



    it('rejects task completion when artifact hash URI is empty or malformed', () => {
      taskRepo.createTask({
        id: 't-test-5',
        goalId: 'goal-audit',
        title: 'Task 5',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-bad-uri', 't-test-5', 'run-1', 'artifact_hash', 'invalid_uri_format', 1, ?)`,
        Date.now()
      );

      expect(() => {
        taskRepo.completeTask('t-test-5', 'ev-bad-uri');
      }).toThrow(/contains invalid artifact proof URI/);
    });

    it('successfully completes task when evidence is verified and matches task and run', () => {
      taskRepo.createTask({
        id: 't-test-6',
        goalId: 'goal-audit',
        title: 'Task 6',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-valid-6', 't-test-6', 'run-6', 'artifact_hash', 'git://commit/a1b2c3d4e5f6', 1, ?)`,
        Date.now()
      );

      const promoted = taskRepo.completeTask('t-test-6', 'ev-valid-6', 'run-6');
      expect(promoted).toBeDefined();

      const task = taskRepo.getTask('t-test-6');
      expect(task?.status).toBe('completed');
      expect(task?.evidenceBundleId).toBe('ev-valid-6');
    });
  });

  // NEW-02: Manual task status completion eliminates synthetic sign-off
  describe('NEW-02: Task Status Sign-Off Gate', () => {
    it('requires verified evidenceId or explicit operator signoff', () => {
      taskRepo.createTask({
        id: 't-signoff-1',
        goalId: 'goal-audit',
        title: 'Signoff Task',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Directly verify TaskRepository completeTask requires valid verified evidence
      expect(() => taskRepo.completeTask('t-signoff-1', 'nonexistent-ev')).toThrow();
    });

    it('disallows manual transition to running status without worker lease', async () => {
      taskRepo.createTask({
        id: 't-manual-running',
        goalId: 'goal-audit',
        title: 'Ready Task',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const server = new CoreServer({ port: 0, dbPath });
      const port = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/tasks/t-manual-running/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'running' }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain('Cannot manually force task to running status');
      } finally {
        await server.stop();
      }
    });
  });

  // NEW-04: Approval parameter digest binding
  describe('NEW-04: Parameter Digest Binding in Approvals', () => {
    it('binds approval token to exact action parameters and verifies matching digest', () => {
      const sentinel = Sentinel.getInstance();
      const gateway = new ToolGateway({ db });

      const toolName = 'executeShell';
      const runId = 'run-sec-test';
      const exactParams = { command: 'npm test', cwd: '/workspace' };

      const token = gateway.generateApprovalToken(toolName, runId, 60000, exactParams);
      expect(token).toBeDefined();

      // Consuming with matching parameters must succeed
      const allowed = sentinel.consumeApprovalToken(token, toolName, runId, exactParams);
      expect(allowed).toBe(true);
    });

    it('rejects approval token when execution parameters differ from approved parameters', () => {
      const sentinel = Sentinel.getInstance();
      const gateway = new ToolGateway({ db });

      const toolName = 'executeShell';
      const runId = 'run-sec-drift';
      const approvedParams = { command: 'ls -la', cwd: '/safe' };
      const driftedParams = { command: 'rm -rf /', cwd: '/danger' };

      const token = gateway.generateApprovalToken(toolName, runId, 60000, approvedParams);

      // Consuming with mutated parameters must be rejected
      const allowed = sentinel.consumeApprovalToken(token, toolName, runId, driftedParams);
      expect(allowed).toBe(false);
    });
  });

  // NEW-05: Direct desktop routes evaluate matching toolName and params
  describe('NEW-05: Direct Desktop Route Action Alignment', () => {
    it('Sentinel evaluates desktopLaunchApp with matching parameter structure', () => {
      const sentinel = Sentinel.getInstance();
      const decision = sentinel.evaluate({
        agentId: 'operator',
        toolName: 'desktopLaunchApp',
        params: { appNameOrPath: 'notepad.exe', args: [] },
        riskLevel: 'MEDIUM',
        autonomyMode: 'FULL_ACCESS',
        agentCapabilities: ['*'],
      });

      expect(decision.allowed).toBe(true);
    });

    it('Sentinel evaluates desktop interact actions with specific action names and params', () => {
      const sentinel = Sentinel.getInstance();

      const clickDecision = sentinel.evaluate({
        agentId: 'operator',
        toolName: 'desktopMouseClick',
        params: { x: 100, y: 200, button: 'left', doubleClick: false },
        riskLevel: 'MEDIUM',
        autonomyMode: 'FULL_ACCESS',
        agentCapabilities: ['*'],
      });
      expect(clickDecision.allowed).toBe(true);

      const typeDecision = sentinel.evaluate({
        agentId: 'operator',
        toolName: 'desktopType',
        params: { text: 'hello world' },
        riskLevel: 'MEDIUM',
        autonomyMode: 'FULL_ACCESS',
        agentCapabilities: ['*'],
      });
      expect(typeDecision.allowed).toBe(true);

      const keyDecision = sentinel.evaluate({
        agentId: 'operator',
        toolName: 'desktopSendKey',
        params: { key: 'enter', modifiers: [] },
        riskLevel: 'MEDIUM',
        autonomyMode: 'FULL_ACCESS',
        agentCapabilities: ['*'],
      });
      expect(keyDecision.allowed).toBe(true);
    });
  });

  // NEW-06: Startup queue dispatch
  describe('NEW-06: Startup Queue Admission & Dispatch', () => {
    it('admitNextQueuedRun transitions queued run to running for dispatch', () => {
      const kernel = new AgentKernel(db);

      db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
         VALUES ('run-queued-boot', 'ag-audit', 'proj-audit', 'queued', ?, 100000, 0, ?)`,
        Date.now(),
        Date.now()
      );

      const admitted = kernel.admitNextQueuedRun();
      expect(admitted).toBeDefined();
      expect(admitted?.id).toBe('run-queued-boot');
      expect(admitted?.state).toBe('running');
    });

    it('dispatchQueuedRunsStartup dispatches queued run without throwing when triggerMessageId is missing', () => {
      const server = new CoreServer({ port: 0, dbPath });
      db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
         VALUES ('run-queued-notrigger', 'ag-audit', 'proj-audit', 'queued', ?, 100000, 0, ?)`,
        Date.now(),
        Date.now()
      );

      // Calling dispatchQueuedRunsStartup directly should not throw
      expect(() => {
        (server as any).dispatchQueuedRunsStartup();
      }).not.toThrow();

      const run = (server as any).kernel.getRun('run-queued-notrigger');
      expect(run?.state).toBe('running');
    });
  });

  // NEW-07 & NEW-08: Truthful model readiness and catalog discovery
  describe('NEW-07 & NEW-08: Model Provider Readiness & Filtering', () => {
    it('reports unverified/offline for Ollama when daemon is not reachable', async () => {
      const gateway = new ModelGateway();
      // Configure an unreachable local port
      (gateway as any).ollamaHost = 'http://127.0.0.1:59999';

      const readiness = await gateway.checkProviderReadiness('ollama');
      expect(readiness.provider).toBe('ollama');
      expect(readiness.validated).toBe(false);
      expect(readiness.modelCount).toBe(0);
      expect(readiness.message).toContain('unreachable');
    });

    it('fetchProviderModels returns empty list for unreachable Ollama without fake models', async () => {
      const gateway = new ModelGateway();
      (gateway as any).ollamaHost = 'http://127.0.0.1:59999';

      const models = await gateway.fetchProviderModels('ollama');
      expect(models).toEqual([]);
    });

    it('getProviderReadiness distinguishes configured API key vs validated network reachability', () => {
      const gateway = new ModelGateway();
      const readiness = gateway.getProviderReadiness('openai');
      expect(readiness.provider).toBe('openai');
      // No key configured in test environment
      expect(readiness.configured).toBe(false);
      expect(readiness.validated).toBe(false);
    });
  });

  // NEW-10: Authoritative EventLedger
  describe('NEW-10: EventLedger Initialization and Authoritative Recording', () => {
    it('records sanitized events into event_journal table', () => {
      const ledger = EventLedger.ensureInitialized(db);
      expect(EventLedger.isInitialized()).toBe(true);

      const eventId = ledger.record({
        eventType: 'TASK_CREATED',
        entityType: 'task',
        entityId: 'task-audit-10',
        payload: {
          title: 'Secure Task',
          apiKey: 'sk-ant-test-secret-value-should-be-masked',
        },
      });

      expect(eventId).toBeGreaterThan(0);

      const row = db.queryOne<{ event_type: string; payload_json: string }>(
        'SELECT event_type, payload_json FROM event_journal WHERE id = ?',
        eventId
      );

      expect(row?.event_type).toBe('TASK_CREATED');
      expect(row?.payload_json).not.toContain('sk-ant-test-secret-value');
      expect(row?.payload_json).toContain('[REDACTED]');
    });
  });

  // NEW-15: Version consistency across workspace
  describe('NEW-15: Release Version Reconciliation', () => {
    it('ensures root and workspace package.json versions are aligned to 0.1.0', () => {
      const rootPkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../package.json'), 'utf-8'));
      const corePkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
      const uiPkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../ui/package.json'), 'utf-8'));

      expect(rootPkg.version).toBe('0.1.0');
      expect(corePkg.version).toBe('0.1.0');
      expect(uiPkg.version).toBe('0.1.0');
    });
  });

  // NEW-16 & Invariant Check: Banned Words
  describe('NEW-16 & Invariant: Banned Terms Scan Across Documentation', () => {
    it('verifies docs contain zero banned words', () => {
      const docsDir = path.resolve(process.cwd(), '../docs');
      if (!fs.existsSync(docsDir)) return;

      const banned = ['operating system', 'guarantee', '100%', 'bulletproof'];
      const scan = (dir: string) => {
        for (const file of fs.readdirSync(dir)) {
          const full = path.join(dir, file);
          if (fs.statSync(full).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'assets') scan(full);
          } else if (file.endsWith('.md')) {
            const content = fs.readFileSync(full, 'utf-8');
            for (const phrase of banned) {
              expect(content.toLowerCase()).not.toContain(phrase.toLowerCase());
            }
            expect(content).not.toMatch(/\bos\b/i);
          }
        }
      };
      scan(docsDir);
    });
  });
});
