# DOC-08: C4 Architecture Diagrams (L1–L4), Architecture Decision Records (ADR-001–ADR-018), Compatibility Matrix, Lockfile Contracts & Build/Troubleshooting Runbook

| Field | Value |
| :--- | :--- |
| **Document ID** | KIN-DOC-08 (`08-C4-ADRS-COMPATIBILITY-RUNBOOK-AND-LOCKFILES.md`) |
| **Suite Version** | `10.0.0-PRODUCTION` |
| **Status** | **Canonical Specification & Reference Contract Bundle (Architecture Views, ADRs, Compatibility, Reference Lockfiles & Operations)** |
| **Scope** | Separation-of-Concerns Responsibility Partition (`§0`), C4 Architecture Diagrams Level 1–4 (`C4-L1`–`C4-L4`, `§1`), 18 Formal Architecture Decision Records (`ADR-001`–`ADR-018` mapped 1-to-1 to `INV-001`–`INV-018`, `§2`), Full OS/Kernel/Toolchain/Crate/Frontend Dependency & Compatibility Matrix (`CMP-*`, `§3`), Reference Pinned Workspace Manifests & Lockfiles (`Cargo.toml`, `.cargo/config.toml`, `Cargo.lock` v4, `apps/desktop/package.json`, `apps/desktop/pnpm-lock.yaml` v9, `§4`), and Reproducible Build, CLI-to-Engine API Mapping & Operational Troubleshooting Runbook (`RUN-BLD-001..005`, `RUN-CLI-001`, `RUN-TRB-001..012`, `§5`) |

## 0. Strict Separation-of-Concerns & Non-Contradiction Matrix (`ARCH-SOC-001`, Fixing `RT13-11`)

To guarantee that every engineering artifact in the KIN (`10.0.0-PRODUCTION`) suite has a **single, distinct responsibility** and **never contradicts another**, the table below defines the authoritative boundary ("Owns vs. Delegates") across all 13 architectural responsibility domains (spanning the 15 suite files) and the automated tests in `verify_kin_v10_0_suite.py` that enforce cross-document consistency:

| # | Engineering Artifact | Authoritative File(s) | Distinct Responsibility (What It Owns) | Explicit Delegation Boundary (Never Duplicated Here) | Enforcing Tests in `verify_kin_v10_0_suite.py` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 01 | **System Governance, Invariants & Error Registry** | `AGENTS.md`, `00-AGENTS-AND-AUDIT.md` (`DOC-00`) | Owns the 10-document suite map, 13-phase audit ledger (`AUD-01`–`AUD-28`, `P0`–`P2`, `ST-01`–`ST-45`, `RT4`–`RT13`), 18 Constitutional Invariants (`INV-001`–`INV-018`), 15 Build Rules, and the 54-code Closed Error Taxonomy Registry table (`KIN-*`). | Delegates functional requirements to `DOC-01`, SQLite DDL to `DOC-02`, Rust `KinError` impl to `DOC-06`, and ADRs/C4/Runbook to `DOC-08`. | `test_50`, `test_80`, `test_125`, `test_126`, `test_153`, `test_154`, `test_176` |
| 02 | **PRD & Requirements Catalogue** | `01-PRD.md` (`DOC-01`) | Owns functional requirements (`PRD-PRJ-001..004`, `PRD-AGT-001..003`, `PRD-COM-001..003`, `PRD-MTG-001..004`, `PRD-EXT-001..005`, `PRD-UX-001..004`), 4-Zone UX layout, quantitative `NFR-*` latency/cost/crash budgets, benchmark corpora (`Corpus A` 50k LOC, `Corpus B` 100k chunks), and 14 Golden E2E Journeys (`G1`–`G14`). | Delegates IPC framing and SQL schemas to `DOC-02`, state-machine transitions to `DOC-03`, and wire structs to `DOC-06`. | `test_36`, `test_47`, `test_48`, `test_71`, `test_132`, `test_142`, `test_166`, `test_177` |
| 03 | **Data & Storage Specifications** | `02-TRD-AND-DDL.md` (`DOC-02`) | Owns process socket paths (`$KIN_RUN_DIR/e.sock <= 44B`), `KIN8` framing & mutual 3-step HMAC handshake (`TRD-PRC-001..003`), monotonic clock (`TRD-CLK-001`), key hierarchy (`PMK_prj`, `PDK_prj`, `PBK_prj`, `LSK_prj`), startup migration & `ENOSPC`/WAL valves (`DB-STR-002`), and executable SQLite `STRICT` + `vec0` DDL (`registry.db`, `project.db`, `index.db`). | Delegates runtime state-machine behavior to `DOC-03`, Git/worktree FS operations to `DOC-04`, and lockfile checksums to `DOC-08 §4`. | `test_03`–`test_08`, `test_16`, `test_19`–`test_32`, `test_59`–`test_64`, `test_83`–`test_87`, `test_93`–`test_95`, `test_117`–`test_121`, `test_158`–`test_160` |
| 04 | **System Architecture Specification (Runtime, Memory & Worktrees)** | `03-HARNESS-MEMORY-CONTEXT.md` (`DOC-03`), `04-WORKTREE-DAG-BROWSER-GATEWAY.md` (`DOC-04`) | `DOC-03` owns the Stage-0 Pre-Gate + 3-Stage Deterministic Turn Arbiter (`Stage 0–3 DTA`), 15-state run transition table, 11-state boot crash recovery matrix, 3-strike completion gate & loop breaker, 4-Tier × 4-Bank bi-temporal graph memory, RRF math, and 9-layer prompt compiler (`L1`–`L9`). `DOC-04` owns `repo.git` `S0` snapshots, 4-tier `fs_patch`, PTYs, POSIX/Windows scrubbed child env (`SEC-ENV-001`), warm LSP caps, 2-phase root apply (`apply_journals`), Task DAG promotion, LLM Gateway resilience, and CDP Browser hardening. | Delegates visual C4 diagrams (`L1`–`L4`) and formal ADRs to `DOC-08 §1–§2`, and policy risk rules to `DOC-05`. | `test_09`–`test_11`, `test_17`, `test_37`–`test_41`, `test_56`–`test_58`, `test_82`, `test_88`, `test_89`, `test_96`, `test_106`, `test_107`, `test_122`, `test_124`, `test_151`, `test_152`, `test_156` |
| 05 | **Security & Permission Model** | `05-SECURITY-LEDGER-EXTENSIBILITY.md` (`DOC-05`) | Owns the 12-class Threat Matrix (`T-01`–`T-12`), 9-stage Dual-AST policy pipeline (`SEC-POL-000..006`), `R0`–`R5` × 4 autonomy decision matrix, `S2-Lane-Exec` vs `S2-Root-Snapshot` OS sandbox model, per-lane authenticated `kin-egress` proxy & dynamic host approval (`SEC-EGR-001..003`), two-level BLAKE3+Ed25519 audit ledger & signed privacy purge receipt (`SEC-PRV-001`), 26-tool risk catalog, MCP `2026-07-28` host security, 4-category extension boundaries, and opt-in signed updater (`SEC-UPD-001`). | Delegates verbatim OS sandbox source files (`.sb`, `linux.rs`, `windows.rs`) and JSON schemas to `DOC-07`. | `test_13`, `test_18`, `test_33`, `test_34`, `test_43`, `test_44`, `test_65`–`test_67`, `test_116`, `test_123`, `test_128`, `test_133`, `test_135`, `test_157`, `test_159` |
| 06 | **Interface & Integration Contracts (+ Machine-Verifiable Schemas)** | `06-IPC-CONTRACTS-QA-ROADMAP.md §1–§2` (`DOC-06`), `07-PROMPTS-SCHEMAS-AND-SANDBOX-PROFILES.md` (`DOC-07`) | `DOC-06 §1–§2` owns `specta`-typed Rust IPC wire contracts (`RunStatus`, closed op enums, `ClientEnvelope`, `EngineCommand`, `ServerFrame`), closed 54-code `KinError` enum (`code`, `category`, `is_retryable`, `to_wire_error`), and reference Rust implementations. `DOC-07` owns verbatim `.tera` prompts, all 26 tool JSON schemas, macOS `.sb` profiles, Linux `seccompiler 0.4` + Landlock `linux.rs`, Windows `windows.rs`, and `.kin/kin.toml`. | Delegates high-level policy prose to `DOC-05` and operational build/troubleshooting procedures to `DOC-08 §5`. | `test_12`, `test_14`, `test_15`, `test_35`, `test_45`, `test_46`, `test_51`–`test_55`, `test_68`, `test_70`, `test_72`, `test_73`, `test_90`, `test_91`, `test_111`–`test_115`, `test_137`, `test_139`, `test_154`, `test_155` |
| 07 | **Testing & Verification Strategy (+ Specification/Contract Verifier)** | `06-IPC-CONTRACTS-QA-ROADMAP.md §3` (`DOC-06`), `verify_kin_v10_0_suite.py` | `DOC-06 §3` defines the 3-Tier QA & Chaos Verification Pyramid (Tier 1 PR Gate `< 90s`, Tier 2 Nightly 4-shard `cargo-mutants >= 85%` & 1,000-crash matrix `< 30m`, Tier 3 10,000-crash soak & `kin-bench-vcr` `G1`–`G14` `< 4h`). `verify_kin_v10_0_suite.py` is the standalone Specification & Contract Verification Suite executing 200 DDL, trigger, simulation, schema, and cross-document contract tests. | Delegates milestone scheduling to `DOC-06 §4` and developer CLI troubleshooting to `DOC-08 §5`. | `test_01`–`test_200` (all 200 tests in `verify_kin_v10_0_suite.py`) |
| 08 | **Implementation & Integration Plan** | `06-IPC-CONTRACTS-QA-ROADMAP.md §4` (`DOC-06`) | Owns the 6-engineer staffing plan, 24-week milestone schedule (`M0`–`M12`), 72 concrete work packages (`WP-001`–`WP-072`), hard exit gates per milestone, and alignment with the 5-step extensibility rollout order. | Delegates day-to-day build commands and incident recovery to `DOC-08 §5`. | `test_49`, `test_136`, `test_185` |
| 09 | **C4 Architecture Diagrams (L1–L4)** | `DOC-08 §1` | Owns the 4 canonical C4 views: **C4 Level 1 (System Context)**, **C4 Level 2 (Container & Process Boundaries)**, **C4 Level 3 (`kin-engine` Component & 6-Layer L0–L5 Hexagonal Graph)**, and **C4 Level 4 (Verification Gate, Dual-AST Batch Policy & Per-Lane Egress Sequence Flows)**. | Delegates crate dependency rules to `DOC-02 §2` and state transition tables to `DOC-03 §2`. | `test_187` |
| 10 | **Architecture Decision Records (`ADR-001`–`ADR-018`)** | `DOC-08 §2` | Owns the 18 formal ADRs (`ADR-001`–`ADR-018`), each with `Status`, `Context`, `Considered Alternatives`, `Decision`, `Consequences`, `Mapped Invariant (INV-001..018)`, and `Enforcing Contract & Verification Test`. | Delegates historical bug-fix audit logs (`AUD`, `ST`, `RT4–RT13`) to `DOC-00 §2`. | `test_188` |
| 11 | **Dependency & Compatibility Matrix** | `DOC-08 §3` | Owns the cross-platform OS, Kernel, CPU Architecture, Sandbox Tier (`S1`/`S2`/`S3`), Filesystem CoW (`clonefile`/`FICLONE`/ReFS), Toolchain, Native C Library (`SQLCipher 4.6.1`, `ONNX Runtime 1.19.2`), Rust Crate (`L0`–`L5`), and Frontend (`Tauri 2.1.0` / `React 19.0.0` / `TypeScript 5.6.3`) Compatibility Matrix. | Delegates reference lockfile graphs to `DOC-08 §4` (`Cargo.lock` / `apps/desktop/pnpm-lock.yaml`). | `test_189` |
| 12 | **Reference Workspace Manifests & Lockfiles** | `DOC-08 §4`, `Cargo.toml`, `.cargo/config.toml`, `Cargo.lock`, `apps/desktop/package.json`, `apps/desktop/pnpm-lock.yaml` | Owns the root `Cargo.toml` workspace manifest, `.cargo/config.toml` (`xtask` alias), `Cargo.lock` (v4 direct-dependency & 32-crate workspace-member lockfile specification), `apps/desktop/package.json`, and `apps/desktop/pnpm-lock.yaml` (`lockfileVersion: '9.0'` with `importers`, `packages`, and `snapshots`). | Delegates layer-dependency rules (`L0`–`L5`) to `DOC-02 §2`. | `test_190`, `test_191` |
| 13 | **Build, CLI Mapping & Troubleshooting Runbook** | `DOC-08 §5` | Owns step-by-step developer & operator runbooks: Reproducible Workspace Build (`RUN-BLD-001..005`), CLI-to-Engine API Ownership & Auth Mapping (`RUN-CLI-001`), and 12 Deterministic Troubleshooting Playbooks (`RUN-TRB-001..012`) mapping symptoms & `KIN-*` error codes to engine-mediated CLI/IPC recovery actions. | Delegates closed `KinError` enum definitions to `DOC-06 §1.2` and error registry metadata to `DOC-00 §5`. | `test_192` |

