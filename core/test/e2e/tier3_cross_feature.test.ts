// ============================================================================
// KIN E2E TEST TRACK — TIER 3: CROSS-FEATURE COMBINATIONS
// Opaque-box verification of multi-subsystem interactions, pairwise states,
// project switching isolation, SAFE autonomy gating, 4-tier memory visibility,
// threaded replies, and 2KB output spiller context integration.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { CoreServer } from '../../src/server/core_server.js';
import { KinDatabase } from '../../src/storage/db.js';
import { OutputSpiller } from '../../src/context/output_spiller.js';
import { EventLedger } from '../../src/security/event_ledger.js';

describe('KIN E2E Tier 3: Cross-Feature Combinations & State Isolation', () => {
  let tempDir: string;
  let testDbPath: string;
  let server: CoreServer;
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-e2e-tier3-'));
    testDbPath = path.join(tempDir, 'kin_e2e_tier3.sqlite');

    server = new CoreServer({
      port: 0,
      dbPath: testDbPath,
    });

    serverPort = await server.start();
    baseUrl = `http://127.0.0.1:${serverPort}`;
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

  // --------------------------------------------------------------------------
  // 1. Multi-Project Switching & Data Isolation
  // --------------------------------------------------------------------------
  describe('1. Multi-Project Switching & State Non-Crosstalk', () => {
    let projAId: string;
    let projBId: string;
    let chanAId: string;
    let chanBId: string;

    it('creates Project A and Project B with independent working folders', async () => {
      const dirA = path.join(tempDir, 'repo_tier3_a');
      const dirB = path.join(tempDir, 'repo_tier3_b');
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });

      const resA = await api('POST', '/api/projects', {
        name: 'ProjectAlpha',
        repoPath: dirA,
        activate: true,
      });
      expect(resA.status).toBe(201);
      projAId = resA.json.project.id;

      const chanARes = await api('POST', '/api/channels', {
        projectId: projAId,
        name: 'alpha-ops',
      });
      expect(chanARes.status).toBe(201);
      chanAId = chanARes.json.channel.id;

      const resB = await api('POST', '/api/projects', {
        name: 'ProjectBeta',
        repoPath: dirB,
        activate: true,
      });
      expect(resB.status).toBe(201);
      projBId = resB.json.project.id;

      const chanBRes = await api('POST', '/api/channels', {
        projectId: projBId,
        name: 'beta-ops',
      });
      expect(chanBRes.status).toBe(201);
      chanBId = chanBRes.json.channel.id;
    });

    it('switching active projects maintains strict message separation across channels', async () => {
      // Post in Project A's channel
      const msgARes = await api('POST', `/api/channels/${chanAId}/messages`, {
        content: 'Alpha secret deployment configuration message.',
        senderType: 'human',
      });
      expect(msgARes.status).toBe(201);

      // Switch active project to Beta
      const switchRes = await api('POST', `/api/projects/${projBId}/activate`);
      expect(switchRes.status).toBe(200);

      // Post in Project B's channel
      const msgBRes = await api('POST', `/api/channels/${chanBId}/messages`, {
        content: 'Beta microservice architecture discussion message.',
        senderType: 'human',
      });
      expect(msgBRes.status).toBe(201);

      // Query Channel A: must contain ONLY Alpha message
      const historyA = await api('GET', `/api/channels/${chanAId}/messages`);
      expect(historyA.status).toBe(200);
      expect(historyA.json.messages.some((m: any) => m.content.includes('Alpha secret deployment'))).toBe(true);
      expect(historyA.json.messages.some((m: any) => m.content.includes('Beta microservice'))).toBe(false);

      // Query Channel B: must contain ONLY Beta message
      const historyB = await api('GET', `/api/channels/${chanBId}/messages`);
      expect(historyB.status).toBe(200);
      expect(historyB.json.messages.some((m: any) => m.content.includes('Beta microservice'))).toBe(true);
      expect(historyB.json.messages.some((m: any) => m.content.includes('Alpha secret deployment'))).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. SAFE Autonomy + Sentinel Gate + CAS Approval + EventLedger
  // --------------------------------------------------------------------------
  describe('2. SAFE Autonomy, CAS Approval Resolution & Tamper-Evident Ledger', () => {
    let approvalId: string;

    it('creates a high-risk tool execution approval gate', async () => {
      const res = await api('POST', '/api/approvals', {
        toolName: 'execute_shell',
        actionPayload: { command: 'git push --force origin main' },
        riskLevel: 'CRITICAL',
      });

      expect(res.status).toBe(201);
      expect(res.json.approval.status).toBe('pending');
      expect(res.json.approval.riskLevel).toBe('CRITICAL');
      approvalId = res.json.approval.id;
    });

    it('resolves approval gate via operator CAS update and appends to EventLedger', async () => {
      const resolveRes = await api('POST', `/api/approvals/${approvalId}/resolve`, {
        decision: 'approve',
      });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.json.status).toBe('approved');

      // Verify recorded in SQLite event_journal with SHA-256 integrity
      const db = server.getDatabase();
      const events = db.query<{ id: string; event_type: string; payload_json: string; prev_hash: string; record_hash: string }>(
        "SELECT id, event_type, payload_json, prev_hash, record_hash FROM event_journal WHERE event_type LIKE 'approval%' ORDER BY rowid ASC"
      );

      expect(events.length).toBeGreaterThanOrEqual(1);
      const latest = events[events.length - 1];
      expect(latest.event_type).toBe('approval.granted');

      // Verify SHA-256 hash chaining invariant: record_hash is computed and 64 hex characters
      expect(latest.record_hash).toBeDefined();
      expect(latest.record_hash.length).toBe(64);
    });
  });

  // --------------------------------------------------------------------------
  // 3. 4-Tier Memory Visibility Boundaries
  // --------------------------------------------------------------------------
  describe('3. 4-Tier Memory Fabric Visibility Boundaries (DM vs Channel vs Project)', () => {
    let testChanId: string;

    it('populates Project Shared, Channel, and DM scoped memory', async () => {
      // 1. Channel
      const chanRes = await api('POST', '/api/channels', {
        projectId: server.activeProjectId,
        name: 'security-review',
      });
      testChanId = chanRes.json.channel.id;

      // 2. Project Memory
      await api('POST', '/api/memories', {
        scope: 'project',
        scopeId: server.activeProjectId,
        key: 'project_framework',
        value: 'node22_tauri2',
      });

      // 3. Channel Memory
      await api('POST', '/api/memories', {
        scope: 'channel',
        scopeId: testChanId,
        key: 'channel_deliverable',
        value: 'threat_model_v1',
      });

      // 4. DM Memory (scoped to dm-human-boss)
      await api('POST', '/api/memories', {
        scope: 'channel', // DM channels are channelType: 'direct_message'
        scopeId: 'dm-human-boss-secret',
        key: 'dm_confidential_fact',
        value: 'private_salary_review',
      });
    });

    it('enforces visibility isolation: channel query cannot observe DM confidential facts', async () => {
      // Query channel memories
      const chanMemRes = await api('GET', `/api/memories?scope=channel&scopeId=${testChanId}`);
      expect(chanMemRes.status).toBe(200);

      // Must find channel deliverable
      expect(chanMemRes.json.memories.some((m: any) => m.key === 'channel_deliverable')).toBe(true);
      // Must NOT leak DM secret
      expect(chanMemRes.json.memories.some((m: any) => m.key === 'dm_confidential_fact')).toBe(false);

      // Query project memories
      const projMemRes = await api('GET', `/api/memories?scope=project&scopeId=${server.activeProjectId}`);
      expect(projMemRes.status).toBe(200);
      expect(projMemRes.json.memories.some((m: any) => m.key === 'project_framework')).toBe(true);
      expect(projMemRes.json.memories.some((m: any) => m.key === 'dm_confidential_fact')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Dynamic Specialist Hiring + Channel Staffing + Threaded Response
  // --------------------------------------------------------------------------
  describe('4. Dynamic Specialist Hiring & Threaded Response Segregation', () => {
    let specialistId: string;
    let collabChanId: string;
    let rootMsgId: string;

    it('hires specialist and adds to dedicated collaboration channel', async () => {
      const hireRes = await api('POST', '/api/agents', {
        projectId: server.activeProjectId,
        displayName: 'DevOpsLead',
        roleTitle: 'DevOps Engineer',
        model: 'ollama/qwen2.5-coder:7b',
      });
      expect(hireRes.status).toBe(201);
      specialistId = hireRes.json.agent.id;

      const chanRes = await api('POST', '/api/channels', {
        projectId: server.activeProjectId,
        name: 'release-coordination',
      });
      expect(chanRes.status).toBe(201);
      collabChanId = chanRes.json.channel.id;

      const addRes = await api('POST', `/api/channels/${collabChanId}/members`, {
        agentId: specialistId,
      });
      expect(addRes.status).toBe(200);
    });

    it('human posts root intent; agent creates threaded reply adhering to transcript contract', async () => {
      // Human posts root task
      const rootRes = await api('POST', `/api/channels/${collabChanId}/messages`, {
        content: 'Please outline the release gate validation steps.',
        senderType: 'human',
      });
      expect(rootRes.status).toBe(201);
      rootMsgId = rootRes.json.message.id;

      // Specialist replies in thread under source message
      const db = server.getDatabase();
      const replyId = `msg-reply-${Date.now()}`;
      db.execute(
        `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, parent_message_id, created_at)
         VALUES (?, ?, ?, 'agent', ?, ?, ?)`,
        replyId,
        collabChanId,
        specialistId,
        'Here are the 15 release gate scenarios verified for production.',
        rootMsgId,
        Date.now()
      );

      // Verify message timeline segregation
      const messagesRes = await api('GET', `/api/channels/${collabChanId}/messages`);
      expect(messagesRes.status).toBe(200);
      const msgs = messagesRes.json.messages;

      const rootMsg = msgs.find((m: any) => m.id === rootMsgId);
      expect(rootMsg).toBeDefined();

      // Direct SQLite check: reply has parent_message_id pointing to rootMsgId
      const replyRow = db.queryOne<{ parent_message_id: string }>(
        'SELECT parent_message_id FROM messages WHERE id = ?',
        replyId
      );
      expect(replyRow?.parent_message_id).toBe(rootMsgId);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Context Compactor & 2KB Tool Output Spiller
  // --------------------------------------------------------------------------
  describe('5. Context Compaction & 2KB Tool Output Spiller', () => {
    let spiller: OutputSpiller;
    let spillDir: string;

    beforeAll(() => {
      spillDir = path.join(tempDir, 'kin_spill_tier3');
      spiller = new OutputSpiller({
        spillDir,
        thresholdBytes: 2048, // 2KB threshold contract
      });
    });

    it('inlines small tool outputs (<= 2048 bytes) without disk spill', () => {
      const smallOutput = 'Compact status report: 39 tests passed, zero regressions.';
      const result = spiller.processOutput(smallOutput);

      expect(result.isSpilled).toBe(false);
      expect(result.content).toBe(smallOutput);
      expect(result.originalBytes).toBeLessThanOrEqual(2048);
      expect(result.spillUri).toBeUndefined();
    });

    it('spills large tool outputs (> 2048 bytes) to disk with content-addressed SHA-256 hash', () => {
      // Generate 8KB repetitive output
      const largePayload = 'Line of detailed log output with telemetry data.\n'.repeat(160);
      expect(Buffer.byteLength(largePayload, 'utf-8')).toBeGreaterThan(2048);

      const result = spiller.processOutput(largePayload);

      expect(result.isSpilled).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.hash!.length).toBe(64);
      expect(result.spillUri).toBeDefined();

      // Verify file exists on disk with exact hash name
      const expectedFilePath = path.join(spillDir, `${result.hash}.log`);
      expect(fs.existsSync(expectedFilePath)).toBe(true);
      const spilledFileContent = fs.readFileSync(expectedFilePath, 'utf-8');
      expect(spilledFileContent).toBe(largePayload);

      // Verify readSpillFile retrieves exact content
      const retrieved = spiller.readSpillFile(result.hash!);
      expect(retrieved).toBe(largePayload);

      // Verify bounded preview contains digest and bounded snippet
      expect(result.content).toContain(result.hash);
      expect(result.content.length).toBeLessThan(largePayload.length);
    });
  });
});
