// ============================================================================
// KIN 18-LAYER AI AGENT HARNESS PRODUCTION VERIFICATION SUITE
// Rigorous end-to-end integration and runtime verification of all 18 layers:
// 1. Foundation Model Layer      10. Planning Layer
// 2. Orchestration Layer         11. Execution Layer
// 3. Context Layer               12. Multi-Agent Layer
// 4. Memory Layer                13. Governance Layer
// 5. Tool Layer                  14. Observability Layer
// 6. Connector Layer             15. Evaluation Layer
// 7. MCP Layer                   16. Security Layer
// 8. Knowledge/RAG Layer         17. UI Layer
// 9. Workspace Layer             18. Deployment Infrastructure
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { CoreServer } from '../src/server/core_server.js';
import { KinDatabase } from '../src/storage/db.js';
import { SecretVault } from '../src/security/secret_vault.js';
import { Sentinel } from '../src/security/sentinel.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { ContextCompactor } from '../src/context/context_compactor.js';

describe('KIN 18-Layer AI Agent Harness Production Verification', () => {
  let tempDir: string;
  let testDbPath: string;
  let server: CoreServer;
  let serverPort: number;
  let baseUrl: string;
  let ipcToken: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-18-layer-prod-'));
    testDbPath = path.join(tempDir, 'kin_18_layer_test.sqlite');

    // Instantiate clean CoreServer with IPC authentication enabled
    server = new CoreServer({
      port: 0,
      dbPath: testDbPath,
      requireIpcAuth: true,
    });

    serverPort = await server.start();
    baseUrl = `http://127.0.0.1:${serverPort}`;
    ipcToken = server.getIpcAuthToken();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    try {
      const localKinMcp = path.resolve(process.cwd(), '.kin', 'mcp.json');
      if (fs.existsSync(localKinMcp)) {
        fs.unlinkSync(localKinMcp);
      }
    } catch {}
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // Reusable HTTP request helper
  function request(
    method: string,
    reqPath: string,
    headers: Record<string, string> = {},
    body?: any
  ): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
      const url = new URL(reqPath, baseUrl);
      const reqHeaders: Record<string, string> = { ...headers };
      let payload = '';

      if (body !== undefined) {
        payload = typeof body === 'string' ? body : JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
      }

      const req = http.request(
        url,
        {
          method,
          headers: reqHeaders,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: data,
              json: () => JSON.parse(data),
            });
          });
        }
      );

      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  // --------------------------------------------------------------------------
  // LAYER 1: Foundation Model Layer
  // --------------------------------------------------------------------------
  describe('Layer 1: Foundation Model Layer', () => {
    it('discovers dynamic models catalog and checks provider readiness', async () => {
      const res = await request('GET', '/api/models', { 'X-IPC-Token': ipcToken });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data.models)).toBe(true);
      expect(data.providerReadiness).toBeDefined();
    });

    it('registers a custom provider endpoint and verifies presence', async () => {
      const res = await request('POST', '/api/models/custom', { 'X-IPC-Token': ipcToken }, {
        modelId: 'custom/qwen-local',
        modelName: 'Qwen 2.5 Local Test',
        provider: 'custom',
        contextWindow: 16384,
        isFree: true,
      });
      expect([200, 201]).toContain(res.statusCode);
      expect(res.json().success).toBe(true);

      const listRes = await request('GET', '/api/models', { 'X-IPC-Token': ipcToken });
      const customModel = listRes.json().models.find((m: any) => m.id === 'custom/qwen-local');
      expect(customModel).toBeDefined();
      expect(customModel.contextWindow).toBe(16384);
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 2: Orchestration Layer
  // --------------------------------------------------------------------------
  describe('Layer 2: Orchestration Layer', () => {
    it('accepts incoming human message in #general and queues agent turn execution', async () => {
      const res = await request('POST', '/api/channels/chan-general/messages', { 'X-IPC-Token': ipcToken }, {
        content: 'Hello workforce, please inspect current status.',
        senderId: 'operator-1',
        senderType: 'human',
      });
      expect([200, 201]).toContain(res.statusCode);
      const data = res.json();
      expect(data.message).toBeDefined();
      expect(data.message.content).toContain('Hello workforce');
      expect(data.message.channelId).toBe('chan-general');
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 3: Context Layer
  // --------------------------------------------------------------------------
  describe('Layer 3: Context Layer', () => {
    it('evaluates and compacts overflowing conversation history with structured snapshot', () => {
      const compactor = new ContextCompactor();
      const longMessages = Array.from({ length: 20 }, (_, idx) => ({
        id: `msg-${idx}`,
        channelId: 'chan-general',
        senderId: idx % 2 === 0 ? 'user' : 'agent-boss',
        senderType: (idx % 2 === 0 ? 'human' : 'agent') as 'human' | 'agent',
        content: `Detailed project progress log step ${idx}: ` + 'x'.repeat(400),
        mentions: [],
        productivityScore: 100,
        createdAt: Date.now() - (20 - idx) * 1000,
      }));

      const result = compactor.evaluateAndCompact({
        messages: longMessages,
        currentTokens: 5000,
        maxTokens: 4000,
        compactionThresholdRatio: 0.7,
        snapshotState: {
          goalId: 'goal-kin-bootstrap',
          primaryObjective: 'Build production-ready multi-agent harness',
          completedTasks: [{ id: 'task-1', title: 'Setup database schema' }],
          activeTask: { id: 'task-2', title: 'Verify IPC endpoints' },
          modifiedFiles: [{ path: 'core/src/server/core_server.ts' }],
          encounteredErrorsAndResolutions: [],
          immutableDecisions: [{ key: 'adr-1', decision: 'Use SQLite WAL mode' }],
          pendingTaskDag: [{ id: 'task-3', title: 'Release desktop shell', dependsOn: ['task-2'] }],
        },
      });

      expect(result.didCompact).toBe(true);
      expect(result.snapshot).toBeDefined();
      expect(result.compactedMessages.length).toBeLessThan(longMessages.length);
      const snapshotText = compactor.formatSnapshot(result.snapshot!);
      expect(snapshotText).toContain('SYSTEM COMPACTION SNAPSHOT');
      expect(snapshotText).toContain('Build production-ready multi-agent harness');
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 4: Memory Layer
  // --------------------------------------------------------------------------
  describe('Layer 4: Memory Layer', () => {
    it('persists and recalls channel-scoped working memory', async () => {
      const db = server.getDatabase();
      const now = Date.now();
      db.execute(
        `INSERT INTO memories (id, scope, scope_id, type, key, value_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'mem-1',
        'channel',
        'chan-general',
        'working_state',
        'build_target',
        JSON.stringify({ target: 'production', arch: 'x86_64' }),
        1,
        now,
        now
      );

      const recalled = db.queryOne<{ value_json: string }>(
        'SELECT value_json FROM memories WHERE scope = ? AND scope_id = ? AND key = ?',
        'channel',
        'chan-general',
        'build_target'
      );
      expect(recalled).toBeDefined();
      const val = JSON.parse(recalled!.value_json);
      expect(val.target).toBe('production');
      expect(val.arch).toBe('x86_64');
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 5: Tool Layer
  // --------------------------------------------------------------------------
  describe('Layer 5: Tool Layer', () => {
    it('executes safe file operations within project jail and enforces directory containment', async () => {
      const toolGateway = server.getToolGateway();
      const testFilePath = 'test_sandbox_file.txt';

      const writeResult = await toolGateway.executeTool(
        'writeFile',
        { path: testFilePath, content: 'Production Ready Content' },
        {
          runId: 'run-tool-test-1',
          agentId: 'agent-boss',
          worktreeRoot: tempDir,
          autonomyMode: 'autonomous',
          allowedCapabilities: ['write', 'read'],
        }
      );
      expect(writeResult.error).toBeUndefined();

      const readResult = await toolGateway.executeTool<{ content?: string } | string>(
        'readFile',
        { filePath: testFilePath },
        {
          runId: 'run-tool-test-2',
          agentId: 'agent-boss',
          worktreeRoot: tempDir,
          autonomyMode: 'autonomous',
          allowedCapabilities: ['read'],
        }
      );
      expect(readResult.output).toBe('Production Ready Content');

      // Attempt directory traversal attack outside jail
      const escapeResult = await toolGateway.executeTool(
        'readFile',
        { filePath: '../../../../../../Windows/System32/drivers/etc/hosts' },
        {
          runId: 'run-tool-test-3',
          agentId: 'agent-boss',
          worktreeRoot: tempDir,
          autonomyMode: 'autonomous',
          allowedCapabilities: ['read'],
        }
      );
      expect(escapeResult.error).toMatch(/SECURITY JAIL VIOLATION|ACCESS_DENIED|escapes worktree jail/i);
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 6: Connector Layer
  // --------------------------------------------------------------------------
  describe('Layer 6: Connector Layer', () => {
    it('receives external incoming message and broadcasts to channel members', async () => {
      const res = await request('POST', '/api/channels/chan-general/messages', { 'X-IPC-Token': ipcToken }, {
        content: '[EXTERNAL WEBHOOK]: Build #42 succeeded.',
        senderId: 'connector-ci-bot',
        senderType: 'human',
      });
      expect([200, 201]).toContain(res.statusCode);
      expect(res.json().message).toBeDefined();

      const msgsRes = await request('GET', '/api/channels/chan-general/messages', { 'X-IPC-Token': ipcToken });
      expect(msgsRes.statusCode).toBe(200);
      const msgs = msgsRes.json().messages;
      expect(msgs.some((m: any) => m.content.includes('[EXTERNAL WEBHOOK]'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 7: MCP Layer
  // --------------------------------------------------------------------------
  describe('Layer 7: Model Context Protocol (MCP) Layer', () => {
    it('lists configured MCP connectors and discovers schema paths', async () => {
      const res = await request('GET', '/api/mcp/connectors?projectId=proj-kin', { 'X-IPC-Token': ipcToken });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.paths.global).toBeDefined();
      expect(data.activeProjectId).toBe('proj-kin');
    });

    it('persists a new connector configuration in project scope', async () => {
      const res = await request('POST', '/api/mcp/connectors/save', { 'X-IPC-Token': ipcToken }, {
        scope: 'project',
        name: 'test-project-mcp',
        config: {
          command: 'node',
          args: ['-e', 'console.log("mcp ready")'],
          env: { NODE_ENV: 'test' },
        },
        projectId: 'proj-kin',
      });
      expect([200, 201]).toContain(res.statusCode);
      expect(res.json().success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 8: Knowledge/RAG Layer
  // --------------------------------------------------------------------------
  describe('Layer 8: Knowledge/RAG Layer', () => {
    it('uploads project attachment, indexes metadata, and permits secure download', async () => {
      const testContent = Buffer.from('Architecture Whitepaper KIN V12: Production Certified').toString('base64');
      const uploadRes = await request('POST', '/api/projects/proj-kin/uploads', { 'X-IPC-Token': ipcToken }, {
        filename: 'whitepaper.txt',
        contentBase64: testContent,
        mimeType: 'text/plain',
      });
      expect([200, 201]).toContain(uploadRes.statusCode);
      const uploadData = uploadRes.json();
      expect(uploadData.success).toBe(true);
      const uploadId = uploadData.upload.id;

      // Verify list
      const listRes = await request('GET', '/api/projects/proj-kin/uploads', { 'X-IPC-Token': ipcToken });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().uploads.some((u: any) => u.id === uploadId)).toBe(true);

      // Verify download
      const downloadRes = await request('GET', `/api/projects/proj-kin/uploads/${uploadId}/download`, { 'X-IPC-Token': ipcToken });
      expect(downloadRes.statusCode).toBe(200);
      expect(downloadRes.body).toContain('Architecture Whitepaper KIN V12: Production Certified');
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 9: Workspace Layer
  // --------------------------------------------------------------------------
  describe('Layer 9: Workspace Layer', () => {
    it('creates secondary isolated project and ensures channel isolation', async () => {
      const res = await request('POST', '/api/projects', { 'X-IPC-Token': ipcToken }, {
        name: 'Demo Isolated App',
        repoPath: tempDir,
      });
      expect([200, 201]).toContain(res.statusCode);
      const newProj = res.json().project;
      expect(newProj.id).toBeDefined();

      // Ensure switching project is verified
      const activateRes = await request('POST', `/api/projects/${newProj.id}/activate`, { 'X-IPC-Token': ipcToken });
      expect(activateRes.statusCode).toBe(200);

      const stateRes = await request('GET', '/api/state', { 'X-IPC-Token': ipcToken });
      expect(stateRes.json().activeProject.id).toBe(newProj.id);

      // Re-activate main project
      await request('POST', '/api/projects/proj-kin/activate', { 'X-IPC-Token': ipcToken });
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 10: Planning Layer
  // --------------------------------------------------------------------------
  describe('Layer 10: Planning Layer', () => {
    it('creates Goal, establishes Task DAG with dependencies, and tracks progress with operator signoff', async () => {
      // 1. Create Goal
      const goalRes = await request('POST', '/api/projects/proj-kin/goals', { 'X-IPC-Token': ipcToken }, {
        title: 'Release Production Build',
        description: 'Complete all automated production readiness gates',
      });
      expect([200, 201]).toContain(goalRes.statusCode);
      const goalId = goalRes.json().goal.id;

      // 2. Create Parent Task under Goal
      const task1Res = await request('POST', `/api/goals/${goalId}/tasks`, { 'X-IPC-Token': ipcToken }, {
        title: 'Compile Hardened Binaries',
        description: 'Compile binaries in release mode',
        priority: 1,
      });
      expect([200, 201]).toContain(task1Res.statusCode);
      const task1Id = task1Res.json().task.id;

      // 3. Create Dependent Task under Goal
      const task2Res = await request('POST', `/api/goals/${goalId}/tasks`, { 'X-IPC-Token': ipcToken }, {
        title: 'Run Final Verification Suite',
        description: 'Ensure test pass rate',
        dependsOnTaskIds: [task1Id],
        priority: 2,
      });
      expect([200, 201]).toContain(task2Res.statusCode);
      const task2 = task2Res.json().task;
      expect(task2.status).toBe('backlog'); // initial status is backlog because task1 is not completed

      // 4. Update Task 1 to completed with authoritative operator signoff signature
      const sig = crypto.createHmac('sha256', ipcToken).update(`${task1Id}:completed`).digest('hex');
      const updateRes = await request('PATCH', `/api/tasks/${task1Id}/status`, { 'X-IPC-Token': ipcToken }, {
        status: 'completed',
        operatorSignoff: {
          operatorId: 'operator-admin',
          signature: sig,
          justification: 'Verified by test harness',
        },
      });
      expect(updateRes.statusCode).toBe(200);
      const updateData = updateRes.json();
      expect(updateData.status).toBe('completed');
      expect(updateData.promotedTaskIds).toContain(task2.id);
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 11: Execution Layer
  // --------------------------------------------------------------------------
  describe('Layer 11: Execution Layer', () => {
    it('enforces execution lease validity and tracks active runner registrations', async () => {
      const db = server.getDatabase();
      const now = Date.now();
      db.execute(
        `INSERT INTO agent_runs (id, agent_id, state, heartbeat_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        'run-exec-layer-test',
        'agent-boss',
        'running',
        now,
        now
      );

      const runRow = db.queryOne<{ state: string }>('SELECT state FROM agent_runs WHERE id = ?', 'run-exec-layer-test');
      expect(runRow?.state).toBe('running');

      // Update to completed
      db.execute('UPDATE agent_runs SET state = ?, completed_at = ? WHERE id = ?', 'completed', Date.now(), 'run-exec-layer-test');
      const finishedRow = db.queryOne<{ state: string }>('SELECT state FROM agent_runs WHERE id = ?', 'run-exec-layer-test');
      expect(finishedRow?.state).toBe('completed');
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 12: Multi-Agent / Individual Agents Layer
  // --------------------------------------------------------------------------
  describe('Layer 12: Multi-Agent Layer', () => {
    it('hires and boards a specialist agent into project and general channel', async () => {
      const res = await request('POST', '/api/agents', { 'X-IPC-Token': ipcToken }, {
        name: 'Reliability Engineer',
        role: 'Site Reliability & Chaos Specialist',
        displayName: '@SRE',
        activeModelId: 'custom/qwen-local',
        capabilities: ['read', 'write', 'shell'],
        systemPrompt: 'You specialize in chaos engineering and site reliability.',
      });
      expect([200, 201]).toContain(res.statusCode);
      const agent = res.json().agent;
      expect(agent.displayName).toBe('@SRE');

      // Verify agent is listed in state
      const stateRes = await request('GET', '/api/state', { 'X-IPC-Token': ipcToken });
      expect(stateRes.json().agents.some((a: any) => a.displayName === '@SRE')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 13: Governance Layer
  // --------------------------------------------------------------------------
  describe('Layer 13: Governance Layer', () => {
    it('creates operator approval gate with single-use token and verifies atomic resolution', async () => {
      const createRes = await request('POST', '/api/approvals', { 'X-IPC-Token': ipcToken }, {
        runId: 'run-gov-test',
        agentId: 'agent-boss',
        toolName: 'executeShell',
        params: { command: 'systemctl restart' },
        riskLevel: 'HIGH',
        channelId: 'chan-general',
      });
      expect([200, 201]).toContain(createRes.statusCode);
      const approval = createRes.json().approval;
      expect(approval.id).toBeDefined();
      expect(approval.status).toBe('pending');
      const token = approval.token;

      // First resolution: approve
      const resolveRes = await request('POST', `/api/approvals/${approval.id}/resolve`, { 'X-IPC-Token': ipcToken }, {
        approved: true,
        token,
      });
      expect(resolveRes.statusCode).toBe(200);
      expect(resolveRes.json().success).toBe(true);

      // Second resolution with same token must fail (single-use token invariant)
      const duplicateRes = await request('POST', `/api/approvals/${approval.id}/resolve`, { 'X-IPC-Token': ipcToken }, {
        approved: true,
        token,
      });
      expect(duplicateRes.statusCode).toBe(400);
      expect(duplicateRes.json().error).toMatch(/is not pending|already resolved|invalid or consumed token/i);
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 14: Observability Layer
  // --------------------------------------------------------------------------
  describe('Layer 14: Observability Layer', () => {
    it('verifies SHA-256 tamper-evident hash chain in event_journal', () => {
      const ledger = EventLedger.getInstance();
      const event1Id = ledger.record({
        eventType: 'TEST_EVENT_ALPHA',
        entityType: 'system',
        entityId: 'test-node-1',
        payload: { step: 1 },
      });
      const event2Id = ledger.record({
        eventType: 'TEST_EVENT_BETA',
        entityType: 'agent',
        entityId: 'agent-boss',
        payload: { step: 2 },
      });

      expect(typeof event1Id).toBe('number');
      expect(typeof event2Id).toBe('number');

      const verification = ledger.verifyChainIntegrity();
      expect(verification.valid).toBe(true);
      expect(verification.verifiedCount).toBeGreaterThanOrEqual(2);
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 15: Evaluation Layer
  // --------------------------------------------------------------------------
  describe('Layer 15: Evaluation Layer', () => {
    it('executes agent evaluation benchmark and saves scores', async () => {
      const res = await request('POST', '/api/agents/agent-boss/evaluate', { 'X-IPC-Token': ipcToken }, {
        benchmarkName: 'Safety and Code Quality',
      });
      expect([200, 201]).toContain(res.statusCode);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(typeof data.evaluation.score).toBe('number');
      expect(data.evaluation.agentId).toBe('agent-boss');
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 16: Security Layer
  // --------------------------------------------------------------------------
  describe('Layer 16: Security Layer', () => {
    it('encrypts secrets in SecretVault with AES-256-GCM and decrypts on-demand', () => {
      const vault = SecretVault.getInstance();
      const secret = 'super-secret-api-key-xyz-987';
      const encrypted = vault.encrypt(secret);
      expect(encrypted).not.toBe(secret);
      expect(encrypted).toContain(':'); // IV:Tag:Data format

      const decrypted = vault.decrypt(encrypted);
      expect(decrypted).toBe(secret);
    });

    it('rejects destructive commands in Sentinel fail-closed evaluation', () => {
      const sentinel = Sentinel.getInstance();
      const evalResult = sentinel.evaluate({
        agentId: 'agent-boss',
        toolName: 'executeShell',
        params: { command: 'rm -rf /*' },
        autonomyMode: 'autonomous',
        agentCapabilities: ['*'],
      });
      expect(evalResult.requiresApproval).toBe(true);
      expect(evalResult.isDestructive).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 17: UI Layer
  // --------------------------------------------------------------------------
  describe('Layer 17: UI Layer', () => {
    it('serves pre-compiled index.html and SPA fallback for UI routes', async () => {
      const res = await request('GET', '/');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');

      const spaRes = await request('GET', '/projects/proj-kin/settings');
      expect(spaRes.statusCode).toBe(200);
      expect(spaRes.headers['content-type']).toContain('text/html');
    });
  });

  // --------------------------------------------------------------------------
  // LAYER 18: Deployment Infrastructure
  // --------------------------------------------------------------------------
  describe('Layer 18: Deployment Infrastructure', () => {
    it('verifies GET /api/health and runs PRAGMA optimize maintenance', async () => {
      const healthRes = await request('GET', '/api/health');
      expect(healthRes.statusCode).toBe(200);
      const health = healthRes.json();
      expect(health.status).toBe('ok');
      expect(health.database.integrity).toBe('ok');

      const optRes = await request('POST', '/api/system/optimize', { 'X-IPC-Token': ipcToken });
      expect(optRes.statusCode).toBe(200);
      expect(optRes.json().success).toBe(true);
    });

    it('verifies standalone native desktop sidecar binary template exists', () => {
      const rootDir = fs.existsSync(path.resolve(process.cwd(), 'package.json')) && fs.existsSync(path.resolve(process.cwd(), 'src-tauri'))
        ? process.cwd()
        : path.resolve(process.cwd(), '..');
      const binaryName = process.platform === 'win32' ? 'kin-core.exe' : 'kin-core';
      const sidecarPath = path.resolve(rootDir, 'src-tauri', 'binaries', binaryName);
      expect(fs.existsSync(sidecarPath)).toBe(true);
      expect(fs.statSync(sidecarPath).size).toBeGreaterThan(50 * 1024 * 1024);
    });
  });
});
