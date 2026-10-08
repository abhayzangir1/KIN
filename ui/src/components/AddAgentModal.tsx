import React, { useState } from 'react';
import { useKinStore, isAgentAvailable } from '../store/kinStore.js';
import { X, UserPlus, UserCheck, Bot } from 'lucide-react';

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
  } = useKinStore();

  const [tab, setTab] = useState<'assign' | 'hire'>('assign');
  const [selectedAgentToAssign, setSelectedAgentToAssign] = useState('');
  
  // Hire form fields
  const [displayName, setDisplayName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [activeModelId, setActiveModelId] = useState('ollama/qwen2.5-coder:3b');
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
    await addChannelMember(activeChannelId, selectedAgentToAssign);
    setSelectedAgentToAssign('');
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
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl w-full max-w-lg shadow-2xl p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#1e293b]">
          <div className="flex items-center space-x-2">
            <Bot className="w-5 h-5 text-blue-400" />
            <h2 className="text-sm font-bold text-kin-text">
              {isChannel ? `Manage Channel Agents (#${activeChannel?.name || 'channel'})` : 'Hire Project Specialist'}
            </h2>
          </div>
          <button
            onClick={() => setAddAgentModalOpen(false)}
            className="text-[#64748b] hover:text-kin-text transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Toggle (Only show Assign tab if in channel and unassigned agents exist) */}
        {isChannel && (
          <div className="grid grid-cols-2 gap-1 bg-[#090d16] p-1 rounded-lg border border-[#1e293b] text-xs">
            <button
              onClick={() => { setTab('assign'); setError(''); }}
              className={`py-1.5 rounded-md font-medium transition ${
                tab === 'assign'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-[#64748b] hover:text-kin-text'
              }`}
            >
              Assign Existing Project Agent
            </button>
            <button
              onClick={() => { setTab('hire'); setError(''); }}
              className={`py-1.5 rounded-md font-medium transition ${
                tab === 'hire'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-[#64748b] hover:text-kin-text'
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
              <label className="text-[#94a3b8] font-medium">Select Project Agent</label>
              {availableToAssign.length > 0 ? (
                <select
                  value={selectedAgentToAssign}
                  onChange={(e) => setSelectedAgentToAssign(e.target.value)}
                  className="w-full bg-[#090d16] border border-[#2d3748] rounded px-3 py-2 text-kin-text focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="">-- Choose agent to assign --</option>
                  {availableToAssign.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.displayName} ({ag.role})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="p-3 rounded bg-[#1e293b]/30 border border-[#1e293b] text-[#94a3b8] italic text-center space-y-1">
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

            <div className="flex justify-end space-x-2 pt-2 border-t border-[#1e293b]">
              <button
                type="button"
                onClick={() => setAddAgentModalOpen(false)}
                className="px-3 py-1.5 rounded bg-[#1e293b] text-[#cbd5e1] hover:bg-[#334155] transition"
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
                <label className="text-[#94a3b8] font-medium">Display Name (@handle)</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. @ResearchAgent"
                  className="w-full bg-[#090d16] border border-[#2d3748] rounded px-2.5 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[#94a3b8] font-medium">Specialist Role Title</label>
                <input
                  type="text"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. Research Specialist"
                  className="w-full bg-[#090d16] border border-[#2d3748] rounded px-2.5 py-1.5 text-kin-text focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[#94a3b8] font-medium">Configured Model</label>
                <div className="flex items-center space-x-1 p-0.5 bg-[#090d16] rounded border border-[#1e293b] text-[10px]">
                  <button
                    type="button"
                    onClick={() => setModelTierFilter('all')}
                    className={`px-2 py-0.5 rounded transition ${
                      modelTierFilter === 'all' ? 'bg-blue-600 text-white font-medium' : 'text-[#64748b] hover:text-[#94a3b8]'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setModelTierFilter('free')}
                    className={`px-2 py-0.5 rounded transition ${
                      modelTierFilter === 'free' ? 'bg-emerald-600 text-white font-medium' : 'text-[#64748b] hover:text-[#94a3b8]'
                    }`}
                  >
                    Free Tier
                  </button>
                  <button
                    type="button"
                    onClick={() => setModelTierFilter('paid')}
                    className={`px-2 py-0.5 rounded transition ${
                      modelTierFilter === 'paid' ? 'bg-purple-600 text-white font-medium' : 'text-[#64748b] hover:text-[#94a3b8]'
                    }`}
                  >
                    Paid
                  </button>
                </div>
              </div>
              <select
                value={activeModelId}
                onChange={(e) => setActiveModelId(e.target.value)}
                className="w-full bg-[#090d16] border border-[#2d3748] rounded px-2.5 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 cursor-pointer font-mono"
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
                {['anthropic', 'openai', 'gemini', 'deepseek', 'groq', 'openrouter'].map((prov) => {
                  const provModels = filteredModels.filter((m) => m.provider === prov && m.configured !== false);
                  if (provModels.length === 0) return null;
                  const provLabel =
                    prov === 'anthropic' ? 'Anthropic Cloud Models' :
                    prov === 'openai' ? 'OpenAI Cloud Models' :
                    prov === 'gemini' ? 'Google Gemini Models' :
                    prov === 'deepseek' ? 'DeepSeek Models' :
                    prov === 'groq' ? 'Groq LPU Models' :
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

              {/* Manual Model ID Assignment */}
              <div className="pt-1 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-[#64748b]">
                  <span>Assign / Type Any Model ID</span>
                  <span className="text-[9px] font-mono text-[#475569]">e.g. openai/gpt-4o, anthropic/claude-3-7-sonnet</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="text"
                    placeholder="e.g. openai/gpt-4o or qwen2.5-coder:7b"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    className="flex-1 bg-[#090d16] border border-[#2d3748] rounded px-2 py-1 text-[11px] text-kin-text font-mono placeholder-[#475569] focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!customModelInput.trim()) return;
                      const mId = customModelInput.trim();
                      await addCustomModel(mId);
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
              <label className="text-[#94a3b8] font-medium">Custom Persona Instructions (Optional)</label>
              <textarea
                rows={3}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Specific instructions, domain expertise, and operational boundaries for this agent..."
                className="w-full bg-[#090d16] border border-[#2d3748] rounded px-2.5 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 resize-none font-mono"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-[#1e293b]">
              <button
                type="button"
                onClick={() => setAddAgentModalOpen(false)}
                className="px-3 py-1.5 rounded bg-[#1e293b] text-[#cbd5e1] hover:bg-[#334155] transition"
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
    </div>
  );
};
