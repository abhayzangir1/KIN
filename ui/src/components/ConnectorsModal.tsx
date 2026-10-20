import React, { useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { ConnectorsManager } from './ConnectorsManager.js';
import { X, Server } from 'lucide-react';

export const ConnectorsModal: React.FC = () => {
  const { isConnectorsModalOpen, setConnectorsModalOpen } = useKinStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isConnectorsModalOpen) {
        setConnectorsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isConnectorsModalOpen, setConnectorsModalOpen]);

  if (!isConnectorsModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden text-kin-text font-sans">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#21262d] bg-[#161b22] shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <span>Model Context Protocol (MCP) Connectors</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  Global & Project Scope
                </span>
              </h2>
              <p className="text-xs text-[#8b949e]">
                Manage external tools, database connections, and API servers for your autonomous workforce
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConnectorsModalOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[#21262d] text-[#8b949e] hover:text-white transition cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#0d1117]">
          <ConnectorsManager embeddedInModal={true} />
        </div>
      </div>
    </div>
  );
};
