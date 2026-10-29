// ============================================================================
// KIN CORE DAEMON ENTRYPOINT
// Launches the local CoreServer on port 54321 with SQLite persistence.
// ============================================================================

import { CoreServer } from './server/core_server.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDataDirectory } from './storage/data_directory.js';

const moduleDir = typeof import.meta !== 'undefined' && (import.meta as any)?.url
  ? path.dirname(fileURLToPath((import.meta as any).url))
  : (typeof __dirname !== 'undefined' ? __dirname : process.cwd());

// Automatically load .env if available
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(moduleDir, '../../.env'),
  path.resolve(moduleDir, '../.env'),
  path.resolve(getDataDirectory(), '.env'),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
      console.log(`[KIN CORE] Environment variables loaded from: ${envPath}`);
      break;
    } catch {}
  }
}

function resolveDbPath(): string {
  if (process.env.KIN_DB_PATH) {
    return path.resolve(process.env.KIN_DB_PATH);
  }
  const dataDir = getDataDirectory();
  return path.resolve(dataDir, 'kin_storage.sqlite');
}

const dbPath = resolveDbPath();
const port = parseInt(process.env.KIN_PORT || '54321', 10);

const server = new CoreServer({ port, dbPath });

process.on('uncaughtException', async (err) => {
  const msg = `[${new Date().toISOString()}] [KIN CORE UNCAUGHT EXCEPTION] ${err?.stack || err}\n`;
  console.error(msg);
  try {
    fs.appendFileSync(path.resolve(process.cwd(), 'daemon_error.log'), msg);
  } catch {}
  try {
    await server.stop();
  } catch {}
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = `[${new Date().toISOString()}] [KIN CORE UNHANDLED REJECTION] ${(reason as any)?.stack || reason}\n`;
  console.error(msg);
  try {
    fs.appendFileSync(path.resolve(process.cwd(), 'daemon_error.log'), msg);
  } catch {}
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

