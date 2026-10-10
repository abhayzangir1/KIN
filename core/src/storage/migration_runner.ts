import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KinDatabase } from './db.js';
import { EMBEDDED_SCHEMA_SQL } from './schema_sql.js';

export interface MigrationReport {
  success: boolean;
  tablesVerified: string[];
  integrityCheck: string;
  appliedAt: number;
}

const REQUIRED_TABLES = [
  'workspaces',
  'projects',
  'agent_definitions',
  'agent_identities',
  'agent_runs',
  'channels',
  'channel_members',
  'messages',
  'queued_messages',
  'goals',
  'tasks',
  'task_dependencies',
  'decisions',
  'evidence',
  'memories',
  'memory_versions',
  'skills',
  'skill_versions',
  'skill_experiences',
  'providers',
  'models',
  'approvals',
  'event_journal',
  'checkpoints',
  'schedules',
  'action_records',
  'file_revisions',
  'agent_evaluations',
  'managed_credentials',
];

export class MigrationRunner {
  private db: KinDatabase;
  private forceEmbedded: boolean = false;

  constructor(db: KinDatabase, options?: { forceEmbedded?: boolean }) {
    this.db = db;
    this.forceEmbedded = Boolean(options?.forceEmbedded);
  }

  public runMigrations(): MigrationReport {
    // Determine path to schema.sql safely across ESM, CJS, and bundled environments
    let currentDir = process.cwd();
    try {
      if (typeof import.meta !== 'undefined' && (import.meta as any)?.url) {
        currentDir = path.dirname(fileURLToPath((import.meta as any).url));
      } else if (typeof __dirname !== 'undefined') {
        currentDir = __dirname;
      }
    } catch {}

    const candidatePaths = [
      path.join(currentDir, 'schema.sql'),
      path.join(currentDir, 'storage', 'schema.sql'),
      path.resolve(currentDir, '../../src/storage/schema.sql'),
      path.resolve(currentDir, '../src/storage/schema.sql'),
      path.resolve(currentDir, '../../storage/schema.sql'),
      path.resolve(process.cwd(), 'schema.sql'),
      path.resolve(process.cwd(), 'src/storage/schema.sql'),
      path.resolve(process.cwd(), 'core/src/storage/schema.sql'),
      path.resolve(process.cwd(), 'dist/storage/schema.sql'),
      path.resolve(process.cwd(), 'core/dist/storage/schema.sql'),
      path.resolve(path.dirname(process.execPath), 'schema.sql'),
      path.resolve(path.dirname(process.execPath), 'storage/schema.sql'),
    ];

    let schemaSql = '';
    if (!this.forceEmbedded) {
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          try {
            const content = fs.readFileSync(p, 'utf-8');
            if (content.trim().length > 0) {
              schemaSql = content;
              break;
            }
          } catch {}
        }
      }
    }

    if (!schemaSql) {
      if (EMBEDDED_SCHEMA_SQL && EMBEDDED_SCHEMA_SQL.trim().length > 0) {
        schemaSql = EMBEDDED_SCHEMA_SQL;
      } else {
        throw new Error(`Migration schema file not found in search paths: ${candidatePaths.slice(0, 4).join(', ')}`);
      }
    }

    // Execute schema in a synchronous transaction
    this.db.transactionSync(() => {
      // Pre-migration: If agent_identities already exists from an earlier version lacking project_id,
      // add the column before executing schemaSql which builds indexes on project_id.
      const existingTables = this.db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table';"
      ).map((t) => t.name);

      if (existingTables.includes('agent_identities')) {
        const agentCols = this.db.query<{ name: string }>("PRAGMA table_info(agent_identities);").map((c) => c.name);
        if (!agentCols.includes('project_id')) {
          this.db.exec('ALTER TABLE agent_identities ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;');
          this.db.exec("UPDATE agent_identities SET project_id = 'proj-kin' WHERE project_id IS NULL;");
        }
      }

      // Pre-migration: skills table learning columns
      if (existingTables.includes('skills')) {
        const skillCols = this.db.query<{ name: string }>("PRAGMA table_info(skills);").map((c) => c.name);
        if (!skillCols.includes('evidence_count')) {
          this.db.exec('ALTER TABLE skills ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0;');
        }
        if (!skillCols.includes('success_count')) {
          this.db.exec('ALTER TABLE skills ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0;');
        }
        if (!skillCols.includes('failure_count')) {
          this.db.exec('ALTER TABLE skills ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;');
        }
        if (!skillCols.includes('last_validated_at')) {
          this.db.exec('ALTER TABLE skills ADD COLUMN last_validated_at INTEGER;');
        }
        if (!skillCols.includes('validator_ref')) {
          this.db.exec('ALTER TABLE skills ADD COLUMN validator_ref TEXT;');
        }
        if (!skillCols.includes('parameters_json')) {
          this.db.exec("ALTER TABLE skills ADD COLUMN parameters_json TEXT DEFAULT '{}';");
        }
        if (!skillCols.includes('handler_code')) {
          this.db.exec('ALTER TABLE skills ADD COLUMN handler_code TEXT;');
        }
        if (!skillCols.includes('skill_type')) {
          this.db.exec("ALTER TABLE skills ADD COLUMN skill_type TEXT DEFAULT 'prompt_instruction';");
        }
        if (!skillCols.includes('enabled')) {
          this.db.exec('ALTER TABLE skills ADD COLUMN enabled BOOLEAN DEFAULT 1;');
        }
      }

      // Pre-migration: skill_experiences learning columns
      if (existingTables.includes('skill_experiences')) {
        const expCols = this.db.query<{ name: string }>("PRAGMA table_info(skill_experiences);").map((c) => c.name);
        if (!expCols.includes('tool_name')) {
          this.db.exec('ALTER TABLE skill_experiences ADD COLUMN tool_name TEXT;');
        }
        if (!expCols.includes('lessons_learned')) {
          this.db.exec('ALTER TABLE skill_experiences ADD COLUMN lessons_learned TEXT;');
        }
        if (!expCols.includes('metadata_json')) {
          this.db.exec("ALTER TABLE skill_experiences ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';");
        }
      }

      // Pre-migration: goals table enriched fields
      if (existingTables.includes('goals')) {
        const goalCols = this.db.query<{ name: string }>("PRAGMA table_info(goals);").map((c) => c.name);
        if (!goalCols.includes('deadline')) {
          this.db.exec('ALTER TABLE goals ADD COLUMN deadline INTEGER;');
        }
        if (!goalCols.includes('check_in_policy')) {
          this.db.exec('ALTER TABLE goals ADD COLUMN check_in_policy TEXT;');
        }
        if (!goalCols.includes('progress_summary')) {
          this.db.exec('ALTER TABLE goals ADD COLUMN progress_summary TEXT;');
        }
        if (!goalCols.includes('blocked_state')) {
          this.db.exec('ALTER TABLE goals ADD COLUMN blocked_state TEXT;');
        }
        if (!goalCols.includes('proposed_replanning_json')) {
          this.db.exec('ALTER TABLE goals ADD COLUMN proposed_replanning_json TEXT;');
        }
        if (!goalCols.includes('origin_channel_id')) {
          this.db.exec('ALTER TABLE goals ADD COLUMN origin_channel_id TEXT;');
        }
      }

      // Pre-migration: agent_runs table channel_id, trigger_message_id, quota_paused state & columns
      if (existingTables.includes('agent_runs')) {
        const agentRunsSql = this.db.queryOne<{ sql: string }>(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_runs';"
        )?.sql || '';

        if (!agentRunsSql.includes('quota_paused')) {
          this.db.exec(`
            CREATE TABLE agent_runs_dg_tmp (
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
            INSERT INTO agent_runs_dg_tmp (id, agent_id, project_id, parent_run_id, task_id, channel_id, trigger_message_id, state, worktree_path, heartbeat_at, allocated_tokens, used_tokens, created_at, completed_at)
            SELECT id, agent_id, project_id, parent_run_id, task_id, channel_id, trigger_message_id, state, worktree_path, heartbeat_at, allocated_tokens, used_tokens, created_at, completed_at
            FROM agent_runs;
            DROP TABLE agent_runs;
            ALTER TABLE agent_runs_dg_tmp RENAME TO agent_runs;
          `);
        } else {
          const runCols = this.db.query<{ name: string }>("PRAGMA table_info(agent_runs);").map((c) => c.name);
          if (!runCols.includes('channel_id')) {
            this.db.exec('ALTER TABLE agent_runs ADD COLUMN channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL;');
          }
          if (!runCols.includes('trigger_message_id')) {
            this.db.exec('ALTER TABLE agent_runs ADD COLUMN trigger_message_id TEXT;');
          }
          if (!runCols.includes('quota_resets_at')) {
            this.db.exec('ALTER TABLE agent_runs ADD COLUMN quota_resets_at INTEGER;');
          }
          if (!runCols.includes('interrupted_turn')) {
            this.db.exec('ALTER TABLE agent_runs ADD COLUMN interrupted_turn INTEGER DEFAULT 0;');
          }
          if (!runCols.includes('model_id')) {
            this.db.exec('ALTER TABLE agent_runs ADD COLUMN model_id TEXT;');
          }
        }
      }

      // Pre-migration: queued_messages table
      if (!existingTables.includes('queued_messages')) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS queued_messages (
            id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
            sender_id TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_queued_messages_channel ON queued_messages(channel_id, created_at);
        `);
      }

      // Pre-migration: tasks table lease columns
      if (existingTables.includes('tasks')) {
        const taskCols = this.db.query<{ name: string }>("PRAGMA table_info(tasks);").map((c) => c.name);
        if (!taskCols.includes('claimed_by_run_id')) {
          this.db.exec('ALTER TABLE tasks ADD COLUMN claimed_by_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;');
        }
        if (!taskCols.includes('lease_expires_at')) {
          this.db.exec('ALTER TABLE tasks ADD COLUMN lease_expires_at INTEGER;');
        }
        if (!taskCols.includes('retry_count')) {
          this.db.exec('ALTER TABLE tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;');
        }
      }

      // Pre-migration: schedules table status constraint and last_error column
      if (existingTables.includes('schedules')) {
        const schedCols = this.db.query<{ name: string }>("PRAGMA table_info(schedules);").map((c) => c.name);
        if (!schedCols.includes('last_error')) {
          this.db.exec('ALTER TABLE schedules ADD COLUMN last_error TEXT;');
        }
        const schedSql = this.db.queryOne<{ sql: string }>(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'schedules';"
        )?.sql || '';
        if (!schedSql.includes("'failed'")) {
          this.db.exec(`
            CREATE TABLE schedules_dg_tmp (
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
              status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled', 'expired', 'failed', 'paused')),
              next_run_at INTEGER NOT NULL,
              last_run_at INTEGER,
              last_error TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            INSERT INTO schedules_dg_tmp (id, project_id, channel_id, target_agent_id, type, prompt, duration_seconds, cron_expression, timer_condition, max_iterations, current_iterations, status, next_run_at, last_run_at, last_error, created_at, updated_at)
            SELECT id, project_id, channel_id, target_agent_id, type, prompt, duration_seconds, cron_expression, timer_condition, max_iterations, current_iterations, status, next_run_at, last_run_at, last_error, created_at, updated_at
            FROM schedules;
            DROP TABLE schedules;
            ALTER TABLE schedules_dg_tmp RENAME TO schedules;
          `);
        }
      }

      // Pre-migration: evidence table verification columns
      if (existingTables.includes('evidence')) {
        const evidenceCols = this.db.query<{ name: string }>("PRAGMA table_info(evidence);").map((c) => c.name);
        if (!evidenceCols.includes('verified_by')) {
          this.db.exec('ALTER TABLE evidence ADD COLUMN verified_by TEXT;');
        }
        if (!evidenceCols.includes('verification_payload_json')) {
          this.db.exec('ALTER TABLE evidence ADD COLUMN verification_payload_json TEXT;');
        }
      }

      // Pre-migration: agent_evaluations table real test suite columns
      if (existingTables.includes('agent_evaluations')) {
        const evalCols = this.db.query<{ name: string }>("PRAGMA table_info(agent_evaluations);").map((c) => c.name);
        if (!evalCols.includes('test_cases_run')) {
          this.db.exec('ALTER TABLE agent_evaluations ADD COLUMN test_cases_run INTEGER NOT NULL DEFAULT 0;');
        }
        if (!evalCols.includes('test_cases_passed')) {
          this.db.exec('ALTER TABLE agent_evaluations ADD COLUMN test_cases_passed INTEGER NOT NULL DEFAULT 0;');
        }
        if (!evalCols.includes('test_cases_json')) {
          this.db.exec("ALTER TABLE agent_evaluations ADD COLUMN test_cases_json TEXT NOT NULL DEFAULT '[]';");
        }
        if (!evalCols.includes('execution_logs')) {
          this.db.exec('ALTER TABLE agent_evaluations ADD COLUMN execution_logs TEXT;');
        }
      }

      // Pre-migration: managed_credentials table masked_key column
      if (existingTables.includes('managed_credentials')) {
        const credCols = this.db.query<{ name: string }>("PRAGMA table_info(managed_credentials);").map((c) => c.name);
        if (!credCols.includes('masked_key')) {
          this.db.exec('ALTER TABLE managed_credentials ADD COLUMN masked_key TEXT;');
        }
      }

      this.db.exec(schemaSql);

      // Verify and ensure column and index presence post-schema
      const postCols = this.db.query<{ name: string }>("PRAGMA table_info(agent_identities);").map((c) => c.name);
      if (!postCols.includes('project_id')) {
        this.db.exec('ALTER TABLE agent_identities ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;');
      }
      this.db.exec("UPDATE agent_identities SET project_id = 'proj-kin' WHERE project_id IS NULL;");
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_project_name ON agent_identities (project_id, display_name COLLATE NOCASE);");
    });

    // Run integrity check
    const integrityResult = this.db.queryOne<{ integrity_check: string }>('PRAGMA integrity_check(10);');
    const integrityStatus = integrityResult?.integrity_check ?? 'unknown';

    if (integrityStatus !== 'ok') {
      throw new Error(`SQLite integrity check failed with status: ${integrityStatus}`);
    }

    // Verify all 22 required tables exist
    const existingTables = this.db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';"
    ).map((row) => row.name);

    for (const requiredTable of REQUIRED_TABLES) {
      if (!existingTables.includes(requiredTable)) {
        throw new Error(`Schema migration incomplete. Missing expected table: ${requiredTable}`);
      }
    }

    return {
      success: true,
      tablesVerified: existingTables,
      integrityCheck: integrityStatus,
      appliedAt: Date.now(),
    };
  }
}