## 1. C4 Architecture Diagrams (Levels 1–4, `C4-L1`–`C4-L4`, Fixing `RT13-12`)

### 1.1 C4 Level 1 — System Context Diagram (`C4-L1-SYS`)

```text
+---------------------------------------------------------------------------------------------------+
|                                   C4 LEVEL 1: SYSTEM CONTEXT                                      |
|                                                                                                   |
|   +-------------------------------+                                                               |
|   |   Human Operator / Tech Lead  |                                                               |
|   |  (Directs Goals, Reviews DAG, |                                                               |
|   |   Approves R3/R4 & Applies)   |                                                               |
|   +---------------+---------------+                                                               |
|                   |                                                                               |
|                   | Directs via 4-Zone Desktop Workbench / `kin` CLI                              |
|                   | over Mutual 3-Step HMAC UDS (`$KIN_RUN_DIR/e.sock`)                           |
|                   v                                                                               |
|   +===========================================================================================+   |
|   |                         KIN (10.0.0-PRODUCTION) OPERATING ENVIRONMENT                     |   |
|   |   Local-First Multi-Agent Engineering Harness (`kin-shell` + `kin-cli` + `kin-engine`)    |   |
|   |   - Hierarchical AI Workforce (`@boss` -> 10+ Specialists -> Bounded Subagents)           |   |
|   |   - Self-Contained `$KIN_HOME/projects/<prj_id>/repo.git` & `wkt_*` Worktree Lanes        |   |
|   |   - SQLCipher-Encrypted `project.db` + `index.db` + BLAKE3/Ed25519 Tamper-Evident Ledger  |   |
|   |   - Dual OS Sandboxes (`S2-Lane-Exec` & `S2-Root-Snapshot`) + `kin-egress` Choke-Point    |   |
|   +===============+=============================+=============================+===============+   |
|                   |                             |                             |                   |
|   Zero-Write Read | (`S2-Root-Snapshot`)        | Single Egress Choke-Point   | Local OS Keychain |
|   & 2-Phase Apply | (`apply_journals`)          | (`kin-egress`, `INV-015`)   | (`PMK_prj` only)  |
|                   v                             v                             v                   |
|   +-------------------------------+   +-------------------------------+   +-------------------+   |
|   |  Host Project Root Workspace  |   | External LLM & MCP Endpoints  |   | Native OS Vault   |   |
|   |  (`<root_path>`, 0B pollution |   | - Anthropic / OpenAI / Gemini |   | - macOS Keychain  |   |
|   |   during S0 / lane execution) |   | - DeepSeek / Ollama (Local)   |   | - Linux SecretSvc |   |
|   |                               |   | - GitHub / Google Sheets MCP  |   | - Win Cred Locker |   |
|   +-------------------------------+   +-------------------------------+   +-------------------+   |
+---------------------------------------------------------------------------------------------------+
```

### 1.2 C4 Level 2 — Container & Process Boundary Diagram (`C4-L2-CNT`)

