import React, { useEffect } from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { useKinStore } from '../store/kinStore.js';

export function requestConfirmation(params: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useKinStore.getState().openConfirmDialog({
      ...params,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export const ConfirmDialog: React.FC = () => {
  const confirmDialog = useKinStore((s) => s.confirmDialog);
  const closeConfirmDialog = useKinStore((s) => s.closeConfirmDialog);

  useEffect(() => {
    if (!confirmDialog?.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeConfirmDialog();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (confirmDialog.onConfirm) {
          const res = confirmDialog.onConfirm();
          if (res && typeof (res as Promise<void>).then === 'function') {
            (res as Promise<void>).finally(() => closeConfirmDialog());
            return;
          }
        }
        closeConfirmDialog();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmDialog, closeConfirmDialog]);

  if (!confirmDialog || !confirmDialog.isOpen) return null;

  const {
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    onConfirm,
  } = confirmDialog;

  const handleConfirm = async () => {
    try {
      if (onConfirm) {
        await onConfirm();
      }
    } finally {
      closeConfirmDialog();
    }
  };

  const handleCancel = () => {
    closeConfirmDialog();
  };

  const icon =
    variant === 'danger' ? (
      <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
    ) : variant === 'warning' ? (
      <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
    ) : (
      <Info className="w-5 h-5 text-blue-400 shrink-0" />
    );

  const confirmBtnBg =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-500 text-white'
      : variant === 'warning'
      ? 'bg-amber-600 hover:bg-amber-500 text-white'
      : 'bg-blue-600 hover:bg-blue-500 text-white';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn"
      onClick={handleCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md bg-[#0c1017] border border-[#1e293b] rounded-xl shadow-2xl overflow-hidden text-kin-text animate-scaleUp p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`p-2 rounded-lg ${
                variant === 'danger'
                  ? 'bg-red-500/10 border border-red-500/30'
                  : variant === 'warning'
                  ? 'bg-amber-500/10 border border-amber-500/30'
                  : 'bg-blue-500/10 border border-blue-500/30'
              }`}
            >
              {icon}
            </div>
            <h3 className="text-sm font-semibold text-kin-text">{title}</h3>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1 rounded-md text-kin-muted hover:text-kin-text hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-kin-muted leading-relaxed pl-1">{message}</p>

        <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#1e293b]/60">
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-kin-muted hover:text-kin-text text-xs font-medium transition cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition cursor-pointer shadow-sm ${confirmBtnBg}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
