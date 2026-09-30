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
  'skill_experiences',
  'providers',
  'models',
  'approvals',
  'event_journal',
  'checkpoints',
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
      this.db.exec(schemaSql);
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
