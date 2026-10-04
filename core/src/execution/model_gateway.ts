// ============================================================================
// KIN MODEL GATEWAY
// Provider-neutral LLM invocation with streaming, error normalization,
// and zero autonomous model routing (strictly adheres to user-assigned model).
// ============================================================================

import { SecretVault } from '../security/secret_vault.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelInvocationParams {
  modelId: string;
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  onToken?: (token: string) => void;
}

export interface ModelInvocationResult {
  content: string;
  thinking?: string;
  modelId: string;
  provider: string;
  tokensUsed: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  durationMs: number;
  isError?: boolean;
}

export interface ModelGatewayOptions {
  apiKeyResolver?: (provider: string) => string | undefined;
  onUsage?: (provider: string, tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  openrouterApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  deepseekApiKey?: string;
  geminiApiKey?: string;
  ollamaHost?: string;
}

export class ModelGateway {
  private ollamaHost: string;
  private openrouterApiKey?: string;
  private openaiApiKey?: string;
  private anthropicApiKey?: string;
  private deepseekApiKey?: string;
  private geminiApiKey?: string;
  private apiKeyResolver?: (provider: string) => string | undefined;
  private onUsage?: (provider: string, tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;

  constructor(options?: ModelGatewayOptions) {
    this.ollamaHost = options?.ollamaHost || process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.openrouterApiKey = options?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    this.openaiApiKey = options?.openaiApiKey || process.env.OPENAI_API_KEY;
    this.anthropicApiKey = options?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    this.deepseekApiKey = options?.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
    this.geminiApiKey = options?.geminiApiKey || process.env.GEMINI_API_KEY;
    this.apiKeyResolver = options?.apiKeyResolver;
    this.onUsage = options?.onUsage;
  }

  public setApiKeyResolver(resolver: (provider: string) => string | undefined) {
    this.apiKeyResolver = resolver;
  }

  public setOnUsage(handler: (provider: string, tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }) => void) {
    this.onUsage = handler;
  }

  public resolveApiKey(provider: string): string | undefined {
    let rawKey: string | undefined;
    if (this.apiKeyResolver) {
      const resolved = this.apiKeyResolver(provider);
      if (resolved) rawKey = resolved;
    }
    if (!rawKey) {
      if (provider === 'openrouter') rawKey = this.openrouterApiKey || process.env.OPENROUTER_API_KEY;
      else if (provider === 'openai') rawKey = this.openaiApiKey || process.env.OPENAI_API_KEY;
      else if (provider === 'anthropic') rawKey = this.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
      else if (provider === 'deepseek') rawKey = this.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
      else if (provider === 'gemini') rawKey = this.geminiApiKey || process.env.GEMINI_API_KEY;
    }
    if (rawKey) {
      return SecretVault.getInstance().decrypt(rawKey);
    }
    return undefined;
  }

  /**
   * Invokes the assigned model directly without autonomous routing.
   */
  public async invoke(params: ModelInvocationParams): Promise<ModelInvocationResult> {
    const startTime = Date.now();
    const [provider, modelName] = this.parseModelId(params.modelId);

    try {
      if (provider === 'ollama') {
        return await this.invokeOllama(modelName, params, startTime);
      } else if (provider === 'openrouter') {
        return await this.invokeOpenRouter(modelName, params, startTime);
      } else if (provider === 'openai') {
        const apiKey = this.resolveApiKey('openai');
        return await this.invokeOpenAiCompatible(
          'https://api.openai.com/v1/chat/completions',
          apiKey,
          modelName,
          params,
          startTime,
          'openai'
        );
      } else if (provider === 'deepseek') {
        const apiKey = this.resolveApiKey('deepseek');
        return await this.invokeOpenAiCompatible(
          'https://api.deepseek.com/v1/chat/completions',
          apiKey,
          modelName,
          params,
          startTime,
          'deepseek'
        );
      } else if (provider === 'anthropic') {
        return await this.invokeAnthropic(modelName, params, startTime);
      } else {
        // Check if provider is an OpenRouter namespace or model slug (e.g. meta-llama/..., qwen/...)
        const openRouterKey = this.resolveApiKey('openrouter');
        if (openRouterKey && (modelName.includes('/') || params.modelId.includes(':free') || params.modelId.includes('/'))) {
          return await this.invokeOpenRouter(params.modelId, params, startTime);
        }

        // Fallback for unrecognized provider
        return {
          content: `[KIN Model Gateway Error] Unsupported model provider: "${provider}". Assigned model was: "${params.modelId}".`,
          modelId: params.modelId,
          provider,
          tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          durationMs: Date.now() - startTime,
          isError: true,
        };
      }
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = `[KIN Model Gateway Error] Failed to reach provider "${provider}" for model "${modelName}": ${err?.message || String(err)}`;
      
      return {
        content: errorMsg,
        modelId: params.modelId,
        provider,
        tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        durationMs,
        isError: true,
      };
    }
  }

