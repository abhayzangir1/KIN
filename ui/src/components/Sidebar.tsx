import React from 'react';
import { useKinStore, isAgentAvailable } from '../store/kinStore.js';
import { Folder, Hash, Plus, MessageSquare, UserPlus, Settings, Target, CheckCircle2, PlayCircle, AlertCircle, Clock, Scale, Trash2, Users, ShieldAlert } from 'lucide-react';
import { AgentModelQuickSwitch } from './AgentModelQuickSwitch.js';

export const Sidebar: React.FC = () => {
  const {
    activeProject,
    channels,
    activeChannelId,
    setActiveChannel,
    deleteChannel,
    agents,
    updateAgentModel,
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
    decisions,
    setDecisionsModalOpen,
    schedules,
    setAutomationsModalOpen,
    sidebarWidth,
    setSettingsModalOpen,
    autonomyMode,
    activeMainView,
    setActiveMainView,
  } = useKinStore();

  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = React.useState<string | null>(null);
  const [confirmDeleteGoalId, setConfirmDeleteGoalId] = React.useState<string | null>(null);

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
      className="shrink-0 bg-kin-surface border-r border-kin-border flex flex-col h-full text-xs select-none"
    >
      {/* Active Project Header */}
      <div className="p-3 border-b border-kin-border flex items-center justify-between text-kin-text font-semibold">
        <div className="flex items-center space-x-2 truncate">
          <Folder className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{activeProject?.name || 'KIN'}</span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-kin-card text-kin-muted border border-kin-border">
          {availableAgents.length} {availableAgents.length === 1 ? 'agent' : 'agents'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* CHANNELS SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-kin-muted">
            <div className="flex items-center space-x-1">
              <Hash className="w-3 h-3 text-kin-muted" />
              <span>Channels</span>
            </div>
            <button
              onClick={() => setCreateChannelModalOpen(true)}
              className="p-0.5 rounded hover:bg-kin-card text-kin-muted hover:text-emerald-500 transition cursor-pointer"
              title="Create New Channel"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {standardChannels.map((chan) => {
              const isActive = chan.id === activeChannelId;
              return (
                <div
                  key={chan.id}
                  className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition group relative ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-500 font-semibold border border-emerald-500/30 shadow-xs pl-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:bg-emerald-500'
                      : 'text-kin-muted hover:bg-kin-card hover:text-kin-text'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveChannel(chan.id);
                      setActiveMainView('chat');
                    }}
                    className="flex items-center space-x-2 truncate flex-1 min-w-0 text-left cursor-pointer mr-1"
                    title={`Open channel #${chan.name}`}
                  >
                    <span className="text-emerald-500 font-mono font-bold">#</span>
                    <span className="truncate">{chan.name}</span>
                  </button>
                  <div className="flex items-center space-x-1.5 shrink-0">
                    {chan.unreadCount > 0 && !isActive && (
                      <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-white font-bold text-[9px] shadow-xs">
                        {chan.unreadCount}
                      </span>
                    )}
                    {chan.memberIds && (
                      <span className="text-[9px] text-kin-muted">
                        {chan.memberIds.length}
                      </span>
                    )}
                    {chan.id !== 'chan-general' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirmDeleteChannelId === chan.id) {
                            deleteChannel(chan.id);
                            setConfirmDeleteChannelId(null);
                          } else {
                            setConfirmDeleteChannelId(chan.id);
                            setTimeout(() => {
                              setConfirmDeleteChannelId((cur) => (cur === chan.id ? null : cur));
                            }, 3500);
                          }
                        }}
                        className={`p-0.5 rounded transition cursor-pointer ${
                          confirmDeleteChannelId === chan.id
                            ? 'bg-red-500 text-white opacity-100 px-1 text-[9px] font-bold shadow-xs'
                            : 'opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-kin-muted hover:text-red-500'
                        }`}
                        title={confirmDeleteChannelId === chan.id ? `Click again to confirm deleting #${chan.name}` : `Delete channel #${chan.name}`}
                      >
                        {confirmDeleteChannelId === chan.id ? 'Delete?' : <Trash2 className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* DIRECT MESSAGES SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-kin-muted">
            <div className="flex items-center space-x-1">
              <MessageSquare className="w-3 h-3 text-kin-muted" />
              <span>Direct Messages</span>
            </div>
            <button
              onClick={() => setAddAgentModalOpen(true)}
              className="p-0.5 rounded hover:bg-kin-card text-kin-muted hover:text-blue-500 transition cursor-pointer"
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
                  <div
                    key={agent.id}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition relative group ${
                      isDmActive
                        ? 'bg-blue-500/15 border border-blue-500/40 text-blue-500 font-semibold shadow-xs pl-3.5 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:bg-blue-500'
                        : isSelected
                        ? 'bg-kin-card text-kin-text font-medium'
                        : 'text-kin-muted hover:bg-kin-card hover:text-kin-text'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectDm(agent.id)}
                      className="flex items-center space-x-2 truncate flex-1 min-w-0 text-left cursor-pointer mr-1"
                      title={`Open 1-on-1 Direct Message with ${agent.displayName}`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isThinking ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'
                        }`}
                      />
                      <span className="truncate text-xs font-medium">{agent.displayName}</span>
                    </button>

                    <div className="flex items-center space-x-1 shrink-0">
                      <AgentModelQuickSwitch
                        agent={agent}
                        availableModels={availableModels}
                        updateAgentModel={updateAgentModel}
                        projectId={activeProject?.id}
                        channelId={activeChannelId}
                        compact
                      />
                      {agent.isOrchestrator ? (
                        <span className="text-[9px] uppercase px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono shrink-0">
                          Boss
                        </span>
                      ) : (
                        <span className="text-[9px] uppercase px-1 rounded bg-blue-500/20 text-blue-300 font-mono shrink-0">
                          Spec
                        </span>
                      )}
                    </div>
                  </div>
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
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-kin-muted">
            <div className="flex items-center space-x-1">
              <Users className="w-3 h-3 text-kin-muted" />
              <span>Coworker Direct Messages</span>
            </div>
            <span className="text-[9px] font-mono text-kin-muted">
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
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition cursor-pointer group ${
                      isActive
                        ? 'bg-indigo-500/15 border border-indigo-500/40 text-indigo-400 font-semibold shadow-xs'
                        : 'text-kin-muted hover:bg-kin-card hover:text-kin-text'
                    }`}
                    title={`Inspect Coworker DM: ${displayLabel}`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                      <span className="truncate">{displayLabel}</span>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      {dm.unreadCount > 0 && !isActive && (
                        <span className="px-1.5 py-0.2 rounded-full bg-indigo-500 text-white font-bold text-[9px]">
                          {dm.unreadCount}
                        </span>
                      )}
                      <span className="text-[9px] font-mono uppercase px-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        Audit
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="px-2.5 py-1.5 text-[10px] text-kin-muted italic">
                No active coworker direct messages
              </div>
            )}
          </div>
        </div>

        {/* TASKS & GOALS SECTION */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-kin-muted">
            <div className="flex items-center space-x-1.5">
              <Target className="w-3.5 h-3.5 text-emerald-500" />
              <span>Goals & Tasks</span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setNewGoalModalOpen(true)}
                className="flex items-center space-x-0.5 px-1.5 py-0.5 rounded hover:bg-kin-card text-kin-muted hover:text-emerald-500 transition cursor-pointer"
                title="Create New Goal in Project"
              >
                <Plus className="w-3 h-3 text-emerald-500" />
                <span className="text-[9px] font-mono lowercase">Goal</span>
              </button>
              <button
                onClick={() => setNewTaskModalOpen(true)}
                className="flex items-center space-x-0.5 px-1.5 py-0.5 rounded hover:bg-kin-card text-kin-muted hover:text-blue-500 transition cursor-pointer"
                title="Create Task in Active Goal"
              >
                <Plus className="w-3 h-3 text-blue-500" />
                <span className="text-[9px] font-mono lowercase">Task</span>
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5 no-scrollbar">
            {uniqueGoals.map((goal) => {
              const goalTasks = tasks.filter((t) => t.goalId === goal.id);
              const completedCount = goalTasks.filter((t) => t.status === 'completed').length;
              const percent = goalTasks.length > 0 ? Math.round((completedCount / goalTasks.length) * 100) : 0;

              return (
                <div key={goal.id} className="p-2.5 rounded-xl bg-kin-card hover:bg-kin-cardHover border border-kin-border transition space-y-2 shadow-xs group/goal">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-kin-text text-xs truncate flex-1 mr-2" title={goal.title}>
                      {goal.title}
                    </span>
                    <div className="flex items-center space-x-1.5 shrink-0">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 font-bold border border-emerald-500/20">
                        {completedCount}/{goalTasks.length}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirmDeleteGoalId === goal.id) {
                            deleteGoal(goal.id);
                            setConfirmDeleteGoalId(null);
                          } else {
                            setConfirmDeleteGoalId(goal.id);
                            setTimeout(() => {
                              setConfirmDeleteGoalId((cur) => (cur === goal.id ? null : cur));
                            }, 3500);
                          }
                        }}
                        className={`p-0.5 rounded transition cursor-pointer ${
                          confirmDeleteGoalId === goal.id
                            ? 'bg-red-500 text-white opacity-100 px-1 text-[9px] font-bold shadow-xs'
                            : 'opacity-0 group-hover/goal:opacity-100 hover:bg-red-500/10 text-kin-muted hover:text-red-500'
                        }`}
                        title={confirmDeleteGoalId === goal.id ? `Click again to confirm deleting "${goal.title}"` : 'Delete Goal'}
                      >
                        {confirmDeleteGoalId === goal.id ? 'Delete?' : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>

                  {/* Sleek Mini Progress Bar */}
                  {goalTasks.length > 0 && (
                    <div className="w-full bg-kin-surface h-1 rounded-full overflow-hidden border border-kin-border/50">
                      <div
                        className="bg-emerald-500 h-full transition-all duration-300 rounded-full"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    {goalTasks.map((task) => {
                      const nextStatus: Record<string, 'ready' | 'running' | 'completed'> = {
                        ready: 'completed',
                        running: 'completed',
                        review: 'completed',
                        blocked: 'ready',
                        backlog: 'ready',
                        completed: 'ready',
                        failed: 'ready',
                        cancelled: 'ready',
                      };

                      return (
                        <div
                          key={task.id}
                          className="flex items-center justify-between px-2 py-1 rounded-lg bg-kin-surface border border-kin-border hover:border-kin-border/80 group/task text-[11px] transition"
                        >
                          <div className="flex items-center space-x-2 truncate flex-1 mr-1">
                            <button
                              onClick={() => updateTaskStatus(task.id, nextStatus[task.status] || 'ready')}
                              className="shrink-0 hover:scale-110 transition cursor-pointer"
                              title={`Status: ${task.status}${task.status === 'review' ? ' (Awaiting operator sign-off - Click to approve)' : ' (Click to advance)'}`}
                            >
                              {task.status === 'completed' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              ) : task.status === 'running' ? (
                                <PlayCircle className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
                              ) : task.status === 'review' ? (
                                <ShieldAlert className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                              ) : task.status === 'failed' ? (
                                <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                              ) : (
                                <Clock className="w-3.5 h-3.5 text-amber-500" />
                              )}
                            </button>
                            <span
                              className={`truncate text-[11px] ${
                                task.status === 'completed'
                                  ? 'line-through text-kin-muted'
                                  : task.status === 'running'
                                  ? 'text-blue-500 font-medium'
                                  : task.status === 'review'
                                  ? 'text-purple-400 font-medium'
                                  : 'text-kin-text'
                              }`}
                              title={task.title}
                            >
                              {task.title}
                            </span>
                          </div>

                          <div className="flex items-center space-x-1 shrink-0">
                            <span
                              className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded font-semibold ${
                                task.status === 'completed'
                                  ? 'bg-emerald-500/10 text-emerald-500'
                                  : task.status === 'running'
                                  ? 'bg-blue-500/10 text-blue-500'
                                  : task.status === 'review'
                                  ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                                  : 'bg-kin-card text-kin-muted border border-kin-border/50'
                              }`}
                            >
                              {task.status}
                            </span>
                            <button
                              onClick={() => deleteTask(task.id)}
                              className="opacity-0 group-hover/task:opacity-100 p-0.5 rounded hover:bg-red-500/10 text-kin-muted hover:text-red-500 transition cursor-pointer"
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
              <div className="text-[11px] text-kin-muted text-center py-3 italic">
                No active goals in project
              </div>
            )}
          </div>
        </div>

        {/* ARCHITECTURE DECISION RECORDS (ADR) SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-kin-muted">
            <div className="flex items-center space-x-1">
              <Scale className="w-3.5 h-3.5 text-amber-500" />
              <span>Decisions (ADR)</span>
            </div>
            <button
              onClick={() => setDecisionsModalOpen(true)}
              className="p-0.5 rounded hover:bg-kin-card text-kin-muted hover:text-amber-500 transition cursor-pointer"
              title="Open Architecture Decision Records Modal"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setDecisionsModalOpen(true)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-kin-muted hover:bg-kin-card hover:text-kin-text transition border border-kin-border group cursor-pointer"
          >
            <div className="flex items-center space-x-2 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              <span className="truncate">Decision Records</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-500 font-semibold border border-amber-500/20">
              {decisions.length}
            </span>
          </button>
        </div>

        {/* AUTOMATIONS & SCHEDULES SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-kin-muted">
            <div className="flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5 text-cyan-500" />
              <span>Automations & Schedules</span>
            </div>
            <button
              onClick={() => {
                setActiveMainView('automations');
                setAutomationsModalOpen(true);
              }}
              className="p-0.5 rounded hover:bg-kin-card text-kin-muted hover:text-cyan-500 transition cursor-pointer"
              title="Add New Automation / Schedule"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setActiveMainView('automations')}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition border group cursor-pointer ${
              activeMainView === 'automations'
                ? 'bg-cyan-500/15 text-cyan-500 font-semibold border-cyan-500/40 shadow-xs'
                : 'text-kin-muted hover:bg-kin-card hover:text-kin-text border-kin-border'
            }`}
          >
            <div className="flex items-center space-x-2 truncate">
              <span className={`w-1.5 h-1.5 rounded-full ${activeMainView === 'automations' ? 'bg-cyan-400' : 'bg-cyan-500'}`} />
              <span className="truncate">Schedules & Routines</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-500 font-semibold border border-cyan-500/20">
              {schedules.filter((s) => s.status === 'active').length} active
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Settings & Preferences Bar */}
      <div className="p-2.5 border-t border-kin-border bg-kin-surface shrink-0">
        <button
          onClick={() => setSettingsModalOpen(true)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-kin-card hover:bg-kin-cardHover text-kin-text border border-kin-border transition group cursor-pointer"
          title="Open System Settings & Preferences"
        >
          <div className="flex items-center space-x-2 truncate">
            <Settings className="w-4 h-4 text-kin-muted group-hover:text-kin-text group-hover:rotate-45 transition-transform duration-300 shrink-0" />
            <span className="font-semibold text-xs truncate">Settings</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 font-medium">
            {autonomyMode}
          </span>
        </button>
      </div>
    </aside>
  );
};
