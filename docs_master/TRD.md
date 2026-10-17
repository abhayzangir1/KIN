# KIN Technical Requirements Document (TRD)

**Document ID:** `KIN-TRD-10.0-PROD`  
**System Name:** KIN — Sovereign Local-First Autonomous Multi-Agent AI Workforce & Harness  
**Version:** `10.0.0-PRODUCTION`  
**Status:** Canonical System Architecture & Engineering Blueprint  

---

## 1. System Architecture & High-Level Design

### 1.1 Architectural Pattern: Sovereign Hybrid Desktop
KIN employs a decoupled, multi-process desktop architecture combining the memory safety, concurrency, and OS-level sandboxing of **Rust** with the rich ergonomic presentation of **React 19** and **Tauri v2**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER (UI)                            │
│  React 19 • Tailwind CSS • Zustand • @tanstack/react-virtual • xyflow       │
│  Tauri v2 Desktop Webview (Wry/Blink) or Headless Browser Client            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                        Mutual 3-Step Authenticated IPC
                        16-Byte KIN8 Binary Framing Header
                  Unix Domain Socket (e.sock) / Win32 Named Pipe
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    KIN NATIVE CORE ENGINE (Rust Daemon)                      │
│                                                                             │
│  ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────┐  │
│  │ L4: Domain & Harness  │ │ L3: Adapters & Gates  │ │ L2: Storage/Index │  │
│  │ • 15-State Runner     │ │ • Dual-AST Policy     │ │ • SQLCipher WAL   │  │
│  │ • 3-Stage DTA Router  │ │ • S2 OS Sandboxes     │ │ • sqlite-vec      │  │
│  │ • Task DAG Engine     │ │ • Lane Git Worktrees  │ │ • BLAKE3 Ledger   │  │
│  │ • 4-Tier Memory Mux   │ │ • Portable PTY & CDP  │ │ • Zstd Enc Blobs  │  │
│  └───────────────────────┘ └───────────────────────┘ └───────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ L1/L0: Hexagonal Ports, Crypto Primitives, Microsecond Clock & Proto  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       ▼                               ▼                               ▼
┌──────────────┐              ┌─────────────────┐             ┌─────────────────┐
│ Local Ollama │              │ Local Disk FS   │             │ Cloud LLM APIs  │
│ / Local vLLM │              │ & Git Worktrees │             │ (Egress Filter) │
└──────────────┘              └─────────────────┘             └─────────────────┘
```

### 1.2 Core Design Principles
1. **Zero-Trust Local Execution:** No untrusted process or external input (from web searches, MCP servers, or project files) is executed with host-level privileges. Execution occurs within layered OS sandboxes (Landlock/Seccomp on Linux, Seatbelt on macOS, Windows Job Objects/Restricted Tokens).
2. **Deterministic Turn Routing:** In multi-agent channels, the cost of invoking a heavy LLM to decide "who speaks next" is eliminated. The 3-Stage Deterministic Turn Arbiter (DTA) resolves turn assignments deterministically in under 15ms without token consumption for >95% of interactions.
3. **Immutability & Forensic Auditability:** Critical operational logs, message histories, tool calls, and state transitions are stored in append-only SQLite tables protected by database triggers and cryptographically sealed with BLAKE3 and Ed25519 digital signatures.
4. **Resilient Crash Recovery:** In the event of an abrupt process crash, power loss, or `SIGKILL`, the single-writer SQLite WAL with `synchronous=FULL` guarantees zero database corruption. An explicit crash recovery reconciler inspects interrupted tool calls on boot and allows safe resumption.

---

## 2. Process Model, Lifecycle & Inter-Process Communication (IPC)

### 2.1 Canonical Directory Layout & Short Socket Paths (`TRD-PRC-001`)
Unix Domain Socket paths (`sockaddr_un.sun_path`) are hard-limited by POSIX kernels to **104 bytes on macOS/BSD** and **108 bytes on Linux**. Placing socket files inside default user application directories (such as `~/Library/Application Support/...`) frequently exceeds this limit on systems with long usernames or nested directories.

KIN strictly partitions persistent state from ephemeral runtime sockets:

| Operating System | Persistent Storage (`KIN_HOME`, `0700`) | Ephemeral Runtime Dir (`KIN_RUN_DIR`, `0700`) | IPC Socket / Pipe Endpoint |
| :--- | :--- | :--- | :--- |
| **macOS** | `~/Library/Application Support/dev.kin.app` | `/tmp/kin-<uid>` (verified `st_uid == geteuid()`) | `/tmp/kin-<uid>/e.sock` (`<= 44B`) |
| **Linux** | `$XDG_DATA_HOME/kin` (`~/.local/share/kin`) | `$XDG_RUNTIME_DIR/kin` (fallback `/tmp/kin-<uid>`) | `$KIN_RUN_DIR/e.sock` (`<= 44B`) |
| **Windows** | `%LOCALAPPDATA%\KIN` | Local Named Pipe Namespace | `\\.\pipe\kin-engine-<UserSID>-<Hash>` |

- **Security Verification:** On Unix, the daemon verifies before binding that `KIN_RUN_DIR` is owned strictly by the current effective UID (`st_uid == geteuid()`), permissions are `0700`, and the path contains no symlinks.

### 2.2 Mutual 3-Step HMAC-SHA256 Handshake Protocol (`TRD-PRC-002`)
To protect against unauthorized local processes connecting to the socket as well as rogue servers squatting on `e.sock`, KIN mandates a mutual challenge-response handshake upon connection establishment:

```text
Client (Tauri / CLI)                                   Server (kin-engine)
       │                                                        │
       │ ─── 1. Connect to e.sock / Named Pipe ───────────────> │
       │                                                        │
       │ <── 2. ServerFrame::HelloChallenge ─────────────────── │
       │        { protocol_version: 8, server_nonce_hex,        │
       │          challenge_issued_at_us, engine_instance_ulid }│
       │                                                        │
       │        (Client reads engine.token from KIN_HOME,       │
       │         generates client_nonce, computes client_hmac)  │
       │                                                        │
       │ ─── 3. ClientEnvelope::Authenticate ──────────────────>│
       │        { protocol_version: 8, client_nonce_hex,        │
       │          client_kind, client_hmac_sha256_hex }         │
       │                                                        │
       │        (Server verifies challenge timeout <= 2000ms,   │
       │         verifies client_hmac in constant time,         │
       │         computes server_hmac)                          │
       │                                                        │
       │ <── 4. ServerFrame::AuthenticatedAck ───────────────── │
       │        { engine_version, sandbox_level,                │
       │          server_hmac_sha256_hex }                      │
       │                                                        │
       │        (Client verifies server_hmac in constant time)  │
       │                                                        │
       ▼                                                        ▼
