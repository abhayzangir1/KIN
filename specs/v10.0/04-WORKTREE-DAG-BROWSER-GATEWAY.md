# DOC-04: Self-Contained repo.git Worktrees, 4-Tier AST Patching, Managed PTYs, Crash-Safe Apply, DAG, Browser & Gateway

| Field | Value |
| :--- | :--- |
| **Document ID** | KIN-DOC-04 (`04-WORKTREE-DAG-BROWSER-GATEWAY.md`) |
| **Suite Version** | `10.0.0-PRODUCTION` |
| **Status** | **Canonical Specification & Reference Contract Bundle** |
| **Scope** | Dual Sandbox Profiles (`S2-Root-Snapshot` vs `S2-Lane-Exec`, `RT4-06`), Self-Contained `repo.git` Pack Fetch (`ST-09`), Unborn `HEAD` & Missing `.kinignore` Safety (`RT4-08`), Tracked & Untracked `.env*` & `.kinignore` Stripping (`ST-10`, `RT4-07`, `RT6-02`), `.git` Pointer File & `reftable` Support (`ST-11`), Sanitized `.gitattributes` (`ST-12`), 4-Tier `fs_patch`, Managed PTYs & PID-1 Reaper (`TL-SHL-002`, `RT9-04`), Scrubbed Child Environment (`SEC-ENV-001`, `RT6-08`), Warm LSP Caps (`ENV-LSP-001`, `RT7-07`), Verified Read-Only Toolchains (`ENV-TCN-001`, `RT8-07`), Two-Phase `apply_journals` & Worktree Pruning (`ST-41`, `RT4-09`, `RT4-27`, `RT7-05`), DAG Promotion (`ST-31`), Gateway Resilience & Matryoshka Embeddings (`ST-30`, `RT4-26`), and CDP Browser Automation & QUIC/WebRTC Hardening (`BRW-CDP-001..004`, `RT9-10`) |

## 1. Zero-Pollution, `git gc`-Immune `repo.git` Architecture (`WT-MIR-001`, Fixing `ST-09`–`ST-12`, `RT4-06`–`RT4-08` & `RT6-02`)

### 1.1 Dual Sandbox Separation (`S2-Root-Snapshot` vs `S2-Lane-Exec`, Fixing `RT4-06`) & Resolving `.git` Pointer Files / Unborn `HEAD` (`ST-11`, `RT4-08`)

To eliminate any contradiction between `ST-07` (agent tools must never see `<root_path>`) and `kin-lanes` needing to read `<root_path>` during `S0` snapshot creation (`RT4-06`), `kin-sandbox` defines two distinct, non-overlapping sandbox profiles:

1. **`S2-Lane-Exec` (Agent Execution Sandbox — `shell_exec`, `pty_open`, `mcp` stdio, and lane-local `GitCmd`)**:
   - Rooted at `$LANE_WORKTREE_DIR`; `<root_path>` and `<root_git_dir>` are **strictly forbidden** (`PROJECT_ROOT_FORBIDDEN` in Seatbelt and omitted from Landlock in Linux, `ST-07`).
2. **`S2-Root-Snapshot` (Internal `kin-lanes` Snapshot/Fetch Helper Sandbox — `RT4-06`)**:
   - Invoked exclusively by `kin-lanes` in Rust during onboarding, `fetch`, and `S0` snapshot creation (`§1.2` and `§1.4`).
   - Mounts `<root_path>` and `<root_git_dir>` **read-only** (`ro_access`), mounts `$REPO_GIT` and `$PROJECT_TMP_DIR` **read-write** (`rw_access`), **completely disables all network access** (`unshare(CLONE_NEWNET)` with no egress bridge on Linux; `(deny network*)` on macOS), and denies `~/.ssh`, `~/.aws`, `~/.gnupg`, and `$KIN_HOME/keys`.
