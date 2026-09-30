import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CoreServer } from '../src/server/core_server.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('KIN Phase 1/2: Core IPC Server Integration & Authoritative State', () => {
  const testDbPath = path.resolve(process.cwd(), 'kin_test_server.sqlite');
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }

    server = new CoreServer({ port: 0, dbPath: testDbPath }); // port 0 selects free ephemeral port
    port = await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('GET /api/state returns authoritative SQLite state and seeded workforce', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.status).toBe(200);

    const data: any = await res.json();
    expect(data.workspace.id).toBe('ws-default');
    expect(data.autonomyMode).toBe('AUTO');
    expect(data.channels.length).toBe(3);
    expect(data.agents.length).toBe(4);

    const orch = data.agents.find((a: any) => a.id === 'agent-orch');
    expect(orch).toBeDefined();
    expect(orch.activeModelId).toBe('anthropic/claude-3-5-sonnet');

    expect(data.messages.length).toBeGreaterThan(0);
    expect(data.pendingApprovals.length).toBe(1);
    expect(data.pendingApprovals[0].riskLevel).toBe('HIGH');
  });

  it('POST /api/channels/:id/messages persists message to SQLite and triggers agent reaction', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/channels/chan-architecture/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '@FrontendLead Please check the component layout.',
      }),
    });

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.message.content).toBe('@FrontendLead Please check the component layout.');
    expect(data.triggeredCount).toBe(1);

    // Verify persisted directly in SQLite
    const db = server.getDatabase();
    const rows = db.query<{ content: string }>(
      "SELECT content FROM messages WHERE channel_id = 'chan-architecture' AND sender_type = 'human'"
    );
    expect(rows.some((r) => r.content.includes('@FrontendLead'))).toBe(true);
  });

  it('PATCH /api/agents/:id/model persists model change directly to SQLite', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/agent-backend/model`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeModelId: 'deepseek/deepseek-reasoner',
      }),
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.activeModelId).toBe('deepseek/deepseek-reasoner');

    // Verify in SQLite agent_identities table
    const db = server.getDatabase();
    const row = db.queryOne<{ active_model_id: string }>(
      "SELECT active_model_id FROM agent_identities WHERE id = 'agent-backend'"
    );
    expect(row?.active_model_id).toBe('deepseek/deepseek-reasoner');
  });

  it('PATCH /api/workspace/autonomy updates SQLite workspaces table', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspace/autonomy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autonomyMode: 'ALWAYS_ASK',
      }),
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.autonomyMode).toBe('ALWAYS_ASK');

    // Verify in SQLite
    const db = server.getDatabase();
    const row = db.queryOne<{ default_autonomy_mode: string }>(
      "SELECT default_autonomy_mode FROM workspaces WHERE id = 'ws-default'"
    );
    expect(row?.default_autonomy_mode).toBe('ALWAYS_ASK');
  });

  it('POST /api/approvals/:id/resolve marks approval decided in SQLite', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/approvals/appr-001/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approved: true,
      }),
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.status).toBe('approved');

    // Verify in SQLite
    const db = server.getDatabase();
    const row = db.queryOne<{ status: string; decided_at: number }>(
      "SELECT status, decided_at FROM approvals WHERE id = 'appr-001'"
    );
    expect(row?.status).toBe('approved');
    expect(row?.decided_at).toBeGreaterThan(0);
  });
});
