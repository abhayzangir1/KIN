import React, { useEffect } from 'react';
import { HeaderBar } from './components/HeaderBar.js';
import { Sidebar } from './components/Sidebar.js';
import { CenterView } from './components/CenterView.js';
import { AgentInspector } from './components/AgentInspector.js';
import { NewProjectModal } from './components/NewProjectModal.js';
import { useKinStore } from './store/kinStore.js';

export const App: React.FC = () => {
  const { fetchState, initSSE } = useKinStore();

  useEffect(() => {
    fetchState();
    initSSE();
  }, [fetchState, initSSE]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0f1d] text-kin-text font-sans antialiased">
      {/* Top Application Header Bar */}
      <HeaderBar />

      {/* Main 3-Column Workspace Layout */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar />
        <CenterView />
        <AgentInspector />
      </div>

      {/* New Project Modal Dialog */}
      <NewProjectModal />
    </div>
  );
};

export default App;
