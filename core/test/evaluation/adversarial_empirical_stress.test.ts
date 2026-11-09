// ============================================================================
// EMPIRICAL CHALLENGER STRESS HARNESS: MILESTONE 4
// Rigorous adversarial stress testing for Feature 36 & Feature 37:
// - 100-worker OCC race and retry convergence
// - OCC key collision on initialization (version 0)
// - Deep DAG cancellation (100 nodes) and running-node orphan analysis
// - Full cycle detection permutations (self, 2-hop, 5-hop, diamond DAG)
// - Real vs typo method audit (addDependency vs addTaskDependency)
// - Extreme and asymmetric hardware profiling matrix (0-core, 128-core, cloud VM, etc.)
// - Full QA profiling suite across all 3 tiers
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
import { HardwareProfiler, HostHardwareSpecs } from '../../src/evaluation/hardware_profiler.js';
import { Task } from '../../src/domain/types.js';

describe('Empirical Challenger: Concurrency & Hardware Stress Harness', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  const workspaceId = 'ws-emp-stress';
  const projectId = 'proj-emp-stress';
  const definitionId = 'def-emp-stress';
  const goalId = 'goal-emp-stress';

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-emp-stress-'));
    dbPath = path.join(tempDir, 'kin_emp_stress.sqlite');

    db = new KinDatabase(dbPath);
    new MigrationRunner(db).runMigrations();

    const now = Date.now();
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, 'Empirical Stress Workspace', ?, 'AUTO', ?, ?)`,
      workspaceId,
      tempDir,
      now,
      now
    );

    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, 'Empirical Stress Project', ?, '{}', ?, ?)`,
      projectId,
      workspaceId,
      tempDir,
      now,
      now
    );

    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
       VALUES (?, 'Empirical Specialist', 'Worker', 'Empirical stress test worker.', 'ollama/llama3', '[]', '["fs:read","fs:write"]', ?)`,
      definitionId,
      now
    );

    db.execute(
      `INSERT INTO goals (id, project_id, title, description, status, acceptance_criteria_json, created_at, updated_at)
       VALUES (?, ?, 'Empirical Goal', 'Stress verification', 'active', '[]', ?, ?)`,
      goalId,
      projectId,
      now,
      now
    );

    // Seed 120 agent identities for high concurrency
    for (let i = 0; i < 120; i++) {
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ollama/llama3', 0, 0, ?, ?)`,
        `ag-emp-${i}`,
        workspaceId,
        projectId,
        definitionId,
        `EmpWorker ${i}`,
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
    db.execute('DELETE FROM checkpoints;');
    db.execute('DELETE FROM task_dependencies;');
    db.execute('DELETE FROM tasks;');
    db.execute('DELETE FROM agent_runs;');
    db.execute('DELETE FROM event_journal;');
    db.execute('DELETE FROM memory_versions;');
    db.execute('DELETE FROM memories;');
  });

  // ==========================================================================
  // SECTION 1: FEATURE 36 - OCC & CONCURRENCY SCALING STRESS
  // ==========================================================================

  it('Feature 36 [Stress 1]: 100 concurrent workers OCC race -> exactly 1 winner, 99 OCCConflictError, and complete retry convergence to version 101', async () => {
    const memRepo = new MemoryRepository(db);
    const key = `occ-stress-100-${Date.now()}`;

    // Seed version 1
    const initial = memRepo.setMemory({
      scope: 'project',
      scopeId: projectId,
      type: 'decision',
      key,
      value: { step: 0, winner: 'initial' },
      updatedByRunId: 'seed-run',
    });
    expect(initial.version).toBe(1);

    const workerCount = 100;
    // 100 concurrent workers all race with expectedVersion: 1
    const promises = Array.from({ length: workerCount }, (_, i) => {
      return (async () => {
        return memRepo.setMemory({
          scope: 'project',
          scopeId: projectId,
          type: 'decision',
          key,
          value: { step: 1, winner: `worker-${i}` },
          expectedVersion: 1,
          updatedByRunId: `run-race-${i}`,
        });
      })();
    });

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 winner at version 2
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(workerCount - 1);

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(OCCConflictError);
        expect((rej.reason as Error).message).toContain('OCC CONFLICT');
      }
    }

    const midMem = memRepo.getMemory('project', projectId, key);
    expect(midMem?.version).toBe(2);

    // Now execute retry convergence loop for the 99 losers
    const retryPromises = rejected.map((_, i) => {
      return (async () => {
        let attempts = 0;
        const maxAttempts = 60;
        while (attempts < maxAttempts) {
          attempts++;
          try {
            const current = memRepo.getMemory('project', projectId, key);
            if (!current) throw new Error('Key vanished');
            return memRepo.setMemory({
              scope: 'project',
              scopeId: projectId,
              type: 'decision',
              key,
              value: { step: current.version + 1, winner: `retry-${i}` },
              expectedVersion: current.version,
              updatedByRunId: `run-retry-${i}`,
            });
          } catch (err) {
            if (err instanceof OCCConflictError) {
              await new Promise((r) => setTimeout(r, 2 + Math.floor(Math.random() * 25)));
              continue;
            }
            throw err;
          }
        }
        throw new Error(`Worker ${i} failed after ${maxAttempts} retries`);
      })();
    });

    const retryResults = await Promise.all(retryPromises);
    expect(retryResults).toHaveLength(workerCount - 1);

    // Final version must be 1 (seed) + 1 (first winner) + 99 (retries) = 101
    const finalMem = memRepo.getMemory('project', projectId, key);
    expect(finalMem?.version).toBe(1 + workerCount);

    // Verify all 100 historical versions exist in memory_versions
    const versionHistory = db.query<any>(
      `SELECT version FROM memory_versions WHERE memory_id = ? ORDER BY version ASC`,
      initial.id
    );
    expect(versionHistory).toHaveLength(workerCount);
    for (let v = 1; v <= workerCount; v++) {
      expect(versionHistory[v - 1].version).toBe(v);
    }
  });

  it('Feature 36 [Stress 2]: 30 concurrent workers colliding on NEW memory insertion with expectedVersion 0', async () => {
    const memRepo = new MemoryRepository(db);
    const key = `occ-new-collision-${Date.now()}`;
    const workerCount = 30;

    const promises = Array.from({ length: workerCount }, (_, i) => {
      return (async () => {
        return memRepo.setMemory({
          scope: 'project',
          scopeId: projectId,
          type: 'semantic',
          key,
          value: { content: `Worker ${i} init` },
          expectedVersion: 0, // Explicitly asserting this must be a new creation
          updatedByRunId: `run-init-${i}`,
        });
      })();
    });

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 winner successfully inserts at version 1
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(workerCount - 1);

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason).toBeInstanceOf(OCCConflictError);
      }
    }

    const created = memRepo.getMemory('project', projectId, key);
    expect(created?.version).toBe(1);
  });

  // ==========================================================================
  // SECTION 2: FEATURE 36 - TASK DAG CANCELLATION & CASCADE STRESS
  // ==========================================================================

  it('Feature 36 [Stress 3]: Deep 100-node multi-level DAG cleanly cascades blocked state to all 100 nodes', () => {
    const taskRepo = new TaskRepository(db);
    const now = Date.now();

    // Graph structure:
    // Root -> 10 Level-1 tasks -> 30 Level-2 tasks -> 60 Level-3 tasks (101 nodes total)
    const rootId = `T-deep-root-${crypto.randomUUID()}`;
    taskRepo.createTask({
      id: rootId,
      goalId,
      title: 'Root',
      status: 'running',
      createdAt: now,
      updatedAt: now,
    });

    const level1: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `T-L1-${i}-${crypto.randomUUID()}`;
      taskRepo.createTask({
        id,
        goalId,
        title: `L1-${i}`,
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      }, [rootId]);
      level1.push(id);
    }

    const level2: string[] = [];
    for (let i = 0; i < 30; i++) {
      const id = `T-L2-${i}-${crypto.randomUUID()}`;
      const parent = level1[i % 10];
      taskRepo.createTask({
        id,
        goalId,
        title: `L2-${i}`,
        status: 'backlog',
        createdAt: now,
        updatedAt: now,
      }, [parent]);
      level2.push(id);
    }

    const level3: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `T-L3-${i}-${crypto.randomUUID()}`;
      const parent = level2[i % 30];
      taskRepo.createTask({
        id,
        goalId,
        title: `L3-${i}`,
        status: 'backlog',
        createdAt: now,
        updatedAt: now,
      }, [parent]);
      level3.push(id);
    }

    const allDownstream = [...level1, ...level2, ...level3];
    expect(allDownstream).toHaveLength(100);

    // Test direct cascadeBlockDependents invocation without updateTaskStatus
    const blocked = taskRepo.cascadeBlockDependents(rootId);
    expect(blocked).toHaveLength(100);

    // Verify every single downstream task is now 'blocked'
    for (const tid of allDownstream) {
      const t = taskRepo.getTask(tid);
      expect(t?.status).toBe('blocked');
    }

    // Now test that updateTaskStatus('cancelled') on another root also cascades automatically
    const rootId2 = `T-root2-${crypto.randomUUID()}`;
    taskRepo.createTask({ id: rootId2, goalId, title: 'Root2', status: 'running', createdAt: now, updatedAt: now });
    const childId2 = `T-child2-${crypto.randomUUID()}`;
    taskRepo.createTask({ id: childId2, goalId, title: 'Child2', status: 'ready', createdAt: now, updatedAt: now }, [rootId2]);

    taskRepo.updateTaskStatus(rootId2, 'cancelled');
    expect(taskRepo.getTask(childId2)?.status).toBe('blocked');

    // Zero unblocked tasks remaining
    const remaining = db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM tasks WHERE id IN (${allDownstream.map(() => '?').join(',')}) AND status != 'blocked'`,
      ...allDownstream
    )?.count;
    expect(remaining).toBe(0);
  });

  it('Feature 36 [Empirical Finding Investigation]: DAG cascade behavior when an intermediate node is in "running" status', () => {
    const taskRepo = new TaskRepository(db);
    const now = Date.now();

    // Node A (root) -> Node B (running) -> Node C (backlog)
    const taskA = `T-chain-A-${crypto.randomUUID()}`;
    const taskB = `T-chain-B-${crypto.randomUUID()}`;
    const taskC = `T-chain-C-${crypto.randomUUID()}`;

    taskRepo.createTask({ id: taskA, goalId, title: 'A', status: 'ready', createdAt: now, updatedAt: now });
    taskRepo.createTask({ id: taskB, goalId, title: 'B', status: 'ready', createdAt: now, updatedAt: now }, [taskA]);
    taskRepo.createTask({ id: taskC, goalId, title: 'C', status: 'backlog', createdAt: now, updatedAt: now }, [taskB]);

    // Simulate task B being claimed and transitioning to 'running'
    taskRepo.claimTaskWithLease(taskB, 'ag-emp-1', 'run-b-1', 60000);
    expect(taskRepo.getTask(taskB)?.status).toBe('running');

    // Now task A fails or is cancelled
    taskRepo.updateTaskStatus(taskA, 'cancelled');
    const blockedList = taskRepo.cascadeBlockDependents(taskA);

    // Empirical Observation:
    // Does cascadeBlockDependents block task B (which is running) and recurse to C?
    // In task_repository.ts line 157: WHERE status IN ('backlog', 'ready', 'assigned')
    // Task B is 'running', so it is NOT matched, and changes === 0, so recursion stops!
    const statusB = taskRepo.getTask(taskB)?.status;
    const statusC = taskRepo.getTask(taskC)?.status;

    // Record the empirical finding:
    // When intermediate node B is 'running', cascadeBlockDependents does not block B,
    // and C remains in 'backlog' (not blocked).
    expect(blockedList).not.toContain(taskB);
    expect(blockedList).not.toContain(taskC);
    expect(statusB).toBe('running');
    expect(statusC).toBe('backlog');
  });

  // ==========================================================================
  // SECTION 3: FEATURE 36 - DAG CYCLE DETECTION & METHOD AUDIT
  // ==========================================================================

  it('Feature 36 [Method Audit & Real Cycle Verification]: Auditing addDependency vs non-existent addTaskDependency', () => {
    const taskRepo = new TaskRepository(db);
    const now = Date.now();

    const taskA = `T-cyc-A-${crypto.randomUUID()}`;
    const taskB = `T-cyc-B-${crypto.randomUUID()}`;
    const taskC = `T-cyc-C-${crypto.randomUUID()}`;

    taskRepo.createTask({ id: taskA, goalId, title: 'A', status: 'ready', createdAt: now, updatedAt: now });
    taskRepo.createTask({ id: taskB, goalId, title: 'B', status: 'backlog', createdAt: now, updatedAt: now }, [taskA]);
    taskRepo.createTask({ id: taskC, goalId, title: 'C', status: 'backlog', createdAt: now, updatedAt: now }, [taskB]);

    // 1. Audit: In worker_m4_impl test line 458, taskRepo.addTaskDependency was called:
    expect((taskRepo as any).addTaskDependency).toBeUndefined();
    try {
      (taskRepo as any).addTaskDependency(taskA, taskC);
      expect.fail('Should have thrown TypeError');
    } catch (e: any) {
      expect(e).toBeInstanceOf(TypeError);
      expect(e.message).toContain('is not a function');
    }

    // 2. Real Cycle Prevention: Calling the actual method taskRepo.addDependency
    expect(taskRepo.wouldCreateCycle(taskA, taskC)).toBe(true);
    expect(() => {
      taskRepo.addDependency(taskA, taskC);
    }).toThrow(/would introduce a cycle/);

    // 3. Self-dependency rejection
    expect(taskRepo.wouldCreateCycle(taskA, taskA)).toBe(true);
    expect(() => {
      taskRepo.addDependency(taskA, taskA);
    }).toThrow(/Self-dependency not permitted/);

    // 4. Diamond DAG is NOT a cycle
    // D depends on B and C, which both depend on A
    const taskD = `T-cyc-D-${crypto.randomUUID()}`;
    taskRepo.createTask({ id: taskD, goalId, title: 'D', status: 'backlog', createdAt: now, updatedAt: now }, [taskB]);
    expect(taskRepo.wouldCreateCycle(taskD, taskC)).toBe(false);
    expect(() => {
      taskRepo.addDependency(taskD, taskC);
    }).not.toThrow();

    // 5. 5-hop long circular dependency rejection
    // E -> F -> G -> H -> I
    const nodes = Array.from({ length: 5 }, (_, idx) => `T-chain-${idx}-${crypto.randomUUID()}`);
    for (let idx = 0; idx < 5; idx++) {
      const deps = idx > 0 ? [nodes[idx - 1]] : [];
      taskRepo.createTask({ id: nodes[idx], goalId, title: `Node ${idx}`, status: 'ready', createdAt: now, updatedAt: now }, deps);
    }
    // Attempt to make node 0 depend on node 4 (5-hop loop)
    expect(taskRepo.wouldCreateCycle(nodes[0], nodes[4])).toBe(true);
    expect(() => {
      taskRepo.addDependency(nodes[0], nodes[4]);
    }).toThrow(/would introduce a cycle/);
  });

  // ==========================================================================
  // SECTION 4: FEATURE 37 - HARDWARE PROFILER MATRIX & EXTREME PROFILES
  // ==========================================================================

  it('Feature 37 [Matrix & Extreme Profiles]: Evaluates full classification boundary matrix and extreme specifications', () => {
    const profiler = new HardwareProfiler();

    // 1. Boundary: RAM 11.9 GB vs 12.0 GB
    const sub12Ram = profiler.detectHostHardware({ totalRamGB: 11.9, cpuCores: 8 });
    expect(profiler.classifyTier(sub12Ram)).toBe('baseline_laptop');

    const exact12Ram = profiler.detectHostHardware({ totalRamGB: 12.0, cpuCores: 8 });
    expect(profiler.classifyTier(exact12Ram)).toBe('standard_developer');

    // 2. Boundary: RAM 27.9 GB vs 28.0 GB
    const sub28Ram = profiler.detectHostHardware({ totalRamGB: 27.9, cpuCores: 8 });
    expect(profiler.classifyTier(sub28Ram)).toBe('standard_developer');

    const exact28Ram = profiler.detectHostHardware({ totalRamGB: 28.0, cpuCores: 8 });
    expect(profiler.classifyTier(exact28Ram)).toBe('performance_workstation');

    // 3. Boundary: CPU Cores 4 vs 5 vs 11 vs 12
    const cores4 = profiler.detectHostHardware({ totalRamGB: 16, cpuCores: 4 });
    expect(profiler.classifyTier(cores4)).toBe('baseline_laptop'); // <= 4 cores forces baseline

    const cores5 = profiler.detectHostHardware({ totalRamGB: 16, cpuCores: 5 });
    expect(profiler.classifyTier(cores5)).toBe('standard_developer');

    const cores11 = profiler.detectHostHardware({ totalRamGB: 16, cpuCores: 11 });
    expect(profiler.classifyTier(cores11)).toBe('standard_developer');

    const cores12 = profiler.detectHostHardware({ totalRamGB: 16, cpuCores: 12 });
    expect(profiler.classifyTier(cores12)).toBe('performance_workstation'); // >= 12 cores promotes

    // 4. Extreme / Asymmetric Profiles
    // Extreme high-memory VM (Cloud VM: 4 vCPUs, 64GB RAM)
    const cloudVm = profiler.detectHostHardware({ totalRamGB: 64, cpuCores: 4 });
    expect(profiler.classifyTier(cloudVm)).toBe('baseline_laptop'); // Empirical: 4 cores throttles it

    // High core low RAM (e.g. Raspberry Pi cluster node: 16 cores, 8GB RAM)
    const highCoreLowRam = profiler.detectHostHardware({ totalRamGB: 8, cpuCores: 16 });
    expect(profiler.classifyTier(highCoreLowRam)).toBe('baseline_laptop'); // RAM < 12 forces baseline

    // Massive HPC node (128 cores, 1024 GB RAM)
    const hpc = profiler.detectHostHardware({ totalRamGB: 1024, cpuCores: 128 });
    expect(profiler.classifyTier(hpc)).toBe('performance_workstation');
    // Empirical Finding: detectHostHardware computes estimatedVram from physical os.totalmem()
    // before merging overrides; thus simulated overrides without explicit estimatedVramGB inherit
    // host physical VRAM estimation. When explicit override is provided, it is honored:
    const hpcExplicit = profiler.detectHostHardware({ totalRamGB: 1024, cpuCores: 128, estimatedVramGB: 16 });
    expect(hpcExplicit.estimatedVramGB).toBe(16);

    // Degenerate values (0 GB RAM, 0 cores)
    const zeroHardware = profiler.detectHostHardware({ totalRamGB: 0, cpuCores: 0 });
    expect(profiler.classifyTier(zeroHardware)).toBe('baseline_laptop');

    // Explicit VRAM overrides
    const specMidVram = profiler.detectHostHardware({ totalRamGB: 16, cpuCores: 8, estimatedVramGB: 8 });
    expect(specMidVram.estimatedVramGB).toBe(8);

    const specLowVram = profiler.detectHostHardware({ totalRamGB: 8, cpuCores: 4, estimatedVramGB: 0 });
    expect(specLowVram.estimatedVramGB).toBe(0);
  });

  it('Feature 37 [Full QA Suite on All 3 Tiers]: Validates benchmark suite across baseline_laptop, standard_developer, and performance_workstation', async () => {
    const profiler = new HardwareProfiler();
    const tiers: ('baseline_laptop' | 'standard_developer' | 'performance_workstation')[] = [
      'baseline_laptop',
      'standard_developer',
      'performance_workstation',
    ];

    for (const tier of tiers) {
      const report = await profiler.runFullHardwareQASuite(db, tier);

      expect(report.assignedTier).toBe(tier);
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.constraints.tier).toBe(tier);
      expect(report.constraints.recommendedLocalModels.length).toBeGreaterThan(0);

      // Verify all benchmarks completed
      expect(report.metrics.sqliteThroughput.totalWrites).toBe(200);
      expect(report.metrics.sqliteThroughput.writesPerSecond).toBeGreaterThan(0);
      expect(report.metrics.sqliteThroughput.passed).toBe(true);

      expect(report.metrics.contextCompilation.tokenBudget).toBe(report.constraints.contextWindowTokens);
      expect(report.metrics.contextCompilation.passed).toBe(true);

      expect(report.metrics.compactionReduction.messagesCompacted).toBe(30);
      expect(report.metrics.compactionReduction.reductionRatioPercent).toBeGreaterThanOrEqual(40);
      expect(report.metrics.compactionReduction.passed).toBe(true);

      expect(report.metrics.startupLatency.durationMs).toBeGreaterThan(0);
      expect(report.metrics.startupLatency.passed).toBe(true);

      // Verify overall passed verdict
      expect(report.overallPassed).toBe(true);
    }
  });

  // ==========================================================================
  // SECTION 5: THREAD LEASE & TASK RECLAMATION STRESS
  // ==========================================================================

  it('Feature 36 [Lease Stress]: 50 concurrent agents racing for thread lease & task lease exclusivity', async () => {
    const channelService = new ChannelService(db);
    const taskRepo = new TaskRepository(db);
    const parentMsgId = `emp-msg-root-${Date.now()}`;
    const agentCount = 50;

    // 1. Thread lease race
    const leaseAttempts = Array.from({ length: agentCount }, (_, i) => {
      return channelService.acquireThreadLease('chan-emp-stress', parentMsgId, `ag-emp-${i}`, 30000);
    });

    const acquired = leaseAttempts.filter((a) => a === true);
    expect(acquired).toHaveLength(1);

    channelService.releaseThreadLease('chan-emp-stress', parentMsgId);

    // 2. 50 workers racing for 10 ready tasks
    const taskIds: string[] = [];
    for (let t = 0; t < 10; t++) {
      const id = `task-emp-contend-${t}-${Date.now()}`;
      taskRepo.createTask({
        id,
        goalId,
        title: `Task ${t}`,
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      taskIds.push(id);
    }

    const claimResults = Array.from({ length: agentCount }, (_, i) => {
      const targetId = taskIds[i % 10];
      return taskRepo.claimTaskWithLease(targetId, `ag-emp-${i}`, `run-claim-emp-${i}`, 60000);
    });

    const successfulClaims = claimResults.filter((c) => c === true);
    expect(successfulClaims).toHaveLength(10);

    // Expire 3 tasks and verify reclamation
    for (let t = 0; t < 3; t++) {
      db.execute(`UPDATE tasks SET lease_expires_at = ? WHERE id = ?`, Date.now() - 5000, taskIds[t]);
    }

    const reclaimed = taskRepo.reclaimExpiredTaskLeases();
    expect(reclaimed.length).toBeGreaterThanOrEqual(3);
    for (let t = 0; t < 3; t++) {
      expect(reclaimed).toContain(taskIds[t]);
      expect(taskRepo.getTask(taskIds[t])?.status).toBe('ready');
    }
  });
});