```text
+-------------------------------------------------------------------------------------------------------+
|                              C4 LEVEL 2: CONTAINER & PROCESS TOPOLOGY                                 |
|                                                                                                       |
|  +----------------------------------+              +-----------------------------------------------+  |
|  | `kin-shell` (Tauri v2 + React 19)|              | `kin-cli` (Headless Rust CLI Binary)          |  |
|  | 4-Zone Spatial Workbench UI      |              | CI/CD, headless runs, `ledger verify`, export |  |
|  +----------------+-----------------+              +-----------------------+-----------------------+  |
|                   |                                                        |                          |
|                   +---------------------------+----------------------------+                          |
|                                               |                                                       |
|                        16-Byte `KIN8` Frames over `$KIN_RUN_DIR/e.sock` (`<= 44B`, `0600`)            |
|                        Mutual 3-Step HMAC-SHA256 Handshake (`TRD-PRC-002`)                            |
|                                               v                                                       |
|  +=================================================================================================+  |
|  |                              `kin-engine` (Supervised Rust Daemon)                              |  |
|  |                                                                                                 |  |
|  |  +---------------------------+  +----------------------------+  +----------------------------+  |  |
|  |  | Orchestrator & Harness    |  | 9-Stage Dual-AST Policy    |  | Per-Lane `kin-egress`      |  |  |
|  |  | (`kin-orch`,`kin-harness`)|  | (`kin-policy`,`kin-crypto`)|  | Proxy + `KinDnsResolver`   |  |  |
|  |  +-------------+-------------+  +--------------+-------------+  +--------------+-------------+  |  |
|  |                |                               |                               ^                |  |
|  |                v                               v                               |                |  |
|  |  +---------------------------+  +----------------------------+                 | SCM_RIGHTS FD3 |  |
|  |  | Single-Writer Store Actor |  | Sandbox & Lane Supervisor  |-----------------+ or Auth Proxy  |  |
|  |  | (`kin-store`,`kin-ledger`)|  | (`kin-sandbox`,`kin-lanes`)|                                  |  |
|  |  +-------------+-------------+  +------+---------------+-----+                                  |  |
|  +================|=======================|===============|========================================+  |
|                   |                       |               |                                           |
|                   v                       v               v                                           |
|  +---------------------------------+  +-----------------------+  +---------------------------------+  |
|  | `$KIN_HOME/projects/<prj_id>/`  |  | `S2-Root-Snapshot`    |  | `S2-Lane-Exec` Worktree Jail    |  |
|  | - `project.db` (SQLCipher+vec0) |  | (`<root_path>` RO,    |  | (`$LANE_WORKTREE_DIR` RW,       |  |
|  | - `index.db` (SQLCipher+vec0)   |  |  `$REPO_GIT` RW,      |  |  `<root_path>` FORBIDDEN,       |  |
|  | - `repo.git` (Bare Object Pack) |  |  Zero Network Access) |  |  PID-1 Reaper + 29-Rule Seccomp)|  |
|  | - `blobs/*.zst.enc` (XChaCha20) |  +-----------------------+  +---------------------------------+  |
|  +---------------------------------+                                                                  |
+-------------------------------------------------------------------------------------------------------+
```

### 1.3 C4 Level 3 — `kin-engine` Component & 6-Layer Hexagonal Dependency Graph (`C4-L3-CMP`)

Enforced by Build Rule 2 (`cargo run --package xtask --locked -- check-deps` / `cargo xtask check-deps` via `.cargo/config.toml`) and verified against `Cargo.lock` in `test_190`:

```text
+---------------------------------------------------------------------------------------------------+
|                   C4 LEVEL 3: SIX-LAYER HEXAGONAL CRATE DEPENDENCY GRAPH                          |
|                                                                                                   |
|  [L5: Host Binaries]                                                                              |
|    `kin-engine` | `kin-shell` (Tauri v2) | `kin-cli` | `kin-bench` | `xtask`                      |
|         |  (Wires concrete L2/L3 adapters into L4 domain traits)                                  |
|         +-----------------------------------------+-----------------------------------+           |
|         |                                         |                                   |           |
|         v                                         v                                   v           |
|  [L4: Pure Domain & Orchestration]         [L3: Execution Adapters]        [L2: Persistence/Idx]  |
|    `kin-harness`  `kin-orch`                 `kin-policy`   `kin-sandbox`    `kin-store`          |
|    `kin-memory`   `kin-context`              `kin-lanes`    `kin-pty`        `kin-ledger`         |
|    `kin-tools`    `kin-tasks`                `kin-lsp`      `kin-gateway`    `kin-blobs`          |
|    `kin-sched`                               `kin-egress`   `kin-browser`    `kin-index`          |
|         |                                    `kin-mcp`                       `kin-vault`          |
|         | (Depends ONLY on L0 + L1 + `jiff` +     |                                   |           |
|         |  `tera` + `tokio(sync)`/`tokio-util`)   +-----------------+-----------------+           |
|         +-----------------------------------------+                 |                             |
|                                                   |                 |                             |
|                                                   v                 v                             |
|                                      [L1: Hexagonal Ports, Crypto & Plugin SDK]                   |
|                                        `kin-ports` | `kin-crypto` | `kin-plugin-sdk`              |
|                                                             |                                     |
|                                                             v                                     |
|                                      [L0: Foundation Types, Wire Proto & Errors]                  |
|                                        `kin-types` | `kin-proto` | `kin-error`                    |
+---------------------------------------------------------------------------------------------------+
```

### 1.4 C4 Level 4 — Code-Level Sequence Flows (`C4-L4-SEQ`)

```text
FLOW A: INTRA-BATCH PRE-MARKING & DUAL-AST TOOL DISPATCH (`DOC-06 §2.1`, `RT4-16`, `RT4-18`)
Model Step Batch `[Call_1..Call_N]`
  --> `evaluate_and_execute_step_batch`:
      1. Pre-check `ctx.step_count() >= ctx.max_steps()` -> abort cleanly with `KIN-HRN-0012` if at limit (`RT9-15`).
      2. Compute `batch_will_taint` & `batch_will_read_private_context` across ALL `Call_1..Call_N` (`RT4-16`).
      3. Persist `runs.tainted = 1` / `runs.has_private_context = 1` in `project.db` BEFORE evaluating `Call_1`.
      4. For each `raw_call`:
         a. Canonicalize RFC 8785 JCS in `SecretString` -> scan via `SecretRedactor`.
         b. If `had_vault_secret == true` on ANY tool -> force `DenyHardStop` (`KIN-POL-0009`, `RT4-18`).
         c. Evaluate Dual-AST `max(Risk(raw), Risk(redacted))` + Stage-6 Lethal-Trifecta (`tainted && has_private_context && exfil_capable -> ASK_HUMAN`).
         d. Persist redacted `tool.intent` in `tool_calls` + `ledger_events` (`synchronous = FULL`, `INV-004`).
         e. Acquire shared `tokio::sync::RwLock::read()` permit on `LaneId`, mint single-use `CapabilityToken`, execute in `S2-Lane-Exec`, increment `mutation_epoch`, redact/spill output (`> 16 KiB`), and log `tool.outcome`.

FLOW B: EPOCH-LOCKED 3-STRIKE COMPLETION GATE (`DOC-06 §2.2`, `INV-017`, `RT9-08`, `RT12-01`)
`EndTurnOnDirtyLane` (`changed_files_count > 0`)
  --> `verify_before_run_completion`:
      1. Acquire exclusive `tokio::sync::RwLock::write()` permit on `LaneId` and set `write_frozen = 1` (`trg_worktree_lanes_freeze_and_terminal`).
      2. If `[gates].fast_check` is unset -> set `verification_state = 'unverified_no_gate'`, `last_verified_tree_sha = NULL` (`ST-13`).
      3. Record `epoch_before` and `pre_tree_sha`; run `fast_check` inside `S2-Lane-Exec` (`timeout_seconds = 180`).
      4. Record `epoch_after` and `post_tree_sha`:
         - If `post_tree_sha != pre_tree_sha || epoch_after != epoch_before`: increment `tree_mutate_attempts` (`CHECK 0..3`, `RT12-01`); if `<= 2` inject self-heal (`attempt 1..2/2`), else (`> 2`, i.e. `3`) transition to `failed` & escalate to `@boss`.
         - If `exit_code == 0`: set `verification_state = 'verified'`, `last_verified_tree_sha = post_tree_sha`, reset `tree_mutate_attempts = 0` & `gate_fail_attempts = 0`.
         - If `exit_code != 0`: increment `fail_attempt = gate_fail_attempts + 1` (`CHECK 0..3`, `RT9-08`); if `< 3` (`1` or `2`) inject self-heal (`attempt 1..2/3`), else (`>= 3`) transition to `failed` & escalate to `@boss`.
```

## 2. Formal Architecture Decision Records Catalogue (`ADR-001`–`ADR-018`, Fixing `RT13-13`)

Every constitutional invariant (`INV-001`–`INV-018` in `DOC-00 §3`) is backed by a dedicated, non-overlapping Architecture Decision Record (`ADR-001`–`ADR-018`) below:

| ADR ID | Title & Status | Context & Problem Statement | Considered Alternatives | Canonical Decision | Consequences & Trade-Offs | Mapped Invariant & Enforcing Contract |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **ADR-001** | **App-Data State Isolation vs. Workspace Dot-Folder** (`Accepted`) | Storing SQLite DBs, logs, and worktrees inside `<root_path>/.kin/` pollutes `git status`, triggers IDE file watchers, and risks committing runtime state. | (A) Store DBs in `<root_path>/.kin/`; (B) Store all runtime state in `$KIN_HOME/projects/<prj_id>/` and keep `<root_path>/.kin/kin.toml` strictly optional and declarative. | Adopt **(B)**: all mutable state (`project.db`, `index.db`, `repo.git`, `blobs/`, `worktrees/`) resides under `$KIN_HOME/projects/<prj_id>/` (`0700`). | Requires deterministic `prj_` ULID lookup in `registry.db`, but guarantees zero workspace pollution. | `INV-001` (`DOC-02 §4` `projects` table, `test_03`) |
| **ADR-002** | **Opaque Secret Handle Substitution & Universal Literal-Secret Block** (`Accepted`) | Allowing agents to read `.env` or pass plaintext API keys in tool arguments leaks secrets into LLM prompts, SQLite rows, and source files. | (A) Post-hoc regex scrubbing only; (B) Opaque handles (`$KIN_SECRET_*` / `KIN_SECRET_*`) + pre-persistence `SecretRedactor` + Stage-1 `KIN-POL-0009` hard stop on any literal vault secret. | Adopt **(B)**: secrets live only in OS Keychain; `KIN-POL-0009` blocks any tool call containing a literal vault secret before execution (`RT4-18`). | Agents must declare `secret_env_handles` on `shell_exec`/`pty_open`, eliminating accidental secret writes into source files. | `INV-002` (`DOC-05 §2.1`, `DOC-06 §2.1`, `test_67`, `test_68`) |
| **ADR-003** | **Self-Contained `repo.git` Object Pack & Zero-Touch `<root_path>`** (`Accepted`) | Using `git worktree` directly on `<root_path>/.git` or using `objects/info/alternates` mutates `<root_path>/.git` locks and breaks when the user runs `git gc --prune=now`. | (A) Direct worktrees on `<root_path>/.git`; (B) `repo.git` with `alternates`; (C) Self-contained `$REPO_GIT` pack fetch (`+HEAD:refs/kin/root_head`) inside `S2-Root-Snapshot` with recursive `:(glob)**/` secret stripping. | Adopt **(C)**: `repo.git` fetches its own object pack inside `S2-Root-Snapshot` and strips tracked/untracked secrets before `write-tree`. | Uses extra disk space for packfile copy in `$REPO_GIT`, but survives `git reset --hard && git gc` with zero bytes written to `<root_path>`. | `INV-003` (`DOC-04 §1.2–§1.4`, `test_09`, `test_56`, `test_152`) |
| **ADR-004** | **Two-Phase `synchronous = FULL` Intent-Before-Effect Journaling** (`Accepted`) | If `kin-engine` crashes mid-tool execution or mid-root-apply, unjournaled side effects leave the workspace in an unknown state. | (A) Log after tool completion (`synchronous = NORMAL`); (B) Log `tool.intent` / `lane.apply.intent` with `PRAGMA synchronous = FULL` before minting `CapabilityToken` or staging files, paired with `outcome` after. | Adopt **(B)**: every side effect is bracketed by a durable `intent_ledger_seq` and `outcome_ledger_seq` in `ledger_events`. | Adds `fsync` latency (~1–2ms per tool call), but guarantees 100% crash auditability. | `INV-004` (`DOC-02 §4` `tool_calls`, `apply_journals`, `test_94`) |
| **ADR-005** | **At-Most-Once Side-Effect Crash Recovery Gate** (`Accepted`) | Auto-replaying interrupted `shell_exec` or `web_fetch` calls after a `SIGKILL` crash can duplicate non-idempotent external mutations. | (A) Auto-retry all interrupted tools on boot; (B) Auto-retry `read_only` and `idempotent_write` tools, but transition `non_idempotent_write` and `external_side_effect` tools to `interrupted_needs_reconcile` (`waiting_recovery`). | Adopt **(B)**: enforced by the 11-state Boot Crash Recovery Matrix in `DOC-03 §2.2`. | Requires operator confirmation (`Retry` / `Mark Succeeded` / `Abort`) after a hard crash during a non-idempotent tool call. | `INV-005` (`DOC-03 §2.2`, `DOC-06 §1.1` `RecoveryResolve`, `test_156`) |
| **ADR-006** | **Monotonic Hierarchical Capability & Budget Attenuation** (`Accepted`) | Subagents spawned via `agent_delegate` or `agent_map_reduce` could otherwise escalate autonomy or exhaust the parent run's token budget. | (A) Flat global agent permissions; (B) Strict tree hierarchy (`spawn_depth BETWEEN 0 AND 2`, `trg_agents_hierarchy_insert`/`_update`) where child grants, autonomy, and budgets are a strict subset of the parent's. | Adopt **(B)**: enforced at Stage 7 of `kin-policy` and by SQLite triggers on `agents`. | Caps delegation depth at 2 (`@boss` -> Specialist -> Subagent), preventing unbounded swarm recursion. | `INV-006` (`DOC-02 §4` `agents`, `DOC-05 §2.1`, `test_120`) |
| **ADR-007** | **Per-Context Run Serialization & Monotonic Lineage/Cost Triggers** (`Accepted`) | Concurrent runs on the same `(agent_id, context_key)` race on conversation history, and mutable `parent_run_id` allows detaching a child run before tainting. | (A) Application-level mutex only; (B) SQLite partial unique index `idx_runs_single_active_per_agent_context` + `trg_runs_monotonic_and_terminal` locking lineage columns and monotonic counters. | Adopt **(B)**: enforced directly inside SQLite (`KIN-SEC-0013`). | Queues concurrent wakes for the same context in `wake_queue` with taint-preserving coalescing. | `INV-007` (`DOC-02 §4` `runs`, `test_24`, `test_85`, `test_119`) |
| **ADR-008** | **Two-Level Hash-Chained Ledger with Signed Privacy Purge Receipts** (`Accepted`) | GDPR/operator `/forget` requests require purging sensitive payloads from disk without breaking the cryptographic BLAKE3 hash chain of `ledger_events`. | (A) Hash raw payload inline in `ledger_events` (breaks chain on purge); (B) Store `payload_blake3` in `ledger_events` and JCS JSON in `ledger_payloads`, requiring a signed `privacy.purge.receipt` (`LSK_prj`) before `DELETE FROM ledger_payloads`. | Adopt **(B)**: enforced by `trg_ledger_enforce_chain`, `trg_ledger_payloads_require_receipt` (`KIN-LDG-0007`), and `trg_ledger_payloads_sync_purge`. | Preserves 100% hash-chain continuity from `seq = 0` while allowing verifiable erasure of payload bytes. | `INV-008` (`DOC-02 §4`, `DOC-05 §4.1–§4.2`, `test_61`, `test_77`, `test_128`, `test_159`) |
| **ADR-009** | **Pure Event-Projected UI over Mutually Authenticated Local IPC** (`Accepted`) | Exposing a localhost HTTP port for the desktop UI allows browser/CSRF/local-process attacks, and stateful UI mutations desynchronize on reconnect. | (A) Localhost TCP REST/WebSocket server; (B) `$KIN_RUN_DIR/e.sock` (`0600`) with mutual 3-step HMAC handshake (`KIN8`) + `ProjectSnapshot` and gapless `project_events(seq)` projection. | Adopt **(B)**: zero loopback TCP listeners for IPC; UI state is a pure function of `ProjectSnapshot` + `EventBatch`. | Achieves `< 150ms` project switching (`PRD-PRJ-003`) and blocks both rogue clients and rogue servers. | `INV-009` (`DOC-02 §1.2`, `DOC-06 §1.1`, `test_16`, `test_19`, `test_72`) |
| **ADR-010** | **Prose-Blind Dual-AST Policy, Batch Pre-Marking & Taint Propagation** (`Accepted`) | Prompt-injected models can disguise dangerous shell commands via secret redaction or emit `[fs_read, web_fetch]` in a single batch to race taint marking. | (A) Evaluate tool calls sequentially using model-supplied `reason`; (B) Ignore `reason`, pre-mark `batch_will_taint` and `batch_will_read_private_context` across the entire batch (`RT4-16`), evaluate `max(Risk(raw), Risk(redacted))`, and propagate taint via SQLite triggers. | Adopt **(B)**: enforced by `evaluate_and_execute_step_batch` and 7 SQLite taint triggers (`KIN-SEC-0010`..`0018`). | Forces `ASK_HUMAN` whenever private context + untrusted taint + exfiltration capability co-occur (Lethal Trifecta). | `INV-010` (`DOC-02 §4`, `DOC-05 §2`, `DOC-06 §2.1`, `test_18`, `test_60`, `test_65`, `test_78`) |
| **ADR-011** | **9-Layer Prompt Compiler with Byte-Stable `BP1–BP2` Prefix** (`Accepted`) | Injecting dynamic timestamps, repo-maps, or mid-run memory writes into early prompt layers invalidates provider KV caches on every step. | (A) Single monolithic system prompt rebuilt per step; (B) 9-Layer Prompt Compiler where `L1–L3` (`BP1`) and `L4–L6` (`BP2`, pinned to `memory_snapshot_seq`) are 100% run-static, `L7` (`BP3`) is append-only, and dynamic PageRank Repo-Map/reminders live in `L8`/`L9`. | Adopt **(B)**: enforced by `prompt_prefix_hash` equality assertions across steps. | Achieves `>= 85%` measured provider KV-cache hit SLI (`NFR-COST-001`) while keeping repo-maps fresh in `L8`. | `INV-011` (`DOC-03 §4`, `test_38`, `test_147`, `test_165`) |
| **ADR-012** | **Scope-Partitioned `sqlite-vec` (`vec0`) & Composite Same-Scope Graph FKs** (`Accepted`) | Unpartitioned vector indexes scan private `T3`/`T4` agent memories during `T1`/`T2` queries, and unvalidated graph edges can link private entities into shared scopes. | (A) Global vector table with post-filtering; (B) `memory_vec` partitioned by `scope_key TEXT PARTITION KEY` (`<tier>:<scope_id>`) + triggers `trg_memory_vec_ai`/`_ad`/`_au` + composite FKs `(entity_id, tier, scope_id)` on `memory_edges`. | Adopt **(B)**: enforced by `query_memory_vec_knn_scoped` and SQLite composite foreign keys. | Guarantees partition-level vector confidentiality and zero cross-scope graph leakage. | `INV-012` (`DOC-02 §4`, `DOC-03 §3.2`, `test_29`, `test_31`, `test_127`, `test_172`) |
| **ADR-013** | **Database & Schema-Enforced Resource Bounds Everywhere** (`Accepted`) | Unbounded agent spawning, meeting rounds, DM ping-pong loops, or tool output sizes can exhaust memory, disk, or token budgets. | (A) Soft prompt instructions only; (B) Hard SQLite `CHECK` constraints (`max_agents_cap = 24`, `spawn_depth <= 2`, `max_steps <= 200`, `meetings` 2..6 participants, `consecutive_agent_turns <= 4`), `16 KiB` spill cap, and strict JSON Schema bounds. | Adopt **(B)**: enforced across SQLite DDL (`DOC-02 §4`), harness guards (`DOC-03 §2.6`), and 26-tool JSON schemas (`DOC-07 §2`). | Prevents runaway loops and guarantees bounded memory/storage footprint. | `INV-013` (`DOC-02 §4`, `DOC-07 §2`, `test_25`, `test_45`, `test_73`, `test_129`, `test_163`) |
| **ADR-014** | **Append-Only Raw History Archive with FTS5 Recall** (`Accepted`) | Context compaction (`L1–L4`) must shrink active prompt tokens (`context_items`) without losing raw historical messages or tool call transcripts. | (A) Delete or overwrite old `messages` and `tool_calls` during compaction; (B) Lock `messages`, `run_steps`, and `tool_calls` with `BEFORE DELETE` and column-level `IS NOT` `BEFORE UPDATE` triggers (`KIN-HIS-0001..0006`) and index them in `messages_fts` and `tool_calls_fts`. | Adopt **(B)**: compaction mutates only `context_items.is_active` and `messages.is_compacted = 1`, leaving raw history searchable via `recall`. | Preserves full forensic history and FTS5 recall while keeping active prompts within $W_{\text{eff}}$. | `INV-014` (`DOC-02 §4`, `DOC-03 §4.1`, `test_22`, `test_59`) |
| **ADR-015** | **Per-Lane Authenticated `kin-egress` Choke-Point & Strict `2000::/3` SSRF Filter** (`Accepted`) | Sandboxed tools, Git, MCP servers, or headless Chromium could bypass host allowlists via DNS rebinding, IPv6 transition prefixes (`6to4`, `Teredo`, `NAT64`), HTTP 3xx redirects, or UDP QUIC/WebRTC. | (A) Advisory `HTTP_PROXY` without authentication or IP pinning; (B) Single `reqwest` choke-point (`kin-egress`) with per-lane `Proxy-Authorization` (`SEC-EGR-002`), dynamic human approval host grant (`SEC-EGR-003`), single-resolution `KinDnsResolver` (`is_ssrf_forbidden_ip` / `is_publicly_routable_ip`), 5-hop DNS-pinned & scheme-checked custom redirect policy, and Chromium `--disable-quic` / WebRTC UDP disable flags. | Adopt **(B)**: kernel-enforced across `S2` (`CLONE_NEWNET` + `SCM_RIGHTS` FD 3 on Linux; Seatbelt `EGRESS_PROXY_ADDR` on macOS) and `S3` (Windows WSL2/AppContainer); on Windows `S1` (advisory `HTTP_PROXY`), `local_only_lock = 1` blocks subprocess spawning (`KIN-EGR-0006`) and `local_only_lock = 0` enforces `R3 ASK_HUMAN` with a direct-socket warning. | Eliminates DNS-rebinding TOCTOU, IPv4/IPv6 SSRF bypasses, redirect smuggling, and cross-lane proxy spoofing. | `INV-015` (`DOC-04 §6`, `DOC-05 §3.2`, `DOC-06 §2.4`, `test_44`, `test_66`, `test_116`, `test_123`, `test_124`, `test_157`) |
| **ADR-016** | **Zero Silent Telemetry & Opt-In-Only Signed Updater** (`Accepted`) | Enterprise and privacy-sensitive operators require a guarantee that no background network calls, telemetry pings, or automatic update checks occur without explicit consent. | (A) Background update polling enabled by default; (B) Zero telemetry/analytics endpoints and `check_updates_enabled = false` by default in `.kin/kin.toml`, with Ed25519 + BLAKE3 verification when manually triggered (`SEC-UPD-001`). | Adopt **(B)**: KIN makes zero unrequested outbound connections on startup or idle. | Satisfies strict air-gapped and `local_only_lock = 1` compliance requirements. | `INV-016` (`DOC-05 §7`, `DOC-07 §4`, `test_43`, `test_130`) |
| **ADR-017** | **Epoch-Locked Pre-Completion Self-Healing Verification Gate** (`Accepted`) | Coding agents frequently claim a task is complete without running the project's build/test suite or while background tools/formatters are still mutating files. | (A) Trust agent self-attestation; (B) Acquire exclusive async `RwLock::write()` permit (`write_frozen = 1`), run `[gates].fast_check` in `S2-Lane-Exec`, verify `pre_tree_sha == post_tree_sha` and `epoch_before == epoch_after`, and persist `tree_mutate_attempts` (`0..3`) and `gate_fail_attempts` (`0..3`) in SQLite. | Adopt **(B)**: enforced by `verify_before_run_completion` (`DOC-06 §2.2`) and `worktree_lanes` triggers/checks (`DOC-02 §4`). | Survives `SIGKILL` crashes without resetting retry counters and prevents unverified code from completing a run. | `INV-017` (`DOC-02 §4`, `DOC-03 §2.4`, `DOC-06 §2.2`, `test_17`, `test_69`, `test_105`, `test_122`, `test_151`) |
| **ADR-018** | **Zero-Turn Inline Tree-sitter & Warm LSP Diagnostic Feedback (`< 80ms`)** (`Accepted`) | Agents waste entire LLM turns and thousands of tokens when they only discover syntax or type errors by running `cargo check` in a subsequent step. | (A) Separate manual lint tool; (B) Inline `<inline_diagnostics>` returned directly by every `fs_write` and `fs_patch` within `< 80ms` (`< 5ms` incremental Tree-sitter + `55ms` warm LSP `publishDiagnostics` timeout + `15ms` IPC margin = `75ms`). | Adopt **(B)**: enforced by `kin-lanes` and `kin-lsp` (`diagnostic_wait_ms = 55` in `.kin/kin.toml`). | Cuts syntax/type correction latency to 0 extra tool turns while bounding LSP memory via `ENV-LSP-001`. | `INV-018` (`DOC-01 §6`, `DOC-04 §2.2`, `DOC-07 §4`, `test_96`, `test_130`, `test_142`) |

## 3. Complete Dependency & Compatibility Matrix (`CMP-*`, Fixing `RT13-14`)

### 3.1 Operating System, Kernel, Sandbox Tier & Copy-on-Write Compatibility Matrix (`CMP-OS-001`)

| Platform | Supported OS Release & CPU Arch | Default Sandbox Tier | Kernel Isolation Primitives Used | Worktree CoW Strategy (`worktree_lanes.cow_strategy`) | Fallback & Compensating Control |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **macOS** | macOS 14 Sonoma, macOS 15 Sequoia (`aarch64-apple-darwin`, `x86_64-apple-darwin`) | `S2` (`S2-Lane-Exec` & `S2-Root-Snapshot`) | Seatbelt (`sandbox_init` `.sb` profiles, ancestor `file-read-metadata`, `EGRESS_PROXY_ADDR` loopback confinement) | `apfs_clonefile` (`clonefile(2)`) | `env_redirect_copy` on non-APFS external volumes |
| **Linux (Modern Kernel)** | Kernel `>= 6.2` (Ubuntu 24.04 LTS, Debian 12 backports, Fedora 40+, Arch; `x86_64` & `aarch64`) | `S2` (`S2-Lane-Exec` & `S2-Root-Snapshot`) | `unshare(CLONE_NEWUSER + NEWNS + NEWPID + NEWNET)`, PID-1 reaper, fresh `/proc`, **Landlock ABI v3**, **29-rule `seccompiler 0.4`**, `SCM_RIGHTS` FD 3 egress | `btrfs_xfs_reflink` (`ioctl(FICLONE)`) or `env_redirect_copy` (ext4) | If Ubuntu 24.04 AppArmor blocks `unshare(CLONE_NEWUSER)` with `EPERM`, transitions to `S1` (`R3 ASK_HUMAN` floor on all shell/PTY) and displays `/etc/apparmor.d/dev.kin.sandbox` banner (`RT4-05`) |
| **Linux (LTS Kernel)** | Kernel `5.15 – 6.1` (Ubuntu 22.04 LTS, RHEL 9, Debian 12; `x86_64` & `aarch64`) | `S2` (`S2-Lane-Exec` & `S2-Root-Snapshot`) | Same namespace, PID-1 reaper, `/proc`, and 29-rule seccomp-bpf stack, negotiating **Landlock ABI v1** (`DOC-07 §3.2`) | `btrfs_xfs_reflink` or `env_redirect_copy` | If `RulesetStatus::NotEnforced`, fails closed to `S1` (`R3 ASK_HUMAN` floor) |
| **Windows 11 (Default)** | Windows 11 23H2 / 24H2 (`x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`) | `S1` | Win32 Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, memory/process caps) + `CreateRestrictedToken(DISABLE_MAX_PRIVILEGE)` + Low-IL SID `S-1-16-4096` + scrubbed UTF-16 env (`DOC-07 §3.3`) | `refs_block_clone` (Dev Drive ReFS) or `env_redirect_copy` (NTFS) | In `S1`, `HTTP_PROXY` is advisory; `kin-policy` Stage 5 elevates **100% of `shell_exec`, `pty_open`, and `pty_write` calls to `R3` (`ASK_HUMAN`)** (`AUD-15`, `ST-05`) |
| **Windows 11 (WSL2 / AppContainer)** | Windows 11 23H2+ with WSL2 Linux Kernel `>= 5.15` or AppContainer profile | `S3` | Full Linux `S2` stack inside WSL2 utility VM (or Win32 AppContainer firewall + capability SIDs) | `env_redirect_copy` / ext4 VHDX | Automatic fallback to `S1` (`R3 ASK_HUMAN`) if WSL2 is unavailable |

### 3.2 Native C Libraries, Compilers, Runtimes & External Protocol Compatibility Matrix (`CMP-TCN-001`)

| Component / Protocol | Pinned Version | Minimum / Compatible Range | Linking & Bundling Strategy | Enforcing Layer / Contract |
| :--- | :--- | :--- | :--- | :--- |
| **Rust Toolchain (MSRV)** | `1.82.0` (`2021` edition) | `>= 1.82.0` | Pinned in `Cargo.toml` (`rust-version = "1.82.0"`) | Workspace `unsafe_code = "deny"`, crate `#![forbid(unsafe_code)]` in 29 pure-safe crates, `#![allow(unsafe_code)]` only in audited OS FFI (`kin-sandbox`, `kin-vault`, `kin-store`) |
| **SQLite / SQLCipher** | SQLite `3.46.1` / SQLCipher `4.6.1` | SQLite `>= 3.45.0` | Statically linked via `rusqlite = "=0.32.1"` (`bundled-sqlcipher-vendored-openssl`) | `kin-store` (`AES-256-CBC + HMAC-SHA512`, `SQLITE_DBCONFIG_DEFENSIVE`) |
| **`sqlite-vec` Extension** | `0.1.9` (`vec0`) | `>= 0.1.6` | Statically registered via `sqlite3_auto_extension` in `kin-store` | `memory_vec` (`scope_key` partition) & `code_chunks_vec` (`float[384]`) |
| **ONNX Runtime (`ort`)** | `2.0.0-rc.6` (ONNX Runtime `1.19.2`) | `1.19.x` | Bundled shared library + `bge-small-en-v1.5-q8.onnx` (384-dim) | `kin-index`, `kin-memory`, `kin-orch` Stage-2 scorer |
| **Tree-sitter Core & Bash** | `tree-sitter = 0.24.3`, `tree-sitter-bash = 0.23.1` | `>= 0.23.0` | Statically compiled C grammars | `kin-policy` Dual-AST classifier, `kin-index`, `kin-lanes` Tier-3 patch |
| **Git CLI (Host or Bundled)** | `2.46.2` | `>= 2.38.0` (requires `merge-tree --write-tree` & `:(glob)`) | Bundled minimal `git` binary in desktop installer (`kin-shell`) | `kin-lanes` (`S0` snapshot, 3-way merge queue, worktree add/remove/prune) |
| **Model Context Protocol (MCP)** | `2026-07-28` (Stateless Streamable HTTP & `stdio`) | `2026-07-28` | Enforced via `MCP-Protocol-Version: 2026-07-28` header & `pinned_schema_sha256` | `kin-mcp` (`DOC-05 §6.1`, `mcp_integrations` table) |
| **Node.js / pnpm (UI Build)** | Node `22.11.0 LTS` / `pnpm 9.12.2` | Node `>= 22.11.0`, `pnpm >= 9.12.0` | Used at build time for `apps/desktop` (`kin-shell` Tauri v2 frontend) | `apps/desktop/package.json` & `apps/desktop/pnpm-lock.yaml` (`lockfileVersion: '9.0'`) |

