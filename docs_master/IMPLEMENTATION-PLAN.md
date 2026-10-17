# KIN Production Implementation Roadmap (M0–M8)

**Document ID:** `KIN-PLN-10.0-PROD`  
**System Name:** KIN — Sovereign Local-First Autonomous Multi-Agent AI Workforce & Harness  
**Version:** `10.0.0-PRODUCTION`  
**Status:** Canonical Engineering Roadmap, Milestones & Done-When Verification Criteria  

---

## 1. Roadmap Overview & Phased Architecture

To transition KIN from architectural specification to a hardened, enterprise-grade production release, implementation is divided into nine disciplined, sequentially verified milestones (`M0` through `M8`):

```text
M0: Foundation & IPC Protocol  ──>  M1: 4-Database Storage & Crypto
             │                                   │
             ▼                                   ▼
M2: Sandboxing & Worktree Lanes ──>  M3: Model Gateway & 9-Layer Compiler
             │                                   │
             ▼                                   ▼
M4: 15-State Harness & DTA      ──>  M5: PTY Shell, Browser CDP & 28 Tools
             │                                   │
             ▼                                   ▼
M6: Workforce, DMs & Task DAG   ──>  M7: React 19 / Tauri v2 4-Zone UI
             │                                   │
             └─────────────────┬─────────────────┘
                               ▼
            M8: Security Audit, Chaos Verification & Release Packaging
```

---

## 2. Milestone Specifications & Done-When Verification Criteria

### Milestone M0: Project Scaffolding, Foundation Crates & IPC Protocol
- **Objective:** Establish the Cargo 6-layer workspace layout, foundational types, closed error taxonomy, 16-byte KIN8 binary wire framing, short socket path bindings, and 3-step mutual HMAC-SHA256 handshake.
- **Key Deliverables:**
  - Crates: `kin-types`, `kin-proto`, `kin-error`, `kin-ports`, `kin-crypto`.
  - Short-path socket abstraction (`KIN_RUN_DIR` under `/tmp/kin-<uid>/e.sock` on Unix, Named Pipes on Windows).
  - Mutual 3-step challenge-response handshake with constant-time verification.
  - Monotonic microsecond clock (`TRD-CLK-001`) with atomic CAS loop.
- **Done-When Criteria:**
  - `cargo check --workspace --all-targets` passes with zero warnings.
  - Test client authenticates against `kin-engine` over local socket in under 10ms.
  - Replay attacks and invalid HMAC responses are rejected with connection termination.

### Milestone M1: 4-Database Storage Architecture & Cryptographic Key Hierarchy
- **Objective:** Implement the four-database storage architecture (`registry.db`, `project.db`, `index.db`, `blobs/`), SQLCipher encryption under `PDK_prj`, SQLite `STRICT` DDL schemas, and immutability triggers.
- **Key Deliverables:**
  - Crate: `kin-store`, `kin-blobs`, `kin-vault`.
  - Full schema migrations for `registry.db` and `project.db`.
  - Immutability and taint triggers on `messages`, `run_steps`, `tool_calls`, and `ledger_events`.
  - Key derivation via HKDF-SHA256 from OS Keychain-held `PMK_prj`.
  - Cryptographic shredding command (`ProjectCryptoShred`).
- **Done-When Criteria:**
  - `project.db` and `index.db` are unreadable without SQLCipher key `PDK_prj`.
  - SQLite triggers abort any attempted `UPDATE` or `DELETE` on finalized ledger events.
  - Project shredding permanently deletes `PMK_prj`, rendering remaining disk blocks unrecoverable.

### Milestone M2: OS Sandboxing, Git Worktrees & 4-Tier Patching Engine
- **Objective:** Deliver OS-level execution sandboxing (S0–S3), true zero-write root onboarding via `$KIN_HOME/.../repo.git`, isolated Git worktree lanes, and the 4-tier cascading patch engine (`fs_patch`).
- **Key Deliverables:**
  - Crates: `kin-sandbox`, `kin-lanes`.
  - macOS Seatbelt profile (`macos_s2_lane.sb`), Linux Landlock+Seccomp rules, Windows Job Objects.
  - Bare mirror clone onboarding with zero mtime/ctime changes to user root.
  - 4-Tier patch algorithm (Exact → Whitespace-Normalized → Indentation-Agnostic → AST-Anchored).
- **Done-When Criteria:**
  - Sandboxed process attempting to read `~/.ssh` or `/etc/shadow` is aborted by the OS kernel.
  - Agents modify files inside worktree lanes; user root directory remains completely untouched.
  - `fs_patch` achieves 100% success across 1,000 synthetic multi-tier code patch fixtures.

### Milestone M3: Model Gateway & 9-Layer Prefix Compiler
- **Objective:** Build the multi-provider language model gateway supporting local Ollama models and cloud APIs (Anthropic with extended thinking tokens, OpenAI, Gemini, Groq, OpenRouter), along with the 9-layer KV-cache stable prefix compiler.
- **Key Deliverables:**
  - Crates: `kin-gateway`, `kin-context`.
  - Local Ollama auto-discovery, model listing, and native tool-calling adapter.
  - Cloud provider adapters with streaming SSE token parsing.
  - 9-Layer prompt compiler enforcing run-static byte-identical base prefixes (BP1–BP2).
  - Context compaction and disk spilling for outputs exceeding 2,000 tokens.
- **Done-When Criteria:**
  - Local Ollama `gemma4:e2b` executes a tool call offline in under 7 seconds.
  - Cloud runs on Anthropic achieve measured `>= 85%` prompt cache hit rates on turns 2 through N.
  - Spilled tool outputs generate compact preview headers with valid BLAKE3 hashes on disk.

