# KIN Canonical Glossary & Architecture Decision Records (ADRs)

**Document ID:** `KIN-GLO-10.0-PROD`  
**System Name:** KIN — Sovereign Local-First Autonomous Multi-Agent AI Workforce & Harness  
**Version:** `10.0.0-PRODUCTION`  
**Status:** Canonical Vocabulary Baseline, Rename Mapping & Architecture Decision Records  

---

## 1. Canonical Vocabulary & Core Definitions

To ensure complete ambiguity-free alignment across engineers, agents, documentation, and user interfaces, the following definitions serve as the authoritative standard in KIN:

### 1.1 Organizational & Workspace Topology
- **Workspace / Root Path (`<root_path>`):** The physical directory on the user’s host computer where source code resides. In KIN, this path is strictly read-only to agents during active runs.
- **Project (`prj_<id>`):** A sovereign, isolated administrative domain within KIN encompassing an associated root path, dedicated encrypted SQLite databases (`project.db`, `index.db`), isolated Git worktrees, channels, and workforce assignments.
- **Channel (`chn_<id>`):** A persistent, topic-specific public collaboration space within a project (e.g., `#general`, `#backend`, `#frontend`) where the human operator and multiple assigned agents converse, coordinate, and review code.
- **Direct Message (`dms_<id>`):** A private 1-on-1 communication channel established either between the human operator and an agent, or between two agents. Isolated from third-party agents.
- **Meeting (`mtg_<id>`):** A structured, multi-round autonomous conference convened among 2 to 6 agents to debate an architectural or implementation problem, concluding with a binding Decision Record.

### 1.2 Workforce & Agent Hierarchy
- **Lead Orchestrator (`@boss`):** The non-deletable project director seeded in `#general`. Manages high-level goal decomposition, Task DAG assignment, specialist recruitment, and blocker escalation.
- **Specialist Coworker:** A persistent, domain-expert agent (e.g., `@backend`, `@frontend`, `@qa`, `@security`) with an explicit charter, allowed tool capabilities, owned file patterns, and assigned AI model.
- **Subagent:** An ephemeral, task-scoped worker spawned by a specialist (via `agent_delegate` or `agent_map_reduce`) to execute subtasks with strictly attenuated permissions (maximum spawn depth: 2).
- **Charter:** The foundational Markdown system prompt defining an agent's domain authority, responsibilities, tone, and operational invariants.
- **Owned Globs:** An array of file path patterns (e.g., `["src/api/**", "migrations/**"]`) designating the code areas where an agent holds primary authoring authority.

### 1.3 Execution, Lifecycle & Sandboxing
- **Turn:** A single conversational exchange or event dispatch within a channel or DM.
- **Wake:** An event indicating that an agent needs to process incoming messages or task changes.
- **Run (`run_<id>`):** An end-to-end autonomous execution session launched by an agent to fulfill a task or respond to a prompt inside an isolated worktree lane.
- **Step (`stp_<id>`):** A single reasoning cycle within a run, consisting of context compilation, model inference, optional thinking tokens, and tool calls.
- **Lane / Worktree (`wkt_<id>`):** An isolated Git worktree or shadow directory where an agent executes tools and modifies files without impacting other agents or the user's live workspace.
- **Autonomy Ceiling:** The project-level security boundary (`SAFE`, `AUTO`, `FULL_ACCESS`) that determines which tool operations execute automatically and which require explicit human approval.
- **Sandbox Level:** The OS-level isolation enforcement (`S0` Unconfined, `S1` Basic, `S2` Strict OS Sandbox, `S3` Air-Gapped) applied to tool subprocesses.

### 1.4 Cognitive Memory & Context Engineering
- **Cognitive Memory:** The structured, persistent knowledge repository partitioned across 4 visibility tiers:
  - *Tier 1 (Project):* Shared across all agents in the project.
  - *Tier 2 (Channel):* Visible only to agents enrolled in that specific channel.
  - *Tier 3 (Private):* Visible exclusively to the authoring agent.
  - *Tier 4 (Direct Message):* Visible exclusively to the two participants of that DM.
- **Cognitive Banks:** The 4 semantic knowledge categories: `World` (facts), `Experience` (outcomes), `Opinion` (tradeoffs), and `Procedure` (recipes).
- **Context Compaction:** The automated summarization of older conversational turns into structured state checkpoints when approaching context window limits.
- **Output Spilling:** The automated offloading of massive command or file search outputs to encrypted disk blobs, providing the agent with a concise preview and a deterministic BLAKE3 hash reference.

