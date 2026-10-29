import React from 'react';
import { useKinStore } from '../store/kinStore.js';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useKinStore();

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col space-y-2 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';
        const isWarning = toast.type === 'warning';
        const isInfo = toast.type === 'info';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start justify-between p-3 rounded-xl shadow-2xl border backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 ${
              isSuccess
                ? 'bg-[#062419]/90 border-emerald-500/40 text-emerald-100 shadow-emerald-950/40'
                : isError
                ? 'bg-[#2a0e14]/90 border-red-500/40 text-red-100 shadow-red-950/40'
                : isWarning
                ? 'bg-[#291b07]/90 border-amber-500/40 text-amber-100 shadow-amber-950/40'
                : 'bg-[#0c192d]/90 border-blue-500/40 text-blue-100 shadow-blue-950/40'
            }`}
          >
            <div className="flex items-start space-x-2.5 mr-2">
              <span className="shrink-0 mt-0.5">
                {isSuccess && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                {isError && <AlertCircle className="w-4 h-4 text-red-400" />}
                {isWarning && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                {isInfo && <Info className="w-4 h-4 text-blue-400" />}
              </span>
              <div className="flex flex-col space-y-0.5">
                {toast.title && <p className="text-xs font-bold leading-tight select-text">{toast.title}</p>}
                <p className="text-[11px] opacity-90 leading-relaxed select-text">{toast.message}</p>
              </div>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-white/60 hover:text-white transition p-0.5 rounded hover:bg-white/10 shrink-0 cursor-pointer"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
