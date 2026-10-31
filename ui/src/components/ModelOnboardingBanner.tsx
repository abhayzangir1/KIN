import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { Sparkles, ArrowRight, X } from 'lucide-react';

export const ModelOnboardingBanner: React.FC = () => {
  const isConnected = useKinStore((s) => s.isConnected);
  const isLoadingModels = useKinStore((s) => s.isLoadingModels);
  const availableModels = useKinStore((s) => s.availableModels);
  const openModelSelector = useKinStore((s) => s.openModelSelector);

  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && sessionStorage.getItem('KIN_MODEL_ONBOARDING_DISMISSED') === 'true';
    } catch {
      return false;
    }
  });

  if (!isConnected || isLoadingModels || (availableModels && availableModels.length > 0) || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      sessionStorage.setItem('KIN_MODEL_ONBOARDING_DISMISSED', 'true');
    } catch (err) {
      console.debug('[ModelOnboardingBanner] Failed to write dismiss flag to sessionStorage:', err);
    }
  };

  return (
    <div
      role="region"
      aria-label="AI Model Setup Onboarding Banner"
      className="bg-gradient-to-r from-indigo-950/80 via-blue-950/70 to-slate-900/90 border-b border-indigo-500/30 text-indigo-100 px-4 py-2 text-xs flex items-center justify-between z-30 transition-all shrink-0 shadow-sm"
    >
      <div className="flex items-center space-x-2.5">
        <div className="w-6 h-6 rounded-md bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shrink-0 text-indigo-300">
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2">
          <span className="font-semibold text-indigo-200">Welcome to KIN — Get Started with AI Models</span>
          <span className="text-indigo-300/75 text-[11px] hidden md:inline">
            Connect an API provider (Anthropic, OpenAI, Gemini) or local Ollama instance to power your agents.
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-2 shrink-0">
        <button
          type="button"
          onClick={() => openModelSelector()}
          className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition cursor-pointer flex items-center space-x-1.5 shadow-sm active:scale-95"
          title="Open Model Selector to configure API providers or local models"
        >
          <span>Configure Models</span>
          <ArrowRight className="w-3 h-3" />
        </button>

        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded text-indigo-400 hover:text-indigo-200 hover:bg-indigo-500/20 transition cursor-pointer"
          title="Dismiss banner for this session"
          aria-label="Dismiss onboarding banner"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