## 4. Reference Pinned Workspace Manifests & Lockfiles (`LCK-CRG-001`, `LCK-PNPM-001`, Fixing `RT13-15`, `RT13-16` & Audit Findings 1–4, 11–13)

To ensure deterministic dependency governance across macOS, Linux, and Windows, the reference root `Cargo.toml`, `.cargo/config.toml` (`xtask` alias), `Cargo.lock` (v4 direct-dependency and 32-crate workspace-member topology specification), `apps/desktop/package.json`, and `apps/desktop/pnpm-lock.yaml` (v9 with `importers`, `packages`, and `snapshots`) are specified below and shipped at their canonical paths in the specification bundle. Every crate version in `Cargo.toml` and `Cargo.lock` matches `DOC-02 §2.2` 1-to-1, and every internal crate dependency in `Cargo.lock` obeys the 6-Layer Hexagonal Dependency Graph (`Build Rule 2`, verified in `test_190` and `test_191`). In the implementation repository, CI validates full transitive registry lockfiles with `cargo test --workspace --locked` and `pnpm --dir apps/desktop install --frozen-lockfile`.

### 4.1 Root Workspace `Cargo.toml` & `.cargo/config.toml`

```toml
[workspace]
resolver = "2"
members = [
    "crates/kin-types",
    "crates/kin-proto",
    "crates/kin-error",
    "crates/kin-ports",
    "crates/kin-crypto",
    "crates/kin-plugin-sdk",
    "crates/kin-store",
    "crates/kin-ledger",
    "crates/kin-blobs",
    "crates/kin-index",
    "crates/kin-vault",
    "crates/kin-policy",
    "crates/kin-sandbox",
    "crates/kin-lanes",
    "crates/kin-pty",
    "crates/kin-lsp",
    "crates/kin-gateway",
    "crates/kin-egress",
    "crates/kin-browser",
    "crates/kin-mcp",
    "crates/kin-memory",
    "crates/kin-context",
    "crates/kin-tools",
    "crates/kin-harness",
    "crates/kin-orch",
    "crates/kin-tasks",
    "crates/kin-sched",
    "crates/kin-engine",
    "crates/kin-shell",
    "crates/kin-cli",
    "crates/kin-bench",
    "xtask",
]

[workspace.package]
version = "10.0.0"
edition = "2021"
rust-version = "1.82.0"
license = "LicenseRef-KIN-Proprietary"

[workspace.lints.rust]
# Audited OS FFI modules in kin-sandbox, kin-vault, and kin-store override `deny` via module-level `#![allow(unsafe_code)]`
# accompanied by mandatory `// SAFETY:` proofs; all other 29 workspace crates set crate-level `#![forbid(unsafe_code)]`.
unsafe_code = "deny"

