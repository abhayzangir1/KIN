import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { ProviderIcon } from './ModelSelectorModal.js';
import {
  X,
  Key,
  Globe,
  Tag,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  Cpu
} from 'lucide-react';

const PROVIDER_DEFAULTS: Record<string, { name: string; defaultBaseUrl: string; requiresKey: boolean; placeholderKey: string }> = {
  openrouter: {
    name: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    placeholderKey: 'sk-or-v1-...',
  },
  anthropic: {
    name: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresKey: true,
    placeholderKey: 'sk-ant-api03-...',
  },
  openai: {
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    placeholderKey: 'sk-proj-...',
  },
  gemini: {
    name: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    requiresKey: true,
    placeholderKey: 'AIzaSy...',
  },
  deepseek: {
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    requiresKey: true,
    placeholderKey: 'sk-...',
  },
  groq: {
    name: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    placeholderKey: 'gsk_...',
  },
  xai: {
    name: 'xAI (Grok)',
    defaultBaseUrl: 'https://api.x.ai/v1',
    requiresKey: true,
    placeholderKey: 'xai-...',
  },
  ollama: {
    name: 'Ollama (Local)',
    defaultBaseUrl: 'http://localhost:11434',
    requiresKey: false,
    placeholderKey: 'Not required for local daemon',
  },
  azure: {
    name: 'Azure OpenAI',
    defaultBaseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments',
    requiresKey: true,
    placeholderKey: 'Azure API Key or Bearer token',
  },
  together: {
    name: 'Together AI',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    requiresKey: true,
    placeholderKey: 'sk-...',
  },
  deepinfra: {
    name: 'DeepInfra',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    requiresKey: true,
    placeholderKey: '...',
  },
  fireworks: {
    name: 'Fireworks AI',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    requiresKey: true,
    placeholderKey: 'fw_...',
  },
  perplexity: {
    name: 'Perplexity AI',
    defaultBaseUrl: 'https://api.perplexity.ai',
    requiresKey: true,
    placeholderKey: 'pplx-...',
  },
  cerebras: {
    name: 'Cerebras',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    requiresKey: true,
    placeholderKey: 'csk-...',
  },
  lmstudio: {
    name: 'LM Studio (Local)',
    defaultBaseUrl: 'http://localhost:1234/v1',
    requiresKey: false,
    placeholderKey: 'Not required for local LM Studio',
  },
  vllm: {
    name: 'vLLM (Local / Remote)',
    defaultBaseUrl: 'http://localhost:8000/v1',
    requiresKey: false,
    placeholderKey: 'Bearer token (optional for local)',
  },
  custom: {
    name: 'Custom Endpoint',
    defaultBaseUrl: 'http://localhost:8000/v1',
    requiresKey: false,
    placeholderKey: 'Bearer token or custom key (optional)',
  },
  openai_compatible: {
    name: 'OpenAI Compatible (LM Studio / vLLM)',
    defaultBaseUrl: 'http://localhost:1234/v1',
    requiresKey: false,
    placeholderKey: 'Bearer token (optional for local)',
  },
};

