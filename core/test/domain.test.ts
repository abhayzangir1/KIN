import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('KIN Phase 0/1: Domain Repositories & Execution Contracts', () => {
  let db: KinDatabase;
  let tempDbPath: string;
  let agentRepo: AgentRepository;
  let workspaceRepo: WorkspaceRepository;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-domain-test-'));
    tempDbPath = path.join(tempDir, 'kin_domain.sqlite');
    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    agentRepo = new AgentRepository(db);
    workspaceRepo = new WorkspaceRepository(db);
    taskRepo = new TaskRepository(db);
  });

  afterEach(() => {
    db.close();
    try {
      const dir = path.dirname(tempDbPath);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows file lock delays
    }
  });

  it('manages agent identities with independent user-configured active & fallback models', () => {
    const now = Date.now();
    workspaceRepo.createWorkspace({
      id: 'ws-1',
      name: 'Default Workspace',
      rootPath: '/workspace',
      defaultAutonomyMode: 'AUTO',
      createdAt: now,
      updatedAt: now,
    });

    agentRepo.createDefinition({
      id: 'def-frontend',
      name: 'Frontend Lead',
      role: 'UI Architect',
      systemPrompt: 'You build resilient, high-speed interfaces.',
      defaultModelId: 'claude-3-5-sonnet',
      domainAuthority: ['ui.components', 'client.rendering'],
      capabilities: ['fs_read', 'fs_write', 'shell'],
      createdAt: now,
    });

    agentRepo.createIdentity({
      id: 'agent-fe-1',
      workspaceId: 'ws-1',
      definitionId: 'def-frontend',
      displayName: '@FrontendLead',
      activeModelId: 'anthropic/claude-3-5-sonnet',
      fallbackModelId: 'openai/gpt-4o',
      isOrchestrator: false,
      isEphemeral: false,
      createdAt: now,
      updatedAt: now,
    });

    const agent = agentRepo.getIdentity('agent-fe-1');
    expect(agent).toBeDefined();
    expect(agent?.displayName).toBe('@FrontendLead');
    expect(agent?.activeModelId).toBe('anthropic/claude-3-5-sonnet');
    expect(agent?.fallbackModelId).toBe('openai/gpt-4o');

    // User explicitly reconfigures agent model
    agentRepo.updateAgentModelConfig('agent-fe-1', 'deepseek/deepseek-chat', 'ollama/qwen2.5-coder');

    const updated = agentRepo.getIdentity('agent-fe-1');
    expect(updated?.activeModelId).toBe('deepseek/deepseek-chat');
    expect(updated?.fallbackModelId).toBe('ollama/qwen2.5-coder');
    // Ensure display name, identity, and timestamps are preserved
    expect(updated?.displayName).toBe('@FrontendLead');
  });

  it('manages atomic task claiming and dependency DAG automated promotion', () => {
    const now = Date.now();
    workspaceRepo.createWorkspace({
      id: 'ws-dag',
      name: 'DAG Workspace',
      rootPath: '/ws',
      defaultAutonomyMode: 'AUTO',
      createdAt: now,
      updatedAt: now,
    });

    workspaceRepo.createProject({
      id: 'proj-dag',
      workspaceId: 'ws-dag',
      name: 'Pipeline Project',
      repoPath: '/repo',
      settings: {},
      createdAt: now,
      updatedAt: now,
    });

    // Create worker agents to satisfy foreign keys
    agentRepo.createDefinition({
      id: 'def-worker',
      name: 'Worker',
      role: 'Engineer',
      systemPrompt: 'You execute tasks.',
      defaultModelId: 'claude-3-5-sonnet',
      domainAuthority: [],
      capabilities: ['shell'],
      createdAt: now,
    });

    agentRepo.createIdentity({
      id: 'agent-worker-a',
      workspaceId: 'ws-dag',
      definitionId: 'def-worker',
      displayName: '@WorkerA',
      activeModelId: 'anthropic/claude-3-5-sonnet',
      isOrchestrator: false,
      isEphemeral: false,
      createdAt: now,
      updatedAt: now,
    });

    agentRepo.createIdentity({
      id: 'agent-worker-b',
      workspaceId: 'ws-dag',
      definitionId: 'def-worker',
      displayName: '@WorkerB',
      activeModelId: 'openai/gpt-4o',
      isOrchestrator: false,
      isEphemeral: false,
      createdAt: now,
      updatedAt: now,
    });

    taskRepo.createGoal({
      id: 'goal-1',
      projectId: 'proj-dag',
      title: 'Build Feature X',
      description: 'Full stack feature implementation',
      acceptanceCriteria: ['Tests pass', 'Build passes'],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    // Create 3 tasks with DAG: Task 1 -> Task 2 -> Task 3
    // Task 1 starts as 'ready'
    taskRepo.createTask({
      id: 'task-1',
      goalId: 'goal-1',
      title: 'Database Migration',
      description: 'Add users table',
      status: 'ready',
      verificationSpec: { command: 'npm run test:db' },
      createdAt: now,
      updatedAt: now,
    });

    // Task 2 depends on Task 1, starts in 'backlog'
    taskRepo.createTask(
      {
        id: 'task-2',
        goalId: 'goal-1',
        title: 'Backend API Service',
        description: 'Expose /api/users endpoint',
        status: 'backlog',
        verificationSpec: { command: 'npm run test:api' },
        createdAt: now,
        updatedAt: now,
      },
      ['task-1']
    );

    // Task 3 depends on Task 2, starts in 'backlog'
    taskRepo.createTask(
      {
        id: 'task-3',
        goalId: 'goal-1',
        title: 'Frontend View',
        description: 'Render user dashboard',
        status: 'backlog',
        verificationSpec: { command: 'npm run test:ui' },
        createdAt: now,
        updatedAt: now,
      },
      ['task-2']
    );

    // 1. Atomic claim test: Agent A claims task-1
    const claimA = taskRepo.claimTask('task-1', 'agent-worker-a');
    expect(claimA).toBe(true);

    // Agent B tries to claim already claimed task-1 -> must fail
    const claimB = taskRepo.claimTask('task-1', 'agent-worker-b');
    expect(claimB).toBe(false);

    // Move task-1 to running
    taskRepo.updateTaskStatus('task-1', 'running');

    // Verify task-2 is still in backlog
    expect(taskRepo.getTask('task-2')?.status).toBe('backlog');

    // 2. Complete Task 1 with verified evidence bundle
    db.execute(
      `INSERT OR IGNORE INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at) VALUES ('run-test-1', 'agent-worker-a', 'proj-dag', 'running', ?, ?)`,
      now,
      now
    );
    db.execute(
      `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'evidence-bundle-001',
      'task-1',
      'run-test-1',
      'artifact_hash',
      'evidence://task-1/bundle-001',
      1,
      Date.now()
    );
    taskRepo.completeTask('task-1', 'evidence-bundle-001');
    expect(taskRepo.getTask('task-1')?.status).toBe('completed');

    // Task 2 must now be AUTOMATICALLY promoted to 'ready' because its dependency (task-1) is completed!
    expect(taskRepo.getTask('task-2')?.status).toBe('ready');

    // Task 3 must STILL be in 'backlog' because task-2 is not yet completed
    expect(taskRepo.getTask('task-3')?.status).toBe('backlog');

    // Now claim and complete Task 2
    expect(taskRepo.claimTask('task-2', 'agent-worker-b')).toBe(true);
    taskRepo.updateTaskStatus('task-2', 'running');
    db.execute(
      `INSERT OR IGNORE INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at) VALUES ('run-test-2', 'agent-worker-b', 'proj-dag', 'running', ?, ?)`,
      now,
      now
    );
    db.execute(
      `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'evidence-bundle-002',
      'task-2',
      'run-test-2',
      'artifact_hash',
      'evidence://task-2/bundle-002',
      1,
      Date.now()
    );
    taskRepo.completeTask('task-2', 'evidence-bundle-002');
    expect(taskRepo.getTask('task-2')?.status).toBe('completed');

    // Now Task 3 must be promoted to 'ready'!
    expect(taskRepo.getTask('task-3')?.status).toBe('ready');
  });
});
