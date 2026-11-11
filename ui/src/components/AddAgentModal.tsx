import React, { useState, useEffect, useMemo } from 'react';
import { useKinStore, isAgentAvailable, AvailableModelItem } from '../store/kinStore.js';
import {
  X,
  UserPlus,
  UserCheck,
  Bot,
  Search,
  Plus,
  Check,
  AlertTriangle,
  Cpu,
  Sparkles,
  Eye,
  Wrench,
  Brain,
} from 'lucide-react';
import { ProviderIcon, formatContextWindow } from './ModelSelectorModal.js';

export const AddAgentModal: React.FC = () => {
  const {
    isAddAgentModalOpen,
    setAddAgentModalOpen,
    activeChannelId,
    channels,
    agents,
    channelMembers,
    addChannelMember,
    hireAgent,
    availableModels,
    ollamaStatus,
    credentials,
    addCustomModel,
    openAddProviderModal,
  } = useKinStore();

  const [tab, setTab] = useState<'assign' | 'hire'>('assign');
  const [selectedAgentToAssign, setSelectedAgentToAssign] = useState('');
  
  // Hire form fields
  const [displayName, setDisplayName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [activeModelId, setActiveModelId] = useState(availableModels[0]?.id || '');

  // Browse Models modal state
  const [isBrowseModelsOpen, setIsBrowseModelsOpen] = useState(false);
  const [browseSearchQuery, setBrowseSearchQuery] = useState('');
  const [browseProviderFilter, setBrowseProviderFilter] = useState('all');
  const [browseToolsOnly, setBrowseToolsOnly] = useState(false);
  const [browseVisionOnly, setBrowseVisionOnly] = useState(false);
  const [browseReasoningOnly, setBrowseReasoningOnly] = useState(false);
  const [browseFreeOnly, setBrowseFreeOnly] = useState(false);

  useEffect(() => {
    if (!activeModelId && availableModels.length > 0) {
      setActiveModelId(availableModels[0].id);
    }
  }, [availableModels, activeModelId]);
  const [customModelInput, setCustomModelInput] = useState('');
  const [modelTierFilter, setModelTierFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isAddAgentModalOpen) return null;

  const isChannel = !activeChannelId.startsWith('dm-');
  const activeChannel = channels.find((c) => c.id === activeChannelId);

  const filteredModels = availableModels.filter((m) => {
    const isFree = Boolean(m.isFree || m.provider === 'ollama' || m.id.endsWith(':free'));
    if (modelTierFilter === 'free') return isFree;
    if (modelTierFilter === 'paid') return !isFree;
    return true;
  });

  // Verified/configured models for the modal browser
  const verifiedModels = useMemo(() => {
    return availableModels.filter((m) => {
      if (m.configured === false || m.validated === false) return false;
      if (m.provider === 'ollama' && !ollamaStatus.online && (!ollamaStatus.models || ollamaStatus.models.length === 0)) {
        return false;
      }
      return true;
    });
  }, [availableModels, ollamaStatus]);

  // Distinct providers list for browse filter pills
  const browseProviders = useMemo(() => {
    const list: Array<{ id: string; name: string; count: number }> = [];
    const provSet = new Set<string>();

    const ollamaModels = verifiedModels.filter((m) => m.provider === 'ollama');
    if (ollamaStatus.online || ollamaModels.length > 0) {
      list.push({ id: 'ollama', name: 'Ollama', count: ollamaModels.length });
      provSet.add('ollama');
    }

    const displayNames: Record<string, string> = {
      openrouter: 'OpenRouter',
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      azure: 'Azure',
      gemini: 'Google Gemini',
      deepseek: 'DeepSeek',
      groq: 'Groq',
      xai: 'xAI',
      nvidia: 'NVIDIA NIM',
      ollama: 'Ollama',
    };

    for (const m of verifiedModels) {
      const p = (m.provider || 'custom').toLowerCase();
      if (!provSet.has(p)) {
        provSet.add(p);
        const count = verifiedModels.filter((item) => (item.provider || 'custom').toLowerCase() === p).length;
        list.push({ id: p, name: displayNames[p] || p.toUpperCase(), count });
      }
    }

    return list;
  }, [verifiedModels, ollamaStatus]);

  // Filtered models inside Browse Models modal
  const browseFilteredModels = useMemo(() => {
    return verifiedModels.filter((m) => {
      if (browseProviderFilter !== 'all') {
        if ((m.provider || '').toLowerCase() !== browseProviderFilter.toLowerCase()) return false;
      }
      if (browseToolsOnly && m.supportsTools === false) return false;
      if (browseVisionOnly && !m.supportsVision) return false;
      if (browseReasoningOnly && !m.supportsReasoning) return false;
      if (browseFreeOnly && !m.isFree) return false;

      if (browseSearchQuery.trim()) {
        const query = browseSearchQuery.toLowerCase().trim();
        const matchesId = m.id.toLowerCase().includes(query);
        const matchesName = (m.name || '').toLowerCase().includes(query);
        const matchesProvider = (m.provider || '').toLowerCase().includes(query);
        const matchesDesc = (m.description || '').toLowerCase().includes(query);
        if (!matchesId && !matchesName && !matchesProvider && !matchesDesc) return false;
      }

      return true;
    });
  }, [verifiedModels, browseProviderFilter, browseToolsOnly, browseVisionOnly, browseReasoningOnly, browseFreeOnly, browseSearchQuery]);

  // All unassigned agents
  const unassignedAgents = agents.filter(
    (ag) => !channelMembers.some((m) => m.id === ag.id)
  );

  // Available project agents with ready models not already in this channel
  const availableToAssign = unassignedAgents.filter(
    (ag) => isAgentAvailable(ag, ollamaStatus, credentials, availableModels)
  );

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentToAssign) return;
    setError('');
    const res = await addChannelMember(activeChannelId, selectedAgentToAssign);
    if (res && !res.success) {
      setError(res.error || 'Failed to assign agent');
      return;
    }
    setSelectedAgentToAssign('');
    setAddAgentModalOpen(false);
  };

  const handleHire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Agent display name is required');
      return;
    }

    setIsSubmitting(true);
    setError('');

    const res = await hireAgent({
      displayName: displayName.trim(),
      roleTitle: roleTitle.trim() || 'Specialist',
      activeModelId,
      systemPrompt: systemPrompt.trim() || undefined,
      channelId: isChannel ? activeChannelId : undefined,
    });

    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || 'Failed to hire agent');
    } else {
      setDisplayName('');
      setRoleTitle('');
      setSystemPrompt('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-kin-surface border border-kin-border rounded-xl w-full max-w-lg shadow-2xl p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-kin-border">
          <div className="flex items-center space-x-2">
            <Bot className="w-5 h-5 text-blue-400" />
            <h2 className="text-sm font-bold text-kin-text">
              {isChannel ? `Manage Channel Agents (#${activeChannel?.name || 'channel'})` : 'Hire Project Specialist'}
            </h2>
          </div>
          <button
            onClick={() => setAddAgentModalOpen(false)}
            className="text-kin-muted hover:text-kin-text transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Toggle (Only show Assign tab if in channel and unassigned agents exist) */}
        {isChannel && (
          <div className="grid grid-cols-2 gap-1 bg-kin-card p-1 rounded-lg border border-kin-border text-xs">
            <button
              onClick={() => { setTab('assign'); setError(''); }}
              className={`py-1.5 rounded-md font-medium transition ${
                tab === 'assign'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-kin-muted hover:text-kin-text'
              }`}
            >
              Assign Existing Project Agent
            </button>
            <button
              onClick={() => { setTab('hire'); setError(''); }}
              className={`py-1.5 rounded-md font-medium transition ${
                tab === 'hire'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-kin-muted hover:text-kin-text'
              }`}
            >
              Hire New Specialist
            </button>
          </div>
        )}

        {error && (
          <div className="p-2.5 rounded bg-red-950/40 border border-red-500/30 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* Tab 1: Assign Existing Agent */}
        {isChannel && tab === 'assign' ? (
          <form onSubmit={handleAssign} className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="text-kin-muted font-medium">Select Project Agent</label>
              {availableToAssign.length > 0 ? (
                <select
                  value={selectedAgentToAssign}
                  onChange={(e) => setSelectedAgentToAssign(e.target.value)}
                  className="w-full bg-kin-card border border-kin-border rounded px-3 py-2 text-kin-text focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="">-- Choose agent to assign --</option>
                  {availableToAssign.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.displayName} ({ag.role})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="p-3 rounded bg-kin-card/50 border border-kin-border text-kin-muted italic text-center space-y-1">
                  <div>
                    {unassignedAgents.length > 0
                      ? 'Unassigned agents exist in this project, but their assigned models are currently offline or missing API credentials.'
                      : `All agents in this project are already members of #${activeChannel?.name || 'this channel'}.`}
                  </div>
                  {unassignedAgents.length > 0 && (
                    <div className="text-[10px] text-blue-400 not-italic">
                      Configure models in <strong>Settings → BYOK &amp; Credentials</strong> or start Ollama to make them available.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-kin-border">
              <button
                type="button"
                onClick={() => setAddAgentModalOpen(false)}
                className="px-3 py-1.5 rounded bg-kin-card text-kin-text hover:bg-kin-cardHover transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!selectedAgentToAssign}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium transition"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Assign to Channel</span>
              </button>
            </div>
          </form>
        ) : (
          /* Tab 2: Hire New Specialist */
          <form onSubmit={handleHire} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-kin-muted font-medium">Display Name (@handle)</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. @ResearchAgent"
                  className="w-full bg-kin-card border border-kin-border rounded px-2.5 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-kin-muted font-medium">Specialist Role Title</label>
                <input
                  type="text"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. Research Specialist"
                  className="w-full bg-kin-card border border-kin-border rounded px-2.5 py-1.5 text-kin-text focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-kin-muted font-medium">Configured Model</label>
                <div className="flex items-center space-x-1 p-0.5 bg-kin-card rounded border border-kin-border text-[10px]">
                  <button
                    type="button"
                    onClick={() => setModelTierFilter('all')}
                    className={`px-2 py-0.5 rounded transition ${
                      modelTierFilter === 'all' ? 'bg-blue-600 text-white font-medium' : 'text-kin-muted hover:text-kin-muted'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setModelTierFilter('free')}
                    className={`px-2 py-0.5 rounded transition ${
                      modelTierFilter === 'free' ? 'bg-emerald-600 text-white font-medium' : 'text-kin-muted hover:text-kin-muted'
                    }`}
                  >
                    Free Tier
                  </button>
                  <button
                    type="button"
                    onClick={() => setModelTierFilter('paid')}
                    className={`px-2 py-0.5 rounded transition ${
                      modelTierFilter === 'paid' ? 'bg-purple-600 text-white font-medium' : 'text-kin-muted hover:text-kin-muted'
                    }`}
                  >
                    Paid
                  </button>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <select
                  value={activeModelId}
                  onChange={(e) => setActiveModelId(e.target.value)}
                  className="flex-1 bg-kin-card border border-kin-border rounded px-2.5 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 cursor-pointer font-mono text-xs"
                >
                  {/* 1. Local Ollama Models */}
                  {filteredModels.filter((m) => m.provider === 'ollama').length > 0 && (
                    <optgroup label="Local Ollama Models">
                      {filteredModels
                        .filter((m) => m.provider === 'ollama')
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id} (Local)
                          </option>
                        ))}
                    </optgroup>
                  )}

                  {/* 2. Discovered External Providers */}
                  {['anthropic', 'openai', 'gemini', 'deepseek', 'groq', 'nvidia', 'xai', 'openrouter'].map((prov) => {
                    const provModels = filteredModels.filter((m) => m.provider === prov && m.configured !== false);
                    if (provModels.length === 0) return null;
                    const provLabel =
                      prov === 'anthropic' ? 'Anthropic Cloud Models' :
                      prov === 'openai' ? 'OpenAI Cloud Models' :
                      prov === 'gemini' ? 'Google Gemini Models' :
                      prov === 'deepseek' ? 'DeepSeek Models' :
                      prov === 'groq' ? 'Groq LPU Models' :
                      prov === 'nvidia' ? 'NVIDIA NIM Models' :
                      prov === 'xai' ? 'xAI Grok Models' :
                      prov === 'openrouter' ? 'OpenRouter Catalog' : `${prov.toUpperCase()} Models`;

                    return (
                      <optgroup key={prov} label={provLabel}>
                        {provModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id} {m.isFree ? '(Provider lists as free)' : ''}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}

                  {/* 3. Custom Registered Models */}
                  {filteredModels.filter((m) => (m.provider === 'custom' || m.isCustom) && m.configured !== false).length > 0 && (
                    <optgroup label="Custom User Models">
                      {filteredModels
                        .filter((m) => (m.provider === 'custom' || m.isCustom) && m.configured !== false)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id} (Custom)
                          </option>
                        ))}
                    </optgroup>
                  )}

                  {/* 4. Active Selected Model if not in list */}
                  {activeModelId && !filteredModels.some((m) => m.id === activeModelId) && (
                    <optgroup label="Active Selected Model">
                      <option value={activeModelId}>{activeModelId}</option>
                    </optgroup>
                  )}

                  {/* 5. Fallback if no models available */}
                  {filteredModels.length === 0 && !activeModelId && (
                    <option value="" disabled>
                      No models match the filter (Configure Ollama or BYOK in Settings)
                    </option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => setIsBrowseModelsOpen(true)}
                  className="px-2.5 py-1.5 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 text-xs font-medium transition cursor-pointer flex items-center space-x-1.5 shrink-0 whitespace-nowrap"
                  title="Browse Models in visual selector"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Browse Models...</span>
                </button>
                <button
                  type="button"
                  onClick={() => openAddProviderModal()}
                  className="px-2.5 py-1.5 rounded bg-kin-card hover:bg-kin-cardHover text-kin-muted hover:text-kin-text border border-kin-border hover:border-emerald-500/40 text-xs font-medium transition cursor-pointer flex items-center space-x-1 shrink-0 whitespace-nowrap"
                  title="Configure LLM API Provider"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>+ Add Provider</span>
                </button>
              </div>

              {filteredModels.length === 0 && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>No models available for selection.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAddProviderModal()}
                    className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-xs font-medium transition cursor-pointer flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Add Provider</span>
                  </button>
                </div>
              )}

              {/* Manual Model ID Assignment */}
              <div className="pt-1 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-kin-muted">
                  <span>Assign / Type Any Model ID</span>
                  <span className="text-[9px] font-mono text-kin-subtle">e.g. openai/gpt-4o, anthropic/claude-3-7-sonnet</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="text"
                    placeholder="e.g. openai/gpt-4o or qwen2.5-coder:7b"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    className="flex-1 bg-kin-card border border-kin-border rounded px-2 py-1 text-[11px] text-kin-text font-mono placeholder-kin-subtle focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!customModelInput.trim()) return;
                      const mId = customModelInput.trim();
                      const res = await addCustomModel(mId);
                      if (!res?.success) {
                        setError(res?.error || `Failed to add model "${mId}"`);
                        return;
                      }
                      setActiveModelId(mId);
                      setCustomModelInput('');
                    }}
                    className="px-2.5 py-1 rounded bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 text-[10px] font-mono font-medium transition cursor-pointer whitespace-nowrap"
                  >
                    + Set Model
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-kin-muted font-medium">Custom Persona Instructions (Optional)</label>
              <textarea
                rows={3}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Specific instructions, domain expertise, and operational boundaries for this agent..."
                className="w-full bg-kin-card border border-kin-border rounded px-2.5 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 resize-none font-mono"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-kin-border">
              <button
                type="button"
                onClick={() => setAddAgentModalOpen(false)}
                className="px-3 py-1.5 rounded bg-kin-card text-kin-text hover:bg-kin-cardHover transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!displayName.trim() || isSubmitting}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium transition"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Hiring...' : 'Hire Agent'}</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Browse Models Dialog */}
      {isBrowseModelsOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn select-none">
          <div className="relative w-full max-w-2xl bg-kin-surface border border-kin-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-kin-border flex items-center justify-between bg-kin-surface">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-kin-text">Browse & Select Model</h3>
                  <p className="text-[11px] text-kin-muted">
                    Choose an active LLM for this new agent from verified local and cloud providers
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBrowseModelsOpen(false)}
                className="p-1 rounded-lg hover:bg-kin-cardHover text-kin-muted hover:text-kin-text transition cursor-pointer"
                title="Close Model Browser"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search & Capability Toggles */}
            <div className="p-4 border-b border-kin-border space-y-3 bg-kin-card">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-kin-muted pointer-events-none" />
                <input
                  type="text"
                  value={browseSearchQuery}
                  onChange={(e) => setBrowseSearchQuery(e.target.value)}
                  placeholder="Search models by name, ID, or provider (e.g. gpt-4o, claude-3-7, llama3)..."
                  className="w-full pl-9 pr-3 py-1.5 bg-kin-surface border border-kin-border rounded-lg text-xs text-kin-text placeholder-kin-subtle focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Capability Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setBrowseToolsOnly(!browseToolsOnly)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition cursor-pointer flex items-center space-x-1 border ${
                    browseToolsOnly
                      ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                      : 'bg-kin-surface hover:bg-kin-surfaceHover text-kin-muted border-kin-border'
                  }`}
                >
                  <Wrench className="w-3 h-3" />
                  <span>Tools</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBrowseVisionOnly(!browseVisionOnly)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition cursor-pointer flex items-center space-x-1 border ${
                    browseVisionOnly
                      ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                      : 'bg-kin-surface hover:bg-kin-surfaceHover text-kin-muted border-kin-border'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>Vision</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBrowseReasoningOnly(!browseReasoningOnly)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition cursor-pointer flex items-center space-x-1 border ${
                    browseReasoningOnly
                      ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                      : 'bg-kin-surface hover:bg-kin-surfaceHover text-kin-muted border-kin-border'
                  }`}
                >
                  <Brain className="w-3 h-3" />
                  <span>Reasoning</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBrowseFreeOnly(!browseFreeOnly)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition cursor-pointer flex items-center space-x-1 border ${
                    browseFreeOnly
                      ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-kin-surface hover:bg-kin-surfaceHover text-kin-muted border-kin-border'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Free Tier</span>
                </button>
              </div>

              {/* Provider Filter Pills */}
              <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
                <button
                  type="button"
                  onClick={() => setBrowseProviderFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer whitespace-nowrap ${
                    browseProviderFilter === 'all'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-kin-surface hover:bg-kin-surfaceHover text-kin-muted hover:text-kin-text border border-kin-border'
                  }`}
                >
                  All Providers ({verifiedModels.length})
                </button>
                {browseProviders.map((prov) => (
                  <button
                    key={prov.id}
                    type="button"
                    onClick={() => setBrowseProviderFilter(prov.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer whitespace-nowrap flex items-center space-x-1 ${
                      browseProviderFilter === prov.id
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-kin-surface hover:bg-kin-surfaceHover text-kin-muted hover:text-kin-text border border-kin-border'
                    }`}
                  >
                    <ProviderIcon provider={prov.id} className="w-3 h-3" />
                    <span>{prov.name}</span>
                    <span className="text-[10px] opacity-75 font-mono">({prov.count})</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => openAddProviderModal()}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer whitespace-nowrap flex items-center space-x-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30"
                  title="Configure another AI provider"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Add Provider</span>
                </button>
              </div>
            </div>

            {/* Model List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {browseFilteredModels.length === 0 ? (
                <div className="text-center py-10 space-y-3">
                  <Cpu className="w-8 h-8 text-kin-muted mx-auto opacity-50" />
                  <p className="text-xs text-kin-muted">No models match your search or filter criteria.</p>
                  <button
                    type="button"
                    onClick={() => openAddProviderModal()}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Add Provider</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {browseFilteredModels.map((m: AvailableModelItem) => {
                    const isSelected = m.id === activeModelId;
                    return (
                      <div
                        key={m.id}
                        onClick={() => {
                          setActiveModelId(m.id);
                          setIsBrowseModelsOpen(false);
                        }}
                        className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-blue-600/10 border-blue-500/50 text-kin-text shadow-sm'
                            : 'bg-kin-card hover:bg-kin-cardHover border-kin-border hover:border-kin-borderSubtle text-kin-text'
                        }`}
                      >
                        <div className="flex items-center space-x-3 min-w-0">
                          <div className="p-1.5 rounded-lg bg-kin-surface border border-kin-border shrink-0">
                            <ProviderIcon provider={m.provider || 'custom'} className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-semibold text-kin-text truncate">
                                {m.name || m.id}
                              </span>
                              {m.isFree && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-400">
                                  Free
                                </span>
                              )}
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-kin-surface text-kin-muted border border-kin-border">
                                {formatContextWindow(m.contextWindow)}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 text-[10px] text-kin-muted font-mono truncate mt-0.5">
                              <span>{m.id}</span>
                              <span className="text-kin-subtle">•</span>
                              <span className="capitalize">{m.provider}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          {isSelected ? (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-500 text-black text-xs font-semibold flex items-center space-x-1">
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                              <span>Selected</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveModelId(m.id);
                                setIsBrowseModelsOpen(false);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-kin-surface hover:bg-emerald-600 hover:text-white text-kin-muted border border-kin-border text-xs font-medium transition cursor-pointer"
                            >
                              Select
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-kin-border flex items-center justify-between bg-kin-surface">
              <button
                type="button"
                onClick={() => openAddProviderModal()}
                className="flex items-center space-x-1.5 text-xs text-kin-muted hover:text-emerald-400 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>+ Add Provider</span>
              </button>
              <button
                type="button"
                onClick={() => setIsBrowseModelsOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-kin-card hover:bg-kin-cardHover text-kin-text text-xs font-medium transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
