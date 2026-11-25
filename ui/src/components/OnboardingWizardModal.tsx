import React, { useEffect, useState } from 'react';
import { Cpu, Cloud, Sparkles, X, CheckCircle2 } from 'lucide-react';
import { useKinStore } from '../store/kinStore.js';

interface HardwareSummary {
  totalMemoryGb?: number;
  cpuCores?: number;
  tierName?: string;
}

export const OnboardingWizardModal: React.FC = () => {
  const isOpen = useKinStore((s) => s.isOnboardingWizardOpen);
  const setOpen = useKinStore((s) => s.setOnboardingWizardOpen);
  const openSettingsModal = useKinStore((s) => s.openSettingsModal);
  const ollamaStatus = useKinStore((s) => s.ollamaStatus);
  const [hw, setHw] = useState<HardwareSummary | null>(null);
  const [hwError, setHwError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setHwError(false);
    fetch('/api/system/governor')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const profile = data?.hardwareProfile || data?.hardware;
        if (profile) {
          setHw({
            totalMemoryGb: profile.totalMemoryGb ?? profile.totalRamGb,
            cpuCores: profile.cpuCores,
            tierName: profile.tierName,
          });
        }
      })
      .catch(() => {
        setHwError(true);
      });
  }, [isOpen]);

  const dismiss = () => {
    try {
      window.localStorage.setItem('kin_onboarding_dismissed', '1');
    } catch {}
    setOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const ramGb = hw?.totalMemoryGb ?? 0;
  const localTierLabel = hwError
    ? 'Host hardware detection unavailable — choose Local Ollama or Cloud API below'
    : ramGb >= 32
    ? 'High-RAM Workstation (14B–32B local models)'
    : ramGb >= 16
    ? 'Standard Workstation (7B–14B local models)'
    : 'Lean Device (3B–7B quantized or Cloud BYOK)';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kin-onboarding-title"
      className="fixed inset-0 z-[115] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg rounded-2xl bg-kin-surface border border-kin-border shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <h2 id="kin-onboarding-title" className="text-base font-bold text-kin-text">
              Welcome to KIN — Quick Setup
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="text-kin-muted hover:text-kin-text p-1 rounded"
            aria-label="Close onboarding wizard"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-kin-card border border-kin-border text-xs space-y-1">
          <div className="font-semibold text-kin-text flex items-center justify-between">
            <span>Detected Host Profile</span>
            {ramGb > 0 && <span className="font-mono text-emerald-400">{ramGb.toFixed(1)} GB RAM · {hw?.cpuCores || '?'} cores</span>}
          </div>
          <div className="text-kin-muted">{localTierLabel}</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              dismiss();
              openSettingsModal('models');
            }}
            className="p-4 rounded-xl bg-kin-card border border-kin-border hover:border-emerald-500/60 text-left space-y-2 transition"
          >
            <div className="flex items-center justify-between">
              <Cpu className="w-5 h-5 text-emerald-400" />
              {ollamaStatus?.online && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            </div>
            <div className="text-xs font-bold text-kin-text">Local Models (Ollama)</div>
            <div className="text-[11px] text-kin-muted">
              {ollamaStatus?.online
                ? `Ollama online (${ollamaStatus.models?.length || 0} models detected).`
                : 'Private offline inference via Ollama auto-detection.'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              dismiss();
              openSettingsModal('credentials');
            }}
            className="p-4 rounded-xl bg-kin-card border border-kin-border hover:border-blue-500/60 text-left space-y-2 transition"
          >
            <Cloud className="w-5 h-5 text-blue-400" />
            <div className="text-xs font-bold text-kin-text">Cloud BYOK Providers</div>
            <div className="text-[11px] text-kin-muted">
              Connect OpenAI, Anthropic, Gemini, DeepSeek, or OpenRouter keys in your encrypted vault.
            </div>
          </button>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-kin-card hover:bg-kin-border text-kin-text border border-kin-border"
          >
            Continue to Workspace
          </button>
        </div>
      </div>
    </div>
  );
};
