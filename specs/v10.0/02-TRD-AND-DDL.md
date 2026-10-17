# DOC-02: Technical Requirements Document (TRD), Mutual IPC Handshake, Crypto Hierarchy, Schema Migrations & Verified SQLite DDL

| Field | Value |
| :--- | :--- |
| **Document ID** | KIN-DOC-02 (`02-TRD-AND-DDL.md`) |
| **Suite Version** | `10.0.0-PRODUCTION` |
| **Status** | **Canonical Specification & Reference Contract Bundle** |
| **Scope** | Process Topology, Short-Path `$KIN_RUN_DIR/e.sock` (`<= 44B`, under 104B kernel `sun_path` limit, `ST-08`), Mutual 3-Step HMAC Handshake (`KIN8`, `ST-15`), Monotonic Microsecond Clock (`TRD-CLK-001`, `RT7-09`), 6-Layer Crate Graph & Pinned Crate Versions (`RT9-01`, `RT12-11`), OS-Keychain `PMK_prj` + `LSK_prj` + Encrypted `index.db` (`ST-15`, `RT12-08`), Immutable-Table Migrations & Disk-Full/WAL Valve (`ST-32`, `RT7-08`), and Verified SQLite `STRICT` + `vec0` Schemas (`mcp_integrations`, `extension_packages`, `RT4`–`RT13`) |

## 1. System Process Topology, Short Socket Paths & Mutual 3-Step Handshake (`TRD-PRC-*`)

### 1.1 Canonical `KIN_HOME` and Short-Path `KIN_RUN_DIR` (`TRD-PRC-001`, Fixing `ST-08` & `RT4-03`)

Unix Domain Socket paths (`sockaddr_un.sun_path`) are limited by the kernel to **104 bytes on macOS/BSD** and **108 bytes on Linux**. Placing sockets under `~/Library/Application Support/...` exceeds 104 bytes when usernames or project IDs are long. KIN therefore separates persistent storage (`KIN_HOME`) from runtime sockets (`KIN_RUN_DIR`):

| Platform | Default `KIN_HOME` (`0700`) | Default `KIN_RUN_DIR` (`0700`, `sun_path <= 36B`) | Engine IPC Socket (`<= 44B`) |
| :--- | :--- | :--- | :--- |
| **macOS** | `~/Library/Application Support/dev.kin.app` | `/tmp/kin-<uid>` (verified `st_uid == geteuid()`, `0700`, no symlinks) | `/tmp/kin-<uid>/e.sock` |
| **Linux** | `$XDG_DATA_HOME/kin` (`~/.local/share/kin`) | `$XDG_RUNTIME_DIR/kin` (fallback `/tmp/kin-<uid>`, `0700`) | `$KIN_RUN_DIR/e.sock` |
| **Windows** | `%LOCALAPPDATA%\KIN` | Named Pipe namespace | `\\.\pipe\kin-engine-<UserSID>-<Hash>` |

- **Ancestor Traversal on macOS Seatbelt (`RT4-03`)**: Worktrees reside at `$KIN_HOME/projects/<prj_id>/worktrees/<wkt_id>` (or optionally `$KIN_RUN_DIR/lanes/<wkt_id>`). To ensure `getcwd(3)` and `realpath(3)` succeed inside `$LANE_WORKTREE_DIR` while `$KIN_HOME` remains protected, `macos_s2_lane.sb` (DOC-07 §3.1) explicitly grants `(allow file-read-metadata (literal ...))` on the exact ancestor directory inodes (`HOME_DIR`, `KIN_HOME_DIR`, `PROJECT_STATE_DIR`, `PROJECT_WORKTREES_DIR`) while denying `file-read-data` and `file-write*` on `(subpath (param "KIN_HOME_DIR"))`.

### 1.2 Mutual 3-Step Challenge-Response IPC Handshake (`TRD-PRC-002`, Fixing `P0-2` & `ST-15`)

To prevent both unauthorized clients **and** rogue server processes squatting on `e.sock`:

1. **Step 1 (`ServerFrame::HelloChallenge` — Frame 0 sent by `kin-engine` on accept)**:
   `{ protocol_version: 8, server_nonce_hex: <32B CSPRNG hex>, challenge_issued_at_us: i64, engine_instance_ulid: String }`.
2. **Step 2 (`ClientEnvelope::Authenticate` — Frame 1 sent by client within `2,000ms`)**:
   Client reads `$KIN_HOME/run/engine.token` (`0600`), generates `client_nonce` (32B), computes:
   `client_hmac = HMAC-SHA256(engine_token, "kin-ipc-v8-client" || le_u16(protocol_version) || server_nonce_bytes || client_nonce_bytes)`
   and sends `ClientEnvelope::Authenticate { protocol_version: 8, client_nonce_hex, client_kind, client_hmac_sha256_hex }`.
3. **Step 3 (`ServerFrame::AuthenticatedAck` — Frame 2 sent by `kin-engine`)**:
   Server verifies `protocol_version == 8`, checks `now_us - challenge_issued_at_us <= 2_000_000`, verifies `server_nonce` is unused in its replay cache, and verifies `client_hmac` in constant time. The server then computes its own proof:
   `server_hmac = HMAC-SHA256(engine_token, "kin-ipc-v8-server" || le_u16(protocol_version) || client_nonce_bytes || server_nonce_bytes)`
   and sends `ServerFrame::AuthenticatedAck { engine_version, sandbox_level, server_hmac_sha256_hex }`. **Client Verification (`ST-15`)**: The client verifies `server_hmac_sha256_hex` in constant time before transmitting any `Command` or `Subscribe` frame.

### 1.3 16-Byte Binary Framing (`KIN8`) & Payload Encoding (`TRD-PRC-003`)

- Wire header: `magic: u32 (0x4B494E38 "KIN8") | flags: u16 | stream_id: u16 | payload_len: u32 (<= 16 MiB) | crc32c: u32`.
- Payload encoding: UTF-8 JSON serialized from `ClientEnvelope` / `ServerFrame` (DOC-06 §1).

## 2. Six-Layer Cargo Workspace Crate Topology & Monotonic Clock (`TRD-CRT-001`, Fixing `ST-40` & `RT7-09`)

Layer L4 depends **only** on L0, L1 (`kin-ports`, `kin-crypto`, `kin-plugin-sdk`), `jiff` (in `kin-sched`), `tera`, `tokio` (`sync`), and `tokio-util` (`sync`, `rt`), honoring Build Rule 2 (`cargo run --package xtask --locked -- check-deps` / `cargo xtask check-deps`):

| Layer | Crates | Allowed Crate Dependencies | Responsibility |
| :--- | :--- | :--- | :--- |
| **L0: Foundation** | `kin-types`, `kin-proto`, `kin-error` | `serde`, `serde_json`, `specta`, `thiserror`, `ulid`, `jiff` | 30-character prefixed ID newtypes (`4-char prefix + 26-char Crockford ULID`), canonical enums (15 run states, 26 tools), IPC wire types, closed `KinError` taxonomy. |
| **L1: Ports, Crypto & Plugin SDK** | `kin-ports`, `kin-crypto`, `kin-plugin-sdk` | L0 + `blake3`, `ed25519-dalek`, `chacha20poly1305`, `argon2`, `hkdf`, `sha2`, `hmac`, `subtle`, `secrecy`, `aho-corasick` | Hexagonal port traits (`Clock`, `Store`, `Fs`, `ProcessSpawner`, `EgressClient`, `Vault`, `LlmGateway`), RFC 8785 JCS, `SecretRedactor`. |
| **L2: Persistence & Index Adapters** | `kin-store`, `kin-ledger`, `kin-blobs`, `kin-index`, `kin-vault` | L0–L1 + `rusqlite` (`bundled-sqlcipher-vendored-openssl`), `sqlite-vec`, `zstd`, `ort`, `ignore`, `tree-sitter`, `keyring` | SQLCipher actors (`project.db` + `index.db`), `project_events`, BLAKE3+Ed25519 ledger, AEAD blob store, `vec0` + PageRank indexer, OS Keychain / BIP39 vault. |
| **L3: Execution Adapters** | `kin-policy`, `kin-sandbox`, `kin-lanes`, `kin-pty`, `kin-lsp`, `kin-gateway`, `kin-egress`, `kin-browser`, `kin-mcp` | L0–L2 + `landlock`, `seccompiler`, `libc`, `windows-sys`, `cap-std`, `portable-pty`, `tree-sitter`, `tree-sitter-bash`, `reqwest` (in `kin-egress` only), `chromiumoxide` | 9-stage Dual-AST policy, OS sandboxes (`S2-Lane-Exec` + `S2-Root-Snapshot` + `socketpair` FD 3), self-contained `repo.git` lanes + 4-tier `fs_patch`, PTYs, LSP mux, LLM gateway, DNS-pinned egress proxy, CDP browser, MCP `2026-07-28` host. |
| **L4: Pure Domain & Orchestration** | `kin-memory`, `kin-context`, `kin-tools`, `kin-harness`, `kin-orch`, `kin-tasks`, `kin-sched` | **L0 + L1 (`kin-ports`, `kin-crypto`, `kin-plugin-sdk`) + `jiff` (`kin-sched`) + `tera` + `tokio` (`sync`) + `tokio-util` (`sync`, `rt`) ONLY** | 4-Tier × 4-Bank + bi-temporal graph logic, 9-layer KV-cache compiler, 26 tool handlers (via `kin-ports`), 15-state harness loop, Stage-0 Pre-Gate + 3-Stage DTA (`Stage 0–3 DTA`), Task DAG, and `jiff` scheduler. |
| **L5: Host Binaries** | `kin-engine`, `kin-shell`, `kin-cli`, `kin-bench`, `xtask` | L0–L4 + `tauri` (in `kin-shell` only), `clap` | Wires L2/L3 adapters into L4 traits; daemon supervisor, Tauri v2 desktop shell, CLI, KIN-Bench, and codegen. |

### 2.1 Monotonic Microsecond Wall-Clock Contract (`TRD-CLK-001`, Fixing `RT7-09`)

To prevent NTP backward clock steps or concurrent same-microsecond calls from violating chronological `ts_us` / `created_at_us` ordering across `ledger_events`, `messages`, `project_events`, and 30-character prefixed ID (26-character Crockford ULID) generation, `kin-ports::Clock::now_us()` updates a process-wide `AtomicI64` (`last_issued_ts_us`) via an atomic compare-and-swap (`fetch_update`) loop that stores the exact returned timestamp:

