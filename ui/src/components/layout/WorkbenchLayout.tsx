import React, { useState, useEffect } from 'react';
import { useKinStore } from '../../store/kinStore.js';
import { Sidebar } from '../Sidebar.js';
import { CenterView } from '../CenterView.js';
import { AgentInspector } from '../AgentInspector.js';
import { ErrorBoundary } from '../ErrorBoundary.js';

interface WorkbenchLayoutProps {
  isCompact?: boolean;
}

export const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({ isCompact = false }) => {
  const {
    setSidebarWidth,
    setInspectorWidth,
    isInspectorOpen,
    activeProjectId,
  } = useKinStore();

  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  // Restore and persist widths in localStorage
  useEffect(() => {
    try {
      const savedSidebar = localStorage.getItem(`kin_sidebar_width_${activeProjectId || 'default'}`);
      if (savedSidebar) {
        const val = parseInt(savedSidebar, 10);
        if (!isNaN(val) && val >= 180 && val <= 500) {
          setSidebarWidth(val);
        }
      }
      const savedInspector = localStorage.getItem(`kin_inspector_width_${activeProjectId || 'default'}`);
      if (savedInspector) {
        const val = parseInt(savedInspector, 10);
        if (!isNaN(val) && val >= 250 && val <= 650) {
          setInspectorWidth(val);
        }
      }
    } catch {
      // Ignored
    }
  }, [activeProjectId, setSidebarWidth, setInspectorWidth]);

  // Window mousemove / mouseup drag listeners
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft) {
        const newWidth = Math.max(180, Math.min(500, e.clientX));
        setSidebarWidth(newWidth);
        try {
          localStorage.setItem(`kin_sidebar_width_${activeProjectId || 'default'}`, String(newWidth));
        } catch {}
      }
      if (isDraggingRight) {
        const newWidth = Math.max(250, Math.min(650, window.innerWidth - e.clientX));
        setInspectorWidth(newWidth);
        try {
          localStorage.setItem(`kin_inspector_width_${activeProjectId || 'default'}`, String(newWidth));
        } catch {}
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
    };

    if (isDraggingLeft || isDraggingRight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingLeft, isDraggingRight, activeProjectId, setSidebarWidth, setInspectorWidth]);

  return (
    <div className="flex flex-1 overflow-hidden min-h-0 relative select-none">
      {/* Pane 1 & 2: Navigation, Channels & Specialist Coworkers */}
      <ErrorBoundary name="Sidebar Channels & Coworkers">
        <Sidebar />
      </ErrorBoundary>

      {/* Left Resizable Divider Handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingLeft(true);
        }}
        onDoubleClick={() => {
          setSidebarWidth(260);
          try {
            localStorage.setItem(`kin_sidebar_width_${activeProjectId || 'default'}`, '260');
          } catch {}
        }}
        className={`relative w-1 hover:w-1.5 cursor-col-resize z-20 shrink-0 transition-all duration-150 select-none group flex items-center justify-center ${
          isDraggingLeft
            ? 'bg-emerald-400 w-1.5 shadow-[0_0_8px_#34d399]'
            : 'bg-kin-border hover:bg-emerald-500/80'
        }`}
        title="Drag to resize sidebar (Double-click to reset)"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5 w-4 cursor-col-resize" />
      </div>

      {/* Pane 3: Central Execution Canvas & Timeline */}
      <ErrorBoundary name="Central Execution Workspace">
        <CenterView />
      </ErrorBoundary>

      {/* Pane 4: Right Inspector & Telemetry */}
      {isInspectorOpen && !isCompact && (
        <>
          {/* Right Resizable Divider Handle */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsDraggingRight(true);
            }}
            onDoubleClick={() => {
              setInspectorWidth(390);
              try {
                localStorage.setItem(`kin_inspector_width_${activeProjectId || 'default'}`, '390');
              } catch {}
            }}
            className={`relative w-1 hover:w-1.5 cursor-col-resize z-20 shrink-0 transition-all duration-150 select-none group flex items-center justify-center ${
              isDraggingRight
                ? 'bg-blue-400 w-1.5 shadow-[0_0_8px_#60a5fa]'
                : 'bg-kin-border hover:bg-blue-500/80'
            }`}
            title="Drag to resize inspector (Double-click to reset)"
          >
            <div className="absolute inset-y-0 -left-1.5 -right-1.5 w-4 cursor-col-resize" />
          </div>

          <ErrorBoundary name="Agent Inspector & Diagnostics">
            <AgentInspector />
          </ErrorBoundary>
        </>
      )}
    </div>
  );
};
