# KIN Frontend User Experience & Workspace Architecture

**Document ID:** `KIN-UX-10.0-PROD`  
**System Name:** KIN — Sovereign Local-First Autonomous Multi-Agent AI Workforce & Harness  
**Version:** `10.0.0-PRODUCTION`  
**Status:** Canonical Interface Specification, 4-Zone Spatial Layout & Interaction Guidelines  

---

## 1. Ergonomic Vision & Design Philosophy

The KIN desktop interface is engineered for maximum developer ergonomics, radical transparency, and calm productivity. Unlike chat interfaces that obscure background agent actions behind spinning spinners or command-line tools that flood terminals with uncontrollable text dumps, KIN establishes a **Spatial Engineering Workbench**.

### Core UX Principles
1. **Calm, High-Information Spatial Hierarchy:** A structured 4-zone layout keeps active projects, navigation channels, conversation stages, and deep inspection drawers logically organized and immediately accessible.
2. **Real-Time Streaming Transparency:** Tool executions, extended reasoning (thinking tokens), and policy gates are rendered as compact, interactive cards inline in the stream, expanding on demand.
3. **Frictionless Human-in-the-Loop Interventions:** Approvals, conflict resolutions, and browser takeovers do not break the developer's flow; they surface as clean, actionable banners with one-click resolutions.
4. **Responsive & Collapsible Layout:** On wide multi-monitor setups, all four zones can remain open; on compact laptop screens (<1200px), secondary inspectors collapse smoothly into drawers, preserving full width for code and conversation.
5. **Universal Keyboard Navigability:** Every primary workflow, project switch, agent mention, and approval decision is accessible via intuitive keyboard shortcuts without requiring mouse interaction.

---

