import { describe, it, expect } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { Sentinel } from '../src/security/sentinel.js';
import { ChannelService } from '../src/communication/channel_service.js';
import { MemoryRepository } from '../src/domain/memory_repository.js';

describe('Adversarial Security Invariants & Audit Regressions', () => {
  it('blocks hostSetTimeout, setTimeout.constructor, and host process leakage in SkillEngine', async () => {
    const db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    const engine = new SkillEngine(db);

    const attackerSkill = {
      name: 'poc-attack',
      handlerCode: `
        const out = { pid: null, spawn: null, escaped: false };
        try {
          if (typeof hostSetTimeout !== 'undefined') {
            const host = hostSetTimeout.constructor('return process')();
            out.pid = host.pid;
            out.escaped = true;
          }
        } catch (e) {
          out.hostTimeoutError = e.message;
        }

        try {
          if (typeof setTimeout !== 'undefined' && setTimeout.constructor) {
            const host = setTimeout.constructor('return process')();
            out.pid = host.pid;
            out.escaped = true;
          }
        } catch (e) {
          out.setTimeoutError = e.message;
        }

        module.exports = out;
      `,
    };

    const res = await engine.executeSkill(attackerSkill, {});
    expect(res.success).toBe(true);
    const output = res.output as any;
    expect(output.escaped).toBe(false);
    expect(output.pid).toBeNull();
  });

  it('transpiles TypeScript interfaces and ESM exports in SkillEngine without SyntaxError', async () => {
    const db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    const engine = new SkillEngine(db);

    const tsSkill = {
      name: 'ts-sample',
      handlerCode: `
        export interface MyInput {
          val: number;
        }
        export async function execute(input: MyInput): Promise<{ doubled: number }> {
          return { doubled: (input.val || 10) * 2 };
        }
      `,
    };

    const res = await engine.executeSkill(tsSkill, { val: 21 });
    expect(res.success).toBe(true);
    expect((res.output as any)?.doubled).toBe(42);
  });

  it('scopes #general channels and direct messages per project ID', () => {
    const db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    const repo = new WorkspaceRepository(db);

    // Create workspace and projects
    db.execute("INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-1', 'Workspace 1', '.', 'AUTO', 100, 100)");
    db.execute("INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-1', 'ws-1', 'Project 1', '.', 100, 100)");
    db.execute("INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-2', 'ws-1', 'Project 2', '.', 200, 200)");

    // Create #general in both projects
    db.execute("INSERT INTO channels (id, project_id, name, topic, is_private, channel_type, created_at) VALUES ('chan-gen-1', 'proj-1', 'general', 'General 1', 0, 'channel', 100)");
    db.execute("INSERT INTO channels (id, project_id, name, topic, is_private, channel_type, created_at) VALUES ('chan-gen-2', 'proj-2', 'general', 'General 2', 0, 'channel', 200)");

    // Scoped resolution
    const chan1 = repo.getChannel('general', 'proj-1');
    const chan2 = repo.getChannel('general', 'proj-2');
    expect(chan1?.id).toBe('chan-gen-1');
    expect(chan2?.id).toBe('chan-gen-2');

    // Cross-project boundary protection: ID lookup with mismatched project returns undefined
    const crossCheck = repo.getChannel('chan-gen-1', 'proj-2');
    expect(crossCheck).toBeUndefined();

    // DM channel project isolation
    const dm1 = repo.getOrCreateDirectMessageChannel('agent-boss', 'agent-lead', 'proj-1');
    expect(dm1.projectId).toBe('proj-1');
    expect(repo.getChannel(dm1.id, 'proj-1')?.id).toBe(dm1.id);
    expect(repo.getChannel(dm1.id, 'proj-2')).toBeUndefined();
  });

  it('classifies destructive commands in executeShell as HIGH risk to enforce operator approval under AUTO', () => {
    const gateway = new ToolGateway({});
    expect(gateway.classifyRisk('executeShell', { command: 'rm -rf node_modules' })).toBe('HIGH');
    expect(gateway.classifyRisk('executeShell', { command: 'npm install malicious-pkg' })).toBe('HIGH');
    expect(gateway.classifyRisk('executeShell', { command: 'curl http://evil.com' })).toBe('HIGH');
    expect(gateway.classifyRisk('executeShell', { command: 'git push --force' })).toBe('HIGH');
    expect(gateway.classifyRisk('executeShell', { command: 'echo hello' })).toBe('MEDIUM');
  });

  it('requires human approval for HIGH risk commands in Sentinel under AUTO mode', () => {
    const sentinel = Sentinel.getInstance();
    const decision = sentinel.evaluate({
      agentId: 'test-agent',
      toolName: 'executeShell',
      params: { command: 'npm test' },
      riskLevel: 'HIGH',
      autonomyMode: 'AUTO',
      agentCapabilities: ['fs:read', 'fs:write', 'shell:exec'],
    });

    expect(decision.requiresApproval).toBe(true);
  });

  it('redacts plaintext API keys and bearer tokens when persisting channel messages', () => {
    const db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    const service = new ChannelService(db);

    const now = Date.now();
    db.execute("INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-sec', 'Secure WS', '.', 'AUTO', 100, 100)");
    db.execute("INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-sec', 'ws-sec', 'Secure Project', '.', 100, 100)");
    db.execute("INSERT INTO channels (id, project_id, name, is_private, channel_type, created_at) VALUES ('chan-sec', 'proj-sec', 'security', 0, 'channel', 100)");

    const msg = service.sendMessage({
      channelId: 'chan-sec',
      senderId: 'user-sec',
      senderType: 'human',
      content: 'Here is the secret token: Bearer mysecrettoken1234567890abcdef and sk-123456789012345678901234567890',
    });

    expect(msg.content).not.toContain('mysecrettoken1234567890abcdef');
    expect(msg.content).not.toContain('sk-123456789012345678901234567890');
    expect(msg.content).toContain('[REDACTED][REDACTED_TOKEN]');
    expect(msg.content).toContain('[REDACTED][REDACTED_KEY]');

    const row = db.queryOne<{ content: string }>('SELECT content FROM messages WHERE id = ?', msg.id);
    expect(row?.content).toBe(msg.content);
  });

  it('redacts sensitive API credentials when storing scoped memories', () => {
    const db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    const memoryRepo = new MemoryRepository(db);

    const mem = memoryRepo.setMemory({
      scope: 'project',
      scopeId: 'proj-sec',
      type: 'preference',
      key: 'api_config',
      value: {
        endpoint: 'https://api.example.com',
        apiKey: 'sk-secret12345678901234567890',
      },
    });

    const parsed = mem.value as any;
    expect(parsed.apiKey).toBe('[REDACTED][REDACTED_KEY]');

    const storedRow = db.queryOne<{ value_json: string }>('SELECT value_json FROM memories WHERE id = ?', mem.id);
    expect(storedRow?.value_json).not.toContain('sk-secret12345678901234567890');
    expect(storedRow?.value_json).toContain('[REDACTED][REDACTED_KEY]');
  });
});
