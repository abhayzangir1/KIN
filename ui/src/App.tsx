import React, { useEffect, useState } from 'react';
import { HeaderBar } from './components/HeaderBar.js';
import { Sidebar } from './components/Sidebar.js';
import { CenterView } from './components/CenterView.js';
import { AgentInspector } from './components/AgentInspector.js';
import { NewProjectModal } from './components/NewProjectModal.js';
import { CreateChannelModal } from './components/CreateChannelModal.js';
import { AddAgentModal } from './components/AddAgentModal.js';
import { SwarmMap } from './components/SwarmMap.js';
import { SkillsModal } from './components/SkillsModal.js';
import { DesktopControlModal } from './components/DesktopControlModal.js';
import { CreateGoalModal } from './components/CreateGoalModal.js';
import { CreateTaskModal } from './components/CreateTaskModal.js';
import { DecisionsModal } from './components/DecisionsModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { AutomationsModal } from './components/AutomationsModal.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useKinStore } from './store/kinStore.js';

export const App: React.FC = () => {
  const {
    fetchState,
    initSSE,
    setSidebarWidth,
    setInspectorWidth,
  } = useKinStore();

  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  useEffect(() => {
    (window as any).kinStore = useKinStore;
    fetchState();
    initSSE();
  }, [fetchState, initSSE]);

  // Global mouse move and up listeners for fluid Antigravity-style dragging
  useEffect(() => {
    if (!isDraggingLeft && !isDraggingRight) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      if (isDraggingLeft) {
        // Left sidebar width is distance from left edge
        const newWidth = Math.max(180, Math.min(480, Math.round(e.clientX)));
        setSidebarWidth(newWidth);
      } else if (isDraggingRight) {
        // Right inspector width is distance from right edge
        const newWidth = Math.max(280, Math.min(720, Math.round(window.innerWidth - e.clientX)));
        setInspectorWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingLeft, isDraggingRight, setSidebarWidth, setInspectorWidth]);

  return (
    <ErrorBoundary name="KIN OS Root Workspace">
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0f1d] text-kin-text font-sans antialiased select-none">
        {/* Top Application Header Bar */}
        <HeaderBar />

        {/* Main 3-Column Draggable & Resizable Workspace Layout */}
        <div className="flex flex-1 overflow-hidden min-h-0 relative">
          {/* Column 1: Left Sidebar (Channels, Specialisms, Goals, Tasks, ADRs, Settings) */}
          <ErrorBoundary name="Sidebar Channels & Direct Messages">
            <Sidebar />
          </ErrorBoundary>

          {/* Left Draggable Splitter Handle */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsDraggingLeft(true);
            }}
            onDoubleClick={() => setSidebarWidth(260)}
            className={`relative w-1 hover:w-1.5 cursor-col-resize z-20 shrink-0 transition-all duration-150 select-none group flex items-center justify-center ${
              isDraggingLeft
                ? 'bg-emerald-400 w-1.5 shadow-[0_0_8px_#34d399]'
                : 'bg-[#1e293b]/70 hover:bg-emerald-500/80'
            }`}
            title="Drag to resize sidebar (Double-click to reset)"
          >
            {/* Expanded invisible touch hit area */}
            <div
              onDoubleClick={(e) => {
                e.stopPropagation();
                setSidebarWidth(260);
              }}
              className="absolute inset-y-0 -left-1.5 -right-1.5 w-4 cursor-col-resize"
            />
          </div>

          {/* Column 2: Center Execution Workspace & Chat */}
          <ErrorBoundary name="Center Chat & Execution Workspace">
            <CenterView />
          </ErrorBoundary>

          {/* Right Draggable Splitter Handle */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsDraggingRight(true);
            }}
            onDoubleClick={() => setInspectorWidth(390)}
            className={`relative w-1 hover:w-1.5 cursor-col-resize z-20 shrink-0 transition-all duration-150 select-none group flex items-center justify-center ${
              isDraggingRight
                ? 'bg-blue-400 w-1.5 shadow-[0_0_8px_#60a5fa]'
                : 'bg-[#1e293b]/70 hover:bg-blue-500/80'
            }`}
            title="Drag to resize inspector (Double-click to reset)"
          >
            {/* Expanded invisible touch hit area */}
            <div
              onDoubleClick={(e) => {
                e.stopPropagation();
                setInspectorWidth(390);
              }}
              className="absolute inset-y-0 -left-1.5 -right-1.5 w-4 cursor-col-resize"
            />
          </div>

          {/* Column 3: Right Inspector & Diagnostics */}
          <ErrorBoundary name="Agent Inspector & Diagnostics">
            <AgentInspector />
          </ErrorBoundary>
        </div>

        {/* Modals & Overlays */}
        <ErrorBoundary name="Modal System">
          <NewProjectModal />
          <CreateChannelModal />
          <AddAgentModal />
          <SwarmMap />
          <SkillsModal />
          <DesktopControlModal />
          <CreateGoalModal />
          <CreateTaskModal />
          <DecisionsModal />
          <SettingsModal />
          <AutomationsModal />
        </ErrorBoundary>
      </div>
    </ErrorBoundary>
  );
};

export default App;
