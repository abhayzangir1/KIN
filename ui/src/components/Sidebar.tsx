import React from 'react';
import { useKinStore, isAgentAvailable } from '../store/kinStore.js';
import { Folder, Hash, Plus, MessageSquare, UserPlus, Settings, Target, CheckCircle2, PlayCircle, AlertCircle, Clock, Scale, Trash2, Sun, Moon, Users } from 'lucide-react';

export const Sidebar: React.FC = () => {
  const {
    activeProject,
    channels,
    activeChannelId,
    setActiveChannel,
    deleteChannel,
    agents,
    ollamaStatus,
    credentials,
    availableModels,
    selectedAgentId,
    setSelectedAgentId,
    setCreateChannelModalOpen,
    setAddAgentModalOpen,
    goals,
    tasks,
    deleteGoal,
    deleteTask,
    updateTaskStatus,
    setNewGoalModalOpen,
    setNewTaskModalOpen,
    setActiveRightTab,
    decisions,
    setDecisionsModalOpen,
    schedules,
    setAutomationsModalOpen,
    sidebarWidth,
    setSettingsModalOpen,
    autonomyMode,
    activeMainView,
    theme,
    toggleTheme,
    setActiveMainView,
  } = useKinStore();

  const handleSelectDm = (agentId: string) => {
    setSelectedAgentId(agentId);
    setActiveChannel(`dm-${agentId}`);
    setActiveMainView('chat');
  };

  const uniqueGoals = React.useMemo(() => {
    const seen = new Set<string>();
    const list = [...goals].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list.filter((g) => {
      const key = g.title.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [goals]);

  const availableAgents = React.useMemo(() => {
    return agents.filter((ag) =>
      isAgentAvailable(ag, ollamaStatus, credentials, availableModels)
    );
  }, [agents, ollamaStatus, credentials, availableModels]);

  const standardChannels = React.useMemo(() => {
    return channels.filter((c) => c.channelType !== 'direct_message' && !c.isPrivate && !c.id.startsWith('dm-'));
  }, [channels]);

  const coworkerDms = React.useMemo(() => {
    return channels.filter((c) => {
      if (c.channelType === 'direct_message' || c.isPrivate) {
        if (c.id.startsWith('dm-') && c.id.replace(/^dm-/, '').split('-agent-').length > 1) return true;
        if (c.memberIds && c.memberIds.length >= 2) return true;
        if (c.id.startsWith('dm-') && c.id.replace(/^dm-/, '').includes('-') && !agents.some((a) => `dm-${a.id}` === c.id)) return true;
      }
      return false;
    });
  }, [channels, agents]);

  return (
    <aside
      style={{ width: `${sidebarWidth}px` }}
      className="shrink-0 bg-[#090d16] border-r border-[#1e293b] flex flex-col h-full text-xs select-none"
    >
      {/* Active Project Header */}
      <div className="p-3 border-b border-[#1e293b] flex items-center justify-between text-kin-text font-semibold">
        <div className="flex items-center space-x-2 truncate">
          <Folder className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{activeProject?.name || 'KIN'}</span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1e293b] text-kin-muted">
          {availableAgents.length} {availableAgents.length === 1 ? 'agent' : 'agents'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* CHANNELS SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <div className="flex items-center space-x-1">
              <Hash className="w-3 h-3 text-[#64748b]" />
              <span>Channels</span>
            </div>
            <button
              onClick={() => setCreateChannelModalOpen(true)}
              className="p-0.5 rounded hover:bg-[#1e293b] text-[#64748b] hover:text-emerald-400 transition"
              title="Create New Channel"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {standardChannels.map((chan) => {
              const isActive = chan.id === activeChannelId;
              return (
                <button
                  key={chan.id}
                  onClick={() => {
                    setActiveChannel(chan.id);
                    setActiveMainView('chat');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition group ${
                    isActive
                      ? 'bg-emerald-600/20 text-emerald-400 font-medium border border-emerald-500/30'
                      : 'text-[#94a3b8] hover:bg-[#131b2e] hover:text-kin-text'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <span className="text-emerald-400 font-mono">#</span>
                    <span className="truncate">{chan.name}</span>
                  </div>
                  <div className="flex items-center space-x-1.5 shrink-0">
                    {chan.unreadCount > 0 && !isActive && (
                      <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-black font-bold text-[9px] shadow-[0_0_6px_#34d399]">
                        {chan.unreadCount}
                      </span>
                    )}
                    {chan.memberIds && (
                      <span className="text-[9px] text-[#64748b] group-hover:text-kin-muted">
                        {chan.memberIds.length}
                      </span>
                    )}
                    {chan.id !== 'chan-general' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete channel #${chan.name}?`)) {
                            deleteChannel(chan.id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-[#64748b] hover:text-red-400 transition"
                        title="Delete Channel"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* DIRECT MESSAGES SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <div className="flex items-center space-x-1">
              <MessageSquare className="w-3 h-3 text-[#64748b]" />
              <span>Direct Messages</span>
            </div>
            <button
              onClick={() => setAddAgentModalOpen(true)}
              className="p-0.5 rounded hover:bg-[#1e293b] text-[#64748b] hover:text-blue-400 transition"
              title="Hire New Specialist for Project"
            >
              <UserPlus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {availableAgents.length > 0 ? (
              availableAgents.map((agent) => {
                const isDmActive = activeChannelId === `dm-${agent.id}`;
                const isSelected = selectedAgentId === agent.id;
                const isThinking = agent.status === 'thinking' || agent.status === 'working';

                return (
                  <button
                    key={agent.id}
                    onClick={() => handleSelectDm(agent.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition cursor-pointer ${
                      isDmActive
                        ? 'bg-blue-600/20 border border-blue-500/40 text-blue-300 font-medium'
                        : isSelected
                        ? 'bg-[#131b2e] text-kin-text'
                        : 'text-[#94a3b8] hover:bg-[#131b2e] hover:text-kin-text'
                    }`}
                    title={`Open 1-on-1 Direct Message with ${agent.displayName}`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isThinking
                            ? 'bg-amber-400 animate-pulse shadow-[0_0_6px_#fbbf24]'
                            : 'bg-emerald-400 shadow-[0_0_4px_#34d399]'
                        }`}
                      />
                      <span className="truncate">{agent.displayName}</span>
                    </div>

                    {agent.isOrchestrator ? (
                      <span className="text-[9px] uppercase px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono shrink-0">
                        Boss
                      </span>
                    ) : (
                      <span className="text-[9px] uppercase px-1 rounded bg-blue-500/20 text-blue-300 font-mono shrink-0">
                        Spec
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="p-2.5 rounded-lg bg-[#0e1424] border border-[#1e293b] text-center space-y-1.5">
                <div className="text-[11px] text-[#94a3b8] font-medium">No Available Agents</div>
                <div className="text-[10px] text-[#64748b]">
                  {ollamaStatus.online
                    ? 'No installed models match configured agents'
                    : 'Ollama offline & no BYOK keys configured'}
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsModalOpen(true)}
                  className="w-full py-1 rounded bg-[#1e293b] hover:bg-[#334155] text-emerald-400 text-[10px] font-semibold transition cursor-pointer"
                >
                  Configure in Settings →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* COWORKER DIRECT MESSAGES SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <div className="flex items-center space-x-1">
              <Users className="w-3 h-3 text-[#64748b]" />
              <span>Coworker Direct Messages</span>
            </div>
            <span className="text-[9px] font-mono text-[#475569]">
              {coworkerDms.length}
            </span>
          </div>

          <div className="space-y-0.5">
            {coworkerDms.length > 0 ? (
              coworkerDms.map((dm) => {
                const isActive = activeChannelId === dm.id;
                const memberNames = (dm.memberIds || [])
                  .map((mId) => agents.find((a) => a.id === mId)?.displayName || mId)
                  .join(' ↔ ');
                const displayLabel = memberNames || dm.name || dm.id;

                return (
                  <button
                    key={dm.id}
                    onClick={() => {
                      setActiveChannel(dm.id);
                      setActiveMainView('chat');
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition cursor-pointer group ${
                      isActive
                        ? 'bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 font-medium'
                        : 'text-[#94a3b8] hover:bg-[#131b2e] hover:text-kin-text'
                    }`}
                    title={`Inspect Coworker DM: ${displayLabel}`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_4px_#818cf8] shrink-0" />
                      <span className="truncate">{displayLabel}</span>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      {dm.unreadCount > 0 && !isActive && (
                        <span className="px-1.5 py-0.2 rounded-full bg-indigo-500 text-black font-bold text-[9px]">
                          {dm.unreadCount}
                        </span>
                      )}
                      <span className="text-[9px] font-mono uppercase px-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        Audit
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="px-2.5 py-1.5 text-[10px] text-[#475569] italic">
                No active coworker direct messages
              </div>
            )}
          </div>
        </div>

        {/* TASKS & GOALS SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <div className="flex items-center space-x-1">
              <Target className="w-3 h-3 text-[#64748b]" />
              <span>Goals & Tasks</span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setNewGoalModalOpen(true)}
                className="flex items-center space-x-0.5 px-1 py-0.5 rounded hover:bg-[#1e293b] text-[#64748b] hover:text-emerald-400 transition"
                title="Create New Goal in Project"
              >
                <Plus className="w-3 h-3 text-emerald-400" />
                <span className="text-[9px] font-mono lowercase">Goal</span>
              </button>
              <button
                onClick={() => setNewTaskModalOpen(true)}
                className="flex items-center space-x-0.5 px-1 py-0.5 rounded hover:bg-[#1e293b] text-[#64748b] hover:text-blue-400 transition"
                title="Create Task in Active Goal"
              >
                <Plus className="w-3 h-3 text-blue-400" />
                <span className="text-[9px] font-mono lowercase">Task</span>
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5 no-scrollbar">
            {uniqueGoals.map((goal) => {
              const goalTasks = tasks.filter((t) => t.goalId === goal.id);
              const completedCount = goalTasks.filter((t) => t.status === 'completed').length;

              return (
                <div key={goal.id} className="p-2 rounded-lg bg-[#0e1424] border border-[#1e293b] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-kin-text text-[11px] truncate flex-1 mr-1" title={goal.title}>
                      {goal.title}
                    </span>
                    <div className="flex items-center space-x-1 shrink-0">
                      <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#1e293b] text-emerald-400">
                        {completedCount}/{goalTasks.length}
                      </span>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete goal "${goal.title}" and its tasks?`)) {
                            deleteGoal(goal.id);
                          }
                        }}
                        className="p-0.5 rounded hover:bg-red-500/20 text-[#64748b] hover:text-red-400 transition"
                        title="Delete Goal"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    {goalTasks.map((task) => {
                      const nextStatus: Record<string, 'ready' | 'running' | 'completed'> = {
                        ready: 'running',
                        running: 'completed',
                        completed: 'ready',
                        failed: 'ready',
                      };

                      return (
                        <div
                          key={task.id}
                          className="flex items-center justify-between px-1.5 py-1 rounded bg-[#070b12] border border-[#1e293b]/60 group text-[10px]"
                        >
                          <div className="flex items-center space-x-1.5 truncate flex-1 mr-1">
                            <button
                              onClick={() => updateTaskStatus(task.id, nextStatus[task.status] || 'ready')}
                              className="shrink-0 hover:scale-110 transition"
                              title={`Status: ${task.status} (Click to advance)`}
                            >
                              {task.status === 'completed' ? (
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              ) : task.status === 'running' ? (
                                <PlayCircle className="w-3 h-3 text-blue-400 animate-pulse" />
                              ) : task.status === 'failed' ? (
                                <AlertCircle className="w-3 h-3 text-red-400" />
                              ) : (
                                <Clock className="w-3 h-3 text-amber-400" />
                              )}
                            </button>
                            <span
                              className={`truncate ${
                                task.status === 'completed'
                                  ? 'line-through text-[#64748b]'
                                  : task.status === 'running'
                                  ? 'text-blue-300 font-medium'
                                  : 'text-[#94a3b8]'
                              }`}
                              title={task.title}
                            >
                              {task.title}
                            </span>
                          </div>

                          <div className="flex items-center space-x-1 shrink-0">
                            <span
                              className={`text-[8px] font-mono uppercase px-1 py-0.2 rounded ${
                                task.status === 'completed'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : task.status === 'running'
                                  ? 'bg-blue-500/10 text-blue-400'
                                  : 'bg-[#1e293b] text-[#64748b]'
                              }`}
                            >
                              {task.status}
                            </span>
                            <button
                              onClick={() => deleteTask(task.id)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-[#64748b] hover:text-red-400 transition"
                              title="Delete Task"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {goals.length === 0 && (
              <div className="text-[10px] text-[#64748b] text-center py-2 italic">
                No active goals in project
              </div>
            )}
          </div>
        </div>

        {/* ARCHITECTURE DECISION RECORDS (ADR) SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <div className="flex items-center space-x-1">
              <Scale className="w-3 h-3 text-amber-400" />
              <span>Decisions (ADR)</span>
            </div>
            <button
              onClick={() => setDecisionsModalOpen(true)}
              className="p-0.5 rounded hover:bg-[#1e293b] text-[#64748b] hover:text-amber-400 transition"
              title="Open Architecture Decision Records Modal"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setDecisionsModalOpen(true)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-[#94a3b8] hover:bg-[#131b2e] hover:text-kin-text transition border border-[#1e293b]/50 group"
          >
            <div className="flex items-center space-x-2 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_4px_#fbbf24]" />
              <span className="truncate">Decision Records</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
              {decisions.length}
            </span>
          </button>
        </div>

        {/* AUTOMATIONS & SCHEDULES SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <div className="flex items-center space-x-1">
              <Clock className="w-3 h-3 text-cyan-400" />
              <span>Automations & Schedules</span>
            </div>
            <button
              onClick={() => {
                setActiveMainView('automations');
                setAutomationsModalOpen(true);
              }}
              className="p-0.5 rounded hover:bg-[#1e293b] text-[#64748b] hover:text-cyan-400 transition cursor-pointer"
              title="Add New Automation / Schedule"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setActiveMainView('automations')}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition border group cursor-pointer ${
              activeMainView === 'automations'
                ? 'bg-cyan-600/20 text-cyan-300 font-medium border-cyan-500/40 shadow-sm'
                : 'text-[#94a3b8] hover:bg-[#131b2e] hover:text-kin-text border-[#1e293b]/50'
            }`}
          >
            <div className="flex items-center space-x-2 truncate">
              <span className={`w-1.5 h-1.5 rounded-full ${activeMainView === 'automations' ? 'bg-cyan-300 shadow-[0_0_6px_#67e8f9]' : 'bg-cyan-400 shadow-[0_0_4px_#22d3ee]'}`} />
              <span className="truncate">Schedules & Routines</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
              {schedules.filter((s) => s.status === 'active').length} active
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Settings & Preferences Bar */}
      <div className="p-2 border-t border-[#1e293b] bg-[#070b12] space-y-1">
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setSettingsModalOpen(true)}
            className="flex-1 flex items-center justify-between px-2.5 py-2 rounded-lg bg-[#131b2e] hover:bg-[#1c2742] text-kin-text border border-[#1e293b] hover:border-emerald-500/40 transition shadow-sm group cursor-pointer"
            title="Open System Settings & Preferences"
          >
            <div className="flex items-center space-x-2 truncate">
              <Settings className="w-4 h-4 text-emerald-400 group-hover:rotate-45 transition-transform duration-300 shrink-0" />
              <span className="font-semibold text-xs truncate">Settings</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              {autonomyMode}
            </span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-[#131b2e] hover:bg-[#1c2742] text-[#8b949e] hover:text-kin-text border border-[#1e293b] transition cursor-pointer shrink-0"
            title={theme === 'light' ? 'Switch to Dark Theme' : 'Switch to Minimal Light Theme'}
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4 text-amber-400" />
            ) : (
              <Sun className="w-4 h-4 text-amber-300" />
            )}
          </button>
        </div>

        <button
          onClick={() => setActiveRightTab('Agent')}
          className="w-full flex items-center space-x-2 px-2.5 py-1 rounded text-[#64748b] hover:text-[#94a3b8] hover:bg-[#0d121f] transition text-[11px] cursor-pointer"
          title="Open Agent Inspector & Contract Tab"
        >
          <span>Inspector & Telemetry</span>
        </button>
      </div>
    </aside>
  );
};