export const AddProviderModal: React.FC = () => {
  const {
    isAddProviderModalOpen,
    addProviderPreselected,
    closeAddProviderModal,
    addCredential,
    discoverModels,
    verifyProviderKey,
    addCustomModel,
    fetchAvailableModels,
    fetchCredentials,
  } = useKinStore();

  const [provider, setProvider] = useState<string>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState(PROVIDER_DEFAULTS.openrouter.defaultBaseUrl);
  const [keyAlias, setKeyAlias] = useState('');
  const [customModelId, setCustomModelId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (addProviderPreselected && PROVIDER_DEFAULTS[addProviderPreselected.toLowerCase()]) {
      const p = addProviderPreselected.toLowerCase();
      setProvider(p);
      setEndpointUrl(PROVIDER_DEFAULTS[p].defaultBaseUrl);
      setKeyAlias(`${PROVIDER_DEFAULTS[p].name} Key`);
    } else {
      setProvider('openrouter');
      setEndpointUrl(PROVIDER_DEFAULTS.openrouter.defaultBaseUrl);
      setKeyAlias('OpenRouter Key');
    }
    setApiKey('');
    setCustomModelId('');
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [addProviderPreselected, isAddProviderModalOpen]);

  const handleProviderChange = (newProv: string) => {
    setProvider(newProv);
    const def = PROVIDER_DEFAULTS[newProv];
    if (def) {
      setEndpointUrl(def.defaultBaseUrl);
      if (!keyAlias || keyAlias.includes('Key')) {
        setKeyAlias(`${def.name} Key`);
      }
    }
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const config = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
    if (config.requiresKey && !apiKey.trim()) {
      setErrorMsg(`API Key is required for ${config.name}.`);
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Verify provider key with live upstream endpoint (if key provided or endpointUrl provided)
      if (apiKey.trim() || (endpointUrl.trim() && !config.requiresKey)) {
        const verifyRes = await verifyProviderKey(provider, apiKey.trim() || undefined, endpointUrl.trim() || undefined);
        if (!verifyRes.working && config.requiresKey) {
          setErrorMsg(`Key Verification Failed: ${verifyRes.message || 'Invalid API key or network error.'}`);
          setIsSubmitting(false);
          return;
        }
      }

      // 2. Save credential (even for keyless local endpoints by saving with 'local-no-key')
      const effectiveKey = apiKey.trim() || (endpointUrl.trim() ? 'local-no-key' : '');
      if (effectiveKey) {
        const credRes = await addCredential({
          provider,
          keyAlias: keyAlias.trim() || `${config.name} Endpoint`,
          apiKey: effectiveKey,
          baseUrl: endpointUrl.trim() || undefined,
        });
        if (!credRes.success) {
          setErrorMsg(credRes.error || 'Failed to persist API credential.');
          setIsSubmitting(false);
          return;
        }
      }

      // 2. Discover models for provider
      const discRes = await discoverModels(
        provider,
        apiKey.trim() || undefined,
        endpointUrl.trim() || undefined,
        keyAlias.trim() || undefined
      );

      // 3. If custom model ID given, register it directly
      if (customModelId.trim()) {
        await addCustomModel(customModelId.trim(), {
          provider,
          baseUrl: endpointUrl.trim(),
          apiKey: apiKey.trim() || undefined,
        });
      }

      // Refresh stores
      await fetchCredentials();
      await fetchAvailableModels();

      const count = discRes.count || (customModelId.trim() ? 1 : 0);
      setSuccessMsg(`Successfully configured ${config.name}! Discovered ${count} model(s).`);

      setTimeout(() => {
        setIsSubmitting(false);
        closeAddProviderModal();
      }, 1200);
    } catch (err: any) {
      console.error('[AddProviderModal] Error:', err);
      setErrorMsg(err?.message || 'Failed to save provider configuration.');
      setIsSubmitting(false);
    }
  };

  if (!isAddProviderModalOpen) return null;

  const currentDef = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-[#0c1017] border border-[#1e293b] rounded-xl shadow-2xl flex flex-col overflow-hidden text-kin-text animate-scaleUp">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e293b] bg-[#0f1420]/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <ProviderIcon provider={provider} className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">
                Add Provider &amp; API Key
              </h2>
              <p className="text-[11px] text-[#64748b]">
                Connect any AI model provider. Credentials are encrypted and models are dynamically discovered.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeAddProviderModal}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[#94a3b8] hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          
          {/* Provider Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#cbd5e1] flex items-center justify-between">
              <span>Select Provider</span>
              <span className="text-[10px] text-[#64748b] font-mono">Dynamic Model Discovery</span>
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full bg-[#070b14] border border-[#1e293b] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-sans cursor-pointer"
            >
              <option value="openrouter">OpenRouter (100+ Models, Claude, DeepSeek, Llama)</option>
              <option value="anthropic">Anthropic (Claude 3.7 Sonnet, Claude 3.5)</option>
              <option value="azure">Azure OpenAI</option>
              <option value="openai">OpenAI (GPT-4o, o3-mini, o1)</option>
              <option value="gemini">Google Gemini (Gemini 2.5 Pro, 2.0 Flash)</option>
              <option value="deepseek">DeepSeek (DeepSeek V3, DeepSeek R1)</option>
              <option value="groq">Groq (Ultra-Fast LPU Inference)</option>
              <option value="xai">xAI (Grok 2, Grok Beta)</option>
              <option value="together">Together AI (Llama 3.3, DeepSeek, Mistral)</option>
              <option value="deepinfra">DeepInfra (High-Throughput Open Models)</option>
              <option value="fireworks">Fireworks AI (Fast Function Calling & Reasoning)</option>
              <option value="perplexity">Perplexity AI (Sonar Online Search Models)</option>
              <option value="cerebras">Cerebras (Wafer-Scale Ultra-Fast Inference)</option>
              <option value="ollama">Ollama (Local Offline Runtime)</option>
              <option value="lmstudio">LM Studio (Local Server)</option>
              <option value="vllm">vLLM (Self-Hosted Inference Engine)</option>
              <option value="openai_compatible">OpenAI Compatible (Any Generic Endpoint)</option>
              <option value="custom">Custom Endpoint (Custom Proxy / Route)</option>
            </select>
          </div>

          {/* API Key Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#cbd5e1] flex items-center justify-between">
              <span className="flex items-center space-x-1.5">
                <Key className="w-3.5 h-3.5 text-emerald-400" />
                <span>API Key {currentDef.requiresKey ? '*' : '(Optional)'}</span>
              </span>
              <span className="text-[10px] text-emerald-400/80 font-mono">Encrypted with AES-256</span>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={currentDef.placeholderKey}
                className="w-full bg-[#070b14] border border-[#1e293b] rounded-lg pl-3 pr-10 py-2 text-xs text-white font-mono placeholder-[#475569] focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-white cursor-pointer"
                title={showKey ? 'Hide Key' : 'Show Key'}
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Endpoint URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#cbd5e1] flex items-center space-x-1.5">
              <Globe className="w-3.5 h-3.5 text-blue-400" />
              <span>Endpoint URL</span>
            </label>
            <input
              type="text"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="e.g. https://api.openai.com/v1"
              className="w-full bg-[#070b14] border border-[#1e293b] rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-[#475569] focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Key Alias & Custom Model ID row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#cbd5e1] flex items-center space-x-1.5">
                <Tag className="w-3.5 h-3.5 text-amber-400" />
                <span>Alias / Label</span>
              </label>
              <input
                type="text"
                value={keyAlias}
                onChange={(e) => setKeyAlias(e.target.value)}
                placeholder="e.g. My OpenRouter Key"
                className="w-full bg-[#070b14] border border-[#1e293b] rounded-lg px-3 py-2 text-xs text-white placeholder-[#475569] focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#cbd5e1] flex items-center space-x-1.5">
                <Cpu className="w-3.5 h-3.5 text-purple-400" />
                <span>Specific Model ID (Optional)</span>
              </label>
              <input
                type="text"
                value={customModelId}
                onChange={(e) => setCustomModelId(e.target.value)}
                placeholder="e.g. meta-llama/llama-3.3-70b"
                className="w-full bg-[#070b14] border border-[#1e293b] rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-[#475569] focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Error & Success Messages */}
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-950/50 border border-red-500/40 text-red-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs flex items-center space-x-2">
              <Check className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Modal Actions */}
          <div className="pt-2 flex items-center justify-end space-x-2.5">
            <button
              type="button"
              onClick={closeAddProviderModal}
              disabled={isSubmitting}
              className="px-3.5 py-2 rounded-lg bg-[#1e293b] hover:bg-[#283548] text-[#cbd5e1] text-xs font-medium transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  <span>Discovering Models...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Save &amp; Discover Models</span>
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
