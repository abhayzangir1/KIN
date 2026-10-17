# KIN Data Model Specification

**Document ID:** `KIN-DAT-10.0-PROD`  
**System Name:** KIN — Sovereign Local-First Autonomous Multi-Agent AI Workforce & Harness  
**Version:** `10.0.0-PRODUCTION`  
**Status:** Canonical Database Schemas, Verified SQLite `STRICT` DDL & Triggers  

---

## 1. The 4-Database Storage Architecture

KIN enforces a disciplined, segregated four-database storage architecture to optimize for concurrency, zero-write isolation, vector search performance, and cryptographic shredding:

```text
$KIN_HOME/
├── registry.db                 [DB 1: Global Registry Database (Plaintext/WAL)]
│   └── Projects, credentials metadata, provider configurations, global settings
│
└── projects/<project_id>/
    ├── project.db              [DB 2: Project Operational Database (SQLCipher Encrypted)]
    │   └── Agents, channels, DMs, messages, runs, tools, tasks, goals, memories, ledger
    │
    ├── index.db                [DB 3: Code Intelligence & Vector DB (SQLCipher Encrypted)]
    │   └── Code chunks, symbols, call-graph edges, PageRank scores, sqlite-vec vec0 tables
    │
    └── blobs/                  [DB 4: Content-Addressed Blob Storage (XChaCha20 AEAD)]
        └── *.zst.enc: Large terminal outputs, browser screenshots, spilled tool payloads
```

### 1.1 Storage Roles & Encryption Invariants
1. **Global Registry (`registry.db`):** Unencrypted on disk, protected by OS permissions (`0600`). Stores non-secret global state, project metadata, and external model provider listings. It **never** stores plaintext API keys or project master keys.
2. **Project Operational Store (`project.db`):** Fully encrypted via SQLCipher using `PDK_prj` (AES-256-CBC with 256,000 PBKDF2 iterations). Enforces SQLite `STRICT` mode, foreign keys, and recursive immutability triggers.
3. **Code Intelligence Index (`index.db`):** Fully encrypted via SQLCipher under `PDK_prj`. Stores AST chunk mappings, symbol graphs, and dense vector embeddings (`sqlite-vec` `vec0`). Encrypting `index.db` prevents proprietary code snippets from being exposed in plaintext.
4. **Encrypted Blob Store (`blobs/`):** Files are compressed with Zstandard (`zstd`) and encrypted using XChaCha20-Poly1305 under `PBK_prj`. Content-addressed by BLAKE3 hash.

---

## 2. Global Registry DDL (`$KIN_HOME/registry.db`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- Track global schema migrations
CREATE TABLE schema_migrations (
    version         INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    checksum_blake3 TEXT NOT NULL CHECK (length(checksum_blake3) = 64),
    applied_at_us   INTEGER NOT NULL
) STRICT;

-- Registered projects on this local machine
CREATE TABLE projects (
    id                      TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'prj_[0-9A-HJKMNP-TV-Z]*'),
    slug                    TEXT NOT NULL UNIQUE,
    display_name            TEXT NOT NULL,
    root_path               TEXT NOT NULL UNIQUE,
    state_dir               TEXT NOT NULL UNIQUE,
    trust_state             TEXT NOT NULL CHECK (trust_state IN ('untrusted', 'trusted', 'restricted')),
    trusted_config_hash     TEXT,
    autonomy_ceiling        TEXT NOT NULL DEFAULT 'AUTO' CHECK (autonomy_ceiling IN ('READ_ONLY', 'WORKTREE_AUTO', 'AUTO', 'FULL_ACCESS')),
    max_agents_cap          INTEGER NOT NULL DEFAULT 24 CHECK (max_agents_cap BETWEEN 1 AND 64),
    pmk_fingerprint_blake3  TEXT NOT NULL CHECK (length(pmk_fingerprint_blake3) = 64),
    ledger_pubkey_hex       TEXT NOT NULL CHECK (length(ledger_pubkey_hex) = 64),
    shredded                INTEGER NOT NULL DEFAULT 0 CHECK (shredded IN (0, 1)),
    shredded_at_us          INTEGER,
    created_at_us           INTEGER NOT NULL,
    updated_at_us           INTEGER NOT NULL
) STRICT;

