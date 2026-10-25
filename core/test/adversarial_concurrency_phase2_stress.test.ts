import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { Task, Goal } from '../src/domain/types.js';

describe('Phase 2: Concurrency, Contention & Adversarial Stress Tests', () => {
  let db: KinDatabase;
  let taskRepo: TaskRepository;
  let ledger: EventLedger;

  beforeEach(() => {
    db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    taskRepo = new TaskRepository(db);
    ledger = new EventLedger(db);

    const now = Date.now();
    const wsRepo = new WorkspaceRepository(db);
    wsRepo.createWorkspace({
      id: 'ws-default',
      name: 'Default Workspace',
      rootPath: '/tmp/kin',
      defaultAutonomyMode: 'AUTO',
      createdAt: now,
      updatedAt: now,
    });
    wsRepo.createProject({
      id: 'proj-kin',
      workspaceId: 'ws-default',
      name: 'KIN Project',
      repoPath: '/tmp/kin/project',
      createdAt: now,
      updatedAt: now,
    });

    const agentRepo = new AgentRepository(db);
    agentRepo.createDefinition({
      id: 'def-worker',
      name: 'Parallel Worker',
      role: 'Worker',
      systemPrompt: 'Executes concurrent tasks',
      defaultModelId: 'claude-3-5-sonnet',
      domainAuthority: [],
      capabilities: ['shell'],
      createdAt: now,
    });

    agentRepo.createIdentity({
      id: 'agent-worker',
      workspaceId: 'ws-default',
      projectId: 'proj-kin',
      definitionId: 'def-worker',
      displayName: '@Worker',
      activeModelId: 'claude-3-5-sonnet',
      autonomyMode: 'AUTO',
      capabilities: ['shell'],
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < 50; i++) {
      agentRepo.createIdentity({
        id: `agent-worker-${i}`,
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-worker',
        displayName: `@Worker-${i}`,
        activeModelId: 'claude-3-5-sonnet',
        autonomyMode: 'AUTO',
        capabilities: ['shell'],
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
  });

  describe('1. Task Lease Reclamation Under Terminated Runs (TOCTOU & Early Fail)', () => {
    it('immediately reclaims a running task if its claimed run fails, even before lease expiry', () => {
      const now = Date.now();
      const goal: Goal = {
        id: 'g-test-1',
        projectId: 'proj-kin',
        title: 'Goal 1',
        description: 'Goal 1 description',
        acceptanceCriteria: [],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      taskRepo.createGoal(goal);

      const task: Task = {
        id: 't-crash-1',
        goalId: 'g-test-1',
        title: 'Crashed Worker Task',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      };
      taskRepo.createTask(task);

      // Worker 1 claims task with a 10-minute lease
      const runId = 'run-crashed-1';
      const claimed = taskRepo.claimTaskWithLease('t-crash-1', 'agent-worker', runId, 600000);
      expect(claimed).toBe(true);

      const runningTask = taskRepo.getTask('t-crash-1');
      expect(runningTask?.status).toBe('running');
      expect(runningTask?.claimedByRunId).toBe(runId);
      expect(runningTask?.leaseExpiresAt).toBeGreaterThan(now + 500000);

      // Simulate worker run crashing and being marked 'failed' by supervisor
      db.execute("UPDATE agent_runs SET state = 'failed' WHERE id = ?", runId);

      // Reclaim expired/terminated task leases
      const reclaimed = taskRepo.reclaimExpiredTaskLeases();
      expect(reclaimed).toContain('t-crash-1');

      // Task must now be reset to ready for successor workers
      const resetTask = taskRepo.getTask('t-crash-1');
      expect(resetTask?.status).toBe('ready');
      expect(resetTask?.claimedByRunId).toBeUndefined();
      expect(resetTask?.leaseExpiresAt).toBeUndefined();
    });
  });

  describe('2. High-Concurrency Multi-Worker Task Claim Race', () => {
    it('ensures exactly 5 unique winners across 50 concurrent workers contending for 5 tasks', async () => {
      const now = Date.now();
      const goal: Goal = {
        id: 'g-race-1',
        projectId: 'proj-kin',
        title: 'Race Goal',
        description: 'Race Goal description',
        acceptanceCriteria: [],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      taskRepo.createGoal(goal);

      // Create 5 ready tasks
      const taskIds = ['t-race-1', 't-race-2', 't-race-3', 't-race-4', 't-race-5'];
      for (const id of taskIds) {
        taskRepo.createTask({
          id,
          goalId: 'g-race-1',
          title: `Race Task ${id}`,
          status: 'ready',
          createdAt: now,
          updatedAt: now,
        });
      }

      // Launch 50 workers simultaneously trying to claim any ready task
      const workerCount = 50;
      const workerPromises = Array.from({ length: workerCount }, async (_, idx) => {
        const workerAgentId = `agent-worker-${idx}`;
        const runId = `run-worker-${idx}`;
        const claimedTasks: string[] = [];

        for (const taskId of taskIds) {
          const won = taskRepo.claimTaskWithLease(taskId, workerAgentId, runId, 300000);
          if (won) {
            claimedTasks.push(taskId);
          }
        }
        return { workerAgentId, runId, claimedTasks };
      });

      const results = await Promise.all(workerPromises);

      // Verify that all 5 tasks are claimed, and each task was claimed by exactly ONE worker
      const allClaimedTaskIds = results.flatMap((r) => r.claimedTasks);
      expect(allClaimedTaskIds.length).toBe(5);

      const uniqueClaimed = new Set(allClaimedTaskIds);
      expect(uniqueClaimed.size).toBe(5);

      for (const id of taskIds) {
        const t = taskRepo.getTask(id);
        expect(t?.status).toBe('running');
        expect(t?.claimedByRunId).toBeDefined();
      }
    });
  });

  describe('3. Complex DAG Dependency Graphs & Cycle Detection', () => {
    it('supports diamond dependencies (A -> B, A -> C, B -> D, C -> D) and rejects cycles (D -> A)', () => {
      const now = Date.now();
      taskRepo.createGoal({
        id: 'g-dag',
        projectId: 'proj-kin',
        title: 'DAG Goal',
        description: 'DAG Goal description',
        acceptanceCriteria: [],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      // A
      taskRepo.createTask({ id: 'task-A', goalId: 'g-dag', title: 'Task A', status: 'ready', createdAt: now, updatedAt: now });

      // B depends on A
      taskRepo.createTask({ id: 'task-B', goalId: 'g-dag', title: 'Task B', status: 'blocked', createdAt: now, updatedAt: now }, ['task-A']);

      // C depends on A
      taskRepo.createTask({ id: 'task-C', goalId: 'g-dag', title: 'Task C', status: 'blocked', createdAt: now, updatedAt: now }, ['task-A']);

      // D depends on B and C (diamond)
      taskRepo.createTask({ id: 'task-D', goalId: 'g-dag', title: 'Task D', status: 'blocked', createdAt: now, updatedAt: now }, ['task-B', 'task-C']);

      // Verifying cycle detection: task-A cannot depend on task-D
      expect(taskRepo.wouldCreateCycle('task-A', 'task-D')).toBe(true);

      // Also cannot depend on task-B or task-C
      expect(taskRepo.wouldCreateCycle('task-A', 'task-B')).toBe(true);
      expect(taskRepo.wouldCreateCycle('task-A', 'task-C')).toBe(true);

      // Non-cycle dependency is allowed
      expect(taskRepo.wouldCreateCycle('task-B', 'task-C')).toBe(false);
    });
  });

  describe('4. EventLedger Cryptographic Append Under 50 Parallel Operations', () => {
    it('maintains continuous linear HMAC SHA-256 chain across 50 concurrent async logs', async () => {
      const eventCount = 50;

      const logPromises = Array.from({ length: eventCount }, async (_, idx) => {
        return ledger.record({
          eventType: 'audit.test.event',
          payload: { index: idx, timestamp: Date.now(), data: `payload-${idx}` },
          actorId: `actor-${idx % 5}`,
          contextId: 'ctx-concurrency',
        });
      });

      const ids = await Promise.all(logPromises);
      expect(ids.length).toBe(eventCount);

      // Verify that all 50 events form an unbroken linear cryptographic hash chain
      const verifyResult = ledger.verifyChainIntegrity();
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.verifiedCount).toBe(eventCount);
      expect(verifyResult.compromisedId).toBeUndefined();
    });
  });
});
