import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecretVault } from '../src/security/secret_vault.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { OutputSpiller } from '../src/context/output_spiller.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import { CoreServer } from '../src/server/core_server.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import * as nodeCrypto from 'node:crypto';

describe('KIN Hardening: Security, Approval Tokens, and Runtime Enforcement', () => {
  let tempDir: string;
  let testDb: KinDatabase;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-hardening-test-'));
    testDb = new KinDatabase({ dbPath: path.join(tempDir, 'test.sqlite') });
    const runner = new MigrationRunner(testDb);
    runner.runMigrations();

    const now = Date.now();
    testDb.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      'ws-1', 'Test WS', tempDir, 'AUTO', now, now
    );
    testDb.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      'p1', 'ws-1', 'Test Project', tempDir, now, now
    );
    testDb.execute(
      `INSERT INTO channels (id, project_id, name, created_at) VALUES (?, ?, ?, ?)`,
      'c1', 'p1', 'general', now
    );
    testDb.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      'def-test', 'Tester', 'Test Agent', 'Prompt', 'ollama/qwen2.5-coder:3b', now
    );
    for (const id of ['agent-root', 'agent-child-1', 'agent-grandchild', 'agent-child-2', 'agent-test']) {
      testDb.execute(
        `INSERT INTO agent_identities (id, workspace_id, definition_id, display_name, active_model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id, 'ws-1', 'def-test', `@${id}`, 'ollama/qwen2.5-coder:3b', now, now
      );
    }
  });

  afterEach(() => {
    try {
      testDb.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    SecretVault.resetInstance();
  });

  describe('SecretVault (AES-256-GCM Credential Storage)', () => {
    it('encrypts and decrypts secret credentials accurately', () => {
      const keyFile = path.join(tempDir, 'test_vault.key');
      const vault = new SecretVault({ keyFilePath: keyFile });

      const plaintext = 'sk-or-v1-my-secret-key-1234567890abcdef';
      const encrypted = vault.encrypt(plaintext);

      expect(encrypted).toMatch(/^vault:v1:[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+$/);
      expect(encrypted).not.toContain(plaintext);

      const decrypted = vault.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('transparently preserves legacy plaintext credentials for backward compatibility', () => {
      const vault = new SecretVault();
      const legacyKey = 'sk-legacy-plain-text-key';
      expect(vault.decrypt(legacyKey)).toBe(legacyKey);
    });

    it('rejects tampered ciphertexts and detects corruption', () => {
      const vault = new SecretVault();
      const encrypted = vault.encrypt('secret');
      const parts = encrypted.split(':');
      // Corrupt the ciphertext body deterministically by bit-flipping the first byte
      const firstByte = parseInt(parts[4].slice(0, 2), 16);
      const flipped = (firstByte ^ 0xff).toString(16).padStart(2, '0');
      parts[4] = flipped + parts[4].slice(2);
      const tampered = parts.join(':');

      expect(() => vault.decrypt(tampered)).toThrow();
    });

    it('derives a consistent master key from custom 32-byte hex or string', () => {
      const customKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const vaultA = new SecretVault({ masterKey: customKey });
      const vaultB = new SecretVault({ masterKey: customKey });

      const encrypted = vaultA.encrypt('shared-secret');
      expect(vaultB.decrypt(encrypted)).toBe('shared-secret');
    });
  });

  describe('Single-Use Approval Tokens (CRITICAL Action Deadlock Fix)', () => {
    it('generates and consumes approval token exactly once', () => {
      const gateway = new ToolGateway();
      const runId = 'run-test-123';
      const toolName = 'executeShell';

      const token = gateway.generateApprovalToken(toolName, runId);
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(16);

      // First consumption succeeds
      const firstTry = gateway.consumeApprovalToken(token, toolName, runId);
      expect(firstTry).toBe(true);

      // Replay attempt fails
      const secondTry = gateway.consumeApprovalToken(token, toolName, runId);
      expect(secondTry).toBe(false);
    });

    it('rejects token consumption if toolName or runId does not match', () => {
      const gateway = new ToolGateway();
      const token = gateway.generateApprovalToken('writeFile', 'run-abc');

      expect(gateway.consumeApprovalToken(token, 'executeShell', 'run-abc')).toBe(false);
      expect(gateway.consumeApprovalToken(token, 'writeFile', 'run-wrong')).toBe(false);
      // Valid consumption still works
      expect(gateway.consumeApprovalToken(token, 'writeFile', 'run-abc')).toBe(true);
    });
  });

  describe('Recursive CTE Agent Hierarchy (Transitive Descendant Count)', () => {
    it('accurately counts descendants across deep multi-agent delegation trees', () => {
      const kernel = new AgentKernel(testDb);

      const runA = kernel.spawnRun({ agentId: 'agent-root', projectId: 'p1', channelId: 'c1' });
      const runB = kernel.spawnRun({ agentId: 'agent-child-1', projectId: 'p1', channelId: 'c1', parentRunId: runA.id });
      const runC = kernel.spawnRun({ agentId: 'agent-grandchild', projectId: 'p1', channelId: 'c1', parentRunId: runB.id });
      const runD = kernel.spawnRun({ agentId: 'agent-child-2', projectId: 'p1', channelId: 'c1', parentRunId: runA.id });

      expect(kernel.countDescendants(runA.id)).toBe(3);
      expect(kernel.countDescendants(runB.id)).toBe(1);
      expect(kernel.countDescendants(runC.id)).toBe(0);
      expect(kernel.countDescendants(runD.id)).toBe(0);
    });

    it('records token usage and correctly detects budget limits', () => {
      const kernel = new AgentKernel(testDb);
      const run = kernel.spawnRun({
        agentId: 'agent-test',
        projectId: 'p1',
        channelId: 'c1',
        allocatedTokens: 1000,
      });

      const res1 = kernel.recordTokenUsage(run.id, 400);
      expect(res1.exceeded).toBe(false);

      const updatedRun1 = kernel.getRun(run.id);
      expect(updatedRun1?.usedTokens).toBe(400);

      const res2 = kernel.recordTokenUsage(run.id, 700);
      expect(res2.exceeded).toBe(true);

      const updatedRun2 = kernel.getRun(run.id);
      expect(updatedRun2?.usedTokens).toBe(1100);
    });
  });

  describe('OutputSpiller (Context Safety & File Spilling)', () => {
    it('leaves outputs smaller than threshold inline without spilling', () => {
      const spiller = new OutputSpiller({
        spillDir: path.join(tempDir, 'spill'),
        thresholdBytes: 4000,
      });

      const smallOutput = 'Brief tool result data.';
      const res = spiller.processOutput(smallOutput, 'readFile');

      expect(res.isSpilled).toBe(false);
      expect(res.content).toBe(smallOutput);
    });

    it('spills outputs larger than 4000 bytes and creates a bounded preview with disk link', () => {
      const spillDir = path.join(tempDir, 'spill');
      const spiller = new OutputSpiller({
        spillDir,
        thresholdBytes: 4000,
      });

      const largeOutput = 'LINE CONTENT\n'.repeat(500); // ~6500 bytes
      const res = spiller.processOutput(largeOutput, 'executeShell');

      expect(res.isSpilled).toBe(true);
      expect(res.hash).toBeDefined();
      expect(res.spillUri).toBeDefined();
      expect(res.content).toContain('persisted at: file:///');
      expect(res.content).toContain('lines (');

      // Verify file was written to disk
      const savedContent = spiller.readSpillFile(res.hash!);
      expect(savedContent).toBe(largeOutput);
    });
  });

  describe('CoreServer Loopback IPC Token Auth & CORS', () => {
    let server: CoreServer;
    let serverPort: number;

    beforeEach(async () => {
      server = new CoreServer({
        port: 0,
        dbPath: path.join(tempDir, 'server_test.sqlite'),
        requireIpcAuth: true,
      });
      serverPort = await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    it('rejects unauthorized requests with 401 when requireIpcAuth is active', async () => {
      const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/workspace`,
          { method: 'GET' },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: data }));
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(res.statusCode).toBe(401);
      expect(res.body).toContain('Unauthorized');
    });

    it('accepts authorized requests when valid token is provided via Authorization Bearer header', async () => {
      const token = server.getIpcAuthToken();
      expect(token).toBeDefined();

      const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/projects`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: data }));
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns full CORS preflight headers allowing operator signature and custom headers', async () => {
      const res = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/tasks/task-test/status`,
          {
            method: 'OPTIONS',
            headers: {
              Origin: 'http://localhost:5173',
              'Access-Control-Request-Method': 'PATCH',
              'Access-Control-Request-Headers': 'Content-Type, Authorization, X-Kin-Operator-Signature, X-Kin-Approval-Token',
            },
          },
          (response) => {
            resolve({ statusCode: response.statusCode || 0, headers: response.headers });
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-headers']).toContain('X-Kin-Operator-Signature');
      expect(res.headers['access-control-allow-headers']).toContain('X-Kin-Approval-Token');
      expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    });

    it('authenticates task signoff via HMAC signature and rejects invalid signatures', async () => {
      const token = server.getIpcAuthToken();
      expect(token).toBeDefined();

      const db = new KinDatabase({ dbPath: path.join(tempDir, 'server_test.sqlite') });
      const taskId = 'task-test-sig-1';
      db.execute(
        `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
         VALUES ('ws-test-sig', 'Test WS', '.', 'AUTO', ?, ?)`,
        Date.now(),
        Date.now()
      );
      db.execute(
        `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, created_at, updated_at)
         VALUES ('proj-kin', 'ws-test-sig', 'Default Project', '.', ?, ?)`,
        Date.now(),
        Date.now()
      );
      db.execute(
        `INSERT OR IGNORE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
         VALUES ('goal-test-sig', 'proj-kin', 'Test Goal', 'desc', '[]', 'active', ?, ?)`,
        Date.now(),
        Date.now()
      );
      db.execute(
        `INSERT INTO tasks (id, goal_id, title, description, status, retry_count, created_at, updated_at)
         VALUES (?, 'goal-test-sig', 'Test Signature Task', 'desc', 'ready', 0, ?, ?)`,
        taskId,
        Date.now(),
        Date.now()
      );
      db.close();

      // 1. Invalid signature should place task in review and return 403
      const badSigRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/tasks/${taskId}/status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'x-kin-operator-signature': 'deadbeef00112233',
            },
          },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: JSON.parse(data) }));
          }
        );
        req.on('error', reject);
        req.write(
          JSON.stringify({
            status: 'completed',
            operatorSignoff: {
              operatorId: 'operator-human',
              signature: 'deadbeef00112233',
              justification: 'Automated test signoff',
            },
          })
        );
        req.end();
      });

      expect(badSigRes.statusCode).toBe(403);
      expect(badSigRes.body.status).toBe('review');

      // 2. Valid HMAC compact signature should succeed with 200
      const validSig = nodeCrypto.createHmac('sha256', token!).update(`${taskId}:completed`).digest('hex');
      const goodSigRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/tasks/${taskId}/status`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'x-kin-operator-signature': validSig,
            },
          },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: JSON.parse(data) }));
          }
        );
        req.on('error', reject);
        req.write(
          JSON.stringify({
            status: 'completed',
            operatorSignoff: {
              operatorId: 'operator-human',
              signature: validSig,
              justification: 'Automated test signoff',
            },
          })
        );
        req.end();
      });

      expect(goodSigRes.statusCode).toBe(200);
      expect(goodSigRes.body.status).toBe('completed');
    });

    it('encrypts credentials on POST and decrypts them for masking on GET', async () => {
      const token = server.getIpcAuthToken();

      const createRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/settings/credentials`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: JSON.parse(data) }));
          }
        );
        req.on('error', reject);
        req.write(
          JSON.stringify({
            provider: 'anthropic',
            keyName: 'Anthropic Prod',
            apiKey: 'sk-ant-api03-verylongsecretkey12345678',
          })
        );
        req.end();
      });

      expect(createRes.statusCode).toBe(201);
      expect(createRes.body.credential.maskedKey).toBe('sk-a...5678');

      // Check database to ensure it is encrypted at rest with vault prefix
      const db = new KinDatabase({ dbPath: path.join(tempDir, 'server_test.sqlite') });
      const row = db.queryOne<any>('SELECT secret_hash FROM managed_credentials WHERE provider = ?', 'anthropic');
      expect(row.secret_hash).toMatch(/^vault:v1:/);
      expect(row.secret_hash).not.toContain('verylongsecretkey');
      db.close();

      // Read via GET endpoint to ensure transparent decryption for masking
      const listRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/settings/credentials`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: JSON.parse(data) }));
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(listRes.statusCode).toBe(200);
      const found = listRes.body.credentials.find((c: any) => c.provider === 'anthropic');
      expect(found).toBeDefined();
      expect(found.maskedKey).toBe('sk-a...5678');
    });

    it('enforces strict project scoping on approvals between proj-kin and a secondary project', async () => {
      const token = server.getIpcAuthToken();

      // Create a pending approval in default project
      const apprRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/approvals`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: JSON.parse(data) }));
          }
        );
        req.on('error', reject);
        req.write(
          JSON.stringify({
            agentId: 'agent-boss',
            toolName: 'executeShell',
            actionPayload: { command: 'echo isolation-test' },
            riskLevel: 'HIGH',
          })
        );
        req.end();
      });

      expect(apprRes.statusCode).toBe(201);
      const approvalId = apprRes.body.approval.id;
      expect(approvalId).toBeDefined();

      // Query approvals for proj-kin
      const kinApprovalsRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/approvals?projectId=proj-kin`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: JSON.parse(data) }));
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(kinApprovalsRes.statusCode).toBe(200);
      expect(kinApprovalsRes.body.approvals.some((a: any) => a.id === approvalId)).toBe(true);

      // Query approvals for a secondary project (e.g. proj-testtt)
      const secondaryApprovalsRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/approvals?projectId=proj-testtt`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: JSON.parse(data) }));
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(secondaryApprovalsRes.statusCode).toBe(200);
      expect(secondaryApprovalsRes.body.approvals.some((a: any) => a.id === approvalId)).toBe(false);

      // Query /api/state for secondary project
      const secondaryStateRes = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/state?projectId=proj-testtt`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: JSON.parse(data) }));
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(secondaryStateRes.statusCode).toBe(200);
      expect(secondaryStateRes.body.pendingApprovals.some((a: any) => a.id === approvalId)).toBe(false);
    });
  });
});
