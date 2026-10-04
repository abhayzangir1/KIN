# KIN Troubleshooting Guide

This guide covers solutions for common operational challenges, recovery procedures, and performance adjustments in KIN.

---

## 1. Database Locked (`SQLITE_BUSY: database is locked`)

### Symptom
The daemon logs: `SQLITE_BUSY: database is locked` or queries time out when executing concurrent operations.

### Cause
SQLite operates in Write-Ahead Logging (`WAL`) mode with atomic transaction leases. If an external tool or an orphaned daemon process holds an exclusive lock without releasing it, subsequent write operations will block.

### Resolution Steps
1. **Stop active KIN processes**:
   Close any open KIN desktop windows or terminal daemon processes.
2. **Inspect lingering processes**:
   On Windows PowerShell:
   ```powershell
   Get-Process -Name "node", "KIN" -ErrorAction SilentlyContinue | Stop-Process -Force
   ```
   On macOS / Linux:
   ```bash
   pkill -f "kin_storage.sqlite" || true
   pkill -f "start_daemon" || true
   ```
3. **Inspect the WAL checkpoint**:
   If `kin_storage.sqlite-wal` remains large (>10MB), launch KIN in checkpoint mode to fold WAL pages back into the main database:
   ```bash
   node -e "const { KinDatabase } = require('./core/dist/storage/db.js'); const db = new KinDatabase(); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();"
   ```
4. **Restart KIN**:
   Restart the daemon via `./start.sh` or `start.bat`.

---

## 2. Agent Stuck in Running State

### Symptom
An agent run in the Workbench shows status `running`, but no messages or tool executions appear in the channel.

### Cause
An external command execution (such as an interactive prompt or non-terminating shell loop) has stalled, or the process died without updating its heartbeat timestamp.

### Resolution Steps
1. **Heartbeat & Lease Timeout**:
   KIN automatically monitors agent runs. Heartbeats update every 15 seconds. If a run misses heartbeats for longer than the lease expiration window (default: 60 seconds), the supervisor reclaims the task lease.
2. **Instant Human Takeover**:
   In the workbench header or drawer, click **Pause** or **Abort** to issue an immediate `AbortSignal` to cancel the hung execution turn.
3. **Manual Reset via REST API**:
   You can abort an active run directly using the core server endpoint:
   ```bash
   curl -X POST http://127.0.0.1:54321/api/runs/abort -H "Content-Type: application/json" -d '{"runId": "<RUN_ID>"}'
   ```
4. **Restart & Crash Recovery**:
   Restarting the daemon triggers the startup recovery sweep. Interrupted runs are frozen at their last checkpoint and presented in the Docked Crash Recovery Banner for review or resumption.

---

## 3. Local Ollama Inference Issues

### Symptom
Agent fails with `Error: Failed to fetch from Ollama` or model responses return empty text.

### Diagnosis & Resolution
1. **Verify Ollama daemon status**:
   Ensure Ollama is running on `http://127.0.0.1:11434`:
   ```bash
   curl http://127.0.0.1:11434/api/tags
   ```
2. **Verify installed models**:
   Check if the model configured for the agent is installed:
   ```bash
   ollama list
   ```
   If missing, pull the required model:
   ```bash
   ollama pull llama3.2
   ```
3. **Verify via KIN API**:
   Query the core server to inspect Ollama connectivity:
   ```bash
   curl http://127.0.0.1:54321/api/system/models
   ```
   The response contains `{ online: true, models: [...] }`.
4. **Cloud BYOK Fallback**:
   If Ollama is offline, add an API key for OpenRouter, Anthropic, OpenAI, or Gemini in the **Settings & Credential Vault**. KIN will automatically route requests to the available provider.

---

## 4. High Workstation Memory & RAM Governor Pauses

### Symptom
Runs pause with warning: `Governor paused execution: Free RAM below minimum threshold`.

### Cause
KIN includes a dynamic hardware governor that inspects free workstation memory via `os.freemem()` before scheduling heavy operations. By default, execution pauses if available memory drops below 256 MB.

### Resolution Steps
1. **Check current memory status**:
   ```bash
   curl http://127.0.0.1:54321/api/system/governor
   ```
2. **Tune threshold via environment variable**:
   Set a custom minimum free memory threshold (in megabytes) before starting KIN:
   ```bash
   # Windows PowerShell
   $env:KIN_RAM_MIN_MB = "128"

   # Bash
   export KIN_RAM_MIN_MB=128
   ```
3. **Close background heavy applications**:
   Free workstation memory to allow the governor to automatically unpause paused runs.

---

## 5. HTTP 429 Quota Pauses

### Symptom
A docked banner appears: `API Quota Reached (HTTP 429). Execution paused.`

### Mechanism
When a cloud provider returns HTTP 429, KIN freezes turn state into an atomic SQLite checkpoint, begins an automatic countdown, and displays options to:
- Wait for the countdown to expire and auto-resume.
- Click **Resume Now** if quotas have reset.
- Click **Failover to Local Model** to switch to an installed Ollama model with zero data loss.

---

## 6. Port Conflicts (54321 or 5173)

### Symptom
Error on startup: `EADDRINUSE: address already in use 127.0.0.1:54321`.

### Resolution Steps
1. **Identify the process using the port**:
   On Windows:
   ```powershell
   netstat -ano | findstr :54321
   ```
2. **Terminate the conflicting process**:
   ```powershell
   taskkill /PID <PID> /F
   ```
3. **Custom daemon port**:
   You can start the daemon on an alternative port by passing the `PORT` environment variable:
   ```bash
   PORT=54322 npm run dev:daemon
   ```

---

## 7. Worktree Confinement & Directory Traversal Violations

### Symptom
Tool error: `FORBIDDEN: Path traversal outside project worktree root is rejected`.

### Cause
KIN enforces strict boundary confinement on all filesystem tools (`readFile`, `writeFile`, `listDirectory`). Relative paths with `../` attempting to escape the project workspace directory are rejected.

### Resolution
Ensure all file paths passed to tools are relative to the active project workspace root (e.g. `src/index.ts` instead of `../../etc/passwd`).