## 2. The 4-Zone Desktop Workbench Layout

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP HUD BAR (36px): Project: kin-core | Active: 3 | Spend: $1.42 / $10 | Sandbox: S2 | 🛑 │
├──────────────┬──────────────────┬─────────────────────────────────┬──────────────────────┤
│ ZONE 1 (60px)│ ZONE 2 (240px)   │ ZONE 3 (Flex >= 520px)          │ ZONE 4 (380px-560px) │
│ Project Rail │ Workspace Nav    │ Primary Stage                   │ Inspector & Review   │
│              │                  │                                 │ Drawer (Collapsible) │
│ [P1] ●       │ ▾ CHANNELS       │ #backend  [@backend @architect] │[Thr][Diff][DAG][Run][Mem][Sec]│
│ [P2] ▲       │   #general       │ ─────────────────────────────── │                      │
│ [P3]         │   #architecture  │ User: Add Redis rate-limiter    │ Lane: wkt_01J9...    │
│ [+]          │   #backend     ● │                                 │ Status: Verified ✓   │
│              │   #qa            │ @backend [Run #42 • sonnet]     │                      │
│              │   #ops-alerts    │  ▸ Thinking (1.2s)              │ ▾ src/limiter.rs     │
│              │ ▾ DIRECT MSGS    │  ▸ [fs_read] src/middleware.rs  │   @@ -12,4 +12,18 @@ │
│              │   @boss        ● │  ▸ [fs_patch] src/limiter.rs    │   + pub struct ...   │
│              │   @architect     │  ▸ [shell_exec] cargo test ✓    │   [Stage Hunk]       │
│              │   @backend       │  Ready for review in wkt_01J9.  │                      │
│              │ ▾ AGENT↔AGENT    │  [Inspect Diff (2 files, +64)]  │ [Apply to Root]      │
│              │   @fe ↔ @be (2)  │ ─────────────────────────────── │ [Request Changes]    │
│ ──────────── │ ▾ GOALS & SCHED  │ [Message #backend, @agent, /cmd]│ [Revert Last Apply]  │
│ [⚙] [🛡]     │   ▸ Auth v2 (4/6)│ [Mode: AUTO ▾] [Slot: Coder ▾]  │                      │
└──────────────┴──────────────────┴─────────────────────────────────┴──────────────────────┘
```

---

## 3. Zone Breakdown & Interactive Components

### 3.1 Top HUD Bar (Height: `36px`)
The top global bar provides persistent operational telemetry across the active workspace:
- **Project Badge:** Active project name and trust status icon (`Trusted` / `Restricted`).
- **Active Runs Counter:** Number of agents currently executing tasks in worktree lanes.
- **Spend & Budget Indicator:** Real-time token spend vs. daily project budget limit (e.g., `$1.42 / $10.00`). Warns in amber at 80%, turns red and halts at 100%.
- **Sandbox Level Badge:** Displays active OS isolation level (`S0`, `S1`, `S2`, `S3`).
- **Panic Stop Button (`🛑`):** Instant global kill switch (`Cmd/Ctrl+Shift+Escape`) that immediately cancels all in-flight agent runs and halts background PTY commands.

### 3.2 Zone 1: Project Rail (Width: `60px`)
A vertical icon rail positioned on the far left:
- **Project Avatars:** Visual badges for all loaded projects.
- **Live Status Rings:**
  - *Green Pulse:* Agents actively executing work.
  - *Amber Solid:* Action paused waiting for human approval.
  - *Red Alert:* Build error, test failure, or circuit breaker trip.
  - *Gray Neutral:* Idle project.
- **Add Project Button (`+`):** Opens directory picker to onboard a new workspace.
- **Settings & Audit Ledger Links:** Direct shortcuts to global configuration and cryptographic ledger inspector.

### 3.3 Zone 2: Workspace Navigator (Width: `240px`, Resizable `180px`–`340px`)
The departmental navigation center for the active project:
- **Section 1: Channels:** Lists public collaboration channels (`#general`, `#backend`, `#frontend`, `#qa`). Displays unread count and active typing dots.
- **Section 2: Direct Messages (Human↔Agent):** 1-on-1 private threads with `@boss` or specific specialists.
- **Section 3: Agent↔Agent DMs (Audit Mode):** Collapsible list of active agent-to-agent coordination threads. Marked with a confidential lock icon; clicking allows the human operator to inspect the full transcript in read-only audit mode.
- **Section 4: Active Goals & Schedules:** Real-time progress bars for active Goal DAGs (e.g., `Auth Migration (4/6 tasks complete)`) and scheduled cron routines.

### 3.4 Zone 3: Primary Stage (Width: `flex-1`, Minimum `520px`)
The central workspace where conversation, reasoning, and live collaboration occur:
- **Header Bar:** Channel title, assigned members list, topic description, and an **Inspector Toggle Button** (`PanelRightClose` / `PanelRight`) to expand or collapse Zone 4.
- **Virtualized Message Stream:** 60 FPS smooth scrolling powered by `@tanstack/react-virtual`, rendering hundreds of messages and streaming tokens without DOM lag.
- **Streaming Run Cards:**
  - *Thinking Accordion:* Collapsible drawer displaying extended reasoning tokens.
  - *Tool Call Pills:* Interactive badges showing tool invocations (e.g., `[fs_read] src/lib.rs`). Clicking reveals full input arguments and output previews.
  - *Inline LSP Badge:* Displays live compiler diagnostics and syntax errors detected immediately after code patches.
  - *Approval Request Banner:* Surfaces when an agent requires operator permission, displaying risk level, exact command, and `[Approve]` / `[Deny]` buttons.
- **Multimodal Composer:**
  - Full markdown support with syntax highlighting.
  - `@` autocomplete: Mentions specific agents (`@backend`) or roles (`@engineering`).
  - `#` autocomplete: References channels.
  - `/` autocomplete: Triggers slash commands (`/goal`, `/task`, `/meet`, `/hire`, `/diff`).
  - `!` autocomplete: Inserts symbols or file path references with live AST grounding.

### 3.5 Zone 4: Context Inspector & Review Drawer (Width: `380px`–`560px`, Collapsible)
A multi-tabbed utility panel toggled via `Cmd/Ctrl+\`:
- **Tab 1: Thread Drawer:** Contextual side-thread for diving into sub-conversations without cluttering the main channel.
- **Tab 2: Diff & Merge Queue:** Side-by-side or unified diff viewer showing pending agent modifications in their isolated worktree. Features:
  - Per-file and per-hunk review checkboxes.
  - `[Apply to Root]` button to trigger atomic 3-way merge.
  - `[Revert Last Apply]` button to roll back previous merges.
- **Tab 3: Goals & Task DAG:** Visual graph powered by `xyflow` showing the topological dependency tree of tasks, live lease owners, and execution status.
- **Tab 4: Run Trace, PTY & Browser Live View:**
  - Interactive terminal emulator connected to the agent's worktree PTY.
  - Live CDP browser view with the **Take Over Browser** / **Hand Back** banner.
- **Tab 5: Memory & Context X-Ray:** Displays the real-time token breakdown across all 9 prompt layers and highlights quarantined memory claims.
- **Tab 6: Security & Audit Ledger:** Real-time feed of the cryptographic BLAKE3 append-only ledger and MCP integration status toggles.

---

## 4. Primary Interactive Modals & Workflow Banners

### 4.1 Workspace Trust Gate Modal
- **Trigger:** First open of an existing local directory containing `.kin/`, build hooks, or MCP configurations.
- **UX Layout:** Clean security card displaying repository path, detected MCP servers, and BLAKE3 configuration hash.
- **Choices:**
  - `[Open in Restricted Mode]`: Read-only exploration; all tool execution and MCP servers disabled.
  - `[Trust Workspace & Enable Full Features]`: Authorizes full local execution according to project autonomy ceiling.

### 4.2 Browser Takeover Banner
- **Trigger:** Agent browser encounters a login page, CAPTCHA, or 2FA challenge.
- **UX Layout:** Amber banner pinned across Zone 3 and Zone 4:
  ```text
  ┌────────────────────────────────────────────────────────────────────────┐
  │ ⚠️ AGENT PAUSED: Authentication or CAPTCHA Detected                   │
  │ Agent @researcher requires manual human authentication on github.com.  │
  │ [Take Over Browser]                           [Abort Agent Run]        │
  └────────────────────────────────────────────────────────────────────────┘
  ```
- **Action:** Clicking "Take Over Browser" grants the human keyboard and mouse control over the live webview. Upon successful login, the operator clicks "Hand Back to Agent", and the agent resumes autonomously.

### 4.3 Autonomous Meeting Agenda & Minutes Modal
- **Trigger:** Initiated via `/meet` command or autonomously by `@boss`.
- **UX Layout:** Form allowing selection of topic, participating agents (2 to 6), discussion mode (`moderated`, `round_robin`, `debate`), and round count.
- **During Meeting:** Messages flow with distinct round indicators. Concludes with a highlighted **Decision Record** card authored by `@boss` that automatically exports action items into the Task DAG.

---

## 5. Universal Keyboard Shortcuts & Navigation

| Key Combination | Action Scope | Function |
| :--- | :--- | :--- |
| **`Cmd/Ctrl + K`** | Global | Opens the Universal Command Palette |
| **`Cmd/Ctrl + \`** | Global | Toggles the Zone 4 Inspector & Review Drawer |
| **`Cmd/Ctrl + 1..9`** | Global | Instantly switches active project (Hydrates in <150ms) |
| **`Cmd/Ctrl + Shift + Escape`** | Global | **PANIC STOP:** Aborts all running agents and PTYs |
| **`Cmd/Ctrl + Enter`** | Composer | Sends message / executes prompt |
| **`Escape`** | Modal / Drawer | Dismisses active modal or collapses inspector drawer |
| **`Up / Down Arrow`** | Composer | Navigates command history |
| **`Tab` / `Shift + Tab`** | Stream | Cycles roving keyboard focus across approval buttons and tool pills |

---

## 6. Accessibility & Theme System

- **WCAG 2.2 AA Compliance:** High-contrast text ratios (minimum 4.5:1 for normal text, 7:1 for headers).
- **Roving Tabindex:** Full keyboard focus trapping within modals and sequential navigation across message tool cards.
- **Screen Reader Support:** ARIA live regions (`aria-live="polite"`) announce background run completions, tool errors, and incoming human approval requests.
- **Reduced Motion:** Fully honors system `prefers-reduced-motion` settings, disabling non-essential CSS transitions and spring physics.
- **Themes:** Ships with tailored **Midnight Slate** (Dark mode default), **Monokai High Contrast**, and **Paper Daylight** (Light mode).
