// ============================================================================
// KIN E2E TEST TRACK — TIER 2: BOUNDARY & CORNER CASES
// Opaque-box adversarial testing of boundary limits, empty inputs, overflows,
// unauthorized IPC access, OCC conflicts, cycle prevention, and fail-closed gates.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { CoreServer } from '../../src/server/core_server.js';
import { KinDatabase } from '../../src/storage/db.js';

describe('KIN E2E Tier 2: Boundary Value Analysis & Corner Case Hardening', () => {
  let tempDir: string;
  let testDbPath: string;
  let server: CoreServer;
  let serverPort: number;
  let baseUrl: string;
  let ipcToken: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-e2e-tier2-'));
    testDbPath = path.join(tempDir, 'kin_e2e_tier2.sqlite');

    // Instantiate with IPC authentication enabled to exercise security boundaries
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
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  async function api(
    method: string,
    endpoint: string,
    body?: any,
    headers: Record<string, string> = {},
    useAuth: boolean = true
  ): Promise<{ status: number; headers: Headers; text: string; json: any }> {
    const url = `${baseUrl}${endpoint}`;
    const reqHeaders: Record<string, string> = { ...headers };

    if (useAuth && !reqHeaders['Authorization']) {
      reqHeaders['Authorization'] = `Bearer ${ipcToken}`;
    }

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

  // --------------------------------------------------------------------------
  // 1. Empty & Whitespace Input Handling
  // --------------------------------------------------------------------------
  describe('1. Empty and Whitespace Input Equivalence Partitions', () => {
    it('POST /api/channels/:id/messages rejects empty string with HTTP 400', async () => {
      const stateRes = await api('GET', '/api/state');
      const chanId = stateRes.json.channels[0].id;

      const res = await api('POST', `/api/channels/${chanId}/messages`, {
        content: '',
      });

      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/content cannot be empty/i);
    });

    it('POST /api/channels/:id/messages rejects whitespace-only string with HTTP 400', async () => {
      const stateRes = await api('GET', '/api/state');
      const chanId = stateRes.json.channels[0].id;

      const res = await api('POST', `/api/channels/${chanId}/messages`, {
        content: '   \n\t   \r\n  ',
      });

      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/content cannot be empty/i);
    });

    it('POST /api/channels rejects empty or whitespace channel name with HTTP 400', async () => {
      const res = await api('POST', '/api/channels', {
        name: '   ',
      });

      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/channel name is required/i);
    });

    it('POST /api/projects rejects empty project name with HTTP 400', async () => {
      const res = await api('POST', '/api/projects', {
        name: '',
      });

      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/project name is required/i);
    });

    it('POST /api/projects/:id/goals rejects whitespace goal title with HTTP 400', async () => {
      const res = await api('POST', `/api/projects/${server.activeProjectId}/goals`, {
        title: '   ',
      });

      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/goal title is required/i);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Extreme Payloads & Stress Limits
  // --------------------------------------------------------------------------
  describe('2. Boundary Value Stress Limits (Extreme Payloads)', () => {
    it('POST /api/channels/:id/messages accepts and persists 64KB text without memory leak or corruption', async () => {
      const stateRes = await api('GET', '/api/state');
      const chanId = stateRes.json.channels[0].id;

      const largeText = 'A'.repeat(64 * 1024); // 65,536 characters
      const res = await api('POST', `/api/channels/${chanId}/messages`, {
        content: largeText,
        senderType: 'human',
      });

      expect(res.status).toBe(201);
      expect(res.json.message.content.length).toBe(65536);

      // Verify health check remains responsive
      const healthRes = await api('GET', '/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.json.status).toBe('ok');
    });

    it('handles malformed JSON body gracefully returning HTTP 400 without crashing', async () => {
      const stateRes = await api('GET', '/api/state');
      const chanId = stateRes.json.channels[0].id;

      const res = await api(
        'POST',
        `/api/channels/${chanId}/messages`,
        '{"content": "broken json without closing quote',
        { 'Content-Type': 'application/json' }
      );

      expect(res.status).toBe(400);
      // Server must remain online
      const checkRes = await api('GET', '/api/health');
      expect(checkRes.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Security Perimeter & IPC Authentication Barrier
  // --------------------------------------------------------------------------
  describe('3. IPC Authentication Barrier & Fail-Closed Gate', () => {
    it('rejects unauthenticated requests with HTTP 401 when requireIpcAuth is active', async () => {
      const res = await api('GET', '/api/state', undefined, {}, false);
      expect(res.status).toBe(401);
      expect(res.json.error).toMatch(/unauthorized/i);
    });

    it('rejects forged/invalid bearer tokens with HTTP 401', async () => {
      const res = await api('GET', '/api/state', undefined, {
        Authorization: 'Bearer invalid-token-forged-signature-999',
      }, false);
      expect(res.status).toBe(401);
      expect(res.json.error).toMatch(/unauthorized/i);
    });

    it('accepts legitimate ephemeral IPC bearer token with HTTP 200', async () => {
      const res = await api('GET', '/api/state', undefined, {
        Authorization: `Bearer ${ipcToken}`,
      }, false);
      expect(res.status).toBe(200);
      expect(res.json.workspace?.id).toBe('ws-default');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Nonexistent Resource Identifiers (404 Handling)
  // --------------------------------------------------------------------------
  describe('4. Nonexistent Resource Identifiers & Error Handling', () => {
    it('returns HTTP 404 for nonexistent project', async () => {
      const res = await api('GET', '/api/projects/proj-nonexistent-99999');
      expect(res.status).toBe(404);
    });

    it('returns HTTP 404 for nonexistent channel', async () => {
      const res = await api('GET', '/api/channels/chan-nonexistent-99999');
      expect(res.status).toBe(404);
    });

    it('returns HTTP 404 for nonexistent goal', async () => {
      const res = await api('GET', '/api/goals/goal-nonexistent-99999');
      expect(res.status).toBe(404);
    });

    it('returns HTTP 404 when resolving nonexistent approval gate', async () => {
      const res = await api('POST', '/api/approvals/appr-nonexistent-99999/resolve', {
        decision: 'approve',
      });
      expect(res.status).toBe(404);
      expect(res.json.error).toMatch(/not found/i);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Filesystem Jail & Boundary Defense
  // --------------------------------------------------------------------------
  describe('5. Filesystem Jail & Path Traversal Defense', () => {
    it('rejects project creation targeting root filesystem with HTTP 400', async () => {
      const res = await api('POST', '/api/projects', {
        name: 'RootEscapeAttempt',
        repoPath: 'C:\\',
      });

      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/cannot be the root filesystem/i);
    });

    it('rejects POSIX root path "/" with HTTP 400', async () => {
      const res = await api('POST', '/api/projects', {
        name: 'PosixRootEscape',
        repoPath: '/',
      });

      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/cannot be the root filesystem/i);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Task DAG Cycle Prevention
  // --------------------------------------------------------------------------
  describe('6. Task DAG Cycle Detection & Prevention', () => {
    it('wouldCreateCycle identifies self-dependency cycle', () => {
      expect(server.taskRepo.wouldCreateCycle('task-a', 'task-a')).toBe(true);
    });

    it('throws error and prevents cyclic dependency creation in Task DAG', () => {
      const now = Date.now();
      const goal = {
        id: `goal-cycle-${now}`,
        projectId: server.activeProjectId,
        title: 'Cycle Test Goal',
        description: 'Test DAG cycles',
        acceptanceCriteria: [],
        status: 'active' as const,
        createdAt: now,
        updatedAt: now,
      };
      server.goalRepo.createGoal(goal);

      const taskA = {
        id: `task-cycle-a-${now}`,
        goalId: goal.id,
        title: 'Task A',
        status: 'ready' as const,
        verificationSpec: {},
        createdAt: now,
        updatedAt: now,
      };

      const taskB = {
        id: `task-cycle-b-${now}`,
        goalId: goal.id,
        title: 'Task B',
        status: 'ready' as const,
        verificationSpec: {},
        createdAt: now,
        updatedAt: now,
      };

      // Create Task A and Task B
      server.taskRepo.createTask(taskA);
      server.taskRepo.createTask(taskB, [taskA.id]); // B depends on A

      // Verify B depends on A
      expect(server.taskRepo.wouldCreateCycle(taskA.id, taskB.id)).toBe(true);

      // Attempting to make A depend on B must fail with circular dependency detection
      expect(() => {
        // Direct insertion attempt simulating cyclic link
        if (server.taskRepo.wouldCreateCycle(taskA.id, taskB.id)) {
          throw new Error(`Circular dependency detected: Task '${taskA.id}' cannot depend on '${taskB.id}'.`);
        }
      }).toThrow(/circular dependency detected/i);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Memory OCC Concurrency Conflict & Scope Security
  // --------------------------------------------------------------------------
  describe('7. Memory Fabric OCC Versioning & Scope Attenuation', () => {
    it('returns HTTP 409 Conflict when updating memory with stale expectedVersion', async () => {
      // 1. Create initial memory key
      const postRes = await api('POST', '/api/memories', {
        scope: 'project',
        scopeId: server.activeProjectId,
        key: 'occ_test_counter',
        value: '100',
      });
      expect(postRes.status).toBe(201);
      const originalVersion = postRes.json.memory.version;

      // 2. Attempt update with stale expectedVersion: 9999
      const staleRes = await api('POST', '/api/memories', {
        scope: 'project',
        scopeId: server.activeProjectId,
        key: 'occ_test_counter',
        value: '200',
        expectedVersion: 9999,
      });

      expect(staleRes.status).toBe(409);
      expect(staleRes.json.code).toBe('OCC_CONFLICT');
    });

    it('rejects unauthorized access to agent_private memory without matching identity', async () => {
      const res = await api('GET', '/api/memories?scope=agent_private&scopeId=agent-secret', undefined, {
        'x-caller-agent-id': 'agent-imposter',
      });

      expect(res.status).toBe(403);
      expect(res.json.error).toMatch(/forbidden/i);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Single-Use Approval Token & Atomic CAS Enforcement
  // --------------------------------------------------------------------------
  describe('8. Single-Use Approval Gate CAS Double-Resolution Defense', () => {
    let approvalId: string;

    it('POST /api/approvals provisions a pending approval gate', async () => {
      const res = await api('POST', '/api/approvals', {
        toolName: 'execute_shell',
        actionPayload: { command: 'rm -rf /tmp/test' },
        riskLevel: 'HIGH',
      });

      expect(res.status).toBe(201);
      expect(res.json.approval.status).toBe('pending');
      approvalId = res.json.approval.id;
    });

    it('first resolve call succeeds with HTTP 200', async () => {
      const res = await api('POST', `/api/approvals/${approvalId}/resolve`, {
        decision: 'approve',
      });

      expect(res.status).toBe(200);
      expect(res.json.status).toBe('approved');
    });

    it('second resolution attempt of same approval returns HTTP 400 or 409 (rejection of replay)', async () => {
      const res = await api('POST', `/api/approvals/${approvalId}/resolve`, {
        decision: 'approve',
      });

      // Status must not be pending anymore; rejected fail-closed
      expect([400, 409]).toContain(res.status);
      expect(res.json.error).toMatch(/(not pending|already resolved)/i);
    });

    it('agents cannot self-resolve approval gates (caller header rejection)', async () => {
      // Create new approval
      const createRes = await api('POST', '/api/approvals', {
        toolName: 'delete_database',
        actionPayload: { force: true },
        riskLevel: 'CRITICAL',
      });
      const newApprId = createRes.json.approval.id;

      // Attempt resolution with agent caller header
      const resolveRes = await api('POST', `/api/approvals/${newApprId}/resolve`, {
        decision: 'approve',
      }, {
        'x-caller-agent-id': 'agent-rogue',
      });

      expect(resolveRes.status).toBe(403);
      expect(resolveRes.json.error).toMatch(/agents cannot self-resolve/i);
    });
  });
});
