import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModelGateway, QuotaGuard } from '../src/execution/model_gateway.js';
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

  it('provides standard Llama 3.1 fallback catalog entries when offline or unverified', async () => {
    const gw = new ModelGateway();
    const models = await gw.discoverProviderModels('nvidia');

    const llama70b = models.find((m) => m.id === 'nvidia/meta/llama-3.1-70b-instruct');
    expect(llama70b).toBeDefined();
    expect(llama70b).toMatchObject({
      id: 'nvidia/meta/llama-3.1-70b-instruct',
      name: 'NVIDIA Llama 3.1 70B Instruct',
      provider: 'nvidia',
      contextWindow: 128000,
      supportsTools: true,
      configured: false,
      validated: false,
      description: 'Fallback model catalog (connection unverified)',
    });

    const llama8b = models.find((m) => m.id === 'nvidia/meta/llama-3.1-8b-instruct');
    expect(llama8b).toBeDefined();
    expect(llama8b).toMatchObject({
      id: 'nvidia/meta/llama-3.1-8b-instruct',
      name: 'NVIDIA Llama 3.1 8B Instruct',
      provider: 'nvidia',
      contextWindow: 128000,
      supportsTools: true,
      configured: false,
      validated: false,
      description: 'Fallback model catalog (connection unverified)',
    });
  });

  it('streams SSE chunks with delta.content and delta.reasoning_content (thinking tokens)', async () => {
    let capturedBody: any = null;
    const encoder = new TextEncoder();
    const sseChunks = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"Step 1: Ponder the question."}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":" Step 2: Formulate concise response."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Here is "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"the verified answer."}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      capturedBody = JSON.parse(init?.body || '{}');
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as any;

    const thinkingTokens: string[] = [];
    const contentTokens: string[] = [];
    const gw = new ModelGateway({ nvidiaApiKey: 'nvapi-stream-test' });

    const result = await gw.invoke({
      modelId: 'nvidia/deepseek-ai/deepseek-r1',
      messages: [{ role: 'user', content: 'Explain reasoning and answer' }],
      onThinkingToken: (token) => thinkingTokens.push(token),
      onToken: (token) => contentTokens.push(token),
    });

    expect(capturedBody.stream).toBe(true);
    expect(capturedBody.model).toBe('deepseek-ai/deepseek-r1');
    expect(thinkingTokens).toEqual(['Step 1: Ponder the question.', ' Step 2: Formulate concise response.']);
    expect(contentTokens).toEqual(['Here is ', 'the verified answer.']);
    expect(result.thinking).toBe('Step 1: Ponder the question. Step 2: Formulate concise response.');
    expect(result.content).toBe('Here is the verified answer.');
    expect(result.provider).toBe('nvidia');
  });

  it('parses token usage from final chunk in streaming responses', async () => {
    const encoder = new TextEncoder();
    const sseChunks = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Streaming content chunk."}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":28,"completion_tokens":14,"total_tokens":42}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as any;

    let reportedUsage: any = null;
    const gw = new ModelGateway({
      nvidiaApiKey: 'nvapi-usage-test',
      onUsage: (provider, tokens) => {
        if (provider === 'nvidia') {
          reportedUsage = tokens;
        }
      },
    });

    const result = await gw.invoke({
      modelId: 'nvidia/meta/llama-3.1-70b-instruct',
      messages: [{ role: 'user', content: 'Test token accounting' }],
      onToken: () => {},
    });

    expect(result.tokensUsed).toEqual({
      promptTokens: 28,
      completionTokens: 14,
      totalTokens: 42,
    });
    expect(reportedUsage).toEqual({
      promptTokens: 28,
      completionTokens: 14,
      totalTokens: 42,
    });
  });

  it('seamlessly rotates to secondary key on NVIDIA NIM HTTP 429 rate limit', async () => {
    const keysUsed: string[] = [];

    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const auth = init?.headers?.Authorization || '';
      keysUsed.push(auth);
      if (auth.includes('primary-429')) {
        return new Response(JSON.stringify({ error: { message: 'NVIDIA NIM TPM quota limit exceeded on primary key' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Success via NVIDIA secondary backup key' } }],
          usage: { prompt_tokens: 16, completion_tokens: 8, total_tokens: 24 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const gw = new ModelGateway();
    gw.setApiKeyResolver((p) => (p === 'nvidia' ? 'nvapi-primary-429' : undefined));
    gw.setAllKeysResolver((p) => {
      if (p === 'nvidia') {
        return [
          { id: 'nv-key-1', key: 'nvapi-primary-429', keyAlias: 'Primary NIM Key' },
          { id: 'nv-key-2', key: 'nvapi-secondary-success', keyAlias: 'Secondary NIM Key' },
        ];
      }
      return [];
    });

    const result = await gw.invoke({
      modelId: 'nvidia/meta/llama-3.1-70b-instruct',
      messages: [{ role: 'user', content: 'Test 429 rotation' }],
    });

    expect(result.content).toBe('Success via NVIDIA secondary backup key');
    expect(result.provider).toBe('nvidia');
    expect(keysUsed).toEqual(['Bearer nvapi-primary-429', 'Bearer nvapi-secondary-success']);
  });

  it('applies exponential backoff with jitter on NVIDIA NIM HTTP 429 when retryCount < 2', async () => {
    let callCount = 0;
    const backoffSpy = vi.spyOn(QuotaGuard, 'computeExponentialJitterBackoff').mockReturnValue(5);

    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: 'NVIDIA NIM 429 rate limit' }), {
          status: 429,
          headers: { 'Retry-After': '2', 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Recovered after backoff wait' } }],
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const gw = new ModelGateway({ nvidiaApiKey: 'nvapi-retry-test' });
    const result = await gw.invoke({
      modelId: 'nvidia/meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: 'Test backoff retry' }],
    });

    expect(callCount).toBe(2);
    expect(backoffSpy).toHaveBeenCalledWith(0, 2, 1500, 60000);
    expect(result.content).toBe('Recovered after backoff wait');
    expect(result.provider).toBe('nvidia');
  });
});
