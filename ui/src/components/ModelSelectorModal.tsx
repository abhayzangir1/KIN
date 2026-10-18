import React, { useState, useMemo, useEffect } from 'react';
import { useKinStore, AvailableModelItem } from '../store/kinStore.js';
import {
  X,
  Search,
  Plus,
  Check,
  Cpu,
  Sparkles,
  Eye,
  Wrench,
  Brain,
  Layers,
  Terminal,
  Server,
  Zap,
  Activity,
  AlertTriangle
} from 'lucide-react';

export const ProviderIcon: React.FC<{ provider: string; className?: string }> = ({ provider, className = 'w-4 h-4' }) => {
  const norm = (provider || '').toLowerCase();
  if (norm.includes('openrouter')) {
    return <Layers className={`${className} text-indigo-400`} />;
  }
  if (norm.includes('openai')) {
    return <Sparkles className={`${className} text-emerald-400`} />;
  }
  if (norm.includes('anthropic') || norm.includes('claude')) {
    return <Brain className={`${className} text-amber-400`} />;
  }
  if (norm.includes('gemini') || norm.includes('google')) {
    return <Zap className={`${className} text-blue-400`} />;
  }
  if (norm.includes('deepseek')) {
    return <Activity className={`${className} text-cyan-400`} />;
  }
  if (norm.includes('groq')) {
    return <Zap className={`${className} text-orange-400`} />;
  }
  if (norm.includes('xai') || norm.includes('grok')) {
    return (
      <span className={`${className} font-bold font-mono text-purple-400 inline-flex items-center justify-center text-xs select-none`}>
        𝕏
      </span>
    );
  }
  if (norm.includes('azure')) {
    return <Server className={`${className} text-sky-400`} />;
  }
  if (norm.includes('copilot')) {
    return <Cpu className={`${className} text-cyan-400`} />;
  }
  if (norm.includes('ollama')) {
    return <Terminal className={`${className} text-emerald-300`} />;
  }
  return <Server className={`${className} text-slate-400`} />;
};