```rust
pub fn next_monotonic_timestamp_us(
    last_issued_ts_us: &std::sync::atomic::AtomicI64,
    os_wall_clock_us: i64,
) -> i64 {
    use std::sync::atomic::Ordering;
    let mut prev = last_issued_ts_us.load(Ordering::Relaxed);
    loop {
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

Because `compare_exchange_weak` (or `last_issued_ts_us.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |prev| Some(prev.max(os_wall_clock_us.saturating_sub(1)).saturating_add(1)))`) stores `next_ts_us` directly into `last_issued_ts_us` before returning `next_ts_us`, repeated calls when `os_wall_clock_us` is unchanged or stepped backward by NTP still advance `last_issued_ts_us` by `+1` on every call, guaranteeing strictly increasing microsecond timestamps across all threads.

### 2.2 Pinned Cargo Workspace Dependency Versions (`Cargo.toml [workspace.dependencies]`, Fixing `RT9-01`)

To eliminate crate API drift across builds, `Cargo.toml` pins the exact versions below:

| Crate | Pinned Version & Features | Used By Layer / Crates |
| :--- | :--- | :--- |
| `serde` / `serde_json` | `"1.0.210"` (`derive`) / `"1.0.128"` | L0–L5 (all crates) |
| `specta` | `"2.0.0-rc.20"` (`derive`) | `kin-types`, `kin-proto`, `xtask` |
| `thiserror` / `ulid` / `jiff` | `"1.0.64"` / `"1.1.3"` / `"0.1.13"` | `kin-error`, `kin-types`, `kin-sched` |
| `blake3` / `ed25519-dalek` | `"1.5.4"` / `"2.1.1"` (`rand_core`) | `kin-crypto` (L1; re-exported to `kin-ledger`, `kin-blobs`) |
| `chacha20poly1305` / `argon2` | `"0.10.1"` / `"0.5.3"` | `kin-crypto` (L1; re-exported to `kin-vault`, `kin-blobs`) |
| `hkdf` / `sha2` / `hmac` / `subtle` | `"0.12.4"` / `"0.10.8"` / `"0.12.1"` / `"2.6.1"` | `kin-crypto` (L1; re-exported to `kin-engine`, `kin-egress`) |
| `secrecy` / `aho-corasick` | `"0.10.3"` / `"1.1.3"` | `kin-crypto` (L1; re-exported to `kin-policy`, `kin-orch`) |
| `rusqlite` | `"0.32.1"` (`bundled-sqlcipher-vendored-openssl`) | `kin-store` (sole SQLite writer/reader adapter) |
| `sqlite-vec` / `ort` | `"0.1.9"` / `"2.0.0-rc.6"` | `kin-store`, `kin-index` (L2 adapters; consumed by `kin-memory` & `kin-orch` via `kin-ports`) |
| `zstd` / `ignore` / `keyring` | `"0.13.2"` / `"0.4.23"` / `"3.4.1"` | `kin-blobs`, `kin-index`, `kin-vault` (L2 persistence & vault adapters) |
| `landlock` / `seccompiler` / `libc` | `landlock = "0.4.1"`, `seccompiler = "0.4.0"`, `libc = "0.2.161"` | `kin-sandbox` (Linux S2 isolation) |
| `windows-sys` | `"0.59.0"` (`Win32_System_JobObjects`, `Win32_Security`, `Win32_System_Threading`) | `kin-sandbox` (Windows S1/S3 isolation) |
| `cap-std` / `portable-pty` | `"3.4.1"` / `"0.8.1"` | `kin-lanes`, `kin-pty` (L3 adapters; consumed by `kin-tools` via `kin-ports`) |
| `tree-sitter` / `tree-sitter-bash` | `"0.24.3"` / `"0.23.1"` | `kin-index`, `kin-lanes`, `kin-policy` |
| `tokio` / `tokio-util` | `"1.40.0"` (`default-features = false, features = ["sync"]` in root workspace for L4; L2/L3/L5 enable `rt`, `macros`, `time`, `net`, `process`, `io-util`, `fs` per-crate) / `"0.7.12"` (`sync`, `rt`) | L4–L5 (`kin-memory`, `kin-context`, `kin-tools`, `kin-harness`, `kin-orch`, `kin-tasks`, `kin-sched`, `kin-engine`, `kin-shell`, `kin-cli`, `kin-bench`) |
| `reqwest` / `chromiumoxide` | `"0.12.8"` (`rustls-tls`, `json`, `stream`) / `"0.7.0"` | `kin-egress` (sole `reqwest` crate), `kin-browser` |
| `tera` | `"1.20.0"` | L4 domain crates (`kin-harness`, `kin-context`, `kin-memory`, `kin-tools`, `kin-orch`, `kin-tasks`, `kin-sched`) |
| `tauri` / `clap` | `"2.1.0"` (`wry`) / `"4.5.20"` (`derive`) | `kin-shell` (sole `tauri` crate), `kin-cli`, `kin-bench`, `xtask` (L5 host binaries) |

## 3. Cryptographic Key Hierarchy, `index.db` Encryption & Irreversible Shred (`TRD-CRY-001`, Fixing `ST-15`)

1. **Independent Per-Project Master Key (`PMK_prj`, 256-bit CSPRNG)**:
   - Generated via OS CSPRNG when project `prj_id` is created.
   - Stored **exclusively** in the OS Keychain (`service = "dev.kin.project.pmk"`, `account = prj_id`).
   - On headless Linux without Secret Service, stored in a dedicated file `$KIN_HOME/keys/<prj_id>.key` (`0600`) encrypted via XChaCha20-Poly1305 under a key derived from the user's passphrase + a **per-project random 32-byte salt** via Argon2id (`m=64MiB, t=3, p=4`). At first vault setup, KIN displays a **24-word BIP39 Recovery Phrase** encoding the master recovery secret so the user can recover keys if they forget their passphrase.
   - `registry.db` **never** stores `PMK_prj` (neither plaintext nor wrapped); it stores only `pmk_fingerprint_blake3 = BLAKE3("kin-pmk-fp" || PMK_prj)`.
2. **Derived Project Keys (Both `project.db` AND `index.db` Encrypted)**:
   - `PDK_prj = HKDF-SHA256(ikm = PMK_prj, salt = prj_id, info = "kin/v8/sqlcipher-pdk")` → Passed to SQLCipher (`AES-256-CBC + HMAC-SHA512, cipher_page_size = 4096, kdf_iter = 256000`) for **both `project.db` AND `index.db`** (`ST-15`), ensuring `code_chunks.chunk_text` and embeddings are never stored in plaintext on disk.
   - `PBK_prj = HKDF-SHA256(ikm = PMK_prj, salt = prj_id, info = "kin/v8/blob-xchacha20")` → Encrypts `blobs/*.zst.enc` via XChaCha20-Poly1305 AEAD.
   - `LSK_prj = HKDF-SHA256(ikm = PMK_prj, salt = prj_id, info = "kin/v8/ledger-ed25519-seed")` → 32-byte Ed25519 signing seed held exclusively in `kin-ledger` zeroized memory (with its 32-byte public key persisted in `registry.db::projects.ledger_pubkey_hex` and optionally cached in OS Keychain `service = "dev.kin.project.lsk"`), used to sign `ledger_checkpoints` and `privacy.purge.receipt` events (`DOC-05 §4.2`).
3. **Cryptographic Shredding (`PRD-PRJ-004`)**:
   - Deletes `PMK_prj` and `LSK_prj` from the OS Keychain (and overwrites + `fsync`s + unlinks `$KIN_HOME/keys/<prj_id>.key` if present), unlinks `$KIN_HOME/projects/<prj_id>/`, and sets `projects.shredded = 1, shredded_at_us = now_us` in `registry.db`. Because `PMK_prj` is never stored in `registry.db` and never derived from a global key, old SSD blocks or backups of `registry.db`, `project.db`, `index.db`, or `blobs/` are permanently unrecoverable ($2^{256}$).

## 4. Complete, Verified SQLite `STRICT` Schemas (`DB-SCH-001..005`)

### 4.1 Connection Initialization, Disk-Full (`ENOSPC`) Valve & Immutable-Table Migrations (`ST-32`, `RT5-03`, `RT7-08`)

1. **Connection Setup**: Every connection sets `PRAGMA key = "x'<PDK_prj>'"` (for `project.db` and `index.db`), enables `SQLITE_DBCONFIG_DEFENSIVE`, and executes `PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY;`.
2. **Disk-Full (`ENOSPC`) Pre-Flight & WAL Checkpoint Valve (`DB-STR-002`, Fixing `RT7-08`)**:
   - Before creating a worktree snapshot `S0`, spilling a blob to `blobs/`, or starting a root apply (`apply_journals`), `kin-store` queries `statvfs` (Unix) / `GetDiskFreeSpaceExW` (Windows) on `$KIN_HOME` and `<root_path>`. If available disk space is `< 256 MiB`, the operation aborts cleanly with `KIN-STR-0008 DiskSpaceLow` before mutating state.
   - Every `1,000` write transactions (or whenever `project.db-wal` exceeds `64 MiB`), the single-writer `DbWriter` actor executes `PRAGMA wal_checkpoint(TRUNCATE);` during an idle beat so the WAL file never grows unboundedly.
3. **Migrating Immutable Tables (`ST-32`)**: Because `ledger_events`, `messages`, `run_steps`, `tool_calls`, `approval_requests`, `apply_journals`, and `project_events` are protected by `BEFORE UPDATE`/`BEFORE DELETE` triggers, `kin-store` executes schema migrations at daemon startup *before* spawning reader pools:
   - Acquire exclusive `project.lock` and open a single writer connection with `SQLITE_DBCONFIG_DEFENSIVE` temporarily disabled for DDL migration.
   - Run `kin_ledger::verify_chain()` prior to migration.
   - Inside `BEGIN IMMEDIATE`: `DROP TRIGGER trg_*_immutable`, apply `ALTER TABLE ADD COLUMN` (or 12-step SQLite table rebuild), recreate all triggers from the new migration script, run `PRAGMA foreign_key_check` and `PRAGMA integrity_check`, insert the new version into `schema_migrations`, `COMMIT`, and re-verify `kin_ledger::verify_chain()`.

```sql
-- =============================================================================
-- 1. GLOBAL REGISTRY DATABASE: $KIN_HOME/registry.db
-- =============================================================================
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA recursive_triggers = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;

CREATE TABLE schema_migrations (
    version         INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    checksum_blake3 TEXT NOT NULL CHECK (length(checksum_blake3) = 64),
    applied_at_us   INTEGER NOT NULL
) STRICT;

CREATE TABLE projects (
    id                        TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'prj_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    slug                      TEXT NOT NULL UNIQUE,
    display_name              TEXT NOT NULL,
    root_path                 TEXT NOT NULL UNIQUE,
    state_dir                 TEXT NOT NULL UNIQUE,
    repo_git_dir              TEXT NOT NULL UNIQUE,
    repo_mode                 TEXT NOT NULL CHECK (repo_mode IN ('git','shadow_git','non_git')),
    trust_state               TEXT NOT NULL DEFAULT 'untrusted'
                              CHECK (trust_state IN ('untrusted','trusted','restricted')),
    trusted_config_hash       TEXT,
    autonomy_ceiling          TEXT NOT NULL DEFAULT 'WORKTREE_AUTO'
                              CHECK (autonomy_ceiling IN ('READ_ONLY','WORKTREE_AUTO','AUTO','FULL_ACCESS')),
    local_only_lock           INTEGER NOT NULL DEFAULT 0 CHECK (local_only_lock IN (0,1)),
    budget_daily_micro_usd    INTEGER NOT NULL DEFAULT 10000000 CHECK (budget_daily_micro_usd >= 0),
    budget_monthly_micro_usd  INTEGER NOT NULL DEFAULT 150000000 CHECK (budget_monthly_micro_usd >= 0),
    max_agents_cap            INTEGER NOT NULL DEFAULT 24 CHECK (max_agents_cap BETWEEN 2 AND 64),
    ledger_pubkey_hex         TEXT NOT NULL CHECK (length(ledger_pubkey_hex) = 64),
    pmk_keychain_account      TEXT NOT NULL, -- Stored in OS Keychain or $KIN_HOME/keys/<prj_id>.key (NEVER in SQLite, ST-15)
    pmk_fingerprint_blake3    TEXT NOT NULL CHECK (length(pmk_fingerprint_blake3) = 64),
    shredded                  INTEGER NOT NULL DEFAULT 0 CHECK (shredded IN (0,1)),
    shredded_at_us            INTEGER,
    archived_at_us            INTEGER,
    last_opened_at_us         INTEGER NOT NULL,
    created_at_us             INTEGER NOT NULL,
    updated_at_us             INTEGER NOT NULL,
    CHECK ((shredded = 0 AND shredded_at_us IS NULL) OR (shredded = 1 AND shredded_at_us IS NOT NULL)),
    CHECK (updated_at_us >= created_at_us)
) STRICT;

CREATE TABLE provider_profiles (
    id                  TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'prv_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    kind                TEXT NOT NULL CHECK (kind IN (
                        'anthropic','openai','gemini','deepseek','openrouter','ollama','openai_compat')),
    display_name        TEXT NOT NULL,
    base_url            TEXT NOT NULL,
    keychain_secret_ref TEXT,
    org_or_project_id   TEXT,
    enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    is_local            INTEGER NOT NULL DEFAULT 0 CHECK (is_local IN (0,1)),
    circuit_state       TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
    cooldown_until_us   INTEGER,
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL,
    CHECK (updated_at_us >= created_at_us)
) STRICT;

-- All cost columns use explicit _micro_usd suffix (Fixing ST-25)
CREATE TABLE model_catalog (
    model_uid                       TEXT PRIMARY KEY,
    provider_id                     TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    model_id                        TEXT NOT NULL,
    display_name                    TEXT NOT NULL,
    context_window                  INTEGER NOT NULL CHECK (context_window > 0),
    max_output_tokens               INTEGER NOT NULL CHECK (max_output_tokens > 0),
    supports_tools                  INTEGER NOT NULL DEFAULT 1 CHECK (supports_tools IN (0,1)),
    supports_vision                 INTEGER NOT NULL DEFAULT 0 CHECK (supports_vision IN (0,1)),
    supports_json_schema            INTEGER NOT NULL DEFAULT 1 CHECK (supports_json_schema IN (0,1)),
    supports_prompt_cache           INTEGER NOT NULL DEFAULT 0 CHECK (supports_prompt_cache IN (0,1)),
    reasoning_mode                  TEXT NOT NULL DEFAULT 'none'
                                    CHECK (reasoning_mode IN ('none','adaptive','budget','effort_only','deepseek_interleaved')),
    reasoning_replay_policy         TEXT NOT NULL DEFAULT 'strip_all'
                                    CHECK (reasoning_replay_policy IN ('replay_all_turns','replay_active_tool_loop_only','strip_all')),
    input_cost_per_mtok_micro_usd   INTEGER NOT NULL DEFAULT 0 CHECK (input_cost_per_mtok_micro_usd >= 0),
    output_cost_per_mtok_micro_usd  INTEGER NOT NULL DEFAULT 0 CHECK (output_cost_per_mtok_micro_usd >= 0),
    cache_read_per_mtok_micro_usd   INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_per_mtok_micro_usd >= 0),
    cache_write_per_mtok_micro_usd  INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_per_mtok_micro_usd >= 0),
    updated_at_us                   INTEGER NOT NULL
) STRICT;

CREATE TABLE global_spend_rollups (
    day_utc         TEXT NOT NULL,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    provider_id     TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
    model_uid       TEXT NOT NULL,
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    cached_tokens   INTEGER NOT NULL DEFAULT 0,
    cost_micro_usd  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day_utc, project_id, provider_id, model_uid)
) STRICT;

-- =============================================================================
-- 2. PER-PROJECT AUTHORITATIVE DATABASE: $KIN_HOME/projects/<prj_id>/project.db
--    Encrypted via SQLCipher (AES-256-CBC + HMAC-SHA512) under PDK_prj
-- =============================================================================
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA recursive_triggers = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;

-- 2.1 Agents, Hierarchy & Capability Grants (Fixing RT4-15.1 & RT4-26)
CREATE TABLE agents (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'agt_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    slug                    TEXT NOT NULL UNIQUE,
    display_name            TEXT NOT NULL,
    role_kind               TEXT NOT NULL CHECK (role_kind IN ('boss','specialist','subagent')),
    lifecycle               TEXT NOT NULL CHECK (lifecycle IN ('persistent','task_scoped','ephemeral')),
    status                  TEXT NOT NULL DEFAULT 'idle'
                            CHECK (status IN ('idle','running','waiting_approval','waiting_takeover','paused','retired')),
    parent_agent_id         TEXT REFERENCES agents(id) ON DELETE RESTRICT,
    spawn_depth             INTEGER NOT NULL DEFAULT 0 CHECK (spawn_depth BETWEEN 0 AND 2),
    bound_task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    title                   TEXT NOT NULL,
    charter_markdown        TEXT NOT NULL,
    owned_globs_json        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(owned_globs_json) AND json_type(owned_globs_json) = 'array'),
    domain_keywords_text    TEXT NOT NULL DEFAULT '',
    role_embedding_f32      BLOB CHECK (role_embedding_f32 IS NULL OR length(role_embedding_f32) IN (1536, 3072, 6144)),
    model_slot              TEXT NOT NULL DEFAULT 'coder'
                            CHECK (model_slot IN ('flagship','planner','coder','fast_research','fast_tool','guard','embedding','local_offline')),
    model_override_uid      TEXT,
    reasoning_effort        TEXT NOT NULL DEFAULT 'medium'
                            CHECK (reasoning_effort IN ('none','low','medium','high','max')),
    autonomy_mode           TEXT NOT NULL DEFAULT 'WORKTREE_AUTO'
                            CHECK (autonomy_mode IN ('READ_ONLY','WORKTREE_AUTO','AUTO','FULL_ACCESS')),
    max_steps_per_run       INTEGER NOT NULL DEFAULT 40 CHECK (max_steps_per_run BETWEEN 1 AND 200),
    run_budget_micro_usd    INTEGER NOT NULL DEFAULT 2000000 CHECK (run_budget_micro_usd > 0),
    daily_budget_micro_usd  INTEGER NOT NULL DEFAULT 5000000 CHECK (daily_budget_micro_usd > 0),
    created_at_us           INTEGER NOT NULL,
    updated_at_us           INTEGER NOT NULL,
    retired_at_us           INTEGER,
    CHECK (
        (role_kind = 'boss' AND parent_agent_id IS NULL AND spawn_depth = 0) OR
        (role_kind = 'specialist' AND parent_agent_id IS NOT NULL AND spawn_depth = 1) OR
        (role_kind = 'subagent' AND parent_agent_id IS NOT NULL AND spawn_depth BETWEEN 1 AND 2)
    ),
    CHECK (updated_at_us >= created_at_us)
) STRICT;

CREATE UNIQUE INDEX idx_agents_single_boss ON agents(role_kind) WHERE role_kind = 'boss' AND retired_at_us IS NULL;

-- Fixed RT9-07e: Enforce parent spawn_depth + 1 consistency on INSERT and immutability of role_kind/parent_agent_id/spawn_depth on UPDATE
CREATE TRIGGER trg_agents_hierarchy_insert BEFORE INSERT ON agents
WHEN new.role_kind != 'boss'
  AND NOT EXISTS (
      SELECT 1 FROM agents p
       WHERE p.id = new.parent_agent_id
         AND p.retired_at_us IS NULL
         AND new.spawn_depth = p.spawn_depth + 1
  )
BEGIN
    SELECT RAISE(ABORT, 'KIN-AGT-0001: child agent spawn_depth must equal active parent_agent_id spawn_depth + 1');
END;

CREATE TRIGGER trg_agents_hierarchy_update BEFORE UPDATE ON agents
WHEN old.role_kind IS NOT new.role_kind
  OR old.parent_agent_id IS NOT new.parent_agent_id
  OR old.spawn_depth IS NOT new.spawn_depth
BEGIN
    SELECT RAISE(ABORT, 'KIN-AGT-0001: agents.role_kind, parent_agent_id, and spawn_depth are immutable');
END;

CREATE TABLE agent_capability_grants (
    id              TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'grt_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    capability      TEXT NOT NULL,
    scope_glob      TEXT NOT NULL DEFAULT '*',
    max_risk_auto   TEXT NOT NULL DEFAULT 'R1' CHECK (max_risk_auto IN ('R0','R1','R2','R3')),
    delegable       INTEGER NOT NULL DEFAULT 0 CHECK (delegable IN (0,1)),
    granted_by      TEXT NOT NULL,
    expires_at_us   INTEGER,
    created_at_us   INTEGER NOT NULL,
    UNIQUE (agent_id, capability, scope_glob)
) STRICT;

-- 2.2 Channels, Threads, Canonical DMs, Bounded Meetings & Append-Only Messages
CREATE TABLE channels (
    id              TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'chn_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    slug            TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('general','department','topic','alerts','review')),
    topic           TEXT NOT NULL DEFAULT '',
    lead_agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
    is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    archived_at_us  INTEGER,
    created_at_us   INTEGER NOT NULL
) STRICT;

CREATE TABLE channel_members (
    channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    member_id       TEXT NOT NULL,
    member_kind     TEXT NOT NULL CHECK (member_kind IN ('human','agent')),
    agent_id        TEXT REFERENCES agents(id) ON DELETE RESTRICT,
    notify_mode     TEXT NOT NULL DEFAULT 'mention_or_route'
                    CHECK (notify_mode IN ('all','mention_or_route','mention_only','muted')),
    joined_at_us    INTEGER NOT NULL,
    PRIMARY KEY (channel_id, member_id),
    CHECK (
        (member_kind = 'human' AND member_id = 'human:operator' AND agent_id IS NULL) OR
        (member_kind = 'agent' AND member_id = agent_id AND agent_id IS NOT NULL)
    )
) STRICT;

-- Fixed ST-19, ST-25, RT4-13 & RT5-01: 30-character dmc_ prefixed ID (4-char prefix + 26-char Crockford ULID) + canonical participant_a < participant_b + validated participant_a & bounded turns
CREATE TABLE dm_conversations (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'dmc_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    kind                    TEXT NOT NULL CHECK (kind IN ('human_agent','agent_agent')),
    participant_a           TEXT NOT NULL,
    participant_b           TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    bound_task_id           TEXT NOT NULL DEFAULT '' CHECK (bound_task_id = '' OR (length(bound_task_id) = 30 AND bound_task_id GLOB 'tsk_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    consecutive_agent_turns INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_agent_turns BETWEEN 0 AND 4),
    created_at_us           INTEGER NOT NULL,
    updated_at_us           INTEGER NOT NULL,
    UNIQUE (kind, participant_a, participant_b, bound_task_id),
    CHECK (
        (kind = 'human_agent' AND participant_a = 'human:operator' AND (length(participant_b) = 30 AND participant_b GLOB 'agt_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')) OR
        (kind = 'agent_agent' AND (length(participant_a) = 30 AND participant_a GLOB 'agt_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]') AND (length(participant_b) = 30 AND participant_b GLOB 'agt_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]') AND participant_a < participant_b)
    ),
    CHECK (updated_at_us >= created_at_us)
) STRICT;

-- Fixed RT4-15.2, RT4-26 & RT5-02: root_message_id deferred FK + flexible embedding length
CREATE TABLE threads (
    id                  TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'thr_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    channel_id          TEXT REFERENCES channels(id) ON DELETE RESTRICT,
    dm_id               TEXT REFERENCES dm_conversations(id) ON DELETE RESTRICT,
    root_message_id     TEXT REFERENCES messages(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    title               TEXT,
    sticky_agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
    sticky_until_us     INTEGER,
    topic_embedding     BLOB CHECK (topic_embedding IS NULL OR length(topic_embedding) IN (1536, 3072, 6144)),
    state               TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','archived')),
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL,
    CHECK ((channel_id IS NOT NULL AND dm_id IS NULL) OR (channel_id IS NULL AND dm_id IS NOT NULL)),
    CHECK (updated_at_us >= created_at_us)
) STRICT;

-- Fixed ST-20: Enforces 2..6 participants via json_array_length(participants_json) BETWEEN 2 AND 6
CREATE TABLE meetings (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'mtg_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    channel_id              TEXT NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    thread_id               TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,
    moderator_agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    mode                    TEXT NOT NULL CHECK (mode IN ('moderated','round_robin','debate','design_review')),
    agenda                  TEXT NOT NULL,
    participants_json       TEXT NOT NULL CHECK (
                                json_valid(participants_json)
                                AND json_type(participants_json) = 'array'
                                AND json_array_length(participants_json) BETWEEN 2 AND 6
                            ),
    status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','synthesizing','concluded','aborted')),
    current_round           INTEGER NOT NULL DEFAULT 1 CHECK (current_round >= 1 AND current_round <= max_rounds),
    max_rounds              INTEGER NOT NULL DEFAULT 3 CHECK (max_rounds BETWEEN 1 AND 6),
    max_tokens_per_speech   INTEGER NOT NULL DEFAULT 800 CHECK (max_tokens_per_speech BETWEEN 100 AND 4096),
    budget_micro_usd_max    INTEGER NOT NULL DEFAULT 500000 CHECK (budget_micro_usd_max > 0),
    budget_micro_usd_spent  INTEGER NOT NULL DEFAULT 0 CHECK (budget_micro_usd_spent >= 0),
    decision_record_md      TEXT,
    started_at_us           INTEGER NOT NULL,
    ended_at_us             INTEGER,
    CHECK (status != 'concluded' OR (decision_record_md IS NOT NULL AND length(decision_record_md) > 0)),
    CHECK (ended_at_us IS NULL OR ended_at_us >= started_at_us)
) STRICT;

-- Fixed ST-14, ST-18, RT4-11.3 & RT4-15.3: Agent messages require run_id + FK to runs(id) + Full-Column Immutability Lock
CREATE TABLE messages (
    id                  TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'msg_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    channel_id          TEXT REFERENCES channels(id) ON DELETE RESTRICT,
    thread_id           TEXT REFERENCES threads(id) ON DELETE RESTRICT,
    dm_id               TEXT REFERENCES dm_conversations(id) ON DELETE RESTRICT,
    meeting_id          TEXT REFERENCES meetings(id) ON DELETE RESTRICT,
    author_kind         TEXT NOT NULL CHECK (author_kind IN ('human','agent','system')),
    author_agent_id     TEXT REFERENCES agents(id) ON DELETE RESTRICT,
    run_id              TEXT REFERENCES runs(id) ON DELETE RESTRICT,
    reply_to_msg_id     TEXT REFERENCES messages(id) ON DELETE RESTRICT,
    msg_kind            TEXT NOT NULL DEFAULT 'chat'
                        CHECK (msg_kind IN ('chat','directive','status','review_comment','meeting_turn','meeting_minutes','system_alert')),
    content_md          TEXT NOT NULL,
    parts_json          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(parts_json) AND json_type(parts_json) = 'array'),
    mentions_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mentions_json) AND json_type(mentions_json) = 'array'),
    token_estimate      INTEGER NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
    hop_depth           INTEGER NOT NULL DEFAULT 0 CHECK (hop_depth BETWEEN 0 AND 10),
    tainted             INTEGER NOT NULL DEFAULT 0 CHECK (tainted IN (0,1)),
    is_compacted        INTEGER NOT NULL DEFAULT 0 CHECK (is_compacted IN (0,1)),
    content_purged      INTEGER NOT NULL DEFAULT 0 CHECK (content_purged IN (0,1)),
    created_at_us       INTEGER NOT NULL,
    CHECK ((channel_id IS NOT NULL AND dm_id IS NULL) OR (channel_id IS NULL AND dm_id IS NOT NULL)),
    CHECK (author_kind != 'agent' OR (author_agent_id IS NOT NULL AND run_id IS NOT NULL))
) STRICT;

CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at_us);
CREATE INDEX idx_messages_thread_time  ON messages(thread_id, created_at_us);
CREATE INDEX idx_messages_dm_time      ON messages(dm_id, created_at_us);

CREATE TRIGGER trg_messages_no_delete BEFORE DELETE ON messages BEGIN
    SELECT RAISE(ABORT, 'KIN-HIS-0001: messages archive is append-only (use privacy purge)');
END;

-- Fixed ST-18: Locks EVERY metadata and content column on messages
CREATE TRIGGER trg_messages_immutable BEFORE UPDATE ON messages
WHEN old.id IS NOT new.id
  OR old.channel_id IS NOT new.channel_id
  OR old.thread_id IS NOT new.thread_id
  OR old.dm_id IS NOT new.dm_id
  OR old.meeting_id IS NOT new.meeting_id
  OR old.author_kind IS NOT new.author_kind
  OR old.author_agent_id IS NOT new.author_agent_id
  OR old.run_id IS NOT new.run_id
  OR old.reply_to_msg_id IS NOT new.reply_to_msg_id
  OR old.msg_kind IS NOT new.msg_kind
  OR old.token_estimate IS NOT new.token_estimate
  OR old.hop_depth IS NOT new.hop_depth
  OR old.tainted IS NOT new.tainted
  OR old.created_at_us IS NOT new.created_at_us
  OR (old.is_compacted = 1 AND new.is_compacted = 0)
  OR (old.content_purged = 1 AND new.content_purged = 0)
  OR (new.content_purged = 0 AND (old.content_md IS NOT new.content_md OR old.parts_json IS NOT new.parts_json OR old.mentions_json IS NOT new.mentions_json))
  OR (new.content_purged = 1 AND (new.content_md != '[PURGED]' OR new.parts_json != '[]' OR new.mentions_json != '[]'))
BEGIN
    SELECT RAISE(ABORT, 'KIN-HIS-0002: messages columns are strictly immutable except is_compacted or one-way privacy purge');
END;

CREATE VIRTUAL TABLE messages_fts USING fts5(
    message_id UNINDEXED,
    scope_key UNINDEXED,
    content_md,
    tokenize = 'porter unicode61'
);

CREATE TRIGGER trg_messages_ai AFTER INSERT ON messages WHEN new.content_purged = 0 BEGIN
    INSERT INTO messages_fts(rowid, message_id, scope_key, content_md)
    VALUES (
        new.rowid,
        new.id,
        CASE WHEN new.channel_id IS NOT NULL THEN 'chn:' || new.channel_id ELSE 'dm:' || new.dm_id END,
        new.content_md
    );
END;

CREATE TRIGGER trg_messages_au AFTER UPDATE OF content_md, content_purged ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
    INSERT INTO messages_fts(rowid, message_id, scope_key, content_md)
    SELECT new.rowid,
           new.id,
           CASE WHEN new.channel_id IS NOT NULL THEN 'chn:' || new.channel_id ELSE 'dm:' || new.dm_id END,
           new.content_md
     WHERE new.content_purged = 0;
END;

-- 2.3 Worktree Lanes, PTY Sessions & Merge Queue (Fixing RT4-15.4..7, RT4-20, RT5-02, RT6-03 & RT7-05)
CREATE TABLE worktree_lanes (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'wkt_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    owner_agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    bound_run_id            TEXT REFERENCES runs(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    bound_task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    worktree_path           TEXT NOT NULL UNIQUE,
    branch_name             TEXT NOT NULL UNIQUE,
    base_commit_sha         TEXT NOT NULL,
    root_snapshot_ref       TEXT NOT NULL,
    head_commit_sha         TEXT NOT NULL,
    current_tree_sha        TEXT NOT NULL,
    last_verified_tree_sha  TEXT,
    verification_state      TEXT NOT NULL DEFAULT 'unverified'
                            CHECK (verification_state IN ('unverified','verified','unverified_no_gate','failed')),
    mutation_epoch          INTEGER NOT NULL DEFAULT 0 CHECK (mutation_epoch >= 0),
    tree_mutate_attempts    INTEGER NOT NULL DEFAULT 0 CHECK (tree_mutate_attempts BETWEEN 0 AND 3),
    gate_fail_attempts      INTEGER NOT NULL DEFAULT 0 CHECK (gate_fail_attempts BETWEEN 0 AND 3),
    write_frozen            INTEGER NOT NULL DEFAULT 0 CHECK (write_frozen IN (0,1)),
    cow_strategy            TEXT NOT NULL CHECK (cow_strategy IN ('apfs_clonefile','btrfs_xfs_reflink','refs_block_clone','env_redirect_copy')),
    status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','ready_for_review','queued_for_merge','verifying','merged','conflicted','discarded')),
    changed_files_count     INTEGER NOT NULL DEFAULT 0,
    insertions              INTEGER NOT NULL DEFAULT 0,
    deletions               INTEGER NOT NULL DEFAULT 0,
    created_at_us           INTEGER NOT NULL,
    updated_at_us           INTEGER NOT NULL,
    merged_at_us            INTEGER,
    CHECK (
        (verification_state = 'verified' AND last_verified_tree_sha IS NOT NULL) OR
        (verification_state = 'unverified_no_gate' AND last_verified_tree_sha IS NULL) OR
        (verification_state IN ('unverified','failed'))
    ),
    CHECK (updated_at_us >= created_at_us)
) STRICT;

-- Fixed RT6-03 & Cross-Doc Audit Finding 8:
-- (1) Terminal rows (old.status IN ('merged','discarded')) reject ALL updates (full terminal lane lock).
-- (2) Frozen rows (old.write_frozen = 1) reject any mutation to tree/commit/epoch/path fields irrespective of new.write_frozen,
--     preventing a single UPDATE from simultaneously setting write_frozen = 0 and mutating protected tree/epoch columns.
CREATE TRIGGER trg_worktree_lanes_freeze_and_terminal BEFORE UPDATE ON worktree_lanes
WHEN (old.status IN ('merged','discarded'))
  OR (old.write_frozen = 1 AND (
      old.current_tree_sha IS NOT new.current_tree_sha OR
      old.head_commit_sha IS NOT new.head_commit_sha OR
      old.changed_files_count IS NOT new.changed_files_count OR
      old.insertions IS NOT new.insertions OR
      old.deletions IS NOT new.deletions OR
      old.mutation_epoch IS NOT new.mutation_epoch OR
      old.worktree_path IS NOT new.worktree_path OR
      old.branch_name IS NOT new.branch_name OR
      old.base_commit_sha IS NOT new.base_commit_sha OR
      old.root_snapshot_ref IS NOT new.root_snapshot_ref
  ))
BEGIN
    SELECT RAISE(ABORT, 'KIN-WKT-0001: worktree_lanes cannot be mutated while write_frozen = 1 or after merged/discarded');
END;

CREATE TABLE pty_sessions (
    id                  TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'pty_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    lane_id             TEXT NOT NULL REFERENCES worktree_lanes(id) ON DELETE CASCADE,
    owner_run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    shell_cmd           TEXT NOT NULL,
    os_pid              INTEGER,
    status              TEXT NOT NULL CHECK (status IN ('running','quiescent','exited','killed')),
    exit_code           INTEGER,
    ring_blob_hash      TEXT,
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL,
    CHECK (updated_at_us >= created_at_us)
) STRICT;

CREATE TABLE ast_symbol_leases (
    file_rel_path       TEXT NOT NULL,
    symbol_fqn          TEXT NOT NULL,
    lane_id             TEXT NOT NULL REFERENCES worktree_lanes(id) ON DELETE CASCADE,
    agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    acquired_at_us      INTEGER NOT NULL,
    expires_at_us       INTEGER NOT NULL,
    PRIMARY KEY (file_rel_path, symbol_fqn),
    CHECK (expires_at_us > acquired_at_us)
) STRICT;

-- Fixed ST-21: Partial unique index idx_mqe_active_lane allows re-enqueuing a lane after gate_failed or conflict_blocked
CREATE TABLE merge_queue_entries (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'mqe_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    lane_id                 TEXT NOT NULL REFERENCES worktree_lanes(id) ON DELETE RESTRICT,
    attempt_no              INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
    submitted_by_agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    priority                INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
    status                  TEXT NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued','merging_tree','running_gates','applying_root','succeeded','conflict_blocked','gate_failed')),
    candidate_tree_sha      TEXT,
    conflict_report_json    TEXT CHECK (conflict_report_json IS NULL OR json_valid(conflict_report_json)),
    gate_output_blob_hash   TEXT,
    enqueued_at_us          INTEGER NOT NULL,
    completed_at_us         INTEGER,
    UNIQUE (lane_id, attempt_no),
    CHECK (completed_at_us IS NULL OR completed_at_us >= enqueued_at_us)
) STRICT;

CREATE UNIQUE INDEX idx_mqe_active_lane ON merge_queue_entries(lane_id)
WHERE status IN ('queued','merging_tree','running_gates','applying_root');

CREATE TABLE apply_journals (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'apj_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    merge_entry_id          TEXT NOT NULL REFERENCES merge_queue_entries(id) ON DELETE RESTRICT,
    pre_apply_root_snap_ref TEXT NOT NULL,
    post_apply_tree_sha     TEXT NOT NULL,
    operations_json         TEXT NOT NULL CHECK (json_valid(operations_json) AND json_type(operations_json) = 'object'), -- {created_dirs: [rel_dir], file_ops: [...]} (RT4-09, RT9-07f)
    state                   TEXT NOT NULL CHECK (state IN ('prepared','committing','committed','rolled_back','failed_needs_revert')),
    intent_ledger_seq       INTEGER NOT NULL,
    outcome_ledger_seq      INTEGER,
    failure_reason          TEXT,
    created_at_us           INTEGER NOT NULL,
    completed_at_us         INTEGER,
    CHECK (completed_at_us IS NULL OR completed_at_us >= created_at_us)
) STRICT;

-- Fixed RT7-05: Enforce valid two-phase state transitions and immutability of operations_json on apply_journals
CREATE TRIGGER trg_apply_journals_state_machine BEFORE UPDATE ON apply_journals
WHEN old.id IS NOT new.id
  OR old.merge_entry_id IS NOT new.merge_entry_id
  OR old.pre_apply_root_snap_ref IS NOT new.pre_apply_root_snap_ref
  OR old.post_apply_tree_sha IS NOT new.post_apply_tree_sha
  OR old.operations_json IS NOT new.operations_json
  OR old.intent_ledger_seq IS NOT new.intent_ledger_seq
  OR (old.state IN ('committed','rolled_back') AND new.state != old.state)
  OR (old.state = 'prepared' AND new.state NOT IN ('prepared','committing','rolled_back'))
  OR (old.state = 'committing' AND new.state NOT IN ('committing','committed','rolled_back','failed_needs_revert'))
  OR (old.state = 'failed_needs_revert' AND new.state NOT IN ('failed_needs_revert','rolled_back'))
BEGIN
    SELECT RAISE(ABORT, 'KIN-WKT-0003: invalid apply_journals state transition or immutable field mutation');
END;

-- 2.4 Goals, Cycle-Checked Fenced Task DAG & Schedules (Fixing RT4-14, RT4-15.8 & RT6-04)
CREATE TABLE goals (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'gol_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    parent_goal_id          TEXT REFERENCES goals(id) ON DELETE RESTRICT,
    title                   TEXT NOT NULL,
    description_md          TEXT NOT NULL,
    success_criteria_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(success_criteria_json) AND json_type(success_criteria_json) = 'array'),
    owner_agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('draft','active','paused','completed','cancelled','failed')),
    priority                INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
    budget_micro_usd_max    INTEGER NOT NULL DEFAULT 10000000 CHECK (budget_micro_usd_max > 0),
    budget_micro_usd_spent  INTEGER NOT NULL DEFAULT 0 CHECK (budget_micro_usd_spent >= 0),
    created_at_us           INTEGER NOT NULL,
    updated_at_us           INTEGER NOT NULL,
    completed_at_us         INTEGER,
    CHECK (updated_at_us >= created_at_us),
    CHECK (completed_at_us IS NULL OR completed_at_us >= created_at_us)
) STRICT;

CREATE TABLE tasks (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'tsk_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    goal_id                 TEXT REFERENCES goals(id) ON DELETE RESTRICT,
    parent_task_id          TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
    channel_id              TEXT REFERENCES channels(id) ON DELETE SET NULL,
    thread_id               TEXT REFERENCES threads(id) ON DELETE SET NULL,
    title                   TEXT NOT NULL,
    description_md          TEXT NOT NULL,
    acceptance_checks_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acceptance_checks_json) AND json_type(acceptance_checks_json) = 'array'),
    verification_mode       TEXT NOT NULL DEFAULT 'checks'
                            CHECK (verification_mode IN ('none','self_attested','checks','reviewer','human')),
    reviewer_agent_id       TEXT REFERENCES agents(id) ON DELETE SET NULL,
    assigned_agent_id       TEXT REFERENCES agents(id) ON DELETE SET NULL,
    lane_id                 TEXT REFERENCES worktree_lanes(id) ON DELETE SET NULL,
    status                  TEXT NOT NULL DEFAULT 'ready'
                            CHECK (status IN ('blocked','ready','leased','in_progress','in_review','done','failed','cancelled')),
    priority                INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
    lease_owner_run_id      TEXT REFERENCES runs(id) ON DELETE SET NULL,
    lease_epoch             INTEGER NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
    lease_expires_at_us     INTEGER,
    attempt_count           INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts            INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    tainted                 INTEGER NOT NULL DEFAULT 0 CHECK (tainted IN (0,1)),
    result_summary_md       TEXT,
    blocker_reason          TEXT,
    idempotency_key         TEXT UNIQUE,
    created_at_us           INTEGER NOT NULL,
    updated_at_us           INTEGER NOT NULL,
    completed_at_us         INTEGER,
    CHECK (updated_at_us >= created_at_us),
    CHECK (completed_at_us IS NULL OR completed_at_us >= created_at_us)
) STRICT;

-- Fixed RT6-04: Enforce monotonic lease_epoch on tasks (AUD-11)
CREATE TRIGGER trg_tasks_lease_epoch_monotonic BEFORE UPDATE ON tasks
WHEN new.lease_epoch < old.lease_epoch
BEGIN
    SELECT RAISE(ABORT, 'KIN-TSK-0004: tasks.lease_epoch is strictly monotonic');
END;

-- Fixed RT8-09 & RT9-07c: Enforce terminal task lock, valid transition to done, and unfinished dependency check
CREATE TRIGGER trg_tasks_state_machine_and_deps BEFORE UPDATE OF status ON tasks
WHEN (old.status IN ('done','failed','cancelled') AND new.status != old.status)
  OR (new.status = 'done' AND old.status NOT IN ('done','in_progress','in_review'))
  OR (new.status IN ('ready','leased','in_progress','in_review','done') AND EXISTS (
      SELECT 1
        FROM task_dependencies td
        JOIN tasks dep ON dep.id = td.depends_on_task_id
       WHERE td.task_id = new.id
         AND dep.status != 'done'
  ))
BEGIN
    SELECT CASE
        WHEN old.status IN ('done','failed','cancelled') AND new.status != old.status
            THEN RAISE(ABORT, 'KIN-TSK-0005: terminal tasks (done, failed, cancelled) cannot be reopened')
        WHEN new.status = 'done' AND old.status NOT IN ('done','in_progress','in_review')
            THEN RAISE(ABORT, 'KIN-TSK-0005: task must be in_progress or in_review before transitioning to done')
        ELSE RAISE(ABORT, 'KIN-TSK-0006: task cannot advance to ready/in_progress/done while a dependency in task_dependencies is not done')
    END;
END;

CREATE INDEX idx_tasks_status_priority ON tasks(status, priority DESC, created_at_us ASC);
CREATE INDEX idx_tasks_lease_expiry    ON tasks(lease_expires_at_us) WHERE status IN ('leased','in_progress');

CREATE TABLE task_dependencies (
    task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_task_id),
    CHECK (task_id != depends_on_task_id)
) STRICT;

-- Fixed ST-20: Recursive CTE trigger rejects arbitrary N-hop task dependency cycles inside SQLite
CREATE TRIGGER trg_task_deps_no_cycle BEFORE INSERT ON task_dependencies BEGIN
    SELECT RAISE(ABORT, 'KIN-TSK-0001: Task DAG cycle detected')
    WHERE EXISTS (
        WITH RECURSIVE reach(id) AS (
            SELECT new.depends_on_task_id
            UNION
            SELECT td.depends_on_task_id
              FROM task_dependencies td
              JOIN reach r ON td.task_id = r.id
        )
        SELECT 1 FROM reach WHERE id = new.task_id
    );
END;

-- Fixed RT4-14: Prevent cycle bypass via UPDATE on task_dependencies
CREATE TRIGGER trg_task_deps_no_update BEFORE UPDATE ON task_dependencies BEGIN
    SELECT RAISE(ABORT, 'KIN-TSK-0002: task_dependencies rows are immutable; delete and re-insert');
END;

-- Fixed RT9-07c: Prevent attaching an unfinished dependency to a non-blocked task
CREATE TRIGGER trg_task_deps_guard_on_insert BEFORE INSERT ON task_dependencies
WHEN EXISTS (SELECT 1 FROM tasks d WHERE d.id = new.depends_on_task_id AND d.status != 'done')
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = new.task_id AND t.status != 'blocked')
BEGIN
    SELECT RAISE(ABORT, 'KIN-TSK-0006: dependent task must have status = blocked when adding an unfinished dependency');
END;

CREATE TABLE schedules (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'sch_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    name                    TEXT NOT NULL,
    trigger_kind            TEXT NOT NULL CHECK (trigger_kind IN ('cron','interval','event')),
    cron_expr               TEXT,
    timezone_iana           TEXT NOT NULL DEFAULT 'UTC',
    interval_seconds        INTEGER CHECK (interval_seconds IS NULL OR interval_seconds >= 60),
    event_filter_json       TEXT CHECK (event_filter_json IS NULL OR json_valid(event_filter_json)),
    target_agent_id         TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    target_channel_id       TEXT NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    action_template_json    TEXT NOT NULL CHECK (json_valid(action_template_json) AND json_type(action_template_json) = 'object'),
    misfire_policy          TEXT NOT NULL DEFAULT 'run_once_on_wake'
                            CHECK (misfire_policy IN ('skip','run_once_on_wake','catch_up_all')),
    overlap_policy          TEXT NOT NULL DEFAULT 'coalesce'
                            CHECK (overlap_policy IN ('skip','coalesce','queue_one')),
    enabled                 INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    consecutive_failures    INTEGER NOT NULL DEFAULT 0,
    max_failures_circuit    INTEGER NOT NULL DEFAULT 3,
    last_tick_at_us         INTEGER,
    next_tick_at_us         INTEGER,
    created_at_us           INTEGER NOT NULL,
    updated_at_us           INTEGER NOT NULL,
    CHECK (updated_at_us >= created_at_us)
) STRICT;

-- 2.5 Durable Wake Queue, INV-007 Enforced Runs, Append-Only Steps & Tool Calls (Fixing RT4-10, RT4-11, RT6-05, RT7-04, RT7-06)
CREATE TABLE wake_queue (
    id                  TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'wak_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    context_key         TEXT NOT NULL,
    trigger_kind        TEXT NOT NULL CHECK (trigger_kind IN (
                        'explicit_mention','router_stage2','router_stage3','sticky_thread',
                        'dm_message','task_ready','meeting_turn','schedule_tick','review_feedback','human_resume','subagent_fanout')),
    source_message_id   TEXT REFERENCES messages(id) ON DELETE RESTRICT,
    source_task_id      TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
    priority            INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
    hop_depth           INTEGER NOT NULL DEFAULT 0 CHECK (hop_depth BETWEEN 0 AND 10),
    tainted             INTEGER NOT NULL DEFAULT 0 CHECK (tainted IN (0,1)),
    coalesce_count      INTEGER NOT NULL DEFAULT 1 CHECK (coalesce_count >= 1),
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','claimed','completed','coalesced','dropped')),
    dedup_key           TEXT UNIQUE,
    enqueued_at_us      INTEGER NOT NULL,
    claimed_at_us       INTEGER,
    CHECK ((status = 'queued' AND claimed_at_us IS NULL) OR (status != 'queued' AND (claimed_at_us IS NULL OR claimed_at_us >= enqueued_at_us)))
) STRICT;

CREATE INDEX idx_wake_queue_agent_status ON wake_queue(agent_id, status, priority DESC, enqueued_at_us ASC);

-- Fixed ST-20: Enforces max_steps BETWEEN 1 AND 200, step_count <= max_steps, has_private_context default 0, and INV-007 unique active run index
CREATE TABLE runs (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'run_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    agent_id                TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    parent_run_id           TEXT REFERENCES runs(id) ON DELETE RESTRICT,
    wake_id                 TEXT REFERENCES wake_queue(id) ON DELETE SET NULL,
    context_key             TEXT NOT NULL,
    channel_id              TEXT REFERENCES channels(id) ON DELETE RESTRICT,
    thread_id               TEXT REFERENCES threads(id) ON DELETE RESTRICT,
    dm_id                   TEXT REFERENCES dm_conversations(id) ON DELETE RESTRICT,
    task_id                 TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
    lane_id                 TEXT REFERENCES worktree_lanes(id) ON DELETE RESTRICT,
    status                  TEXT NOT NULL CHECK (status IN (
                            'queued','preparing','streaming_model','evaluating_policy',
                            'waiting_approval','waiting_takeover','waiting_subagent','waiting_recovery',
                            'executing_tools','verifying_completion','compacting','completed','cancelled','failed','budget_exceeded')),
    autonomy_effective      TEXT NOT NULL CHECK (autonomy_effective IN ('READ_ONLY','WORKTREE_AUTO','AUTO','FULL_ACCESS')),
    sandbox_level           TEXT NOT NULL CHECK (sandbox_level IN ('S0','S1','S2','S3')),
    tainted                 INTEGER NOT NULL DEFAULT 0 CHECK (tainted IN (0,1)),
    has_private_context     INTEGER NOT NULL DEFAULT 0 CHECK (has_private_context IN (0,1)),
    memory_snapshot_seq     INTEGER NOT NULL DEFAULT 0 CHECK (memory_snapshot_seq >= 0),
    step_count              INTEGER NOT NULL DEFAULT 0,
    max_steps               INTEGER NOT NULL DEFAULT 40,
    input_tokens            INTEGER NOT NULL DEFAULT 0,
    output_tokens           INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens     INTEGER NOT NULL DEFAULT 0,
    cost_micro_usd          INTEGER NOT NULL DEFAULT 0,
    budget_micro_usd_max    INTEGER NOT NULL DEFAULT 2000000 CHECK (budget_micro_usd_max > 0),
    error_code              TEXT,
    error_message           TEXT,
    started_at_us           INTEGER NOT NULL,
    ended_at_us             INTEGER,
    CHECK (max_steps BETWEEN 1 AND 200 AND step_count >= 0 AND step_count <= max_steps),
    CHECK (ended_at_us IS NULL OR ended_at_us >= started_at_us),
    CHECK (
        (status IN ('completed','cancelled','failed','budget_exceeded') AND ended_at_us IS NOT NULL) OR
        (status NOT IN ('completed','cancelled','failed','budget_exceeded') AND ended_at_us IS NULL)
    )
) STRICT;

-- INV-007 Database Enforcement: At most 1 active foreground run per (agent_id, context_key) (Fixing ST-20)
-- Fixed RT6-05 & RT9-07d: Lock lineage/identity columns (id, agent_id, parent_run_id, wake_id, context_key, channel_id, thread_id, dm_id, task_id, started_at_us)
-- so a child run can NEVER be detached before tainting, and enforce monotonic taint, private_context, terminal status, step_count, token counters, and cost_micro_usd
CREATE TRIGGER trg_runs_monotonic_and_terminal BEFORE UPDATE ON runs
WHEN old.id IS NOT new.id
  OR old.agent_id IS NOT new.agent_id
  OR old.parent_run_id IS NOT new.parent_run_id
  OR old.wake_id IS NOT new.wake_id
  OR old.context_key IS NOT new.context_key
  OR old.channel_id IS NOT new.channel_id
  OR old.thread_id IS NOT new.thread_id
  OR old.dm_id IS NOT new.dm_id
  OR old.task_id IS NOT new.task_id
  OR old.started_at_us IS NOT new.started_at_us
  OR (old.tainted = 1 AND new.tainted = 0)
  OR (old.has_private_context = 1 AND new.has_private_context = 0)
  OR (old.status IN ('completed','cancelled','failed','budget_exceeded') AND new.status != old.status)
  OR (new.step_count < old.step_count)
  OR (new.input_tokens < old.input_tokens)
  OR (new.output_tokens < old.output_tokens)
  OR (new.cached_input_tokens < old.cached_input_tokens)
  OR (new.cost_micro_usd < old.cost_micro_usd)
BEGIN
    SELECT RAISE(ABORT, 'KIN-SEC-0013: runs lineage columns are immutable and tainted, has_private_context, terminal status, step_count, and cost_micro_usd are monotonic');
END;

CREATE UNIQUE INDEX idx_runs_single_active_per_agent_context
ON runs(agent_id, context_key)
WHERE status NOT IN ('completed','cancelled','failed','budget_exceeded');

-- Fixed RT7-06, RT8-03 & RT9-07a: 2-hop subagent cancellation cascade setting ended_at_us = MAX(new.ended_at_us, runs.started_at_us)
CREATE TRIGGER trg_runs_cancel_children_on_parent_abort AFTER UPDATE OF status ON runs
WHEN new.status IN ('cancelled','failed','budget_exceeded')
BEGIN
    UPDATE runs
       SET status = 'cancelled',
           error_code = COALESCE(error_code, 'KIN-HRN-0010'),
           error_message = COALESCE(error_message, 'Parent run terminated'),
           ended_at_us = COALESCE(ended_at_us, MAX(new.ended_at_us, runs.started_at_us))
     WHERE (parent_run_id = new.id OR parent_run_id IN (SELECT id FROM runs WHERE parent_run_id = new.id))
       AND status NOT IN ('completed','cancelled','failed','budget_exceeded');
END;

CREATE TRIGGER trg_dm_validate_refs BEFORE INSERT ON dm_conversations
WHEN (new.kind = 'agent_agent' AND NOT EXISTS (SELECT 1 FROM agents WHERE id = new.participant_a))
  OR (new.bound_task_id != '' AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = new.bound_task_id))
BEGIN
    SELECT RAISE(ABORT, 'KIN-COM-0001: invalid participant_a agent_id or bound_task_id in dm_conversations');
END;

CREATE TRIGGER trg_dm_validate_refs_update BEFORE UPDATE ON dm_conversations
WHEN (new.kind = 'agent_agent' AND NOT EXISTS (SELECT 1 FROM agents WHERE id = new.participant_a))
  OR (new.bound_task_id != '' AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = new.bound_task_id))
BEGIN
    SELECT RAISE(ABORT, 'KIN-COM-0001: invalid participant_a agent_id or bound_task_id in dm_conversations');
END;

CREATE TRIGGER trg_agents_restrict_dm_participant_a BEFORE DELETE ON agents
WHEN EXISTS (SELECT 1 FROM dm_conversations WHERE kind = 'agent_agent' AND participant_a = old.id)
BEGIN
    SELECT RAISE(ABORT, 'KIN-COM-0002: cannot delete agent referenced by dm_conversations.participant_a');
END;

CREATE TRIGGER trg_tasks_restrict_dm_bound_task BEFORE DELETE ON tasks
WHEN EXISTS (SELECT 1 FROM dm_conversations WHERE bound_task_id = old.id)
BEGIN
    SELECT RAISE(ABORT, 'KIN-COM-0003: cannot delete task referenced by dm_conversations.bound_task_id');
END;

CREATE TRIGGER trg_tasks_propagate_run_taint BEFORE INSERT ON tasks
WHEN new.lease_owner_run_id IS NOT NULL AND new.tainted = 0
  AND EXISTS (SELECT 1 FROM runs WHERE id = new.lease_owner_run_id AND tainted = 1)
BEGIN
    SELECT RAISE(ABORT, 'KIN-SEC-0014: task created/leased by a tainted run must set tainted = 1');
END;

CREATE TRIGGER trg_tasks_monotonic_taint BEFORE UPDATE ON tasks
WHEN (old.tainted = 1 AND new.tainted = 0)
  OR (new.lease_owner_run_id IS NOT NULL AND new.tainted = 0 AND EXISTS (SELECT 1 FROM runs WHERE id = new.lease_owner_run_id AND tainted = 1))
BEGIN
    SELECT RAISE(ABORT, 'KIN-SEC-0015: tasks.tainted is monotonic and propagates from tainted lease owner');
END;

-- End-to-End Taint Propagation Triggers (Fixing ST-14, RT4-11.1..3 & RT5-03)
CREATE TRIGGER trg_messages_propagate_run_taint BEFORE INSERT ON messages
WHEN new.run_id IS NOT NULL AND new.tainted = 0
  AND EXISTS (SELECT 1 FROM runs WHERE id = new.run_id AND tainted = 1)
BEGIN
    SELECT RAISE(ABORT, 'KIN-SEC-0010: message posted by a tainted run must set tainted = 1');
END;

CREATE TRIGGER trg_wake_propagate_source_taint BEFORE INSERT ON wake_queue
WHEN new.tainted = 0 AND (
    (new.source_message_id IS NOT NULL AND EXISTS (SELECT 1 FROM messages WHERE id = new.source_message_id AND tainted = 1)) OR
    (new.source_task_id IS NOT NULL AND EXISTS (SELECT 1 FROM tasks WHERE id = new.source_task_id AND tainted = 1))
)
BEGIN
    SELECT RAISE(ABORT, 'KIN-SEC-0011: wake triggered by a tainted message or task must set tainted = 1');
END;

-- Fixed RT4-11.2: Enforce wake_queue taint monotonicity on UPDATE / coalesce
CREATE TRIGGER trg_wake_monotonic_taint BEFORE UPDATE ON wake_queue
WHEN (old.tainted = 1 AND new.tainted = 0)
  OR (new.tainted = 0 AND (
      (new.source_message_id IS NOT NULL AND EXISTS (SELECT 1 FROM messages WHERE id = new.source_message_id AND tainted = 1)) OR
      (new.source_task_id IS NOT NULL AND EXISTS (SELECT 1 FROM tasks WHERE id = new.source_task_id AND tainted = 1))
  ))
BEGIN
    SELECT RAISE(ABORT, 'KIN-SEC-0016: wake_queue.tainted is monotonic and propagates on coalesce');
END;

CREATE TRIGGER trg_runs_propagate_wake_taint BEFORE INSERT ON runs
WHEN new.tainted = 0 AND (
    (new.wake_id IS NOT NULL AND EXISTS (SELECT 1 FROM wake_queue WHERE id = new.wake_id AND tainted = 1)) OR
    (new.parent_run_id IS NOT NULL AND EXISTS (SELECT 1 FROM runs WHERE id = new.parent_run_id AND tainted = 1)) OR
    (new.task_id IS NOT NULL AND EXISTS (SELECT 1 FROM tasks WHERE id = new.task_id AND tainted = 1))
)
BEGIN
    SELECT RAISE(ABORT, 'KIN-SEC-0012: run spawned from a tainted wake, parent run, or task must set tainted = 1');
END;

-- Fixed RT4-11.1 & RT5-03: Propagate child subagent taint back to parent and grandparent runs (spawn_depth <= 2)
CREATE TRIGGER trg_runs_propagate_child_taint_to_parent AFTER UPDATE OF tainted ON runs
WHEN new.tainted = 1 AND new.parent_run_id IS NOT NULL
BEGIN
    UPDATE runs
       SET tainted = 1
     WHERE id IN (
           SELECT p1.id FROM runs p1 WHERE p1.id = new.parent_run_id
           UNION
           SELECT p2.parent_run_id FROM runs p2 WHERE p2.id = new.parent_run_id AND p2.parent_run_id IS NOT NULL
     )
       AND tainted = 0;
END;

CREATE TRIGGER trg_runs_propagate_child_taint_on_insert AFTER INSERT ON runs
WHEN new.tainted = 1 AND new.parent_run_id IS NOT NULL
BEGIN
    UPDATE runs
       SET tainted = 1
     WHERE id IN (
           SELECT p1.id FROM runs p1 WHERE p1.id = new.parent_run_id
           UNION
           SELECT p2.parent_run_id FROM runs p2 WHERE p2.id = new.parent_run_id AND p2.parent_run_id IS NOT NULL
     )
       AND tainted = 0;
END;

CREATE TABLE run_steps (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'stp_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    run_id                  TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    step_index              INTEGER NOT NULL CHECK (step_index >= 0),
    model_uid               TEXT NOT NULL,
    prompt_prefix_hash      TEXT NOT NULL,
    status                  TEXT NOT NULL CHECK (status IN ('streaming','tool_phase','completed','failed','aborted')),
    stop_reason             TEXT,
    assistant_parts_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assistant_parts_json) AND json_type(assistant_parts_json) = 'array'),
    content_purged          INTEGER NOT NULL DEFAULT 0 CHECK (content_purged IN (0,1)),
    input_tokens            INTEGER NOT NULL DEFAULT 0,
    output_tokens           INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens     INTEGER NOT NULL DEFAULT 0,
    cost_micro_usd          INTEGER NOT NULL DEFAULT 0,
    ttft_ms                 INTEGER,
    total_ms                INTEGER,
    started_at_us           INTEGER NOT NULL,
    ended_at_us             INTEGER,
    UNIQUE (run_id, step_index),
    CHECK (ended_at_us IS NULL OR ended_at_us >= started_at_us)
) STRICT;

CREATE TRIGGER trg_run_steps_no_delete BEFORE DELETE ON run_steps BEGIN
    SELECT RAISE(ABORT, 'KIN-HIS-0003: run_steps history is append-only');
END;

CREATE TRIGGER trg_run_steps_immutable BEFORE UPDATE ON run_steps
WHEN old.id IS NOT new.id
  OR old.run_id IS NOT new.run_id
  OR old.step_index IS NOT new.step_index
  OR old.model_uid IS NOT new.model_uid
  OR old.prompt_prefix_hash IS NOT new.prompt_prefix_hash
  OR old.started_at_us IS NOT new.started_at_us
  OR (old.content_purged = 1 AND new.content_purged = 0)
  OR (old.status IN ('completed','failed','aborted') AND new.content_purged = 0 AND old.assistant_parts_json IS NOT new.assistant_parts_json)
  OR (new.content_purged = 1 AND new.assistant_parts_json != '[]')
BEGIN
    SELECT RAISE(ABORT, 'KIN-HIS-0004: finalized run_steps are immutable except via privacy purge');
END;

CREATE TABLE tool_calls (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'tlc_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    run_id                  TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    step_id                 TEXT NOT NULL REFERENCES run_steps(id) ON DELETE RESTRICT,
    provider_call_id        TEXT NOT NULL,
    tool_name               TEXT NOT NULL,
    args_redacted_jcs_json  TEXT NOT NULL CHECK (json_valid(args_redacted_jcs_json) AND json_type(args_redacted_jcs_json) = 'object'),
    args_blake3             TEXT NOT NULL,
    mutability              TEXT NOT NULL CHECK (mutability IN ('read_only','idempotent_write','non_idempotent_write','external_side_effect')),
    risk_class              TEXT NOT NULL CHECK (risk_class IN ('R0','R1','R2','R3','R4','R5')),
    policy_decision         TEXT NOT NULL CHECK (policy_decision IN ('allow','allow_sandboxed','ask_human','deny_policy','deny_hard_stop')),
    policy_rule_id          TEXT NOT NULL,
    status                  TEXT NOT NULL CHECK (status IN (
                            'intent_logged','awaiting_approval','executing','succeeded','failed','denied',
                            'aborted_on_crash','interrupted_needs_reconcile')),
    intent_ledger_seq       INTEGER NOT NULL,
    outcome_ledger_seq      INTEGER,
    patch_tier_used         INTEGER CHECK (patch_tier_used IS NULL OR patch_tier_used BETWEEN 1 AND 4),
    lsp_errors_introduced   INTEGER NOT NULL DEFAULT 0,
    exit_code               INTEGER,
    result_preview_text     TEXT,
    spill_blob_hash         TEXT,
    spill_byte_len          INTEGER,
    content_purged          INTEGER NOT NULL DEFAULT 0 CHECK (content_purged IN (0,1)),
    duration_ms             INTEGER,
    started_at_us           INTEGER NOT NULL,
    ended_at_us             INTEGER,
    CHECK (ended_at_us IS NULL OR ended_at_us >= started_at_us)
) STRICT;

CREATE TRIGGER trg_tool_calls_no_delete BEFORE DELETE ON tool_calls BEGIN
    SELECT RAISE(ABORT, 'KIN-HIS-0005: tool_calls journal is append-only');
END;

CREATE TRIGGER trg_tool_calls_immutable BEFORE UPDATE ON tool_calls
WHEN old.id IS NOT new.id
  OR old.run_id IS NOT new.run_id
  OR old.step_id IS NOT new.step_id
  OR old.provider_call_id IS NOT new.provider_call_id
  OR old.tool_name IS NOT new.tool_name
  OR old.args_blake3 IS NOT new.args_blake3
  OR old.mutability IS NOT new.mutability
  OR old.risk_class IS NOT new.risk_class
  OR old.policy_decision IS NOT new.policy_decision
  OR old.policy_rule_id IS NOT new.policy_rule_id
  OR old.intent_ledger_seq IS NOT new.intent_ledger_seq
  OR old.started_at_us IS NOT new.started_at_us
  OR (old.content_purged = 1 AND new.content_purged = 0)
  OR (new.content_purged = 0 AND old.args_redacted_jcs_json IS NOT new.args_redacted_jcs_json)
  OR (new.content_purged = 1 AND (new.args_redacted_jcs_json != '{}' OR new.result_preview_text IS NOT NULL OR new.spill_blob_hash IS NOT NULL))
BEGIN
    SELECT RAISE(ABORT, 'KIN-HIS-0006: tool_calls intent fields are immutable except via privacy purge');
END;

-- Fixed RT4-10: FTS5 index over tool_calls for Tool 21 `recall` with privacy-purge sync triggers
CREATE VIRTUAL TABLE tool_calls_fts USING fts5(
    tool_call_id UNINDEXED,
    run_id UNINDEXED,
    tool_name,
    args_redacted_jcs_json,
    result_preview_text,
    tokenize = 'porter unicode61'
);

CREATE TRIGGER trg_tool_calls_ai AFTER INSERT ON tool_calls WHEN new.content_purged = 0 BEGIN
    INSERT INTO tool_calls_fts(rowid, tool_call_id, run_id, tool_name, args_redacted_jcs_json, result_preview_text)
    VALUES (new.rowid, new.id, new.run_id, new.tool_name, new.args_redacted_jcs_json, COALESCE(new.result_preview_text, ''));
END;

CREATE TRIGGER trg_tool_calls_au AFTER UPDATE OF result_preview_text, content_purged ON tool_calls BEGIN
    DELETE FROM tool_calls_fts WHERE rowid = old.rowid;
    INSERT INTO tool_calls_fts(rowid, tool_call_id, run_id, tool_name, args_redacted_jcs_json, result_preview_text)
    SELECT new.rowid, new.id, new.run_id, new.tool_name, new.args_redacted_jcs_json, COALESCE(new.result_preview_text, '')
     WHERE new.content_purged = 0;
END;

CREATE TABLE approval_requests (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'apr_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    run_id                  TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    tool_call_id            TEXT NOT NULL UNIQUE REFERENCES tool_calls(id) ON DELETE RESTRICT,
    agent_id                TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    risk_class              TEXT NOT NULL CHECK (risk_class IN ('R2','R3','R4')),
    reason_code             TEXT NOT NULL,
    summary_title           TEXT NOT NULL,
    canonical_action_json   TEXT NOT NULL CHECK (json_valid(canonical_action_json) AND json_type(canonical_action_json) = 'object'),
    diff_preview            TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved_once','approved_session','approved_rule','denied','expired')),
    resolved_by             TEXT,
    resolved_note           TEXT,
    created_at_us           INTEGER NOT NULL,
    expires_at_us           INTEGER NOT NULL,
    resolved_at_us          INTEGER,
    CHECK (expires_at_us > created_at_us AND (resolved_at_us IS NULL OR resolved_at_us >= created_at_us))
) STRICT;

-- Fixed RT7-04: Once an approval_request is resolved, its decision and action binding are strictly immutable
CREATE TRIGGER trg_approval_requests_immutable_once_resolved BEFORE UPDATE ON approval_requests
WHEN old.id IS NOT new.id
  OR old.run_id IS NOT new.run_id
  OR old.tool_call_id IS NOT new.tool_call_id
  OR old.agent_id IS NOT new.agent_id
  OR old.risk_class IS NOT new.risk_class
  OR old.canonical_action_json IS NOT new.canonical_action_json
  OR (old.status != 'pending' AND new.status != old.status)
BEGIN
    SELECT RAISE(ABORT, 'KIN-POL-0010: approval_requests action fields and resolved status are immutable');
END;

-- 2.6 Active Prompt Projection & Compaction History (INV-014)
CREATE TABLE context_items (
    id                  TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'cxi_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    context_key         TEXT NOT NULL,
    seq_order           INTEGER NOT NULL,
    item_kind           TEXT NOT NULL CHECK (item_kind IN ('message_ref','tool_turn_ref','compaction_summary','masked_observation')),
    message_id          TEXT REFERENCES messages(id) ON DELETE RESTRICT,
    run_step_id         TEXT REFERENCES run_steps(id) ON DELETE RESTRICT,
    summary_markdown    TEXT,
    archived_range_json TEXT CHECK (archived_range_json IS NULL OR (json_valid(archived_range_json) AND json_type(archived_range_json) = 'array')),
    token_count         INTEGER NOT NULL CHECK (token_count >= 0),
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at_us       INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_context_items_active ON context_items(context_key, is_active, seq_order ASC);

-- 2.7 4-Tier x 4-Bank Memory + Same-Scope Bi-Temporal Knowledge Graph (Fixing RT4-11.4, RT4-26 & RT5-04)
CREATE TABLE memory_items (
    id                  TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'mem_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    tier                TEXT NOT NULL CHECK (tier IN ('T1','T2','T3','T4')),
    scope_id            TEXT NOT NULL,
    bank                TEXT NOT NULL CHECK (bank IN ('world','experience','opinion','procedure')),
    heat_tier           TEXT NOT NULL DEFAULT 'warm_indexed'
                        CHECK (heat_tier IN ('hot_pinned','warm_indexed','cold_archive')),
    subject_key         TEXT NOT NULL,
    claim_text          TEXT NOT NULL,
    trigger_globs_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(trigger_globs_json) AND json_type(trigger_globs_json) = 'array'),
    confidence          REAL NOT NULL DEFAULT 0.85 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    importance          REAL NOT NULL DEFAULT 0.50 CHECK (importance >= 0.0 AND importance <= 1.0),
    utility_ema         REAL NOT NULL DEFAULT 0.50 CHECK (utility_ema >= 0.0 AND utility_ema <= 1.0),
    injected_count      INTEGER NOT NULL DEFAULT 0 CHECK (injected_count >= 0),
    helpful_count       INTEGER NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','pending_review','quarantined','superseded','archived','rejected')),
    trust               TEXT NOT NULL DEFAULT 'agent'
                        CHECK (trust IN ('system','human','agent','untrusted')),
    provenance_json     TEXT NOT NULL CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
    supersedes_id       TEXT REFERENCES memory_items(id) ON DELETE SET NULL,
    superseded_by_id    TEXT REFERENCES memory_items(id) ON DELETE SET NULL,
    valid_from_us       INTEGER NOT NULL,
    valid_to_us         INTEGER,
    recorded_at_us      INTEGER NOT NULL,
    superseded_at_us    INTEGER,
    access_count        INTEGER NOT NULL DEFAULT 0,
    last_accessed_at_us INTEGER,
    embedding_f32       BLOB CHECK (embedding_f32 IS NULL OR length(embedding_f32) IN (1536, 3072, 6144)),
    content_blake3      TEXT NOT NULL,
    created_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    created_by_run_id   TEXT REFERENCES runs(id) ON DELETE SET NULL,
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL,
    UNIQUE (id, tier, scope_id),
    CHECK (
        (tier = 'T1' AND scope_id = 'project') OR
        (tier = 'T2' AND (length(scope_id) = 30 AND scope_id GLOB 'chn_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')) OR
        (tier = 'T3' AND (length(scope_id) = 30 AND scope_id GLOB 'agt_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')) OR
        (tier = 'T4' AND (length(scope_id) = 30 AND scope_id GLOB 'dmc_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]'))
    ),
    CHECK (updated_at_us >= created_at_us AND (valid_to_us IS NULL OR valid_to_us >= valid_from_us) AND (superseded_at_us IS NULL OR superseded_at_us >= recorded_at_us))
) STRICT;

-- Fixed RT4-11.4 & RT5-04: Enforce quarantine on T1/T2 and untrusted on T3/T4 when written by a tainted run
CREATE TRIGGER trg_memory_enforce_taint_quarantine_insert BEFORE INSERT ON memory_items
WHEN (new.created_by_agent_id IS NOT NULL AND new.created_by_run_id IS NULL)
  OR (new.created_by_run_id IS NOT NULL AND EXISTS (SELECT 1 FROM runs WHERE id = new.created_by_run_id AND tainted = 1)
      AND (
          (new.tier IN ('T1','T2') AND (new.status != 'quarantined' OR new.trust != 'untrusted')) OR
          (new.tier IN ('T3','T4') AND new.trust != 'untrusted')
      ))
BEGIN
    SELECT RAISE(ABORT, 'KIN-SEC-0017: agent memory writes require created_by_run_id and tainted runs must write quarantined/untrusted memories');
END;

CREATE TRIGGER trg_memory_enforce_taint_quarantine_update BEFORE UPDATE ON memory_items
WHEN (old.status = 'quarantined' AND new.status = 'active' AND new.trust != 'human')
  OR (old.trust = 'untrusted' AND new.trust != 'untrusted' AND new.trust != 'human')
BEGIN
    SELECT RAISE(ABORT, 'KIN-SEC-0018: quarantined or untrusted memory items can only be promoted to active by human approval');
END;

CREATE INDEX idx_memory_scope_status ON memory_items(tier, scope_id, status, heat_tier);
CREATE INDEX idx_memory_subject      ON memory_items(tier, scope_id, subject_key) WHERE status = 'active';

CREATE TABLE memory_entities (
    id                  TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'ent_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    tier                TEXT NOT NULL CHECK (tier IN ('T1','T2','T3','T4')),
    scope_id            TEXT NOT NULL,
    canonical_name      TEXT NOT NULL,
    entity_kind         TEXT NOT NULL CHECK (entity_kind IN ('component','file','symbol','api_contract','decision','incident','person','external_system')),
    summary_text        TEXT NOT NULL DEFAULT '',
    valid_from_us       INTEGER NOT NULL,
    valid_to_us         INTEGER,
    recorded_at_us      INTEGER NOT NULL,
    superseded_at_us    INTEGER,
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL,
    UNIQUE (id, tier, scope_id),
    UNIQUE (tier, scope_id, canonical_name),
    CHECK (updated_at_us >= created_at_us AND (valid_to_us IS NULL OR valid_to_us >= valid_from_us) AND (superseded_at_us IS NULL OR superseded_at_us >= recorded_at_us))
) STRICT;

CREATE TABLE memory_edges (
    id                  TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'edg_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    tier                TEXT NOT NULL CHECK (tier IN ('T1','T2','T3','T4')),
    scope_id            TEXT NOT NULL,
    from_entity_id      TEXT NOT NULL,
    to_entity_id        TEXT NOT NULL,
    relation_kind       TEXT NOT NULL CHECK (relation_kind IN (
                        'depends_on','implements','calls','mutates','caused_by','resolved_by','contradicts','supersedes','owned_by')),
    evidence_memory_id  TEXT NOT NULL,
    weight              REAL NOT NULL DEFAULT 1.0 CHECK (weight > 0.0),
    valid_from_us       INTEGER NOT NULL,
    valid_to_us         INTEGER,
    recorded_at_us      INTEGER NOT NULL,
    superseded_at_us    INTEGER,
    created_at_us       INTEGER NOT NULL,
    FOREIGN KEY (from_entity_id, tier, scope_id)     REFERENCES memory_entities(id, tier, scope_id) ON DELETE CASCADE,
    FOREIGN KEY (to_entity_id, tier, scope_id)       REFERENCES memory_entities(id, tier, scope_id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_memory_id, tier, scope_id) REFERENCES memory_items(id, tier, scope_id)    ON DELETE CASCADE,
    CHECK ((valid_to_us IS NULL OR valid_to_us >= valid_from_us) AND (superseded_at_us IS NULL OR superseded_at_us >= recorded_at_us))
) STRICT;

CREATE INDEX idx_memory_edges_from ON memory_edges(tier, scope_id, from_entity_id) WHERE valid_to_us IS NULL AND superseded_at_us IS NULL;
CREATE INDEX idx_memory_edges_to   ON memory_edges(tier, scope_id, to_entity_id)   WHERE valid_to_us IS NULL AND superseded_at_us IS NULL;

CREATE VIRTUAL TABLE memory_fts USING fts5(
    memory_id UNINDEXED,
    tier UNINDEXED,
    scope_id UNINDEXED,
    subject_key,
    claim_text,
    tokenize = 'porter unicode61'
);

CREATE TRIGGER trg_memory_ai AFTER INSERT ON memory_items WHEN new.status = 'active' BEGIN
    INSERT INTO memory_fts(rowid, memory_id, tier, scope_id, subject_key, claim_text)
    VALUES (new.rowid, new.id, new.tier, new.scope_id, new.subject_key, new.claim_text);
END;

CREATE TRIGGER trg_memory_ad AFTER DELETE ON memory_items BEGIN
    DELETE FROM memory_fts WHERE rowid = old.rowid;
END;

-- Fixed ST-22: Fires ONLY when indexed text/status columns change (never on access_count++ or utility_ema updates!)
CREATE TRIGGER trg_memory_au AFTER UPDATE OF status, subject_key, claim_text, tier, scope_id ON memory_items BEGIN
    DELETE FROM memory_fts WHERE rowid = old.rowid;
    INSERT INTO memory_fts(rowid, memory_id, tier, scope_id, subject_key, claim_text)
    SELECT new.rowid, new.id, new.tier, new.scope_id, new.subject_key, new.claim_text
    WHERE new.status = 'active';
END;

-- 2.8 Two-Level Tamper-Evident Cryptographic Audit Ledger (Fixing RT4-12 & RT5-05)
CREATE TABLE ledger_events (
    seq                 INTEGER PRIMARY KEY,
    id                  TEXT NOT NULL UNIQUE CHECK ((length(id) = 30 AND id GLOB 'ldg_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    ts_us               INTEGER NOT NULL,
    event_kind          TEXT NOT NULL,
    actor_kind          TEXT NOT NULL CHECK (actor_kind IN ('human','agent','system','scheduler')),
    actor_id            TEXT NOT NULL,
    run_id              TEXT,
    tool_call_id        TEXT,
    risk_class          TEXT CHECK (risk_class IS NULL OR risk_class IN ('R0','R1','R2','R3','R4','R5')),
    decision            TEXT,
    payload_blake3      TEXT NOT NULL,
    payload_purged      INTEGER NOT NULL DEFAULT 0 CHECK (payload_purged IN (0,1)),
    prev_event_blake3   TEXT NOT NULL,
    event_blake3        TEXT NOT NULL UNIQUE
) STRICT;

-- Fixed RT5-05: Enforce gapless seq and prev_event_blake3 hash-chain continuity at INSERT time
CREATE TRIGGER trg_ledger_enforce_chain BEFORE INSERT ON ledger_events
WHEN (new.seq = 0 AND (EXISTS (SELECT 1 FROM ledger_events) OR new.prev_event_blake3 != '0000000000000000000000000000000000000000000000000000000000000000'))
  OR (new.seq > 0 AND NOT EXISTS (SELECT 1 FROM ledger_events WHERE seq = new.seq - 1 AND event_blake3 = new.prev_event_blake3))
  OR (new.seq < 0)
BEGIN
    SELECT RAISE(ABORT, 'KIN-LDG-0006: ledger_events seq must be contiguous starting at 0 and prev_event_blake3 must match prior event_blake3');
END;

CREATE TABLE ledger_payloads (
    seq                 INTEGER PRIMARY KEY REFERENCES ledger_events(seq) ON DELETE RESTRICT,
    payload_jcs_json    TEXT NOT NULL CHECK (json_valid(payload_jcs_json) AND json_type(payload_jcs_json) = 'object')
) STRICT;

CREATE TABLE ledger_checkpoints (
    checkpoint_seq      INTEGER PRIMARY KEY REFERENCES ledger_events(seq) ON DELETE RESTRICT,
    event_blake3        TEXT NOT NULL,
    ed25519_pubkey_hex  TEXT NOT NULL,
    ed25519_sig_hex     TEXT NOT NULL,
    signed_at_us        INTEGER NOT NULL
) STRICT;

CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON ledger_events BEGIN
    SELECT RAISE(ABORT, 'KIN-LDG-0001: ledger_events is strictly append-only');
END;

CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON ledger_events
WHEN old.seq IS NOT new.seq
  OR old.id IS NOT new.id
  OR old.ts_us IS NOT new.ts_us
  OR old.event_kind IS NOT new.event_kind
  OR old.actor_kind IS NOT new.actor_kind
  OR old.actor_id IS NOT new.actor_id
  OR old.run_id IS NOT new.run_id
  OR old.tool_call_id IS NOT new.tool_call_id
  OR old.risk_class IS NOT new.risk_class
  OR old.decision IS NOT new.decision
  OR old.payload_blake3 IS NOT new.payload_blake3
  OR old.prev_event_blake3 IS NOT new.prev_event_blake3
  OR old.event_blake3 IS NOT new.event_blake3
  OR (old.payload_purged = 1 AND new.payload_purged = 0)
  OR (old.payload_purged = 0 AND new.payload_purged = 1 AND EXISTS (SELECT 1 FROM ledger_payloads WHERE seq = new.seq))
BEGIN
    SELECT RAISE(ABORT, 'KIN-LDG-0002: ledger_events envelope fields are strictly immutable');
END;

CREATE TRIGGER trg_ledger_payloads_no_update BEFORE UPDATE ON ledger_payloads BEGIN
    SELECT RAISE(ABORT, 'KIN-LDG-0003: ledger_payloads content is strictly immutable');
END;

-- Fixed RT9-14: Require a hash-chained privacy.purge.receipt event in ledger_events before deleting any ledger_payloads row
CREATE TRIGGER trg_ledger_payloads_require_receipt BEFORE DELETE ON ledger_payloads
WHEN NOT EXISTS (
    SELECT 1
      FROM ledger_events le
      JOIN ledger_payloads lp ON lp.seq = le.seq
     WHERE le.event_kind = 'privacy.purge.receipt'
       AND le.seq > old.seq
       AND json_extract(lp.payload_jcs_json, '$.purged_seq') = old.seq
       AND json_extract(lp.payload_jcs_json, '$.entity_id') IS NOT NULL
       AND json_extract(lp.payload_jcs_json, '$.reason') IS NOT NULL
       AND json_extract(lp.payload_jcs_json, '$.ed25519_sig_hex') IS NOT NULL
)
BEGIN
    SELECT RAISE(ABORT, 'KIN-LDG-0007: cannot delete ledger_payloads row without a prior signed privacy.purge.receipt ledger event');
END;

-- Fixed RT4-12: Automatically synchronize ledger_events.payload_purged = 1 whenever a ledger_payloads row is deleted
CREATE TRIGGER trg_ledger_payloads_sync_purge AFTER DELETE ON ledger_payloads BEGIN
    UPDATE ledger_events SET payload_purged = 1 WHERE seq = old.seq;
END;

CREATE TRIGGER trg_ledger_checkpoints_immutable BEFORE UPDATE ON ledger_checkpoints BEGIN
    SELECT RAISE(ABORT, 'KIN-LDG-0004: ledger_checkpoints are immutable');
END;

CREATE TRIGGER trg_ledger_checkpoints_no_delete BEFORE DELETE ON ledger_checkpoints BEGIN
    SELECT RAISE(ABORT, 'KIN-LDG-0005: ledger_checkpoints are append-only');
END;

-- 2.9 Durable Monotonic Project Event Stream with One-Way Privacy Purge (Fixing ST-24)
CREATE TABLE project_events (
    seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
    id                  TEXT NOT NULL UNIQUE CHECK ((length(id) = 30 AND id GLOB 'evt_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    ts_us               INTEGER NOT NULL,
    event_kind          TEXT NOT NULL,
    entity_id           TEXT NOT NULL,
    payload_json        TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
    payload_purged      INTEGER NOT NULL DEFAULT 0 CHECK (payload_purged IN (0,1))
) STRICT;

CREATE TRIGGER trg_project_events_immutable BEFORE UPDATE ON project_events
WHEN old.seq IS NOT new.seq
  OR old.id IS NOT new.id
  OR old.ts_us IS NOT new.ts_us
  OR old.event_kind IS NOT new.event_kind
  OR old.entity_id IS NOT new.entity_id
  OR (old.payload_purged = 1 AND new.payload_purged = 0)
  OR (new.payload_purged = 0 AND old.payload_json IS NOT new.payload_json)
  OR (new.payload_purged = 1 AND new.payload_json != '{"purged":true}')
BEGIN
    SELECT RAISE(ABORT, 'KIN-EVT-0001: project_events stream is immutable except via one-way privacy purge');
END;

CREATE TRIGGER trg_project_events_no_delete BEFORE DELETE ON project_events BEGIN
    SELECT RAISE(ABORT, 'KIN-EVT-0002: project_events stream is append-only');
END;

-- 2.10 Content-Addressed Encrypted Blob & Spill Store Catalog (XChaCha20-Poly1305 AEAD)
CREATE TABLE blobs (
    blake3_hash         TEXT PRIMARY KEY CHECK (length(blake3_hash) = 64),
    byte_len            INTEGER NOT NULL CHECK (byte_len >= 0),
    compressed_len      INTEGER NOT NULL CHECK (compressed_len >= 0),
    chunk_count         INTEGER NOT NULL CHECK (chunk_count >= 1),
    mime_type           TEXT NOT NULL DEFAULT 'application/octet-stream',
    redaction_applied   INTEGER NOT NULL DEFAULT 1 CHECK (redaction_applied IN (0,1)),
    ref_count           INTEGER NOT NULL DEFAULT 1 CHECK (ref_count >= 0),
    created_at_us       INTEGER NOT NULL
) STRICT;

-- Fixed RT6-06: Prevent deleting blobs while ref_count > 0
CREATE TRIGGER trg_blobs_no_delete_while_referenced BEFORE DELETE ON blobs
WHEN old.ref_count > 0
BEGIN
    SELECT RAISE(ABORT, 'KIN-BLB-0001: cannot delete blob while ref_count > 0');
END;

-- Fixed RT6-07: Covering Foreign-Key & Hot-Lookup Indexes
CREATE INDEX idx_runs_parent_run ON runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
CREATE INDEX idx_runs_task_id ON runs(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_tool_calls_run_step ON tool_calls(run_id, step_id, started_at_us ASC);
CREATE INDEX idx_approval_requests_pending ON approval_requests(status, expires_at_us) WHERE status = 'pending';
CREATE INDEX idx_project_events_kind_entity ON project_events(event_kind, entity_id, seq DESC);
CREATE INDEX idx_schedules_enabled_next_tick ON schedules(enabled, next_tick_at_us ASC) WHERE enabled = 1;

-- 2.11 Engine Heartbeat for OS Sleep/Wake Detection
CREATE TABLE engine_heartbeat (
    singleton_id        INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    instance_ulid       TEXT NOT NULL,
    pid                 INTEGER NOT NULL,
    started_at_us       INTEGER NOT NULL,
    last_alive_at_us    INTEGER NOT NULL,
    CHECK (last_alive_at_us >= started_at_us)
) STRICT;

-- 2.12 MCP Integrations & Four-Category Extension Packages (Fixing RT10-04, RT10-05 & RT10-06)
CREATE TABLE mcp_integrations (
    id                      TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'mcp_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    slug                    TEXT NOT NULL UNIQUE,
    display_name            TEXT NOT NULL,
    preset_slug             TEXT NOT NULL DEFAULT 'custom'
                            CHECK (preset_slug IN ('custom','github','filesystem','browser','google_workspace','slack','discord','linear_jira','notion','trello','postgres')),
    transport               TEXT NOT NULL CHECK (transport IN ('stdio','streamable_http')),
    endpoint_or_cmd_json    TEXT NOT NULL CHECK (json_valid(endpoint_or_cmd_json) AND json_type(endpoint_or_cmd_json) = 'object'),
    protocol_version        TEXT NOT NULL DEFAULT '2026-07-28',
    auth_kind               TEXT NOT NULL DEFAULT 'none' CHECK (auth_kind IN ('none','secret_handle','oauth2_pkce')),
    secret_handle_ref       TEXT,
    access_mode             TEXT NOT NULL DEFAULT 'read_only' CHECK (access_mode IN ('read_only','write_enabled')),
    enabled                 INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
    trust_status            TEXT NOT NULL DEFAULT 'unverified'
                            CHECK (trust_status IN ('verified_schema','quarantined_schema_mismatch','unverified','revoked')),
    pinned_schema_sha256    TEXT CHECK (pinned_schema_sha256 IS NULL OR length(pinned_schema_sha256) = 64),
    discovered_tools_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(discovered_tools_json) AND json_type(discovered_tools_json) = 'array'),
    created_at_us           INTEGER NOT NULL,
    updated_at_us           INTEGER NOT NULL,
    CHECK (enabled = 0 OR trust_status = 'verified_schema'),
    CHECK ((auth_kind = 'secret_handle' AND secret_handle_ref IS NOT NULL) OR (auth_kind != 'secret_handle' AND secret_handle_ref IS NULL)),
    CHECK (updated_at_us >= created_at_us)
) STRICT;

CREATE TRIGGER trg_mcp_integrations_block_enable_if_quarantined BEFORE UPDATE ON mcp_integrations
WHEN new.enabled = 1 AND new.trust_status != 'verified_schema'
BEGIN
    SELECT RAISE(ABORT, 'KIN-EXT-0004: cannot enable MCP integration unless trust_status is verified_schema');
END;

CREATE TABLE extension_packages (
    id                          TEXT PRIMARY KEY CHECK ((length(id) = 30 AND id GLOB 'ext_[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
    category                    TEXT NOT NULL CHECK (category IN ('integration','plugin','skill','workflow_pack')),
    slug                        TEXT NOT NULL,
    version_semver              TEXT NOT NULL,
    display_name                TEXT NOT NULL,
    publisher_id                TEXT NOT NULL,
    publisher_verified          INTEGER NOT NULL DEFAULT 0 CHECK (publisher_verified IN (0,1)),
    min_kin_version             TEXT NOT NULL DEFAULT '10.0.0',
    package_blake3              TEXT NOT NULL CHECK (length(package_blake3) = 64),
    ed25519_sig_hex             TEXT,
    manifest_json               TEXT NOT NULL CHECK (json_valid(manifest_json) AND json_type(manifest_json) = 'object'),
    requested_capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(requested_capabilities_json) AND json_type(requested_capabilities_json) = 'array'),
    security_scan_status        TEXT NOT NULL DEFAULT 'pending' CHECK (security_scan_status IN ('passed','pending','flagged','revoked')),
    enabled                     INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
    installed_at_us             INTEGER NOT NULL,
    updated_at_us               INTEGER NOT NULL,
    revoked_at_us               INTEGER,
    UNIQUE (category, slug),
    CHECK (enabled = 0 OR (security_scan_status = 'passed' AND revoked_at_us IS NULL)),
    CHECK (updated_at_us >= installed_at_us AND (revoked_at_us IS NULL OR revoked_at_us >= installed_at_us))
) STRICT;

CREATE TRIGGER trg_extension_packages_block_enable_if_revoked_or_flagged BEFORE UPDATE ON extension_packages
WHEN new.enabled = 1 AND (new.security_scan_status != 'passed' OR new.revoked_at_us IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'KIN-EXT-0003: cannot enable extension package unless security_scan_status = passed and revoked_at_us IS NULL');
END;

-- =============================================================================
-- 3. REBUILDABLE CODE, CALL-GRAPH & PAGERANK INDEX DATABASE: $KIN_HOME/projects/<prj_id>/index.db
--    Encrypted via SQLCipher (AES-256-CBC + HMAC-SHA512) under PDK_prj (Fixing ST-15 & RT4-26)
-- =============================================================================
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA recursive_triggers = ON;
PRAGMA temp_store = MEMORY;

CREATE TABLE indexed_files (
    file_rel_path       TEXT PRIMARY KEY,
    content_blake3      TEXT NOT NULL,
    byte_len            INTEGER NOT NULL,
    language            TEXT NOT NULL,
    mtime_ns            INTEGER NOT NULL,
    indexed_at_us       INTEGER NOT NULL
) STRICT;

CREATE TABLE code_symbols (
    id                  TEXT PRIMARY KEY,
    file_rel_path       TEXT NOT NULL REFERENCES indexed_files(file_rel_path) ON DELETE CASCADE,
    symbol_name         TEXT NOT NULL,
    symbol_fqn          TEXT NOT NULL,
    kind                TEXT NOT NULL CHECK (kind IN ('function','method','struct','class','interface','enum','trait','type','const','module')),
    signature           TEXT NOT NULL,
    start_line          INTEGER NOT NULL,
    end_line            INTEGER NOT NULL,
    docstring           TEXT,
    pagerank_score      REAL NOT NULL DEFAULT 0.001,
    ast_blake3          TEXT NOT NULL,
    CHECK (start_line >= 1 AND end_line >= start_line)
) STRICT;

CREATE INDEX idx_symbols_name     ON code_symbols(symbol_name);
CREATE INDEX idx_symbols_file     ON code_symbols(file_rel_path, start_line);
CREATE INDEX idx_symbols_pagerank ON code_symbols(pagerank_score DESC);

CREATE TABLE symbol_edges (
    from_symbol_id      TEXT NOT NULL REFERENCES code_symbols(id) ON DELETE CASCADE,
    to_symbol_fqn       TEXT NOT NULL,
    to_symbol_id        TEXT REFERENCES code_symbols(id) ON DELETE SET NULL,
    edge_kind           TEXT NOT NULL CHECK (edge_kind IN ('calls','imports','implements','types')),
    call_line           INTEGER NOT NULL,
    PRIMARY KEY (from_symbol_id, to_symbol_fqn, edge_kind, call_line)
) STRICT;

CREATE INDEX idx_symbol_edges_to ON symbol_edges(to_symbol_id);

-- Fixed ST-16, ST-17 & RT4-26: Nullable embedding_f32 (384/768/1536 dims) for async embedding + full insert/delete/update FTS5 triggers
CREATE TABLE code_chunks (
    chunk_id            TEXT PRIMARY KEY,
    file_rel_path       TEXT NOT NULL REFERENCES indexed_files(file_rel_path) ON DELETE CASCADE,
    start_line          INTEGER NOT NULL,
    end_line            INTEGER NOT NULL,
    symbol_fqn          TEXT,
    chunk_text          TEXT NOT NULL,
    embedding_status    TEXT NOT NULL DEFAULT 'pending' CHECK (embedding_status IN ('pending','ready')),
    embedding_f32       BLOB CHECK (embedding_f32 IS NULL OR length(embedding_f32) IN (1536, 3072, 6144)),
    CHECK ((embedding_status = 'pending' AND embedding_f32 IS NULL) OR (embedding_status = 'ready' AND embedding_f32 IS NOT NULL)),
    CHECK (start_line >= 1 AND end_line >= start_line)
) STRICT;

CREATE VIRTUAL TABLE code_chunks_fts USING fts5(
    chunk_id UNINDEXED,
    file_rel_path,
    symbol_fqn,
    chunk_text,
    tokenize = 'unicode61 tokenchars ''_'''
);

CREATE TRIGGER trg_code_chunks_ai AFTER INSERT ON code_chunks BEGIN
    INSERT INTO code_chunks_fts(rowid, chunk_id, file_rel_path, symbol_fqn, chunk_text)
    VALUES (new.rowid, new.chunk_id, new.file_rel_path, COALESCE(new.symbol_fqn, ''), new.chunk_text);
END;

CREATE TRIGGER trg_code_chunks_ad AFTER DELETE ON code_chunks BEGIN
    DELETE FROM code_chunks_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER trg_code_chunks_au AFTER UPDATE OF file_rel_path, symbol_fqn, chunk_text ON code_chunks BEGIN
    DELETE FROM code_chunks_fts WHERE rowid = old.rowid;
    INSERT INTO code_chunks_fts(rowid, chunk_id, file_rel_path, symbol_fqn, chunk_text)
    VALUES (new.rowid, new.chunk_id, new.file_rel_path, COALESCE(new.symbol_fqn, ''), new.chunk_text);
END;

-- =============================================================================
-- 4. SQLITE-VEC (v0.1.6+) PARTITIONED VECTOR INDEX TABLES (Fixing ST-23 & RT4-26)
-- =============================================================================
-- On project.db: Partitioned by scope_key ('T1:project', 'T2:chn_...', 'T3:agt_...', 'T4:dmc_...')
-- so KNN queries on T3 or T4 NEVER scan another agent's or DM's vectors (INV-012):
CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
    memory_id TEXT PRIMARY KEY,
    scope_key TEXT PARTITION KEY,
    embedding float[384] distance_metric=cosine
);

-- Fixed RT9-13: Automatically remove/sync vectors in memory_vec when memory_items are deleted, superseded, archived, or quarantined
CREATE TRIGGER IF NOT EXISTS trg_memory_vec_ai AFTER INSERT ON memory_items
WHEN new.status = 'active' AND new.embedding_f32 IS NOT NULL AND length(new.embedding_f32) = 1536
BEGIN
    INSERT INTO memory_vec(memory_id, scope_key, embedding)
    VALUES (new.id, new.tier || ':' || new.scope_id, new.embedding_f32);
END;

CREATE TRIGGER IF NOT EXISTS trg_memory_vec_ad AFTER DELETE ON memory_items BEGIN
    DELETE FROM memory_vec WHERE memory_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_memory_vec_au AFTER UPDATE OF status, tier, scope_id, embedding_f32 ON memory_items BEGIN
    DELETE FROM memory_vec WHERE memory_id = old.id;
    INSERT INTO memory_vec(memory_id, scope_key, embedding)
    SELECT new.id, new.tier || ':' || new.scope_id, new.embedding_f32
     WHERE new.status = 'active' AND new.embedding_f32 IS NOT NULL AND length(new.embedding_f32) = 1536;
END;

-- On index.db (Matryoshka-truncated & L2-normalized to 384 dims when external model > 384 dims, RT4-26):
CREATE VIRTUAL TABLE IF NOT EXISTS code_chunks_vec USING vec0(
    chunk_id  TEXT PRIMARY KEY,
    embedding float[384] distance_metric=cosine
);

-- Fixed RT13-06: Automatically synchronize code_chunks_vec when code_chunks embeddings become ready, change, or are deleted
CREATE TRIGGER IF NOT EXISTS trg_code_chunks_vec_ai AFTER INSERT ON code_chunks
WHEN new.embedding_status = 'ready' AND new.embedding_f32 IS NOT NULL AND length(new.embedding_f32) = 1536
BEGIN
    INSERT INTO code_chunks_vec(chunk_id, embedding) VALUES (new.chunk_id, new.embedding_f32);
END;

CREATE TRIGGER IF NOT EXISTS trg_code_chunks_vec_ad AFTER DELETE ON code_chunks BEGIN
    DELETE FROM code_chunks_vec WHERE chunk_id = old.chunk_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_code_chunks_vec_au AFTER UPDATE OF embedding_status, embedding_f32 ON code_chunks BEGIN
    DELETE FROM code_chunks_vec WHERE chunk_id = old.chunk_id;
    INSERT INTO code_chunks_vec(chunk_id, embedding)
    SELECT new.chunk_id, new.embedding_f32
     WHERE new.embedding_status = 'ready' AND new.embedding_f32 IS NOT NULL AND length(new.embedding_f32) = 1536;
END;
```
