import React, { useState } from 'react';
import {
  ShieldCheck,
  Globe,
  Lock,
  Server,
  FileText,
  MessageSquare,
  Search,
} from 'lucide-react';
import { useKinStore } from '../../store/kinStore.js';
import { requestConfirmation } from '../ConfirmDialog.js';

export interface EgressConsentState {
  masterEgressEnabled: boolean;
  allowPrompts: boolean;
  allowSharedMemory: boolean;
  allowPrivateNotes: boolean;
  allowDirectMessages: boolean;
  allowWebSearchContext: boolean;
  updatedAt: number;
}

export const EgressConsentTab: React.FC = () => {
  const { activeProjectId, activeProject, credentials, addToast } = useKinStore();

  const storageKey = `kin_egress_consent_${activeProjectId || 'global'}`;

  const [consent, setConsent] = useState<EgressConsentState>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.warn('[KIN UI] Failed to load egress consent:', err);
    }
    // Default safe state per PRD § 8:
    // Egress disabled by default, private notes & DMs never enabled automatically
    return {
      masterEgressEnabled: false,
      allowPrompts: true,
      allowSharedMemory: true,
      allowPrivateNotes: false,
      allowDirectMessages: false,
      allowWebSearchContext: false,
      updatedAt: Date.now(),
    };
  });

  const saveConsent = (updated: Partial<EgressConsentState>) => {
    const newState = {
      ...consent,
      ...updated,
      updatedAt: Date.now(),
    };
    setConsent(newState);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newState));
      addToast('Cloud Egress Policy updated', 'success');
    } catch (err) {
      console.error('[KIN UI] Failed to persist egress consent:', err);
    }
  };

  const handleRevokeAll = async () => {
    const ok = await requestConfirmation({
      title: 'Revoke All Cloud Egress',
      message:
        'This will immediately block all external cloud transmissions. Autonomous agents will fail over to local Ollama or pause until reauthorized.',
      confirmLabel: 'Revoke All Egress',
      variant: 'danger',
    });
    if (!ok) return;

    saveConsent({
      masterEgressEnabled: false,
      allowPrivateNotes: false,
      allowDirectMessages: false,
      allowWebSearchContext: false,
    });
    addToast('All cloud egress revoked — operating in strict air-gapped mode', 'info');
  };

  // Known provider destinations
  const externalDestinations = credentials.filter(
    (c) => !['ollama', 'lmstudio', 'vllm'].includes(c.provider.toLowerCase())
  );

  return (
    <div className="space-y-6 font-sans text-xs">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center space-x-2">
          <Globe className="w-4 h-4 text-blue-500" />
          <span>Cloud Egress Consent & Data Classification Policy</span>
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          PRD § 8 Governance: External inference is disabled by default. Project data leaves this device only with your explicit cryptographic consent.
        </p>
      </div>

      {/* Master Egress Kill-Switch Banner */}
      <div
        className={`p-4 rounded-xl border transition-all ${
          consent.masterEgressEnabled
            ? 'bg-blue-50/70 dark:bg-blue-950/25 border-blue-300 dark:border-blue-800'
            : 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-300 dark:border-emerald-800'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div
              className={`p-2.5 rounded-lg shrink-0 ${
                consent.masterEgressEnabled
                  ? 'bg-blue-600 text-white'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {consent.masterEgressEnabled ? (
                <Globe className="w-5 h-5 animate-pulse" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-slate-900 dark:text-white">
                  Master Cloud Egress Status:
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-mono font-bold uppercase ${
                    consent.masterEgressEnabled
                      ? 'bg-blue-200 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300'
                      : 'bg-emerald-200 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300'
                  }`}
                >
                  {consent.masterEgressEnabled ? 'Cloud Enabled' : 'Air-Gapped / Local Only'}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {consent.masterEgressEnabled
                  ? 'Project content may be transmitted to authorized frontier LLM endpoints according to the classification rules below.'
                  : 'All outbound LLM traffic is blocked. Agents are constrained to local Ollama / LM Studio models.'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => saveConsent({ masterEgressEnabled: !consent.masterEgressEnabled })}
              className={`px-4 py-2 rounded-lg font-bold text-xs shadow-xs transition cursor-pointer ${
                consent.masterEgressEnabled
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {consent.masterEgressEnabled ? 'Disable Cloud Egress' : 'Authorize Cloud Egress'}
            </button>
            {consent.masterEgressEnabled && (
              <button
                type="button"
                onClick={handleRevokeAll}
                className="px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition cursor-pointer"
                title="Immediately revoke all consents"
              >
                Revoke All
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Destination Disclosure (PRD § 8) */}
      <div className="p-4 bg-white dark:bg-[#0c1220] border border-slate-200 dark:border-slate-800 rounded-xl space-y-3 shadow-xs">
        <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white">
          <Server className="w-4 h-4 text-purple-500" />
          <span>Destination Disclosure: Configured Cloud Endpoints</span>
        </div>
        <p className="text-slate-600 dark:text-slate-400 text-xs">
          When cloud egress is enabled, prompts and context can only be delivered to these explicitly configured vault profiles:
        </p>

        {externalDestinations.length === 0 ? (
          <div className="p-3 rounded-lg bg-slate-100 dark:bg-[#070b14] text-slate-500 font-mono text-[11px] text-center">
            No external cloud providers configured in Vault. Local-only mode guaranteed.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {externalDestinations.map((dest) => (
              <div
                key={dest.id}
                className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800 flex items-center justify-between font-mono text-[11px]"
              >
                <div className="min-w-0 pr-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200 uppercase">
                    {dest.provider}
                  </span>
                  <div className="text-slate-400 text-[10px] truncate">
                    {dest.baseUrl || `https://api.${dest.provider}.com/v1`}
                  </div>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[9px] uppercase font-bold shrink-0">
                  Target
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Data Classification Consent Matrix */}
      <div className="p-4 bg-white dark:bg-[#0c1220] border border-slate-200 dark:border-slate-800 rounded-xl space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white">
            <Lock className="w-4 h-4 text-emerald-500" />
            <span>Data Classification Policy (Granular Opt-In)</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            Project: {activeProject?.name || 'Current'}
          </span>
        </div>

        <div className="space-y-3">
          {/* User Prompts */}
          <div className="flex items-start justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40 transition">
            <div className="flex items-start space-x-2.5">
              <FileText className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  User Prompts & Task Directives
                </span>
                <p className="text-[11px] text-slate-500">
                  Transmit operator prompts and explicit instructions to selected models.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              disabled={!consent.masterEgressEnabled}
              checked={consent.allowPrompts}
              onChange={(e) => saveConsent({ allowPrompts: e.target.checked })}
              className="rounded text-blue-600 focus:ring-0 cursor-pointer disabled:opacity-40 mt-1"
            />
          </div>

          {/* Shared Memory */}
          <div className="flex items-start justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40 transition">
            <div className="flex items-start space-x-2.5">
              <Server className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Project Shared Memory & Architecture Records
                </span>
                <p className="text-[11px] text-slate-500">
                  Include public project goals, ADRs, and shared repository context in turn context windows.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              disabled={!consent.masterEgressEnabled}
              checked={consent.allowSharedMemory}
              onChange={(e) => saveConsent({ allowSharedMemory: e.target.checked })}
              className="rounded text-blue-600 focus:ring-0 cursor-pointer disabled:opacity-40 mt-1"
            />
          </div>

          {/* Agent Private Notes */}
          <div className="flex items-start justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40 transition">
            <div className="flex items-start space-x-2.5">
              <Lock className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <div className="flex items-center space-x-1.5">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Agent Private Scratchpads & Internal Notes
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-mono text-[9px] uppercase font-bold border border-amber-300 dark:border-amber-800/40">
                    Protected
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  PRD § 8: Private thoughts, scratchpads, and reflections remain strictly local unless explicitly enabled here.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              disabled={!consent.masterEgressEnabled}
              checked={consent.allowPrivateNotes}
              onChange={(e) => saveConsent({ allowPrivateNotes: e.target.checked })}
              className="rounded text-blue-600 focus:ring-0 cursor-pointer disabled:opacity-40 mt-1"
            />
          </div>

          {/* Direct Messages */}
          <div className="flex items-start justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40 transition">
            <div className="flex items-start space-x-2.5">
              <MessageSquare className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
              <div>
                <div className="flex items-center space-x-1.5">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Confidential Agent-to-Agent Direct Messages
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 font-mono text-[9px] uppercase font-bold border border-indigo-300 dark:border-indigo-800/40">
                    Protected
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Allow peer-to-peer coworker private threads to be forwarded through external frontier models.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              disabled={!consent.masterEgressEnabled}
              checked={consent.allowDirectMessages}
              onChange={(e) => saveConsent({ allowDirectMessages: e.target.checked })}
              className="rounded text-blue-600 focus:ring-0 cursor-pointer disabled:opacity-40 mt-1"
            />
          </div>

          {/* Web Search Context */}
          <div className="flex items-start justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40 transition">
            <div className="flex items-start space-x-2.5">
              <Search className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Web Search Context Attachment
                </span>
                <p className="text-[11px] text-slate-500">
                  PRD § 8: Web search queries only contain search keywords by default. Attaching project context requires this separate consent.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              disabled={!consent.masterEgressEnabled}
              checked={consent.allowWebSearchContext}
              onChange={(e) => saveConsent({ allowWebSearchContext: e.target.checked })}
              className="rounded text-blue-600 focus:ring-0 cursor-pointer disabled:opacity-40 mt-1"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