3. **Resolving `.git` Pointer Files, `reftable` Repos & Unborn `HEAD` (`ST-11`, `RT4-08`)**:
   - If `<root_path>/.git` is a regular file starting with `gitdir:`, `kin-lanes` resolves the target `<gitdir>` and `<gitdir>/commondir` to locate `<root_common_git_dir>`.
   - If `projects.repo_mode == 'non_git'` or `git --no-optional-locks --git-dir="$ROOT_GIT_DIR" rev-parse --verify -q HEAD` returns non-zero (e.g., exit code `128` on a freshly initialized `git init` repository with 0 commits, `RT4-08`), `kin-lanes` skips `git fetch` and initializes the snapshot index from an empty tree (`git --git-dir="$REPO_GIT" read-tree --empty`).

### 1.2 Self-Contained Object Pack Fetch (Immune to User `git reset --hard && git gc`, Fixing `ST-09` & `RT4-08`)

Relying on `repo.git/objects/info/alternates` pointing to `<root_path>/.git/objects` breaks if the user runs `git reset --hard && git gc --prune=now` in `<root_path>`, because Git prunes objects that are only referenced by refs in `repo.git` (`ST-09`).

- **Canonical Solution (`WT-MIR-002`)**: On project onboarding and before snapshot creation, `kin-lanes` initializes `$KIN_HOME/projects/<prj_id>/repo.git` (`git init --bare`) and, when `<root_path>` has a valid `HEAD` commit (`rev-parse --verify -q HEAD`), runs inside `S2-Root-Snapshot`:

```bash
if [ "$REPO_MODE" != "non_git" ] && git --no-optional-locks --git-dir="$ROOT_GIT_DIR" rev-parse --verify -q HEAD >/dev/null; then
    git --git-dir="$REPO_GIT" fetch --no-tags --quiet "$ROOT_GIT_DIR" +HEAD:refs/kin/root_head
fi
```

Because `repo.git` owns its own compressed packfile copy of reachable objects (and stores all new snapshot/worktree objects in `repo.git/objects`), the user can run `git reset --hard`, `git rebase`, or `git gc --prune=now` in `<root_path>` at any time and `repo.git` **never** suffers missing objects.

### 1.3 Sanitized `.gitattributes` Tree Preserving `text`/`eol` While Stripping Filters (`ST-12`)

Binding an empty `attr.tree` strips `text=auto` and `eol=crlf`, causing unmodified CRLF files on Windows/cross-platform repos to appear modified against `HEAD` (`ST-12`). Instead, `kin-lanes` runs **`sanitize_gitattributes()`** in Rust:

1. Read `<root_path>/.gitattributes` and `<root_git_dir>/info/attributes` (if present).
2. Parse each attribute token on every non-comment line:
   - **Allowlisted Formatting Tokens (Retained)**: `text`, `-text`, `text=auto`, `eol=lf`, `eol=crlf`, `working-tree-encoding=*`, `binary`, `-crlf`.
   - **Executable/Driver Tokens (Stripped)**: `filter=*`, `diff=*`, `merge=*`, `textconv=*`, `ident`, `export-subst`.
3. Write the sanitized `.gitattributes` blob into `repo.git` (`git --git-dir=$REPO_GIT hash-object -w --stdin`), create a single-entry tree `$SANITIZED_ATTR_TREE`, and pass `-c attr.tree=$SANITIZED_ATTR_TREE` on all `GitCmd` invocations. This preserves `text`/`eol` normalization 100% while making `filter`/`textconv`/`diff` RCE impossible (`ST-12`).

### 1.4 Dirty-Root Snapshot S0 (Unborn-HEAD Safe, Conditional Exclude Files & Tracked/Untracked `.env*` + `.kinignore` Stripping, Fixing `ST-10`, `RT4-06`–`RT4-08`, `RT4-27`, `RT6-02`)

To capture uncommitted edits in `<root_path>` into `repo.git` inside `S2-Root-Snapshot` without crashing on unborn `HEAD` or missing `.kinignore` (`RT4-08`) and without leaking **either untracked or tracked** `.env*`, `*.pem`, `*.key`, `.kin`, or `.kinignore` files into agent worktrees (`ST-10`, `RT4-07`, `RT6-02`):

