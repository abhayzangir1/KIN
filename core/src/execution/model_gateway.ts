// ============================================================================
// KIN MODEL GATEWAY
// Provider-neutral LLM invocation with streaming, error normalization,
// and zero autonomous model routing (strictly adheres to user-assigned model).
// ============================================================================

import { SecretVault } from '../security/secret_vault.js';
import { SecretBroker } from '../security/secret_broker.js';
import { ModelDiscoveryService, type DiscoveredModel, type ProviderReadiness } from './model_discovery.js';
import { QuotaGuard } from './quota_guard.js';
import { StreamingInferenceClient } from './streaming_client.js';

export { ModelDiscoveryService, QuotaGuard, StreamingInferenceClient };
export type { DiscoveredModel, ProviderReadiness };

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
      } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
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
  toolCalls?: Array<{ name: string; parameters: any }>;
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
  nvidia: 'https://integrate.api.nvidia.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  together: 'https://api.together.xyz/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  perplexity: 'https://api.perplexity.ai',
  cerebras: 'https://api.cerebras.ai/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  vllm: 'http://127.0.0.1:8000/v1',
  openai_compatible: 'http://127.0.0.1:1234/v1',
};

export const KNOWN_OPENAI_COMPATIBLE_PROVIDERS: string[] = [
  'openai',
  'deepseek',
  'gemini',
  'groq',
  'xai',
  'nvidia',
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

export const FALLBACK_PROVIDER_CATALOGS: Record<string, DiscoveredModel[]> = {
  openrouter: [
    { id: 'openrouter/deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 64000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'openrouter/meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 128000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'openrouter/google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 1048576, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'openrouter/qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen 2.5 Coder 32B (Free Tier)', provider: 'openrouter', isFree: true, contextWindow: 32768, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'openrouter/anthropic/claude-3.5-sonnet', name: 'Anthropic Claude 3.5 Sonnet', provider: 'openrouter', contextWindow: 200000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'openrouter/openai/gpt-4o', name: 'OpenAI GPT-4o', provider: 'openrouter', contextWindow: 128000, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
  ],
  openai: [
    { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'openai/o1-mini', name: 'OpenAI o1-mini', provider: 'openai', contextWindow: 128000, maxOutputTokens: 65536, supportsTools: true, supportsReasoning: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'openai/o3-mini', name: 'OpenAI o3-mini', provider: 'openai', contextWindow: 200000, maxOutputTokens: 100000, supportsTools: true, supportsReasoning: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
  ],
  anthropic: [
    { id: 'anthropic/claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (v2)', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'anthropic/claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextWindow: 200000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'anthropic/claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
  ],
  gemini: [
    { id: 'gemini/gemini-2.5-pro', name: 'Google Gemini 2.5 Pro', provider: 'gemini', contextWindow: 2097152, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'gemini/gemini-2.0-flash', name: 'Google Gemini 2.0 Flash', provider: 'gemini', contextWindow: 1048576, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'gemini/gemini-1.5-pro', name: 'Google Gemini 1.5 Pro', provider: 'gemini', contextWindow: 2097152, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'gemini/gemini-1.5-flash', name: 'Google Gemini 1.5 Flash', provider: 'gemini', contextWindow: 1048576, supportsTools: true, supportsVision: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
  ],
  deepseek: [
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek-V3 (Chat)', provider: 'deepseek', contextWindow: 64000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek-R1 (Reasoner)', provider: 'deepseek', contextWindow: 64000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
  ],
  groq: [
    { id: 'groq/llama-3.3-70b-versatile', name: 'Groq Llama 3.3 70B Versatile', provider: 'groq', contextWindow: 128000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'groq/deepseek-r1-distill-llama-70b', name: 'Groq DeepSeek R1 Distill 70B', provider: 'groq', contextWindow: 128000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'groq/mixtral-8x7b-32768', name: 'Groq Mixtral 8x7B', provider: 'groq', contextWindow: 32768, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
  ],
  xai: [
    { id: 'xai/grok-2', name: 'Grok 2', provider: 'xai', contextWindow: 131072, supportsTools: true, supportsVision: true, supportsReasoning: true, configured: false, validated: false, description: 'xAI flagship multimodal reasoning model' },
    { id: 'xai/grok-2-mini', name: 'Grok 2 Mini', provider: 'xai', contextWindow: 131072, supportsTools: true, supportsVision: false, supportsReasoning: true, configured: false, validated: false, description: 'xAI fast compact reasoning model' },
    { id: 'xai/grok-beta', name: 'Grok Beta', provider: 'xai', contextWindow: 131072, supportsTools: true, supportsVision: false, supportsReasoning: true, configured: false, validated: false, description: 'xAI Grok Beta' },
  ],
  azure: [
    { id: 'azure/gpt-4o', name: 'Azure OpenAI GPT-4o', provider: 'azure', contextWindow: 128000, supportsTools: true, supportsVision: true, supportsReasoning: false, configured: false, validated: false, description: 'Azure OpenAI enterprise deployment' },
    { id: 'azure/gpt-4o-mini', name: 'Azure OpenAI GPT-4o Mini', provider: 'azure', contextWindow: 128000, supportsTools: true, supportsVision: true, supportsReasoning: false, configured: false, validated: false, description: 'Azure OpenAI fast compact deployment' },
    { id: 'azure/o3-mini', name: 'Azure OpenAI o3-mini', provider: 'azure', contextWindow: 200000, supportsTools: true, supportsVision: false, supportsReasoning: true, configured: false, validated: false, description: 'Azure OpenAI reasoning deployment' },
  ],
  ollama: [
    { id: 'ollama/qwen2.5-coder:7b', name: 'Ollama qwen2.5-coder:7b', provider: 'ollama', contextWindow: 32768, maxOutputTokens: 8192, supportsTools: true, isFree: true, configured: true, validated: false, description: 'Fallback local Ollama catalog' },
    { id: 'ollama/llama3.1:8b', name: 'Ollama llama3.1:8b', provider: 'ollama', contextWindow: 32768, maxOutputTokens: 8192, supportsTools: true, isFree: true, configured: true, validated: false, description: 'Fallback local Ollama catalog' },
    { id: 'ollama/deepseek-r1:8b', name: 'Ollama deepseek-r1:8b', provider: 'ollama', contextWindow: 32768, maxOutputTokens: 8192, supportsTools: true, supportsReasoning: true, isFree: true, configured: true, validated: false, description: 'Fallback local Ollama catalog' },
  ],
  together: [
    { id: 'together/meta-llama/llama-3.3-70b-instruct', name: 'Together Llama 3.3 70B', provider: 'together', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
    { id: 'together/deepseek-ai/deepseek-v3', name: 'Together DeepSeek V3', provider: 'together', contextWindow: 64000, supportsTools: true, configured: true, validated: true },
  ],
  deepinfra: [
    { id: 'deepinfra/deepseek-ai/deepseek-v3', name: 'DeepInfra DeepSeek V3', provider: 'deepinfra', contextWindow: 64000, supportsTools: true, configured: true, validated: true },
    { id: 'deepinfra/meta-llama/llama-3.3-70b-turbo', name: 'DeepInfra Llama 3.3 70B Turbo', provider: 'deepinfra', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
  ],
  fireworks: [
    { id: 'fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Fireworks Llama 3.3 70B', provider: 'fireworks', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
  ],
  perplexity: [
    { id: 'perplexity/sonar-reasoning-pro', name: 'Perplexity Sonar Reasoning Pro', provider: 'perplexity', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
    { id: 'perplexity/sonar-pro', name: 'Perplexity Sonar Pro', provider: 'perplexity', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
  ],
  cerebras: [
    { id: 'cerebras/llama-3.3-70b', name: 'Cerebras Llama 3.3 70B', provider: 'cerebras', contextWindow: 128000, supportsTools: true, configured: true, validated: true },
  ],
  lmstudio: [
    { id: 'lmstudio/default', name: 'LM Studio Default Model', provider: 'lmstudio', contextWindow: 128000, maxOutputTokens: 8192, supportsTools: true, configured: true, validated: true },
  ],
  vllm: [
    { id: 'vllm/default', name: 'vLLM Default Model', provider: 'vllm', contextWindow: 128000, maxOutputTokens: 8192, supportsTools: true, configured: true, validated: true },
  ],
  openai_compatible: [
    { id: 'openai_compatible/default', name: 'OpenAI Compatible Default Model', provider: 'openai_compatible', contextWindow: 128000, maxOutputTokens: 8192, supportsTools: true, configured: true, validated: true },
  ],
  nvidia: [
    { id: 'nvidia/meta/llama-3.3-70b-instruct', name: 'NVIDIA Llama 3.3 70B Instruct', provider: 'nvidia', contextWindow: 128000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'nvidia/meta/llama-3.1-70b-instruct', name: 'NVIDIA Llama 3.1 70B Instruct', provider: 'nvidia', contextWindow: 128000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'nvidia/meta/llama-3.1-8b-instruct', name: 'NVIDIA Llama 3.1 8B Instruct', provider: 'nvidia', contextWindow: 128000, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'nvidia/nvidia/llama-3.1-nemotron-70b-instruct', name: 'NVIDIA Llama 3.1 Nemotron 70B Instruct', provider: 'nvidia', contextWindow: 128000, supportsTools: true, supportsReasoning: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'nvidia/deepseek-ai/deepseek-r1', name: 'NVIDIA DeepSeek R1', provider: 'nvidia', contextWindow: 128000, supportsTools: true, supportsReasoning: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
    { id: 'nvidia/qwen/qwen2.5-coder-32b-instruct', name: 'NVIDIA Qwen 2.5 Coder 32B', provider: 'nvidia', contextWindow: 32768, supportsTools: true, configured: false, validated: false, description: 'Fallback model catalog (connection unverified)' },
  ],
};

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
  nvidiaApiKey?: string;
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
  private nvidiaApiKey?: string;
  private apiKeyResolver?: (provider: string, callerAgentId?: string) => string | undefined;
  private allKeysResolver?: (provider: string, callerAgentId?: string) => ManagedKeyInfo[];
  private onUsage?: (provider: string, tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  private customEndpoints: Map<string, { baseUrl: string; apiKey?: string }> = new Map();
  private validatedProviders: Map<string, boolean> = new Map();
  private providerModelCounts: Map<string, number> = new Map();
  private isOllamaOnlineCached?: boolean;
  private ollamaModelCountCached?: number;
  private providerReadinessCache: Map<string, { readiness: ProviderReadiness; cachedAt: number }> = new Map();
  private static readonly READINESS_CACHE_TTL_MS = 60000;

  constructor(options?: ModelGatewayOptions) {
    this.ollamaHost = options?.ollamaHost || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    this.openrouterApiKey = options?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    this.openaiApiKey = options?.openaiApiKey || process.env.OPENAI_API_KEY;
    this.anthropicApiKey = options?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    this.deepseekApiKey = options?.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
    this.geminiApiKey = options?.geminiApiKey || process.env.GEMINI_API_KEY;
    this.groqApiKey = options?.groqApiKey || process.env.GROQ_API_KEY;
    this.xaiApiKey = options?.xaiApiKey || process.env.XAI_API_KEY;
    this.nvidiaApiKey = options?.nvidiaApiKey || process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY;
    this.apiKeyResolver = options?.apiKeyResolver;
    this.allKeysResolver = options?.allKeysResolver;
    this.onUsage = options?.onUsage;
  }

  public registerCustomProvider(name: string, baseUrl: string, apiKey?: string): void {
    const norm = name.toLowerCase().trim();
    this.customEndpoints.set(norm, { baseUrl, apiKey });
    this.providerReadinessCache.delete(norm);
    this.providerReadinessCache.delete('custom');
  }

  public unregisterCustomProvider(name: string): void {
    const norm = name.toLowerCase().trim();
    this.customEndpoints.delete(norm);
    this.providerReadinessCache.delete(norm);
    this.providerReadinessCache.delete('custom');
  }

  public clearCustomEndpoints(): void {
    this.customEndpoints.clear();
    this.providerReadinessCache.clear();
  }

  public clearReadinessCache(): void {
    this.providerReadinessCache.clear();
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
      else if (provider === 'nvidia') rawKey = this.nvidiaApiKey || process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY;
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

  public async checkProviderReadiness(provider: string, forceRefresh = false): Promise<ProviderReadiness> {
    const norm = provider.toLowerCase().trim();
    if (!forceRefresh) {
      const cached = this.providerReadinessCache.get(norm);
      if (cached && (Date.now() - cached.cachedAt < ModelGateway.READINESS_CACHE_TTL_MS)) {
        return cached.readiness;
      }
    }

    const saveAndReturn = (result: ProviderReadiness): ProviderReadiness => {
      this.providerReadinessCache.set(norm, { readiness: result, cachedAt: Date.now() });
      return result;
    };

    if (norm === 'ollama') {
      if (process.env.KIN_ISOLATE_OLLAMA === 'true') {
        this.isOllamaOnlineCached = false;
        this.ollamaModelCountCached = 0;
        return saveAndReturn({
          provider: 'ollama',
          configured: Boolean(this.ollamaHost),
          validated: false,
          ready: false,
          keyCount: 1,
          modelCount: 0,
          message: 'Local Ollama runtime unreachable (isolated via environment)',
        });
      }
      try {
        const res = await fetch(`${this.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
        if (res && res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const models: any[] = data.models || [];
          this.isOllamaOnlineCached = true;
          this.ollamaModelCountCached = models.length;
          return saveAndReturn({
            provider: norm,
            configured: true,
            validated: true,
            ready: true,
            keyCount: 1,
            modelCount: models.length,
            message: `Local Ollama online (${models.length} model(s) available)`,
          });
        }
      } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
      this.isOllamaOnlineCached = false;
      this.ollamaModelCountCached = 0;
      return saveAndReturn({
        provider: norm,
        configured: Boolean(this.ollamaHost),
        validated: false,
        ready: false,
        keyCount: 1,
        modelCount: 0,
        message: 'Local Ollama runtime unreachable (offline)',
      });
    }

    if (norm === 'custom' || this.customEndpoints.has(norm)) {
      if (this.customEndpoints.has(norm)) {
        const custom = this.customEndpoints.get(norm)!;
        return saveAndReturn({
          provider: norm,
          configured: true,
          validated: true,
          ready: true,
          keyCount: 1,
          modelCount: this.providerModelCounts.get(norm) || 1,
          message: `Custom endpoint "${norm}" registered at ${custom.baseUrl}`,
        });
      }
      const customCount = this.customEndpoints.size;
      return saveAndReturn({
        provider: 'custom',
        configured: customCount > 0,
        validated: customCount > 0,
        ready: customCount > 0,
        keyCount: customCount,
        modelCount: customCount,
        message: customCount > 0 ? `${customCount} custom endpoint(s) registered` : 'No custom endpoint configured',
      });
    }

    const apiKey = this.resolveApiKey(norm);
    const allKeys = this.allKeysResolver ? this.allKeysResolver(norm) : [];
    const keyCount = allKeys.length || (apiKey ? 1 : 0);
    if (!apiKey) {
      this.validatedProviders.set(norm, false);
      this.providerModelCounts.set(norm, 0);
      return saveAndReturn({
        provider: norm,
        configured: false,
        validated: false,
        ready: false,
        keyCount: 0,
        modelCount: 0,
        message: `API key not configured for ${norm}`,
      });
    }

    try {
      const verification = await this.verifyProviderConnection(norm, apiKey);
      this.validatedProviders.set(norm, verification.working);
      this.providerModelCounts.set(norm, verification.working ? verification.modelCount : 0);
      return saveAndReturn({
        provider: norm,
        configured: true,
        validated: verification.working,
        ready: verification.working,
        keyCount,
        modelCount: verification.working ? verification.modelCount : 0,
        message: keyCount > 1
          ? `${verification.message} (${keyCount} keys active)`
          : verification.message,
      });
    } catch (e: any) {
      this.validatedProviders.set(norm, false);
      this.providerModelCounts.set(norm, 0);
      return saveAndReturn({
        provider: norm,
        configured: true,
        validated: false,
        ready: false,
        keyCount,
        modelCount: 0,
        message: `Connection validation failed: ${e.message}`,
      });
    }
  }

  public invalidateProvider(provider: string): void {
    const norm = provider.toLowerCase().trim();
    this.validatedProviders.delete(norm);
    this.providerModelCounts.delete(norm);
    this.customEndpoints.delete(norm);
    this.providerReadinessCache.delete(norm);
  }

  /**
   * Performs an authoritative, real network verification of a provider's credentials.
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
            message: `Local Ollama verified (${models.length} local model(s) available)`,
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
      let testUrl = '';
      const headers: Record<string, string> = {};

      if (norm === 'anthropic') {
        testUrl = 'https://api.anthropic.com/v1/models';
        if (apiKey) {
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
        }
      } else if (norm === 'azure') {
        const endpoint = customBaseUrl || process.env.AZURE_OPENAI_ENDPOINT;
        if (!endpoint) {
          return { valid: false, working: false, message: 'Azure OpenAI requires an endpoint URL (e.g. https://YOUR_RESOURCE.openai.azure.com)', modelCount: 0, models: [] };
        }
        testUrl = `${endpoint.replace(/\/+$/, '')}/openai/models?api-version=2024-06-01`;
        if (apiKey) headers['api-key'] = apiKey;
      } else if (norm === 'gemini') {
        testUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/models';
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      } else {
        const custom = this.customEndpoints.get(norm);
        const rawBase = customBaseUrl || custom?.baseUrl || DEFAULT_PROVIDER_BASE_URLS[norm] || 'https://api.openai.com/v1';
        const cleanBase = rawBase.replace(/\/+$/, '');
        testUrl = cleanBase.endsWith('/models') ? cleanBase : `${cleanBase}/models`;
        if (apiKey && apiKey !== 'local-no-key') {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
      }
      if (norm === 'openrouter') {
        headers['HTTP-Referer'] = 'https://github.com/abhayzangir1/KIN';
        headers['X-Title'] = 'KIN Workforce Platform';
      }

      const res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(8000) }).catch((err) => {
        throw new Error(`Network failure connecting to ${norm}: ${err.message}`);
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error?.message || errData.message || `HTTP ${res.status}: ${res.statusText}`;
        this.validatedProviders.set(norm, false);
        return {
          valid: false,
          working: false,
          message: `${norm.toUpperCase()} API Key invalid or rejected: ${errMsg}`,
          modelCount: 0,
          models: [],
        };
      }

      const data: any = await res.json().catch(() => ({}));
      const rawList: any[] = data.data || data.models || [];
      const models = this.mapRawModelsToDiscovered(norm, rawList);

      this.validatedProviders.set(norm, true);
      this.providerModelCounts.set(norm, models.length);
      return {
        valid: true,
        working: true,
        message: `${norm.toUpperCase()} verified successfully (${models.length} model(s) available)`,
        modelCount: models.length,
        models: models.length > 0 ? models : this.getStandardFallbackModels(norm, customBaseUrl),
      };
    } catch (err: any) {
      this.validatedProviders.set(norm, false);
      return {
        valid: false,
        working: false,
        message: `Validation error for ${norm}: ${err.message}`,
        modelCount: 0,
        models: [],
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
    options?: { omitUnconfigured?: boolean; baseUrl?: string } | boolean
  ): Promise<DiscoveredModel[]> {
    const normProvider = provider.toLowerCase().trim();
    const shouldOmit = typeof options === 'boolean' ? options : Boolean(options?.omitUnconfigured);
    const customBaseUrl = typeof options === 'object' ? options?.baseUrl : undefined;
    const apiKey = explicitApiKey || this.resolveApiKey(normProvider);

    if (shouldOmit && normProvider !== 'ollama' && normProvider !== 'custom' && !this.customEndpoints.has(normProvider) && !customBaseUrl && !apiKey) {
      return [];
    }

    if (normProvider === 'ollama') {
      const res = await fetch(`${this.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (res && res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const rawList: any[] = data.models || [];
        this.isOllamaOnlineCached = true;
        this.ollamaModelCountCached = rawList.length;
        return rawList
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
      }
      this.isOllamaOnlineCached = false;
      this.ollamaModelCountCached = 0;
      return [];
    }

    // Handle custom provider enumeration
    if (normProvider === 'custom') {
      const result: DiscoveredModel[] = [];
      for (const [name, info] of this.customEndpoints.entries()) {
        const live = await this.queryLiveModels(name, info.apiKey || apiKey, info.baseUrl);
        if (live.length > 0) result.push(...live);
        else if (!shouldOmit) result.push(...this.getStandardFallbackModels(name, info.baseUrl));
      }
      return result;
    }

    // Live query for cloud/remote provider
    const custom = this.customEndpoints.get(normProvider);
    const targetBase = customBaseUrl || custom?.baseUrl || DEFAULT_PROVIDER_BASE_URLS[normProvider];
    if (apiKey || customBaseUrl || normProvider === 'lmstudio' || normProvider === 'vllm' || normProvider === 'openai_compatible') {
      const live = await this.queryLiveModels(normProvider, apiKey, targetBase);
      if (live.length > 0) {
        this.validatedProviders.set(normProvider, true);
        this.providerModelCounts.set(normProvider, live.length);
        return live;
      }
    }

    this.validatedProviders.set(normProvider, false);
    if (shouldOmit) return [];
    return this.getStandardFallbackModels(normProvider, targetBase);
  }

  private async queryLiveModels(provider: string, apiKey?: string, baseUrl?: string): Promise<DiscoveredModel[]> {
    try {
      let testUrl = '';
      const headers: Record<string, string> = {};
      if (provider === 'anthropic') {
        testUrl = 'https://api.anthropic.com/v1/models';
        if (apiKey) {
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
        }
      } else if (provider === 'azure') {
        const endpoint = baseUrl || process.env.AZURE_OPENAI_ENDPOINT;
        if (!endpoint) return [];
        testUrl = `${endpoint.replace(/\/+$/, '')}/openai/models?api-version=2024-06-01`;
        if (apiKey) headers['api-key'] = apiKey;
      } else if (provider === 'gemini') {
        testUrl = apiKey
          ? `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
          : 'https://generativelanguage.googleapis.com/v1beta/openai/models';
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      } else {
        const rawBase = baseUrl || DEFAULT_PROVIDER_BASE_URLS[provider] || 'https://api.openai.com/v1';
        const cleanBase = rawBase.replace(/\/+$/, '');
        testUrl = cleanBase.endsWith('/models') ? cleanBase : `${cleanBase}/models`;
        if (apiKey && apiKey !== 'local-no-key') {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
      }
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://github.com/abhayzangir1/KIN';
        headers['X-Title'] = 'KIN Workforce Platform';
      }

      const res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(6000) }).catch(() => null);
      if (res && res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const rawList: any[] = data.data || data.models || [];
        return this.mapRawModelsToDiscovered(provider, rawList);
      }
    } catch (err) {
      console.debug(`[model_gateway] Suppressed queryLiveModels exception for ${provider}:`, err);
    }
    return [];
  }

  /**
   * Alias for fetchProviderModels to discover models for a specific provider.
   */
  public async discoverProviderModels(
    provider: string,
    explicitApiKey?: string,
    options?: { omitUnconfigured?: boolean; baseUrl?: string } | boolean
  ): Promise<DiscoveredModel[]> {
    return this.fetchProviderModels(provider, explicitApiKey, options);
  }

  private mapRawModelsToDiscovered(provider: string, rawList: any[]): DiscoveredModel[] {
    if (!Array.isArray(rawList)) return [];
    const norm = provider.toLowerCase().trim();

    const filtered = rawList.filter((m: any) => {
      const id = String(m.id || m.name || '').toLowerCase();
      if (norm === 'gemini') {
        return !id.includes('embed') && !id.includes('aqa');
      }
      if (norm === 'nvidia') {
        return (
          id.length > 0 &&
          !id.includes('embed') &&
          !id.includes('rerank') &&
          !id.includes('nvclip') &&
          !id.includes('streampetr') &&
          !id.includes('guard') &&
          !id.includes('shield') &&
          !id.includes('parse')
        );
      }
      return (
        !id.includes('whisper') &&
        !id.includes('embedding') &&
        !id.includes('tts') &&
        !id.includes('dall-e') &&
        !id.includes('moderation') &&
        !id.includes('realtime') &&
        !id.includes('audio')
      );
    });

    return filtered.map((m: any) => {
      const rawId = String(m.id || m.name || '').replace(/^models\//, '');
      const cleanId = norm === 'nvidia' ? `nvidia/${rawId}` : (rawId.startsWith(`${norm}/`) ? rawId : `${norm}/${rawId}`);
      const name = m.displayName || m.name || m.id || cleanId;
      const isFree = cleanId.endsWith(':free') || m.pricing?.prompt === 0 || m.is_free === true;
      const contextWindow = m.context_window || m.inputTokenLimit || (cleanId.includes('o1') || cleanId.includes('o3') ? 200000 : 128000);
      const maxOutputTokens = m.max_output_tokens || m.outputTokenLimit || 8192;
      const idLower = cleanId.toLowerCase();
      const supportsVision = cleanId.includes('4o') || idLower.includes('vision') || idLower.includes('vl') || idLower.includes('neva') || idLower.includes('vlm') || cleanId.includes('gemini');
      const supportsReasoning = cleanId.includes('r1') || cleanId.includes('reasoner') || cleanId.includes('o1') || cleanId.includes('o3') || idLower.includes('nemotron') || idLower.includes('thinking') || idLower.includes('qwq');

      return {
        id: cleanId,
        name: norm === 'nvidia' && !name.startsWith('NVIDIA ') ? `NVIDIA ${name}` : name,
        provider: norm,
        contextWindow,
        maxOutputTokens,
        supportsTools: true,
        supportsVision,
        supportsReasoning,
        isFree,
        description: m.description,
        configured: true,
        validated: true,
      };
    });
  }

  private getStandardFallbackModels(provider: string, baseUrl?: string): DiscoveredModel[] {
    const norm = provider.toLowerCase().trim();
    if (FALLBACK_PROVIDER_CATALOGS[norm]) {
      return FALLBACK_PROVIDER_CATALOGS[norm];
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
      }
      if (provider === 'anthropic') {
        return await this.invokeAnthropic(modelName, params, startTime);
      }

      // Determine target URL and API key for universal OpenAI-compatible pipeline
      let targetUrl: string;
      const custom = this.customEndpoints.get(provider) || this.customEndpoints.get(params.modelId);
      const apiKey = custom?.apiKey || this.resolveApiKey(provider, params.callerAgentId);

      if (custom?.baseUrl) {
        targetUrl = custom.baseUrl.endsWith('/chat/completions')
          ? custom.baseUrl
          : `${custom.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      } else if (provider === 'azure') {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT || 'https://YOUR_RESOURCE.openai.azure.com';
        const cleanBase = endpoint.replace(/\/+$/, '');
        const deployment = modelName.replace(/^azure\//, '');
        targetUrl = `${cleanBase}/openai/deployments/${deployment}/chat/completions?api-version=2024-06-01`;
      } else if (DEFAULT_PROVIDER_BASE_URLS[provider]) {
        const base = DEFAULT_PROVIDER_BASE_URLS[provider].replace(/\/+$/, '');
        targetUrl = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
      } else {
        targetUrl = 'https://openrouter.ai/api/v1/chat/completions';
      }

      return await this.invokeOpenAiCompatible(targetUrl, apiKey, modelName, params, startTime, provider);
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
        } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
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
        ['ollama', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'xai', 'azure', 'nvidia', 'custom', 'openrouter', 'together', 'deepinfra', 'vllm', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'openai_compatible'].includes(prefix) ||
        this.customEndpoints.has(prefix)
      ) {
        return [prefix, modelId.substring(colonIdx + 1)];
      }
    }
    if (slashIdx !== -1) {
      const prefix = modelId.substring(0, slashIdx).toLowerCase();
      if (prefix === 'nvidia' && modelId.endsWith(':free')) {
        return ['openrouter', modelId];
      }
      if (
        ['ollama', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'xai', 'azure', 'nvidia', 'custom', 'openrouter', 'together', 'deepinfra', 'vllm', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'openai_compatible'].includes(prefix) ||
        this.customEndpoints.has(prefix)
      ) {
        return [prefix, modelId.substring(slashIdx + 1)];
      }
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
        ['ollama', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'xai', 'azure', 'nvidia', 'custom', 'openrouter', 'together', 'deepinfra', 'vllm', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'openai_compatible'].includes(prefix)
      ) {
        return [prefix, modelId.substring(colonIdx + 1)];
      }
    }
    if (slashIdx !== -1) {
      const prefix = modelId.substring(0, slashIdx).toLowerCase();
      if (prefix === 'nvidia' && modelId.endsWith(':free')) {
        return ['openrouter', modelId];
      }
      if (
        ['ollama', 'openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'xai', 'azure', 'nvidia', 'custom', 'openrouter', 'together', 'deepinfra', 'vllm', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'openai_compatible'].includes(prefix)
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
      : 180000;
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
            try { fnArgs = JSON.parse(fnArgs); } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
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
        const { done, value } = await readChunkWithTimeout(reader, 30000);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.tool_calls) {
              processToolCalls(parsed.message);
            }
            if (parsed.message?.content) {
              const chunk = parsed.message.content;
              fullContent += chunk;
              if (params.onToken) {
                params.onToken(chunk);
              }
            }
            if (parsed.message?.reasoning || parsed.message?.thinking) {
              const thinkChunk = parsed.message.reasoning || parsed.message.thinking;
              fullThinking += thinkChunk;
              if (params.onThinkingToken) {
                params.onThinkingToken(thinkChunk);
              }
            }
            if (parsed.prompt_eval_count) promptTokens = parsed.prompt_eval_count;
            if (parsed.eval_count) completionTokens = parsed.eval_count;
          } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
        }
      }
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.message?.tool_calls) {
            processToolCalls(parsed.message);
          }
          if (parsed.message?.content) {
            const chunk = parsed.message.content;
            fullContent += chunk;
            if (params.onToken) {
              params.onToken(chunk);
            }
          }
          if (parsed.message?.reasoning || parsed.message?.thinking) {
            const thinkChunk = parsed.message.reasoning || parsed.message.thinking;
            fullThinking += thinkChunk;
            if (params.onThinkingToken) {
              params.onThinkingToken(thinkChunk);
            }
          }
          if (parsed.prompt_eval_count) promptTokens = parsed.prompt_eval_count;
          if (parsed.eval_count) completionTokens = parsed.eval_count;
        } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
      }
    } else if (typeof res.text === 'function') {
      const text = await res.text();
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.message?.tool_calls) {
            processToolCalls(parsed.message);
          }
          if (parsed.message?.content) {
            const chunk = parsed.message.content;
            fullContent += chunk;
            if (params.onToken) {
              params.onToken(chunk);
            }
          }
          if (parsed.message?.reasoning || parsed.message?.thinking) {
            const thinkChunk = parsed.message.reasoning || parsed.message.thinking;
            fullThinking += thinkChunk;
            if (params.onThinkingToken) {
              params.onThinkingToken(thinkChunk);
            }
          }
          if (parsed.prompt_eval_count) promptTokens = parsed.prompt_eval_count;
          if (parsed.eval_count) completionTokens = parsed.eval_count;
        } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
      }
    } else if (typeof res.json === 'function') {
      const data: any = await res.json();
      if (data.message?.tool_calls) {
        processToolCalls(data.message);
      }
      fullContent = data.message?.content || '';
      fullThinking = data.message?.reasoning || data.message?.thinking || '';
      promptTokens = data.prompt_eval_count || 0;
      completionTokens = data.eval_count || 0;
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

    if (!fullContent.trim() && fullThinking.trim()) {
      fullContent = fullThinking.trim();
    }

    const separated = separateThinkingAndContent(fullContent, fullThinking);

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
    if (!apiKey && !isCustomEndpoint && provider !== 'lmstudio' && provider !== 'vllm' && provider !== 'openai_compatible') {
      throw new Error(`API key for ${provider.toUpperCase()} is not set in environment or managed credentials.`);
    }

    const stream = !!params.onToken || !!params.onThinkingToken;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey && apiKey !== 'local-no-key') {
      reqHeaders['Authorization'] = `Bearer ${apiKey}`;
      if (provider === 'azure') {
        reqHeaders['api-key'] = apiKey;
      }
    }
    if (provider === 'openrouter') {
      reqHeaders['HTTP-Referer'] = 'https://github.com/abhayzangir1/KIN';
      reqHeaders['X-Title'] = 'KIN Workforce Platform';
    }

    const reqBody: Record<string, any> = {
      model: modelName,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 2048,
      stream,
    };
    if (params.tools && params.tools.length > 0) {
      reqBody.tools = params.tools;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: reqHeaders,
      signal: resolveEffectiveSignal(params.signal),
      body: JSON.stringify(reqBody),
    });

    if (res.status === 429) {
      // 1. If multi-key resolver is available, attempt next key
      if (this.allKeysResolver && apiKey) {
        if (!attemptedKeys.has(apiKey)) attemptedKeys.add(apiKey);
        const allKeys = this.allKeysResolver(provider, params.callerAgentId);
        const untriedKeys = allKeys.filter((k) => !attemptedKeys.has(k.key));
        if (untriedKeys.length > 0) {
          const next = untriedKeys[0];
          attemptedKeys.add(next.key);
          console.warn(`[KIN MODEL GATEWAY] 429 rate limit on ${provider.toUpperCase()} key. Seamlessly rotating to secondary key (${next.keyAlias || next.id}).`);
          const nextUrl = next.baseUrl
            ? (next.baseUrl.endsWith('/chat/completions') ? next.baseUrl : `${next.baseUrl.replace(/\/+$/, '')}/chat/completions`)
            : url;
          return this.invokeOpenAiCompatible(nextUrl, next.key, modelName, params, startTime, provider, retryCount, attemptedKeys);
        }
      }
      // 2. OpenRouter free-tier failover
      if (provider === 'openrouter' && modelName.endsWith(':free')) {
        if (params.disableFallback) {
          throw new Error(`OpenRouter 429 Rate Limit exceeded after retries for model "${modelName}" (fallback disabled).`);
        }
        const freeFallbacks = [
          'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
          'nvidia/nemotron-3.5-lightning:free',
          'nvidia/nemotron-3.5-super-vl:free',
          'meta-llama/llama-3.3-70b-instruct:free',
          'google/gemini-2.0-flash-exp:free',
          'qwen/qwen-2.5-coder-32b-instruct:free',
        ];
        const nextFallback = freeFallbacks.find((m) => m !== modelName);
        if (nextFallback) {
          console.warn(`[KIN MODEL GATEWAY] 429 rate limit on "${modelName}". Seamlessly failing over to resilient free tier model "${nextFallback}".`);
          return this.invokeOpenAiCompatible(url, apiKey, nextFallback, params, startTime, provider, 0, attemptedKeys);
        }
      }

      // 3. Exponential backoff retry with jitter
      if (retryCount < 2) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterSec = QuotaGuard.parseRetryAfter(retryAfterHeader);
        const backoffMs = QuotaGuard.computeExponentialJitterBackoff(retryCount, retryAfterSec, 1500, 60000);
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
          } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
        }
      }

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr && dataStr !== '[DONE]') {
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                content += delta.content;
                if (params.onToken) params.onToken(delta.content);
              }
              if (delta?.reasoning || delta?.reasoning_content) {
                fullThinking += (delta.reasoning || delta.reasoning_content);
              }
              const toolCallsDelta = delta?.tool_calls;
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
            } catch (err) { console.debug("[model_gateway] Suppressed exception in trailing buffer flush:", err); }
          }
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
      let data: any = null;
      if (typeof res.json === 'function') {
        data = await res.json().catch(() => null);
      }
      if (!data && typeof res.text === 'function') {
        const raw = await res.text().catch(() => '');
        try { data = JSON.parse(raw); } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
      }
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
            try { fnArgs = JSON.parse(fnArgs); } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
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

    const stream = !!params.onToken || !!params.onThinkingToken;
    const effectiveSignal = resolveEffectiveSignal(params.signal);
    const reqBody: Record<string, any> = {
      model: modelName,
      system: systemMsg,
      messages: coalescedMsgs,
      max_tokens: params.maxTokens ?? 2048,
      temperature: params.temperature ?? 0.2,
      stream,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: effectiveSignal,
      body: JSON.stringify(reqBody),
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
        const retryAfterSec = QuotaGuard.parseRetryAfter(retryAfterHeader);
        const backoffMs = QuotaGuard.computeExponentialJitterBackoff(retryCount, retryAfterSec, 1500, 60000);
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
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
              const idx = parsed.index ?? streamToolCalls.size;
              streamToolCalls.set(idx, {
                id: parsed.content_block.id || '',
                name: parsed.content_block.name || '',
                arguments: '',
              });
            }
            if (parsed.type === 'content_block_delta') {
              if (parsed.delta?.type === 'thinking_delta' && parsed.delta?.thinking) {
                fullThinking += parsed.delta.thinking;
                if (params.onThinkingToken) {
                  params.onThinkingToken(parsed.delta.thinking);
                }
              } else if (parsed.delta?.type === 'text_delta' && parsed.delta?.text) {
                content += parsed.delta.text;
                if (params.onToken) {
                  params.onToken(parsed.delta.text);
                }
              } else if (parsed.delta?.text) {
                content += parsed.delta.text;
                if (params.onToken) {
                  params.onToken(parsed.delta.text);
                }
              } else if (parsed.delta?.type === 'input_json_delta' && parsed.delta?.partial_json) {
                const idx = parsed.index ?? 0;
                const tc = streamToolCalls.get(idx);
                if (tc) {
                  tc.arguments += parsed.delta.partial_json;
                }
              }
            }
            if (parsed.type === 'message_start' && parsed.message?.usage?.input_tokens) {
              promptTokens = parsed.message.usage.input_tokens;
            }
            if (parsed.type === 'message_delta' && parsed.usage?.output_tokens) {
              completionTokens = parsed.usage.output_tokens;
            }
          } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
        }
      }

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === 'content_block_delta') {
              if (parsed.delta?.type === 'thinking_delta' && parsed.delta?.thinking) {
                fullThinking += parsed.delta.thinking;
                if (params.onThinkingToken) params.onThinkingToken(parsed.delta.thinking);
              } else if (parsed.delta?.type === 'text_delta' && parsed.delta?.text) {
                content += parsed.delta.text;
                if (params.onToken) params.onToken(parsed.delta.text);
              } else if (parsed.delta?.text) {
                content += parsed.delta.text;
                if (params.onToken) params.onToken(parsed.delta.text);
              } else if (parsed.delta?.type === 'input_json_delta' && parsed.delta?.partial_json) {
                const idx = parsed.index ?? 0;
                const tc = streamToolCalls.get(idx);
                if (tc) tc.arguments += parsed.delta.partial_json;
              }
            }
          } catch (err) { console.debug("[model_gateway] Suppressed exception in trailing buffer flush:", err); }
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
      let data: any = null;
      if (typeof res.json === 'function') {
        data = await res.json().catch(() => null);
      }
      if (!data && typeof res.text === 'function') {
        const raw = await res.text().catch(() => '');
        try { data = JSON.parse(raw); } catch (err) { console.debug("[model_gateway] Suppressed exception in catch block:", err); }
      }
      if (Array.isArray(data?.content)) {
        for (const item of data.content) {
          if (item?.type === 'text') {
            content += item.text || '';
          } else if (item?.type === 'tool_use') {
            collectedToolCalls.push({ name: item.name, parameters: item.input || {} });
          }
        }
      } else {
        content = data?.content?.[0]?.text || '';
      }
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
      toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
    };
  }
}
