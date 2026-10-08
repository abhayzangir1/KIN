import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ModelGateway } from '../src/execution/model_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('KIN Dynamic Model Discovery & User Custom Model Registration', () => {
  let tempDir: string;
  let tempDbPath: string;
  let modelGateway: ModelGateway;
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-models-server-test-'));
    tempDbPath = path.join(tempDir, 'kin_models_test.sqlite');

    server = new CoreServer({ port: 0, dbPath: tempDbPath });
    port = await server.start();
    modelGateway = new ModelGateway();
  });

  afterAll(async () => {
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('fetchProviderModels returns structured models for all supported providers', async () => {
    const openaiModels = await modelGateway.fetchProviderModels('openai');
    expect(openaiModels.length).toBeGreaterThan(0);
    expect(openaiModels.some((m) => m.id.includes('gpt-4'))).toBe(true);

    const anthropicModels = await modelGateway.fetchProviderModels('anthropic');
    expect(anthropicModels.length).toBeGreaterThan(0);
    expect(anthropicModels.some((m) => m.id.includes('claude-3-7'))).toBe(true);

    const geminiModels = await modelGateway.fetchProviderModels('gemini');
    expect(geminiModels.length).toBeGreaterThan(0);
    expect(geminiModels.some((m) => m.id.includes('gemini-2.5'))).toBe(true);

    const deepseekModels = await modelGateway.fetchProviderModels('deepseek');
    expect(deepseekModels.length).toBeGreaterThan(0);
    expect(deepseekModels.some((m) => m.id.includes('deepseek-chat'))).toBe(true);

    const openrouterModels = await modelGateway.fetchProviderModels('openrouter');
    expect(openrouterModels.length).toBeGreaterThan(0);
    expect(openrouterModels.some((m) => m.isFree)).toBe(true);
  });

  it('GET /api/models returns dynamic models list with providers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/models`);
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);
  });

  it('POST /api/models/custom registers arbitrary user-defined model ID', async () => {
    const customModelId = 'openai/gpt-4.5-preview';
    const res = await fetch(`http://127.0.0.1:${port}/api/models/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: customModelId,
        name: 'OpenAI GPT-4.5 Preview',
        contextWindow: 128000,
      }),
    });
    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.model.id).toBe(customModelId);
    expect(data.model.provider).toBe('openai');

    // Verify it is now present in GET /api/models
    const listRes = await fetch(`http://127.0.0.1:${port}/api/models`);
    const listData: any = await listRes.json();
    const found = listData.models.find((m: any) => m.id === customModelId);
    expect(found).toBeDefined();
    expect(found.name).toBe('OpenAI GPT-4.5 Preview');
  });

  it('POST /api/models/discover discovers and persists models for a provider', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/models/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
      }),
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.count).toBeGreaterThan(0);

    // Verify discovered models are returned in GET /api/models
    const listRes = await fetch(`http://127.0.0.1:${port}/api/models`);
    const listData: any = await listRes.json();
    const claudeFound = listData.models.some((m: any) => m.id.includes('claude-3-7'));
    expect(claudeFound).toBe(true);
  });

  it('fetchProviderModels returns empty list when shouldOmit is true and credentials are unconfigured', async () => {
    const unconfiguredGw = new ModelGateway({
      ollamaHost: 'http://127.0.0.1:99999',
    });

    const openaiOmitted = await unconfiguredGw.fetchProviderModels('openai', undefined, { omitUnconfigured: true });
    expect(openaiOmitted).toEqual([]);

    const anthropicOmitted = await unconfiguredGw.fetchProviderModels('anthropic', undefined, { omitUnconfigured: true });
    expect(anthropicOmitted).toEqual([]);

    const openrouterOmitted = await unconfiguredGw.fetchProviderModels('openrouter', undefined, { omitUnconfigured: true });
    expect(openrouterOmitted).toEqual([]);

    const geminiOmitted = await unconfiguredGw.fetchProviderModels('gemini', undefined, { omitUnconfigured: true });
    expect(geminiOmitted).toEqual([]);

    const deepseekOmitted = await unconfiguredGw.fetchProviderModels('deepseek', undefined, { omitUnconfigured: true });
    expect(deepseekOmitted).toEqual([]);

    const groqOmitted = await unconfiguredGw.fetchProviderModels('groq', undefined, { omitUnconfigured: true });
    expect(groqOmitted).toEqual([]);
  });

  it('evaluates custom provider readiness and includes custom in GET /api/models/readiness', async () => {
    const gw = new ModelGateway();

    // Initially 0 custom endpoints
    const readinessEmpty = await gw.checkProviderReadiness('custom');
    expect(readinessEmpty.provider).toBe('custom');
    expect(readinessEmpty.configured).toBe(false);
    expect(readinessEmpty.validated).toBe(false);

    // Register custom provider
    gw.registerCustomProvider('my-endpoint', 'http://127.0.0.1:8000/v1', 'custom-key');
    const readinessActive = await gw.checkProviderReadiness('custom');
    expect(readinessActive.configured).toBe(true);
    expect(readinessActive.validated).toBe(true);
    expect(readinessActive.modelCount).toBe(1);

    // Named custom provider readiness checks
    const namedReadiness = await gw.checkProviderReadiness('my-endpoint');
    expect(namedReadiness.configured).toBe(true);
    expect(namedReadiness.validated).toBe(true);
    expect(namedReadiness.modelCount).toBe(1);

    const namedSyncReadiness = gw.getProviderReadiness('my-endpoint');
    expect(namedSyncReadiness.configured).toBe(true);
    expect(namedSyncReadiness.validated).toBe(true);

    const models = await gw.fetchProviderModels('custom');
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('custom/my-endpoint');
    expect(models[0].validated).toBe(true);

    const namedModels = await gw.fetchProviderModels('my-endpoint');
    expect(namedModels).toHaveLength(1);
    expect(namedModels[0].id).toBe('custom/my-endpoint');

    // Verify GET /api/models/readiness contains custom
    const res = await fetch(`http://127.0.0.1:${port}/api/models/readiness`);
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.providerReadiness?.custom).toBeDefined();
    expect(data.providerReadiness?.custom.provider).toBe('custom');
  });

  it('POST /api/models/custom with baseUrl registers endpoint on modelGateway and marks it validated', async () => {
    const customId = 'custom/local-llama3';
    const res = await fetch(`http://127.0.0.1:${port}/api/models/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: customId,
        name: 'Local Llama 3 (Custom)',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
    });
    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.model.id).toBe(customId);
    expect(data.model.validated).toBe(true);
    expect(data.model.configured).toBe(true);

    // Verify GET /api/models returns the registered custom model with validated true
    const listRes = await fetch(`http://127.0.0.1:${port}/api/models`);
    const listData: any = await listRes.json();
    const found = listData.models.find((m: any) => m.id === customId);
    expect(found).toBeDefined();
    expect(found.validated).toBe(true);
  });
});
