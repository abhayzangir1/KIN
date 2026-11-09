// ============================================================================
// KIN MILESTONE 4: ADVERSARIAL CONCURRENCY & STRESS HARDENING SUITE
// 5 High-Concurrency Stress Scenarios:
// 1. Parallel SQLite transactions with 50+ concurrent agents under WAL mode.
// 2. OCC version race: 25+ concurrent workers mutating shared memory block,
//    verifying exactly 1 winner, OCCConflictError on losers, and retry convergence.
// 3. Thread lease exhaustion: 30 agents competing for lease and crash recovery.
// 4. Deadlock prevention: DAG cycle detection and kernel concurrency quota (8 running / 22 queued).
// 5. Cascading DAG cancellations: cancelling root cascades 'blocked' to all 50 downstream tasks.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { KinDatabase } from '../../src/storage/db.js';
import { MigrationRunner } from '../../src/storage/migration_runner.js';
import { MemoryRepository, OCCConflictError } from '../../src/domain/memory_repository.js';
import { TaskRepository } from '../../src/domain/task_repository.js';
import { ChannelService } from '../../src/communication/channel_service.js';
import { AgentKernel } from '../../src/kernel/agent_kernel.js';
import { EventLedger } from '../../src/security/event_ledger.js';
import { Task } from '../../src/domain/types.js';