  private parseModelId(modelId: string): [string, string] {
    const slashIdx = modelId.indexOf('/');
    if (slashIdx === -1) {
      return ['ollama', modelId];
    }
    return [modelId.substring(0, slashIdx).toLowerCase(), modelId.substring(slashIdx + 1)];
  }

  private async invokeOllama(
    modelName: string,
    params: ModelInvocationParams,
    startTime: number
  ): Promise<ModelInvocationResult> {
    const endpoint = `${this.ollamaHost}/api/chat`;
    const timeoutMs = process.env.KIN_OLLAMA_TIMEOUT_MS
      ? parseInt(process.env.KIN_OLLAMA_TIMEOUT_MS, 10)
      : 180000; // 3 minutes default to allow cold-loading large model weights into VRAM
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: modelName,
        messages: params.messages,
        stream: true,
        options: {
          temperature: params.temperature ?? 0.2,
          num_predict: params.maxTokens ?? 2048,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
    }

    let fullContent = '';
    let fullThinking = '';
    let promptTokens = 0;
    let completionTokens = 0;

    if (res.body && typeof (res.body as any).getReader === 'function') {
      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const token = parsed?.message?.content || '';
            const thinkToken = parsed?.message?.thinking || '';
            if (token) {
              fullContent += token;
              if (params.onToken) {
                params.onToken(token);
              }
            }
            if (thinkToken) {
              fullThinking += thinkToken;
            }
            if (parsed.done) {
              promptTokens = parsed.prompt_eval_count || promptTokens;
              completionTokens = parsed.eval_count || completionTokens;
            }
          } catch {}
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          const token = parsed?.message?.content || '';
          if (token) {
            fullContent += token;
            if (params.onToken) params.onToken(token);
          }
          if (parsed.done) {
            promptTokens = parsed.prompt_eval_count || promptTokens;
            completionTokens = parsed.eval_count || completionTokens;
          }
        } catch {}
      }
    } else if (res.body && (Symbol.asyncIterator in (res.body as any))) {
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      for await (const chunk of (res.body as any)) {
        buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const token = parsed?.message?.content || '';
            const thinkToken = parsed?.message?.thinking || '';
            if (token) {
              fullContent += token;
              if (params.onToken) params.onToken(token);
            }
            if (thinkToken) fullThinking += thinkToken;
            if (parsed.done) {
              promptTokens = parsed.prompt_eval_count || promptTokens;
              completionTokens = parsed.eval_count || completionTokens;
            }
          } catch {}
        }
      }
    } else {
      const text = await res.text();
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const token = parsed?.message?.content || '';
          if (token) fullContent += token;
          if (parsed.done) {
            promptTokens = parsed.prompt_eval_count || promptTokens;
            completionTokens = parsed.eval_count || completionTokens;
          }
        } catch {}
      }
      if (params.onToken && fullContent) {
        params.onToken(fullContent);
      }
    }

    let content = fullContent;
    if (!content.trim() && fullThinking.trim()) {
      content = fullThinking.trim();
    }

    const tokensUsed = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    if (this.onUsage) {
      this.onUsage('ollama', tokensUsed);
    }

    return {
      content,
      thinking: fullThinking.trim() || undefined,
      modelId: params.modelId,
      provider: 'ollama',
      tokensUsed,
      durationMs: Date.now() - startTime,
    };
  }

  private async invokeOpenRouter(
    modelName: string,
    params: ModelInvocationParams,
    startTime: number,
    retryCount: number = 0
  ): Promise<ModelInvocationResult> {
    const apiKey = this.resolveApiKey('openrouter');
    if (!apiKey) {
      throw new Error('API key for OPENROUTER is not set in managed credentials or environment.');
    }

    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/abhayzangir1/KIN',
        'X-Title': 'KIN Workforce Platform',
      },
      body: JSON.stringify({
        model: modelName,
        messages: params.messages,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens ?? 2048,
      }),
    });

    if (res.status === 429) {
      // Live 429 rate limit backoff retry
      if (retryCount < 2) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 1;
        const backoffMs = (isNaN(retryAfterSec) ? 1 : retryAfterSec) * 1000 * (retryCount + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return this.invokeOpenRouter(modelName, params, startTime, retryCount + 1);
      }
      throw new Error(`OpenRouter 429 Rate Limit exceeded after retries for model "${modelName}".`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`OpenRouter HTTP ${res.status}: ${errText}`);
    }

    const data: any = await res.json();
    const choiceMsg = data?.choices?.[0]?.message;
    const content = (choiceMsg?.content || choiceMsg?.reasoning || data?.choices?.[0]?.text || '').trim();
    if (params.onToken && content) {
      params.onToken(content);
    }

    const tokensUsed = {
      promptTokens: data?.usage?.prompt_tokens || 0,
      completionTokens: data?.usage?.completion_tokens || 0,
      totalTokens: data?.usage?.total_tokens || 0,
    };

    if (this.onUsage) {
      this.onUsage('openrouter', tokensUsed);
    }

    return {
      content,
      modelId: params.modelId,
      provider: 'openrouter',
      tokensUsed,
      durationMs: Date.now() - startTime,
    };
  }

  private async invokeOpenAiCompatible(
    url: string,
    apiKey: string | undefined,
    modelName: string,
    params: ModelInvocationParams,
    startTime: number,
    provider: string
  ): Promise<ModelInvocationResult> {
    if (!apiKey) {
      throw new Error(`API key for ${provider.toUpperCase()} is not set in environment or managed credentials.`);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: params.messages,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens ?? 2048,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`${provider.toUpperCase()} HTTP ${res.status}: ${errText}`);
    }

    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    if (params.onToken && content) {
      params.onToken(content);
    }

    const tokensUsed = {
      promptTokens: data?.usage?.prompt_tokens || 0,
      completionTokens: data?.usage?.completion_tokens || 0,
      totalTokens: data?.usage?.total_tokens || 0,
    };

    if (this.onUsage) {
      this.onUsage(provider, tokensUsed);
    }

    return {
      content,
      modelId: params.modelId,
      provider,
      tokensUsed,
      durationMs: Date.now() - startTime,
    };
  }

  private async invokeAnthropic(
    modelName: string,
    params: ModelInvocationParams,
    startTime: number
  ): Promise<ModelInvocationResult> {
    const apiKey = this.resolveApiKey('anthropic');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set in environment or managed credentials.');
    }

    const systemMsg = params.messages.find((m) => m.role === 'system')?.content || '';
    const userAndAssistantMsgs = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelName,
        system: systemMsg,
        messages: userAndAssistantMsgs,
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.2,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic HTTP ${res.status}: ${errText}`);
    }

    const data: any = await res.json();
    const content = data?.content?.[0]?.text || '';
    if (params.onToken && content) {
      params.onToken(content);
    }

    const tokensUsed = {
      promptTokens: data?.usage?.input_tokens || 0,
      completionTokens: data?.usage?.output_tokens || 0,
      totalTokens: (data?.usage?.input_tokens || 0) + (data?.usage?.output_tokens || 0),
    };

    if (this.onUsage) {
      this.onUsage('anthropic', tokensUsed);
    }

    return {
      content,
      modelId: params.modelId,
      provider: 'anthropic',
      tokensUsed,
      durationMs: Date.now() - startTime,
    };
  }
}
