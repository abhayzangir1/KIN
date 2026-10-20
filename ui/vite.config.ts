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
  plugins: [
    react(),
    {
      name: 'kin-security-headers',
      configureServer(server) {
        server.middlewares.use('/api', (req, res, next) => {
          const origin = req.headers['origin'];
          const host = req.headers['host'];
          const secFetchSite = req.headers['sec-fetch-site'];

          const isLocalHost = !host || host === '127.0.0.1:5173' || host === 'localhost:5173';
          const isAllowedOrigin = !origin || origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173' || origin === 'tauri://localhost';
          const isNotCrossSite = secFetchSite !== 'cross-site';

          if (!isLocalHost || !isAllowedOrigin || !isNotCrossSite) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Forbidden: Cross-site or unauthorized proxy request rejected.' }));
            return;
          }
          next();
        });
      },
    },
  ],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const origin = req.headers['origin'];
            const host = req.headers['host'];
            const secFetchSite = req.headers['sec-fetch-site'];

            const isLocalHost = !host || host === '127.0.0.1:5173' || host === 'localhost:5173';
            const isAllowedOrigin = !origin || origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173' || origin === 'tauri://localhost';
            const isNotCrossSite = secFetchSite !== 'cross-site';

            if (isLocalHost && isAllowedOrigin && isNotCrossSite) {
              const token = getIpcToken();
              if (token && !proxyReq.getHeader('authorization')) {
                proxyReq.setHeader('Authorization', `Bearer ${token}`);
              }
            } else {
              proxyReq.destroy(new Error('Vite proxy rejected cross-origin request'));
            }
          });
        },
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
