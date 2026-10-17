# KIN Troubleshooting & Diagnostic Guide

This guide provides step-by-step diagnostic procedures and solutions for common operational issues encountered while running KIN.

---

## Quick Diagnostic Checklist

If you encounter unexpected behavior:
1. **Check Core Daemon Status**: Run `curl http://127.0.0.1:54321/api/health` to confirm the backend is responsive.
2. **Inspect Terminal Logs**: Review stdout/stderr in the terminal running `npm run daemon --workspace=core`.
3. **Verify Database Integrity**: Ensure no duplicate daemon processes are accessing `kin_storage.sqlite`.
4. **Check Ollama Connectivity**: Run `curl http://127.0.0.1:11434/api/tags` if using local models.

---

## Common Issues & Solutions

### 1. The Frontend Displays "Disconnected from Core" or "Failed to Fetch"
**Symptom**: The UI banner shows a red disconnection indicator and messages cannot be sent.

**Root Causes & Solutions**:
- **Core Daemon is Not Running**: Start the core service from the repository root:
  ```bash
  npm run daemon --workspace=core
  ```
- **Port Conflict (`EADDRINUSE`)**: Another process is occupying port `54321`. Check running processes:
  - *Windows*: `netstat -ano | findstr :54321` and terminate the conflicting PID with `taskkill /F /PID <pid>`.
  - *macOS/Linux*: `lsof -i :54321` and `kill -9 <pid>`.
  - Alternatively, launch on a custom port: `KIN_PORT=54322 npm run daemon --workspace=core`.
- **IPC Token Mismatch**: If `KIN_IPC_TOKEN` was set on the daemon but not provided to the UI, the frontend will receive HTTP 401 Unauthorized. Ensure your environment variables match or reload the UI so it receives the negotiated session token.

---

### 2. A Task or Agent Run Appears "Stuck"
**Symptom**: An agent status shows `executing` or `thinking`, but no new SSE events or messages appear.

**Root Causes & Solutions**:
- **Awaiting Operator Approval**: The agent may have invoked a privileged tool (e.g. `executeShell` with critical arguments or desktop control) that requires user approval. Check the chat feed for an active **Approval Card** and click **Approve** or **Reject**.
- **Inference Latency / Extended Thinking**: Deep reasoning models (e.g., DeepSeek R1, o1/o3-mini) may take 30-90 seconds to generate their initial thought chain. Check the daemon terminal to confirm the HTTP request is pending.
- **Quota Limit Exceeded (HTTP 429)**: The provider has throttled requests. Check the UI for the **Quota Guard Banner**. You can click **Switch to Local Ollama** to resume immediately using your local hardware.
- **Force Cancelling a Run**: In the UI, navigate to the **Agent Inspector** and click **Stop Run**, or call the REST endpoint:
  ```bash
  curl -X POST -H "Authorization: Bearer $KIN_TOKEN" \
    http://127.0.0.1:54321/api/runs/<run_id>/cancel
  ```

---

### 3. "SQLite Error: SQLITE_BUSY: database is locked"
**Symptom**: API endpoints return 500 with a database lock error.

**Root Causes & Solutions**:
- **Multiple Daemon Instances**: Two instances of KIN Core were started concurrently against the same `kin_storage.sqlite` file.
  - Stop all running Node processes associated with KIN.
  - Restart a single daemon instance.
- **Stale Lock or Unfinished Transaction**: KIN uses SQLite in WAL mode with a 5000ms busy timeout. If a transaction hangs, restarting the daemon will allow SQLite's WAL engine to recover and checkpoint automatically.
- **Do NOT Delete Sidecar Files**: Never delete `kin_storage.sqlite-wal` or `kin_storage.sqlite-shm` while the daemon is running, as this will corrupt uncheckpointed transactions.

---

### 4. Local Ollama Models Fail to Respond or Show as "Offline"
**Symptom**: In the UI, Ollama shows `offline` or requests time out.

**Root Causes & Solutions**:
- **Ollama Daemon Not Started**: Ensure Ollama is running:
  ```bash
  ollama serve
  ```
- **Custom Ollama Host Binding**: If Ollama is listening on a non-default port or host, set the `OLLAMA_HOST` variable:
  ```bash
  export OLLAMA_HOST="http://localhost:11434"
  ```
- **Model Not Pulled**: Verify that the requested model exists locally:
  ```bash
  ollama list
  ```
  If missing, download it: `ollama pull qwen2.5:7b` or `ollama pull llama3.2`.

---

### 5. "Security Error: Path outside project boundary"
**Symptom**: The agent attempts to read or write a file, and the tool returns an authorization failure.

**Root Causes & Solutions**:
- **Confinement Policy**: KIN restricts filesystem operations strictly to the active project repository and dedicated Git worktrees (`.kin/worktrees/`).
- **Relative Path Traversal**: Prompts containing `../../` outside the project root are rejected by design. Ensure agents are operating on files within the project working directory.

---

### 6. Git Worktree Lock Contention
**Symptom**: Agent reports error creating worktree or `fatal: '.kin/worktrees/...' already exists`.

**Root Causes & Solutions**:
- **Previous Abnormal Termination**: A previous task was forcibly killed before removing its temporary worktree.
- **Manual Cleanup**:
  ```bash
  git worktree prune
  git branch -D kin/task-<task_id>
  ```
  KIN will safely recreate clean worktrees on subsequent runs.

---

### 7. Tauri Desktop App Fails to Compile or Launch
**Symptom**: Running `npm run tauri dev` or `cargo build` fails.

**Root Causes & Solutions**:
- **Missing Build Prerequisites**:
  - *Windows*: Ensure the C++ Build Tools (Visual Studio 2022) and WebView2 Runtime are installed.
  - *Linux*: Install webkit2gtk dependencies (`sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`).
  - *macOS*: Install Xcode Command Line Tools (`xcode-select --install`).
- **Build Core First**: The Tauri app expects the frontend build assets. Ensure you have run `npm run build` in root before launching Tauri.
