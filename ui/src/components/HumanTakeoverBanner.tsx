import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
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

  const isChannelExecuting =
    !!activeTakeover ||
    Object.entries(activeAgentChannels || {}).some(([_, chanId]) => chanId === activeChannelId) ||
    (isDm && !!targetAgentId && agents.some((a) => a.id === targetAgentId && (a.status === 'working' || a.status === 'thinking')));

  // Check if an agent in another channel requires urgent attention (paused, auth required, or financial gate)
  const crossChannelAlert = Object.values(activeTakeovers || {}).find(
    (t) => t.channelId && t.channelId !== activeChannelId && (t.isPaused || t.authRequired || t.financialGate)
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
      // Do not trigger if typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
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

  if (!activeTakeover && !runningAgent && !isChannelExecuting) {
    if (crossChannelAlert && crossChannelName) {
      return (
        <div className="w-full pointer-events-auto select-none p-2.5 rounded-xl bg-[#1a1208] border border-amber-500/50 shadow-xl flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 text-amber-300 font-mono">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <span>
              <strong>{crossChannelAgent}</strong> requires attention in <strong>#{crossChannelName}</strong> ({crossChannelAlert.riskLevel || 'PAUSED'})
            </span>
          </div>
          <button
            onClick={() => setActiveChannel(crossChannelAlert.channelId!)}
            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-xs font-semibold transition"
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
    if (!steerText.trim()) return;
    const text = steerText.trim();
    setSteerText('');
    setIsSteerOpen(false);
    const targetChan = activeTakeover?.channelId || activeChannelId;
    await sendMessage(`⚠️ [STEER DIRECTIVE]: ${text}`, targetChan);
    setSteerSent(true);
    setTimeout(() => setSteerSent(false), 3000);
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
    <div className="w-full pointer-events-auto select-none transition-all duration-200">
      <div
        className={`rounded-xl border backdrop-blur-xl p-3 shadow-2xl transition-all ${
          isFinancial
            ? 'bg-[#180a0f]/95 border-red-500/80 shadow-[0_0_30px_rgba(239,68,68,0.4)]'
            : isAuth
            ? 'bg-[#181106]/95 border-amber-500/80 shadow-[0_0_30px_rgba(245,158,11,0.4)]'
            : isPaused
            ? 'bg-[#151206]/95 border-yellow-500/70 shadow-[0_0_25px_rgba(234,179,8,0.3)]'
            : 'bg-[#0b1329]/95 border-blue-500/60 shadow-[0_0_25px_rgba(59,130,246,0.3)]'
        }`}
      >
        {/* Top Header Row */}
        <div className="flex items-center justify-between gap-3 text-xs">
          {/* Status Indicator */}
          <div className="flex items-center space-x-2.5 truncate">
            <span className="relative flex h-3 w-3 shrink-0">
              {isPaused ? (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
              ) : isAborted ? (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 shadow-[0_0_8px_#ef4444]" />
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                </>
              )}
            </span>

            <div className="flex items-center space-x-1.5 font-bold tracking-wide">
              <span className="text-white text-[13px]">{agentDisplayName}</span>
              <span className="text-gray-400">|</span>
              <span
                className={`uppercase text-[11px] px-2 py-0.5 rounded font-mono font-semibold ${
                  isAborted
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                    : isPaused
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                }`}
              >
                {isAborted ? 'ABORTED' : isPaused ? 'PAUSED (TAKEN OVER)' : 'EXECUTING'}
              </span>
            </div>

            {/* Risk Badge */}
            {activeTakeover?.riskLevel && (
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 ${
                  activeTakeover.riskLevel === 'CRITICAL'
                    ? 'bg-red-600 text-white animate-pulse shadow-[0_0_12px_#ef4444]'
                    : activeTakeover.riskLevel === 'HIGH'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
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
                  onClick={() => resumeAgent(activeTakeover.runId)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-[0_0_12px_rgba(16,185,129,0.4)]"
                  title="Resume Autonomous Execution (Press Esc)"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Resume (Esc)</span>
                </button>
              ) : (
                <button
                  onClick={() => pauseAgent(activeTakeover.runId)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition shadow-[0_0_12px_rgba(245,158,11,0.4)]"
                  title="Pause Agent Immediately (Press Esc)"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Pause (Esc)</span>
                </button>
              )
            ) : (
              <button
                onClick={async () => {
                  await fetchActiveRuns();
                  const cur = useKinStore.getState().activeTakeover;
                  if (cur) await pauseAgent(cur.runId);
                }}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-amber-600/80 hover:bg-amber-600 text-white font-medium text-xs transition"
                title="Pause Active Agent Execution (Press Esc)"
              >
                <Pause className="w-3 h-3 fill-current" />
                <span>Pause (Esc)</span>
              </button>
            )}

            {/* Steer Popover Toggle */}
            <button
              onClick={() => setIsSteerOpen(!isSteerOpen)}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
                isSteerOpen
                  ? 'bg-blue-600 text-white border-blue-400'
                  : 'bg-[#1b2234] hover:bg-[#252f48] text-blue-300 border-blue-500/30'
              }`}
              title="Steer active execution without stopping task"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Steer</span>
            </button>

            {/* Emergency Kill Switch */}
            <button
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
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white font-semibold text-xs transition shadow-[0_0_10px_rgba(239,68,68,0.4)]"
              title="Emergency Kill Switch — Immediately abort current agent run"
            >
              <OctagonAlert className="w-3.5 h-3.5" />
              <span>Abort</span>
            </button>

            {/* Dismiss Takeover Pill */}
            <button
              onClick={dismissTakeover}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
              title="Dismiss Takeover Banner"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Mid-Task Steer Notification Toast */}
        {steerSent && (
          <div className="mt-2 p-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
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
              className="flex-1 bg-[#090d18] border border-blue-500/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center space-x-1 transition"
            >
              <SendHorizontal className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
        )}

        {/* CRITICAL Financial Commerce Alert Box */}
        {isFinancial && (
          <div className="mt-2.5 p-2 rounded-lg bg-red-950/70 border border-red-500/60 text-red-200 text-xs flex items-start space-x-2.5">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5 animate-bounce" />
            <div className="space-y-0.5">
              <div className="font-bold text-red-300 tracking-wide uppercase text-[11px]">
                Zero-Trust Financial Safety Gate Activated
              </div>
              <p className="text-[11px] leading-relaxed text-red-200">
                The agent is preparing to execute a commercial or payment action (checkout, cart, or financial form).
                Autonomy mode bypasses are disabled. Inspect the action below and approve or take manual steering.
              </p>
            </div>
          </div>
        )}

        {/* Human Authorization Protocol Alert Box */}
        {isAuth && (
          <div className="mt-2.5 p-2 rounded-lg bg-amber-950/70 border border-amber-500/60 text-amber-200 text-xs flex items-start space-x-2.5">
            <KeyRound className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 animate-pulse" />
            <div className="space-y-0.5">
              <div className="font-bold text-amber-300 tracking-wide uppercase text-[11px]">
                Human Authorization Protocol: Sign-In / CAPTCHA Required
              </div>
              <p className="text-[11px] leading-relaxed text-amber-200">
                A login or verification challenge was detected in the active browser session. Please complete credentials or CAPTCHA manually in the browser window, then click <strong>Resume (Esc)</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Active Tool Action Preview Banner */}
        {activeTakeover?.previewPayload && (
          <div className="mt-2.5 p-2 rounded-lg bg-[#070c18] border border-[#1e2a4a] text-xs flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 truncate">
              <Eye className="w-4 h-4 text-blue-400 shrink-0" />
              <div className="truncate">
                <span className="font-mono text-blue-300 font-semibold">
                  {activeTakeover.previewPayload.toolName}:
                </span>{' '}
                <span className="text-gray-300">{activeTakeover.previewPayload.description}</span>
                {activeTakeover.previewPayload.target && (
                  <span className="ml-2 font-mono text-[11px] text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800">
                    {activeTakeover.previewPayload.target}
                  </span>
                )}
              </div>
            </div>

            {isPaused && (
              <span className="text-[10px] text-amber-400 font-mono italic shrink-0">
                Holding for human approval...
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
