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
} from 'lucide-react';

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
        setTargetChannelId(activeChannelId || channels[0]?.id || 'chan-general');
      }
    }
  }, [isAutomationsModalOpen, agents, channels, activeChannelId]);

  if (!isAutomationsModalOpen) return null;

  const activeSchedules = schedules.filter((s) => s.status === 'active');
  const completedOrCancelled = schedules.filter((s) => s.status !== 'active');

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn select-none">
      <div className="relative w-full max-w-2xl bg-[#090d16] border border-[#1e293b] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1e293b] flex items-center justify-between bg-[#060911]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-kin-text">Automations & Scheduled Routines</h2>
              <p className="text-[11px] text-[#64748b]">
                Antigravity non-blocking sleep/wakeup timers and proactive recurring routines
              </p>
            </div>
          </div>
          <button
            onClick={() => setAutomationsModalOpen(false)}
            title="Close Automations (Esc)"
            aria-label="Close Automations"
            className="p-1 rounded-lg hover:bg-[#1e293b] text-[#64748b] hover:text-kin-text transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 border-b border-[#1e293b] flex space-x-2 bg-[#080c17]">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'active'
                ? 'bg-[#0f172a] text-cyan-300 border-t border-x border-[#1e293b]'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
          >
            <Timer className="w-3.5 h-3.5" />
            <span>Active Routines</span>
            <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 font-mono font-bold">
              {activeSchedules.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('create')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'create'
                ? 'bg-[#0f172a] text-cyan-300 border-t border-x border-[#1e293b]'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Automation</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-[#0f172a] text-cyan-300 border-t border-x border-[#1e293b]'
                : 'text-[#64748b] hover:text-kin-text'
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
                <div className="py-12 text-center space-y-3 bg-[#0c1220] rounded-xl border border-[#1e293b]/60">
                  <Clock className="w-8 h-8 text-[#475569] mx-auto" />
                  <p className="text-xs text-[#94a3b8]">No active automations or scheduled timers running.</p>
                  <button
                    onClick={() => setActiveTab('create')}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition cursor-pointer"
                  >
                    Create Your First Automation
                  </button>
                </div>
              ) : (
                activeSchedules.map((s) => {
                  const remainingSec = Math.max(0, Math.ceil((s.nextRunAt - now) / 1000));
                  const targetAgent = agents.find((a) => a.id === s.targetAgentId);

                  return (
                    <div
                      key={s.id}
                      className="p-3.5 rounded-xl bg-[#0c1220] border border-[#1e293b] hover:border-cyan-500/40 transition space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                              s.type === 'one_shot'
                                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                                : 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                            }`}
                          >
                            {s.type === 'one_shot' ? 'One-Shot Timer' : `Cron (${s.cronExpression})`}
                          </span>

                          <span className="flex items-center space-x-1 text-emerald-400 font-mono text-[11px] font-bold bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-800/40">
                            <Clock className="w-3 h-3" />
                            <span>{remainingSec > 0 ? `Fires in ${remainingSec}s` : 'Due now'}</span>
                          </span>

                          {targetAgent && (
                            <span className="flex items-center space-x-1 text-blue-300 text-[10px] bg-blue-950/40 px-2 py-0.5 rounded border border-blue-800/30">
                              <Bot className="w-3 h-3" />
                              <span>{targetAgent.displayName}</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => handleTriggerNow(s.id)}
                            className="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-semibold border border-amber-500/30 transition flex items-center space-x-1 cursor-pointer"
                            title="Trigger execution immediately"
                          >
                            <Zap className="w-3 h-3" />
                            <span>Trigger</span>
                          </button>
                          <button
                            onClick={() => cancelSchedule(s.id)}
                            className="px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[11px] font-semibold border border-red-500/30 transition flex items-center space-x-1 cursor-pointer"
                            title="Cancel schedule"
                          >
                            <X className="w-3 h-3" />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>

                      <div className="text-xs text-kin-text font-medium bg-[#070a12] p-2.5 rounded-lg border border-[#1e293b]/70 font-mono">
                        "{s.prompt}"
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-[#64748b]">
                        <span>ID: <code className="text-[#94a3b8]">{s.id}</code></span>
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
              {/* Type Switcher */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                  Automation Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSchedType('one_shot')}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center space-x-2.5 cursor-pointer ${
                      schedType === 'one_shot'
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                        : 'bg-[#0c1220] border-[#1e293b] text-[#64748b] hover:text-kin-text'
                    }`}
                  >
                    <Timer className="w-4 h-4 shrink-0" />
                    <div>
                      <div className="font-semibold text-xs">One-Shot Wakeup Timer</div>
                      <div className="text-[10px] opacity-80">Wakes agent once after specified duration</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSchedType('cron')}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center space-x-2.5 cursor-pointer ${
                      schedType === 'cron'
                        ? 'bg-purple-500/10 border-purple-500/40 text-purple-300'
                        : 'bg-[#0c1220] border-[#1e293b] text-[#64748b] hover:text-kin-text'
                    }`}
                  >
                    <Repeat className="w-4 h-4 shrink-0" />
                    <div>
                      <div className="font-semibold text-xs">Recurring Proactive Routine</div>
                      <div className="text-[10px] opacity-80">Periodic background task on interval or cron</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Timing Controls */}
              {schedType === 'one_shot' ? (
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Sleep Duration Before Wakeup
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '5s', val: 5 },
                      { label: '10s', val: 10 },
                      { label: '30s', val: 30 },
                      { label: '1m', val: 60 },
                      { label: '5m', val: 300 },
                      { label: '15m', val: 900 },
                      { label: '1h', val: 3600 },
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => setDurationSeconds(p.val)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition cursor-pointer border ${
                          durationSeconds === p.val
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : 'bg-[#0c1220] text-[#64748b] border-[#1e293b] hover:text-kin-text'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <span className="text-[11px] text-[#64748b]">Custom Seconds:</span>
                    <input
                      type="number"
                      min={1}
                      max={86400}
                      value={durationSeconds}
                      onChange={(e) => setDurationSeconds(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-24 px-2 py-1 rounded bg-[#070a12] border border-[#1e293b] text-kin-text text-xs font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Recurring Interval / Cron Expression
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: 'Every 15s', expr: '*/15s' },
                      { label: 'Every 1 min', expr: '*/1 * * * *' },
                      { label: 'Every 5 min', expr: '*/5 * * * *' },
                      { label: 'Every 15 min', expr: '*/15 * * * *' },
                      { label: 'Hourly', expr: '0 * * * *' },
                    ].map((p) => (
                      <button
                        key={p.expr}
                        type="button"
                        onClick={() => setCronExpression(p.expr)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition cursor-pointer border ${
                          cronExpression === p.expr
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                            : 'bg-[#0c1220] text-[#64748b] border-[#1e293b] hover:text-kin-text'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={cronExpression}
                    onChange={(e) => setCronExpression(e.target.value)}
                    placeholder="*/15 * * * *"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#070a12] border border-[#1e293b] text-kin-text text-xs font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              )}

              {/* Assignment Controls */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Assigned Agent
                  </label>
                  <select
                    value={targetAgentId}
                    onChange={(e) => setTargetAgentId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#070a12] border border-[#1e293b] text-kin-text text-xs focus:outline-none focus:border-cyan-500"
                  >
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.displayName} ({ag.role || (ag.isOrchestrator ? 'Boss' : 'Specialist')})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Destination Channel
                  </label>
                  <select
                    value={targetChannelId}
                    onChange={(e) => setTargetChannelId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#070a12] border border-[#1e293b] text-kin-text text-xs focus:outline-none focus:border-cyan-500"
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
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Directive Prompt / Autonomous Action
                  </label>
                  <span className="text-[10px] text-[#64748b]">Dispatched when triggered</span>
                </div>
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Audit workspace test results and report any test failures in #general"
                  className="w-full px-3 py-2 rounded-xl bg-[#070a12] border border-[#1e293b] text-kin-text text-xs font-sans focus:outline-none focus:border-cyan-500 resize-none"
                />

                {/* Quick suggestions */}
                <div className="flex flex-wrap gap-1 pt-1">
                  {[
                    'Audit repository git status and check for uncommitted changes',
                    'Verify all core unit tests and report pass rate',
                    'Check Ollama local LLM daemon telemetry and available models',
                    'Perform SQLite WAL checkpoint optimization',
                  ].map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setPrompt(sug)}
                      className="text-[10px] px-2 py-0.5 rounded bg-[#131b2e] hover:bg-[#1a253f] text-[#94a3b8] hover:text-cyan-300 transition text-left cursor-pointer truncate max-w-full"
                    >
                      💡 {sug}
                    </button>
                  ))}
                </div>
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
                <div className="py-8 text-center text-xs text-[#64748b]">
                  No completed or cancelled automations in history.
                </div>
              ) : (
                completedOrCancelled.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-xl bg-[#0c1220]/60 border border-[#1e293b]/50 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-1 min-w-0 pr-2">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded uppercase ${
                            s.status === 'completed'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-[#1e293b] text-[#64748b]'
                          }`}
                        >
                          {s.status}
                        </span>
                        <span className="text-[#94a3b8] font-mono text-[10px]">[{s.type}]</span>
                        <span className="text-[#64748b] text-[10px]">
                          Ran {s.currentIterations || 0} time(s)
                        </span>
                      </div>
                      <p className="text-kin-text font-mono text-[11px] truncate">{s.prompt}</p>
                    </div>

                    <button
                      onClick={() => handleTriggerNow(s.id)}
                      className="px-2.5 py-1 rounded bg-[#131b2e] hover:bg-cyan-500/20 text-[#94a3b8] hover:text-cyan-300 text-[10px] font-semibold border border-[#1e293b] transition shrink-0 cursor-pointer"
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
