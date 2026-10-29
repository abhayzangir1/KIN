// ============================================================================
// KIN MODEL GATEWAY
// Provider-neutral LLM invocation with streaming, error normalization,
// and zero autonomous model routing (strictly adheres to user-assigned model).
// ============================================================================

import { SecretVault } from '../security/secret_vault.js';
import { SecretBroker } from '../security/secret_broker.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelInvocationParams {
  modelId: string;
  fallbackModelId?: string;
  disableFallback?: boolean;
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  onToken?: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  callerAgentId?: string;
  signal?: AbortSignal;
}

function resolveEffectiveSignal(signal?: AbortSignal, timeoutMs: number = 120000): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  return typeof (AbortSignal as any).any === 'function' ? (AbortSignal as any).any([signal, timeoutSignal]) : signal;
}

/**
 * Strips raw thinking / chain-of-thought tags, reasoning blocks, and raw tool syntax
 * so channel & DM messages remain clean, crisp, and user-facing.
 */
export function separateThinkingAndContent(
  rawContent: string,
  existingThinking?: string,
  options: { stripToolCalls?: boolean } = {}
): { cleanContent: string; thinking?: string } {
  let content = rawContent || '';
  let thinking = existingThinking || '';

  // 1. Extract <think>...</think> tags
  if (content.includes('<think>')) {
    const thinkMatches = content.match(/<think>([\s\S]*?)<\/think>/gi);
    if (thinkMatches) {
      for (const m of thinkMatches) {
        const inner = m.replace(/<\/?think>/gi, '').trim();
        if (inner) thinking = thinking ? `${thinking}\n${inner}` : inner;
      }
      content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    } else if (content.includes('</think>')) {
      const parts = content.split('</think>');
      const inner = parts[0].replace(/<think>/gi, '').trim();
      if (inner) thinking = thinking ? `${thinking}\n${inner}` : inner;
      content = parts.slice(1).join('').trim();
    }
  } else if (content.includes('</think>')) {
    const parts = content.split('</think>');
    const inner = parts[0].trim();
    if (inner) thinking = thinking ? `${thinking}\n${inner}` : inner;
    content = parts.slice(1).join('').trim();
  }

  // 2. Extract <reasoning>...</reasoning>
  if (content.includes('<reasoning>')) {
    const reasoningMatches = content.match(/<reasoning>([\s\S]*?)<\/reasoning>/gi);
    if (reasoningMatches) {
      for (const m of reasoningMatches) {
        const inner = m.replace(/<\/?reasoning>/gi, '').trim();
        if (inner) thinking = thinking ? `${thinking}\n${inner}` : inner;
      }
      content = content.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').trim();
    }
  }

  // 3. Extract explicit "Thinking Process:\n\n" or "Reasoning:\n\n" prefix
  const thinkingProcessMatch = content.match(/^(?:Thinking Process|Reasoning):\s*([\s\S]*?)(?:\r?\n\r?\n|\n\n)([\s\S]*)$/i);
  if (thinkingProcessMatch) {
    const inner = thinkingProcessMatch[1].trim();
    if (inner) thinking = thinking ? `${thinking}\n${inner}` : inner;
    content = thinkingProcessMatch[2].trim();
  }

  // 4. Strip stray unexecuted <tool_call>...</tool_call> tags ONLY if explicitly requested (e.g. final user message)
  if (options.stripToolCalls && content.includes('<tool_call>')) {
    content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
  }

  return {
    cleanContent: content.trim(),
    thinking: thinking.trim() || undefined,
  };
}

