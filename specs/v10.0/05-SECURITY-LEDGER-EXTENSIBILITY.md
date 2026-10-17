# DOC-05: Security Architecture, 9-Stage Dual-AST Policy, OS Sandboxes, Cryptographic Ledger, 26-Tool Catalog & Extensibility

| Field | Value |
| :--- | :--- |
| **Document ID** | KIN-DOC-05 (`05-SECURITY-LEDGER-EXTENSIBILITY.md`) |
| **Suite Version** | `10.0.0-PRODUCTION` |
| **Status** | **Canonical Specification & Reference Contract Bundle** |
| **Scope** | `T-01`–`T-12` Threat Matrix, 9-Stage Dual-AST Policy with Intra-Batch Pre-Marking & Universal Literal-Secret Block (`ST-14`, `RT4-16`, `RT4-18`, `RT4-19`, `RT11-08`), Dual Sandbox Profiles & Full-Duplex `SCM_RIGHTS` Egress Bridge (`S2-Lane-Exec` & `S2-Root-Snapshot`, `RT4-01`–`RT4-06`, `RT7-01`), Per-Lane Authenticated `kin-egress`, Dynamic Approval Host Grant & SSRF Guard (`SEC-EGR-001..003`, `ST-36`, `RT4-17`, `RT9-06`, `RT9-09`, `RT11-04`, `RT12-07`), Ledger & Unified Signed Privacy Purge Receipt (`ST-24`, `RT4-12`, `RT9-14`, `RT12-09`), 26-Tool Catalog (`RT4-10`, `RT4-21`, `RT4-22`), MCP-First 6 Integration Domains, 4-Category Extension Taxonomy, 5-Step Marketplace & Hooks (`ST-26`, `RT9-21`, `RT10-02`–`RT10-07`), and Opt-In Signed Updater (`ST-33`, `RT9-22`) |

## 1. Twelve-Class Threat Matrix (`SEC-THR-001`)

| Threat ID | Attack Vector | Primary Deterministic Control | Secondary Control |
| :--- | :--- | :--- | :--- |
| **T-01: Indirect Prompt Injection & Intra-Batch Exfiltration** | Hostile webpage/README instructs agent to emit `[fs_read, web_fetch]` in one batch to exfiltrate code | **Batch Pre-Tainting & Batch Private-Context Pre-Marking (`RT4-16`) + Lethal-Trifecta Guard (`SEC-INJ-002`)** | DNS-pinned & redirect-validated `kin-egress` allowlist (`RT4-17`) |
| **T-02: Symlink / TOCTOU Workspace Escape** | Swapping a directory inside `wkt_` with a symlink to `~/.ssh` mid-write | **Handle-relative `cap-std::fs::Dir` (`O_NOFOLLOW`)** + no `<root_path>` mount in `S2-Lane-Exec` (`ST-07`, `RT4-06`) | OS Sandbox write jail |
| **T-03: Shell & PTY Obfuscation (`ST-14`)** | `eval $(...)`, process substitution `<(...)`, or sending shell commands via `pty_write` | **Tree-sitter Bash AST Classifier (`SEC-POL-004`) on both `shell_exec` AND `pty_write`** | Scrubbed environment block (`SEC-ENV-001`, `RT4-04`, `RT6-08`) + `kin-sandbox` |
| **T-04: Hostile Git Repo Config/Filter RCE (`ST-09`–`ST-12`, `RT4-06`)** | Malicious `.git/config` `fsmonitor` or `.gitattributes` `filter=evil` | **Self-contained `repo.git` + `GIT_CONFIG_GLOBAL=/dev/null` + `-c attr.tree=$SANITIZED_ATTR_TREE` + tracked `.env*` & `.kinignore` stripping (`RT4-07`, `RT6-02`)** | `S2-Root-Snapshot` (zero network) & `S2-Lane-Exec` sandboxes |
| **T-05: Secret Leak, File Corruption or Redaction Bypass (`ST-14`, `RT4-18`)** | Literal secret in tool args persisted to DB or written as `[REDACTED_SECRET]` into source files by `fs_write`/`fs_patch` | **Universal Stage-1 Literal-Secret Block (`KIN-POL-0009` on ALL tools, `RT4-18`) + Dual-AST Policy + Normalized Secret Handles (`$KIN_SECRET_*` / `KIN_SECRET_*`, `RT4-19`)** | Pre-persistence `SecretRedactor` |
| **T-06: Cross-Scope Memory & Vector Leak (`ST-23`)** | KNN query on T3 returning another agent's private embeddings | **`memory_vec` partitioned by `scope_key` (`<tier>:<scope_id>`) + composite FKs on `memory_edges`** | Per-project isolated `project.db` |
| **T-07: Cross-Agent & Subagent Taint Laundering (`ST-14`, `RT4-11`)** | Tainted subagent returning summary to untainted parent, or tainted message coalescing into queued wake | **SQLite triggers `trg_runs_propagate_child_taint_to_parent`, `trg_wake_monotonic_taint`, `trg_messages_propagate_run_taint`, `trg_memory_enforce_taint_quarantine_insert`** | `<untrusted_content>` wrapping on tainted subagent artifacts |
| **T-08: Malicious / Rug-Pull MCP Server** | MCP server mutating tool schemas after approval | **SHA-256 JCS Tool Schema Pinning (`EXT-MCP-004`)** in `kin.toml` | Sandboxed `stdio` spawn + R2 risk floor |
| **T-09: Audit Ledger or History Tampering (`RT4-12`, `RT5-05`)** | Mutating `ledger_events`, deleting `ledger_payloads` without marking `payload_purged`, or breaking `prev_event_blake3` chain | **Full-Row Null-Safe `IS NOT` Triggers + `trg_ledger_enforce_chain` + `trg_ledger_payloads_sync_purge` + `trg_approval_requests_immutable_once_resolved`** | BLAKE3 chain + Ed25519 checkpoints |
| **T-10: Post-Shred Recovery of DB or Code Index (`ST-15`)** | Recovering `project.db` or `index.db` chunks after project deletion | **`PMK_prj` stored only in OS Keychain; both `project.db` AND `index.db` SQLCipher-encrypted under `PDK_prj`** | XChaCha20-Poly1305 `blobs/` |
| **T-11: Rogue Local IPC Server or Client (`ST-15`)** | Local process connecting to `e.sock` or squatting on `e.sock` | **Mutual 3-Step HMAC Handshake (`client_hmac` + `server_hmac`) + `0700` `$KIN_RUN_DIR/e.sock`** | `SO_PEERCRED` / Windows SID DACL |
| **T-12: DNS Rebinding, IPv6 `[::]` / NAT64 & HTTP Redirect SSRF (`ST-36`, `RT4-17`)** | Connecting to `[::]:port`, `64:ff9b::/96`, or 302 redirecting from an allowlisted host to `127.0.0.1` | **`KinDnsResolver` rejects `is_ssrf_forbidden_ip(ip)` / `!is_publicly_routable_ip(ip)` (`::/128`, `64:ff9b::/96`, `198.18.0.0/15`, `ff00::/8`), pins IP, and `reqwest::redirect::Policy::custom` re-verifies scheme, allowlist, and DNS-pinned IPs on every redirect hop** | Restricted Seatbelt/Linux loopback egress port (`RT4-01`, `RT4-03`, `RT7-01`) |

