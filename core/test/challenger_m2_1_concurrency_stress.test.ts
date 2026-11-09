import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import {
  RunStateMachine,
  StateTransitionError,
  RUN_STATE_TRANSITIONS,
  AuthoritativeRunState,
} from '../src/kernel/state_machine.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import { ChannelService } from '../src/communication/channel_service.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { DynamicHiringService, HiringProposal } from '../src/kernel/dynamic_hiring.js';
import { RunState, TaskStatus } from '../src/domain/types.js';

describe('Adversarial Challenger M2-1: Concurrency & State Transition Stress Harness', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let migrationRunner: MigrationRunner;
  let kernel: AgentKernel;
  let channelService: ChannelService;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-challenger-m2-1-'));
    dbPath = path.join(tempDir, 'challenger_m2_1.db');
    db = new KinDatabase(dbPath);
    migrationRunner = new MigrationRunner(db);
    migrationRunner.runMigrations();
    seedTestFixtures(db, tempDir);

    kernel = new AgentKernel(db);
    channelService = new ChannelService(db);
    taskRepo = new TaskRepository(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function seedTestFixtures(database: KinDatabase, rootPath: string) {
    const now = Date.now();
    database.execute(
      `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-stress', 'Stress Workspace', ?, 'AUTO', ?, ?);`,
      rootPath,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, created_at, updated_at)
       VALUES ('proj-stress', 'ws-stress', 'Stress Project', ?, ?, ?);`,
      rootPath,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, capabilities_json, created_at)
       VALUES ('def-root-boss', 'Boss', 'Orchestrator', 'You are Boss', 'mock-model', '["*"]', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
       VALUES ('agent-root-boss', 'ws-stress', 'proj-stress', 'def-root-boss', '@Boss', 'mock-model', 1, 0, ?, ?);`,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO channels (id, project_id, name, channel_type, created_at)
       VALUES ('chan-stress', 'proj-stress', 'general', 'channel', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO channel_members (channel_id, agent_id, joined_at)
       VALUES ('chan-stress', 'agent-root-boss', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
       VALUES ('goal-stress', 'proj-stress', 'Milestone Stress Goal', 'Stress verification', '[]', 'active', ?, ?);`,
      now,
      now
    );
  }

  // ==========================================================================
  // CHALLENGE 1: 13-State Machine & Illegal Transitions / Immutability
  // ==========================================================================
  describe('Adversarial Challenge 1: 13-State Machine Lifecycle & Terminal Immutability', () => {
    const ALL_13_STATES: AuthoritativeRunState[] = [
      'created',
      'queued',
      'running',
      'paused_approval',
      'paused_rate_limit',
      'paused_user',
      'resuming',
      'cancelling',
      'cancelled',
      'completed',
      'failed',
      'quota_paused',
      'interrupted',
    ];

    it('rejects all known illegal state transitions with StateTransitionError', () => {
      const forbiddenTransitions: Array<[AuthoritativeRunState, AuthoritativeRunState]> = [
        ['created', 'completed'],
        ['created', 'failed'],
        ['created', 'paused_user'],
        ['created', 'resuming'],
        ['queued', 'completed'],
        ['queued', 'paused_user'],
        ['queued', 'failed'],
        ['paused_user', 'completed'],
        ['paused_user', 'failed'],
        ['paused_approval', 'completed'],
        ['cancelling', 'running'],
        ['cancelling', 'completed'],
        ['cancelling', 'resuming'],
        ['cancelling', 'paused_user'],
        ['resuming', 'completed'],
        ['interrupted', 'completed'],
        ['interrupted', 'failed'],
      ];

      for (const [from, to] of forbiddenTransitions) {
        expect(
          RunStateMachine.isValidTransition(from, to),
          `Transition ${from} -> ${to} should be illegal`
        ).toBe(false);

        expect(
          () => RunStateMachine.validateTransition(from, to),
          `validateTransition(${from}, ${to}) must throw StateTransitionError`
        ).toThrow(StateTransitionError);
      }
    });

    it('exhaustively audits all 169 combinations in the 13-state transition matrix', () => {
      let validCount = 0;
      let invalidCount = 0;

      for (const from of ALL_13_STATES) {
        for (const to of ALL_13_STATES) {
          const isValid = RunStateMachine.isValidTransition(from, to);
          const normFrom = RunStateMachine.normalizeRunState(from);
          const normTo = RunStateMachine.normalizeRunState(to);

          if (from === to || normFrom === normTo) {
            // Self-transitions and canonical-alias equivalences are idempotent
            expect(isValid).toBe(true);
            validCount++;
          } else {
            const allowed = RUN_STATE_TRANSITIONS[from] || [];
            const expectedValid =
              allowed.includes(to) ||
              allowed.includes(normTo) ||
              (RUN_STATE_TRANSITIONS[normFrom] || []).includes(normTo);

            if (RunStateMachine.isTerminal(from)) {
              expect(isValid, `Terminal state ${from} must never transition to ${to}`).toBe(false);
              expect(() => RunStateMachine.validateTransition(from, to)).toThrow(
                StateTransitionError
              );
              invalidCount++;
            } else if (expectedValid) {
              expect(isValid, `Expected transition ${from} -> ${to} to be valid`).toBe(true);
              validCount++;
            } else {
              expect(isValid, `Expected transition ${from} -> ${to} to be rejected`).toBe(false);
              expect(() => RunStateMachine.validateTransition(from, to)).toThrow(
                StateTransitionError
              );
              invalidCount++;
            }
          }
        }
      }

      expect(validCount + invalidCount).toBe(169);
    });

    it('strictly enforces terminal state immutability across all 3 terminal states', () => {
      const terminalStates: AuthoritativeRunState[] = ['completed', 'failed', 'cancelled'];

      for (const terminal of terminalStates) {
        expect(RunStateMachine.isTerminal(terminal)).toBe(true);
        expect(RunStateMachine.getAvailableTransitions(terminal)).toEqual([]);

        for (const targetState of ALL_13_STATES) {
          if (targetState === terminal) continue;
          expect(
            RunStateMachine.isValidTransition(terminal, targetState),
            `Terminal state ${terminal} cannot transition to ${targetState}`
          ).toBe(false);

          expect(
            () => RunStateMachine.validateTransition(terminal, targetState),
            `validateTransition from terminal ${terminal} to ${targetState} must throw`
          ).toThrow(StateTransitionError);
        }
      }
    });

    it('enforces terminal state immutability in AgentKernel against SQLite database', () => {
      const run = kernel.spawnRun({
        agentId: 'agent-root-boss',
        projectId: 'proj-stress',
      });

      kernel.transitionState(run.id, 'running');
      kernel.transitionState(run.id, 'completed');

      const completedRun = kernel.getRun(run.id);
      expect(completedRun?.state).toBe('completed');
      expect(completedRun?.completedAt).toBeDefined();

      expect(() => kernel.transitionState(run.id, 'running')).toThrow(StateTransitionError);
      expect(() => kernel.transitionState(run.id, 'queued')).toThrow(StateTransitionError);
      expect(() => kernel.transitionState(run.id, 'paused_user')).toThrow(StateTransitionError);
      expect(() => kernel.transitionState(run.id, 'resuming')).toThrow(StateTransitionError);
      expect(() => kernel.transitionState(run.id, 'failed')).toThrow(StateTransitionError);
      expect(() => kernel.transitionState(run.id, 'cancelled')).toThrow(StateTransitionError);

      const preservedRun = kernel.getRun(run.id);
      expect(preservedRun?.state).toBe('completed');
    });

    it('maintains run state integrity through multi-step lifecycle with rollback on illegal jump', () => {
      const runId = 'run-lifecycle-stress';
      db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
         VALUES (?, 'agent-root-boss', 'proj-stress', 'created', ?, 10000, 0, ?)`,
        runId,
        Date.now(),
        Date.now()
      );

      expect(kernel.getRun(runId)?.state).toBe('created');

      // created -> running (valid)
      kernel.transitionState(runId, 'running');
      expect(kernel.getRun(runId)?.state).toBe('running');

      // running -> paused_user (valid)
      kernel.transitionState(runId, 'paused_user');
      expect(kernel.getRun(runId)?.state).toBe('paused_user');

      // paused_user -> completed (ILLEGAL! must resume first)
      expect(() => kernel.transitionState(runId, 'completed')).toThrow(StateTransitionError);
      expect(kernel.getRun(runId)?.state).toBe('paused_user');

      // paused_user -> resuming (valid)
      kernel.transitionState(runId, 'resuming');
      expect(kernel.getRun(runId)?.state).toBe('resuming');

      // resuming -> running (valid)
      kernel.transitionState(runId, 'running');
      expect(kernel.getRun(runId)?.state).toBe('running');

      // running -> completed (valid)
      kernel.transitionState(runId, 'completed');
      expect(kernel.getRun(runId)?.state).toBe('completed');

      // completed -> running (ILLEGAL!)
      expect(() => kernel.transitionState(runId, 'running')).toThrow(StateTransitionError);
      expect(kernel.getRun(runId)?.state).toBe('completed');
    });

    it('survives 30 concurrent transition attempts on a terminal run without corrupting state', async () => {
      const run = kernel.spawnRun({
        agentId: 'agent-root-boss',
        projectId: 'proj-stress',
      });
      kernel.transitionState(run.id, 'running');
      kernel.transitionState(run.id, 'completed');

      const attempts = [
        'running',
        'queued',
        'resuming',
        'paused_user',
        'paused_approval',
        'quota_paused',
        'interrupted',
        'failed',
        'cancelled',
      ] as RunState[];

      const parallelPromises = Array.from({ length: 30 }, (_, i) => {
        const targetState = attempts[i % attempts.length];
        return new Promise<{ index: number; target: RunState; success: boolean; error?: any }>((resolve) => {
          try {
            kernel.transitionState(run.id, targetState);
            resolve({ index: i, target: targetState, success: true });
          } catch (err: any) {
            resolve({ index: i, target: targetState, success: false, error: err });
          }
        });
      });

      const results = await Promise.all(parallelPromises);

      for (const res of results) {
        expect(res.success).toBe(false);
        expect(res.error).toBeInstanceOf(StateTransitionError);
      }

      const dbRow = db.queryOne<{ state: string; completed_at: number }>(
        'SELECT state, completed_at FROM agent_runs WHERE id = ?',
        run.id
      );
      expect(dbRow?.state).toBe('completed');
      expect(dbRow?.completed_at).toBeGreaterThan(0);
    });

    it('handles concurrent race to terminal state: exactly one succeeds and terminal immutability holds', async () => {
      const run = kernel.spawnRun({
        agentId: 'agent-root-boss',
        projectId: 'proj-stress',
      });
      kernel.transitionState(run.id, 'running');

      const terminalTargets: RunState[] = ['completed', 'failed', 'cancelled'];

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => {
          const target = terminalTargets[i % terminalTargets.length];
          return new Promise<{ index: number; target: RunState; success: boolean; error?: any }>((resolve) => {
            try {
              kernel.transitionState(run.id, target);
              resolve({ index: i, target, success: true });
            } catch (err: any) {
              resolve({ index: i, target, success: false, error: err });
            }
          });
        })
      );

      const finalRow = db.queryOne<{ state: string }>(
        'SELECT state FROM agent_runs WHERE id = ?',
        run.id
      );
      expect(['completed', 'failed', 'cancelled']).toContain(finalRow?.state);
      expect(() => kernel.transitionState(run.id, 'running')).toThrow(StateTransitionError);
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Sequential Threading & Atomic Leases Under Concurrency
  // ==========================================================================
  describe('Adversarial Challenge 2: Sequential Threading & Atomic Leases', () => {
    it('executes 20 concurrent parallel lease acquisition attempts: exactly ONE succeeds, 19 rejected', async () => {
      const channelId = 'chan-stress';
      const parentMessageId = 'msg-thread-concurrency-root';

      channelService.postMessage({
        channelId,
        senderId: 'user-operator',
        senderType: 'human',
        content: 'Root prompt requiring sequential coordination',
      });

      const workerCount = 20;
      const results = await Promise.all(
        Array.from({ length: workerCount }, (_, i) => {
          const workerId = `worker-agent-${i}`;
          return new Promise<{ workerId: string; acquired: boolean }>((resolve) => {
            setTimeout(() => {
              const acquired = channelService.acquireThreadLease(
                channelId,
                parentMessageId,
                workerId,
                10000
              );
              resolve({ workerId, acquired });
            }, Math.random() * 5);
          });
        })
      );

      const successfulAcquisitions = results.filter((r) => r.acquired);
      const rejectedAcquisitions = results.filter((r) => !r.acquired);

      expect(successfulAcquisitions.length).toBe(1);
      expect(rejectedAcquisitions.length).toBe(19);

      const winner = successfulAcquisitions[0];
      expect(winner.workerId).toBeDefined();

      const secondWave = await Promise.all(
        Array.from({ length: 20 }, (_, i) => {
          const competitorId = `competitor-agent-${i}`;
          return new Promise<boolean>((resolve) => {
            const acquired = channelService.acquireThreadLease(
              channelId,
              parentMessageId,
              competitorId,
              10000
            );
            resolve(acquired);
          });
        })
      );
      expect(secondWave.every((a) => a === false)).toBe(true);

      // Verify non-owner cannot release winner's lease
      channelService.releaseThreadLease(channelId, parentMessageId, 'imposter-agent');

      const competitorAttempt = channelService.acquireThreadLease(
        channelId,
        parentMessageId,
        'competitor-agent-0',
        5000
      );
      expect(competitorAttempt).toBe(false);

      // Winner can renew lease
      const renewed = channelService.acquireThreadLease(
        channelId,
        parentMessageId,
        winner.workerId,
        15000
      );
      expect(renewed).toBe(true);

      // Winner cleanly releases lease
      channelService.releaseThreadLease(channelId, parentMessageId, winner.workerId);

      const nextClaim = channelService.acquireThreadLease(
        channelId,
        parentMessageId,
        'next-legitimate-worker',
        5000
      );
      expect(nextClaim).toBe(true);
    });

    it('isolates thread leases across distinct parentMessageIds under concurrent contention', async () => {
      const channelId = 'chan-stress';
      const thread1 = 'msg-thread-alpha';
      const thread2 = 'msg-thread-beta';

      // 15 workers on Thread 1, 15 workers on Thread 2 simultaneously
      const [results1, results2] = await Promise.all([
        Promise.all(
          Array.from({ length: 15 }, (_, i) => {
            return new Promise<boolean>((resolve) => {
              const acq = channelService.acquireThreadLease(channelId, thread1, `t1-worker-${i}`, 5000);
              resolve(acq);
            });
          })
        ),
        Promise.all(
          Array.from({ length: 15 }, (_, i) => {
            return new Promise<boolean>((resolve) => {
              const acq = channelService.acquireThreadLease(channelId, thread2, `t2-worker-${i}`, 5000);
              resolve(acq);
            });
          })
        ),
      ]);

      // Exactly 1 winner on Thread 1, and 1 winner on Thread 2
      expect(results1.filter(Boolean).length).toBe(1);
      expect(results2.filter(Boolean).length).toBe(1);
    });

    it('supports rapid sequential lease handoff across multiple workers', () => {
      const channelId = 'chan-stress';
      const threadId = 'msg-handoff-thread';

      const workers = ['worker-A', 'worker-B', 'worker-C', 'worker-D', 'worker-E'];
      for (const w of workers) {
        const acquired = channelService.acquireThreadLease(channelId, threadId, w, 5000);
        expect(acquired, `${w} should acquire lease after predecessor released`).toBe(true);
        channelService.releaseThreadLease(channelId, threadId, w);
      }
    });

    it('enforces automatic lease expiration (TTL expiry) under rapid polling', async () => {
      const channelId = 'chan-stress';
      const parentMessageId = 'msg-thread-ttl-test';

      const acquired1 = channelService.acquireThreadLease(
        channelId,
        parentMessageId,
        'worker-short-ttl',
        40
      );
      expect(acquired1).toBe(true);

      expect(
        channelService.acquireThreadLease(channelId, parentMessageId, 'worker-eager', 5000)
      ).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 60));

      const acquired2 = channelService.acquireThreadLease(
        channelId,
        parentMessageId,
        'worker-eager',
        5000
      );
      expect(acquired2).toBe(true);
    });

    it('maintains sequential thread reply ordering and parentMessageId lineage', () => {
      const channelId = 'chan-stress';
      const root = channelService.postMessage({
        channelId,
        senderId: 'user-stress',
        senderType: 'human',
        content: 'Original multi-specialist dispatch',
      });

      const specialists = ['agent-specialist-1', 'agent-specialist-2', 'agent-specialist-3'];
      const replies = specialists.map((specId, idx) => {
        return channelService.postMessage({
          channelId,
          senderId: specId,
          senderType: 'agent',
          content: `Specialist reply #${idx + 1} with analysis`,
          parentMessageId: root.id,
          productivityScore: 1,
        });
      });

      const threadReplies = channelService.getThreadReplies(channelId, root.id);
      expect(threadReplies.length).toBe(3);

      for (let i = 0; i < threadReplies.length; i++) {
        expect(threadReplies[i].id).toBe(replies[i].id);
        expect(threadReplies[i].parentMessageId).toBe(root.id);
        expect(threadReplies[i].senderId).toBe(specialists[i]);
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Task DAG Multi-Level Cascade Blocking & Cyclic Injection
  // ==========================================================================
  describe('Adversarial Challenge 3: Task DAG Dependencies & Multi-Level Cascade Blocking', () => {
    it('cascades blocked status down a multi-level chain (A -> B -> C -> D) on root failure', () => {
      taskRepo.createTask({
        id: 'task-A',
        goalId: 'goal-stress',
        title: 'Task A (Root)',
        description: 'Root upstream task',
        status: 'ready',
      });
      taskRepo.createTask({
        id: 'task-B',
        goalId: 'goal-stress',
        title: 'Task B (Level 1)',
        description: 'Depends on A',
        status: 'backlog',
      });
      taskRepo.createTask({
        id: 'task-C',
        goalId: 'goal-stress',
        title: 'Task C (Level 2)',
        description: 'Depends on B',
        status: 'backlog',
      });
      taskRepo.createTask({
        id: 'task-D',
        goalId: 'goal-stress',
        title: 'Task D (Level 3)',
        description: 'Depends on C',
        status: 'backlog',
      });

      taskRepo.addDependency('task-B', 'task-A');
      taskRepo.addDependency('task-C', 'task-B');
      taskRepo.addDependency('task-D', 'task-C');

      expect(taskRepo.getTaskDependencies('task-B')).toEqual(['task-A']);
      expect(taskRepo.getTaskDependencies('task-C')).toEqual(['task-B']);
      expect(taskRepo.getTaskDependencies('task-D')).toEqual(['task-C']);

      expect(taskRepo.getTaskDependents('task-A')).toEqual(['task-B']);
      expect(taskRepo.getTaskDependents('task-B')).toEqual(['task-C']);
      expect(taskRepo.getTaskDependents('task-C')).toEqual(['task-D']);

      taskRepo.updateTaskStatus('task-A', 'failed');

      const taskA = taskRepo.getTask('task-A');
      const taskB = taskRepo.getTask('task-B');
      const taskC = taskRepo.getTask('task-C');
      const taskD = taskRepo.getTask('task-D');

      expect(taskA?.status).toBe('failed');
      expect(taskB?.status).toBe('blocked');
      expect(taskC?.status).toBe('blocked');
      expect(taskD?.status).toBe('blocked');
    });

    it('preserves already completed tasks when upstream prerequisite cascades failure', () => {
      taskRepo.createTask({ id: 'task-root-f', goalId: 'goal-stress', title: 'Root', description: 'Root', status: 'ready' });
      taskRepo.createTask({ id: 'task-already-done', goalId: 'goal-stress', title: 'Done', description: 'Done', status: 'completed' });
      taskRepo.createTask({ id: 'task-pending', goalId: 'goal-stress', title: 'Pending', description: 'Pending', status: 'backlog' });

      taskRepo.addDependency('task-already-done', 'task-root-f');
      taskRepo.addDependency('task-pending', 'task-root-f');

      taskRepo.updateTaskStatus('task-root-f', 'failed');

      // The completed task MUST NOT be mutated to 'blocked'
      expect(taskRepo.getTask('task-already-done')?.status).toBe('completed');
      // The pending task must be cascaded to 'blocked'
      expect(taskRepo.getTask('task-pending')?.status).toBe('blocked');
    });

    it('cascades blocked status down a multi-level chain on cancellation', () => {
      taskRepo.createTask({ id: 'task-E', goalId: 'goal-stress', title: 'Task E', description: 'Root', status: 'ready' });
      taskRepo.createTask({ id: 'task-F', goalId: 'goal-stress', title: 'Task F', description: 'Dep E', status: 'backlog' });
      taskRepo.createTask({ id: 'task-G', goalId: 'goal-stress', title: 'Task G', description: 'Dep F', status: 'assigned' });
      taskRepo.createTask({ id: 'task-H', goalId: 'goal-stress', title: 'Task H', description: 'Dep G', status: 'backlog' });

      taskRepo.addDependency('task-F', 'task-E');
      taskRepo.addDependency('task-G', 'task-F');
      taskRepo.addDependency('task-H', 'task-G');

      taskRepo.updateTaskStatus('task-E', 'cancelled');

      expect(taskRepo.getTask('task-E')?.status).toBe('cancelled');
      expect(taskRepo.getTask('task-F')?.status).toBe('blocked');
      expect(taskRepo.getTask('task-G')?.status).toBe('blocked');
      expect(taskRepo.getTask('task-H')?.status).toBe('blocked');
    });

    it('cascades blocked status across diamond DAG topology (A -> (B1, B2) -> C -> D)', () => {
      taskRepo.createTask({ id: 'task-root', goalId: 'goal-stress', title: 'Root', description: 'Root', status: 'ready' });
      taskRepo.createTask({ id: 'task-b1', goalId: 'goal-stress', title: 'Branch 1', description: 'Dep root', status: 'backlog' });
      taskRepo.createTask({ id: 'task-b2', goalId: 'goal-stress', title: 'Branch 2', description: 'Dep root', status: 'backlog' });
      taskRepo.createTask({ id: 'task-join', goalId: 'goal-stress', title: 'Join', description: 'Dep b1 & b2', status: 'backlog' });
      taskRepo.createTask({ id: 'task-tail', goalId: 'goal-stress', title: 'Tail', description: 'Dep join', status: 'backlog' });

      taskRepo.addDependency('task-b1', 'task-root');
      taskRepo.addDependency('task-b2', 'task-root');
      taskRepo.addDependency('task-join', 'task-b1');
      taskRepo.addDependency('task-join', 'task-b2');
      taskRepo.addDependency('task-tail', 'task-join');

      taskRepo.updateTaskStatus('task-root', 'failed');

      expect(taskRepo.getTask('task-root')?.status).toBe('failed');
      expect(taskRepo.getTask('task-b1')?.status).toBe('blocked');
      expect(taskRepo.getTask('task-b2')?.status).toBe('blocked');
      expect(taskRepo.getTask('task-join')?.status).toBe('blocked');
      expect(taskRepo.getTask('task-tail')?.status).toBe('blocked');
    });

    it('detects and strictly rejects cyclic dependencies (A -> B -> C -> A) and self-loops', () => {
      taskRepo.createTask({ id: 'task-c1', goalId: 'goal-stress', title: 'C1', description: 'Node 1', status: 'ready' });
      taskRepo.createTask({ id: 'task-c2', goalId: 'goal-stress', title: 'C2', description: 'Node 2', status: 'backlog' });
      taskRepo.createTask({ id: 'task-c3', goalId: 'goal-stress', title: 'C3', description: 'Node 3', status: 'backlog' });

      // Self-dependency rejection
      expect(taskRepo.wouldCreateCycle('task-c1', 'task-c1')).toBe(true);
      expect(() => taskRepo.addDependency('task-c1', 'task-c1')).toThrow(
        /Self-dependency not permitted/
      );

      taskRepo.addDependency('task-c2', 'task-c1');
      taskRepo.addDependency('task-c3', 'task-c2');

      // Direct 2-node cycle: C1 cannot depend on C2
      expect(taskRepo.wouldCreateCycle('task-c1', 'task-c2')).toBe(true);
      expect(() => taskRepo.addDependency('task-c1', 'task-c2')).toThrow(
        /would introduce a cycle/
      );

      // Multi-hop 3-node cycle: C1 cannot depend on C3
      expect(taskRepo.wouldCreateCycle('task-c1', 'task-c3')).toBe(true);
      expect(() => taskRepo.addDependency('task-c1', 'task-c3')).toThrow(
        /would introduce a cycle/
      );

      const deps = taskRepo.getTaskDependencies('task-c1');
      expect(deps).toEqual([]);
    });

    it('rejects deep 7-node cycle (1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 1)', () => {
      const nodes = ['node-1', 'node-2', 'node-3', 'node-4', 'node-5', 'node-6', 'node-7'];
      for (const n of nodes) {
        taskRepo.createTask({ id: n, goalId: 'goal-stress', title: n, description: n, status: 'ready' });
      }

      taskRepo.addDependency('node-2', 'node-1');
      taskRepo.addDependency('node-3', 'node-2');
      taskRepo.addDependency('node-4', 'node-3');
      taskRepo.addDependency('node-5', 'node-4');
      taskRepo.addDependency('node-6', 'node-5');
      taskRepo.addDependency('node-7', 'node-6');

      expect(taskRepo.wouldCreateCycle('node-1', 'node-7')).toBe(true);
      expect(() => taskRepo.addDependency('node-1', 'node-7')).toThrow(
        /would introduce a cycle/
      );
    });
  });

  // ==========================================================================
  // CHALLENGE 4: Dynamic Hiring Attenuation & Depth Limits
  // ==========================================================================
  describe('Adversarial Challenge 4: Dynamic Hiring Attenuation & Depth Limits', () => {
    it('attenuates child capabilities against restricted parent agent permissions', () => {
      const now = Date.now();
      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, capabilities_json, created_at)
         VALUES ('def-restricted-parent', 'RestrictedDev', 'Dev', 'Prompt', 'mock-model', '["fs:read","fs:write"]', ?)`,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, parent_agent_id, created_at, updated_at)
         VALUES ('agent-restricted-parent', 'ws-stress', 'proj-stress', 'def-restricted-parent', '@RestrictedDev', 'mock-model', 0, 'agent-root-boss', ?, ?)`,
        now,
        now
      );

      const proposal = DynamicHiringService.createProposal(
        {
          displayName: 'EscalatedWorker',
          roleTitle: 'PrivilegedDev',
          capabilities: [
            'fs:read',
            'fs:write',
            'shell:exec',
            'agent:hire',
            'network:*',
            'admin:*',
            '*',
          ],
        },
        { agentId: 'agent-restricted-parent', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );

      expect(proposal.capabilities).toEqual(['fs:read', 'fs:write']);
      expect(proposal.capabilities).not.toContain('shell:exec');
      expect(proposal.capabilities).not.toContain('agent:hire');
      expect(proposal.capabilities).not.toContain('network:*');
      expect(proposal.capabilities).not.toContain('admin:*');
      expect(proposal.capabilities).not.toContain('*');
    });

    it('strictly attenuates arbitrary subset permissions: [fs:read, mcp:call]', () => {
      const now = Date.now();
      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, capabilities_json, created_at)
         VALUES ('def-subset-parent', 'SubsetDev', 'Dev', 'Prompt', 'mock-model', '["fs:read","mcp:call"]', ?)`,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at)
         VALUES ('agent-subset-parent', 'ws-stress', 'proj-stress', 'def-subset-parent', '@SubsetDev', 'mock-model', 0, ?, ?)`,
        now,
        now
      );

      const proposal = DynamicHiringService.createProposal(
        {
          displayName: 'SubsetChild',
          roleTitle: 'Worker',
          capabilities: ['fs:read', 'fs:write', 'mcp:call', 'shell:exec', 'network:*'],
        },
        { agentId: 'agent-subset-parent', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );

      expect(proposal.capabilities).toEqual(['fs:read', 'mcp:call']);
    });

    it('strictly strips capabilities when parent has empty permissions []', () => {
      const now = Date.now();
      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, capabilities_json, created_at)
         VALUES ('def-zero-cap', 'ZeroCapDev', 'Dev', 'Prompt', 'mock-model', '[]', ?)`,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at)
         VALUES ('agent-zero-cap', 'ws-stress', 'proj-stress', 'def-zero-cap', '@ZeroCap', 'mock-model', 0, ?, ?)`,
        now,
        now
      );

      const proposal = DynamicHiringService.createProposal(
        {
          displayName: 'EmptyChild',
          roleTitle: 'Worker',
          capabilities: ['shell:exec', 'fs:write'],
        },
        { agentId: 'agent-zero-cap', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );

      expect(proposal.capabilities).toEqual([]);
    });

    it('enforces delegation depth limit of 3 and prevents recursion beyond depth 3', () => {
      const now = Date.now();
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, parent_agent_id, created_at, updated_at)
         VALUES ('agent-level-1', 'ws-stress', 'proj-stress', 'def-root-boss', '@Level1', 'mock-model', 0, 'agent-root-boss', ?, ?)`,
        now,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, parent_agent_id, created_at, updated_at)
         VALUES ('agent-level-2', 'ws-stress', 'proj-stress', 'def-root-boss', '@Level2', 'mock-model', 0, 'agent-level-1', ?, ?)`,
        now,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, parent_agent_id, created_at, updated_at)
         VALUES ('agent-level-3', 'ws-stress', 'proj-stress', 'def-root-boss', '@Level3', 'mock-model', 0, 'agent-level-2', ?, ?)`,
        now,
        now
      );

      expect(DynamicHiringService.getDelegationDepth('agent-root-boss', db)).toBe(0);
      expect(DynamicHiringService.getDelegationDepth('agent-level-1', db)).toBe(1);
      expect(DynamicHiringService.getDelegationDepth('agent-level-2', db)).toBe(2);
      expect(DynamicHiringService.getDelegationDepth('agent-level-3', db)).toBe(3);

      expect(() => {
        DynamicHiringService.createProposal(
          {
            displayName: 'Level4Agent',
            roleTitle: 'ForbiddenDeepSubagent',
          },
          { agentId: 'agent-level-3', projectId: 'proj-stress', channelId: 'chan-stress' },
          db
        );
      }).toThrow(/Maximum delegation depth reached/);

      const checkRow = db.queryOne(
        `SELECT id FROM agent_identities WHERE display_name = '@Level4Agent'`
      );
      expect(checkRow).toBeUndefined();
    });

    it('enforces specialist capacity cap of 25 for non-ephemeral agents while allowing ephemeral agents', () => {
      const now = Date.now();
      // Count current non-ephemeral identities in proj-stress (agent-root-boss is 1)
      const initialCount = db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM agent_identities WHERE project_id = 'proj-stress' AND is_ephemeral = 0`
      )!.count;

      // Seed up to exactly 25 non-ephemeral specialists
      for (let i = initialCount; i < 25; i++) {
        db.execute(
          `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
           VALUES ('def-fill-${i}', 'Fill${i}', 'Worker', 'Prompt', 'mock-model', ?)`,
          now
        );
        db.execute(
          `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
           VALUES ('agent-fill-${i}', 'ws-stress', 'proj-stress', 'def-fill-${i}', '@Fill${i}', 'mock-model', 0, 0, ?, ?)`,
          now,
          now
        );
      }

      // Verify we have 25 persistent agents
      const atCap = db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM agent_identities WHERE project_id = 'proj-stress' AND is_ephemeral = 0`
      )!.count;
      expect(atCap).toBe(25);

      // Attempt to hire the 26th persistent specialist must throw capacity limit error
      const persistent26th = DynamicHiringService.createProposal(
        { displayName: 'OverCapDev', roleTitle: 'Dev', isEphemeral: false },
        { agentId: 'agent-root-boss', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );

      expect(() => {
        DynamicHiringService.executeHiring(
          persistent26th,
          { agentId: 'agent-root-boss', projectId: 'proj-stress', channelId: 'chan-stress' },
          db
        );
      }).toThrow(/Specialist capacity limit reached for project 'proj-stress'/);

      // Hiring an EPHEMERAL specialist at capacity MUST SUCCEED
      const ephemeralProposal = DynamicHiringService.createProposal(
        { displayName: 'EphemeralAtCap', roleTitle: 'TempDev', isEphemeral: true },
        { agentId: 'agent-root-boss', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );

      const hiredEphemeral = DynamicHiringService.executeHiring(
        ephemeralProposal,
        { agentId: 'agent-root-boss', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );

      expect(hiredEphemeral.agentId).toBeDefined();
      expect(hiredEphemeral.isEphemeral).toBe(true);

      // Clean up ephemeral
      DynamicHiringService.teardownEphemeralAgent(hiredEphemeral.agentId, db);
    });

    it('cleanly executes teardown of ephemeral agents and preserves persistent agents', () => {
      const ephemeralProposal = DynamicHiringService.createProposal(
        {
          displayName: 'EphemeralTempAgent',
          roleTitle: 'Researcher',
          isEphemeral: true,
        },
        { agentId: 'agent-root-boss', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );

      const hiredEphemeral = DynamicHiringService.executeHiring(
        ephemeralProposal,
        { agentId: 'agent-root-boss', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );

      expect(hiredEphemeral.isEphemeral).toBe(true);
      const ephId = hiredEphemeral.agentId;

      const ephIdentity = db.queryOne<{ id: string; is_ephemeral: number }>(
        'SELECT id, is_ephemeral FROM agent_identities WHERE id = ?',
        ephId
      );
      expect(ephIdentity?.is_ephemeral).toBe(1);

      const ephMember = db.queryOne<{ agent_id: string }>(
        'SELECT agent_id FROM channel_members WHERE agent_id = ? AND channel_id = ?',
        ephId,
        'chan-stress'
      );
      expect(ephMember).toBeDefined();

      const tornDown = DynamicHiringService.teardownEphemeralAgent(ephId, db);
      expect(tornDown).toBe(true);

      expect(
        db.queryOne('SELECT id FROM agent_identities WHERE id = ?', ephId)
      ).toBeUndefined();
      expect(
        db.queryOne('SELECT agent_id FROM channel_members WHERE agent_id = ?', ephId)
      ).toBeUndefined();

      const persistentProposal = DynamicHiringService.createProposal(
        {
          displayName: 'PersistentDev',
          roleTitle: 'StaffDev',
          isEphemeral: false,
        },
        { agentId: 'agent-root-boss', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );

      const hiredPersistent = DynamicHiringService.executeHiring(
        persistentProposal,
        { agentId: 'agent-root-boss', projectId: 'proj-stress', channelId: 'chan-stress' },
        db
      );
      const persId = hiredPersistent.agentId;

      const persTearDown = DynamicHiringService.teardownEphemeralAgent(persId, db);
      expect(persTearDown).toBe(false);

      const persIdentity = db.queryOne<{ id: string }>(
        'SELECT id FROM agent_identities WHERE id = ?',
        persId
      );
      expect(persIdentity).toBeDefined();

      expect(DynamicHiringService.teardownEphemeralAgent('non-existent-agent-id', db)).toBe(false);
    });
  });
});