-- Global settings and provider defaults
CREATE TABLE global_settings (
    key             TEXT PRIMARY KEY,
    value_json      TEXT NOT NULL,
    updated_at_us   INTEGER NOT NULL
) STRICT;

-- Provider configuration and OS Keychain secret handles (NO PLAINTEXT SECRETS)
CREATE TABLE provider_credentials (
    provider_id     TEXT PRIMARY KEY, -- 'anthropic', 'openai', 'gemini', 'openrouter', 'ollama'
    keychain_handle TEXT NOT NULL,    -- Handle referencing OS Keychain entry
    base_url        TEXT,             -- Optional custom proxy/endpoint
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at_us   INTEGER NOT NULL
) STRICT;
```

---

## 3. Project Operational Database DDL (`$KIN_HOME/projects/<id>/project.db`)

### 3.1 Workforce & Channel Architecture

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA recursive_triggers = ON;
PRAGMA busy_timeout = 5000;

-- Agents registered in the project
CREATE TABLE agents (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'agt_[0-9A-HJKMNP-TV-Z]*'),
    slug                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    role_kind           TEXT NOT NULL CHECK (role_kind IN ('boss', 'specialist', 'subagent')),
    role_title          TEXT NOT NULL,
    system_prompt       TEXT NOT NULL,
    model_override      TEXT,
    owned_globs_json    TEXT NOT NULL DEFAULT '[]', -- JSON array of file globs
    capabilities_json   TEXT NOT NULL DEFAULT '[]', -- JSON array of capability tags
    parent_agent_id     TEXT REFERENCES agents(id),
    spawn_depth         INTEGER NOT NULL DEFAULT 0 CHECK (spawn_depth BETWEEN 0 AND 2),
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL
) STRICT;

-- Unique partial index enforcing exactly one @boss per project
CREATE UNIQUE INDEX idx_agents_single_boss ON agents (role_kind) WHERE role_kind = 'boss';

-- Communication channels
CREATE TABLE channels (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'chn_[0-9A-HJKMNP-TV-Z]*'),
    slug                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    topic               TEXT NOT NULL DEFAULT '',
    is_default          INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    is_archived         INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL
) STRICT;

-- Multi-channel coworker membership (enables cross-department mobility)
CREATE TABLE channel_members (
    channel_id          TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    enrolled_at_us      INTEGER NOT NULL,
    PRIMARY KEY (channel_id, agent_id)
) STRICT;

-- Confidential 1-on-1 Direct Message threads
CREATE TABLE direct_messages (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'dms_[0-9A-HJKMNP-TV-Z]*'),
    participant_a       TEXT NOT NULL, -- Either agent_id or 'operator'
    participant_b       TEXT NOT NULL, -- Must be agent_id
    consecutive_turns   INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_turns BETWEEN 0 AND 4),
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL,
    -- Canonical ordering: participant_a < participant_b enforces uniqueness
    CHECK (participant_a < participant_b),
    UNIQUE (participant_a, participant_b)
) STRICT;
```

### 3.2 Messages & Communication Archive

```sql
CREATE TABLE messages (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'msg_[0-9A-HJKMNP-TV-Z]*'),
    channel_id          TEXT REFERENCES channels(id),
    dm_id               TEXT REFERENCES direct_messages(id),
    thread_id           TEXT REFERENCES messages(id),
    sender_kind         TEXT NOT NULL CHECK (sender_kind IN ('operator', 'agent', 'system')),
    sender_id           TEXT NOT NULL, -- agent_id or 'operator'
    msg_kind            TEXT NOT NULL DEFAULT 'chat' CHECK (msg_kind IN ('chat', 'meeting_turn', 'meeting_minutes', 'announcement', 'blocker')),
    content_md          TEXT NOT NULL,
    mentions_json       TEXT NOT NULL DEFAULT '[]', -- Array of agent slugs or '@all'
    tainted             INTEGER NOT NULL DEFAULT 0 CHECK (tainted IN (0, 1)),
    created_at_us       INTEGER NOT NULL,
    -- Message must belong to either a channel or a DM, but not both
    CHECK ((channel_id IS NOT NULL AND dm_id IS NULL) OR (channel_id IS NULL AND dm_id IS NOT NULL))
) STRICT;

CREATE VIRTUAL TABLE messages_fts USING fts5(
    content_md,
    content='messages',
    content_rowid='rowid'
);
```

