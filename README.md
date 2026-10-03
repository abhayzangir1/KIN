<div align="center">

<img src="docs/assets/logo.png" alt="KIN Platform Logo" width="280" />

# KIN

**The Autonomous Local-First Multi-Agent Workforce Platform**

*Orchestrate collaborative specialist agent teams directly on your physical workstation with authoritative local state, turn-by-turn crash recovery, dynamic hardware governors, and governed desktop/browser automation.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb.svg?style=flat-square&logo=react)](https://react.dev/)
[![Tauri](https://img.shields.io/badge/Tauri-2.2-FFC131.svg?style=flat-square&logo=tauri)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584.svg?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![SQLite](https://img.shields.io/badge/SQLite_3-WAL_Mode-003B57.svg?style=flat-square&logo=sqlite)](https://www.sqlite.org/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_Inference-white.svg?style=flat-square&logo=ollama)](https://ollama.ai/)
[![Vitest](https://img.shields.io/badge/Tests-117%2F117_Passed-success.svg?style=flat-square&logo=vitest)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

[Architecture Guide](docs/ARCHITECTURE.md) • [Product Specifications](docs/PRD.md) • [Technical Requirements](docs/TRD.md) • [Native Installation](#-native-desktop-installation--packaging) • [Quick Start](#-quick-start)

---

</div>

## 🌟 Product Core & Vision

### Product Core
**KIN** is an autonomous, local-first engineering workforce platform. Instead of routing your code, proprietary context, and development tasks through opaque cloud wrappers, KIN executes multi-agent workflows directly on your workstation. It combines **local SQLite persistence**, **turn-by-turn execution checkpointing**, **hardware resource governors**, and **governed desktop and browser automation** into a cohesive engineering environment.

### Vision & Engineering Philosophy
- **Local State Authority**: All tasks, channel messages, execution checkpoints, memories, and API credentials live in an ACID-compliant local SQLite database with Write-Ahead Logging (`WAL` mode).
- **Crash Resilience Without Data Loss**: Every reasoning turn and tool action persists to an immutable checkpoint. When interrupted by an unexpected power loss, system reboot, or process kill, in-flight runs can be resumed from the exact recorded turn.
- **Hardware-Aware Autonomy**: Dynamic governors inspect available system RAM (`os.freemem()`) before spawning heavy processes, and physical input mutexes serialize mouse and keyboard interactions to prevent collisions.
- **Deterministic Multi-Agent Collaboration**: Specialists claim tasks through atomic leases, work in isolated git worktrees, and communicate over structured channels without goal drift.

---

## 💼 Real-World Use Cases

1. **Full-Lifecycle Software Engineering**:
   - Deconstruct complex epics into sequential milestone DAG tasks with `/plan`.
   - Provision isolated git worktrees for parallel feature implementations.
   - Run automated peer reviews on changed files with `@Boss` and execute test suites locally.
2. **Web & Communications Automation**:
   - Execute browser tasks across social platforms, documentation sites, Slack, or Discord using persistent browser sessions that preserve logins and cookies.
   - Extract reference data, verify web applications, and interact with web portals under operator oversight.
3. **Hardware-Governed Desktop Control**:
   - Automate local GUI applications, inspect active windows, and execute coordinate-mapped keyboard and mouse actions.
   - Gate sensitive actions (such as checkout, billing, and credential retrieval) behind mandatory human approval barriers.
4. **Proactive Timed Execution & Recurring Routines**:
   - Establish non-busy-polling timers with `/schedule` and recurring cron maintenance routines with `/routine` to perform automated repository audits and health checks.

---

## ⚡ Core Capabilities & Priority Architecture

Features are ordered below according to their system hierarchy and architectural dependencies:

```text
1. Storage & State Layer (SQLite 3 WAL + Turn-by-Turn Checkpointing)
   └── 2. Process & Hardware Governors (Tauri Supervisor + RAM Governor + Mutex)
        └── 3. Context Compiler & Goal Ancestry (5-Block Context Pipeline)
             └── 4. Model Gateway & Quota Guard (Ollama Local + OpenRouter Cloud)
                  └── 5. Tool Gateway & Sandboxing (OCC File Integrity + Git Worktrees)
                       └── 6. Multi-Agent Coordination (Atomic Leases + Specialist Routing)
                            └── 7. Computer & Browser Automation (Persistent Profiles + Win32 Lock)
                                 └── 8. Slash Command Engine (Unified & Compound Pipelines)
                                      └── 9. Reactive User Interface (SSE Bus + Swarm Map)
```

### 1. Authoritative State & Turn-by-Turn Checkpointing
- **Immutable Turn Snapshots**: Every tool call and reasoning step in `agent_loop.ts` commits an atomic snapshot to the SQLite `agent_checkpoints` table.
- **Crash Recovery Supervisor**: Upon restart after an abnormal shutdown, KIN reconciles stale leases and presents an interactive **Docked Crash Recovery Banner** in the UI with options to **Resume All**, **Inspect State**, or **Discard**.

### 2. Hardware Resource Governors & Input Mutex
- **RAM-Aware Process Throttling**: Queries `os.freemem()` before allocating browser contexts or shell processes. If available memory drops below 500 MB, execution tasks are queued to avoid host thrashing.
- **Win32 `DesktopLock` Mutex**: Serializes mouse and keyboard inputs across agents through a single-flight Promise mutex, preventing conflicting inputs.

### 3. The 5-Block Context Compiler
- Synthesizes the active workspace state into an structured prompt before every reasoning turn:
  1. *Agent Identity*: Specialist role, system prompt, and domain authorities.
  2. *Goal Ancestry*: `Workspace -> Project -> Goal -> Task -> Run` hierarchy.
  3. *Project Rules & ADRs*: Invariant rules and architectural decision records.
  4. *Long-Term Memory*: Relevant semantic memories and continuous learning experiences.
  5. *Tool Schemas & OCC Hashes*: Tool parameters and baseline SHA-256 hashes for file integrity.

### 4. Model Gateway & HTTP 429 Quota Guard
- **Dual-Engine Inference**: Native local inference via **Ollama** (`qwen2.5-coder`, `llama3.2`) and cloud models via **OpenRouter** (Anthropic, OpenAI, DeepSeek, Google Gemini).
- **Non-Destructive Quota Pause**: Intercepts HTTP 429 rate-limit responses, checkpoints in-flight progress, displays a live reset countdown in the UI, and enables instant failover to local Ollama with no loss of context.

### 5. Tool Gateway & Git Worktree Confinement
- **Optimistic Concurrency Control (OCC)**: Validates SHA-256 file hashes before write operations to prevent stale-write conflicts.
- **Strict Directory Sandboxing**: Verifies that all filesystem operations remain confined within the project boundary; directory traversal (`../../`) attempts are blocked.
- **Isolated Git Worktrees**: Automatically provisions isolated worktrees (`.kin/worktrees/<task-id>`) so agents can build and test without stepping on each other's changes.

### 6. Multi-Agent Coordination & Atomic Task Leases
- **Distributed Leases**: Tasks are claimed atomically (`claimed_by_run_id` and `lease_expires_at`) to eliminate race conditions among concurrent workers.
- **Specialist Roster**: Direct tasks to specialized agent identities (`@Boss`, `@Frontend`, `@Backend`, `@Architect`) with custom system prompts and domain authorities.

### 7. Governed Computer & Browser Automation
- **Persistent Partitioned Profiles**: Chromium sessions run with agent-specific directories (`.kin/browser_profiles/<agentId>`) that retain logins, cookies, and local storage, with a 3-minute idle eviction policy.
- **Financial Safety Shield**: Detects payment, billing, and checkout interactions as `CRITICAL_RISK`, requiring explicit human confirmation before execution.

### 8. Antigravity Slash Command Suite
- **`/plan <topic>`**: Decomposes objectives into milestone DAG tasks with dependency chaining.
- **`/boost <target>`**: Runs git porcelain checks, verifies SQLite WAL metrics, and activates high-autonomy verification.
- **`/teamwork-preview`**: Displays active specialists, assigned channels, and local Ollama model readiness.
- **`/goal <title> [| desc] [| criteria]`**: Adds persistent goals with acceptance criteria.
- **`/schedule <duration> [prompt]`**: Sets a non-busy-polling timer that wakes the agent when the duration elapses.
- **`/routine <interval | cron> [prompt]`**: Configures periodic cron routines for proactive background operations.
- **`/btw <query>`**: Non-blocking side queries answered immediately without creating DAG tasks.
- **`/grill-me [topic]`**: Launches an interactive architectural questionnaire and records decisions as ADRs.
- **`/decisions` or `/adr`**: Lists or proposes Architectural Decision Records.
- **`/skills`**: Displays registered skills and capability extensions.
- **`/hire <role> [name]`**: Registers a new specialist agent definition and identity.
- **Compound Pipelines**: Supports chained commands (e.g. `/plan /boost /teamwork-preview /goal`).

---

## 📸 Interface Tour

<div align="center">

### 1. Unified Master Workbench
![Master Workbench](docs/assets/screenshots/01_app_interface_workbench.png)
*Central workspace featuring real-time agent output streaming, channel-based collaboration, task trees, and the unified slash-command prompt.*

---

### 2. Interactive Swarm Map
![Swarm Map Topology](docs/assets/screenshots/02_swarm_map_topology.png)
*Interactive graph rendering active specialists, message delegation flows, task dependency DAGs, and real-time swarm convergence.*

---

### 3. Settings & Credential Vault
![Settings and Credentials](docs/assets/screenshots/03_settings_and_credentials.png)
*Manage OpenRouter, Anthropic, OpenAI, and local Ollama inference settings, alongside memory governor thresholds and token spend caps.*

---

### 4. Agent Inspector & Teamwork Matrix
![Agent Inspector and Teamwork](docs/assets/screenshots/04_agent_inspector_teamwork.png)
*Detailed agent drawer displaying role definitions, assigned channels, execution histories, evaluation metrics, and team collaboration status.*

---

### 5. Docked Crash Recovery Banner
![Crash Recovery Banner](docs/assets/screenshots/05_crash_recovery_banner.png)
*Crash recovery prompt alerting the operator to interrupted runs following a system restart, with 1-click **Resume All**, **Inspect State**, and **Discard** options.*

---

### 6. HTTP 429 Quota Guard & Local Fallback
![Quota Pause Banner](docs/assets/screenshots/06_quota_pause_banner.png)
*Quota pause banner displaying a live countdown to rate-limit reset, a **Resume Now** action, and 1-click failover to local **Ollama** models.*

---

### 7. Architectural Decision Records (ADR) & `/grill-me`
![Decisions and ADR](docs/assets/screenshots/07_decisions_and_adr.png)
*Decision log tracking design rationale, trade-offs, and interactive questionnaire responses recorded during `/grill-me` requirement alignment sessions.*

---

### 8. Governed Desktop & Browser Automation
![Desktop and Web Control](docs/assets/screenshots/08_desktop_and_web_control.png)
*Computer control interface showing Win32 `DesktopLock` input serialization, persistent browser sessions, and coordinate-mapped desktop actions.*

</div>

---

## 💻 Native Desktop Installation & Packaging

KIN includes native desktop shell configurations powered by **Tauri 2** and **Rust**. This allows building self-contained desktop applications across Windows, macOS, and Linux.

### System Prerequisites
- **Node.js**: v20.x or higher
- **Rust & Cargo**: v1.78 or higher (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` on Unix, or `rustup` on Windows)
- **C++ Build Tools**:
  - *Windows*: Visual Studio Build Tools (C++ workload)
  - *macOS*: Xcode Command Line Tools (`xcode-select --install`)
  - *Linux*: Standard build toolchain (`build-essential`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`)

---

### 1. Windows Native Package (`.exe` / `.msi`)

To build the standalone Windows executable and installer:
```powershell
# 1. Install dependencies and build web assets
npm install
npm run build

# 2. Build native release bundle
npm run tauri:build
```
**Output Artifacts:**
- Portable Executable: `src-tauri/target/release/kin-desktop.exe`
- Windows Installer: `src-tauri/target/release/bundle/msi/KIN_0.1.0_x64_en-US.msi`
- NSIS Installer: `src-tauri/target/release/bundle/nsis/KIN_0.1.0_x64-setup.exe`

---

### 2. macOS Native Package (`.dmg` / `.app`)

To build the macOS application bundle:
```bash
# 1. Install dependencies and build assets
npm install
npm run build

# 2. Build native macOS bundle
npm run tauri:build
```
**Output Artifacts:**
- Application Bundle: `src-tauri/target/release/bundle/macos/KIN.app`
- Apple Disk Image: `src-tauri/target/release/bundle/dmg/KIN_0.1.0_universal.dmg`

---

### 3. Linux Native Package (`.AppImage` / `.deb`)

On Debian/Ubuntu systems:
```bash
# 1. Install system prerequisites
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev

# 2. Install project dependencies and build assets
npm install
npm run build

# 3. Build native Linux packages
npm run tauri:build
```
**Output Artifacts:**
- Universal AppImage: `src-tauri/target/release/bundle/appimage/kin_0.1.0_amd64.AppImage`
- Debian Package: `src-tauri/target/release/bundle/deb/kin_0.1.0_amd64.deb`

---

## 🚀 Quick Start (Development Mode)

If you prefer running KIN directly in development mode without building native binaries:

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/abhayzangir1/KIN.git
cd KIN
npm install
```

### 2. Build Workspaces
```bash
npm run build
```

### 3. Run Automated Vitest Test Suite
```bash
npm test --workspace=core
# Output: Test Files 11 passed (11) | Tests 117 passed (117)
```

### 4. Launch Core Server Daemon & Web Interface
Open two terminal windows:

**Terminal 1 (Core Server Daemon):**
```bash
npm run daemon --workspace=core
# Listening on http://127.0.0.1:54321
```

**Terminal 2 (React UI Dev Server):**
```bash
npm run dev --workspace=ui
# Serving at http://localhost:5173
```

Navigate to `http://localhost:5173` to access the workbench.

---

## 🛡️ Security, Privacy & Confinement

1. **Local Data Confinement**: Project databases, task records, and execution logs remain on local storage (`kin_storage.sqlite`). No user data is transmitted to analytics or telemetry endpoints.
2. **Filesystem Boundaries**: File tools enforce path verification against project directory roots. Path traversal sequences (`../`) are detected and rejected.
3. **Optimistic Concurrency Control**: SHA-256 baseline hashing prevents concurrent tasks from overwriting modified files.
4. **Governed Automation**: Potentially destructive terminal commands and sensitive browser actions require operator confirmation.

---

## 📜 License

KIN is released under the [MIT License](LICENSE).
