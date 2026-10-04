import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as fs from 'node:fs';
import * as path from 'node:path';

function getIpcToken(): string | null {
  try {
    const tokenPath = path.resolve(__dirname, '../.kin/ipc_auth.token');
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, 'utf-8').trim();
    }
  } catch {}
  return null;
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = getIpcToken();
            if (token && !proxyReq.getHeader('authorization')) {
              proxyReq.setHeader('Authorization', `Bearer ${token}`);
            }
          });
        },
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});