### 3.3 Harness Execution, Runs, Steps & Tool Calls

```sql
-- Execution runs
CREATE TABLE runs (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'run_[0-9A-HJKMNP-TV-Z]*'),
    agent_id            TEXT NOT NULL REFERENCES agents(id),
    task_id             TEXT, -- Optional link to Task DAG
    worktree_id         TEXT NOT NULL, -- Dedicated worktree lane
    status              TEXT NOT NULL CHECK (status IN (
                            'queued', 'preparing', 'streaming_model', 'evaluating_policy',
                            'waiting_approval', 'waiting_takeover', 'waiting_subagent',
                            'waiting_recovery', 'executing_tools', 'verifying_completion',
                            'compacting', 'completed', 'cancelled', 'failed', 'budget_exceeded'
                        )),
    tainted             INTEGER NOT NULL DEFAULT 0 CHECK (tainted IN (0, 1)),
    parent_run_id       TEXT REFERENCES runs(id),
    total_tokens_in     INTEGER NOT NULL DEFAULT 0,
    total_tokens_out    INTEGER NOT NULL DEFAULT 0,
    spend_micro_usd     INTEGER NOT NULL DEFAULT 0,
    error_code          TEXT,
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL
) STRICT;

-- Individual reasoning steps within a run
CREATE TABLE run_steps (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'stp_[0-9A-HJKMNP-TV-Z]*'),
    run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_number         INTEGER NOT NULL,
    prompt_tokens       INTEGER NOT NULL,
    completion_tokens   INTEGER NOT NULL,
    thinking_content    TEXT, -- Extended reasoning tokens
    model_name          TEXT NOT NULL,
    created_at_us       INTEGER NOT NULL,
    UNIQUE (run_id, step_number)
) STRICT;

-- Individual tool execution records
CREATE TABLE tool_calls (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'tcl_[0-9A-HJKMNP-TV-Z]*'),
    run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_id             TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
    tool_name           TEXT NOT NULL,
    input_json          TEXT NOT NULL,
    output_preview      TEXT,
    spilled_blob_blake3 TEXT CHECK (spilled_blob_blake3 IS NULL OR length(spilled_blob_blake3) = 64),
    status              TEXT NOT NULL CHECK (status IN ('invoked', 'executing', 'completed', 'failed', 'blocked')),
    duration_ms         INTEGER NOT NULL DEFAULT 0,
    is_mutating         INTEGER NOT NULL CHECK (is_mutating IN (0, 1)),
    created_at_us       INTEGER NOT NULL,
    completed_at_us     INTEGER
) STRICT;

-- Human approval requests
CREATE TABLE approval_requests (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'apr_[0-9A-HJKMNP-TV-Z]*'),
    run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    tool_call_id        TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
    risk_level          TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    action_summary      TEXT NOT NULL,
    decision            TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'denied')),
    resolved_by         TEXT,
    resolved_at_us      INTEGER,
    created_at_us       INTEGER NOT NULL
) STRICT;
```

### 3.4 Goals, Task DAG Engine & Autonomous Meetings