## 2. The 9-Stage Dual-AST Prose-Blind Policy Pipeline (`SEC-POL-001..006`, Fixing `ST-14`, `RT4-16`, `RT4-18` & `RT4-19`)

### 2.0 Batch Pre-Marking of `tainted` AND `has_private_context` (`SEC-POL-000`, Fixing `RT4-16`)

Before evaluating Stages 1–9 on **any** individual tool call in a model step batch (`runs.status == 'evaluating_policy'`), `kin-harness` inspects the entire proposed batch `calls: &[ProposedToolCall]`:

- `batch_will_taint = calls.iter().any(|c| matches!(c.name.as_str(), "web_search" | "web_fetch" | "browser_act") || c.is_untrusted_mcp())` (where `c.is_untrusted_mcp()` is `true` for any tool call targeting an external `mcp_integrations` server with `preset_slug != 'filesystem'`, since external MCP responses are wrapped in `<untrusted_content>`, `INV-010`, `RT11-08`)
- `batch_will_read_private_context = calls.iter().any(|c| matches!(c.name.as_str(), "fs_read" | "code_search" | "ast_symbols" | "memory_query" | "recall" | "spill_read" | "pty_read_ring") || c.has_secret_env_handles())`
- If `batch_will_taint` is true, `runs.tainted` is persisted as `1` in SQLite (and in `ctx`) **before** Stage 1 runs on the first tool in the batch.
- If `batch_will_read_private_context` is true, `runs.has_private_context` is persisted as `1` in SQLite (and in `ctx`) **before** Stage 1 runs on the first tool in the batch.
- **Result (`RT4-16`)**: Whether a model emits `[fs_read("src/secret.rs"), web_fetch("https://...")]` or `[web_fetch("https://..."), fs_read("src/secret.rs")]` in a single turn, both `run_tainted == true` and `has_private_context == true` are active when `web_fetch` reaches Stage 6 (Lethal-Trifecta Guard), deterministically forcing `ASK_HUMAN`.

### 2.1 Stages 1–9 Per-Tool Evaluation (`RT4-18`, `RT4-19`)

1. **Stage 1 — Pre-Persistence Secret Redaction, Universal Literal-Secret Block (`KIN-POL-0009`) & Handle Normalization (`ST-14`, `RT4-18`, `RT4-19`)**:
   - Canonicalize `raw_call.arguments` via RFC 8785 JCS in zeroized memory (`raw_jcs`).
   - Run `SecretRedactor` to produce `args_redacted_jcs_json` (replacing any literal vault secret with `[REDACTED_SECRET:<name>]`).
   - **Universal Literal-Secret Block (`KIN-POL-0009`, Fixing `RT4-18`)**: If `redaction_scan.had_vault_secret == true` on **ANY** tool call (including `fs_write`, `fs_patch`, `channel_post`, `dm_send`, `memory_write`, `shell_exec`, `pty_open`, `pty_write`, `web_fetch`, `web_search`, `browser_act`), Stage 1 rejects the call immediately with `DenyHardStop` (`KIN-POL-0009`: *"Literal vault secret detected in tool arguments; never emit plaintext secrets into files, messages, or commands—reference allowlisted `secret_env_handles` instead"*). `args_redacted_jcs_json` is logged to `tool_calls` and `ledger_payloads` for audit, and the tool is **never executed**, preventing `SecretRedactor` from ever corrupting workspace source files with `[REDACTED_SECRET:<name>]`.
   - **Secret Handle Prefix Normalization (`RT4-19`)**: For `shell_exec` and `pty_open`, each entry in `secret_env_handles` is normalized by stripping any optional leading `$` (`let canonical_handle = raw_handle.trim_start_matches('$');`), accepting both `"$KIN_SECRET_GITHUB_TOKEN"` and `"KIN_SECRET_GITHUB_TOKEN"` against `.kin/kin.toml` `[secrets].allowed_env_injections`.
2. **Stage 2 — Constitutional Hard-Stop & Protected-Path Matcher (`R5`)**:
   - Denies any read/write/exec touching `~/.ssh`, `~/.aws`, `~/.gnupg`, OS Keychain, `$KIN_HOME`, `<root_path>/.git`, `<root_path>/.kin`, `<root_path>/.env*`, raw block devices, or destructive host commands (`DENY_HARD_STOP`).
3. **Stage 3 — Canonical `cap-std` Path & Windows ADS/UNC/Reserved Verification**:
   - Verifies all paths resolve inside `$LANE_WORKTREE_DIR` via `O_NOFOLLOW` handle checks.
4. **Stage 4 — Dual-AST Tree-sitter Bash Classifier (`shell_exec`, `pty_open`, AND `pty_write`, `ST-14`)**:
   - Parses **both** `raw_jcs` and `args_redacted_jcs_json` with `tree-sitter-bash` and takes $\text{Risk} = \max(\text{Risk}(\text{raw}), \text{Risk}(\text{redacted}))$.
   - Any syntax `ERROR`, `eval`, `exec`, process substitution `<(...)`, command substitution `$(...)`, backticks, or control characters in `pty_write` targeting a shell PTY floors at `R3` (`ASK_HUMAN`).
5. **Stage 5 — OS Sandbox Level Compensation (`S1` Elevates ALL Shell/PTY to `R3`, Fixing `ST-05` & `RT4-05`)**:
   - When `sandbox_level == S1` (Windows S1 without WSL2/AppContainer S3, or Linux fallback when `unshare(CLONE_NEWUSER)` returns `EPERM`), **EVERY `shell_exec`, `pty_open`, and `pty_write` call (including allowlisted test commands like `npm test` or `cargo test`) is elevated to floor `R3` (`ASK_HUMAN`)** (`ST-05`, `RT4-05`).
