import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import {
  Clock,
  Timer,
  Play,
  Trash2,
  Plus,
  RefreshCw,
  CheckCircle2,
  Calendar,
  Bot,
  Hash,
  Cpu,
  ArrowLeft,
  Search,
  Activity,
  Zap,
} from 'lucide-react';

export const AutomationsView: React.FC = () => {
  const {
    schedules,
    fetchSchedules,
    triggerScheduleNow,
    cancelSchedule,
    createSchedule,
    agents,
    channels,
    activeChannelId,
    setActiveMainView,
    systemHealth,
    fetchSystemHealth,
  } = useKinStore();

  const [now, setNow] = useState(Date.now());
  const [filterType, setFilterType] = useState<'all' | 'one_shot' | 'cron'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [schedType, setSchedType] = useState<'one_shot' | 'cron'>('one_shot');
  const [durationSeconds, setDurationSeconds] = useState(15);
  const [cronExpression, setCronExpression] = useState('*/10 * * * *');
  const [prompt, setPrompt] = useState('');
  const [targetAgentId, setTargetAgentId] = useState<string>('');
  const [targetChannelId, setTargetChannelId] = useState<string>('');

  // Live countdown ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync schedules and system health
  useEffect(() => {
    fetchSchedules();
    fetchSystemHealth();
  }, [fetchSchedules, fetchSystemHealth]);

  // Set default form agent and channel
  useEffect(() => {
    if (agents.length > 0 && !targetAgentId) {
      const boss = agents.find((a) => a.isOrchestrator) || agents[0];
      setTargetAgentId(boss.id);
    }
    if (!targetChannelId) {
      setTargetChannelId(activeChannelId || channels[0]?.id || 'chan-general');
    }
  }, [agents, channels, activeChannelId, targetAgentId, targetChannelId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setActionFeedback('Please provide a valid prompt or directive.');
      return;
    }

    setIsSubmitting(true);
    setActionFeedback(null);

    const res = await createSchedule({
      type: schedType,
      durationSeconds: schedType === 'one_shot' ? Number(durationSeconds) : undefined,
      cronExpression: schedType === 'cron' ? cronExpression : undefined,
      prompt: prompt.trim(),
      targetAgentId: targetAgentId || undefined,
      channelId: targetChannelId || undefined,
    });

    setIsSubmitting(false);

    if (res.success) {
      setActionFeedback('Automation registered and scheduled successfully!');
      setPrompt('');
      setIsCreating(false);
      fetchSchedules();
      setTimeout(() => setActionFeedback(null), 3000);
    } else {
      setActionFeedback(`Failed: ${res.error || 'Unknown error'}`);
    }
  };

  const handleTrigger = async (id: string) => {
    const res = await triggerScheduleNow(id);
    if (res.success) {
      setActionFeedback('Triggered automation execution successfully.');
      fetchSchedules();
      setTimeout(() => setActionFeedback(null), 3000);
    } else {
      setActionFeedback(`Trigger failed: ${res.error || 'Unknown'}`);
    }
  };

  const handleCancel = async (id: string) => {
    await cancelSchedule(id);
    setActionFeedback('Cancelled schedule.');
    fetchSchedules();
    setTimeout(() => setActionFeedback(null), 3000);
  };

  const filteredSchedules = schedules.filter((s) => {
    if (filterType !== 'all' && s.type !== filterType) return false;
    if (filterStatus !== 'all' && s.status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchPrompt = s.prompt.toLowerCase().includes(q);
      const matchAgent = s.targetAgentId?.toLowerCase().includes(q);
      const matchChannel = s.channelId?.toLowerCase().includes(q);
      return matchPrompt || matchAgent || matchChannel;
    }
    return true;
  });

  const activeCount = schedules.filter((s) => s.status === 'active').length;
  const totalCount = schedules.length;

  return (
    <main className="flex-1 flex flex-col h-full bg-[#0a0f1d] min-w-0 overflow-y-auto text-kin-text select-none">
      {/* Top Header */}
      <div className="px-6 py-4 border-b border-[#1e293b] bg-[#0c1222] flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setActiveMainView('chat')}
            className="p-1.5 rounded-lg bg-[#1e293b] hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300 border border-[#2d3748] transition cursor-pointer"
            title="Return to Channel Chat Workspace"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <Timer className="w-5 h-5 text-cyan-400" />
              <h1 className="text-base font-bold text-white tracking-wide">
                Automations & Schedules Control Hub
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                {activeCount} Active
              </span>
            </div>
            <p className="text-xs text-[#94a3b8] mt-0.5">
              Autonomous wakeup timers, durable cron routines, and multi-agent proactive execution schedules
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              fetchSchedules();
              fetchSystemHealth();
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#1e293b] hover:bg-[#283548] text-xs font-medium text-[#cbd5e1] border border-[#2d3748] transition cursor-pointer"
            title="Refresh Automations & Health"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setIsCreating(!isCreating)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-lg shadow-emerald-900/40 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{isCreating ? 'Close Creator' : 'New Schedule'}</span>
          </button>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionFeedback && (
        <div className="mx-6 mt-4 px-4 py-2 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionFeedback}</span>
          </div>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-emerald-400 hover:text-emerald-200 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Dynamic Resource Governor Telemetry Bar */}
      {systemHealth && (
        <div className="mx-6 mt-4 p-3 rounded-xl bg-[#0e1628] border border-[#1e293b] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5 font-mono">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-[#94a3b8]">System Status:</span>
              <span
                className={`font-bold px-1.5 py-0.5 rounded text-[10px] uppercase ${
                  systemHealth.status === 'healthy'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                }`}
              >
                {systemHealth.status}
              </span>
            </div>

            {(systemHealth.memory || (systemHealth as any).components?.memory) && (() => {
              const mem = systemHealth.memory || {
                freeMb: Math.round(((systemHealth as any).components?.memory?.freeMemBytes || 0) / (1024 * 1024)),
                totalMb: Math.round(((systemHealth as any).components?.memory?.totalMemBytes || 0) / (1024 * 1024)),
                freeRatio: ((systemHealth as any).components?.memory?.freeMemBytes || 0) / ((systemHealth as any).components?.memory?.totalMemBytes || 1),
              };
              return (
                <div className="flex items-center space-x-1.5 font-mono text-[#94a3b8]">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span>Free RAM:</span>
                  <span className="text-white font-semibold">
                    {mem.freeMb} MB / {mem.totalMb} MB (
                    {Math.round((mem.freeRatio || 0) * 100)}%)
                  </span>
                </div>
              );
            })()}
          </div>

          {(systemHealth.limits || (systemHealth as any).components?.memory) && (() => {
            const lim = systemHealth.limits || {
              maxConcurrentShell: (systemHealth as any).components?.memory?.maxShellProcesses || 2,
              maxConcurrentBrowser: (systemHealth as any).components?.memory?.maxBrowserContexts || 2,
            };
            return (
              <div className="flex items-center space-x-3 font-mono text-[11px] text-[#94a3b8]">
                <span className="px-2 py-0.5 rounded bg-[#1e293b] text-blue-300">
                  Max Shells: {lim.maxConcurrentShell}
                </span>
                <span className="px-2 py-0.5 rounded bg-[#1e293b] text-indigo-300">
                  Max Browsers: {lim.maxConcurrentBrowser}
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* Creation Drawer / Form */}
      {isCreating && (
        <div className="mx-6 mt-4 p-4 rounded-xl bg-[#0f172a] border border-cyan-500/40 space-y-3 shadow-xl">
          <div className="flex items-center justify-between border-b border-[#1e293b] pb-2">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-white">Create Proactive Routine or Wakeup Timer</h2>
            </div>
            <button
              onClick={() => setIsCreating(false)}
              className="text-[#64748b] hover:text-white text-xs"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleCreate} className="space-y-3 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Schedule Type */}
              <div>
                <label className="block text-[#94a3b8] mb-1 font-medium">Schedule Type</label>
                <div className="flex rounded-lg overflow-hidden border border-[#2d3748]">
                  <button
                    type="button"
                    onClick={() => setSchedType('one_shot')}
                    className={`flex-1 py-1.5 text-center transition cursor-pointer ${
                      schedType === 'one_shot'
                        ? 'bg-cyan-600 text-white font-bold'
                        : 'bg-[#1e293b] text-[#94a3b8] hover:text-white'
                    }`}
                  >
                    One-Shot Timer
                  </button>
                  <button
                    type="button"
                    onClick={() => setSchedType('cron')}
                    className={`flex-1 py-1.5 text-center transition cursor-pointer ${
                      schedType === 'cron'
                        ? 'bg-cyan-600 text-white font-bold'
                        : 'bg-[#1e293b] text-[#94a3b8] hover:text-white'
                    }`}
                  >
                    Recurring Cron
                  </button>
                </div>
              </div>

              {/* Timing Parameter */}
              <div>
                {schedType === 'one_shot' ? (
                  <>
                    <label className="block text-[#94a3b8] mb-1 font-medium">
                      Duration (Seconds)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={86400}
                      value={durationSeconds}
                      onChange={(e) => setDurationSeconds(Number(e.target.value))}
                      className="w-full bg-[#1e293b] border border-[#2d3748] rounded-lg px-3 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </>
                ) : (
                  <>
                    <label className="block text-[#94a3b8] mb-1 font-medium">
                      Cron Expression (5-part or interval e.g. */5 * * * *)
                    </label>
                    <input
                      type="text"
                      value={cronExpression}
                      onChange={(e) => setCronExpression(e.target.value)}
                      placeholder="*/15 * * * *"
                      className="w-full bg-[#1e293b] border border-[#2d3748] rounded-lg px-3 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </>
                )}
              </div>

              {/* Target Agent & Channel */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#94a3b8] mb-1 font-medium">Target Agent</label>
                  <select
                    value={targetAgentId}
                    onChange={(e) => setTargetAgentId(e.target.value)}
                    className="w-full bg-[#1e293b] border border-[#2d3748] rounded-lg px-2 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                  >
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[#94a3b8] mb-1 font-medium">Channel</label>
                  <select
                    value={targetChannelId}
                    onChange={(e) => setTargetChannelId(e.target.value)}
                    className="w-full bg-[#1e293b] border border-[#2d3748] rounded-lg px-2 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                  >
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        #{ch.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Directive Prompt */}
            <div>
              <label className="block text-[#94a3b8] mb-1 font-medium">
                Directive Prompt to Execute Upon Trigger
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Inspect git diff for uncommitted changes, run build diagnostics, and post summary..."
                rows={2}
                className="w-full bg-[#1e293b] border border-[#2d3748] rounded-lg p-2.5 text-white font-sans text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3 py-1.5 rounded-lg bg-[#1e293b] hover:bg-[#283548] text-[#94a3b8] text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition cursor-pointer"
              >
                {isSubmitting ? 'Arming Schedule...' : 'Arm & Schedule Now'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter and Search Controls */}
      <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-2">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#64748b] absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompt, agent, channel..."
              className="bg-[#111827] border border-[#1e293b] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#64748b] focus:border-cyan-500 focus:outline-none w-56"
            />
          </div>

          {/* Type Filter */}
          <div className="flex rounded-lg overflow-hidden border border-[#1e293b]">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 text-[11px] font-mono ${
                filterType === 'all' ? 'bg-[#1e293b] text-cyan-400 font-bold' : 'bg-[#0f172a] text-[#94a3b8]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterType('one_shot')}
              className={`px-2.5 py-1 text-[11px] font-mono ${
                filterType === 'one_shot' ? 'bg-[#1e293b] text-cyan-400 font-bold' : 'bg-[#0f172a] text-[#94a3b8]'
              }`}
            >
              Timers
            </button>
            <button
              onClick={() => setFilterType('cron')}
              className={`px-2.5 py-1 text-[11px] font-mono ${
                filterType === 'cron' ? 'bg-[#1e293b] text-cyan-400 font-bold' : 'bg-[#0f172a] text-[#94a3b8]'
              }`}
            >
              Routines
            </button>
          </div>

          {/* Status Filter */}
          <div className="flex rounded-lg overflow-hidden border border-[#1e293b]">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-2.5 py-1 text-[11px] font-mono ${
                filterStatus === 'all' ? 'bg-[#1e293b] text-emerald-400 font-bold' : 'bg-[#0f172a] text-[#94a3b8]'
              }`}
            >
              All Status
            </button>
            <button
              onClick={() => setFilterStatus('active')}
              className={`px-2.5 py-1 text-[11px] font-mono ${
                filterStatus === 'active' ? 'bg-[#1e293b] text-emerald-400 font-bold' : 'bg-[#0f172a] text-[#94a3b8]'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setFilterStatus('completed')}
              className={`px-2.5 py-1 text-[11px] font-mono ${
                filterStatus === 'completed' ? 'bg-[#1e293b] text-emerald-400 font-bold' : 'bg-[#0f172a] text-[#94a3b8]'
              }`}
            >
              Completed
            </button>
          </div>
        </div>

        <div className="text-xs text-[#94a3b8] font-mono">
          Showing {filteredSchedules.length} of {totalCount} automations
        </div>
      </div>

      {/* Main Schedules List */}
      <div className="mx-6 mt-4 pb-8 space-y-2.5">
        {filteredSchedules.map((s) => {
          const remainingSec = Math.max(0, Math.ceil((s.nextRunAt - now) / 1000));
          const targetAgent = agents.find((a) => a.id === s.targetAgentId);
          const targetChan = channels.find((c) => c.id === s.channelId);

          return (
            <div
              key={s.id}
              className={`p-3.5 rounded-xl border transition-all ${
                s.status === 'active'
                  ? 'bg-[#0d1424] border-[#1e293b] hover:border-cyan-500/50 shadow-md'
                  : 'bg-[#070b14]/70 border-[#1a2234] opacity-75'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                {/* Left: Timing & Prompt */}
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        s.type === 'one_shot'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      }`}
                    >
                      {s.type === 'one_shot' ? 'One-Shot Timer' : 'Cron Routine'}
                    </span>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        s.status === 'active'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : s.status === 'completed'
                          ? 'bg-blue-500/20 text-blue-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}
                    >
                      {s.status}
                    </span>

                    {s.status === 'active' && (
                      <span className="flex items-center space-x-1 font-mono text-[11px] text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">
                        <Clock className="w-3 h-3 text-cyan-400" />
                        <span>Fires in {remainingSec}s</span>
                      </span>
                    )}

                    {s.cronExpression && (
                      <span className="font-mono text-[11px] text-[#94a3b8] bg-[#1e293b] px-2 py-0.5 rounded">
                        cron: {s.cronExpression}
                      </span>
                    )}
                  </div>

                  <div className="text-white text-xs font-medium font-sans leading-relaxed break-words">
                    {s.prompt}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#94a3b8]">
                    <span className="flex items-center space-x-1">
                      <Bot className="w-3 h-3 text-emerald-400" />
                      <span>{targetAgent?.displayName || s.targetAgentId || '@Boss'}</span>
                    </span>

                    <span className="flex items-center space-x-1">
                      <Hash className="w-3 h-3 text-blue-400" />
                      <span>{targetChan?.name ? `#${targetChan.name}` : s.channelId || 'general'}</span>
                    </span>

                    <span className="flex items-center space-x-1">
                      <Calendar className="w-3 h-3 text-purple-400" />
                      <span>Next: {new Date(s.nextRunAt).toLocaleTimeString()}</span>
                    </span>

                    {s.lastRunAt && (
                      <span className="text-[#64748b]">
                        Last ran: {new Date(s.lastRunAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => handleTrigger(s.id)}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-xs font-medium transition cursor-pointer"
                    title="Trigger this automation immediately right now"
                  >
                    <Play className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Trigger Now</span>
                  </button>

                  {s.status === 'active' && (
                    <button
                      onClick={() => handleCancel(s.id)}
                      className="p-1.5 rounded-lg bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/30 transition cursor-pointer"
                      title="Cancel and deactivate schedule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {filteredSchedules.length === 0 && (
          <div className="py-16 text-center border border-dashed border-[#1e293b] rounded-2xl bg-[#0c1222]/30 space-y-3">
            <Timer className="w-10 h-10 text-cyan-400/40 mx-auto" />
            <div className="text-sm font-semibold text-white">No schedules match the criteria</div>
            <p className="text-xs text-[#64748b] max-w-sm mx-auto">
              Create an automated wakeup timer or proactive routine using the button above or type /schedule in chat.
            </p>
          </div>
        )}
      </div>
    </main>
  );
};
