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
} from '../src/kernel/state_machine.js';
import { ActivationEngine, GreetingClassifier } from '../src/communication/activation_engine.js';
import { IntentRouter } from '../src/communication/intent_router.js';
import { ChannelService } from '../src/communication/channel_service.js';
import { DynamicHiringService, HiringProposal } from '../src/kernel/dynamic_hiring.js';
import { LoopBreaker, calculateMessageHash } from '../src/kernel/loop_breaker.js';
import { ModelDiscoveryService } from '../src/execution/model_discovery.js';
import { DEFAULT_PROVIDER_BASE_URLS } from '../src/execution/model_gateway.js';
import { StreamingInferenceClient } from '../src/execution/streaming_client.js';
import { QuotaGuard } from '../src/execution/quota_guard.js';
import { ContextCompiler } from '../src/context/context_compiler.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { Scheduler } from '../src/automation/scheduler.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { Message, TaskStatus } from '../src/domain/types.js';

describe('Milestone 2: Multi-Agent Harness & Local Inference Runtime Remediations', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let migrationRunner: MigrationRunner;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-m2-remediation-'));
    dbPath = path.join(tempDir, 'kin_test.db');
    db = new KinDatabase(dbPath);
    migrationRunner = new MigrationRunner(db);
    migrationRunner.runMigrations();
    seedFoundationalEntities(db, tempDir);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function seedFoundationalEntities(database: KinDatabase, rootPath: string) {
    const now = Date.now();
    database.execute(
      `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-test', 'Test Workspace', ?, 'AUTO', ?, ?);`,
      rootPath,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, created_at, updated_at)
       VALUES ('proj-test', 'ws-test', 'Test Project', ?, ?, ?);`,
      rootPath,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, capabilities_json, created_at)
       VALUES ('def-orch', 'Boss', 'Orchestrator', 'You are Boss', 'mock-model', '["*"]', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
       VALUES ('agent-boss', 'ws-test', 'proj-test', 'def-orch', '@Boss', 'mock-model', 1, 0, ?, ?);`,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO channels (id, project_id, name, channel_type, created_at)
       VALUES ('chan-test', 'proj-test', 'general', 'channel', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO channel_members (channel_id, agent_id, joined_at)
       VALUES ('chan-test', 'agent-boss', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
       VALUES ('goal-test', 'proj-test', 'Primary Objective', 'Complete milestone testing', '[]', 'active', ?, ?);`,
      now,
      now
    );
  }

  // ==========================================================================
  // Feature 12: Run State Machine & 13 Authoritative States
  // ==========================================================================
  describe('Feature 12: Run State Machine Lifecycle Transitions', () => {
    it('validates canonical forward lifecycle transitions', () => {
      expect(RunStateMachine.isValidTransition('created', 'queued')).toBe(true);
      expect(RunStateMachine.isValidTransition('queued', 'running')).toBe(true);
      expect(RunStateMachine.isValidTransition('running', 'paused_approval')).toBe(true);
      expect(RunStateMachine.isValidTransition('paused_approval', 'resuming')).toBe(true);
      expect(RunStateMachine.isValidTransition('resuming', 'running')).toBe(true);
      expect(RunStateMachine.isValidTransition('running', 'completed')).toBe(true);
    });

    it('validates cancellation, pause, and rate-limit transitions', () => {
      expect(RunStateMachine.isValidTransition('running', 'cancelling')).toBe(true);
      expect(RunStateMachine.isValidTransition('cancelling', 'cancelled')).toBe(true);
      expect(RunStateMachine.isValidTransition('running', 'quota_paused')).toBe(true);
      expect(RunStateMachine.isValidTransition('quota_paused', 'resuming')).toBe(true);
      expect(RunStateMachine.isValidTransition('running', 'interrupted')).toBe(true);
      expect(RunStateMachine.isValidTransition('interrupted', 'resuming')).toBe(true);
    });

    it('enforces terminal state immutability and throws StateTransitionError', () => {
      expect(RunStateMachine.isTerminal('completed')).toBe(true);
      expect(RunStateMachine.isTerminal('failed')).toBe(true);
      expect(RunStateMachine.isTerminal('cancelled')).toBe(true);
      expect(RunStateMachine.isTerminal('running')).toBe(false);

      expect(() => RunStateMachine.validateTransition('completed', 'running')).toThrow(
        StateTransitionError
      );
      expect(() => RunStateMachine.validateTransition('cancelled', 'queued')).toThrow(
        StateTransitionError
      );
      expect(() => RunStateMachine.validateTransition('failed', 'running')).toThrow(
        StateTransitionError
      );
      expect(() => RunStateMachine.validateTransition('created', 'completed')).toThrow(
        StateTransitionError
      );
    });

    it('normalizes legacy aliases seamlessly', () => {
      expect(RunStateMachine.normalizeRunState('waiting_for_approval')).toBe('paused_approval');
      expect(RunStateMachine.normalizeRunState('paused')).toBe('paused_user');
      expect(RunStateMachine.normalizeRunState('recovering')).toBe('resuming');
      expect(RunStateMachine.normalizeRunState('quota_paused')).toBe('paused_rate_limit');
      expect(RunStateMachine.normalizeRunState('waiting_for_tool')).toBe('running');

      // Alias-tolerant transition validation
      expect(RunStateMachine.isValidTransition('waiting_for_approval', 'running')).toBe(true);
      expect(RunStateMachine.isValidTransition('running', 'waiting_for_approval')).toBe(true);
    });
  });

  // ==========================================================================
  // Feature 13: Greeting Classifier & Channel Routing Boundaries
  // ==========================================================================
  describe('Feature 13: Greeting Classifier & Channel Routing Boundaries', () => {
    it('classifies pure pleasantries vs directives correctly', () => {
      const pureGreetings = [
        'Hello',
        'Hi there!',
        'Good morning',
        'Hey kin team',
        'Whats up?',
        'How are you doing today?',
      ];
      for (const phrase of pureGreetings) {
        const classified = GreetingClassifier.classify(phrase);
        expect(classified.isGreeting, `Expected "${phrase}" to be pure greeting`).toBe(true);
        expect(ActivationEngine.isPureGreeting(phrase)).toBe(true);
      }

      const mixedOrDirectives = [
        'Hello, please build the latest project',
        'Hi, can you run the tests?',
        'Good morning, check task #4',
        'Hey @Boss, deploy the changes',
        'Execute npm run build',
      ];
      for (const phrase of mixedOrDirectives) {
        const classified = GreetingClassifier.classify(phrase);
        expect(classified.isGreeting, `Expected "${phrase}" NOT to be pure greeting`).toBe(false);
        expect(ActivationEngine.isPureGreeting(phrase)).toBe(false);
      }
    });

    it('prevents silent auto-enrollment for non-member agent mentions', () => {
      const now = Date.now();
      // Create a specialist who is NOT enrolled in chan-test
      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
         VALUES ('def-unassigned', 'UnassignedDev', 'Dev', 'You are dev', 'mock-model', ?)`,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at)
         VALUES ('agent-unassigned', 'ws-test', 'proj-test', 'def-unassigned', '@UnassignedDev', 'mock-model', 0, ?, ?)`,
        now,
        now
      );

      const channelService = new ChannelService(db);
      const membersBefore = channelService.listMembers('chan-test');
      expect(membersBefore.some((m) => m.id === 'agent-unassigned')).toBe(false);

      const bossIdentity = {
        id: 'agent-boss',
        workspaceId: 'ws-test',
        projectId: 'proj-test',
        definitionId: 'def-orch',
        displayName: '@Boss',
        activeModelId: 'mock-model',
        isOrchestrator: true,
        createdAt: now,
        updatedAt: now,
      };

      const unassignedIdentity = {
        id: 'agent-unassigned',
        workspaceId: 'ws-test',
        projectId: 'proj-test',
        definitionId: 'def-unassigned',
        displayName: '@UnassignedDev',
        activeModelId: 'mock-model',
        isOrchestrator: false,
        createdAt: now,
        updatedAt: now,
      };

      // Verify routing checks channel membership and routes to @Boss if mentioned agent is not enrolled
      const engine = new ActivationEngine();
      const mockMsg: Message = {
        id: 'msg-mention-test',
        channelId: 'chan-test',
        senderId: 'user-1',
        senderType: 'human',
        content: 'Hey @UnassignedDev, what do you think?',
        mentions: ['UnassignedDev'],
        createdAt: now,
      };

      const routeResult = engine.routeChannelMessage({
        channelId: 'chan-test',
        message: mockMsg,
        channelMembers: [bossIdentity],
        allProjectAgents: [bossIdentity, unassignedIdentity],
        definitionsMap: new Map(),
      });

      // Should route to @Boss because @UnassignedDev is not enrolled in the channel
      expect(routeResult.action).toBe('orchestrator_fallback');
      expect(routeResult.targetAgents[0].id).toBe('agent-boss');
      expect(routeResult.explanation).toContain('@UnassignedDev is not a member of this channel');

      // Verify non-member was NOT silently enrolled into SQLite channel_members
      const membersAfter = channelService.listMembers('chan-test');
      expect(membersAfter.some((m) => m.id === 'agent-unassigned')).toBe(false);
    });

    it('safely handles unpersisted or ad-hoc DM channels', () => {
      const channelService = new ChannelService(db);
      // Requesting an ad-hoc unpersisted DM channel does not crash
      const dmChannel = channelService.getChannel('dm-user-agent-boss');
      expect(dmChannel).toBeDefined();
      expect(dmChannel?.type).toBe('dm');
    });
  });

  // ==========================================================================
  // Feature 14: Sequential Threading & Atomic Thread Leases
  // ==========================================================================
  describe('Feature 14: Sequential Threading & Atomic Thread Leases', () => {
    it('propagates parentMessageId in sequential replies and retrieves thread replies', () => {
      const channelService = new ChannelService(db);
      const rootMsg = channelService.postMessage({
        channelId: 'chan-test',
        senderId: 'user-1',
        senderType: 'human',
        content: 'Root thread question',
      });

      const reply1 = channelService.postMessage({
        channelId: 'chan-test',
        senderId: 'agent-boss',
        senderType: 'agent',
        content: 'First sequential reply',
        parentMessageId: rootMsg.id,
      });

      const reply2 = channelService.postMessage({
        channelId: 'chan-test',
        senderId: 'user-1',
        senderType: 'human',
        content: 'Second reply in same thread',
        parentMessageId: rootMsg.id,
      });

      const replies = channelService.getThreadReplies('chan-test', rootMsg.id);
      expect(replies.length).toBe(2);
      const replyIds = replies.map((r) => r.id);
      expect(replyIds).toContain(reply1.id);
      expect(replyIds).toContain(reply2.id);
      expect(replies[0].parentMessageId).toBe(rootMsg.id);
      expect(replies[1].parentMessageId).toBe(rootMsg.id);
    });

    it('enforces atomic thread lease acquisition, conflict rejection, and renewal', () => {
      const channelService = new ChannelService(db);
      const rootMsgId = 'msg-thread-lease-test';

      // 1. Initial lease claim succeeds
      const claimed = channelService.acquireThreadLease('chan-test', rootMsgId, 'run-worker-1', 5000);
      expect(claimed).toBe(true);

      // 2. Conflicting claim by another run is rejected
      const conflictClaimed = channelService.acquireThreadLease('chan-test', rootMsgId, 'run-worker-2', 5000);
      expect(conflictClaimed).toBe(false);

      // 3. Same run can renew lease
      const renewed = channelService.acquireThreadLease('chan-test', rootMsgId, 'run-worker-1', 10000);
      expect(renewed).toBe(true);

      // 4. Releasing lease allows another run to claim
      channelService.releaseThreadLease('chan-test', rootMsgId, 'run-worker-1');
      const nowAllowed = channelService.acquireThreadLease('chan-test', rootMsgId, 'run-worker-2', 5000);
      expect(nowAllowed).toBe(true);
    });
  });

  // ==========================================================================
  // Feature 15: Dynamic Hiring Contract, Attenuation & Teardown
  // ==========================================================================
  describe('Feature 15: Dynamic Hiring Contract, Attenuation & Teardown', () => {
    it('constructs and validates a 7-tuple proposal with attenuation', () => {
      const now = Date.now();
      // Create a restricted parent specialist
      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, capabilities_json, created_at)
         VALUES ('def-subparent', 'LeadWorker', 'Lead', 'You are lead', 'mock-model', '["fs:read","fs:write"]', ?)`,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, parent_agent_id, created_at, updated_at)
         VALUES ('agent-lead', 'ws-test', 'proj-test', 'def-subparent', '@LeadWorker', 'mock-model', 0, 'agent-boss', ?, ?)`,
        now,
        now
      );

      // LeadWorker attempts to hire a specialist with capabilities exceeding its own
      const proposal = DynamicHiringService.createProposal(
        {
          displayName: 'HelperDev',
          roleTitle: 'Developer',
          capabilities: ['fs:read', 'fs:write', 'shell:exec', 'network:*'],
        },
        { agentId: 'agent-lead', projectId: 'proj-test', channelId: 'chan-test' },
        db
      );

      // Capabilities must be attenuated: shell:exec and network:* should NOT be granted
      expect(proposal.capabilities).toEqual(['fs:read', 'fs:write']);
      expect(proposal.displayName).toBe('@HelperDev');
      expect(proposal.roleTitle).toBe('Developer');
      expect(proposal.parentAgentId).toBe('agent-lead');
    });

    it('enforces delegation depth cap of 3 and prevents runaway delegation', () => {
      const now = Date.now();
      // Setup hierarchy: agent-boss (depth 0) -> agent-depth-1 -> agent-depth-2 -> agent-depth-3
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, parent_agent_id, created_at, updated_at)
         VALUES ('agent-d1', 'ws-test', 'proj-test', 'def-orch', '@D1', 'mock-model', 0, 'agent-boss', ?, ?)`,
        now,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, parent_agent_id, created_at, updated_at)
         VALUES ('agent-d2', 'ws-test', 'proj-test', 'def-orch', '@D2', 'mock-model', 0, 'agent-d1', ?, ?)`,
        now,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, parent_agent_id, created_at, updated_at)
         VALUES ('agent-d3', 'ws-test', 'proj-test', 'def-orch', '@D3', 'mock-model', 0, 'agent-d2', ?, ?)`,
        now,
        now
      );

      expect(DynamicHiringService.getDelegationDepth('agent-boss', db)).toBe(0);
      expect(DynamicHiringService.getDelegationDepth('agent-d1', db)).toBe(1);
      expect(DynamicHiringService.getDelegationDepth('agent-d2', db)).toBe(2);
      expect(DynamicHiringService.getDelegationDepth('agent-d3', db)).toBe(3);

      // Attempting to hire from depth 3 must throw error
      expect(() => {
        DynamicHiringService.createProposal(
          { displayName: 'OverDepthSpecialist', roleTitle: 'Worker' },
          { agentId: 'agent-d3', projectId: 'proj-test', channelId: 'chan-test' },
          db
        );
      }).toThrow(/Maximum delegation depth reached/);
    });

    it('executes hiring and cleanly tears down ephemeral agents', () => {
      const proposal = DynamicHiringService.createProposal(
        { displayName: 'TempAgent', roleTitle: 'EphemeralResearcher', isEphemeral: true },
        { agentId: 'agent-boss', projectId: 'proj-test', channelId: 'chan-test' },
        db
      );

      const hired = DynamicHiringService.executeHiring(
        proposal,
        { agentId: 'agent-boss', projectId: 'proj-test', channelId: 'chan-test' },
        db
      );

      expect(hired.agentId).toBeDefined();
      expect(hired.isEphemeral).toBe(true);

      // Check SQLite records
      const row = db.queryOne<{ id: string; is_ephemeral: number }>(
        'SELECT id, is_ephemeral FROM agent_identities WHERE id = ?',
        hired.agentId
      );
      expect(row?.is_ephemeral).toBe(1);

      // Teardown ephemeral agent
      const tornDown = DynamicHiringService.teardownEphemeralAgent(hired.agentId, db);
      expect(tornDown).toBe(true);

      // Verify deletion
      const checkRow = db.queryOne(
        'SELECT id FROM agent_identities WHERE id = ?',
        hired.agentId
      );
      expect(checkRow).toBeUndefined();
    });
  });

  // ==========================================================================
  // Feature 16: Loop Breaker, Shingle Hashing & Progressive Throttle
  // ==========================================================================
  describe('Feature 16: Loop Breaker & Debate Stagnation Protocol', () => {
    it('produces identical SHA-256 shingle hash across whitespace and markdown formatting', () => {
      const text1 = 'Please review the test output in `result.txt`:\n```json\n{"status": "ok"}\n```';
      const text2 = 'Please   review the   test output in `result.txt`:\n';
      const hash1 = calculateMessageHash(text1);
      const hash2 = calculateMessageHash(text2);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });

    it('detects alternating ping-pong debate pattern (A, B, A, B)', () => {
      const breaker = new LoopBreaker();
      const now = Date.now();
      const messages: Message[] = [
        { id: '1', channelId: 'c1', senderId: 'agent-A', senderType: 'agent', content: 'I suggest approach X', productivityScore: 0, createdAt: now - 3000 },
        { id: '2', channelId: 'c1', senderId: 'agent-B', senderType: 'agent', content: 'I disagree, approach Y is better', productivityScore: 0, createdAt: now - 2000 },
        { id: '3', channelId: 'c1', senderId: 'agent-A', senderType: 'agent', content: 'I suggest approach X', productivityScore: 0, createdAt: now - 1000 },
        { id: '4', channelId: 'c1', senderId: 'agent-B', senderType: 'agent', content: 'I disagree, approach Y is better', productivityScore: 0, createdAt: now },
      ];

      const evaluation = breaker.evaluateThread(messages);
      expect(evaluation.isPingPong).toBe(true);
      expect(evaluation.isStagnant).toBe(true);
      expect(evaluation.action).toBe('halt_and_escalate');
      expect(evaluation.conflictDossier).toBeDefined();
    });

    it('detects velocity breaches (> 4 peer agent turns in 30s without human)', () => {
      const breaker = new LoopBreaker();
      const now = Date.now();
      const messages: Message[] = [
        { id: '1', channelId: 'c1', senderId: 'agent-A', senderType: 'agent', content: 'turn 1', createdAt: now - 4000 },
        { id: '2', channelId: 'c1', senderId: 'agent-B', senderType: 'agent', content: 'turn 2', createdAt: now - 3000 },
        { id: '3', channelId: 'c1', senderId: 'agent-C', senderType: 'agent', content: 'turn 3', createdAt: now - 2000 },
        { id: '4', channelId: 'c1', senderId: 'agent-A', senderType: 'agent', content: 'turn 4', createdAt: now - 1000 },
        { id: '5', channelId: 'c1', senderId: 'agent-B', senderType: 'agent', content: 'turn 5', createdAt: now },
      ];

      const evaluation = breaker.evaluateThread(messages);
      expect(evaluation.isVelocityBreach).toBe(true);
      expect(evaluation.action).toBe('warn');
      expect(evaluation.suggestedThrottleMs).toBe(2500);
    });
  });

  // ==========================================================================
  // Feature 17: Local Model Discovery & Base URL Defaults
  // ==========================================================================
  describe('Feature 17: Local Model Discovery & Base URL Defaults', () => {
    it('configures 127.0.0.1 default base URLs to prevent IPv6 latency loops', () => {
      expect(DEFAULT_PROVIDER_BASE_URLS.lmstudio).toBe('http://127.0.0.1:1234/v1');
      expect(DEFAULT_PROVIDER_BASE_URLS.vllm).toBe('http://127.0.0.1:8000/v1');
      expect(DEFAULT_PROVIDER_BASE_URLS.openai_compatible).toBe('http://127.0.0.1:1234/v1');
    });

    it('maps model capabilities and preserves pricing structures', () => {
      const visionModel = ModelDiscoveryService.mapModelCapabilities('claude-3-5-sonnet');
      expect(visionModel.supportsVision).toBe(true);

      const reasoningModel = ModelDiscoveryService.mapModelCapabilities('deepseek-r1-distill-qwen-32b');
      expect(reasoningModel.supportsReasoning).toBe(true);

      const rawPricing = { prompt: '0.0000015', completion: '0.000002' };
      const parsed = ModelDiscoveryService.parsePricing(rawPricing);
      expect(parsed?.prompt).toBe('0.0000015');
      expect(parsed?.completion).toBe('0.000002');
    });
  });

  // ==========================================================================
  // Feature 18: Streaming Inference Client, Stall Guards & SSE Buffering
  // ==========================================================================
  describe('Feature 18: Streaming Inference Client & Stall Guard', () => {
    it('times out and rejects when stream chunk reading stalls', async () => {
      const stalledReader = {
        read: () => new Promise<{ done: boolean; value?: any }>(() => {}), // Stalls indefinitely
      };

      await expect(
        StreamingInferenceClient.readChunkWithTimeout(stalledReader, 50)
      ).rejects.toThrow(/timed out/);
    });

    it('flushes trailing SSE buffer when stream terminates without trailing newline', () => {
      let received: any = null;
      let isDone = false;

      const buffer = 'data: {"choices":[{"delta":{"content":"final token"}}]}';
      StreamingInferenceClient.flushSseBuffer(buffer, (payload, done) => {
        received = payload;
        isDone = done;
      });

      expect(received?.choices?.[0]?.delta?.content).toBe('final token');
      expect(isDone).toBe(false);
    });

    it('parses Anthropic streaming tool use events', () => {
      const startEvent = {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'call_123',
          name: 'readFile',
        },
      };

      const deltaEvent = {
        type: 'content_block_delta',
        delta: {
          type: 'input_json_delta',
          partial_json: '{"path": "test.txt"}',
        },
      };

      const parsedStart = StreamingInferenceClient.parseAnthropicStreamEvent(startEvent);
      expect(parsedStart?.type).toBe('tool_call_chunk');
      expect(parsedStart?.toolCall?.name).toBe('readFile');
      expect(parsedStart?.toolCall?.id).toBe('call_123');

      const parsedDelta = StreamingInferenceClient.parseAnthropicStreamEvent(deltaEvent);
      expect(parsedDelta?.type).toBe('tool_call_chunk');
      expect(parsedDelta?.toolCall?.argumentsDelta).toBe('{"path": "test.txt"}');
    });
  });

  // ==========================================================================
  // Feature 19: Quota Guard & Backoff
  // ==========================================================================
  describe('Feature 19: Quota Guard & Exponential Jitter Backoff', () => {
    it('parses Retry-After headers in seconds and RFC 7231 HTTP-Date formats', () => {
      // 1. Integer seconds
      expect(QuotaGuard.parseRetryAfter('120')).toBe(120);
      expect(QuotaGuard.parseRetryAfter(' 45 ')).toBe(45);

      // 2. RFC 7231 date 60 seconds into future
      const futureDate = new Date(Date.now() + 60000).toUTCString();
      const parsedSec = QuotaGuard.parseRetryAfter(futureDate);
      expect(parsedSec).toBeGreaterThanOrEqual(58);
      expect(parsedSec).toBeLessThanOrEqual(62);

      // 3. Invalid header returns undefined
      expect(QuotaGuard.parseRetryAfter('invalid-header')).toBeUndefined();
      expect(QuotaGuard.parseRetryAfter(null)).toBeUndefined();
    });

    it('computes randomized exponential backoff with full jitter', () => {
      const backoff0 = QuotaGuard.computeExponentialJitterBackoff(0, undefined, 1000, 30000);
      const backoff3 = QuotaGuard.computeExponentialJitterBackoff(3, undefined, 1000, 30000);

      expect(backoff0).toBeGreaterThanOrEqual(500);
      expect(backoff3).toBeGreaterThanOrEqual(500);
      expect(backoff3).toBeLessThanOrEqual(30000);

      // With instructed delay
      const instructed = QuotaGuard.computeExponentialJitterBackoff(1, 10, 1000, 30000);
      expect(instructed).toBeGreaterThanOrEqual(10000);
      expect(instructed).toBeLessThanOrEqual(15000);
    });

    it('identifies HTTP 429 quota exhaustion errors', () => {
      expect(QuotaGuard.isQuotaError('Rate limit reached', 429)).toBe(true);
      expect(QuotaGuard.isQuotaError('insufficient_quota error', 200)).toBe(true);
      expect(QuotaGuard.isQuotaError('Normal network timeout', 504)).toBe(false);
    });
  });

  // ==========================================================================
  // Feature 20: Context Compiler Token Budget Packing
  // ==========================================================================
  describe('Feature 20: Context Compiler Token Budget Packing', () => {
    it('packs memories proportionally within token budget', () => {
      const compiler = new ContextCompiler();
      const memories = [
        { id: '1', agentId: 'agent-boss', tier: 'core' as const, key: 'rule1', content: 'Core instruction rule', tokenCount: 20 },
        { id: '2', agentId: 'agent-boss', tier: 'recall' as const, key: 'fact1', content: 'A very long recall memory content that should be pruned when budget is low', tokenCount: 80 },
        { id: '3', agentId: 'agent-boss', tier: 'archival' as const, key: 'fact2', content: 'Old archival memory', tokenCount: 50 },
      ];

      // Format with tight budget
      const formattedTight = compiler.formatMemoryList(memories, 40);
      expect(formattedTight).toContain('Core instruction rule');

      // Format with abundant budget
      const formattedFull = compiler.formatMemoryList(memories, 500);
      expect(formattedFull).toContain('Core instruction rule');
      expect(formattedFull).toContain('fact1');
      expect(formattedFull).toContain('fact2');
    });
  });

  // ==========================================================================
  // Feature 21: Windows MCP Argument Escaping
  // ==========================================================================
  describe('Feature 21: Windows MCP Client Safety', () => {
    it('properly quotes and sanitizes arguments on Windows', () => {
      // Test arguments containing shell metacharacters
      const rawArg = 'hello & calc.exe';
      const safeArg = `"${rawArg.replace(/"/g, '""')}"`;
      expect(safeArg).toBe('"hello & calc.exe"');
    });
  });

  // ==========================================================================
  // Feature 22: Skill Engine BigInt Parameter Serialization
  // ==========================================================================
  describe('Feature 22: Skill Engine BigInt Parameter Serialization', () => {
    it('safely serializes BigInt parameters without crashing JSON serialization', () => {
      const complexParams = {
        id: 123,
        largeCounter: 9007199254740993n,
        nested: {
          timestampNano: 1730000000000000000n,
          label: 'benchmark',
        },
        list: [1n, 2n, 3n],
      };

      const sanitized = SkillEngine.sanitizeForWorker(complexParams);
      expect(sanitized.id).toBe(123);
      expect(sanitized.largeCounter).toBe('9007199254740993');
      expect(sanitized.nested.timestampNano).toBe('1730000000000000000');
      expect(sanitized.nested.label).toBe('benchmark');
      expect(sanitized.list).toEqual(['1', '2', '3']);
    });
  });

  // ==========================================================================
  // Feature 23: Cron Scheduler Jitter & Background Messages
  // ==========================================================================
  describe('Feature 23: Cron Scheduler Load-Leveling Jitter', () => {
    it('supports exactTiming and load-leveling jitter options', () => {
      const scheduler = new Scheduler(db);
      const exactSchedule = scheduler.createCronSchedule({
        name: 'Exact Schedule',
        cronExpression: '*/5 * * * *',
        targetAgentId: 'agent-boss',
        channelId: 'chan-test',
        exactTiming: true,
      });

      expect(exactSchedule.id).toBeDefined();

      const jitterSchedule = scheduler.createCronSchedule({
        name: 'Jitter Schedule',
        cronExpression: '*/5 * * * *',
        targetAgentId: 'agent-boss',
        channelId: 'chan-test',
        exactTiming: false,
        jitterSeconds: 15,
      });

      expect(jitterSchedule.id).toBeDefined();
    });

    it('persists is_background flag to messages table', () => {
      const channelService = new ChannelService(db);
      const bgMessage = channelService.postMessage({
        channelId: 'chan-test',
        senderId: 'scheduler',
        senderType: 'system',
        content: 'Periodic heartbeat',
        isBackground: true,
      });

      expect(bgMessage.id).toBeDefined();
      const row = db.queryOne<{ is_background: number }>(
        'SELECT is_background FROM messages WHERE id = ?',
        bgMessage.id
      );
      expect(row?.is_background).toBe(1);
    });
  });

  // ==========================================================================
  // Feature 24: Task DAG Dependency Tracking & Cascade Blocking
  // ==========================================================================
  describe('Feature 24: Task DAG Dependency Tracking & Cascade Blocking', () => {
    let taskRepo: TaskRepository;

    beforeEach(() => {
      taskRepo = new TaskRepository(db);
      // Create tasks
      taskRepo.createTask({
        id: 'task-A',
        goalId: 'goal-test',
        title: 'Task A',
        description: 'Upstream task',
        status: 'ready',
      });
      taskRepo.createTask({
        id: 'task-B',
        goalId: 'goal-test',
        title: 'Task B',
        description: 'Midstream task depending on A',
        status: 'backlog',
      });
      taskRepo.createTask({
        id: 'task-C',
        goalId: 'goal-test',
        title: 'Task C',
        description: 'Downstream task depending on B',
        status: 'backlog',
      });
    });

    it('adds and queries task dependencies and dependents', () => {
      taskRepo.addDependency('task-B', 'task-A');
      taskRepo.addDependency('task-C', 'task-B');

      expect(taskRepo.getTaskDependencies('task-B')).toEqual(['task-A']);
      expect(taskRepo.getTaskDependencies('task-C')).toEqual(['task-B']);
      expect(taskRepo.getTaskDependents('task-A')).toEqual(['task-B']);
      expect(taskRepo.getTaskDependents('task-B')).toEqual(['task-C']);

      // Hydration into Task model
      const taskB = taskRepo.getTask('task-B');
      expect(taskB?.dependsOnTaskIds).toEqual(['task-A']);
    });

    it('rejects self-dependencies and cyclic dependency graphs', () => {
      // Self-dependency
      expect(() => taskRepo.addDependency('task-A', 'task-A')).toThrow(
        /Self-dependency not permitted/
      );

      taskRepo.addDependency('task-B', 'task-A');
      taskRepo.addDependency('task-C', 'task-B');

      // Immediate 2-node cycle: A cannot depend on B
      expect(() => taskRepo.addDependency('task-A', 'task-B')).toThrow(
        /would introduce a cycle/
      );

      // Multi-hop cycle: A cannot depend on C
      expect(() => taskRepo.addDependency('task-A', 'task-C')).toThrow(
        /would introduce a cycle/
      );
    });

    it('removes dependencies cleanly', () => {
      taskRepo.addDependency('task-B', 'task-A');
      expect(taskRepo.getTaskDependencies('task-B')).toEqual(['task-A']);

      taskRepo.removeDependency('task-B', 'task-A');
      expect(taskRepo.getTaskDependencies('task-B')).toEqual([]);
    });

    it('cascades blocked status down the dependency graph on upstream failure', () => {
      taskRepo.addDependency('task-B', 'task-A');
      taskRepo.addDependency('task-C', 'task-B');

      // Upstream task-A fails
      taskRepo.updateTaskStatus('task-A', 'failed');

      // Both task-B and task-C must be cascaded to 'blocked'
      const taskB = taskRepo.getTask('task-B');
      const taskC = taskRepo.getTask('task-C');

      expect(taskB?.status).toBe('blocked');
      expect(taskC?.status).toBe('blocked');
    });

    it('promotes dependent tasks from backlog to ready when dependencies complete', () => {
      taskRepo.addDependency('task-B', 'task-A');

      expect(taskRepo.getTask('task-B')?.status).toBe('backlog');

      // Promote dependents of task-A
      const promoted = taskRepo.promoteDependentTasks('task-A');
      expect(promoted).toEqual(['task-B']);

      expect(taskRepo.getTask('task-B')?.status).toBe('ready');
    });
  });
});
