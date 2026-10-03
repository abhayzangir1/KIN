import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KinDatabase } from './db.js';

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

  constructor(db: KinDatabase) {
    this.db = db;
  }

  public runMigrations(): MigrationReport {
    // Determine path to schema.sql
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    let schemaPath = path.join(currentDir, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      const srcPath = path.resolve(currentDir, '../../src/storage/schema.sql');
      if (fs.existsSync(srcPath)) {
        schemaPath = srcPath;
      } else {
        throw new Error(`Migration schema file not found at: ${schemaPath} or ${srcPath}`);
      }
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

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
        }
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

      this.db.exec(schemaSql);

      // Verify and guarantee column and index presence post-schema
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
