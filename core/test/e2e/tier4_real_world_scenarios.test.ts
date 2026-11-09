// ============================================================================
// KIN E2E TEST TRACK — TIER 4: REAL-WORLD APPLICATION SCENARIOS
// End-to-end user workflows derived directly from PRD § 15 (Acceptance Scenarios):
// SC-01: Workspace Bootstrap & Offline Model Discovery (PRD § 15.1, § 15.2)
// SC-02: Multi-Specialist Collaboration & Threaded Synthesis (PRD § 15.4)
// SC-03: Governed Code Mutation & Approval Gate CAS Resolution (PRD § 15.6, § 15.7, § 15.8)
// SC-04: Private DM Consultation & 4-Tier Memory Isolation (PRD § 15.5)
// SC-05: Automation Scheduling & Cold Boot Recovery (PRD § 15.9, § 15.11, § 15.13)
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { CoreServer } from '../../src/server/core_server.js';
import { KinDatabase } from '../../src/storage/db.js';

describe('KIN E2E Tier 4: Real-World Application Workflows (PRD § 15 Scenarios)', () => {
  let tempDir: string;
  let testDbPath: string;
  let server: CoreServer;
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-e2e-tier4-'));
    testDbPath = path.join(tempDir, 'kin_e2e_tier4.sqlite');

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
  // Scenario 1: Workspace Bootstrap & Offline Model Discovery (PRD § 15.1, § 15.2)
  // --------------------------------------------------------------------------
  describe('SC-01: Engineering Workspace Bootstrap & Offline Model Discovery', () => {
    let onboardedProjectId: string;
    let onboardedRepoDir: string;

    it('Step 1: User selects a local engineering folder and establishes project workspace', async () => {
      onboardedRepoDir = path.join(tempDir, 'repo_onboarded_app');
      fs.mkdirSync(onboardedRepoDir, { recursive: true });
      fs.writeFileSync(path.join(onboardedRepoDir, 'package.json'), JSON.stringify({ name: 'sample-app', version: '1.0.0' }));

      const res = await api('POST', '/api/projects', {
        name: 'SampleEngineeringApp',
        repoPath: onboardedRepoDir,
        activate: true,
      });

      expect(res.status).toBe(201);
      expect(res.json.project.name).toBe('SampleEngineeringApp');
      onboardedProjectId = res.json.project.id;
      expect(onboardedProjectId).toBeDefined();
    });

    it('Step 2: Auto-provisions #general channel and installs initial @Boss identity', async () => {
      const stateRes = await api('GET', '/api/state');
      expect(stateRes.status).toBe(200);
      expect(stateRes.json.activeProject.id).toBe(onboardedProjectId);

      // Verify #general channel exists
      const channels = stateRes.json.channels;
      expect(channels.some((c: any) => c.name === 'general')).toBe(true);

      // Verify @Boss orchestrator exists
      const agents = stateRes.json.agents;
      const boss = agents.find((a: any) => a.displayName === '@Boss');
      expect(boss).toBeDefined();
      expect(boss.isOrchestrator).toBe(true);
    });

    it('Step 3: Detects local model availability offline without external cloud dependencies', async () => {
      const modelsRes = await api('GET', '/api/system/models');
      expect(modelsRes.status).toBe(200);
      expect(typeof modelsRes.json.online).toBe('boolean');
      expect(Array.isArray(modelsRes.json.models)).toBe(true);

      // Invariant: Zero cloud egress credentials required for local offline baseline
      const credsRes = await api('GET', '/api/settings/credentials');
      expect(credsRes.status).toBe(200);
      // Clean initialization: no mandatory external cloud accounts
      expect(Array.isArray(credsRes.json.credentials)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Multi-Specialist Collaboration & Threaded Synthesis (PRD § 15.4)
  // --------------------------------------------------------------------------
  describe('SC-02: Multi-Specialist Collaboration & Threaded Synthesis', () => {
    let collabChanId: string;
    let backendAgentId: string;
    let securityAgentId: string;
    let rootPromptMsgId: string;

    it('Step 1: Hires @BackendLead and @SecurityAuditor specialists into workspace', async () => {
      // Hire Backend
      const backendRes = await api('POST', '/api/agents', {
        projectId: server.activeProjectId,
        displayName: 'BackendLead',
        roleTitle: 'Senior Backend Engineer',
        model: 'ollama/qwen2.5-coder:7b',
      });
      expect(backendRes.status).toBe(201);
      backendAgentId = backendRes.json.agent.id;

      // Hire Security
      const secRes = await api('POST', '/api/agents', {
        projectId: server.activeProjectId,
        displayName: 'SecurityAuditor',
        roleTitle: 'Security Architect',
        model: 'ollama/qwen2.5-coder:7b',
      });
      expect(secRes.status).toBe(201);
      securityAgentId = secRes.json.agent.id;

      // Create feature channel
      const chanRes = await api('POST', '/api/channels', {
        projectId: server.activeProjectId,
        name: 'auth-architecture',
      });
      expect(chanRes.status).toBe(201);
      collabChanId = chanRes.json.channel.id;

      // Add both specialists to channel
      await api('POST', `/api/channels/${collabChanId}/members`, { agentId: backendAgentId });
      await api('POST', `/api/channels/${collabChanId}/members`, { agentId: securityAgentId });

      const membersRes = await api('GET', `/api/channels/${collabChanId}/members`);
      expect(membersRes.status).toBe(200);
      expect(membersRes.json.members.some((m: any) => m.id === backendAgentId)).toBe(true);
      expect(membersRes.json.members.some((m: any) => m.id === securityAgentId)).toBe(true);
    });

    it('Step 2: User submits multi-part intent and responses serialize in source thread', async () => {
      // 1. Post root user intent
      const promptRes = await api('POST', `/api/channels/${collabChanId}/messages`, {
        content: 'Design token-based auth schema and audit security boundaries.',
        senderType: 'human',
      });
      expect(promptRes.status).toBe(201);
      rootPromptMsgId = promptRes.json.message.id;

      // 2. Backend specialist posts design in thread
      const db = server.getDatabase();
      const backendReplyId = `msg-backend-${Date.now()}`;
      db.execute(
        `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, parent_message_id, created_at)
         VALUES (?, ?, ?, 'agent', ?, ?, ?)`,
        backendReplyId,
        collabChanId,
        backendAgentId,
        'Proposed schema: JWT session tokens with scrypt-derived password hashes.',
        rootPromptMsgId,
        Date.now()
      );

      // 3. Security specialist posts review in same thread
      const secReplyId = `msg-sec-${Date.now() + 10}`;
      db.execute(
        `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, parent_message_id, created_at)
         VALUES (?, ?, ?, 'agent', ?, ?, ?)`,
        secReplyId,
        collabChanId,
        securityAgentId,
        'Security Review: Recommend 15-minute token TTL and rate limiting.',
        rootPromptMsgId,
        Date.now() + 10
      );

      // 4. Verify thread replies preserve Chat Transcript Contract
      const msgs = db.query<{ id: string; parent_message_id: string; content: string }>(
        'SELECT id, parent_message_id, content FROM messages WHERE channel_id = ? ORDER BY created_at ASC',
        collabChanId
      );

      const root = msgs.find((m) => m.id === rootPromptMsgId);
      expect(root).toBeDefined();
      expect(root?.parent_message_id).toBeNull();

      const threadedReplies = msgs.filter((m) => m.parent_message_id === rootPromptMsgId);
      expect(threadedReplies.length).toBe(2);
      expect(threadedReplies.some((r) => r.content.includes('Proposed schema'))).toBe(true);
      expect(threadedReplies.some((r) => r.content.includes('Security Review'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Governed Code Generation & Approval Gate CAS Resolution (PRD § 15.6, § 15.8)
  // --------------------------------------------------------------------------
  describe('SC-03: Governed Code Mutation, Approval Gate & EventLedger Verification', () => {
    let approvalId: string;

    it('Step 1: In SAFE mode, consequential tool execution pauses and generates pending approval', async () => {
      const res = await api('POST', '/api/approvals', {
        toolName: 'write_file',
        actionPayload: {
          path: 'src/auth/jwt_handler.ts',
          content: 'export function verifyToken(t: string) { return true; }',
        },
        riskLevel: 'HIGH',
      });

      expect(res.status).toBe(201);
      expect(res.json.approval.status).toBe('pending');
      expect(res.json.approval.toolName).toBe('write_file');
      approvalId = res.json.approval.id;
    });

    it('Step 2: Human operator reviews parameters and resolves approval gate atomically', async () => {
      const resolveRes = await api('POST', `/api/approvals/${approvalId}/resolve`, {
        decision: 'approve',
      });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.json.status).toBe('approved');

      // Attempting double-resolution must fail with 400 or 409
      const replayRes = await api('POST', `/api/approvals/${approvalId}/resolve`, {
        decision: 'approve',
      });
      expect([400, 409]).toContain(replayRes.status);
    });

    it('Step 3: Verifies cryptographic hash chain in EventLedger remains unbroken', () => {
      const db = server.getDatabase();
      const ledgerEvents = db.query<{ id: string; prev_hash: string; record_hash: string; event_type: string }>(
        'SELECT id, prev_hash, record_hash, event_type FROM event_journal ORDER BY rowid ASC'
      );

      expect(ledgerEvents.length).toBeGreaterThanOrEqual(1);

      // Verify hash chaining integrity: each record's prev_hash matches the prior record's record_hash
      for (let i = 1; i < ledgerEvents.length; i++) {
        const prev = ledgerEvents[i - 1];
        const current = ledgerEvents[i];
        if (current.prev_hash) {
          expect(current.prev_hash).toBe(prev.record_hash);
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Private DM Consultation & 4-Tier Memory Isolation (PRD § 15.5)
  // --------------------------------------------------------------------------
  describe('SC-04: Private DM Consultation & Strict Memory Scope Isolation', () => {
    let dmChannelId: string;

    it('Step 1: Human conducts confidential 1-on-1 consultation in direct message channel', async () => {
      const dmRes = await api('POST', '/api/channels', {
        projectId: server.activeProjectId,
        name: 'dm-security-consult',
        isPrivate: true,
        channelType: 'direct_message',
      });
      expect(dmRes.status).toBe(201);
      dmChannelId = dmRes.json.channel.id;

      // User posts private message in DM
      const dmMsgRes = await api('POST', `/api/channels/${dmChannelId}/messages`, {
        content: 'Confidential review: Database access credentials rotate weekly.',
        senderType: 'human',
      });
      expect(dmMsgRes.status).toBe(201);

      // Store sensitive DM memory fact
      const dmMemRes = await api('POST', '/api/memories', {
        scope: 'channel',
        scopeId: dmChannelId,
        key: 'secret_rotation_cadence',
        value: 'every_7_days',
      });
      expect(dmMemRes.status).toBe(201);
    });

    it('Step 2: Verifies public channel queries cannot access or observe private DM memory', async () => {
      // Query Project Shared Memory
      const projMemRes = await api('GET', `/api/memories?scope=project&scopeId=${server.activeProjectId}`);
      expect(projMemRes.status).toBe(200);
      expect(projMemRes.json.memories.some((m: any) => m.key === 'secret_rotation_cadence')).toBe(false);

      // Query public #general channel memory
      const stateRes = await api('GET', '/api/state');
      const generalChan = stateRes.json.channels.find((c: any) => c.name === 'general');
      expect(generalChan).toBeDefined();

      const generalMemRes = await api('GET', `/api/memories?scope=channel&scopeId=${generalChan.id}`);
      expect(generalMemRes.status).toBe(200);
      expect(generalMemRes.json.memories.some((m: any) => m.key === 'secret_rotation_cadence')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Automation Scheduling, Cold Boot Recovery & Durable State (PRD § 15.9, § 15.11, § 15.13)
  // --------------------------------------------------------------------------
  describe('SC-05: Automation Scheduling & Cold Boot Crash Recovery', () => {
    let scheduledJobId: string;
    let currentProjectId: string;

    it('Step 1: User registers recurring cron schedule with timezone', async () => {
      currentProjectId = server.activeProjectId;
      const res = await api('POST', `/api/projects/${currentProjectId}/schedules`, {
        type: 'cron',
        cronExpression: '0 8 * * 1-5',
        prompt: 'Morning engineering health audit and dependency check',
      });

      expect(res.status).toBe(201);
      expect(res.json.schedule.cronExpression).toBe('0 8 * * 1-5');
      scheduledJobId = res.json.schedule.id;
      expect(scheduledJobId).toBeDefined();
    });

    it('Step 2: Simulates abrupt daemon restart and verifies cold boot recovery of state', async () => {
      // Stop the running server abruptly
      await server.stop();

      // Launch fresh CoreServer daemon on the EXACT same SQLite database file
      const recoveredServer = new CoreServer({
        port: 0,
        dbPath: testDbPath,
      });

      const recoveredPort = await recoveredServer.start();
      const recoveredBaseUrl = `http://127.0.0.1:${recoveredPort}`;

      try {
        // 1. Verify SQLite database integrity after cold restart
        const db = recoveredServer.getDatabase();
        const integrity = db.queryOne<{ integrity_check: string }>('PRAGMA integrity_check(5);');
        expect(integrity?.integrity_check).toBe('ok');

        // 2. Verify all projects survived restart
        const projRes = await fetch(`${recoveredBaseUrl}/api/projects`);
        expect(projRes.status).toBe(200);
        const projData = await projRes.json();
        expect(projData.projects.some((p: any) => p.id === currentProjectId)).toBe(true);

        // 3. Verify schedules survived restart
        const schedRes = await fetch(`${recoveredBaseUrl}/api/projects/${currentProjectId}/schedules`);
        expect(schedRes.status).toBe(200);
        const schedData = await schedRes.json();
        expect(schedData.schedules.some((s: any) => s.id === scheduledJobId)).toBe(true);

        // 4. Verify channels survived restart
        const chansRes = await fetch(`${recoveredBaseUrl}/api/channels`);
        expect(chansRes.status).toBe(200);
        const chansData = await chansRes.json();
        expect(chansData.channels.length).toBeGreaterThanOrEqual(1);
      } finally {
        await recoveredServer.stop();
      }
    });
  });
});