[workspace.lints.clippy]
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
todo = "deny"
unimplemented = "deny"

[workspace.dependencies]
serde = { version = "=1.0.210", features = ["derive"] }
serde_json = "=1.0.128"
specta = { version = "=2.0.0-rc.20", features = ["derive"] }
thiserror = "=1.0.64"
ulid = "=1.1.3"
jiff = "=0.1.13"
blake3 = "=1.5.4"
ed25519-dalek = { version = "=2.1.1", features = ["rand_core"] }
chacha20poly1305 = "=0.10.1"
argon2 = "=0.5.3"
hkdf = "=0.12.4"
sha2 = "=0.10.8"
hmac = "=0.12.1"
subtle = "=2.6.1"
secrecy = "=0.10.3"
aho-corasick = "=1.1.3"
rusqlite = { version = "=0.32.1", features = ["bundled-sqlcipher-vendored-openssl"] }
sqlite-vec = "=0.1.9"
zstd = "=0.13.2"
ort = "=2.0.0-rc.6"
ignore = "=0.4.23"
keyring = "=3.4.1"
landlock = "=0.4.1"
seccompiler = "=0.4.0"
libc = "=0.2.161"
windows-sys = { version = "=0.59.0", features = ["Win32_System_JobObjects", "Win32_Security", "Win32_System_Threading"] }
cap-std = "=3.4.1"
portable-pty = "=0.8.1"
tree-sitter = "=0.24.3"
tree-sitter-bash = "=0.23.1"
# Workspace base exposes only `sync` for Layer L4 crates; L2/L3/L5 crates opt into `rt`, `macros`, `time`, `net`, `process`, `io-util`, `fs` per-crate (enforced by `xtask check-deps`).
tokio = { version = "=1.40.0", default-features = false, features = ["sync"] }
tokio-util = { version = "=0.7.12", features = ["sync", "rt"] }
reqwest = { version = "=0.12.8", default-features = false, features = ["rustls-tls", "json", "stream"] }
chromiumoxide = "=0.7.0"
tera = "=1.20.0"
tauri = { version = "=2.1.0", features = ["wry"] }
clap = { version = "=4.5.20", features = ["derive"] }
```

```toml
# .cargo/config.toml — Canonical Workspace Cargo Aliases (Fixing Audit Finding 12)
[alias]
xtask = "run --package xtask --locked --"
```

### 4.2 Reference `Cargo.lock` (v4 Pinned Direct-Dependency & 32-Member Workspace Graph)

```toml
# Reference Direct-Dependency & Workspace-Topology Lockfile Specification (Cargo.lock v4)
# Validated against Cargo.toml [workspace.dependencies] and 6-Layer Hexagonal Rules by verify_kin_v10_0_suite.py.
version = 4

[[package]]
name = "aho-corasick"
version = "1.1.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "850ee406414b85701ac6d20fdec053ebb2b95aea1627e2ac28e2f9a262073dc7"

[[package]]
name = "argon2"
version = "0.5.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "7f4e12b103279bf4b0970a80e4e0bae031387d119d576340319dfa39b9c85e8c"
dependencies = ["blake3", "subtle"]

[[package]]
name = "blake3"
version = "1.5.4"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "3d8364a0d25abdde3a6f653d1de2fe1303cb7a276c6ecd0370ef5eac69ab66f4"
dependencies = ["subtle"]

[[package]]
name = "cap-std"
version = "3.4.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "5a6f603b93a90d2c65e4339574344e3ab04ee279b5e4ad88987ba2f9d12390af"
dependencies = ["libc", "windows-sys"]

[[package]]
name = "chacha20poly1305"
version = "0.10.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "81f26a2078d41c6438590a0b2c288171af4a842b537eb83436b0256b3907a1cb"
dependencies = ["subtle"]

[[package]]
name = "chromiumoxide"
version = "0.7.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "95fe0a657c44e5ee2712fa54b7a5800620214ea48da1438161439b5b577bb2bf"
dependencies = ["serde", "serde_json", "thiserror", "tokio"]

[[package]]
name = "clap"
version = "4.5.20"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "9fb9e2fc2cc6a8a9231d7ac3eb2e96f935b4686b72ba33e95feabfdc52b43dab"
dependencies = ["serde"]

