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
  fallbackModelId?: string;
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

export interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  isFree?: boolean;
  description?: string;
  isCustom?: boolean;
  configured?: boolean;
  validated?: boolean;
}

export interface ProviderReadiness {
  provider: string;
  configured: boolean;
  validated: boolean;
  modelCount: number;
  message?: string;
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
  private customEndpoints: Map<string, { baseUrl: string; apiKey?: string }> = new Map();
  private validatedProviders: Map<string, boolean> = new Map();
  private providerModelCounts: Map<string, number> = new Map();
  private isOllamaOnlineCached?: boolean;
  private ollamaModelCountCached?: number;

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

  public registerCustomProvider(name: string, baseUrl: string, apiKey?: string): void {
    this.customEndpoints.set(name.toLowerCase(), { baseUrl, apiKey });
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

  public getProviderReadiness(provider: string): ProviderReadiness {
    const norm = provider.toLowerCase().trim();
    if (norm === 'ollama') {
      const isOnline = this.isOllamaOnlineCached ?? false;
      return {
        provider: norm,
        configured: Boolean(this.ollamaHost),
        validated: isOnline,
        modelCount: isOnline ? (this.ollamaModelCountCached ?? 0) : 0,
        message: isOnline
          ? `Local Ollama online (${this.ollamaModelCountCached ?? 0} models available)`
          : 'Local Ollama runtime offline or unverified',
      };
    }
    if (norm === 'custom' || this.customEndpoints.has(norm)) {
      if (this.customEndpoints.has(norm)) {
        const custom = this.customEndpoints.get(norm)!;
        return {
          provider: norm,
          configured: true,
          validated: true,
          modelCount: 1,
          message: `Custom endpoint "${norm}" registered at ${custom.baseUrl}`,
        };
      }
      const customCount = this.customEndpoints.size;
      return {
        provider: 'custom',
        configured: customCount > 0,
        validated: customCount > 0,
        modelCount: customCount,
        message: customCount > 0 ? `${customCount} custom endpoint(s) registered` : 'No custom endpoint configured',
      };
    }
    const apiKey = this.resolveApiKey(norm);
    const isConfigured = Boolean(apiKey);
    const isValidated = this.validatedProviders.get(norm) ?? false;
    const count = this.providerModelCounts.get(norm) ?? 0;
    return {
      provider: norm,
      configured: isConfigured,
      validated: isValidated,
      modelCount: isValidated ? count : 0,
      message: !isConfigured
        ? `API key missing for ${norm}`
        : (isValidated ? `Validated and reachable (${count} models)` : `API key configured; connection unverified (${norm})`),
    };
  }

  public async checkProviderReadiness(provider: string): Promise<ProviderReadiness> {
    const norm = provider.toLowerCase().trim();
    if (norm === 'ollama') {
      try {
        const res = await fetch(`${this.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
        if (res && res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const models: any[] = data.models || [];
          this.isOllamaOnlineCached = true;
          this.ollamaModelCountCached = models.length;
          return {
            provider: norm,
            configured: true,
            validated: true,
            modelCount: models.length,
            message: `Local Ollama online (${models.length} model(s) available)`,
          };
        }
      } catch {}
      this.isOllamaOnlineCached = false;
      this.ollamaModelCountCached = 0;
      return {
        provider: norm,
        configured: Boolean(this.ollamaHost),
        validated: false,
        modelCount: 0,
        message: 'Local Ollama runtime unreachable (offline)',
      };
    }

    if (norm === 'custom' || this.customEndpoints.has(norm)) {
      if (this.customEndpoints.has(norm)) {
        const custom = this.customEndpoints.get(norm)!;
        return {
          provider: norm,
          configured: true,
          validated: true,
          modelCount: 1,
          message: `Custom endpoint "${norm}" registered at ${custom.baseUrl}`,
        };
      }
      const customCount = this.customEndpoints.size;
      return {
        provider: 'custom',
        configured: customCount > 0,
        validated: customCount > 0,
        modelCount: customCount,
        message: customCount > 0 ? `${customCount} custom endpoint(s) registered` : 'No custom endpoint configured',
      };
    }

    const apiKey = this.resolveApiKey(norm);
    if (!apiKey) {
      this.validatedProviders.set(norm, false);
      this.providerModelCounts.set(norm, 0);
      return {
        provider: norm,
        configured: false,
        validated: false,
        modelCount: 0,
        message: `API key not configured for ${norm}`,
      };
    }

    try {
      const models = await this.fetchProviderModels(norm, apiKey, { omitUnconfigured: true });
      const reachable = models.length > 0 && models.some((m) => m.validated);
      this.validatedProviders.set(norm, reachable);
      this.providerModelCounts.set(norm, reachable ? models.length : 0);
      return {
        provider: norm,
        configured: true,
        validated: reachable,
        modelCount: reachable ? models.length : 0,
        message: reachable
          ? `Validated and reachable (${models.length} model(s) discovered)`
          : `API key configured, but reachable model verification returned empty catalog`,
      };
    } catch (e: any) {
      this.validatedProviders.set(norm, false);
      this.providerModelCounts.set(norm, 0);
      return {
        provider: norm,
        configured: true,
        validated: false,
        modelCount: 0,
        message: `Connection validation failed: ${e.message}`,
      };
    }
  }

  /**
   * Dynamically discovers and fetches available models directly from provider APIs.
   * Enables zero-hardcoding discovery so newly released models are immediately accessible.
   */
  public async fetchProviderModels(
    provider: string,
    explicitApiKey?: string,
    options?: { omitUnconfigured?: boolean } | boolean
  ): Promise<DiscoveredModel[]> {
    const normProvider = provider.toLowerCase().trim();
    const shouldOmit = typeof options === 'boolean' ? options : Boolean(options?.omitUnconfigured);
    const apiKey = explicitApiKey || this.resolveApiKey(normProvider);

    if (shouldOmit && normProvider !== 'ollama' && normProvider !== 'custom' && !this.customEndpoints.has(normProvider) && !apiKey) {
      return [];
    }

    try {
      if (normProvider === 'custom' || this.customEndpoints.has(normProvider)) {
        const result: DiscoveredModel[] = [];
        const endpoints = normProvider === 'custom'
          ? Array.from(this.customEndpoints.entries())
          : (this.customEndpoints.has(normProvider) ? [[normProvider, this.customEndpoints.get(normProvider)!] as const] : []);
        for (const [name, info] of endpoints) {
          result.push({
            id: `custom/${name}`,
            name: `Custom (${name})`,
            provider: 'custom',
            contextWindow: 128000,
            maxOutputTokens: 8192,
            supportsTools: true,
            supportsVision: false,
            isFree: false,
            description: `Custom model endpoint at ${info.baseUrl}`,
            configured: true,
            validated: true,
          });
        }
        return result;
      }

      if (normProvider === 'ollama') {
        const res = await fetch(`${this.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        if (res && res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const models: any[] = data.models || [];
          this.isOllamaOnlineCached = true;
          this.ollamaModelCountCached = models.length;
          return models
            .filter((m: any) => !m.name.toLowerCase().includes('embed'))
            .map((m: any) => ({
              id: `ollama/${m.name}`,
              name: `Ollama ${m.name}`,
              provider: 'ollama',
              contextWindow: 32768,
              maxOutputTokens: 8192,
              supportsTools: true,
              supportsVision: m.name.includes('vision') || m.name.includes('llava'),
              isFree: true,
              description: `Local Ollama model (${(m.size ? (m.size / (1024 * 1024 * 1024)).toFixed(1) : 0)} GB)`,
              configured: true,
              validated: true,
            }));
        }
        this.isOllamaOnlineCached = false;
        this.ollamaModelCountCached = 0;
        return [];
      }

      if (normProvider === 'openrouter') {
        const headers: Record<string, string> = {
          'HTTP-Referer': 'https://github.com/abhayzangir1/KIN',
          'X-Title': 'KIN Workforce Platform',
        };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers,
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        if (res && res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const rawList: any[] = data.data || [];
          if (rawList.length > 0) {
            this.validatedProviders.set('openrouter', true);
            this.providerModelCounts.set('openrouter', rawList.length);
            return rawList.map((m: any) => {
              const isZeroCost = m.id.endsWith(':free') ||
                (m.pricing && parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0);
              return {
                id: `openrouter/${m.id}`,
                name: m.name || m.id,
                provider: 'openrouter',
                contextWindow: m.context_length || 128000,
                maxOutputTokens: m.top_provider?.max_completion_tokens || 4096,
                supportsTools: true,
                supportsVision: m.architecture?.modality?.includes('image') || false,
                isFree: isZeroCost,
                description: m.description || `OpenRouter model with ${m.context_length || 128000} context window`,
                configured: Boolean(apiKey),
                validated: Boolean(apiKey),
              };
            });
          }
        }
        this.validatedProviders.set('openrouter', false);
        if (shouldOmit) return [];
        // Fallback standard OpenRouter model templates if offline or unverified
        return [
          { id: 'openrouter/deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 64000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'openrouter/meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 128000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'openrouter/google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 1048576, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'openrouter/qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen 2.5 Coder 32B (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 32768, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'openrouter/anthropic/claude-3.5-sonnet', name: 'Anthropic Claude 3.5 Sonnet', provider: 'openrouter', contextWindow: 200000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'openrouter/openai/gpt-4o', name: 'OpenAI GPT-4o', provider: 'openrouter', contextWindow: 128000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
        ];
      }

      if (normProvider === 'openai') {
        const standardOpenAi: DiscoveredModel[] = [
          { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o', provider: 'openai', contextWindow: 128000, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini', provider: 'openai', contextWindow: 128000, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'openai/o3-mini', name: 'OpenAI o3-mini (Reasoning)', provider: 'openai', contextWindow: 200000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'openai/o1', name: 'OpenAI o1 (Advanced Reasoning)', provider: 'openai', contextWindow: 200000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'openai/gpt-4.5-preview', name: 'OpenAI GPT-4.5 Preview', provider: 'openai', contextWindow: 128000, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
        ];
        if (!apiKey) return shouldOmit ? [] : standardOpenAi;

        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        if (res && res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const list: any[] = data.data || [];
          const chatRegex = /^(gpt-|o1|o3|chatgpt-)/;
          const filtered = list.filter((m: any) =>
            chatRegex.test(m.id) &&
            !m.id.includes('whisper') &&
            !m.id.includes('embedding') &&
            !m.id.includes('tts') &&
            !m.id.includes('dall-e') &&
            !m.id.includes('moderation') &&
            !m.id.includes('realtime') &&
            !m.id.includes('audio')
          );
          if (filtered.length > 0) {
            filtered.sort((a: any, b: any) => (b.created || 0) - (a.created || 0));
            this.validatedProviders.set('openai', true);
            this.providerModelCounts.set('openai', filtered.length);
            return filtered.map((m: any) => ({
              id: `openai/${m.id}`,
              name: `OpenAI ${m.id}`,
              provider: 'openai',
              contextWindow: m.id.includes('o1') || m.id.includes('o3') ? 200000 : 128000,
              maxOutputTokens: 16384,
              supportsTools: true,
              supportsVision: m.id.includes('4o') || m.id.includes('4.5'),
              configured: true,
              validated: true,
            }));
          }
        }
        this.validatedProviders.set('openai', false);
        if (shouldOmit) return [];
        return standardOpenAi;
      }

      if (normProvider === 'anthropic') {
        const standardAnthropic: DiscoveredModel[] = [
          { id: 'anthropic/claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (v2)', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'anthropic/claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextWindow: 200000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'anthropic/claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
        ];
        if (!apiKey) return shouldOmit ? [] : standardAnthropic;

        try {
          const res = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            signal: AbortSignal.timeout(10000),
          }).catch(() => null);

          if (res && res.ok) {
            const data: any = await res.json().catch(() => ({}));
            const list: any[] = data.data || [];
            if (list.length > 0) {
              this.validatedProviders.set('anthropic', true);
              this.providerModelCounts.set('anthropic', list.length);
              return list.map((m: any) => ({
                id: `anthropic/${m.id}`,
                name: m.display_name || `Anthropic ${m.id}`,
                provider: 'anthropic',
                contextWindow: 200000,
                supportsTools: true,
                supportsVision: true,
                configured: true,
                validated: true,
              }));
            }
          }
        } catch {}
        this.validatedProviders.set('anthropic', false);
        if (shouldOmit) return [];
        return standardAnthropic;
      }

      if (normProvider === 'gemini') {
        const standardGemini: DiscoveredModel[] = [
          { id: 'gemini/gemini-2.5-pro', name: 'Google Gemini 2.5 Pro', provider: 'gemini', contextWindow: 2097152, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'gemini/gemini-2.0-flash', name: 'Google Gemini 2.0 Flash', provider: 'gemini', contextWindow: 1048576, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'gemini/gemini-1.5-pro', name: 'Google Gemini 1.5 Pro', provider: 'gemini', contextWindow: 2097152, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'gemini/gemini-1.5-flash', name: 'Google Gemini 1.5 Flash', provider: 'gemini', contextWindow: 1048576, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
        ];
        if (!apiKey) return shouldOmit ? [] : standardGemini;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        if (res && res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const list: any[] = data.models || [];
          const filtered = list.filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'));
          if (filtered.length > 0) {
            this.validatedProviders.set('gemini', true);
            this.providerModelCounts.set('gemini', filtered.length);
            return filtered.map((m: any) => {
              const cleanId = m.name.replace(/^models\//, '');
              return {
                id: `gemini/${cleanId}`,
                name: m.displayName || `Gemini ${cleanId}`,
                provider: 'gemini',
                contextWindow: m.inputTokenLimit || 1048576,
                maxOutputTokens: m.outputTokenLimit || 8192,
                supportsTools: true,
                supportsVision: true,
                description: m.description,
                configured: true,
                validated: true,
              };
            });
          }
        }
        this.validatedProviders.set('gemini', false);
        if (shouldOmit) return [];
        return standardGemini;
      }

      if (normProvider === 'deepseek') {
        const standardDeepSeek: DiscoveredModel[] = [
          { id: 'deepseek/deepseek-chat', name: 'DeepSeek-V3 (Chat)', provider: 'deepseek', contextWindow: 64000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek-R1 (Reasoner)', provider: 'deepseek', contextWindow: 64000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
        ];
        if (!apiKey) return shouldOmit ? [] : standardDeepSeek;

        try {
          const res = await fetch('https://api.deepseek.com/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          }).catch(() => null);

          if (res && res.ok) {
            const data: any = await res.json().catch(() => ({}));
            const list: any[] = data.data || [];
            if (list.length > 0) {
              this.validatedProviders.set('deepseek', true);
              this.providerModelCounts.set('deepseek', list.length);
              return list.map((m: any) => ({
                id: `deepseek/${m.id}`,
                name: `DeepSeek ${m.id}`,
                provider: 'deepseek',
                contextWindow: 64000,
                supportsTools: true,
                configured: true,
                validated: true,
              }));
            }
          }
        } catch {}
        this.validatedProviders.set('deepseek', false);
        if (shouldOmit) return [];
        return standardDeepSeek;
      }

      if (normProvider === 'groq') {
        const standardGroq: DiscoveredModel[] = [
          { id: 'groq/llama-3.3-70b-versatile', name: 'Groq Llama 3.3 70B Versatile', provider: 'groq', contextWindow: 128000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'groq/deepseek-r1-distill-llama-70b', name: 'Groq DeepSeek R1 Distill 70B', provider: 'groq', contextWindow: 128000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          { id: 'groq/mixtral-8x7b-32768', name: 'Groq Mixtral 8x7B', provider: 'groq', contextWindow: 32768, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
        ];
        if (!apiKey) return shouldOmit ? [] : standardGroq;

        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        if (res && res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const list: any[] = data.data || [];
          const filtered = list.filter((m: any) => !m.id.includes('whisper'));
          if (filtered.length > 0) {
            this.validatedProviders.set('groq', true);
            this.providerModelCounts.set('groq', filtered.length);
            return filtered.map((m: any) => ({
              id: `groq/${m.id}`,
              name: `Groq ${m.id}`,
              provider: 'groq',
              contextWindow: m.context_window || 128000,
              supportsTools: true,
              configured: true,
              validated: true,
            }));
          }
        }
        this.validatedProviders.set('groq', false);
        if (shouldOmit) return [];
        return standardGroq;
      }
    } catch (err) {
      console.warn(`[KIN MODEL GATEWAY] Error discovering models for ${provider}:`, err);
    }

    return [];
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
      } else if (provider === 'gemini') {
        const apiKey = this.resolveApiKey('gemini');
        return await this.invokeOpenAiCompatible(
          'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
          apiKey,
          modelName,
          params,
          startTime,
          'gemini'
        );
      } else if (this.customEndpoints.has(provider) || (provider === 'custom' && this.customEndpoints.has(modelName)) || (provider === 'custom' && this.customEndpoints.size === 1)) {
        const custom = this.customEndpoints.get(provider)
          || this.customEndpoints.get(modelName)
          || this.customEndpoints.values().next().value!;
        const apiKey = custom.apiKey || this.resolveApiKey(provider) || this.resolveApiKey(modelName);
        const url = custom.baseUrl.endsWith('/chat/completions')
          ? custom.baseUrl
          : `${custom.baseUrl.replace(/\/$/, '')}/chat/completions`;
        return await this.invokeOpenAiCompatible(
          url,
          apiKey,
          modelName,
          params,
          startTime,
          provider
        );
      } else {
        // Check if provider is an OpenRouter namespace or model slug (e.g. meta-llama/..., qwen/...)
        const openRouterKey = this.resolveApiKey('openrouter');
        if (openRouterKey && (modelName.includes('/') || params.modelId.includes(':free') || params.modelId.includes('/'))) {
          return await this.invokeOpenRouter(params.modelId, params, startTime);
        }

        // Automated fallback failover if configured
        if (params.fallbackModelId && params.fallbackModelId !== params.modelId) {
          const fallbackRes = await this.invoke({
            ...params,
            modelId: params.fallbackModelId,
            fallbackModelId: undefined,
          });
          if (!fallbackRes.isError) return fallbackRes;
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
      if (params.fallbackModelId && params.fallbackModelId !== params.modelId) {
        try {
          const fallbackRes = await this.invoke({
            ...params,
            modelId: params.fallbackModelId,
            fallbackModelId: undefined,
          });
          if (!fallbackRes.isError) return fallbackRes;
        } catch {
          // ignore fallback error and return primary error report
        }
      }
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

    const stream = !!params.onToken;
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
        stream,
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

    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    if (stream && res.body && typeof (res.body as any).getReader === 'function') {
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
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.delta?.reasoning || '';
            if (delta) {
              content += delta;
              params.onToken!(delta);
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || promptTokens;
              completionTokens = parsed.usage.completion_tokens || completionTokens;
              totalTokens = parsed.usage.total_tokens || totalTokens;
            }
          } catch {}
        }
      }
    } else {
      const data: any = await res.json();
      const choiceMsg = data?.choices?.[0]?.message;
      content = (choiceMsg?.content || choiceMsg?.reasoning || data?.choices?.[0]?.text || '').trim();
      promptTokens = data?.usage?.prompt_tokens || 0;
      completionTokens = data?.usage?.completion_tokens || 0;
      totalTokens = data?.usage?.total_tokens || 0;
      if (params.onToken && content) {
        params.onToken(content);
      }
    }

    const tokensUsed = {
      promptTokens,
      completionTokens,
      totalTokens: totalTokens || (promptTokens + completionTokens),
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

    const stream = !!params.onToken;
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
        stream,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`${provider.toUpperCase()} HTTP ${res.status}: ${errText}`);
    }

    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    if (stream && res.body && typeof (res.body as any).getReader === 'function') {
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
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.delta?.reasoning || '';
            if (delta) {
              content += delta;
              params.onToken!(delta);
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || promptTokens;
              completionTokens = parsed.usage.completion_tokens || completionTokens;
              totalTokens = parsed.usage.total_tokens || totalTokens;
            }
          } catch {}
        }
      }
    } else {
      const data: any = await res.json();
      content = data?.choices?.[0]?.message?.content || '';
      promptTokens = data?.usage?.prompt_tokens || 0;
      completionTokens = data?.usage?.completion_tokens || 0;
      totalTokens = data?.usage?.total_tokens || 0;
      if (params.onToken && content) {
        params.onToken(content);
      }
    }

    const tokensUsed = {
      promptTokens,
      completionTokens,
      totalTokens: totalTokens || (promptTokens + completionTokens),
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

    const stream = !!params.onToken;
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
        stream,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic HTTP ${res.status}: ${errText}`);
    }

    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;

    if (stream && res.body && typeof (res.body as any).getReader === 'function') {
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
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              content += parsed.delta.text;
              params.onToken!(parsed.delta.text);
            }
            if (parsed.type === 'message_start' && parsed.message?.usage?.input_tokens) {
              promptTokens = parsed.message.usage.input_tokens;
            }
            if (parsed.type === 'message_delta' && parsed.usage?.output_tokens) {
              completionTokens = parsed.usage.output_tokens;
            }
          } catch {}
        }
      }
    } else {
      const data: any = await res.json();
      content = data?.content?.[0]?.text || '';
      promptTokens = data?.usage?.input_tokens || 0;
      completionTokens = data?.usage?.output_tokens || 0;
      if (params.onToken && content) {
        params.onToken(content);
      }
    }

    const tokensUsed = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
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