Connection Authenticated: Ready for Commands, Streaming, and Event Subscriptions
```

- **HMAC Calculation Contracts:**
  - `client_hmac = HMAC-SHA256(engine_token, "kin-ipc-v8-client" || le_u16(8) || server_nonce || client_nonce)`
  - `server_hmac = HMAC-SHA256(engine_token, "kin-ipc-v8-server" || le_u16(8) || client_nonce || server_nonce)`
- **Constant-Time Verification:** Both parties verify proofs using constant-time comparison (`subtle::ConstantTimeEq`) to eliminate timing side-channel attacks.

### 2.3 16-Byte Binary Framing Header (`KIN8`)
All communications over the socket utilize a fixed 16-byte binary framing header preceding the serialized payload:

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                  Magic: 0x4B494E38 ("KIN8")                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Flags (u16)          |        Stream ID (u16)        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Payload Length (u32)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     CRC-32C Checksum (u32)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Payload Data (UTF-8 JSON)                   |
|                              ...                              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Magic:** Fixed 4-byte identifier `0x4B494E38` ASCII `"KIN8"`.
- **Flags:** Bit 0 = Compressed (Zstd); Bit 1 = Heartbeat; Bit 2 = Resync Required.
- **Stream ID:** Allows multiplexing multiple concurrent agent token streams over a single connection.
- **Payload Length:** Unsigned 32-bit integer indicating payload size (enforced maximum: 16 MiB).
- **CRC-32C:** Castagnoli polynomial checksum over the payload data for hardware-accelerated integrity verification.

---

## 3. Six-Layer Crate Graph & Dependency Architecture

KIN is organized into a modular, strictly partitioned 6-layer Rust workspace. Lower layers have zero visibility into higher layers, preventing circular dependencies and ensuring unit-testability of core domain logic without I/O adapters:

```text
Layer 5: Host Binaries & Tauri Shell
  [kin-shell (Tauri v2)]   [kin-engine (Daemon)]   [kin-cli]   [kin-bench]   [xtask]
                                      │
Layer 4: Pure Domain & Orchestration (Pure Logic — Tokio Sync only, no direct I/O)
  [kin-orch]    [kin-harness]   [kin-memory]   [kin-context]   [kin-tasks]   [kin-sched]
                                      │
Layer 3: Execution Adapters & OS Sandboxing
  [kin-policy]  [kin-sandbox]   [kin-lanes]    [kin-pty]       [kin-browser] [kin-egress] [kin-mcp]
                                      │
Layer 2: Persistence, Indexing & Vault
  [kin-store]   [kin-ledger]    [kin-blobs]    [kin-index]     [kin-vault]
                                      │