6. **Stage 6 — Lethal-Trifecta Guard (`SEC-INJ-002`, `ST-14`, `RT4-16`)**:
   - When `has_private_context == 1 && run.tainted == 1` (including via Batch Pre-Marking in Stage 0) and the tool is exfiltration-capable (`web_fetch`, `web_search`, `browser_act`, network-capable `shell_exec`/`pty_write`, or external `mcp_*`), policy forces **`ASK_HUMAN`** (even in `FULL_ACCESS`) and runs `lethal_trifecta_guard.md.tera`.
7. **Stage 7 — Hierarchical Capability Grant & Attenuation Check (`INV-006`)**:
   - Verifies `(capability, scope_glob)` in `agent_capability_grants` across the agent and all ancestors.
8. **Stage 8 — Effective Autonomy Matrix Lookup (`READ_ONLY`, `WORKTREE_AUTO`, `AUTO`, `FULL_ACCESS`)**:
   - Computes `min(project.autonomy_ceiling, agent.autonomy_mode, run.autonomy_override)`.
9. **Stage 9 — Durable `tool.intent` Ledger Append (`synchronous = FULL`) & Single-Use `CapabilityToken` Mint**:
   - Persists `args_redacted_jcs_json` to `tool_calls` and `ledger_payloads`, and mints a single-use `CapabilityToken` bound to `args_blake3`.

### 2.2 Risk Classes (`R0`–`R5`) & Autonomy Decision Matrix

| Risk Class | Canonical Examples | `READ_ONLY` | `WORKTREE_AUTO` *(Default)* | `AUTO` | `FULL_ACCESS` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **R0: Pure Read** | `fs_read`, `fs_list`, `code_search`, `ast_symbols`, `memory_query`, `recall`, `spill_read`, `pty_read_ring` | `ALLOW` | `ALLOW` | `ALLOW` | `ALLOW` |
| **R1: Scoped Lane Write & S2/S3 Safe Test** | `fs_write`, `fs_patch`, `goal_mutate`, `task_mutate`, `lane_submit_merge`, `channel_post`, `dm_send`, `memory_write` (T3/T4), allowlisted test `shell_exec` in S2/S3 (`R3` on S1!) | `DENY` | `ALLOW_SANDBOXED` | `ALLOW_SANDBOXED` | `ALLOW_SANDBOXED` |
| **R2: Project Mutation & Allowlisted Egress** | `memory_write` (T1/T2), `agent_hire`, `agent_map_reduce`, `pty_open`/`pty_write` (in S2/S3), `web_fetch`/`browser_act` on allowlisted domains | `DENY` | `ASK_HUMAN` | `ALLOW_SANDBOXED` | `ALLOW_SANDBOXED` |
| **R3: Arbitrary Shell, Package Install, S1 Shell, or Root Apply** | Arbitrary `shell_exec`, any `shell_exec`/`pty_open` on S1 (`ST-05`), `npm i`/`cargo add`, unlisted domains, `LaneEnqueueMerge` root apply | `DENY` | `ASK_HUMAN` | `ASK_HUMAN` | `ALLOW_SANDBOXED` *(unless Lethal Trifecta)* |
| **R4: Destructive / External Side Effect** | Deleting root files, `git push`, modifying `kin.toml` security policy, exporting data | `DENY` | `ASK_HUMAN` | `ASK_HUMAN` | `ASK_HUMAN` *(Always human-gated)* |
| **R5: Constitutional Hard Stop** | `~/.ssh`, `~/.aws`, `~/.gnupg`, `$KIN_HOME`, `<root_path>/.git`, `<root_path>/.env*`, any tool call containing a literal vault secret (`KIN-POL-0009`, `RT4-18`) | **`DENY_HARD_STOP`** | **`DENY_HARD_STOP`** | **`DENY_HARD_STOP`** | **`DENY_HARD_STOP`** |

## 3. Native OS Sandboxes & DNS-Pinned `kin-egress` Proxy (`SEC-SBX-*`, Fixing `ST-04`–`ST-08`, `ST-36`, `RT4-01`–`RT4-06`, `RT4-17`, `RT7-01`)

### 3.1 Dual Sandbox Profiles (`S2-Lane-Exec` vs `S2-Root-Snapshot`) & Platform Enforcement (`RT4-01`–`RT4-06`, `RT7-01`)

- **Profile 1: `S2-Lane-Exec` (Agent Tools, `shell_exec`, `pty_open`, `mcp` stdio, and Lane-Local `GitCmd` — `ST-07`, `RT4-06`)**:
  - Rooted at `$LANE_WORKTREE_DIR` and **never** mounts `<root_path>` (`PROJECT_ROOT_FORBIDDEN`). Because `$LANE_WORKTREE_DIR` is populated from snapshot `S0` (which strips both tracked and untracked `.env*`, `*.pem`, `*.key`, `.kin`, `.git/info/exclude`, and `.kinignore`, `RT4-07`, `RT6-02`), sandboxed agent commands cannot read root secrets.
- **Profile 2: `S2-Root-Snapshot` (Internal `kin-lanes` Fetch & `S0` Snapshot Helper Only — `RT4-06`)**:
  - Used exclusively by `kin-lanes` during `rev-parse`, `fetch +HEAD:refs/kin/root_head`, and `S0` index creation (DOC-04 §1.1–§1.4). Mounts `<root_path>` and `<root_git_dir>` **read-only**, mounts `$REPO_GIT` and `$PROJECT_TMP_DIR` **read-write**, disables all network interfaces (`CLONE_NEWNET` with no egress relay on Linux; `(deny network*)` on macOS), and denies `~/.ssh`, `~/.aws`, `~/.gnupg`, and `$KIN_HOME/keys`.
