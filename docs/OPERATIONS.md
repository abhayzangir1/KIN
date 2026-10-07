# KIN Operations & Deployment Guide

This guide details operational administration, backup strategies, performance tuning, and headless server deployment for the KIN multi-agent coordination platform.

---

## 1. Backup & Disaster Recovery

KIN stores all operational state (tasks, runs, messages, credentials, goals, and skills) in a local SQLite database utilizing Write-Ahead Logging (`WAL` mode).

### Backing Up Active State
To take an authoritative backup without terminating running agents, checkpoint the SQLite WAL and copy the data directory:

```bash
# 1. Force a WAL checkpoint to flush pending transactions to disk
node -e "const { KinDatabase } = require('./core/dist/storage/db.js'); const db = new KinDatabase(); db.pragma('wal_checkpoint(PASSIVE)'); db.close();"

# 2. Archive SQLite database and state files
BACKUP_DIR="$HOME/backups/kin_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

cp kin_storage.sqlite "$BACKUP_DIR/"
cp -r .kin "$BACKUP_DIR/"
```

### Restoring from Backup
```bash
# 1. Stop all active KIN daemon and UI processes
# 2. Restore database and .kin directories
cp "$BACKUP_DIR/kin_storage.sqlite" ./kin_storage.sqlite
cp -r "$BACKUP_DIR/.kin" ./

# 3. Remove stale WAL and shared memory files if present
rm -f kin_storage.sqlite-wal kin_storage.sqlite-shm

# 4. Start KIN
./start.sh
```

---

## 2. Headless Daemon Mode (Server / Background Service)

KIN can run headlessly on a physical workstation, virtual machine, or local server without the Tauri graphical interface.

### Starting the Headless Daemon
```bash
# Production daemon execution
npm run daemon --workspace=core

# Or launch directly with custom host and port
PORT=54321 HOST=127.0.0.1 node core/dist/start_daemon.js
```

### Accessing Headless Services
When running headlessly, KIN can be managed via:
1. **REST API**: Automated scripts interacting with endpoints documented in [docs/API.md](docs/API.md).
2. **Web Browser UI**: Opening `http://localhost:5173` in any standard web browser connected to the local network or SSH tunnel.
3. **SSE Event Stream**: Real-time event subscription on `http://127.0.0.1:54321/api/events`.

---

## 3. Performance Tuning & Governors

### Adjusting Hardware RAM Governor Thresholds
KIN automatically suspends dispatching heavy tasks if available workstation memory drops below safe limits.

To adjust the minimum free memory threshold:
```bash
# Windows PowerShell
$env:KIN_RAM_MIN_MB = "512"

# Linux / macOS Bash
export KIN_RAM_MIN_MB=512
```

### Tuning Concurrent Agent Runs
By default, KIN permits up to 8 active concurrent execution loops. In high-capacity environments with ample compute, this threshold can be tuned in configuration or kernel settings (`core/src/kernel/agent_kernel.ts`):
```typescript
private readonly maxActiveConcurrentRuns: number = 16;
```

### Token Spend Caps & Quota Management
In **Settings & Credential Vault**, configure monthly or daily token spend caps per provider (OpenRouter, Anthropic, OpenAI). When a provider reaches its threshold, KIN automatically switches to local Ollama models or pauses runs gracefully.

---

## 4. Security & Isolation Architecture

1. **Filesystem Jail Path Confinement**:
   All filesystem tool invocations (`readFile`, `writeFile`, `listDirectory`) verify that resolved file targets reside strictly within the project worktree root. Symbolic links and `../` path traversal attempts are rejected.

2. **Physical Desktop Serialized Single-Flight Execution Queue**:
   When multiple agents execute computer-use tasks (mouse clicks, typing, window focus), KIN uses an internal serialized single-flight execution queue with native window focus management to serialize input events. This prevents competing agents from clicking concurrently on the workstation screen.

3. **Financial Hard Stops**:
   Operations matching commerce, checkout, or billing patterns trigger mandatory approval gates (`RiskLevel: CRITICAL`), requiring explicit human operator authorization regardless of active autonomy mode.