describe('KIN Milestone 4: Adversarial Concurrency & Stress Hardening Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  const workspaceId = 'ws-stress';
  const projectId = 'proj-stress';
  const definitionId = 'def-stress';
  const goalId = 'goal-stress';

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-concurrency-stress-'));
    dbPath = path.join(tempDir, 'kin_stress.sqlite');

    db = new KinDatabase(dbPath);
    new MigrationRunner(db).runMigrations();

    // Seed required relational parents for foreign keys
    const now = Date.now();
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, 'Stress Workspace', ?, 'AUTO', ?, ?)`,
      workspaceId,
      tempDir,
      now,
      now
    );

    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, 'Stress Project', ?, '{}', ?, ?)`,
      projectId,
      workspaceId,
      tempDir,
      now,
      now
    );

    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
       VALUES (?, 'Stress Specialist', 'Worker', 'You are a concurrency stress worker.', 'ollama/llama3', '[]', '["fs:read","fs:write"]', ?)`,
      definitionId,
      now
    );

    db.execute(
      `INSERT INTO goals (id, project_id, title, description, status, acceptance_criteria_json, created_at, updated_at)
       VALUES (?, ?, 'Stress Goal', 'Adversarial concurrency testing', 'active', '[]', ?, ?)`,
      goalId,
      projectId,
      now,
      now
    );

    // Seed agent identities for stress workers
    for (let i = 0; i < 60; i++) {
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ollama/llama3', 0, 0, ?, ?)`,
        `ag-stress-${i}`,
        workspaceId,
        projectId,
        definitionId,
        `Worker ${i}`,
        now,
        now
      );
    }
  });

  afterAll(() => {
    try {
      if (db) db.close();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  beforeEach(() => {
    // Clean up dynamic execution tables between test scenarios
    db.execute('DELETE FROM checkpoints;');
    db.execute('DELETE FROM task_dependencies;');
    db.execute('DELETE FROM tasks;');
    db.execute('DELETE FROM agent_runs;');
    db.execute('DELETE FROM event_journal;');
    db.execute('DELETE FROM memory_versions;');
    db.execute('DELETE FROM memories;');
  });

  // --------------------------------------------------------------------------
  // Stress Scenario 1: 50+ Concurrent Parallel SQLite Transactions & Ledger Integrity
  // --------------------------------------------------------------------------
  it('Scenario 1: 50+ concurrent agents executing parallel transactionAsync commit without corruption', async () => {
    const workerCount = 50;
    const ledger = EventLedger.ensureInitialized(db);

    const workerTasks = Array.from({ length: workerCount }, (_, i) => {
      return (async () => {
        const runId = `run-stress-1-${i}-${crypto.randomBytes(4).toString('hex')}`;
        const agentId = `ag-stress-${i}`;

        await db.transactionAsync(async () => {
          // 1. Insert agent run record
          db.execute(
            `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
             VALUES (?, ?, ?, 'running', ?, 10000, 100, ?)`,
            runId,
            agentId,
            projectId,
            Date.now(),
            Date.now()
          );

          // 2. Insert checkpoint record
          db.execute(
            `INSERT INTO checkpoints (id, run_id, snapshot_json, created_at)
             VALUES (?, ?, ?, ?)`,
            `chk-${runId}`,
            runId,
            JSON.stringify({ turn: 1, step: 'concurrency-verification' }),
            Date.now()
          );

          // 3. Record audit event in ledger
          ledger.record({
            eventType: 'agent.turn.completed',
            entityType: 'agent_run',
            entityId: runId,
            runId,
            payload: {
              agentId,
              tokens: 100,
              workerIndex: i,
            },
          });

          // Interleave nested savepoint transaction
          if (i % 5 === 0) {
            await db.transactionAsync(async () => {
              db.execute(
                `UPDATE agent_runs SET used_tokens = 200 WHERE id = ?`,
                runId
              );
            });
          }
        });
      })();
    });

    // Execute all 50 parallel transactions simultaneously
    await Promise.all(workerTasks);

    // Verify exactly 50 runs and 50 checkpoints persisted
    const runCount = db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM agent_runs WHERE id LIKE 'run-stress-1-%'`
    )?.count;
    expect(runCount).toBe(workerCount);

    const chkCount = db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM checkpoints WHERE id LIKE 'chk-run-stress-1-%'`
    )?.count;
    expect(chkCount).toBe(workerCount);

    // Verify cryptographic tamper-evident audit ledger chain integrity
    const chainIntegrity = ledger.verifyChainIntegrity();
    expect(chainIntegrity.valid).toBe(true);
    expect(chainIntegrity.verifiedCount).toBeGreaterThanOrEqual(workerCount);
  });

  // --------------------------------------------------------------------------
  // Stress Scenario 2: OCC Version Races on Shared Memory Fabric
  // --------------------------------------------------------------------------
  it('Scenario 2: OCC version race rejects stale writers with OCCConflictError and achieves convergence on retry', async () => {
    const memRepo = new MemoryRepository(db);
    const sharedKey = `shared_arch_decision_${Date.now()}`;

    // Seed shared memory at version 1
    const initial = memRepo.setMemory({
      scope: 'project',
      scopeId: projectId,
      type: 'decision',
      key: sharedKey,
      value: { architecture: 'Initial Baseline' },
      updatedByRunId: 'seed-run',
    });
    expect(initial.version).toBe(1);

    // Phase A: 25 concurrent workers attempt to update the same memory with expectedVersion: 1
    const workerCount = 25;
    const racePromises = Array.from({ length: workerCount }, (_, i) => {
      return (async () => {
        return memRepo.setMemory({
          scope: 'project',
          scopeId: projectId,
          type: 'decision',
          key: sharedKey,
          value: { architecture: `Updated by Worker ${i}` },
          expectedVersion: 1,
          updatedByRunId: `run-occ-${i}`,
        });
      })();
    });

    const results = await Promise.allSettled(racePromises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one winner commits at version 2
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(workerCount - 1);

    // Every loser encounters an OCCConflictError
    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(OCCConflictError);
      }
    }

    // Verify version is advanced to 2 and version 1 is archived
    const currentMem = memRepo.getMemory('project', projectId, sharedKey);
    expect(currentMem?.version).toBe(2);

    const archivedVersions = db.query<any>(
      `SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version ASC`,
      initial.id
    );
    expect(archivedVersions.length).toBeGreaterThanOrEqual(1);
    expect(archivedVersions[0].version).toBe(1);

    // Phase B: Optimistic retry convergence loop with jitter
    const retryPromises = rejected.map((_, i) => {
      return (async () => {
        let attempts = 0;
        while (attempts < 30) {
          attempts++;
          try {
            const latest = memRepo.getMemory('project', projectId, sharedKey);
            if (!latest) throw new Error('Memory missing during retry');

            return memRepo.setMemory({
              scope: 'project',
              scopeId: projectId,
              type: 'decision',
              key: sharedKey,
              value: { architecture: `Retry Winner ${i}` },
              expectedVersion: latest.version,
              updatedByRunId: `run-retry-${i}`,
            });
          } catch (err) {
            if (err instanceof OCCConflictError) {
              // Randomized backoff jitter
              await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 20)));
              continue;
            }
            throw err;
          }
        }
        throw new Error(`Worker ${i} failed to converge after ${attempts} attempts`);
      })();
    });

    const retryResults = await Promise.all(retryPromises);
    expect(retryResults).toHaveLength(workerCount - 1);

    // Final memory version must equal 1 (initial) + 1 (winner) + 24 (retries) = 26
    const finalMem = memRepo.getMemory('project', projectId, sharedKey);
    expect(finalMem?.version).toBe(1 + workerCount);
  });

  // --------------------------------------------------------------------------
  // Stress Scenario 3: Thread Lease Exhaustion & Stalled Worker Reclamation
  // --------------------------------------------------------------------------
  it('Scenario 3: Thread lease exclusivity rejects competing agents, and stalled task leases are auto-reclaimed', async () => {
    const channelService = new ChannelService(db);
    const taskRepo = new TaskRepository(db);

    // 1. Thread Lease Contention: 30 agents race to acquire the same thread lease
    const parentMsgId = `msg-root-${Date.now()}`;
    const agentCount = 30;

    const leaseAttempts = Array.from({ length: agentCount }, (_, i) => {
      return channelService.acquireThreadLease('chan-stress', parentMsgId, `ag-stress-${i}`, 10000);
    });

    const acquiredTrue = leaseAttempts.filter((a) => a === true);
    const acquiredFalse = leaseAttempts.filter((a) => a === false);

    // Exactly one agent acquires the lease
    expect(acquiredTrue).toHaveLength(1);
    expect(acquiredFalse).toHaveLength(agentCount - 1);

    channelService.releaseThreadLease('chan-stress', parentMsgId);

    // 2. Task Lease Contention across 5 ready tasks
    const readyTaskIds: string[] = [];
    for (let t = 0; t < 5; t++) {
      const taskId = `task-stress-claim-${t}-${Date.now()}`;
      const task: Task = {
        id: taskId,
        goalId,
        title: `Parallel Task ${t}`,
        description: 'Test atomic lease claims under contention',
        status: 'ready',
        verificationSpec: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      taskRepo.createTask(task);
      readyTaskIds.push(taskId);
    }

    // 30 workers attempt to claim the 5 tasks
    const claimResults = Array.from({ length: agentCount }, (_, i) => {
      const targetTaskId = readyTaskIds[i % 5];
      const runId = `run-claim-${i}-${Date.now()}`;
      return taskRepo.claimTaskWithLease(targetTaskId, `ag-stress-${i}`, runId, 60000);
    });

    const claimedSuccess = claimResults.filter((c) => c === true);
    expect(claimedSuccess).toHaveLength(5);

    // 3. Crash Simulation: Mark 2 worker runs as failed
    const claimedTasks = readyTaskIds.map((id) => taskRepo.getTask(id)!);
    const taskToCrash1 = claimedTasks[0];
    const taskToCrash2 = claimedTasks[1];

    db.execute(
      `UPDATE agent_runs SET state = 'failed' WHERE id IN (?, ?)`,
      taskToCrash1.claimedByRunId,
      taskToCrash2.claimedByRunId
    );

    // Also simulate expired lease on task 1
    db.execute(
      `UPDATE tasks SET lease_expires_at = ? WHERE id = ?`,
      Date.now() - 10000,
      taskToCrash1.id
    );

    // Reclaim expired/failed leases
    const reclaimed = taskRepo.reclaimExpiredTaskLeases();
    expect(reclaimed).toContain(taskToCrash1.id);

    // Verify reclaimed task is reset to 'ready' with cleared lease
    const refreshed = taskRepo.getTask(taskToCrash1.id);
    expect(refreshed?.status).toBe('ready');
    expect(refreshed?.claimedByRunId).toBeUndefined();
    expect(refreshed?.leaseExpiresAt).toBeUndefined();
    expect(refreshed?.retryCount).toBeGreaterThanOrEqual(1);

    // Idle worker can immediately re-claim the task
    const reClaimed = taskRepo.claimTaskWithLease(taskToCrash1.id, 'ag-stress-0', 'run-idle-1', 60000);
    expect(reClaimed).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Stress Scenario 4: Deadlock Prevention, Quota Throttling & DAG Cycle Injections
  // --------------------------------------------------------------------------
  it('Scenario 4: Kernel concurrency quota caps active runs at 8, and DAG cycle detector intercepts deadlock loops', () => {
    const kernel = new AgentKernel(db);
    const taskRepo = new TaskRepository(db);

    // 1. Concurrency Quota: Spawn 30 runs with queueIfExceeded: true
    const spawnedRuns: any[] = [];
    for (let i = 0; i < 30; i++) {
      const run = kernel.spawnRun({
        agentId: `ag-stress-${i}`,
        projectId,
        queueIfExceeded: true,
      });
      spawnedRuns.push(run);
    }

    const runningCount = spawnedRuns.filter((r) => r.state === 'running').length;
    const queuedCount = spawnedRuns.filter((r) => r.state === 'queued').length;

    // Active runs are capped at maxActiveConcurrentRuns (8)
    expect(runningCount).toBe(8);
    expect(queuedCount).toBe(22);

    // Complete one running run and verify queue admission
    const runningRun = spawnedRuns.find((r) => r.state === 'running')!;
    kernel.transitionState(runningRun.id, 'completed', 'Execution completed successfully');

    const admittedRun = kernel.admitNextQueuedRun();
    expect(admittedRun).toBeDefined();
    expect(admittedRun?.state).toBe('running');

    // 2. DAG Deadlock Cycle Prevention: Attempt circular cycle injection
    const taskAId = `dag-node-a-${Date.now()}`;
    const taskBId = `dag-node-b-${Date.now()}`;
    const taskCId = `dag-node-c-${Date.now()}`;

    taskRepo.createTask({
      id: taskAId,
      goalId,
      title: 'Node A',
      description: 'A',
      status: 'ready',
      verificationSpec: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    taskRepo.createTask({
      id: taskBId,
      goalId,
      title: 'Node B',
      description: 'B depends on A',
      status: 'backlog',
      verificationSpec: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, [taskAId]);

    taskRepo.createTask({
      id: taskCId,
      goalId,
      title: 'Node C',
      description: 'C depends on B',
      status: 'backlog',
      verificationSpec: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, [taskBId]);

    // Attempting to make A depend on C (C -> B -> A -> C) would create a circular deadlock
    expect(taskRepo.wouldCreateCycle(taskAId, taskCId)).toBe(true);

    // Adding circular dependency must be rejected
    expect(() => {
      taskRepo.addTaskDependency(taskAId, taskCId);
    }).toThrow();
  });

  // --------------------------------------------------------------------------
  // Stress Scenario 5: Cascading Task DAG Cancellations & Run Cleanup
  // --------------------------------------------------------------------------
  it('Scenario 5: Cancelling root task in 51-node DAG cleanly cascades blocked state to all 50 dependents', () => {
    const taskRepo = new TaskRepository(db);
    const kernel = new AgentKernel(db);
    const now = Date.now();

    // Build a 51-task fan-out diamond graph:
    // Level 0: 1 Root Task (T-0)
    // Level 1: 5 Tasks (T-1-0 .. T-1-4)
    // Level 2: 15 Tasks (T-2-0 .. T-2-14)
    // Level 3: 30 Tasks (T-3-0 .. T-3-29)

    const rootTaskId = `T-root-${crypto.randomUUID()}`;
    taskRepo.createTask({
      id: rootTaskId,
      goalId,
      title: 'Root Task 0',
      description: 'Root of DAG',
      status: 'running',
      verificationSpec: {},
      createdAt: now,
      updatedAt: now,
    });

    // Level 1: 5 tasks
    const level1Ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `T-1-${i}-${crypto.randomUUID()}`;
      taskRepo.createTask({
        id,
        goalId,
        title: `Level 1 Task ${i}`,
        description: `Depends on Root`,
        status: 'ready',
        verificationSpec: {},
        createdAt: now,
        updatedAt: now,
      }, [rootTaskId]);
      level1Ids.push(id);
    }

    // Level 2: 15 tasks
    const level2Ids: string[] = [];
    for (let i = 0; i < 15; i++) {
      const id = `T-2-${i}-${crypto.randomUUID()}`;
      const parentId = level1Ids[i % 5];
      taskRepo.createTask({
        id,
        goalId,
        title: `Level 2 Task ${i}`,
        description: `Depends on Level 1`,
        status: 'backlog',
        verificationSpec: {},
        createdAt: now,
        updatedAt: now,
      }, [parentId]);
      level2Ids.push(id);
    }

    // Level 3: 30 tasks
    const level3Ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const id = `T-3-${i}-${crypto.randomUUID()}`;
      const parentId = level2Ids[i % 15];
      taskRepo.createTask({
        id,
        goalId,
        title: `Level 3 Task ${i}`,
        description: `Depends on Level 2`,
        status: 'backlog',
        verificationSpec: {},
        createdAt: now,
        updatedAt: now,
      }, [parentId]);
      level3Ids.push(id);
    }

    // Assign active runs to 5 tasks across Level 1
    const activeRuns: string[] = [];
    for (let i = 0; i < 5; i++) {
      const run = kernel.spawnRun({
        agentId: `ag-stress-${i}`,
        projectId,
        taskId: level1Ids[i],
        queueIfExceeded: true,
      });
      activeRuns.push(run.id);
    }

    // Action: Cancel the Root Task and cascade blocking down the graph
    taskRepo.updateTaskStatus(rootTaskId, 'cancelled');
    const blockedIds = taskRepo.cascadeBlockDependents(rootTaskId);

    // Cancel linked active agent runs
    for (const runId of activeRuns) {
      kernel.transitionState(runId, 'cancelled', 'Upstream DAG dependency cancelled');
    }

    // Assertions:
    // 1. Root task status is 'cancelled'
    const rootTask = taskRepo.getTask(rootTaskId);
    expect(rootTask?.status).toBe('cancelled');

    // 2. All 50 downstream tasks (Level 1, 2, 3) must be in status 'blocked'
    const allDownstreamIds = [...level1Ids, ...level2Ids, ...level3Ids];
    expect(allDownstreamIds).toHaveLength(50);

    for (const id of allDownstreamIds) {
      const t = taskRepo.getTask(id);
      expect(t?.status).toBe('blocked');
    }

    // 3. Zero downstream tasks remain in 'ready', 'backlog', or 'assigned'
    const activeDownstreamCount = db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM tasks WHERE id IN (${allDownstreamIds.map(() => '?').join(',')}) AND status IN ('ready', 'backlog', 'assigned', 'running')`,
      ...allDownstreamIds
    )?.count;
    expect(activeDownstreamCount).toBe(0);

    // 4. All active agent runs are cleanly cancelled
    for (const runId of activeRuns) {
      const run = kernel.getRun(runId);
      expect(run?.state).toBe('cancelled');
    }
  });
});