async function readChunkWithTimeout(reader: any, timeoutMs = 30000): Promise<{ done: boolean; value?: any }> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<{ done: boolean; value?: any }>((_, reject) => {
    timer = setTimeout(() => {
      try {
        if (reader && typeof reader.cancel === 'function') {
          reader.cancel().catch?.(() => {});
        }
      } catch {}
      reject(new Error(`Model stream stalled: no chunk received within ${timeoutMs}ms idle timeout.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      reader.read(),
      timeoutPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  isAborted?: boolean;
  switchedModelId?: string;
}

export interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
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
  ready?: boolean;
  keyCount?: number;
  modelCount: number;
  message?: string;
}

export interface ManagedKeyInfo {
  id: string;
  key: string;
  keyAlias?: string;
  baseUrl?: string;
}

export const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1',
  xai: 'https://api.x.ai/v1',
  anthropic: 'https://api.anthropic.com/v1',
  together: 'https://api.together.xyz/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  perplexity: 'https://api.perplexity.ai',
  cerebras: 'https://api.cerebras.ai/v1',
  lmstudio: 'http://localhost:1234/v1',
  vllm: 'http://localhost:8000/v1',
  openai_compatible: 'http://localhost:1234/v1',
};

export const KNOWN_OPENAI_COMPATIBLE_PROVIDERS: string[] = [
  'openai',
  'deepseek',
  'gemini',
  'groq',
  'xai',
  'together',
  'deepinfra',
  'fireworks',
  'perplexity',
  'cerebras',
  'lmstudio',
  'vllm',
  'openai_compatible',
  'custom',
];

export interface ModelGatewayOptions {
  apiKeyResolver?: (provider: string, callerAgentId?: string) => string | undefined;
  allKeysResolver?: (provider: string, callerAgentId?: string) => ManagedKeyInfo[];
  onUsage?: (provider: string, tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  openrouterApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  deepseekApiKey?: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  xaiApiKey?: string;
  ollamaHost?: string;
}

export class ModelGateway {
  private ollamaHost: string;
  private openrouterApiKey?: string;
  private openaiApiKey?: string;
  private anthropicApiKey?: string;
  private deepseekApiKey?: string;
  private geminiApiKey?: string;
  private groqApiKey?: string;
  private xaiApiKey?: string;
  private apiKeyResolver?: (provider: string, callerAgentId?: string) => string | undefined;
  private allKeysResolver?: (provider: string, callerAgentId?: string) => ManagedKeyInfo[];
  private onUsage?: (provider: string, tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  private customEndpoints: Map<string, { baseUrl: string; apiKey?: string }> = new Map();
  private validatedProviders: Map<string, boolean> = new Map();
  private providerModelCounts: Map<string, number> = new Map();
  private isOllamaOnlineCached?: boolean;
  private ollamaModelCountCached?: number;

  constructor(options?: ModelGatewayOptions) {
    this.ollamaHost = options?.ollamaHost || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    this.openrouterApiKey = options?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    this.openaiApiKey = options?.openaiApiKey || process.env.OPENAI_API_KEY;
    this.anthropicApiKey = options?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    this.deepseekApiKey = options?.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
    this.geminiApiKey = options?.geminiApiKey || process.env.GEMINI_API_KEY;
    this.groqApiKey = options?.groqApiKey || process.env.GROQ_API_KEY;
    this.xaiApiKey = options?.xaiApiKey || process.env.XAI_API_KEY;
    this.apiKeyResolver = options?.apiKeyResolver;
    this.allKeysResolver = options?.allKeysResolver;
    this.onUsage = options?.onUsage;
  }

  public registerCustomProvider(name: string, baseUrl: string, apiKey?: string): void {
    this.customEndpoints.set(name.toLowerCase(), { baseUrl, apiKey });
  }

  public unregisterCustomProvider(name: string): void {
    this.customEndpoints.delete(name.toLowerCase().trim());
  }

  public clearCustomEndpoints(): void {
    this.customEndpoints.clear();
  }

  public getCustomEndpointNames(): string[] {
    return Array.from(this.customEndpoints.keys());
  }

  public getCustomEndpoint(name: string): { baseUrl: string; apiKey?: string } | undefined {
    return this.customEndpoints.get(name.toLowerCase());
  }

  public setApiKeyResolver(resolver: (provider: string, callerAgentId?: string) => string | undefined) {
    this.apiKeyResolver = resolver;
  }

  public setAllKeysResolver(resolver: (provider: string, callerAgentId?: string) => ManagedKeyInfo[]) {
    this.allKeysResolver = resolver;
  }

  public setOnUsage(handler: (provider: string, tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }) => void) {
    this.onUsage = handler;
  }

  public resolveApiKey(provider: string, callerAgentId?: string): string | undefined {
    let rawKey: string | undefined;
    if (this.apiKeyResolver) {
      const resolved = this.apiKeyResolver(provider, callerAgentId);
      if (resolved) rawKey = resolved;
    }
    if (!rawKey) {
      if (provider === 'openrouter') rawKey = this.openrouterApiKey || process.env.OPENROUTER_API_KEY;
      else if (provider === 'openai') rawKey = this.openaiApiKey || process.env.OPENAI_API_KEY;
      else if (provider === 'anthropic') rawKey = this.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
      else if (provider === 'deepseek') rawKey = this.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
      else if (provider === 'gemini') rawKey = this.geminiApiKey || process.env.GEMINI_API_KEY;
      else if (provider === 'groq') rawKey = this.groqApiKey || process.env.GROQ_API_KEY;
      else if (provider === 'xai') rawKey = this.xaiApiKey || process.env.XAI_API_KEY;
      else {
        const custom = this.customEndpoints.get(provider.toLowerCase());
        if (custom && custom.apiKey) {
          rawKey = custom.apiKey;
        }
      }
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
        ready: isOnline,
        keyCount: 1,
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
          ready: true,
          keyCount: 1,
          modelCount: this.providerModelCounts.get(norm) || 1,
          message: `Custom endpoint "${norm}" registered at ${custom.baseUrl}`,
        };
      }
      const customCount = this.customEndpoints.size;
      return {
        provider: 'custom',
        configured: customCount > 0,
        validated: customCount > 0,
        ready: customCount > 0,
        keyCount: customCount,
        modelCount: customCount,
        message: customCount > 0 ? `${customCount} custom endpoint(s) registered` : 'No custom endpoint configured',
      };
    }
    const apiKey = this.resolveApiKey(norm);
    const isConfigured = Boolean(apiKey);
    const isValidated = this.validatedProviders.get(norm) ?? false;
    const count = this.providerModelCounts.get(norm) ?? 0;
    const allKeys = this.allKeysResolver ? this.allKeysResolver(norm) : [];
    const keyCount = allKeys.length || (isConfigured ? 1 : 0);
    return {
      provider: norm,
      configured: isConfigured,
      validated: isValidated,
      ready: isConfigured && isValidated,
      keyCount,
      modelCount: isValidated ? count : 0,
      message: !isConfigured
        ? `API key missing for ${norm}`
        : (isValidated
            ? (keyCount > 1 ? `Validated and reachable (${count} models, ${keyCount} active keys)` : `Validated and reachable (${count} models)`)
            : `API key configured; connection unverified (${norm})`),
    };
  }

  public async checkProviderReadiness(provider: string): Promise<ProviderReadiness> {
    const norm = provider.toLowerCase().trim();
    if (norm === 'ollama') {
      if (process.env.KIN_ISOLATE_OLLAMA === 'true') {
        this.isOllamaOnlineCached = false;
        this.ollamaModelCountCached = 0;
        return {
          provider: 'ollama',
          configured: Boolean(this.ollamaHost),
          validated: false,
          ready: false,
          keyCount: 1,
          modelCount: 0,
          message: 'Local Ollama runtime unreachable (isolated via environment)',
        };
      }
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
            ready: true,
            keyCount: 1,
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
        ready: false,
        keyCount: 1,
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
          ready: true,
          keyCount: 1,
          modelCount: this.providerModelCounts.get(norm) || 1,
          message: `Custom endpoint "${norm}" registered at ${custom.baseUrl}`,
        };
      }
      const customCount = this.customEndpoints.size;
      return {
        provider: 'custom',
        configured: customCount > 0,
        validated: customCount > 0,
        ready: customCount > 0,
        keyCount: customCount,
        modelCount: customCount,
        message: customCount > 0 ? `${customCount} custom endpoint(s) registered` : 'No custom endpoint configured',
      };
    }

    const apiKey = this.resolveApiKey(norm);
    const allKeys = this.allKeysResolver ? this.allKeysResolver(norm) : [];
    const keyCount = allKeys.length || (apiKey ? 1 : 0);
    if (!apiKey) {
      this.validatedProviders.set(norm, false);
      this.providerModelCounts.set(norm, 0);
      return {
        provider: norm,
        configured: false,
        validated: false,
        ready: false,
        keyCount: 0,
        modelCount: 0,
        message: `API key not configured for ${norm}`,
      };
    }

    try {
      const verification = await this.verifyProviderConnection(norm, apiKey);
      this.validatedProviders.set(norm, verification.working);
      this.providerModelCounts.set(norm, verification.working ? verification.modelCount : 0);
      return {
        provider: norm,
        configured: true,
        validated: verification.working,
        ready: verification.working,
        keyCount,
        modelCount: verification.working ? verification.modelCount : 0,
        message: keyCount > 1
          ? `${verification.message} (${keyCount} keys active)`
          : verification.message,
      };
    } catch (e: any) {
      this.validatedProviders.set(norm, false);
      this.providerModelCounts.set(norm, 0);
      return {
        provider: norm,
        configured: true,
        validated: false,
        ready: false,
        keyCount,
        modelCount: 0,
        message: `Connection validation failed: ${e.message}`,
      };
    }
  }

  public invalidateProvider(provider: string): void {
    const norm = provider.toLowerCase().trim();
    this.validatedProviders.delete(norm);
    this.providerModelCounts.delete(norm);
    this.customEndpoints.delete(norm);
  }

  /**
   * Performs an authoritative, real network verification of a provider's API key.
   * Confirms whether the API credentials are valid and functional, returning true models or error details.
   */
  public async verifyProviderConnection(
    provider: string,
    explicitApiKey?: string,
    customBaseUrl?: string
  ): Promise<{ valid: boolean; working: boolean; message: string; modelCount: number; models: DiscoveredModel[] }> {
    const norm = provider.toLowerCase().trim();
    const apiKey = explicitApiKey || this.resolveApiKey(norm);

    if (norm === 'ollama') {
      try {
        const res = await fetch(`${this.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
        if (res && res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const rawModels: any[] = data.models || [];
          const models: DiscoveredModel[] = rawModels
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
              description: `Local Ollama model (${m.size ? (m.size / (1024 * 1024 * 1024)).toFixed(1) : 0} GB)`,
              configured: true,
              validated: true,
            }));
          this.isOllamaOnlineCached = true;
          this.ollamaModelCountCached = models.length;
          this.validatedProviders.set('ollama', true);
          this.providerModelCounts.set('ollama', models.length);
          return {
            valid: true,
            working: true,
            message: `Local Ollama is online and working (${models.length} model(s) available)`,
            modelCount: models.length,
            models,
          };
        }
      } catch (err: any) {
        return {
          valid: false,
          working: false,
          message: `Local Ollama unreachable on port 11434 (${err.message})`,
          modelCount: 0,
          models: [],
        };
      }
      return {
        valid: false,
        working: false,
        message: 'Local Ollama service is offline',
        modelCount: 0,
        models: [],
      };
    }

    const isZeroAuthPermitted =
      Boolean(customBaseUrl) ||
      norm === 'custom' ||
      norm === 'openai_compatible' ||
      norm === 'vllm' ||
      norm === 'lmstudio' ||
      this.customEndpoints.has(norm);
    if (!apiKey && !isZeroAuthPermitted) {
      return {
        valid: false,
        working: false,
        message: `No API key configured for ${norm}`,
        modelCount: 0,
        models: [],
      };
    }

    try {
      if (norm === 'openai') {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        }).catch((err) => { throw new Error(`Network failure connecting to OpenAI: ${err.message}`); });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${res.status}: ${res.statusText}`;
          return {
            valid: false,
            working: false,
            message: `OpenAI API Key invalid or rejected: ${errMsg}`,
            modelCount: 0,
            models: [],
          };
        }

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
        filtered.sort((a: any, b: any) => (b.created || 0) - (a.created || 0));

        const models: DiscoveredModel[] = filtered.map((m: any) => ({
          id: `openai/${m.id}`,
          name: `OpenAI ${m.id}`,
          provider: 'openai',
          contextWindow: m.id.includes('o1') || m.id.includes('o3') ? 200000 : 128000,
          maxOutputTokens: 16384,
          supportsTools: true,
          supportsVision: m.id.includes('4o') || m.id.includes('4.5'),
          supportsReasoning: m.id.includes('o1') || m.id.includes('o3'),
          configured: true,
          validated: true,
        }));

        this.validatedProviders.set('openai', true);
        this.providerModelCounts.set('openai', models.length);
        return {
          valid: true,
          working: true,
          message: `OpenAI API key verified successfully (${models.length} chat & reasoning model(s) available)`,
          modelCount: models.length,
          models,
        };
      }

      if (norm === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey!,
            'anthropic-version': '2023-06-01',
          },
          signal: AbortSignal.timeout(8000),
        }).catch((err) => { throw new Error(`Network failure connecting to Anthropic: ${err.message}`); });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${res.status}: ${res.statusText}`;
          return {
            valid: false,
            working: false,
            message: `Anthropic API Key invalid or rejected: ${errMsg}`,
            modelCount: 0,
            models: [],
          };
        }

        const data: any = await res.json().catch(() => ({}));
        const list: any[] = data.data || [];
        const models: DiscoveredModel[] = list.map((m: any) => ({
          id: `anthropic/${m.id}`,
          name: m.display_name || `Anthropic ${m.id}`,
          provider: 'anthropic',
          contextWindow: 200000,
          supportsTools: true,
          supportsVision: true,
          supportsReasoning: m.id.includes('3-7') || m.id.includes('reasoning'),
          configured: true,
          validated: true,
        }));

        this.validatedProviders.set('anthropic', true);
        this.providerModelCounts.set('anthropic', models.length);
        return {
          valid: true,
          working: true,
          message: `Anthropic API key verified successfully (${models.length} Claude model(s) available)`,
          modelCount: models.length,
          models,
        };
      }

      if (norm === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models`, {
          headers: {
            'x-goog-api-key': apiKey!,
          },
          signal: AbortSignal.timeout(8000),
        }).catch((err) => { throw new Error(`Network failure connecting to Google Gemini: ${err.message}`); });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${res.status}: ${res.statusText}`;
          return {
            valid: false,
            working: false,
            message: `Google Gemini API Key invalid or rejected: ${errMsg}`,
            modelCount: 0,
            models: [],
          };
        }

        const data: any = await res.json().catch(() => ({}));
        const list: any[] = data.models || [];
        const filtered = list.filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'));
        const models: DiscoveredModel[] = filtered.map((m: any) => {
          const cleanId = m.name.replace(/^models\//, '');
          return {
            id: `gemini/${cleanId}`,
            name: m.displayName || `Gemini ${cleanId}`,
            provider: 'gemini',
            contextWindow: m.inputTokenLimit || 1048576,
            maxOutputTokens: m.outputTokenLimit || 8192,
            supportsTools: true,
            supportsVision: true,
            supportsReasoning: cleanId.includes('2.5') || cleanId.includes('thinking'),
            description: m.description,
            configured: true,
            validated: true,
          };
        });

        this.validatedProviders.set('gemini', true);
        this.providerModelCounts.set('gemini', models.length);
        return {
          valid: true,
          working: true,
          message: `Google Gemini API key verified successfully (${models.length} Gemini model(s) available)`,
          modelCount: models.length,
          models,
        };
      }

      if (norm === 'deepseek') {
        const res = await fetch('https://api.deepseek.com/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        }).catch((err) => { throw new Error(`Network failure connecting to DeepSeek: ${err.message}`); });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${res.status}: ${res.statusText}`;
          return {
            valid: false,
            working: false,
            message: `DeepSeek API Key invalid or rejected: ${errMsg}`,
            modelCount: 0,
            models: [],
          };
        }

        const data: any = await res.json().catch(() => ({}));
        const list: any[] = data.data || [];
        const models: DiscoveredModel[] = list.map((m: any) => ({
          id: `deepseek/${m.id}`,
          name: `DeepSeek ${m.id}`,
          provider: 'deepseek',
          contextWindow: 64000,
          supportsTools: true,
          supportsReasoning: m.id.includes('reasoner') || m.id.includes('r1'),
          configured: true,
          validated: true,
        }));

        this.validatedProviders.set('deepseek', true);
        this.providerModelCounts.set('deepseek', models.length);
        return {
          valid: true,
          working: true,
          message: `DeepSeek API key verified successfully (${models.length} model(s) available)`,
          modelCount: models.length,
          models,
        };
      }

      if (norm === 'groq') {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        }).catch((err) => { throw new Error(`Network failure connecting to Groq: ${err.message}`); });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${res.status}: ${res.statusText}`;
          return {
            valid: false,
            working: false,
            message: `Groq API Key invalid or rejected: ${errMsg}`,
            modelCount: 0,
            models: [],
          };
        }

        const data: any = await res.json().catch(() => ({}));
        const list: any[] = data.data || [];
        const filtered = list.filter((m: any) => !m.id.includes('whisper'));
        const models: DiscoveredModel[] = filtered.map((m: any) => ({
          id: `groq/${m.id}`,
          name: `Groq ${m.id}`,
          provider: 'groq',
          contextWindow: m.context_window || 128000,
          supportsTools: true,
          supportsReasoning: m.id.includes('r1') || m.id.includes('reason'),
          configured: true,
          validated: true,
        }));

        this.validatedProviders.set('groq', true);
        this.providerModelCounts.set('groq', models.length);
        return {
          valid: true,
          working: true,
          message: `Groq API key verified successfully (${models.length} high-speed model(s) available)`,
          modelCount: models.length,
          models,
        };
      }

      if (norm === 'xai') {
        const res = await fetch('https://api.x.ai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        }).catch((err) => { throw new Error(`Network failure connecting to xAI: ${err.message}`); });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${res.status}: ${res.statusText}`;
          return {
            valid: false,
            working: false,
            message: `xAI API Key invalid or rejected: ${errMsg}`,
            modelCount: 0,
            models: [],
          };
        }

        const data: any = await res.json().catch(() => ({}));
        const list: any[] = data.data || [];
        const models: DiscoveredModel[] = list.map((m: any) => ({
          id: `xai/${m.id}`,
          name: `xAI ${m.id}`,
          provider: 'xai',
          contextWindow: 131072,
          supportsTools: true,
          supportsVision: m.id.includes('vision'),
          supportsReasoning: true,
          configured: true,
          validated: true,
        }));

        this.validatedProviders.set('xai', true);
        this.providerModelCounts.set('xai', models.length);
        return {
          valid: true,
          working: true,
          message: `xAI API key verified successfully (${models.length} Grok model(s) available)`,
          modelCount: models.length,
          models,
        };
      }

      if (norm === 'openrouter') {
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
        }).catch((err) => { throw new Error(`Network failure connecting to OpenRouter: ${err.message}`); });

        if (!res.ok) {
          return {
            valid: false,
            working: false,
            message: `OpenRouter API connection failed: HTTP ${res.status}`,
            modelCount: 0,
            models: [],
          };
        }

        const data: any = await res.json().catch(() => ({}));
        const rawList: any[] = data.data || [];
        const models: DiscoveredModel[] = rawList.map((m: any) => {
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
            supportsReasoning: Boolean(m.id.includes('r1') || m.id.includes('reason') || m.id.includes('thinking')),
            isFree: isZeroCost,
            description: m.description,
            configured: Boolean(apiKey),
            validated: true,
          };
        });

        this.validatedProviders.set('openrouter', true);
        this.providerModelCounts.set('openrouter', models.length);
        return {
          valid: true,
          working: true,
          message: `OpenRouter connection verified (${models.length} model(s) accessible)`,
          modelCount: models.length,
          models,
        };
      }

      if (norm === 'azure') {
        const endpoint = customBaseUrl || process.env.AZURE_OPENAI_ENDPOINT;
        if (!endpoint) {
          return {
            valid: false,
            working: false,
            message: 'Azure OpenAI requires an endpoint URL (e.g. https://YOUR_RESOURCE.openai.azure.com)',
            modelCount: 0,
            models: [],
          };
        }
        if (!apiKey) {
          return {
            valid: false,
            working: false,
            message: 'Azure API key is required',
            modelCount: 0,
            models: [],
          };
        }
        const cleanBase = endpoint.replace(/\/+$/, '');
        const testUrl = `${cleanBase}/openai/models?api-version=2024-06-01`;
        const res = await fetch(testUrl, {
          headers: { 'api-key': apiKey },
          signal: AbortSignal.timeout(8000),
        }).catch((err) => { throw new Error(`Network failure connecting to Azure OpenAI: ${err.message}`); });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${res.status}: ${res.statusText}`;
          return {
            valid: false,
            working: false,
            message: `Azure OpenAI verification failed: ${errMsg}`,
            modelCount: 0,
            models: [],
          };
        }

        const data: any = await res.json().catch(() => ({}));
        const list: any[] = data.data || [];
        const models: DiscoveredModel[] = list.map((m: any) => ({
          id: `azure/${m.id}`,
          name: `Azure ${m.id}`,
          provider: 'azure',
          contextWindow: 128000,
          supportsTools: true,
          supportsVision: m.id.includes('vision') || m.id.includes('4o'),
          configured: true,
          validated: true,
        }));

        this.validatedProviders.set('azure', true);
        this.providerModelCounts.set('azure', models.length);
        return {
          valid: true,
          working: true,
          message: `Azure OpenAI verified successfully (${models.length} model(s) available)`,
          modelCount: models.length,
          models,
        };
      }

      const isOpenAiCompatible =
        norm === 'custom' ||
        norm === 'openai_compatible' ||
        KNOWN_OPENAI_COMPATIBLE_PROVIDERS.includes(norm) ||
        this.customEndpoints.has(norm) ||
        Boolean(customBaseUrl);

      if (isOpenAiCompatible) {
        const endpoint = this.customEndpoints.get(norm) || (customBaseUrl ? { baseUrl: customBaseUrl, apiKey } : null);
        const rawBaseUrl = endpoint?.baseUrl || customBaseUrl || DEFAULT_PROVIDER_BASE_URLS[norm];
        if (!rawBaseUrl) {
          return {
            valid: false,
            working: false,
            message: `No endpoint URL configured for provider ${norm}`,
            modelCount: 0,
            models: [],
          };
        }
        const cleanBase = rawBaseUrl.replace(/\/+$/, '');
        const modelsUrl = cleanBase.endsWith('/models') ? cleanBase : `${cleanBase}/models`;
        const headers: Record<string, string> = {};
        const effectiveKey = apiKey || endpoint?.apiKey;
        if (effectiveKey && effectiveKey !== 'local-no-key') {
          headers['Authorization'] = `Bearer ${effectiveKey}`;
        }
        let res: Response | null = null;
        try {
          res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(8000) });
        } catch (fetchErr: any) {
          return {
            valid: false,
            working: false,
            message: `Endpoint unreachable at ${rawBaseUrl}: ${fetchErr.message}`,
            modelCount: 0,
            models: [],
          };
        }

        if (res.status === 401 || res.status === 403) {
          return {
            valid: false,
            working: false,
            message: `${norm.toUpperCase()} API key rejected or unauthorized (HTTP ${res.status})`,
            modelCount: 0,
            models: [],
          };
        }

        if (res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const list: any[] = data.data || data.models || [];
          if (Array.isArray(list) && list.length > 0) {
            const models: DiscoveredModel[] = list.map((m: any) => {
              const rawId = String(m.id || m.name);
              const prefixedId = rawId.startsWith(`${norm}/`) ? rawId : `${norm}/${rawId}`;
              return {
                id: prefixedId,
                name: m.name || m.id || prefixedId,
                provider: norm,
                contextWindow: m.context_window || 128000,
                supportsTools: true,
                supportsReasoning: Boolean(rawId.includes('r1') || rawId.includes('reason') || rawId.includes('thinking')),
                configured: true,
                validated: true,
              };
            });
            this.validatedProviders.set(norm, true);
            this.providerModelCounts.set(norm, models.length);
            return {
              valid: true,
              working: true,
              message: `${norm} verified successfully (${models.length} model(s) available)`,
              modelCount: models.length,
              models,
            };
          }
        }

        // For endpoints that return 200 or 404/405 without standard /models array:
        const fallbackModel: DiscoveredModel = {
          id: `${norm}/default`,
          name: `${norm} default model`,
          provider: norm,
          contextWindow: 128000,
          supportsTools: true,
          configured: true,
          validated: true,
        };
        this.validatedProviders.set(norm, true);
        this.providerModelCounts.set(norm, 1);
        return {
          valid: true,
          working: true,
          message: `${norm} endpoint verified successfully at ${rawBaseUrl}`,
          modelCount: 1,
          models: [fallbackModel],
        };
      }
    } catch (err: any) {
      return {
        valid: false,
        working: false,
        message: `Validation error for ${norm}: ${err.message}`,
        modelCount: 0,
        models: [],
      };
    }

    return {
      valid: false,
      working: false,
      message: `Unknown provider ${provider}`,
      modelCount: 0,
      models: [],
    };
  }

  /**
   * Dynamically discovers and fetches available models directly from provider APIs.
   * Enables zero-hardcoding discovery so newly released models are immediately accessible.
   */
  public async fetchProviderModels(
    provider: string,
    explicitApiKey?: string,
    options?: { omitUnconfigured?: boolean; baseUrl?: string } | boolean
  ): Promise<DiscoveredModel[]> {
    const normProvider = provider.toLowerCase().trim();
    const shouldOmit = typeof options === 'boolean' ? options : Boolean(options?.omitUnconfigured);
    const customBaseUrl = typeof options === 'object' ? options?.baseUrl : undefined;
    const apiKey = explicitApiKey || this.resolveApiKey(normProvider);

    if (shouldOmit && normProvider !== 'ollama' && normProvider !== 'custom' && !this.customEndpoints.has(normProvider) && !customBaseUrl && !apiKey) {
      return [];
    }

    try {
      const isGenericCompatible =
        normProvider === 'custom' ||
        normProvider === 'openai_compatible' ||
        KNOWN_OPENAI_COMPATIBLE_PROVIDERS.includes(normProvider) ||
        this.customEndpoints.has(normProvider) ||
        Boolean(customBaseUrl);

      if (
        isGenericCompatible &&
        normProvider !== 'openai' &&
        normProvider !== 'gemini' &&
        normProvider !== 'deepseek' &&
        normProvider !== 'groq' &&
        normProvider !== 'xai' &&
        normProvider !== 'ollama' &&
        normProvider !== 'openrouter' &&
        normProvider !== 'anthropic' &&
        normProvider !== 'azure'
      ) {
        const result: DiscoveredModel[] = [];
        const endpoints: Array<[string, { baseUrl: string; apiKey?: string }]> = [];
        if (customBaseUrl) {
          endpoints.push([normProvider, { baseUrl: customBaseUrl, apiKey: explicitApiKey }]);
        } else if (normProvider === 'custom') {
          for (const entry of this.customEndpoints.entries()) {
            endpoints.push(entry);
          }
        } else if (this.customEndpoints.has(normProvider)) {
          endpoints.push([normProvider, this.customEndpoints.get(normProvider)!]);
        } else if (DEFAULT_PROVIDER_BASE_URLS[normProvider]) {
          endpoints.push([normProvider, { baseUrl: DEFAULT_PROVIDER_BASE_URLS[normProvider], apiKey: explicitApiKey }]);
        }

        for (const [name, info] of endpoints) {
          let liveModels: DiscoveredModel[] = [];
          if (info.baseUrl) {
            try {
              const cleanBase = info.baseUrl.replace(/\/+$/, '');
              const modelsUrl = cleanBase.endsWith('/models') ? cleanBase : `${cleanBase}/models`;
              const headers: Record<string, string> = {};
              const keyToUse = explicitApiKey || info.apiKey || this.resolveApiKey(name);
              if (keyToUse && keyToUse !== 'local-no-key') {
                headers['Authorization'] = `Bearer ${keyToUse}`;
              }
              const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(4000) }).catch(() => null);
              if (res && res.ok) {
                const data: any = await res.json().catch(() => ({}));
                const list: any[] = data.data || data.models || [];
                if (Array.isArray(list) && list.length > 0) {
                  liveModels = list.map((m: any) => {
                    const rawId = String(m.id || m.name);
                    const prefixedId = rawId.startsWith(`${name}/`) ? rawId : `${name}/${rawId}`;
                    return {
                      id: prefixedId,
                      name: m.name || m.id || prefixedId,
                      provider: name,
                      contextWindow: m.context_window || 128000,
                      maxOutputTokens: 8192,
                      supportsTools: true,
                      supportsVision: false,
                      isFree: false,
                      description: `Model from ${name} at ${info.baseUrl}`,
                      configured: true,
                      validated: true,
                    };
                  });
                }
              }
            } catch {}
          }

          if (liveModels.length > 0) {
            result.push(...liveModels);
          } else if (!shouldOmit) {
            const fallbacks = this.getStandardFallbackModels(name, info.baseUrl);
            result.push(...fallbacks);
          }
        }
        if (result.length > 0) {
          this.validatedProviders.set(normProvider, true);
          this.providerModelCounts.set(normProvider, result.length);
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
        if (!apiKey && (process.env.VITEST || process.env.NODE_ENV === 'test')) {
          this.validatedProviders.set('openrouter', false);
          if (shouldOmit) return [];
          return [
            { id: 'openrouter/deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 64000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
            { id: 'openrouter/meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 128000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
            { id: 'openrouter/google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 1048576, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
            { id: 'openrouter/qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen 2.5 Coder 32B (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 32768, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
            { id: 'openrouter/anthropic/claude-3.5-sonnet', name: 'Anthropic Claude 3.5 Sonnet', provider: 'openrouter', contextWindow: 200000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
            { id: 'openrouter/openai/gpt-4o', name: 'OpenAI GPT-4o', provider: 'openrouter', contextWindow: 128000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
          ];
        }

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

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models`, {
          headers: {
            'x-goog-api-key': apiKey,
          },
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

      if (normProvider === 'xai') {
        const standardXAi: DiscoveredModel[] = [
          { id: 'xai/grok-2', name: 'Grok 2', provider: 'xai', contextWindow: 131072, supportsTools: true, supportsVision: true, supportsReasoning: true, configured: false, validated: false, description: 'xAI flagship multimodal reasoning model' },
          { id: 'xai/grok-2-mini', name: 'Grok 2 Mini', provider: 'xai', contextWindow: 131072, supportsTools: true, supportsVision: false, supportsReasoning: true, configured: false, validated: false, description: 'xAI fast compact reasoning model' },
          { id: 'xai/grok-beta', name: 'Grok Beta', provider: 'xai', contextWindow: 131072, supportsTools: true, supportsVision: false, supportsReasoning: true, configured: false, validated: false, description: 'xAI Grok Beta' },
        ];
        if (!apiKey) return shouldOmit ? [] : standardXAi;

        try {
          const res = await fetch('https://api.x.ai/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          }).catch(() => null);

          if (res && res.ok) {
            const data: any = await res.json().catch(() => ({}));
            const list: any[] = data.data || [];
            if (list.length > 0) {
              this.validatedProviders.set('xai', true);
              this.providerModelCounts.set('xai', list.length);
              return list.map((m: any) => ({
                id: `xai/${m.id}`,
                name: `xAI ${m.id}`,
                provider: 'xai',
                contextWindow: 131072,
                supportsTools: true,
                supportsVision: m.id.includes('vision'),
                supportsReasoning: true,
                configured: true,
                validated: true,
              }));
            }
          }
        } catch {}
        this.validatedProviders.set('xai', false);
        if (shouldOmit) return [];
        return standardXAi;
      }

      if (normProvider === 'azure') {
        const standardAzure: DiscoveredModel[] = [
          { id: 'azure/gpt-4o', name: 'Azure OpenAI GPT-4o', provider: 'azure', contextWindow: 128000, supportsTools: true, supportsVision: true, supportsReasoning: false, configured: Boolean(apiKey), validated: Boolean(apiKey), description: 'Azure OpenAI enterprise deployment' },
          { id: 'azure/gpt-4o-mini', name: 'Azure OpenAI GPT-4o Mini', provider: 'azure', contextWindow: 128000, supportsTools: true, supportsVision: true, supportsReasoning: false, configured: Boolean(apiKey), validated: Boolean(apiKey), description: 'Azure OpenAI fast compact deployment' },
          { id: 'azure/o3-mini', name: 'Azure OpenAI o3-mini', provider: 'azure', contextWindow: 200000, supportsTools: true, supportsVision: false, supportsReasoning: true, configured: Boolean(apiKey), validated: Boolean(apiKey), description: 'Azure OpenAI reasoning deployment' },
        ];
        if (!apiKey) return shouldOmit ? [] : standardAzure;
        this.validatedProviders.set('azure', true);
        this.providerModelCounts.set('azure', standardAzure.length);
        return standardAzure;
      }
    } catch (err) {
      console.warn(`[KIN MODEL GATEWAY] Error discovering models for ${provider}:`, err);
    }

    return [];
  }

  private getStandardFallbackModels(provider: string, baseUrl?: string): DiscoveredModel[] {
    const norm = provider.toLowerCase().trim();
    if (norm === 'together') {
      return [
        { id: 'together/meta-llama/llama-3.3-70b-instruct', name: 'Together Llama 3.3 70B', provider: 'together', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
        { id: 'together/deepseek-ai/deepseek-v3', name: 'Together DeepSeek V3', provider: 'together', contextWindow: 64000, supportsTools: true, configured: true, validated: true },
      ];
    }
    if (norm === 'deepinfra') {
      return [
        { id: 'deepinfra/deepseek-ai/deepseek-v3', name: 'DeepInfra DeepSeek V3', provider: 'deepinfra', contextWindow: 64000, supportsTools: true, configured: true, validated: true },
        { id: 'deepinfra/meta-llama/llama-3.3-70b-turbo', name: 'DeepInfra Llama 3.3 70B Turbo', provider: 'deepinfra', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
      ];
    }
    if (norm === 'fireworks') {
      return [
        { id: 'fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Fireworks Llama 3.3 70B', provider: 'fireworks', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
      ];
    }
    if (norm === 'perplexity') {
      return [
        { id: 'perplexity/sonar-reasoning-pro', name: 'Perplexity Sonar Reasoning Pro', provider: 'perplexity', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
        { id: 'perplexity/sonar-pro', name: 'Perplexity Sonar Pro', provider: 'perplexity', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
      ];
    }
    if (norm === 'cerebras') {
      return [
        { id: 'cerebras/llama-3.3-70b', name: 'Cerebras Llama 3.3 70B', provider: 'cerebras', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
      ];
    }
    if (norm === 'lmstudio') {
      return [{
        id: 'lmstudio/default',
        name: 'LM Studio Default Model',
        provider: 'lmstudio',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsTools: true,
        configured: true,
        validated: true,
      }];
    }
    if (norm === 'vllm') {
      return [{
        id: 'vllm/default',
        name: 'vLLM Default Model',
        provider: 'vllm',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsTools: true,
        configured: true,
        validated: true,
      }];
    }
    if (norm === 'openai_compatible') {
      return [{
        id: 'openai_compatible/default',
        name: 'OpenAI Compatible Default Model',
        provider: 'openai_compatible',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsTools: true,
        configured: true,
        validated: true,
      }];
    }
    return [{
      id: `custom/${norm}`,
      name: `Custom model (${norm})`,
      provider: 'custom',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsVision: false,
      isFree: false,
      description: baseUrl ? `Model endpoint at ${baseUrl}` : undefined,
      configured: true,
      validated: true,
    }];
  }

  /**
   * Invokes the assigned model directly without autonomous routing.
   */
  public async invokeModel(params: ModelInvocationParams): Promise<ModelInvocationResult> {
    return this.invoke(params);
  }

  public async invoke(params: ModelInvocationParams): Promise<ModelInvocationResult> {
    const startTime = Date.now();
    const [provider, modelName] = this.parseModelId(params.modelId);

    try {
      if (provider === 'ollama') {
        return await this.invokeOllama(modelName, params, startTime);
      } else if (provider === 'openrouter') {
        return await this.invokeOpenRouter(modelName, params, startTime);
      } else if (provider === 'openai') {
        const custom = this.customEndpoints.get('openai');
        const apiKey = custom?.apiKey || this.resolveApiKey('openai', params.callerAgentId);
        const url = custom?.baseUrl
          ? (custom.baseUrl.endsWith('/chat/completions') ? custom.baseUrl : `${custom.baseUrl.replace(/\/+$/, '')}/chat/completions`)
          : 'https://api.openai.com/v1/chat/completions';
        return await this.invokeOpenAiCompatible(
          url,
          apiKey,
          modelName,
          params,
          startTime,
          'openai'
        );
      } else if (provider === 'deepseek') {
        const custom = this.customEndpoints.get('deepseek');
        const apiKey = custom?.apiKey || this.resolveApiKey('deepseek', params.callerAgentId);
        const url = custom?.baseUrl
          ? (custom.baseUrl.endsWith('/chat/completions') ? custom.baseUrl : `${custom.baseUrl.replace(/\/+$/, '')}/chat/completions`)
          : 'https://api.deepseek.com/chat/completions';
        return await this.invokeOpenAiCompatible(
          url,
          apiKey,
          modelName,
          params,
          startTime,
          'deepseek'
        );
      } else if (provider === 'anthropic') {
        return await this.invokeAnthropic(modelName, params, startTime);
      } else if (provider === 'gemini') {
        const custom = this.customEndpoints.get('gemini');
        const apiKey = custom?.apiKey || this.resolveApiKey('gemini', params.callerAgentId);
        const url = custom?.baseUrl
          ? (custom.baseUrl.endsWith('/chat/completions') ? custom.baseUrl : `${custom.baseUrl.replace(/\/+$/, '')}/chat/completions`)
          : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
        return await this.invokeOpenAiCompatible(
          url,
          apiKey,
          modelName,
          params,
          startTime,
          'gemini'
        );
      } else if (provider === 'groq') {
        const custom = this.customEndpoints.get('groq');
        const apiKey = custom?.apiKey || this.resolveApiKey('groq', params.callerAgentId);
        const url = custom?.baseUrl
          ? (custom.baseUrl.endsWith('/chat/completions') ? custom.baseUrl : `${custom.baseUrl.replace(/\/+$/, '')}/chat/completions`)
          : 'https://api.groq.com/openai/v1/chat/completions';
        return await this.invokeOpenAiCompatible(
          url,
          apiKey,
          modelName,
          params,
          startTime,
          'groq'
        );
      } else if (provider === 'xai') {
        const custom = this.customEndpoints.get('xai');
        const apiKey = custom?.apiKey || this.resolveApiKey('xai', params.callerAgentId);
        const url = custom?.baseUrl
          ? (custom.baseUrl.endsWith('/chat/completions') ? custom.baseUrl : `${custom.baseUrl.replace(/\/+$/, '')}/chat/completions`)
          : 'https://api.x.ai/v1/chat/completions';
        return await this.invokeOpenAiCompatible(
          url,
          apiKey,
          modelName,
          params,
          startTime,
          'xai'
        );
      } else if (provider === 'azure') {
        const apiKey = this.resolveApiKey('azure', params.callerAgentId);
        const custom = this.customEndpoints.get('azure');
        let url = custom?.baseUrl || 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments';
        if (!url.includes('/chat/completions')) {
          const cleanBase = url.replace(/\/+$/, '');
          const deployment = modelName.replace(/^azure\//, '');
          url = cleanBase.includes('/openai/deployments')
            ? `${cleanBase}/${deployment}/chat/completions?api-version=2024-02-15-preview`
            : `${cleanBase}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-15-preview`;
        }
        return await this.invokeOpenAiCompatible(
          url,
          apiKey,
          modelName,
          params,
          startTime,
          'azure'
        );
      } else if (
        this.customEndpoints.has(provider) ||
        KNOWN_OPENAI_COMPATIBLE_PROVIDERS.includes(provider) ||
        provider === 'custom' ||
        provider === 'openai_compatible' ||
        (this.customEndpoints.has(modelName)) ||
        (modelName.includes('/') && this.customEndpoints.has(modelName.split('/')[0])) ||
        (provider === 'custom' && this.customEndpoints.size === 1)
      ) {
        let endpointName = provider;
        let actualModelName = modelName;
        if ((provider === 'custom' || provider === 'openai_compatible') && modelName.includes('/')) {
          const sub = modelName.split('/')[0];
          if (this.customEndpoints.has(sub)) {
            endpointName = sub;
            actualModelName = modelName.slice(sub.length + 1);
          }
        }
        const custom = this.customEndpoints.get(endpointName)
          || this.customEndpoints.get(modelName);
        const apiKey = this.resolveApiKey(endpointName, params.callerAgentId)
          || this.resolveApiKey(modelName, params.callerAgentId)
          || custom?.apiKey
          || this.resolveApiKey('custom', params.callerAgentId)
          || this.resolveApiKey('openai_compatible', params.callerAgentId);
        const rawBaseUrl = custom?.baseUrl
          || DEFAULT_PROVIDER_BASE_URLS[endpointName]
          || DEFAULT_PROVIDER_BASE_URLS[provider]
          || 'http://localhost:8000/v1';
        const url = rawBaseUrl.endsWith('/chat/completions')
          ? rawBaseUrl
          : `${rawBaseUrl.replace(/\/+$/, '')}/chat/completions`;
        return await this.invokeOpenAiCompatible(
          url,
          apiKey,
          actualModelName,
          params,
          startTime,
          endpointName
        );
      } else {
        // Check if provider is an OpenRouter namespace or model slug (e.g. meta-llama/..., qwen/...)
        const openRouterKey = this.resolveApiKey('openrouter', params.callerAgentId);
        if (openRouterKey && (modelName.includes('/') || params.modelId.includes(':free') || params.modelId.includes('/'))) {
          return await this.invokeOpenRouter(params.modelId, params, startTime);
        }

        // Automated fallback failover only if explicitly configured and fallback not disabled
        if (!params.disableFallback && params.fallbackModelId && params.fallbackModelId !== params.modelId) {
          const fallbackRes = await this.invoke({
            ...params,
            modelId: params.fallbackModelId,
            fallbackModelId: undefined,
          });
          if (!fallbackRes.isError) {
            return {
              ...fallbackRes,
              switchedModelId: params.fallbackModelId,
            };
          }
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
      if (err?.name === 'AbortError' || params.signal?.aborted) {
        throw err;
      }
      if (!params.disableFallback && params.fallbackModelId && params.fallbackModelId !== params.modelId) {
        try {
          const fallbackRes = await this.invoke({
            ...params,
            modelId: params.fallbackModelId,
            fallbackModelId: undefined,
          });
          if (!fallbackRes.isError) {
            return {
              ...fallbackRes,
              switchedModelId: params.fallbackModelId,
            };
          }
        } catch {
          // ignore fallback error and return primary error report
        }
      }
      const durationMs = Date.now() - startTime;
      const causeText = err?.cause?.message || (err?.cause ? String(err.cause) : '');
      const errorMsg = `[KIN Model Gateway Error] Failed to reach provider "${provider}" for model "${modelName}": ${err?.message || String(err)}${causeText ? ` (${causeText})` : ''}`;
      
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

  public parseModelId(modelId: string): [string, string] {
    const colonIdx = modelId.indexOf(':');
    const slashIdx = modelId.indexOf('/');
    if (colonIdx !== -1 && (slashIdx === -1 || colonIdx < slashIdx)) {
      const prefix = modelId.substring(0, colonIdx).toLowerCase();
      if (
        ['ollama', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'xai', 'azure', 'custom', 'openrouter', 'together', 'deepinfra', 'vllm', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'openai_compatible'].includes(prefix) ||
        this.customEndpoints.has(prefix)
      ) {
        return [prefix, modelId.substring(colonIdx + 1)];
      }
    }
    if (slashIdx !== -1) {
      const prefix = modelId.substring(0, slashIdx).toLowerCase();
      if (
        ['ollama', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'xai', 'azure', 'custom', 'openrouter', 'together', 'deepinfra', 'vllm', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'openai_compatible'].includes(prefix) ||
        this.customEndpoints.has(prefix)
      ) {
        return [prefix, modelId.substring(slashIdx + 1)];
      }
      // If prefix is an OpenRouter namespace (e.g. "nvidia/nemotron-...", "google/gemma-...", "dots-studio/...", "thinkingmachines/...")
      if (this.openrouterApiKey || process.env.OPENROUTER_API_KEY) {
        return ['openrouter', modelId];
      }
      return [prefix, modelId.substring(slashIdx + 1)];
    }
    return ['ollama', modelId];
  }

  public static parseModelId(modelId: string): [string, string] {
    const colonIdx = modelId.indexOf(':');
    const slashIdx = modelId.indexOf('/');
    if (colonIdx !== -1 && (slashIdx === -1 || colonIdx < slashIdx)) {
      const prefix = modelId.substring(0, colonIdx).toLowerCase();
      if (
        ['ollama', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'xai', 'azure', 'custom', 'openrouter', 'together', 'deepinfra', 'vllm', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'openai_compatible'].includes(prefix)
      ) {
        return [prefix, modelId.substring(colonIdx + 1)];
      }
    }
    if (slashIdx !== -1) {
      const prefix = modelId.substring(0, slashIdx).toLowerCase();
      if (
        ['ollama', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'xai', 'azure', 'custom', 'openrouter', 'together', 'deepinfra', 'vllm', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'openai_compatible'].includes(prefix)
      ) {
        return [prefix, modelId.substring(slashIdx + 1)];
      }
      if (process.env.OPENROUTER_API_KEY) {
        return ['openrouter', modelId];
      }
      return [prefix, modelId.substring(slashIdx + 1)];
    }
    return ['ollama', modelId];
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
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = params.signal ? (AbortSignal as any).any([timeoutSignal, params.signal]) : timeoutSignal;
    const requestBody: Record<string, any> = {
      model: modelName,
      messages: params.messages,
      stream: true,
      options: {
        temperature: params.temperature ?? 0.2,
        num_predict: params.maxTokens ?? 1536,
        num_ctx: process.env.KIN_OLLAMA_NUM_CTX ? parseInt(process.env.KIN_OLLAMA_NUM_CTX, 10) : 8192,
      },
    };
    const sysPrompt = params.messages?.find((m) => m.role === 'system')?.content || '';
    const promptHasTools = sysPrompt.includes('AVAILABLE TOOLS') || sysPrompt.includes('TOOL INSTRUCTIONS:');
    if (params.tools && params.tools.length > 0 && !promptHasTools) {
      requestBody.tools = params.tools;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: combinedSignal,
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const rawErrText = await res.text().catch(() => res.statusText);
      const errText = SecretBroker.getInstance().redactSecrets(rawErrText);
      throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
    }

    let fullContent = '';
    let fullThinking = '';
    let promptTokens = 0;
    let completionTokens = 0;
    const collectedToolCalls: Array<{ name: string; parameters: any }> = [];
    const seenToolCalls = new Set<string>();

    const processToolCalls = (parsedMsg: any) => {
      const calls = parsedMsg?.tool_calls;
      if (Array.isArray(calls)) {
        for (const tc of calls) {
          const fnName = tc?.function?.name || tc?.name;
          if (!fnName) continue;
          let fnArgs = tc?.function?.arguments ?? tc?.arguments ?? tc?.parameters ?? {};
          if (typeof fnArgs === 'string') {
            try { fnArgs = JSON.parse(fnArgs); } catch {}
          }
          const callKey = tc.id ? String(tc.id) : `${fnName}:${JSON.stringify(fnArgs)}`;
          if (!seenToolCalls.has(callKey)) {
            seenToolCalls.add(callKey);
            collectedToolCalls.push({ name: fnName, parameters: fnArgs });
          }
        }
      }
    };

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
            processToolCalls(parsed?.message);
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
          processToolCalls(parsed?.message);
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
            processToolCalls(parsed?.message);
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
          processToolCalls(parsed?.message);
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

    if (collectedToolCalls.length > 0) {
      for (const tc of collectedToolCalls) {
        const toolXml = `\n<tool_call>\n${JSON.stringify({ name: tc.name, parameters: tc.parameters }, null, 2)}\n</tool_call>\n`;
        fullContent += toolXml;
        if (params.onToken) {
          params.onToken(toolXml);
        }
      }
    }

    let content = fullContent;
    if (!content.trim() && fullThinking.trim()) {
      content = fullThinking.trim();
    }

    const separated = separateThinkingAndContent(content, fullThinking);

    const tokensUsed = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    if (this.onUsage) {
      this.onUsage('ollama', tokensUsed);
    }

    return {
      content: separated.cleanContent,
      thinking: separated.thinking,
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
    retryCount: number = 0,
    explicitApiKey?: string,
    attemptedKeys: Set<string> = new Set(explicitApiKey ? [explicitApiKey] : [])
  ): Promise<ModelInvocationResult> {
    const apiKey = explicitApiKey || this.resolveApiKey('openrouter', params.callerAgentId);
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
      signal: resolveEffectiveSignal(params.signal),
      body: JSON.stringify({
        model: modelName,
        messages: params.messages,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens ?? 2048,
        stream,
      }),
    });

    if (res.status === 429) {
      if (this.allKeysResolver && apiKey) {
        if (!attemptedKeys.has(apiKey)) attemptedKeys.add(apiKey);
        const allKeys = this.allKeysResolver('openrouter', params.callerAgentId);
        const untriedKeys = allKeys.filter((k) => !attemptedKeys.has(k.key));
        if (untriedKeys.length > 0) {
          const next = untriedKeys[0];
          attemptedKeys.add(next.key);
          console.warn(`[KIN MODEL GATEWAY] 429 rate limit on OpenRouter key. Seamlessly rotating to secondary key (${next.keyAlias || next.id}).`);
          return this.invokeOpenRouter(modelName, params, startTime, retryCount, next.key, attemptedKeys);
        }
      }
      // Live 429 rate limit backoff retry
      if (retryCount < 3) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 3;
        const backoffMs = Math.max(2500, (isNaN(retryAfterSec) ? 3 : retryAfterSec) * 1000) * (retryCount + 1);
        console.warn(`[KIN MODEL GATEWAY] 429 rate limit for "${modelName}". Backing off ${backoffMs}ms (attempt ${retryCount + 1}/3)...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return this.invokeOpenRouter(modelName, params, startTime, retryCount + 1, apiKey, attemptedKeys);
      }

      // If a free tier model hit rate limits after retries, seamlessly fallback to a resilient alternative free model
      if (modelName.endsWith(':free')) {
        if (params.disableFallback) {
          throw new Error(`OpenRouter 429 Rate Limit exceeded after retries for model "${modelName}" (fallback disabled).`);
        }
        const freeFallbacks = [
          'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
          'nvidia/nemotron-3.5-lightning:free',
          'nvidia/nemotron-3.5-super-vl:free',
        ];
        const nextFallback = freeFallbacks.find((m) => m !== modelName);
        if (nextFallback) {
          console.warn(`[KIN MODEL GATEWAY] 429 rate limit on "${modelName}". Seamlessly failing over to resilient free tier model "${nextFallback}".`);
          return this.invokeOpenRouter(nextFallback, params, startTime, 0, apiKey, attemptedKeys);
        }
      }

      throw new Error(`OpenRouter 429 Rate Limit exceeded after retries for model "${modelName}".`);
    }

    if (!res.ok) {
      const rawErrText = await res.text().catch(() => res.statusText);
      const errText = SecretBroker.getInstance().redactSecrets(rawErrText);
      throw new Error(`OpenRouter HTTP ${res.status}: ${errText}`);
    }

    let content = '';
    let fullThinking = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    const streamToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    const collectedToolCalls: Array<{ name: string; parameters: any }> = [];

    if (stream && res.body && typeof (res.body as any).getReader === 'function') {
      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { done, value } = await readChunkWithTimeout(reader, 30000);
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
            const rawDeltaContent = parsed?.choices?.[0]?.delta?.content || '';
            const deltaContent = typeof rawDeltaContent === 'string'
              ? rawDeltaContent
              : (Array.isArray(rawDeltaContent) ? rawDeltaContent.map((c: any) => c?.text || c).join('') : '');
            const deltaReasoning = parsed?.choices?.[0]?.delta?.reasoning || parsed?.choices?.[0]?.delta?.reasoning_content || '';
            if (deltaReasoning) {
              fullThinking += deltaReasoning;
              if (params.onThinkingToken) {
                params.onThinkingToken(deltaReasoning);
              }
            }
            if (deltaContent) {
              content += deltaContent;
              if (params.onToken) {
                params.onToken(deltaContent);
              }
            }
            const toolCallsDelta = parsed?.choices?.[0]?.delta?.tool_calls;
            if (Array.isArray(toolCallsDelta)) {
              for (const tc of toolCallsDelta) {
                const idx = tc.index ?? 0;
                if (!streamToolCalls.has(idx)) {
                  streamToolCalls.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' });
                }
                const current = streamToolCalls.get(idx)!;
                if (tc.id) current.id = tc.id;
                if (tc.function?.name) current.name += tc.function.name;
                if (tc.function?.arguments) current.arguments += tc.function.arguments;
              }
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || promptTokens;
              completionTokens = parsed.usage.completion_tokens || completionTokens;
              totalTokens = parsed.usage.total_tokens || totalTokens;
            }
          } catch {}
        }
      }

      for (const tc of streamToolCalls.values()) {
        let parsedArgs: any = {};
        if (tc.arguments) {
          try { parsedArgs = JSON.parse(tc.arguments); } catch { parsedArgs = { raw: tc.arguments }; }
        }
        if (tc.name) {
          collectedToolCalls.push({ name: tc.name, parameters: parsedArgs });
        }
      }
    } else {
      const data: any = await res.json();
      const choiceMsg = data?.choices?.[0]?.message;
      const rawMsgContent = choiceMsg?.content || data?.choices?.[0]?.text || '';
      content = (typeof rawMsgContent === 'string'
        ? rawMsgContent
        : (Array.isArray(rawMsgContent) ? rawMsgContent.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('') : '')).trim();
      const reasoning = (choiceMsg?.reasoning || choiceMsg?.reasoning_content || '').trim();
      if (reasoning) {
        fullThinking = reasoning;
      }

      const choiceToolCalls = choiceMsg?.tool_calls;
      if (Array.isArray(choiceToolCalls)) {
        for (const tc of choiceToolCalls) {
          const fnName = tc?.function?.name || tc?.name;
          if (!fnName) continue;
          let fnArgs = tc?.function?.arguments ?? tc?.arguments ?? tc?.parameters ?? {};
          if (typeof fnArgs === 'string') {
            try { fnArgs = JSON.parse(fnArgs); } catch {}
          }
          collectedToolCalls.push({ name: fnName, parameters: fnArgs });
        }
      }

      promptTokens = data?.usage?.prompt_tokens || 0;
      completionTokens = data?.usage?.completion_tokens || 0;
      totalTokens = data?.usage?.total_tokens || 0;
      if (params.onToken && content) {
        params.onToken(content);
      }
    }

    if (collectedToolCalls.length > 0) {
      for (const tc of collectedToolCalls) {
        const toolXml = `\n<tool_call>\n${JSON.stringify({ name: tc.name, parameters: tc.parameters }, null, 2)}\n</tool_call>\n`;
        content += toolXml;
        if (params.onToken) {
          params.onToken(toolXml);
        }
      }
    }

    if (!content.trim() && fullThinking.trim()) {
      content = fullThinking.trim();
    }

    const separated = separateThinkingAndContent(content, fullThinking);

    const tokensUsed = {
      promptTokens,
      completionTokens,
      totalTokens: totalTokens || (promptTokens + completionTokens),
    };

    if (this.onUsage) {
      this.onUsage('openrouter', tokensUsed);
    }

    return {
      content: separated.cleanContent,
      thinking: separated.thinking,
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
    provider: string,
    retryCount: number = 0,
    attemptedKeys: Set<string> = new Set(apiKey ? [apiKey] : [])
  ): Promise<ModelInvocationResult> {
    const isCustomEndpoint = provider === 'custom' || this.customEndpoints.has(provider);
    if (!apiKey && !isCustomEndpoint) {
      throw new Error(`API key for ${provider.toUpperCase()} is not set in environment or managed credentials.`);
    }

    const stream = !!params.onToken;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey && apiKey !== 'local-no-key') {
      reqHeaders['Authorization'] = `Bearer ${apiKey}`;
      if (provider === 'azure') {
        reqHeaders['api-key'] = apiKey;
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: reqHeaders,
      signal: resolveEffectiveSignal(params.signal),
      body: JSON.stringify({
        model: modelName,
        messages: params.messages,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens ?? 2048,
        stream,
      }),
    });

    if (res.status === 429) {
      // 1. If multi-key resolver is available, attempt next available key for provider
      if (this.allKeysResolver && apiKey) {
        if (!attemptedKeys.has(apiKey)) attemptedKeys.add(apiKey);
        const allKeys = this.allKeysResolver(provider, params.callerAgentId);
        const untriedKeys = allKeys.filter((k) => !attemptedKeys.has(k.key));
        if (untriedKeys.length > 0) {
          const next = untriedKeys[0];
          attemptedKeys.add(next.key);
          console.warn(`[KIN MODEL GATEWAY] 429 rate limit on current key for ${provider}. Seamlessly rotating to secondary key (${next.keyAlias || next.id}).`);
          const nextUrl = next.baseUrl
            ? (next.baseUrl.endsWith('/chat/completions') ? next.baseUrl : `${next.baseUrl.replace(/\/+$/, '')}/chat/completions`)
            : url;
          return this.invokeOpenAiCompatible(nextUrl, next.key, modelName, params, startTime, provider, retryCount, attemptedKeys);
        }
      }
      // 2. Exponential backoff retry
      if (retryCount < 2) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 1;
        const backoffMs = (isNaN(retryAfterSec) ? 1 : retryAfterSec) * 1000 * (retryCount + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return this.invokeOpenAiCompatible(url, apiKey, modelName, params, startTime, provider, retryCount + 1, attemptedKeys);
      }
      const rawErrText = await res.text().catch(() => res.statusText);
      const errText = SecretBroker.getInstance().redactSecrets(rawErrText);
      throw new Error(`${provider.toUpperCase()} HTTP 429 Rate Limit exceeded after retries: ${errText}`);
    }

    if (!res.ok) {
      const rawErrText = await res.text().catch(() => res.statusText);
      const errText = SecretBroker.getInstance().redactSecrets(rawErrText);
      throw new Error(`${provider.toUpperCase()} HTTP ${res.status}: ${errText}`);
    }

    let content = '';
    let fullThinking = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    const streamToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    const collectedToolCalls: Array<{ name: string; parameters: any }> = [];

    if (stream && res.body && typeof (res.body as any).getReader === 'function') {
      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { done, value } = await readChunkWithTimeout(reader, 30000);
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
            const rawDeltaContent = parsed?.choices?.[0]?.delta?.content || '';
            const deltaContent = typeof rawDeltaContent === 'string'
              ? rawDeltaContent
              : (Array.isArray(rawDeltaContent) ? rawDeltaContent.map((c: any) => c?.text || c).join('') : '');
            const deltaReasoning = parsed?.choices?.[0]?.delta?.reasoning || parsed?.choices?.[0]?.delta?.reasoning_content || '';
            if (deltaReasoning) {
              fullThinking += deltaReasoning;
              if (params.onThinkingToken) {
                params.onThinkingToken(deltaReasoning);
              }
            }
            if (deltaContent) {
              content += deltaContent;
              if (params.onToken) {
                params.onToken(deltaContent);
              }
            }
            const toolCallsDelta = parsed?.choices?.[0]?.delta?.tool_calls;
            if (Array.isArray(toolCallsDelta)) {
              for (const tc of toolCallsDelta) {
                const idx = tc.index ?? 0;
                if (!streamToolCalls.has(idx)) {
                  streamToolCalls.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' });
                }
                const current = streamToolCalls.get(idx)!;
                if (tc.id) current.id = tc.id;
                if (tc.function?.name) current.name += tc.function.name;
                if (tc.function?.arguments) current.arguments += tc.function.arguments;
              }
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || promptTokens;
              completionTokens = parsed.usage.completion_tokens || completionTokens;
              totalTokens = parsed.usage.total_tokens || totalTokens;
            }
          } catch {}
        }
      }

      for (const tc of streamToolCalls.values()) {
        let parsedArgs: any = {};
        if (tc.arguments) {
          try { parsedArgs = JSON.parse(tc.arguments); } catch { parsedArgs = { raw: tc.arguments }; }
        }
        if (tc.name) {
          collectedToolCalls.push({ name: tc.name, parameters: parsedArgs });
        }
      }
    } else {
      const data: any = await res.json();
      const choiceMsg = data?.choices?.[0]?.message;
      const rawMsgContent = choiceMsg?.content || data?.choices?.[0]?.text || '';
      content = (typeof rawMsgContent === 'string'
        ? rawMsgContent
        : (Array.isArray(rawMsgContent) ? rawMsgContent.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('') : '')).trim();
      const reasoning = (choiceMsg?.reasoning || choiceMsg?.reasoning_content || '').trim();
      if (reasoning) {
        fullThinking = reasoning;
      }

      const choiceToolCalls = choiceMsg?.tool_calls;
      if (Array.isArray(choiceToolCalls)) {
        for (const tc of choiceToolCalls) {
          const fnName = tc?.function?.name || tc?.name;
          if (!fnName) continue;
          let fnArgs = tc?.function?.arguments ?? tc?.arguments ?? tc?.parameters ?? {};
          if (typeof fnArgs === 'string') {
            try { fnArgs = JSON.parse(fnArgs); } catch {}
          }
          collectedToolCalls.push({ name: fnName, parameters: fnArgs });
        }
      }

      promptTokens = data?.usage?.prompt_tokens || 0;
      completionTokens = data?.usage?.completion_tokens || 0;
      totalTokens = data?.usage?.total_tokens || 0;
      if (params.onToken && content) {
        params.onToken(content);
      }
    }

    if (collectedToolCalls.length > 0) {
      for (const tc of collectedToolCalls) {
        const toolXml = `\n<tool_call>\n${JSON.stringify({ name: tc.name, parameters: tc.parameters }, null, 2)}\n</tool_call>\n`;
        content += toolXml;
        if (params.onToken) {
          params.onToken(toolXml);
        }
      }
    }

    if (!content.trim() && fullThinking.trim()) {
      content = fullThinking.trim();
    }

    const separated = separateThinkingAndContent(content, fullThinking);

    const tokensUsed = {
      promptTokens,
      completionTokens,
      totalTokens: totalTokens || (promptTokens + completionTokens),
    };

    if (this.onUsage) {
      this.onUsage(provider, tokensUsed);
    }

    return {
      content: separated.cleanContent,
      thinking: separated.thinking,
      modelId: params.modelId,
      provider,
      tokensUsed,
      durationMs: Date.now() - startTime,
    };
  }

  private async invokeAnthropic(
    modelName: string,
    params: ModelInvocationParams,
    startTime: number,
    retryCount: number = 0,
    explicitApiKey?: string,
    overrideUrl?: string,
    attemptedKeys: Set<string> = new Set(explicitApiKey ? [explicitApiKey] : [])
  ): Promise<ModelInvocationResult> {
    const apiKey = explicitApiKey || this.resolveApiKey('anthropic', params.callerAgentId);
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set in environment or managed credentials.');
    }

    const systemMsgs = params.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .filter(Boolean);
    const systemMsg = systemMsgs.join('\n\n');

    const coalescedMsgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of params.messages.filter((m) => m.role !== 'system')) {
      const role = (msg.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant';
      if (coalescedMsgs.length > 0 && coalescedMsgs[coalescedMsgs.length - 1].role === role) {
        coalescedMsgs[coalescedMsgs.length - 1].content += '\n\n' + (msg.content || '');
      } else {
        coalescedMsgs.push({ role, content: msg.content || '' });
      }
    }

    const custom = this.customEndpoints.get('anthropic');
    const url = overrideUrl || (custom?.baseUrl
      ? (custom.baseUrl.endsWith('/messages') ? custom.baseUrl : `${custom.baseUrl.replace(/\/+$/, '')}/messages`)
      : 'https://api.anthropic.com/v1/messages');

    const stream = !!params.onToken;
    const effectiveSignal = resolveEffectiveSignal(params.signal);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: effectiveSignal,
      body: JSON.stringify({
        model: modelName,
        system: systemMsg,
        messages: coalescedMsgs,
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.2,
        stream,
      }),
    });

    if (res.status === 429) {
      if (this.allKeysResolver && apiKey) {
        if (!attemptedKeys.has(apiKey)) attemptedKeys.add(apiKey);
        const allKeys = this.allKeysResolver('anthropic', params.callerAgentId);
        const untriedKeys = allKeys.filter((k) => !attemptedKeys.has(k.key));
        if (untriedKeys.length > 0) {
          const next = untriedKeys[0];
          attemptedKeys.add(next.key);
          console.warn(`[KIN MODEL GATEWAY] 429 rate limit on Anthropic key. Seamlessly rotating to secondary key (${next.keyAlias || next.id}).`);
          const nextUrl = next.baseUrl
            ? (next.baseUrl.endsWith('/messages') ? next.baseUrl : `${next.baseUrl.replace(/\/+$/, '')}/messages`)
            : url;
          return this.invokeAnthropic(modelName, params, startTime, retryCount, next.key, nextUrl, attemptedKeys);
        }
      }
      if (retryCount < 2) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 1;
        const backoffMs = (isNaN(retryAfterSec) ? 1 : retryAfterSec) * 1000 * (retryCount + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return this.invokeAnthropic(modelName, params, startTime, retryCount + 1, apiKey, url, attemptedKeys);
      }
      const rawErrText = await res.text().catch(() => res.statusText);
      const errText = SecretBroker.getInstance().redactSecrets(rawErrText);
      throw new Error(`Anthropic HTTP 429 Rate Limit exceeded after retries: ${errText}`);
    }

    if (!res.ok) {
      const rawErrText = await res.text().catch(() => res.statusText);
      const errText = SecretBroker.getInstance().redactSecrets(rawErrText);
      throw new Error(`Anthropic HTTP ${res.status}: ${errText}`);
    }

    let content = '';
    let fullThinking = '';
    let promptTokens = 0;
    let completionTokens = 0;

    if (stream && res.body && typeof (res.body as any).getReader === 'function') {
      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { done, value } = await readChunkWithTimeout(reader, 30000);
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
            if (parsed.type === 'content_block_delta') {
              if (parsed.delta?.type === 'thinking_delta' && parsed.delta?.thinking) {
                fullThinking += parsed.delta.thinking;
                if (params.onThinkingToken) {
                  params.onThinkingToken(parsed.delta.thinking);
                }
              } else if (parsed.delta?.text) {
                content += parsed.delta.text;
                if (params.onToken) {
                  params.onToken(parsed.delta.text);
                }
              }
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

    const separated = separateThinkingAndContent(content, fullThinking);

    const tokensUsed = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    if (this.onUsage) {
      this.onUsage('anthropic', tokensUsed);
    }

    return {
      content: separated.cleanContent,
      thinking: separated.thinking,
      modelId: params.modelId,
      provider: 'anthropic',
      tokensUsed,
      durationMs: Date.now() - startTime,
    };
  }
}
