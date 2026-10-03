import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
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
    ollamaStatus,
  } = useKinStore();

  const [tab, setTab] = useState<'assign' | 'hire'>('assign');
  const [selectedAgentToAssign, setSelectedAgentToAssign] = useState('');
  
  // Hire form fields
  const [displayName, setDisplayName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [activeModelId, setActiveModelId] = useState('ollama/qwen2.5-coder:3b');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isAddAgentModalOpen) return null;

  const isChannel = !activeChannelId.startsWith('dm-');
  const activeChannel = channels.find((c) => c.id === activeChannelId);

  // Available project agents not already in this channel
  const availableToAssign = agents.filter(
    (ag) => !channelMembers.some((m) => m.id === ag.id)
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
                <div className="p-3 rounded bg-[#1e293b]/30 border border-[#1e293b] text-[#94a3b8] italic">
                  All agents in this project are already members of #{activeChannel?.name || 'this channel'}.
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

            <div className="space-y-1">
              <label className="text-[#94a3b8] font-medium">Configured Model</label>
              <select
                value={activeModelId}
                onChange={(e) => setActiveModelId(e.target.value)}
                className="w-full bg-[#090d16] border border-[#2d3748] rounded px-2.5 py-1.5 text-kin-text focus:outline-none focus:border-blue-500 cursor-pointer font-mono"
              >
                <optgroup label="Local Ollama Models">
                  {ollamaStatus.models.length > 0 ? (
                    ollamaStatus.models.map((m) => (
                      <option key={`ollama/${m}`} value={`ollama/${m}`}>
                        {m}
                      </option>
                    ))
                  ) : (
                    <option value="ollama/qwen2.5-coder:3b">qwen2.5-coder:3b</option>
                  )}
                </optgroup>
                <optgroup label="Cloud Providers">
                  <option value="anthropic/claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                  <option value="openai/gpt-4o">GPT-4o</option>
                  <option value="deepseek/deepseek-chat">DeepSeek V3</option>
                </optgroup>
              </select>
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