- **Linux (`S2` on Kernel `>= 5.15`, Landlock ABI v1 on `5.15–6.1` / ABI v3 on `>= 6.2`, Fixing `RT4-01`, `RT4-02`, `RT4-05` & `RT7-01`)**:
  1. **User/Mount/PID/Net Namespace Initialization (`RT4-02`)**: Captures host `uid`/`gid`, calls `unshare(CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWNET)`, writes `"deny"` to `/proc/self/setgroups`, writes `0 <uid> 1` to `/proc/self/uid_map` and `0 <gid> 1` to `/proc/self/gid_map`, and sets `mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL)`.
  2. **Loopback `lo` Up & Full-Duplex `SCM_RIGHTS` / Bidirectional `egress_socketpair_fd` (`KIN_EGRESS_FD=3`) Bridge (`RT4-01`, `RT7-01`)**: Brings `lo` UP inside the new network namespace via `ioctl(sock, SIOCSIFFLAGS, IFF_UP | IFF_RUNNING)`, binds `127.0.0.1:18080`, and in the namespace supervisor process transfers each accepted TCP client socket FD over `egress_socketpair_fd` to `kin-egress` using `libc::sendmsg` (`SCM_RIGHTS` control message, with a 2-thread blocking full-duplex `spawn_bidirectional_tcp_unix_relay` fallback) while `fork()`ing the child into PID 1 of the new `CLONE_NEWPID` namespace!
  3. **Fresh `/proc` Mount, Landlock & 29-Rule seccomp-bpf (`RT4-02`, `RT9-02`, `RT12-19`)**: Inside the PID-1 child process, mounts a fresh `procfs` over `/proc` (`MS_NOSUID | MS_NOEXEC | MS_NODEV` so host `/proc/<kin-engine-pid>/environ` is completely hidden), applies Landlock (`RulesetStatus::NotEnforced` fails closed to `S1`), sets `umask(0o022)` and `set_current_dir`, and applies the 29-rule seccomp-bpf filter (27 unconditional `EPERM` syscalls + conditional `SYS_clone` namespace-flag mask `EPERM` + `SYS_clone3` `ENOSYS`, DOC-07 §3.2).
  4. **Ubuntu 24.04+ AppArmor & `EPERM` Fallback to `S1` (`RT4-05`)**: Ships `/etc/apparmor.d/dev.kin.sandbox` covering `{/usr/lib/kin/kin-sandbox,/opt/kin/kin-sandbox,@{HOME}/.local/bin/kin-sandbox}`. If `unshare(CLONE_NEWUSER)` returns `EPERM` (e.g., an uninstalled `.AppImage` or local cargo binary on Ubuntu 24.04+), `kin-sandbox` explicitly transitions `sandbox_level` to `S1` (enforcing `R3 ASK_HUMAN` on every `shell_exec`/`pty_open`/`pty_write` per `AUD-15`/`ST-05`) and emits a UI diagnostic banner with the one-line `sudo apparmor_parser -r` installation command.
