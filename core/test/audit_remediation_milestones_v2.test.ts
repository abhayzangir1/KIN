import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { SecretBroker } from '../src/security/secret_broker.js';
import { SecretVault } from '../src/security/secret_vault.js';
import { Sentinel } from '../src/security/sentinel.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { AsyncMutex } from '../src/execution/worktree_manager.js';
import { OutputSpiller } from '../src/context/output_spiller.js';
import { ActivationEngine } from '../src/communication/activation_engine.js';
import { SkillEngine, Skill } from '../src/skills/skill_engine.js';
import { AgentLoopRunner } from '../src/kernel/agent_loop.js';
import { CoreServer } from '../src/server/core_server.js';
import { AgentIdentity, Task } from '../src/domain/types.js';

describe('KIN Comprehensive Audit Remediation Verification (V2)', () => {
  let db: KinDatabase;
  let dbPath: string;

  const tempDir = process.env.TEMP || process.env.TMP || '/tmp';

  beforeEach(() => {
    dbPath = path.join(tempDir, `kin_v2_audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sqlite`);
    db = new KinDatabase(dbPath);
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

  // ==========================================================================
  // 1. Storage Migrations & Identity Verification
  // ==========================================================================
  describe('1. Storage Layer & Migrations', () => {
    it('preserves model_id across agent_runs table recreation and sets default project', () => {
      // Create legacy database tables without quota_paused and without project_id in agent_identities
      db.exec(`
        CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL, default_autonomy_mode TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, repo_path TEXT NOT NULL, settings_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE agent_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, system_prompt TEXT NOT NULL, default_model_id TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE agent_identities (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), definition_id TEXT NOT NULL REFERENCES agent_definitions(id), display_name TEXT NOT NULL, active_model_id TEXT NOT NULL, is_orchestrator INTEGER NOT NULL, is_ephemeral INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE channels (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, topic TEXT, is_private INTEGER NOT NULL DEFAULT 0, channel_type TEXT NOT NULL DEFAULT 'group', participant_ids_json TEXT, created_at INTEGER NOT NULL);
        CREATE TABLE agent_runs (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agent_identities(id),
          project_id TEXT REFERENCES projects(id),
          parent_run_id TEXT REFERENCES agent_runs(id),
          task_id TEXT,
          channel_id TEXT REFERENCES channels(id),
          trigger_message_id TEXT,
          state TEXT NOT NULL CHECK (state IN ('created', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
          worktree_path TEXT,
          heartbeat_at INTEGER NOT NULL,
          allocated_tokens INTEGER NOT NULL DEFAULT 0,
          used_tokens INTEGER NOT NULL DEFAULT 0,
          model_id TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        );
      `);

      db.execute(`INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-1', 'WS 1', '.', 'AUTO', 1, 1)`);
      db.execute(`INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-1', 'Def 1', 'Worker', 'Prompt', 'ollama/llama3', 1)`);
      db.execute(`INSERT INTO agent_identities (id, workspace_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at) VALUES ('ag-1', 'ws-1', 'def-1', 'Agent 1', 'ollama/llama3', 0, 0, 1, 1)`);
      db.execute(`INSERT INTO agent_runs (id, agent_id, state, heartbeat_at, allocated_tokens, used_tokens, model_id, created_at) VALUES ('run-1', 'ag-1', 'running', 100, 1000, 50, 'custom-deepseek-r1', 1)`);

      // Run migrations
      const migrator = new MigrationRunner(db);
      migrator.runMigrations();

      // Verify agent_runs model_id was preserved
      const run = db.queryOne<{ id: string; model_id: string; state: string }>(
        'SELECT id, model_id, state FROM agent_runs WHERE id = ?',
        'run-1'
      );
      expect(run).toBeDefined();
      expect(run?.model_id).toBe('custom-deepseek-r1');
      expect(run?.state).toBe('running');

      // Verify default project proj-kin was created and agent identity updated
      const defaultProject = db.queryOne<{ id: string }>(
        "SELECT id FROM projects WHERE id = 'proj-kin'"
      );
      expect(defaultProject).toBeDefined();

      const identity = db.queryOne<{ id: string; project_id: string }>(
        'SELECT id, project_id FROM agent_identities WHERE id = ?',
        'ag-1'
      );
      expect(identity?.project_id).toBe('proj-kin');
    });

    it('ensureProjectBoss strictly checks isOrchestrator true to prevent identity spoofing', () => {
      const migrator = new MigrationRunner(db);
      migrator.runMigrations();

      const agentRepo = new AgentRepository(db);
      db.execute(`INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-boss', 'WS Boss', '.', 'AUTO', 1, 1)`);
      db.execute(`INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('proj-boss', 'ws-boss', 'Proj Boss', '.', '{}', 1, 1)`);

      // Seed a regular agent with isOrchestrator = 0
      db.execute(`INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-impostor', 'Boss', 'Worker', 'Prompt', 'ollama/llama3', 1)`);
      db.execute(`INSERT INTO agent_identities (id, workspace_id, definition_id, project_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at) VALUES ('ag-impostor', 'ws-boss', 'def-impostor', 'proj-boss', '@Impostor', 'ollama/llama3', 0, 0, 1, 1)`);

      // ensureProjectBoss must NOT return the non-orchestrator agent, and must create genuine @Boss
      const genuineBoss = agentRepo.ensureProjectBoss('proj-boss', 'ws-boss');
      expect(genuineBoss.isOrchestrator).toBe(true);
      expect(genuineBoss.displayName).toBe('@Boss');
      expect(genuineBoss.id).not.toBe('ag-impostor');
    });
  });

  // ==========================================================================
  // 2. Task Concurrency, Strict Claiming & Fencing
  // ==========================================================================
  describe('2. Task Concurrency & Fencing', () => {
    let taskRepo: TaskRepository;

    beforeEach(() => {
      const migrator = new MigrationRunner(db);
      migrator.runMigrations();
      EventLedger.ensureInitialized(db);
      taskRepo = new TaskRepository(db);

      db.execute(`INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-task', 'WS Task', '.', 'AUTO', 1, 1)`);
      db.execute(`INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('proj-task', 'ws-task', 'Proj Task', '.', '{}', 1, 1)`);
      db.execute(`INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at) VALUES ('goal-task', 'proj-task', 'Goal Task', 'Desc', '[]', 'active', 1, 1)`);
      db.execute(`INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-task', 'Def Task', 'Worker', 'Prompt', 'ollama/llama3', 1)`);
      db.execute(`INSERT INTO agent_identities (id, workspace_id, definition_id, project_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at) VALUES ('ag-worker', 'ws-task', 'def-task', 'proj-task', 'Worker', 'ollama/llama3', 0, 0, 1, 1)`);
      db.execute(`INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at) VALUES ('run-active', 'ag-worker', 'proj-task', 'running', 100, 1000, 50, 1)`);
      db.execute(`INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at) VALUES ('run-rival', 'ag-worker', 'proj-task', 'running', 100, 1000, 50, 1)`);
    });

    it('strictly rejects task claims on backlog tasks', () => {
      const task: Task = {
        id: 'task-backlog-1',
        goalId: 'goal-task',
        title: 'Backlog Item',
        description: 'Waiting for upstream prerequisites',
        assignedAgentId: 'ag-worker',
        status: 'backlog',
        createdAt: 1,
        updatedAt: 1,
      };
      taskRepo.createTask(task);

      // Attempting to claim backlog task must return false
      const claimed = taskRepo.claimTaskWithLease('task-backlog-1', 'ag-worker', 'run-active', 60000);
      expect(claimed).toBe(false);

      const refreshed = taskRepo.getTask('task-backlog-1');
      expect(refreshed?.status).toBe('backlog');
      expect(refreshed?.claimedByRunId).toBeUndefined();
    });

    it('allows re-leasing by the same active run upon approval resumption within active lease window', () => {
      const task: Task = {
        id: 'task-interactive-1',
        goalId: 'goal-task',
        title: 'Interactive Task',
        description: 'Requires operator approval halfway',
        assignedAgentId: 'ag-worker',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      };
      taskRepo.createTask(task);

      // Initial claim succeeds
      const firstClaim = taskRepo.claimTaskWithLease('task-interactive-1', 'ag-worker', 'run-active', 30000);
      expect(firstClaim).toBe(true);

      const runningTask = taskRepo.getTask('task-interactive-1');
      expect(runningTask?.status).toBe('running');
      expect(runningTask?.claimedByRunId).toBe('run-active');

      // A rival run cannot steal the task while lease is active
      const rivalClaim = taskRepo.claimTaskWithLease('task-interactive-1', 'ag-worker', 'run-rival', 30000);
      expect(rivalClaim).toBe(false);

      // The same run resuming execution CAN re-acquire and refresh the lease
      const resumeClaim = taskRepo.claimTaskWithLease('task-interactive-1', 'ag-worker', 'run-active', 60000);
      expect(resumeClaim).toBe(true);

      const resumedTask = taskRepo.getTask('task-interactive-1');
      expect(resumedTask?.status).toBe('running');
      expect(resumedTask?.claimedByRunId).toBe('run-active');
    });

    it('fences task evidence failure updates so stale runs cannot demote active rival claims', () => {
      const task: Task = {
        id: 'task-fenced-1',
        goalId: 'goal-task',
        title: 'Fenced Task',
        description: 'Validating review demotion fencing',
        assignedAgentId: 'ag-worker',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      };
      taskRepo.createTask(task);

      // Claimed by run-active
      taskRepo.claimTaskWithLease('task-fenced-1', 'ag-worker', 'run-active', 60000);

      // Suppose rival took over the claim:
      db.execute(`UPDATE tasks SET claimed_by_run_id = 'run-rival' WHERE id = ?`, 'task-fenced-1');

      // Old run-active calls completeTask with invalid evidence
      expect(() => {
        taskRepo.completeTask('task-fenced-1', 'non-existent-evidence', 'run-active');
      }).toThrow();

      // Task must remain assigned to run-rival in running status, not demoted to review
      const currentTask = taskRepo.getTask('task-fenced-1');
      expect(currentTask?.claimedByRunId).toBe('run-rival');
      expect(currentTask?.status).toBe('running');

      // Also test with existing evidence record of type artifact_hash that fails validation (missing file)
      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-bad-artifact', 'task-fenced-1', 'run-active', 'artifact_hash', 'file:///nonexistent/artifact.txt', 1, 100)`
      );
      expect(() => {
        taskRepo.completeTask('task-fenced-1', 'ev-bad-artifact', 'run-active');
      }).toThrow();

      const taskAfterArtifactFailure = taskRepo.getTask('task-fenced-1');
      expect(taskAfterArtifactFailure?.claimedByRunId).toBe('run-rival');
      expect(taskAfterArtifactFailure?.status).toBe('running');
    });

    it('wraps task completion and dependent task promotion atomically', () => {
      const t1: Task = {
        id: 'task-a',
        goalId: 'goal-task',
        title: 'Task A',
        description: 'First prerequisite',
        assignedAgentId: 'ag-worker',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      };
      const t2: Task = {
        id: 'task-b',
        goalId: 'goal-task',
        title: 'Task B',
        description: 'Second depends on A',
        assignedAgentId: 'ag-worker',
        status: 'backlog',
        createdAt: 1,
        updatedAt: 1,
      };
      taskRepo.createTask(t1);
      taskRepo.createTask(t2, [t1.id]);

      taskRepo.claimTaskWithLease(t1.id, 'ag-worker', 'run-active', 60000);

      const evidenceFile = path.join(tempDir, `evidence_${Date.now()}.txt`);
      fs.writeFileSync(evidenceFile, 'Verification test passed successfully', 'utf-8');
      const evidenceUri = `file:///${evidenceFile.replace(/\\/g, '/')}`;

      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES ('ev-t1', ?, 'run-active', 'test_output', ?, 1, 100)`,
        t1.id,
        evidenceUri
      );

      const promoted = taskRepo.completeTask(t1.id, 'ev-t1', 'run-active');
      expect(promoted).toContain(t2.id);

      const finishedT1 = taskRepo.getTask(t1.id);
      const promotedT2 = taskRepo.getTask(t2.id);
      expect(finishedT1?.status).toBe('completed');
      expect(promotedT2?.status).toBe('ready');
    });
  });

  // ==========================================================================
  // 3. Execution Security & Sentinel Grants
  // ==========================================================================
  describe('3. Execution Security & Sentinel', () => {
    let sentinel: Sentinel;
    let secretVault: SecretVault;
    let secretBroker: SecretBroker;

    beforeEach(() => {
      const migrator = new MigrationRunner(db);
      migrator.runMigrations();
      EventLedger.ensureInitialized(db);

      secretVault = new SecretVault(path.join(tempDir, `test_vault_${Date.now()}.key`));
      secretBroker = new SecretBroker(secretVault);
      secretBroker.setDatabase(db);
      sentinel = Sentinel.getInstance();
      (sentinel as any).secretBroker = secretBroker;

      const encryptedSecret = secretVault.encrypt('SECRET_API_TOKEN_VALUE');
      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, scoped_grants_json, created_at, updated_at)
         VALUES ('cred-1', 'custom', 'DEPLOY_KEY', ?, '["ag-allowed"]', 1, 1)`,
        encryptedSecret
      );
    });

    it('enforces scoped_grants_json against agentId in Sentinel placeholder evaluation', () => {
      // Authorized agent gets decrypted secret
      const evalAllowed = sentinel.evaluate({
        agentId: 'ag-allowed',
        toolName: 'execute_command',
        params: { command: 'deploy --key={{vault:DEPLOY_KEY}}' },
        autonomyMode: 'FULL_AUTONOMOUS',
        agentCapabilities: ['*'],
      });

      expect(evalAllowed.allowed).toBe(true);
      expect(evalAllowed.sanitizedParams.command).toBe('deploy --key=SECRET_API_TOKEN_VALUE');

      // Unauthorized agent gets denied marker
      const evalDenied = sentinel.evaluate({
        agentId: 'ag-unauthorized',
        toolName: 'execute_command',
        params: { command: 'deploy --key={{vault:DEPLOY_KEY}}' },
        autonomyMode: 'FULL_AUTONOMOUS',
        agentCapabilities: ['*'],
      });

      expect(evalDenied.allowed).toBe(true);
      expect(evalDenied.sanitizedParams.command).toContain('[DENIED_UNAUTHORIZED_KEY_ACCESS:DEPLOY_KEY]');
      expect(evalDenied.sanitizedParams.command).not.toContain('SECRET_API_TOKEN_VALUE');
    });

    it('prevents single-use approval token replay in Sentinel and ToolGateway', () => {
      const gateway = new ToolGateway({ db });
      const token = gateway.generateApprovalToken('git_push', 'run-test', 60000, { branch: 'main' });

      // First consumption succeeds
      const firstCheck = gateway.consumeApprovalToken(token, 'git_push', 'run-test', { branch: 'main' });
      expect(firstCheck).toBe(true);

      // Replay attempt fails
      const secondCheck = gateway.consumeApprovalToken(token, 'git_push', 'run-test', { branch: 'main' });
      expect(secondCheck).toBe(false);
    });
  });

  // ==========================================================================
  // 4. Server IPC Authentication & Origin Header Spoofing
  // ==========================================================================
  describe('4. Server IPC Authentication', () => {
    it('rejects requests with spoofed Origin headers when IPC token is missing', async () => {
      const server = new CoreServer({ port: 0, dbPath, requireIpcAuth: true });
      const port = await server.start();
      try {
        // Request without token but with spoofed Origin returns 401
        const resSpoofed = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
          headers: {
            Origin: 'http://localhost:5173',
            Referer: 'http://localhost:5173',
          },
        });
        expect(resSpoofed.status).toBe(401);

        // Request with valid IPC token succeeds
        const token = (server as any).ipcAuthToken;
        const resValid = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        expect(resValid.status).not.toBe(401);
      } finally {
        await server.stop();
      }
    });
  });

  // ==========================================================================
  // 5. Context Spill, read_spill Visibility & Execution
  // ==========================================================================
  describe('5. Context Spill & read_spill Tool', () => {
    beforeEach(() => {
      new MigrationRunner(db).runMigrations();
    });

    it('instructs agent to use read_spill and retrieves spilled content by hash', () => {
      const spillDir = path.join(tempDir, `spill_test_${Date.now()}`);
      const spiller = new OutputSpiller({ spillDir, thresholdBytes: 100 });
      const hugeOutput = 'LARGE_PAYLOAD_'.repeat(500);

      const spillResult = spiller.processOutput(hugeOutput, 'cmd-1');
      expect(spillResult.isSpilled).toBe(true);
      expect(spillResult.content).toContain('read_spill');
      expect(spillResult.hash).toBeDefined();

      const recovered = spiller.readSpillFile(spillResult.hash!);
      expect(recovered).toBe(hugeOutput);
    });

    it('buildSystemPrompt includes read_spill tool schema and usage instructions', () => {
      const gateway = new ToolGateway({ db });
      const loop = new AgentLoopRunner({} as any, gateway, {} as any, new SkillEngine(db));
      const prompt = (loop as any).buildSystemPrompt('System Base Instructions', []);
      expect(prompt).toContain('read_spill');
      expect(prompt).toContain('Read bounded excerpt of a spilled large observation log');
    });

    it('ToolGateway executes read_spill tool successfully', async () => {
      const outputSpiller = new OutputSpiller({ thresholdBytes: 50 });
      const payload = 'ALPHA_BRAVO_CHARLIE_'.repeat(200);
      const spill = outputSpiller.processOutput(payload, 'test-tool');
      expect(spill.isSpilled).toBe(true);
      expect(spill.hash).toBeDefined();

      const gateway = new ToolGateway({ db });
      const toolRes = await gateway.executeTool<{ content: string; length: number; totalBytes: number }>(
        'read_spill',
        { hash: spill.hash, offset: 0, limit: 100 },
        {
          runId: 'run-1',
          agentId: 'ag-1',
          worktreeRoot: tempDir,
          autonomyMode: 'FULL_AUTONOMOUS',
          allowedCapabilities: ['*'],
        }
      );

      expect(toolRes.success).toBe(true);
      expect((toolRes.output as any)?.content).toBe(payload.slice(0, 100));
      expect((toolRes.output as any)?.totalBytes).toBe(Buffer.byteLength(payload, 'utf-8'));
    });
  });

  // ==========================================================================
  // 6. Mutex Error Recovery & Skill Sandbox Isolation
  // ==========================================================================
  describe('6. AsyncMutex & Skill Sandbox Isolation', () => {
    it('AsyncMutex recovers cleanly after thrown errors without permanent deadlock', async () => {
      const mutex = new AsyncMutex();
      let firstExecuted = false;
      let secondExecuted = false;

      await expect(
        mutex.runExclusive(async () => {
          firstExecuted = true;
          throw new Error('Forced mutex error');
        })
      ).rejects.toThrow('Forced mutex error');

      expect(firstExecuted).toBe(true);

      const secondResult = await mutex.runExclusive(async () => {
        secondExecuted = true;
        return 'resilient_success';
      });

      expect(secondExecuted).toBe(true);
      expect(secondResult).toBe('resilient_success');
    });

    it('SkillEngine sandbox isolates execution and prevents prototype tampering', async () => {
      const migrator = new MigrationRunner(db);
      migrator.runMigrations();
      const engine = new SkillEngine(db);

      const maliciousSkill: Skill = {
        id: 'skill-sandbox',
        name: 'test-sandbox',
        version: '1.0.0',
        description: 'Test sandbox',
        instructions: 'Test sandbox',
        requiredTools: [],
        triggerPatterns: [],
        isBuiltIn: false,
        status: 'active',
        handlerCode: `
            let result = 'contained';
            try {
              const testBuf = Buffer.from('data');
              if (testBuf.constructor) {
                const Fn = testBuf.constructor.constructor;
                if (Fn('return process')()) result = 'leaked_buffer';
              }
              if (params.constructor) {
                const Fn = params.constructor.constructor;
                if (Fn('return process')()) result = 'leaked_params';
              }
              if (context.constructor) {
                const Fn = context.constructor.constructor;
                if (Fn('return process')()) result = 'leaked_context';
              }
            } catch (e) {
              result = 'contained: ' + e.message;
            }
          `,
        createdAt: 1,
        updatedAt: 1,
      };

      const execution = await engine.executeSkill(maliciousSkill, { sampleParam: 'value' }, { sampleCtx: true });
      expect(execution.output).not.toContain('leaked');
    });
  });

  // ==========================================================================
  // 7. Activation Engine Direct Message Routing
  // ==========================================================================
  describe('7. Activation Engine DM Routing', () => {
    it('resolves recipient candidate correctly in dm-p1-p2 channels', () => {
      const engine = new ActivationEngine();

      const leadAgent: AgentIdentity = {
        id: 'agent-lead',
        workspaceId: 'ws-dm',
        definitionId: 'def-1',
        projectId: 'proj-dm',
        displayName: 'Lead Agent',
        activeModelId: 'ollama/llama3',
        isOrchestrator: false,
        isEphemeral: false,
        roleTitle: 'Lead',
        createdAt: 1,
        updatedAt: 1,
      };

      const specialistAgent: AgentIdentity = {
        id: 'agent-specialist',
        workspaceId: 'ws-dm',
        definitionId: 'def-2',
        projectId: 'proj-dm',
        displayName: 'Specialist Agent',
        activeModelId: 'ollama/llama3',
        isOrchestrator: false,
        isEphemeral: false,
        roleTitle: 'Specialist',
        createdAt: 1,
        updatedAt: 1,
      };

      const routingResult = engine.evaluateChannelRouting({
        channelId: 'dm-agent-lead-agent-specialist',
        isPrivate: true,
        message: {
          id: 'msg-dm-1',
          senderId: 'agent-lead',
          content: 'Hello specialist, review needed',
          createdAt: 100,
        },
        channelMembers: [],
        allProjectAgents: [leadAgent, specialistAgent],
        definitionsMap: new Map(),
      });

      expect(routingResult.action).toBe('direct_response');
      expect(routingResult.targetAgents).toHaveLength(1);
      expect(routingResult.targetAgents[0].id).toBe('agent-specialist');
    });
  });

  // ==========================================================================
  // 8. Control Plane Route Gating & Memory Scoping
  // ==========================================================================
  describe('8. Control Plane Gating & Memory Scoping', () => {
    it('enforces caller identity when reading or writing agent_private memories', async () => {
      const server = new CoreServer({ port: 0, dbPath, requireIpcAuth: false });
      const port = await server.start();
      try {
        // Attempt to create agent_private memory without matching caller
        const writeForbidden = await fetch(`http://127.0.0.1:${port}/api/memories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-caller-agent-id': 'agent-stranger' },
          body: JSON.stringify({
            scope: 'agent_private',
            scopeId: 'agent-target',
            key: 'secret-memory',
            value: { insight: 'classified' },
          }),
        });
        expect(writeForbidden.status).toBe(403);

        // Create with matching caller identity
        const writeAllowed = await fetch(`http://127.0.0.1:${port}/api/memories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-caller-agent-id': 'agent-target' },
          body: JSON.stringify({
            scope: 'agent_private',
            scopeId: 'agent-target',
            key: 'secret-memory',
            value: { insight: 'classified' },
          }),
        });
        expect(writeAllowed.status).toBe(201);

        // Read without matching caller
        const readForbidden = await fetch(`http://127.0.0.1:${port}/api/memories?scope=agent_private&scopeId=agent-target`, {
          headers: { 'x-caller-agent-id': 'agent-stranger' },
        });
        expect(readForbidden.status).toBe(403);

        // Read with matching caller
        const readAllowed = await fetch(`http://127.0.0.1:${port}/api/memories?scope=agent_private&scopeId=agent-target`, {
          headers: { 'x-caller-agent-id': 'agent-target' },
        });
        expect(readAllowed.status).toBe(200);
        const readData = await readAllowed.json();
        expect(readData.memories).toHaveLength(1);
      } finally {
        await server.stop();
      }
    });

    it('terminates active worker process upon async skill execution timeout', async () => {
      const migrator = new MigrationRunner(db);
      migrator.runMigrations();
      const engine = new SkillEngine(db);

      let workerTerminated = false;
      const mockWorker = {
        terminate: () => {
          workerTerminated = true;
        },
      };

      const hangingSkill: Skill = {
        id: 'skill-hanging-worker',
        name: 'test-hanging-worker',
        version: '1.0.0',
        description: 'Test hanging worker',
        instructions: 'Test hanging worker',
        requiredTools: [],
        triggerPatterns: [],
        isBuiltIn: false,
        status: 'active',
        handlerCode: `
          module.exports = async function(params, context) {
            await new Promise((r) => setTimeout(r, 1000));
            return { ok: true };
          };
        `,
        createdAt: 1,
        updatedAt: 1,
      };

      const result = await engine.executeSkill(hangingSkill, { _timeoutMs: 50 }, { worker: mockWorker });
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(workerTerminated).toBe(true);
    });

    it('retrieves single goal via GET /api/goals/:id and handles 404 for unknown goal', async () => {
      const server = new CoreServer({ port: 0, dbPath, requireIpcAuth: false });
      const port = await server.start();

      try {
        // Create a goal
        const postRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/goals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Audit Verification Goal',
            description: 'Testing goal REST endpoints',
            acceptanceCriteria: ['Tests pass'],
          }),
        });
        expect(postRes.status).toBe(201);
        const postData = await postRes.json();
        const createdId = postData.goal.id;

        // Fetch single goal by ID
        const getRes = await fetch(`http://127.0.0.1:${port}/api/goals/${createdId}`);
        expect(getRes.status).toBe(200);
        const getData = await getRes.json();
        expect(getData.goal.id).toBe(createdId);
        expect(getData.goal.title).toBe('Audit Verification Goal');

        // Fetch nonexistent goal
        const notFoundRes = await fetch(`http://127.0.0.1:${port}/api/goals/goal-nonexistent-999`);
        expect(notFoundRes.status).toBe(404);
      } finally {
        await server.stop();
      }
    });

    it('broadcasts operator notification when delegateToAgent specifies a direct message channel', async () => {
      const migrator = new MigrationRunner(db);
      migrator.runMigrations();
      db.execute(`INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-default', 'Default', '.', 'AUTO', ?, ?);`, Date.now(), Date.now());
      db.execute(`INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('proj-kin', 'ws-default', 'Default', '.', '{}', ?, ?);`, Date.now(), Date.now());
      const agentRepo = new AgentRepository(db);
      const gateway = new ToolGateway({ db, agentRepo });

      agentRepo.createDefinition({
        id: 'def-peer',
        name: 'PeerWorker',
        role: 'Specialist',
        systemPrompt: 'Peer system prompt',
        defaultModelId: 'test-model',
        domainAuthority: [],
        capabilities: ['*'],
        createdAt: Date.now(),
      });
      agentRepo.createIdentity({
        id: 'agent-peer-sender',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-peer',
        displayName: '@PeerSender',
        activeModelId: 'test-model',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      agentRepo.createIdentity({
        id: 'agent-peer-receiver',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-peer',
        displayName: '@PeerReceiver',
        activeModelId: 'test-model',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      let operatorNotified = false;
      let notificationPayload: any = null;
      gateway.setOperatorNotificationCallback((notif) => {
        operatorNotified = true;
        notificationPayload = notif;
      });

      const execContext = {
        agentId: 'agent-peer-sender',
        runId: 'run-test-dm',
        channelId: 'chan-general',
        projectId: 'proj-kin',
        allowedCapabilities: ['*'],
      };

      const result = await gateway.executeTool(
        'delegateToAgent',
        {
          targetAgent: '@PeerReceiver',
          directive: 'Confidential coordination inquiry',
          channelId: 'dm-agent-peer-sender-agent-peer-receiver',
        },
        execContext
      );

      expect(result.success).toBe(true);
      expect(operatorNotified).toBe(true);
      expect(notificationPayload.type).toBe('agent_dm');
      expect(notificationPayload.channelId).toBe('dm-agent-peer-receiver-agent-peer-sender');
    });
  });

  // ==========================================================================
  // 10. Analytical Task Evidence & analysis_summary Grounding
  // ==========================================================================
  describe('10. Evidence Schema, Indexes & Analytical Task Completion', () => {
    beforeEach(() => {
      new MigrationRunner(db).runMigrations();
    });

    it('creates evidence indexes and supports analysis_summary evidence type', () => {
      // Check indexes
      const indexes = db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'evidence';"
      ).map((r) => r.name);
      expect(indexes).toContain('idx_evidence_task');
      expect(indexes).toContain('idx_evidence_run');

      // Insert workspace, project, goal, agent definition & identity, task, run
      const now = Date.now();
      db.execute(`INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-default', 'Default', '.', 'AUTO', ?, ?);`, now, now);
      db.execute(`INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('proj-kin', 'ws-default', 'Default', '.', '{}', ?, ?);`, now, now);
      db.execute(`INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-ev', 'Def Ev', 'Analyst', 'Prompt', 'ollama/llama3', ?);`, now);
      db.execute(`INSERT OR IGNORE INTO agent_identities (id, workspace_id, definition_id, project_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at) VALUES ('ag-ev', 'ws-default', 'def-ev', 'proj-kin', 'Analyst', 'ollama/llama3', 0, 0, ?, ?);`, now, now);
      db.execute(`INSERT OR IGNORE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at) VALUES ('goal-ev', 'proj-kin', 'Goal Ev', 'Desc', '[]', 'active', ?, ?);`, now, now);
      db.execute(`INSERT OR IGNORE INTO tasks (id, goal_id, title, description, status, created_at, updated_at) VALUES ('task-analysis', 'goal-ev', 'Analysis Task', 'Analyze architecture', 'running', ?, ?);`, now, now);
      db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, task_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
         VALUES ('run-ev-1', 'ag-ev', 'proj-kin', 'task-analysis', 'running', ?, 1000, 100, ?);`,
        now,
        now
      );

      // Insert analysis_summary evidence
      const evId = 'ev-analysis-1';
      const contentUri = 'memo://analysis/run/run-ev-1?sha256=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, verified_by, verification_payload_json, created_at)
         VALUES (?, 'task-analysis', 'run-ev-1', 'analysis_summary', ?, 1, 'ag-ev', '{}', ?);`,
        evId,
        contentUri,
        now
      );

      const evRow = db.queryOne<any>('SELECT * FROM evidence WHERE id = ?', evId);
      expect(evRow).toBeDefined();
      expect(evRow.type).toBe('analysis_summary');

      // Verify taskRepo.completeTask completes successfully with analysis_summary
      const taskRepo = new TaskRepository(db);
      taskRepo.claimTaskWithLease('task-analysis', 'ag-ev', 'run-ev-1', 60000);
      const promoted = taskRepo.completeTask('task-analysis', evId, 'run-ev-1');
      expect(promoted).toBeDefined();

      const completedTask = taskRepo.getTask('task-analysis');
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.evidenceBundleId).toBe(evId);
    });

    it('rejects invalid analysis_summary URI during task completion', () => {
      const now = Date.now();
      db.execute(`INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-default', 'Default', '.', 'AUTO', ?, ?);`, now, now);
      db.execute(`INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('proj-kin', 'ws-default', 'Default', '.', '{}', ?, ?);`, now, now);
      db.execute(`INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-ev', 'Def Ev', 'Analyst', 'Prompt', 'ollama/llama3', ?);`, now);
      db.execute(`INSERT OR IGNORE INTO agent_identities (id, workspace_id, definition_id, project_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at) VALUES ('ag-ev', 'ws-default', 'def-ev', 'proj-kin', 'Analyst', 'ollama/llama3', 0, 0, ?, ?);`, now, now);
      db.execute(`INSERT OR IGNORE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at) VALUES ('goal-ev', 'proj-kin', 'Goal Ev', 'Desc', '[]', 'active', ?, ?);`, now, now);
      db.execute(`INSERT OR IGNORE INTO tasks (id, goal_id, title, description, status, created_at, updated_at) VALUES ('task-bad-analysis', 'goal-ev', 'Bad Analysis Task', 'Desc', 'running', ?, ?);`, now, now);
      db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, task_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
         VALUES ('run-ev-bad', 'ag-ev', 'proj-kin', 'task-bad-analysis', 'running', ?, 1000, 100, ?);`,
        now,
        now
      );

      const evId = 'ev-bad-1';
      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, verified_by, verification_payload_json, created_at)
         VALUES (?, 'task-bad-analysis', 'run-ev-bad', 'analysis_summary', 'invalid://scheme/uri', 1, 'ag-ev', '{}', ?);`,
        evId,
        now
      );

      const taskRepo = new TaskRepository(db);
      expect(() => {
        taskRepo.completeTask('task-bad-analysis', evId, 'run-ev-bad');
      }).toThrow(/invalid analysis_summary URI/);

      const task = taskRepo.getTask('task-bad-analysis');
      expect(task?.status).toBe('review');
    });
  });
});


