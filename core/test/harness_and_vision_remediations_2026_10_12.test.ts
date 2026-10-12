import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { ToolGateway, hasDirectMessageCompletionToken } from '../src/execution/tool_gateway.js';
import { Sentinel } from '../src/security/sentinel.js';
import { ContextCompiler } from '../src/context/context_compiler.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { MemoryRepository } from '../src/domain/memory_repository.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { ActivationEngine } from '../src/communication/activation_engine.js';

describe('KIN Vision & DeepSeek Harness Remediations (2026-10-12)', () => {
  let tempBaseDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let agentRepo: AgentRepository;
  let memoryRepo: MemoryRepository;
  let workspaceRepo: WorkspaceRepository;
  let toolGateway: ToolGateway;

  beforeEach(() => {
    const tmp = process.env.TEMP || process.env.TMP || '/tmp';
    tempBaseDir = path.join(tmp, `kin-vision-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(tempBaseDir, { recursive: true });
    dbPath = path.join(tempBaseDir, 'test.sqlite');

    db = new KinDatabase(dbPath);
    new MigrationRunner(db, { forceEmbedded: true }).runMigrations();
    agentRepo = new AgentRepository(db);
    memoryRepo = new MemoryRepository(db);
    workspaceRepo = new WorkspaceRepository(db);

    // Seed default workspace and project
    workspaceRepo.createWorkspace({
      id: 'ws-default',
      name: 'Default Workspace',
      rootPath: tempBaseDir,
      defaultAutonomyMode: 'AUTO',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    workspaceRepo.createProject({
      id: 'proj-kin',
      workspaceId: 'ws-default',
      name: 'KIN Project',
      repoPath: tempBaseDir,
      settings: { defaultModel: 'ollama/gemma' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    toolGateway = new ToolGateway({
      db,
      memoryRepo,
      agentRepo,
    });
    toolGateway.setMemoryRepository(memoryRepo);
    toolGateway.setAgentRepository(agentRepo);
  });

  afterEach(() => {
    try {
      db.close();
      if (fs.existsSync(tempBaseDir)) {
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('1. Subagent Default Model Inheritance', () => {
    it('inherits caller agent activeModelId when suggestedModel is omitted', async () => {
      const now = Date.now();
      // Register caller agent with gemma model
      agentRepo.createDefinition({
        id: 'def-hiring-caller',
        name: 'Alex',
        role: 'Tech Lead',
        systemPrompt: 'You are Alex.',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['code'],
        capabilities: ['agent:hire'],
        createdAt: now,
      });

      agentRepo.createIdentity({
        id: 'agent-alex',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-hiring-caller',
        displayName: '@Alex',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      const res = await toolGateway.executeTool<any>('hireSpecialist', {
        displayName: 'Quinn',
        roleTitle: 'QA Specialist',
      }, {
        agentId: 'agent-alex',
        projectId: 'proj-kin',
        channelId: 'chan-general',
      });

      expect(res.success).toBe(true);
      expect(res.output.activeModelId).toBe('ollama/gemma');

      // Verify persisted identity in SQLite inherited gemma
      const hiredAgent = agentRepo.getIdentity(res.output.agentId);
      expect(hiredAgent).toBeDefined();
      expect(hiredAgent?.activeModelId).toBe('ollama/gemma');
    });

    it('falls back to project default model when caller agent has no active model', async () => {
      const res = await toolGateway.executeTool<any>('hireSpecialist', {
        displayName: 'Morgan',
        roleTitle: 'Security Specialist',
      }, {
        projectId: 'proj-kin',
        channelId: 'chan-general',
      });

      expect(res.success).toBe(true);
      expect(res.output.activeModelId).toBe('ollama/gemma');
    });

    it('honors explicitly specified suggestedModel over inherited model', async () => {
      const res = await toolGateway.executeTool<any>('hireSpecialist', {
        displayName: 'Jordan',
        roleTitle: 'Frontend Specialist',
        suggestedModel: 'anthropic/claude-3-7-sonnet',
      }, {
        projectId: 'proj-kin',
        channelId: 'chan-general',
      });

      expect(res.success).toBe(true);
      expect(res.output.activeModelId).toBe('anthropic/claude-3-7-sonnet');
    });
  });

  describe('2. Department Channel Memory (rememberChannel & recallChannel)', () => {
    it('registers rememberChannel and recallChannel schemas in ToolGateway', () => {
      const schemas = toolGateway.getToolSchemas();
      const rememberSchema = schemas.find((s) => s.name === 'rememberChannel');
      const recallSchema = schemas.find((s) => s.name === 'recallChannel');

      expect(rememberSchema).toBeDefined();
      expect(rememberSchema?.parameters?.properties?.key).toBeDefined();
      expect(rememberSchema?.parameters?.properties?.value).toBeDefined();

      expect(recallSchema).toBeDefined();
    });

    it('Sentinel recognizes rememberChannel and recallChannel under memory:manage capability', () => {
      const sentinel = Sentinel.getInstance();
      const capRemember = sentinel.getRequiredCapability('rememberChannel');
      const capRecall = sentinel.getRequiredCapability('recallChannel');

      expect(capRemember.primary).toBe('memory:manage');
      expect(capRecall.primary).toBe('memory:manage');
    });

    it('records and recalls channel-scoped memories correctly', async () => {
      const channelId = 'chan-engineering';
      const recordRes = await toolGateway.executeTool<any>('rememberChannel', {
        key: 'Deployment_Guideline',
        value: 'Deployments must pass linting and unit test verification.',
        type: 'procedural',
      }, {
        channelId,
        projectId: 'proj-kin',
      });

      expect(recordRes.success).toBe(true);
      expect(recordRes.output.scope).toBe('channel');
      expect(recordRes.output.channelId).toBe(channelId);

      // Verify in memory repository
      const memory = memoryRepo.getMemory('channel', channelId, 'Deployment_Guideline');
      expect(memory).toBeDefined();
      expect(memory?.value).toBe('Deployments must pass linting and unit test verification.');

      // Recall via tool
      const recallRes = await toolGateway.executeTool<any>('recallChannel', {
        key: 'Deployment_Guideline',
      }, {
        channelId,
        projectId: 'proj-kin',
      });

      expect(recallRes.success).toBe(true);
      expect(recallRes.output.memories.length).toBe(1);
      expect(recallRes.output.memories[0].key).toBe('Deployment_Guideline');
    });
  });

  describe('3. Multi-Department Structured Memory Expansion in ContextCompiler', () => {
    it('compiles memories from other assigned departments into Block 3 Tier 2', () => {
      const compiler = new ContextCompiler();

      const input = {
        agentDefinition: {
          id: 'def-engineer',
          name: 'Sam',
          role: 'Full Stack Engineer',
          systemPrompt: 'You are Sam.',
          defaultModelId: 'ollama/gemma',
          domainAuthority: [],
          capabilities: ['fs:read', 'fs:write'],
          createdAt: Date.now(),
        },
        agentIdentity: {
          id: 'agent-sam',
          workspaceId: 'ws-default',
          projectId: 'proj-kin',
          definitionId: 'def-engineer',
          displayName: '@Sam',
          activeModelId: 'ollama/gemma',
          isOrchestrator: false,
          isEphemeral: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        project: {
          id: 'proj-kin',
          workspaceId: 'ws-default',
          name: 'KIN Project',
          repoPath: tempBaseDir,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: [],
        activeChannel: { id: 'chan-engineering', name: 'engineering' },
        assignedChannels: ['#engineering', '#research'],
        channelMemories: [
          { key: 'Eng_Standard', value: 'Use TypeScript strict mode.', type: 'working_state' },
        ],
        assignedDepartmentMemories: [
          {
            channelId: 'chan-research',
            channelName: '#research',
            memories: [
              { key: 'Research_Finding', value: 'Local models benefit from structured tool blocks.', type: 'semantic' },
            ],
          },
        ],
      };

      const compiled = compiler.compile(input);

      // Verify active channel memory is present
      expect(compiled.fullAssembledPrompt).toContain('Channel Working Memory:');
      expect(compiled.fullAssembledPrompt).toContain('Eng_Standard: Use TypeScript strict mode.');

      // Verify cross-department structured memory is expanded
      expect(compiled.fullAssembledPrompt).toContain('Other Assigned Department (#research) Structured Memory:');
      expect(compiled.fullAssembledPrompt).toContain('Research_Finding: Local models benefit from structured tool blocks.');
    });
  });

  describe('4. Peer Direct Messaging Ping-Pong Prevention', () => {
    it('detects completion tokens in direct messages accurately', () => {
      expect(hasDirectMessageCompletionToken('Everything looks good! [ACK]')).toBe(true);
      expect(hasDirectMessageCompletionToken('[RESOLVED] I have merged the branch.')).toBe(true);
      expect(hasDirectMessageCompletionToken('The review is [COMPLETE].')).toBe(true);
      expect(hasDirectMessageCompletionToken('Work is done. [CLOSED]')).toBe(true);
    });

    it('guards against false-positives on forward-looking requests', () => {
      // Questions or instructions mentioning complete/ack should not trigger completion token
      expect(hasDirectMessageCompletionToken('Please complete the task when you are ready.')).toBe(false);
      expect(hasDirectMessageCompletionToken('Can you acknowledge if the server is up?')).toBe(false);
      expect(hasDirectMessageCompletionToken('Thanks in advance for reviewing.')).toBe(false);
    });
  });

  describe('5. Direct Messaging to Human Operator (recipient="user" / "human")', () => {
    it('dispatches direct message to human operator in dedicated dm-${agentId} channel and emits operator:notification', async () => {
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-dm-sender',
        name: 'Jordan',
        role: 'Frontend Architect',
        systemPrompt: 'You are Jordan.',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['ui'],
        capabilities: ['chat:write'],
        createdAt: now,
      });

      agentRepo.createIdentity({
        id: 'agent-jordan',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-dm-sender',
        displayName: '@Jordan',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      const notifications: any[] = [];
      toolGateway.setOperatorNotificationCallback((notif) => {
        notifications.push(notif);
      });

      let callbackParams: any = null;
      toolGateway.setDirectMessageCallback(async (params) => {
        callbackParams = params;
        return { channelId: `dm-${params.senderAgentId}`, consecutiveTurns: 1 };
      });

      const res = await toolGateway.executeTool<any>('sendDirectMessage', {
        recipient: 'user',
        message: 'Hello operator, I have completed the frontend refactoring.',
      }, {
        agentId: 'agent-jordan',
        projectId: 'proj-kin',
        channelId: 'chan-general',
      });

      expect(res.success).toBe(true);
      expect(res.output.sent).toBe(true);
      expect(res.output.channelId).toBe('dm-agent-jordan');
      expect(res.output.recipientId).toBe('human');
      expect(callbackParams).toBeDefined();
      expect(callbackParams.recipientAgentId).toBe('human');
      expect(callbackParams.content).toContain('completed the frontend refactoring');

      // Operator notification emitted
      expect(notifications.length).toBeGreaterThan(0);
      const humanDmNotif = notifications.find((n) => n.type === 'agent_dm_to_human');
      expect(humanDmNotif).toBeDefined();
      expect(humanDmNotif.channelId).toBe('dm-agent-jordan');
      expect(humanDmNotif.fromAgentId).toBe('agent-jordan');
    });

    it('creates private DM channel in SQLite when directMessageCallback is not wired', async () => {
      const bareGateway = new ToolGateway({ db, agentRepo });
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-dm-bare',
        name: 'Dev',
        role: 'Developer',
        systemPrompt: 'You are Dev.',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['code'],
        capabilities: ['chat:write'],
        createdAt: now,
      });
      agentRepo.createIdentity({
        id: 'agent-dev',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-dm-bare',
        displayName: '@Dev',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      const res = await bareGateway.executeTool<any>('sendDirectMessage', {
        recipient: 'human',
        message: 'Direct update to human operator.',
      }, {
        agentId: 'agent-dev',
        projectId: 'proj-kin',
        channelId: 'chan-general',
      });

      expect(res.success).toBe(true);
      expect(res.output.channelId).toBe('dm-agent-dev');

      // Verify channel exists in database
      const row = db.queryOne<{ id: string; is_private: number }>(
        `SELECT id, is_private FROM channels WHERE id = ?`,
        'dm-agent-dev'
      );
      expect(row).toBeDefined();
      expect(row?.is_private).toBe(1);
    });
  });

  describe('6. Meeting Convening with Invited Participant Wakeup', () => {
    it('convenes meeting channel with agenda, records announcement, and triggers callMeetingCallback', async () => {
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-alex',
        name: 'Alex',
        role: 'Tech Lead',
        systemPrompt: 'You are Alex.',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['architecture'],
        capabilities: ['agent:hire'],
        createdAt: now,
      });
      agentRepo.createIdentity({
        id: 'agent-alex',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-alex',
        displayName: '@Alex',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      agentRepo.createDefinition({
        id: 'def-qa',
        name: 'QA',
        role: 'QA Specialist',
        systemPrompt: 'You are QA.',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['testing'],
        capabilities: ['agent:hire'],
        createdAt: now,
      });
      agentRepo.createIdentity({
        id: 'agent-qa',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-qa',
        displayName: '@QA',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      let meetingInvoked: any = null;
      toolGateway.setCallMeetingCallback((params) => {
        meetingInvoked = params;
      });

      const res = await toolGateway.executeTool<any>('callMeeting', {
        topic: 'frontend-performance-review',
        agenda: 'Review Core Web Vitals and lazy loading strategy.',
        participants: ['@QA'],
      }, {
        agentId: 'agent-alex',
        projectId: 'proj-kin',
        channelId: 'chan-general',
      });

      expect(res.success).toBe(true);
      expect(res.output.convened).toBe(true);
      expect(res.output.channelId).toContain('chan-meeting-frontend-performance-review');
      expect(meetingInvoked).toBeDefined();
      expect(meetingInvoked.topic).toBe('frontend-performance-review');
      expect(meetingInvoked.agenda).toContain('Core Web Vitals');
      expect(meetingInvoked.participantIds).toContain('agent-alex');
      expect(meetingInvoked.participantIds).toContain('agent-qa');

      // Verify channel in database
      const chanRow = db.queryOne<{ id: string; channel_type: string }>(
        `SELECT id, channel_type FROM channels WHERE id = ?`,
        res.output.channelId
      );
      expect(chanRow).toBeDefined();
      expect(chanRow?.channel_type).toBe('meeting');
    });
  });

  describe('7. Context Compiler Workforce Roster & Responsibilities Grounding', () => {
    it('renders project workforce roster and other assigned department rosters in Block 1', () => {
      const compiler = new ContextCompiler();

      const input = {
        agentDefinition: {
          id: 'def-boss',
          name: 'Boss',
          role: 'Workspace Orchestrator',
          systemPrompt: 'You are Boss.',
          defaultModelId: 'ollama/gemma',
          domainAuthority: ['orchestration'],
          capabilities: [],
          createdAt: Date.now(),
        },
        agentIdentity: {
          id: 'agent-boss',
          workspaceId: 'ws-default',
          projectId: 'proj-kin',
          definitionId: 'def-boss',
          displayName: '@Boss',
          activeModelId: 'ollama/gemma',
          isOrchestrator: true,
          isEphemeral: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        project: {
          id: 'proj-kin',
          workspaceId: 'ws-default',
          name: 'KIN Project',
          repoPath: tempBaseDir,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: [],
        activeChannel: { id: 'chan-general', name: 'general' },
        projectRoster: [
          {
            id: 'agent-boss',
            displayName: '@Boss',
            role: 'Workspace Orchestrator',
            domainAuthority: 'Orchestration, Management',
            status: 'Active',
            activeTask: 'Oversee project release',
          },
          {
            id: 'agent-frontend',
            displayName: '@Frontend',
            role: 'Frontend Specialist',
            domainAuthority: 'React, Vite, CSS',
            status: 'Active',
            activeTask: 'Build dashboard widgets',
          },
          {
            id: 'agent-qa',
            displayName: '@QA',
            role: 'QA Specialist',
            domainAuthority: 'Testing, Vitest, E2E',
            status: 'Active',
          },
        ],
        otherAssignedChannelRosters: [
          {
            channelId: 'chan-mobile',
            channelName: '#mobile',
            topic: 'Android & iOS development',
            members: ['@Boss', '@MobileDev'],
          },
        ],
      };

      const compiled = compiler.compile(input);

      // Verify Project Workforce Roster section is present
      expect(compiled.fullAssembledPrompt).toContain('[PROJECT WORKFORCE ROSTER & RESPONSIBILITIES]');
      expect(compiled.fullAssembledPrompt).toContain('@Frontend (Frontend Specialist): Domain: React, Vite, CSS, Status: Active, Current Task: "Build dashboard widgets"');
      expect(compiled.fullAssembledPrompt).toContain('@QA (QA Specialist): Domain: Testing, Vitest, E2E, Status: Active');

      // Verify Other Assigned Departments & Rosters section is present
      expect(compiled.fullAssembledPrompt).toContain('[OTHER ASSIGNED DEPARTMENTS & ROSTERS]');
      expect(compiled.fullAssembledPrompt).toContain('- #mobile (Android & iOS development): Members: @Boss, @MobileDev');

      // Verify operational invariants include DM to user and meeting convening
      expect(compiled.fullAssembledPrompt).toContain('Direct Messaging Invariant');
      expect(compiled.fullAssembledPrompt).toContain('Meeting Convening Invariant');
      expect(compiled.fullAssembledPrompt).toContain('Team & Role Awareness');
    });
  });

  describe('8. Selective Activation Engine Routing & Human Phrasing', () => {
    const activationEngine = new ActivationEngine();

    const boss: any = {
      id: 'agent-boss',
      displayName: '@Boss',
      definitionId: 'def-boss',
      isOrchestrator: true,
    };
    const frontend: any = {
      id: 'agent-frontend',
      displayName: '@Frontend',
      definitionId: 'def-frontend',
      isOrchestrator: false,
    };
    const backend: any = {
      id: 'agent-backend',
      displayName: '@Backend',
      definitionId: 'def-backend',
      isOrchestrator: false,
    };
    const mobile: any = {
      id: 'agent-mobile',
      displayName: '@Mobile',
      definitionId: 'def-mobile',
      isOrchestrator: false,
    };

    const definitions = new Map<string, any>([
      ['def-boss', { id: 'def-boss', role: 'Workspace Orchestrator', domainAuthority: ['orchestration'] }],
      ['def-frontend', { id: 'def-frontend', role: 'Frontend Specialist', domainAuthority: ['react', 'ui', 'css'] }],
      ['def-backend', { id: 'def-backend', role: 'Backend Specialist', domainAuthority: ['api', 'database', 'sql'] }],
      ['def-mobile', { id: 'def-mobile', role: 'Mobile Specialist', domainAuthority: ['android', 'ios'] }],
    ]);

    it('scopes @all strictly to channel members of the active channel, excluding outside project agents', () => {
      // In #frontend-dept: channelMembers are boss and frontend; backend and mobile are outside
      const routing = activationEngine.evaluateChannelRouting({
        channelId: 'chan-frontend-dept',
        isPrivate: false,
        message: {
          id: 'msg-1',
          channelId: 'chan-frontend-dept',
          senderId: 'user-operator',
          senderType: 'human',
          content: 'Hey @all review this mock',
          mentions: ['@all'],
          productivityScore: 1,
          createdAt: Date.now(),
        },
        channelMembers: [boss, frontend],
        allProjectAgents: [boss, frontend, backend, mobile],
        definitionsMap: definitions,
      });

      expect(routing.action).toBe('sequential_specialists');
      expect(routing.targetAgents.map((a) => a.id)).toEqual(['agent-boss', 'agent-frontend']);
      expect(routing.targetAgents.some((a) => a.id === 'agent-backend')).toBe(false);
      expect(routing.targetAgents.some((a) => a.id === 'agent-mobile')).toBe(false);
    });

    it('triggers sequential team introductions on natural phrasing ("hey all introduce yourself to me")', () => {
      const routing = activationEngine.evaluateChannelRouting({
        channelId: 'chan-general',
        isPrivate: false,
        message: {
          id: 'msg-2',
          channelId: 'chan-general',
          senderId: 'user-operator',
          senderType: 'human',
          content: 'hey all introduce yourself to me',
          mentions: [],
          productivityScore: 1,
          createdAt: Date.now(),
        },
        channelMembers: [boss, frontend, backend],
        allProjectAgents: [boss, frontend, backend],
        definitionsMap: definitions,
      });

      expect(routing.action).toBe('sequential_specialists');
      expect(routing.reason).toBe('team_introduction');
      expect(routing.targetAgents.length).toBe(3);
      expect(routing.targetAgents.map((a) => a.id)).toContain('agent-boss');
      expect(routing.targetAgents.map((a) => a.id)).toContain('agent-frontend');
      expect(routing.targetAgents.map((a) => a.id)).toContain('agent-backend');
    });

    it('activates named coworker when mentioned by whole word in text without @', () => {
      const routing = activationEngine.evaluateChannelRouting({
        channelId: 'chan-general',
        isPrivate: false,
        message: {
          id: 'msg-3',
          channelId: 'chan-general',
          senderId: 'user-operator',
          senderType: 'human',
          content: 'Frontend could you check the login page styling?',
          mentions: [],
          productivityScore: 1,
          createdAt: Date.now(),
        },
        channelMembers: [boss, frontend, backend],
        allProjectAgents: [boss, frontend, backend],
        definitionsMap: definitions,
      });

      expect(routing.action).toBe('sequential_specialists');
      expect(routing.targetAgents.length).toBe(1);
      expect(routing.targetAgents[0].id).toBe('agent-frontend');
      expect(routing.reason).toBe('named_in_text');
    });
  });

  describe('9. Direct Message Origin Channel Tracking and Context Awareness', () => {
    it('passes sourceChannelId from tool context when agent sends DM to human operator', async () => {
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-alex-sender',
        name: 'Alex',
        role: 'Tech Lead',
        systemPrompt: 'You are Alex.',
        defaultModelId: 'ollama/gemma',
        domainAuthority: ['code'],
        capabilities: ['chat:write'],
        createdAt: now,
      });
      agentRepo.createIdentity({
        id: 'agent-alex',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-alex-sender',
        displayName: '@Alex',
        activeModelId: 'ollama/gemma',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      let receivedParams: any = null;
      toolGateway.setDirectMessageCallback(async (params) => {
        receivedParams = params;
        return { channelId: `dm-${params.senderAgentId}`, consecutiveTurns: 1 };
      });

      const res = await toolGateway.executeTool<any>('sendDirectMessage', {
        recipient: 'user',
        message: 'Hello operator, messaging you in private DM as requested from the frontend channel.',
      }, {
        agentId: 'agent-alex',
        projectId: 'proj-kin',
        channelId: 'chan-frontend',
      });

      expect(res.success).toBe(true);
      expect(receivedParams).toBeDefined();
      expect(receivedParams.sourceChannelId).toBe('chan-frontend');
      expect(receivedParams.senderAgentId).toBe('agent-alex');
      expect(receivedParams.recipientAgentId).toBe('human');
    });

    it('renders Direct Message Origin Channel and Origin Channel Invariant in ContextCompiler', () => {
      const compiler = new ContextCompiler();

      const compiled = compiler.compile({
        agentDefinition: {
          id: 'def-alex',
          name: 'Alex',
          role: 'Tech Lead',
          systemPrompt: 'You are Alex.',
          defaultModelId: 'ollama/gemma',
          domainAuthority: ['code'],
          capabilities: [],
          createdAt: Date.now(),
        },
        agentIdentity: {
          id: 'agent-alex',
          workspaceId: 'ws-default',
          projectId: 'proj-kin',
          definitionId: 'def-alex',
          displayName: '@Alex',
          activeModelId: 'ollama/gemma',
          isOrchestrator: false,
          isEphemeral: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: [],
        activeChannel: { id: 'dm-agent-alex', name: 'DM', isPrivate: true, channelType: 'direct_message' },
        dmContext: {
          isDirectMessage: true,
          participants: ['Human Operator', '@Alex'],
          originChannel: {
            id: 'chan-frontend',
            name: 'frontend',
            members: ['@Alex', '@QA', '@Designer'],
          },
        },
        assignedChannels: ['#general', '#frontend'],
        projectAgents: ['@Alex', '@QA', '@Designer', '@Boss'],
      });

      expect(compiled.fullAssembledPrompt).toContain('Direct Message Origin Channel: #frontend (Members in origin channel: @Alex, @QA, @Designer)');
      expect(compiled.fullAssembledPrompt).toContain('Origin Channel Invariant: You were asked to message the operator in this DM from #frontend');
      expect(compiled.fullAssembledPrompt).toContain('explain that this private direct message is strictly 1-on-1 between you and the operator');
    });
  });

  describe('10. Channel Staffing Invariants in ContextCompiler', () => {
    it('renders Channel Staffing & Coworker Assignment Invariant covering assignCoworker and hireSpecialist', () => {
      const compiler = new ContextCompiler();

      const compiled = compiler.compile({
        agentDefinition: {
          id: 'def-boss',
          name: 'Boss',
          role: 'Lead Orchestrator',
          systemPrompt: 'You are Boss.',
          defaultModelId: 'ollama/gemma',
          domainAuthority: ['orchestration'],
          capabilities: [],
          createdAt: Date.now(),
        },
        agentIdentity: {
          id: 'agent-boss',
          workspaceId: 'ws-default',
          projectId: 'proj-kin',
          definitionId: 'def-boss',
          displayName: '@Boss',
          activeModelId: 'ollama/gemma',
          isOrchestrator: true,
          isEphemeral: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: [],
        activeChannel: { id: 'chan-new-dept', name: 'mobile', isPrivate: false, channelType: 'channel' },
      });

      expect(compiled.fullAssembledPrompt).toContain('Channel Staffing & Coworker Assignment Invariant: Every new channel starts with only the Lead Orchestrator (@Boss)');
      expect(compiled.fullAssembledPrompt).toContain("Option 1 (Call Existing Coworker): If a coworker with that expertise already works in another department/channel of this project, use the 'assignCoworker' tool");
      expect(compiled.fullAssembledPrompt).toContain("Option 2 (Hire New Specialist): You can hire a brand-new specialist dedicated to this channel using the 'hireSpecialist' tool");
    });
  });
});