1. Set `GIT_DIR=$REPO_GIT`, `GIT_WORK_TREE=$ROOT_PATH`, `GIT_INDEX_FILE=$KIN_HOME/projects/<prj_id>/tmp/index.<ulid>`, `GIT_OBJECT_DIRECTORY=$REPO_GIT/objects`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` (or `GIT_CONFIG_GLOBAL=NUL` on native Windows), `GIT_ATTR_NOSYSTEM=1`, and `GIT_ALLOW_PROTOCOL=file`.
2. Execute the 3-step index population and secret-stripping pipeline inside `S2-Root-Snapshot`:

```bash
# 1. Seed temporary index from refs/kin/root_head if present, else empty tree (Fixing RT4-08 unborn HEAD / non_git)
if git --git-dir="$REPO_GIT" rev-parse --verify -q refs/kin/root_head >/dev/null; then
    git --git-dir="$REPO_GIT" read-tree refs/kin/root_head
    git --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null \
        -c attr.tree="$SANITIZED_ATTR_TREE" \
        update-index --add --remove -z --again
else
    git --git-dir="$REPO_GIT" read-tree --empty
fi

# 2. Add untracked files, conditionally passing --exclude-from ONLY for files that exist on disk (Fixing RT4-08)
EXCLUDE_ARGS=()
[ -n "$ROOT_GIT_DIR" ] && [ -f "$ROOT_GIT_DIR/info/exclude" ] && EXCLUDE_ARGS+=(--exclude-from="$ROOT_GIT_DIR/info/exclude")
[ -f "$ROOT_PATH/.kinignore" ] && EXCLUDE_ARGS+=(--exclude-from="$ROOT_PATH/.kinignore")

git --no-optional-locks -c attr.tree="$SANITIZED_ATTR_TREE" \
    ls-files --others --exclude-standard "${EXCLUDE_ARGS[@]}" \
    --exclude='.env' --exclude='.env.*' --exclude='*.pem' --exclude='*.key' --exclude='.kin' -z \
  | git -c attr.tree="$SANITIZED_ATTR_TREE" update-index --add -z --stdin

# 3. Strip any TRACKED root or nested secret files (using recursive :(glob)**/ pathspecs, Fixing RT4-07, RT6-02 & RT12-02) AND any tracked files matching .kinignore from the index before write-tree
git --no-optional-locks rm --cached --ignore-unmatch --quiet -r -- \
    ':(glob)**/.env' ':(glob)**/.env.*' ':(glob)**/*.pem' ':(glob)**/*.key' \
    ':(glob)**/*.p12' ':(glob)**/*.pfx' ':(glob)**/id_rsa*' ':(glob)**/id_ed25519*' \
    ':(glob)**/.npmrc' ':(glob)**/.pypirc' ':(glob)**/.netrc' ':(glob)**/.kin' ':(glob)**/.kin/**'
if [ -f "$ROOT_PATH/.kinignore" ]; then
    git --no-optional-locks ls-files --cached --ignored --exclude-from="$ROOT_PATH/.kinignore" -z \
      | git --no-optional-locks update-index --force-remove -z --stdin
