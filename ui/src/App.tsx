import React, { useEffect } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { ChannelView } from './components/ChannelView.js';
import { AgentPresenceBar } from './components/AgentPresenceBar.js';
import { useKinStore } from './store/kinStore.js';

export const App: React.FC = () => {
  const { fetchState, initSSE } = useKinStore();

  useEffect(() => {
    fetchState();
    initSSE();
  }, [fetchState, initSSE]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-kin-bg text-kin-text font-sans antialiased">
      <Sidebar />
      <ChannelView />
      <AgentPresenceBar />
    </div>
  );
};

export default App;
