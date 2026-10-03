-- ============================================================================
-- KIN CORE — AUTHORITATIVE SQLITE DATABASE SCHEMA
-- Version: 1.0 (Production Baseline)
-- ============================================================================

-- Workspaces & Projects
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    default_autonomy_mode TEXT NOT NULL CHECK (default_autonomy_mode IN ('AUTO', 'ALWAYS_ASK', 'FULL_ACCESS')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Agent Personas & Definitions
CREATE TABLE IF NOT EXISTS agent_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    default_model_id TEXT NOT NULL,
    domain_authority_json TEXT NOT NULL DEFAULT '[]',
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
);

-- Agent Persistent Identities (Explicit User-Configured Models)
CREATE TABLE IF NOT EXISTS agent_identities (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    definition_id TEXT NOT NULL REFERENCES agent_definitions(id),
    display_name TEXT NOT NULL COLLATE NOCASE,
    avatar_url TEXT,
    active_model_id TEXT NOT NULL,
    fallback_model_id TEXT,
    is_orchestrator BOOLEAN NOT NULL DEFAULT 0,
    is_ephemeral BOOLEAN NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, display_name COLLATE NOCASE)
);

-- Agent Runs & Execution Lifecycle
CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
    task_id TEXT,
    channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    trigger_message_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('created', 'queued', 'running', 'waiting_for_tool', 'waiting_for_approval', 'waiting_for_agent', 'waiting_for_model', 'quota_paused', 'resuming', 'recovering', 'paused', 'completed', 'failed', 'cancelled')),
    worktree_path TEXT,
    heartbeat_at INTEGER NOT NULL,
    allocated_tokens INTEGER NOT NULL DEFAULT 0,
    used_tokens INTEGER NOT NULL DEFAULT 0,
    quota_resets_at INTEGER,
    interrupted_turn INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
);

-- Communication (Channels, DMs, Threads, Messages)
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    topic TEXT,
    is_private BOOLEAN NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, agent_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('human', 'agent', 'system')),
    content TEXT NOT NULL,
    parent_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    mentions_json TEXT NOT NULL DEFAULT '[]',
    productivity_score INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- Goals, Tasks & Dependencies
CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    acceptance_criteria_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'failed', 'cancelled')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    assigned_agent_id TEXT REFERENCES agent_identities(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('backlog', 'ready', 'assigned', 'running', 'blocked', 'review', 'completed', 'failed', 'cancelled')),
    verification_spec_json TEXT NOT NULL DEFAULT '{}',
    evidence_bundle_id TEXT,
    claimed_by_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
    lease_expires_at INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_task_id)
);

-- Architectural Decisions & Verification Evidence
CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    decided_by_id TEXT NOT NULL,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    alternatives_considered_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK (status IN ('proposed', 'authoritative', 'superseded', 'rejected')),
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('test_output', 'build_log', 'artifact_hash', 'human_signoff')),
    content_uri TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- Memory Fabric with Optimistic Concurrency Control (OCC)
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'workspace', 'project', 'team', 'channel', 'agent_private', 'task')),
    scope_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('semantic', 'episodic', 'procedural', 'decision', 'preference', 'working_state')),
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    evidence_ref TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(scope, scope_id, key)
);

CREATE TABLE IF NOT EXISTS memory_versions (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    value_json TEXT NOT NULL,
    updated_by_run_id TEXT,
    created_at INTEGER NOT NULL
);

