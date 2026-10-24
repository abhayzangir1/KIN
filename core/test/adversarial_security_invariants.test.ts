import { describe, it, expect } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { Sentinel } from '../src/security/sentinel.js';

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
});