```sql
-- High-level project goals
CREATE TABLE goals (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'gol_[0-9A-HJKMNP-TV-Z]*'),
    title               TEXT NOT NULL,
    description_md      TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
    meeting_id          TEXT,
    decision_record_md  TEXT,
    budget_micro_usd    INTEGER NOT NULL DEFAULT 0,
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL
) STRICT;

-- Directed Acyclic Graph (DAG) Tasks
CREATE TABLE tasks (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'tsk_[0-9A-HJKMNP-TV-Z]*'),
    goal_id             TEXT REFERENCES goals(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description_md      TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'claimed', 'in_progress', 'review', 'completed', 'failed')),
    assigned_agent_id   TEXT REFERENCES agents(id),
    lease_run_id        TEXT REFERENCES runs(id),
    lease_expires_at_us INTEGER,
    epoch               INTEGER NOT NULL DEFAULT 1, -- Optimistic concurrency control fencing
    tainted             INTEGER NOT NULL DEFAULT 0 CHECK (tainted IN (0, 1)),
    verification_mode   TEXT NOT NULL DEFAULT 'checks' CHECK (verification_mode IN ('none', 'self_attested', 'checks', 'reviewer', 'human')),
    result_summary_md   TEXT,
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL
) STRICT;

-- DAG task dependency relationships
CREATE TABLE task_dependencies (
    task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    PRIMARY KEY (task_id, depends_on_task_id),
    CHECK (task_id != depends_on_task_id)
) STRICT;

-- Autonomous meetings
CREATE TABLE meetings (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'mtg_[0-9A-HJKMNP-TV-Z]*'),
    channel_id          TEXT NOT NULL REFERENCES channels(id),
    agenda              TEXT NOT NULL,
    mode                TEXT NOT NULL CHECK (mode IN ('moderated', 'round_robin', 'debate', 'design_review')),
    participants_json   TEXT NOT NULL, -- Array of 2 to 6 agent IDs
    max_rounds          INTEGER NOT NULL DEFAULT 3 CHECK (max_rounds BETWEEN 1 AND 6),
    current_round       INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL CHECK (status IN ('in_progress', 'concluded', 'aborted')),
    decision_record_md  TEXT,
    created_at_us       INTEGER NOT NULL,
    ended_at_us         INTEGER
) STRICT;
```

### 3.5 4-Tier Cognitive Memory Subsystem

```sql
CREATE TABLE memory_items (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'mem_[0-9A-HJKMNP-TV-Z]*'),
    tier                TEXT NOT NULL CHECK (tier IN ('T1', 'T2', 'T3', 'T4')),
    scope_id            TEXT NOT NULL, -- 'project', channel_id, agent_id, or dm_id
    bank                TEXT NOT NULL CHECK (bank IN ('world', 'experience', 'opinion', 'procedure')),
    subject_key         TEXT NOT NULL,
    claim_text          TEXT NOT NULL,
    confidence          REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0.0 AND 1.0),
    is_quarantined      INTEGER NOT NULL DEFAULT 0 CHECK (is_quarantined IN (0, 1)),
    valid_from_us       INTEGER NOT NULL,
    valid_to_us         INTEGER, -- Bi-temporal validity
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_memory_items_lookup ON memory_items (tier, scope_id, bank, subject_key);

CREATE TABLE memory_links (
    source_mem_id       TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
    target_mem_id       TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
    relation            TEXT NOT NULL,
    weight              REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY (source_mem_id, target_mem_id, relation)
) STRICT;
```

### 3.6 Worktree Merges & Cryptographic Audit Ledger

