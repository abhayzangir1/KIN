# DOC-01: Product Requirements Document (PRD), Harness Superiority Matrix, Workforce Model & 4-Zone UX Architecture

| Field | Value |
| :--- | :--- |
| **Document ID** | KIN-DOC-01 (`01-PRD.md`) |
| **Suite Version** | `10.0.0-PRODUCTION` |
| **Status** | **Canonical Specification & Reference Contract Bundle** |
| **Scope** | Product Vision, Competitive Superiority Matrix, Complete `PRD-*` Requirements (`PRD-PRJ-*`, `PRD-AGT-*`, `PRD-COM-*`, `PRD-MTG-*`, `PRD-EXT-001..005`, `PRD-UX-*`), MCP-First 6 Integration Domains, 4-Category Extension Taxonomy, 5-Step Marketplace Order, 4-Zone Desktop UX Architecture, Pinned `NFR-*` Benchmark Contracts, and 14 Golden E2E Journeys (`G1`–`G14`) |

## 1. Product Vision & Head-to-Head Harness Superiority Matrix

| Harness Capability | Claude Code CLI | OpenAI Codex CLI | DeepSeek / Aider CLI | CrewAI / AutoGen / OpenClaw | KIN (`10.0.0-PRODUCTION`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Execution Topology** | Single agent + opaque sub-tasks | Single terminal agent | Single chat/edit loop | Unbounded flat swarm | **Hierarchical AI Org (`@boss` → 10+ Specialists → `agent_map_reduce` Subagents)** |
| **Turn Routing Cost** | N/A (single agent) | N/A (single agent) | N/A (single agent) | LLM router on every turn | **Stage-0 Pre-Gate + 3-Stage Deterministic Turn Arbiter (`Stage 0–3 DTA`: `< 15ms` p95 & `0` LLM tokens on Stages 0–2 covering `>= 95%` of turns; Stage-3 `fast_tool` fallback `< 5%` of turns bounded at `< 800ms` p95 / `1,500ms` timeout)** |
| **Codebase Orientation** | Blind `glob` / `grep` | Blind shell search | Static ctags RepoMap | Manual RAG | **Personalized PageRank (PPR) Call-Graph Repo-Map (L8) + `sqlite-vec` `vec0` (`< 45ms` target on 100k chunks)** |
| **File Patching & Diagnostics** | Exact `str_replace` (no inline LSP) | Patch diff (no inline LSP) | Search/replace blocks | Raw file overwrite | **4-Tier Cascade Fuzzy + AST-Anchored `fs_patch` + Zero-Turn Inline Tree-sitter/LSP Diagnostics (`< 80ms` target)** |
| **Self-Healing Verification** | Agent-optional | Agent-optional | Optional lint hook | None | **Epoch-Locked Pre-Completion Gate (`INV-017`) verifies `pre_tree_sha == post_tree_sha` around `[gates].fast_check` with SQLite-persisted `gate_fail_attempts` (`RT4-20`)** |
| **Interactive Process Control** | Stateless bash + bg jobs | Stateless shell | Stateless shell | Host subprocess | **Managed Lane-Scoped Interactive PTYs (`pty_open`/`write`/`read_ring`/`kill`) with `secret_env_handles` & Bash-AST classification** |
| **Workspace & `.git` Isolation** | Mutates live root by default | Mutates live root | Mutates live root | Mutates host root | **Self-Contained `$KIN_HOME/.../repo.git` — Zero bytes written and zero `mtime`/`ctime` changed in `<root_path>` or `<root_path>/.git`** |
| **Memory Architecture** | Flat `CLAUDE.md` | Flat `AGENTS.md` | Flat chat history | External vector DB | **4-Tier (T1–T4) × 4-Bank + Same-Scope Bi-Temporal Knowledge Graph + `scope_key`-Partitioned `vec0`** |
| **Prefix Stability & Caching** | Single-vendor cache | Single-vendor cache | Fragile prefix cache | Dynamic prompts | **9-Layer Prefix Compiler (BP1–BP2 Run-Static Byte-Identical + BP3 Append-Only, `INV-011`) + Measured Per-Provider Cache SLIs** |
| **Security & Auditability** | Terminal prompts | Seatbelt/Landlock | None | None | **9-Stage Dual-AST Policy + Batch Pre-Marking + Secret Handle Substitution + End-to-End Taint Propagation + Immutable Ledger** |

## 2. Functional Requirements: Project Lifecycle (`PRD-PRJ-*`)

- **PRD-PRJ-001 [P0] [T] True Zero-Write Root & `.git` Onboarding (`< 3.0s` on 50k LOC / 2,500 Chunks)**: Opening `<root_path>` initializes `$KIN_HOME/projects/<prj_id>/` (`0700`) and `$KIN_HOME/projects/<prj_id>/repo.git/`. If `<root_path>` is a Git repo (including `.git` pointer files for linked worktrees/submodules, `reftable` repos, and newly initialized `git init` repos with unborn `HEAD`, `ST-11`, `RT4-08`), `kin-lanes` fetches the object pack into `repo.git` inside `S2-Root-Snapshot` (making `repo.git` immune to `git gc` in `<root_path>`, `ST-09`, `RT4-06`). Zero bytes are written and zero `mtime`/`ctime` values change in `<root_path>` or `<root_path>/.git/**` (`INV-003`).
- **PRD-PRJ-002 [P0] [T] Mandatory Workspace Trust Gate**: First open of a folder containing repo-local `.kin/`, `.gitattributes`, or `[gates]` opens in **Restricted Browse Mode** (`READ_ONLY` autonomy, repo-local MCP/hooks/gates disabled) until the operator approves the **Workspace Trust Modal** (`trusted_config_hash = BLAKE3(config)`).
- **PRD-PRJ-003 [P0] [T] Instant Project Switch (`p95 < 150ms`, `RT4-23`)**: Switching projects via Zone 1 or `Cmd/Ctrl+1..9` hydrates the UI projection immediately from `ServerFrame::ProjectSnapshot { project_id, snapshot_seq, state_json }` followed by incremental `EventBatch` frames (`seq > snapshot_seq`), while background runs in up to `max_active_projects = 3` continue safely (`INV-009`).
- **PRD-PRJ-004 [P0] [T] Portable `.kin-archive.tar.zst` Export & Irreversible Cryptographic Shred (`ST-15`)**:
  - **Export/Backup**: Exports `project.db` (re-keyed under a user export passphrase), `repo.git` bundle, and sealed `.klg.zst` ledger segments (excluding OS Keychain secrets) into a signed `.kin-archive.tar.zst` archive.
  - **Cryptographic Shred**: Both `project.db` and `index.db` are encrypted under `PDK_prj` (SQLCipher), and `blobs/` under `PBK_prj` (XChaCha20-Poly1305), derived from an independent 256-bit CSPRNG `PMK_prj` stored **only** in the OS Keychain (or `$KIN_HOME/keys/<prj_id>.key`, never in `registry.db`). Shredding deletes `PMK_prj` from the OS Keychain / keyfile and unlinks `$KIN_HOME/projects/<prj_id>/`, rendering all remaining flash blocks permanently unrecoverable (`2^256`).

## 3. Functional Requirements: Workforce Hierarchy (`PRD-AGT-*`)

- **PRD-AGT-001 [P0] [T] Curated Specialist Roster & Custom Personas**: Ships with 10 specialist templates (`@architect`, `@backend`, `@frontend`, `@qa`, `@security`, `@researcher`, `@devops`, `@data`, `@writer`, `@product`) plus `@boss` (`RoleKind::Boss`, non-deletable, enforced by `idx_agents_single_boss`). Custom personas can be hired via `agent_hire` (or `EngineCommand::AgentHire`, `RT4-24`) with `custom_charter_md` and `owned_globs` up to the project team cap (`projects.max_agents_cap = 24`: `1` `@boss` + up to `15` persistent specialists + up to `8` active task-scoped/ephemeral subagents).
- **PRD-AGT-002 [P0] [T] Policy-Gated Hiring & `agent_map_reduce` Subagents**: Spawning task-scoped subagents (`spawn_depth <= 2`) via `agent_delegate` (R1) or `agent_map_reduce` (2..8 parallel lanes, R2) carves a strict subset of the parent's grants and remaining budget (`INV-006`).
- **PRD-AGT-003 [P0] [T] Immediate Revocation & Cancellation Cascade (`< 100ms`, `RT7-06`)**: Revoking or attenuating a parent grant, or cancelling/failing a parent run (`trg_runs_cancel_children_on_parent_abort`), immediately cascades to all descendant subagents and cancels any in-flight tool call.

## 4. Functional Requirements: Channels, Confidential DMs & Meetings (`PRD-COM-*`, `PRD-MTG-*`)

- **PRD-COM-001 [P0] [T] Hear (0 Tokens) vs. Wake (DTA-Gated)**: Channel messages are indexed in `messages`/`messages_fts`. Short human acknowledgments (`<= 6` words non-imperative) are caught by the Stage-0 Ack Gate (`0` wakes, `0` tokens). Any unmentioned human message scoring `< 0.32` in Stage 2 that does **not** match the Ack Gate routes to `@boss` (never silently dropped, `ST-38`).
- **PRD-COM-002 [P0] [T] Confidential Agent↔Agent DMs & Ping-Pong Circuit Breaker (`RT4-13`, `RT4-22`)**: Canonical pair ordering (`participant_a < participant_b` enforced in SQLite, `ST-19`), foreign-key validation triggers (`trg_dm_validate_refs`, `RT4-13`), and storage-layer `AgentSecurityContext` predicates (`INV-012`) isolate DM transcripts and T4 memories to the two participants (plus human read-only audit). Before sending an agent DM in `dm_send`, the handler inspects `consecutive_agent_turns`:
  - If `consecutive_agent_turns < 4`: increments `consecutive_agent_turns = consecutive_agent_turns + 1` and delivers the DM.
  - If `consecutive_agent_turns == 4` (an agent attempts a 5th consecutive turn without intermediate progress): `dm_send` **does not increment** (avoiding a SQLite `CHECK` abort), blocks the DM reply, resets `consecutive_agent_turns = 0`, and automatically posts a structured blocker escalation message to `@boss` (`RT4-22`).
  - **Reset Contract (`RT4-22`)**: `consecutive_agent_turns` resets to `0` whenever (a) the human operator posts a message in the DM, (b) either participant executes a mutating worktree tool (`fs_write`, `fs_patch`), or (c) either participant executes a `task_mutate` state transition (`claim`, `checkpoint`, `complete`, `review_approve`, `fail`).
- **PRD-COM-003 [P0] [T] End-to-End Cross-Agent & Subagent Taint Propagation (`ST-14`, `RT4-11`)**:
  - When a tainted run (`runs.tainted == 1`) posts a message (`channel_post`/`dm_send`) or mutates a task (`task_mutate`), `tainted = 1` is required on that message/task (`trg_messages_propagate_run_taint`, `trg_tasks_propagate_run_taint`) and inherited by any wake (`trg_wake_propagate_source_taint`, `trg_wake_monotonic_taint` on coalesce) and run (`trg_runs_propagate_wake_taint`).
  - When a child subagent spawned via `agent_delegate` or `agent_map_reduce` becomes tainted (`child.tainted == 1`), `trg_runs_propagate_child_taint_to_parent` atomically propagates `tainted = 1` up to `parent_run_id` (and grandparent runs up to `spawn_depth = 2`, `RT4-11.1`, `RT5-03`).
- **PRD-MTG-001..004 [P0] [T] Time-Boxed Autonomous Meetings (`RT4-21`)**:
  - **PRD-MTG-001**: Supports `moderated`, `round_robin`, `debate`, and `design_review` modes, initiated by the human operator (`EngineCommand::MeetingStart`) or by `@boss` via `goal_mutate(op = "meeting_start", ...)`.
  - **PRD-MTG-002**: Enforces `2..6` participants (`CHECK (json_array_length(participants_json) BETWEEN 2 AND 6)` in SQLite, `ST-20`), `max_rounds BETWEEN 1 AND 6` (default `3`), `max_tokens_per_speech = 800`, and `budget_micro_usd_max = 500_000`.
  - **PRD-MTG-003 (`RT4-21`)**: Concludes with a mandatory `@boss` **Decision Record** stored in `meetings.decision_record_md`. `@boss` writes the Decision Record and concludes the meeting by calling either `channel_post(channel_id, thread_id, meeting_id, msg_kind = "meeting_minutes", conclude_meeting_decision_record = true, content_md = ...)` or `goal_mutate(op = "meeting_conclude", meeting_id = ..., decision_record_md = ...)`, which atomically sets `meetings.decision_record_md`, `meetings.status = 'concluded'`, and `meetings.ended_at_us = now_us`.
  - **PRD-MTG-004**: Raw meeting turns (`msg_kind = 'meeting_turn'`) compact into the thread archive while action items promote into the Task DAG.

### 4.1 MCP-First Integration Strategy & Six Supported Integration Domains (`PRD-EXT-001..002`, Fixing `RT10-02` & `RT10-03`)

- **PRD-EXT-001 [P0] [T] MCP-First Integration Principle**: KIN builds its external service integrations around the **Model Context Protocol (MCP `2026-07-28`)** wherever practical, rather than implementing and maintaining a bespoke integration framework for every third-party application. Local MCP servers run sandboxed inside `S2-Lane-Exec` (`stdio`), and remote MCP servers communicate over stateless `streamable_http` through `kin-egress` (`INV-015`).
- **PRD-EXT-002 [P0] [T] Supported Integration Domains & Explicit Availability Caveat**:
  - **Scope & Availability Caveat**: The six integration domains below are examples of integrations KIN's MCP-first architecture is designed to support—**not** a claim that every third-party connector is currently bundled, implemented, or verified out of the box. Actual runtime availability depends on the specific connector, its authentication requirements (such as Google Cloud project configuration and OAuth 2.0 setup), and the capabilities exposed by its server:

| Integration Domain | Representative Connectors & MCP Servers | Supported Capabilities & Authentication Notes |
| :--- | :--- | :--- |
| **1. GitHub** | Official GitHub MCP Server (`github`) | Repository search, issues, pull requests, code review, GitHub Actions workflows, releases, security alerts, and project management. An official GitHub MCP server already exposes these capabilities to compatible AI clients; KIN ships a first-party preset with `read_only` and `write_enabled` modes authenticated via `KIN_SECRET_GITHUB_TOKEN` or OAuth. |
| **2. Google Sheets & Google Drive** | Google Workspace / Sheets MCP Server (`google_workspace`) | Read and update spreadsheets, populate cells, evaluate formulas, organize Drive files, and automate reporting. Google publishes a Sheets MCP server (currently documented under Google's Developer Preview Program); access requires the operator's Google Cloud configuration and OAuth 2.0 setup. |
| **3. Slack & Discord** | Slack & Discord MCP Connectors (`slack`, `discord`) | Read permitted channel and thread conversations, summarize engineering discussions, post status updates, and coordinate work across human and agent teams. |
| **4. Notion, Linear, Jira & Trello** | Project & Issue Tracker MCP Servers (`linear_jira`, `notion`, `trello`) | Manage architecture documentation, track engineering tasks, create tickets, update project status, and synchronize execution with KIN's internal Task DAG. |
| **5. Databases & Infrastructure** | PostgreSQL, SQLite, Supabase, Cloud & CI/CD MCP Servers (`postgres`) | Inspect schemas, run read-only or policy-gated queries against PostgreSQL, SQLite, and Supabase, and interact with REST/GraphQL APIs, cloud services, monitoring, deployment, and CI/CD tools. |
| **6. Browser, Terminal & Developer Tools** | Built-in `kin-browser` (CDP), `kin-pty`, `kin-sandbox` & Custom MCP Servers | Managed CDP browser automation (`browser_act` with Zero-Capture Takeover), sandboxed local scripts (`shell_exec`, `pty_open`), testing frameworks, package managers, local/remote MCP servers, and custom APIs. |

### 4.2 Four-Category Extension Organization (`PRD-EXT-003`, Fixing `RT10-04`)

KIN does **not** treat every extension as the same thing. Because MCP integrations, native extensions, reusable instructions, and multi-agent workflows solve different problems and carry different risk profiles, KIN organizes extensions into **four distinct categories**:

| Category | Canonical Kind (`extension_packages.category`) | Primary Problem Solved & Security Boundary |
| :--- | :--- | :--- |
| **1. Integrations** | `integration` (backed by `mcp_integrations`) | Connect external services such as GitHub, Google Sheets/Drive, Slack, Linear, Jira, and PostgreSQL. Provide real actions and live data through MCP (`stdio` / `streamable_http`), native adapters, or APIs. Governed by explicit `read_only` vs `write_enabled` mode (`KIN-EXT-0001`), `<untrusted_content>` wrapping, and `kin-egress` host allowlists. |
| **2. Plugins & Extensions** | `plugin` (backed by `kin-plugin-sdk`) | Add capabilities to KIN itself: new Zone 4 inspector panels, custom deterministic tools, language/LSP integrations, model provider adapters, or specialized agent runtimes. Executed in isolated WASM/WASI 0.2 sandboxes or signed helper processes with explicit capability manifests. |
| **3. Skills & Playbooks** | `skill` (`.kin/skills/<slug>/SKILL.md`) | Reusable, versioned Markdown/YAML instructions that tell agents how to perform a workflow (e.g., researching a competitor, updating a Google Sheet, and preparing a report). **Zero implicit permissions**: a Skill never grants extra tool or network privileges (`INV-006`, `KIN-EXT-0002`). |
| **4. Workflow Packs** | `workflow_pack` (`.kin/workflows/<slug>/workflow.toml`) | Preconfigured, versioned multi-step processes combining tools, skills, specialist agent roles, Task DAG templates, and mandatory human approval checkpoints (e.g., an Issue-to-Pull-Request workflow pack). **Zero implicit permissions**: Workflow Packs cannot bypass approval gates or elevate autonomy ceilings (`KIN-EXT-0002`). |

### 4.3 Five-Step Recommended Implementation Order (`PRD-EXT-004..005`, Fixing `RT10-07`)

KIN's extensibility and marketplace capabilities are implemented in five disciplined phases:

1. **Step 1 — MCP Integration Manager**: A dedicated UI in Zone 4 and Settings (`EngineCommand::McpIntegrationMutate`) to discover (`server/discover` & `tools/list`), configure, authorize (OS Keychain secret handle or OAuth 2.0 PKCE), inspect pinned JCS schemas (`pinned_schema_sha256` / `schema_sha256`), switch between `read_only` and `write_enabled` modes, and enable or disable local (`stdio`) and remote (`streamable_http`) MCP servers.
2. **Step 2 — First-Party Integration Presets**: Curated built-in presets prioritizing **GitHub**, **Filesystem**, **Browser**, and **Google Workspace (Sheets & Drive)**, with clear `read_only` (default) and `write_enabled` modes, reusing official MCP servers where sensible.
3. **Step 3 — Skills & Workflow Marketplace**: Installable, semver-versioned **Skills** and preconfigured multi-agent **Workflow Packs**, enforced with zero implicit extra permissions (`KIN-EXT-0002`).
4. **Step 4 — Native Plugin SDK (`kin-plugin-sdk`)**: A stable, versioned extension API for plugins that genuinely need deeper access to KIN's UI panels or runtime adapters.
5. **Step 5 — Public Marketplace**: Publishing, semantic search, engine compatibility checks, Ed25519 verified publisher signatures, user reviews, automated static/AST security scanning, version management, and cryptographic package removal or revocation mechanisms (`KIN-EXT-0003`).

## 5. Desktop User Experience & 4-Zone Interface Architecture (`PRD-UX-001..004`)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP HUD BAR (36px): Project Badge | Active Runs (3) | Spend $1.42/$10 | Sandbox:S2 | 🛑  │
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

- **PRD-UX-001 [P0] [T] Four-Zone Spatial Workbench**:
  - **Zone 1 (Project Switcher Rail, `60px`)**: Project icons with live status rings (Idle, Running, Approval Needed, Alert), Settings, Ledger Inspector, and Panic Stop (`Cmd/Ctrl+Shift+Escape`).
  - **Zone 2 (Workspace Navigator, `240px` resizable `180px`–`340px`)**: Channels, Human↔Agent DMs, collapsible read-only Agent↔Agent DMs, Active Goals progress, and Schedules.
  - **Zone 3 (Primary Stage, `flex-1 >= 520px`)**: Virtualized 60 FPS message stream (`@tanstack/react-virtual`), inline collapsible **Run Cards** (streaming tokens, tool pills, inline LSP badge, Approval Banner), and **Multimodal Composer** (`@agent`, `#channel`, `/command`, `!file/symbol`).
  - **Zone 4 (Context Inspector & Review Drawer, `380px`–`560px`, `Cmd/Ctrl+\`)**: Six tabs: (1) **Thread**, (2) **Diff & Merge Queue** (per-file/hunk review, **Apply to Root**, **Revert Apply**), (3) **Goals & Task DAG** (`xyflow` topological graph), (4) **Run Trace, PTY & Browser Live View** (`EngineCommand::PtyControl`, 1-click **Take Over Browser** / **Hand Back**), (5) **Memory & Context X-Ray** (L1–L9 token breakdown & quarantine queue), and (6) **Security, MCP Integrations & Audit Ledger** (`McpIntegrationMutate`, `ExtensionPackageMutate`).
- **PRD-UX-002 [P0] [T] Command Palette (`Cmd/Ctrl+K`) & Slash Commands (`RT4-24`, `RT11-09`)**: `/goal` (`EngineCommand::GoalMutate`), `/task` (`TaskMutate`), `/meet` (`MeetingStart`), `/hire` (`AgentHire`), `/schedule` (`ScheduleMutate`), `/worktree`, `/review` (`LaneEnqueueMerge`), `/compact` (`ContextCompact`), `/remember` (`MemoryWrite`), `/forget` (`PrivacyPurgeEntity`), `/mode`, `/model`, `/budget` (`ProjectUpdateSettings`), `/mcp` (`McpIntegrationMutate`), `/ext` (`ExtensionPackageMutate`), `/workflow` (`WorkflowPackStart`), `/takeover` (`BrowserTakeoverResolve`), `/stop` (`CancelRun` / `PanicStopAll`), `/export` (`ProjectExportArchive`).
- **PRD-UX-003 [P0] [T] WCAG 2.2 AA Accessibility**: Full keyboard roving `tabindex`, `aria-live` announcements for approvals/completions, high-contrast themes, and `prefers-reduced-motion`.
- **PRD-UX-004 [P1] [T] Internationalization & Multilingual Codebases (`ST-34`)**: UI strings externalized via `i18next`; embedding slot defaults to bundled `bge-small-en-v1.5-q8.onnx` (384-dim) and supports one-click switch to `multilingual-e5-small-q8.onnx` (384-dim, 100 languages) or external 768/1536-dim embedding models with Matryoshka truncation to 384 dims (`RT4-26`).

## 6. Pinned Quantitative Non-Functional Budgets & Benchmark Corpora (`NFR-*`, `ST-37`)

**Reference Benchmark Environments & Corpora (`KIN-Bench-Env-v10.0`)**:

- **Hardware**: Apple MacBook Pro M3 Pro (12-core, 18GB unified RAM, APFS) / AMD Ryzen 7 7840U (16GB RAM, NVMe, Ubuntu 24.04 Kernel 6.8 / Windows 11 23H2).
- **Corpus A (`kin-bench-repo-50k` — Standard Repo Onboarding Corpus)**: 50,000 LOC across 420 Rust/TypeScript/Python files yielding **2,500 AST-aligned code chunks** (~20 lines/chunk) and 3,800 symbols.
- **Corpus B (`kin-bench-monorepo-100k` — Monorepo Scale Stress Corpus)**: Synthetic + multi-crate corpus of ~2,000,000 LOC yielding **100,000 code chunks** in `index.db` and **10,000 active memories** in `project.db`.

| ID | Metric | Target Budget (p95, N=100) | Corpus / Condition | Enforcement Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **NFR-PERF-001** | Cold Start to Interactive Window | `< 800 ms` (macOS), `< 1,200 ms` (Win/Linux) | Cold process start | Native Rust daemon + lazy ONNX load + pre-warmed SQLite reader pool |
| **NFR-PERF-002** | Initial Onboarding (Tree-sitter + FTS5) | `< 3,000 ms` (2,500 chunks) | Corpus A (50k LOC), warm FS cache | Parallel `ignore` walk + `rayon` Tree-sitter parse; `code_chunks.embedding_f32` populated asynchronously (`ST-17`) |
| **NFR-PERF-003** | UI Frame Time (Streaming 3 Runs) | `< 16.6 ms` (60 FPS) | Active streaming | 16ms IPC delta coalescing + virtualized DOM lists |
| **NFR-PERF-004** | Turn Arbiter Latency (Stages 0–2 vs Stage 3) | `< 15 ms` p95 (`0` LLM tokens) for Stages 0–2 (`>= 95%` of turns); `< 800 ms` p95 (`1,500 ms` hard timeout) for Stage-3 fallback (`< 5%` of turns) | Warm ONNX session (`KIN-Bench-Router-1k`) | Rust regex/Aho-Corasick + INT8 ONNX `bge-small-en-v1.5` (Stages 0–2); bounded `fast_tool` `max_output_tokens = 96` (Stage 3) |
| **NFR-PERF-005** | 4-Signal Hybrid Search (top-20) | `< 45 ms` | Corpus B (100k chunks, 10k memories), warm SQLite cache | `scope_key`-partitioned `sqlite-vec` `vec0` + FTS5 BM25 + 2-hop CTE + RRF |
| **NFR-PERF-006** | Inline Post-Patch Tree-sitter + Warm LSP | `< 80 ms` (`< 5ms` AST + `55ms` LSP cap + `15ms` margin = `75ms` budget) | Warm LSP daemon (`ST-37`, `RT9-20`) | Incremental `tree-sitter` + hard `55ms` timeout on `publishDiagnostics` (`diagnostic_wait_ms = 55`) |
| **NFR-PERF-007** | Idle Memory / Idle CPU (1 project open) | `< 180 MB` RSS (pre-ONNX) / `< 0.5%` CPU | 60s idle window | Bounded LRU caches, event-driven Tokio reactor, 15m idle LSP eviction (`RT7-07`) |
| **NFR-REL-001** | Crash Integrity (10,000 `SIGKILL` soak) | `0` SQLite/ledger corruptions, `0` dup effects | M11 release soak | WAL `synchronous=FULL` + two-phase intent journal (`INV-004`, `INV-005`) |
| **NFR-COST-001** | Prefix Byte-Stability & Cache Hit SLI | 100% byte-identical L1–L6 prefix; `>= 85%` measured cache-read SLI on warm Anthropic/OpenAI runs | Steps 2..N within provider TTL | `prompt_prefix_hash` assertion in CI + per-provider telemetry SLI |

## 7. Fourteen Golden End-to-End Verification Journeys (`G1`–`G14`)

Executed deterministically in CI using recorded LLM cassette fixtures (`kin-bench-vcr`, `ST-37`) plus live provider nightly runs:

1. **G1 — Zero-Pollution Onboarding & Trust Gate**: Open repo → verify `0` bytes and `0` `mtime`/`ctime` changes in `<root_path>` and `<root_path>/.git` → approve Trust Modal → index 2,500 chunks in `< 3s`.
2. **G2 — Stage-2 Deterministic Routing & Ack Gate**: Unmentioned bug report in `#backend` routes to `@backend` in `< 15ms`; `"thanks"` triggers Ack Gate (`0` tokens); low-signal human question `< 0.32` routes to `@boss`.
3. **G3 — Goal Decomposition & Parallel Worktree Execution**: `@boss` creates Goal (`goal_mutate`) and 5-task DAG (`task_mutate`) → `@backend` and `@frontend` execute in isolated lanes → `lane_submit_merge` → user applies to root → `git worktree remove --force` & `prune` (`RT4-27`).
4. **G4 — Dirty-Root Snapshot S0 + `git gc` Resilience + Tracked/Untracked `.env` Exclusion**: User has dirty edits + `.git/info/exclude` + tracked `.env` + untracked `.env.local` and runs `git gc` → `repo.git` retains pack objects, strips both tracked and untracked `.env*` and `.kinignore` globs (`RT4-07`, `RT6-02`), and merges cleanly.
5. **G5 — Concurrent Same-File Edits & AST Import Merger**: Disjoint function edits + additive imports merge cleanly via `git merge-tree` + Tree-sitter import combiner.
6. **G6 — Confidential Agent↔Agent DM & Ping-Pong Breaker**: Canonical `dmc_` ordering + 4-turn ping-pong pre-check escalation to `@boss` without SQLite `CHECK` abort (`RT4-22`).
7. **G7 — Time-Boxed Autonomous Meeting**: 2..6 participants debate for 2 rounds → `@boss` publishes Decision Record via `channel_post(..., conclude_meeting_decision_record = true)` (`RT4-21`).
8. **G8 — Bi-Temporal Memory Contradiction & Same-Scope Graph Traversal**: Superseding REST with gRPC updates `valid_to_us` and `superseded_at_us`; cross-scope edges are blocked by SQLite FKs.
9. **G9 — 60-Step Compaction & AEAD Spill Recall**: 2MB log spills to `blobs/`; L1 + L2 checkpoint summary reduces active `context_items` while raw `messages`/`tool_calls` remain searchable via `recall` (`messages_fts` + `tool_calls_fts`, `RT4-10`).
10. **G10 — Browser Research with Zero-Capture Takeover**: Login wall triggers `waiting_takeover` → human logs in → DOM password fields scrubbed on Hand Back.
11. **G11 — Dual-AST Secret Redaction, Batch Pre-Marking & Taint Propagation**: Secret handle substitution (`RT4-18`, `RT4-19`) + intra-batch `[fs_read, web_fetch]` pre-marking (`RT4-16`) + taint propagation across child subagents, messages, tasks, and wakes (`RT4-11`) blocks indirect exfiltration.
12. **G12 — `SIGKILL` Crash Recovery & Multi-File Apply Roll-Forward/Roll-Back**: Tests recovery from all non-terminal `runs.status` states (`waiting_approval`, `waiting_takeover`, `waiting_subagent`, `executing_tools`), persisted `gate_fail_attempts` (`RT4-20`), and `apply_journals` crash boundaries including subdirectory creation and file deletion (`RT4-09`, `RT7-05`).
13. **G13 — 4-Tier Fuzzy/AST Patch + Epoch-Locked Completion Gate**: Applies AST-anchored patch with `< 80ms` inline diagnostics and verifies `pre_tree_sha == post_tree_sha` under `RwLock` write permit.
14. **G14 — Post-Run Procedural Auto-Distillation & `agent_map_reduce`**: Distills a 9-step recovery trajectory into a `procedure` memory and reuses it across an `agent_map_reduce` fan-out.