### Milestone M4: 15-State Harness Lifecycle & 3-Stage Turn Arbiter (DTA)
- **Objective:** Implement the core reasoning loop, 15-state harness lifecycle, Stage 0–3 Deterministic Turn Arbiter, LoopBreaker circuit breaker, and 4-tier cognitive memory engine.
- **Key Deliverables:**
  - Crates: `kin-harness`, `kin-orch`, `kin-memory`.
  - 15-state FSM state transitions and event broadcasting.
  - 3-Stage DTA (Stage 0 Regex Ack Pre-Gate, Stage 1 Mentions, Stage 2 Quantized ONNX Matcher, Stage 3 @boss Fallback).
  - LoopBreaker tracking 3-turn rolling tool hashes.
  - Bi-temporal memory graph (`valid_from_us`, `valid_to_us`).
- **Done-When Criteria:**
  - DTA Stages 0–2 resolve turn assignments in `< 15ms p95` with 0 token consumption.
  - LoopBreaker trips immediately when an agent repeats identical failing tool calls 3 times.
  - Bi-temporal memory queries return current valid claims while maintaining historical auditability.

### Milestone M5: Interactive PTYs, Browser CDP & Canonical 28 Built-In Tools
- **Objective:** Implement managed lane-scoped pseudo-terminals, persistent headless CDP browser controller, Zero-Capture Human Takeover Banner, and the complete canonical 28 built-in tool suite.
- **Key Deliverables:**
  - Crates: `kin-pty`, `kin-browser`, `kin-tools`.
  - Portable-pty circular ring buffer manager.
  - Chrome DevTools Protocol automation with persistent per-agent cookie/storage profiles.
  - Takeover banner lifecycle (transitions from `StreamingModel` → `WaitingTakeover` → `ExecutingTools`).
  - Implementation of all 28 tools (`fs_*`, `pty_*`, `web_*`, `browser_*`, `memory_*`, `agent_*`, `task_*`).
- **Done-When Criteria:**
  - Browser encounters CAPTCHA; agent run suspends; operator completes challenge; agent resumes seamlessly.
  - Terminal commands stream output smoothly through circular ring buffer without memory leakage.
  - All 28 tools execute within sandboxed worktree bounds.

### Milestone M6: Workforce Hierarchy, Confidential DMs, Meetings & Task DAG
- **Objective:** Deliver multi-channel workforce collaboration, dynamic agent recruitment, 1-on-1 human/agent DMs, confidential agent-to-agent DMs with ping-pong circuit breakers, autonomous meetings, and the Task DAG engine.
- **Key Deliverables:**
  - Crates: `kin-tasks`, `kin-sched`.
  - Dynamic agent recruitment (`agent_hire`) up to the 24-agent project cap.
  - Confidential agent-to-agent DMs with 4-turn Ping-Pong Circuit Breaker and operator audit inspection.
  - Autonomous meetings with 2 to 6 participants and mandatory `@boss` Decision Records.
  - Directed Acyclic Graph task execution with atomic OCC leasing epochs.
- **Done-When Criteria:**
  - Two agents in a DM exchange 4 turns without progress; system trips circuit breaker and alerts `@boss`.
  - Multi-agent meeting completes 3 rounds and exports an authoritative Decision Record to the Task DAG.
  - Multiple agents claim and complete ready DAG tasks concurrently without race conditions.

### Milestone M7: Desktop User Experience & 4-Zone Spatial Workbench
- **Objective:** Build the production desktop interface using Tauri v2, React 19, Tailwind CSS, and Zustand, implementing the responsive 4-zone layout, virtualized message stream, and review drawers.
- **Key Deliverables:**
  - Packages: `src-tauri`, `ui`.
  - 4-Zone Workbench: Project Rail (Z1), Navigator (Z2), Primary Stage (Z3), Inspector Drawer (Z4).
  - Virtualized message stream rendering 60 FPS under active multi-agent streaming.
  - Side-by-side unified diff review panel with `[Apply to Root]` and `[Revert Last Apply]`.
  - Visual Task DAG topology using `xyflow`.
  - Universal keyboard shortcuts (`Cmd/Ctrl+K`, `Cmd/Ctrl+\`, `Cmd/Ctrl+Shift+Escape`).
- **Done-When Criteria:**
  - UI maintains solid 60 FPS while 3 agents stream tokens and tool executions concurrently.
  - Collapsing Zone 4 on narrow viewports expands Zone 3 smoothly to 100% width.
  - One-click diff apply cleanly updates the user's workspace; one-click revert cleanly rolls it back.

### Milestone M8: Security Hardening, Chaos Testing & Production Packaging
- **Objective:** Complete comprehensive penetration testing, Model Context Protocol integration, 200-test chaos verification pyramid, and cross-platform native installer packaging.
- **Key Deliverables:**
  - Model Context Protocol (MCP 2026-07-28) host with schema pinning.
  - Full execution of all 15 adversarial stress scenarios (`ST-01` through `ST-15`).
  - 14 Golden End-to-End Verification Journeys (`G1` through `G14`).
  - Native installers: macOS `.dmg` / `.app` (Universal binary, code-signed, notarized), Windows `.msi` / `.exe` (MSVC signed), Linux `.AppImage` / `.deb`.
- **Done-When Criteria:**
  - All 14 Golden Journeys pass deterministically in CI.
  - 10,000 simulated SIGKILL crash cycles produce zero database corruptions and zero orphaned worktrees.
  - Standalone installer executes cleanly on a fresh, pristine virtual machine with zero prerequisites.
