import React from 'react';
import { useKinStore } from '../store/kinStore.js';
import { Hash, ShieldAlert, Cpu, CheckCircle2 } from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { channels, activeChannelId, setActiveChannel, autonomyMode, setAutonomyMode, pendingApprovals, isConnected } = useKinStore();

  return (
    <aside className="w-64 bg-kin-surface border-r border-kin-border flex flex-col h-screen">
      {/* Workspace Header */}
      <div className="p-4 border-b border-kin-border flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white tracking-wider">
            KIN
          </div>
          <div>
            <h1 className="font-semibold text-sm leading-tight">KIN Workforce</h1>
            <p className="text-xs text-kin-muted">Local-first OS</p>
          </div>
        </div>
      </div>

      {/* Autonomy Mode Selector */}
      <div className="p-3 border-b border-kin-border bg-kin-card/50">
        <label className="text-[11px] uppercase tracking-wider font-semibold text-kin-muted block mb-1.5 flex items-center justify-between">
          <span>Autonomy Policy</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">
            {autonomyMode}
          </span>
        </label>
        <select
          value={autonomyMode}
          onChange={(e) => setAutonomyMode(e.target.value as any)}
          aria-label="Autonomy Policy"
          className="w-full bg-kin-bg border border-kin-border rounded-md px-2.5 py-1.5 text-xs text-kin-text focus:outline-none focus:border-blue-500"
        >
          <option value="AUTO">AUTO (Safe Auto-Approve)</option>
          <option value="ALWAYS_ASK">ALWAYS_ASK (Interactive Gate)</option>
          <option value="FULL_ACCESS">FULL_ACCESS (Prompt Bypass)</option>
        </select>
      </div>

      {/* Channels List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-kin-muted px-2 py-1">
          Channels
        </div>
        {channels.map((chan) => {
          const isActive = chan.id === activeChannelId;
          const isApprovals = chan.id === 'chan-approvals';
          const hasPending = isApprovals && pendingApprovals.length > 0;

          return (
            <button
              key={chan.id}
              onClick={() => setActiveChannel(chan.id)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 font-medium'
                  : 'text-kin-muted hover:text-kin-text hover:bg-kin-card'
              }`}
            >
              <div className="flex items-center space-x-2">
                {isApprovals ? (
                  <ShieldAlert className={`w-3.5 h-3.5 ${hasPending ? 'text-amber-400 animate-pulse' : ''}`} />
                ) : (
                  <Hash className="w-3.5 h-3.5" />
                )}
                <span>{chan.name}</span>
              </div>
              {hasPending && (
                <span className="bg-amber-500 text-black text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                  {pendingApprovals.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* System Status Footer */}
      <div className="p-3 border-t border-kin-border bg-kin-card/30 flex items-center justify-between text-xs text-kin-muted">
        <div className="flex items-center space-x-1.5">
          <CheckCircle2 className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`} />
          <span>{isConnected ? 'Core Monolith Online' : 'Connecting to Core...'}</span>
        </div>
        <Cpu className={`w-3.5 h-3.5 ${isConnected ? 'text-blue-400' : 'text-kin-muted'}`} />
      </div>
    </aside>
  );
};