```sql
-- Worktree apply and merge journal
CREATE TABLE apply_journals (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'apj_[0-9A-HJKMNP-TV-Z]*'),
    run_id              TEXT NOT NULL REFERENCES runs(id),
    worktree_id         TEXT NOT NULL,
    base_commit_sha     TEXT NOT NULL,
    merge_commit_sha    TEXT NOT NULL,
    files_changed_count INTEGER NOT NULL,
    diff_patch_blob     TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('applied', 'reverted')),
    applied_at_us       INTEGER NOT NULL,
    reverted_at_us      INTEGER
) STRICT;

-- Monotonic append-only cryptographic audit ledger
CREATE TABLE ledger_events (
    seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id            TEXT NOT NULL UNIQUE CHECK (length(event_id) = 30 AND event_id GLOB 'ldg_[0-9A-HJKMNP-TV-Z]*'),
    ts_us               INTEGER NOT NULL,
    prev_hash_blake3    TEXT NOT NULL CHECK (length(prev_hash_blake3) = 64),
    event_kind          TEXT NOT NULL,
    entity_id           TEXT NOT NULL,
    payload_json        TEXT NOT NULL,
    hash_blake3         TEXT NOT NULL CHECK (length(hash_blake3) = 64)
) STRICT;

-- Cryptographically signed ledger checkpoints
CREATE TABLE ledger_checkpoints (
    seq                 INTEGER PRIMARY KEY,
    head_hash_blake3    TEXT NOT NULL CHECK (length(head_hash_blake3) = 64),
    events_count        INTEGER NOT NULL,
    signature_ed25519   TEXT NOT NULL CHECK (length(signature_ed25519) = 128),
    created_at_us       INTEGER NOT NULL
) STRICT;
```

---

## 4. Code Intelligence Database DDL (`$KIN_HOME/projects/<id>/index.db`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

-- Code chunks extracted by Tree-sitter
CREATE TABLE code_chunks (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 30 AND id GLOB 'chk_[0-9A-HJKMNP-TV-Z]*'),
    file_path           TEXT NOT NULL,
    start_line          INTEGER NOT NULL,
    end_line            INTEGER NOT NULL,
    language            TEXT NOT NULL,
    chunk_text          TEXT NOT NULL,
    content_blake3      TEXT NOT NULL CHECK (length(content_blake3) = 64),
    pagerank_score      REAL NOT NULL DEFAULT 1.0,
    updated_at_us       INTEGER NOT NULL
) STRICT;

CREATE VIRTUAL TABLE code_chunks_fts USING fts5(
    file_path,
    chunk_text,
    content='code_chunks',
    content_rowid='rowid'
);

-- sqlite-vec dense vector table for semantic code search (384 dimensions)
CREATE VIRTUAL TABLE vec_code_chunks USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding float[384] distance_metric=cosine
);
```

---

## 5. Database Triggers & Invariant Enforcement

```sql
-- 1. Prevent modification or deletion of finalized audit ledger events
CREATE TRIGGER trg_ledger_immutable
BEFORE UPDATE OR DELETE ON ledger_events
BEGIN
    SELECT RAISE(FAIL, 'KIN-LDG-0002: ledger_events is an append-only immutable table');
END;

-- 2. Prevent modification or deletion of sent messages
CREATE TRIGGER trg_messages_immutable
BEFORE UPDATE OR DELETE ON messages
BEGIN
    SELECT RAISE(FAIL, 'KIN-HIS-0002: messages archive is immutable');
END;

-- 3. Propagate taint from a tainted run to all messages it generates
CREATE TRIGGER trg_messages_propagate_run_taint
BEFORE INSERT ON messages
WHEN NEW.sender_kind = 'agent'
BEGIN
    UPDATE messages SET tainted = 1
    WHERE id = NEW.id
      AND EXISTS (SELECT 1 FROM runs WHERE id = NEW.sender_id AND tainted = 1);
END;

-- 4. Propagate taint from a child subagent to its parent run
CREATE TRIGGER trg_runs_propagate_child_taint_to_parent
AFTER UPDATE OF tainted ON runs
WHEN NEW.tainted = 1 AND NEW.parent_run_id IS NOT NULL
BEGIN
    UPDATE runs SET tainted = 1 WHERE id = NEW.parent_run_id;
END;

-- 5. Foreign key and canonical participant order validation for Direct Messages
CREATE TRIGGER trg_dm_validate_refs
BEFORE INSERT ON direct_messages
BEGIN
    SELECT CASE
        WHEN NEW.participant_a = NEW.participant_b THEN
            RAISE(ABORT, 'KIN-COM-0001: DM participants must be distinct')
        WHEN NEW.participant_a >= NEW.participant_b THEN
            RAISE(ABORT, 'KIN-COM-0001: DM participants must follow canonical ordering (a < b)')
    END;
END;
```
