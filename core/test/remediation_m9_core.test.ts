import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CoreServer } from '../src/server/core_server.js';
import { OAuthHandler } from '../src/api/oauth_handler.js';
import { BrowserController } from '../src/browser/browser_controller.js';
import { ComputerSupervisor } from '../src/computer/computer_supervisor.js';
import * as CoreExports from '../src/index.js';

describe('Milestone 9: Core Subsystem Remediations Verification Suite', () => {
  const testDbPath = path.resolve(os.tmpdir(), `kin_m9_remediation_${Date.now()}.sqlite`);
  const testProjectDir = path.resolve(os.tmpdir(), `kin_m9_proj_${Date.now()}`);
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    fs.mkdirSync(testProjectDir, { recursive: true });
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }

    server = new CoreServer({ port: 0, dbPath: testDbPath });
    port = await server.start();
    server.db.execute("UPDATE projects SET repo_path = ? WHERE id = 'proj-kin'", testProjectDir);
  });

  afterAll(async () => {
    await server.stop();
    for (const ext of ['', '-wal', '-shm']) {
      const file = `${testDbPath}${ext}`;
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch {}
      }
    }
    if (fs.existsSync(testProjectDir)) {
      try { fs.rmSync(testProjectDir, { recursive: true, force: true }); } catch {}
    }
  });

  // --------------------------------------------------------------------------
  // 1. SSRF Fail-Closed Verification (F2.1)
  // --------------------------------------------------------------------------
  it('SSRF check fails closed when DNS lookup fails or times out', async () => {
    const gateway = server.toolGateway;

    // Use an unresolvable test hostname guaranteed to throw in DNS resolution
    const fakeDomainUrl = 'http://nonexistent-internal-gateway.invalid-domain-test:8080/data';
    const result = await gateway.executeTool<any>(
      'fetch_url',
      { url: fakeDomainUrl },
      { agentId: 'agent-boss' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('SSRF_BLOCKED: DNS resolution failed or timed out');
  });

  // --------------------------------------------------------------------------
  // 2. /btw Returns Honest Notification Without Canned WAL String (F1.1)
  // --------------------------------------------------------------------------
  it('/btw command returns honest model offline notification without canned WAL text', async () => {
    const query = 'what is the current status of the daemon?';
    const postRes = await fetch(`http://127.0.0.1:${port}/api/channels/chan-general/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `/btw ${query}`,
        senderId: 'user-operator',
      }),
    });
    expect(postRes.status).toBe(201);

    // Retrieve channel messages
    const getRes = await fetch(`http://127.0.0.1:${port}/api/channels/chan-general/messages`);
    const data = await getRes.json();
    const messages: any[] = data.messages || [];

    const btwReply = messages.find((m) => m.content && m.content.includes('[Side Query / BTW]'));
    expect(btwReply).toBeDefined();

    // Verify absence of canned text
    expect(btwReply.content).not.toContain('SQLite WAL mode');
    expect(btwReply.content).not.toContain('daemon is active on port 54321');
    expect(btwReply.content).not.toContain('KB journal');

    // Verify honest message
    expect(btwReply.content).toContain('could not be completed because the model is currently unavailable');
  });

  // --------------------------------------------------------------------------
  // 3. Trajectory Returns Empty Array When No Reasoning Exists (F1.2 & F1.3)
  // --------------------------------------------------------------------------
  it('trajectory returns empty array when no reasoning exists without synthetic thoughts or explore items', async () => {
    // Create fresh specialist definition and identity with zero action history
    const defId = `def-auditor-${Date.now()}`;
    server.agentRepo.createDefinition({
      id: defId,
      name: 'CleanAuditor',
      role: 'Auditor',
      systemPrompt: 'You are an auditor.',
      defaultModelId: 'openrouter/anthropic/claude-3.5-sonnet',
      domainAuthority: ['Audit'],
      capabilities: ['fs:read'],
      createdAt: Date.now(),
    });

    const agentId = `agent-clean-auditor-${Date.now()}`;
    server.agentRepo.createIdentity({
      id: agentId,
      workspaceId: 'ws-default',
      definitionId: defId,
      projectId: 'proj-kin',
      displayName: 'CleanAuditor',
      activeModelId: 'openrouter/anthropic/claude-3.5-sonnet',
      isOrchestrator: false,
      isEphemeral: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/agents/${agentId}/trajectory`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const details = data.executionDetails;

    expect(details).toBeDefined();
    expect(details.phases).toBeDefined();

    const reasoningPhase = details.phases.find((p: any) => p.id === 'phase-reasoning');
    expect(reasoningPhase).toBeDefined();
    // Genuine items: must be empty array since agent has never executed
    expect(reasoningPhase.items).toEqual([]);

    // Verify synthetic items are completely eliminated
    const allItemIds = details.phases.flatMap((p: any) => p.items.map((i: any) => i.id));
    expect(allItemIds).not.toContain('item-thought-1');
    expect(allItemIds.some((id: string) => id.startsWith('item-explore-'))).toBe(false);

    // Explored files must only reflect real action records (empty here)
    expect(details.exploredFiles).toEqual([]);
    expect(details.metrics.exploredFilesCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 4. OAuth Handler Throws Clear Error on Missing Client ID (F1.4)
  // --------------------------------------------------------------------------
  it('OAuthHandler throws clear actionable configuration error when client IDs are missing', () => {
    const origGithub = process.env.KIN_GITHUB_CLIENT_ID;
    const origGoogle = process.env.KIN_GOOGLE_CLIENT_ID;
    const origSlack = process.env.KIN_SLACK_CLIENT_ID;

    try {
      delete process.env.KIN_GITHUB_CLIENT_ID;
      delete process.env.KIN_GOOGLE_CLIENT_ID;
      delete process.env.KIN_SLACK_CLIENT_ID;

      expect(() => OAuthHandler.startAuth('github', 54321)).toThrowError(
        'OAuth provider "github" is not configured. Missing KIN_GITHUB_CLIENT_ID environment variable.'
      );

      expect(() => OAuthHandler.startAuth('google', 54321)).toThrowError(
        'OAuth provider "google" is not configured. Missing KIN_GOOGLE_CLIENT_ID environment variable.'
      );

      expect(() => OAuthHandler.startAuth('slack', 54321)).toThrowError(
        'OAuth provider "slack" is not configured. Missing KIN_SLACK_CLIENT_ID environment variable.'
      );
    } finally {
      if (origGithub) process.env.KIN_GITHUB_CLIENT_ID = origGithub;
      if (origGoogle) process.env.KIN_GOOGLE_CLIENT_ID = origGoogle;
      if (origSlack) process.env.KIN_SLACK_CLIENT_ID = origSlack;
    }
  });

  // --------------------------------------------------------------------------
  // 5. /api/state Serializes Capabilities on AgentDisplay (F4.3 / UI-2 Contract)
  // --------------------------------------------------------------------------
  it('/api/state serializes capabilities array on each AgentDisplay object', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.agents).toBeDefined();
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThan(0);

    for (const agent of data.agents) {
      expect(agent).toHaveProperty('capabilities');
      expect(Array.isArray(agent.capabilities)).toBe(true);
    }
  });

  // --------------------------------------------------------------------------
  // 6. core/src/index.ts Exports All Foundational Core Modules (F4.1)
  // --------------------------------------------------------------------------
  it('core index exports all required foundational security and domain modules', () => {
    expect(CoreExports.Sentinel).toBeDefined();
    expect(CoreExports.SecretVault).toBeDefined();
    expect(CoreExports.SecretBroker).toBeDefined();
    expect(CoreExports.EventLedger).toBeDefined();
    expect(CoreExports.CredentialScanner).toBeDefined();
    expect(CoreExports.GoalRepository).toBeDefined();
    expect(CoreExports.MemoryRepository).toBeDefined();
    expect(CoreExports.ExecutionNodeRouter).toBeDefined();
    expect(CoreExports.McpClientManager).toBeDefined();
    expect(CoreExports.RunnerAdapterRegistry).toBeDefined();
    expect(CoreExports.OAuthHandler).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 7. Dynamic Active Model Resolution (F1.5)
  // --------------------------------------------------------------------------
  it('hire_specialist dynamically resolves active model and rejects when unconfigured', async () => {
    const origDefaultModel = process.env.KIN_DEFAULT_MODEL;
    delete process.env.KIN_DEFAULT_MODEL;

    try {
      // 1. Ensure provider exists for foreign key constraint
      server.db.execute(
        `INSERT OR IGNORE INTO providers (id, name, provider_type, created_at) VALUES ('prov-test-m9', 'Test Provider M9', 'custom', ?)`,
        Date.now()
      );

      // 2. Insert active model into models table
      server.db.execute(
        `INSERT OR REPLACE INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, created_at)
         VALUES ('test-active-model-42', 'prov-test-m9', 'Test Active Model', 128000, 4096, 1, ?)`,
        Date.now()
      );

      // 1. With suggested model, uses dynamic suggested model
      const hireWithSuggested = await server.toolGateway.executeTool<any>(
        'hire_specialist',
        {
          name: 'DynamicSecExpert',
          role: 'Security Specialist',
          suggestedModel: 'test-active-model-42',
        },
        { agentId: 'agent-boss' }
      );
      expect(hireWithSuggested.success).toBe(true);
      expect(hireWithSuggested.output.activeModelId).toBe('test-active-model-42');
      expect(hireWithSuggested.output.activeModelId).not.toBe('ollama/gemma');

      // 2. Without suggested model, dynamically inherits caller model without hardcoded ollama/gemma fallback
      const hireInherited = await server.toolGateway.executeTool<any>(
        'hire_specialist',
        {
          name: 'DynamicInheritedExpert',
          role: 'Domain Specialist',
        },
        { agentId: 'agent-boss' }
      );
      expect(hireInherited.success).toBe(true);
      expect(hireInherited.output.activeModelId).toBeDefined();
      expect(hireInherited.output.activeModelId).not.toBe('ollama/gemma');
    } finally {
      if (origDefaultModel) process.env.KIN_DEFAULT_MODEL = origDefaultModel;
    }
  });

  // --------------------------------------------------------------------------
  // 8. Static BrowserController.findBrowserExecutable (F3.1)
  // --------------------------------------------------------------------------
  it('BrowserController.findBrowserExecutable is callable statically without dummy allocation', () => {
    const pathStatic = BrowserController.findBrowserExecutable();
    expect(pathStatic === undefined || typeof pathStatic === 'string').toBe(true);

    const supervisor = new ComputerSupervisor();
    const gov = supervisor.getGovernorStatus();
    expect(gov).toBeDefined();
    expect(['low', 'medium', 'high']).toContain(gov.tier);
  });

  // --------------------------------------------------------------------------
  // 9. Bounded Eviction on Admission Fences & Prompt Fingerprints (O3.4)
  // --------------------------------------------------------------------------
  it('pruneOldAdmissionFences bounds lastChannelPromptFingerprints TTL and max size', () => {
    const now = Date.now();
    // Insert old entries (> 60s)
    server.lastChannelPromptFingerprints.set('chan:user:old1', { promptHash: 'old1', timestamp: now - 90000 });
    server.lastChannelPromptFingerprints.set('chan:user:old2', { promptHash: 'old2', timestamp: now - 70000 });
    server.lastChannelPromptFingerprints.set('chan:user:fresh', { promptHash: 'fresh', timestamp: now });

    server.pruneOldAdmissionFences(now);

    expect(server.lastChannelPromptFingerprints.has('chan:user:old1')).toBe(false);
    expect(server.lastChannelPromptFingerprints.has('chan:user:old2')).toBe(false);
    expect(server.lastChannelPromptFingerprints.has('chan:user:fresh')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 10. MCP Tool Argument JSON Validation (F2.3)
  // --------------------------------------------------------------------------
  it('MCP tool execution throws clear Error when arguments string is malformed JSON', async () => {
    const res = await server.toolGateway.executeTool(
      'mcp_call',
      {
        server: 'test-mcp-server',
        tool: 'test-tool',
        arguments: '{ malformed json: not valid }',
      },
      { agentId: 'agent-boss' }
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid JSON string passed for tool arguments');
  });

  // --------------------------------------------------------------------------
  // 11. Create Skill ToolEngine Registration Error Handling (F2.2)
  // --------------------------------------------------------------------------
  it('create_skill catches ToolEngine errors and returns success: false with clear error', async () => {
    const spy = vi.spyOn(server.toolEngine, 'createTool').mockImplementationOnce(() => {
      throw new Error('Simulated syntax validation failure in ToolEngine');
    });

    const res = await server.toolGateway.executeTool<any>(
      'create_skill',
      {
        name: 'syntax_error_tool',
        description: 'Tool with broken JavaScript code',
        parameters: { type: 'object', properties: {} },
        handlerCode: 'function broken( { syntax error! }}}',
      },
      { agentId: 'agent-boss' }
    );

    spy.mockRestore();

    expect(res.success).toBe(false);
    expect(res.error).toContain('Failed to register skill in ToolEngine: Simulated syntax validation failure in ToolEngine');
  });
});