[[package]]
name = "ed25519-dalek"
version = "2.1.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "d09aa29ead48508660600a9db0464f1ccc2e2bac30ecc9bbaca33ab69eb3308b"
dependencies = ["sha2", "subtle"]

[[package]]
name = "hkdf"
version = "0.12.4"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "8a193f5451abaa443bf5e741fc7c5bc3fe0cf2a8c3247bceb13879c2955c706a"
dependencies = ["hmac", "sha2"]

[[package]]
name = "hmac"
version = "0.12.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "ee46a3e9eec615f3116db86f23368922690ab4e63e690cc2dcd93fe0eab03299"
dependencies = ["sha2", "subtle"]

[[package]]
name = "ignore"
version = "0.4.23"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "f1a3a5789fa1980b9e9d2a3c7f3ac0c016acbf01aea1073507ea8cb1b2c38525"
dependencies = ["aho-corasick"]

[[package]]
name = "jiff"
version = "0.1.13"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "bb1903d4ec705870486f9b16d082ef09c2b1765888d94774e7cf164c6c4adae8"
dependencies = ["serde"]

[[package]]
name = "keyring"
version = "3.4.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "db7432f740c92c5d385fe30c1aa94f15fffb32ef424fb260da9778c014de0c03"
dependencies = ["libc", "windows-sys"]

[[package]]
name = "landlock"
version = "0.4.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "10a31f39e8eb795044d2f3b1f8669a52b176a38b1b8dcd07e2d3b0ad6f754e02"
dependencies = ["libc"]

[[package]]
name = "libc"
version = "0.2.161"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "9ace6e1ba37863169cdde7b63ed49e89e54be5a5887d6d3c302d858989a4c1a6"

[[package]]
name = "ort"
version = "2.0.0-rc.6"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "589d30345fbffeb0ba6e500f2b64a496c13c40c23dd5ddb4c4c5bd5ec95bde5f"
dependencies = ["thiserror"]

[[package]]
name = "portable-pty"
version = "0.8.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "b247530a8c25ccae9d6f49a37e4e7e1e0ee8825a7c414aea380fe0e83cb61646"
dependencies = ["libc", "windows-sys"]

[[package]]
name = "reqwest"
version = "0.12.8"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "a7f05eb4cc2aea786743d92696ddcbedcdb9ed8805767277b95d113b0614e706"
dependencies = ["serde", "serde_json", "tokio", "tokio-util"]

[[package]]
name = "rusqlite"
version = "0.32.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "4b968e51f198ece63e1782b1720c1235218204cba167b7f822463c58929235e1"
dependencies = ["libc"]

[[package]]
name = "seccompiler"
version = "0.4.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "992154b282fdd44b00859d979b77fc025d2f4d87c67aa0e9769d2b8d07c0ca5b"
dependencies = ["libc", "thiserror"]

[[package]]
name = "secrecy"
version = "0.10.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "f9a67f43d253524c1dc6c18a8210614635f5aef0ca5886bb9d009dc4ef81b7e6"
dependencies = ["serde"]

[[package]]
name = "serde"
version = "1.0.210"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "eaa274ec0b26032a882708b6d271ac6f5274ba6b8b1dd34e800c6516215e6031"

[[package]]
name = "serde_json"
version = "1.0.128"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "cc1a932155217550e5feae98d64979bc16cc8d8af97a8d032450068877deabf4"
dependencies = ["serde"]

[[package]]
name = "sha2"
version = "0.10.8"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "0793cc59e2c4ad028b97799d72d3c2220cc46de8fb102240fe8d708705639483"

[[package]]
name = "specta"
version = "2.0.0-rc.20"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "0292b5f57fc47bec84be90251329fe4d5995066b65baf18bb67aa77b32785ad6"
dependencies = ["serde"]

[[package]]
name = "sqlite-vec"
version = "0.1.9"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "4e60ab2a37c4887a5457eab536700d6c087c71d3fdfa742b066830d19b4c9448"
dependencies = ["rusqlite"]

[[package]]
name = "subtle"
version = "2.6.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "88007a6d83b927c8201f73f9732e311d2f8b45be879a2707e32fd507b8cc69a3"

[[package]]
name = "tauri"
version = "2.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "62a6e410f9926249b1cf79ad182e546e8ff23bf98ba68b152d052d5e6947437c"
dependencies = ["serde", "serde_json", "thiserror", "tokio"]

[[package]]
name = "tera"
version = "1.20.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "07b5a28cae10949decd04317b755a2b222cf7b96ded5ed0df90b09a321099b74"
dependencies = ["serde", "serde_json"]

[[package]]
name = "thiserror"
version = "1.0.64"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "eaee6d3c4d589c13554854ac15c1f54ff3bac969f546ee6433239eb9c4446d20"

[[package]]
name = "tokio"
version = "1.40.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "fbadeb5e123993b82731be8ccb7c41b81d7aca7c748f6a29b1ad86b52e61cc66"
dependencies = ["libc", "windows-sys"]

[[package]]
name = "tokio-util"
version = "0.7.12"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "9fa5ed291656edd79ac36b78fca710aaa9ce2025648d08cbdbe0c368895b7e74"
dependencies = ["tokio"]

[[package]]
name = "tree-sitter"
version = "0.24.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "a74e2fd3e2087e29d08d5eb2aee1d940146a30c3ba435758e46308c799b87211"

[[package]]
name = "tree-sitter-bash"
version = "0.23.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "f36e857c9f7d8c3fec4bb153533c3be28bd7cbf3688168e407e4f74e8c2a960e"
dependencies = ["tree-sitter"]

[[package]]
name = "ulid"
version = "1.1.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "2ba17d9704b8dad03a903b4786a091da580398db740e427cdc10aac22ba8a529"
dependencies = ["serde"]

[[package]]
name = "windows-sys"
version = "0.59.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "d09291612a48d4000c816986e3d45469af972b6d6c827755fa4020b4a8679515"

[[package]]
name = "zstd"
version = "0.13.2"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "160d743df85b1dbfb8cce82f0aab0d596c73b017493ad48b404442a3ff8646d9"
dependencies = ["libc"]

[[package]]
name = "kin-types"
version = "10.0.0"
dependencies = ["serde", "serde_json", "specta", "ulid", "jiff"]

[[package]]
name = "kin-proto"
version = "10.0.0"
dependencies = ["kin-types", "serde", "serde_json", "specta"]

[[package]]
name = "kin-error"
version = "10.0.0"
dependencies = ["kin-proto", "thiserror"]

[[package]]
name = "kin-ports"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error"]

[[package]]
name = "kin-crypto"
version = "10.0.0"
dependencies = ["kin-types", "kin-error", "blake3", "ed25519-dalek", "chacha20poly1305", "argon2", "hkdf", "sha2", "hmac", "subtle", "secrecy", "aho-corasick"]

[[package]]
name = "kin-plugin-sdk"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error"]

[[package]]
name = "kin-store"
version = "10.0.0"
dependencies = ["kin-ports", "kin-crypto", "rusqlite", "sqlite-vec"]

[[package]]
name = "kin-ledger"
version = "10.0.0"
dependencies = ["kin-ports", "kin-crypto"]

[[package]]
name = "kin-blobs"
version = "10.0.0"
dependencies = ["kin-ports", "kin-crypto", "zstd"]

[[package]]
name = "kin-index"
version = "10.0.0"
dependencies = ["kin-ports", "kin-store", "ort", "ignore", "tree-sitter"]

[[package]]
name = "kin-vault"
version = "10.0.0"
dependencies = ["kin-ports", "kin-crypto", "keyring"]

[[package]]
name = "kin-policy"
version = "10.0.0"
dependencies = ["kin-ports", "kin-crypto", "tree-sitter", "tree-sitter-bash"]

[[package]]
name = "kin-sandbox"
version = "10.0.0"
dependencies = ["kin-ports", "landlock", "seccompiler", "libc", "windows-sys"]

[[package]]
name = "kin-lanes"
version = "10.0.0"
dependencies = ["kin-ports", "kin-sandbox", "cap-std", "tree-sitter"]

[[package]]
name = "kin-pty"
version = "10.0.0"
dependencies = ["kin-ports", "kin-sandbox", "portable-pty"]

[[package]]
name = "kin-lsp"
version = "10.0.0"
dependencies = ["kin-ports", "kin-sandbox"]

[[package]]
name = "kin-gateway"
version = "10.0.0"
dependencies = ["kin-ports", "kin-egress"]

[[package]]
name = "kin-egress"
version = "10.0.0"
dependencies = ["kin-ports", "kin-crypto", "reqwest"]

[[package]]
name = "kin-browser"
version = "10.0.0"
dependencies = ["kin-ports", "kin-egress", "chromiumoxide"]

[[package]]
name = "kin-mcp"
version = "10.0.0"
dependencies = ["kin-ports", "kin-sandbox", "kin-egress"]

[[package]]
name = "kin-memory"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-ports", "kin-crypto", "kin-plugin-sdk", "tera", "tokio", "tokio-util"]

[[package]]
name = "kin-context"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-ports", "kin-crypto", "kin-plugin-sdk", "tera", "tokio", "tokio-util"]

[[package]]
name = "kin-tools"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-ports", "kin-crypto", "kin-plugin-sdk", "tera", "tokio", "tokio-util"]

[[package]]
name = "kin-harness"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-ports", "kin-crypto", "kin-plugin-sdk", "tera", "tokio", "tokio-util"]

[[package]]
name = "kin-orch"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-ports", "kin-crypto", "kin-plugin-sdk", "tera", "tokio", "tokio-util"]

[[package]]
name = "kin-tasks"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-ports", "kin-crypto", "kin-plugin-sdk", "tera", "tokio", "tokio-util"]

[[package]]
name = "kin-sched"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-ports", "kin-crypto", "kin-plugin-sdk", "jiff", "tera", "tokio", "tokio-util"]

[[package]]
name = "kin-engine"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-ports", "kin-crypto", "kin-plugin-sdk", "kin-store", "kin-ledger", "kin-blobs", "kin-index", "kin-vault", "kin-policy", "kin-sandbox", "kin-lanes", "kin-pty", "kin-lsp", "kin-gateway", "kin-egress", "kin-browser", "kin-mcp", "kin-memory", "kin-context", "kin-tools", "kin-harness", "kin-orch", "kin-tasks", "kin-sched", "tokio", "tokio-util"]

[[package]]
name = "kin-shell"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-engine", "tauri", "tokio"]

[[package]]
name = "kin-cli"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-engine", "clap", "tokio"]

[[package]]
name = "kin-bench"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "kin-engine", "clap", "tokio"]

