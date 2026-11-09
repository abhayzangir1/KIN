import React, { useEffect, useState, Suspense } from 'react';
import { TitleBar } from './components/layout/TitleBar.js';
import { WorkbenchLayout } from './components/layout/WorkbenchLayout.js';
import { HeaderBar } from './components/HeaderBar.js';
import { AgentInspector } from './components/AgentInspector.js';
import { NewProjectModal } from './components/NewProjectModal.js';
import { CreateChannelModal } from './components/CreateChannelModal.js';
import { AddAgentModal } from './components/AddAgentModal.js';
import { CreateGoalModal } from './components/CreateGoalModal.js';
import { CreateTaskModal } from './components/CreateTaskModal.js';
import { ModelSelectorModal } from './components/ModelSelectorModal.js';
import { AddProviderModal } from './components/AddProviderModal.js';
import { ModelUnavailablePromptModal } from './components/ModelUnavailablePromptModal.js';
import { ToastContainer } from './components/ToastContainer.js';
import { ModelOnboardingBanner } from './components/ModelOnboardingBanner.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useKinStore } from './store/kinStore.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';

// Lazy-loaded heavy modals to eliminate background hook overhead and optimize initial bundle
const SettingsModal = React.lazy(() => import('./components/SettingsModal.js').then(m => ({ default: m.SettingsModal })));
const SwarmMap = React.lazy(() => import('./components/SwarmMap.js').then(m => ({ default: m.SwarmMap })));
const SkillsModal = React.lazy(() => import('./components/SkillsModal.js').then(m => ({ default: m.SkillsModal })));
const ConnectorsModal = React.lazy(() => import('./components/ConnectorsModal.js').then(m => ({ default: m.ConnectorsModal })));
const AutomationsModal = React.lazy(() => import('./components/AutomationsModal.js').then(m => ({ default: m.AutomationsModal })));
const DesktopControlModal = React.lazy(() => import('./components/DesktopControlModal.js').then(m => ({ default: m.DesktopControlModal })));
const DecisionsModal = React.lazy(() => import('./components/DecisionsModal.js').then(m => ({ default: m.DecisionsModal })));
const AgentSettingsModal = React.lazy(() => import('./components/AgentSettingsModal.js').then(m => ({ default: m.AgentSettingsModal })));

export const App: React.FC = () => {
  useKeyboardShortcuts();

  const {
    fetchState,
    initSSE,
    closeSSE,
    isInspectorOpen,
    setInspectorOpen,
    theme,
    isConnected,
    isSettingsModalOpen,
    isSwarmMapOpen,
    isSkillsModalOpen,
    isConnectorsModalOpen,
    isAutomationsModalOpen,
    isDesktopControlModalOpen,
    isDecisionsModalOpen,
    isAgentSettingsModalOpen,
    addToast,
  } = useKinStore();

  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCompact = windowWidth < 1100;

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
  }, [theme]);

  useEffect(() => {
    (window as any).kinStore = useKinStore;
    fetchState();
    initSSE();
    return () => {
      closeSSE();
    };
  }, [fetchState, initSSE, closeSSE]);

  // Listen to native Tauri supervisor daemon events (daemon-ready, daemon-error)
  useEffect(() => {
    let unlistenReady: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    const setupTauriEvents = async () => {
      try {
        const tauriEvent =
          (window as any).__TAURI__?.event ||
          (window as any).__TAURI_INTERNALS__?.event;
        if (tauriEvent?.listen) {
          unlistenReady = await tauriEvent.listen('daemon-ready', () => {
            console.log('[KIN APP] Received daemon-ready event from Tauri supervisor');
            fetchState();
            initSSE();
          });
          unlistenError = await tauriEvent.listen('daemon-error', (event: any) => {
            console.error('[KIN APP] Received daemon-error event from Tauri supervisor:', event?.payload);
            addToast(`Daemon Startup Alert: ${event?.payload || 'Failed to initialize core daemon'}`, 'error');
          });
        }
      } catch (err) {
        console.debug('[KIN APP] Tauri event listener setup skipped:', err);
      }
    };

    setupTauriEvents();

    return () => {
      if (unlistenReady) unlistenReady();
      if (unlistenError) unlistenError();
    };
  }, [fetchState, initSSE, addToast]);

  return (
    <ErrorBoundary name="KIN Root Workspace">
      <div className={`flex flex-col h-screen w-screen overflow-hidden font-sans antialiased select-none ${theme === 'light' ? 'bg-[#f6f8fa] text-slate-800' : 'bg-[#0d1117] text-kin-text'}`}>
        {/* Desktop Frameless TitleBar */}
        <TitleBar />

        {/* Top Application Header Bar */}
        <HeaderBar />

        {/* Backend Offline / Connecting Banner */}
        {!isConnected && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-200 px-4 py-1.5 text-xs flex items-center justify-between z-30 transition-all shrink-0">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span className="font-semibold text-amber-300">KIN Core Daemon Disconnected</span>
              <span className="text-amber-400/70 text-[11px] hidden sm:inline">— Attempting automatic reconnection...</span>
            </div>
            <button
              onClick={() => {
                fetchState();
                initSSE();
              }}
              className="px-2.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border border-amber-500/40 text-[11px] font-medium transition cursor-pointer flex items-center space-x-1"
              title="Manually retry connection to KIN Core Daemon"
            >
              <span>Reconnect Now</span>
            </button>
          </div>
        )}

        {/* First-Boot AI Model Onboarding Banner */}
        <ModelOnboardingBanner />

        {/* Main 4-Pane Workbench Layout */}
        <WorkbenchLayout isCompact={isCompact} />

        {/* Compact Screen Slide-Over Inspector Drawer (< 1100px) */}
        {isInspectorOpen && isCompact && (
          <div className="fixed inset-0 z-40 flex justify-end animate-fadeIn">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
              onClick={() => setInspectorOpen(false)}
            />
            <div className="relative z-50 h-full max-w-[85vw] shadow-2xl flex flex-col animate-slideLeft">
              <ErrorBoundary name="Agent Inspector & Diagnostics Drawer">
                <AgentInspector />
              </ErrorBoundary>
            </div>
          </div>
        )}

        {/* Modals & Overlays */}
        <ErrorBoundary name="Modal System">
          <NewProjectModal />
          <CreateChannelModal />
          <AddAgentModal />
          {isSwarmMapOpen && (
            <Suspense fallback={null}>
              <SwarmMap />
            </Suspense>
          )}
          {isSkillsModalOpen && (
            <Suspense fallback={null}>
              <SkillsModal />
            </Suspense>
          )}
          {isDesktopControlModalOpen && (
            <Suspense fallback={null}>
              <DesktopControlModal />
            </Suspense>
          )}
          {isDecisionsModalOpen && (
            <Suspense fallback={null}>
              <DecisionsModal />
            </Suspense>
          )}
          {isSettingsModalOpen && (
            <Suspense fallback={null}>
              <SettingsModal />
            </Suspense>
          )}
          {isConnectorsModalOpen && (
            <Suspense fallback={null}>
              <ConnectorsModal />
            </Suspense>
          )}
          {isAutomationsModalOpen && (
            <Suspense fallback={null}>
              <AutomationsModal />
            </Suspense>
          )}
          <CreateGoalModal />
          <CreateTaskModal />
          <ModelSelectorModal />
          <AddProviderModal />
          <ModelUnavailablePromptModal />
          {isAgentSettingsModalOpen && (
            <Suspense fallback={null}>
              <AgentSettingsModal />
            </Suspense>
          )}
          <ToastContainer />
        </ErrorBoundary>
      </div>
    </ErrorBoundary>
  );
};

export default App;
