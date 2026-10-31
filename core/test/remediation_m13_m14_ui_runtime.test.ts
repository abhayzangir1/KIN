import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CoreServer } from '../src/server/core_server.js';
import { ComputerSupervisor } from '../src/computer/computer_supervisor.js';

describe('Milestones 13 & 14: UI & Desktop Runtime Production Verification Suite', () => {
  let tempDir: string;
  let testDbPath: string;
  let testProjectDir: string;
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    process.env.KIN_GITHUB_CLIENT_ID = 'test-github-client-id-12345';
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-ui-runtime-test-'));
    testDbPath = path.join(tempDir, 'test_ui_runtime.sqlite');
    testProjectDir = path.join(tempDir, 'project');
    fs.mkdirSync(testProjectDir, { recursive: true });

    server = new CoreServer({ port: 0, dbPath: testDbPath });
    port = await server.start();
    server.db.execute("UPDATE projects SET repo_path = ? WHERE id = 'proj-kin'", testProjectDir);
  });

  afterAll(async () => {
    delete process.env.KIN_GITHUB_CLIENT_ID;
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // Feature 70: OAuth Flow URL Generation & State Security
  // --------------------------------------------------------------------------
  describe('Feature 70: OAuth Flow URL Generation and Security', () => {
    it('generates genuine OAuth authorization URLs with required state and callback parameters when configured', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/oauth/authorize/github`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.authUrl).toBeDefined();
      expect(typeof data.authUrl).toBe('string');
      expect(data.authUrl).toContain('test-github-client-id-12345');
      expect(data.authUrl).toContain(`state=${encodeURIComponent(data.state)}`);
    });

    it('returns HTTP 400 with helpful error when OAuth provider credentials are not configured', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/oauth/authorize/google`, {
        method: 'POST',
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing KIN_GOOGLE_CLIENT_ID');
    });

    it('rejects unsupported OAuth providers with HTTP 400', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/oauth/authorize/unsupported-service`, {
        method: 'POST',
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain('Unsupported OAuth provider');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 75: MCP Connectors Save & Persistence Contract
  // --------------------------------------------------------------------------
  describe('Feature 75: MCP Connectors Save and Persistence Contract', () => {
    it('saves valid Claude-format connector configuration to global scope without facades', async () => {
      const payload = {
        scope: 'global',
        name: 'test-claude-connector-saved',
        config: {
          command: 'node',
          args: ['-v'],
          env: { TEST_ENV: '1' },
          disabled: true,
        },
      };

      const res = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.connector).toBeDefined();
      expect(data.connector.name).toBe('test-claude-connector-saved');
      expect(data.connector.command).toBe('node');
    });

    it('rejects connector save when scope or name is missing with HTTP 400', async () => {
      const invalidPayload = {
        scope: 'global',
        config: {},
      };

      const res = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Feature 76: Model Assignment Status Feedback
  // --------------------------------------------------------------------------
  describe('Feature 76: Model Assignment Status Feedback', () => {
    it('updates agent active model when agent is idle and persists change in database', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/agents/agent-boss/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModelId: 'ollama/llama3.3:70b' }),
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.activeModelId).toBe('ollama/llama3.3:70b');

      const row = server.db.queryOne<{ active_model_id: string }>(
        "SELECT active_model_id FROM agent_identities WHERE id = 'agent-boss'"
      );
      expect(row?.active_model_id).toBe('ollama/llama3.3:70b');
    });

    it('returns 400 when modelId is empty or missing', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/agents/agent-boss/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModelId: '' }),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Feature 77: Decision Cards ADR Authoritative Structure
  // --------------------------------------------------------------------------
  describe('Feature 77: Authoritative Decision Storage and Retrieval', () => {
    it('stores and retrieves authoritative decisions without mock placeholder text', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/decisions/grill-me-answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'Database Resilience & High-Concurrency Isolation',
          channelId: 'chan-general',
          answers: {
            q1: 'Enforce WAL mode and single-writer CAS queueing',
            q2: 'Use structured diagnostic logs instead of silent swallows',
          },
        }),
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.decision).toBeDefined();
      expect(data.decision.title).toContain('Database Resilience');
      expect(data.decision.status).toBe('authoritative');
      expect(data.decision.rationale).not.toContain('Normalized payload with client selector');
      expect(data.decision.alternativesConsidered.length).toBeGreaterThan(0);

      // Verify in database
      const row = server.db.queryOne<{ id: string; title: string; status: string }>(
        'SELECT id, title, status FROM decisions WHERE id = ?',
        data.decision.id
      );
      expect(row?.title).toBe(data.decision.title);
      expect(row?.status).toBe('authoritative');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 78: Dynamic Channel Listing & Default Resolution
  // --------------------------------------------------------------------------
  describe('Feature 78: Dynamic Channel Listing and Default Resolution', () => {
    it('GET /api/channels lists channels with at least one default general channel', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(Array.isArray(data.channels)).toBe(true);
      expect(data.channels.length).toBeGreaterThan(0);

      const generalChan = data.channels.find((c: any) => c.name.toLowerCase() === 'general');
      expect(generalChan).toBeDefined();
      expect(typeof generalChan.id).toBe('string');
      expect(generalChan.id.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 80: Skills Deletion API Verification
  // --------------------------------------------------------------------------
  describe('Feature 80: Skills Lifecycle and Deletion Error Handlers', () => {
    it('creates custom skill and returns success, then deletes it cleanly', async () => {
      const createRes = await fetch(`http://127.0.0.1:${port}/api/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'verification_test_skill',
          description: 'A skill for testing UI deletion feedback',
          instructions: 'Perform verified actions',
          tags: ['test', 'ui'],
        }),
      });

      expect([200, 201]).toContain(createRes.status);
      const createData: any = await createRes.json();
      expect(createData.skill).toBeDefined();
      const skillId = createData.skill.id;
      expect(skillId).toBeDefined();

      // Delete the skill
      const deleteRes = await fetch(`http://127.0.0.1:${port}/api/skills/${encodeURIComponent(skillId)}`, {
        method: 'DELETE',
      });
      expect(deleteRes.status).toBe(200);
      const deleteData: any = await deleteRes.json();
      expect(deleteData.success).toBe(true);

      // Subsequent delete returns 404 or false
      const repeatDelete = await fetch(`http://127.0.0.1:${port}/api/skills/${encodeURIComponent(skillId)}`, {
        method: 'DELETE',
      });
      expect(repeatDelete.status === 404 || repeatDelete.status === 200).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 82: ComputerSupervisor Shutdown Cleanly Resolves DesktopLock Waiters
  // --------------------------------------------------------------------------
  describe('Feature 82: ComputerSupervisor Lock Waiter Resolution on Shutdown', () => {
    it('resolves all pending acquireDesktopLock waiters when supervisor shuts down', async () => {
      const supervisor = new ComputerSupervisor({
        freeMemProvider: () => 16 * 1024 * 1024 * 1024,
      });

      // Acquire lock first
      const acquired1 = await supervisor.acquireDesktopLock('agent-1', 60000);
      expect(acquired1).toBe(true);

      // Queue waiter for agent-2 with timeout
      let waiterResolvedValue: boolean | undefined;
      const waiterPromise = supervisor.acquireDesktopLock('agent-2', 60000).then((v) => {
        waiterResolvedValue = v;
        return v;
      });

      // Shut down supervisor immediately
      supervisor.shutdown();

      const result = await waiterPromise;
      expect(result).toBe(false);
      expect(waiterResolvedValue).toBe(false);
    });
  });
});