Layer 1: Hexagonal Ports, Crypto & Plugin SDK
  [kin-ports]   [kin-crypto]    [kin-plugin-sdk]
                                      │
Layer 0: Foundational Types & Wire Protocol
  [kin-types]   [kin-proto]     [kin-error]
```

### 3.1 Layer Responsibilities & Isolation Invariants
- **Layer 0 (Foundation):** Contains canonical data types, strongly-typed 30-character prefixed IDs (`prj_...`, `agt_...`, `run_...`, `msg_...`, `tsk_...`), wire serialization types, and the closed `KinError` taxonomy. Zero external dependencies other than serde and basic utility crates.
- **Layer 1 (Ports & Crypto):** Defines abstract hexagonal traits (`StorePort`, `FsPort`, `LlmGatewayPort`, `ProcessPort`, `VaultPort`), RFC 8785 JSON Canonicalization, cryptographic hashers (BLAKE3), and digital signers (Ed25519).
- **Layer 2 (Persistence):** Encrypted SQLCipher actors, `sqlite-vec` vector index adapters, append-only BLAKE3 audit ledgers, and XChaCha20-Poly1305 encrypted blob storage.
- **Layer 3 (Execution Adapters):** Implements system integrations: OS sandboxes (Landlock/Seccomp/Seatbelt), Git worktree operations, PTY management, headless Chrome CDP browser controller, and DNS-pinned outbound egress.
- **Layer 4 (Pure Domain):** Implements the 15-state harness lifecycle, Deterministic Turn Arbiter (DTA), Task DAG topological scheduler, and 9-layer context compiler. Layer 4 depends **strictly** on Layer 0 and Layer 1 traits, making the core reasoning engine completely decoupled from OS side-effects.
- **Layer 5 (Host Binaries):** Tauri desktop shell, headless CLI daemon, benchmark harness, and xtask automation scripts.

### 3.2 Monotonic Microsecond Wall-Clock Contract (`TRD-CLK-001`)
To ensure that audit logs, message sequences, and ledger events maintain strict chronological order even during NTP backward clock adjustments, KIN uses an atomic compare-and-swap monotonic clock:

```rust
pub fn next_monotonic_timestamp_us(
    last_issued_ts_us: &std::sync::atomic::AtomicI64,
    os_wall_clock_us: i64,
) -> i64 {
    use std::sync::atomic::Ordering;
    let mut prev = last_issued_ts_us.load(Ordering::Relaxed);
    loop {
        // Enforce strictly greater than the previous timestamp
        let next_ts_us = prev.max(os_wall_clock_us.saturating_sub(1)).saturating_add(1);
        match last_issued_ts_us.compare_exchange_weak(
            prev,
            next_ts_us,
            Ordering::SeqCst,
            Ordering::Relaxed,
        ) {
            Ok(_) => return next_ts_us,
            Err(actual) => prev = actual,
        }
    }
}
```

---

## 4. Cryptographic Key Hierarchy & Data Shredding Architecture

KIN employs a multi-tiered cryptographic envelope structure ensuring zero-knowledge isolation between projects and clean mathematical destruction on project deletion:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       OS KEYCHAIN (Secure Enclave / DPAPI)                  │
│       Service: "dev.kin.project.pmk"   Account: "<project_id>"              │
│       Contains: 256-bit CSPRNG Project Master Key (PMK_prj)                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            HKDF-SHA256 (IKM: PMK_prj, Salt: "<project_id>")
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
Info: "kin/v8/sqlcipher"       Info: "kin/v8/blobs"          Info: "kin/v8/ledger"
┌───────────────────────┐      ┌───────────────────────┐     ┌───────────────────────┐
│     PDK_prj (256b)    │      │     PBK_prj (256b)    │     │     LSK_prj (32B)     │
│  SQLCipher AES-256    │      │ XChaCha20-Poly1305    │     │ Ed25519 Signing Seed  │
│  • project.db         │      │ • blobs/*.zst.enc     │     │ • Ledger checkpoints  │
│  • index.db           │      │                       │     │ • Purge receipts      │
└───────────────────────┘      └───────────────────────┘     └───────────────────────┘
```

### 4.1 Master Key Derivation & Storage
1. **Independent Per-Project Master Key (`PMK_prj`):** A 256-bit cryptographic random key generated via OS CSPRNG. Stored exclusively in the OS Keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service).
2. **Derived Database Key (`PDK_prj`):** Derived via HKDF-SHA256 to encrypt both `project.db` (application state) and `index.db` (code chunks and vector embeddings) using SQLCipher with 256,000 PBKDF2 iterations.
3. **Derived Blob Encryption Key (`PBK_prj`):** Derived via HKDF-SHA256 to encrypt large files, terminal outputs, and browser snapshots via XChaCha20-Poly1305 AEAD.
4. **Derived Ledger Signing Key (`LSK_prj`):** A 32-byte Ed25519 signing seed held in zeroized memory to produce non-repudiable signatures on ledger checkpoints.

