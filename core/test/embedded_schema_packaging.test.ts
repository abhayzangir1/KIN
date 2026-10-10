import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { EMBEDDED_SCHEMA_SQL } from '../src/storage/schema_sql.js';

describe('Embedded Schema Packaging & Migration Fallback', () => {
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

  it('EMBEDDED_SCHEMA_SQL contains authoritative definitions for all 29 tables', () => {
    expect(EMBEDDED_SCHEMA_SQL).toBeDefined();
    expect(EMBEDDED_SCHEMA_SQL.length).toBeGreaterThan(1000);

    for (const table of REQUIRED_TABLES) {
      expect(EMBEDDED_SCHEMA_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('EMBEDDED_SCHEMA_SQL includes queued_messages, agent_runs.model_id, and provider CHECK constraint', () => {
    // Durable queue table and index
    expect(EMBEDDED_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS queued_messages');
    expect(EMBEDDED_SCHEMA_SQL).toContain('idx_queued_messages_channel');

    // agent_runs.model_id column
    expect(EMBEDDED_SCHEMA_SQL).toContain('model_id TEXT');

    // Expanded provider_type CHECK constraint
    expect(EMBEDDED_SCHEMA_SQL).toMatch(/provider_type.*deepseek/i);
    expect(EMBEDDED_SCHEMA_SQL).toMatch(/provider_type.*groq/i);
    expect(EMBEDDED_SCHEMA_SQL).toMatch(/provider_type.*openrouter/i);
  });

  it('MigrationRunner initializes a fresh database with all 29 tables and passes integrity check', () => {
    const db = new KinDatabase(':memory:');
    try {
      const runner = new MigrationRunner(db);
      const report = runner.runMigrations();

      expect(report.success).toBe(true);
      expect(report.integrityCheck).toBe('ok');
      expect(report.tablesVerified.length).toBe(29);

      // Verify all tables exist via sqlite_master
      const tables = db
        .query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';")
        .map((t) => t.name);

      for (const required of REQUIRED_TABLES) {
        expect(tables).toContain(required);
      }

      // Verify columns on agent_runs
      const agentRunCols = db.query<{ name: string }>("PRAGMA table_info(agent_runs);").map((c) => c.name);
      expect(agentRunCols).toContain('model_id');

      // Verify columns on queued_messages
      const queueCols = db.query<{ name: string }>("PRAGMA table_info(queued_messages);").map((c) => c.name);
      expect(queueCols).toContain('id');
      expect(queueCols).toContain('channel_id');
      expect(queueCols).toContain('content');
      expect(queueCols).toContain('created_at');
    } finally {
      db.close();
    }
  });

  it('MigrationRunner falls back to EMBEDDED_SCHEMA_SQL when schema.sql is absent on disk', () => {
    const db = new KinDatabase(':memory:');
    try {
      // Force embedded schema mode, bypassing candidate paths on disk
      const runner = new MigrationRunner(db, { forceEmbedded: true });
      const report = runner.runMigrations();

      expect(report.success).toBe(true);
      expect(report.integrityCheck).toBe('ok');
      expect(report.tablesVerified.length).toBe(29);

      // Verify all 29 tables exist via sqlite_master
      const tables = db
        .query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';")
        .map((t) => t.name);

      for (const required of REQUIRED_TABLES) {
        expect(tables).toContain(required);
      }
      expect(tables).toContain('queued_messages');
    } finally {
      db.close();
    }
  });

  it('MigrationRunner is idempotent and can be safely executed multiple times', () => {
    const db = new KinDatabase(':memory:');
    try {
      const runner = new MigrationRunner(db);
      const report1 = runner.runMigrations();
      expect(report1.success).toBe(true);

      const report2 = runner.runMigrations();
      expect(report2.success).toBe(true);
      expect(report2.integrityCheck).toBe('ok');
      expect(report2.tablesVerified.length).toBe(29);
    } finally {
      db.close();
    }
  });

  it('standalone package_binary.js bundles schema.sql into binaries distribution target', () => {
    const packageScriptPath = path.resolve(__dirname, '../scripts/package_binary.js');
    expect(fs.existsSync(packageScriptPath)).toBe(true);

    const scriptContent = fs.readFileSync(packageScriptPath, 'utf-8');
    expect(scriptContent).toContain('schema.sql');
    expect(scriptContent).toContain('tauriBinariesDir');
    expect(scriptContent).toContain('coreBinariesDir');
  });

  it('CI workflow specifies packaged sidecar binary execution', () => {
    const ciPath = path.resolve(__dirname, '../../.github/workflows/ci.yml');
    if (fs.existsSync(ciPath)) {
      const ciContent = fs.readFileSync(ciPath, 'utf-8');
      expect(ciContent).toContain('kin-core');
    }
  });
});
