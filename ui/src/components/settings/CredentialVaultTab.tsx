import React, { useState } from 'react';
import {
  Key,
  Plus,
  Lock,
  X,
  AlertCircle,
  Eye,
  EyeOff,
  Trash2,
  Edit2,
  Shield,
} from 'lucide-react';
import { useKinStore, ManagedCredentialItem } from '../../store/kinStore.js';
import { ProviderIcon } from '../ModelSelectorModal.js';
import { requestConfirmation } from '../ConfirmDialog.js';

export const CredentialVaultTab: React.FC = () => {
  const {
    credentials,
    credentialsLoading,
    addCredential,
    updateCredential,
    deleteCredential,
    verifyProviderKey,
    agents,
    addToast,
  } = useKinStore();

  const [showCredForm, setShowCredForm] = useState(false);
  const [editingCredId, setEditingCredId] = useState<string | null>(null);
  const [credProvider, setCredProvider] = useState('openai');
  const [credKeyName, setCredKeyName] = useState('');
  const [credApiKey, setCredApiKey] = useState('');
  const [credBaseUrl, setCredBaseUrl] = useState('');
  const [credQuota, setCredQuota] = useState(5000000);
  const [showCredKey, setShowCredKey] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [credSaving, setCredSaving] = useState(false);

  // Scoped Agent Grants: default to All Agents ('*') to avoid SecretBroker default-deny lockout
  const [grantAllAgents, setGrantAllAgents] = useState(true);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  const handleOpenAdd = () => {
    setEditingCredId(null);
    setCredProvider('openai');
    setCredKeyName('');
    setCredApiKey('');
    setCredBaseUrl('');
    setCredQuota(5000000);
    setGrantAllAgents(true);
    setSelectedAgentIds([]);
    setShowCredKey(false);
    setCredError(null);
    setShowCredForm(true);
  };

  const handleOpenEdit = (cred: ManagedCredentialItem) => {
    setEditingCredId(cred.id);
    setCredProvider(cred.provider);
    setCredKeyName(cred.keyName || cred.keyAlias || '');
    setCredApiKey('');
    setCredBaseUrl(cred.baseUrl || (cred as any).endpointUrl || '');
    setCredQuota(cred.monthlyQuotaTokens || cred.maxSpendTokens || 5000000);
    const grants = cred.scopedAgentIds || (cred as any).scopedGrants || [];
    if (!grants || grants.length === 0 || grants.includes('*')) {
      setGrantAllAgents(true);
      setSelectedAgentIds([]);
    } else {
      setGrantAllAgents(false);
      setSelectedAgentIds(grants);
    }
    setShowCredKey(false);
    setCredError(null);
    setShowCredForm(true);
  };

  const toggleAgentGrant = (agentId: string) => {
    if (selectedAgentIds.includes(agentId)) {
      setSelectedAgentIds(selectedAgentIds.filter((id) => id !== agentId));
    } else {
      setSelectedAgentIds([...selectedAgentIds, agentId]);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credKeyName.trim()) {
      setCredError('Key alias or label is required');
      return;
    }

    const isZeroAuthAllowed = ['lmstudio', 'vllm', 'custom', 'openai_compatible', 'ollama'].includes(
      credProvider.toLowerCase()
    );

    if (!editingCredId && !credApiKey.trim() && !isZeroAuthAllowed) {
      setCredError('API Key is required');
      return;
    }

    // Determine scopedAgentIds: '*' if all agents or explicit list
    const finalScopedAgents = grantAllAgents || selectedAgentIds.length === 0 ? ['*'] : selectedAgentIds;

    setCredSaving(true);
    setCredError(null);

    try {
      if (credApiKey.trim()) {
        const verifyRes = await verifyProviderKey(
          credProvider,
          credApiKey.trim(),
          credBaseUrl.trim() || undefined
        );
        if (!verifyRes.working) {
          setCredError(
            `Key verification failed: ${verifyRes.message || 'Invalid API key or unreachable provider'}`
          );
          setCredSaving(false);
          return;
        }
      }

      const effectiveKey = credApiKey.trim() || (isZeroAuthAllowed ? 'local-no-key' : '');

      if (editingCredId) {
        const res = await updateCredential(editingCredId, {
          provider: credProvider,
          keyName: credKeyName.trim(),
          apiKey: credApiKey.trim()
            ? credApiKey.trim()
            : isZeroAuthAllowed && !credApiKey
            ? 'local-no-key'
            : undefined,
          baseUrl: credBaseUrl.trim() || undefined,
          monthlyQuotaTokens: credQuota,
          scopedAgentIds: finalScopedAgents,
        });
        if (!res.success) {
          setCredError(res.error || 'Failed to update credential');
          return;
        }
        addToast('Provider credential updated successfully', 'success');
      } else {
        const res = await addCredential({
          provider: credProvider,
          keyName: credKeyName.trim(),
          apiKey: effectiveKey,
          baseUrl: credBaseUrl.trim() || undefined,
          monthlyQuotaTokens: credQuota,
          scopedAgentIds: finalScopedAgents,
        });
        if (!res.success) {
          setCredError(res.error || 'Failed to save credential');
          return;
        }
        addToast('Provider credential added to Vault', 'success');
      }

      setShowCredForm(false);
      setEditingCredId(null);
    } catch (err: any) {
      setCredError(err?.message || 'Error communicating with credential vault');
    } finally {
      setCredSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await requestConfirmation({
      title: 'Delete Credential',
      message: `Are you sure you want to delete the credential "${name}"? Agents relying on this provider may fail unless failover is configured.`,
      confirmLabel: 'Delete Key',
      variant: 'danger',
    });
    if (!ok) return;

    const okDeleted = await deleteCredential(id);
    if (okDeleted) {
      addToast('Credential deleted from Vault', 'info');
    } else {
      addToast('Failed to delete credential', 'error');
    }
  };

  return (
    <div className="space-y-5 font-sans text-xs">
      {/* Header & Add Button */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center space-x-2">
            <Key className="w-4 h-4 text-amber-500" />
            <span>BYOK Universal Credential Vault</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Encrypted with HMAC in SQLite WAL. Configured with Scoped Agent Grants to prevent default-deny lockout while enforcing least privilege.
          </p>
        </div>
        {!showCredForm && (
          <button
            type="button"
            onClick={handleOpenAdd}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Provider Key</span>
          </button>
        )}
      </div>

      {/* Add / Edit Credential Form */}
      {showCredForm && (
        <form
          onSubmit={handleSave}
          className="p-4 rounded-xl bg-slate-50 dark:bg-[#0c1220] border border-emerald-500/50 space-y-4 shadow-lg animate-fadeIn"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white">
              <Lock className="w-3.5 h-3.5 text-emerald-500" />
              <span>{editingCredId ? 'Edit Provider Credential' : 'Add New Provider Credential'}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowCredForm(false);
                setEditingCredId(null);
              }}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {credError && (
            <div className="flex items-center space-x-2 px-3 py-2 rounded bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-500/50 text-red-700 dark:text-red-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{credError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Provider Selector */}
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">Provider</label>
              <select
                value={credProvider}
                onChange={(e) => setCredProvider(e.target.value)}
                disabled={Boolean(editingCredId)}
                className="w-full bg-white dark:bg-[#060911] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-60"
              >
                <option value="openai">OpenAI (GPT-4.5, GPT-4o, o3-mini)</option>
                <option value="anthropic">Anthropic (Claude 3.7 Sonnet, Claude 3.5)</option>
                <option value="openrouter">OpenRouter (Unified Catalog)</option>
                <option value="gemini">Google Gemini (Gemini 2.0 Flash, 1.5 Pro)</option>
                <option value="groq">Groq (Llama 3.3 70B, Ultra-fast LPU)</option>
                <option value="deepseek">DeepSeek (DeepSeek V3, DeepSeek R1)</option>
                <option value="xai">xAI (Grok)</option>
                <option value="nvidia">NVIDIA NIM (Nemotron, Llama 3.3, DeepSeek R1)</option>
                <option value="together">Together AI</option>
                <option value="deepinfra">DeepInfra</option>
                <option value="fireworks">Fireworks AI</option>
                <option value="perplexity">Perplexity AI</option>
                <option value="cerebras">Cerebras</option>
                <option value="azure">Azure OpenAI</option>
                <option value="lmstudio">LM Studio (Local)</option>
                <option value="vllm">vLLM (Local / Remote)</option>
                <option value="ollama">Ollama (Local)</option>
                <option value="openai_compatible">OpenAI Compatible (Local/Remote)</option>
                <option value="custom">Custom Provider</option>
              </select>
            </div>

            {/* Key Alias */}
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">Key Label / Alias</label>
              <input
                type="text"
                value={credKeyName}
                onChange={(e) => setCredKeyName(e.target.value)}
                placeholder="e.g. Primary OpenAI Key"
                className="w-full bg-white dark:bg-[#060911] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            {/* Base URL */}
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">Base URL (Optional)</label>
              <input
                type="text"
                value={credBaseUrl}
                onChange={(e) => setCredBaseUrl(e.target.value)}
                placeholder="e.g. http://localhost:1234/v1"
                className="w-full bg-white dark:bg-[#060911] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* API Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                API Key {editingCredId && <span className="text-[10px] text-slate-500">(Leave blank to keep existing key)</span>}
              </label>
              <button
                type="button"
                onClick={() => setShowCredKey(!showCredKey)}
                className="text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center space-x-1 cursor-pointer"
              >
                {showCredKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                <span>{showCredKey ? 'Hide' : 'Show'}</span>
              </button>
            </div>
            <input
              type={showCredKey ? 'text' : 'password'}
              value={credApiKey}
              onChange={(e) => setCredApiKey(e.target.value)}
              placeholder={editingCredId ? '••••••••••••••••••••' : 'sk-...'}
              className="w-full bg-white dark:bg-[#060911] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-emerald-500"
              required={!editingCredId}
            />
          </div>

          {/* Monthly Token Quota */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">Monthly Token Spend Quota</label>
              <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                {credQuota >= 1000000000 ? 'Unlimited' : `${(credQuota / 1000000).toFixed(1)}M Tokens`}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={credQuota}
                onChange={(e) => setCredQuota(Math.max(10000, Number(e.target.value)))}
                step={500000}
                min={0}
                className="flex-1 bg-white dark:bg-[#060911] border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-emerald-500"
              />
              <div className="flex items-center space-x-1">
                {[1000000, 5000000, 10000000, 50000000].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setCredQuota(q)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer border ${
                      credQuota === q
                        ? 'bg-emerald-600 text-white font-bold border-emerald-600'
                        : 'bg-white dark:bg-[#060911] text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {q / 1000000}M
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* SCOPED AGENT GRANTS SELECTOR (Feature 32 Security Requirement) */}
          <div className="p-3 bg-white dark:bg-[#080d1a] border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                <Shield className="w-3.5 h-3.5 text-blue-500" />
                <span>Scoped Agent Grants (SecretBroker Authorization)</span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                Default: All Agents (*)
              </span>
            </div>

            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Control which agents are authorized to use this credential. Saving with <strong>All Agents (`*`)</strong> ensures no specialist is blocked by SecretBroker default-deny.
            </p>

            <div className="space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={grantAllAgents}
                  onChange={(e) => {
                    setGrantAllAgents(e.target.checked);
                    if (e.target.checked) setSelectedAgentIds([]);
                  }}
                  className="rounded text-blue-600 focus:ring-0 cursor-pointer"
                />
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Grant to All Agents (`*`) — Recommended
                </span>
              </label>

              {!grantAllAgents && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-6 pt-1">
                  {agents.map((agent) => {
                    const isChecked = selectedAgentIds.includes(agent.id);
                    return (
                      <label
                        key={agent.id}
                        className="flex items-center space-x-2 text-[11px] cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleAgentGrant(agent.id)}
                          className="rounded text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <span className="truncate">{agent.displayName || `@${agent.name}`}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setShowCredForm(false);
                setEditingCredId(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={credSaving}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer shadow-xs"
            >
              {credSaving ? 'Encrypting & Saving...' : editingCredId ? 'Update Key' : 'Save Key to Vault'}
            </button>
          </div>
        </form>
      )}

      {/* Vault Credentials List */}
      <div className="space-y-2">
        {credentialsLoading ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            Loading encrypted vault credentials...
          </div>
        ) : credentials.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <Key className="w-8 h-8 mx-auto text-slate-400 dark:text-slate-600" />
            <p className="font-semibold text-slate-700 dark:text-slate-300">Vault is empty</p>
            <p className="text-[11px] text-slate-500">
              Add your provider API keys (OpenAI, Anthropic, OpenRouter, Gemini, Groq, DeepSeek, etc.) to enable frontier LLM capabilities.
            </p>
          </div>
        ) : (
          credentials.map((cred) => {
            const grants = cred.scopedAgentIds || (cred as any).scopedGrants || ['*'];
            const grantDisplay = grants.includes('*') ? 'All Agents (*)' : `${grants.length} specific agents`;

            return (
              <div
                key={cred.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-white dark:bg-[#0c1220] border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition shadow-xs"
              >
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-[#060911] border border-slate-200 dark:border-slate-800 shrink-0">
                    <ProviderIcon provider={cred.provider} className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-900 dark:text-white truncate">
                        {cred.keyName || cred.keyAlias || cred.provider}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 uppercase font-bold border border-blue-200 dark:border-blue-900/50">
                        {cred.provider}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-slate-500 font-mono">
                      <span>Grants: <strong className="text-slate-700 dark:text-slate-300">{grantDisplay}</strong></span>
                      <span>•</span>
                      <span>Quota: {cred.monthlyQuotaTokens ? `${(cred.monthlyQuotaTokens / 1000000).toFixed(1)}M` : 'Unlimited'}</span>
                      {cred.baseUrl && (
                        <>
                          <span>•</span>
                          <span className="truncate max-w-xs">{cred.baseUrl}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(cred)}
                    className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                    title="Edit credential"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(cred.id, cred.keyName || cred.provider)}
                    className="p-1.5 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 transition cursor-pointer"
                    title="Delete credential"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
