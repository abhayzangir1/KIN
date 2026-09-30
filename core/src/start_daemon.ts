// ============================================================================
// KIN CORE DAEMON ENTRYPOINT
// Launches the local CoreServer on port 54321 with SQLite persistence.
// ============================================================================

import { CoreServer } from './server/core_server.js';
import * as path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'kin_storage.sqlite');
const port = parseInt(process.env.KIN_PORT || '54321', 10);

const server = new CoreServer({ port, dbPath });

server.start().then((actualPort) => {
  console.log(`[KIN CORE] Workforce engine running on http://127.0.0.1:${actualPort}`);
  console.log(`[KIN CORE] Database: ${dbPath}`);
}).catch((err) => {
  console.error('[KIN CORE FATAL] Failed to start Core Server:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n[KIN CORE] Shutting down gracefully...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[KIN CORE] Received SIGTERM. Shutting down...');
  await server.stop();
  process.exit(0);
});
