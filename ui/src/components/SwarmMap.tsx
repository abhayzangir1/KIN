import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useKinStore } from '../store/kinStore.js';
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
  Search,
  Radio,
  Activity,
  Zap,
  Workflow,
  ArrowRight,
  Lock,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Move,
  GripVertical,
  Hammer,
} from 'lucide-react';

export const SwarmMap: React.FC = () => {
  const {
    isSwarmMapOpen,
    setSwarmMapOpen,
    agents,
    channels,
    activeProjectId,
    activeChannelId,
    setActiveChannel,
    selectedSwarmAgentId,
    setSelectedSwarmAgentId,
    agentExecutionDetails,
    isLoadingExecutionDetails,
    fetchAgentExecutionDetails,
    setAddAgentModalOpen,
    openModelSelector,
    decommissionAgent,
    fetchState,
    agentThinkingDrafts,
    agentLiveTools,
    latestDelegation,
    activeAgentChannels,
    coordinationLinks,
    availableModels,
    fetchAvailableModels,
    updateAgentModel,
  } = useKinStore();

  const [filterScope, setFilterScope] = useState<'all' | 'channel'>('all');
  const [selectedChannelId, setSelectedChannelId] = useState<string>(
    activeChannelId.startsWith('dm-') ? 'chan-general' : activeChannelId
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'flow' | 'hierarchy' | 'matrix'>(() => {
    try {
      const saved = localStorage.getItem(`kin_swarm_viewmode_${activeProjectId || 'default'}`);
      return (saved as any) || 'flow';
    } catch {
      return 'flow';
    }
  });
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  // Free-Form Pan & Zoom Canvas State (Persisted per project)
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`kin_swarm_zoom_${activeProjectId || 'default'}`);
      return saved ? parseFloat(saved) : 1.0;
    } catch {
      return 1.0;
    }
  });
  const [pan, setPan] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem(`kin_swarm_pan_${activeProjectId || 'default'}`);
      return saved ? JSON.parse(saved) : { x: 0, y: 0 };
    } catch {
      return { x: 0, y: 0 };
    }
  });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // User-defined Dragged Node Positions
  const [userPositions, setUserPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      const saved = localStorage.getItem(`kin_swarm_positions_${activeProjectId || 'default'}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Re-synchronize user positions, viewMode, pan, and zoom when active project changes
  useEffect(() => {
    try {
      const savedPos = localStorage.getItem(`kin_swarm_positions_${activeProjectId || 'default'}`);
      setUserPositions(savedPos ? JSON.parse(savedPos) : {});

      const savedView = localStorage.getItem(`kin_swarm_viewmode_${activeProjectId || 'default'}`);
      if (savedView) setViewMode(savedView as any);

      const savedZoom = localStorage.getItem(`kin_swarm_zoom_${activeProjectId || 'default'}`);
      if (savedZoom) setZoom(parseFloat(savedZoom));

      const savedPan = localStorage.getItem(`kin_swarm_pan_${activeProjectId || 'default'}`);
      if (savedPan) setPan(JSON.parse(savedPan));
    } catch {
      setUserPositions({});
    }
  }, [activeProjectId]);

  // Persist viewMode changes per project
  useEffect(() => {
    try {
      localStorage.setItem(`kin_swarm_viewmode_${activeProjectId || 'default'}`, viewMode);
    } catch {}
  }, [viewMode, activeProjectId]);

  // Persist zoom changes per project
  useEffect(() => {
    try {
      localStorage.setItem(`kin_swarm_zoom_${activeProjectId || 'default'}`, String(zoom));
    } catch {}
  }, [zoom, activeProjectId]);

  const [draggingAgentId, setDraggingAgentId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{
    mouseStartX: number;
    mouseStartY: number;
    initialNodeX: number;
    initialNodeY: number;
  }>({
    mouseStartX: 0,
    mouseStartY: 0,
    initialNodeX: 0,
    initialNodeY: 0,
  });

  const [openAccordion, setOpenAccordion] = useState<Record<string, boolean>>({
    thoughts: true,
    tools: true,
    files: true,
    commands: true,
    coordination: true,
  });
  const [expandedJson, setExpandedJson] = useState<Record<string, boolean>>({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Filter agents based on scope filter and search query
  const filteredByScope = useMemo(() => {
    if (filterScope === 'all') return agents;
    const chan = channels.find((c) => c.id === selectedChannelId);
    return agents.filter((ag) => chan?.memberIds?.includes(ag.id) || ag.isOrchestrator);
  }, [filterScope, selectedChannelId, agents, channels]);

  const displayedAgents = useMemo(() => {
    if (!searchQuery.trim()) return filteredByScope;
    const q = searchQuery.toLowerCase();
    return filteredByScope.filter(
      (ag) =>
        ag.displayName.toLowerCase().includes(q) ||
        (ag.role && ag.role.toLowerCase().includes(q)) ||
        ag.activeModelId.toLowerCase().includes(q)
    );
  }, [filteredByScope, searchQuery]);

  const orchestrator = useMemo(() => {
    return displayedAgents.find((a) => a.isOrchestrator) || agents.find((a) => a.isOrchestrator) || displayedAgents[0] || agents[0];
  }, [displayedAgents, agents]);

  const specialists = useMemo(() => {
    return displayedAgents.filter((a) => a.id !== orchestrator?.id);
  }, [displayedAgents, orchestrator]);

  const selectedAgent = useMemo(() => {
    return (
      agents.find((a) => a.id === selectedSwarmAgentId) ||
      displayedAgents[0] ||
      agents[0]
    );
  }, [agents, selectedSwarmAgentId, displayedAgents]);

  const focusedAgent = useMemo(() => {
    return agents.find((a) => a.id === (hoveredAgentId || selectedSwarmAgentId)) || selectedAgent;
  }, [agents, hoveredAgentId, selectedSwarmAgentId, selectedAgent]);

  // Dynamic layout generator: combines auto-spacing with custom user-dragged coordinates
  const nodePositions = useMemo(() => {
    const positions: Record<
      string,
      { x: number; y: number; tier: number; roleTag: string }
    > = {};

    if (!displayedAgents.length) return positions;

    // Orchestrator at top center by default
    if (orchestrator) {
      const custom = userPositions[orchestrator.id];
      positions[orchestrator.id] = {
        x: custom?.x ?? 700,
        y: custom?.y ?? 120,
        tier: 1,
        roleTag: 'WORKFORCE ORCHESTRATOR',
      };
    }

    // Distribute specialists cleanly
    const specs = displayedAgents.filter((a) => a.id !== orchestrator?.id);
    const totalSpecs = specs.length;

    specs.forEach((spec, idx) => {
      const custom = userPositions[spec.id];
      if (custom) {
        positions[spec.id] = {
          x: custom.x,
          y: custom.y,
          tier: 2,
          roleTag: spec.role ? spec.role.toUpperCase() : 'DOMAIN SPECIALIST',
        };
      } else {
        const row = Math.floor(idx / 3);
        const col = idx % 3;
        const countInRow = Math.min(3, totalSpecs - row * 3);
        const startX = 700 - ((countInRow - 1) * 360) / 2;
        const autoX = Math.round(startX + col * 360);
        const autoY = 380 + row * 270;

        positions[spec.id] = {
          x: autoX,
          y: autoY,
          tier: 2,
          roleTag: spec.role ? spec.role.toUpperCase() : 'DOMAIN SPECIALIST',
        };
      }
    });

    return positions;
  }, [displayedAgents, orchestrator, userPositions]);

  // Set of agent IDs actively coordinating with the currently focused/hovered/selected agent
  const coordinatingPeerIds = useMemo(() => {
    if (!focusedAgent) return new Set<string>();
    const peers = new Set<string>();

    if (focusedAgent.isOrchestrator) {
      agents.forEach((a) => {
        if (!a.isOrchestrator) peers.add(a.id);
      });
    } else {
      const boss = agents.find((a) => a.isOrchestrator);
      if (boss) peers.add(boss.id);
    }

    if (latestDelegation) {
      if (latestDelegation.fromAgentId === focusedAgent.id && latestDelegation.targetAgentId) {
        peers.add(latestDelegation.targetAgentId);
      }
      if (latestDelegation.targetAgentId === focusedAgent.id && latestDelegation.fromAgentId) {
        peers.add(latestDelegation.fromAgentId);
      }
    }

    channels.forEach((chan) => {
      if (chan.memberIds?.includes(focusedAgent.id)) {
        chan.memberIds.forEach((mId) => {
          if (mId !== focusedAgent.id) peers.add(mId);
        });
      }
    });

    const myActiveChannel = activeAgentChannels[focusedAgent.id];
    if (myActiveChannel) {
      Object.entries(activeAgentChannels).forEach(([peerId, chanId]) => {
        if (chanId === myActiveChannel && peerId !== focusedAgent.id) {
          peers.add(peerId);
        }
      });
    }

    return peers;
  }, [focusedAgent, agents, channels, latestDelegation, activeAgentChannels]);

  // Pure dynamic coordination links (no mocks, no hardcoding, zero dead code)
  const linksToRender = useMemo(() => {
    const list: Array<{
      id: string;
      fromAgentId: string;
      fromAgentName?: string;
      targetAgentId: string;
      targetAgentName?: string;
      directive: string;
      channelId: string;
      type: string;
      status: 'active' | 'completed';
      isLive: boolean;
    }> = [];

    const agentMap = new Map(displayedAgents.map((a) => [a.id, a]));

    // 1. Direct active delegation from latestDelegation
    if (latestDelegation && latestDelegation.fromAgentId && latestDelegation.targetAgentId) {
      if (agentMap.has(latestDelegation.fromAgentId) && agentMap.has(latestDelegation.targetAgentId)) {
        const from = agentMap.get(latestDelegation.fromAgentId)!;
        const to = agentMap.get(latestDelegation.targetAgentId)!;
        list.push({
          id: `del-live-${latestDelegation.targetAgentId}`,
          fromAgentId: latestDelegation.fromAgentId,
          fromAgentName: from.displayName,
          targetAgentId: latestDelegation.targetAgentId,
          targetAgentName: to.displayName,
          directive: latestDelegation.directive || 'Active Task Delegation',
          channelId: latestDelegation.channelId || 'chan-general',
          type: 'direct_delegation',
          status: 'active',
          isLive: true,
        });
      }
    }

    // 2. Real SSE coordination events (delegations & @mention interactions)
    for (const cl of coordinationLinks) {
      if (agentMap.has(cl.fromAgentId) && agentMap.has(cl.targetAgentId)) {
        if (!list.some((l) => l.fromAgentId === cl.fromAgentId && l.targetAgentId === cl.targetAgentId)) {
          const from = agentMap.get(cl.fromAgentId)!;
          const to = agentMap.get(cl.targetAgentId)!;
          list.push({
            id: cl.id,
            fromAgentId: cl.fromAgentId,
            fromAgentName: from.displayName,
            targetAgentId: cl.targetAgentId,
            targetAgentName: to.displayName,
            directive: cl.directive,
            channelId: cl.channelId,
            type: cl.type,
            status: cl.status,
            isLive: cl.status === 'active',
          });
        }
      }
    }

    // 3. Dynamic active channel coordination: agents working in the same channel
    const activeEntries = Object.entries(activeAgentChannels);
    if (activeEntries.length > 1) {
      const channelGroups: Record<string, string[]> = {};
      for (const [agId, chId] of activeEntries) {
        if (agentMap.has(agId)) {
          if (!channelGroups[chId]) channelGroups[chId] = [];
          channelGroups[chId].push(agId);
        }
      }

      for (const [chId, agIds] of Object.entries(channelGroups)) {
        for (let i = 0; i < agIds.length - 1; i++) {
          const fromId = agIds[i];
          const toId = agIds[i + 1];
          if (!list.some((l) => (l.fromAgentId === fromId && l.targetAgentId === toId) || (l.fromAgentId === toId && l.targetAgentId === fromId))) {
            list.push({
              id: `chan-coord-${fromId}-${toId}`,
              fromAgentId: fromId,
              fromAgentName: agentMap.get(fromId)?.displayName,
              targetAgentId: toId,
              targetAgentName: agentMap.get(toId)?.displayName,
              directive: `Active Channel Peer Coordination`,
              channelId: chId,
              type: 'channel_coordination',
              status: 'active',
              isLive: true,
            });
          }
        }
      }
    }

    // 4. Default workforce coordination from Orchestrator to specialists if no active delegation
    if (orchestrator && list.length === 0) {
      const activeSpecs = displayedAgents.filter((a) => !a.isOrchestrator);
      activeSpecs.forEach((spec) => {
        const isSpecWorking = spec.status === 'working' || spec.status === 'thinking' || Boolean(activeAgentChannels[spec.id]);
        list.push({
          id: `workforce-link-${spec.id}`,
          fromAgentId: orchestrator.id,
          fromAgentName: orchestrator.displayName,
          targetAgentId: spec.id,
          targetAgentName: spec.displayName,
          directive: `Workforce Coordination: ${spec.role || 'Specialist Execution'}`,
          channelId: spec.assignedChannels?.[0] || 'chan-general',
          type: 'direct_delegation',
          status: isSpecWorking ? 'active' : 'completed',
          isLive: isSpecWorking,
        });
      });
    }

    if (filterScope === 'channel') {
      return list.filter((l) => l.channelId === selectedChannelId);
    }

    return list;
  }, [displayedAgents, latestDelegation, coordinationLinks, activeAgentChannels, orchestrator, filterScope, selectedChannelId]);

  const activeSelectedLink = linksToRender.find((l) => l.id === selectedLinkId);
  const execDetails = selectedAgent ? agentExecutionDetails[selectedAgent.id] : null;

  useEffect(() => {
    if (isSwarmMapOpen) {
      fetchAvailableModels();
      if (selectedAgent) {
        fetchAgentExecutionDetails(selectedAgent.id);
      }
    }
  }, [isSwarmMapOpen, selectedAgent?.id, fetchAvailableModels, fetchAgentExecutionDetails]);

  // Smooth Mouse Wheel Zoom (Clamped 0.35x to 2.5x)
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoom((prev) => Math.min(2.5, Math.max(0.35, Number((prev * zoomFactor).toFixed(3)))));
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Free-Form Backdrop Panning Handlers (Attached to Window during pan to prevent stuck state)
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.agent-node-card, button, select, input, a')) {
      return;
    }
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    };
  };

  useEffect(() => {
    if (!isPanning) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
    };

    const handleWindowMouseUp = () => {
      setIsPanning(false);
      setPan((currentPan) => {
        try {
          localStorage.setItem(`kin_swarm_pan_${activeProjectId || 'default'}`, JSON.stringify(currentPan));
        } catch {}
        return currentPan;
      });
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isPanning]);

  // Draggable Node Event Handlers (Attached to Window during drag, with localStorage persistence strictly on mouseUp)
  const handleAgentMouseDown = (e: React.MouseEvent, agentId: string) => {
    if ((e.target as HTMLElement).closest('button, select, input, option, a')) {
      return;
    }
    e.stopPropagation();
    const currentPos = nodePositions[agentId] || { x: 500, y: 300 };
    dragOffsetRef.current = {
      mouseStartX: e.clientX,
      mouseStartY: e.clientY,
      initialNodeX: currentPos.x,
      initialNodeY: currentPos.y,
    };
    setDraggingAgentId(agentId);
  };

  useEffect(() => {
    if (!draggingAgentId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = (e.clientX - dragOffsetRef.current.mouseStartX) / zoom;
      const deltaY = (e.clientY - dragOffsetRef.current.mouseStartY) / zoom;
      const newX = Math.round(dragOffsetRef.current.initialNodeX + deltaX);
      const newY = Math.round(dragOffsetRef.current.initialNodeY + deltaY);

      setUserPositions((prev) => ({
        ...prev,
        [draggingAgentId]: { x: newX, y: newY },
      }));
    };

    const handleMouseUp = () => {
      setDraggingAgentId((currId) => {
        if (currId) {
          setUserPositions((latestPositions) => {
            try {
              localStorage.setItem(`kin_swarm_positions_${activeProjectId || 'default'}`, JSON.stringify(latestPositions));
            } catch {}
            return latestPositions;
          });
        }
        return null;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingAgentId, zoom, activeProjectId]);

  const handleResetLayout = () => {
    setUserPositions({});
    try {
      localStorage.removeItem(`kin_swarm_positions_${activeProjectId || 'default'}`);
      localStorage.removeItem(`kin_swarm_pan_${activeProjectId || 'default'}`);
      localStorage.removeItem(`kin_swarm_zoom_${activeProjectId || 'default'}`);
    } catch {}
    const containerW = canvasContainerRef.current?.clientWidth || 1000;
    const containerH = canvasContainerRef.current?.clientHeight || 700;
    const targetPanX = Math.round(containerW / 2 - 700);
    const targetPanY = Math.round(Math.max(20, containerH / 2 - 320));
    setPan({ x: targetPanX, y: targetPanY });
    setZoom(1.0);
  };

  const toggleAccordion = (section: string) => {
    setOpenAccordion((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleJson = (itemId: string) => {
    setExpandedJson((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  if (!isSwarmMapOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-5 animate-fadeIn select-none font-sans">
      <div className="bg-white dark:bg-[#090d16] border border-slate-200 dark:border-[#1e293b] rounded-2xl w-full max-w-[96vw] h-[95vh] flex flex-col shadow-2xl overflow-hidden transition-colors">
        {/* TOP CONTROL BAR */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-[#1e293b] bg-slate-50 dark:bg-[#0c1222] flex items-center justify-between shrink-0 flex-wrap gap-2.5 transition-colors">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-slate-900 dark:text-white text-sm tracking-wide">
                  Autonomous Workforce Swarm Map
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold">
                  {viewMode === 'flow' ? 'Free-Form Dynamic Canvas' : viewMode === 'hierarchy' ? 'Dynamic Bus Hierarchy' : 'Department Matrix'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-[#64748b]">
                Real-time peer coordination, live execution indicators, and seamless in-map model switching
              </p>
            </div>
          </div>

          {/* Scope Filters & Canvas Actions */}
          <div className="flex items-center space-x-2 shrink-0 flex-wrap gap-1.5">
            {/* Quick Search */}
            <div className="flex items-center space-x-1.5 bg-slate-100 dark:bg-[#070b12] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-[#1e293b] text-xs">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#64748b] shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search specialists, models..."
                className="bg-transparent text-slate-900 dark:text-white text-xs focus:outline-none placeholder:text-slate-400 dark:placeholder:text-[#64748b] w-28 sm:w-36"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-0.5"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center bg-slate-100 dark:bg-[#070b12] p-0.5 rounded-lg border border-slate-300 dark:border-[#1e293b]">
              <button
                onClick={() => setViewMode('flow')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  viewMode === 'flow'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-[#64748b] hover:text-slate-900 dark:hover:text-white'
                }`}
                title="View free-form draggable & zoomable swarm canvas"
              >
                <Workflow className="w-3.5 h-3.5" />
                <span>Canvas Flow</span>
              </button>
              <button
                onClick={() => setViewMode('hierarchy')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  viewMode === 'hierarchy'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-[#64748b] hover:text-slate-900 dark:hover:text-white'
                }`}
                title="View multi-tier delegation hierarchy and channel bus"
              >
                <GitFork className="w-3.5 h-3.5" />
                <span>Hierarchy</span>
              </button>
              <button
                onClick={() => setViewMode('matrix')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                  viewMode === 'matrix'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-[#64748b] hover:text-slate-900 dark:hover:text-white'
                }`}
                title="View workforce grouped by departmental channels"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Departments</span>
              </button>
            </div>

            {/* Filter Scope Toggle */}
            <div className="flex items-center bg-slate-100 dark:bg-[#070b12] p-0.5 rounded-lg border border-slate-300 dark:border-[#1e293b]">
              <button
                onClick={() => setFilterScope('all')}
                className={`px-2 py-1 rounded-md text-xs font-semibold transition ${
                  filterScope === 'all'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-[#64748b] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                All ({agents.length})
              </button>
              <button
                onClick={() => setFilterScope('channel')}
                className={`px-2 py-1 rounded-md text-xs font-semibold transition ${
                  filterScope === 'channel'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-[#64748b] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Channel
              </button>
            </div>

            {filterScope === 'channel' && (
              <select
                value={selectedChannelId}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className="bg-slate-100 dark:bg-[#070b12] text-slate-800 dark:text-white border border-slate-300 dark:border-[#1e293b] rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
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

            {/* Hire Specialist */}
            <button
              onClick={() => {
                setSwarmMapOpen(false);
                setAddAgentModalOpen(true);
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-900/20 transition cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Hire</span>
            </button>

            {/* Toggle Drawer */}
            <button
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                isDrawerOpen
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-600 dark:text-blue-300'
                  : 'bg-slate-100 dark:bg-[#1e293b] border-slate-300 dark:border-[#334155] text-slate-600 dark:text-[#94a3b8] hover:text-slate-900 dark:hover:text-white'
              }`}
              title={isDrawerOpen ? 'Collapse Activity Drawer' : 'Open Activity Drawer'}
            >
              {isDrawerOpen ? <PanelRightClose className="w-3.5 h-3.5 text-blue-500" /> : <PanelRight className="w-3.5 h-3.5 text-blue-500" />}
              <span>{isDrawerOpen ? 'Close' : 'Inspect'}</span>
            </button>

            {/* Refresh */}
            <button
              onClick={() => {
                fetchState();
                if (selectedAgent) fetchAgentExecutionDetails(selectedAgent.id);
              }}
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-[#1e293b] hover:bg-slate-200 dark:hover:bg-[#2d3748] text-slate-600 dark:text-[#94a3b8] transition cursor-pointer"
              title="Refresh Swarm State"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* Close */}
            <button
              onClick={() => setSwarmMapOpen(false)}
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-[#1e293b] hover:bg-red-500/20 hover:text-red-500 text-slate-600 dark:text-[#94a3b8] transition cursor-pointer"
              title="Close Swarm Map"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* MAIN BODY: CANVAS AREA + INSPECTION DRAWER */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* FLOW MODE: FREE-FORM DRAGGABLE & ZOOMABLE CANVAS */}
          {viewMode === 'flow' ? (
            <div
              ref={canvasContainerRef}
              onMouseDown={handleCanvasMouseDown}
              className={`flex-1 relative overflow-hidden bg-slate-100 dark:bg-[#070b14] select-none ${
                isPanning ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            >
              {/* Infinite Subtle Grid Background */}
              <div
                className="absolute inset-0 pointer-events-none opacity-20 dark:opacity-25"
                style={{
                  backgroundImage:
                    'radial-gradient(#64748b 1.5px, transparent 1.5px), radial-gradient(#64748b 1.5px, #070b14 1.5px)',
                  backgroundSize: `${Math.round(24 * zoom)}px ${Math.round(24 * zoom)}px`,
                  backgroundPosition: `${pan.x}px ${pan.y}px, ${pan.x + 12 * zoom}px ${pan.y + 12 * zoom}px`,
                }}
              />

              {/* Floating Canvas Controls Toolbar */}
              <div className="absolute top-4 left-4 z-40 flex items-center space-x-1.5 p-1.5 rounded-2xl bg-white/95 dark:bg-[#0c1427]/95 border border-slate-300 dark:border-blue-500/30 shadow-xl backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.35, Number((z - 0.15).toFixed(2))))}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <div className="h-4 w-px bg-slate-300 dark:bg-[#1e293b]" />
                <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold text-slate-700 dark:text-blue-300">
                  {Math.round(zoom * 100)}%
                </span>
                <div className="h-4 w-px bg-slate-300 dark:bg-[#1e293b]" />
                <button
                  type="button"
                  onClick={handleResetLayout}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition cursor-pointer"
                  title="Reset canvas zoom, pan, and restore auto-arranged layout"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset / Fit</span>
                </button>
              </div>

              {/* Canvas Interactive Instruction Pill */}
              <div className="absolute top-4 right-4 z-40 hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-white/90 dark:bg-[#0c1427]/90 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-[#94a3b8] shadow-md backdrop-blur-md">
                <Move className="w-3.5 h-3.5 text-blue-500" />
                <span>Drag canvas to pan • Wheel to zoom • Drag cards to arrange</span>
              </div>

              {/* Transformed World Layer */}
              <div
                className="absolute inset-0 origin-top-left"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  width: '3200px',
                  height: '2400px',
                }}
              >
                {/* SVG Connections & Animated Cables Layer */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  <defs>
                    <filter id="flow-glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <linearGradient id="grad-active-link" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#d97706" />
                      <stop offset="100%" stopColor="#0284c7" />
                    </linearGradient>
                    <linearGradient id="grad-standard-link" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                    <marker id="arrow-flow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M 0 1 L 8 5 L 0 9 z" fill="#0284c7" />
                    </marker>
                  </defs>

                  {/* Render Dynamic Cubic Bezier Paths */}
                  {linksToRender.map((link) => {
                    const fromPos = nodePositions[link.fromAgentId];
                    const toPos = nodePositions[link.targetAgentId];
                    if (!fromPos || !toPos) return null;

                    const dy = toPos.y - fromPos.y;
                    const dx = toPos.x - fromPos.x;

                    // Compute dynamic port coordinates based on relative card direction
                    let x1 = fromPos.x;
                    let y1 = fromPos.y;
                    let x2 = toPos.x;
                    let y2 = toPos.y;

                    let pathD = '';
                    if (Math.abs(dy) >= Math.abs(dx)) {
                      // Primarily vertical flow (Top/Bottom ports)
                      if (dy >= 0) {
                        y1 = fromPos.y + 85;
                        y2 = toPos.y - 85;
                      } else {
                        y1 = fromPos.y - 85;
                        y2 = toPos.y + 85;
                      }
                      const cY1 = y1 + (y2 - y1) * 0.45;
                      const cY2 = y2 - (y2 - y1) * 0.45;
                      pathD = `M ${x1} ${y1} C ${x1} ${cY1}, ${x2} ${cY2}, ${x2} ${y2}`;
                    } else {
                      // Primarily horizontal flow (Left/Right ports)
                      if (dx >= 0) {
                        x1 = fromPos.x + 145;
                        x2 = toPos.x - 145;
                      } else {
                        x1 = fromPos.x - 145;
                        x2 = toPos.x + 145;
                      }
                      const cX1 = x1 + (x2 - x1) * 0.45;
                      const cX2 = x2 - (x2 - x1) * 0.45;
                      pathD = `M ${x1} ${y1} C ${cX1} ${y1}, ${cX2} ${y2}, ${x2} ${y2}`;
                    }

                    const isLinkActive =
                      link.isLive ||
                      hoveredAgentId === link.fromAgentId ||
                      hoveredAgentId === link.targetAgentId ||
                      selectedSwarmAgentId === link.fromAgentId ||
                      selectedSwarmAgentId === link.targetAgentId ||
                      selectedLinkId === link.id;

                    const strokeColor = link.isLive ? '#d97706' : '#0284c7';
                    const particleColor = link.isLive ? '#f59e0b' : '#38bdf8';

                    return (
                      <g key={link.id} className="transition-all duration-300">
                        {/* Outer Glow Halo */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth={isLinkActive ? 12 : 7}
                          strokeOpacity={isLinkActive ? 0.4 : 0.18}
                          filter="url(#flow-glow)"
                        />
                        {/* Core Dashed Cable */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke={link.isLive ? 'url(#grad-active-link)' : 'url(#grad-standard-link)'}
                          strokeWidth={isLinkActive ? 3.5 : 2.5}
                          strokeDasharray={isLinkActive ? '6 4' : '5 4'}
                          markerEnd="url(#arrow-flow)"
                          className={isLinkActive ? 'animate-pulse' : undefined}
                        />
                        {/* Animated Particle Moving Along Live Curve */}
                        <circle r={isLinkActive ? 5.5 : 4} fill={particleColor} filter="url(#flow-glow)">
                          <animateMotion
                            path={pathD}
                            dur={isLinkActive ? '2.0s' : '3.6s'}
                            repeatCount="indefinite"
                          />
                        </circle>
                      </g>
                    );
                  })}
                </svg>

                {/* HTML Midpoint Connection Badges */}
                {linksToRender.map((link) => {
                  const fromPos = nodePositions[link.fromAgentId];
                  const toPos = nodePositions[link.targetAgentId];
                  if (!fromPos || !toPos) return null;

                  const midX = (fromPos.x + toPos.x) / 2;
                  const midY = (fromPos.y + toPos.y) / 2;

                  const isLinkActive =
                    link.isLive ||
                    selectedLinkId === link.id ||
                    hoveredAgentId === link.fromAgentId ||
                    hoveredAgentId === link.targetAgentId;

                  return (
                    <div
                      key={`badge-${link.id}`}
                      style={{
                        left: `${midX}px`,
                        top: `${midY}px`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      className="absolute z-20"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedLinkId(link.id)}
                        className={`group/badge px-2.5 py-1 rounded-xl text-[10px] font-mono transition-all duration-200 border shadow-lg flex items-center space-x-1.5 cursor-pointer backdrop-blur-md ${
                          isLinkActive
                            ? 'bg-amber-50 dark:bg-[#101b33] border-amber-400 dark:border-cyan-400 text-amber-900 dark:text-cyan-200 shadow-[0_0_16px_rgba(251,191,36,0.35)] scale-105'
                            : 'bg-white/95 dark:bg-[#0d1424]/90 border-slate-300 dark:border-[#1e293b] text-slate-800 dark:text-[#94a3b8] hover:border-blue-500/50'
                        }`}
                        title={`Click to inspect details of link: ${link.directive}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${isLinkActive ? 'bg-amber-400 dark:bg-cyan-400 animate-ping' : 'bg-blue-400'}`} />
                        <span className="font-bold text-slate-800 dark:text-amber-300 flex items-center space-x-1">
                          <span>{link.fromAgentName || 'Agent'}</span>
                          <ArrowRight className="w-2.5 h-2.5 text-blue-500 inline" />
                          <span>{link.targetAgentName || 'Specialist'}</span>
                        </span>
                        <span className="text-slate-400 dark:text-[#64748b]">|</span>
                        <span className="truncate max-w-[120px] text-slate-700 dark:text-[#cbd5e1]">
                          "{link.directive}"
                        </span>
                        <span className="text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-black/50 text-blue-700 dark:text-blue-300 border border-slate-200 dark:border-transparent">
                          #{link.channelId.replace(/^chan-/, '')}
                        </span>
                      </button>
                    </div>
                  );
                })}

                {/* HTML Draggable Agent Node Cards Layer */}
                {displayedAgents.map((agent) => {
                  const pos = nodePositions[agent.id];
                  if (!pos) return null;

                  const isSelected = selectedSwarmAgentId === agent.id;
                  const isBusy = agent.status === 'working' || agent.status === 'thinking' || Boolean(activeAgentChannels[agent.id]);
                  const isHovered = hoveredAgentId === agent.id;
                  const isOrch = agent.isOrchestrator;
                  const isDraggingThis = draggingAgentId === agent.id;
                  const isCoordinating = coordinatingPeerIds.has(agent.id);

                  // Antigravity Live Activity Details
                  const liveThought = agent.status === 'thinking' ? agentThinkingDrafts[agent.id] : null;
                  const liveTool = agentLiveTools[agent.id];
                  const currentToolName = liveTool?.toolName || agent.currentTool;
                  const toolParams = liveTool?.params || {};
                  const commandStr = toolParams.command || toolParams.CommandLine || '';
                  const filePathStr = toolParams.filePath || toolParams.TargetFile || toolParams.path || '';

                  const isWritingFile =
                    Boolean(currentToolName && /write|replace|file/i.test(currentToolName)) ||
                    Boolean(filePathStr);

                  const isCommand =
                    Boolean(currentToolName && /command|terminal|run_command|executeShell|shell/i.test(currentToolName)) ||
                    Boolean(commandStr);

                  const isBuild =
                    Boolean(commandStr && /build|compile|cargo|tsc|make|gradle|mvn/i.test(commandStr)) ||
                    Boolean(currentToolName && /build/i.test(currentToolName));

                  return (
                    <div
                      key={agent.id}
                      style={{
                        left: `${pos.x}px`,
                        top: `${pos.y}px`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      onMouseEnter={() => setHoveredAgentId(agent.id)}
                      onMouseLeave={() => setHoveredAgentId(null)}
                      onClick={() => {
                        setSelectedSwarmAgentId(agent.id);
                        setIsDrawerOpen(true);
                      }}
                      className={`agent-node-card absolute z-30 w-[290px] p-3.5 rounded-2xl transition-shadow duration-150 border shadow-xl backdrop-blur-md select-none ${
                        isDraggingThis
                          ? 'ring-4 ring-blue-500 shadow-2xl cursor-grabbing scale-105 z-50'
                          : isSelected
                          ? 'bg-blue-50/95 dark:bg-[#151f38]/95 border-blue-500 shadow-[0_0_24px_rgba(59,130,246,0.35)] ring-2 ring-blue-400'
                          : isBusy
                          ? 'bg-amber-50/95 dark:bg-[#151c2f]/95 border-amber-500 shadow-[0_0_22px_rgba(251,191,36,0.35)] ring-1 ring-amber-400/80 animate-pulse'
                          : isCoordinating
                          ? 'bg-cyan-50/95 dark:bg-[#101b33]/95 border-cyan-400 shadow-[0_0_18px_rgba(6,182,212,0.3)] ring-1 ring-cyan-400/50 scale-[1.01]'
                          : isHovered
                          ? 'bg-cyan-50/95 dark:bg-[#101b33]/95 border-cyan-500 shadow-[0_0_18px_rgba(6,182,212,0.3)] scale-[1.02]'
                          : isOrch
                          ? 'bg-amber-500/10 dark:bg-[#0f172a] border-amber-500/40 hover:border-amber-400'
                          : 'bg-white dark:bg-[#0c1427] border-slate-200 dark:border-slate-800 hover:border-blue-500/60'
                      }`}
                    >
                      {/* Top Port Indicator (Inflow) */}
                      {!isOrch && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center space-x-1 px-1.5 py-0.2 rounded-full bg-white dark:bg-[#0a0f1d] border border-blue-500/40 text-[9px] font-mono text-blue-600 dark:text-blue-300 shadow">
                          <span className="w-1 h-1 rounded-full bg-blue-500" />
                          <span>▲ IN</span>
                        </div>
                      )}

                      {/* Card Header (Drag Handle) */}
                      <div
                        onMouseDown={(e) => handleAgentMouseDown(e, agent.id)}
                        className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-[#1e293b]/70 cursor-grab active:cursor-grabbing group/header"
                        title="Drag to reposition agent node on canvas"
                      >
                        <div className="flex items-center space-x-2.5">
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold shadow-inner ${
                              isOrch
                                ? 'bg-amber-500/20 text-amber-500 dark:text-amber-300 border border-amber-500/40'
                                : 'bg-blue-500/20 text-blue-500 dark:text-blue-300 border border-blue-500/40'
                            }`}
                          >
                            {isOrch ? <Shield className="w-4 h-4 text-amber-500" /> : <Bot className="w-4 h-4 text-blue-500" />}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white text-xs flex items-center space-x-1.5">
                              <span>{agent.displayName}</span>
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  isBusy ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                                }`}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-[#94a3b8] font-mono font-medium block truncate max-w-[130px]">
                              {agent.role || 'Autonomous Specialist'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-1">
                          <span
                            className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded font-bold border ${
                              isOrch
                                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/40'
                                : 'bg-blue-500/20 text-blue-600 dark:text-blue-300 border-blue-500/40'
                            }`}
                          >
                            {isOrch ? 'ROOT' : 'AGENT'}
                          </span>
                          <GripVertical className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600 group-hover/header:text-blue-400 transition" />
                          {!isOrch && (
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (window.confirm(`Decommission ${agent.displayName} from workforce?`)) {
                                  setUserPositions((prev) => {
                                    const next = { ...prev };
                                    delete next[agent.id];
                                    try {
                                      localStorage.setItem(`kin_swarm_positions_${activeProjectId || 'default'}`, JSON.stringify(next));
                                    } catch {}
                                    return next;
                                  });
                                  await decommissionAgent(agent.id);
                                }
                              }}
                              className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition cursor-pointer"
                              title={`Decommission ${agent.displayName}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Coordinating Peer & Channel Indicators */}
                      {isCoordinating && focusedAgent?.id !== agent.id && (
                        <div className="mt-1.5 px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-400/40 text-cyan-700 dark:text-cyan-300 text-[10px] font-mono flex items-center space-x-1">
                          <Activity className="w-3 h-3 text-cyan-500 shrink-0 animate-pulse" />
                          <span className="truncate">Coordinating with {focusedAgent?.displayName}</span>
                        </div>
                      )}

                      {agent.assignedChannels && agent.assignedChannels.length > 0 && (
                        <div className="mt-1 px-2 py-0.5 rounded bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-400 flex items-center space-x-1">
                          <Radio className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                          <span className="truncate">#{channels.find((c) => c.id === agent.assignedChannels![0])?.name || agent.assignedChannels[0]}</span>
                        </div>
                      )}
                      {/* Seamless In-Map Model Switching Dropdown */}
                      <div className="mt-2.5 pt-1.5 flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center space-x-1 text-slate-500 dark:text-[#64748b]">
                          <Cpu className="w-3 h-3 text-blue-500 dark:text-blue-400 shrink-0" />
                          <span className="text-[10px]">Model:</span>
                        </div>

                        <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={agent.activeModelId}
                            disabled={isBusy}
                            onChange={async (e) => {
                              e.stopPropagation();
                              const newModel = e.target.value;
                              if (newModel === '__open_modal__') {
                                openModelSelector(agent.id);
                                return;
                              }
                              if (newModel && newModel !== agent.activeModelId) {
                                await updateAgentModel(agent.id, newModel, activeProjectId, activeChannelId);
                              }
                            }}
                            className={`px-2 py-0.5 pr-5 rounded-md text-[10px] font-mono border appearance-none transition focus:outline-none max-w-[160px] truncate ${
                              isBusy
                                ? 'cursor-not-allowed opacity-60 bg-slate-100 dark:bg-slate-900/80 border-slate-300 dark:border-slate-800 text-slate-400'
                                : 'cursor-pointer bg-white dark:bg-[#070b14] hover:bg-slate-50 dark:hover:bg-blue-950/40 border-slate-200 dark:border-blue-500/40 text-blue-600 dark:text-blue-300 focus:border-blue-500'
                            }`}
                            title={
                              isBusy
                                ? `Agent is actively running (${agent.status}). Model switching is blocked until execution completes.`
                                : `Active Model: ${agent.activeModelId} (Click to switch)`
                            }
                          >
                            {!availableModels.some((m) => m.id === agent.activeModelId) && (
                              <option value={agent.activeModelId}>
                                {agent.activeModelId}
                              </option>
                            )}
                            {availableModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.provider ? `[${m.provider}] ` : ''}{m.name || m.id}
                              </option>
                            ))}
                            <option value="__open_modal__">⚙️ Manage Models...</option>
                          </select>
                          {isBusy ? (
                            <Lock className="w-2.5 h-2.5 text-amber-500 dark:text-amber-400 absolute right-1.5 pointer-events-none" />
                          ) : (
                            <ChevronDown className="w-2.5 h-2.5 text-slate-400 dark:text-blue-400 absolute right-1.5 pointer-events-none" />
                          )}
                        </div>
                      </div>

                      {/* Antigravity Live Activity Indicators */}
                      {liveThought ? (
                        <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-[10px] font-mono flex items-center space-x-1.5 animate-pulse shadow-sm">
                          <Sparkles className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                          <span className="truncate font-semibold">
                            🧠 Thinking: {liveThought.slice(-45)}
                          </span>
                        </div>
                      ) : isBuild ? (
                        <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-blue-500/15 border border-blue-500/40 text-blue-600 dark:text-blue-300 text-[10px] font-mono flex items-center space-x-1.5 animate-pulse shadow-sm">
                          <Hammer className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 shrink-0" />
                          <span className="truncate font-semibold">
                            🔨 Building: {commandStr.slice(0, 30) || 'Build Task'}
                          </span>
                        </div>
                      ) : isWritingFile ? (
                        <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 text-[10px] font-mono flex items-center space-x-1.5 animate-pulse shadow-sm">
                          <FileCode className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400 shrink-0" />
                          <span className="truncate font-semibold">
                            📝 Writing: {filePathStr.split(/[/\\]/).pop() || 'file'}
                          </span>
                        </div>
                      ) : isCommand ? (
                        <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-mono flex items-center space-x-1.5 animate-pulse shadow-sm">
                          <Terminal className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
                          <span className="truncate font-semibold">
                            💻 Command: {commandStr.slice(0, 28) || 'Executing'}
                          </span>
                        </div>
                      ) : currentToolName ? (
                        <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/40 text-purple-700 dark:text-purple-300 text-[10px] font-mono flex items-center space-x-1.5 animate-pulse shadow-sm">
                          <Zap className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400 shrink-0" />
                          <span className="truncate font-semibold">⚡ Tool: {currentToolName}</span>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 dark:text-[#64748b] font-mono">
                          <span className="flex items-center space-x-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${isBusy ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                            <span>{isBusy ? 'Executing...' : 'Ready (Idle)'}</span>
                          </span>
                          <span className="text-blue-500 dark:text-blue-400 hover:underline">Inspect ➔</span>
                        </div>
                      )}

                      {/* Bottom Port Indicator (Outflow) */}
                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center space-x-1 px-1.5 py-0.2 rounded-full bg-white dark:bg-[#0a0f1d] border border-blue-500/40 text-[9px] font-mono text-blue-600 dark:text-blue-300 shadow">
                        <span className="w-1 h-1 rounded-full bg-blue-400" />
                        <span>▼ OUT</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Link Details Inspection Modal */}
              {selectedLinkId && activeSelectedLink && (
                <div className="absolute bottom-5 left-5 z-40 w-96 p-4 rounded-2xl bg-white/95 dark:bg-[#0c1527]/98 border border-blue-400/60 shadow-2xl backdrop-blur-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#1e293b] pb-2">
                    <div className="flex items-center space-x-2">
                      <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                      <span className="font-bold text-slate-900 dark:text-white text-xs font-mono">
                        Coordination Link Inspector
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedLinkId(null)}
                      className="p-1 rounded text-slate-500 hover:text-slate-900 dark:text-[#64748b] dark:hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-[#070b14] p-2 rounded-lg border border-slate-200 dark:border-[#1e293b]">
                      <span className="text-slate-500 dark:text-[#64748b]">Channel:</span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">#{activeSelectedLink.channelId.replace(/^chan-/, '')}</span>
                    </div>

                    <div className="flex items-center justify-between bg-slate-50 dark:bg-[#070b14] p-2 rounded-lg border border-slate-200 dark:border-[#1e293b]">
                      <span className="text-slate-500 dark:text-[#64748b]">From Agent:</span>
                      <span className="text-amber-600 dark:text-amber-400 font-bold">{activeSelectedLink.fromAgentName}</span>
                    </div>

                    <div className="flex items-center justify-between bg-slate-50 dark:bg-[#070b14] p-2 rounded-lg border border-slate-200 dark:border-[#1e293b]">
                      <span className="text-slate-500 dark:text-[#64748b]">Target Agent:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">{activeSelectedLink.targetAgentName}</span>
                    </div>

                    <div className="bg-slate-50 dark:bg-[#070b14] p-2.5 rounded-lg border border-slate-200 dark:border-[#1e293b] space-y-1">
                      <span className="text-[10px] text-slate-500 dark:text-[#64748b] block font-semibold">Directive / Transferred Context:</span>
                      <p className="text-slate-900 dark:text-white text-xs leading-relaxed font-sans font-medium">{activeSelectedLink.directive}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-semibold">● Status: Active & Dynamic</span>
                    <button
                      onClick={() => setSelectedLinkId(null)}
                      className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* HIERARCHY OR MATRIX VIEWS */
            <div className="flex-1 bg-slate-100 dark:bg-[#070b12] p-8 overflow-auto relative flex flex-col items-center select-none">
              {/* Orchestrator Tier */}
              {orchestrator && (
                <div className="relative z-10 flex flex-col items-center w-full max-w-5xl mb-4">
                  <div className="flex items-center space-x-2 px-3.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs font-mono font-bold tracking-wider mb-3">
                    <Shield className="w-4 h-4 text-amber-500" />
                    <span>TIER 1: WORKFORCE ORCHESTRATOR</span>
                  </div>

                  <div
                    onClick={() => {
                      setSelectedSwarmAgentId(orchestrator.id);
                      setIsDrawerOpen(true);
                    }}
                    className={`w-80 md:w-96 p-4 rounded-2xl cursor-pointer transition-all duration-200 border shadow-2xl relative ${
                      selectedSwarmAgentId === orchestrator.id
                        ? 'bg-amber-50 dark:bg-[#151c2f] border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.3)] ring-2 ring-amber-400/50'
                        : 'bg-white dark:bg-[#0f172a] border-amber-500/40 hover:border-amber-400'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-500 dark:text-amber-300 font-bold">
                          <Shield className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white text-sm flex items-center space-x-1.5">
                            <span>{orchestrator.displayName}</span>
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          </div>
                          <span className="text-[11px] text-amber-600 dark:text-amber-300/90 font-mono font-medium">
                            {orchestrator.role || 'Workspace Orchestrator'}
                          </span>
                        </div>
                      </div>
                      <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-300 font-bold border border-amber-500/30">
                        ROOT
                      </span>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-[#1e293b] flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-[#64748b] flex items-center space-x-1 font-mono text-[11px]">
                        <Cpu className="w-3.5 h-3.5 text-amber-500" />
                        <span>Model:</span>
                      </span>
                      <select
                        value={orchestrator.activeModelId}
                        disabled={orchestrator.status === 'working' || orchestrator.status === 'thinking'}
                        onChange={async (e) => {
                          e.stopPropagation();
                          if (e.target.value === '__open_modal__') {
                            openModelSelector(orchestrator.id);
                          } else {
                            await updateAgentModel(orchestrator.id, e.target.value, activeProjectId, activeChannelId);
                          }
                        }}
                        className={`bg-slate-100 dark:bg-[#090d16] text-amber-600 dark:text-amber-300 border border-amber-500/40 rounded px-2 py-0.5 text-[11px] font-mono ${
                          orchestrator.status === 'working' || orchestrator.status === 'thinking'
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer'
                        }`}
                      >
                        {!availableModels.some((m) => m.id === orchestrator.activeModelId) && (
                          <option value={orchestrator.activeModelId}>
                            {orchestrator.activeModelId}
                          </option>
                        )}
                        {availableModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.provider ? `[${m.provider}] ` : ''}{m.name || m.id}
                          </option>
                        ))}
                        <option value="__open_modal__">⚙️ Manage Models...</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Department Matrix vs Hierarchy Cards */}
              {viewMode === 'matrix' ? (
                <div className="w-full max-w-6xl space-y-4 pb-16">
                  {channels
                    .filter((c) => !c.id.startsWith('dm-'))
                    .map((chan) => {
                      const members = agents.filter((a) => chan.memberIds?.includes(a.id) || a.isOrchestrator);
                      return (
                        <div
                          key={chan.id}
                          className="p-4 rounded-2xl bg-white dark:bg-[#0c1427]/80 border border-slate-200 dark:border-[#1e293b] space-y-3 shadow-lg"
                        >
                          <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#1e293b]/70 pb-2">
                            <div className="flex items-center space-x-2">
                              <span className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center font-mono font-bold text-blue-500">
                                #
                              </span>
                              <div>
                                <span className="font-bold text-slate-900 dark:text-white text-sm">#{chan.name}</span>
                                <span className="text-[11px] text-slate-500 dark:text-[#64748b] ml-2">
                                  {chan.topic || `Departmental channel #${chan.name}`}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                setSwarmMapOpen(false);
                                setActiveChannel(chan.id);
                              }}
                              className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-[#1e293b] hover:bg-blue-600 hover:text-white text-blue-600 dark:text-blue-300 text-xs font-mono transition cursor-pointer"
                            >
                              Open Channel ➔
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-3">
                            {members.map((ag) => (
                              <div
                                key={ag.id}
                                onClick={() => {
                                  setSelectedSwarmAgentId(ag.id);
                                  setIsDrawerOpen(true);
                                }}
                                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-[#1e293b] hover:border-blue-500 cursor-pointer flex items-center space-x-2.5 transition"
                              >
                                <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-500 text-xs font-bold">
                                  {ag.isOrchestrator ? <Shield className="w-3.5 h-3.5 text-amber-500" /> : <Bot className="w-3.5 h-3.5" />}
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-900 dark:text-white text-xs flex items-center space-x-1">
                                    <span>{ag.displayName}</span>
                                    <span className={`w-1.5 h-1.5 rounded-full ${ag.status === 'working' || ag.status === 'thinking' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                                  </div>
                                  <span className="text-[10px] text-slate-500 dark:text-[#64748b] font-mono">{ag.role}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="flex flex-wrap justify-center gap-6 max-w-6xl w-full pb-16">
                  {specialists.map((spec) => {
                    const isSelected = selectedSwarmAgentId === spec.id;
                    const isBusy = spec.status === 'working' || spec.status === 'thinking' || Boolean(activeAgentChannels[spec.id]);

                    return (
                      <div
                        key={spec.id}
                        onClick={() => {
                          setSelectedSwarmAgentId(spec.id);
                          setIsDrawerOpen(true);
                        }}
                        className={`w-[320px] p-4 rounded-2xl cursor-pointer transition-all duration-200 border shadow-xl relative ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-[#131d35] border-blue-400 shadow-blue-500/20'
                            : 'bg-white dark:bg-[#0c1427] border-slate-200 dark:border-slate-800 hover:border-blue-500'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-500 font-bold shrink-0">
                              <Bot className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white text-sm flex items-center space-x-1.5">
                                <span>{spec.displayName}</span>
                                <span className={`w-2 h-2 rounded-full ${isBusy ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                              </div>
                              <span className="text-[11px] text-blue-600 dark:text-blue-300 font-mono font-medium block leading-snug">
                                {spec.role}
                              </span>
                            </div>
                          </div>
                          <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-600 dark:text-blue-300 font-bold border border-blue-500/30 shrink-0">
                            Specialist
                          </span>
                        </div>

                        {/* In-Map Model Selector */}
                        <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-[#1e293b] flex items-center justify-between text-xs">
                          <span className="text-slate-500 dark:text-[#64748b] flex items-center space-x-1 font-mono text-[11px]">
                            <Cpu className="w-3.5 h-3.5 text-blue-500" />
                            <span>Model:</span>
                          </span>
                          <select
                            value={spec.activeModelId}
                            disabled={isBusy}
                            onChange={async (e) => {
                              e.stopPropagation();
                              const newModel = e.target.value;
                              if (newModel === '__open_modal__') {
                                openModelSelector(spec.id);
                                return;
                              }
                              if (newModel && newModel !== spec.activeModelId) {
                                await updateAgentModel(spec.id, newModel, activeProjectId, activeChannelId);
                              }
                            }}
                            className="bg-slate-100 dark:bg-[#090d16] text-blue-600 dark:text-blue-300 border border-blue-500/30 rounded px-2 py-0.5 text-[11px] font-mono cursor-pointer max-w-[190px] truncate"
                          >
                            {!availableModels.some((m) => m.id === spec.activeModelId) && (
                              <option value={spec.activeModelId}>
                                {spec.activeModelId}
                              </option>
                            )}
                            {availableModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.provider ? `[${m.provider}] ` : ''}{m.name || m.id}
                              </option>
                            ))}
                            <option value="__open_modal__">⚙️ Manage Models...</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Quick Inspect Floating Pill when Drawer is Closed */}
          {!isDrawerOpen && selectedAgent && (
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="fixed bottom-8 right-8 z-40 flex items-center space-x-2 px-4 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-2xl text-xs font-semibold transition cursor-pointer border border-blue-400 animate-fadeIn"
              title={`Inspect ${selectedAgent.displayName}`}
            >
              <PanelRight className="w-4 h-4" />
              <span>Inspect {selectedAgent.displayName} Activity</span>
            </button>
          )}

          {/* RIGHT: ANTIGRAVITY-STYLE TRANSPARENT ACTIVITY DRAWER */}
          {isDrawerOpen && (
            <div className="w-[380px] lg:w-[430px] shrink-0 bg-white dark:bg-[#090d16] border-l border-slate-200 dark:border-[#1e293b] flex flex-col h-full overflow-hidden animate-fadeIn">
              {/* Drawer Header */}
              <div className="p-4 border-b border-slate-200 dark:border-[#1e293b] bg-slate-50 dark:bg-[#0c1222] shrink-0 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-500 font-bold">
                      {selectedAgent?.isOrchestrator ? <Shield className="w-4 h-4 text-amber-500" /> : <Bot className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white text-sm flex items-center space-x-1.5">
                        <span>{selectedAgent?.displayName}</span>
                        <span className="text-[10px] text-slate-500 dark:text-[#64748b] font-normal">({selectedAgent?.role})</span>
                      </div>
                      <div className="flex items-center space-x-1.5 mt-0.5">
                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-mono truncate max-w-[180px]">
                          {selectedAgent?.activeModelId}
                        </span>
                        <button
                          type="button"
                          onClick={() => selectedAgent && openModelSelector(selectedAgent.id)}
                          className="px-1.5 py-0.2 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-600 dark:text-blue-300 text-[9px] font-mono border border-blue-500/30 transition cursor-pointer"
                        >
                          Change
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => {
                        setSwarmMapOpen(false);
                        setActiveChannel(`dm-${selectedAgent?.id}`);
                      }}
                      className="px-2.5 py-1 rounded-md bg-slate-200 dark:bg-[#1e293b] hover:bg-blue-600 hover:text-white text-slate-800 dark:text-white text-xs transition flex items-center space-x-1 cursor-pointer"
                      title="Open Direct Message Thread"
                    >
                      <MessageSquare className="w-3 h-3 text-blue-500" />
                      <span>DM</span>
                    </button>

                    <button
                      onClick={() => setIsDrawerOpen(false)}
                      className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition cursor-pointer"
                      title="Close Activity Drawer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Antigravity Trajectory Summary Pill */}
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#070b12] border border-slate-200 dark:border-[#1e293b] space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 font-semibold font-mono">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{execDetails?.durationFormatted || '0s'}</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20">
                      Telemetry Live
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-600 dark:text-[#94a3b8] flex items-center space-x-2 font-mono">
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
                  <div className="text-center py-6 text-slate-500 dark:text-[#64748b] flex items-center justify-center space-x-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                    <span>Loading execution trajectory...</span>
                  </div>
                )}

                {/* 1. Thoughts & Reasoning */}
                <div className="border border-slate-200 dark:border-[#1e293b] rounded-xl overflow-hidden bg-slate-50 dark:bg-[#0c1222]">
                  <button
                    onClick={() => toggleAccordion('thoughts')}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-[#0e1628] flex items-center justify-between font-semibold text-slate-900 dark:text-white text-xs hover:bg-slate-200 dark:hover:bg-[#131d35] transition cursor-pointer"
                  >
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      <span>Thoughts & Reasoning</span>
                    </div>
                    {openAccordion.thoughts ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  {openAccordion.thoughts && (
                    <div className="p-3 space-y-2 text-[11px] text-slate-800 dark:text-[#cbd5e1] bg-white dark:bg-[#070b12] leading-relaxed">
                      {agentThinkingDrafts[selectedAgent?.id || ''] && (
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-200 space-y-1.5 animate-pulse">
                          <div className="flex items-center justify-between text-[10px] font-mono text-amber-600 dark:text-amber-400 font-bold">
                            <div className="flex items-center space-x-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                              <span>LIVE AGENT REASONING STREAM</span>
                            </div>
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold text-[9px]">ACTIVE</span>
                          </div>
                          <div className="font-mono text-[11px] whitespace-pre-wrap leading-relaxed">
                            {agentThinkingDrafts[selectedAgent?.id || '']}
                            <span className="inline-block w-1.5 h-3.5 bg-amber-500 ml-1 animate-pulse align-middle" />
                          </div>
                        </div>
                      )}

                      {execDetails?.phases?.find((p) => p.id === 'phase-reasoning')?.items?.length ? (
                        execDetails.phases.find((p) => p.id === 'phase-reasoning')!.items.map((item: any, idx: number) => (
                          <div key={item.id || idx} className="p-2.5 rounded-lg bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-[#1e293b] font-mono text-[10px] whitespace-pre-wrap">
                            {item.summary}
                            {item.details?.reasoning && (
                              <div className="mt-1 text-slate-500 dark:text-[#94a3b8]">{item.details.reasoning}</div>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="font-mono text-slate-500 dark:text-[#94a3b8]">
                          Agent is ready in workspace. No past reasoning trace recorded.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. Explored Files */}
                <div className="border border-slate-200 dark:border-[#1e293b] rounded-xl overflow-hidden bg-slate-50 dark:bg-[#0c1222]">
                  <button
                    onClick={() => toggleAccordion('files')}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-[#0e1628] flex items-center justify-between font-semibold text-slate-900 dark:text-white text-xs hover:bg-slate-200 dark:hover:bg-[#131d35] transition cursor-pointer"
                  >
                    <div className="flex items-center space-x-2">
                      <FileCode className="w-3.5 h-3.5 text-blue-500" />
                      <span>Explored Files ({execDetails?.exploredFiles?.length || execDetails?.metrics?.exploredFilesCount || 0})</span>
                    </div>
                    {openAccordion.files ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  {openAccordion.files && (
                    <div className="p-2.5 space-y-1.5 bg-white dark:bg-[#070b12]">
                      {execDetails?.exploredFiles && execDetails.exploredFiles.length > 0 ? (
                        execDetails.exploredFiles.map((f: string, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between px-2 py-1 rounded bg-slate-50 dark:bg-[#0c1222] border border-slate-200 dark:border-[#1e293b] text-[11px] font-mono text-slate-700 dark:text-[#94a3b8]"
                          >
                            <span className="truncate">{f}</span>
                            <span className="text-[9px] text-emerald-600 dark:text-emerald-400 shrink-0">Analyzed</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-[11px] font-mono text-slate-500 dark:text-[#64748b] text-center py-2">
                          No files accessed yet in this session
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. Commands & Shell Execution */}
                <div className="border border-slate-200 dark:border-[#1e293b] rounded-xl overflow-hidden bg-slate-50 dark:bg-[#0c1222]">
                  <button
                    onClick={() => toggleAccordion('commands')}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-[#0e1628] flex items-center justify-between font-semibold text-slate-900 dark:text-white text-xs hover:bg-slate-200 dark:hover:bg-[#131d35] transition cursor-pointer"
                  >
                    <div className="flex items-center space-x-2">
                      <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Commands & Shell ({execDetails?.phases?.find((p) => p.id === 'phase-tools')?.items?.filter((i: any) => i.type === 'command')?.length || execDetails?.metrics?.commandsCount || 0})</span>
                    </div>
                    {openAccordion.commands ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  {openAccordion.commands && (
                    <div className="p-2.5 space-y-2 bg-white dark:bg-[#070b12]">
                      {execDetails?.phases?.find((p) => p.id === 'phase-tools')?.items?.filter((i: any) => i.type === 'command')?.length ? (
                        execDetails.phases
                          .find((p) => p.id === 'phase-tools')!
                          .items.filter((i: any) => i.type === 'command')
                          .map((item: any, idx: number) => {
                            const itemKey = item.id || `cmd-${idx}`;
                            return (
                              <div key={itemKey} className="rounded-lg border border-slate-200 dark:border-[#1e293b] p-2 bg-slate-50 dark:bg-[#0c1222] space-y-1.5 font-mono">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{item.summary}</span>
                                  <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${item.details?.exitCode === 0 ? 'bg-emerald-500/20 text-emerald-600' : 'bg-red-500/20 text-red-500'}`}>
                                    exit {item.details?.exitCode ?? 0}
                                  </span>
                                </div>
                                {item.details?.command && (
                                  <div className="text-[10px] text-slate-700 dark:text-[#cbd5e1] bg-slate-100 dark:bg-black/40 p-1.5 rounded">
                                    $ {item.details.command}
                                  </div>
                                )}
                              </div>
                            );
                          })
                      ) : (
                        <div className="text-[11px] font-mono text-slate-500 dark:text-[#64748b] text-center py-2">
                          No shell commands executed in this session
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 4. Tools & Actions */}
                <div className="border border-slate-200 dark:border-[#1e293b] rounded-xl overflow-hidden bg-slate-50 dark:bg-[#0c1222]">
                  <button
                    onClick={() => toggleAccordion('tools')}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-[#0e1628] flex items-center justify-between font-semibold text-slate-900 dark:text-white text-xs hover:bg-slate-200 dark:hover:bg-[#131d35] transition cursor-pointer"
                  >
                    <div className="flex items-center space-x-2">
                      <Terminal className="w-3.5 h-3.5 text-purple-500" />
                      <span>Tools & Actions Executed ({execDetails?.phases?.find((p) => p.id === 'phase-tools')?.items?.length || execDetails?.metrics?.actionsCount || 0})</span>
                    </div>
                    {openAccordion.tools ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  {openAccordion.tools && (
                    <div className="p-2.5 space-y-2 bg-white dark:bg-[#070b12]">
                      {(agentLiveTools[selectedAgent?.id || ''] || selectedAgent?.currentTool) && (
                        <div className="p-3 rounded-xl bg-purple-500/15 border border-purple-500/50 text-purple-900 dark:text-purple-200 space-y-1.5 animate-pulse">
                          <div className="flex items-center justify-between text-[10px] font-mono text-purple-600 dark:text-purple-300 font-bold">
                            <div className="flex items-center space-x-1.5">
                              <Terminal className="w-3.5 h-3.5 text-purple-500" />
                              <span>CURRENTLY EXECUTING ACTION</span>
                            </div>
                            <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-700 dark:text-purple-300 font-bold text-[9px]">RUNNING</span>
                          </div>
                          <div className="font-mono text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
                            <span>Tool:</span>
                            <span className="text-purple-600 dark:text-purple-300 underline underline-offset-2">
                              {agentLiveTools[selectedAgent?.id || '']?.toolName || selectedAgent?.currentTool}
                            </span>
                          </div>
                          {agentLiveTools[selectedAgent?.id || '']?.params && Object.keys(agentLiveTools[selectedAgent?.id || '']?.params || {}).length > 0 && (
                            <pre className="p-2 rounded bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-purple-500/30 text-[10px] font-mono text-emerald-600 dark:text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(agentLiveTools[selectedAgent?.id || '']?.params, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}

                      {execDetails?.phases?.find((p) => p.id === 'phase-tools')?.items?.length ? (
                        execDetails.phases.find((p) => p.id === 'phase-tools')!.items.map((item: any, idx: number) => {
                          const itemKey = item.id || `tool-${idx}`;
                          return (
                            <div key={itemKey} className="rounded-lg border border-slate-200 dark:border-[#1e293b] p-2 bg-slate-50 dark:bg-[#0c1222] space-y-1.5">
                              <div
                                onClick={() => toggleJson(itemKey)}
                                className="flex items-center justify-between cursor-pointer text-[11px]"
                              >
                                <span className="font-mono font-bold text-purple-600 dark:text-purple-400">{item.summary || item.type}</span>
                                <div className="flex items-center space-x-1 text-[10px] text-slate-500 dark:text-[#64748b]">
                                  {item.details?.exitCode !== undefined && <span>exit: {item.details.exitCode}</span>}
                                  {expandedJson[itemKey] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                </div>
                              </div>
                              {item.details?.command && (
                                <div className="text-[10px] text-slate-600 dark:text-[#94a3b8] font-mono">
                                  {item.details.command}
                                </div>
                              )}
                              {expandedJson[itemKey] && (
                                <pre className="p-2 rounded bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-[#1e293b] text-[10px] font-mono text-emerald-600 dark:text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                                  {JSON.stringify(item.details || item, null, 2)}
                                </pre>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-[11px] font-mono text-slate-500 dark:text-[#64748b] text-center py-2">
                          No tool actions executed yet
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 4. Peer Coordination */}
                <div className="border border-slate-200 dark:border-[#1e293b] rounded-xl overflow-hidden bg-slate-50 dark:bg-[#0c1222]">
                  <button
                    onClick={() => toggleAccordion('coordination')}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-[#0e1628] flex items-center justify-between font-semibold text-slate-900 dark:text-white text-xs hover:bg-slate-200 dark:hover:bg-[#131d35] transition cursor-pointer"
                  >
                    <div className="flex items-center space-x-2">
                      <Layers className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Peer Coordination Log ({execDetails?.peerCoordination?.length || 0})</span>
                    </div>
                    {openAccordion.coordination ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  {openAccordion.coordination && (
                    <div className="p-2.5 space-y-1.5 bg-white dark:bg-[#070b12] text-[11px]">
                      {execDetails?.peerCoordination && execDetails.peerCoordination.length > 0 ? (
                        execDetails.peerCoordination.map((pc: any, idx: number) => (
                          <div key={idx} className="p-2 rounded bg-slate-50 dark:bg-[#0c1222] border border-slate-200 dark:border-[#1e293b] space-y-1">
                            <div className="flex items-center justify-between text-slate-500 dark:text-[#64748b]">
                              <span className="font-mono font-semibold text-slate-900 dark:text-white">{pc.channelName || '#general'}</span>
                              <span className="text-emerald-600 dark:text-emerald-400 font-mono">{pc.targetAgent}</span>
                            </div>
                            <p className="text-slate-600 dark:text-[#94a3b8] font-mono text-[10px]">
                              {pc.action}
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="text-[11px] font-mono text-slate-500 dark:text-[#64748b] text-center py-2">
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
