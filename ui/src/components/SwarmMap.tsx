import React, { useState, useEffect } from 'react';
import { useKinStore, AgentDisplay } from '../store/kinStore.js';
import {
  Network,
  Bot,
  Shield,
  Terminal,
  FileCode,
  Clock,
  ChevronDown,
  ChevronRight,
  UserPlus,
  X,
  Sparkles,
  Layers,
  MessageSquare,
  Cpu,
  RefreshCw,
  Trash2,
  GitFork,
  PanelRight,
  PanelRightClose,
} from 'lucide-react';

export const SwarmMap: React.FC = () => {
  const {
    isSwarmMapOpen,
    setSwarmMapOpen,
    agents,
    channels,
    activeChannelId,
    setActiveChannel,
    selectedSwarmAgentId,
    setSelectedSwarmAgentId,
    agentExecutionDetails,
    isLoadingExecutionDetails,
    fetchAgentExecutionDetails,
    setAddAgentModalOpen,
    ollamaStatus,
    availableModels,
    updateAgentContract,
    decommissionAgent,
    addChannelMember,
    fetchState,
    agentThinkingDrafts,
    agentLiveTools,
  } = useKinStore();

  const [filterScope, setFilterScope] = useState<'all' | 'channel'>('all');
  const [selectedChannelId, setSelectedChannelId] = useState<string>(
    activeChannelId.startsWith('dm-') ? 'chan-general' : activeChannelId
  );
  const [openAccordion, setOpenAccordion] = useState<Record<string, boolean>>({
    thoughts: true,
    tools: true,
    files: true,
    commands: true,
    coordination: true,
  });
  const [expandedJson, setExpandedJson] = useState<Record<string, boolean>>({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Active agents based on filter
  const displayedAgents =
    filterScope === 'all'
      ? agents
      : agents.filter((ag) => {
          const chan = channels.find((c) => c.id === selectedChannelId);
          return chan?.memberIds?.includes(ag.id) || ag.isOrchestrator;
        });

  const selectedAgent =
    agents.find((a) => a.id === selectedSwarmAgentId) ||
    displayedAgents[0] ||
    agents[0];

  const execDetails = selectedAgent ? agentExecutionDetails[selectedAgent.id] : null;

  useEffect(() => {
    if (isSwarmMapOpen && selectedAgent) {
      fetchAgentExecutionDetails(selectedAgent.id);
    }
  }, [isSwarmMapOpen, selectedAgent?.id]);

  if (!isSwarmMapOpen) return null;

  const toggleAccordion = (section: string) => {
    setOpenAccordion((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleJson = (itemId: string) => {
    setExpandedJson((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const handleModelChange = async (agent: AgentDisplay, newModel: string) => {
    await updateAgentContract(agent.id, agent.role, newModel);
    fetchAgentExecutionDetails(agent.id);
  };

  const renderModelOptions = (currentModelId: string) => {
    const localOllama = availableModels.filter((m) => m.provider === 'ollama');
    const freeCloud = availableModels.filter((m) => m.provider !== 'ollama' && m.isFree && m.configured !== false);
    const paidCloud = availableModels.filter((m) => m.provider !== 'ollama' && !m.isFree && m.configured !== false);
    const hasCurrent = availableModels.some((m) => m.id === currentModelId) || (ollamaStatus.models && ollamaStatus.models.some((m) => `ollama/${m}` === currentModelId));

    return (
      <>
        {localOllama.length > 0 ? (
          <optgroup label="Local Ollama">
            {localOllama.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id} (Local)
              </option>
            ))}
          </optgroup>
        ) : ollamaStatus.models?.length > 0 ? (
          <optgroup label="Local Ollama">
            {ollamaStatus.models.map((m) => (
              <option key={m} value={`ollama/${m}`}>
                {m} (Local)
              </option>
            ))}
          </optgroup>
        ) : null}

        {freeCloud.length > 0 && (
          <optgroup label="Free Cloud (OpenRouter)">
            {freeCloud.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id} (Free)
              </option>
            ))}
          </optgroup>
        )}

        {paidCloud.length > 0 && (
          <optgroup label="Cloud Models">
            {paidCloud.slice(0, 30).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id}
              </option>
            ))}
          </optgroup>
        )}

        {currentModelId && !hasCurrent && (
          <optgroup label="Active Selected">
            <option value={currentModelId}>{currentModelId}</option>
          </optgroup>
        )}

        <option value="inherit">inherit (Project Default)</option>
      </>
    );
  };

  const orchestrator = displayedAgents.find((a) => a.isOrchestrator) || agents.find((a) => a.isOrchestrator);
  const specialists = displayedAgents.filter((a) => !a.isOrchestrator);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 animate-fadeIn select-none font-sans">
      <div className="bg-[#090d16] border border-[#1e293b] rounded-2xl w-full max-w-7xl h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Top Control Bar */}
        <div className="px-6 py-3.5 border-b border-[#1e293b] bg-[#0c1222] flex items-center justify-between shrink-0 flex-wrap gap-2">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-kin-text text-sm tracking-wide">
                  Autonomous Workforce Swarm Map
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold">
                  Live Hierarchy
                </span>
              </div>
              <p className="text-[11px] text-[#64748b]">
                Multi-agent organizational hierarchy, model routing, and Antigravity execution telemetry
              </p>
            </div>
          </div>

          {/* Scope Filters & Actions */}
          <div className="flex items-center space-x-2.5">
            {/* Filter Scope Toggle */}
            <div className="flex items-center bg-[#070b12] p-0.5 rounded-lg border border-[#1e293b]">
              <button
                onClick={() => setFilterScope('all')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                  filterScope === 'all'
                    ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-[#64748b] hover:text-kin-text'
                }`}
              >
                All Workforce ({agents.length})
              </button>
              <button
                onClick={() => setFilterScope('channel')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                  filterScope === 'channel'
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-[#64748b] hover:text-kin-text'
                }`}
              >
                By Channel
              </button>
            </div>

            {/* Channel Dropdown if filterScope is channel */}
            {filterScope === 'channel' && (
              <select
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className="bg-[#070b12] text-kin-text border border-[#1e293b] rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-blue-500"
              >
                {channels
                  .filter((c) => !c.id.startsWith('dm-'))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
              </select>
            )}

            {/* Hire Specialist Button */}
            <button
              onClick={() => {
                setSwarmMapOpen(false);
                setAddAgentModalOpen(true);
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-900/30 transition"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Hire Specialist</span>
            </button>

            {/* Toggle Activity Drawer */}
            <button
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                isDrawerOpen
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                  : 'bg-[#1e293b] border-[#334155] text-[#94a3b8] hover:text-white'
              }`}
              title={isDrawerOpen ? 'Collapse Agent Activity Drawer' : 'Open Agent Activity Drawer'}
            >
              {isDrawerOpen ? <PanelRightClose className="w-3.5 h-3.5 text-blue-400" /> : <PanelRight className="w-3.5 h-3.5 text-blue-400" />}
              <span>{isDrawerOpen ? 'Drawer' : 'Inspect'}</span>
            </button>

            {/* Refresh */}
            <button
              onClick={() => {
                fetchState();
                if (selectedAgent) fetchAgentExecutionDetails(selectedAgent.id);
              }}
              className="p-1.5 rounded-lg bg-[#1e293b] hover:bg-[#2d3748] text-[#94a3b8] hover:text-kin-text transition"
              title="Refresh State"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* Close */}
            <button
              onClick={() => setSwarmMapOpen(false)}
              className="p-1.5 rounded-lg bg-[#1e293b] hover:bg-red-500/20 hover:text-red-400 text-[#94a3b8] transition"
              title="Close Swarm Map"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body: Left Visual Graph + Right Antigravity Activity Drawer */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* LEFT: VISUAL TOPOLOGY GRAPH */}
          <div className="flex-1 bg-[#070b12] p-8 overflow-auto relative flex flex-col items-center select-none">
            {/* Visual Background Grid Lines */}
            <div
              className="absolute inset-0 pointer-events-none opacity-20"
              style={{
                backgroundImage:
                  'radial-gradient(#334155 1px, transparent 1px), radial-gradient(#334155 1px, #070b12 1px)',
                backgroundSize: '24px 24px',
                backgroundPosition: '0 0, 12px 12px',
              }}
            />

            {/* TIER 1: ROOT WORKFORCE ORCHESTRATOR */}
            <div className="relative z-10 flex flex-col items-center w-full max-w-5xl">
              <div className="flex items-center space-x-2 px-3.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono font-bold tracking-wider mb-3 shadow-[0_0_12px_rgba(251,191,36,0.15)]">
                <Shield className="w-4 h-4 text-amber-400" />
                <span>TIER 1: WORKFORCE ORCHESTRATOR (ROOT COORDINATOR)</span>
              </div>

              {orchestrator && (
                <div
                  onClick={() => {
                    setSelectedSwarmAgentId(orchestrator.id);
                    setIsDrawerOpen(true);
                  }}
                  className={`w-80 md:w-96 p-4 rounded-2xl cursor-pointer transition-all duration-200 border shadow-2xl ${
                    selectedSwarmAgentId === orchestrator.id
                      ? 'bg-[#151c2f] border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.3)] ring-2 ring-amber-400/50'
                      : 'bg-[#0f172a] border-amber-500/40 hover:border-amber-400/80 hover:bg-[#131b2e]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold shadow-inner">
                        <Shield className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-bold text-kin-text text-sm flex items-center space-x-1.5">
                          <span>{orchestrator.displayName}</span>
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                        </div>
                        <span className="text-[11px] text-amber-300/90 font-mono font-medium">
                          {orchestrator.role || 'Workspace Orchestrator & Delegator'}
                        </span>
                      </div>
                    </div>
                    <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                      ROOT
                    </span>
                  </div>

                  {/* Model Selector on Card */}
                  <div className="mt-3 pt-2.5 border-t border-[#1e293b] flex items-center justify-between text-xs">
                    <span className="text-[#64748b] flex items-center space-x-1 font-mono text-[11px]">
                      <Cpu className="w-3.5 h-3.5 text-amber-400" />
                      <span>Model:</span>
                    </span>
                    <select
                      value={orchestrator.activeModelId}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleModelChange(orchestrator, e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-[#090d16] text-amber-300 border border-amber-500/30 rounded-lg px-2 py-0.5 text-[11px] font-mono focus:outline-none cursor-pointer max-w-[210px] truncate"
                    >
                      {renderModelOptions(orchestrator.activeModelId)}
                    </select>
                  </div>

                  {/* Quick Activity Stats */}
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#94a3b8] font-mono">
                    <span>Channels: {orchestrator.assignedChannels?.length || 1}</span>
                    <span className="text-emerald-400 font-semibold">Status: {orchestrator.status}</span>
                  </div>

                  {/* Live Thinking / Active Tool Pill */}
                  {agentThinkingDrafts[orchestrator.id] && (
                    <div className="mt-2.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] flex items-center space-x-1.5 animate-pulse">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="font-mono truncate">
                        🧠 Thinking: {agentThinkingDrafts[orchestrator.id].slice(-60)}
                      </span>
                    </div>
                  )}
                  {(agentLiveTools[orchestrator.id] || orchestrator.currentTool) && (
                    <div className="mt-2.5 p-2 rounded-lg bg-purple-500/15 border border-purple-500/40 text-purple-300 text-[10px] flex items-center space-x-1.5 animate-pulse">
                      <Terminal className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span className="font-mono truncate font-semibold">
                        ⚡ Tool: {agentLiveTools[orchestrator.id]?.toolName || orchestrator.currentTool}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* TREE HIERARCHY CONNECTOR & DISTRIBUTION BUS */}
              <div className="w-full flex flex-col items-center my-3 select-none pointer-events-none">
                {/* Vertical Trunk */}
                <div className="w-0.5 h-8 bg-gradient-to-b from-amber-400 via-blue-400 to-blue-500 relative">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                </div>
                {/* Junction Node */}
                <div className="px-3 py-1 rounded-full bg-[#0c1427] border border-blue-500/50 text-[10px] font-mono text-blue-300 flex items-center space-x-1.5 shadow-lg">
                  <GitFork className="w-3 h-3 text-blue-400" />
                  <span>Task Delegation & Tool Routing Bus</span>
                </div>
                {/* Horizontal Tree Bus */}
                {specialists.length > 0 && (
                  <div className="w-full max-w-4xl h-0.5 bg-gradient-to-r from-transparent via-blue-500/60 to-transparent mt-2" />
                )}
              </div>

              {/* TIER 2: DOMAIN SPECIALISTS & WORKFORCE */}
              <div className="flex items-center space-x-2 px-3.5 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs font-mono font-bold tracking-wider my-3 shadow-[0_0_12px_rgba(59,130,246,0.15)]">
                <Bot className="w-4 h-4 text-blue-400" />
                <span>TIER 2: DOMAIN SPECIALISTS ({specialists.length} ACTIVE IN WORKFORCE)</span>
              </div>

              {/* Specialists Cards Container */}
              <div className="flex flex-wrap justify-center gap-6 max-w-6xl w-full pb-16">
                {specialists.map((spec) => {
                  const isSelected = selectedSwarmAgentId === spec.id;
                  const isThinking = spec.status === 'thinking' || spec.status === 'working';

                  return (
                    <div
                      key={spec.id}
                      onClick={() => {
                        setSelectedSwarmAgentId(spec.id);
                        setIsDrawerOpen(true);
                      }}
                      className={`w-[320px] max-w-[340px] flex-shrink-0 p-4 rounded-2xl cursor-pointer transition-all duration-200 border shadow-xl relative ${
                        isSelected
                          ? 'bg-[#131d35] border-blue-400 shadow-[0_0_24px_rgba(59,130,246,0.3)] ring-2 ring-blue-400/50 scale-[1.02]'
                          : 'bg-[#0c1427] border-slate-800 hover:border-blue-500/60 hover:bg-[#101a30]'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold shadow-inner shrink-0">
                            <Bot className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-bold text-kin-text text-sm flex items-center space-x-1.5">
                              <span>{spec.displayName}</span>
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  isThinking
                                    ? 'bg-amber-400 animate-pulse shadow-[0_0_6px_#fbbf24]'
                                    : 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                                }`}
                              />
                            </div>
                            <span className="text-[11px] text-blue-300/90 font-mono font-medium block leading-snug">
                              {spec.role}
                            </span>
                          </div>
                        </div>
                        <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30 shrink-0">
                          Specialist
                        </span>
                      </div>

                      {/* Model Selector on Card */}
                      <div className="mt-3 pt-2.5 border-t border-[#1e293b] flex items-center justify-between text-xs">
                        <span className="text-[#64748b] flex items-center space-x-1 font-mono text-[11px]">
                          <Cpu className="w-3.5 h-3.5 text-blue-400" />
                          <span>Model:</span>
                        </span>
                        <select
                          value={spec.activeModelId}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleModelChange(spec, e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-[#090d16] text-blue-300 border border-blue-500/30 rounded-lg px-2 py-0.5 text-[11px] font-mono focus:outline-none cursor-pointer max-w-[210px] truncate"
                        >
                          {renderModelOptions(spec.activeModelId)}
                        </select>
                      </div>

                      {/* Live Thinking / Active Tool Pill */}
                      {agentThinkingDrafts[spec.id] && (
                        <div className="mt-2.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] flex items-center space-x-1.5 animate-pulse">
                          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="font-mono truncate">
                            🧠 Thinking: {agentThinkingDrafts[spec.id].slice(-60)}
                          </span>
                        </div>
                      )}
                      {(agentLiveTools[spec.id] || spec.currentTool) && (
                        <div className="mt-2.5 p-2 rounded-lg bg-purple-500/15 border border-purple-500/40 text-purple-300 text-[10px] flex items-center space-x-1.5 animate-pulse">
                          <Terminal className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          <span className="font-mono truncate font-semibold">
                            ⚡ Tool: {agentLiveTools[spec.id]?.toolName || spec.currentTool}
                          </span>
                        </div>
                      )}

                      {/* Action buttons on card */}
                      <div className="mt-3 pt-2.5 border-t border-[#1e293b]/70 flex items-center justify-between text-[11px]">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSwarmMapOpen(false);
                            setActiveChannel(`dm-${spec.id}`);
                          }}
                          className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 transition font-medium"
                          title="Open Direct Message Thread"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Direct Message</span>
                        </button>

                        <div className="flex items-center space-x-2">
                          {/* Channel quick enroll dropdown */}
                          <select
                            onClick={(e) => e.stopPropagation()}
                            onChange={async (e) => {
                              e.stopPropagation();
                              const targetChanId = e.target.value;
                              if (targetChanId) {
                                await addChannelMember(targetChanId, spec.id);
                              }
                            }}
                            defaultValue=""
                            className="bg-[#090d16] text-[#94a3b8] hover:text-kin-text border border-[#1e293b] rounded-md px-1.5 py-0.5 text-[10px] focus:outline-none"
                            title="Assign to another channel"
                          >
                            <option value="" disabled>
                              + Assign Channel
                            </option>
                            {channels
                              .filter((c) => !c.id.startsWith('dm-') && !spec.assignedChannels?.includes(c.id))
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  #{c.name}
                                </option>
                              ))}
                          </select>

                          {/* Decommission specialist */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (window.confirm(`Decommission and remove ${spec.displayName} from workforce?`)) {
                                await decommissionAgent(spec.id);
                              }
                            }}
                            className="p-1 rounded text-[#64748b] hover:text-red-400 hover:bg-red-500/10 transition"
                            title={`Decommission ${spec.displayName}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {specialists.length === 0 && (
                  <div className="col-span-full py-10 px-6 text-center text-[#64748b] italic border border-dashed border-[#1e293b] rounded-2xl bg-[#0b0f19]">
                    No specialists found in this channel scope. Click "+ Hire Specialist" to expand the workforce!
                  </div>
                )}
              </div>
            </div>

            {/* Quick Inspect Floating Pill when Drawer is Closed */}
            {!isDrawerOpen && selectedAgent && (
              <button
                onClick={() => setIsDrawerOpen(true)}
                className="fixed bottom-10 right-10 z-30 flex items-center space-x-2 px-4 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-2xl shadow-blue-900/60 text-xs font-semibold transition cursor-pointer border border-blue-400/40 animate-fadeIn"
                title={`Inspect ${selectedAgent.displayName}`}
              >
                <PanelRight className="w-4 h-4" />
                <span>Inspect {selectedAgent.displayName} Activity</span>
              </button>
            )}
          </div>

          {/* RIGHT: ANTIGRAVITY-STYLE TRANSPARENT ACTIVITY DRAWER */}
          {isDrawerOpen && (
            <div className="w-[380px] lg:w-[420px] shrink-0 bg-[#090d16] border-l border-[#1e293b] flex flex-col h-full overflow-hidden animate-fadeIn">
              {/* Drawer Header */}
              <div className="p-4 border-b border-[#1e293b] bg-[#0c1222] shrink-0 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#1e293b] border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                      {selectedAgent?.isOrchestrator ? <Shield className="w-4 h-4 text-amber-400" /> : <Bot className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="font-bold text-kin-text text-sm flex items-center space-x-1.5">
                        <span>{selectedAgent?.displayName}</span>
                        <span className="text-[10px] text-[#64748b] font-normal">({selectedAgent?.role})</span>
                      </div>
                      <span className="text-[10px] text-blue-400 font-mono">{selectedAgent?.activeModelId}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => {
                        setSwarmMapOpen(false);
                        setActiveChannel(`dm-${selectedAgent?.id}`);
                      }}
                      className="px-2.5 py-1 rounded-md bg-[#1e293b] hover:bg-blue-600/30 hover:text-blue-300 text-kin-text text-xs transition flex items-center space-x-1"
                      title="Open Direct Message Thread"
                    >
                      <MessageSquare className="w-3 h-3 text-blue-400" />
                      <span>DM</span>
                    </button>

                    <button
                      onClick={() => setIsDrawerOpen(false)}
                      className="p-1 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition"
                      title="Close Activity Drawer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

              {/* Antigravity Trajectory Summary Pill */}
              <div className="p-2.5 rounded-xl bg-[#070b12] border border-[#1e293b] space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-1.5 text-emerald-400 font-semibold font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{execDetails?.durationFormatted || '0s'}</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    Telemetry Live
                  </span>
                </div>

                <div className="text-[11px] text-[#94a3b8] flex items-center space-x-2 font-mono">
                  <span>{execDetails?.metrics?.exploredFilesCount ?? 0} files</span>
                  <span>•</span>
                  <span>{execDetails?.metrics?.tasksCount ?? 0} tasks</span>
                  <span>•</span>
                  <span>{execDetails?.metrics?.actionsCount ?? 0} actions</span>
                  <span>•</span>
                  <span>{execDetails?.metrics?.commandsCount ?? 0} commands</span>
                </div>
              </div>
            </div>

            {/* Execution Accordion Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 font-sans text-xs">
              {isLoadingExecutionDetails && (
                <div className="text-center py-6 text-[#64748b] flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Loading execution trajectory...</span>
                </div>
              )}

              {/* 1. THOUGHTS & REASONING SECTION */}
              <div className="border border-[#1e293b] rounded-xl overflow-hidden bg-[#0c1222]">
                <button
                  onClick={() => toggleAccordion('thoughts')}
                  className="w-full px-3 py-2 bg-[#0e1628] flex items-center justify-between font-semibold text-kin-text text-xs hover:bg-[#131d35] transition"
                >
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Thoughts & Reasoning</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">
                      {execDetails?.phases?.find((p) => p.id === 'phase-reasoning')?.durationFormatted || execDetails?.durationFormatted || 'Live'}
                    </span>
                  </div>
                  {openAccordion.thoughts ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {openAccordion.thoughts && (
                  <div className="p-3 space-y-2 text-[11px] text-[#cbd5e1] bg-[#070b12] leading-relaxed">
                    {/* Live in-flight streaming thought */}
                    {agentThinkingDrafts[selectedAgent?.id || ''] && (
                      <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/40 text-amber-200 space-y-1.5 animate-pulse">
                        <div className="flex items-center justify-between text-[10px] font-mono text-amber-400 font-bold">
                          <div className="flex items-center space-x-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                            <span>LIVE AGENT REASONING STREAM</span>
                          </div>
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[9px]">ACTIVE</span>
                        </div>
                        <div className="font-mono text-[11px] whitespace-pre-wrap leading-relaxed text-amber-100">
                          {agentThinkingDrafts[selectedAgent?.id || '']}
                          <span className="inline-block w-1.5 h-3.5 bg-amber-400 ml-1 animate-pulse align-middle" />
                        </div>
                      </div>
                    )}

                    {execDetails?.phases?.find((p) => p.id === 'phase-reasoning')?.items?.map((item: any, idx: number) => (
                      <div key={item.id || idx} className="p-2.5 rounded-lg bg-black/40 border border-[#1e293b] text-[#e2e8f0] font-mono text-[10px] whitespace-pre-wrap">
                        {item.summary}
                        {item.details?.reasoning && (
                          <div className="mt-1 text-[#94a3b8]">{item.details.reasoning}</div>
                        )}
                      </div>
                    )) || (
                      <p className="font-mono text-[#94a3b8]">
                        Selected agent is active and ready in workspace. No past reasoning trace recorded.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 2. EXPLORED FILES SECTION */}
              <div className="border border-[#1e293b] rounded-xl overflow-hidden bg-[#0c1222]">
                <button
                  onClick={() => toggleAccordion('files')}
                  className="w-full px-3 py-2 bg-[#0e1628] flex items-center justify-between font-semibold text-kin-text text-xs hover:bg-[#131d35] transition"
                >
                  <div className="flex items-center space-x-2">
                    <FileCode className="w-3.5 h-3.5 text-blue-400" />
                    <span>Explored Files ({execDetails?.exploredFiles?.length || execDetails?.metrics.exploredFilesCount || 0})</span>
                  </div>
                  {openAccordion.files ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {openAccordion.files && (
                  <div className="p-2.5 space-y-1.5 bg-[#070b12]">
                    {(execDetails?.exploredFiles && execDetails.exploredFiles.length > 0) ? (
                      execDetails.exploredFiles.map((f: string, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between px-2 py-1 rounded bg-[#0c1222] border border-[#1e293b] text-[11px] font-mono text-[#94a3b8]"
                        >
                          <span className="truncate">{f}</span>
                          <span className="text-[9px] text-emerald-400 shrink-0">Analyzed</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-[11px] font-mono text-[#64748b] text-center py-2">
                        No files accessed yet in this session
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 3. TOOLS & MCP ACTIONS SECTION */}
              <div className="border border-[#1e293b] rounded-xl overflow-hidden bg-[#0c1222]">
                <button
                  onClick={() => toggleAccordion('tools')}
                  className="w-full px-3 py-2 bg-[#0e1628] flex items-center justify-between font-semibold text-kin-text text-xs hover:bg-[#131d35] transition"
                >
                  <div className="flex items-center space-x-2">
                    <Terminal className="w-3.5 h-3.5 text-purple-400" />
                    <span>Tools & Actions Executed ({execDetails?.phases?.find((p) => p.id === 'phase-tools')?.items?.length || execDetails?.metrics.actionsCount || 0})</span>
                  </div>
                  {openAccordion.tools ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {openAccordion.tools && (
                  <div className="p-2.5 space-y-2 bg-[#070b12]">
                    {/* Live in-flight executing action */}
                    {(agentLiveTools[selectedAgent?.id || ''] || selectedAgent?.currentTool) && (
                      <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/50 text-purple-200 space-y-1.5 animate-pulse">
                        <div className="flex items-center justify-between text-[10px] font-mono text-purple-300 font-bold">
                          <div className="flex items-center space-x-1.5">
                            <Terminal className="w-3.5 h-3.5 text-purple-400" />
                            <span>CURRENTLY EXECUTING ACTION</span>
                          </div>
                          <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-[9px]">RUNNING</span>
                        </div>
                        <div className="font-mono text-xs font-bold text-white flex items-center space-x-1.5">
                          <span>Tool:</span>
                          <span className="text-purple-300 underline underline-offset-2">
                            {agentLiveTools[selectedAgent?.id || '']?.toolName || selectedAgent?.currentTool}
                          </span>
                        </div>
                        {agentLiveTools[selectedAgent?.id || '']?.params && Object.keys(agentLiveTools[selectedAgent?.id || '']?.params || {}).length > 0 && (
                          <pre className="p-2 rounded bg-black/60 border border-purple-500/30 text-[10px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(agentLiveTools[selectedAgent?.id || '']?.params, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}

                    {execDetails?.phases?.find((p) => p.id === 'phase-tools')?.items?.length ? (
                      execDetails.phases.find((p) => p.id === 'phase-tools')!.items.map((item: any, idx: number) => {
                        const itemKey = item.id || `tool-${idx}`;
                        return (
                          <div key={itemKey} className="rounded-lg border border-[#1e293b] p-2 bg-[#0c1222] space-y-1.5">
                            <div
                              onClick={() => toggleJson(itemKey)}
                              className="flex items-center justify-between cursor-pointer text-[11px]"
                            >
                              <span className="font-mono font-bold text-purple-400">{item.summary || item.type}</span>
                              <div className="flex items-center space-x-1 text-[10px] text-[#64748b]">
                                {item.details?.exitCode !== undefined && <span>exit: {item.details.exitCode}</span>}
                                {expandedJson[itemKey] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </div>
                            </div>
                            {item.details?.command && (
                              <div className="text-[10px] text-[#94a3b8] font-mono">
                                {item.details.command}
                              </div>
                            )}
                            {expandedJson[itemKey] && (
                              <pre className="p-2 rounded bg-black/60 border border-[#1e293b] text-[10px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                                {JSON.stringify(item.details || item, null, 2)}
                              </pre>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-[11px] font-mono text-[#64748b] text-center py-2">
                        No tool actions executed yet
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 4. PEER COORDINATION LOG SECTION */}
              <div className="border border-[#1e293b] rounded-xl overflow-hidden bg-[#0c1222]">
                <button
                  onClick={() => toggleAccordion('coordination')}
                  className="w-full px-3 py-2 bg-[#0e1628] flex items-center justify-between font-semibold text-kin-text text-xs hover:bg-[#131d35] transition"
                >
                  <div className="flex items-center space-x-2">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Peer Coordination Log ({execDetails?.peerCoordination?.length || 0})</span>
                  </div>
                  {openAccordion.coordination ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {openAccordion.coordination && (
                  <div className="p-2.5 space-y-1.5 bg-[#070b12] text-[11px]">
                    {execDetails?.peerCoordination && execDetails.peerCoordination.length > 0 ? (
                      execDetails.peerCoordination.map((pc: any, idx: number) => (
                        <div key={idx} className="p-2 rounded bg-[#0c1222] border border-[#1e293b] space-y-1">
                          <div className="flex items-center justify-between text-[#64748b]">
                            <span className="font-mono font-semibold text-kin-text">{pc.channelName || '#general'}</span>
                            <span className="text-emerald-400 font-mono">{pc.targetAgent}</span>
                          </div>
                          <p className="text-[#94a3b8] font-mono text-[10px]">
                            {pc.action}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="text-[11px] font-mono text-[#64748b] text-center py-2">
                        No cross-agent coordination recorded yet
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
  );
};