export function formatContextWindow(tokens?: number): string {
  if (!tokens || tokens <= 0) return '128K';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(tokens % 1000000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return `${tokens}`;
}

export const ModelSelectorModal: React.FC = () => {
  const {
    isModelSelectorOpen,
    modelSelectorTargetAgentId,
    closeModelSelector,
    openAddProviderModal,
    availableModels,
    credentials,
    ollamaStatus,
    agents,
    projects,
    activeProjectId,
    activeChannelId,
    channels,
    activeAgentChannels,
    updateAgentModel,
    addCustomModel,
  } = useKinStore();

  const [selectedProjectId, setSelectedProjectId] = useState<string>(activeProjectId || '');
  const [selectedChannelId, setSelectedChannelId] = useState<string>(activeChannelId || '');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [filterToolsOnly, setFilterToolsOnly] = useState(false);
  const [filterVisionOnly, setFilterVisionOnly] = useState(false);
  const [filterReasoningOnly, setFilterReasoningOnly] = useState(false);
  const [filterFreeOnly, setFilterFreeOnly] = useState(false);
  const [customModelInput, setCustomModelInput] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (activeProjectId && !selectedProjectId) {
      setSelectedProjectId(activeProjectId);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (activeChannelId && !selectedChannelId) {
      setSelectedChannelId(activeChannelId);
    }
  }, [activeChannelId]);

  useEffect(() => {
    if (modelSelectorTargetAgentId) {
      setSelectedAgentId(modelSelectorTargetAgentId);
    } else if (!selectedAgentId && agents.length > 0) {
      setSelectedAgentId(agents[0].id);
    }
  }, [modelSelectorTargetAgentId, agents]);

  const projectChannels = useMemo(() => {
    return channels.filter((c) => !selectedProjectId || c.projectId === selectedProjectId);
  }, [channels, selectedProjectId]);

  const projectAgents = useMemo(() => {
    return agents.filter((a) => !selectedProjectId || a.projectId === selectedProjectId);
  }, [agents, selectedProjectId]);

  const targetAgent = useMemo(() => {
    return projectAgents.find((a) => a.id === selectedAgentId) || projectAgents[0] || agents[0] || null;
  }, [projectAgents, agents, selectedAgentId]);

  const isAgentBusy = targetAgent?.status === 'working' || targetAgent?.status === 'thinking' || Boolean(activeAgentChannels[targetAgent?.id || '']);

  const activeModelId = targetAgent?.activeModelId || '';

  // Filter availableModels to strictly verified/configured models with no mock data
  const verifiedModels = useMemo(() => {
    return availableModels.filter((m) => {
      if (m.configured === false || m.validated === false) return false;
      if (m.provider === 'ollama' && !ollamaStatus.online && (!ollamaStatus.models || ollamaStatus.models.length === 0)) {
        return false;
      }
      return true;
    });
  }, [availableModels, ollamaStatus]);
  const addedProviders = useMemo(() => {
    const list: Array<{ id: string; name: string; count: number; isConfigured: boolean }> = [];
    const provSet = new Set<string>();

    // 1. Ollama
    const ollamaModels = verifiedModels.filter((m) => m.provider === 'ollama');
    if (ollamaStatus.online || ollamaModels.length > 0) {
      list.push({
        id: 'ollama',
        name: 'Ollama',
        count: ollamaModels.length || (ollamaStatus.models?.length ?? 0),
        isConfigured: true,
      });
      provSet.add('ollama');
    }

    // 2. Added Credentials from Settings/BYOK
    for (const cred of credentials) {
      if (cred.status !== 'revoked') {
        const pNorm = cred.provider.toLowerCase();
        if (!provSet.has(pNorm)) {
          provSet.add(pNorm);
          const count = verifiedModels.filter((m) => m.provider.toLowerCase() === pNorm).length;
          const displayNames: Record<string, string> = {
            openrouter: 'OpenRouter',
            anthropic: 'Anthropic',
            openai: 'OpenAI',
            azure: 'Azure',
            gemini: 'Google Gemini',
            deepseek: 'DeepSeek',
            groq: 'Groq',
            xai: 'xAI',
            ollama: 'Ollama',
            copilot: 'Copilot',
            openai_compatible: 'OpenAI Compatible',
            custom: 'Custom',
          };
          list.push({
            id: pNorm,
            name: displayNames[pNorm] || cred.provider,
            count,
            isConfigured: true,
          });
        }
      }
    }

    // 3. Any provider present in verifiedModels
    for (const m of verifiedModels) {
      const pNorm = (m.provider || 'custom').toLowerCase();
      if (!provSet.has(pNorm)) {
        provSet.add(pNorm);
        const count = verifiedModels.filter((item) => (item.provider || 'custom').toLowerCase() === pNorm).length;
        const displayNames: Record<string, string> = {
          openrouter: 'OpenRouter',
          anthropic: 'Anthropic',
          openai: 'OpenAI',
          azure: 'Azure',
          gemini: 'Google Gemini',
          deepseek: 'DeepSeek',
          groq: 'Groq',
          xai: 'xAI',
          ollama: 'Ollama',
          copilot: 'Copilot',
          openai_compatible: 'OpenAI Compatible',
          custom: 'Custom',
        };
        list.push({
          id: pNorm,
          name: displayNames[pNorm] || pNorm.toUpperCase(),
          count,
          isConfigured: m.configured !== false,
        });
      }
    }

    return list;
  }, [verifiedModels, credentials, ollamaStatus]);

  // Filter models based on search, provider pill, and capability toggles
  const filteredModels = useMemo(() => {
    return verifiedModels.filter((m) => {
      // Provider filter
      if (selectedProvider !== 'all') {
        if (m.provider.toLowerCase() !== selectedProvider.toLowerCase()) return false;
      }

      // Capability toggles
      if (filterToolsOnly && m.supportsTools === false) return false;
      if (filterVisionOnly && !m.supportsVision) return false;
      if (filterReasoningOnly && !m.supportsReasoning) return false;
      if (filterFreeOnly && !m.isFree) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesId = m.id.toLowerCase().includes(query);
        const matchesName = (m.name || '').toLowerCase().includes(query);
        const matchesProvider = (m.provider || '').toLowerCase().includes(query);
        const matchesDesc = (m.description || '').toLowerCase().includes(query);
        if (!matchesId && !matchesName && !matchesProvider && !matchesDesc) return false;
      }

      return true;
    });
  }, [verifiedModels, selectedProvider, filterToolsOnly, filterVisionOnly, filterReasoningOnly, filterFreeOnly, searchQuery]);

  const handleSelectModel = async (model: AvailableModelItem) => {
    if (isAgentBusy) return;
    if (!targetAgent) {
      // Standalone mode: give notification
      setNotification({ message: `Model ${model.name || model.id} is available for selection.`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const success = await updateAgentModel(targetAgent.id, model.id, selectedProjectId, selectedChannelId);
    if (success) {
      const channelLabel = selectedChannelId ? ` in #${projectChannels.find((c) => c.id === selectedChannelId)?.name || selectedChannelId}` : '';
      setNotification({
        message: `Set "${model.name || model.id}" for agent @${targetAgent.name || targetAgent.displayName}${channelLabel}!`,
        type: 'success',
      });
      setTimeout(() => {
        setNotification(null);
        closeModelSelector();
      }, 900);
    } else {
      setNotification({ message: `Failed to set model for agent. Agent may be actively working.`, type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleManualAssign = async () => {
    if (!customModelInput.trim()) return;
    const modelId = customModelInput.trim();
    await addCustomModel(modelId);
    if (targetAgent && !isAgentBusy) {
      await updateAgentModel(targetAgent.id, modelId, selectedProjectId, selectedChannelId);
      setNotification({ message: `Assigned model "${modelId}" to @${targetAgent.name || targetAgent.displayName}`, type: 'success' });
      setTimeout(() => {
        setNotification(null);
        closeModelSelector();
      }, 900);
    } else {
      setNotification({ message: `Registered custom model "${modelId}" in catalog.`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    }
    setCustomModelInput('');
  };

  if (!isModelSelectorOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[88vh] bg-[#0c1017] border border-[#1e293b] rounded-xl shadow-2xl flex flex-col overflow-hidden text-kin-text animate-scaleUp">
        
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1e293b] bg-[#0f1420]/70">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h2 className="text-sm font-semibold text-white tracking-wide">
                  Assign Language Model
                </h2>
                <div className="flex items-center space-x-1.5 bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-0.5">
                  <span className="text-[10px] text-[#8b949e] font-mono">Project:</span>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => {
                      const newProj = e.target.value;
                      setSelectedProjectId(newProj);
                      const firstChan = channels.find((c) => c.projectId === newProj);
                      if (firstChan) setSelectedChannelId(firstChan.id);
                    }}
                    className="bg-transparent text-[11px] text-emerald-300 font-mono focus:outline-none cursor-pointer"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id} className="bg-[#0f1420] text-white">
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center space-x-1.5 bg-[#161b22] border border-[#30363d] rounded-lg px-2 py-0.5">
                  <span className="text-[10px] text-[#8b949e] font-mono">Channel:</span>
                  <select
                    value={selectedChannelId}
                    onChange={(e) => setSelectedChannelId(e.target.value)}
                    className="bg-transparent text-[11px] text-blue-300 font-mono focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-[#0f1420] text-slate-400">All Project Channels (Default)</option>
                    {projectChannels.map((c) => (
                      <option key={c.id} value={c.id} className="bg-[#0f1420] text-white">
                        #{c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-[#64748b] mt-0.5">
                Model configurations are stored per-agent in this project. Only verified, active local &amp; cloud models are displayed.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {/* Target Agent Selector Dropdown */}
            {projectAgents.length > 0 && (
              <div className="flex items-center space-x-1.5 bg-[#161b22] border border-[#30363d] rounded-lg px-2.5 py-1">
                <span className="text-[11px] text-[#8b949e] font-mono">Agent:</span>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="bg-transparent text-xs text-white font-mono focus:outline-none cursor-pointer"
                >
                  {projectAgents.map((ag) => (
                    <option key={ag.id} value={ag.id} className="bg-[#0f1420] text-white">
                      {ag.displayName} ({ag.role || (ag.isOrchestrator ? 'Boss' : 'Spec')})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {/* + Add Models / Add Provider Dropdown Button (Matches Reference Image 2) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Add Models</span>
              </button>

              {showAddMenu && (
                <div
                  className="absolute right-0 mt-1.5 w-60 bg-[#0f1623] border border-[#1e293b] rounded-lg shadow-2xl py-1 z-50 text-xs animate-fadeIn"
                  onMouseLeave={() => setShowAddMenu(false)}
                >
                  <div className="px-3 py-1.5 text-[10px] font-semibold tracking-wider text-[#64748b] uppercase border-b border-[#1e293b]/70">
                    Add Language Model Provider
                  </div>
                  {[
                    { id: 'anthropic', name: 'Anthropic' },
                    { id: 'azure', name: 'Azure' },
                    { id: 'gemini', name: 'Google' },
                    { id: 'openai', name: 'OpenAI' },
                    { id: 'openrouter', name: 'OpenRouter' },
                    { id: 'xai', name: 'xAI' },
                    { id: 'ollama', name: 'Ollama' },
                    { id: 'openai_compatible', name: 'OpenAI Compatible' },
                    { id: 'custom', name: 'Custom Endpoint' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setShowAddMenu(false);
                        openAddProviderModal(p.id);
                      }}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-left hover:bg-sky-500/10 hover:text-sky-300 transition text-[#cbd5e1] cursor-pointer"
                    >
                      <ProviderIcon provider={p.id} className="w-3.5 h-3.5" />
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={closeModelSelector}
              className="p-1.5 rounded-lg hover:bg-white/5 text-[#94a3b8] hover:text-white transition cursor-pointer"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Notification Toast */}
        {notification && (
          <div
            className={`px-4 py-2 text-xs flex items-center justify-between border-b ${
              notification.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                : 'bg-red-950/60 border-red-500/40 text-red-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              {notification.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              <span>{notification.message}</span>
            </div>
          </div>
        )}

        {/* Busy Agent Concurrency Lock Banner */}
        {isAgentBusy && (
          <div className="mx-5 my-2.5 px-3.5 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center space-x-2 text-amber-300 text-xs shrink-0 animate-fadeIn">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              Agent <strong>@{targetAgent?.displayName || targetAgent?.name}</strong> is currently active ({targetAgent?.status || 'working'}). Model switching is locked to prevent execution conflicts.
            </span>
          </div>
        )}

        {/* Top Controls: Search Bar & Capability Filters */}
        <div className="px-5 pt-3 pb-2.5 border-b border-[#1e293b]/70 flex flex-wrap items-center justify-between gap-3 bg-[#0a0e17]">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748b]" />
            <input
              type="text"
              placeholder="Type to search models by name, ID, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#05080f] border border-[#1e293b] rounded-lg pl-9 pr-8 py-1.5 text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-emerald-500 font-mono transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[#64748b] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Capability Toggles */}
          <div className="flex items-center space-x-1.5 text-xs">
            <button
              type="button"
              onClick={() => setFilterToolsOnly(!filterToolsOnly)}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                filterToolsOnly
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                  : 'bg-[#0f1420] text-[#64748b] border-[#1e293b] hover:text-[#94a3b8]'
              }`}
            >
              <Wrench className="w-3 h-3" />
              <span>Tools</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterVisionOnly(!filterVisionOnly)}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                filterVisionOnly
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                  : 'bg-[#0f1420] text-[#64748b] border-[#1e293b] hover:text-[#94a3b8]'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Vision</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterReasoningOnly(!filterReasoningOnly)}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                filterReasoningOnly
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-[#0f1420] text-[#64748b] border-[#1e293b] hover:text-[#94a3b8]'
              }`}
            >
              <Brain className="w-3 h-3" />
              <span>Reasoning</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterFreeOnly(!filterFreeOnly)}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                filterFreeOnly
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-[#0f1420] text-[#64748b] border-[#1e293b] hover:text-[#94a3b8]'
              }`}
            >
              <span>Free Tier</span>
            </button>
          </div>
        </div>

        {/* Provider Pill Bar with + Button (Matches Reference Images 1 & 3) */}
        <div className="px-5 py-2.5 border-b border-[#1e293b]/70 bg-[#070a12] flex items-center space-x-2 overflow-x-auto scrollbar-none">
          <span className="text-[11px] text-[#64748b] font-medium mr-1 shrink-0">Providers:</span>

          {/* "All" Pill */}
          <button
            type="button"
            onClick={() => setSelectedProvider('all')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer shrink-0 ${
              selectedProvider === 'all'
                ? 'bg-white text-black shadow-md font-semibold'
                : 'bg-[#151c2c] text-[#94a3b8] hover:text-white hover:bg-[#1a2336] border border-[#1e293b]'
            }`}
          >
            <span>All Models</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${selectedProvider === 'all' ? 'bg-black/20 text-black' : 'bg-black/40 text-[#64748b]'}`}>
              {availableModels.length}
            </span>
          </button>

          {/* Configured & Added Provider Pills */}
          {addedProviders.map((prov) => {
            const isSelected = selectedProvider.toLowerCase() === prov.id.toLowerCase();
            return (
              <button
                key={prov.id}
                type="button"
                onClick={() => setSelectedProvider(prov.id)}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer shrink-0 ${
                  isSelected
                    ? 'bg-white text-black shadow-md font-semibold'
                    : 'bg-[#151c2c] text-[#cbd5e1] hover:text-white hover:bg-[#1a2336] border border-[#1e293b]'
                }`}
              >
                <ProviderIcon provider={prov.id} className="w-3.5 h-3.5" />
                <span>{prov.name}</span>
                {prov.count > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${isSelected ? 'bg-black/20 text-black' : 'bg-black/40 text-[#64748b]'}`}>
                    {prov.count}
                  </span>
                )}
              </button>
            );
          })}

          {/* + Add Provider Button (Matching Image 1 & 3: Pill '+' button directly in pill bar) */}
          <button
            type="button"
            onClick={() => openAddProviderModal()}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition cursor-pointer shrink-0"
            title="Configure a new provider API key or local Ollama"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Provider</span>
          </button>
        </div>

        {/* Table Column Headers (Matching Reference Image 2) */}
        <div className="grid grid-cols-12 gap-3 px-6 py-2 border-b border-[#1e293b]/70 bg-[#070a12] text-[11px] font-semibold text-[#64748b] select-none">
          <div className="col-span-6 flex items-center space-x-2">
            <span>Name</span>
          </div>
          <div className="col-span-2 text-center">
            <span>Context Size</span>
          </div>
          <div className="col-span-3 text-center">
            <span>Capabilities</span>
          </div>
          <div className="col-span-1 text-right">
            <span>{targetAgent ? 'Select' : 'Status'}</span>
          </div>
        </div>

        {/* Model List / Table */}
        <div className="flex-1 overflow-y-auto min-h-[300px] max-h-[52vh] p-2 divide-y divide-[#1e293b]/40">
          {filteredModels.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#64748b] flex flex-col items-center justify-center space-y-3">
              <Cpu className="w-8 h-8 text-[#475569] animate-pulse" />
              <div>
                <p className="font-medium text-white">No models match your search or filter.</p>
                <p className="text-xs text-[#64748b] mt-1">
                  Click <strong>+ Add Models</strong> to configure API keys for Anthropic, Azure, OpenAI, Google, OpenRouter, xAI, or local Ollama.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openAddProviderModal()}
                className="mt-2 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition cursor-pointer"
              >
                + Configure Provider Key
              </button>
            </div>
          ) : (
            filteredModels.map((model) => {
              const isActiveForAgent = targetAgent ? activeModelId === model.id : false;
              return (
                <div
                  key={model.id}
                  onClick={() => {
                    if (isAgentBusy) return;
                    handleSelectModel(model);
                  }}
                  className={`group grid grid-cols-12 gap-3 items-center px-4 py-2.5 rounded-lg transition border ${
                    isAgentBusy
                      ? 'opacity-50 cursor-not-allowed bg-slate-900/30'
                      : 'cursor-pointer hover:bg-[#141b2b]'
                  } ${
                    isActiveForAgent
                      ? 'bg-emerald-500/10 border-emerald-500/40 shadow-sm'
                      : 'border-transparent hover:border-[#1e293b]'
                  }`}
                  title={isAgentBusy ? `Agent is busy. Model switching is locked.` : `Select ${model.name || model.id}`}
                >
                  {/* Name Column: Eyeball Icon + Provider Icon + Name + ID */}
                  <div className="col-span-6 flex items-center space-x-2.5 min-w-0 pr-2">
                    <span title="Model visible in catalog" className="shrink-0 flex items-center">
                      <Eye className="w-3.5 h-3.5 text-[#475569] group-hover:text-slate-300" />
                    </span>
                    <ProviderIcon provider={model.provider} className="w-4 h-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className={`text-xs font-semibold truncate ${isActiveForAgent ? 'text-emerald-300' : 'text-white group-hover:text-sky-300'}`}>
                          {model.name || model.id}
                        </span>

                        {isActiveForAgent && (
                          <span className="flex items-center space-x-1 px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono shrink-0">
                            <Check className="w-2.5 h-2.5" />
                            <span>Active</span>
                          </span>
                        )}

                        {model.isFree && (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-mono shrink-0">
                            Free Tier
                          </span>
                        )}

                        {model.isCustom && (
                          <span className="px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-300 text-[10px] font-mono shrink-0">
                            Custom
                          </span>
                        )}
                      </div>

                      <div className="text-[10px] font-mono text-[#64748b] truncate mt-0.5">
                        {model.id}
                      </div>
                    </div>
                  </div>

                  {/* Context Size Column */}
                  <div className="col-span-2 flex justify-center">
                    <span className="font-mono text-xs text-[#94a3b8] px-2 py-0.5 rounded bg-black/40 border border-[#1e293b]" title="Context Window Size">
                      {formatContextWindow(model.contextWindow)}
                    </span>
                  </div>

                  {/* Capabilities Column */}
                  <div className="col-span-3 flex justify-center items-center space-x-1.5">
                    {model.supportsTools !== false && (
                      <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/20 text-[10px] font-mono flex items-center space-x-1" title="Supports Function / Tool Calling">
                        <Wrench className="w-2.5 h-2.5" />
                        <span>Tools</span>
                      </span>
                    )}

                    {model.supportsVision && (
                      <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/20 text-[10px] font-mono flex items-center space-x-1" title="Supports Multimodal / Vision Input">
                        <Eye className="w-2.5 h-2.5" />
                        <span>Vision</span>
                      </span>
                    )}

                    {model.supportsReasoning && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20 text-[10px] font-mono flex items-center space-x-1" title="Extended Thinking / Reasoning Model">
                        <Brain className="w-2.5 h-2.5" />
                        <span>Reasoning</span>
                      </span>
                    )}
                  </div>

                  {/* Action Column */}
                  <div className="col-span-1 flex justify-end">
                    {targetAgent ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectModel(model);
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition cursor-pointer flex items-center space-x-1 ${
                          isActiveForAgent
                            ? 'bg-emerald-500 text-black font-semibold'
                            : 'bg-[#1e293b] hover:bg-emerald-600 hover:text-white text-[#cbd5e1]'
                        }`}
                      >
                        {isActiveForAgent ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span className="hidden sm:inline">Set</span>
                          </>
                        ) : (
                          <span>Assign</span>
                        )}
                      </button>
                    ) : (
                      <span className="text-[10px] text-[#64748b] font-mono">Available</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer: Direct Manual Model ID Assignment */}
        <div className="px-5 py-3 border-t border-[#1e293b] bg-[#070b13] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2 flex-1 min-w-[280px]">
            <span className="text-[#64748b] whitespace-nowrap text-[11px]">Direct Model ID:</span>
            <input
              type="text"
              placeholder="e.g. openai/gpt-4.5-preview or custom/local-llama"
              value={customModelInput}
              onChange={(e) => setCustomModelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleManualAssign();
              }}
              className="flex-1 bg-[#04060a] border border-[#1e293b] rounded px-2.5 py-1 text-xs text-white font-mono placeholder-[#475569] focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={handleManualAssign}
              disabled={!customModelInput.trim()}
              className="px-3 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              + Set Model
            </button>
          </div>

          <div className="text-[11px] text-[#64748b] font-mono flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Automatic fallback disabled (operator controlled)</span>
          </div>
        </div>

      </div>
    </div>
  );
};
