import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { Folder, Plus, X, Play, Copy, Check, Shield, Activity, Network, Sparkles, Monitor } from 'lucide-react';

export const HeaderBar: React.FC = () => {
  const {
    projects,
    activeProjectId,
    activeProject,
    setActiveProject,
    deleteProject,
    setNewProjectModalOpen,
    ollamaStatus,
    startOllama,
    isConnected,
    autonomyMode,
    setAutonomyMode,
    projectAnalytics,
    setSwarmMapOpen,
    setSkillsModalOpen,
    setDesktopControlModalOpen,
    browserStatus,
    activeTakeover,
    activeTakeovers,
    agents,
  } = useKinStore();

  const isMachineTool = (tool?: string) => {
    if (!tool) return false;
    return (
      ['computer', 'application', 'browser'].includes(tool) ||
      tool.startsWith('desktop') ||
      tool.startsWith('browser')
    );
  };

  const isMachineControlActive =
    !!browserStatus?.active ||
    isMachineTool(activeTakeover?.activeTool) ||
    isMachineTool(activeTakeover?.previewPayload?.toolName) ||
    Object.values(activeTakeovers || {}).some(
      (t) => isMachineTool(t.activeTool) || isMachineTool(t.previewPayload?.toolName)
    );

  const activeMachineAgent =
    (activeTakeover?.agentId && agents.find((a) => a.id === activeTakeover.agentId)?.displayName) ||
    Object.values(activeTakeovers || {})
      .filter((t) => isMachineTool(t.activeTool) || isMachineTool(t.previewPayload?.toolName))
      .map((t) => agents.find((a) => a.id === t.agentId)?.displayName)
      .filter(Boolean)[0] ||
    (browserStatus?.active ? '@Agent' : null);

  const [copied, setCopied] = useState(false);

  const handleCopyPath = () => {
    const path = activeProject?.repoPath || 'D:\\KIN';
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="h-10 bg-[#0d1117] border-b border-[#21262d] px-4 flex items-center justify-between text-xs select-none">
      {/* Left: Brand & Project Switcher */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1.5 font-bold tracking-wide text-kin-text">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <span>KIN OS</span>
        </div>

        <span className="text-[#30363d]">|</span>

        {/* Project Selector */}
        <div className="flex items-center space-x-1.5">
          <span className="text-kin-muted">Project:</span>
          <select
            value={activeProjectId}
            onChange={(e) => setActiveProject(e.target.value)}
            className="bg-[#161b22] border border-[#30363d] rounded px-2 py-0.5 text-xs text-kin-text font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setNewProjectModalOpen(true)}
            className="flex items-center space-x-0.5 px-1.5 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-kin-text font-medium transition"
            title="Create New Project Workspace"
          >
            <Plus className="w-3 h-3 text-emerald-400" />
            <span>New</span>
          </button>

          {projects.length > 1 && activeProjectId !== 'proj-kin' && (
            <button
              onClick={() => {
                if (window.confirm(`Delete project "${activeProject?.name}"?`)) {
                  deleteProject(activeProjectId);
                }
              }}
              className="p-1 rounded hover:bg-red-900/40 text-red-400 transition"
              title="Delete Active Project"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Directory Breadcrumb with Copy Button */}
        <div className="flex items-center space-x-1 bg-[#161b22] border border-[#30363d] rounded px-2 py-0.5 text-[#8b949e] font-mono text-[11px] max-w-xs">
          <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="truncate">{activeProject?.repoPath || 'D:\\KIN'}</span>
          <button
            onClick={handleCopyPath}
            className="hover:text-kin-text transition ml-1 shrink-0 text-[#8b949e] hover:text-emerald-400"
            title="Copy Directory Path"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Right: Path, Ollama Status, DB Status, Autonomy Mode, Settings */}
      <div className="flex items-center space-x-3 text-[11px] font-mono">
        {/* Ollama Status */}
        <div className="flex items-center space-x-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              ollamaStatus.online ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-red-400'
            }`}
          />
          <span className={ollamaStatus.online ? 'text-emerald-400' : 'text-red-400'}>
            Ollama: {ollamaStatus.online ? `Online (${ollamaStatus.models.length} models)` : 'Offline'}
          </span>
          {!ollamaStatus.online && (
            <button
              onClick={startOllama}
              className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 text-[10px] font-sans transition"
            >
              <Play className="w-2.5 h-2.5" />
              <span>Start</span>
            </button>
          )}
        </div>

        {/* Real DB Status with Live Database Size */}
        <div className="flex items-center space-x-1 text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_4px_#34d399]" />
          <span>
            DB:{' '}
            {isConnected
              ? projectAnalytics?.databaseSizeBytes
                ? `WAL (${(projectAnalytics.databaseSizeBytes / 1024).toFixed(0)} KB)`
                : 'WAL Connected'
              : 'Reconnecting...'}
          </span>
        </div>

        {/* Live Project Telemetry Pill */}
        {projectAnalytics && (
          <div
            className="hidden lg:flex items-center space-x-1.5 px-2 py-0.5 rounded bg-[#161b22] border border-[#30363d] text-[#8b949e]"
            title={`Live Project Analytics: ${projectAnalytics.totalMessages} total messages (${projectAnalytics.humanMessages} human, ${projectAnalytics.agentMessages} agent), ${projectAnalytics.completedTasks}/${projectAnalytics.totalTasks} tasks completed`}
          >
            <Activity className="w-3 h-3 text-blue-400 shrink-0" />
            <span>Tasks: {projectAnalytics.completedTasks}/{projectAnalytics.totalTasks}</span>
            <span className="text-[10px] text-blue-400 font-bold">({projectAnalytics.taskCompletionRate}%)</span>
          </div>
        )}

        {/* Autonomy Mode Selector (Persisted to SQLite) */}
        <div className="flex items-center space-x-1 bg-[#161b22] border border-[#30363d] rounded px-2 py-0.5">
          <Shield className="w-3 h-3 text-amber-400 shrink-0" />
          <select
            value={autonomyMode}
            onChange={(e) => setAutonomyMode(e.target.value as any)}
            className="bg-transparent text-kin-text text-[11px] font-medium focus:outline-none cursor-pointer"
            title="Autonomy Mode"
          >
            <option value="AUTO" className="bg-[#161b22] text-emerald-400">AUTO</option>
            <option value="ALWAYS_ASK" className="bg-[#161b22] text-amber-400">ALWAYS_ASK</option>
            <option value="FULL_ACCESS" className="bg-[#161b22] text-blue-400">FULL_ACCESS</option>
          </select>
        </div>

        {/* Swarm Map Trigger Button */}
        <button
          onClick={() => setSwarmMapOpen(true)}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-sans font-semibold transition shadow-sm"
          title="Open Autonomous Workforce Swarm Map"
        >
          <Network className="w-3.5 h-3.5 text-emerald-400" />
          <span>Swarm Map</span>
        </button>

        {/* Skills Registry Button */}
        <button
          onClick={() => setSkillsModalOpen(true)}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 text-[11px] font-sans font-semibold transition shadow-sm"
          title="Open Procedural Skills Engine & Bundles"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>Skills</span>
        </button>

        {/* Live Machine Control Glowing Indicator */}
        {isMachineControlActive && (
          <div
            className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-red-950/80 border border-red-500/80 text-red-200 text-[11px] font-sans font-bold shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse"
            title="An autonomous agent is driving desktop or browser actions on this machine"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444] animate-ping shrink-0" />
            <span>🔴 {activeMachineAgent || '@Agent'} Controlling Local Machine</span>
            <button
              onClick={() => setDesktopControlModalOpen(true)}
              className="ml-1 px-1.5 py-0.5 rounded bg-red-800/80 hover:bg-red-700 text-white text-[10px] font-mono transition cursor-pointer"
            >
              [Inspect]
            </button>
          </div>
        )}

        {/* Desktop & Web Control Center Button */}
        <button
          onClick={() => setDesktopControlModalOpen(true)}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-[11px] font-sans font-semibold transition shadow-sm"
          title="Open Desktop GUI, Windows, Browser & Routines"
        >
          <Monitor className="w-3.5 h-3.5 text-blue-400" />
          <span>Desktop & Web</span>
        </button>
      </div>
    </header>
  );
};
