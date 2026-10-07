import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { Sentinel } from '../src/security/sentinel.js';
import { SecretBroker } from '../src/security/secret_broker.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { ModelGateway } from '../src/execution/model_gateway.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { WorktreeManager } from '../src/execution/worktree_manager.js';
import { CoreServer } from '../src/server/core_server.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as nodeOs from 'node:os';
import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';

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
      const headSha = childProcess.execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
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
         VALUES ('ev-valid-6', 't-test-6', 'run-6', 'artifact_hash', ?, 1, ?)`,
        `git://commit/${headSha}`,
        Date.now()
      );

      const promoted = taskRepo.completeTask('t-test-6', 'ev-valid-6', 'run-6');
      expect(promoted).toBeDefined();

      const task = taskRepo.getTask('t-test-6');
      expect(task?.status).toBe('completed');
      expect(task?.evidenceBundleId).toBe('ev-valid-6');
    });

    it('rejects nonexistent git commit SHA and leaves task in review status', () => {
      taskRepo.createTask({
        id: 't-fake-sha',
        goalId: 'goal-audit',
        title: 'Fake SHA Task',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-fake-sha', 't-fake-sha', 'run-6', 'artifact_hash', 'git://commit/0000000000000000000000000000000000000000', 1, ?)`,
        Date.now()
      );

      expect(() => taskRepo.completeTask('t-fake-sha', 'ev-fake-sha', 'run-6')).toThrow(/does not exist/);
      const task = taskRepo.getTask('t-fake-sha');
      expect(task?.status).toBe('review');
    });

    it('rejects nonexistent file:// URI and leaves task in review status', () => {
      taskRepo.createTask({
        id: 't-fake-file',
        goalId: 'goal-audit',
        title: 'Fake File Task',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-fake-file', 't-fake-file', 'run-6', 'artifact_hash', 'file:///nonexistent/artifact/path/file.txt', 1, ?)`,
        Date.now()
      );

      expect(() => taskRepo.completeTask('t-fake-file', 'ev-fake-file', 'run-6')).toThrow(/does not exist on disk/);
      const task = taskRepo.getTask('t-fake-file');
      expect(task?.status).toBe('review');
    });

    it('rejects task completion when evidence record has unrecognized type and leaves task in review status', () => {
      taskRepo.createTask({
        id: 't-unrecognized-type',
        goalId: 'goal-audit',
        title: 'Unrecognized Type Task',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Mock queryOne to simulate unrecognized type record bypassing SQLite CHECK constraint
      const origQueryOne = (taskRepo as any).db.queryOne.bind((taskRepo as any).db);
      const querySpy = vi.spyOn((taskRepo as any).db, 'queryOne').mockImplementation((sql: string, ...params: any[]) => {
        if (typeof sql === 'string' && sql.includes('FROM evidence WHERE id = ?') && params[0] === 'ev-unknown-type') {
          return {
            id: 'ev-unknown-type',
            task_id: 't-unrecognized-type',
            run_id: 'run-6',
            type: 'unrecognized_type',
            content_uri: 'file:///tmp/artifact.txt',
            verified: 1,
          };
        }
        return origQueryOne(sql, ...params);
      });

      try {
        expect(() => taskRepo.completeTask('t-unrecognized-type', 'ev-unknown-type', 'run-6')).toThrow(/unrecognized evidence type/);
        const task = taskRepo.getTask('t-unrecognized-type');
        expect(task?.status).toBe('review');
      } finally {
        querySpy.mockRestore();
      }
    });

    it('rejects task completion when evidence type does not match verificationSpec expectedArtifactType and leaves task in review', () => {
      taskRepo.createTask({
        id: 't-mismatch-spec',
        goalId: 'goal-audit',
        title: 'Mismatch Spec Task',
        status: 'running',
        verificationSpec: { expectedArtifactType: 'test_output' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const headSha = childProcess.execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-mismatch-spec', 't-mismatch-spec', 'run-6', 'artifact_hash', ?, 1, ?)`,
        `git://commit/${headSha}`,
        Date.now()
      );

      expect(() => taskRepo.completeTask('t-mismatch-spec', 'ev-mismatch-spec', 'run-6')).toThrow(/does not match expected artifact type/);
      const task = taskRepo.getTask('t-mismatch-spec');
      expect(task?.status).toBe('review');
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

    it('PATCH /api/tasks/:id/status requires valid IPC token and signature for manual completion', async () => {
      taskRepo.createTask({
        id: 't-manual-signoff',
        goalId: 'goal-audit',
        title: 'Manual Signoff Task',
        status: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const server = new CoreServer({ port: 0, dbPath });
      const port = await server.start();
      try {
        // 1. Missing Authorization header -> 401
        const resNoAuth = await fetch(`http://127.0.0.1:${port}/api/tasks/t-manual-signoff/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        });
        expect(resNoAuth.status).toBe(401);

        // 2. Invalid Bearer token -> 403
        const resBadAuth = await fetch(`http://127.0.0.1:${port}/api/tasks/t-manual-signoff/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer bad-token',
          },
          body: JSON.stringify({ status: 'completed' }),
        });
        expect(resBadAuth.status).toBe(403);

        // 3. Valid IPC token with operator signature -> 200
        const ipcToken = (server as any).ipcAuthToken;
        const operatorSig = crypto.createHmac('sha256', ipcToken).update('t-manual-signoff:completed').digest('hex');
        const resValid = await fetch(`http://127.0.0.1:${port}/api/tasks/t-manual-signoff/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ipcToken}`,
            'x-kin-operator-signature': operatorSig,
          },
          body: JSON.stringify({ status: 'completed', signoffNotes: 'Verified by operator' }),
        });
        expect(resValid.status).toBe(200);

        // 4. Even when evidenceId is passed in body, manual status change without valid IPC token must be rejected with 401
        const resWithEvNoAuth = await fetch(`http://127.0.0.1:${port}/api/tasks/t-manual-signoff/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', evidenceId: 'ev-test-123' }),
        });
        expect(resWithEvNoAuth.status).toBe(401);
      } finally {
        await server.stop();
      }
    });
  });

  // NEW-03: Worktree merge error transitions task to blocked and run to failed
  describe('NEW-03: Worktree Merge Failure State Handling', () => {
    it('transitions task to blocked and run to failed when verifyAndMerge fails', async () => {
      const server = new CoreServer({ port: 0, dbPath });

      // Ensure test channel exists
      db.execute(
        `INSERT OR IGNORE INTO channels (id, project_id, name, created_at)
         VALUES ('chan-audit', 'proj-audit', 'audit-channel', 1)`
      );
      db.execute(
        `INSERT OR IGNORE INTO channel_members (channel_id, agent_id, joined_at)
         VALUES ('chan-audit', 'ag-audit', 1)`
      );

      taskRepo.createTask({
        id: 't-merge-fail',
        goalId: 'goal-audit',
        title: 'Merge Fail Task',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const spyProvision = vi.spyOn(WorktreeManager.prototype, 'provisionWorktree').mockResolvedValue({
        worktreePath: path.join(nodeOs.tmpdir(), 'wt-test-conflict-sim'),
        branch: 'kin-worker-test',
        isShadowRepo: false,
      });
      const spyDiff = vi.spyOn(WorktreeManager.prototype, 'generateDiff').mockResolvedValue('diff --git a/a.txt b/a.txt');
      const spyCommit = vi.spyOn(WorktreeManager.prototype, 'commitWorktreeChanges').mockResolvedValue('mock-commit-sha-789');
      const spyMerge = vi.spyOn(WorktreeManager.prototype, 'verifyAndMerge').mockResolvedValue({
        success: false,
        cleanMerge: false,
        error: 'Merge conflict detected in base branch',
      });
      const spyLoop = vi.spyOn((server as any).agentLoopRunner, 'execute').mockResolvedValue({
        finalContent: 'Code changes ready for merge',
        turnCount: 1,
        actions: [],
      });

      try {
        const agent = (server as any).agentRepo.getIdentity('ag-audit');
        await (server as any).executeAgentResponse(
          agent,
          'chan-audit',
          { id: 'msg-merge-fail', content: 'Implement coding task', taskId: 't-merge-fail' }
        );

        const updatedTask = taskRepo.getTask('t-merge-fail');
        expect(updatedTask?.status).toBe('blocked');
        expect(updatedTask?.claimedByRunId).toBeUndefined();

        const runs = db.query<{ id: string; state: string }>(
          `SELECT id, state FROM agent_runs WHERE task_id = 't-merge-fail' ORDER BY created_at DESC`
        );
        expect(runs.length).toBeGreaterThan(0);
        expect(runs[0].state).toBe('failed');

        const events = db.query<{ payload_json: string }>(
          `SELECT payload_json FROM event_journal WHERE entity_id = 't-merge-fail' AND event_type = 'TASK_BLOCKED'`
        );
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].payload_json).toContain('Merge conflict detected in base branch');
      } finally {
        spyProvision.mockRestore();
        spyDiff.mockRestore();
        spyCommit.mockRestore();
        spyMerge.mockRestore();
        spyLoop.mockRestore();
      }
    });
  });

  // NEW-04: Approval parameter digest binding
  describe('NEW-04: Parameter Digest Binding in Approvals', () => {
    it('evaluates direct HTTP terminal route with and without x-kin-approval-token', async () => {
      const server = new CoreServer({ port: 0, dbPath });
      const port = await server.start();
      try {
        const testCmd = 'rm -rf test-audit-nonexistent-dir-12345';
        const workingDir = process.cwd();
        const resNoToken = await fetch(`http://127.0.0.1:${port}/api/system/terminal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: testCmd, cwd: workingDir }),
        });
        expect(resNoToken.status).toBe(428);
        const dataNoToken = await resNoToken.json();
        expect(dataNoToken.requiresApproval).toBe(true);
        expect(dataNoToken.approvalId).toBeDefined();

        const token = (server as any).toolGateway.generateApprovalToken(
          'executeShell',
          undefined,
          60000,
          { command: testCmd, cwd: workingDir }
        );

        // Consuming with drifted parameters over HTTP must be rejected
        const resDrifted = await fetch(`http://127.0.0.1:${port}/api/system/terminal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-kin-approval-token': token,
          },
          body: JSON.stringify({ command: 'rm -rf /unauthorized', cwd: workingDir }),
        });
        expect(resDrifted.status).toBe(428);
        const dataDrifted = await resDrifted.json();
        expect(dataDrifted.requiresApproval).toBe(true);

        // Consuming with matching parameters over HTTP must succeed
        const resWithToken = await fetch(`http://127.0.0.1:${port}/api/system/terminal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-kin-approval-token': token,
          },
          body: JSON.stringify({ command: testCmd, cwd: workingDir }),
        });
        expect(resWithToken.status).toBe(200);
      } finally {
        await server.stop();
      }
    });
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
