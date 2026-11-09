import React, { useState, useEffect } from 'react';
import { useKinStore, isDesktopApp } from '../../store/kinStore.js';
import { Minus, Square, X, Plus } from 'lucide-react';

export const TitleBar: React.FC = () => {
  const {
    projects,
    activeProjectId,
    activeProject,
    setActiveProject,
    setNewProjectModalOpen,
    isConnected,
    channels,
    activeChannelId,
  } = useKinStore();

  const [isMaximized, setIsMaximized] = useState(false);
  const isDesktop = isDesktopApp();

  const invokeTauri = async (cmd: string, args?: Record<string, any>) => {
    if (typeof window === 'undefined') return;
    try {
      const tauri = (window as any).__TAURI__;
      const tauriInternals = (window as any).__TAURI_INTERNALS__;
      const invoke =
        tauri?.core?.invoke ||
        tauri?.tauri?.invoke ||
        tauri?.invoke ||
        tauriInternals?.invoke;
      if (typeof invoke === 'function') {
        return await invoke(cmd, args);
      }
    } catch (err) {
      console.warn(`[TitleBar] Failed to invoke '${cmd}':`, err);
    }
  };

  useEffect(() => {
    if (!isDesktop) return;
    let mounted = true;
    const checkMaximized = async () => {
      try {
        const max = await invokeTauri('is_window_maximized');
        if (mounted && typeof max === 'boolean') {
          setIsMaximized(max);
        }
      } catch {
        // Ignored in non-Tauri or unsupported modes
      }
    };
    checkMaximized();
    const interval = setInterval(checkMaximized, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isDesktop]);

  const handleMinimize = async () => {
    await invokeTauri('minimize_window');
  };

  const handleToggleMaximize = async () => {
    await invokeTauri('toggle_maximize_window');
    setIsMaximized((prev) => !prev);
  };

  const handleClose = async () => {
    await invokeTauri('close_window');
  };

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  return (
    <div
      data-tauri-drag-region
      className="h-9 bg-kin-surface border-b border-kin-border px-3 flex items-center justify-between text-xs select-none transition-colors shrink-0 z-50"
    >
      {/* Left: Brand & Project Selector */}
      <div className="flex items-center space-x-3 pointer-events-auto" data-tauri-drag-region="false">
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
            className="bg-kin-card border border-kin-border rounded px-2 py-0.5 text-xs text-kin-text font-medium focus:outline-none focus:border-kin-primary cursor-pointer hover:bg-kin-cardHover transition"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setNewProjectModalOpen(true)}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-kin-card hover:bg-kin-cardHover text-kin-text border border-kin-border font-medium text-xs transition"
            title="Create New Project Workspace"
          >
            <Plus className="w-3 h-3 text-emerald-400" />
            <span>New</span>
          </button>
        </div>

        {activeChannel && (
          <span className="text-kin-muted/70 text-[11px] hidden sm:inline-flex items-center space-x-1">
            <span>•</span>
            <span className="font-mono text-kin-primary">{activeChannel.name}</span>
          </span>
        )}
      </div>

      {/* Middle: Draggable center zone with window title */}
      <div
        data-tauri-drag-region
        className="flex-1 h-full flex items-center justify-center text-[11px] text-kin-muted/60 font-mono truncate px-4 pointer-events-auto cursor-default"
      >
        {activeProject?.name ? `${activeProject.name} — KIN` : 'KIN — Local-First AI Workspace'}
      </div>

      {/* Right: Window Controls (Tauri Desktop Shell) or Web Indicator */}
      <div className="flex items-center space-x-1 pointer-events-auto" data-tauri-drag-region="false">
        {isDesktop ? (
          <div className="flex items-center -mr-1">
            <button
              onClick={handleMinimize}
              className="w-8 h-7 inline-flex items-center justify-center text-kin-muted hover:text-kin-text hover:bg-kin-card rounded transition"
              title="Minimize"
              aria-label="Minimize Window"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleToggleMaximize}
              className="w-8 h-7 inline-flex items-center justify-center text-kin-muted hover:text-kin-text hover:bg-kin-card rounded transition"
              title={isMaximized ? 'Restore' : 'Maximize'}
              aria-label={isMaximized ? 'Restore Window' : 'Maximize Window'}
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={handleClose}
              className="w-8 h-7 inline-flex items-center justify-center text-kin-muted hover:text-white hover:bg-red-600 rounded transition"
              title="Close to Tray"
              aria-label="Close Window"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="text-[10px] text-kin-muted/60 font-mono px-2 py-0.5 rounded bg-kin-card/50">
            Web
          </div>
        )}
      </div>
    </div>
  );
};
