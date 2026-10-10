import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelGateway, ModelInvocationParams } from '../src/execution/model_gateway.js';

describe('Model Gateway: Parsing, Provider Routing, and Failover Recovery', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Model ID Parsing (parseModelId)', () => {
    it('correctly parses slash-separated model IDs across all supported providers', () => {
      expect(ModelGateway.parseModelId('ollama/llama3')).toEqual(['ollama', 'llama3']);
      expect(ModelGateway.parseModelId('openai/gpt-4o')).toEqual(['openai', 'gpt-4o']);
      expect(ModelGateway.parseModelId('anthropic/claude-3-5-sonnet-20241022')).toEqual([
        'anthropic',
        'claude-3-5-sonnet-20241022',
      ]);
      expect(ModelGateway.parseModelId('groq/llama-3.3-70b-versatile')).toEqual([
        'groq',
        'llama-3.3-70b-versatile',
      ]);
      expect(ModelGateway.parseModelId('deepseek/deepseek-chat')).toEqual([
        'deepseek',
        'deepseek-chat',
      ]);
      expect(ModelGateway.parseModelId('gemini/gemini-2.0-flash')).toEqual([
        'gemini',
        'gemini-2.0-flash',
      ]);
      expect(ModelGateway.parseModelId('openrouter/meta-llama/llama-3.3-70b-instruct')).toEqual([
        'openrouter',
        'meta-llama/llama-3.3-70b-instruct',
      ]);
      expect(ModelGateway.parseModelId('custom/my-fine-tuned-model')).toEqual([
        'custom',
        'my-fine-tuned-model',
      ]);
    });

    it('correctly parses colon-separated model IDs for supported providers', () => {
      expect(ModelGateway.parseModelId('ollama:llama3.1:8b')).toEqual(['ollama', 'llama3.1:8b']);
      expect(ModelGateway.parseModelId('groq:llama-3.3-70b-versatile')).toEqual([
        'groq',
        'llama-3.3-70b-versatile',
      ]);
      expect(ModelGateway.parseModelId('deepseek:deepseek-reasoner')).toEqual([
        'deepseek',
        'deepseek-reasoner',
      ]);
      expect(ModelGateway.parseModelId('openai:o3-mini')).toEqual(['openai', 'o3-mini']);
      expect(ModelGateway.parseModelId('anthropic:claude-3-haiku-20240307')).toEqual([
        'anthropic',
        'claude-3-haiku-20240307',
      ]);
      expect(ModelGateway.parseModelId('openrouter:mistralai/mistral-small')).toEqual([
        'openrouter',
        'mistralai/mistral-small',
      ]);
    });

    it('defaults bare / un-prefixed model names to ollama provider', () => {
      expect(ModelGateway.parseModelId('llama3')).toEqual(['ollama', 'llama3']);
      expect(ModelGateway.parseModelId('qwen2.5-coder:7b')).toEqual(['ollama', 'qwen2.5-coder:7b']);
      expect(ModelGateway.parseModelId('deepseek-r1:8b')).toEqual(['ollama', 'deepseek-r1:8b']);
    });
  });

  describe('Groq Provider Routing & Key Resolution', () => {
    it('resolves Groq API key from constructor options', () => {
      const gateway = new ModelGateway({ groqApiKey: 'gsk_test_options_key' });
      expect(gateway.resolveApiKey('groq')).toBe('gsk_test_options_key');
    });

    it('resolves Groq API key from GROQ_API_KEY environment variable', () => {
      process.env.GROQ_API_KEY = 'gsk_test_env_key';
      const gateway = new ModelGateway();
      expect(gateway.resolveApiKey('groq')).toBe('gsk_test_env_key');
    });

    it('routes groq provider to OpenAI-compatible endpoint with bearer auth', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Groq response tokens' } }],
          usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const gateway = new ModelGateway({ groqApiKey: 'gsk_valid_key' });
      const result = await gateway.invokeModel({
        modelId: 'groq/llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Say hello' }],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBe('Groq response tokens');
      expect(result.provider).toBe('groq');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('https://api.groq.com/openai/v1/chat/completions');
      expect(calledOptions.headers['Authorization']).toBe('Bearer gsk_valid_key');
    });
  });

  describe('AbortSignal Plumbing & Steering Cancellation', () => {
    it('aborts fetch immediately when signal is triggered', async () => {
      const controller = new AbortController();

      const mockFetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const gateway = new ModelGateway({ openaiApiKey: 'sk-test' });

      const invocationPromise = gateway.invokeModel({
        modelId: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'Long generation' }],
        signal: controller.signal,
      });

      // Trigger mid-flight steer cancellation
      controller.abort();

      await expect(invocationPromise).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('Model Failover with switchedModelId', () => {
    it('falls back to secondary model and sets switchedModelId upon primary error', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (callCount === 1) {
          // Primary cloud call fails
          return Promise.resolve({
            ok: false,
            status: 429,
            text: async () => 'Rate limit exceeded',
          });
        }
        // Fallback Ollama call succeeds
        return Promise.resolve({
          ok: true,
          body: {
            getReader: () => {
              const encoder = new TextEncoder();
              let readDone = false;
              return {
                read: async () => {
                  if (readDone) return { done: true, value: undefined };
                  readDone = true;
                  return {
                    done: false,
                    value: encoder.encode(
                      JSON.stringify({ message: { content: 'Fallback answer from Ollama' } }) + '\n'
                    ),
                  };
                },
              };
            },
          },
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const gateway = new ModelGateway({ openaiApiKey: 'sk-test' });
      const result = await gateway.invokeModel({
        modelId: 'openai/gpt-4o',
        fallbackModelId: 'ollama/llama3',
        messages: [{ role: 'user', content: 'Solve this task' }],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBe('Fallback answer from Ollama');
      expect(result.switchedModelId).toBe('ollama/llama3');
    });
  });
});
