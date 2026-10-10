import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { MemoryRepository } from '../src/domain/memory_repository.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { ContextCompiler } from '../src/context/context_compiler.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { ActivationEngine } from '../src/communication/activation_engine.js';
import { RunnerAdapterRegistry, NativeReActRunnerAdapter } from '../src/kernel/runner_adapter.js';
import { AgentLoopRunner } from '../src/kernel/agent_loop.js';
import { ModelGateway } from '../src/execution/model_gateway.js';
import { SchedulerService } from '../src/automation/scheduler.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { RecoveryEngine } from '../src/recovery/recovery_engine.js';
import { FinancialSafetyShield } from '../src/policy/financial_safety.js';

describe('KIN Enterprise Multi-Agent Workforce Architecture', () => {
  const testDbPath = path.resolve(process.cwd(), './test_enterprise_workforce.sqlite');
  let db: KinDatabase;
  let workspaceRepo: WorkspaceRepository;
  let agentRepo: AgentRepository;
  let memoryRepo: MemoryRepository;
  let taskRepo: TaskRepository;
  let contextCompiler: ContextCompiler;

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
    contextCompiler = new ContextCompiler();

    const now = Date.now();
    workspaceRepo.createWorkspace({
      id: 'ws-enterprise',
      name: 'Enterprise Workforce Workspace',
      rootPath: process.cwd(),
      defaultAutonomyMode: 'AUTO',
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    try { db.close(); } catch {}
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    RunnerAdapterRegistry.clear();
  });

  describe('1. Strict Project Boundary Containment', () => {
    it('strictly isolates agent identities to their respective project organization', () => {
      const now = Date.now();
      // Provision two distinct projects
      workspaceRepo.createProject({
        id: 'proj-alpha',
        workspaceId: 'ws-enterprise',
        name: 'Alpha Project',
        repoPath: path.resolve(process.cwd(), 'alpha'),
        settings: {},
        createdAt: now,
      });

      workspaceRepo.createProject({
        id: 'proj-beta',
        workspaceId: 'ws-enterprise',
        name: 'Beta Project',
        repoPath: path.resolve(process.cwd(), 'beta'),
        settings: {},
        createdAt: now,
      });

      // Seed definitions
      agentRepo.createDefinition({
        id: 'def-engineer',
        name: 'Engineer',
        role: 'Software Engineer',
        systemPrompt: 'You build high-performance software.',
        defaultModelId: 'mock-model',
        domainAuthority: ['code'],
        capabilities: ['fs:read', 'fs:write'],
        createdAt: now,
      });

      // Create identity in Alpha
      agentRepo.createIdentity({
        id: 'agent-alpha-eng',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-alpha',
        definitionId: 'def-engineer',
        displayName: '@AlphaEngineer',
        activeModelId: 'mock-model',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      // Create identity in Beta
      agentRepo.createIdentity({
        id: 'agent-beta-eng',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-beta',
        definitionId: 'def-engineer',
        displayName: '@BetaEngineer',
        activeModelId: 'mock-model',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      // Verification: project boundary containment
      const alphaAgents = agentRepo.listIdentitiesByProject('proj-alpha');
      expect(alphaAgents.map((a) => a.id)).toContain('agent-alpha-eng');
      expect(alphaAgents.map((a) => a.id)).not.toContain('agent-beta-eng');

      const betaAgents = agentRepo.listIdentitiesByProject('proj-beta');
      expect(betaAgents.map((a) => a.id)).toContain('agent-beta-eng');
      expect(betaAgents.map((a) => a.id)).not.toContain('agent-alpha-eng');

      // Verify cross-project lookup fails closed
      expect(agentRepo.getIdentityByProjectAndName('proj-alpha', '@BetaEngineer')).toBeUndefined();
      expect(agentRepo.getIdentityByProjectAndName('proj-beta', '@AlphaEngineer')).toBeUndefined();
    });

    it('ensures independent project-scoped Boss instances per project', () => {
      const now = Date.now();
      workspaceRepo.createProject({
        id: 'proj-omega-1',
        workspaceId: 'ws-enterprise',
        name: 'Omega 1',
        repoPath: '/tmp/omega1',
        settings: {},
        createdAt: now,
      });
      workspaceRepo.createProject({
        id: 'proj-omega-2',
        workspaceId: 'ws-enterprise',
        name: 'Omega 2',
        repoPath: '/tmp/omega2',
        settings: {},
        createdAt: now,
      });

      const boss1 = agentRepo.ensureProjectBoss('proj-omega-1', 'ws-enterprise');
      const boss2 = agentRepo.ensureProjectBoss('proj-omega-2', 'ws-enterprise');

      expect(boss1).toBeDefined();
      expect(boss2).toBeDefined();
      expect(boss1.projectId).toBe('proj-omega-1');
      expect(boss2.projectId).toBe('proj-omega-2');
      expect(boss1.id).not.toBe(boss2.id);

      // Subsequent call returns the existing project boss without duplication
      const boss1Again = agentRepo.ensureProjectBoss('proj-omega-1', 'ws-enterprise');
      expect(boss1Again.id).toBe(boss1.id);
    });

    it('prevents assigning coworkers across project boundaries via ToolGateway', async () => {
      const now = Date.now();
      workspaceRepo.createProject({
        id: 'proj-team-a',
        workspaceId: 'ws-enterprise',
        name: 'Team A',
        repoPath: '/tmp/teama',
        settings: {},
        createdAt: now,
      });
      workspaceRepo.createProject({
        id: 'proj-team-b',
        workspaceId: 'ws-enterprise',
        name: 'Team B',
        repoPath: '/tmp/teamb',
        settings: {},
        createdAt: now,
      });

      workspaceRepo.createChannel({
        id: 'chan-team-a',
        projectId: 'proj-team-a',
        name: 'team-a-dev',
        isPrivate: false,
        createdAt: now,
      });

      agentRepo.createDefinition({
        id: 'def-spec',
        name: 'Spec',
        role: 'Specialist',
        systemPrompt: 'Work.',
        defaultModelId: 'mock-model',
        domainAuthority: [],
        capabilities: ['*'],
        createdAt: now,
      });

      agentRepo.createIdentity({
        id: 'agent-in-b',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-team-b',
        definitionId: 'def-spec',
        displayName: '@AgentInB',
        activeModelId: 'mock-model',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      const gateway = new ToolGateway({ db, agentRepo });

      const res = await gateway.executeTool(
        'assignCoworker',
        { coworker: '@AgentInB', channelId: 'chan-team-a' },
        { agentId: 'agent-boss', projectId: 'proj-team-a', channelId: 'chan-team-a', allowedCapabilities: ['*'] }
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not found in project 'proj-team-a'/);
    });
  });

  describe('2. 4-Tier Memory Scoping & Isolation', () => {
    it('assembles and strictly isolates the 4 memory tiers in compiled prompts', () => {
      const now = Date.now();
      const proj = {
        id: 'proj-mem',
        workspaceId: 'ws-enterprise',
        name: 'Memory Project',
        repoPath: '/tmp/mem-proj',
        settings: {},
        createdAt: now,
        updatedAt: now,
      };

      const def = {
        id: 'def-worker',
        name: 'Worker',
        role: 'Developer',
        systemPrompt: 'You build features.',
        defaultModelId: 'mock-model',
        domainAuthority: [],
        capabilities: [],
        createdAt: now,
      };

      const agentA = {
        id: 'agent-alice',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-mem',
        definitionId: 'def-worker',
        displayName: '@Alice',
        activeModelId: 'mock-model',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };

      const agentB = {
        id: 'agent-bob',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-mem',
        definitionId: 'def-worker',
        displayName: '@Bob',
        activeModelId: 'mock-model',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };

      // Tier 1: Project Knowledge
      const projectMemories = [
        { key: 'coding_standard', type: 'semantic', value: 'Use TypeScript strict mode' },
      ];

      // Tier 2: Channel Working Memory
      const channelMemories = [
        { key: 'active_sprint_goal', type: 'semantic', value: 'Implement authentication flow' },
      ];

      // Tier 3: Alice's Private Memory
      const alicePrivateMemories = [
        { key: 'personal_scratchpad', type: 'working_state', value: 'Investigate token expiration issue in login route' },
      ];

      // Tier 3: Bob's Private Memory
      const bobPrivateMemories = [
        { key: 'personal_scratchpad', type: 'working_state', value: 'Review database migrations for foreign key consistency' },
      ];

      // Compile for Alice
      const compiledAlice = contextCompiler.compile({
        agentDefinition: def,
        agentIdentity: agentA,
        project: proj,
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: [],
        activeChannel: { id: 'chan-features', name: 'features' },
        projectMemories,
        channelMemories,
        agentPrivateMemories: alicePrivateMemories,
      });

      // Compile for Bob
      const compiledBob = contextCompiler.compile({
        agentDefinition: def,
        agentIdentity: agentB,
        project: proj,
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: [],
        activeChannel: { id: 'chan-features', name: 'features' },
        projectMemories,
        channelMemories,
        agentPrivateMemories: bobPrivateMemories,
      });

      // Verify Tier 1 is present in both
      expect(compiledAlice.fullAssembledPrompt).toContain('TIER 1: PROJECT-SHARED GROUNDING & KNOWLEDGE');
      expect(compiledAlice.fullAssembledPrompt).toContain('Use TypeScript strict mode');
      expect(compiledBob.fullAssembledPrompt).toContain('Use TypeScript strict mode');

      // Verify Tier 2 is present in both
      expect(compiledAlice.fullAssembledPrompt).toContain('TIER 2: CONVERSATION & CHANNEL-SCOPED CONTEXT');
      expect(compiledAlice.fullAssembledPrompt).toContain('Implement authentication flow');
      expect(compiledBob.fullAssembledPrompt).toContain('Implement authentication flow');

      // Verify Tier 3 is confidential: Alice sees her own scratchpad, not Bob's
      expect(compiledAlice.fullAssembledPrompt).toContain('TIER 3: AGENT-PRIVATE MEMORY (Confidential to @Alice)');
      expect(compiledAlice.fullAssembledPrompt).toContain('Investigate token expiration issue');
      expect(compiledAlice.fullAssembledPrompt).not.toContain('Review database migrations for foreign key consistency');

      // Bob sees his scratchpad, not Alice's
      expect(compiledBob.fullAssembledPrompt).toContain('TIER 3: AGENT-PRIVATE MEMORY (Confidential to @Bob)');
      expect(compiledBob.fullAssembledPrompt).toContain('Review database migrations for foreign key consistency');
      expect(compiledBob.fullAssembledPrompt).not.toContain('Investigate token expiration issue');
    });

    it('enforces Tier 4 DM Isolation banner when inside direct message', () => {
      const now = Date.now();
      const def = {
        id: 'def-peer',
        name: 'Peer',
        role: 'Peer',
        systemPrompt: 'Talk.',
        defaultModelId: 'mock',
        domainAuthority: [],
        capabilities: [],
        createdAt: now,
      };
      const agent = {
        id: 'agent-1',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-mem',
        definitionId: 'def-peer',
        displayName: '@PeerA',
        activeModelId: 'mock',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };

      const compiledDm = contextCompiler.compile({
        agentDefinition: def,
        agentIdentity: agent,
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: [],
        activeChannel: { id: 'dm-1-2', name: 'dm-1-2', isPrivate: true, channelType: 'direct_message' },
        dmContext: { isDirectMessage: true, participants: ['@PeerA', '@PeerB'] },
      });

      expect(compiledDm.fullAssembledPrompt).toContain('TIER 4: PRIVATE DIRECT MESSAGE ISOLATION');
      expect(compiledDm.fullAssembledPrompt).toContain('@PeerA, @PeerB');
      expect(compiledDm.fullAssembledPrompt).toContain('Privacy Invariant');
    });
  });

  describe('3. Agent-to-Agent Direct Messaging & Privacy', () => {
    it('creates private DM channels between project coworkers and dispatches messages', async () => {
      const now = Date.now();
      workspaceRepo.createProject({
        id: 'proj-dm-test',
        workspaceId: 'ws-enterprise',
        name: 'DM Test Project',
        repoPath: '/tmp/dm-proj',
        settings: {},
        createdAt: now,
      });

      agentRepo.createDefinition({
        id: 'def-colleague',
        name: 'Colleague',
        role: 'Colleague',
        systemPrompt: 'Help.',
        defaultModelId: 'mock',
        domainAuthority: [],
        capabilities: ['*'],
        createdAt: now,
      });

      agentRepo.createIdentity({
        id: 'agent-dev',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-dm-test',
        definitionId: 'def-colleague',
        displayName: '@Dev',
        activeModelId: 'mock',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      agentRepo.createIdentity({
        id: 'agent-qa',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-dm-test',
        definitionId: 'def-colleague',
        displayName: '@QA',
        activeModelId: 'mock',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      const gateway = new ToolGateway({ db, agentRepo });

      const res = await gateway.executeTool<any>(
        'sendDirectMessage',
        { recipient: '@QA', message: 'Can you verify the build on feature branch?' },
        { agentId: 'agent-dev', projectId: 'proj-dm-test', channelId: 'chan-general', allowedCapabilities: ['*'] }
      );

      expect(res.success).toBe(true);
      expect(res.output?.sent).toBe(true);
      expect(res.output?.recipientId).toBe('agent-qa');
      expect(res.output?.channelId).toMatch(/^dm-/);

      // Verify DM channel was persisted with direct_message channel_type and is_private = 1
      const dmChannel = workspaceRepo.getChannel(res.output?.channelId);
      expect(dmChannel).toBeDefined();
      expect(dmChannel?.isPrivate).toBe(true);
      expect(dmChannel?.channelType).toBe('direct_message');

      // Verify channel members include both agents
      const members = workspaceRepo.listChannelMemberIds(res.output?.channelId);
      expect(members).toContain('agent-dev');
      expect(members).toContain('agent-qa');
    });

    it('isolates private DM channels in activation engine routing', async () => {
      const activationEngine = new ActivationEngine();
      const mockAgents = [
        { id: 'agent-lead', displayName: '@Lead', isOrchestrator: true, roleTitle: 'Lead', systemPrompt: '' },
        { id: 'agent-specialist', displayName: '@Specialist', isOrchestrator: false, roleTitle: 'Specialist', systemPrompt: '' },
      ] as any[];

      const dmChannel = {
        id: 'dm-agent-lead-agent-specialist',
        projectId: 'proj-1',
        name: 'dm-lead-spec',
        isPrivate: true,
        channelType: 'direct_message' as const,
        createdAt: Date.now(),
      };

      // A direct mention inside a DM to the participant should activate that participant
      const routing = activationEngine.evaluateChannelRouting({
        channelId: dmChannel.id,
        isPrivate: true,
        message: {
          id: 'msg-dm-1',
          channelId: dmChannel.id,
          senderId: 'agent-lead',
          senderType: 'agent',
          content: '@Specialist please check the test log.',
          mentions: ['Specialist'],
          productivityScore: 100,
          createdAt: Date.now(),
        },
        channelMembers: mockAgents,
        allProjectAgents: mockAgents,
        definitionsMap: new Map(),
      });

      expect(routing.action).toBe('direct_response');
      expect(routing.targetAgents.map((a) => a.id)).toContain('agent-specialist');
      expect(routing.targetAgents.map((a) => a.id)).not.toContain('agent-lead');
    });
  });

  describe('4. Boss Coworker Assignment & Meeting Convening', () => {
    it('allows Boss to assign existing coworkers to a department channel', async () => {
      const now = Date.now();
      workspaceRepo.createProject({
        id: 'proj-org',
        workspaceId: 'ws-enterprise',
        name: 'Org Project',
        repoPath: '/tmp/org',
        settings: {},
        createdAt: now,
      });

      const boss = agentRepo.ensureProjectBoss('proj-org', 'ws-enterprise');

      agentRepo.createDefinition({
        id: 'def-architect',
        name: 'Architect',
        role: 'Systems Architect',
        systemPrompt: 'Architecture.',
        defaultModelId: 'mock',
        domainAuthority: [],
        capabilities: ['*'],
        createdAt: now,
      });

      const architect = agentRepo.createIdentity({
        id: 'agent-arch',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-org',
        definitionId: 'def-architect',
        displayName: '@Architect',
        activeModelId: 'mock',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      workspaceRepo.createChannel({
        id: 'chan-infra',
        projectId: 'proj-org',
        name: 'infra-team',
        isPrivate: false,
        createdAt: now,
      });

      const gateway = new ToolGateway({ db, agentRepo });
      let assignedCoworker: any = null;
      gateway.setAssignCoworkerCallback((coworker, channelId) => {
        assignedCoworker = { coworker, channelId };
      });

      const res = await gateway.executeTool<any>(
        'assignCoworker',
        { coworker: '@Architect', channelId: 'chan-infra' },
        { agentId: boss.id, projectId: 'proj-org', channelId: 'chan-infra', allowedCapabilities: ['*'] }
      );

      expect(res.success).toBe(true);
      expect(res.output?.assigned).toBe(true);
      expect(res.output?.agentId).toBe('agent-arch');
      expect(workspaceRepo.listChannelMemberIds('chan-infra')).toContain('agent-arch');
      expect(assignedCoworker).toBeDefined();
      expect(assignedCoworker.coworker.id).toBe('agent-arch');
    });

    it('allows Boss to convene a meeting with agenda and invited participants', async () => {
      const now = Date.now();
      workspaceRepo.createProject({
        id: 'proj-council',
        workspaceId: 'ws-enterprise',
        name: 'Council Project',
        repoPath: '/tmp/council',
        settings: {},
        createdAt: now,
      });

      const boss = agentRepo.ensureProjectBoss('proj-council', 'ws-enterprise');

      agentRepo.createDefinition({
        id: 'def-sec',
        name: 'Security Lead',
        role: 'Security',
        systemPrompt: 'Security review.',
        defaultModelId: 'mock',
        domainAuthority: [],
        capabilities: ['*'],
        createdAt: now,
      });

      agentRepo.createIdentity({
        id: 'agent-sec',
        workspaceId: 'ws-enterprise',
        projectId: 'proj-council',
        definitionId: 'def-sec',
        displayName: '@SecurityLead',
        activeModelId: 'mock',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      const gateway = new ToolGateway({ db, agentRepo });
      let meetingPayload: any = null;
      gateway.setCallMeetingCallback((params) => {
        meetingPayload = params;
      });

      const res = await gateway.executeTool<any>(
        'callMeeting',
        {
          topic: 'Q3 Security Architecture Review',
          agenda: 'Audit credential vault, review jail paths, verify sandboxing',
          participants: ['@SecurityLead'],
        },
        { agentId: boss.id, projectId: 'proj-council', channelId: 'chan-general', allowedCapabilities: ['*'] }
      );

      expect(res.success).toBe(true);
      expect(res.output?.convened).toBe(true);
      expect(res.output?.channelId).toMatch(/^chan-meeting-/);
      expect(res.output?.participantCount).toBeGreaterThanOrEqual(1);

      // Verify channel in database
      const meetingChannel = workspaceRepo.getChannel(res.output?.channelId);
      expect(meetingChannel).toBeDefined();
      expect(meetingChannel?.channelType).toBe('meeting');

      // Verify participants were joined to channel
      const members = workspaceRepo.listChannelMemberIds(res.output?.channelId);
      expect(members).toContain(boss.id);
      expect(members).toContain('agent-sec');

      expect(meetingPayload).toBeDefined();
      expect(meetingPayload.topic).toBe('Q3 Security Architecture Review');
    });
  });

  describe('5. RunnerAdapter Execution Engine', () => {
    it('registers NativeReActRunnerAdapter and dispatches executions through the registry', async () => {
      const mockModelGateway = new ModelGateway();
      const mockToolGateway = new ToolGateway({ db, agentRepo });
      const mockScheduler = new SchedulerService(db);
      const mockSkillEngine = new SkillEngine(db);
      const mockRecovery = new RecoveryEngine(mockSkillEngine);
      const mockSafety = new FinancialSafetyShield();

      const loopRunner = new AgentLoopRunner(
        mockModelGateway,
        mockToolGateway,
        mockScheduler,
        mockSkillEngine,
        mockRecovery,
        mockSafety
      );

      const nativeAdapter = new NativeReActRunnerAdapter(loopRunner);
      RunnerAdapterRegistry.register(nativeAdapter, true);

      // Verify registry lookup
      const defaultAdapter = RunnerAdapterRegistry.getDefault();
      expect(defaultAdapter.id).toBe('native-react');
      expect(defaultAdapter.name).toContain('Native ReAct');

      const listed = RunnerAdapterRegistry.list();
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe('native-react');

      // Registering a custom runner adapter
      let customExecuted = false;
      const customAdapter = {
        id: 'custom-openhands-adapter',
        name: 'OpenHands Compatible Adapter',
        version: '1.0.0',
        execute: async () => {
          customExecuted = true;
          return {
            completed: true,
            totalTurns: 1,
            tokensUsed: 100,
            conversationHistory: [],
            actionsTaken: [],
          };
        },
      };

      RunnerAdapterRegistry.register(customAdapter);
      expect(RunnerAdapterRegistry.list()).toHaveLength(2);

      RunnerAdapterRegistry.setDefault('custom-openhands-adapter');
      expect(RunnerAdapterRegistry.getDefault().id).toBe('custom-openhands-adapter');

      const result = await RunnerAdapterRegistry.getDefault().execute({} as any);
      expect(customExecuted).toBe(true);
      expect(result.completed).toBe(true);
    });
  });
});