fi
```

3. Write the tree (`SNAP_TREE=$(git write-tree)`), commit `S0` inside `repo.git` (`SNAP_SHA=$(git commit-tree "$SNAP_TREE" -m "kin-s0")`), and check out the isolated worktree:
   `git --git-dir="$REPO_GIT" -c attr.tree="$SANITIZED_ATTR_TREE" worktree add --detach "$WORKTREE_PATH" "$SNAP_SHA"`.
4. **Result**: `<root_path>` and `<root_path>/.git/**` have **0 bytes written and 0 `mtime`/`ctime` changes**; both tracked and untracked `.env*`/`*.pem`/`*.key`/`.kin`, `.kinignore` globs, and `.git/info/exclude` files never enter `S0` or `wkt_`; and `repo.git` is 100% self-contained.

## 2. 4-Tier `fs_patch` Engine, Managed Lane PTYs, Scrubbed Env & Warm LSP Caps (`TL-PTC-001`, `TL-PTY-001`)

- **4-Tier Cascade `fs_patch`**: Tier 1 Exact -> Tier 2 Line-Trimmed/CRLF-Normalized -> Tier 3 Tree-sitter AST-Symbol-Scoped & Re-indented -> Tier 4 Levenshtein Fuzzy Anchor (`Sim >= 0.92`, margin `Delta >= 0.08`). Acquires lexicographically ordered advisory AST symbol leases (`ast_symbol_leases`) and returns `<inline_diagnostics>` in `< 80ms`.
- **Managed PTYs (`pty_open`, `pty_write`, `pty_read_ring`, `pty_kill`)**: `pty_open` supports allowlisted `secret_env_handles` (normalized via `handle.trim_start_matches('$')`, `RT4-19`). Every `pty_write` input string is parsed through the **Tree-sitter Bash AST Classifier (`SEC-POL-004`)** before writing to the PTY master FD (`ST-14`), preventing an open shell PTY from bypassing R3/R5 command policy.
- **PID-1 Init Reaper & `2,000ms` Kill Grace Period (`TL-SHL-002`, Fixing `RT9-04`)**: On Linux (`S2`), PID 1 inside `CLONE_NEWPID` runs `run_pid1_init_reaper_for_pid2` (installing `SIGTERM`/`SIGINT`/`SIGHUP` handlers, spawning the target command as PID 2 in its own process group `setpgid(0, 0)`, forwarding signals to `-child_pid`, and reaping orphan grandchildren via `waitpid(-1, ...)`). On `timeout_ms` or `CancellationToken` cancellation, `kin-sandbox` sends `SIGTERM` to the process group, waits `kill_grace_period_ms = 2000` (`2,000ms`), and then sends `SIGKILL` to the namespace supervisor.

### 2.1 Canonical Scrubbed Child Environment Block (`SEC-ENV-001`, Fixing `RT6-08`)

Every child process spawned by `kin-sandbox` (`shell_exec`, `pty_open`, `GitCmd`, hooks, and `stdio` MCP servers) starts from `Command::env_clear()` (or an explicit UTF-16 `env_block_utf16` on Windows, `RT4-04`) populated **only** with the deterministic keys below:

| Environment Variable | POSIX Value (`macOS S2` / `Linux S2` / `Windows S3 WSL2`) | Native Windows Value (`Windows S1` / `S3 AppContainer` UTF-16 `env_block_utf16`) | Security & Isolation Purpose |
| :--- | :--- | :--- | :--- |
| `HOME` / `USERPROFILE` | `HOME=$LANE_TMP_DIR/home` | `USERPROFILE=%LANE_TMP_DIR%\home`, `HOME=%LANE_TMP_DIR%\home` | Prevents tools from reading/polluting the host user's `$HOME` / `%USERPROFILE%` dotfiles |
| `TMPDIR` / `TMP` / `TEMP` | `TMPDIR=$LANE_TMP_DIR` | `TMP=%LANE_TMP_DIR%`, `TEMP=%LANE_TMP_DIR%` | Confines temporary files to the per-lane ephemeral directory |
| `PATH` & `SystemRoot` | `PATH=<toolchain_ro_bins>:/usr/local/bin:/usr/bin:/bin` (`:` delimiter) | `PATH=<toolchain_ro_bins>;C:\Windows\System32;C:\Windows` (`;` delimiter), `SystemRoot=C:\Windows`, `COMSPEC=C:\Windows\System32\cmd.exe` | Exposes only verified read-only language toolchains and minimal OS system binaries |
| `LANG` / `LC_ALL` / `PYTHONUTF8` | `LANG=C.UTF-8`, `LC_ALL=C.UTF-8` | `LANG=en_US.UTF-8`, `PYTHONUTF8=1` (with `CP_UTF8` codepage `65001`) | Deterministic UTF-8 locale and console stream encoding across POSIX and native Windows |
| `TERM` / `CI` | `xterm-256color` / `true` | `xterm-256color` / `true` | Suppresses interactive pagers and color-breaking terminal probes |
| `GIT_TERMINAL_PROMPT` | `0` | `0` | Prevents Git from hanging on interactive credential prompts |
| `GIT_CONFIG_NOSYSTEM` / `GIT_CONFIG_GLOBAL` | `1` / `/dev/null` | `1` / `NUL` | Neutralizes host `/etc/gitconfig` and `~/.gitconfig` (`%USERPROFILE%\.gitconfig`) hooks/aliases (`AUD-18`) |
| `CARGO_TARGET_DIR` / `CARGO_HOME` | `$LANE_CACHE_DIR/cargo-target` / `$LANE_CACHE_DIR/cargo-home` | `%LANE_CACHE_DIR%\cargo-target` / `%LANE_CACHE_DIR%\cargo-home` | Per-lane isolated Rust build cache (`AUD-04`) |
| `UV_CACHE_DIR` / `PIP_CACHE_DIR` / `NPM_CONFIG_CACHE` | `$LANE_CACHE_DIR/uv` / `$LANE_CACHE_DIR/pip` / `$LANE_CACHE_DIR/npm` | `%LANE_CACHE_DIR%\uv` / `%LANE_CACHE_DIR%\pip` / `%LANE_CACHE_DIR%\npm` | Per-lane isolated Python and Node package caches (`AUD-04`) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | `http://kin-lane-<wkt_id>:<lane_proxy_token>@127.0.0.1:<lane_proxy_port>` (`127.0.0.1:18080` in Linux `CLONE_NEWNET`) / `127.0.0.1,localhost` | `http://kin-lane-<wkt_id>:<lane_proxy_token>@127.0.0.1:<lane_proxy_port>` / `127.0.0.1,localhost` | Routes HTTP/HTTPS traffic through `kin-egress` with per-lane `Proxy-Authorization` (`INV-015`, `SEC-EGR-002`, `RT9-06`; kernel-enforced in `S2`/`S3`, advisory with `R3 ASK_HUMAN` gate in Windows `S1`) |
| `<ALLOWED_ENV_VAR>` | Resolved from OS Keychain via normalized `secret_env_handles` (`RT4-19`) | Resolved from Windows Credential Manager via normalized `secret_env_handles` (`RT4-19`) | Injects only explicitly granted secrets (`allowed_tools` in `.kin/kin.toml`) |

### 2.2 Warm LSP Multiplexer & MCP Daemon Resource Caps & Idle Eviction (`ENV-LSP-001`, Fixing `RT7-07`)

To prevent background language servers (`rust-analyzer`, `vtsls`, `basedpyright-langserver`) or `stdio` MCP servers from exhausting host RAM:

- **Concurrency & RSS Ceiling**: `kin-lsp` spawns at most `max_warm_lsp_servers_per_project = 2` inside `S2-Lane-Exec`, each bounded by an OS process memory cap of `max_lsp_rss_mb = 1536` (`1.5 GiB` via `RLIMIT_AS` / Win32 Job Object).
- **Idle Eviction & Auto-Restart**: Any warm LSP or `stdio` MCP server that receives no requests for `lsp_idle_timeout_secs = 900` (`15 minutes`) is gracefully shut down (`shutdown` -> `exit` -> `SIGKILL` after `2s`) so idle projects consume `< 180 MB` RSS (`NFR-PERF-007`).

### 2.3 Verified Read-Only Toolchain Discovery & Mount Contract (`ENV-TCN-001`, Fixing `RT8-07`)

Before exposing any host language toolchain directory (`~/.rustup`, `~/.cargo/bin`, `~/.nvm/versions`, `~/.local/share/uv`, `/opt/homebrew`, `/nix/store` on POSIX; `%USERPROFILE%\.rustup`, `%USERPROFILE%\.cargo\bin`, `%LOCALAPPDATA%\Programs\Git\cmd`, `%LOCALAPPDATA%\uv` on native Windows) inside `S2-Lane-Exec` / `S1`:

1. **Ownership & Permission Verification**: On POSIX, `kin-sandbox` calls `lstat(2)` on the directory and its parent: it rejects any symlink at the root mount point, verifies `st_uid == geteuid() || st_uid == 0`, and verifies that neither group-write nor world-write bits are set (`(st_mode & 0o022) == 0`). On native Windows, `kin-sandbox` checks `GetFileAttributesW` to reject reparse points (`FILE_ATTRIBUTE_REPARSE_POINT`) and inspects the DACL via `GetNamedSecurityInfoW` to verify that only `SYSTEM`, `Administrators`, `TrustedInstaller`, and the current user SID hold write ACEs (`FILE_WRITE_DATA | FILE_APPEND_DATA | WRITE_DAC | WRITE_OWNER`).
2. **Read-Only Code + Writable Per-Lane Cache Split**: Verified toolchain directories are mounted **strictly read-only** (`ro_access` in Landlock / `(allow file-read* ...)` in Seatbelt), while `CARGO_HOME`, `CARGO_TARGET_DIR`, `UV_CACHE_DIR`, `PIP_CACHE_DIR`, and `NPM_CONFIG_CACHE` point to `$LANE_CACHE_DIR` (`SEC-ENV-001`). Consequently, sandboxed builds can compile and cache dependencies at native speed without ever being able to mutate host compiler binaries (`~/.cargo/bin/*`) to persist a backdoor across runs.

## 3. Two-Phase Mode-Preserving Crash-Safe Root Application & Worktree Pruning (`WT-MRG-*`, Fixing `ST-41`, `RT4-09`, `RT4-27`, `RT7-05`)

When a lane passes `[gates].merge_commands` in `wkt_verify` and the operator (or `FULL_ACCESS` policy) approves **Apply to Root**:

1. **Two-Phase Ledger Intent BEFORE Effect (`INV-004`, `ST-41`, `RT4-09`)**:
   - Append `lane.apply.intent` to `ledger_events` (`synchronous = FULL`) and insert `apply_journals` with `state = 'prepared'`, `intent_ledger_seq`, and `operations_json`:
     `{ "created_dirs": ["crates/new_crate/src", ...], "file_ops": [{ "rel_path": "...", "op": "Create"|"Modify"|"Delete"|"Symlink", "file_mode_octal": "0755"|"0644", "symlink_target": null, "pre_blake3": "...", "pre_backup_blob_hash": "...", "post_blake3": "...", "staged_blob_hash": "..." }] }` (`RT4-09`).
2. **Handle-Relative `cap-std` Subdirectory Creation, Staging & `O_NOFOLLOW` Verification (`ST-41`, `RT4-09`)**:
   - Open `<root_path>` via `cap_std::fs::Dir`.
   - **Create Missing Parent Directories (`RT4-09.1`)**: Iterate `operations_json.created_dirs` in topological parent-first order, verifying no path component is a symlink (`O_NOFOLLOW`), and call `root_dir.create_dir_all(rel_dir)` so staging new files in newly introduced subdirectories never fails with `ENOENT`.
   - For every entry in `operations_json.file_ops`:
     - If `op` is `"Modify"` or `"Delete"`, open the existing target with `O_NOFOLLOW`, verify its BLAKE3 still equals `pre_blake3` (aborting to `rolled_back` and pruning `created_dirs` if the user edited the file concurrently), and archive its pre-apply bytes and mode in `blobs/<pre_backup_blob_hash>`.
     - If `op` is `"Create"`, `"Modify"`, or `"Symlink"`, materialize `staged_blob_hash` to `<dir>/.kin-apply-<apj_id>-<idx>.tmp`, set exact permissions (`chmod 0755` if executable bit set in Git tree mode `100755`, else `0644`; or `symlink()` for `120000`), and `fsync` the temp file.
3. **Commit Point (`state = 'committing'`), `Delete` Unlink & Failure Escape Path (`ST-41`, `RT4-09.2`, `RT7-05`)**:
   - Flip `apply_journals.state = 'committing'` (`synchronous = FULL`, validated by SQLite trigger `trg_apply_journals_state_machine`, `KIN-WKT-0003`).
   - For each operation in `file_ops`:
     - For `op IN ("Create", "Modify", "Symlink")`: execute `root_dir.rename(tmp_rel_path, &root_dir, rel_path)` and `fsync` the parent directory handle.
     - For `op == "Delete"` (`RT4-09.2`): execute `root_dir.remove_file(rel_path)` and `fsync` the parent directory handle.
   - **Failure Escape Path (`failed_needs_revert`, `ST-41`, `RT4-09`)**: If an OS error prevents committing operation $k$, `kin-lanes` immediately restores operations $0..k-1$ from `pre_backup_blob_hash` (re-creating any unlinked `Delete` files and unlinking any newly created files), removes `created_dirs` in reverse depth order via `root_dir.remove_dir(rel_dir)` if empty, transitions `apply_journals.state = 'rolled_back'` (or `'failed_needs_revert'` if restoration itself hits a lock), and logs `lane.apply.outcome(failed)`.
   - On success, flip `apply_journals.state = 'committed'` and log `lane.apply.outcome(succeeded)` to `ledger_events`.
4. **Deterministic Worktree Removal & Pruning on Lane Retirement (`WT-MRG-004`, Fixing `RT4-27`)**:
   - Whenever `worktree_lanes.status` transitions to a terminal state (`merged` or `discarded`), `kin-lanes` terminates any remaining lane PTYs (`pty_kill`) and executes:

```bash
git --git-dir="$REPO_GIT" worktree remove --force "$WORKTREE_PATH"
git --git-dir="$REPO_GIT" worktree prune --expire=now
git --git-dir="$REPO_GIT" branch -D "$BRANCH_NAME"
```

   - This guarantees `$WORKTREE_PATH`, `$LANE_TMP_DIR`, and `repo.git/worktrees/<wkt_id>` metadata/locks are deterministically reclaimed with zero administrative leak (`RT4-27`).

## 4. Cycle-Checked Task DAG & Topological Promotion Algorithm (`TSK-DAG-001`, Fixing `ST-31` & `RT4-14`)

1. **Database-Level Cycle Prevention on Both `INSERT` and `UPDATE` (`ST-20`, `ST-31`, `RT4-14`)**: `trg_task_deps_no_cycle` (DOC-02 §4) runs a recursive CTE on every `INSERT INTO task_dependencies(task_id, depends_on_task_id)` and aborts with `KIN-TSK-0001` if `task_id` is reachable from `depends_on_task_id`, while `trg_task_deps_no_update` rejects any `UPDATE ON task_dependencies` with `KIN-TSK-0002` so cycles can never be introduced via `UPDATE`.
2. **Atomic Topological Promotion Transaction (`TSK-DAG-002`, `ST-31`)**: When task $T$ transitions to `status = 'done'` (after passing its `verification_mode` contract), `kin-tasks` executes inside the **same** SQLite `BEGIN IMMEDIATE` transaction:

```sql
UPDATE tasks
   SET status = 'ready',
       updated_at_us = :now_us
 WHERE status = 'blocked'
   AND id IN (
       SELECT td.task_id
         FROM task_dependencies td
        WHERE td.depends_on_task_id = :completed_task_id
   )
   AND NOT EXISTS (
       SELECT 1
         FROM task_dependencies td2
         JOIN tasks dep ON dep.id = td2.depends_on_task_id
        WHERE td2.task_id = tasks.id
          AND dep.status != 'done'
   )
RETURNING id, assigned_agent_id, channel_id, thread_id, tainted;
```

For every newly promoted `ready` task returned, `kin-tasks` enqueues a `wake_queue` entry (`trigger_kind = 'task_ready'`, propagating `tainted`).

## 5. Multi-Provider Gateway Resilience & Matryoshka Embedding Normalization (`GW-RES-001`, Fixing `ST-30`, `ST-42` & `RT4-26`)

1. **Dynamic Model Catalog Resolution (`ST-42`)**: Semantic slots (`flagship`, `planner`, `coder`, `fast_research`, `fast_tool`, `guard`, `embedding`, `local_offline`) resolve against `registry.db::model_catalog` (seeded with current provider models and updatable via Settings or `kin models sync` without code changes).
2. **Matryoshka Embedding Dimension Truncation & L2 Normalization (`GW-EMB-001`, Fixing `RT4-26`)**:
   - Bundled ONNX models (`bge-small-en-v1.5-q8.onnx` and `multilingual-e5-small-q8.onnx`) emit native 384-dimensional `f32` vectors (`1,536` bytes).
   - When an operator configures the `embedding` slot to use an external Ollama/OpenAI model returning 768-dim (`3,072` bytes) or 1,536-dim (`6,144` bytes) vectors:
     - Relational `BLOB` columns (`agents.role_embedding_f32`, `threads.topic_embedding`, `memory_items.embedding_f32`, `code_chunks.embedding_f32`) accept `length(embedding_f32) IN (1536, 3072, 6144)` (`RT4-26`).
     - Before indexing into `memory_vec` or `code_chunks_vec` (`float[384]`), `kin-index` and `kin-memory` slice the leading 384 Matryoshka dimensions (`v[0..384]`) and L2-normalize the slice ($\hat{v}_i = v_i / \max(\|\mathbf{v}_{0..384}\|_2, 10^{-12})$), guaranteeing 100% compatibility with `sqlite-vec` `float[384]` partition tables.
3. **HTTP 429 / 503 / 529 Retry & Full-Jitter Backoff (`GW-RES-001`, `ST-30`)**:
   - On HTTP 429 (Rate Limit), 503, or 529 (Overloaded) before any non-idempotent tool side effect:
     - Honor provider `Retry-After` / `x-ratelimit-reset-tokens` header if present and $\le 30\text{s}$.
     - Otherwise compute full-jitter exponential backoff:
       $$t_{\text{sleep}}(a) = \text{Uniform}\Big(0,\; \min\big(30\text{s},\; 0.5\text{s} \cdot 2^{a}\big)\Big), \quad a \in \{0, 1, 2\}$$
4. **Circuit-Breaker & Cross-Provider Failover (`GW-RES-002`, `ST-30`)**:
   - After 3 consecutive transient failures on `provider_profiles.id`, `circuit_state` transitions `closed -> open` with `cooldown_until_us = now_us + 60_000_000` (`60s`), and `kin-gateway` automatically routes the request to the next model in the slot's fallback chain, stripping provider-specific `Part::Opaque` blocks when crossing provider families.

## 6. Dedicated `kin-browser` CDP Automation, Egress Hardening & Zero-Capture Takeover Fence (`BRW-CDP-001..004`, Fixing `RT9-10`)

1. **Isolated Per-Project Profile & Mandatory `kin-egress` Proxy Flags (`BRW-CDP-001`)**:
   - `kin-browser` launches a dedicated Chromium instance per project using `chromiumoxide` with:
     - `--user-data-dir=$KIN_HOME/projects/<prj_id>/browser-profile`
     - `--proxy-server=http://127.0.0.1:<lane_proxy_port>` (authenticated to `kin-egress` via `SEC-EGR-002`)
     - `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"` (preventing local DNS resolution bypass and forcing all DNS lookups through `KinDnsResolver`)
     - `--disable-quic` (disabling UDP QUIC/HTTP3 so UDP traffic cannot bypass the TCP HTTP proxy)
     - `--proxy-bypass-list=<-loopback>` (forcing even localhost requests from Chromium through `kin-egress`)
     - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` and `--webrtc-ip-handling-policy=disable_non_proxied_udp` (preventing WebRTC STUN/TURN UDP leaks)
2. **Accessibility-Tree Snapshot & Taint Marking (`BRW-CDP-002`)**:
   - Every `browser_act` invocation (`navigate`, `snapshot`, `click`, `type`, `request_takeover`) marks `runs.tainted = 1` (pre-marked across the step batch per `RT4-16`) and wraps all extracted AXTree/DOM text in `<untrusted_content nonce="...">`.
3. **Zero-Capture Human Takeover Fence (`BRW-CDP-003`, `AUD-17`)**:
   - When `browser_act(action = "request_takeover")` is invoked (or a login/MFA/CAPTCHA wall is encountered), `kin-harness` transitions the run to `waiting_takeover` and **immediately detaches/suspends all CDP `Page.screencastFrame`, `DOM.getDocument`, `Network.getResponseBody`, and `Runtime.evaluate` observers** so zero keystrokes, passwords, or session cookies are captured while the human operator interacts with the browser.
4. **Pre-Hand-Back DOM Scrubbing (`BRW-CDP-004`)**:
   - When the human operator clicks **Hand Back to Agent** (`EngineCommand::BrowserTakeoverResolve { action: TakeoverAction::HandBackToAgent }`), `kin-browser` executes a pre-resume sanitizer in the page context that clears `.value = ""` on all `input[type="password"]`, `input[autocomplete="one-time-code"]`, and hidden credential fields and flushes the CDP network capture buffer before re-attaching agent CDP observers and transitioning the run to `preparing`.
