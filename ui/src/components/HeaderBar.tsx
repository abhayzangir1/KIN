import React from 'react';
import { useKinStore } from '../store/kinStore.js';
import { Folder, Plus, X, Settings, Play } from 'lucide-react';

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
  } = useKinStore();

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
      </div>

      {/* Right: Path, Ollama Status, DB Status, Settings */}
      <div className="flex items-center space-x-4 text-[11px] text-kin-muted font-mono">
        {/* Working Directory */}
        <div className="flex items-center space-x-1 text-[#8b949e] max-w-xs truncate" title={activeProject?.repoPath}>
          <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="truncate">{activeProject?.repoPath || 'D:\\KIN'}</span>
        </div>

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

        {/* DB Status */}
        <div className="flex items-center space-x-1 text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>DB: {isConnected ? 'Connected' : 'Reconnecting...'}</span>
        </div>

        {/* Settings Button */}
        <button
          className="flex items-center space-x-1 text-kin-muted hover:text-kin-text font-sans transition"
          title="System Settings"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </button>
      </div>
    </header>
  );
};
