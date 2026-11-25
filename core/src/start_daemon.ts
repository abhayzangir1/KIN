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
    } catch (err) { console.debug("[start_daemon] Suppressed exception in catch block:", err); }
  }
}

function resolveDbPath(): string {
  if (process.env.KIN_DB_PATH) {
    if (process.env.KIN_DB_PATH === ':memory:') {
      return ':memory:';
    }
    return path.resolve(process.env.KIN_DB_PATH);
  }
  const dataDir = getDataDirectory();
  return path.resolve(dataDir, 'kin_storage.sqlite');
}

const dbPath = resolveDbPath();
const port = parseInt(process.env.KIN_PORT || '54321', 10);

const server = new CoreServer({ port, dbPath });

function getDaemonErrorLogPath(): string {
  try {
    const dir = getDataDirectory();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.resolve(dir, 'daemon_error.log');
  } catch {
    return path.resolve(process.cwd(), 'daemon_error.log');
  }
}

process.on('uncaughtException', async (err) => {
  const msg = `[${new Date().toISOString()}] [KIN CORE UNCAUGHT EXCEPTION] ${err?.stack || err}\n`;
  console.error(msg);
  try {
    fs.appendFileSync(getDaemonErrorLogPath(), msg);
  } catch (logErr) {
    console.error('[start_daemon] Failed to append uncaught exception to daemon_error.log:', logErr);
  }
  try {
    await server.stop();
  } catch (stopErr) {
    console.error('[start_daemon] Failed to stop server cleanly during uncaughtException:', stopErr);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = `[${new Date().toISOString()}] [KIN CORE UNHANDLED REJECTION] ${(reason as any)?.stack || reason}\n`;
  console.error(msg);
  try {
    fs.appendFileSync(getDaemonErrorLogPath(), msg);
  } catch (logErr) {
    console.error('[start_daemon] Failed to append unhandled rejection to daemon_error.log:', logErr);
  }
});

server.start().then((actualPort) => {
  console.log(`[KIN CORE] Workforce engine running on http://127.0.0.1:${actualPort}`);
  const resolvedDataDir = getDataDirectory();
  const tokenCandidates = [
    path.join(resolvedDataDir, 'ipc_auth.token'),
    path.join(resolvedDataDir, '.kin', 'ipc_auth.token'),
  ];
  for (const tp of tokenCandidates) {
    if (fs.existsSync(tp)) {
      const tok = fs.readFileSync(tp, 'utf8').trim();
      if (tok) {
        console.log(`[KIN CORE] Browser UI (authenticated): http://127.0.0.1:${actualPort}/?token=${tok}`);
        break;
      }
    }
  }
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

// ============================================================================
// PARENT PROCESS WATCHDOG
// Supervises the parent process (host application, Tauri shell, or terminal).
// On Unix/macOS, if the parent terminates abnormally (e.g. SIGKILL), the child
// is reparented to init/launchd (PID 1).
// Cross-platform signal 0 probe verifies parent process liveness.
// If the parent process dies, shuts down CoreServer cleanly and exits.
// ============================================================================
function setupParentProcessWatchdog(): void {
  if (process.env.KIN_WATCH_PARENT === 'false' || process.env.KIN_NO_PARENT_WATCHDOG === '1') {
    return;
  }

  const initialPpid = process.ppid;
  if (!initialPpid || initialPpid <= 1) {
    return;
  }

  let isShuttingDown = false;
  const triggerGracefulShutdown = async (reason: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.warn(
      `[KIN CORE WATCHDOG] Host parent process (PID ${initialPpid}) termination detected (${reason}). Initiating graceful daemon shutdown...`
    );
    try {
      await server.stop();
    } catch (stopErr) {
      console.error('[KIN CORE WATCHDOG] Error stopping server during parent termination:', stopErr);
    }
    process.exit(0);
  };

  // Immediate detection: If stdin is a pipe connected to the host parent,
  // stream closure immediately signals parent process termination with 0ms latency.
  if (!process.stdin.isTTY && typeof process.stdin.on === 'function') {
    try {
      process.stdin.resume();
      process.stdin.on('end', () => {
        void triggerGracefulShutdown('stdin stream closed');
      });
      process.stdin.on('close', () => {
        void triggerGracefulShutdown('stdin handle closed');
      });
    } catch {}
  }

  const intervalMs = parseInt(process.env.KIN_WATCHDOG_INTERVAL_MS || '2500', 10);

  const watchdog = setInterval(async () => {
    if (isShuttingDown) {
      clearInterval(watchdog);
      return;
    }

    let parentTerminated = false;

    // Check 1: Unix reparenting detection (reparented to PID 1 or changed PPID)
    if (process.platform !== 'win32') {
      if (process.ppid !== initialPpid || process.ppid === 1) {
        parentTerminated = true;
      }
    }

    // Check 2: Cross-platform process liveness probe using kill(pid, 0)
    if (!parentTerminated) {
      try {
        process.kill(initialPpid, 0);
      } catch (err: any) {
        if (err?.code === 'ESRCH') {
          parentTerminated = true;
        }
      }
    }

    if (parentTerminated) {
      clearInterval(watchdog);
      await triggerGracefulShutdown('process probe ESRCH');
    }
  }, intervalMs);

  watchdog.unref();
}

setupParentProcessWatchdog();