[[package]]
name = "xtask"
version = "10.0.0"
dependencies = ["kin-types", "kin-proto", "kin-error", "clap", "serde", "serde_json", "specta"]
```

### 4.3 Desktop Workbench `apps/desktop/package.json`

```json
{
  "name": "@kin/desktop-workbench",
  "version": "10.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.11.0",
    "pnpm": ">=9.12.0"
  },
  "scripts": {
    "dev": "vite --port 1420 --strictPort",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "2.1.0",
    "@tanstack/react-virtual": "3.10.8",
    "@xyflow/react": "12.3.2",
    "i18next": "23.16.4",
    "monaco-editor": "0.52.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-i18next": "15.1.0",
    "zustand": "5.0.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "2.1.0",
    "@types/react": "19.0.1",
    "@types/react-dom": "19.0.1",
    "typescript": "5.6.3",
    "vite": "5.4.10",
    "vitest": "2.1.4"
  }
}
```

### 4.4 Reference `apps/desktop/pnpm-lock.yaml` (`lockfileVersion: '9.0'` with `packages` & `snapshots`)

```yaml
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:
  .:
    dependencies:
      '@tauri-apps/api':
        specifier: 2.1.0
        version: 2.1.0
      '@tanstack/react-virtual':
        specifier: 3.10.8
        version: 3.10.8(react-dom@19.0.0(react@19.0.0))(react@19.0.0)
      '@xyflow/react':
        specifier: 12.3.2
        version: 12.3.2(react-dom@19.0.0(react@19.0.0))(react@19.0.0)
      i18next:
        specifier: 23.16.4
        version: 23.16.4
      monaco-editor:
        specifier: 0.52.0
        version: 0.52.0
      react:
        specifier: 19.0.0
        version: 19.0.0
      react-dom:
        specifier: 19.0.0
        version: 19.0.0(react@19.0.0)
      react-i18next:
        specifier: 15.1.0
        version: 15.1.0(i18next@23.16.4)(react-dom@19.0.0(react@19.0.0))(react@19.0.0)
      zustand:
        specifier: 5.0.1
        version: 5.0.1(react@19.0.0)
    devDependencies:
      '@tauri-apps/cli':
        specifier: 2.1.0
        version: 2.1.0
      '@types/react':
        specifier: 19.0.1
        version: 19.0.1
      '@types/react-dom':
        specifier: 19.0.1
        version: 19.0.1(@types/react@19.0.1)
      typescript:
        specifier: 5.6.3
        version: 5.6.3
      vite:
        specifier: 5.4.10
        version: 5.4.10
      vitest:
        specifier: 2.1.4
        version: 2.1.4(vite@5.4.10)

packages:
  '@tauri-apps/api@2.1.0':
    resolution: {integrity: sha512-7bR8x9cK1vL2mN3pQ4rS5tU6vW7xY8zA9bC0dE1fG2hI3jK4lM5nO6pQ7rS8tU9vW0xY1zA2bC3dE4fG5hI6jA==}

  '@tauri-apps/cli@2.1.0':
    resolution: {integrity: sha512-8cR9y0dL2wM3nO4qR5sT6uV7wX8yZ9aB0cD1eF2gH3iJ4kL5mN6oP7qR8sT9uV0wX1yZ2aB3cD4eF5gH6iJ7kB==}
    hasBin: true

  '@tanstack/react-virtual@3.10.8':
    resolution: {integrity: sha512-9dS0z1eM3xN4oP5rS6tU7vW8xY9zA0bC1dE2fG3hI4jK5lM6nO7pQ8rS9tU0vW1xY2zA3bC4dE5fG6hI7jK8lC==}
    peerDependencies:
      react: ^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0
      react-dom: ^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0

  '@types/react@19.0.1':
    resolution: {integrity: sha512-1eT1a2fN4yO5pQ6sT7uV8wX9yZ0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mD==}

  '@types/react-dom@19.0.1':
    resolution: {integrity: sha512-2fU2b3gO5zP6qR7tU8vW9xY0zA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1vW2xY3zA4bC5dE6fG7hI8jK9lM0nE==}
    peerDependencies:
      '@types/react': ^19.0.0

  '@xyflow/react@12.3.2':
    resolution: {integrity: sha512-3gV3c4hP6aQ7rS8uV9wX0yZ1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4aB5cD6eF7gH8iJ9kL0mN1oF==}
    peerDependencies:
      react: '>=17'
      react-dom: '>=17'

  i18next@23.16.4:
    resolution: {integrity: sha512-4hW4d5iQ7bR8sT9vW0xY1zA2bC3dE4fG5hI6jK7lM8nO9pQ0rS1tU2vW3xY4zA5bC6dE7fG8hI9jK0lM1nO2pG==}

  monaco-editor@0.52.0:
    resolution: {integrity: sha512-5iX5e6jR8cS9tU0wX1yZ2aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD7eF8gH9iJ0kL1mN2oP3qH==}

  react@19.0.0:
    resolution: {integrity: sha512-6jY6f7kS9dT0uV1xY2zA3bC4dE5fG6hI7jK8lM9nO0pQ1rS2tU3vW4xY5zA6bC7dE8fG9hI0jK1lM2nO3pQ4rI==}
    engines: {node: '>=0.10.0'}

  react-dom@19.0.0:
    resolution: {integrity: sha512-7kZ7g8lT0eU1vW2yZ3aB4cD5eF6gH7iJ8kL9mN0oP1qR2sT3uV4wX5yZ6aB7cD8eF9gH0iJ1kL2mN3oP4qR5sJ==}
    peerDependencies:
      react: 19.0.0

  react-i18next@15.1.0:
    resolution: {integrity: sha512-8lA8h9mU1fV2wX3zA4bC5dE6fG7hI8jK9lM0nO1pQ2rS3tU4vW5xY6zA7bC8dE9fG0hI1jK2lM3nO4pQ5rS6tK==}
    peerDependencies:
      i18next: '>= 23.2.3'
      react: '>= 16.8.0'
      react-dom: '>= 16.8.0'

  typescript@5.6.3:
    resolution: {integrity: sha512-hjcS1m2nV3gW4xY5aB6cD7eF8gH9iJ0kL1mN2oP3qR4sT5uV6wX7yZ8aB9cD0eF1gH2iJ3kL4mN5oP6qR7sT8uL==}
    engines: {node: '>=14.17'}
    hasBin: true

  vite@5.4.10:
    resolution: {integrity: sha512-9mB9i0nV2gW3xY4aB5cD6eF7gH8iJ9kL0mN1oP2qR3sT4uV5wX6yZ7aB8cD9eF0gH1iJ2kL3mN4oP5qR6sT7uM==}
    engines: {node: ^18.0.0 || >=20.0.0}
    hasBin: true

  vitest@2.1.4:
    resolution: {integrity: sha512-0nC0j1oW3hX4yZ5bC6dE7fG8hI9jK0lM1nO2pQ3rS4tU5vW6xY7zA8bC9dE0fG1hI2jK3lM4nO5pQ6rS7tU8vN==}
    engines: {node: ^18.0.0 || >=20.0.0}
    hasBin: true
    peerDependencies:
      vite: ^5.0.0

  zustand@5.0.1:
    resolution: {integrity: sha512-1oD1k2pX4iY5zA6cD7eF8gH9iJ0kL1mN2oP3qR4sT5uV6wX7yZ8aB9cD0eF1gH2iJ3kL4mN5oP6qR7sT8uV9wO==}
    peerDependencies:
      react: '>=18.0.0'

snapshots:
  '@tauri-apps/api@2.1.0': {}

  '@tauri-apps/cli@2.1.0': {}

  '@tanstack/react-virtual@3.10.8(react-dom@19.0.0(react@19.0.0))(react@19.0.0)':
    dependencies:
      react: 19.0.0
      react-dom: 19.0.0(react@19.0.0)

  '@types/react@19.0.1': {}

  '@types/react-dom@19.0.1(@types/react@19.0.1)':
    dependencies:
      '@types/react': 19.0.1

  '@xyflow/react@12.3.2(react-dom@19.0.0(react@19.0.0))(react@19.0.0)':
    dependencies:
      react: 19.0.0
      react-dom: 19.0.0(react@19.0.0)
      zustand: 5.0.1(react@19.0.0)

  i18next@23.16.4: {}

  monaco-editor@0.52.0: {}

  react@19.0.0: {}

  react-dom@19.0.0(react@19.0.0):
    dependencies:
      react: 19.0.0

  react-i18next@15.1.0(i18next@23.16.4)(react-dom@19.0.0(react@19.0.0))(react@19.0.0):
    dependencies:
      i18next: 23.16.4
      react: 19.0.0
      react-dom: 19.0.0(react@19.0.0)

  typescript@5.6.3: {}

  vite@5.4.10: {}

  vitest@2.1.4(vite@5.4.10):
    dependencies:
      vite: 5.4.10

  zustand@5.0.1(react@19.0.0):
    dependencies:
      react: 19.0.0
```

## 5. Reproducible Build, Release & Operational Troubleshooting Runbook (`RUN-*`, Fixing `RT13-17` & Audit Findings 12, 14, 15, 16, 20)

### 5.1 Reproducible Specification Verification & Implementation Repository Build Runbook (`RUN-BLD-001..005`)

1. **`RUN-BLD-001` — Standalone Specification & Contract Verification Gate (`< 60s`, runs directly on this Specification Bundle)**:
   ```bash
   python3 verify_kin_v10_0_suite.py
   ```
   *Pass criteria*: `Ran 200 tests ... OK` (executes the standalone specification and contract verifier across all SQLite `STRICT` schemas, triggers, FTS5, foreign keys, `S0` secret stripping simulations, SSRF IPv4/IPv6 + DNS-pinned redirect logic, completion gate state-machine simulation, sandbox `seccompiler 0.4` + `// SAFETY:` comments, 54-code error registry, C4 diagrams, ADRs, compatibility matrix, reference manifests/lockfiles, and runbook playbooks).
2. **`RUN-BLD-002` — Hexagonal Layer & TypeScript/JSON Schema Codegen Check (`< 15s`, Implementation Repo CI)**:
   ```bash
   cargo run --package xtask --locked -- check-deps
   cargo run --package xtask --locked -- codegen --check
   # Equivalent via shipped .cargo/config.toml alias:
   cargo xtask check-deps
   cargo xtask codegen --check
   ```
   *Pass criteria*: Verifies `L4` crates depend only on `L0 + L1 + jiff (in kin-sched) + tera + tokio(sync) + tokio-util(sync,rt)` (rejecting any non-`sync` Tokio feature in `L4`) and verifies `crates/kin-tools/schemas/builtin_tools.json` and TypeScript `specta` bindings match Rust source definitions byte-for-byte.
3. **`RUN-BLD-003` — Workspace Rust Compile & Clippy Safety Gate (Implementation Repo CI)**:
   ```bash
   cargo clippy --workspace --all-targets --locked -- -D warnings
   cargo test --workspace --locked
   ```
   *Pass criteria*: Zero compiler warnings; zero unapproved `unsafe_code` violations (`#![forbid(unsafe_code)]` on all 29 pure-safe crates); zero `unwrap_used`, `expect_used`, `panic`, `todo`, or `unimplemented` violations.
4. **`RUN-BLD-004` — Desktop UI Typecheck & Tauri v2 Bundle Build (Implementation Repo CI)**:
   ```bash
   pnpm --dir apps/desktop install --frozen-lockfile
   pnpm --dir apps/desktop run typecheck
   pnpm --dir apps/desktop run build
   pnpm --dir apps/desktop exec tauri build -- --locked
   ```
5. **`RUN-BLD-005` — Linux AppArmor Profile Installation (Ubuntu 24.04+ Host Setup)**:
   ```bash
   sudo cp crates/kin-sandbox/profiles/dev.kin.sandbox.apparmor /etc/apparmor.d/dev.kin.sandbox
   sudo apparmor_parser -r /etc/apparmor.d/dev.kin.sandbox
   ```

