import React, { useState, useMemo } from 'react';
import {
  Users,
  X,
  Search,
  UserPlus,
  Bot,
  MessageSquare,
  Sliders,
  Cpu,
  Terminal,
  Globe,
  Wrench,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useKinStore } from '../../store/kinStore.js';
import { AgentModelBadge } from '../AgentModelBadge.js';

export const WorkforceManagerModal: React.FC = () => {
  const {
    isWorkforceModalOpen,
    setWorkforceModalOpen,
    agents,
    availableModels,
    channels,
    activeChannelId,
    setAddAgentModalOpen,
    setSelectedAgentId,
    setActiveRightTab,
    setInspectorOpen,
    setActiveChannel,
    setActiveMainView,
    openAgentSettings,
  } = useKinStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'channel'>('all');
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  const filteredAgents = useMemo(() => {
    let list = agents;
    if (scopeFilter === 'channel' && activeChannel) {
      const channelName = activeChannel.name.toLowerCase();
      list = list.filter((ag) =>
        ag.isOrchestrator ||
        ag.assignedChannels?.some((ch) => ch.toLowerCase().replace(/^#/, '') === channelName)
      );
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (ag) =>
        ag.name.toLowerCase().includes(q) ||
        ag.displayName.toLowerCase().includes(q) ||
        (ag.role && ag.role.toLowerCase().includes(q)) ||
        (ag.systemPrompt && ag.systemPrompt.toLowerCase().includes(q)) ||
        ag.assignedChannels?.some((ch) => ch.toLowerCase().includes(q))
    );
  }, [agents, searchQuery, scopeFilter, activeChannel]);

  if (!isWorkforceModalOpen) return null;

  const orchestrators = agents.filter((a) => a.isOrchestrator);
  const specialists = agents.filter((a) => !a.isOrchestrator);
  const activeCount = agents.filter((a) => a.status === 'thinking' || a.status === 'working').length;

  const handleStartDm = (agentId: string) => {
    setActiveChannel(`dm-${agentId}`);
    setActiveMainView('chat');
    setWorkforceModalOpen(false);
  };

  const handleInspect = (agentId: string) => {
    setSelectedAgentId(agentId);
    setActiveRightTab('Agent');
    setInspectorOpen(true);
    setWorkforceModalOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Team Workforce Hub"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={() => setWorkforceModalOpen(false)}
    >
      <div
        className="relative w-full max-w-5xl max-h-[90vh] bg-kin-surface/95 border border-kin-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-kin-border flex items-center justify-between shrink-0 bg-kin-surface/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 shadow-xs">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-kin-text tracking-tight">Team Workforce Hub</h2>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-mono text-xs font-semibold border border-blue-500/20">
                  {agents.length} Agents
                </span>
              </div>
              <p className="text-xs text-kin-muted mt-0.5">
                Centralized registry to manage, tune instructions, allocate models, and inspect specialist coworkers
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={() => {
                setWorkforceModalOpen(false);
                setAddAgentModalOpen(true);
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-900/30 transition cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ New Specialist</span>
            </button>
            <button
              onClick={() => setWorkforceModalOpen(false)}
              className="p-1.5 rounded-lg text-kin-muted hover:text-kin-text hover:bg-kin-card transition cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toolbar & Filter Bar */}
        <div className="px-6 py-3 border-b border-kin-border/80 bg-kin-card/40 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-2 flex-1 min-w-[280px]">
            {/* Search Box */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-kin-muted" />
              <input
                type="text"
                placeholder="Search specialists by name, role, capability or channel..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-kin-surface border border-kin-border text-xs text-kin-text placeholder-kin-subtle focus:outline-none focus:border-kin-accent focus:ring-1 focus:ring-kin-accent transition"
              />
            </div>

            {/* Scope Filter Pill Selector */}
            <div className="flex items-center p-0.5 rounded-xl bg-kin-surface border border-kin-border text-xs shrink-0 select-none">
              <button
                type="button"
                onClick={() => setScopeFilter('all')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  scopeFilter === 'all'
                    ? 'bg-kin-card text-kin-text shadow-xs'
                    : 'text-kin-muted hover:text-kin-text'
                }`}
              >
                All ({agents.length})
              </button>
              {activeChannel && (
                <button
                  type="button"
                  onClick={() => setScopeFilter('channel')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                    scopeFilter === 'channel'
                      ? 'bg-kin-card text-emerald-400 shadow-xs'
                      : 'text-kin-muted hover:text-kin-text'
                  }`}
                >
                  #{activeChannel.name}
                </button>
              )}
            </div>
          </div>

          {/* Quick Stats Pills */}
          <div className="flex items-center space-x-2 text-[11px] font-mono text-kin-muted">
            <span className="px-2.5 py-1 rounded-lg bg-kin-surface border border-kin-border flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>Orchestrators: {orchestrators.length}</span>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-kin-surface border border-kin-border flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span>Specialists: {specialists.length}</span>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-kin-surface border border-kin-border flex items-center space-x-1">
              <span className={`w-1.5 h-1.5 rounded-full ${activeCount > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
              <span>Active Runs: {activeCount}</span>
            </span>
          </div>
        </div>

        {/* Agent Cards Grid */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {filteredAgents.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Users className="w-10 h-10 text-kin-muted mx-auto opacity-40" />
              <div className="text-sm font-semibold text-kin-text">No Agents Found</div>
              <p className="text-xs text-kin-muted max-w-sm mx-auto">
                No specialists match your search criteria. Try a different search term or hire a new specialist coworker.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredAgents.map((agent) => {
                const isWorking = agent.status === 'working' || agent.status === 'thinking';
                const isExpanded = expandedPromptId === agent.id;

                return (
                  <div
                    key={agent.id}
                    className="p-5 rounded-2xl bg-kin-card border border-kin-border hover:border-kin-accent/40 shadow-sm transition space-y-3 group relative flex flex-col justify-between"
                  >
                    {/* Top Identity Row */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 min-w-0">
                        {/* Avatar */}
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm font-bold text-white text-sm border ${
                            agent.isOrchestrator
                              ? 'bg-gradient-to-br from-amber-500 to-amber-700 border-amber-400/40'
                              : 'bg-gradient-to-br from-blue-600 to-indigo-700 border-blue-400/30'
                          }`}
                        >
                          <Bot className="w-5 h-5" />
                        </div>

                        {/* Name & Role */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-2">
                            <h3 className="font-bold text-sm text-kin-text truncate">{agent.displayName}</h3>
                            {agent.isOrchestrator ? (
                              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono font-bold shrink-0">
                                Orchestrator
                              </span>
                            ) : (
                              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 font-mono font-bold shrink-0">
                                Specialist
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-kin-muted truncate mt-0.5">
                            {agent.role || 'Autonomous Task Specialist'}
                          </p>
                        </div>
                      </div>

                      {/* Status Indicator */}
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isWorking ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'
                          }`}
                        />
                        <span className="text-[10px] font-mono text-kin-muted capitalize">
                          {agent.status || 'Ready'}
                        </span>
                      </div>
                    </div>

                    {/* Active LLM Model Allocation Badge */}
                    <div className="p-2.5 rounded-xl bg-kin-surface border border-kin-border/80 flex items-center justify-between">
                      <div className="flex items-center space-x-2 truncate">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span className="text-xs text-kin-text font-medium truncate">Active Model:</span>
                      </div>
                      <AgentModelBadge agent={agent} availableModels={availableModels} compact />
                    </div>

                    {/* Assigned Channels & Tool Tags */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-kin-muted">
                        <span>Assigned Channels:</span>
                        <div className="flex items-center space-x-1 flex-wrap justify-end">
                          {(agent.assignedChannels || ['#general']).map((ch) => (
                            <span
                              key={ch}
                              className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px] border border-emerald-500/20"
                            >
                              {ch.startsWith('#') ? ch : `#${ch}`}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Capabilities pills */}
                      <div className="flex items-center space-x-1 text-[10px] text-kin-muted/80 flex-wrap pt-0.5">
                        <span className="px-1.5 py-0.5 rounded bg-kin-surface border border-kin-border flex items-center space-x-1">
                          <Terminal className="w-2.5 h-2.5 text-emerald-400" />
                          <span>Shell Jail</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-kin-surface border border-kin-border flex items-center space-x-1">
                          <Globe className="w-2.5 h-2.5 text-blue-400" />
                          <span>Browser</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-kin-surface border border-kin-border flex items-center space-x-1">
                          <Wrench className="w-2.5 h-2.5 text-purple-400" />
                          <span>MCP Tools</span>
                        </span>
                      </div>
                    </div>

                    {/* System Instructions Preview / Accordion with Quick Tune */}
                    {agent.systemPrompt && (
                      <div className="rounded-xl bg-kin-surface/60 border border-kin-border/60 overflow-hidden text-xs">
                        <div className="w-full px-3 py-1.5 flex items-center justify-between text-kin-muted hover:text-kin-text transition bg-kin-surface/40 select-none">
                          <button
                            type="button"
                            onClick={() => setExpandedPromptId(isExpanded ? null : agent.id)}
                            className="flex items-center space-x-2 truncate flex-1 text-left cursor-pointer"
                          >
                            <span className="font-mono text-[10px] uppercase font-bold text-kin-muted">
                              System Directive
                            </span>
                            <span className="text-[10px] font-mono text-kin-muted">
                              {isExpanded ? '(Collapse)' : '(Preview)'}
                            </span>
                          </button>
                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openAgentSettings(agent.id);
                              }}
                              className="px-1.5 py-0.5 rounded hover:bg-kin-card text-cyan-400 hover:text-cyan-300 font-mono text-[10px] flex items-center space-x-1 transition cursor-pointer"
                              title={`Quick tune system prompt for ${agent.displayName}`}
                            >
                              <Sliders className="w-2.5 h-2.5" />
                              <span>Tune</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedPromptId(isExpanded ? null : agent.id)}
                              className="p-0.5 text-kin-muted hover:text-kin-text cursor-pointer"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="p-3 border-t border-kin-border/40 font-mono text-[11px] text-kin-text/80 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                            {agent.systemPrompt}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Buttons Toolbar */}
                    <div className="pt-2 border-t border-kin-border/80 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleStartDm(agent.id)}
                        className="flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 border border-blue-500/30 text-xs font-semibold transition cursor-pointer"
                        title={`Open 1-on-1 DM with ${agent.displayName}`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Direct Chat</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openAgentSettings(agent.id)}
                        className="flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-xl bg-kin-surface hover:bg-kin-card text-kin-text border border-kin-border text-xs font-semibold transition cursor-pointer"
                        title={`Tune instructions, prompt, and parameters for ${agent.displayName}`}
                      >
                        <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Tune Agent</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleInspect(agent.id)}
                        className="py-1.5 px-3 rounded-xl bg-kin-surface hover:bg-kin-card text-kin-muted hover:text-kin-text border border-kin-border text-xs font-semibold transition cursor-pointer"
                        title={`Inspect telemetry and execution details for ${agent.displayName}`}
                      >
                        <span>Telemetry</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
