import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';
import { useKinStore } from './store/kinStore.js';

// Attach store to window for browser automation and developer console inspection
if (typeof window !== 'undefined') {
  (window as any).kinStore = useKinStore;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
