import React, { useState, useEffect } from 'react';
import { KeyRound, X, AlertCircle } from 'lucide-react';
import { useKinStore } from '../store/kinStore.js';

export const TokenPairingModal: React.FC = () => {
  const isOpen = useKinStore((s) => s.isPairingModalOpen);
  const pairingError = useKinStore((s) => s.pairingError);
  const setPairingModalOpen = useKinStore((s) => s.setPairingModalOpen);
  const submitPairingToken = useKinStore((s) => s.submitPairingToken);
  const [tokenInput, setTokenInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPairingModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, setPairingModalOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setSubmitting(true);
    try {
      await submitPairingToken(tokenInput.trim());
      if (!useKinStore.getState().pairingError) {
        setTokenInput('');
      }
    } catch (err: any) {
      useKinStore.getState().setPairingModalOpen(true, err?.message || 'Failed to reach KIN daemon.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kin-pairing-title"
      className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-kin-surface border border-kin-border shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <KeyRound className="w-5 h-5 text-amber-400" />
            <h2 id="kin-pairing-title" className="text-sm font-bold text-kin-text">
              Pair with Local KIN Daemon
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setPairingModalOpen(false)}
            className="text-kin-muted hover:text-kin-text p-1 rounded"
            aria-label="Close pairing dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-kin-muted leading-relaxed">
          Your browser session requires the local IPC authentication token printed by the KIN daemon at startup
          (or via <code className="px-1 py-0.5 rounded bg-kin-card font-mono">/?token=...</code>).
        </p>

        {pairingError && (
          <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{pairingError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste KIN IPC Bearer token..."
            autoFocus
            className="w-full px-3 py-2 rounded-lg bg-kin-card border border-kin-border text-xs font-mono text-kin-text focus:outline-none focus:border-emerald-500"
          />
          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setPairingModalOpen(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-kin-muted hover:text-kin-text border border-kin-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !tokenInput.trim()}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              {submitting ? 'Pairing...' : 'Connect & Pair'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