- **macOS (`S2` Seatbelt `macos_s2_lane.sb`, Fixing `RT4-03`)**:
  - Grants `(allow file-read-metadata (literal ...))` on exact ancestor directory paths (`HOME_DIR`, `KIN_HOME_DIR`, `PROJECT_STATE_DIR`, `PROJECT_WORKTREES_DIR`) so `getcwd(3)` / `realpath(3)` succeed inside `$LANE_WORKTREE_DIR` while denying `file-read-data` / `file-write*` on `(subpath (param "KIN_HOME_DIR"))`.
  - Restricts `network-outbound` to `(remote ip (param "EGRESS_PROXY_ADDR"))` (`127.0.0.1:<lane_proxy_port>`, the per-lane authenticated `kin-egress` listener on macOS) and `(remote ip (param "LANE_TEST_LOOPBACK_ADDR"))` (the lane's ephemeral test port), blocking access to host localhost services (Postgres `5432`, Redis `6379`, Ollama `11434`, Chrome `9222`, `RT11-04`).
- **Windows 11 (`S1` Default / `S3` WSL2 or AppContainer, Fixing `ST-04`, `ST-05` & `RT4-04`)**:
  - Initializes `si.cb = std::mem::size_of::<STARTUPINFOW>() as u32`, frees `low_il_sid` via `LocalFree` immediately after `SetTokenInformation`, passes an explicit UTF-16 double-null-terminated scrubbed environment block `env_block_utf16`, and falls back from `CreateProcessAsUserW` to `CreateProcessW` + Job Object if `ERROR_PRIVILEGE_NOT_HELD` (`1314`) is returned on a non-elevated desktop token (DOC-07 §3.3). All `S1` shell/PTY commands floor at `R3` (`ASK_HUMAN`, `ST-05`). Because Windows `S1` does not include a kernel network filter (unlike `S2` on Linux/macOS and `S3` WSL2/AppContainer), `HTTP_PROXY` in `S1` is advisory for arbitrary child processes; therefore, when `projects.local_only_lock == 1`, `S1` completely blocks spawning `shell_exec`, `pty_open`, and local `stdio` MCP subprocesses (`KIN-EGR-0006`), and when `local_only_lock == 0`, `R3` (`ASK_HUMAN`) approval on every `S1` command and local `stdio` MCP launch—paired with an explicit UI warning that `S1` cannot kernel-block direct sockets opened by human-approved binaries—is the mandatory compensating control (`INV-015`, `RT9-06`).

### 3.2 SSRF, IPv6 `[::]` / NAT64 Denylist & Per-Hop HTTP Redirect Validation in `kin-egress` (`SEC-EGR-001`, Fixing `ST-36` & `RT4-17`)

Every in-process outbound HTTP/HTTPS request from `kin-engine` (`kin-gateway`, `web_fetch`, `web_search`, `Streamable HTTP` MCP), managed Chromium (`--proxy-server`, `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`, `--disable-quic`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`), and `S2`/`S3` kernel-confined subprocesses (`127.0.0.1:18080` inside Linux `CLONE_NEWNET` bridged over `KIN_EGRESS_FD=3`, or `127.0.0.1:<lane_proxy_port>` on macOS `S2` Seatbelt / Windows `S3` WSL2/AppContainer; advisory `HTTP_PROXY` + `R3 ASK_HUMAN` gate on Windows `S1` when `local_only_lock == 0`) traverses `kin-egress`:

1. **Per-Lane Proxy Authentication (`SEC-EGR-002`, Fixing `RT9-06`), Host Allowlist & Local-Only Lock**:
   - On Linux (`S2`), `kin-egress` receives accepted connections over the per-lane `socketpair` (`KIN_EGRESS_FD=3`) via `SCM_RIGHTS`. On macOS (`S2`) and Windows (`S1`/`S3`), `kin-egress` binds a per-lane loopback listener `127.0.0.1:<lane_proxy_port>` and verifies the `Proxy-Authorization: Basic base64("kin-lane-<wkt_id>:<lane_proxy_token>")` header in constant time (`subtle::ConstantTimeEq`) against the active `(prj_id, wkt_id, run_id)` token table (rejecting unauthenticated local connections with `KIN-EGR-0006 ProxyAuthInvalid` and stripping `Proxy-Authorization` before forwarding).
   - Verifies `projects.local_only_lock == 0` and checks the request host against `EffectiveAllowedHosts(prj_id, run_id) = config.egress.allowed_hosts UNION run_approved_egress_hosts(run_id) UNION session_approved_egress_hosts(prj_id)`.
   - **Dynamic Egress Host Grant on `ASK_HUMAN` Approval (`SEC-EGR-003`, Fixing `RT12-07`)**: When `web_fetch`, `browser_act` (G10), or an MCP call targets an unlisted domain, Stage 8 classifies the call as `R3` (`ASK_HUMAN`). When the human operator resolves the approval request via `EngineCommand::ApprovalResolve` (`ApproveOnce`, `ApproveSession`, or `ApproveRule`), `kin-policy` registers the normalized target hostname in `run_approved_egress_hosts(run_id)` (for `ApproveOnce`) or `session_approved_egress_hosts(prj_id)` (for `ApproveSession`/`ApproveRule`) before minting the `CapabilityToken`. Every dynamically approved host still undergoes mandatory `KinDnsResolver` SSRF IP filtering and per-hop redirect validation (`KinDnsResolver` never bypasses private/non-global IP blocks).
2. **Single-Resolution DNS Pinning & Comprehensive Non-Global IP Denylist (`KinDnsResolver`, `ST-36`, `RT4-17`)**:
   - Resolves the hostname once via the system resolver (`KinDnsResolver::resolve_and_pin_host`) and rejects the connection (`KIN-EGR-0004 SsrfBlockedIpRange`) if the resolved address set is empty or **any** returned `IpAddr` fails the stable Rust 1.82 helper `is_publicly_routable_ip(ip)` (i.e., `is_ssrf_forbidden_ip(ip) == true` in `DOC-06 §2.4`, which implements the full IANA non-global denylist on stable Rust 1.82 without nightly-only `IpAddr::is_global()`) by falling in:
     - **IPv4 Blocked Ranges**: Unspecified (`0.0.0.0/8`), Loopback (`127.0.0.0/8`), RFC 1918 Private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), Link-Local / Cloud Metadata (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`), Benchmarking (`198.18.0.0/15`, `RT4-17`), IETF Protocol Assignments (`192.0.0.0/24`), Documentation (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), Multicast/Broadcast (`224.0.0.0/4`, `240.0.0.0/4`).
     - **IPv6 Blocked Ranges (`RT4-17`)**: **Unspecified `[::]` (`::/128`)** (which routes to loopback on Linux/macOS!), Loopback (`::1/128`), IPv4-Mapped (`::ffff:0:0/96`), IPv4-Compatible, **NAT64 Well-Known & Local-Use Prefixes (`64:ff9b::/96` and `64:ff9b:1::/48`)**, Unique Local (`fc00::/7`), Link-Local (`fe80::/10`), Multicast (`ff00::/8`), Documentation (`2001:db8::/32`), and AWS IMDSv2 (`fd00:ec2::254/128`).
   - Dials the TCP connection directly to the **first verified `SocketAddr`** (with TLS SNI set to the original hostname), eliminating DNS-rebinding TOCTOU.
3. **Per-Hop HTTP 3xx Redirect Re-Validation (`reqwest::redirect::Policy::custom`, Fixing `RT4-17.3`)**:
   - `kin-egress` configures `reqwest::redirect::Policy::custom` via `build_egress_redirect_policy(allowed_hosts, allow_insecure_http, resolver)` (`DOC-06 §2.4`, max 5 redirect hops). On every HTTP `301`, `302`, `303`, `307`, or `308` response, the custom policy extracts the target `Location` URL, validates the URL scheme (`https`, or `http` only when `allow_insecure_http == true`), verifies the target host against `EffectiveAllowedHosts`, and calls `resolver.resolve_and_pin_host(host, port)` to resolve, validate (`is_ssrf_forbidden_ip`), and pin every resolved IP address for that redirect hop *before* following the redirect (aborting with `KIN-EGR-0005 RedirectTargetForbidden` or `KIN-EGR-0004 SsrfBlockedIpRange` on any violation).

## 4. Two-Level Audit Ledger & Unified Privacy Purge (`SEC-LDG-*`, `SEC-PRV-001`, Fixing `ST-24`, `ST-40`, `RT4-12` & `RT5-05`)

### 4.1 Exact Envelope Hash Input & SQLite Chain Continuity (`ST-40`, `RT5-05`)

 Let `EnvelopeMeta12` be the RFC 8785 JCS object containing the **12 preceding columns** of `ledger_events` (`seq`, `id`, `ts_us`, `event_kind`, `actor_kind`, `actor_id`, `run_id`, `tool_call_id`, `risk_class`, `decision`, `payload_blake3`, `prev_event_blake3` — excluding `payload_purged` and `event_blake3`). Then:
   $$\text{payload\_blake3} = \text{BLAKE3}\big(\texttt{0x02} \;\|\; \text{JCS}(\text{RedactedPayload})\big)$$
   $$\text{event\_blake3} = \text{BLAKE3}\big(\texttt{0x01} \;\|\; \text{prev\_event\_blake3} \;\|\; \text{JCS}(\text{EnvelopeMeta12})\big)$$
   SQLite trigger `trg_ledger_enforce_chain` verifies on every `INSERT` that `seq` starts at `0` with 64 zero hex characters for `prev_event_blake3` and increments by `+1` with `prev_event_blake3 == prior.event_blake3`.
### 4.2 Signed Privacy Purge Receipt (`privacy.purge.receipt`) & Unified Privacy Purge Procedure (`SEC-PRV-001`, Fixing `ST-24`, `RT4-10`, `RT4-12` & `RT9-14`)

When an operator executes `/forget` or Privacy Purge on a message, run, or tool call (`seq = :target_seq`, `entity_id = :entity_id`):
- **Step 0 — Append Signed Purge Receipt (`privacy.purge.receipt`, Fixing `RT9-14` & `RT12-09`)**: Before deleting any row from `ledger_payloads`, `kin-ledger` signs the canonical receipt digest with the project's Ed25519 ledger signing key `LSK_prj` (`DOC-02 §3`) and appends a new event with `event_kind = 'privacy.purge.receipt'`, `actor_kind = 'human'`, and unified JCS payload `payload_jcs_json = '{"ed25519_sig_hex":"<128_hex_sig>","entity_id":"<entity_id>","purged_seq":<target_seq>,"reason":"operator_privacy_purge"}'` into `ledger_events` and `ledger_payloads`. SQLite trigger `trg_ledger_payloads_require_receipt` (`KIN-LDG-0007`) rejects any `DELETE FROM ledger_payloads` unless a subsequent receipt row (`le.seq > old.seq`) exists in `ledger_events` with `$.purged_seq = old.seq`, non-null `$.entity_id` and `$.reason`, and a 128-hex-char `$.ed25519_sig_hex`.
   - Inside an atomic `DbWriter` transaction:
     - `UPDATE messages SET content_purged = 1, content_md = '[PURGED]', parts_json = '[]', mentions_json = '[]'` (automatically purging `messages_fts` via `trg_messages_au`);
     - `UPDATE run_steps SET content_purged = 1, assistant_parts_json = '[]'`;
     - `UPDATE tool_calls SET content_purged = 1, args_redacted_jcs_json = '{}', result_preview_text = NULL, spill_blob_hash = NULL` (automatically purging `tool_calls_fts` via `trg_tool_calls_au`, `RT4-10`);
     - `UPDATE project_events SET payload_purged = 1, payload_json = '{"purged":true}'`;
     - Append the signed `privacy.purge.receipt` event (`payload_jcs_json = '{"ed25519_sig_hex":"<128_hex_sig>","entity_id":"<entity_id>","purged_seq":<target_seq>,"reason":"operator_privacy_purge"}'`) to `ledger_events` and `ledger_payloads`, and then execute `DELETE FROM ledger_payloads WHERE seq = :target_seq` (enforced by `trg_ledger_payloads_require_receipt` `KIN-LDG-0007` and synchronized via `trg_ledger_payloads_sync_purge` to set `UPDATE ledger_events SET payload_purged = 1 WHERE seq = old.seq`, `RT4-12`, `RT9-14`, `RT12-09`).
   - Decrement `blobs.ref_count` (`ref_count = 0`) and unlink the corresponding encrypted `blobs/<hash>.zst.enc` file on disk. The `ledger_events` BLAKE3 hash chain and Ed25519 checkpoint signatures remain 100% valid from Genesis (`seq = 0`) to head.

## 5. Canonical 26-Tool Catalog (`TL-CAT-001`, Fixing `RT4-10`, `RT4-19`, `RT4-21`, `RT4-22` & `RT4-25`)

All **26 built-in tools** are listed below in **strict ASCII lexicographic order** (`01..26`), matching DOC-07 §2 1-to-1:

| # | Tool Name (A–Z) | Domain | Mutability | Base Risk | Normative Contract |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 01 | `agent_delegate` | Workforce & DAG | `non_idempotent_write` | R1 | Spawn one isolated task-scoped subagent with attenuated grants and carved budget (propagates child taint back to parent, `RT4-11.1`). |
| 02 | `agent_hire` | Workforce & DAG | `non_idempotent_write` | R2 | Hire a specialist from a curated template or custom charter within project team caps (`projects.max_agents_cap = 24`). |
| 03 | `agent_map_reduce` | Workforce & DAG | `non_idempotent_write` | R2 | Fan out 2..8 isolated subagents in parallel lanes and return bounded `SubagentArtifact`s (propagates child taint back to parent, `RT4-11.1`). |
| 04 | `ast_symbols` | Code Intelligence | `read_only` | R0 | Query `code_symbols` and `symbol_edges` (requires `file_path` or `symbol_query` via `anyOf`, `RT4-25`; sets `has_private_context=1`). |
| 05 | `browser_act` | Web & Browser | `external_side_effect` | R2 | Execute a deterministic CDP browser action (`navigate`, `snapshot`, `click`, `type`, `request_takeover`; marks `run.tainted=1`). |
| 06 | `channel_post` | Workforce & DAG | `non_idempotent_write` | R1 | Post a message or meeting Decision Record (`meeting_id`, `conclude_meeting_decision_record: bool`, `RT4-21`) to a channel/thread (propagates run taint). |
| 07 | `code_search` | Code Intelligence | `read_only` | R0 | Hybrid `ripgrep` regex + FTS5 BM25 + `sqlite-vec` semantic code search (sets `has_private_context=1`). |
| 08 | `dm_send` | Workforce & DAG | `non_idempotent_write` | R1 | Send a confidential 1:1 DM (pre-checks `consecutive_agent_turns == 4` to reset and escalate to `@boss` without SQLite abort, `RT4-22`). |
| 09 | `fs_list` | Filesystem | `read_only` | R0 | List files and directories inside the active Lane respecting `.gitignore` and `.kinignore`. |
| 10 | `fs_patch` | Filesystem | `idempotent_write` | R1 | Apply search/replace hunks via the 4-Tier Fuzzy + AST-Anchored Patch Engine with inline LSP diagnostics (rejects literal secrets via `KIN-POL-0009`, `RT4-18`). |
| 11 | `fs_read` | Filesystem | `read_only` | R0 | Read a line range from a file inside the active Lane via `cap-std` handle (sets `has_private_context=1`, pre-marked across batch per `RT4-16`). |
| 12 | `fs_write` | Filesystem | `idempotent_write` | R1 | Atomically write a file inside the active Lane via `cap-std` temp-write+rename and return inline LSP diagnostics (rejects literal secrets via `KIN-POL-0009`, `RT4-18`). |
| 13 | `goal_mutate` | Workforce & DAG | `idempotent_write` | R1 | List, create, update, pause, complete, or cancel Goals, or start/conclude Meetings (`meeting_start`, `meeting_conclude` writing `meetings.decision_record_md`, `RT4-21`). |
| 14 | `lane_submit_merge` | Workforce & DAG | `idempotent_write` | R1 | Submit the active verified Worktree Lane to the serialized 3-Way Merge Queue. |
| 15 | `memory_query` | Memory & Graph | `read_only` | R0 | Query governed T1..T4 memories and 2-hop bi-temporal knowledge graph edges via 4-Signal RRF. |
| 16 | `memory_write` | Memory & Graph | `idempotent_write` | R1 | Persist a governed memory item (`created_by_run_id` enforced; tainted T1/T2 forced to `quarantined`/`untrusted` by SQLite trigger, `RT4-11.4`). |
| 17 | `pty_kill` | Execution & PTY | `idempotent_write` | R1 | Terminate a lane-scoped interactive PTY session and reap its process group. |
| 18 | `pty_open` | Execution & PTY | `non_idempotent_write` | R2 | Open a managed, sandboxed (`S2-Lane-Exec`) interactive PTY session with optional normalized `secret_env_handles` (`RT4-19`; `R3` on S1). |
| 19 | `pty_read_ring` | Execution & PTY | `read_only` | R0 | Read recent lines from a PTY session's 1 MiB secret-redacted ring buffer. |
| 20 | `pty_write` | Execution & PTY | `non_idempotent_write` | R2 | Write Bash-AST-classified input to a PTY session and wait for output quiescence or exit (`R3` on S1). |
| 21 | `recall` | Memory & Graph | `read_only` | R0 | Search raw uncompacted messages (`messages_fts`) and tool call history (`tool_calls_fts`, `RT4-10`) in SQLite FTS5. |
| 22 | `shell_exec` | Execution & PTY | `non_idempotent_write` | R1 | Execute a Bash-AST-classified command inside `S2-Lane-Exec` with optional normalized `secret_env_handles` (`RT4-19`; `R3` on S1). |
| 23 | `spill_read` | Execution & PTY | `read_only` | R0 | Paginate or regex-filter an XChaCha20-Poly1305 encrypted tool output spill blob. |
| 24 | `task_mutate` | Workforce & DAG | `idempotent_write` | R1 | List, create, claim, checkpoint, review, or complete tasks in the Project Task DAG with `lease_epoch` fencing and conditional `required` schema validation (`RT4-25`). |
| 25 | `web_fetch` | Web & Browser | `external_side_effect` | R2 | Fetch a URL through `kin-egress` (SSRF/DNS-pinned + redirect-validated, `RT4-17`), wrap in `<untrusted_content>`, and mark `run.tainted = 1`. |
| 26 | `web_search` | Web & Browser | `external_side_effect` | R1 | Execute a web search query through `kin-egress`, wrap snippets in `<untrusted_content>`, and mark `run.tainted = 1`. |

## 6. Extensibility: MCP-First Integrations, Four-Category Extension Taxonomy, Five-Phase Implementation Order & Lifecycle Hooks (`EXT-*`, Fixing `ST-26`, `RT9-21` & `RT10-02`–`RT10-07`)

### 6.1 MCP-First Integration Principle & Stateless MCP (`2026-07-28`) Host Architecture (`EXT-MCP-FIRST`, `EXT-MCP-001..005`, `ST-26`, `RT9-21`, `RT10-02`)

KIN builds its external integrations around the **Model Context Protocol (MCP `2026-07-28`)** wherever practical, rather than implementing a different integration framework for every application. The `2026-07-28` MCP specification uses a **stateless Streamable HTTP transport** (and stateless JSON-RPC message framing over `stdio`) without mandatory server-side sticky sessions:

1. **Transport, Sandbox Hosting & Egress Enforcement**:
   - **`stdio` Servers**: Spawned on demand inside `kin-sandbox` (`S2-Lane-Exec` / `S3`) with `env_clear()` (`SEC-ENV-001`), `CWD = $LANE_WORKTREE_DIR`, `15m` idle eviction (`ENV-LSP-001`, `RT7-07`), and no `<root_path>` mount.
   - **Stateless `streamable_http` Servers (`RT9-21`)**: At discovery time, `kin-mcp` invokes stateless `server/discover` (and `tools/list`) to retrieve server capabilities and tool schemas without sticky server sessions. Every JSON-RPC HTTP POST request traverses `kin-egress` (`SEC-EGR-001`) carrying `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: <jsonrpc_method>`, and `Mcp-Name: <tool_or_resource_name>`, and passes any multi-round-trip state in `_meta.continuation_token` (`kin-mcp` handles both `application/json` and `text/event-stream` responses per call).
2. **SHA-256 JCS Schema Pinning & Quarantine Trigger (`EXT-MCP-004`, `KIN-EXT-0004`)**:
   - Declared in `.kin/kin.toml` under `[[mcp.servers]]` with `pinned_schema_sha256 = "<hex>"` (accepting `schema_sha256` as a backward-compatible config alias, `RT11-03`) and persisted in `project.db::mcp_integrations.pinned_schema_sha256`.
   - On connection, `kin-mcp` fetches `tools/list`, canonicalizes the tool definitions via RFC 8785 JCS, and verifies `SHA-256(JCS(tools)) == pinned_schema_sha256`. Any mismatch flips `mcp_integrations.trust_status = 'quarantined_schema_mismatch'` and `enabled = 0`; SQLite trigger `trg_mcp_integrations_block_enable_if_quarantined` (`KIN-EXT-0004`) prevents enabling any integration unless `trust_status == 'verified_schema'`.
3. **Explicit `read_only` vs `write_enabled` Mode Enforcement (`EXT-MCP-005`, `KIN-EXT-0001`)**:
   - Every row in `mcp_integrations` declares `access_mode IN ('read_only', 'write_enabled')` (defaulting to `'read_only'`).
   - When `access_mode == 'read_only'`, `kin-policy` and `kin-mcp` allow only discovery/read tools (`mutability == 'read_only'`) and deterministically reject any mutating or external-write tool call on that server with `KIN-EXT-0001 IntegrationWriteBlockedInReadOnlyMode`.
4. **L2 Cache Protection (`RT12-12`)**: If an MCP server exposes `> 12` tools, L2 includes only a compact read-only `mcp_tool_search` directory block (`<mcp_tool_directory>`, not a 27th built-in tool) listing tool names and 1-line summaries, while full JSON schemas for referenced MCP tools load into L8 on demand.

### 6.2 Six Supported Integration Domains & Explicit Availability Caveat (`EXT-INT-001..006`, Fixing `RT10-03`)

**Important Availability & Authentication Boundary**: The six integration domains below are examples of integrations KIN could support through its MCP-first architecture—**not** a claim that every connector is currently bundled, implemented, or verified out of the box. Actual runtime availability depends on the connector, its authentication requirements (such as Google Cloud configuration and OAuth 2.0 setup), and the capabilities exposed by its server:

1. **GitHub (`preset_slug = 'github'`)**:
   - *Capabilities*: Repository search, issues, pull requests, code review, GitHub Actions, releases, security alerts, and project management.
   - *MCP Server & Auth*: An official GitHub MCP server already exposes GitHub capabilities to compatible AI clients; KIN provides a first-party preset supporting both `read_only` and `write_enabled` modes authenticated via `KIN_SECRET_GITHUB_TOKEN` or OAuth.
2. **Google Sheets and Drive (`preset_slug = 'google_workspace'`)**:
   - *Capabilities*: Read and update spreadsheets, populate cells, use formulas, organize data, and automate reporting.
   - *MCP Server & Auth*: Google publishes a Sheets MCP server, currently documented as part of its Developer Preview Program; access requires the relevant Google Cloud project configuration and OAuth 2.0 PKCE setup.
3. **Slack and Discord (`preset_slug IN ('slack', 'discord')`)**:
   - *Capabilities*: Read permitted conversations, summarize discussions, post updates, and coordinate work across teams.
4. **Notion, Linear, Jira and Trello (`preset_slug IN ('linear_jira', 'notion', 'trello')`)**:
   - *Capabilities*: Manage documentation, track tasks, create tickets, update project status, and coordinate execution with KIN's Task DAG.
5. **Databases and Infrastructure (`preset_slug = 'postgres'`)**:
   - *Capabilities*: Query and inspect PostgreSQL, SQLite, Supabase, REST/GraphQL APIs, cloud services, monitoring, deployment, and CI/CD tools under `read_only` or policy-gated `write_enabled` modes.
6. **Browser, Terminal and Developer Tools (`preset_slug = 'browser'` / `'filesystem'`)**:
   - *Capabilities*: Browser automation (`kin-browser` CDP), local scripts (`shell_exec`, `pty_open`), testing tools, package managers, local/remote MCP servers, and custom APIs.

### 6.3 Four-Category Extension Organization & Security Boundaries (`EXT-TAX-001`, Fixing `RT10-04` & `RT10-06`)

KIN does **not** treat every extension as the same thing. Keeping MCP integrations, native extensions, skills, and workflow packs distinct in `project.db::extension_packages` (`category IN ('integration','plugin','skill','workflow_pack')`) makes the architecture easier to maintain and secure:

1. **Category 1 — Integrations (`category = 'integration'`, `EXT-INT-001`)**:
   - Connect external services such as GitHub, Google Sheets, and Slack to provide real actions and data through MCP (`stdio` or `streamable_http`), native adapters, or APIs.
   - All inbound responses are wrapped in `<untrusted_content>` and mark `runs.tainted = 1` (`INV-010`), and write actions require `access_mode = 'write_enabled'` (`KIN-EXT-0001`).
2. **Category 2 — Plugins and Extensions (`category = 'plugin'`, `EXT-PLG-001`)**:
   - Add capabilities to KIN itself: new Zone 4 interface panels, deterministic tools, custom workflows, language/LSP integrations, model providers, or specialized agent runtimes via the **Native Plugin SDK (`crates/kin-plugin-sdk`)**.
   - Plugins execute inside a WASI 0.2 WebAssembly component sandbox (or signed out-of-process helper) and must declare all required capabilities in `requested_capabilities_json`.
3. **Category 3 — Skills and Playbooks (`category = 'skill'`, `EXT-SKL-001`)**:
   - Reusable, semver-versioned instructions (`.kin/skills/<slug>/SKILL.md`, `max_tokens <= 4000`) that tell agents how to perform a workflow (for example, how to research a competitor, update a Google Sheet via MCP, and prepare a report).
   - **Zero Implicit Extra Permissions (`INV-006`, `KIN-EXT-0002`)**: Only the 1-line `name + description` (~40 tokens) is compiled into L2; when triggered, the full `SKILL.md` body loads into L8 as a `<kin-skill>` block. A Skill **never** grants implicit tool, filesystem, secret, or network permissions beyond the invoking agent's existing `agent_capability_grants`.
4. **Category 4 — Workflow Packs (`category = 'workflow_pack'`, `EXT-WFP-001`)**:
   - Preconfigured, semver-versioned multi-step processes (`.kin/workflows/<slug>/workflow.toml`) combining tools, skills, specialist agent roles (`@architect`, `@backend`, `@qa`), and mandatory human approval checkpoints—for example, an **Issue-to-Pull-Request Workflow Pack** (`fetch_issue_read_only -> plan_task_dag -> implement_in_worktree_lane -> run_fast_check_gate -> human_approval_checkpoint -> create_pull_request`).
   - **Zero Implicit Extra Permissions (`INV-006`, `KIN-EXT-0002`)**: Workflow Packs instantiate standard Task DAG nodes (`tasks` + `task_dependencies`) and **cannot** bypass approval checkpoints or elevate `autonomy_effective` (`KIN-EXT-0002 ExtensionPrivilegeEscalationDenied`).

### 6.4 Five-Step Extension & Marketplace Implementation Order (`EXT-MKT-001..005`, Fixing `RT10-07`)

1. **Step 1 — MCP Integration Manager (`EXT-MKT-001`)**: Real UI in Zone 4 / Settings (`EngineCommand::McpIntegrationMutate`) to discover, configure, authorize (OS Keychain secret handle or OAuth 2.0 PKCE), inspect tool schemas, toggle `read_only` / `write_enabled` mode, and enable or disable local (`stdio`) and remote (`streamable_http`) MCP servers.
2. **Step 2 — First-Party Integration Presets (`EXT-MKT-002`)**: Built-in presets prioritizing **GitHub**, **Filesystem**, **Browser**, and **Google Workspace**, with clear `read_only` (default) and `write_enabled` modes, reusing official MCP servers where sensible.
3. **Step 3 — Skills and Workflow Marketplace (`EXT-MKT-003`)**: Installable, semver-versioned Skills (`SKILL.md`) and preconfigured multi-agent Workflow Packs (`workflow.toml`) with zero implicit extra permissions (`KIN-EXT-0002`).
4. **Step 4 — Native Plugin SDK (`crates/kin-plugin-sdk`, `EXT-MKT-004`)**: Stable, capability-attenuated extension API for plugins that genuinely need deeper access to KIN's UI panels or runtime.
5. **Step 5 — Public Marketplace & Revocation (`EXT-MKT-005`, `KIN-EXT-0003`)**: Publishing, search, compatibility checks (`min_kin_version`), Ed25519 verified publishers (`publisher_verified = 1`), user reviews, automated static/AST security scanning (`security_scan_status`), semver version management, and cryptographic removal/revocation mechanisms enforced at the SQLite layer by `trg_extension_packages_block_enable_if_revoked_or_flagged` (`KIN-EXT-0003`).

### 6.5 Deterministic Lifecycle Hooks (`[[hooks]]`, `EXT-HOK-001`)

- Configured in `.kin/kin.toml` (DOC-07 §4) for events `PreToolUse`, `PostToolUse`, `PreLaneIntegrate`, `PostLaneApply`, and `RunCompleted`.
- Hooks execute inside `kin-sandbox` (`S2-Lane-Exec`) with a hard `5,000ms` timeout. A `PreToolUse` hook may return `deny` or `ask_human`, but **cannot** downgrade a policy `deny` or `ask_human` into `allow`.

## 7. Signed Tauri v2 Updater, Code Signing & Notarized Packaging (`SEC-UPD-001`, Fixing `ST-33`)

- **Installers**: macOS Universal `.dmg` / `.app` (signed with Apple Developer ID Application certificate, hardened runtime, and notarized via `notarytool`), Windows `.msi` / `.exe` (signed via Azure Trusted Signing / EV Authenticode), and Linux `.deb` (with `/etc/apparmor.d/dev.kin.sandbox`) + `.AppImage`.
- **Opt-In Signed Update Verification (`INV-016`, Fixing `RT9-16`)**: Background update checks are **disabled by default (`check_updates_enabled = false`)** so KIN makes zero unrequested outbound connections. When the operator manually clicks **Check for Updates** or explicitly opts in (`check_updates_enabled = true`), `kin-shell` queries `https://releases.kin.dev/v10.0/manifest.json` through `kin-egress`, verifying both TLS and an offline-pinned **Ed25519 Release Signing Key** signature over the binary's BLAKE3 digest before staging an update.
