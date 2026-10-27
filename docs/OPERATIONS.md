# KIN Operations & Administration Manual

This manual provides authoritative operational guidelines for running, configuring, monitoring, and maintaining KIN in local development and production workstation environments.

---

## 1. System Requirements & Runtime Prerequisites

| Component | Minimum Version | Recommended Specification |
|---|---|---|
| **Platform** | Windows 10/11 (x64), macOS 12+ (Apple Silicon/Intel), Linux (Ubuntu 22.04+) | 64-bit system |
| **Node.js** | v20.0.0 LTS | v22 LTS |
| **npm** | v10.0.0 | Latest |
| **Rust / Cargo** | v1.75+ | Required only when compiling the Tauri desktop shell |
| **SQLite** | 3.40+ (Bundled via `better-sqlite3`) | Runs in WAL (Write-Ahead Logging) mode |
| **Ollama** | Optional (v0.3.0+) | For local offline inference (`16GB+ RAM` recommended) |

---

## 2. Booting the Runtime Services

KIN operates as a modular local architecture consisting of a TypeScript Core Daemon and a React desktop UI.

### Step 1: Install Dependencies & Build Workspace
```bash
git clone https://github.com/abhayzangir1/KIN.git
cd KIN
npm install
npm run build
```

### Step 2: Launch KIN

**Option A: One-Click Production Mode (Default)**
Run KIN directly in production mode. The Core Daemon serves both the backend IPC APIs and the pre-compiled React workbench on `http://127.0.0.1:54321`:
```bash
# Windows
start.bat

# macOS / Linux
chmod +x start.sh && ./start.sh

# Or via npm
npm run start:prod
```
- **Default Listener**: `http://127.0.0.1:54321`
- **Database Initialization**: Automatically executes SQLite migrations on `kin_storage.sqlite`.
- **Health Check**: `GET http://127.0.0.1:54321/api/health` returns comprehensive system diagnostics.

**Option B: Browser Development Mode (Vite HMR)**
Run with live Hot Module Replacement (HMR) for frontend development:
```bash
# Windows
start.bat --dev

# macOS / Linux
./start.sh --dev
```
Opens the web workbench at `http://127.0.0.1:5173`.

**Option C: Tauri Native Desktop Shell**
Launch the unified native desktop shell:
```bash
npm run tauri:dev
```
To package the standalone desktop installer with freshly compiled Node SEA binary sidecars:
```bash
npm run package:desktop
```

---

## 3. Configuration & Environment Variables

Configure KIN by creating a `.env` file in the repository root or exporting environment variables:

| Variable | Default Value | Description |
|---|---|---|
| `KIN_PORT` | `54321` | TCP port for the KIN Core Daemon HTTP REST and SSE server. |
| `KIN_HOST` | `127.0.0.1` | Network binding interface. Keep as `127.0.0.1` for local-first security. |
| `KIN_DB_PATH` | `./kin_storage.sqlite` | Path to the authoritative SQLite database. |
| `KIN_IPC_TOKEN` | *Auto-generated* | Secret bearer token required for authenticating all API and SSE connections. |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Endpoint for connecting to the local Ollama inference service. |
| `NODE_ENV` | `development` | Runtime environment (`development` or `production`). |

---

## 4. SQLite Storage & Backup Procedures

KIN stores all operational state (agents, channels, messages, goals, tasks, schedules, memory tiers, and credentials) in `kin_storage.sqlite`.

### Write-Ahead Logging (WAL) Mode
KIN automatically configures SQLite for maximum multi-agent concurrency:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```
- **Concurrent Readers**: Unlimited simultaneous read operations across all agents and UI views.
- **Dedicated Writer**: Background loggers and schedulers do not block foreground user chat or streaming responses.

### Performing Safe Backups
Because SQLite is running in WAL mode, **do not copy the database while high-throughput writes are active without including sidecar files**.

**Recommended Cold Backup Procedure:**
1. Stop the Core Daemon process (`Ctrl+C` or kill process).
2. Copy the database and its WAL sidecars:
   ```bash
   cp kin_storage.sqlite kin_storage.sqlite.bak
   cp kin_storage.sqlite-wal kin_storage.sqlite-wal.bak 2>/dev/null || true
   cp kin_storage.sqlite-shm kin_storage.sqlite-shm.bak 2>/dev/null || true
   ```
3. Restart the Core Daemon.

**Recommended Online Backup (Without Stopping):**
Use SQLite's native backup command:
```bash
sqlite3 kin_storage.sqlite ".backup kin_backup_$(date +%Y%m%d).sqlite"
```

---

## 5. Security & Trust Hardening

1. **Loopback Confinement**: KIN binds exclusively to `127.0.0.1`. Never expose KIN to public networks without a secure reverse proxy enforcing TLS and strict IP allowlisting.
2. **IPC Token Authentication**: When `KIN_IPC_TOKEN` is active, all HTTP endpoints and SSE streams require the header `Authorization: Bearer <token>`.
3. **Encrypted Secret Vault**: API keys and cloud credentials entered in the UI are encrypted via AES-256-GCM before writing to the `secrets` table. Plaintext keys are never logged or exposed in client responses.
4. **Git Worktree Isolation**: All coding tasks execute inside temporary directories (`.kin/worktrees/`). Path traversal outside the active project boundary is rejected by `ToolGateway`.

---

## 6. Observability & Log Monitoring

- **SSE Stream**: Monitor real-time system events by subscribing to `GET /api/events`.
- **System Diagnostics**: Inspect memory usage, database size, and Ollama connectivity via:
  ```bash
  curl -H "Authorization: Bearer $KIN_TOKEN" http://127.0.0.1:54321/api/diagnostics
  ```
- **Daemon Logs**: Tail stdout/stderr in your terminal or redirect to a dedicated logfile (`kin.log`).

---

## 7. Verification, Testing & Build Operations

### Automated Test Execution

KIN maintains a comprehensive automated testing suite (750 tests across 53 test suites, all passing deterministically).

**Monorepo Test Command:**
```bash
npm test
```

**Core Workspace Test Command:**
```bash
npm test --workspace=core
```

**Individual Test File Execution:**
```bash
npx vitest run core/test/adversarial_r1_concurrency_stress.test.ts
```

### Full Production Builds

**Monorepo Build (Core & UI):**
```bash
npm run build
```

**Core Daemon Build (`tsc`):**
```bash
npm run build --workspace=core
```

**Frontend UI Build (`tsc && vite build`):**
```bash
npm run build --workspace=ui
```

### Operational Invariant: Background Server Processes

> **MANDATORY VERIFICATION RULE**:  
> During automated test execution and build verification workflows, all background daemons (`node core/dist/start_daemon.js` or `npm run daemon`) and UI development servers (`npm run dev` or `npm run dev --workspace=ui`) must remain completely stopped.  
> 
> Automated test suites dynamically instantiate isolated in-memory or ephemeral SQLite databases and bind to dynamic loopback ports (port `0`). Running external daemons concurrently can create file handle locks on temporary SQLite files, generate lease collisions, or cause port contention. Automated verification commands expect a clean, idle host environment.
