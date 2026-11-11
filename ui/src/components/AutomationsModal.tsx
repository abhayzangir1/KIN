import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import {
  Clock,
  Timer,
  Repeat,
  Zap,
  X,
  Plus,
  Bot,
  Sparkles,
  Maximize2,
} from 'lucide-react';
import {
  DIRECTIVE_BLUEPRINTS,
  QUICK_INTERVALS,
  QUICK_TIMERS,
  NATURAL_DAILY_TIMES,
  translateCronToEnglish,
  DirectiveBlueprint,
} from '../utils/automationCadence.js';

export const AutomationsModal: React.FC = () => {
  const {
    isAutomationsModalOpen,
    setAutomationsModalOpen,
    schedules,
    cancelSchedule,
    createSchedule,
    triggerScheduleNow,
    agents,
    channels,
    activeChannelId,
    setActiveMainView,
    addToast,
  } = useKinStore();

  const [activeTab, setActiveTab] = useState<'active' | 'create' | 'history'>('active');
  const [now, setNow] = useState(Date.now());

  // Form State
  const [schedType, setSchedType] = useState<'one_shot' | 'cron'>('one_shot');
  const [durationSeconds, setDurationSeconds] = useState(10);
  const [cronExpression, setCronExpression] = useState('*/15 * * * *');
  const [prompt, setPrompt] = useState('');
  const [targetAgentId, setTargetAgentId] = useState<string>('');
  const [targetChannelId, setTargetChannelId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Keep now updated every second for real-time countdowns
  useEffect(() => {
    if (!isAutomationsModalOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isAutomationsModalOpen]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAutomationsModalOpen) {
        setAutomationsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAutomationsModalOpen, setAutomationsModalOpen]);

  // Set default target agent and channel when modal opens
  useEffect(() => {
    if (isAutomationsModalOpen) {
      if (agents.length > 0 && !targetAgentId) {
        const boss = agents.find((a) => a.isOrchestrator) || agents[0];
        setTargetAgentId(boss.id);
      }
      if (!targetChannelId) {
        setTargetChannelId(activeChannelId || channels.find((c: any) => c.isDefault)?.id || channels[0]?.id || '');
      }
    }
  }, [isAutomationsModalOpen, agents, channels, activeChannelId, targetAgentId, targetChannelId]);

  if (!isAutomationsModalOpen) return null;

  const activeSchedules = schedules.filter((s) => s.status === 'active');
  const completedOrCancelled = schedules.filter((s) => s.status !== 'active');

  const handleApplyBlueprint = (bp: DirectiveBlueprint) => {
    setPrompt(bp.prompt);
    if (bp.cadenceType === 'one_shot') {
      setSchedType('one_shot');
      setDurationSeconds(bp.durationSeconds || 60);
    } else {
      setSchedType('cron');
      setCronExpression(bp.cronExpression || '0 */4 * * *');
    }
    setActiveTab('create');
    setActionFeedback(`Loaded ${bp.title}: Directive loaded into composer.`);
    setTimeout(() => setActionFeedback(null), 3000);
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setActionFeedback('Please provide an actionable directive prompt.');
      return;
    }

    setIsSubmitting(true);
    setActionFeedback(null);

    const res = await createSchedule({
      type: schedType,
      durationSeconds: schedType === 'one_shot' ? durationSeconds : undefined,
      cronExpression: schedType === 'cron' ? cronExpression : undefined,
      prompt: prompt.trim(),
      targetAgentId: targetAgentId || undefined,
      channelId: targetChannelId || undefined,
    });

    setIsSubmitting(false);

    if (res.success) {
      setActionFeedback('Automation created and armed successfully!');
      setPrompt('');
      setTimeout(() => {
        setActionFeedback(null);
        setActiveTab('active');
      }, 1200);
    } else {
      setActionFeedback(`Error: ${res.error || 'Failed to create automation'}`);
    }
  };

  const handleTriggerNow = async (id: string) => {
    setActionFeedback('Triggering automation now...');
    const res = await triggerScheduleNow(id);
    if (res.success) {
      setActionFeedback('Trigger dispatched to agent successfully.');
    } else {
      setActionFeedback(`Trigger error: ${res.error}`);
    }
    setTimeout(() => setActionFeedback(null), 2500);
  };

  const openFullWorkspace = () => {
    setAutomationsModalOpen(false);
    setActiveMainView('automations');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn select-none">
      <div className="relative w-full max-w-2xl bg-kin-surface border border-kin-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-kin-border flex items-center justify-between bg-kin-surface">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-kin-text">Automations & Scheduled Routines</h2>
              <p className="text-[11px] text-kin-muted">
                Antigravity visual cadence timers, English cron schedules, and proactive autonomous directives
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-1.5">
            <button
              onClick={openFullWorkspace}
              title="Open in Full Control Hub"
              className="p-1.5 rounded-lg hover:bg-kin-cardHover text-kin-muted hover:text-cyan-400 transition cursor-pointer flex items-center space-x-1 text-xs"
            >
              <Maximize2 className="w-4 h-4" />
              <span className="text-[10px] hidden sm:inline">Expand View</span>
            </button>
            <button
              onClick={() => setAutomationsModalOpen(false)}
              title="Close Automations (Esc)"
              aria-label="Close Automations"
              className="p-1 rounded-lg hover:bg-kin-cardHover text-kin-muted hover:text-kin-text transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 border-b border-kin-border flex space-x-2 bg-kin-card">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'active'
                ? 'bg-kin-surface text-cyan-600 dark:text-cyan-300 border-t border-x border-kin-border'
                : 'text-kin-muted hover:text-kin-text'
            }`}
          >
            <Timer className="w-3.5 h-3.5" />
            <span>Active Routines</span>
            <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 font-mono font-bold">
              {activeSchedules.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('create')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'create'
                ? 'bg-kin-surface text-cyan-600 dark:text-cyan-300 border-t border-x border-kin-border'
                : 'text-kin-muted hover:text-kin-text'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Automation</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-kin-surface text-cyan-600 dark:text-cyan-300 border-t border-x border-kin-border'
                : 'text-kin-muted hover:text-kin-text'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>History ({completedOrCancelled.length})</span>
          </button>
        </div>

        {/* Notification Feedback Toast */}
        {actionFeedback && (
          <div className="px-6 py-2 bg-cyan-950/80 border-b border-cyan-500/30 text-cyan-300 text-xs flex items-center space-x-2 animate-fadeIn">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>{actionFeedback}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* TAB 1: ACTIVE ROUTINES */}
          {activeTab === 'active' && (
            <div className="space-y-3">
              {activeSchedules.length === 0 ? (
                <div className="py-12 text-center space-y-3 bg-kin-card rounded-xl border border-kin-border">
                  <Clock className="w-8 h-8 text-kin-subtle mx-auto" />
                  <p className="text-xs text-kin-muted">No active automations or scheduled timers running.</p>
                  <button
                    onClick={() => setActiveTab('create')}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition cursor-pointer"
                  >
                    Create Your First Automation
                  </button>
                </div>
              ) : (
                activeSchedules.map((s) => {
                  const remainingSec = Math.max(0, Math.ceil((s.nextRunAt - now) / 1000));
                  const targetAgent = agents.find((a) => a.id === s.targetAgentId);
                  const englishCadence = s.cronExpression
                    ? translateCronToEnglish(s.cronExpression)
                    : s.durationSeconds
                    ? `Every ${s.durationSeconds}s`
                    : 'Wakeup timer';

                  return (
                    <div
                      key={s.id}
                      className="p-3.5 rounded-xl bg-kin-card border border-kin-border hover:border-cyan-500/40 transition space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                              s.type === 'one_shot'
                                ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border-cyan-500/30'
                                : 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/30'
                            }`}
                          >
                            {s.type === 'one_shot' ? 'One-Shot Timer' : 'Cron Routine'}
                          </span>

                          <span className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                            <Clock className="w-3 h-3" />
                            <span>{remainingSec > 0 ? `Fires in ${remainingSec}s` : 'Due now'}</span>
                          </span>

                          <span className="text-[11px] text-cyan-600 dark:text-cyan-200 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 font-sans">
                            🗓️ {englishCadence}
                          </span>

                          {targetAgent && (
                            <span className="flex items-center space-x-1 text-blue-600 dark:text-blue-300 text-[10px] bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                              <Bot className="w-3 h-3" />
                              <span>{targetAgent.displayName}</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => handleTriggerNow(s.id)}
                            className="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 text-[11px] font-semibold border border-amber-500/30 transition flex items-center space-x-1 cursor-pointer"
                            title="Trigger execution immediately"
                          >
                            <Zap className="w-3 h-3" />
                            <span>Trigger</span>
                          </button>
                          <button
                            onClick={async () => {
                              const res = await cancelSchedule(s.id);
                              if (!res?.success) {
                                addToast(res?.error || 'Failed to cancel schedule', 'error');
                              } else {
                                addToast('Schedule cancelled', 'info');
                              }
                            }}
                            className="px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 dark:text-red-400 text-[11px] font-semibold border border-red-500/30 transition flex items-center space-x-1 cursor-pointer"
                            title="Cancel schedule"
                          >
                            <X className="w-3 h-3" />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>

                      <div className="text-xs text-kin-text font-medium bg-kin-surface p-2.5 rounded-lg border border-kin-border font-mono">
                        "{s.prompt}"
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-kin-muted">
                        <span>ID: <code className="text-kin-muted">{s.id}</code></span>
                        <span>Iterations: {s.currentIterations || 0}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: CREATE AUTOMATION */}
          {activeTab === 'create' && (
            <form onSubmit={handleCreateSchedule} className="space-y-4">
              {/* Directive Blueprints Row */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-kin-muted">
                    1-Click Directive Blueprints
                  </label>
                  <span className="text-[10px] text-kin-muted">Click to populate</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DIRECTIVE_BLUEPRINTS.slice(0, 4).map((bp) => (
                    <button
                      key={bp.id}
                      type="button"
                      onClick={() => handleApplyBlueprint(bp)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-kin-card hover:bg-kin-cardHover text-kin-text hover:text-cyan-600 dark:hover:text-cyan-300 border border-kin-border hover:border-cyan-500/40 transition cursor-pointer"
                    >
                      ⚡ {bp.title}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type Switcher */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-kin-muted">
                  Automation Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSchedType('one_shot')}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center space-x-2.5 cursor-pointer ${
                      schedType === 'one_shot'
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-600 dark:text-cyan-300'
                        : 'bg-kin-card border-kin-border text-kin-muted hover:text-kin-text'
                    }`}
                  >
                    <Timer className="w-4 h-4 shrink-0" />
                    <div>
                      <div className="font-semibold text-xs text-kin-text">One-Shot Wakeup Timer</div>
                      <div className="text-[10px] text-kin-muted">Wakes agent once after specified duration</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSchedType('cron')}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center space-x-2.5 cursor-pointer ${
                      schedType === 'cron'
                        ? 'bg-purple-500/10 border-purple-500/40 text-purple-600 dark:text-purple-300'
                        : 'bg-kin-card border-kin-border text-kin-muted hover:text-kin-text'
                    }`}
                  >
                    <Repeat className="w-4 h-4 shrink-0" />
                    <div>
                      <div className="font-semibold text-xs text-kin-text">Recurring Proactive Routine</div>
                      <div className="text-[10px] text-kin-muted">Periodic background task on interval or cron</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Timing Controls */}
              {schedType === 'one_shot' ? (
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-kin-muted">
                    Sleep Duration Before Wakeup
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_TIMERS.map((p) => (
                      <button
                        key={p.seconds}
                        type="button"
                        onClick={() => setDurationSeconds(p.seconds)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition cursor-pointer border ${
                          durationSeconds === p.seconds
                            ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border-cyan-500/40'
                            : 'bg-kin-card text-kin-muted border-kin-border hover:text-kin-text hover:bg-kin-cardHover'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <span className="text-[11px] text-kin-muted">Custom Seconds:</span>
                    <input
                      type="number"
                      min={1}
                      max={86400}
                      value={durationSeconds}
                      onChange={(e) => setDurationSeconds(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-24 px-2 py-1 rounded bg-kin-card border border-kin-border text-kin-text text-xs font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-kin-muted">
                    Recurring Interval / Cron Expression
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_INTERVALS.map((p) => (
                      <button
                        key={p.expr}
                        type="button"
                        onClick={() => setCronExpression(p.expr)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition cursor-pointer border ${
                          cronExpression === p.expr
                            ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/40'
                            : 'bg-kin-card text-kin-muted border-kin-border hover:text-kin-text hover:bg-kin-cardHover'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                    {NATURAL_DAILY_TIMES.slice(0, 2).map((n) => (
                      <button
                        key={n.expr}
                        type="button"
                        onClick={() => setCronExpression(n.expr)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer border ${
                          cronExpression === n.expr
                            ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/40'
                            : 'bg-kin-card text-kin-muted border-kin-border hover:text-kin-text hover:bg-kin-cardHover'
                        }`}
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={cronExpression}
                    onChange={(e) => setCronExpression(e.target.value)}
                    placeholder="*/15 * * * *"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-kin-card border border-kin-border text-kin-text text-xs font-mono focus:outline-none focus:border-purple-500"
                  />
                  <div className="text-[11px] text-cyan-600 dark:text-cyan-300 flex items-center space-x-1.5 pt-0.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>🗓️ Preview: {translateCronToEnglish(cronExpression)}</span>
                  </div>
                </div>
              )}

              {/* Assignment Controls */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-kin-muted">
                    Assigned Agent
                  </label>
                  <select
                    value={targetAgentId}
                    onChange={(e) => setTargetAgentId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-kin-card border border-kin-border text-kin-text text-xs focus:outline-none focus:border-cyan-500"
                  >
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.displayName} ({ag.role || (ag.isOrchestrator ? 'Boss' : 'Specialist')})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-kin-muted">
                    Destination Channel
                  </label>
                  <select
                    value={targetChannelId}
                    onChange={(e) => setTargetChannelId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-kin-card border border-kin-border text-kin-text text-xs focus:outline-none focus:border-cyan-500"
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
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-kin-muted">
                    Directive Prompt / Autonomous Action
                  </label>
                  <span className="text-[10px] text-kin-muted">Dispatched when triggered</span>
                </div>
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Audit workspace test results and report any test failures in #general"
                  className="w-full px-3 py-2 rounded-xl bg-kin-card border border-kin-border text-kin-text text-xs font-sans focus:outline-none focus:border-cyan-500 resize-none"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs shadow-lg transition disabled:opacity-50 flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>{isSubmitting ? 'Arming Automation...' : 'Create & Arm Automation'}</span>
              </button>
            </form>
          )}

          {/* TAB 3: HISTORY & COMPLETED */}
          {activeTab === 'history' && (
            <div className="space-y-2">
              {completedOrCancelled.length === 0 ? (
                <div className="py-8 text-center text-xs text-kin-muted">
                  No completed or cancelled automations in history.
                </div>
              ) : (
                completedOrCancelled.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-xl bg-kin-card border border-kin-border flex items-center justify-between text-xs"
                  >
                    <div className="space-y-1 min-w-0 pr-2">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded uppercase ${
                            s.status === 'completed'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                              : 'bg-kin-surface text-kin-muted border border-kin-border'
                          }`}
                        >
                          {s.status}
                        </span>
                        <span className="text-kin-muted font-mono text-[10px]">[{s.type}]</span>
                        <span className="text-kin-muted text-[10px]">
                          Ran {s.currentIterations || 0} time(s)
                        </span>
                      </div>
                      <p className="text-kin-text font-mono text-[11px] truncate">{s.prompt}</p>
                    </div>

                    <button
                      onClick={() => handleTriggerNow(s.id)}
                      className="px-2.5 py-1 rounded bg-kin-surface hover:bg-cyan-500/20 text-kin-muted hover:text-cyan-600 dark:hover:text-cyan-300 text-[10px] font-semibold border border-kin-border transition shrink-0 cursor-pointer"
                      title="Re-run this directive now"
                    >
                      Re-Trigger
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
