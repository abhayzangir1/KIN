import React from 'react';
import { Sidebar } from './components/Sidebar.js';
import { ChannelView } from './components/ChannelView.js';
import { AgentPresenceBar } from './components/AgentPresenceBar.js';

export const App: React.FC = () => {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-kin-bg text-kin-text font-sans antialiased">
      <Sidebar />
      <ChannelView />
      <AgentPresenceBar />
    </div>
  );
};
export default App;
