import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ModelGateway } from '../src/execution/model_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import { AgentLoopRunner } from '../src/kernel/agent_loop.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Model Selector API & No Silent Fallback Policy', { timeout: 30000 }, () => {
  let tempDir: string;
  let tempDbPath: string;
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-model-selector-test-'));
    tempDbPath = path.join(tempDir, 'kin_test.sqlite');

    server = new CoreServer({ port: 0, dbPath: tempDbPath });
    port = await server.start();
  });

  afterAll(async () => {
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('PATCH /api/agents/:id sets activeModelId directly for any agent', async () => {
    // 1. Get initial agents
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state`);
    const stateData: any = await stateRes.json();
    const boss = stateData.agents.find((a: any) => a.id === 'agent-boss') || stateData.agents[0];
    expect(boss).toBeDefined();

    // 2. PATCH agent model directly via /api/agents/:id
    const targetModel = 'openrouter/anthropic/claude-3.7-sonnet';
    const patchRes = await fetch(`http://127.0.0.1:${port}/api/agents/${boss.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeModelId: targetModel }),
    });

    expect(patchRes.status).toBe(200);
    const patchData: any = await patchRes.json();
    expect(patchData.success).toBe(true);
    expect(patchData.activeModelId).toBe(targetModel);

    // 3. Verify updated model persisted
    const updatedStateRes = await fetch(`http://127.0.0.1:${port}/api/state`);
    const updatedData: any = await updatedStateRes.json();
    const updatedBoss = updatedData.agents.find((a: any) => a.id === boss.id);
    expect(updatedBoss.activeModelId).toBe(targetModel);
  });

  it('GET /api/models includes supportsReasoning on reasoning models and lists xai', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/models`);
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(Array.isArray(data.models)).toBe(true);

    const r1 = data.models.find((m: any) => m.id.includes('deepseek-r1') || m.id.includes('r1'));
    if (r1) {
      expect(r1.supportsReasoning).toBe(true);
    }

    // Verify readiness contains xai
    const readinessRes = await fetch(`http://127.0.0.1:${port}/api/models/readiness`);
    const readinessData: any = await readinessRes.json();
    expect(readinessData.providerReadiness?.xai).toBeDefined();
    expect(readinessData.providerReadiness?.xai.provider).toBe('xai');
  });

  it('ModelGateway does NOT fallback when disableFallback: true even if fallbackModelId is passed', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized: Invalid API key',
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const gateway = new ModelGateway({ openaiApiKey: 'sk-invalid' });
    const result = await gateway.invoke({
      modelId: 'openai/gpt-4o',
      fallbackModelId: 'ollama/llama3',
      disableFallback: true,
      messages: [{ role: 'user', content: 'Say hello' }],
    });

    // Should return the 401 error, NOT switch to fallback model
    expect(result.isError).toBe(true);
    expect(result.switchedModelId).toBeUndefined();
    expect(callCount).toBe(1); // Did not make second call to fallback
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('AgentLoopRunner halts with isModelUnavailable and does not proceed when model errors', async () => {
    const mockGateway: any = {
      invoke: vi.fn().mockResolvedValue({
        content: '[KIN Model Gateway Error] Failed to reach provider "openai" for model "gpt-4o": 401 Unauthorized',
        modelId: 'openai/gpt-4o',
        provider: 'openai',
        tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        durationMs: 50,
        isError: true,
      }),
    };
    const mockToolGateway: any = { getToolSchemas: () => [] };
    const mockScheduler: any = {};
    const mockSkillEngine: any = { matchSkills: () => [] };
    const mockRecoveryEngine: any = {};
    const mockFinancialSafety: any = {};

    const runner = new AgentLoopRunner(
      mockGateway,
      mockToolGateway,
      mockScheduler,
      mockSkillEngine,
      mockRecoveryEngine,
      mockFinancialSafety
    );

    let onModelUnavailableCalled = false;
    let reportedModel = '';
    const result = await runner.execute({
      runId: 'test-run-1',
      agentId: 'agent-1',
      modelId: 'openai/gpt-4o',
      projectId: 'proj-1',
      channelId: 'chan-1',
      userPrompt: 'Test task',
      systemPrompt: 'System',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO',
      onModelUnavailable: (modelId, error) => {
        onModelUnavailableCalled = true;
        reportedModel = modelId;
      },
    });

    expect(result.isError).toBe(true);
    expect(result.isModelUnavailable).toBe(true);
    expect(result.modelId).toBe('openai/gpt-4o');
    expect(result.finalContent).toContain('Execution halted');
    expect(result.finalContent).toContain('Automatic fallback is disabled');
    expect(onModelUnavailableCalled).toBe(true);
    expect(reportedModel).toBe('openai/gpt-4o');
  });

  it('AgentLoopRunner executes options.modelGateway if passed rather than stale instance', async () => {
    const defaultGateway: any = {
      invoke: vi.fn().mockRejectedValue(new Error('Stale gateway should not be called')),
    };
    const overriddenGateway: any = {
      invoke: vi.fn().mockResolvedValue({
        content: 'Success from overridden gateway',
        modelId: 'test-model',
        provider: 'test',
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        durationMs: 20,
      }),
    };
    const mockToolGateway: any = { getToolSchemas: () => [] };
    const runner = new AgentLoopRunner(
      defaultGateway,
      mockToolGateway,
      {} as any,
      { matchSkills: () => [] } as any,
      {} as any,
      {} as any
    );

    const result = await runner.execute({
      runId: 'test-run-gw-override',
      agentId: 'agent-1',
      modelId: 'test-model',
      projectId: 'proj-1',
      channelId: 'chan-1',
      userPrompt: 'Hello',
      systemPrompt: 'System',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO',
      modelGateway: overriddenGateway,
    });

    expect(result.finalContent).toBe('Success from overridden gateway');
    expect(overriddenGateway.invoke).toHaveBeenCalledTimes(1);
    expect(defaultGateway.invoke).not.toHaveBeenCalled();
  });

  it('ModelGateway resolves xai provider API key from options and env', () => {
    const gwWithOptions = new ModelGateway({ xaiApiKey: 'xai-test-key-123' });
    expect(gwWithOptions.resolveApiKey('xai')).toBe('xai-test-key-123');

    const origEnv = process.env.XAI_API_KEY;
    try {
      process.env.XAI_API_KEY = 'xai-env-key-456';
      const gwWithEnv = new ModelGateway();
      expect(gwWithEnv.resolveApiKey('xai')).toBe('xai-env-key-456');
    } finally {
      process.env.XAI_API_KEY = origEnv;
    }
  });

  it('ModelGateway allows custom local endpoint invocation without requiring API key', async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response from local custom model without key' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const gateway = new ModelGateway();
    gateway.registerCustomProvider('my-local', 'http://localhost:8000/v1');

    const res = await gateway.invoke({
      modelId: 'my-local/custom-llama',
      messages: [{ role: 'user', content: 'Test' }],
    });

    expect(res.isError).toBeFalsy();
    expect(res.content).toBe('Response from local custom model without key');
    expect(mockFetch).toHaveBeenCalled();
    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('http://localhost:8000/v1/chat/completions');
    // Headers should not have undefined Authorization
    expect(calledOpts.headers['Authorization']).toBeUndefined();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('POST /api/models/custom registers custom model and provider in SQLite', async () => {
    const customPayload = {
      modelId: 'local-vllm/mistral-nemo-12b',
      name: 'Mistral Nemo 12B',
      baseUrl: 'http://127.0.0.1:8000/v1',
      contextWindow: 128000,
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/models/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customPayload),
    });

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.model.id).toBe('local-vllm/mistral-nemo-12b');

    // Verify it appears in GET /api/models
    const listRes = await fetch(`http://127.0.0.1:${port}/api/models`);
    const listData: any = await listRes.json();
    const found = listData.models.find((m: any) => m.id === 'local-vllm/mistral-nemo-12b');
    expect(found).toBeDefined();
    expect(found.isCustom).toBe(true);
  });

  it('PATCH /api/agents/:id/model returns 409 Conflict when agent is actively executing', async () => {
    const bossId = 'agent-boss';
    (server as any).activeAgentExecutions.set(bossId, { agentId: bossId, channelId: 'chan-1', startedAt: Date.now() });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/agents/${bossId}/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModelId: 'openai/gpt-4o' }),
      });
      expect(res.status).toBe(409);
      const data: any = await res.json();
      expect(data.error).toContain('is actively working');
    } finally {
      (server as any).activeAgentExecutions.delete(bossId);
    }
  });

  it('PATCH /api/agents/:id/model persists channel-scoped model override and reflects in GET /api/channels/:id/members', async () => {
    const channelId = 'chan-general';
    const bossId = 'agent-boss';
    const channelModel = 'anthropic/claude-3-5-haiku-20241022';

    const res = await fetch(`http://127.0.0.1:${port}/api/agents/${bossId}/model`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeModelId: channelModel, channelId }),
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.channelId).toBe(channelId);

    // Verify GET /api/channels/:id/members returns channelModel
    const memRes = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/members`);
    expect(memRes.status).toBe(200);
    const memData: any = await memRes.json();
    const memberBoss = memData.members.find((m: any) => m.id === bossId);
    expect(memberBoss).toBeDefined();
    expect(memberBoss.activeModelId).toBe(channelModel);
  });

  it('POST /api/models/verify-key validates key and registers models in SQLite on success', async () => {
    const origFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (String(url).includes('127.0.0.1') || String(url).includes('localhost')) {
        return origFetch(url, init);
      }
      if (String(url).includes('api.openai.com/v1/models')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-4o', object: 'model' },
              { id: 'gpt-4o-mini', object: 'model' },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Unauthorized' } }),
        text: async () => 'Unauthorized',
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/models/verify-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-live-valid-test-key' }),
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.working).toBe(true);
      expect(data.models.length).toBeGreaterThanOrEqual(2);

      // Persist credential as user would after verification
      await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', keyAlias: 'OpenAI Test', apiKey: 'sk-live-valid-test-key' }),
      });

      // Verify models appear in GET /api/models
      const listRes = await fetch(`http://127.0.0.1:${port}/api/models?omitUnconfigured=true`);
      const listData: any = await listRes.json();
      const hasGpt4o = listData.models.some((m: any) => m.id === 'openai/gpt-4o');
      expect(hasGpt4o).toBe(true);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('POST /api/models/verify-key fails cleanly and prunes stale models on invalid key', async () => {
    const origFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (String(url).includes('127.0.0.1') || String(url).includes('localhost')) {
        return origFetch(url, init);
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API Key' } }),
        text: async () => 'Invalid API Key',
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/models/verify-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-invalid-key-999' }),
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.working).toBe(false);
      expect(data.message.toLowerCase()).toContain('invalid');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