### 1.5 Security, Governance & Verification
- **Taint:** A security state flag applied to any run, message, or task that has ingested unverified external content (web pages, third-party MCP output). Taint propagates monotonically to all downstream actions.
- **Memory Quarantine:** A security holding state for memory claims generated by tainted runs. Quarantined memories are hidden from prompt compilation until approved by the operator.
- **Audit Ledger:** An append-only, tamper-evident sequence of operational events chained with BLAKE3 hashes and cryptographically signed with Ed25519 checkpoint signatures.
- **Project Master Key (`PMK_prj`):** A 256-bit CSPRNG key stored exclusively in the OS Keychain, used to derive database and blob encryption keys.
- **Cryptographic Shredding:** The irreversible destruction of `PMK_prj` from the OS Keychain, permanently rendering all encrypted project databases and blobs mathematically unrecoverable.

---

## 2. Legacy Rename & Deprecation Mapping

To maintain strict backward compatibility while migrating older prototype codebases to the production specification, the following mapping defines canonical replacements:

| Legacy Prototype Term | Canonical Production Term | Reason for Deprecation |
| :--- | :--- | :--- |
| `master_agent` | `@boss` (`RoleKind::Boss`) | Aligns with human engineering office organizational hierarchy. |
| `assistant` / `bot` | `specialist` / `coworker` | Emphasizes professional peer coworker relationship and domain ownership. |
| `chat_room` | `channel` (`chn_<id>`) | Standardizes on modern team communication terminology. |
| `flat_memory` | `cognitive_memory` (4-Tier) | Eliminates context leaks and enforces strict multi-department privacy. |
| `raw_git_commit` | `worktree_lane` + `apply_journal` | Prevents race conditions and guarantees zero-write root safety. |
| `direct_patch` | `fs_patch` (4-Tier Cascading) | Replaces brittle exact-match edits with multi-tier fuzzy and AST matching. |
| `global_api_keys` | `keychain_secret_handles` | Prevents plaintext API keys from being leaked in LLM prompts or logs. |
| `unbounded_subagent` | `agent_delegate` (Max Depth 2) | Prevents infinite agent recursion, fork bombs, and runaway API spend. |

---

## 3. Authoritative Architecture Decision Records (ADRs)

### ADR-001: Local-First Desktop Shell (Tauri v2 + Rust Core + React 19)
- **Status:** Approved & Canonical
- **Context:** KIN requires sovereign local-first privacy, sub-second native performance, low memory footprint, and access to OS-level sandboxing primitives, paired with a modern reactive desktop UI.
- **Decision:** Build KIN as a decoupled multi-process desktop app: a lightweight Tauri v2 webview presentation layer running React 19, communicating over authenticated local domain sockets/pipes with an independent native Rust core engine (`kin-engine`).
- **Consequences:** Eliminates cloud data exfiltration, guarantees offline operational capability, and maintains engine stability independent of UI reloads.

### ADR-002: Four-Database Segregated Storage Topology
- **Status:** Approved & Canonical
- **Context:** Storing all application state, code intelligence, vector embeddings, and large file blobs in a single SQLite database leads to lock contention, bloats backups, and complicates cryptographic shredding.
- **Decision:** Segregate persistence into four discrete stores: `registry.db` (global projects index), `project.db` (operational state, SQLCipher encrypted), `index.db` (AST chunks and `sqlite-vec` vector tables, SQLCipher encrypted), and `blobs/` (Zstandard compressed, XChaCha20-Poly1305 encrypted large payloads).
- **Consequences:** Maximizes concurrent read/write throughput, allows independent vector indexing, and enables instant cryptographic shredding by unlinking per-project keys.

### ADR-003: Mutual 3-Step HMAC-SHA256 Handshake over Short Socket Paths
- **Status:** Approved & Canonical
- **Context:** Standard Unix domain socket paths in user directories frequently exceed the 104-byte POSIX limit. Unauthenticated sockets allow rogue local processes to hijack engine control.
- **Decision:** Bind sockets strictly inside `/tmp/kin-<uid>/e.sock` (`<= 44B`) on Unix and Named Pipes on Windows. Mandate a mutual 3-step challenge-response handshake (`KIN8`) where both client and server prove possession of the filesystem-secured `engine.token` via HMAC-SHA256.
- **Consequences:** Guarantees universal OS socket compatibility and eliminates unauthorized local inter-process attacks.

### ADR-004: True Zero-Write Root Path via Self-Contained `$KIN_HOME/.../repo.git`
- **Status:** Approved & Canonical
- **Context:** Single-agent assistants modify code directly in the user's working directory, causing merge conflicts, altering file mtimes, and leaving uncommitted dirty states.
- **Decision:** When a project is opened, KIN fetches repository objects into a self-contained bare mirror at `$KIN_HOME/projects/<id>/repo.git`. Agents execute tools strictly within isolated Git worktrees. Modifications are brought back to the user's workspace only via validated 3-way merge apply journals.
- **Consequences:** Zero bytes are written to `<root_path>` during runs. The developer's live environment is completely protected from corruption or unverified changes.

