import React, { useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import {
  AlertTriangle,
  X,
  Key,
  Cpu,
} from 'lucide-react';

export const ModelUnavailablePromptModal: React.FC = () => {
  const {
    modelUnavailableNotice,
    dismissModelUnavailableNotice,
    openModelSelector,
    openAddProviderModal,
  } = useKinStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modelUnavailableNotice) {
        dismissModelUnavailableNotice();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modelUnavailableNotice, dismissModelUnavailableNotice]);

  if (!modelUnavailableNotice) return null;

  const { agentId, agentName, modelId, error } = modelUnavailableNotice;

  // Determine provider hint from modelId
  let providerHint = '';
  if (modelId.includes('/')) {
    providerHint = modelId.split('/')[0];
  } else if (modelId.startsWith('claude')) {
    providerHint = 'anthropic';
  } else if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
    providerHint = 'openai';
  } else if (modelId.startsWith('gemini')) {
    providerHint = 'gemini';
  } else if (modelId.startsWith('deepseek')) {
    providerHint = 'deepseek';
  } else if (modelId.startsWith('grok')) {
    providerHint = 'xai';
  }

  const handleChangeModel = () => {
    dismissModelUnavailableNotice();
    openModelSelector(agentId);
  };

  const handleConfigureKey = () => {
    dismissModelUnavailableNotice();
    openAddProviderModal(providerHint || null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className="w-full max-w-lg bg-[#0b0f19] border border-amber-500/40 rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#e2e8f0] animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-amber-950/20 border-b border-amber-500/20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="modal-title" className="text-base font-semibold text-white tracking-wide">
                Model Execution Halted
              </h2>
              <p className="text-xs text-amber-300/80">
                Silent fallback is disabled — operator action required
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissModelUnavailableNotice}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            title="Dismiss notification"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 text-xs">
          <div className="text-slate-300 leading-relaxed">
            The selected model for <span className="font-semibold text-white">{agentName}</span> failed to respond. Under the strict operator control policy, KIN does not automatically substitute an unverified fallback model.
          </div>

          <div className="bg-[#050811] border border-slate-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-mono text-[11px]">Target Agent:</span>
              <span className="font-medium text-white px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700 text-[11px]">
                {agentName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-mono text-[11px]">Configured Model:</span>
              <span className="font-mono text-cyan-300 text-[11px] truncate max-w-[280px]">
                {modelId || 'None'}
              </span>
            </div>
          </div>

          <div>
            <div className="text-slate-400 mb-1.5 font-medium flex items-center space-x-1.5">
              <span>Failure Diagnosis:</span>
            </div>
            <div className="bg-red-950/20 border border-red-500/30 rounded-lg p-3 text-red-300 font-mono text-[11px] max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
              {error || 'Model service rejected request or returned an error status.'}
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/80 rounded-lg p-3 text-slate-400 text-[11px] leading-relaxed">
            💡 <strong className="text-slate-300">Recommended Resolution:</strong> Switch to another available model or configure valid API credentials for provider <span className="font-mono text-amber-300">{providerHint || 'configured'}</span>.
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-[#070b13] border-t border-slate-800/80 flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={dismissModelUnavailableNotice}
            className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition text-xs font-medium cursor-pointer"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleConfigureKey}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-amber-300 transition text-xs font-medium flex items-center space-x-1.5 cursor-pointer shadow-sm"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Configure API Key</span>
          </button>
          <button
            type="button"
            onClick={handleChangeModel}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center space-x-1.5 transition cursor-pointer shadow-sm shadow-emerald-900/50"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Switch Model</span>
          </button>
        </div>
      </div>
    </div>
  );
};
