import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CoreServer } from '../src/server/core_server.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { ContextCompiler } from '../src/context/context_compiler.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { Sentinel } from '../src/security/sentinel.js';
import { AgentIdentity, AgentDefinition } from '../src/domain/types.js';

describe('Audit Remediation & Vision Verification Suite', () => {
  let db: KinDatabase;
  let agentRepo: AgentRepository;
  let workspaceRepo: WorkspaceRepository;
  let server: CoreServer;
  let port: number;
  let baseUrl: string;
  const tempDbPath = path.join(process.cwd(), `test_audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.sqlite`);

  beforeEach(async () => {
    server = new CoreServer({
      dbPath: tempDbPath,
      requireIpcAuth: false,
      port: 0,
    });

    port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
    db = (server as any).db;
    agentRepo = (server as any).agentRepo;
    workspaceRepo = (server as any).workspaceRepo;
  });

  afterEach(async () => {
    await server.stop();
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      const wal = `${tempDbPath}-wal`;
      const shm = `${tempDbPath}-shm`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}
  });

  describe('Defect 1: Composite DM REST Auto-Provisioning Foreign Key Resilience', () => {
    it('successfully provisions compound DM channel and enrolls both agents without foreign key error', async () => {
      const now = Date.now();
      const defA: AgentDefinition = {
        id: 'def-alpha',
        name: 'AlphaWorker',
        role: 'Alpha Specialist',
        systemPrompt: 'Alpha persona',
        defaultModelId: 'ollama/qwen2.5-coder:3b',
        domainAuthority: ['backend'],
        capabilities: ['read', 'write'],
        createdAt: now,
      };
      const defB: AgentDefinition = {
        id: 'def-beta',
        name: 'BetaWorker',
        role: 'Beta Specialist',
        systemPrompt: 'Beta persona',
        defaultModelId: 'ollama/qwen2.5-coder:3b',
        domainAuthority: ['frontend'],
        capabilities: ['read', 'write'],
        createdAt: now,
      };
      agentRepo.createDefinition(defA);
      agentRepo.createDefinition(defB);

      const agentA: AgentIdentity = {
        id: 'agent-alpha-comp',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-alpha',
        displayName: '@AlphaComp',
        activeModelId: 'ollama/qwen2.5-coder:3b',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      const agentB: AgentIdentity = {
        id: 'agent-beta-comp',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-beta',
        displayName: '@BetaComp',
        activeModelId: 'ollama/qwen2.5-coder:3b',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(agentA);
      agentRepo.createIdentity(agentB);

      const compositeChannelId = `dm-${agentA.id}-${agentB.id}`;
      // Verify channel does NOT exist beforehand
      expect(workspaceRepo.getChannel(compositeChannelId)).toBeUndefined();

      // Post message to unprovisioned composite channel
      const res = await fetch(`${baseUrl}/api/channels/${compositeChannelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello coworker peer!',
          senderId: agentA.id,
          senderType: 'agent',
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.message.content).toBe('Hello coworker peer!');

      // Verify channel was created and both agents enrolled
      const provisioned = workspaceRepo.getChannel(compositeChannelId);
      expect(provisioned).toBeDefined();
      expect(provisioned?.isPrivate).toBe(true);

      const members = workspaceRepo.listChannelMemberIds(compositeChannelId);
      expect(members).toContain(agentA.id);
      expect(members).toContain(agentB.id);
    });

    it('preserves single agent DM auto-provisioning for human-to-agent DMs', async () => {
      const now = Date.now();
      const def: AgentDefinition = {
        id: 'def-solo',
        name: 'SoloWorker',
        role: 'Solo Specialist',
        systemPrompt: 'Solo prompt',
        defaultModelId: 'ollama/qwen2.5-coder:3b',
        domainAuthority: ['qa'],
        capabilities: ['read'],
        createdAt: now,
      };
      agentRepo.createDefinition(def);

      const soloAgent: AgentIdentity = {
        id: 'agent-solo-user',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-solo',
        displayName: '@SoloWorker',
        activeModelId: 'ollama/qwen2.5-coder:3b',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };
      agentRepo.createIdentity(soloAgent);

      const singleDmChannelId = `dm-${soloAgent.id}`;
      const res = await fetch(`${baseUrl}/api/channels/${singleDmChannelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Direct human directive to solo agent',
          senderId: 'human-user',
          senderType: 'human',
        }),
      });

      expect(res.status).toBe(201);
      const members = workspaceRepo.listChannelMemberIds(singleDmChannelId);
      expect(members).toContain(soloAgent.id);
    });
  });

  describe('Defect 2: Field Name Inconsistency & Reporting Field in POST /api/agents', () => {
    it('accepts model and suggestedModel aliases and parentAgentId on hiring', async () => {
      // 1. Hiring with body.model and body.parentAgentId
      const hireRes1 = await fetch(`${baseUrl}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: '@ModelAliasAgent',
          roleTitle: 'Model Alias Specialist',
          model: 'ollama/deepseek-r1:8b',
          parentAgentId: 'agent-boss',
        }),
      });

      expect(hireRes1.status).toBe(201);
      const data1 = (await hireRes1.json()) as any;
      expect(data1.agent.activeModelId).toBe('ollama/deepseek-r1:8b');
      expect(data1.agent.parentAgentId).toBe('agent-boss');

      const persisted1 = agentRepo.getIdentity(data1.agent.id);
      expect(persisted1?.activeModelId).toBe('ollama/deepseek-r1:8b');
      expect(persisted1?.parentAgentId).toBe('agent-boss');

      // 2. Hiring with body.suggestedModel
      const hireRes2 = await fetch(`${baseUrl}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: '@SuggestedModelAgent',
          roleTitle: 'Suggested Model Specialist',
          suggestedModel: 'anthropic/claude-3-5-sonnet',
        }),
      });

      expect(hireRes2.status).toBe(201);
      const data2 = (await hireRes2.json()) as any;
      expect(data2.agent.activeModelId).toBe('anthropic/claude-3-5-sonnet');
    });
  });

  describe('Defect 5: Prefix-Cache Stability in ContextCompiler', () => {
    it('preserves Blocks 1, 2, and 3 byte-for-byte identical when crossChannelSummaries mutate', () => {
      const compiler = new ContextCompiler();
      const def: AgentDefinition = {
        id: 'def-stable',
        name: 'StableAgent',
        role: 'Stability Specialist',
        systemPrompt: 'Execute stable operations.',
        defaultModelId: 'ollama/qwen2.5-coder:3b',
        domainAuthority: ['core'],
        capabilities: ['read'],
        createdAt: 100,
      };
      const identity: AgentIdentity = {
        id: 'agent-stable',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-stable',
        displayName: '@StableAgent',
        activeModelId: 'ollama/qwen2.5-coder:3b',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: 100,
        updatedAt: 100,
      };

      const baseInput = {
        agentDefinition: def,
        agentIdentity: identity,
        toolSchemas: [{ name: 'readFile', description: 'Read', parameters: {} }],
        projectDecisions: [{ key: 'STORAGE', decision: 'SQLite WAL' }],
        trajectoryMessages: [],
        activeChannel: { id: 'chan-main', name: 'main' },
        channelPeers: ['@Boss'],
        assignedChannels: ['#main', '#side'],
        projectAgents: ['@Boss', '@StableAgent'],
      };

      // Turn 1: Without cross channel summaries
      const turn1 = compiler.compile({ ...baseInput });

      // Turn 2: With dynamic cross channel messages from #side
      const turn2 = compiler.compile({
        ...baseInput,
        crossChannelSummaries: [
          {
            channelName: 'side',
            topic: 'Side discussion',
            recentMessages: [
              { senderName: 'Human', content: 'Did we finish the schema?' },
              { senderName: '@Boss', content: 'Yes, fully complete.' },
            ],
          },
        ],
      });

      // Turn 3: With updated messages from #side
      const turn3 = compiler.compile({
        ...baseInput,
        crossChannelSummaries: [
          {
            channelName: 'side',
            topic: 'Side discussion',
            recentMessages: [
              { senderName: 'Human', content: 'Another turn happened.' },
            ],
          },
        ],
      });

      // Strict Prefix-Stability Invariant: Block 1 must NOT change when cross channel summaries change
      expect(turn1.systemPromptBlock).toBe(turn2.systemPromptBlock);
      expect(turn2.systemPromptBlock).toBe(turn3.systemPromptBlock);
      expect(turn1.systemPromptBlock).not.toContain('Cross-Channel Operational Memory:');

      // Blocks 2 & 3 must also be identical
      expect(turn1.toolSchemasBlock).toBe(turn2.toolSchemasBlock);
      expect(turn1.projectGroundingBlock).toBe(turn2.projectGroundingBlock);

      // Block 4 holds the dynamic cross-channel memory
      expect(turn2.compactionBlock).toContain('Cross-Channel Operational Memory:');
      expect(turn2.compactionBlock).toContain('Channel #side');
      expect(turn3.compactionBlock).toContain('Another turn happened.');
    });
  });

  describe('Defect 6: Organizational Reporting Tree & Hierarchical Spawning', () => {
    it('persists parentAgentId in hireSpecialist and returns reporting line in context', async () => {
      const gateway = (server as any).toolGateway as ToolGateway;

      // Hire subagent via hireSpecialist tool
      const hireResult = await gateway.executeTool(
        'hireSpecialist',
        {
          displayName: '@JuniorDev',
          roleTitle: 'Junior Developer',
          systemPrompt: 'Implement assigned features.',
        },
        {
          agentId: 'agent-boss',
          projectId: 'proj-kin',
          channelId: 'chan-general',
          autonomyMode: 'AUTO',
          worktreeRoot: process.cwd(),
        }
      );

      expect(hireResult.success).toBe(true);
      const hiredId = (hireResult.output as any).id;
      expect((hireResult.output as any).parentAgentId).toBe('agent-boss');

      // Verify repository persists and retrieves parentAgentId
      const junior = agentRepo.getIdentity(hiredId);
      expect(junior).toBeDefined();
      expect(junior?.parentAgentId).toBe('agent-boss');

      // Verify listSubordinates returns the newly hired subagent
      const subordinates = agentRepo.listSubordinates('agent-boss');
      expect(subordinates.some((s) => s.id === hiredId)).toBe(true);

      // Verify ContextCompiler renders organizational reporting line
      const compiler = new ContextCompiler();
      const compiled = compiler.compile({
        agentDefinition: {
          id: junior!.definitionId,
          name: junior!.displayName,
          role: junior!.roleTitle || 'Junior Developer',
          systemPrompt: junior!.systemPrompt || '',
          defaultModelId: junior!.activeModelId,
          domainAuthority: [],
          capabilities: [],
          createdAt: Date.now(),
        },
        agentIdentity: junior!,
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: [],
        activeChannel: { id: 'chan-general', name: 'general' },
        reportingLine: {
          manager: '@Boss',
          subordinates: [],
        },
      });

      expect(compiled.systemPromptBlock).toContain('Reporting Line / Manager: @Boss');
    });
  });

  describe('Lightweight Native Web Tools in ToolGateway', () => {
    it('registers fetchUrl and webSearch schemas mapped to web:browse capability', () => {
      const sentinel = new Sentinel();
      const gateway = (server as any).toolGateway as ToolGateway;
      const schemas = gateway.getToolSchemas();

      const fetchUrlSchema = schemas.find((s) => s.name === 'fetchUrl');
      const webSearchSchema = schemas.find((s) => s.name === 'webSearch');

      expect(fetchUrlSchema).toBeDefined();
      expect(webSearchSchema).toBeDefined();

      const fetchCap = sentinel.getRequiredCapability('fetchUrl');
      const searchCap = sentinel.getRequiredCapability('webSearch');

      expect(fetchCap.primary).toBe('web:browse');
      expect(searchCap.primary).toBe('web:browse');
    });

    it('executes fetchUrl using native HTTP fetch without browser launching', async () => {
      // Spin up local HTTP loopback server for controlled fetch test
      const testServer = http.createServer((req, res) => {
        if (req.url === '/data.json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', workforce: 'KIN' }));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', () => resolve()));
      const addr = testServer.address() as any;
      const testUrl = `http://127.0.0.1:${addr.port}/data.json`;

      try {
        const gateway = (server as any).toolGateway as ToolGateway;
        const result = await gateway.executeTool(
          'fetchUrl',
          { url: testUrl },
          {
            agentId: 'agent-boss',
            projectId: 'proj-kin',
            channelId: 'chan-general',
            autonomyMode: 'AUTO',
            worktreeRoot: process.cwd(),
          }
        );

        expect(result.success).toBe(true);
        const out = result.output as any;
        expect(out.status).toBe(200);
        expect(out.contentType).toContain('application/json');
        expect(out.content).toContain('KIN');
      } finally {
        await new Promise<void>((resolve) => testServer.close(() => resolve()));
      }
    });

    it('executes webSearch cleanly and returns structured results or graceful message', async () => {
      const gateway = (server as any).toolGateway as ToolGateway;
      const result = await gateway.executeTool(
        'webSearch',
        { query: 'TypeScript SQLite WAL', maxResults: 3 },
        {
          agentId: 'agent-boss',
          projectId: 'proj-kin',
          channelId: 'chan-general',
          autonomyMode: 'AUTO',
          worktreeRoot: process.cwd(),
        }
      );

      expect(result).toBeDefined();
      expect(result.riskLevel).toBe('LOW');
      const out = result.output as any;
      expect(out.query).toBe('TypeScript SQLite WAL');
      expect(Array.isArray(out.results)).toBe(true);
    });
  });

  describe('Shell Virtual Environment Detection', () => {
    it('detects .venv Scripts or bin directory and prepends to PATH', async () => {
      const testWorktree = path.join(process.cwd(), `test_venv_dir_${Date.now()}`);
      const isWin = process.platform === 'win32';
      const venvBinDir = isWin ? 'Scripts' : 'bin';
      const venvBinPath = path.join(testWorktree, '.venv', venvBinDir);

      fs.mkdirSync(venvBinPath, { recursive: true });

      try {
        const gateway = (server as any).toolGateway as ToolGateway;
        // Print PATH using shell
        const cmd = isWin ? 'echo %PATH%' : 'echo $PATH';
        const result = await gateway.executeTool(
          'executeShell',
          { command: cmd },
          {
            agentId: 'agent-boss',
            projectId: 'proj-kin',
            channelId: 'chan-general',
            autonomyMode: 'AUTO',
            worktreeRoot: testWorktree,
          }
        );

        expect(result.success).toBe(true);
        const stdout = (result.output as any).stdout;
        expect(stdout).toContain(venvBinPath);
      } finally {
        try {
          fs.rmSync(testWorktree, { recursive: true, force: true });
        } catch {}
      }
    });

    it('detects .venv in projectRoot when executing inside an isolated worktree child directory', async () => {
      const testProjectRoot = path.join(process.cwd(), `test_proj_root_${Date.now()}`);
      const testWorktree = path.join(testProjectRoot, '.kin', 'worktrees', 'run-test-venv');
      const isWin = process.platform === 'win32';
      const venvBinDir = isWin ? 'Scripts' : 'bin';
      const venvBinPath = path.join(testProjectRoot, '.venv', venvBinDir);

      fs.mkdirSync(venvBinPath, { recursive: true });
      fs.mkdirSync(testWorktree, { recursive: true });

      try {
        const gateway = (server as any).toolGateway as ToolGateway;
        const cmd = isWin ? 'echo %PATH%' : 'echo $PATH';
        const result = await gateway.executeTool(
          'executeShell',
          { command: cmd, projectRoot: testProjectRoot },
          {
            agentId: 'agent-boss',
            projectId: 'proj-kin',
            channelId: 'chan-general',
            autonomyMode: 'AUTO',
            worktreeRoot: testWorktree,
          }
        );

        expect(result.success).toBe(true);
        const stdout = (result.output as any).stdout;
        expect(stdout).toContain(venvBinPath);
      } finally {
        try {
          fs.rmSync(testProjectRoot, { recursive: true, force: true });
        } catch {}
      }
    });
  });

  describe('Edge Cases: Absent DM targets and explicit parentAgentId in hireSpecialist', () => {
    it('returns 404 when sending message to unprovisioned DM with non-existent target agent', async () => {
      const nonexistentChannelId = `dm-nonexistent-agent-${Date.now()}`;
      const res = await fetch(`${baseUrl}/api/channels/${nonexistentChannelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello void!',
          senderId: 'human-user',
          senderType: 'human',
        }),
      });

      expect(res.status).toBe(404);
      expect(workspaceRepo.getChannel(nonexistentChannelId)).toBeUndefined();
    });

    it('allows explicit parentAgentId in hireSpecialist parameters and updates existing unparented identity', async () => {
      const gateway = (server as any).toolGateway as ToolGateway;

      // 1. Hire agent with explicit parentAgentId parameter
      const hireRes1 = await gateway.executeTool(
        'hireSpecialist',
        {
          displayName: '@ExplicitChildDev',
          roleTitle: 'Frontend Engineer',
          parentAgentId: 'agent-boss',
        },
        {
          agentId: 'system',
          projectId: 'proj-kin',
          channelId: 'chan-general',
          autonomyMode: 'AUTO',
          worktreeRoot: process.cwd(),
        }
      );

      expect(hireRes1.success).toBe(true);
      const hiredId = (hireRes1.output as any).id;
      expect((hireRes1.output as any).parentAgentId).toBe('agent-boss');

      const child = agentRepo.getIdentity(hiredId);
      expect(child?.parentAgentId).toBe('agent-boss');

      // 2. Re-hiring existing agent updates parent_agent_id in SQLite if previously missing
      db.execute("UPDATE agent_identities SET parent_agent_id = NULL WHERE id = ?", hiredId);
      expect(agentRepo.getIdentity(hiredId)?.parentAgentId).toBeUndefined();

      const reHireRes = await gateway.executeTool(
        'hireSpecialist',
        {
          displayName: '@ExplicitChildDev',
          roleTitle: 'Frontend Engineer',
          parentAgentId: 'agent-boss',
        },
        {
          agentId: 'system',
          projectId: 'proj-kin',
          channelId: 'chan-general',
          autonomyMode: 'AUTO',
          worktreeRoot: process.cwd(),
        }
      );

      expect(reHireRes.success).toBe(true);
      const updatedChild = agentRepo.getIdentity(hiredId);
      expect(updatedChild?.parentAgentId).toBe('agent-boss');
    });
  });
});
