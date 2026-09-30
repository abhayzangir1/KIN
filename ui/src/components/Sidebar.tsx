import React from 'react';
import { useKinStore } from '../store/kinStore.js';
import { Folder, Hash, Plus, Settings } from 'lucide-react';

export const Sidebar: React.FC = () => {
  const {
    activeProject,
    channels,
    activeChannelId,
    setActiveChannel,
    agents,
    selectedAgentId,
    setSelectedAgentId,
  } = useKinStore();

  const boss = agents.find((a) => a.isOrchestrator) || agents[0];

  return (
    <aside className="w-56 bg-[#090d16] border-r border-[#1e293b] flex flex-col h-full text-xs select-none">
      {/* Project Folder Header */}
      <div className="p-3 border-b border-[#1e293b] flex items-center justify-between text-kin-text font-semibold">
        <div className="flex items-center space-x-2 truncate">
          <Folder className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{activeProject?.name || 'KIN'}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* DEPARTMENTS SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <span>Departments</span>
            <button className="hover:text-kin-text transition">
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <button className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded bg-[#102a24]/50 border border-emerald-500/20 text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>general</span>
          </button>
        </div>

        {/* CHANNELS SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <span>Channels</span>
            <button className="hover:text-kin-text transition">
              <Plus className="w-3 h-3" />
            </button>
          </div>
          {channels.map((chan) => {
            const isActive = chan.id === activeChannelId;
            return (
              <button
                key={chan.id}
                onClick={() => setActiveChannel(chan.id)}
                className={`w-full flex items-center space-x-2 px-2.5 py-1.5 rounded transition ${
                  isActive
                    ? 'bg-emerald-600/20 text-emerald-400 font-medium border border-emerald-500/30'
                    : 'text-[#94a3b8] hover:bg-[#131b2e] hover:text-kin-text'
                }`}
              >
                <Hash className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{chan.name}</span>
              </button>
            );
          })}
        </div>

        {/* DEPARTMENT MEMBERS SECTION */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <span>Department Members</span>
            <span className="text-[10px] bg-[#1e293b] px-1.5 rounded text-kin-muted">{agents.length}</span>
          </div>

          {boss && (
            <button
              onClick={() => setSelectedAgentId(boss.id)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition ${
                selectedAgentId === boss.id
                  ? 'bg-blue-600/20 border border-blue-500/30 text-blue-300'
                  : 'text-[#cbd5e1] hover:bg-[#131b2e]'
              }`}
            >
              <div className="flex items-center space-x-1.5 truncate">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="font-medium truncate">{boss.displayName}</span>
              </div>
              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                Orchestrator
              </span>
            </button>
          )}
        </div>

        {/* ORGANIZATION POOL SECTION */}
        <div className="space-y-1 pt-2 border-t border-[#1e293b]/60">
          <div className="flex items-center justify-between px-2 text-[10px] uppercase font-bold tracking-wider text-[#64748b]">
            <span>Organization Pool</span>
            <button className="hover:text-kin-text transition">
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <p className="px-2 text-[10px] text-[#64748b] leading-relaxed italic">
            All organization specialists are enrolled in this department.
          </p>
        </div>
      </div>

      {/* Bottom Settings Link */}
      <div className="p-2 border-t border-[#1e293b] bg-[#070b12]">
        <button className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded text-[#94a3b8] hover:text-kin-text hover:bg-[#131b2e] transition">
          <Settings className="w-3.5 h-3.5" />
          <span className="font-medium">Settings</span>
        </button>
      </div>
    </aside>
  );
};
