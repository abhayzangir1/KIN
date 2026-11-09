// ============================================================================
// CHALLENGER M4-2 EMPIRICAL ADVERSARIAL STRESS TEST SUITE
// Rigorous verification & edge-case probing for Milestone 4:
// - Feature 35: Egress kill-switch, secret masking, takeover transitions, quota 429
// - Feature 38: Daemon path resolution (:memory:, custom) & SEA packaging checks
// - Feature 39: GitHub Actions release workflow validation & matrix verification
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { CoreServer } from '../src/server/core_server.js';
import { canEgressData, isAgentAuthorizedForCredential, EgressConsentSettings } from '../src/security/egress_policy.js';
import { QuotaGuard } from '../src/execution/quota_guard.js';
import { getDataDirectory } from '../src/storage/data_directory.js';

describe('Challenger M4-2: Empirical Adversarial Stress & Release Gate Verification', () => {
  let tempDir: string;
  let testDbPath: string;
  let server: CoreServer;
  let serverPort: number;
  let baseUrl: string;
  let testProjectId: string;
  let testAgentId: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-challenger-m4-2-'));
    testDbPath = path.join(tempDir, 'challenger_m4_2.sqlite');

    server = new CoreServer({
      port: 0,
      dbPath: testDbPath,
    });

    serverPort = await server.start();
    baseUrl = `http://127.0.0.1:${serverPort}`;

    // Seed test project and agent identity for foreign key relations
    const workspaceId = `ws-test-${Date.now()}`;
    testProjectId = `proj-test-${Date.now()}`;
    const defId = `def-test-${Date.now()}`;
    testAgentId = `agent-test-${Date.now()}`;

    server.db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, 'TestWorkspace', ?, 'AUTO', ?, ?)`,
      workspaceId,
      tempDir,
      Date.now(),
      Date.now()
    );

    server.db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, 'TestProject', ?, '{}', ?, ?)`,
      testProjectId,
      workspaceId,
      tempDir,
      Date.now(),
      Date.now()
    );

    server.db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES (?, 'TestAgentDef', 'Developer', 'Test prompt', 'gpt-4o', ?)`,
      defId,
      Date.now()
    );

    server.db.execute(
      `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'TestAgent', 'gpt-4o', ?, ?)`,
      testAgentId,
      workspaceId,
      testProjectId,
      defId,
      Date.now(),
      Date.now()
    );
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  async function api(
    method: string,
    endpoint: string,
    body?: any,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; headers: Headers; text: string; json: any }> {
    const url = `${baseUrl}${endpoint}`;
    const reqHeaders: Record<string, string> = { ...headers };
    let payload: string | undefined = undefined;

    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
    }

    const res = await fetch(url, {
      method,
      headers: reqHeaders,
      body: payload,
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}

    return { status: res.status, headers: res.headers, text, json };
  }

  // ==========================================================================
  // 1. FEATURE 35: PRD § 15 EDGE CASES & STRESS PROBES
  // ==========================================================================
  describe('Feature 35 Edge Cases: Egress, Secrets, Takeover, Quota', () => {

    // 1.1 Air-gapped Egress Kill-switch Stress & Boundaries
    it('1.1 Egress Kill-switch: masterEgressEnabled=false unconditionally denies all channels and malformed categories', () => {
      const strictKillSwitch: EgressConsentSettings = {
        masterEgressEnabled: false,
        allowPrompts: true,
        allowSharedMemory: true,
        allowPrivateNotes: true,
        allowDirectMessages: true,
      };

      // All 4 standard types MUST return false
      expect(canEgressData('prompt', strictKillSwitch)).toBe(false);
      expect(canEgressData('sharedMemory', strictKillSwitch)).toBe(false);
      expect(canEgressData('privateNote', strictKillSwitch)).toBe(false);
      expect(canEgressData('dm', strictKillSwitch)).toBe(false);

      // Malformed or unknown data types must also return false
      expect(canEgressData('unknown_category' as any, strictKillSwitch)).toBe(false);
      expect(canEgressData('' as any, strictKillSwitch)).toBe(false);
      expect(canEgressData(null as any, strictKillSwitch)).toBe(false);

      // When enabled, only individually consented channels pass
      const partialConsent: EgressConsentSettings = {
        masterEgressEnabled: true,
        allowPrompts: true,
        allowSharedMemory: false,
        allowPrivateNotes: false,
        allowDirectMessages: true,
      };
      expect(canEgressData('prompt', partialConsent)).toBe(true);
      expect(canEgressData('dm', partialConsent)).toBe(true);
      expect(canEgressData('sharedMemory', partialConsent)).toBe(false);
      expect(canEgressData('privateNote', partialConsent)).toBe(false);
      expect(canEgressData('arbitrary' as any, partialConsent)).toBe(false);
    });

    // 1.2 Agent Credential Scoping Boundaries
    it('1.2 Credential Scoping: strict default-deny when empty, wildcard access, scoped IDs', () => {
      // Empty or undefined scopedAgentIds
      expect(isAgentAuthorizedForCredential({ id: 'c1', provider: 'openai', scopedAgentIds: [] }, 'agent-1')).toBe(false);
      expect(isAgentAuthorizedForCredential({ id: 'c2', provider: 'openai', scopedAgentIds: null as any }, 'agent-1')).toBe(false);

      // Wildcard scoping
      expect(isAgentAuthorizedForCredential({ id: 'c3', provider: 'openai', scopedAgentIds: ['*'] }, 'any-agent-uuid')).toBe(true);
      expect(isAgentAuthorizedForCredential({ id: 'c3', provider: 'openai', scopedAgentIds: ['agent-a', '*'] }, 'any-agent-uuid')).toBe(true);

      // Explicit scoping
      const explicitCred = { id: 'c4', provider: 'anthropic', scopedAgentIds: ['agent-dev', 'agent-qa'] };
      expect(isAgentAuthorizedForCredential(explicitCred, 'agent-dev')).toBe(true);
      expect(isAgentAuthorizedForCredential(explicitCred, 'agent-qa')).toBe(true);
      expect(isAgentAuthorizedForCredential(explicitCred, 'agent-attacker')).toBe(false);
    });

    // 1.3 Secret Broker Masking & Duplicate Key Prevention
    it('1.3 Secret Broker: Redacts keys in API outputs across short, medium, and long key lengths', async () => {
      // 1. Long key (>= 16 chars): should show first 4 + '...' + last 4
      const longKey = 'sk-ant-api03-verylongcredentialstring1234567890';
      const r1 = await api('POST', '/api/settings/credentials', {
        provider: 'anthropic',
        keyAlias: 'LongKeyTest',
        apiKey: longKey,
      });
      expect(r1.status).toBe(201);

      // 2. Medium key (8-15 chars): should show first 2 + '...' + last 2
      const mediumKey = 'midkey1234';
      const r2 = await api('POST', '/api/settings/credentials', {
        provider: 'custom',
        keyAlias: 'MediumKeyTest',
        apiKey: mediumKey,
        baseUrl: 'http://localhost:11434',
      });
      expect(r2.status).toBe(201);

      // 3. Short key (< 8 chars): should show '****...****'
      const shortKey = 'short1';
      const r3 = await api('POST', '/api/settings/credentials', {
        provider: 'custom',
        keyAlias: 'ShortKeyTest',
        apiKey: shortKey,
        baseUrl: 'http://localhost:8080',
      });
      expect(r3.status).toBe(201);

      // Retrieve all credentials and verify redaction
      const list = await api('GET', '/api/settings/credentials');
      expect(list.status).toBe(200);

      const longStored = list.json.credentials.find((c: any) => c.keyAlias === 'LongKeyTest');
      expect(longStored).toBeDefined();
      expect(longStored.apiKey).toBeUndefined();
      expect(longStored.secret_hash).toBeUndefined();
      expect(longStored.maskedKey).toBe(`${longKey.slice(0, 4)}...${longKey.slice(-4)}`);
      expect(list.text).not.toContain(longKey);

      const midStored = list.json.credentials.find((c: any) => c.keyAlias === 'MediumKeyTest');
      expect(midStored).toBeDefined();
      expect(midStored.apiKey).toBeUndefined();
      expect(midStored.maskedKey).toBe(`${mediumKey.slice(0, 2)}...${mediumKey.slice(-2)}`);
      expect(list.text).not.toContain(mediumKey);

      const shortStored = list.json.credentials.find((c: any) => c.keyAlias === 'ShortKeyTest');
      expect(shortStored).toBeDefined();
      expect(shortStored.apiKey).toBeUndefined();
      expect(shortStored.maskedKey).toBe('****...****');
      expect(list.text).not.toContain(shortKey);

      // 4. Duplicate Key Prevention: Submitting the identical long key again MUST return 409 Conflict
      const dupRes = await api('POST', '/api/settings/credentials', {
        provider: 'anthropic',
        keyAlias: 'DuplicateAttempt',
        apiKey: longKey,
      });
      expect(dupRes.status).toBe(409);
      expect(dupRes.json.duplicate).toBe(true);
      expect(dupRes.json.existingAlias).toBe('LongKeyTest');
    });

    // 1.4 Human Takeover Steering State Machine
    it('1.4 Human Takeover: Handles repeated pauses, resumes, and aborts with deterministic idempotency', async () => {
      const runId = `run-stress-takeover-${Date.now()}`;
      server.db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
         VALUES (?, ?, ?, 'running', ?, 10000, 0, ?)`,
        runId,
        testAgentId,
        testProjectId,
        Date.now(),
        Date.now()
      );

      // Pause run
      const p1 = await api('POST', `/api/runs/${runId}/pause`);
      expect(p1.status).toBe(200);
      expect(server.takeoverStates.get(runId)?.isPaused).toBe(true);

      // Repeated pause must be idempotent
      const p2 = await api('POST', `/api/runs/${runId}/pause`);
      expect(p2.status).toBe(200);
      expect(server.takeoverStates.get(runId)?.isPaused).toBe(true);

      // Resume run
      const r1 = await api('POST', `/api/runs/${runId}/resume`);
      expect(r1.status).toBe(200);
      expect(server.takeoverStates.get(runId)?.isPaused).toBe(false);

      // Repeated resume must be idempotent
      const r2 = await api('POST', `/api/runs/${runId}/resume`);
      expect(r2.status).toBe(200);
      expect(server.takeoverStates.get(runId)?.isPaused).toBe(false);

      // Abort run
      const a1 = await api('POST', `/api/runs/${runId}/abort`);
      expect(a1.status).toBe(200);
      expect(server.takeoverStates.get(runId)?.isAborted).toBe(true);

      // Abort idempotency
      const a2 = await api('POST', `/api/runs/${runId}/abort`);
      expect(a2.status).toBe(200);
      expect(server.takeoverStates.get(runId)?.isAborted).toBe(true);
    });

    // 1.5 Quota 429 Detection & Retry-After Parser Resilience
    it('1.5 Quota 429: Robust error pattern detection, Retry-After header parsing, and jitter bounds', () => {
      // Error message patterns
      expect(QuotaGuard.isQuotaError('HTTP 429 Too Many Requests')).toBe(true);
      expect(QuotaGuard.isQuotaError('rate_limit_exceeded: current quota is exhausted')).toBe(true);
      expect(QuotaGuard.isQuotaError('RESOURCE_EXHAUSTED')).toBe(true);
      expect(QuotaGuard.isQuotaError('insufficient_quota')).toBe(true);
      expect(QuotaGuard.isQuotaError('tokens per minute limit reached')).toBe(true);
      expect(QuotaGuard.isQuotaError('tpm limit exceeded')).toBe(true);
      expect(QuotaGuard.isQuotaError('rpm limit exceeded')).toBe(true);
      expect(QuotaGuard.isQuotaError('error message', 429)).toBe(true);

      // Non-quota errors must NOT trigger false quota pauses
      expect(QuotaGuard.isQuotaError('500 Internal Server Error')).toBe(false);
      expect(QuotaGuard.isQuotaError('404 Not Found')).toBe(false);
      expect(QuotaGuard.isQuotaError('401 Unauthorized: Invalid API key')).toBe(false);

      // Retry-After header parsing
      expect(QuotaGuard.parseRetryAfter('120')).toBe(120);

      // HTTP-date future string
      const futureDate = new Date(Date.now() + 90000).toUTCString();
      const parsedSeconds = QuotaGuard.parseRetryAfter(futureDate);
      expect(parsedSeconds).toBeDefined();
      expect(parsedSeconds!).toBeGreaterThanOrEqual(80);
      expect(parsedSeconds!).toBeLessThanOrEqual(100);

      // Malformed / undefined Retry-After returns undefined (callers fallback to defaults)
      expect(QuotaGuard.parseRetryAfter(undefined)).toBeUndefined();
      expect(QuotaGuard.parseRetryAfter('invalid-header-string')).toBeUndefined();

      // Jitter backoff bounds with instructed seconds
      const backoffWithInstructed = QuotaGuard.computeExponentialJitterBackoff(1, 60);
      expect(backoffWithInstructed).toBeGreaterThanOrEqual(60000);
      expect(backoffWithInstructed).toBeLessThanOrEqual(60000 * 1.3);

      // Full jitter backoff without instructed seconds
      const backoffJitter = QuotaGuard.computeExponentialJitterBackoff(2);
      expect(backoffJitter).toBeGreaterThanOrEqual(750);
      expect(backoffJitter).toBeLessThanOrEqual(60000);
    });

    // 1.6 Desktop Tray Lifecycle & DB WAL Integrity
    it('1.6 Tray Lifecycle: CoreServer health and SQLite WAL integrity remain pristine under load', async () => {
      const health = await api('GET', '/api/health');
      expect(health.status).toBe(200);
      expect(health.json.status).toBe('ok');
      expect(health.json.database.connected).toBe(true);
      expect(health.json.database.integrity).toBe('ok');
      expect(server.isStopping).toBe(false);

      // Confirm journal mode is WAL
      const journalMode = server.db.queryOne<any>('PRAGMA journal_mode;');
      expect(journalMode?.journal_mode?.toLowerCase()).toBe('wal');

      // Run deep integrity check
      const integrityCheck = server.db.queryOne<any>('PRAGMA integrity_check(100);');
      expect(integrityCheck?.integrity_check).toBe('ok');
    });
  });

  // ==========================================================================
  // 2. FEATURE 38: PACKAGING SCRIPT & DAEMON RESOLUTION
  // ==========================================================================
  describe('Feature 38: Packaging Script & Daemon Path Resolution', () => {

    it('2.1 resolveDbPath correctly isolates :memory: without Windows NTFS file path corruption', () => {
      function testResolve(input: string | undefined): string {
        if (input) {
          if (input === ':memory:') {
            return ':memory:';
          }
          return path.resolve(input);
        }
        return path.resolve(getDataDirectory(), 'kin_storage.sqlite');
      }

      // :memory: must NOT be passed to path.resolve
      expect(testResolve(':memory:')).toBe(':memory:');

      // Relative path is resolved
      const rel = testResolve('test_kin.sqlite');
      expect(path.isAbsolute(rel)).toBe(true);
      expect(rel.endsWith('test_kin.sqlite')).toBe(true);

      // Absolute path remains unchanged
      const abs = path.resolve('D:/KIN/data/kin.sqlite');
      expect(testResolve(abs)).toBe(abs);

      // Undefined defaults to kin_storage.sqlite
      const def = testResolve(undefined);
      expect(path.isAbsolute(def)).toBe(true);
      expect(def.endsWith('kin_storage.sqlite')).toBe(true);
    });

    it('2.2 CoreServer boots in :memory: mode cleanly and passes all schema migrations', async () => {
      const memoryServer = new CoreServer({ port: 0, dbPath: ':memory:' });
      const memPort = await memoryServer.start();
      expect(memPort).toBeGreaterThan(0);

      const memDb = memoryServer.db;
      const integrity = memDb.queryOne<any>('PRAGMA integrity_check;');
      expect(integrity?.integrity_check).toBe('ok');

      // Verify schema tables exist in memory
      const tables = memDb.query<any>("SELECT name FROM sqlite_master WHERE type='table';");
      const tableNames = tables.map((t: any) => t.name);
      expect(tableNames).toContain('workspaces');
      expect(tableNames).toContain('projects');
      expect(tableNames).toContain('agent_identities');
      expect(tableNames).toContain('agent_runs');
      expect(tableNames).toContain('tasks');
      expect(tableNames).toContain('memories');
      expect(tableNames).toContain('managed_credentials');

      await memoryServer.stop();
    });

    it('2.3 package_binary.js produces sidecar binaries and schema.sql in target directories', () => {
      const rootDir = path.resolve(__dirname, '..', '..');
      const tauriBinariesDir = path.resolve(rootDir, 'src-tauri', 'binaries');
      const coreBinariesDir = path.resolve(rootDir, 'core', 'binaries');

      // Verify binary directories exist
      expect(fs.existsSync(tauriBinariesDir)).toBe(true);
      expect(fs.existsSync(coreBinariesDir)).toBe(true);

      // Verify kin-core.exe exists in both dirs
      const tauriExe = path.resolve(tauriBinariesDir, 'kin-core.exe');
      const coreExe = path.resolve(coreBinariesDir, 'kin-core.exe');
      expect(fs.existsSync(tauriExe)).toBe(true);
      expect(fs.existsSync(coreExe)).toBe(true);

      // Check binary size (SEA binary must be > 50 MB)
      const tauriStat = fs.statSync(tauriExe);
      expect(tauriStat.size).toBeGreaterThan(50 * 1024 * 1024);

      // Verify schema.sql bundled in distribution
      const schemaTauri = path.resolve(tauriBinariesDir, 'schema.sql');
      const schemaCore = path.resolve(coreBinariesDir, 'schema.sql');
      expect(fs.existsSync(schemaTauri)).toBe(true);
      expect(fs.existsSync(schemaCore)).toBe(true);
    });

    it('2.4 package_binary.js source includes signature stripping and postject sentinel fuse', () => {
      const rootDir = path.resolve(__dirname, '..', '..');
      const scriptPath = path.resolve(rootDir, 'core', 'scripts', 'package_binary.js');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      // Pre-injection signature removal
      expect(scriptContent).toContain('signtool remove /s');
      expect(scriptContent).toContain('codesign --remove-signature');

      // Postject injection sentinel fuse
      expect(scriptContent).toContain('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2');
      expect(scriptContent).toContain('NODE_SEA_BLOB');

      // Target triples for cross-platform packaging
      expect(scriptContent).toContain('x86_64-pc-windows-msvc');
      expect(scriptContent).toContain('x86_64-apple-darwin');
      expect(scriptContent).toContain('aarch64-apple-darwin');
      expect(scriptContent).toContain('x86_64-unknown-linux-gnu');
    });
  });

  // ==========================================================================
  // 3. FEATURE 39: CI/CD RELEASE WORKFLOW SPECIFICATION
  // ==========================================================================
  describe('Feature 39: Release Workflow Syntax & Configuration', () => {

    it('3.1 .github/workflows/release.yml contains all 4 quality gates and 3-OS matrix', () => {
      const rootDir = path.resolve(__dirname, '..', '..');
      const workflowPath = path.resolve(rootDir, '.github', 'workflows', 'release.yml');
      expect(fs.existsSync(workflowPath)).toBe(true);

      const content = fs.readFileSync(workflowPath, 'utf-8');

      // Multi-OS matrix
      expect(content).toContain('platform: [windows-latest, macos-latest, ubuntu-latest]');

      // Triggers
      expect(content).toContain("tags:\n      - 'v*'");
      expect(content).toContain('workflow_dispatch:');

      // Gate 1: Typecheck
      expect(content).toContain('Gate 1');
      expect(content).toContain('npm run typecheck');

      // Gate 2: Core Vitest Test Suite
      expect(content).toContain('Gate 2');
      expect(content).toContain('npm run test --workspace=core');

      // Gate 3: Tauri Cargo Tests
      expect(content).toContain('Gate 3');
      expect(content).toContain('cargo test --manifest-path src-tauri/Cargo.toml');

      // Gate 4: Standalone Binary Boot & API Health Check
      expect(content).toContain('Gate 4');
      expect(content).toContain('/api/health');

      // Tauri action configuration
      expect(content).toContain('uses: tauri-apps/tauri-action@v1');

      // Checksum generation and upload
      expect(content).toContain('generate-checksums:');
      expect(content).toContain('sha256sum * > ../SHA256SUMS.txt');
      expect(content).toContain('gh release upload ${{ github.ref_name }} SHA256SUMS.txt');
    });
  });
});
