// ============================================================================
// KIN CORE DAEMON ENTRYPOINT
// Launches the local CoreServer on port 54321 with SQLite persistence.
// ============================================================================

import { CoreServer } from './server/core_server.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getDataDirectory } from './storage/data_directory.js';

function resolveDbPath(): string {
  if (process.env.KIN_DB_PATH) {
    return path.resolve(process.env.KIN_DB_PATH);
  }
  const dataDir = getDataDirectory();
  const candidates = [
    path.resolve(dataDir, 'kin_storage.sqlite'),
    path.resolve(process.cwd(), 'kin_storage.sqlite'),
    path.resolve(process.cwd(), '..', 'kin_storage.sqlite'),
    path.resolve(process.cwd(), 'core', 'kin_storage.sqlite'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return path.resolve(dataDir, 'kin_storage.sqlite');
}

const dbPath = resolveDbPath();
const port = parseInt(process.env.KIN_PORT || '54321', 10);

const server = new CoreServer({ port, dbPath });

process.on('uncaughtException', (err) => {
  console.error('[KIN CORE UNCAUGHT EXCEPTION]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[KIN CORE UNHANDLED REJECTION]', reason);
});

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

