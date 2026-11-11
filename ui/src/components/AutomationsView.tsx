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
  AlertTriangle,
  X,
  Sparkles,
  ShieldCheck,
  GitPullRequest,
  FileText,
  PlayCircle,
} from 'lucide-react';
import type { ScheduleAttemptItem } from '../store/kinStore.js';
import {
  DIRECTIVE_BLUEPRINTS,
  QUICK_INTERVALS,
  QUICK_TIMERS,
  NATURAL_DAILY_TIMES,
  translateCronToEnglish,
  DirectiveBlueprint,
} from '../utils/automationCadence.js';

export const AutomationsView: React.FC = () => {
  const {
    schedules,
    fetchSchedules,
    triggerScheduleNow,
    retrySchedule,
    fetchScheduleAttempts,
    cancelSchedule,
    createSchedule,
    agents,
    channels,
    activeChannelId,
    setActiveMainView,
    systemHealth,
    fetchSystemHealth,
    addToast,
  } = useKinStore();

  const [now, setNow] = useState(Date.now());
  const [filterType, setFilterType] = useState<'all' | 'one_shot' | 'cron'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'cancelled' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attemptsScheduleId, setAttemptsScheduleId] = useState<string | null>(null);
  const [attemptsList, setAttemptsList] = useState<ScheduleAttemptItem[]>([]);
  const [loadingAttempts, setLoadingAttempts] = useState(false);

  // Cadence Picker Mode
  const [cadenceMode, setCadenceMode] = useState<'interval' | 'timer' | 'natural' | 'cron'>('interval');
  const [schedType, setSchedType] = useState<'one_shot' | 'cron'>('cron');
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [cronExpression, setCronExpression] = useState('*/15 * * * *');
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
      setTargetChannelId(activeChannelId || channels.find((c: any) => c.isDefault)?.id || channels[0]?.id || '');
    }
  }, [agents, channels, activeChannelId, targetAgentId, targetChannelId]);

  const handleApplyBlueprint = (bp: DirectiveBlueprint) => {
    setPrompt(bp.prompt);
    if (bp.cadenceType === 'one_shot') {
      setSchedType('one_shot');
      setCadenceMode('timer');
      setDurationSeconds(bp.durationSeconds || 60);
    } else {
      setSchedType('cron');
      setCronExpression(bp.cronExpression || '0 */4 * * *');
      const isInterval = QUICK_INTERVALS.some((q) => q.expr === bp.cronExpression);
      const isNatural = NATURAL_DAILY_TIMES.some((n) => n.expr === bp.cronExpression);
      if (isInterval) {
        setCadenceMode('interval');
      } else if (isNatural) {
        setCadenceMode('natural');
      } else {
        setCadenceMode('cron');
      }
    }
    setIsCreating(true);
    setActionFeedback(`Loaded ${bp.title}: Blueprint loaded into schedule composer.`);
    setTimeout(() => setActionFeedback(null), 3000);
  };

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
      setActionFeedback('Automation registered and armed successfully!');
      setPrompt('');
      setIsCreating(false);
      fetchSchedules();
      setTimeout(() => setActionFeedback(null), 3000);
    } else {
      setActionFeedback(`Failed: ${res.error || 'Unknown error'}`);
      addToast({
        title: 'Schedule Failed',
        message: res.error || 'Unknown error occurred',
        type: 'error',
      });
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
    const res = await cancelSchedule(id);
    if (!res?.success) {
      setActionFeedback(`Cancel failed: ${res?.error || 'Unknown error'}`);
      addToast({ title: 'Cancel Failed', message: res?.error || 'Could not cancel schedule', type: 'error' });
    } else {
      setActionFeedback('Cancelled schedule.');
      addToast({ title: 'Schedule Cancelled', message: 'Automation was deactivated.', type: 'info' });
      fetchSchedules();
    }
    setTimeout(() => setActionFeedback(null), 3000);
  };

  const handleRetry = async (id: string) => {
    setActionFeedback(null);
    const res = await retrySchedule(id);
    if (res.success) {
      setActionFeedback('Failed schedule reset and triggered successfully.');
      addToast({ title: 'Schedule Retried', message: 'Failed automation state was reset and triggered.', type: 'success' });
      fetchSchedules();
      setTimeout(() => setActionFeedback(null), 3000);
    } else {
      setActionFeedback(`Retry failed: ${res.error || 'Unknown error'}`);
    }
  };

  const handleViewAttempts = async (id: string) => {
    setAttemptsScheduleId(id);
    setLoadingAttempts(true);
    const attempts = await fetchScheduleAttempts(id);
    setAttemptsList(attempts);
    setLoadingAttempts(false);
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

  const renderBlueprintIcon = (iconName: string) => {
    switch (iconName) {
      case 'ShieldCheck':
        return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
      case 'GitPullRequest':
        return <GitPullRequest className="w-4 h-4 text-cyan-400" />;
      case 'FileText':
        return <FileText className="w-4 h-4 text-purple-400" />;
      case 'PlayCircle':
        return <PlayCircle className="w-4 h-4 text-amber-400" />;
      case 'Sparkles':
      default:
        return <Sparkles className="w-4 h-4 text-emerald-400" />;
    }
  };

  return (
    <main className="flex-1 flex flex-col h-full bg-kin-surface min-w-0 overflow-y-auto text-kin-text select-none">
      {/* Top Header */}
      <div className="px-6 py-4 border-b border-kin-border bg-kin-surface flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setActiveMainView('chat')}
            className="p-1.5 rounded-lg bg-kin-card hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300 border border-kin-border transition cursor-pointer"
            title="Return to Channel Chat Workspace"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <Timer className="w-5 h-5 text-cyan-400" />
              <h1 className="text-base font-bold text-kin-text tracking-wide">
                Automations & Schedules Control Hub
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40">
                {activeCount} Active
              </span>
            </div>
            <p className="text-xs text-kin-muted mt-0.5">
              Visual cadence scheduling, natural language intervals, and autonomous directive routines
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              fetchSchedules();
              fetchSystemHealth();
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-kin-card hover:bg-kin-cardHover text-xs font-medium text-kin-text border border-kin-border transition cursor-pointer"
            title="Refresh Automations & Health"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setIsCreating(!isCreating)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-lg shadow-emerald-900/40 transition cursor-pointer"
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
        <div className="mx-6 mt-4 p-3 rounded-xl bg-kin-card border border-kin-border flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5 font-mono">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-kin-muted">System Status:</span>
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
                <div className="flex items-center space-x-1.5 font-mono text-kin-muted">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span>Free RAM:</span>
                  <span className="text-kin-text font-semibold">
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
              <div className="flex items-center space-x-3 font-mono text-[11px] text-kin-muted">
                <span className="px-2 py-0.5 rounded bg-kin-card text-blue-300">
                  Max Shells: {lim.maxConcurrentShell}
                </span>
                <span className="px-2 py-0.5 rounded bg-kin-card text-indigo-300">
                  Max Browsers: {lim.maxConcurrentBrowser}
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* 1-Click Autonomous Directive Blueprints Bar */}
      <div className="mx-6 mt-4 p-4 rounded-xl bg-gradient-to-r from-kin-card to-kin-surface border border-kin-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs font-semibold text-kin-text uppercase tracking-wider">
              1-Click Autonomous Directive Blueprints
            </h2>
          </div>
          <span className="text-[11px] text-kin-muted">Click any blueprint to populate schedule</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {DIRECTIVE_BLUEPRINTS.map((bp) => (
            <button
              key={bp.id}
              onClick={() => handleApplyBlueprint(bp)}
              className="p-3 rounded-lg bg-kin-surface/80 hover:bg-kin-cardHover border border-kin-border hover:border-cyan-500/40 text-left transition group cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  {renderBlueprintIcon(bp.icon)}
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800/40">
                    {bp.humanCadence}
                  </span>
                </div>
                <div className="text-xs font-bold text-kin-text group-hover:text-cyan-500 dark:group-hover:text-cyan-300 transition">
                  {bp.title}
                </div>
                <div className="text-[11px] text-kin-muted mt-1 line-clamp-2 leading-relaxed">
                  {bp.description}
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-kin-border flex items-center justify-between text-[10px] text-cyan-400 font-medium">
                <span>Arm Blueprint</span>
                <span className="group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Visual Cadence Creation Drawer */}
      {isCreating && (
        <div className="mx-6 mt-4 p-5 rounded-xl bg-kin-card border border-cyan-500/40 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between border-b border-kin-border pb-3">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-kin-text">Visual Cadence Schedule Composer</h2>
            </div>
            <button
              onClick={() => setIsCreating(false)}
              className="text-kin-muted hover:text-kin-text text-xs p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleCreate} className="space-y-4 text-xs">
            {/* Cadence Mode Selector Tabs */}
            <div className="space-y-2">
              <label className="block text-kin-muted font-medium">Choose Cadence Mode</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCadenceMode('interval');
                    setSchedType('cron');
                    setCronExpression('*/15 * * * *');
                  }}
                  className={`py-2 px-3 rounded-lg border text-left transition cursor-pointer ${
                    cadenceMode === 'interval'
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200'
                      : 'bg-kin-card/70 border-kin-border text-kin-muted hover:text-kin-text'
                  }`}
                >
                  <div className="font-bold text-xs">Quick Interval</div>
                  <div className="text-[10px] opacity-75">Every 5m, 15m, 1h...</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCadenceMode('timer');
                    setSchedType('one_shot');
                    setDurationSeconds(30);
                  }}
                  className={`py-2 px-3 rounded-lg border text-left transition cursor-pointer ${
                    cadenceMode === 'timer'
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200'
                      : 'bg-kin-card/70 border-kin-border text-kin-muted hover:text-kin-text'
                  }`}
                >
                  <div className="font-bold text-xs">One-Shot Timer</div>
                  <div className="text-[10px] opacity-75">Wake up in 10s, 1m...</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCadenceMode('natural');
                    setSchedType('cron');
                    setCronExpression('0 9 * * 1-5');
                  }}
                  className={`py-2 px-3 rounded-lg border text-left transition cursor-pointer ${
                    cadenceMode === 'natural'
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200'
                      : 'bg-kin-card/70 border-kin-border text-kin-muted hover:text-kin-text'
                  }`}
                >
                  <div className="font-bold text-xs">Daily Natural Time</div>
                  <div className="text-[10px] opacity-75">9:00 AM Weekdays, etc.</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCadenceMode('cron');
                    setSchedType('cron');
                  }}
                  className={`py-2 px-3 rounded-lg border text-left transition cursor-pointer ${
                    cadenceMode === 'cron'
                      ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200'
                      : 'bg-kin-card/70 border-kin-border text-kin-muted hover:text-kin-text'
                  }`}
                >
                  <div className="font-bold text-xs">Advanced Cron</div>
                  <div className="text-[10px] opacity-75">Raw 5-field cron</div>
                </button>
              </div>
            </div>

            {/* Cadence Specific Chips / Inputs */}
            <div className="p-3.5 rounded-lg bg-kin-card border border-kin-border space-y-2.5">
              {cadenceMode === 'interval' && (
                <div className="space-y-2">
                  <div className="text-[11px] text-kin-muted">Select execution interval:</div>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_INTERVALS.map((q) => (
                      <button
                        key={q.expr}
                        type="button"
                        onClick={() => setCronExpression(q.expr)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition cursor-pointer ${
                          cronExpression === q.expr
                            ? 'bg-cyan-600 text-white border-cyan-400 font-bold shadow'
                            : 'bg-kin-card border-kin-border text-kin-text hover:text-kin-text hover:bg-kin-cardHover'
                        }`}
                      >
                        {q.label} ({q.desc})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {cadenceMode === 'timer' && (
                <div className="space-y-3">
                  <div className="text-[11px] text-kin-muted">Select or enter wakeup duration:</div>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_TIMERS.map((t) => (
                      <button
                        key={t.seconds}
                        type="button"
                        onClick={() => setDurationSeconds(t.seconds)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition cursor-pointer ${
                          durationSeconds === t.seconds
                            ? 'bg-blue-600 text-white border-blue-400 font-bold shadow'
                            : 'bg-kin-card border-kin-border text-kin-text hover:text-kin-text hover:bg-kin-cardHover'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <span className="text-[11px] text-kin-muted">Custom Duration (seconds):</span>
                    <input
                      type="number"
                      min={1}
                      max={86400}
                      value={durationSeconds}
                      onChange={(e) => setDurationSeconds(Math.max(1, Number(e.target.value)))}
                      className="w-28 bg-kin-card border border-kin-border rounded px-2 py-1 text-kin-text font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {cadenceMode === 'natural' && (
                <div className="space-y-2">
                  <div className="text-[11px] text-kin-muted">Select natural daily schedule:</div>
                  <div className="flex flex-wrap gap-2">
                    {NATURAL_DAILY_TIMES.map((n) => (
                      <button
                        key={n.expr}
                        type="button"
                        onClick={() => setCronExpression(n.expr)}
                        className={`px-3 py-1.5 rounded-lg border text-xs transition cursor-pointer ${
                          cronExpression === n.expr
                            ? 'bg-purple-600 text-white border-purple-400 font-bold shadow'
                            : 'bg-kin-card border-kin-border text-kin-text hover:text-kin-text hover:bg-kin-cardHover'
                        }`}
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {cadenceMode === 'cron' && (
                <div className="space-y-2">
                  <div className="text-[11px] text-kin-muted">Enter standard 5-part cron (Minute Hour Day-of-Month Month Day-of-Week):</div>
                  <input
                    type="text"
                    value={cronExpression}
                    onChange={(e) => setCronExpression(e.target.value)}
                    placeholder="*/15 * * * *"
                    className="w-full bg-kin-card border border-kin-border rounded px-3 py-1.5 text-kin-text font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Real-time English Cron Translation pill */}
              <div className="pt-2 border-t border-kin-border flex items-center justify-between text-[11px]">
                <div className="flex items-center space-x-1.5 text-cyan-600 dark:text-cyan-300">
                  <Clock className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400" />
                  <span className="font-medium">Cadence Preview:</span>
                  <span className="font-semibold text-kin-text">
                    {schedType === 'one_shot'
                      ? `Fires once after ${durationSeconds} seconds`
                      : translateCronToEnglish(cronExpression)}
                  </span>
                </div>
                {schedType === 'cron' && (
                  <span className="font-mono text-[10px] text-kin-muted">
                    expr: {cronExpression}
                  </span>
                )}
              </div>
            </div>

            {/* Target Agent & Channel */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-kin-muted mb-1 font-medium">Assigned Agent Specialist</label>
                <select
                  value={targetAgentId}
                  onChange={(e) => setTargetAgentId(e.target.value)}
                  className="w-full bg-kin-card border border-kin-border rounded-lg px-2.5 py-1.5 text-kin-text focus:border-cyan-500 focus:outline-none"
                >
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.displayName} ({ag.role || 'Specialist'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-kin-muted mb-1 font-medium">Target Broadcast Channel</label>
                <select
                  value={targetChannelId}
                  onChange={(e) => setTargetChannelId(e.target.value)}
                  className="w-full bg-kin-card border border-kin-border rounded-lg px-2.5 py-1.5 text-kin-text focus:border-cyan-500 focus:outline-none"
                >
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      #{ch.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Directive Prompt */}
            <div>
              <label className="block text-kin-muted mb-1 font-medium">
                Directive Prompt to Execute Upon Trigger
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Inspect git diff for uncommitted changes, verify project dependencies, and post findings..."
                rows={3}
                className="w-full bg-kin-card border border-kin-border rounded-lg p-2.5 text-kin-text font-sans text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3.5 py-1.5 rounded-lg bg-kin-card hover:bg-kin-cardHover text-kin-muted text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition cursor-pointer shadow-lg shadow-cyan-900/40"
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
            <Search className="w-3.5 h-3.5 text-kin-muted absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompt, agent, channel..."
              className="bg-kin-surface border border-kin-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-kin-text placeholder-kin-subtle focus:border-cyan-500 focus:outline-none w-56"
            />
          </div>

          {/* Type Filter */}
          <div className="flex rounded-lg overflow-hidden border border-kin-border">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 text-[11px] font-mono cursor-pointer ${
                filterType === 'all' ? 'bg-kin-card text-cyan-400 font-bold' : 'bg-kin-card text-kin-muted'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterType('one_shot')}
              className={`px-2.5 py-1 text-[11px] font-mono cursor-pointer ${
                filterType === 'one_shot' ? 'bg-kin-card text-cyan-400 font-bold' : 'bg-kin-card text-kin-muted'
              }`}
            >
              Timers
            </button>
            <button
              onClick={() => setFilterType('cron')}
              className={`px-2.5 py-1 text-[11px] font-mono cursor-pointer ${
                filterType === 'cron' ? 'bg-kin-card text-cyan-400 font-bold' : 'bg-kin-card text-kin-muted'
              }`}
            >
              Routines
            </button>
          </div>

          {/* Status Filter */}
          <div className="flex rounded-lg overflow-hidden border border-kin-border">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-2.5 py-1 text-[11px] font-mono cursor-pointer ${
                filterStatus === 'all' ? 'bg-kin-card text-emerald-400 font-bold' : 'bg-kin-card text-kin-muted'
              }`}
            >
              All Status
            </button>
            <button
              onClick={() => setFilterStatus('active')}
              className={`px-2.5 py-1 text-[11px] font-mono cursor-pointer ${
                filterStatus === 'active' ? 'bg-kin-card text-emerald-400 font-bold' : 'bg-kin-card text-kin-muted'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setFilterStatus('completed')}
              className={`px-2.5 py-1 text-[11px] font-mono cursor-pointer ${
                filterStatus === 'completed' ? 'bg-kin-card text-emerald-400 font-bold' : 'bg-kin-card text-kin-muted'
              }`}
            >
              Completed
            </button>
            <button
              onClick={() => setFilterStatus('failed')}
              className={`px-2.5 py-1 text-[11px] font-mono cursor-pointer ${
                filterStatus === 'failed' ? 'bg-kin-card text-red-400 font-bold' : 'bg-kin-card text-kin-muted'
              }`}
            >
              Failed
            </button>
          </div>
        </div>

        <div className="text-xs text-kin-muted font-mono">
          Showing {filteredSchedules.length} of {totalCount} automations
        </div>
      </div>

      {/* Main Schedules List */}
      <div className="mx-6 mt-4 pb-8 space-y-2.5">
        {filteredSchedules.map((s) => {
          const remainingSec = Math.max(0, Math.ceil((s.nextRunAt - now) / 1000));
          const targetAgent = agents.find((a) => a.id === s.targetAgentId);
          const targetChan = channels.find((c) => c.id === s.channelId);
          const englishCadence = s.cronExpression
            ? translateCronToEnglish(s.cronExpression)
            : s.durationSeconds
            ? `Every ${s.durationSeconds}s`
            : 'One-time wakeup';

          return (
            <div
              key={s.id}
              className={`p-3.5 rounded-xl border transition-all ${
                s.status === 'active'
                  ? 'bg-kin-card border-kin-border hover:border-cyan-500/50 shadow-md'
                  : s.status === 'failed'
                  ? 'bg-kin-card border-red-900/40 shadow-md'
                  : 'bg-kin-surface/70 border-kin-border opacity-75'
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
                          : s.status === 'failed'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                          : 'bg-zinc-500/20 text-zinc-300'
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

                    <span className="font-sans text-[11px] text-cyan-200 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-800/40">
                      🗓️ {englishCadence}
                    </span>

                    {s.cronExpression && (
                      <span className="font-mono text-[10px] text-kin-muted bg-kin-card px-1.5 py-0.5 rounded">
                        {s.cronExpression}
                      </span>
                    )}
                  </div>

                  <div className="text-kin-text text-xs font-medium font-sans leading-relaxed break-words">
                    {s.prompt}
                  </div>

                  {s.lastError && (
                    <div className="bg-red-950/40 border border-red-800/40 rounded px-2.5 py-1 text-[11px] text-red-300 font-mono flex items-center space-x-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="truncate">Last Error: {s.lastError}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-kin-muted">
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
                      <span className="text-kin-muted">
                        Last ran: {new Date(s.lastRunAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center space-x-2 shrink-0">
                  {s.status === 'failed' && (
                    <button
                      onClick={() => handleRetry(s.id)}
                      className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-medium transition cursor-pointer"
                      title="Reset failure state and retry immediately"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                      <span>Retry</span>
                    </button>
                  )}

                  {s.status === 'active' && (
                    <button
                      onClick={() => handleTrigger(s.id)}
                      className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-xs font-medium transition cursor-pointer"
                      title="Trigger this automation immediately right now"
                    >
                      <Play className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Trigger Now</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleViewAttempts(s.id)}
                    className="p-1.5 rounded-lg bg-kin-card hover:bg-kin-cardHover text-kin-muted hover:text-kin-text border border-kin-border transition cursor-pointer"
                    title="View execution attempt history"
                  >
                    <Activity className="w-3.5 h-3.5 text-purple-400" />
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
          <div className="py-16 text-center border border-dashed border-kin-border rounded-2xl bg-kin-surface/30 space-y-3">
            <Timer className="w-10 h-10 text-cyan-400/40 mx-auto" />
            <div className="text-sm font-semibold text-kin-text">No schedules match the criteria</div>
            <p className="text-xs text-kin-muted max-w-sm mx-auto">
              Create an automated wakeup timer or proactive routine using the blueprints or button above.
            </p>
          </div>
        )}
      </div>

      {/* Execution Attempts History Modal */}
      {attemptsScheduleId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-kin-card border border-kin-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-5 py-3.5 border-b border-kin-border flex items-center justify-between bg-kin-surface">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold text-kin-text">Execution Attempts History</h3>
              </div>
              <button
                onClick={() => setAttemptsScheduleId(null)}
                className="p-1 text-kin-muted hover:text-kin-text rounded-lg hover:bg-kin-cardHover transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              {loadingAttempts ? (
                <div className="py-8 text-center text-xs text-kin-muted">Loading attempts...</div>
              ) : attemptsList.length === 0 ? (
                <div className="py-8 text-center text-xs text-kin-muted">
                  No execution attempts recorded yet for this schedule.
                </div>
              ) : (
                attemptsList.map((att) => (
                  <div
                    key={att.id}
                    className="p-3 rounded-xl border border-kin-border bg-kin-surface flex flex-col space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-kin-muted">Attempt #{att.attemptNumber}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                            att.status === 'success'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-red-500/20 text-red-300'
                          }`}
                        >
                          {att.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-kin-muted font-mono">
                        {new Date(att.executedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    {att.errorMessage && (
                      <div className="text-red-300 text-[11px] font-mono bg-red-950/40 p-2 rounded border border-red-800/40 break-words">
                        {att.errorMessage}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 border-t border-kin-border bg-kin-surface flex justify-end">
              <button
                onClick={() => setAttemptsScheduleId(null)}
                className="px-3 py-1.5 rounded-lg bg-kin-card hover:bg-kin-cardHover text-kin-muted text-xs font-medium cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
