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
[![Vitest](https://img.shields.io/badge/Tests-206%2F206_Passed-success.svg?style=flat-square&logo=vitest)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

[Architecture](docs/ARCHITECTURE.md) • [API Reference](docs/API.md) • [Skills Guide](docs/SKILLS_GUIDE.md) • [Slash Commands](docs/SLASH_COMMANDS.md) • [Tutorials](docs/TUTORIALS.md) • [Operations](docs/OPERATIONS.md) • [Troubleshooting](docs/TROUBLESHOOTING.md) • [Contributing](docs/CONTRIBUTING.md) • [FAQ](docs/FAQ.md) • [PRD](docs/PRD.md) • [TRD](docs/TRD.md)

---

</div>

## 🌟 Product Core & Vision

### Product Core
**KIN** is a sovereign, local-first autonomous AI workforce and multi-agent coordination platform. Unlike cloud wrappers or single-purpose bots, KIN empowers you to **swarm any type of autonomous agent for any task** directly on your local workstation — from deep research, operations, and daily personal routines to social media management, data analysis, and software engineering.

KIN pairs **authoritative local SQLite persistence** with **turn-by-turn crash recovery**, **hardware-aware dynamic RAM governors**, and **governed desktop & browser automation** into a cohesive, private desktop environment.

### Vision & Core Philosophy
- **Universal Multi-Task Swarms**: You are not limited to one domain. Hire, configure, and coordinate specialist agent teams for research, operations, daily personal routines, web automation, content drafting, or full-stack development.
- **Local Sovereignty & Zero Cloud Lock-In**: All messages, tasks, goals, memories, checkpoints, and credentials reside on your own machine in SQLite with Write-Ahead Logging (`WAL` mode). Zero telemetry is transmitted to third parties.
- **Crash Resilience Without Data Loss**: Every reasoning turn and tool invocation commits an immutable checkpoint. Following unexpected power loss or process termination, interrupted runs resume from their exact recorded state.
- **Hardware-Aware Autonomy**: Dynamic governors continuously monitor host RAM before dispatching heavy processes, while a Win32 `DesktopLock` mutex serializes mouse and keyboard inputs to prevent collisions.
- **Zero Cloud Subscriptions Required**: Run completely offline with local **Ollama** models, or connect to any cloud LLM provider (OpenRouter, Anthropic, OpenAI, Gemini) using your own keys (BYOK) with token spend caps.

---

## ⚡ The Sovereign Alternative to ChatGPT Dots, Grok Bots & OpenDots

Recent industry advancements have introduced persistent "always-on" agent concepts like **ChatGPT Dots** (OpenAI), **Grok Bots** (xAI), and **OpenDots**. Here is how KIN fundamentally differentiates:

| Dimension | ChatGPT Dots (OpenAI) | Grok Bots (xAI) | OpenDots (CopilotKit) | **KIN (Autonomous Workforce Platform)** |
|---|---|---|---|---|
| **Architecture** | Proprietary cloud microservices | Proprietary cloud service | Cloud/server-centric template | **Local-First Native Desktop (Tauri 2 + Rust + Node)** |
| **Data Privacy** | All files, prompts, and actions stored on OpenAI servers | Stored on xAI cloud servers | Depends on deployment server | **Fully Sovereign: Local SQLite WAL on your disk** |
| **Cost & Gating** | Gated behind $200/mo Pro / Enterprise | Gated behind xAI subscription tiers | Self-hosted infrastructure costs | **Free & Open Source (MIT). $0 subscription.** |
| **Offline Operation** | Impossible (requires continuous cloud connection) | Impossible (cloud only) | Requires running server | **Native Offline Execution with local Ollama models** |
| **Crash Recovery** | Server-side restart; context wiped on session drop | Managed in cloud | Application-level | **Turn-by-Turn SQLite Checkpointing & Instant Resumption** |
| **Hardware Governors** | None (cloud compute) | None (cloud compute) | Manual server sizing | **Dynamic Host RAM Governor** |
| **Physical Computer Use**| Virtual cloud browser sandbox | Cloud agent tool calls | Virtual cloud environment | **Governed Real Desktop & Browser Control (Win32 Mutex + Human Takeover)** |
| **Autonomy Modes** | Fixed provider guardrails | Fixed provider policy | Developer-configured | **Fine-Grained: `AUTO`, `ALWAYS_ASK`, `FULL_ACCESS`** |

---

## 🚀 1-Click Quickstart (Zero Friction)

### 📦 Direct Desktop Downloads (Pre-Built Releases)
Download pre-compiled binaries directly from [GitHub Releases v0.1.0](https://github.com/abhayzangir1/KIN/releases/tag/v0.1.0) with zero build configuration:
- **Portable Standalone Executable**: [`KIN.exe`](https://github.com/abhayzangir1/KIN/releases/download/v0.1.0/KIN.exe) — Run immediately without installation.
- **Windows Setup Installer**: [`KIN_Installer.exe`](https://github.com/abhayzangir1/KIN/releases/download/v0.1.0/KIN_Installer.exe) — Standard NSIS setup wizard.
- **Enterprise Windows MSI**: [`KIN_0.1.0_x64.msi`](https://github.com/abhayzangir1/KIN/releases/download/v0.1.0/KIN_0.1.0_x64.msi) — Windows Installer package.
- **Clean Source Archive**: [`KIN.zip`](https://github.com/abhayzangir1/KIN/releases/download/v0.1.0/KIN.zip) — Complete clean source code package (4.5 MB).

---

### Source 1-Click Launch

#### Windows (1-Click Launch)
Double-click `start.bat` in the repository root, or run in PowerShell:
```powershell
.\start.bat
```
*Automatically verifies Node.js, installs dependencies, builds workspaces, starts Ollama if present, and launches the KIN Core daemon and UI at `http://localhost:5173`.*

#### macOS / Linux (1-Click Launch)
Run the launch script in your terminal:
```bash
chmod +x start.sh
./start.sh
```

---

## 💼 Multi-Domain Workforces (Swarm Any Agent For Any Task)

Users can swarm arbitrary specialist agents tailored to specific real-world domains:

1. **Deep Research & Intelligence Swarms**:
   - Swarm multi-agent teams to synthesize technical literature, extract structured insights from documents, track competitors, and compile executive briefings.
2. **Proactive Daily Routines & Personal Automations**:
   - Configure background routines with `/routine` (e.g. morning calendar digests, repository health checks, inbox summaries) and non-blocking timers with `/schedule`.
3. **Governed Web & Social Platform Automation**:
   - Run partitioned browser sessions that retain logins and cookies to navigate portals, verify web deployments, fill multi-step forms, and draft posts on GitHub, X, or LinkedIn with human oversight.
4. **Strategic Executive & Product Planning**:
   - Conduct interactive architectural scrutiny interviews using `/grill-me`, decompose complex epics into milestone DAGs with `/plan`, and track persistent objectives with `/goal`.
5. **Full-Lifecycle Software Engineering & Data Analysis**:
   - Provision isolated git worktrees, execute local build and test suites, run automated peer reviews with `@Boss`, and debug code in parallel worktrees without merge conflicts.

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
                                 └── 8. Persistent Skills Engine (SKILL.md + Dynamic Creation & Import)
                                      └── 9. Sentinel Security Boundary (Hierarchical Attenuation & Redaction)
                                           └── 10. Origin-Aware Goals & Replanning (Interactive DecisionCards)
                                                └── 11. Slash Command Engine (Unified & Compound Pipelines)
                                                     └── 12. Reactive User Interface (SSE Bus + Swarm Map)
```

### 1. Authoritative State & Turn-by-Turn Checkpointing
- **Immutable Turn Snapshots**: Every tool call and reasoning step in `agent_loop.ts` commits an atomic snapshot to the SQLite `checkpoints` table.
- **Crash Recovery Supervisor**: Upon restart after an abnormal shutdown, KIN reconciles stale leases and presents an interactive **Docked Crash Recovery Banner** in the UI with options to **Resume All**, **Inspect State**, or **Discard**.

### 2. Hardware Resource Governors & Input Mutex
- **RAM-Aware Process Throttling**: Evaluates free system memory before allocating browser contexts or shell processes using adaptive concurrency tiers: `low` (<2.5 GB free: 1 browser, 1 shell), `medium` (2.5–6.0 GB free: 2 browsers, 2 shells), and `high` (>6.0 GB free: 3 browsers, 4 shells). If free memory falls critically low (<300 MB), execution tasks are delayed to prevent host thrashing.
- **Win32 `DesktopLock` Mutex**: Serializes mouse and keyboard inputs across agents through a single-flight Promise mutex, preventing conflicting inputs.

### 3. The 5-Block Context Compiler
- Synthesizes the active workspace state into a prefix-stable structured prompt before every reasoning turn:
  1. *Agent Identity & Goal Ancestry*: Specialist role, system prompt, invariants, and `Workspace -> Project -> Goal -> Task -> Run` hierarchy.
  2. *Tool Schemas (Cacheable Prefix)*: Tool parameters, names, and required attributes.
  3. *Project Grounding & ADRs*: Invariant rules, coding conventions, and architectural decision records.
  4. *Context Compaction & Long-Term Memory*: Compacted history, error repair strategies, and institutional skill recipes.
  5. *Dynamic Turn Trajectory & Step Observations*: Active messages, tool outputs, and baseline SHA-256 OCC hashes for file integrity.

### 4. Dynamic Model Gateway, Live Discovery & Quota Guard
- **Universal Provider Gateway**: Seamlessly routes reasoning requests to local **Ollama** models or external cloud providers (**Anthropic**, **OpenAI**, **Google Gemini**, **DeepSeek**, **Groq**, **OpenRouter**) using encrypted BYOK credentials.
- **Dynamic Live Model Discovery**: Automatically queries provider APIs upon credential entry or on-demand (`POST /api/models/discover`), surfacing newly released models dynamically without requiring application updates.
- **Arbitrary Model ID Assignment**: Assign any newly released or custom fine-tuned model ID (e.g. `openai/gpt-4.5-preview`, `anthropic/claude-3-7-sonnet-20250219`, `deepseek/deepseek-r1`) directly to any specialist agent.
- **Non-Destructive Quota Pause**: Intercepts HTTP 429 rate-limit responses, checkpoints in-flight progress, displays a live reset countdown in the UI, and enables instant failover to local Ollama with zero loss of context.

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

### 8. Persistent Skills Engine & Dynamic Capabilities
- **Dual SQLite & Disk Synchronization**: Every skill is persisted both in the SQLite `skills` table and on disk under `.kin/skills/<folder>/` containing standard `SKILL.md` (metadata frontmatter and instructions), `implementation.ts` handler logic, and `skill.json` parameter schemas.
- **Dynamic Skill Synthesis by Agents**: Autonomous agents can synthesize new tools during task execution using the `create_skill` tool, making custom tools immediately callable across the swarm.
- **Directory Bundle Import**: Easily import existing skill bundles from local folders via `POST /api/skills/import` or the `/skills import <directoryPath>` slash command.
- **Continuous Learning Loop**: The `LearningPipeline` records successful execution traces and extracts reusable playbooks into institutional memory.

### 9. Sentinel Security Boundary & Hierarchical Attenuation
- **Hierarchical Capability Attenuation**: `@Boss` holds lead platform authority (`*`), while specialist agents are strictly confined to their declared capability sets (e.g. `['fs:read', 'fs:write']`, `['web:browse']`, `['mcp:call']`). `Sentinel` enforces fail-closed authorization, rejecting unauthorized tool calls.
- **Secret Redaction & Token Authentication**: `SecretBroker` strips and redacts sensitive credentials from action records and operator approval prompts before SQLite storage. The daemon enforces loopback token authentication via `.kin/ipc_auth.token` to guard against unauthorized local browser access.
- **Execution Boundaries**: MCP server subprocesses receive sanitized host environments stripped of API keys, and browser controllers reject `file:` and `data:` traversal schemes without explicit administrative capability grants.

### 10. Origin-Aware Goals & Interactive Replanning
- **Enriched Goal Lifecycle**: Goals track deadlines, check-in policies, progress summaries, blocked states, and origin channels in SQLite.
- **DM Boundary Elevation**: Cross-cutting or shared project objectives initiated in direct messages are elevated to `#general`, where `@Boss` constructs the authoritative Goal and Task DAG.
- **Interactive DecisionCards**: When agents hit blocked states or propose architectural shifts via `proposePlanAdjustment`, KIN emits an interactive `[DECISION_CARD]` in chat. The operator selects Option A, Option B, or a Compromise, and `/decisions choose` records an authoritative ADR while updating goal progress.

### 11. Antigravity Slash Command Suite

| Command | Syntax / Arguments | Purpose |
|---|---|---|
| `/plan` | `<objective>` | Decompose a high-level outcome into a directed acyclic task graph (DAG). |
| `/boost` | `<target>` | Perform git status inspection, evaluate SQLite WAL metrics, and activate deep-autonomy verification. |
| `/teamwork-preview` | *(none)* | Inspect active specialist roles, assigned communication channels, and local Ollama model readiness. |
| `/goal` | `<title> [\| desc] [\| criteria]` | Declare a top-level persistent goal with quantifiable acceptance criteria. |
| `/schedule` | `<duration> [prompt]` | Register a non-busy-polling timer (e.g. `10m`, `2h`) that triggers an agent turn upon expiry. |
| `/routine` | `<interval \| cron> [prompt]` | Establish a persistent background recurring routine (e.g. `1h`, `0 9 * * 1-5`). |
| `/btw` | `<query>` | Ask an ephemeral, non-blocking side query without creating a task in the DAG. |
| `/grill-me` | `[topic]` | Trigger an architectural interview where the agent interrogates the human and records ADRs. |
| `/decisions` or `/adr` | `[list \| propose \| choose <choice>]` | View, propose, or authoritatively select Architecture Decision Records. |
| `/skills` | `[list \| create \| import]` | Manage persistent skills. Support dynamic skill creation and directory bundle import. |
| `/hire` | `<role> [name]` | Register and configure a new specialist agent identity. |

- **Compound Pipelines**: Slash commands can be chained into atomic compound pipelines (e.g. `/plan /boost /teamwork-preview /goal Architecture Scrutiny | High assurance build`). The engine parses sub-commands sequentially, executes setup phases, and provisions tasks without human intervention.

---

## 📸 Interface Tour

<div align="center">

### 1. Unified Master Workbench
![KIN Master Workbench interface showing channel messages, task tree, and agent status](docs/assets/screenshots/01_app_interface_workbench.png)
*Central workspace featuring real-time agent output streaming, channel-based collaboration, task trees, and the unified slash-command prompt.*

---

### 2. Interactive Swarm Map
![Interactive Swarm Map showing real-time agent topology, message routes, and task dependencies](docs/assets/screenshots/02_swarm_map_topology.png)
*Interactive graph rendering active specialists, message delegation flows, task dependency DAGs, and real-time swarm convergence.*

---

### 3. Settings & Credential Vault
![Settings modal showing local Ollama configuration, OpenRouter BYOK credentials, and memory limits](docs/assets/screenshots/03_settings_and_credentials.png)
*Manage OpenRouter, Anthropic, OpenAI, and local Ollama inference settings, alongside memory governor thresholds and token spend caps.*

---

### 4. Agent Inspector & Teamwork Matrix
![Agent Inspector drawer displaying specialist prompt, tool capabilities, and channel assignments](docs/assets/screenshots/04_agent_inspector_teamwork.png)
*Detailed agent drawer displaying role definitions, assigned channels, execution histories, evaluation metrics, and team collaboration status.*

---

### 5. Docked Crash Recovery Banner
![Docked Crash Recovery Banner alerting operator to interrupted runs with 1-click resumption](docs/assets/screenshots/05_crash_recovery_banner.png)
*Crash recovery prompt alerting the operator to interrupted runs following a system restart, with 1-click **Resume All**, **Inspect State**, and **Discard** options.*

---

### 6. HTTP 429 Quota Guard & Local Fallback
![HTTP 429 Quota Guard banner displaying live rate-limit reset countdown and local Ollama failover](docs/assets/screenshots/06_quota_pause_banner.png)
*Quota pause banner displaying a live countdown to rate-limit reset, a **Resume Now** action, and 1-click failover to local **Ollama** models.*

---

### 7. Architectural Decision Records (ADR) & `/grill-me`
![Architectural Decision Records log and interactive questionnaire interface](docs/assets/screenshots/07_decisions_and_adr.png)
*Decision log tracking design rationale, trade-offs, and interactive questionnaire responses recorded during `/grill-me` requirement alignment sessions.*

---

### 8. Governed Desktop & Browser Automation
![Desktop and Web Control dashboard showing Win32 input mutex state and browser session trajectory](docs/assets/screenshots/08_desktop_and_web_control.png)
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
# Output: Test Files 13 passed (13) | Tests 161 passed (161)
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
2. **Sentinel Security Boundary & Attenuation**: Every tool execution passes through `Sentinel`. While `@Boss` retains platform authority (`*`), specialist agents are strictly confined to their declared capability sets. Unauthorized tool invocations fail closed.
3. **Secret Vault & Payload Redaction**: Sensitive credentials in `managed_credentials` are encrypted with AES-256-GCM. Tool execution parameters and approval payloads are automatically sanitized by `SecretBroker` before database persistence.
4. **Loopback IPC Token Authentication**: Port 54321 enforces bearer token authentication via `.kin/ipc_auth.token`, preventing unauthorized scripts or browser tabs from accessing core endpoints.
5. **Subprocess & Browser Isolation**: Subprocesses spawned by MCP clients run in sanitized environments stripped of host API keys. Browser controllers reject `file:` and `data:` scheme traversals without explicit administrative permission.
6. **Filesystem Boundaries & OCC**: File tools enforce path verification against project directory roots. Path traversal sequences (`../`) are blocked, and SHA-256 baseline hashing prevents concurrent overwrites.
7. **Governed Automation & Approval Tokens**: Destructive terminal commands and sensitive browser actions require operator confirmation with single-use authorization tokens.

---

## 📜 License

KIN is released under the [MIT License](LICENSE).
