import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { ApprovalStatus } from '../src/domain/types.js';
import { Sentinel } from '../src/security/sentinel.js';
import { PolicyEngine } from '../src/policy/policy_engine.js';
import { ToolEngine } from '../src/execution/tool_engine.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { SecretVault } from '../src/security/secret_vault.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { AgentRepository } from '../src/domain/agent_repository.js';

describe('Milestone 1 Core & Security Remediation Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-m1-remediation-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows file lock cleanup delays
    }
  });

  // Helper to seed foundational parent entities for foreign key integrity
  function seedFoundationalEntities(db: KinDatabase, rootPath: string = tempDir) {
    const now = Date.now();
    db.execute(
      `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-test', 'Test Workspace', ?, 'AUTO', ?, ?);`,
      rootPath,
      now,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, created_at, updated_at)
       VALUES ('proj-test', 'ws-test', 'Test Project', ?, ?, ?);`,
      rootPath,
      now,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES ('def-test', 'Tester', 'QA', 'You are QA', 'mock-model', ?);`,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at)
       VALUES ('agent-test', 'ws-test', 'proj-test', 'def-test', 'Tester', 'mock-model', 1, ?, ?);`,
      now,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at)
       VALUES ('run-test', 'agent-test', 'proj-test', 'running', ?, ?);`,
      now,
      now
    );
  }

  // ==========================================================================
  // Remediation 1: MigrationRunner Foreign Key Handling
  // ==========================================================================
  describe('1. MigrationRunner Foreign Key & Temporary Table Handling', () => {
    it('migrates legacy providers table without data loss or foreign key violations when dependent child models exist', () => {
      const dbPath = path.join(tempDir, 'test_legacy_fk_migration.sqlite');
      const db = new KinDatabase(dbPath);
      const rawDb = db.getRawDb();

      // Ensure foreign keys are enabled initially
      rawDb.exec('PRAGMA foreign_keys = ON;');

      // Seed foundational workspaces and projects
      rawDb.exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL,
          default_autonomy_mode TEXT NOT NULL DEFAULT 'AUTO',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          name TEXT NOT NULL,
          repo_path TEXT NOT NULL,
          settings_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO workspaces VALUES ('ws-legacy', 'Legacy Workspace', '.', 'AUTO', 1000, 1000);
        INSERT INTO projects VALUES ('proj-kin', 'ws-legacy', 'Default Project', '.', '{}', 1000, 1000);
      `);

      // Create genuine legacy providers table lacking 'xai' and 'azure' in CHECK constraint
      rawDb.exec(`
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'openrouter', 'together', 'deepinfra', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'vllm', 'openai_compatible', 'custom')),
          base_url TEXT,
          api_key_ref TEXT,
          is_active BOOLEAN NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE models (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          context_window INTEGER NOT NULL DEFAULT 8192,
          max_output_tokens INTEGER NOT NULL DEFAULT 2048,
          supports_tools BOOLEAN NOT NULL DEFAULT 1,
          supports_vision BOOLEAN NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      `);

      // Seed 2 providers and 2 dependent child models referencing providers(id) ON DELETE CASCADE
      const now = Date.now();
      rawDb.exec(`
        INSERT INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
        VALUES ('p-ollama', 'Local Ollama', 'ollama', 'http://localhost:11434', NULL, 1, ${now}),
               ('p-anthropic', 'Anthropic Provider', 'anthropic', NULL, 'sec-ref-1', 1, ${now});

        INSERT INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
        VALUES ('m-llama', 'p-ollama', 'llama-3.1-8b', 128000, 4096, 1, 0, ${now}),
               ('m-claude', 'p-anthropic', 'claude-3-5-sonnet', 200000, 8192, 1, 1, ${now});
      `);

      // Verify legacy setup before migration
      const initialModels = db.queryOne<{ count: number }>('SELECT count(*) as count FROM models;');
      expect(initialModels?.count).toBe(2);

      // Execute migration runner
      const runner = new MigrationRunner(db);
      const result = runner.runMigrations();

      // Assertions matching concrete implementation objectives:
      expect(result.success).toBe(true);
      expect(result.integrityCheck).toBe('ok');

      // Assert child models rows are preserved (count matches inserted rows)
      const postModels = db.queryOne<{ count: number }>('SELECT count(*) as count FROM models;');
      expect(postModels?.count).toBe(2);

      const postProviders = db.queryOne<{ count: number }>('SELECT count(*) as count FROM providers;');
      expect(postProviders?.count).toBe(2);

      // Verify PRAGMA foreign_key_check returns 0 violations
      const violations = db.query<{ table: string }>('PRAGMA foreign_key_check;');
      expect(violations).toHaveLength(0);

      // Verify PRAGMA foreign_keys is ON
      const fkSetting = db.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys;');
      expect(fkSetting?.foreign_keys).toBe(1);

      // Verify schema now supports 'xai' and 'azure'
      db.execute(
        "INSERT INTO providers (id, name, provider_type, base_url, is_active, created_at) VALUES ('p-xai', 'xAI Grok', 'xai', 'https://api.x.ai', 1, ?)",
        now
      );
      const xaiProvider = db.queryOne<{ id: string }>("SELECT id FROM providers WHERE id = 'p-xai'");
      expect(xaiProvider?.id).toBe('p-xai');

      db.close();
    });
  });

  // ==========================================================================
  // Remediation 2: ApprovalStatus Type and DB Constraint Alignment
  // ==========================================================================
  describe('2. ApprovalStatus Schema and Type Union', () => {
    it('supports "failed" status in TypeScript and persists without violating SQLite CHECK constraint', () => {
      const db = new KinDatabase(':memory:');
      new MigrationRunner(db).runMigrations();
      seedFoundationalEntities(db);

      const failedStatus: ApprovalStatus = 'failed';
      const now = Date.now();

      db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at, decided_at)
         VALUES ('app-fail-1', 'run-test', 'agent-test', 'executeShell', '{"command":"npm test"}', 'HIGH', ?, ?, ?, ?)`,
        failedStatus,
        now + 60000,
        now,
        now
      );

      const row = db.queryOne<{ id: string; status: ApprovalStatus }>(
        "SELECT id, status FROM approvals WHERE id = 'app-fail-1'"
      );
      expect(row?.status).toBe('failed');
      db.close();
    });
  });

  // ==========================================================================
  // Remediation 3: Sentinel Capability Attenuation & Root Credential Elevation
  // ==========================================================================
  describe('3. Sentinel Attenuation & Root Credential Critical Risk', () => {
    it('enforces monotonic capability attenuation between parent run and subagent', () => {
      const sentinel = Sentinel.getInstance();

      // Subagent attempting action holding capabilities not granted to parent
      const escalatedRequest = {
        agentId: 'subagent-1',
        runId: 'child-run-1',
        parentRunId: 'parent-run-1',
        toolName: 'readFile',
        params: { filePath: 'README.md' },
        riskLevel: 'LOW' as const,
        autonomyMode: 'AUTO' as const,
        agentCapabilities: ['fs:read', 'admin:super'],
        parentCapabilities: ['fs:read'], // Parent lacks admin:super
      };

      const decision = sentinel.evaluate(escalatedRequest);
      expect(decision.requiresApproval).toBe(true);
      expect(decision.reason).toContain('Monotonic capability attenuation violated');

      // Subagent with capabilities strictly attenuated within parent capabilities
      const validSubagentRequest = {
        agentId: 'subagent-1',
        runId: 'child-run-2',
        parentRunId: 'parent-run-1',
        toolName: 'readFile',
        params: { filePath: 'README.md' },
        riskLevel: 'LOW' as const,
        autonomyMode: 'AUTO' as const,
        agentCapabilities: ['fs:read'],
        parentCapabilities: ['fs:read', 'fs:write'],
      };

      const validDecision = sentinel.evaluate(validSubagentRequest);
      expect(validDecision.allowed).toBe(true);
      expect(validDecision.requiresApproval).toBe(false);
    });

    it('elevates direct access to vault.key, kin_storage.sqlite*, and ipc_auth.token to CRITICAL risk', () => {
      const sentinel = Sentinel.getInstance();

      const sensitiveFiles = [
        'vault.key',
        '.kin/vault.key',
        'kin_storage.sqlite',
        'kin_storage.sqlite-wal',
        'kin_storage.sqlite-shm',
        'ipc_auth.token',
        '.kin/ipc_auth.token',
      ];

      for (const file of sensitiveFiles) {
        // Direct evaluateRisk check
        const risk = sentinel.evaluateRisk('readFile', { filePath: file }, 'LOW');
        expect(risk).toBe('CRITICAL');

        // Full evaluate check under FULL_ACCESS autonomy mode:
        // Normally LOW or HIGH risks are auto-approved in FULL_ACCESS,
        // but CRITICAL requires mandatory interactive approval!
        const decision = sentinel.evaluate({
          agentId: 'worker-agent',
          toolName: 'readFile',
          params: { filePath: file },
          riskLevel: 'LOW',
          autonomyMode: 'FULL_ACCESS',
          agentCapabilities: ['*'],
        });

        expect(decision.requiresApproval).toBe(true);
      }

      // Shell access to root credentials must also evaluate to CRITICAL
      expect(sentinel.evaluateRisk('executeShell', { command: 'cat .kin/vault.key' })).toBe('CRITICAL');
      expect(sentinel.evaluateRisk('executeShell', { command: 'type .kin\\ipc_auth.token' })).toBe('CRITICAL');
      expect(sentinel.evaluateRisk('executeShell', { command: 'sqlite3 kin_storage.sqlite .dump' })).toBe('CRITICAL');
    });

    it('forwards parentCapabilities and subagentWhitelist in ToolGateway.executeTool to enforce attenuation', async () => {
      const db = new KinDatabase(':memory:');
      new MigrationRunner(db).runMigrations();
      seedFoundationalEntities(db);
      const agentRepo = new AgentRepository(db);
      const toolGateway = new ToolGateway({ db, agentRepo });

      // 1. Subagent with elevated capability not held by parent must require approval even under FULL_ACCESS
      const unattenuatedContext = {
        runId: 'run-sub-elevated',
        agentId: 'agent-test',
        parentRunId: 'run-parent',
        parentCapabilities: ['fs:read'], // Parent only holds fs:read
        allowedCapabilities: ['shell:exec', 'fs:read'],
        autonomyMode: 'FULL_ACCESS' as const,
        worktreeRoot: tempDir,
      };

      const elevatedResult = await toolGateway.executeTool(
        'executeShell',
        { command: 'echo should_require_approval' },
        unattenuatedContext
      );

      expect(elevatedResult.success).toBe(false);
      expect(elevatedResult.requiresApproval).toBe(true);
      expect(elevatedResult.error).toContain('Monotonic capability attenuation violated');

      // 2. Subagent whose capabilities are fully within parentCapabilities executes without block
      const attenuatedContext = {
        runId: 'run-sub-attenuated',
        agentId: 'agent-test',
        parentRunId: 'run-parent',
        parentCapabilities: ['shell:exec', 'fs:read'],
        allowedCapabilities: ['shell:exec', 'fs:read'],
        autonomyMode: 'FULL_ACCESS' as const,
        worktreeRoot: tempDir,
      };

      const validResult = await toolGateway.executeTool(
        'executeShell',
        { command: 'echo hello_world' },
        attenuatedContext
      );

      expect(validResult.success).toBe(true);

      // 3. Subagent command whitelisting forwarded to Sentinel / PolicyEngine
      const whitelistContext = {
        runId: 'run-sub-whitelist',
        agentId: 'agent-test',
        parentRunId: 'run-parent',
        parentCapabilities: ['shell:exec', 'fs:read'],
        allowedCapabilities: ['shell:exec', 'fs:read'],
        autonomyMode: 'AUTO' as const,
        subagentWhitelist: {
          permittedCommands: ['npm test'],
        },
        worktreeRoot: tempDir,
      };

      // Exact whitelisted command is pre-authorized under AUTO
      const whitelistValid = await toolGateway.executeTool(
        'executeShell',
        { command: 'npm test' },
        whitelistContext
      );
      expect(whitelistValid.requiresApproval).toBeFalsy();

      db.close();
    });
  });

  // ==========================================================================
  // Remediation 4: Subagent Whitelist Shell Subshell Blocking
  // ==========================================================================
  describe('4. PolicyEngine Subagent Whitelist Command Chaining and Subshell Blocking', () => {
    it('blocks shell subshell execution characters ($, (, ), <, >) in subagent command whitelisting', () => {
      const engine = new PolicyEngine();

      const baseReq = {
        agentId: 'subagent-1',
        parentRunId: 'parent-1',
        toolName: 'executeShell',
        riskLevel: 'HIGH' as const, // Shell execution defaults to HIGH risk
        autonomyMode: 'AUTO' as const,
        agentCapabilities: ['*'],
        subagentApprovedWhitelist: {
          permittedCommands: ['npm test', 'cargo check'],
        },
      };

      // Exact whitelisted command is pre-authorized
      const valid1 = engine.evaluateAction({
        ...baseReq,
        commandOrPath: 'npm test',
      });
      expect(valid1.requiresInteractiveApproval).toBe(false);

      // Whitelisted command with harmless arguments is pre-authorized
      const valid2 = engine.evaluateAction({
        ...baseReq,
        commandOrPath: 'npm test -- --runInBand',
      });
      expect(valid2.requiresInteractiveApproval).toBe(false);

      // Subshell execution injections must NOT be pre-authorized
      const subshellVectors = [
        'npm test $(whoami)',
        'npm test (echo secret)',
        'npm test <(cat /etc/passwd)',
        'npm test > overwrite.txt',
        'npm test $VAR',
        'npm test; whoami',
        'npm test && whoami',
        'npm test || whoami',
        'npm test | grep result',
        'npm test `id`',
      ];

      for (const vector of subshellVectors) {
        const result = engine.evaluateAction({
          ...baseReq,
          commandOrPath: vector,
        });
        // Non-whitelisted HIGH risk shell commands in AUTO mode require interactive operator approval
        expect(
          result.requiresInteractiveApproval,
          `Expected vector '${vector}' to require interactive approval`
        ).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Remediation 5: Worker Thread jailedFs Sensitive Pattern & Canonical Realpath
  // ==========================================================================
  describe('5. ToolEngine Worker Sandbox jailedFs Enforcement', () => {
    it('blocks worker scripts from reading sensitive credential patterns via jailedFs', async () => {
      const db = new KinDatabase(':memory:');
      new MigrationRunner(db).runMigrations();
      seedFoundationalEntities(db);

      const engine = new ToolEngine(db);

      // Create dummy sensitive files and a safe file in tempDir
      fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET_API_KEY=supersecret123');
      fs.writeFileSync(path.join(tempDir, 'vault.key'), '0123456789abcdef');
      fs.writeFileSync(path.join(tempDir, 'safe_file.txt'), 'hello safe world');

      // Create malicious tool attempting to read .env
      const malRes = engine.createTool({
        name: 'read_env_leak',
        description: 'Attempts to read .env file',
        handlerCode: `
          module.exports = async function(params, context) {
            return { content: fs.readFileSync('.env', 'utf-8') };
          };
        `,
        requireApproval: false,
        projectId: 'proj-test',
      });
      expect(malRes.success).toBe(true);

      const execResult = await engine.executeTool(
        'read_env_leak',
        {},
        { worktreeRoot: tempDir }
      );

      expect(execResult.success).toBe(false);
      expect(execResult.error).toMatch(/Path jail access to sensitive file blocked/i);

      // Create safe tool reading non-sensitive file
      const safeRes = engine.createTool({
        name: 'read_safe_content',
        description: 'Reads safe file',
        handlerCode: `
          module.exports = async function(params, context) {
            return { content: fs.readFileSync('safe_file.txt', 'utf-8') };
          };
        `,
        requireApproval: false,
        projectId: 'proj-test',
      });
      expect(safeRes.success).toBe(true);

      const safeResult = await engine.executeTool(
        'read_safe_content',
        {},
        { worktreeRoot: tempDir }
      );

      expect(safeResult.success).toBe(true);
      expect(safeResult.output).toEqual({ content: 'hello safe world' });

      // Create traversal tool attempting to escape worktree root
      const traversalRes = engine.createTool({
        name: 'read_traversal_escape',
        description: 'Attempts directory traversal',
        handlerCode: `
          module.exports = async function(params, context) {
            return { content: fs.readFileSync('../../outside.txt', 'utf-8') };
          };
        `,
        requireApproval: false,
        projectId: 'proj-test',
      });
      expect(traversalRes.success).toBe(true);

      const traversalResult = await engine.executeTool(
        'read_traversal_escape',
        {},
        { worktreeRoot: tempDir }
      );
      expect(traversalResult.success).toBe(false);
      expect(traversalResult.error).toMatch(/Path jail traversal blocked/i);

      db.close();
    });
  });

  // ==========================================================================
  // Remediation 6: EventLedger HMAC-SHA256 Chaining with Vault Key
  // ==========================================================================
  describe('6. EventLedger Cryptographic HMAC-SHA256 Hash Chaining', () => {
    it('computes HMAC-SHA256 hash using SecretVault master key and detects tampering', () => {
      const db = new KinDatabase(':memory:');
      new MigrationRunner(db).runMigrations();

      // Configure SecretVault with a deterministic test key
      const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      SecretVault.resetInstance();
      const vault = SecretVault.getInstance({ masterKey: testKey });
      expect(vault.getMasterKey().toString('hex')).toBe(testKey);

      const ledger = EventLedger.initialize(db);

      // Record lifecycle event
      const eventId = ledger.record({
        eventType: 'TASK_CREATED',
        entityType: 'task',
        entityId: 'task-100',
        payload: { title: 'Remediation Verification' },
      });

      expect(eventId).toBeGreaterThan(0);

      // Retrieve record from event_journal
      const row = db.queryOne<{
        record_hash: string;
        prev_hash: string;
        event_type: string;
        entity_type: string;
        entity_id: string;
        payload_json: string;
        created_at: number;
      }>('SELECT * FROM event_journal WHERE id = ?', eventId);

      expect(row).toBeDefined();

      // Verify the record hash was calculated with HMAC-SHA256 using vault key
      const rawData = `${row!.prev_hash}:${row!.event_type}:${row!.entity_type}:${row!.entity_id}::${row!.payload_json}:${row!.created_at}`;
      const expectedHmac = crypto.createHmac('sha256', Buffer.from(testKey, 'hex')).update(rawData).digest('hex');
      const unkeyedSha = crypto.createHash('sha256').update(rawData).digest('hex');

      expect(row!.record_hash).toBe(expectedHmac);
      expect(row!.record_hash).not.toBe(unkeyedSha);

      // Verify chain integrity passes
      const integrity = ledger.verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.verifiedCount).toBe(1);

      // Tampering with payload fails chain integrity
      db.execute("UPDATE event_journal SET payload_json = '{\"title\":\"HACKED\"}' WHERE id = ?", eventId);
      const tamperedIntegrity = ledger.verifyChainIntegrity();
      expect(tamperedIntegrity.valid).toBe(false);
      expect(tamperedIntegrity.compromisedId).toBe(eventId);
      expect(tamperedIntegrity.error).toContain('Tampered event record detected');

      db.close();
      SecretVault.resetInstance();
    });

    it('maintains continuous HMAC-SHA256 hash chaining across multiple sequential events', () => {
      const db = new KinDatabase(':memory:');
      new MigrationRunner(db).runMigrations();

      const testKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      SecretVault.resetInstance();
      SecretVault.getInstance({ masterKey: testKey });

      const ledger = EventLedger.initialize(db);

      const id1 = ledger.record({ eventType: 'TASK_CREATED', entityType: 'task', entityId: 't-1', payload: { step: 1 } });
      const id2 = ledger.record({ eventType: 'RUN_CREATED', entityType: 'run', entityId: 'r-1', payload: { step: 2 } });
      const id3 = ledger.record({ eventType: 'TASK_COMPLETED', entityType: 'task', entityId: 't-1', payload: { step: 3 } });

      const r1 = db.queryOne<{ record_hash: string; prev_hash: string }>('SELECT record_hash, prev_hash FROM event_journal WHERE id = ?', id1);
      const r2 = db.queryOne<{ record_hash: string; prev_hash: string }>('SELECT record_hash, prev_hash FROM event_journal WHERE id = ?', id2);
      const r3 = db.queryOne<{ record_hash: string; prev_hash: string }>('SELECT record_hash, prev_hash FROM event_journal WHERE id = ?', id3);

      expect(r1?.prev_hash).toBe('GENESIS_HASH_0000000000000000');
      expect(r2?.prev_hash).toBe(r1?.record_hash);
      expect(r3?.prev_hash).toBe(r2?.record_hash);

      const check = ledger.verifyChainIntegrity();
      expect(check.valid).toBe(true);
      expect(check.verifiedCount).toBe(3);

      db.close();
      SecretVault.resetInstance();
    });

    it('rejects cryptographic downgrade attacks using unkeyed SHA-256 when vault master key is active', () => {
      const db = new KinDatabase(':memory:');
      new MigrationRunner(db).runMigrations();

      const testKey = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
      SecretVault.resetInstance();
      const vault = SecretVault.getInstance({ masterKey: testKey });
      expect(vault.getMasterKey().toString('hex')).toBe(testKey);

      const ledger = EventLedger.initialize(db);

      const eventId = ledger.record({
        eventType: 'CONFIG_CHANGED',
        entityType: 'system',
        entityId: 'sys-1',
        payload: { setting: 'security_level', value: 'high' },
      });

      // Chain integrity initially valid
      expect(ledger.verifyChainIntegrity().valid).toBe(true);

      const row = db.queryOne<{
        record_hash: string;
        prev_hash: string;
        event_type: string;
        entity_type: string;
        entity_id: string;
        run_id: string | null;
        payload_json: string;
        created_at: number;
      }>('SELECT * FROM event_journal WHERE id = ?', eventId)!;

      // An attacker tampers with payload and calculates an unkeyed SHA-256 hash
      const forgedPayload = JSON.stringify({ setting: 'security_level', value: 'disabled' });
      const rawData = `${row.prev_hash}:${row.event_type}:${row.entity_type}:${row.entity_id}:${row.run_id || ''}:${forgedPayload}:${row.created_at}`;
      const unkeyedSha256 = crypto.createHash('sha256').update(rawData).digest('hex');

      // Write tampered payload and unkeyed sha256
      db.execute(
        'UPDATE event_journal SET payload_json = ?, record_hash = ? WHERE id = ?',
        forgedPayload,
        unkeyedSha256,
        eventId
      );

      // Verify chain integrity REJECTS the unkeyed SHA-256 downgrade because masterKey is active
      const audit = ledger.verifyChainIntegrity();
      expect(audit.valid).toBe(false);
      expect(audit.compromisedId).toBe(eventId);
      expect(audit.error).toContain('Tampered event record detected');

      db.close();
      SecretVault.resetInstance();
    });

    it('permits unkeyed SHA-256 fallback only when vault master key is absent for backward compatibility', () => {
      const db = new KinDatabase(':memory:');
      new MigrationRunner(db).runMigrations();

      // Ensure vault has inactive master key
      SecretVault.resetInstance();
      const vault = SecretVault.getInstance();
      (vault as any).masterKey = Buffer.alloc(0);
      expect(vault.getMasterKey().length).toBe(0);

      const ledger = EventLedger.initialize(db);

      // Record an event in unkeyed mode
      ledger.record({
        eventType: 'LEGACY_BOOT',
        entityType: 'system',
        entityId: 'sys-legacy',
        payload: { mode: 'legacy' },
      });

      const audit = ledger.verifyChainIntegrity();
      expect(audit.valid).toBe(true);
      expect(audit.verifiedCount).toBe(1);

      db.close();
      SecretVault.resetInstance();
    });
  });
});
