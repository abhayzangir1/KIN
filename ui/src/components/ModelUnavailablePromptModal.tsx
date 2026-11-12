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

  // Only show modal when an actual provider authentication error (HTTP 401, 403, invalid API key) occurs.
  const isAuthError = Boolean(
    error &&
      (error.includes('401') ||
        error.includes('403') ||
        /invalid\s*(api)?\s*key/i.test(error) ||
        /authentication/i.test(error) ||
        /unauthorized/i.test(error) ||
        /auth\s*failure/i.test(error) ||
        /bad\s*api\s*key/i.test(error))
  );

  if (!isAuthError) return null;

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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div
        className="w-full max-w-lg bg-kin-surface border border-amber-500/40 rounded-xl shadow-2xl flex flex-col overflow-hidden text-kin-text animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="modal-title" className="text-base font-semibold text-kin-text tracking-wide">
                Model Execution Halted
              </h2>
              <p className="text-xs text-amber-400/90">
                Silent fallback is disabled — operator action required
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissModelUnavailableNotice}
            className="p-1.5 text-kin-muted hover:text-kin-text rounded-lg hover:bg-kin-card transition cursor-pointer"
            title="Dismiss notification"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 text-xs">
          <div className="text-kin-muted leading-relaxed">
            The selected model for <span className="font-semibold text-kin-text">{agentName}</span> failed to respond. Under the strict operator control policy, KIN does not automatically substitute an unverified fallback model.
          </div>

          <div className="bg-kin-card border border-kin-border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-kin-muted font-mono text-[11px]">Target Agent:</span>
              <span className="font-medium text-kin-text px-2 py-0.5 rounded bg-kin-surface border border-kin-border text-[11px]">
                {agentName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-kin-muted font-mono text-[11px]">Configured Model:</span>
              <span className="font-mono text-cyan-400 text-[11px] truncate max-w-[280px]">
                {modelId || 'None'}
              </span>
            </div>
          </div>

          <div>
            <div className="text-kin-muted mb-1.5 font-medium flex items-center space-x-1.5">
              <span>Failure Diagnosis:</span>
            </div>
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 font-mono text-[11px] max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
              {error || 'Model service rejected request or returned an error status.'}
            </div>
          </div>

          <div className="bg-kin-card/60 border border-kin-border rounded-lg p-3 text-kin-muted text-[11px] leading-relaxed">
            💡 <strong className="text-kin-text">Recommended Resolution:</strong> Switch to another available model or configure valid API credentials for provider <span className="font-mono text-amber-400">{providerHint || 'configured'}</span>.
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-kin-card/40 border-t border-kin-border flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={dismissModelUnavailableNotice}
            className="px-3.5 py-1.5 rounded-lg border border-kin-border text-kin-muted hover:bg-kin-card hover:text-kin-text transition text-xs font-medium cursor-pointer"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleConfigureKey}
            className="px-3.5 py-1.5 rounded-lg bg-kin-surface hover:bg-kin-card border border-kin-border text-amber-400 transition text-xs font-medium flex items-center space-x-1.5 cursor-pointer shadow-xs"
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
