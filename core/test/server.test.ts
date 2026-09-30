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

  it('GET /api/state returns authoritative SQLite state and single default agent @Boss', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.status).toBe(200);

    const data: any = await res.json();
    expect(data.workspace.id).toBe('ws-default');
    expect(data.activeProject.name).toBe('KIN');
    expect(data.autonomyMode).toBe('AUTO');
    expect(data.channels.length).toBe(1);
    expect(data.channels[0].name).toBe('general');

    // ONLY ONE default agent: @Boss
    expect(data.agents.length).toBe(1);
    const boss = data.agents[0];
    expect(boss.displayName).toBe('@Boss');
    expect(boss.role).toBe('Lead Sovereign Orchestrator');
    expect(boss.isOrchestrator).toBe(true);

    expect(data.messages.length).toBeGreaterThan(0);
    expect(data.messages[0].senderName).toBe('@Boss');
  });

  it('GET /api/system/models detects local Ollama status and installed models', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/system/models`);
    expect(res.status).toBe(200);

    const data: any = await res.json();
    expect(typeof data.online).toBe('boolean');
    expect(Array.isArray(data.models)).toBe(true);
  });

  it('POST /api/projects creates a new independent workspace project', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test01',
        repoPath: 'D:\\test01',
      }),
    });

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.project.name).toBe('test01');
    expect(data.project.repoPath).toBe('D:\\test01');

    // Verify in projects list
    const listRes = await fetch(`http://127.0.0.1:${port}/api/projects`);
    const listData: any = await listRes.json();
    expect(listData.projects.length).toBe(2);
    expect(listData.projects.some((p: any) => p.name === 'test01')).toBe(true);
  });

  it('POST /api/system/terminal executes shell command in project directory', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/system/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'echo KIN_TERMINAL_ONLINE',
      }),
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.stdout).toContain('KIN_TERMINAL_ONLINE');
    expect(data.exitCode).toBe(0);
  });

  it('POST /api/channels/:id/messages persists message and activates @Boss', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state`);
    const state: any = await stateRes.json();
    const channelId = state.channels[0].id;

    const res = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'create a txt file and write something in it.',
      }),
    });

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.message.content).toBe('create a txt file and write something in it.');
    expect(data.triggeredCount).toBe(1);

    // Verify persisted directly in SQLite
    const db = server.getDatabase();
    const rows = db.query<{ content: string }>(
      `SELECT content FROM messages WHERE channel_id = ? AND sender_type = 'human'`,
      channelId
    );
    expect(rows.some((r) => r.content.includes('create a txt file'))).toBe(true);
  });

  it('PATCH /api/agents/:id/contract updates role title and active model in SQLite', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/agent-boss/contract`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleTitle: 'boss',
        activeModelId: 'ollama/qwen2.5-coder:3b',
        systemPrompt: 'You are the boss of this workspace.',
      }),
    });

    expect(res.status).toBe(200);

    // Verify in SQLite
    const db = server.getDatabase();
    const identity = db.queryOne<{ active_model_id: string }>(
      "SELECT active_model_id FROM agent_identities WHERE id = 'agent-boss'"
    );
    expect(identity?.active_model_id).toBe('ollama/qwen2.5-coder:3b');

    const def = db.queryOne<{ role: string; system_prompt: string }>(
      "SELECT role, system_prompt FROM agent_definitions WHERE id = 'def-boss'"
    );
    expect(def?.role).toBe('boss');
    expect(def?.system_prompt).toBe('You are the boss of this workspace.');
  });
});
