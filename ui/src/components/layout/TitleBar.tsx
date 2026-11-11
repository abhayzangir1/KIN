import React, { useState, useEffect } from 'react';
import { useKinStore, isDesktopApp } from '../../store/kinStore.js';
import { Minus, Square, X } from 'lucide-react';

export const TitleBar: React.FC = () => {
  const { activeProject } = useKinStore();

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

  return (
    <div
      data-tauri-drag-region
      className="h-8 bg-kin-surface border-b border-kin-border px-3 flex items-center justify-between text-xs select-none transition-colors shrink-0 z-50"
    >
      {/* Left: Clean Desktop Window Branding */}
      <div className="flex items-center space-x-2 select-none" data-tauri-drag-region>
        <span className="text-xs font-semibold tracking-wider text-kin-muted">KIN</span>
        {activeProject?.name && (
          <span className="text-[11px] text-kin-muted/60 font-mono hidden md:inline truncate max-w-xs">
            / {activeProject.name}
          </span>
        )}
      </div>

      {/* Middle: Draggable center zone with window title */}
      <div
        data-tauri-drag-region
        className="flex-1 h-full flex items-center justify-center text-[11px] text-kin-muted/60 font-mono truncate px-4 cursor-default"
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