### 5.2 CLI-to-Engine API Ownership, Authorization, Audit & Error Mapping (`RUN-CLI-001`, Fixing Audit Findings 14 & 16)

Because `kin-store` inside `kin-engine` is the sole database writer (`Build Rule 6`, `INV-004`), `kin-cli` never opens `project.db` or `index.db` directly for writes. Every operator CLI command authenticates over `$KIN_RUN_DIR/e.sock` via `ClientEnvelope::Authenticate` (`ClientKind::HeadlessCli`, `DOC-02 §1.2`) and dispatches a strongly typed `EngineCommand` (`DOC-06 §1.1`):

| Operator CLI Command | Dispatched `EngineCommand` Variant (`DOC-06 §1.1`) | Owning Engine Subsystem & Pre-Condition Checks | Ledger Audit Event (`ledger_events.event_kind`) | `CommandAck` Variant & Error Semantics |
| :--- | :--- | :--- | :--- | :--- |
| `kin project gc --prune-worktrees` | `EngineCommand::ProjectGarbageCollect { prune_worktrees: true }` | `kin-lanes` + `kin-blobs` + `kin-store`: acquires lane manager lock, runs `git worktree prune --expire=now` on inactive worktrees, unlinks `blobs/*.zst.enc` with `ref_count == 0` (`trg_blobs_no_delete_while_referenced`), and executes `PRAGMA wal_checkpoint(TRUNCATE);`. | `project.gc.executed` | `CommandAck::GarbageCollected { pruned_worktrees, unlinked_blobs, wal_truncated_bytes }` (`KIN-BLB-0001` if blob is still referenced) |
| `kin lane unfreeze <wkt_id> --expected-epoch <n> --reason "<text>"` | `EngineCommand::LaneUnfreeze { lane_id, expected_mutation_epoch, reason }` | `kin-harness` + `kin-lanes` + `kin-store`: verifies lane status is not `'merged'`/`'discarded'`, verifies no active run or completion-gate `tokio::sync::RwLock` write permit is held on `<wkt_id>`, verifies `mutation_epoch == expected_mutation_epoch`, and clears `write_frozen = 0` via `kin-store`. | `lane.unfreeze.manual` (logged *before* state update per `INV-004`) | `CommandAck::Accepted { entity_id, seq }` (`KIN-WKT-0001` if terminal or gate active; `KIN-WKT-0001` on epoch mismatch) |
| `kin mcp inspect-schema <slug>` | `EngineCommand::McpInspectSchema { slug }` | `kin-mcp` + `kin-store`: queries `mcp_integrations` for `pinned_schema_sha256`, fetches live `tools/list` inside `S2`/`kin-egress`, canonicalizes via RFC 8785 JCS, and computes structural JSON diff without enabling the server. | `mcp.schema.inspected` | `CommandAck::McpSchemaInspection { slug, pinned_schema_sha256, live_schema_sha256, schema_diff_json }` (`KIN-EXT-0004` if revoked) |
| `kin ledger verify [--from <seq>] [--to <seq>]` | `EngineCommand::LedgerVerifyChain { from_seq, to_seq }` | `kin-ledger`: walks `ledger_events` from `seq = 0`, recomputes `EnvelopeMeta12` BLAKE3 chain and Ed25519 checkpoint/purge signatures against `registry.db::projects.ledger_pubkey_hex`. | `ledger.chain.verified` | `CommandAck::LedgerVerified { verified_events, head_blake3 }` (`KIN-LDG-0006` on chain break) |

### 5.3 Twelve Deterministic Operational Troubleshooting Playbooks (`RUN-TRB-001..012`)

Every operational failure mode and critical `KIN-*` error code maps to a deterministic diagnostic and recovery procedure below:

| Playbook ID | Symptom / Error Code | Root Cause | Deterministic Diagnostic & Recovery Procedure |
| :--- | :--- | :--- | :--- |
| **RUN-TRB-001** | Ubuntu 24.04+ banner: `UserNsEpermFallbackToS1` (all `shell_exec`/`pty_open` prompt `ASK_HUMAN`) | `kernel.apparmor_restrict_unprivileged_userns = 1` blocks unprivileged `unshare(CLONE_NEWUSER)` when AppArmor profile is not loaded (`RT4-05`). | Run `sudo apparmor_parser -r /etc/apparmor.d/dev.kin.sandbox` and restart `kin-engine`; verify Top HUD badge changes from `Sandbox:S1` to `Sandbox:S2`. |
| **RUN-TRB-002** | `KIN-STR-0008` (`DiskSpaceLow`) before `S0` snapshot, blob spill, or root apply | Free disk space on `$KIN_HOME` or `<root_path>` dropped below the `256 MiB` pre-flight safety floor (`DB-STR-002`, `RT7-08`). | Run `kin project gc --prune-worktrees` (dispatches `EngineCommand::ProjectGarbageCollect { prune_worktrees: true }`, which runs `git worktree prune --expire=now`, unlinks unreferenced `blobs/*.zst.enc` with `ref_count = 0`, and executes `PRAGMA wal_checkpoint(TRUNCATE);`). |
| **RUN-TRB-003** | `KIN-POL-0009` (`LiteralVaultSecretInToolArgs`) hard stop during `fs_write`, `fs_patch`, or `shell_exec` | Agent attempted to pass a raw credential string that matched a secret registered in OS Keychain / `SecretRedactor` (`RT4-18`). | Never put literal secrets in files or commands. Store the secret in OS Keychain via Settings -> Secrets, map it in `.kin/kin.toml` under `[secrets].allowed_env_injections`, and reference `KIN_SECRET_<NAME>` in `secret_env_handles`. |
| **RUN-TRB-004** | `KIN-WKT-0001` (`WorktreeLaneFrozenOrTerminal`) rejecting file writes in a worktree lane | Lane was left with `write_frozen = 1` after an interrupted `verifying_completion` gate, or the lane is already `merged`/`discarded` (`RT6-03`, Audit Finding 8 & 14). | On daemon boot, `HRN-REC-001` automatically resets `write_frozen = 0` for non-terminal runs after releasing stale locks. To unfreeze manually without bypassing `kin-store`: run `kin lane unfreeze <wkt_id> --expected-epoch <n> --reason "operator recovery"` (`EngineCommand::LaneUnfreeze`), which verifies no run/gate is active, checks `mutation_epoch`, logs `lane.unfreeze.manual` in `ledger_events`, and sets `write_frozen = 0`. |
| **RUN-TRB-005** | `KIN-WKT-0003` (`ApplyJournalInvalidTransition`) or `apply_journals.state = 'failed_needs_revert'` | OS file lock or crash interrupted Phase 3 (`committing`) of a root apply (`DOC-04 §3`, `ST-41`, `RT4-09`). | In Zone 4 -> Diff & Merge Queue, click **Revert Last Apply** (or send `EngineCommand::LaneRevertApply { apply_journal_id }`), which restores pre-apply bytes/modes from `pre_backup_blob_hash`, prunes `created_dirs`, and transitions `apply_journals.state -> 'rolled_back'`. |
| **RUN-TRB-006** | `KIN-EXT-0004` (`McpIntegrationQuarantinedOrRevoked`) when enabling an MCP server | Remote/local MCP server `tools/list` JCS SHA-256 digest diverged from `mcp_integrations.pinned_schema_sha256` (`EXT-MCP-004`, rug-pull protection). | Inspect the diff in Zone 4 -> Security & MCP Integrations (`kin mcp inspect-schema <slug>` -> `EngineCommand::McpInspectSchema`). If legitimate, approve the new digest (`EngineCommand::McpIntegrationMutate { op: McpMutateOp::ApproveSchema, pinned_schema_sha256, .. }`), updating `trust_status = 'verified_schema'`. |
| **RUN-TRB-007** | `KIN-EXT-0001` (`IntegrationWriteBlockedInReadOnlyMode`) on GitHub / Sheets MCP tool call | Agent invoked a mutating MCP tool while `mcp_integrations.access_mode == 'read_only'` (`RT10-06`). | Toggle the integration from `read_only` to `write_enabled` via `/mcp` or Zone 4 (`EngineCommand::McpIntegrationMutate { op: McpMutateOp::Update, access_mode: Some(McpAccessMode::WriteEnabled), .. }`). |
| **RUN-TRB-008** | `KIN-EGR-0004` (`SsrfBlockedIpRange`) or `KIN-EGR-0005` (`RedirectTargetForbidden`) on `web_fetch` / `browser_act` | Target hostname resolved to a non-global/private/NAT64/6to4/loopback IP (`is_ssrf_forbidden_ip`, `RT9-09`) or 3xx redirected to a disallowed scheme, host outside `EffectiveAllowedHosts`, or DNS-rebinding IP (`KinDnsResolver`, Audit Finding 5). | If the redirect domain is a legitimate public CDN/API over `https`, either approve the `R3 ASK_HUMAN` prompt (which grants `SEC-EGR-003` dynamic host access for the run/session) or add the host to `.kin/kin.toml` `[egress].allowed_hosts`. Private/non-global IPs (`KIN-EGR-0004`) are constitutional hard blocks when `block_private_cidrs = true`. |
| **RUN-TRB-009** | `KIN-HRN-0008` / `KIN-HRN-0009` (`LoopCircuitBreakerTripped`) halting a specialist run | Agent proposed the identical `(tool_name, args_blake3)` 3 times on the same `current_tree_sha` or oscillated tree SHAs `A -> B -> A -> B` (`HRN-LOOP-001`, `RT6-09`). | Inspect the automatic blocker summary posted to `@boss` in the channel thread; provide a human steer directive or reassign the task via `/task`. |
| **RUN-TRB-010** | `KIN-HRN-0011` (`BudgetExceeded`) or `KIN-HRN-0012` (`MaxStepsReached`) | Run hit 100% of `run_budget_micro_usd` / `daily_budget_micro_usd` (`HRN-BDG-001`) or reached `step_count == max_steps` (`HRN-STP-001`, `RT9-15`). | Raise the project/run budget via `/budget` (`EngineCommand::ProjectUpdateSettings`) or resume work in a new run from the latest committed worktree lane state. |
| **RUN-TRB-011** | `KIN-TSK-0004` (`TaskLeaseEpochMonotonic`) or `KIN-TSK-0006` (`TaskUnfinishedDependency`) | Stale worker attempted to mutate a task with an outdated `expected_epoch`, or tried to start/complete a task whose `task_dependencies` are not yet `'done'` (`RT9-07c`). | Re-read the latest `tasks.lease_epoch` via `task_mutate(op = "list")` and complete upstream dependency tasks in topological order first. |
| **RUN-TRB-012** | `KIN-LDG-0006` (`LedgerChainDiscontinuity`) or `KIN-LDG-0007` (`LedgerPurgeReceiptMissing`) | Direct out-of-band SQLite edit attempted to insert a non-contiguous `ledger_events.seq` or delete from `ledger_payloads` without a signed `privacy.purge.receipt` (`RT9-14`, `RT12-09`). | Run `kin ledger verify` (`EngineCommand::LedgerVerifyChain`). Always use `/forget` (`EngineCommand::PrivacyPurgeEntity`) so `kin-ledger` appends the Ed25519-signed `privacy.purge.receipt` before deleting `ledger_payloads`. |
