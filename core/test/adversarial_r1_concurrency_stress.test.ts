import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { ChannelService } from '../src/communication/channel_service.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { CoreServer } from '../src/server/core_server.js';
import { TaskItem, Channel } from '../src/domain/types.js';

describe('R1: Adversarial Concurrency & Stress Testing Suite', () => {
  // ==========================================================================
  // Area 1: Task Lease Contention Across Parallel Worker Runs
  // ==========================================================================
  describe('1. Task Lease Contention Across Parallel Worker Runs', () => {
    let db: KinDatabase;
    let tempDir: string;
    let tempDbPath: string;
    let workspaceRepo: WorkspaceRepository;
    let agentRepo: AgentRepository;
    let taskRepo: TaskRepository;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-lease-stress-'));
      tempDbPath = path.join(tempDir, 'lease_stress.sqlite');
      db = new KinDatabase({ dbPath: tempDbPath });
      new MigrationRunner(db).runMigrations();

      workspaceRepo = new WorkspaceRepository(db);
      agentRepo = new AgentRepository(db);
      taskRepo = new TaskRepository(db);

      const now = Date.now();
      workspaceRepo.createWorkspace({
        id: 'ws-lease',
        name: 'Lease Test Workspace',
        rootPath: '/workspace',
        defaultAutonomyMode: 'AUTO',
        createdAt: now,
        updatedAt: now,
      });

      workspaceRepo.createProject({
        id: 'proj-lease',
        workspaceId: 'ws-lease',
        name: 'Lease Project',
        repoPath: '/workspace',
        settings: {},
        createdAt: now,
        updatedAt: now,
      });

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

      // Register 40 worker agent identities for foreign key integrity
      for (let i = 0; i < 40; i++) {
        agentRepo.createIdentity({
          id: `agent-worker-${i}`,
          workspaceId: 'ws-lease',
          projectId: 'proj-lease',
          definitionId: 'def-worker',
          displayName: `@Worker${i}`,
          activeModelId: 'anthropic/claude-3-5-sonnet',
          isOrchestrator: false,
          isEphemeral: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      taskRepo.createGoal({
        id: 'goal-lease',
        projectId: 'proj-lease',
        title: 'Task Lease Contention Goal',
        description: 'Goal for testing worker lease contention',
        acceptanceCriteria: ['Only 1 worker wins lease'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
    });

    afterEach(() => {
      db.close();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it('contends across 40 parallel workers claiming the same ready task - exactly 1 wins and 39 receive false', async () => {
      const now = Date.now();
      const taskId = 'task-contention-40';

      taskRepo.createTask({
        id: taskId,
        goalId: 'goal-lease',
        title: 'High-Contention Processing Task',
        description: 'Contended task among 40 parallel workers',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      // 40 workers attempt claimTaskWithLease concurrently
      const workers = Array.from({ length: 40 }, (_, i) => ({
        agentId: `agent-worker-${i}`,
        runId: `run-worker-${i}`,
      }));

      const claimResults = await Promise.all(
        workers.map((w) =>
          Promise.resolve().then(() =>
            taskRepo.claimTaskWithLease(taskId, w.agentId, w.runId, 300000)
          )
        )
      );

      const successCount = claimResults.filter(Boolean).length;
      const failureCount = claimResults.filter((r) => !r).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(39);

      const winningIndex = claimResults.findIndex(Boolean);
      const winner = workers[winningIndex];

      const task = taskRepo.getTask(taskId);
      expect(task).toBeDefined();
      expect(task?.status).toBe('running');
      expect(task?.assignedAgentId).toBe(winner.agentId);
      expect(task?.claimedByRunId).toBe(winner.runId);
      expect(task?.leaseExpiresAt).toBeGreaterThan(Date.now());
    });

    it('executes rapid lease renewals in a tight loop by winning worker while rivals continuously fail to steal', async () => {
      const now = Date.now();
      const taskId = 'task-renewal-loop';

      taskRepo.createTask({
        id: taskId,
        goalId: 'goal-lease',
        title: 'Rapid Renewal Contention Task',
        description: 'Task under rapid lease renewal by winner',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      // Worker 0 wins initial claim
      const initialClaim = taskRepo.claimTaskWithLease(taskId, 'agent-worker-0', 'run-worker-0', 60000);
      expect(initialClaim).toBe(true);

      const rivals = Array.from({ length: 10 }, (_, i) => ({
        agentId: `agent-worker-${i + 1}`,
        runId: `run-worker-${i + 1}`,
      }));

      // Worker 0 rapidly renews lease 40 times in a tight loop
      const renewalTask = (async () => {
        for (let i = 0; i < 40; i++) {
          const renewed = taskRepo.renewTaskLease(taskId, 'run-worker-0', 120000);
          expect(renewed).toBe(true);
        }
      })();

      // Simultaneously rivals try to claim the task
      const rivalTasks = rivals.map(async (rival) => {
        for (let j = 0; j < 5; j++) {
          const stolen = taskRepo.claimTaskWithLease(taskId, rival.agentId, rival.runId, 300000);
          expect(stolen).toBe(false);
        }
      });

      await Promise.all([renewalTask, ...rivalTasks]);

      const finalTask = taskRepo.getTask(taskId);
      expect(finalTask?.status).toBe('running');
      expect(finalTask?.claimedByRunId).toBe('run-worker-0');
      expect(finalTask?.assignedAgentId).toBe('agent-worker-0');
      expect(finalTask?.leaseExpiresAt).toBeGreaterThan(Date.now() + 50000);
    });

    it('handles lease expiry and re-claim handover cleanly between workers and rejects subsequent expired renewals', async () => {
      const now = Date.now();
      const taskId = 'task-expiry-handover';

      taskRepo.createTask({
        id: taskId,
        goalId: 'goal-lease',
        title: 'Expiry Handover Task',
        description: 'Task where lease expires and is claimed by another worker run',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      // Worker 1 (run-worker-0) claims with a short 30ms lease
      const claim1 = taskRepo.claimTaskWithLease(taskId, 'agent-worker-0', 'run-worker-0', 30);
      expect(claim1).toBe(true);

      // Premature claim before lease expiry must fail
      const prematureClaim = taskRepo.claimTaskWithLease(taskId, 'agent-worker-0', 'run-worker-1', 60000);
      expect(prematureClaim).toBe(false);

      // Wait 60ms for lease to expire
      await new Promise((r) => setTimeout(r, 60));

      // Worker 2 (run-worker-1) claims after expiry -> must succeed because lease expired
      const claim2 = taskRepo.claimTaskWithLease(taskId, 'agent-worker-0', 'run-worker-1', 300000);
      expect(claim2).toBe(true);

      const handedOverTask = taskRepo.getTask(taskId);
      expect(handedOverTask?.status).toBe('running');
      expect(handedOverTask?.claimedByRunId).toBe('run-worker-1');
      expect(handedOverTask?.assignedAgentId).toBe('agent-worker-0');

      // Worker 1 (run-worker-0) attempts to renew its expired and handed-over lease -> must fail
      const expiredRenewal = taskRepo.renewTaskLease(taskId, 'run-worker-0', 300000);
      expect(expiredRenewal).toBe(false);
    });
  });

  // ==========================================================================
  // Area 2: Rapid Parallel Message Ingestion & Admission Fencing
  // ==========================================================================
  describe('2. Rapid Parallel Message Ingestion & Admission Fencing', () => {
    let db: KinDatabase;
    let tempDir: string;
    let tempDbPath: string;
    let server: CoreServer;
    let port: number;
    let channelService: ChannelService;
    let workspaceRepo: WorkspaceRepository;
    let agentRepo: AgentRepository;

    beforeAll(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-msg-stress-'));
      tempDbPath = path.join(tempDir, 'msg_stress.sqlite');

      server = new CoreServer({ port: 0, dbPath: tempDbPath, requireIpcAuth: false });
      port = await server.start();
      db = server.getDatabase();

      workspaceRepo = new WorkspaceRepository(db);
      agentRepo = new AgentRepository(db);
      channelService = new ChannelService(db);

      const now = Date.now();
      // Setup test channels
      workspaceRepo.createChannel({
        id: 'chan-stress-public-1',
        projectId: 'proj-kin',
        name: 'stress-public-1',
        topic: 'Stress Testing Public 1',
        channelType: 'channel',
        isPrivate: false,
        createdAt: now,
      });

      workspaceRepo.createChannel({
        id: 'chan-stress-public-2',
        projectId: 'proj-kin',
        name: 'stress-public-2',
        topic: 'Stress Testing Public 2',
        channelType: 'channel',
        isPrivate: false,
        createdAt: now,
      });

      // Register agents for DMs
      agentRepo.createDefinition({
        id: 'def-dm-agent',
        name: 'DM Agent',
        role: 'Collaborator',
        systemPrompt: 'DM assistant',
        defaultModelId: 'claude-3-5-sonnet',
        domainAuthority: [],
        capabilities: ['shell'],
        createdAt: now,
      });

      agentRepo.createIdentity({
        id: 'agent-dm-alpha',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-dm-agent',
        displayName: '@DMAlpha',
        activeModelId: 'anthropic/claude-3-5-sonnet',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      agentRepo.createIdentity({
        id: 'agent-dm-beta',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-dm-agent',
        displayName: '@DMBeta',
        activeModelId: 'anthropic/claude-3-5-sonnet',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      // Private DM channel
      workspaceRepo.createChannel({
        id: 'dm-alpha-beta',
        projectId: 'proj-kin',
        name: 'dm-DMAlpha-DMBeta',
        topic: 'Private DM',
        channelType: 'direct_message',
        isPrivate: true,
        participantIds: ['agent-dm-alpha', 'agent-dm-beta'],
        createdAt: now,
      });
      workspaceRepo.addChannelMember('dm-alpha-beta', 'agent-dm-alpha');
      workspaceRepo.addChannelMember('dm-alpha-beta', 'agent-dm-beta');
    });

    afterAll(async () => {
      await server.stop();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it('ingests high-concurrency message bursts across channels and DMs without SQLite busy or locking errors', async () => {
      const channelIds = ['chan-stress-public-1', 'chan-stress-public-2', 'dm-alpha-beta'];
      const totalMessages = 60;

      const messageSpecs = Array.from({ length: totalMessages }, (_, i) => {
        const channelId = channelIds[i % channelIds.length];
        const senderId = channelId === 'dm-alpha-beta'
          ? (i % 2 === 0 ? 'agent-dm-alpha' : 'agent-dm-beta')
          : 'agent-dm-alpha';
        return {
          channelId,
          senderId,
          senderType: 'agent' as const,
          content: `High concurrency stress message payload #${i} - timestamp:${Date.now()}`,
        };
      });

      // Fire 60 concurrent insertions
      const results = await Promise.all(
        messageSpecs.map((spec) => Promise.resolve().then(() => channelService.sendMessage(spec)))
      );

      expect(results.length).toBe(totalMessages);
      for (const msg of results) {
        expect(msg.id).toBeDefined();
        expect(msg.content).toContain('High concurrency stress message payload');
      }

      // Verify channel message counts in database
      const count1 = channelService.getMessages('chan-stress-public-1', 100);
      const count2 = channelService.getMessages('chan-stress-public-2', 100);
      const countDm = channelService.getMessages('dm-alpha-beta', 100);

      expect(count1.length + count2.length + countDm.length).toBe(totalMessages);
      expect(count1.length).toBe(20);
      expect(count2.length).toBe(20);
      expect(countDm.length).toBe(20);

      // Verify EventLedger has tracked the messages without chain breakdown
      const ledger = EventLedger.ensureInitialized(db);
      const integrity = ledger.verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
    });

    it('enforces channel prompt admission duplicate fencing within 1500ms from the same sender', async () => {
      const channelId = 'chan-stress-public-1';
      const promptContent = 'Deploy release artifacts to staging environment';

      // 1. Initial prompt submission succeeds (HTTP 201)
      const res1 = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: promptContent,
          senderId: 'operator-alice',
        }),
      });

      expect([200, 201]).toContain(res1.status);
      const body1: any = await res1.json();
      expect(body1.message).toBeDefined();
      expect(body1.suppressedDuplicate).toBeUndefined();

      // 2. Rapid duplicate submission from same sender within 1500ms is suppressed
      const res2 = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: promptContent,
          senderId: 'operator-alice',
        }),
      });

      expect(res2.status).toBe(200);
      const body2: any = await res2.json();
      expect(body2.success).toBe(true);
      expect(body2.suppressedDuplicate).toBe(true);
      expect(body2.message).toContain('Duplicate prompt submitted in quick succession');

      // 3. Parallel burst of 10 identical submissions from the same sender: all must be suppressed
      const burstResponses = await Promise.all(
        Array.from({ length: 10 }, () =>
          fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: promptContent,
              senderId: 'operator-alice',
            }),
          })
        )
      );

      const burstBodies: any[] = await Promise.all(burstResponses.map((r) => r.json()));
      for (const b of burstBodies) {
        expect(b.success).toBe(true);
        expect(b.suppressedDuplicate).toBe(true);
      }

      // 4. Different prompt from the same sender is NOT suppressed
      const resDifferent = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Run performance benchmark tests instead',
          senderId: 'operator-alice',
        }),
      });

      expect([200, 201]).toContain(resDifferent.status);
      const bodyDiff: any = await resDifferent.json();
      expect(bodyDiff.message).toBeDefined();
      expect(bodyDiff.suppressedDuplicate).toBeUndefined();

      // 5. Same prompt from a different sender is NOT suppressed
      const resDifferentSender = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: promptContent,
          senderId: 'operator-bob',
        }),
      });

      expect([200, 201]).toContain(resDifferentSender.status);
      const bodyDiffSender: any = await resDifferentSender.json();
      expect(bodyDiffSender.message).toBeDefined();
      expect(bodyDiffSender.suppressedDuplicate).toBeUndefined();
    });

    it('asserts deterministic chronological message ordering with secondary id tie-breaker on identical timestamps', () => {
      const orderingChannelId = 'chan-ordering-test';
      const now = Date.now();

      workspaceRepo.createChannel({
        id: orderingChannelId,
        projectId: 'proj-kin',
        name: 'ordering-test',
        topic: 'Deterministic Ordering Test',
        channelType: 'channel',
        isPrivate: false,
        createdAt: now,
      });

      // Insert 20 messages sharing the exact same millisecond timestamp
      const fixedTimestamp = now;
      const expectedIds: string[] = [];

      for (let i = 0; i < 20; i++) {
        const id = `msg-deterministic-${String(i).padStart(3, '0')}`;
        expectedIds.push(id);
        db.execute(
          `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, parent_message_id, mentions_json, productivity_score, created_at)
           VALUES (?, ?, 'agent-dm-alpha', 'agent', ?, NULL, '[]', 0, ?)`,
          id,
          orderingChannelId,
          `Deterministic message ${i}`,
          fixedTimestamp
        );
      }

      // Query repeatedly (5 iterations)
      for (let run = 0; run < 5; run++) {
        const retrieved = channelService.getMessages(orderingChannelId, 50);
        expect(retrieved.length).toBe(20);

        const retrievedIds = retrieved.map((m) => m.id);
        // Strict deterministic comparison: sorted by created_at ASC, id ASC
        expect(retrievedIds).toEqual([...expectedIds].sort());
      }
    });
  });

  // ==========================================================================
  // Area 3: Concurrent Approval Resolution & Single-Use Tokens
  // ==========================================================================
  describe('3. Concurrent Approval Resolution & Single-Use Token Semantics', () => {
    let db: KinDatabase;
    let tempDir: string;
    let tempDbPath: string;
    let server: CoreServer;
    let port: number;

    beforeAll(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-appr-stress-'));
      tempDbPath = path.join(tempDir, 'approval_stress.sqlite');

      server = new CoreServer({ port: 0, dbPath: tempDbPath, requireIpcAuth: false });
      port = await server.start();
      db = server.getDatabase();
    });

    afterAll(async () => {
      await server.stop();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it('handles parallel HTTP POST resolve attempts against a pending approval with atomic CAS single-resolution', async () => {
      const defaultAgent = db.queryOne<{ id: string }>('SELECT id FROM agent_identities LIMIT 1');
      expect(defaultAgent).toBeDefined();

      const approvalId = server.createApprovalRecord(
        'workspace_tree',
        { depth: 1 },
        'Parallel approval stress test',
        defaultAgent!.id,
        'HIGH'
      );

      // Verify initial pending status
      const initial = db.queryOne<{ status: string }>('SELECT status FROM approvals WHERE id = ?', approvalId);
      expect(initial?.status).toBe('pending');

      // Fire 12 parallel POST resolve attempts with { approved: true }
      const parallelRequests = Array.from({ length: 12 }, () =>
        fetch(`http://127.0.0.1:${port}/api/approvals/${approvalId}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved: true }),
        })
      );

      const responses = await Promise.all(parallelRequests);
      const statuses = responses.map((r) => r.status);
      const bodies: any[] = await Promise.all(responses.map((r) => r.json()));

      // Exactly 1 request succeeds with HTTP 200
      const okCount = statuses.filter((s) => s === 200).length;
      // All rivals fail with HTTP 409 (Conflict) or HTTP 400 (Already decided)
      const conflictCount = statuses.filter((s) => s === 409 || s === 400).length;

      expect(okCount).toBe(1);
      expect(conflictCount).toBe(11);

      // Winning body has approvalId and success: true
      const winningBody = bodies.find((b) => b.success === true);
      expect(winningBody).toBeDefined();
      expect(winningBody.approvalId).toBe(approvalId);

      // Verify database reflects exactly 1 approved status with decided_at
      const resolvedRow = db.queryOne<{ status: string; decided_at: number }>(
        'SELECT status, decided_at FROM approvals WHERE id = ?',
        approvalId
      );
      expect(resolvedRow?.status).toBe('approved');
      expect(resolvedRow?.decided_at).toBeGreaterThan(0);
    });

    it('enforces single-use approval token semantics in ToolGateway preventing duplicate tool execution', async () => {
      const gateway = new ToolGateway();
      const toolName = 'workspace_tree';
      const runId = 'run-token-test-1';
      const params = { depth: 1 };

      const token = gateway.generateApprovalToken(toolName, runId, 60000, params);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(16);

      // First consumption succeeds
      const firstConsumption = gateway.consumeApprovalToken(token, toolName, runId, params);
      expect(firstConsumption).toBe(true);

      // Replay attempt fails (single-use token consumed and discarded)
      const replayAttempt = gateway.consumeApprovalToken(token, toolName, runId, params);
      expect(replayAttempt).toBe(false);

      // Parallel race to consume a fresh approval token: exactly 1 caller succeeds
      const freshToken = gateway.generateApprovalToken(toolName, 'run-token-race', 60000, params);
      const parallelConsumes = await Promise.all(
        Array.from({ length: 10 }, () =>
          Promise.resolve().then(() =>
            gateway.consumeApprovalToken(freshToken, toolName, 'run-token-race', params)
          )
        )
      );

      const successCount = parallelConsumes.filter(Boolean).length;
      const failCount = parallelConsumes.filter((c) => !c).length;

      expect(successCount).toBe(1);
      expect(failCount).toBe(9);
    });

    it('prevents split-brain state under conflicting concurrent decisions (approve vs reject)', async () => {
      const defaultAgent = db.queryOne<{ id: string }>('SELECT id FROM agent_identities LIMIT 1');
      const conflictApprovalId = server.createApprovalRecord(
        'workspace_tree',
        { depth: 1 },
        'Conflicting decision race test',
        defaultAgent!.id,
        'HIGH'
      );

      // Fire 5 approve and 5 reject requests concurrently
      const decisions = [
        ...Array.from({ length: 5 }, () => ({ approved: true })),
        ...Array.from({ length: 5 }, () => ({ approved: false })),
      ];

      const responses = await Promise.all(
        decisions.map((d) =>
          fetch(`http://127.0.0.1:${port}/api/approvals/${conflictApprovalId}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d),
          })
        )
      );

      const okResponses = responses.filter((r) => r.status === 200);
      const rivalResponses = responses.filter((r) => r.status === 409 || r.status === 400);

      expect(okResponses.length).toBe(1);
      expect(rivalResponses.length).toBe(9);

      // Verify that database reflects the single winning status cleanly
      const finalRow = db.queryOne<{ status: string }>('SELECT status FROM approvals WHERE id = ?', conflictApprovalId);
      expect(['approved', 'rejected']).toContain(finalRow?.status);
    });
  });

  // ==========================================================================
  // Area 4: EventLedger Cryptographic Hash Chain Under Parallel Load
  // ==========================================================================
  describe('4. EventLedger Cryptographic Hash Chain Under Parallel Load', () => {
    let db: KinDatabase;
    let tempDir: string;
    let tempDbPath: string;
    let ledger: EventLedger;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-ledger-stress-'));
      tempDbPath = path.join(tempDir, 'ledger_stress.sqlite');
      db = new KinDatabase({ dbPath: tempDbPath });
      new MigrationRunner(db).runMigrations();
      ledger = EventLedger.initialize(db);
    });

    afterEach(() => {
      db.close();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    it('preserves cryptographic hash chain integrity under parallel asynchronous event logging', async () => {
      const eventCount = 50;

      // 50 concurrent async event logging operations
      const operations = Array.from({ length: eventCount }, (_, i) =>
        Promise.resolve().then(() =>
          ledger.record({
            eventType: 'agent.parallel_execution',
            entityType: 'run',
            entityId: `run-${i}`,
            payload: {
              step: i,
              task: 'concurrency_verification',
              entropy: crypto.randomBytes(8).toString('hex'),
            },
          })
        )
      );

      const insertedIds = await Promise.all(operations);
      expect(insertedIds.length).toBe(eventCount);

      // Verify chain integrity across all records
      const integrity = ledger.verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.verifiedCount).toBe(eventCount);
      expect(integrity.error).toBeUndefined();
      expect(integrity.compromisedId).toBeUndefined();

      // Directly verify row-by-row SHA-256 links in SQLite
      const rows = db.query<{ id: number; record_hash: string; prev_hash: string }>(
        'SELECT id, record_hash, prev_hash FROM event_journal ORDER BY id ASC'
      );
      expect(rows.length).toBe(eventCount);
      expect(rows[0].prev_hash).toBe('GENESIS_HASH_0000000000000000');

      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].prev_hash).toBe(rows[i - 1].record_hash);
      }
    });

    it('detects payload tampering and identifies exact compromised row ID', async () => {
      // Record 15 initial events
      for (let i = 0; i < 15; i++) {
        ledger.record({
          eventType: 'audit.milestone',
          entityType: 'audit',
          entityId: `audit-${i}`,
          payload: { index: i, note: `Audit note ${i}` },
        });
      }

      // Initial check must be valid
      const initialCheck = ledger.verifyChainIntegrity();
      expect(initialCheck.valid).toBe(true);
      expect(initialCheck.verifiedCount).toBe(15);

      const rows = db.query<{ id: number }>('SELECT id FROM event_journal ORDER BY id ASC');
      const targetRowId = rows[7].id;

      // Tamper directly with the payload JSON of row index 7
      db.execute(
        `UPDATE event_journal SET payload_json = '{"tampered":true,"forged":1}' WHERE id = ?`,
        targetRowId
      );

      const tamperResult = ledger.verifyChainIntegrity();
      expect(tamperResult.valid).toBe(false);
      expect(tamperResult.compromisedId).toBe(targetRowId);
      expect(tamperResult.error).toContain(`Tampered event record detected at ID ${targetRowId}: hash mismatch`);
    });

    it('detects broken previous hash links in event chain and identifies exact compromised row ID', async () => {
      // Record 12 initial events
      for (let i = 0; i < 12; i++) {
        ledger.record({
          eventType: 'security.checkpoint',
          entityType: 'checkpoint',
          entityId: `chk-${i}`,
          payload: { level: i, verified: true },
        });
      }

      const rows = db.query<{ id: number }>('SELECT id FROM event_journal ORDER BY id ASC');
      const targetRowId = rows[5].id;

      // Corrupt prev_hash of row index 5
      db.execute(
        `UPDATE event_journal SET prev_hash = 'tampered_previous_hash_0000000000000000' WHERE id = ?`,
        targetRowId
      );

      const brokenLinkResult = ledger.verifyChainIntegrity();
      expect(brokenLinkResult.valid).toBe(false);
      expect(brokenLinkResult.compromisedId).toBe(targetRowId);
      expect(brokenLinkResult.error).toContain(`Broken chain link at event ID ${targetRowId}`);
    });
  });
});
