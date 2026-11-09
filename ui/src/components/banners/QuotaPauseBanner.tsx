import React, { useState, useEffect } from 'react';
import { Timer, X } from 'lucide-react';
import { useKinStore, AvailableModelItem } from '../../store/kinStore.js';

interface QuotaPauseBannerProps {
  selectableModels?: AvailableModelItem[];
}

export const QuotaPauseBanner: React.FC<QuotaPauseBannerProps> = ({ selectableModels = [] }) => {
  const {
    quotaPauseState,
    clearQuotaPause,
    switchRunToModel,
    switchRunToOllama,
    resumeRun,
    ollamaStatus,
    addToast,
    availableModels,
  } = useKinStore();

  const [selectedModel, setSelectedModel] = useState<string>('');
  const [now, setNow] = useState(Date.now());

  // Isolated 1-second countdown interval inside QuotaPauseBanner
  useEffect(() => {
    if (!quotaPauseState?.isPaused) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [quotaPauseState?.isPaused]);

  if (!quotaPauseState?.isPaused) return null;

  const models = selectableModels.length > 0 ? selectableModels : availableModels;
  const targetTime = quotaPauseState.resetsAt || quotaPauseState.quotaResetsAt || now;
  const secondsRemaining = Math.max(0, Math.ceil((targetTime - now) / 1000));

  const handleSwitchToOllama = async () => {
    const res = await switchRunToOllama(quotaPauseState.runId || '');
    if (!res.success) {
      addToast('Failed to switch to local Ollama', 'error');
    } else {
      addToast(`Switched run to Ollama (${res.model || 'local'})`, 'success');
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className="my-2 p-3 bg-purple-50/90 dark:bg-purple-950/70 backdrop-blur-sm border border-purple-300 dark:border-purple-500/60 rounded-xl space-y-2 shadow-lg transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Timer className="w-4 h-4 text-purple-600 dark:text-purple-400 animate-spin" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-purple-800 dark:text-purple-200 font-mono">
            Quota Guard: Execution Paused (HTTP 429 Rate Limit)
          </span>
          <span className="px-1.5 py-0.5 rounded bg-purple-200 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300 font-mono text-[10px] border border-purple-300 dark:border-purple-500/30">
            Auto-resumes in {secondsRemaining}s
          </span>
        </div>
        <button
          type="button"
          onClick={() => clearQuotaPause()}
          className="p-1 text-slate-500 hover:text-purple-800 dark:text-slate-400 dark:hover:text-purple-300 transition cursor-pointer"
          title="Dismiss Quota Banner"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono p-2 rounded-lg bg-white/70 dark:bg-[#0b0616] border border-purple-200 dark:border-purple-900/40">
        <div className="text-slate-700 dark:text-[#cbd5e1] text-[11px] truncate">
          Agent <strong className="text-purple-700 dark:text-purple-300">{quotaPauseState.agentName ? (quotaPauseState.agentName.startsWith('@') ? quotaPauseState.agentName : `@${quotaPauseState.agentName}`) : 'specialist'}</strong> on provider <strong className="text-purple-700 dark:text-purple-300">{quotaPauseState.provider || 'frontier API'}</strong> reached rate limits.
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <select
            value={selectedModel || models[0]?.id || ''}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-white dark:bg-black/60 border border-purple-300 dark:border-purple-500/40 text-purple-900 dark:text-purple-200 text-[10px] rounded px-2 py-1 max-w-[170px] truncate focus:outline-none focus:border-purple-500 cursor-pointer font-mono"
            title="Select alternative model to resume immediately"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} className="text-slate-900 dark:text-white">
                {m.name} ({m.provider})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              const target = selectedModel || models[0]?.id || '';
              switchRunToModel(quotaPauseState.runId || '', target);
            }}
            className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
            title="Switch to selected LLM and resume execution immediately"
          >
            ⚡ Switch & Resume
          </button>

          {ollamaStatus?.online && (
            <button
              type="button"
              onClick={handleSwitchToOllama}
              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
              title="Switch immediately to local Ollama (zero API cost/quota)"
            >
              🦙 Switch to Ollama
            </button>
          )}

          <button
            type="button"
            onClick={() => resumeRun(quotaPauseState.runId || '')}
            className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
            title="Force resume execution now"
          >
            Resume Now
          </button>
        </div>
      </div>
    </div>
  );
};