### ADR-005: 3-Stage Deterministic Turn Arbiter (DTA) Turn Routing
- **Status:** Approved & Canonical
- **Context:** In multi-agent group channels, invoking an LLM to decide which agent should respond to each message introduces high latency (1-3 seconds) and wastes significant API budget.
- **Decision:** Implement the 3-Stage DTA: Stage 0 Regex Ack Pre-Gate (0 tokens, <1ms), Stage 1 Explicit Mention Router (<2ms), Stage 2 Quantized Local ONNX Embedding Matcher (<15ms), and Stage 3 `@boss` Fallback.
- **Consequences:** Resolves turn routing for >= 95% of messages in under 15ms at zero token cost.

### ADR-006: Four-Tier Cognitive Memory Scoping with Bi-Temporal Graphs
- **Status:** Approved & Canonical
- **Context:** Flat memory files (like `CLAUDE.md`) lack visibility boundaries, causing private agent notes or channel-specific details to leak across the entire project.
- **Decision:** Enforce four strict memory tiers (Project, Channel, Private, DM) with bi-temporal validity (`valid_from_us`, `valid_to_us`) and cognitive banks (`World`, `Experience`, `Opinion`, `Procedure`).
- **Consequences:** Guarantees confidential communications remain strictly private while enabling seamless sharing of verified project-wide architecture facts.

### ADR-007: Four-Tier Cascading Fuzzy & AST-Anchored Patch Engine
- **Status:** Approved & Canonical
- **Context:** Exact string-replacement editing tools fail frequently when language models generate code with minor whitespace, indentation, or newline discrepancies.
- **Decision:** Implement a 4-tier fallback patch algorithm: Tier 1 Exact Match, Tier 2 Whitespace-Normalized, Tier 3 Indentation-Agnostic, and Tier 4 Tree-sitter AST-Anchored Node Replacement.
- **Consequences:** Achieves >99.8% patch application reliability without requiring full file overwrites.

### ADR-008: Immutable BLAKE3 Append-Only Ledger with Ed25519 Signatures
- **Status:** Approved & Canonical
- **Context:** Regulated enterprise environments require tamper-evident proof of all AI actions, tool calls, and human approvals.
- **Decision:** Record all operational transitions in `ledger_events`, chained with BLAKE3 hashes and protected by SQLite immutability triggers. Generate Ed25519 digital signatures every 1,000 events using the Keychain-held signing key `LSK_prj`.
- **Consequences:** Provides forensic auditability that mathematically detects any retroactive tampering or deletion of event records.

### ADR-009: Model Context Protocol (MCP 2026-07-28) First-Class Integration
- **Status:** Approved & Canonical
- **Context:** Maintaining custom bespoke connectors for hundreds of third-party tools creates an unsustainable maintenance burden.
- **Decision:** Standardize all external integrations around the open Model Context Protocol (MCP). Support both Stdio and Streamable HTTP transports with schema pinning, read-only modes, and untrusted output tagging.
- **Consequences:** Enables instant access to the global MCP ecosystem while enforcing strict security boundaries.

### ADR-010: Zero-Capture Human Browser Takeover Flow
- **Status:** Approved & Canonical
- **Context:** Headless browser agents break when encountering CAPTCHAs, bot protection, or multi-factor authentication.
- **Decision:** When authentication challenges are detected, the agent suspends execution and displays an interactive Takeover Banner in Zone 4. The human completes the challenge in the live webview and hands control back to the agent with authenticated cookies intact.
- **Consequences:** Eliminates the #1 cause of browser agent failures without compromising user passwords or session security.

### ADR-011: Prefix-Stable 9-Layer Context Compiler with Run-Static Bounds
- **Status:** Approved & Canonical
- **Context:** Frequent changes in prompt prefixes invalidate provider KV-caches, resulting in high latency and increased API spend.
- **Decision:** Structure agent prompts into 9 distinct layers where Layers 1 through 4 (invariants, persona, tools, project topology) are strictly byte-identical across all turns.
- **Consequences:** Achieves measured >= 85% cache hit rates on modern providers, cutting inference costs by up to 80% and drastically reducing time-to-first-token.

### ADR-012: Cryptographic Shredding via Keychain-Held PMK CSPRNG Deletion
- **Status:** Approved & Canonical
- **Context:** Deleting local files on modern flash SSDs often leaves orphaned data blocks that can be recovered using specialized forensic software.
- **Decision:** Encrypt all project databases and blobs under keys derived from an independent 256-bit CSPRNG master key (`PMK_prj`) held strictly in the OS Keychain. On project deletion, wipe `PMK_prj` from the Keychain.
- **Consequences:** Without `PMK_prj`, all remaining flash memory blocks on disk become mathematically indecipherable ($2^{256}$ brute-force resistance), providing instant, guaranteed cryptographic shredding.
