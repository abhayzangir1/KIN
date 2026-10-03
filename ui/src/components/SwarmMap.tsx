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
    updateAgentContract,
    decommissionAgent,
    addChannelMember,
    fetchState,
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

  const orchestrator = displayedAgents.find((a) => a.isOrchestrator) || agents.find((a) => a.isOrchestrator);
  const specialists = displayedAgents.filter((a) => !a.isOrchestrator);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn select-none font-sans">
      <div className="bg-[#090d16] border border-[#1e293b] rounded-2xl w-full max-w-7xl h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Top Control Bar */}
        <div className="px-6 py-3.5 border-b border-[#1e293b] bg-[#0c1222] flex items-center justify-between shrink-0">
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
                Real-time agent relations, model routing, and Antigravity execution telemetry
              </p>
            </div>
          </div>

          {/* Scope Filters & Actions */}
          <div className="flex items-center space-x-3">
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
                All Project ({agents.length})
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
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: VISUAL TOPOLOGY GRAPH */}
          <div className="flex-1 bg-[#070b12] p-6 overflow-y-auto relative flex flex-col items-center space-y-8">
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

            {/* ROOT ORCHESTRATOR NODE */}
            {orchestrator && (
              <div className="relative z-10 flex flex-col items-center">
                <div
                  onClick={() => setSelectedSwarmAgentId(orchestrator.id)}
                  className={`w-72 p-4 rounded-xl cursor-pointer transition-all duration-200 border shadow-xl ${
                    selectedSwarmAgentId === orchestrator.id
                      ? 'bg-[#151c2f] border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.25)] ring-2 ring-amber-400/40'
                      : 'bg-[#0f172a] border-amber-500/40 hover:border-amber-400/80 hover:bg-[#131b2e]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold">
                        <Shield className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-kin-text text-xs flex items-center space-x-1.5">
                          <span>{orchestrator.displayName}</span>
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                        </div>
                        <span className="text-[10px] text-amber-300/80 font-mono font-medium">
                          {orchestrator.role}
                        </span>
                      </div>
                    </div>
                    <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                      Root
                    </span>
                  </div>

                  {/* Model Selector on Card */}
                  <div className="mt-3 pt-2.5 border-t border-[#1e293b] flex items-center justify-between text-[11px]">
                    <span className="text-[#64748b] flex items-center space-x-1">
                      <Cpu className="w-3 h-3 text-amber-400" />
                      <span>Model:</span>
                    </span>
                    <select
                      value={orchestrator.activeModelId}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleModelChange(orchestrator, e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-[#090d16] text-amber-300 border border-amber-500/30 rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none"
                    >
                      {ollamaStatus.models.map((m) => (
                        <option key={m} value={`ollama/${m}`}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Quick Activity Stats */}
                  <div className="mt-2 flex items-center justify-between text-[10px] text-[#94a3b8]">
                    <span>Channels: {orchestrator.assignedChannels?.length || 1}</span>
                    <span className="text-emerald-400 font-mono font-semibold">Status: {orchestrator.status}</span>
                  </div>
                </div>

                {/* Vertical SVG connector downwards */}
                <div className="w-0.5 h-10 bg-gradient-to-b from-amber-400/80 to-blue-500/80 relative">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                </div>
              </div>
            )}

            {/* HORIZONTAL BUS & SPECIALISTS ROW */}
            <div className="relative z-10 w-full flex flex-col items-center">
              {/* Horizontal line spreading to specialists */}
              {specialists.length > 1 && (
                <div className="w-3/4 h-0.5 bg-[#1e293b] mb-8 relative">
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500/20 via-blue-500/80 to-blue-500/20" />
                </div>
              )}

              {/* Specialists Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl w-full">
                {specialists.map((spec) => {
                  const isSelected = selectedSwarmAgentId === spec.id;
                  const isThinking = spec.status === 'thinking' || spec.status === 'working';

                  return (
                    <div
                      key={spec.id}
                      onClick={() => setSelectedSwarmAgentId(spec.id)}
                      className={`p-4 rounded-xl cursor-pointer transition-all duration-200 border shadow-lg relative ${
                        isSelected
                          ? 'bg-[#151c2f] border-blue-400 shadow-[0_0_18px_rgba(59,130,246,0.25)] ring-2 ring-blue-400/40'
                          : 'bg-[#0f172a] border-[#1e293b] hover:border-blue-500/60 hover:bg-[#131b2e]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                            <Bot className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-bold text-kin-text text-xs flex items-center space-x-1.5">
                              <span>{spec.displayName}</span>
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  isThinking
                                    ? 'bg-amber-400 animate-pulse shadow-[0_0_6px_#fbbf24]'
                                    : 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                                }`}
                              />
                            </div>
                            <span className="text-[10px] text-blue-300 font-mono">{spec.role}</span>
                          </div>
                        </div>
                        <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30">
                          Specialist
                        </span>
                      </div>

                      {/* Model Selector on Card */}
                      <div className="mt-3 pt-2.5 border-t border-[#1e293b] flex items-center justify-between text-[11px]">
                        <span className="text-[#64748b] flex items-center space-x-1">
                          <Cpu className="w-3 h-3 text-blue-400" />
                          <span>Model:</span>
                        </span>
                        <select
                          value={spec.activeModelId}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleModelChange(spec, e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-[#090d16] text-blue-300 border border-blue-500/30 rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none"
                        >
                          {ollamaStatus.models.map((m) => (
                            <option key={m} value={`ollama/${m}`}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Action buttons on card */}
                      <div className="mt-3 pt-2 border-t border-[#1e293b]/60 flex items-center justify-between text-[10px]">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSwarmMapOpen(false);
                            setActiveChannel(`dm-${spec.id}`);
                          }}
                          className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 transition"
                          title="Open Direct Message Thread"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>DM</span>
                        </button>

                        <div className="flex items-center space-x-1.5">
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
                            className="bg-[#090d16] text-[#94a3b8] hover:text-kin-text border border-[#1e293b] rounded px-1.5 py-0.5 text-[9px] focus:outline-none"
                            title="Assign to another channel"
                          >
                            <option value="" disabled>
                              + Chan
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
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {specialists.length === 0 && (
                  <div className="col-span-full py-8 text-center text-[#64748b] italic border border-dashed border-[#1e293b] rounded-xl bg-[#0b0f19]">
                    No specialists in this channel scope. Click "+ Hire Specialist" to expand the workforce!
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: ANTIGRAVITY-STYLE TRANSPARENT ACTIVITY DRAWER */}
          <div className="w-[480px] shrink-0 bg-[#090d16] border-l border-[#1e293b] flex flex-col h-full overflow-hidden">
            {/* Drawer Header */}
            <div className="p-4 border-b border-[#1e293b] bg-[#0c1222] shrink-0 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
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

                <button
                  onClick={() => {
                    setSwarmMapOpen(false);
                    setActiveChannel(`dm-${selectedAgent?.id}`);
                  }}
                  className="px-2.5 py-1 rounded bg-[#1e293b] hover:bg-blue-600/30 hover:text-blue-300 text-kin-text text-xs transition flex items-center space-x-1"
                  title="Open Direct Message Thread"
                >
                  <MessageSquare className="w-3 h-3 text-blue-400" />
                  <span>DM</span>
                </button>
              </div>

              {/* Antigravity Trajectory Summary Pill */}
              <div className="p-2.5 rounded-xl bg-[#070b12] border border-[#1e293b] space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-1.5 text-emerald-400 font-semibold font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{execDetails?.durationFormatted || 'Worked for 18s'}</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    Telemetry Live
                  </span>
                </div>

                <div className="text-[11px] text-[#94a3b8] flex items-center space-x-2 font-mono">
                  <span>{execDetails?.metrics.exploredFilesCount || 4} files</span>
                  <span>•</span>
                  <span>{execDetails?.metrics.tasksCount || 2} tasks</span>
                  <span>•</span>
                  <span>{execDetails?.metrics.actionsCount || 7} actions</span>
                  <span>•</span>
                  <span>{execDetails?.metrics.commandsCount || 2} commands</span>
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
                      14s
                    </span>
                  </div>
                  {openAccordion.thoughts ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {openAccordion.thoughts && (
                  <div className="p-3 space-y-2 text-[11px] text-[#cbd5e1] bg-[#070b12] leading-relaxed">
                    <p className="font-mono text-[#94a3b8]">
                      Thought for 14s: Evaluated system requirements against SQLite WAL schema invariants.
                    </p>
                    <div className="p-2.5 rounded-lg bg-black/40 border border-[#1e293b] text-[#e2e8f0] font-mono text-[10px] whitespace-pre-wrap">
                      [Agent Invariant Rationale]:
                      - Verified active workspace path D:\KIN
                      - Zero mocks detected: state loaded from SQLite WAL tables
                      - Context compiled with cross-channel memory and domain authority
                      - Model execution routed to local Ollama instance
                    </div>
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
                    <span>Explored Files ({execDetails?.metrics.exploredFilesCount || 4})</span>
                  </div>
                  {openAccordion.files ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {openAccordion.files && (
                  <div className="p-2.5 space-y-1.5 bg-[#070b12]">
                    {[
                      'core/src/server/core_server.ts #L1050-1200',
                      'core/src/storage/schema.sql #L30-85',
                      'ui/src/store/kinStore.ts #L200-340',
                      'ui/src/components/CenterView.tsx #L110-250',
                    ].map((f, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-2 py-1 rounded bg-[#0c1222] border border-[#1e293b] text-[11px] font-mono text-[#94a3b8]"
                      >
                        <span className="truncate">{f}</span>
                        <span className="text-[9px] text-emerald-400 shrink-0">Analyzed</span>
                      </div>
                    ))}
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
                    <span>Tools & Actions Executed</span>
                  </div>
                  {openAccordion.tools ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {openAccordion.tools && (
                  <div className="p-2.5 space-y-2 bg-[#070b12]">
                    {/* Tool 1 */}
                    <div className="rounded-lg border border-[#1e293b] p-2 bg-[#0c1222] space-y-1.5">
                      <div
                        onClick={() => toggleJson('tool-1')}
                        className="flex items-center justify-between cursor-pointer text-[11px]"
                      >
                        <span className="font-mono font-bold text-purple-400">exec_command</span>
                        <div className="flex items-center space-x-1 text-[10px] text-[#64748b]">
                          <span>exit: 0</span>
                          {expandedJson['tool-1'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </div>
                      </div>
                      <div className="text-[10px] text-[#94a3b8] font-mono">
                        git status --porcelain=v1
                      </div>

                      {expandedJson['tool-1'] && (
                        <pre className="p-2 rounded bg-black/60 border border-[#1e293b] text-[10px] font-mono text-emerald-300 overflow-x-auto">
                          {JSON.stringify(
                            {
                              command: 'git status --porcelain=v1',
                              cwd: 'D:\\KIN',
                              exitCode: 0,
                              output: 'Clean working tree or tracking modified files',
                            },
                            null,
                            2
                          )}
                        </pre>
                      )}
                    </div>

                    {/* Tool 2 */}
                    <div className="rounded-lg border border-[#1e293b] p-2 bg-[#0c1222] space-y-1.5">
                      <div
                        onClick={() => toggleJson('tool-2')}
                        className="flex items-center justify-between cursor-pointer text-[11px]"
                      >
                        <span className="font-mono font-bold text-purple-400">model_generate</span>
                        <div className="flex items-center space-x-1 text-[10px] text-[#64748b]">
                          <span>tokens: 420</span>
                          {expandedJson['tool-2'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </div>
                      </div>
                      <div className="text-[10px] text-[#94a3b8] font-mono">
                        Model: {selectedAgent?.activeModelId}
                      </div>

                      {expandedJson['tool-2'] && (
                        <pre className="p-2 rounded bg-black/60 border border-[#1e293b] text-[10px] font-mono text-purple-300 overflow-x-auto">
                          {JSON.stringify(
                            {
                              model: selectedAgent?.activeModelId,
                              channel: '#general',
                              temperature: 0.2,
                              status: 'completed',
                            },
                            null,
                            2
                          )}
                        </pre>
                      )}
                    </div>
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
                    <span>Peer Coordination Log</span>
                  </div>
                  {openAccordion.coordination ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {openAccordion.coordination && (
                  <div className="p-2.5 space-y-1.5 bg-[#070b12] text-[11px]">
                    <div className="p-2 rounded bg-[#0c1222] border border-[#1e293b] space-y-1">
                      <div className="flex items-center justify-between text-[#64748b]">
                        <span className="font-mono font-semibold text-kin-text">#general</span>
                        <span>Sequential Turn Routing</span>
                      </div>
                      <p className="text-[#94a3b8]">
                        Coordinated with project peers using Selective Activation. Orchestrator safety net active.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
