import React, { useState } from 'react';
import { AlertTriangle, Zap, X } from 'lucide-react';
import { useKinStore, AvailableModelItem, PendingRecoveryItem } from '../../store/kinStore.js';

interface InterruptedRecoveryDockProps {
  selectableModels?: AvailableModelItem[];
}

export const InterruptedRecoveryDock: React.FC<InterruptedRecoveryDockProps> = ({
  selectableModels = [],
}) => {
  const {
    pendingRecoveries,
    discardRecoveries,
    resumeAllRecoveries,
    resumeRun,
    switchRunToModel,
    switchRunToOllama,
    ollamaStatus,
    availableModels,
    addToast,
  } = useKinStore();

  const [inspectingRecovery, setInspectingRecovery] = useState<PendingRecoveryItem | null>(null);
  const [selectedRecoveryModels, setSelectedRecoveryModels] = useState<Record<string, string>>({});
  const [isDismissed, setIsDismissed] = useState(false);

  // Ensure it only mounts when genuine persistent recoveries exist from cold startup with valid checkpoints
  const validRecoveries = (pendingRecoveries || []).filter(
    (rec) => (rec.checkpoint?.snapshotJson || rec.checkpoint) && (rec.runId || rec.id)
  );

  if (isDismissed || validRecoveries.length === 0) return null;

  const models = selectableModels.length > 0 ? selectableModels : availableModels;

  const handleSwitchOllama = async (runId: string) => {
    const res = await switchRunToOllama(runId);
    if (!res.success) {
      addToast('Failed to switch to local Ollama', 'error');
    } else {
      addToast(`Switched run to Ollama (${res.model || 'local'})`, 'success');
    }
  };

  return (
    <div
      role="region"
      aria-label="Interrupted Run Recovery Dock"
      className="my-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2.5 shadow-sm transition-all overflow-hidden"
    >
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2 min-w-0">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-pulse shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200 font-mono truncate">
            Interrupted Run Recovery ({validRecoveries.length} run{validRecoveries.length > 1 ? 's' : ''})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setInspectingRecovery(inspectingRecovery ? null : validRecoveries[0])}
            className="px-2.5 py-1 rounded bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-500/40 text-[10px] font-mono transition cursor-pointer whitespace-nowrap"
            title="Inspect turn checkpoint state and execution snapshot"
          >
            {inspectingRecovery ? 'Close Inspection' : 'Inspect State'}
          </button>
          <button
            type="button"
            onClick={() => discardRecoveries()}
            className="px-2.5 py-1 rounded bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-500/40 text-[10px] font-mono transition cursor-pointer whitespace-nowrap"
            title="Discard interrupted runs and start clean"
          >
            Discard All
          </button>
          <button
            type="button"
            onClick={() => resumeAllRecoveries()}
            className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold font-mono transition flex items-center space-x-1 shadow-sm cursor-pointer whitespace-nowrap"
            title="Resume all runs from their exact saved turn checkpoints"
          >
            <Zap className="w-3 h-3 text-black fill-current shrink-0" />
            <span>Resume All ({validRecoveries.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="p-1 rounded text-kin-muted hover:text-kin-text transition cursor-pointer"
            title="Dismiss recovery banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Recoveries List */}
      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
        {validRecoveries.map((rec) => {
          const runId = rec.runId || rec.id;
          return (
            <div
              key={runId}
              className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-white/70 dark:bg-[#0b0805] border border-amber-200 dark:border-amber-900/40 text-xs font-mono"
            >
              <div className="flex items-center space-x-2 min-w-0 pr-2 flex-1">
                <span className="text-amber-800 dark:text-amber-400 font-bold shrink-0">{rec.agentName}</span>
                <span className="text-slate-600 dark:text-[#94a3b8] text-[11px] truncate">
                  Turn #{rec.interruptedTurn} ({rec.model || 'default'})
                </span>
                <span className="text-slate-500 dark:text-[#64748b] text-[10px] truncate max-w-[200px]">
                  {rec.checkpointReason}
                </span>
              </div>

              <div className="flex items-center space-x-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setInspectingRecovery(rec)}
                  className="px-2 py-0.5 rounded bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-500/40 text-[10px] transition cursor-pointer whitespace-nowrap"
                  title="Inspect turn snapshot"
                >
                  Inspect
                </button>
                <select
                  value={selectedRecoveryModels[runId] || rec.model || models[0]?.id || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedRecoveryModels((prev) => ({ ...prev, [runId]: val }));
                  }}
                  className="bg-white dark:bg-black/60 border border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-200 text-[10px] rounded px-1.5 py-0.5 max-w-[150px] truncate focus:outline-none focus:border-amber-500 cursor-pointer"
                  title="Select target model for failover/resume"
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
                    const targetModel = selectedRecoveryModels[runId] || rec.model || models[0]?.id || '';
                    switchRunToModel(runId, targetModel);
                  }}
                  className="px-2 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
                  title="Switch to selected LLM and resume from checkpoint"
                >
                  Switch & Resume
                </button>
                {ollamaStatus?.online && (
                  <button
                    type="button"
                    onClick={() => handleSwitchOllama(runId)}
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
                    title="Switch immediately to local Ollama"
                  >
                    🦙 Ollama
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => resumeRun(runId)}
                  className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
                  title="Resume this specific run"
                >
                  Resume
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Snapshot Inspection Panel */}
      {inspectingRecovery && (
        <div className="p-3 bg-white/90 dark:bg-black/60 border border-amber-300 dark:border-amber-500/40 rounded-lg space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between border-b border-amber-200 dark:border-amber-900/40 pb-1.5">
            <span className="font-bold text-amber-800 dark:text-amber-300">
              Checkpoint Snapshot: {inspectingRecovery.agentName} (Turn #{inspectingRecovery.interruptedTurn})
            </span>
            <button
              type="button"
              onClick={() => setInspectingRecovery(null)}
              className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
            {inspectingRecovery.snapshotState
              ? JSON.stringify(inspectingRecovery.snapshotState, null, 2)
              : inspectingRecovery.checkpointReason || 'No extended snapshot data captured.'}
          </div>
        </div>
      )}
    </div>
  );
};