### 4.2 Mathematical Cryptographic Shredding (`PRD-PRJ-004`)
When an operator issues `ProjectCryptoShred`:
1. The daemon securely deletes `PMK_prj` from the OS Keychain.
2. If fallback keyfiles exist (`$KIN_HOME/keys/<prj_id>.key`), they are overwritten with random bytes, flushed via `fsync`, and unlinked.
3. The local project directory `$KIN_HOME/projects/<prj_id>/` is unlinked.
4. Because the encryption key `PMK_prj` is destroyed and was never stored in the global registry or sent to any cloud server, all remaining flash blocks across `project.db`, `index.db`, and `blobs/` are rendered permanently unrecoverable ($2^{256}$ brute-force barrier).

---

## 5. Non-Functional Requirements & Engineering Performance Budgets

| Metric | Target Specification | Architectural Mechanism |
| :--- | :--- | :--- |
| **Engine Cold Startup** | `< 800ms` macOS / `< 1200ms` Win/Linux | Pure Rust daemon, lazy ONNX model loading, pre-warmed connection pool |
| **Turn Arbiter (DTA) Stages 0–2** | `< 15ms` p95 (0 LLM tokens, >= 95% turns) | Aho-Corasick pattern matching + quantized local ONNX embedding matcher |
| **Hybrid Vector/BM25 Search** | `< 45ms` on 100k chunks + 10k memories | `sqlite-vec` `vec0` partition indexing + FTS5 BM25 + Reciprocal Rank Fusion |
| **Patch Validation + Lint** | `< 80ms` total turnaround | Incremental Tree-sitter parse + 55ms warm LSP diagnostic query timeout |
| **UI Streaming Frame Time** | `< 16.6ms` (Solid 60 FPS) | Virtualized DOM (`@tanstack/react-virtual`) + 16ms token batch coalescing |
| **Idle Memory Footprint** | `< 180MB` RSS (pre-ONNX) | Strict LRU memory pools, 15-minute idle LSP daemon eviction |
| **Crash Safety Under Power Loss** | 0 corruptions, 0 orphaned worktrees | SQLite WAL `synchronous=FULL` + two-phase intent recovery journal |

---

## 6. Technical Risk Matrix & Concrete Mitigations

| Risk / Failure Mode | Severity | Likelihood | Concrete Technical Mitigation |
| :--- | :---: | :---: | :--- |
| **1. Socket Path Exceeds OS Limits** | High | High | Enforce canonical `KIN_RUN_DIR` under `/tmp/kin-<uid>` (`<= 44B`), bypassing user home paths. |
| **2. Prompt Bloat Truncates Tool Schemas** | Critical | High | Minify tool schemas, deduplicate prompt instructions, compact trajectory, calibrate context window. |
| **3. Concurrent Agents Corrupt Git Index** | Critical | Med | Isolate agents to dedicated Git worktree lanes (`repo.git`), enforce 3-way merge queue serialization. |
| **4. SSRF & Prompt Injection via Web Tools** | Critical | Med | Enforce DNS resolution check blocking RFC 1918/link-local IPs; wrap external content in `<untrusted_content>` tags. |
| **5. Infinite Agent-to-Agent DM Loops** | High | Med | Enforce Ping-Pong Circuit Breaker: 4 turns without disk or task progress automatically escalates to `@boss`. |
| **6. Disk Space Exhaustion (ENOSPC)** | High | Med | Pre-flight disk space check: abort operations cleanly if free disk space falls below 256 MiB; auto-truncate WAL. |

---

## 7. Explicit Descoping & Non-Goals

To maintain security sovereignty, high performance, and execution focus, the following capabilities are explicitly descoped from KIN:
1. **Multi-Tenant Cloud Hosting:** KIN is not a hosted multi-user SaaS. It does not provide remote multi-user collaboration over external web servers. All core databases and execution lanes run strictly on the developer's physical machine.
2. **Unsandboxed Host Execution:** KIN will never execute arbitrary tool commands directly against the user's host environment without going through the S2 sandbox policy and autonomy gate.
3. **Proprietary Closed Tool Protocols:** KIN rejects bespoke, non-standard tool protocols in favor of the open standard **Model Context Protocol (MCP)**.
4. **Silent Automatic Code Merging:** KIN will never silently merge agent-generated code changes into the user's live working branch without either explicit human approval or verified passing test suites under `AUTO` mode.
