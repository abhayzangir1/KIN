// ============================================================================
// KIN MODEL GATEWAY
// Provider-neutral LLM invocation with streaming, error normalization,
// and zero autonomous model routing (strictly adheres to user-assigned model).
// ============================================================================

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

export class ModelGateway {
  private ollamaHost: string;
  private openaiApiKey?: string;
  private anthropicApiKey?: string;
  private deepseekApiKey?: string;
  private geminiApiKey?: string;

  constructor() {
    this.ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    this.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    this.geminiApiKey = process.env.GEMINI_API_KEY;
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
      } else if (provider === 'openai') {
        return await this.invokeOpenAiCompatible(
          'https://api.openai.com/v1/chat/completions',
          this.openaiApiKey,
          modelName,
          params,
          startTime,
          'openai'
        );
      } else if (provider === 'deepseek') {
        return await this.invokeOpenAiCompatible(
          'https://api.deepseek.com/v1/chat/completions',
          this.deepseekApiKey,
          modelName,
          params,
          startTime,
          'deepseek'
        );
      } else if (provider === 'anthropic') {
        return await this.invokeAnthropic(modelName, params, startTime);
      } else {
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
        stream: false,
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

    const data: any = await res.json();
    const content = data?.message?.content || '';
    if (params.onToken && content) {
      params.onToken(content);
    }

    return {
      content,
      modelId: params.modelId,
      provider: 'ollama',
      tokensUsed: {
        promptTokens: data?.prompt_eval_count || 0,
        completionTokens: data?.eval_count || 0,
        totalTokens: (data?.prompt_eval_count || 0) + (data?.eval_count || 0),
      },
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
      throw new Error(`API key for ${provider.toUpperCase()} is not set in environment.`);
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

    return {
      content,
      modelId: params.modelId,
      provider,
      tokensUsed: {
        promptTokens: data?.usage?.prompt_tokens || 0,
        completionTokens: data?.usage?.completion_tokens || 0,
        totalTokens: data?.usage?.total_tokens || 0,
      },
      durationMs: Date.now() - startTime,
    };
  }

  private async invokeAnthropic(
    modelName: string,
    params: ModelInvocationParams,
    startTime: number
  ): Promise<ModelInvocationResult> {
    if (!this.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set in environment.');
    }

    const systemMsg = params.messages.find((m) => m.role === 'system')?.content || '';
    const userAndAssistantMsgs = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicApiKey,
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

    return {
      content,
      modelId: params.modelId,
      provider: 'anthropic',
      tokensUsed: {
        promptTokens: data?.usage?.input_tokens || 0,
        completionTokens: data?.usage?.output_tokens || 0,
        totalTokens: (data?.usage?.input_tokens || 0) + (data?.usage?.output_tokens || 0),
      },
      durationMs: Date.now() - startTime,
    };
  }
}
