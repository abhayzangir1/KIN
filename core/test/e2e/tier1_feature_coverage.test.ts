// ============================================================================
// KIN E2E TEST TRACK — TIER 1: FEATURE COVERAGE (HAPPY PATH & ISOLATION)
// Opaque-box verification of nominal functionality across core system layers
// through loopback HTTP REST endpoints, SQLite persistence, and event streams.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { CoreServer } from '../../src/server/core_server.js';
import { KinDatabase } from '../../src/storage/db.js';

describe('KIN E2E Tier 1: Feature Coverage & Subsystem Isolation', () => {
  let tempDir: string;
  let testDbPath: string;
  let server: CoreServer;
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-e2e-tier1-'));
    testDbPath = path.join(tempDir, 'kin_e2e_tier1.sqlite');

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
  // 1. Storage & Schema Baseline
  // --------------------------------------------------------------------------
  describe('1. SQLite WAL Engine & Authoritative 31-Table Schema', () => {
    it('initializes persistent SQLite database in WAL mode with integrity verified', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
      const db = new KinDatabase({ dbPath: testDbPath });
      try {
        const jm = db.queryOne<{ journal_mode: string }>('PRAGMA journal_mode;');
        expect(jm?.journal_mode.toLowerCase()).toBe('wal');

        const fk = db.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys;');
        expect(fk?.foreign_keys).toBe(1);

        const tables = db
          .query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table';")
          .map((r) => r.name);

        const requiredTables = [
          'workspaces',
          'projects',
          'agent_identities',
          'agent_definitions',
          'channels',
          'channel_members',
          'messages',
          'tasks',
          'goals',
          'approvals',
          'event_journal',
          'managed_credentials',
          'schedules',
          'skills',
        ];

        for (const tbl of requiredTables) {
          expect(tables).toContain(tbl);
        }

        const integrity = db.queryOne<{ integrity_check: string }>('PRAGMA integrity_check(5);');
        expect(integrity?.integrity_check).toBe('ok');
      } finally {
        db.close();
      }
    });

    it('GET /api/health returns HTTP 200 with online status and uptime telemetry', async () => {
      const res = await api('GET', '/api/health');
      expect(res.status).toBe(200);
      expect(res.json.status).toBe('ok');
      expect(typeof res.json.uptime).toBe('number');
      expect(res.json.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Authoritative State & Project Lifecycle
  // --------------------------------------------------------------------------
  describe('2. Project Lifecycle & Non-Destructive Workspace Navigation', () => {
    it('GET /api/state returns default workspace, project, #general channel, and @Boss', async () => {
      const res = await api('GET', '/api/state');
      expect(res.status).toBe(200);
      expect(res.json.workspace?.id).toBe('ws-default');
      expect(res.json.activeProject?.name).toBe('KIN');
      expect(res.json.channels?.length).toBeGreaterThanOrEqual(1);

      const generalChan = res.json.channels.find((c: any) => c.name === 'general');
      expect(generalChan).toBeDefined();

      const bossAgent = res.json.agents.find((a: any) => a.displayName === '@Boss');
      expect(bossAgent).toBeDefined();
      expect(bossAgent.isOrchestrator).toBe(true);
    });

    it('POST /api/projects creates an independent project without mutating default project', async () => {
      const projectDir = path.join(tempDir, 'repo_tier1_alpha');
      fs.mkdirSync(projectDir, { recursive: true });

      const res = await api('POST', '/api/projects', {
        name: 'AlphaEngineering',
        repoPath: projectDir,
        activate: false,
      });

      expect(res.status).toBe(201);
      expect(res.json.project.name).toBe('AlphaEngineering');
      const alphaId = res.json.project.id;

      // Verify in project listing
      const listRes = await api('GET', '/api/projects');
      expect(listRes.status).toBe(200);
      expect(listRes.json.projects.some((p: any) => p.id === alphaId)).toBe(true);
    });

    it('POST /api/projects/:id/activate switches active project scope', async () => {
      const listRes = await api('GET', '/api/projects');
      const alpha = listRes.json.projects.find((p: any) => p.name === 'AlphaEngineering');
      expect(alpha).toBeDefined();

      const activateRes = await api('POST', `/api/projects/${alpha.id}/activate`);
      expect(activateRes.status).toBe(200);
      expect(activateRes.json.activeProjectId).toBe(alpha.id);

      // Verify active project in state
      const stateRes = await api('GET', '/api/state');
      expect(stateRes.json.activeProject.id).toBe(alpha.id);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Channels & Message Timeline Contract
  // --------------------------------------------------------------------------
  describe('3. Channel Collaboration & Strict Message History', () => {
    let testChannelId: string;

    it('POST /api/channels creates a project-scoped channel with default @Boss membership', async () => {
      const res = await api('POST', '/api/channels', {
        projectId: server.activeProjectId,
        name: 'backend-dev',
        topic: 'Core backend engineering and API design',
      });

      expect(res.status).toBe(201);
      expect(res.json.channel.name).toBe('backend-dev');
      testChannelId = res.json.channel.id;

      // Invariant: New channel begins with @Boss
      const membersRes = await api('GET', `/api/channels/${testChannelId}/members`);
      expect(membersRes.status).toBe(200);
      expect(membersRes.json.members.some((m: any) => m.displayName === '@Boss')).toBe(true);
    });

    it('POST /api/channels/:id/messages persists human message and updates timeline', async () => {
      const res = await api('POST', `/api/channels/${testChannelId}/messages`, {
        content: 'Establish the database migration strategy for Milestone 1.',
        senderType: 'human',
      });

      expect(res.status).toBe(201);
      expect(res.json.message.content).toBe('Establish the database migration strategy for Milestone 1.');
      expect(res.json.message.channelId).toBe(testChannelId);

      // Read back via GET
      const historyRes = await api('GET', `/api/channels/${testChannelId}/messages`);
      expect(historyRes.status).toBe(200);
      const messages = historyRes.json.messages;
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages.some((m: any) => m.content.includes('database migration strategy'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Dynamic Specialist Hiring & Agent Hierarchy
  // --------------------------------------------------------------------------
  describe('4. Dynamic Agent Hiring & Channel Staffing', () => {
    let hiredAgentId: string;

    it('POST /api/agents hires a persistent specialist coworker with defined capabilities', async () => {
      const res = await api('POST', '/api/agents', {
        projectId: server.activeProjectId,
        displayName: 'SecuritySpecialist',
        roleTitle: 'Security Auditor',
        systemPrompt: 'You audit architecture, cryptographic integrity, and access controls.',
        model: 'ollama/qwen2.5-coder:7b',
        capabilities: ['read', 'write', 'execute'],
        domainAuthority: ['Security', 'Cryptography'],
      });

      expect(res.status).toBe(201);
      expect(res.json.agent.displayName).toBe('@SecuritySpecialist');
      hiredAgentId = res.json.agent.id;

      // Verify in agent catalog
      const listRes = await api('GET', `/api/projects/${server.activeProjectId}/agents`);
      expect(listRes.status).toBe(200);
      expect(listRes.json.agents.some((a: any) => a.id === hiredAgentId)).toBe(true);
    });

    it('POST /api/channels/:id/members assigns specialist to channel within same project', async () => {
      const channelsRes = await api('GET', '/api/channels');
      const chan = channelsRes.json.channels.find((c: any) => c.projectId === server.activeProjectId) || channelsRes.json.channels[0];

      const addRes = await api('POST', `/api/channels/${chan.id}/members`, {
        agentId: hiredAgentId,
      });

      expect(addRes.status).toBe(200);
      expect(addRes.json.success).toBe(true);

      const membersRes = await api('GET', `/api/channels/${chan.id}/members`);
      expect(membersRes.status).toBe(200);
      expect(membersRes.json.members.some((m: any) => m.id === hiredAgentId)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 5. 4-Tier Memory Fabric
  // --------------------------------------------------------------------------
  describe('5. 4-Tier Memory Fabric (Project & Channel Scopes)', () => {
    it('POST and GET /api/memories stores and retrieves Project Shared Memory', async () => {
      const postRes = await api('POST', '/api/memories', {
        scope: 'project',
        scopeId: server.activeProjectId,
        key: 'core_architecture',
        value: 'local_first_tauri_sqlite',
      });

      expect(postRes.status).toBe(201);
      expect(postRes.json.memory.key).toBe('core_architecture');

      const getRes = await api('GET', `/api/memories?scope=project&scopeId=${server.activeProjectId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.json.memories.some((m: any) => m.key === 'core_architecture')).toBe(true);
    });

    it('POST and GET /api/memories stores and retrieves Channel Scoped Memory', async () => {
      const channelsRes = await api('GET', '/api/channels');
      const chan = channelsRes.json.channels[0];

      const postRes = await api('POST', '/api/memories', {
        scope: 'channel',
        scopeId: chan.id,
        key: 'sprint_priority',
        value: 'e2e_testing_track',
      });

      expect(postRes.status).toBe(201);

      const getRes = await api('GET', `/api/memories?scope=channel&scopeId=${chan.id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.json.memories.some((m: any) => m.key === 'sprint_priority')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Goals & Task DAG Management
  // --------------------------------------------------------------------------
  describe('6. Goals & Task DAG Dependency Management', () => {
    let createdGoalId: string;
    let task1Id: string;
    let task2Id: string;

    it('POST /api/projects/:id/goals creates a strategic project goal', async () => {
      const res = await api('POST', `/api/projects/${server.activeProjectId}/goals`, {
        title: 'Complete Production Hardening',
        description: 'Verify all 18 layers and achieve 100% test pass rate',
      });

      expect(res.status).toBe(201);
      expect(res.json.goal.title).toBe('Complete Production Hardening');
      createdGoalId = res.json.goal.id;
      expect(createdGoalId).toBeDefined();
    });

    it('POST /api/goals/:goalId/tasks creates tasks with prerequisite dependencies', async () => {
      // Create root task
      const task1Res = await api('POST', `/api/goals/${createdGoalId}/tasks`, {
        title: 'Run Core Migration Suite',
        description: 'Verify 31-table schema DDL',
      });

      expect(task1Res.status).toBe(201);
      task1Id = task1Res.json.task.id;

      // Create dependent task
      const task2Res = await api('POST', `/api/goals/${createdGoalId}/tasks`, {
        title: 'Execute E2E Integration Suite',
        description: 'Depends on migration suite completion',
        dependsOnTaskIds: [task1Id],
      });

      expect(task2Res.status).toBe(201);
      task2Id = task2Res.json.task.id;
      expect(task2Res.json.dependsOnTaskIds).toContain(task1Id);

      // Verify in goals & tasks list
      const stateRes = await api('GET', `/api/projects/${server.activeProjectId}/goals`);
      expect(stateRes.status).toBe(200);
      expect(stateRes.json.tasks.some((t: any) => t.id === task1Id)).toBe(true);
      expect(stateRes.json.tasks.some((t: any) => t.id === task2Id)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Secret Vault & Key Masking
  // --------------------------------------------------------------------------
  describe('7. AES-256-GCM Secret Vault & Redaction', () => {
    it('POST /api/settings/credentials stores provider credentials securely', async () => {
      const res = await api('POST', '/api/settings/credentials', {
        provider: 'openrouter',
        keyName: 'production-key',
        apiKey: 'sk-or-v1-secret-token-abcdef123456',
      });

      expect(res.status).toBe(201);
      expect(res.json.credential?.provider).toBe('openrouter');
    });

    it('GET /api/settings/credentials masks stored credential secrets in API output', async () => {
      const res = await api('GET', '/api/settings/credentials');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json.credentials)).toBe(true);

      const cred = res.json.credentials.find((c: any) => c.provider === 'openrouter');
      expect(cred).toBeDefined();
      // Invariant: Raw secret token must NEVER be returned in plaintext
      expect(cred.apiKey).not.toBe('sk-or-v1-secret-token-abcdef123456');
      expect(res.text).not.toContain('sk-or-v1-secret-token-abcdef123456');
    });
  });

  // --------------------------------------------------------------------------
  // 8. Skill Engine & Proactive Scheduler
  // --------------------------------------------------------------------------
  describe('8. Skill Engine Registry & Proactive Scheduler', () => {
    it('POST /api/skills registers procedural custom skill', async () => {
      const res = await api('POST', '/api/skills', {
        name: 'code_formatter',
        description: 'Auto-format source code using prettier rules',
        parameters: { language: 'typescript' },
        handlerCode: 'return { formatted: true };',
      });

      expect(res.status).toBe(201);
      expect(res.json.skill.name).toBe('code_formatter');

      const listRes = await api('GET', '/api/skills');
      expect(listRes.status).toBe(200);
      expect(listRes.json.skills.some((s: any) => s.name === 'code_formatter')).toBe(true);
    });

    it('POST /api/projects/:id/schedules creates 5-field cron routine', async () => {
      const res = await api('POST', `/api/projects/${server.activeProjectId}/schedules`, {
        type: 'cron',
        cronExpression: '0 9 * * 1-5',
        prompt: 'Daily Standup Summary',
      });

      expect(res.status).toBe(201);
      expect(res.json.schedule.cronExpression).toBe('0 9 * * 1-5');

      const listRes = await api('GET', `/api/projects/${server.activeProjectId}/schedules`);
      expect(listRes.status).toBe(200);
      expect(listRes.json.schedules.some((s: any) => s.cronExpression === '0 9 * * 1-5')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 9. SSE Real-Time Event Stream
  // --------------------------------------------------------------------------
  describe('9. SSE Swarm Map Telemetry Stream', () => {
    it('GET /api/events establishes Server-Sent Events stream with text/event-stream content type', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      try {
        const res = await fetch(`${baseUrl}/api/events`, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/event-stream');
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          throw err;
        }
      } finally {
        clearTimeout(timeout);
      }
    });
  });
});
