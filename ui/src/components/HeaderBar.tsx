import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { Folder, Plus, X, Copy, Check, Activity, Network, PanelRight, PanelRightClose, Server } from 'lucide-react';
import { ConfirmDialog, requestConfirmation } from './ConfirmDialog.js';

export const HeaderBar: React.FC = () => {
  const {
    projects,
    activeProjectId,
    activeProject,
    setActiveProject,
    deleteProject,
    setNewProjectModalOpen,
    setSwarmMapOpen,
    isConnected,
    projectAnalytics,
    setDesktopControlModalOpen,
    openSettingsModal,
    mcpConnectors,
    browserStatus,
    activeTakeover,
    activeTakeovers,
    agents,
    isInspectorOpen,
    toggleInspector,
    addToast,
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
    const path = activeProject?.repoPath || '';
    if (!path) return;
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="h-11 bg-kin-surface border-b border-kin-border px-3.5 flex items-center justify-between text-xs select-none transition-colors shrink-0">
      {/* Left: Brand & Project Switcher */}
      <div className="flex items-center space-x-2.5">
        <div className="flex items-center space-x-1.5 font-bold tracking-wide text-kin-text">
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`}
            title={isConnected ? 'KIN Core Connected (WAL Mode)' : 'KIN Core Offline / Connecting...'}
          />
          <span className="text-sm font-semibold tracking-wider text-kin-text">KIN</span>
        </div>

        <span className="text-kin-muted/40">|</span>

        {/* Project Selector */}
        <div className="flex items-center space-x-1.5">
          <span className="text-kin-muted text-[11px]">Project:</span>
          <select
            value={activeProjectId}
            onChange={(e) => setActiveProject(e.target.value)}
            className="bg-kin-card border border-kin-border rounded-md px-2 py-0.5 text-xs text-kin-text font-medium focus:outline-none focus:border-kin-primary cursor-pointer hover:bg-kin-cardHover transition"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setNewProjectModalOpen(true)}
            className="flex items-center space-x-1 px-2 py-0.5 rounded-md bg-kin-card hover:bg-kin-cardHover text-kin-text border border-kin-border font-medium text-xs transition"
            title="Create New Project Workspace"
          >
            <Plus className="w-3 h-3 text-emerald-400" />
            <span>New</span>
          </button>

          {projects.length > 1 && activeProjectId !== 'proj-kin' && (
            <button
              onClick={async () => {
                const confirmed = await requestConfirmation({
                  title: 'Delete Project Workspace',
                  message: `Delete project "${activeProject?.name || activeProjectId}"? All project files and channels will be detached.`,
                  confirmLabel: 'Delete Project',
                  variant: 'danger',
                });
                if (confirmed) {
                  const res = await deleteProject(activeProjectId);
                  if (res && !res.success) {
                    addToast(res.error || 'Failed to delete project', 'error');
                  } else {
                    addToast(`Project "${activeProject?.name || ''}" deleted.`, 'info');
                  }
                }
              }}
              className="p-1 rounded hover:bg-red-900/30 text-kin-muted hover:text-red-400 transition"
              title="Delete Active Project"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Directory Breadcrumb with Copy Button */}
        <div className="hidden md:flex items-center space-x-1 bg-kin-card border border-kin-border rounded-md px-2 py-0.5 text-kin-muted font-mono text-[11px] max-w-[220px] lg:max-w-xs">
          <Folder className="w-3.5 h-3.5 text-kin-primary shrink-0" />
          <span className="truncate">{activeProject?.repoPath || 'No repository selected'}</span>
          <button
            onClick={handleCopyPath}
            className="hover:text-kin-text transition ml-1 shrink-0 text-kin-muted hover:text-emerald-400 cursor-pointer"
            title="Copy Directory Path"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>

        {/* Swarm Map Top Navigation Button */}
        <button
          onClick={() => setSwarmMapOpen(true)}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 text-xs font-sans font-medium transition cursor-pointer"
          title="Open Swarm Map Hierarchy & Workforce Topology"
        >
          <Network className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span>Swarm Map</span>
        </button>
      </div>

      {/* Right: Consolidated System Status & Canonical Inspector Toggle */}
      <div className="flex items-center space-x-2 text-[11px] font-mono">
        {/* Consolidated System Health Capsule (SQLite WAL & Progress) */}
        <div className="flex items-center space-x-2 px-2.5 py-0.5 rounded-md bg-kin-card border border-kin-border text-kin-muted">
          {/* Real DB Status */}
          <div
            className={`flex items-center space-x-1 ${isConnected ? 'text-emerald-400' : 'text-amber-400'}`}
            title={isConnected ? 'SQLite 3 WAL Engine Active' : 'Connecting to Core Daemon...'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            <span>DB: {isConnected ? 'WAL' : 'Connecting...'}</span>
          </div>

          {/* Project Tasks Progress */}
          {projectAnalytics && (
            <>
              <span className="text-kin-muted/30">|</span>
              <div
                className="hidden xl:flex items-center space-x-1 text-kin-muted"
                title={`Tasks: ${projectAnalytics.completedTasks}/${projectAnalytics.totalTasks} completed (${projectAnalytics.taskCompletionRate}%)`}
              >
                <Activity className="w-3 h-3 text-kin-primary shrink-0" />
                <span>{projectAnalytics.completedTasks}/{projectAnalytics.totalTasks}</span>
              </div>
            </>
          )}
        </div>

        {/* MCP Connectors Capsule */}
        <button
          onClick={() => openSettingsModal('connectors')}
          className="hidden sm:flex items-center space-x-1 px-2.5 py-0.5 rounded-md bg-kin-card hover:bg-kin-cardHover border border-kin-border text-kin-muted hover:text-kin-text transition cursor-pointer"
          title="Open Model Context Protocol (MCP) Connectors Hub in Settings"
        >
          <Server className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-[10px]">MCP: {mcpConnectors.filter((c) => !c.disabled).length}</span>
        </button>

        {/* Canonical Inspector Panel Toggle Button */}
        <button
          onClick={toggleInspector}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md border text-xs font-sans font-medium transition cursor-pointer ${
            isInspectorOpen
              ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
              : 'bg-kin-card border-kin-border text-kin-muted hover:text-kin-text hover:bg-kin-cardHover'
          }`}
          title={isInspectorOpen ? 'Collapse Inspector (Gain Full Workspace Width)' : 'Expand Inspector & Diagnostics'}
        >
          {isInspectorOpen ? (
            <PanelRightClose className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          ) : (
            <PanelRight className="w-3.5 h-3.5 text-kin-muted shrink-0" />
          )}
          <span>Inspector</span>
        </button>

        {/* Machine Control Indicator */}
        {isMachineControlActive && (
          <div
            className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/70 border border-red-300 dark:border-red-500/50 text-red-800 dark:text-red-200 text-[11px] font-sans font-semibold animate-pulse"
            title="An autonomous agent is driving desktop or browser actions"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping shrink-0" />
            <span>{activeMachineAgent || '@Agent'} Controlling Machine</span>
            <button
              onClick={() => setDesktopControlModalOpen(true)}
              className="ml-1 px-1.5 py-0.2 rounded bg-red-200 hover:bg-red-300 dark:bg-red-800/80 dark:hover:bg-red-700 text-red-900 dark:text-white text-[10px] font-mono transition cursor-pointer"
            >
              Inspect
            </button>
          </div>
        )}
      </div>
      <ConfirmDialog />
    </header>
  );
};