-- Skills, Versions & Experience Records (Evidence-Driven Continuous Improvement)
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT NOT NULL,
    instructions TEXT NOT NULL,
    required_tools_json TEXT NOT NULL DEFAULT '[]',
    trigger_patterns_json TEXT NOT NULL DEFAULT '[]',
    is_built_in BOOLEAN NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'deprecated', 'disabled')),
    evidence_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_validated_at INTEGER,
    validator_ref TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_versions (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    description TEXT NOT NULL,
    instructions TEXT NOT NULL,
    trigger_patterns_json TEXT NOT NULL DEFAULT '[]',
    promoted_by TEXT NOT NULL,
    change_summary TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_experiences (
    id TEXT PRIMARY KEY,
    skill_id TEXT REFERENCES skills(id) ON DELETE SET NULL,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    tool_name TEXT,
    objective TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
    failure_reason TEXT,
    repair_strategy TEXT,
    lessons_learned TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
);

-- Models & Providers Library
CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'anthropic', 'gemini', 'custom')),
    base_url TEXT,
    api_key_ref TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    context_window INTEGER NOT NULL,
    max_output_tokens INTEGER NOT NULL,
    supports_tools BOOLEAN NOT NULL DEFAULT 1,
    supports_vision BOOLEAN NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- Policy, Approvals & Auditing
CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    action_payload_json TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    commit_sha TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS event_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    run_id TEXT,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL,
    worktree_commit_sha TEXT,
    created_at INTEGER NOT NULL
);

-- In-App Scheduler & Timed Autonomy (One-shot timers and recurring cron)
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_agent_id TEXT REFERENCES agent_identities(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('one_shot', 'cron')),
    prompt TEXT NOT NULL,
    duration_seconds INTEGER,
    cron_expression TEXT,
    timer_condition TEXT DEFAULT 'never',
    max_iterations INTEGER,
    current_iterations INTEGER DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled', 'expired')),
    next_run_at INTEGER NOT NULL,
    last_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Tool Execution Auditing & Action Records
CREATE TABLE IF NOT EXISTS action_records (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    agent_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    params_json TEXT NOT NULL,
    output_snippet TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'requires_approval', 'aborted')),
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- Optimistic Concurrency Control (OCC) File Revision Tracking
CREATE TABLE IF NOT EXISTS file_revisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    mtime INTEGER NOT NULL,
    last_modified_by TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, file_path)
);

-- High-performance indexes for fast lookups & constraint enforcement
CREATE INDEX IF NOT EXISTS idx_runs_heartbeat ON agent_runs(heartbeat_at) WHERE state = 'running';
CREATE INDEX IF NOT EXISTS idx_agent_runs_channel ON agent_runs(channel_id);
CREATE INDEX IF NOT EXISTS idx_action_records_run ON action_records(run_id);
CREATE INDEX IF NOT EXISTS idx_action_records_agent ON action_records(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_action_records_tool ON action_records(tool_name);
CREATE INDEX IF NOT EXISTS idx_file_revisions_project_path ON file_revisions(project_id, file_path);
CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_goal_status ON tasks(goal_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_scope_key ON memories(scope, scope_id, key);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_events_type_time ON event_journal(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at, status) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_project_name ON agent_identities(project_id, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_time ON agent_runs(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_channels_project ON channels(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent ON tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_reverse ON task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_schedules_project ON schedules(project_id, status);
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);
CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_versions(skill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_exp_tool ON skill_experiences(tool_name);

-- Formal Agent Evaluation Benchmarking System
CREATE TABLE IF NOT EXISTS agent_evaluations (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    test_suite_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    passed BOOLEAN NOT NULL DEFAULT 0,
    rubric_metrics_json TEXT NOT NULL DEFAULT '{}',
    evaluator_notes TEXT,
    created_at INTEGER NOT NULL
);

-- Managed Credentials Vault (BYOK)
CREATE TABLE IF NOT EXISTS managed_credentials (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    key_alias TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    scoped_grants_json TEXT NOT NULL DEFAULT '[]',
    max_spend_tokens INTEGER,
    current_spend_tokens INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_claimed_run ON tasks(claimed_by_run_id);
CREATE INDEX IF NOT EXISTS idx_tasks_lease ON tasks(lease_expires_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_agent_evals_agent ON agent_evaluations(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_managed_creds_provider ON managed_credentials(provider, key_alias);
