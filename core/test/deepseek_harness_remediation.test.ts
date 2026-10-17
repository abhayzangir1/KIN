import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { MemoryRepository } from '../src/domain/memory_repository.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { ContextCompiler } from '../src/context/context_compiler.js';
import { ToolGateway, hasDirectMessageCompletionToken } from '../src/execution/tool_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import { ChannelService } from '../src/communication/channel_service.js';
import { AgentIdentity } from '../src/domain/types.js';

describe('DeepSeek Harness & KIN Workforce Architecture Remediation Suite', () => {
  const testDbPath = path.resolve(os.tmpdir(), './test_harness_remediation.sqlite');
  let db: KinDatabase;
  let workspaceRepo: WorkspaceRepository;
  let agentRepo: AgentRepository;
  let memoryRepo: MemoryRepository;
  let taskRepo: TaskRepository;
  let channelService: ChannelService;
  let contextCompiler: ContextCompiler;
  let toolGateway: ToolGateway;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    db = new KinDatabase({ dbPath: testDbPath });
    new MigrationRunner(db).runMigrations();

    workspaceRepo = new WorkspaceRepository(db);
    agentRepo = new AgentRepository(db);
    memoryRepo = new MemoryRepository(db);
    taskRepo = new TaskRepository(db);
    channelService = new ChannelService(db);
    contextCompiler = new ContextCompiler();

    toolGateway = new ToolGateway({
      db,
      memoryRepo,
      agentRepo,
    });
    toolGateway.setMemoryRepository(memoryRepo);
    toolGateway.setAgentRepository(agentRepo);

    const now = Date.now();
    let ws = workspaceRepo.getWorkspace('ws-default');
    if (!ws) {
      workspaceRepo.createWorkspace({
        id: 'ws-default',
        name: 'Default Workspace',
        rootPath: process.cwd(),
        defaultAutonomyMode: 'AUTO',
        createdAt: now,
        updatedAt: now,
      });
    }

    workspaceRepo.createProject({
      id: 'proj-harness',
      workspaceId: 'ws-default',
      name: 'Harness Project',
      repoPath: process.cwd(),
      settings: { defaultBranch: 'main' },
      createdAt: now,
      updatedAt: now,
    });

    workspaceRepo.createChannel({
      id: 'chan-engineering',
      projectId: 'proj-harness',
      name: 'engineering',
      topic: 'Engineering channel',
      isPrivate: false,
      createdAt: now,
    });

    workspaceRepo.createChannel({
      id: 'chan-research',
      projectId: 'proj-harness',
      name: 'research',
      topic: 'Research channel',
      isPrivate: false,
      createdAt: now,
    });
  });

  afterEach(() => {
    try { db.close(); } catch {}
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  describe('Remediation 1: Subagent Default Model Inheritance', () => {
    it('inherits caller agent activeModelId when suggestedModel is omitted', async () => {
      const now = Date.now();
      // Provision hiring agent configured with local gemma model
      agentRepo.createDefinition({
        id: 'def-alex',
        name: 'Alex',
        role: 'Tech Lead',
        systemPrompt: 'You are @Alex',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['Architecture'],
        capabilities: ['agent:hire', 'fs:read', 'fs:write'],
        createdAt: now,
      });

      const alex: AgentIdentity = {
        id: 'agent-alex',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-alex',
        displayName: '@Alex',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(alex);

      workspaceRepo.addChannelMember('chan-engineering', alex.id);

      // Hire subagent through ToolGateway with caller agent context
      const res = await toolGateway.executeTool(
        'hireSpecialist',
        {
          displayName: 'Quinn',
          roleTitle: 'Quality Engineer',
          // suggestedModel intentionally omitted to test inheritance
        },
        {
          runId: 'run-test-hire-1',
          agentId: alex.id,
          projectId: 'proj-harness',
          channelId: 'chan-engineering',
          worktreeRoot: process.cwd(),
          autonomyMode: 'AUTO',
          allowedCapabilities: ['*'],
        }
      );

      expect(res.success).toBe(true);
      const output = res.output as any;
      expect(output.displayName).toBe('@Quinn');
      expect(output.activeModelId).toBe('ollama/gemma');

      // Verify persistence in SQLite
      const identityInDb = agentRepo.getIdentity(output.agentId);
      expect(identityInDb).toBeDefined();
      expect(identityInDb?.activeModelId).toBe('ollama/gemma');

      const definitionInDb = agentRepo.getDefinition(identityInDb!.definitionId);
      expect(definitionInDb?.defaultModelId).toBe('ollama/gemma');
    });

    it('respects explicit suggestedModel parameter when provided', async () => {
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-lead',
        name: 'Lead',
        role: 'Lead',
        systemPrompt: 'You are @Lead',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['Architecture'],
        capabilities: ['agent:hire'],
        createdAt: now,
      });

      const lead: AgentIdentity = {
        id: 'agent-lead',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-lead',
        displayName: '@Lead',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(lead);

      const res = await toolGateway.executeTool(
        'hireSpecialist',
        {
          displayName: 'Specialist',
          roleTitle: 'Data Analyst',
          suggestedModel: 'openrouter/anthropic/claude-3.7-sonnet',
        },
        {
          runId: 'run-test-hire-2',
          agentId: lead.id,
          projectId: 'proj-harness',
          channelId: 'chan-engineering',
          worktreeRoot: process.cwd(),
          autonomyMode: 'AUTO',
          allowedCapabilities: ['*'],
        }
      );

      expect(res.success).toBe(true);
      const output = res.output as any;
      expect(output.activeModelId).toBe('openrouter/anthropic/claude-3.7-sonnet');
    });

    it('inherits project orchestrator activeModelId when caller identity is not set', async () => {
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-boss-harness',
        name: 'Boss',
        role: 'Workspace Orchestrator',
        systemPrompt: 'You are @Boss',
        defaultModelId: 'ollama/gemma:latest',
        domainAuthority: ['Management'],
        capabilities: ['*'],
        createdAt: now,
      });

      const bossIdentity: AgentIdentity = {
        id: 'agent-boss-harness',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-boss-harness',
        displayName: '@Boss',
        activeModelId: 'ollama/gemma:latest',
        isOrchestrator: true,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(bossIdentity);

      const res = await toolGateway.executeTool(
        'hireSpecialist',
        {
          displayName: 'InfraEngineer',
          roleTitle: 'Site Reliability Specialist',
        },
        {
          runId: 'run-test-hire-3',
          agentId: '', // unassigned caller context
          projectId: 'proj-harness',
          channelId: 'chan-engineering',
          worktreeRoot: process.cwd(),
          autonomyMode: 'AUTO',
          allowedCapabilities: ['*'],
        }
      );

      expect(res.success).toBe(true);
      const output = res.output as any;
      expect(output.activeModelId).toBe('ollama/gemma:latest');
    });
  });

  describe('Remediation 2: Multi-Department Structured Memory Expansion', () => {
    it('compiles cross-department structured memories labeled by department name in Block 3', () => {
      const now = Date.now();
      const def = {
        id: 'def-staff',
        name: 'StaffEngineer',
        role: 'Staff Engineer',
        systemPrompt: 'Staff Prompt',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['Backend', 'Research'],
        capabilities: ['*'],
        createdAt: now,
      };

      const identity: AgentIdentity = {
        id: 'agent-staff',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-staff',
        displayName: '@StaffEngineer',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };

      const compiled = contextCompiler.compile({
        agentDefinition: def,
        agentIdentity: identity,
        project: workspaceRepo.getProject('proj-harness'),
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: [],
        activeChannel: { id: 'chan-engineering', name: 'engineering' },
        assignedChannels: ['#engineering', '#research'],
        channelMemories: [
          { key: 'port', type: 'semantic', value: '3000' },
        ],
        assignedDepartmentMemories: [
          {
            channelId: 'chan-research',
            channelName: 'research',
            memories: [
              { key: 'benchmark_target', type: 'semantic', value: 'sub-50ms latency' },
              { key: 'architecture_doc', type: 'semantic', value: 'event-sourcing spec' },
            ],
          },
        ],
        agentPrivateMemories: [],
      });

      expect(compiled.projectGroundingBlock).toContain('### TIER 2: CONVERSATION & CHANNEL-SCOPED CONTEXT:');
      expect(compiled.projectGroundingBlock).toContain('Channel Working Memory:');
      expect(compiled.projectGroundingBlock).toContain('- [semantic] port: 3000');
      // Verifies structured documentation from other assigned department is included and labeled
      expect(compiled.projectGroundingBlock).toContain('Other Assigned Department (#research) Structured Memory:');
      expect(compiled.projectGroundingBlock).toContain('- [semantic] benchmark_target: sub-50ms latency');
      expect(compiled.projectGroundingBlock).toContain('- [semantic] architecture_doc: event-sourcing spec');
    });
  });

  describe('Remediation 3: Agent-to-Agent Direct Messaging Ping-Pong Prevention', () => {
    it('detects completion tokens accurately across various formats and avoids false positives on task instructions', () => {
      expect(hasDirectMessageCompletionToken('[RESOLVED]')).toBe(true);
      expect(hasDirectMessageCompletionToken('The issue is RESOLVED.')).toBe(true);
      expect(hasDirectMessageCompletionToken('[ACK]')).toBe(true);
      expect(hasDirectMessageCompletionToken('ACK received.')).toBe(true);
      expect(hasDirectMessageCompletionToken('Task is ACKNOWLEDGED.')).toBe(true);
      expect(hasDirectMessageCompletionToken('[COMPLETE]')).toBe(true);
      expect(hasDirectMessageCompletionToken('Task execution COMPLETE')).toBe(true);
      expect(hasDirectMessageCompletionToken('All changes COMPLETED successfully')).toBe(true);
      expect(hasDirectMessageCompletionToken('THANK YOU for the quick review!')).toBe(true);
      expect(hasDirectMessageCompletionToken('THANKS! Have a good day.')).toBe(true);

      // Verifies non-terminal directives containing 'complete', 'ack', or 'thanks in advance' do NOT trigger premature cessation
      expect(hasDirectMessageCompletionToken('Please review file auth.ts')).toBe(false);
      expect(hasDirectMessageCompletionToken('Starting step 3 of execution')).toBe(false);
      expect(hasDirectMessageCompletionToken('Please complete the database schema')).toBe(false);
      expect(hasDirectMessageCompletionToken('Can you ack this request?')).toBe(false);
      expect(hasDirectMessageCompletionToken('Please send the files, thanks in advance')).toBe(false);
      expect(hasDirectMessageCompletionToken('We need to complete the migration')).toBe(false);
      expect(hasDirectMessageCompletionToken('Could you complete the unit tests for auth?')).toBe(false);
    });

    it('stops peer execution loop when completion indicator is sent', async () => {
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-a',
        name: 'WorkerA',
        role: 'Worker',
        systemPrompt: 'Worker A',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['Dev'],
        capabilities: ['*'],
        createdAt: now,
      });

      agentRepo.createDefinition({
        id: 'def-b',
        name: 'WorkerB',
        role: 'Worker',
        systemPrompt: 'Worker B',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['Dev'],
        capabilities: ['*'],
        createdAt: now,
      });

      const agentA: AgentIdentity = {
        id: 'agent-worker-a',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-a',
        displayName: '@WorkerA',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(agentA);

      const agentB: AgentIdentity = {
        id: 'agent-worker-b',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-b',
        displayName: '@WorkerB',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(agentB);

      const res = await toolGateway.executeTool(
        'sendDirectMessage',
        {
          recipient: '@WorkerB',
          message: 'Here are the requested logs. [RESOLVED]',
        },
        {
          runId: 'run-dm-1',
          agentId: agentA.id,
          projectId: 'proj-harness',
          worktreeRoot: process.cwd(),
          autonomyMode: 'AUTO',
          allowedCapabilities: ['*'],
        }
      );

      expect(res.success).toBe(true);
      const output = res.output as any;
      expect(output.sent).toBe(true);
      expect(output.enqueuedResponse).toBe(false);
      expect(output.stoppedReason).toContain('Completion token detected');
    });

    it('enforces turn ceiling after 5 consecutive agent-to-agent turns without human intervention', async () => {
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-p1',
        name: 'Peer1',
        role: 'Peer',
        systemPrompt: 'Peer 1',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['Dev'],
        capabilities: ['*'],
        createdAt: now,
      });

      agentRepo.createDefinition({
        id: 'def-p2',
        name: 'Peer2',
        role: 'Peer',
        systemPrompt: 'Peer 2',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['Dev'],
        capabilities: ['*'],
        createdAt: now,
      });

      const agentA: AgentIdentity = {
        id: 'agent-peer-1',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-p1',
        displayName: '@Peer1',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(agentA);

      const agentB: AgentIdentity = {
        id: 'agent-peer-2',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-p2',
        displayName: '@Peer2',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(agentB);

      const dmChannel = workspaceRepo.getOrCreateDirectMessageChannel(agentA.id, agentB.id, 'proj-harness');

      // Pre-seed 5 consecutive agent messages in the DM channel
      for (let i = 0; i < 5; i++) {
        channelService.sendMessage({
          channelId: dmChannel.id,
          senderId: i % 2 === 0 ? agentA.id : agentB.id,
          senderType: 'agent',
          content: `Automated exchange step ${i + 1}`,
          productivityScore: 1,
        });
      }

      // Next message should reach the 5-turn depth ceiling
      const res = await toolGateway.executeTool(
        'sendDirectMessage',
        {
          recipient: '@Peer2',
          message: 'Automated exchange step 6 without human input',
        },
        {
          runId: 'run-dm-turn-ceiling',
          agentId: agentA.id,
          projectId: 'proj-harness',
          worktreeRoot: process.cwd(),
          autonomyMode: 'AUTO',
          allowedCapabilities: ['*'],
        }
      );

      expect(res.success).toBe(true);
      const output = res.output as any;
      expect(output.enqueuedResponse).toBe(false);
      expect(output.stoppedReason).toContain('depth limit reached');
    });

    it('resets consecutive agent turn count when human operator intervenes in DM', async () => {
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-u1',
        name: 'BotAlpha',
        role: 'Bot',
        systemPrompt: 'Bot Alpha',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['Dev'],
        capabilities: ['*'],
        createdAt: now,
      });

      agentRepo.createDefinition({
        id: 'def-u2',
        name: 'BotBeta',
        role: 'Bot',
        systemPrompt: 'Bot Beta',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['Dev'],
        capabilities: ['*'],
        createdAt: now,
      });

      const agentA: AgentIdentity = {
        id: 'agent-user-dm-1',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-u1',
        displayName: '@BotAlpha',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(agentA);

      const agentB: AgentIdentity = {
        id: 'agent-user-dm-2',
        workspaceId: 'ws-default',
        projectId: 'proj-harness',
        definitionId: 'def-u2',
        displayName: '@BotBeta',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(agentB);

      const dmChannel = workspaceRepo.getOrCreateDirectMessageChannel(agentA.id, agentB.id, 'proj-harness');

      // 5 agent turns
      for (let i = 0; i < 5; i++) {
        channelService.sendMessage({
          channelId: dmChannel.id,
          senderId: agentA.id,
          senderType: 'agent',
          content: `Bot exchange ${i + 1}`,
          productivityScore: 1,
        });
      }

      // Operator sends message, resetting the turn count
      channelService.sendMessage({
        channelId: dmChannel.id,
        senderId: 'user-operator',
        senderType: 'human',
        content: 'Operator intervention: continue with verification.',
        productivityScore: 100,
      });

      // Subsequent agent message is now turn 1 and should allow response
      const res = await toolGateway.executeTool(
        'sendDirectMessage',
        {
          recipient: '@BotBeta',
          message: 'Continuing verification under operator supervision.',
        },
        {
          runId: 'run-dm-reset',
          agentId: agentA.id,
          projectId: 'proj-harness',
          worktreeRoot: process.cwd(),
          autonomyMode: 'AUTO',
          allowedCapabilities: ['*'],
        }
      );

      expect(res.success).toBe(true);
      const output = res.output as any;
      expect(output.enqueuedResponse).toBe(true);
      expect(output.stoppedReason).toBeUndefined();
    });
  });

  describe('Remediation 4: Channel Message Admission Queue Fencing', () => {
    const serverDbPath = path.resolve(os.tmpdir(), './test_harness_server_fencing.sqlite');
    let server: CoreServer;

    beforeEach(() => {
      if (fs.existsSync(serverDbPath)) {
        try { fs.unlinkSync(serverDbPath); } catch {}
      }
      server = new CoreServer({ port: 59998, dbPath: serverDbPath });
      const now = Date.now();
      const wsRepo = (server as any).workspaceRepo as WorkspaceRepository;
      if (!wsRepo.getWorkspace('ws-default')) {
        wsRepo.createWorkspace({
          id: 'ws-default',
          name: 'Default Workspace',
          rootPath: process.cwd(),
          defaultAutonomyMode: 'AUTO',
          createdAt: now,
          updatedAt: now,
        });
      }
      if (!wsRepo.getProject('proj-harness')) {
        wsRepo.createProject({
          id: 'proj-harness',
          workspaceId: 'ws-default',
          name: 'Harness Project',
          repoPath: process.cwd(),
          settings: { defaultBranch: 'main' },
          createdAt: now,
          updatedAt: now,
        });
      }
      if (!wsRepo.getChannel('chan-engineering')) {
        wsRepo.createChannel({
          id: 'chan-engineering',
          projectId: 'proj-harness',
          name: 'engineering',
          topic: 'Engineering channel',
          isPrivate: false,
          createdAt: now,
        });
      }
    });

    afterEach(async () => {
      try { await server.stop(); } catch {}
      if (fs.existsSync(serverDbPath)) {
        try { fs.unlinkSync(serverDbPath); } catch {}
      }
    });

    it('attaches fencing token and suppresses duplicate prompt execution cycles', async () => {
      const msg1 = {
        id: 'msg-fenced-test-1',
        channelId: 'chan-engineering',
        senderId: 'user-operator',
        senderType: 'human' as const,
        content: 'Generate deployment manifest for microservices',
        createdAt: Date.now(),
      };

      const dummyAgent = {
        id: 'agent-deployer',
        displayName: '@Deployer',
        definitionId: 'def-deploy',
        activeModelId: 'ollama/gemma',
        projectId: 'proj-harness',
      };

      let executionCount = 0;
      (server as any).enqueueChannelExecution = async (cId: string, fn: () => Promise<void>) => {
        executionCount++;
        return Promise.resolve();
      };

      // First admission executes
      await (server as any).executeSequentialAgents([dummyAgent], 'chan-engineering', msg1);
      expect(executionCount).toBe(1);

      // Re-admission of the same message ID is fenced and skipped
      await (server as any).executeSequentialAgents([dummyAgent], 'chan-engineering', msg1);
      expect(executionCount).toBe(1); // Still 1, duplicate execution prevented!

      // Verifies fencing token was attached
      expect((msg1 as any).fencingToken).toBeDefined();
      expect((msg1 as any).fencingToken).toMatch(/^fence-msg-fenced-test-1-\d+$/);
    });

    it('dequeuing from queued_messages assigns fencing token and avoids duplicate replay', async () => {
      const now = Date.now();
      const serverDb = (server as any).db as KinDatabase;

      // Seed candidate in queued_messages
      const qMsgId = 'qmsg-test-100';
      serverDb.execute(
        `INSERT INTO queued_messages (id, channel_id, sender_id, content, metadata_json, created_at)
         VALUES (?, ?, ?, ?, '{}', ?)`,
        qMsgId,
        'chan-engineering',
        'user-operator',
        'Test queued prompt',
        now
      );

      // Verify row exists
      const beforeRow = serverDb.queryOne<{ id: string }>('SELECT id FROM queued_messages WHERE id = ?', qMsgId);
      expect(beforeRow?.id).toBe(qMsgId);

      // Dequeue message
      const dequeued = await server.processNextQueuedMessage('chan-engineering');
      expect(dequeued).toBe(true);

      // Verify row was deleted and fencing map was populated
      const afterRow = serverDb.queryOne<{ id: string }>('SELECT id FROM queued_messages WHERE id = ?', qMsgId);
      expect(afterRow).toBeUndefined();

      const fence = (server as any).messageAdmissionFences.get(qMsgId);
      expect(fence).toBeDefined();
      expect(fence.fenceToken).toContain(`fence-${qMsgId}`);
    });
  });
});
