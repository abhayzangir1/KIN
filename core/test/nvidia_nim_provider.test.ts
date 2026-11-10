import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModelGateway } from '../src/execution/model_gateway.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';

describe('NVIDIA NIM Provider Support', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('parses nvidia/ NIM model IDs directly while preserving :free OpenRouter slugs', () => {
    const gw = new ModelGateway({
      openrouterApiKey: 'sk-or-test',
      nvidiaApiKey: 'nvapi-test',
    });

    expect(gw.parseModelId('nvidia/meta/llama-3.3-70b-instruct')).toEqual([
      'nvidia',
      'meta/llama-3.3-70b-instruct',
    ]);
    expect(gw.parseModelId('nvidia/nvidia/llama-3.1-nemotron-70b-instruct')).toEqual([
      'nvidia',
      'nvidia/llama-3.1-nemotron-70b-instruct',
    ]);
    expect(gw.parseModelId('nvidia:deepseek-ai/deepseek-r1')).toEqual([
      'nvidia',
      'deepseek-ai/deepseek-r1',
    ]);
    expect(gw.parseModelId('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free')).toEqual([
      'openrouter',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    ]);
  });

  it('verifies NVIDIA NIM API connection, filters non-chat models, and discovers catalog', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      capturedUrl = String(input);
      capturedAuth = init?.headers?.Authorization || '';
      return new Response(
        JSON.stringify({
          data: [
            { id: 'meta/llama-3.3-70b-instruct', context_window: 131072 },
            { id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
            { id: 'nvidia/nv-embedqa-e5-v5' },
            { id: 'nvidia/nv-rerankqa-mistral-4b-v3' },
            { id: 'nvidia/llama-3.2-neva-vision-12b' },
            { id: 'deepseek-ai/deepseek-r1' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const gw = new ModelGateway();
    const res = await gw.verifyProviderConnection('nvidia', 'nvapi-live-key-123');

    expect(capturedUrl).toBe('https://integrate.api.nvidia.com/v1/models');
    expect(capturedAuth).toBe('Bearer nvapi-live-key-123');
    expect(res.working).toBe(true);
    expect(res.valid).toBe(true);
    expect(res.modelCount).toBe(4);
    expect(res.models.map((m) => m.id)).toEqual([
      'nvidia/meta/llama-3.3-70b-instruct',
      'nvidia/nvidia/llama-3.1-nemotron-70b-instruct',
      'nvidia/nvidia/llama-3.2-neva-vision-12b',
      'nvidia/deepseek-ai/deepseek-r1',
    ]);
    const visionModel = res.models.find((m) => m.id.includes('neva-vision'));
    expect(visionModel?.supportsVision).toBe(true);
    const r1Model = res.models.find((m) => m.id.includes('deepseek-r1'));
    expect(r1Model?.supportsReasoning).toBe(true);
  });

  it('invokes NVIDIA NIM chat completions endpoint with correct payload and auth', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;
    let capturedAuth = '';

    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      capturedUrl = String(input);
      capturedAuth = init?.headers?.Authorization || '';
      capturedBody = JSON.parse(init?.body || '{}');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from NVIDIA NIM!' } }],
          usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const gw = new ModelGateway({ nvidiaApiKey: 'nvapi-secret-abc' });
    const result = await gw.invoke({
      modelId: 'nvidia/meta/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(capturedUrl).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(capturedAuth).toBe('Bearer nvapi-secret-abc');
    expect(capturedBody.model).toBe('meta/llama-3.3-70b-instruct');
    expect(result.isError).toBeFalsy();
    expect(result.provider).toBe('nvidia');
    expect(result.content).toBe('Hello from NVIDIA NIM!');
    expect(result.tokensUsed.totalTokens).toBe(17);
  });

  it('permits nvidia provider_type in fresh and migrated SQLite databases', () => {
    const db = new KinDatabase(':memory:');
    // Simulate legacy providers table without nvidia in CHECK constraint
    db.exec(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'xai', 'azure', 'openrouter', 'custom')),
        base_url TEXT,
        api_key_ref TEXT,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
    `);

    const runner = new MigrationRunner(db);
    runner.runMigrations();

    expect(() => {
      db.execute(
        `INSERT INTO providers (id, name, provider_type, base_url, is_active, created_at)
         VALUES ('nvidia', 'NVIDIA NIM', 'nvidia', 'https://integrate.api.nvidia.com/v1', 1, ?)`,
        Date.now()
      );
    }).not.toThrow();

    const row = db.queryOne<any>("SELECT * FROM providers WHERE id = 'nvidia'");
    expect(row?.provider_type).toBe('nvidia');
    db.close();
  });
});
