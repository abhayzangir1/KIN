import React, { useState, useEffect, useRef } from 'react';
import { useKinStore } from '../../store/kinStore.js';
import {
  ShieldAlert,
  Pause,
  Play,
  OctagonAlert,
  SendHorizontal,
  KeyRound,
  Eye,
  Radio,
  CheckCircle2,
  X,
} from 'lucide-react';

export const HumanTakeoverBanner: React.FC = () => {
  const {
    activeTakeover,
    activeTakeovers,
    pauseAgent,
    resumeAgent,
    abortAgent,
    sendMessage,
    agents,
    channels,
    dismissTakeover,
    fetchActiveRuns,
    activeAgentChannels,
    activeChannelId,
    setActiveChannel,
  } = useKinStore();

  const [isSteerOpen, setIsSteerOpen] = useState(false);
  const [steerText, setSteerText] = useState('');
  const [steerSent, setSteerSent] = useState(false);
  const [isSteerSending, setIsSteerSending] = useState(false);
  const isSteerSendingRef = useRef(false);

  const isDm = activeChannelId?.startsWith('dm-') || false;
  const targetAgentId = isDm ? activeChannelId.replace(/^dm-/, '') : null;

  // Running agent strictly in this active channel or thread:
  const runningAgent = isDm
    ? agents.find((a) => a.id === targetAgentId && (a.status === 'working' || a.status === 'thinking'))
    : agents.find(
        (a) =>
          (a.status === 'working' || a.status === 'thinking') &&
          activeAgentChannels?.[a.id] === activeChannelId
      ) || (activeTakeover?.agentId ? agents.find((a) => a.id === activeTakeover.agentId) : null);

  // Check if an agent in another channel requires urgent attention (exclude finished or aborted runs)
  const crossChannelAlert = Object.values(activeTakeovers || {}).find(
    (t) =>
      t.channelId &&
      t.channelId !== activeChannelId &&
      !t.isAborted &&
      (t.isPaused === true ||
        Boolean(t.authRequired) ||
        Boolean(t.financialGate) ||
        t.riskLevel === 'CRITICAL' ||
        Boolean(t.previewPayload?.requiresApproval) ||
        (t as any)?.state === 'waiting_for_approval')
  );
  const crossChannelName = crossChannelAlert?.channelId
    ? channels.find((c) => c.id === crossChannelAlert.channelId)?.name || crossChannelAlert.channelId
    : null;
  const crossChannelAgent = crossChannelAlert?.agentId
    ? agents.find((a) => a.id === crossChannelAlert.agentId)?.displayName || 'Specialist'
    : 'Agent';

  // Global Esc key binding for instant pause/resume takeover
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeTakeover) {
          if (activeTakeover.isPaused) {
            await resumeAgent(activeTakeover.runId);
          } else {
            await pauseAgent(activeTakeover.runId);
          }
        } else if (runningAgent) {
          await fetchActiveRuns();
          const current = useKinStore.getState().activeTakeover;
          if (current) {
            await pauseAgent(current.runId);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTakeover, runningAgent, pauseAgent, resumeAgent, fetchActiveRuns]);

  // Only mount human takeover banner when genuine human intervention occurs (isPaused === true || isAborted === true)
  // or during explicit approval gates (authRequired || financialGate || riskLevel === 'CRITICAL' || previewPayload?.requiresApproval || state === 'waiting_for_approval').
  // Ensures it NEVER displays during normal agent running/thinking/streaming.
  const isIntervention =
    Boolean(activeTakeover?.isPaused === true || activeTakeover?.isAborted === true);

  const isApprovalGate =
    Boolean(
      activeTakeover?.authRequired ||
      activeTakeover?.financialGate ||
      activeTakeover?.riskLevel === 'CRITICAL' ||
      activeTakeover?.previewPayload?.requiresApproval ||
      (activeTakeover as any)?.state === 'waiting_for_approval'
    );

  const needsTakeoverDisplay = Boolean(activeTakeover && (isIntervention || isApprovalGate));

  if (!needsTakeoverDisplay) {
    if (crossChannelAlert && crossChannelName) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="w-full pointer-events-auto select-none p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-600/50 shadow-md flex items-center justify-between text-xs"
        >
          <div className="flex items-center space-x-2 text-amber-800 dark:text-amber-200 font-mono">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 animate-pulse" />
            <span>
              <strong>{crossChannelAgent}</strong> requires attention in <strong>#{crossChannelName}</strong> ({crossChannelAlert.riskLevel || 'PAUSED'})
            </span>
          </div>
          <button
            onClick={() => setActiveChannel(crossChannelAlert.channelId!)}
            className="px-2.5 py-1 rounded bg-amber-200 hover:bg-amber-300 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-600/40 text-xs font-semibold transition"
          >
            Switch to #{crossChannelName}
          </button>
        </div>
      );
    }
    return null;
  }

  // Handle Steer Submission
  const handleSendSteer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!steerText.trim() || isSteerSendingRef.current || isSteerSending) return;
    isSteerSendingRef.current = true;
    setIsSteerSending(true);
    const text = steerText.trim();
    setSteerText('');
    setIsSteerOpen(false);
    const targetChan = activeTakeover?.channelId || activeChannelId;
    try {
      await sendMessage(`⚠️ [STEER DIRECTIVE]: ${text}`, targetChan, true);
      setSteerSent(true);
      setTimeout(() => setSteerSent(false), 3000);
    } finally {
      setIsSteerSending(false);
      setTimeout(() => {
        isSteerSendingRef.current = false;
      }, 600);
    }
  };

  const isFinancial = activeTakeover?.financialGate || activeTakeover?.riskLevel === 'CRITICAL';
  const isAuth = activeTakeover?.authRequired;
  const isPaused = activeTakeover?.isPaused;
  const isAborted = activeTakeover?.isAborted;

  const agentDisplayName =
    (activeTakeover?.agentId ? agents.find((a) => a.id === activeTakeover.agentId)?.displayName : null) ||
    runningAgent?.displayName ||
    '@Boss';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="w-full pointer-events-auto select-none transition-all duration-200 my-2"
    >
      <div
        className={`rounded-xl border backdrop-blur-md p-3 shadow-lg transition-all ${
          isFinancial
            ? 'bg-rose-50 dark:bg-rose-950/70 border-rose-300 dark:border-rose-500/80 text-rose-900 dark:text-rose-100 shadow-rose-500/10'
            : isAuth
            ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-300 dark:border-amber-500/80 text-amber-900 dark:text-amber-100 shadow-amber-500/10'
            : isPaused
            ? 'bg-yellow-50 dark:bg-yellow-950/70 border-yellow-300 dark:border-yellow-500/70 text-yellow-900 dark:text-yellow-100 shadow-yellow-500/10'
            : isAborted
            ? 'bg-red-50 dark:bg-red-950/70 border-red-300 dark:border-red-500/70 text-red-900 dark:text-red-100 shadow-red-500/10'
            : isApprovalGate
            ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-300 dark:border-amber-500/70 text-amber-900 dark:text-amber-100 shadow-amber-500/10'
            : 'bg-blue-50 dark:bg-slate-900/90 border-blue-200 dark:border-blue-500/60 text-slate-900 dark:text-blue-100 shadow-blue-500/10'
        }`}
      >
        {/* Top Header Row */}
        <div className="flex items-center justify-between gap-3 text-xs">
          {/* Status Indicator */}
          <div className="flex items-center space-x-2.5 truncate">
            <span className="relative flex h-3 w-3 shrink-0">
              {isPaused ? (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500 shadow-xs" />
              ) : isAborted ? (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 shadow-xs" />
              ) : isApprovalGate ? (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500 shadow-xs animate-pulse" />
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-xs" />
                </>
              )}
            </span>

            <div className="flex items-center space-x-1.5 font-bold tracking-wide">
              <span className="text-slate-900 dark:text-white text-[13px]">{agentDisplayName}</span>
              <span className="text-slate-400 dark:text-slate-500">|</span>
              <span
                className={`uppercase text-[11px] px-2 py-0.5 rounded font-mono font-semibold ${
                  isAborted
                    ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 border border-red-300 dark:border-red-500/40'
                    : isPaused
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40'
                    : isApprovalGate
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40'
                }`}
              >
                {isAborted
                  ? 'ABORTED'
                  : isPaused
                  ? 'PAUSED (TAKEN OVER)'
                  : isApprovalGate
                  ? 'APPROVAL REQUIRED'
                  : 'EXECUTING'}
              </span>
            </div>

            {/* Risk Badge */}
            {activeTakeover?.riskLevel && (
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 ${
                  activeTakeover.riskLevel === 'CRITICAL'
                    ? 'bg-red-600 text-white animate-pulse'
                    : activeTakeover.riskLevel === 'HIGH'
                    ? 'bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40'
                    : 'bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40'
                }`}
              >
                {activeTakeover.riskLevel} RISK
              </span>
            )}
          </div>

          {/* Action Control Buttons */}
          <div className="flex items-center space-x-2 shrink-0">
            {/* Esc Shortcut Pause / Resume */}
            {activeTakeover ? (
              isPaused ? (
                <button
                  type="button"
                  onClick={() => resumeAgent(activeTakeover.runId)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-sm"
                  title="Resume Autonomous Execution (Press Esc)"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Resume (Esc)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => pauseAgent(activeTakeover.runId)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition shadow-sm"
                  title="Pause Agent Immediately (Press Esc)"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Pause (Esc)</span>
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await fetchActiveRuns();
                  const cur = useKinStore.getState().activeTakeover;
                  if (cur) await pauseAgent(cur.runId);
                }}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs transition shadow-sm"
                title="Pause Active Agent Execution (Press Esc)"
              >
                <Pause className="w-3 h-3 fill-current" />
                <span>Pause (Esc)</span>
              </button>
            )}

            {/* Steer Popover Toggle */}
            <button
              type="button"
              onClick={() => setIsSteerOpen(!isSteerOpen)}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
                isSteerOpen
                  ? 'bg-blue-600 text-white border-blue-400'
                  : 'bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-blue-300 border-slate-300 dark:border-blue-500/30'
              }`}
              title="Steer active execution without stopping task"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Steer</span>
            </button>

            {/* Emergency Kill Switch */}
            <button
              type="button"
              onClick={() => {
                if (activeTakeover) {
                  abortAgent(activeTakeover.runId);
                } else {
                  fetchActiveRuns().then(() => {
                    const cur = useKinStore.getState().activeTakeover;
                    if (cur) abortAgent(cur.runId);
                  });
                }
              }}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs transition shadow-sm"
              title="Emergency Kill Switch — Immediately abort current agent run"
            >
              <OctagonAlert className="w-3.5 h-3.5" />
              <span>Abort</span>
            </button>

            {/* Dismiss Takeover Pill */}
            <button
              type="button"
              onClick={dismissTakeover}
              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white transition cursor-pointer"
              title="Dismiss Takeover Banner"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Mid-Task Steer Notification Toast */}
        {steerSent && (
          <div className="mt-2 p-1.5 rounded bg-emerald-100 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-600/40 text-emerald-800 dark:text-emerald-200 text-[11px] flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Steering directive injected into active execution context!</span>
          </div>
        )}

        {/* Steer Input Bar */}
        {isSteerOpen && (
          <form onSubmit={handleSendSteer} className="mt-2.5 flex items-center space-x-2">
            <input
              type="text"
              autoFocus
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              placeholder="Inject mid-execution steering directive (e.g., 'Skip login, navigate to pricing')..."
              className="flex-1 bg-white dark:bg-kin-surface border border-slate-300 dark:border-kin-border rounded-lg px-3 py-1.5 text-xs text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center space-x-1 transition cursor-pointer"
            >
              <SendHorizontal className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
        )}

        {/* CRITICAL Financial Commerce Alert Box */}
        {isFinancial && (
          <div className="mt-2.5 p-2 rounded-lg bg-rose-100 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-600/60 text-rose-900 dark:text-rose-200 text-xs flex items-start space-x-2.5">
            <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5 animate-bounce" />
            <div className="space-y-0.5">
              <div className="font-bold text-rose-800 dark:text-rose-300 tracking-wide uppercase text-[11px]">
                Zero-Trust Financial Safety Gate Activated
              </div>
              <p className="text-[11px] leading-relaxed text-rose-900 dark:text-rose-200">
                The agent is preparing to execute a commercial or payment action. Autonomy mode bypasses are disabled.
              </p>
            </div>
          </div>
        )}

        {/* Human Authorization Protocol Alert Box */}
        {isAuth && (
          <div className="mt-2.5 p-2 rounded-lg bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-600/60 text-amber-900 dark:text-amber-200 text-xs flex items-start space-x-2.5">
            <KeyRound className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 animate-pulse" />
            <div className="space-y-0.5">
              <div className="font-bold text-amber-800 dark:text-amber-300 tracking-wide uppercase text-[11px]">
                Human Authorization Protocol: Sign-In / Challenge Required
              </div>
              <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                A verification challenge was detected. Complete the action in the browser, then click <strong>Resume (Esc)</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Active Tool Action Preview Banner */}
        {activeTakeover?.previewPayload && (
          <div className="mt-2.5 p-2 rounded-lg bg-white/80 dark:bg-kin-card/80 border border-slate-200 dark:border-kin-border text-xs flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 truncate">
              <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <div className="truncate">
                <span className="font-mono text-blue-700 dark:text-blue-300 font-semibold">
                  {activeTakeover.previewPayload.toolName}:
                </span>{' '}
                <span className="text-slate-700 dark:text-gray-300">{activeTakeover.previewPayload.description}</span>
                {activeTakeover.previewPayload.target && (
                  <span className="ml-2 font-mono text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-300 dark:border-emerald-800">
                    {activeTakeover.previewPayload.target}
                  </span>
                )}
              </div>
            </div>

            {isPaused && (
              <span className="text-[10px] text-amber-700 dark:text-amber-400 font-mono italic shrink-0">
                Holding for human approval...
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
