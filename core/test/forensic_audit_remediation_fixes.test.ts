import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import { ToolEngine } from '../src/execution/tool_engine.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';

describe('Forensic Audit Codebase Remediation Fixes', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let kernel: AgentKernel;
  let taskRepo: TaskRepository;
  let agentRepo: AgentRepository;
  let workspaceRepo: WorkspaceRepository;
  let toolEngine: ToolEngine;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-forensic-fix-test-'));
    dbPath = path.join(tempDir, 'fixes_test.sqlite');
    db = new KinDatabase(dbPath);
    new MigrationRunner(db).runMigrations();

    kernel = new AgentKernel(db);
    taskRepo = new TaskRepository(db);
    agentRepo = new AgentRepository(db);
    workspaceRepo = new WorkspaceRepository(db);
    toolEngine = new ToolEngine(db);

    const now = Date.now();
    workspaceRepo.createWorkspace({
      id: 'ws-fix-test',
      name: 'Fix Test Workspace',
      rootPath: tempDir,
      defaultAutonomyMode: 'AUTO',
      createdAt: now,
      updatedAt: now,
    });
    workspaceRepo.createProject({
      id: 'proj-fix-test',
      workspaceId: 'ws-fix-test',
      name: 'Fix Test Project',
      repoPath: tempDir,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    workspaceRepo.createChannel({
      id: 'chan-fix',
      projectId: 'proj-fix-test',
      name: 'general',
      topic: 'General discussion',
      isPrivate: false,
      channelType: 'channel',
      createdAt: now,
    });

    agentRepo.createDefinition({
      id: 'def-boss-fix',
      name: 'Boss Definition',
      role: 'Orchestrator',
      systemPrompt: 'prompt',
      defaultModelId: 'gpt-4o',
      domainAuthority: [],
      capabilities: ['shell:exec'],
      createdAt: now,
    });

    agentRepo.createIdentity({
      id: 'agent-boss',
      workspaceId: 'ws-fix-test',
      projectId: 'proj-fix-test',
      definitionId: 'def-boss-fix',
      displayName: '@Boss',
      activeModelId: 'gpt-4o',
      isOrchestrator: true,
      createdAt: now,
      updatedAt: now,
    });

    taskRepo.createGoal({
      id: 'goal-fix-1',
      projectId: 'proj-fix-test',
      title: 'Fix Goal',
      description: 'Goal for testing',
      acceptanceCriteria: ['pass'],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(() => {
    if (db) db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ============================================================================
  // 1. ToolEngine VM Sandbox Escape Prevention
  // ============================================================================
  describe('ToolEngine Sandbox Security', () => {
    it('prevents sandbox escape via Buffer constructor chain', async () => {
      const toolCreation = toolEngine.createTool({
        name: 'exploit_buffer_constructor',
        description: 'Attempts to escape VM sandbox via Buffer constructor chain',
        parametersSchema: { type: 'object', properties: {} },
        handlerCode: `
          module.exports = async function(params, context) {
            try {
              const b = Buffer.from('test');
              const HostFunction = b.constructor.constructor;
              const hostProcess = HostFunction('return typeof process !== "undefined" ? process.version : null')();
              return { executed: true, version: hostProcess };
            } catch (err) {
              return { executed: true, error: err.message, version: null };
            }
          };
        `,
        status: 'active',
        forceCreation: true,
        requireApproval: false,
      });

      expect(toolCreation.success).toBe(true);

      const result = await toolEngine.executeCustomTool('exploit_buffer_constructor', {}, { worktreeRoot: tempDir });
      expect(result.success).toBe(true);
      // The guest function cannot access host process
      expect(result.output.version).toBeNull();
    });

    it('prevents prototype pollution inside guest execution context', async () => {
      const toolCreation = toolEngine.createTool({
        name: 'pollute_prototype',
        description: 'Attempts to pollute Object prototype',
        parametersSchema: { type: 'object', properties: {} },
        handlerCode: `
          module.exports = async function() {
            try {
              Object.prototype.polluted = true;
              return { polluted: !!Object.prototype.polluted };
            } catch (err) {
              return { error: err.message, polluted: false };
            }
          };
        `,
        status: 'active',
        forceCreation: true,
        requireApproval: false,
      });

      expect(toolCreation.success).toBe(true);

      const result = await toolEngine.executeCustomTool('pollute_prototype', {}, { worktreeRoot: tempDir });
      expect(result.success).toBe(true);
      // Object.prototype is frozen in the guest context
      expect(result.output.polluted).toBeFalsy();
    });
  });

  // ============================================================================
  // 2. Checkpoint Trajectory Preservation Across Approvals
  // ============================================================================
  describe('Checkpoint Trajectory Preservation', () => {
    it('getLatestCheckpoint preserves conversationHistory even when subsequent completion checkpoint exists', () => {
      const now = Date.now();
      const runId = `run-chk-${now}`;

      // Register run in kernel
      db.execute(
        `INSERT INTO agent_runs (id, agent_id, channel_id, state, heartbeat_at, created_at)
         VALUES (?, 'agent-boss', 'chan-fix', 'running', ?, ?)`,
        runId, now, now
      );

      // Turn 1 checkpoint with conversation history
      kernel.saveCheckpoint(runId, {
        turn: 1,
        conversationHistory: [
          { role: 'user', content: 'Original user instruction' },
          { role: 'assistant', content: 'Action planned' },
        ],
        actions: [{ toolName: 'scan', params: {} }],
        timestamp: now,
      });

      // Later checkpoint at run termination without conversation history
      kernel.saveCheckpoint(runId, {
        actions: [{ toolName: 'scan', params: {} }],
        finalContent: 'Action requires approval',
        turnCount: 1,
        agentId: 'agent-boss',
        channelId: 'chan-fix',
      });

      // getLatestCheckpoint must return the snapshot that preserves conversationHistory
      const latest = kernel.getLatestCheckpoint(runId);
      expect(latest).toBeDefined();
      expect(latest.conversationHistory).toBeDefined();
      expect(latest.conversationHistory.length).toBe(2);
      expect(latest.conversationHistory[0].content).toBe('Original user instruction');
    });
  });

  // ============================================================================
  // 3. Decommissioned Agent Lease and Task Reassignment
  // ============================================================================
  describe('Decommissioned Agent Lease Cleanup', () => {
    it('clears running leases and resets status to ready when tasks are reassigned to boss', () => {
      const now = Date.now();
      const deadAgentId = `agent-worker-${now}`;
      const bossAgentId = `agent-boss-fix-${now}`;

      agentRepo.createDefinition({
        id: `def-dead-${now}`,
        name: 'Dead Worker Def',
        role: 'Worker',
        systemPrompt: 'prompt',
        defaultModelId: 'gpt-4o',
        domainAuthority: [],
        capabilities: ['shell:exec'],
        createdAt: now,
      });

      agentRepo.createIdentity({
        id: deadAgentId,
        workspaceId: 'ws-fix-test',
        projectId: 'proj-fix-test',
        definitionId: `def-dead-${now}`,
        displayName: '@DeadWorker',
        activeModelId: 'gpt-4o',
        isOrchestrator: false,
        createdAt: now,
        updatedAt: now,
      });

      agentRepo.createIdentity({
        id: bossAgentId,
        workspaceId: 'ws-fix-test',
        projectId: 'proj-fix-test',
        definitionId: `def-dead-${now}`,
        displayName: '@BossFix',
        activeModelId: 'gpt-4o',
        isOrchestrator: true,
        createdAt: now,
        updatedAt: now,
      });

      db.execute(
        `INSERT INTO agent_runs (id, agent_id, channel_id, state, heartbeat_at, created_at)
         VALUES ('run-dead-1', ?, 'chan-fix', 'running', ?, ?)`,
        deadAgentId, now, now
      );

      const taskId = `task-decom-${now}`;
      db.execute(
        `INSERT INTO tasks (id, goal_id, title, description, status, assigned_agent_id, claimed_by_run_id, lease_expires_at, retry_count, created_at, updated_at)
         VALUES (?, 'goal-fix-1', 'Running Task', 'Task description', 'running', ?, 'run-dead-1', ?, 0, ?, ?)`,
        taskId, deadAgentId, now + 60000, now, now
      );

      // Simulate decommission task reassignment
      const boss = agentRepo.getBossIdentityForProject('proj-fix-test');
      expect(boss).toBeDefined();
      db.execute(
        `UPDATE tasks
         SET assigned_agent_id = ?,
             status = CASE WHEN status = 'running' THEN 'ready' ELSE status END,
             claimed_by_run_id = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE assigned_agent_id = ?`,
        boss!.id,
        now,
        deadAgentId
      );

      const updated = taskRepo.getTask(taskId);
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('ready');
      expect(updated?.assignedAgentId).toBe(boss!.id);
      expect(updated?.claimedByRunId).toBeFalsy();
      expect(updated?.leaseExpiresAt).toBeFalsy();
    });
  });

  // ============================================================================
  // 4. Non-blocking Database Async Execution
  // ============================================================================
  describe('KinDatabase executeAsync Non-Blocking Backoff', () => {
    it('executes asynchronous queries safely across concurrent promises', async () => {
      const promises = Array.from({ length: 15 }, (_, i) =>
        db.executeAsync(
          `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, created_at)
           VALUES (?, 'chan-fix', 'user-1', 'human', ?, ?)`,
          `msg-async-${Date.now()}-${i}`,
          `Content ${i}`,
          Date.now()
        )
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(15);
      for (const res of results) {
        expect(Number(res.changes)).toBe(1);
      }
    });
  });
});
