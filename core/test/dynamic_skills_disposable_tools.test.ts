import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { Sentinel } from '../src/security/sentinel.js';
import { CoreServer } from '../src/server/core_server.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { MemoryRepository, OCCConflictError } from '../src/domain/memory_repository.js';

describe('Dynamic Skills & Disposable Tools Full Lifecycle Verification', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let skillEngine: SkillEngine;
  let toolGateway: ToolGateway;
  let sentinel: Sentinel;
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-skills-disposable-test-'));
    dbPath = path.join(tempDir, 'skills_test.sqlite');
    db = new KinDatabase(dbPath);
    new MigrationRunner(db).runMigrations();

    skillEngine = new SkillEngine(db, path.join(tempDir, 'skills'));
    toolGateway = new ToolGateway({ db, skillEngine });
    sentinel = Sentinel.getInstance();

    server = new CoreServer({ port: 0, dbPath });
    port = await server.start();
  });

  afterAll(async () => {
    if (server) await server.stop();
    if (db) db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ============================================================================
  // 1. ToolGateway Schemas & Capability Mapping
  // ============================================================================
  it('ToolGateway exposes delete_skill and dispose_tool schemas', () => {
    const schemas = toolGateway.getToolSchemas();
    const deleteSkillSchema = schemas.find((s) => s.name === 'delete_skill');
    const disposeToolSchema = schemas.find((s) => s.name === 'dispose_tool');

    expect(deleteSkillSchema).toBeDefined();
    expect(deleteSkillSchema?.description).toContain('Delete or remove a skill');
    expect(deleteSkillSchema?.parameters.properties).toHaveProperty('skillId');

    expect(disposeToolSchema).toBeDefined();
    expect(disposeToolSchema?.description).toContain('Dispose or deregister');
    expect(disposeToolSchema?.parameters.properties).toHaveProperty('toolName');
  });

  it('ToolGateway maps delete_skill and dispose_tool to skills:manage capability', () => {
    for (const name of ['delete_skill', 'deleteSkill', 'dispose_tool', 'disposeTool']) {
      const cap = toolGateway.getRequiredCapability(name);
      expect(cap.primary).toBe('skills:manage');
      expect(cap.aliases).toContain('skills:manage');
      expect(cap.aliases).toContain(name);
    }
  });

  // ============================================================================
  // 2. Sentinel Safe Reversible Gate & Destructive Exemption
  // ============================================================================
  it('Sentinel classifies delete_skill and dispose_tool as safe reversible MEDIUM risk', () => {
    for (const name of ['delete_skill', 'deleteSkill', 'dispose_tool', 'disposeTool']) {
      const risk = sentinel.evaluateRisk(name, { skillId: 'some-skill' });
      expect(risk).toBe('MEDIUM');
    }
  });

  it('Sentinel isDestructiveAction exempts delete_skill and dispose_tool from destructive gate', () => {
    for (const name of ['delete_skill', 'deleteskill', 'dispose_tool', 'disposetool', 'deleteSkill', 'disposeTool']) {
      const check = sentinel.isDestructiveAction(name, {});
      expect(check.isDestructive).toBe(false);
    }
  });

  // ============================================================================
  // 3. SkillEngine & Dynamic Disposable Tool Creation, Execution, and Deletion
  // ============================================================================
  it('SkillEngine creates, executes (TypeScript transpile in worker), and deletes custom skills', async () => {
    // Create skill
    const skill = skillEngine.createSkill({
      name: 'math-doubler',
      description: 'Doubles an input number',
      instructions: 'Return double the input',
      handlerCode: `
        export async function run(params: { num: number }) {
          return { doubled: params.num * 2 };
        }
      `,
      parameters: { num: { type: 'number' } },
      skillType: 'tool_extension',
      status: 'active',
    });

    expect(skill.id).toBeDefined();
    expect(skill.name).toBe('math-doubler');

    // Execute skill via worker threads
    const execRes = await skillEngine.executeSkill('math-doubler', { num: 21 });
    expect(execRes.success).toBe(true);
    expect(execRes.output).toEqual({ doubled: 42 });

    // Delete skill by bare name
    const deletedByName = skillEngine.deleteSkill('math-doubler');
    expect(deletedByName).toBe(true);
    expect(skillEngine.getSkill('math-doubler')).toBeUndefined();
  });

  it('SkillEngine deleteSkill supports lookup by ID, bare name, and stripped candidate name', () => {
    // 1. Delete by ID
    const s1 = skillEngine.createSkill({
      name: 'temp-skill-one',
      description: 'One',
      instructions: 'One',
      status: 'active',
    });
    expect(skillEngine.deleteSkill(s1.id)).toBe(true);
    expect(skillEngine.getSkill(s1.id)).toBeUndefined();

    // 2. Delete by bare name
    const s2 = skillEngine.createSkill({
      name: 'temp-skill-two',
      description: 'Two',
      instructions: 'Two',
      status: 'active',
    });
    expect(skillEngine.deleteSkill('temp-skill-two')).toBe(true);
    expect(skillEngine.getSkill('temp-skill-two')).toBeUndefined();

    // 3. Delete by stripped candidate name (e.g. skill__temp-skill-three or skill_temp-skill-three)
    const s3 = skillEngine.createSkill({
      name: 'temp_skill_three',
      description: 'Three',
      instructions: 'Three',
      status: 'active',
    });
    expect(skillEngine.deleteSkill('skill__temp_skill_three')).toBe(true);
    expect(skillEngine.getSkill('temp_skill_three')).toBeUndefined();
  });

  it('SkillEngine rejects deletion of built-in system skills', () => {
    // Built-in skills have is_built_in = 1
    const builtInRow = db.queryOne<any>('SELECT id, name FROM skills WHERE is_built_in = 1');
    if (builtInRow) {
      expect(() => skillEngine.deleteSkill(builtInRow.id)).toThrow(/built-in/i);
      expect(() => skillEngine.deleteSkill(builtInRow.name)).toThrow(/built-in/i);
    }
  });

  // ============================================================================
  // 4. ToolGateway delete_skill and dispose_tool Invocations
  // ============================================================================
  it('ToolGateway executes create_skill and dispose_tool successfully', async () => {
    const ctx = {
      runId: 'run-test-dispose',
      agentId: 'agent-worker',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO' as const,
      allowedCapabilities: ['skills:manage', 'skills', '*'],
    };

    // 1. Create a disposable tool
    const createRes = await toolGateway.executeTool(
      'create_skill',
      {
        name: 'disposable-validator',
        description: 'Temporary JSON validation tool',
        handlerCode: 'module.exports = async (p) => ({ valid: Boolean(p.data) });',
        skillType: 'tool_extension',
        enabled: true,
      },
      ctx
    );
    expect(createRes.success).toBe(true);
    const createdId = (createRes.output as any).skillId;
    expect(createdId).toBeDefined();

    // 2. Execute via projected tool name skill__disposable_validator
    const invokeRes = await toolGateway.executeTool(
      'skill__disposable_validator',
      { data: 'valid payload' },
      ctx
    );
    expect(invokeRes.success).toBe(true);
    expect(invokeRes.output).toEqual({ valid: true });

    // 3. Dispose tool using dispose_tool with projected toolName
    const disposeRes = await toolGateway.executeTool(
      'dispose_tool',
      { toolName: 'skill__disposable_validator' },
      ctx
    );
    expect(disposeRes.success).toBe(true);
    expect((disposeRes.output as any).message).toContain('successfully deleted/disposed');

    // 4. Verify skill is gone
    expect(skillEngine.getSkill('disposable-validator')).toBeUndefined();
  });

  it('ToolGateway rejects deleting or disposing built-in skills', async () => {
    const ctx = {
      runId: 'run-test-protect',
      agentId: 'agent-worker',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO' as const,
      allowedCapabilities: ['skills:manage', '*'],
    };

    const builtInRow = db.queryOne<any>('SELECT id, name FROM skills WHERE is_built_in = 1');
    if (builtInRow) {
      const res = await toolGateway.executeTool('delete_skill', { skillId: builtInRow.name }, ctx);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/built-in/i);
    }
  });

  // ============================================================================
  // 5. CoreServer POST /api/memories OCC Conflict (HTTP 409)
  // ============================================================================
  it('POST /api/memories returns HTTP 409 Conflict with OCC_CONFLICT payload on version mismatch', async () => {
    // 1. Initial write
    const writeRes = await fetch(`http://127.0.0.1:${port}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        key: 'project_architecture_spec',
        value: { architecture: 'monolith', v: 1 },
      }),
    });
    expect(writeRes.status).toBe(201);
    const writeData: any = await writeRes.json();
    const version1 = writeData.memory.version;
    expect(version1).toBe(1);

    // 2. Stale write attempt with expectedVersion = 0 (OCC conflict)
    const conflictRes = await fetch(`http://127.0.0.1:${port}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        key: 'project_architecture_spec',
        value: { architecture: 'microservices', v: 2 },
        expectedVersion: 0,
      }),
    });
    expect(conflictRes.status).toBe(409);
    const conflictData: any = await conflictRes.json();
    expect(conflictData.code).toBe('OCC_CONFLICT');
    expect(conflictData.key).toBe('project_architecture_spec');
    expect(conflictData.expectedVersion).toBe(0);
    expect(conflictData.error).toContain('OCC CONFLICT');

    // 3. Valid write with matching expectedVersion = 1
    const okRes = await fetch(`http://127.0.0.1:${port}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        key: 'project_architecture_spec',
        value: { architecture: 'modular-monolith', v: 2 },
        expectedVersion: 1,
      }),
    });
    expect(okRes.status).toBe(201);
    const okData: any = await okRes.json();
    expect(okData.memory.version).toBe(2);
  });

  // ============================================================================
  // 6. Slash Command /skills delete <name> & /skills remove <name>
  // ============================================================================
  it('slash command /skills delete removes skill and broadcasts event', async () => {
    // Create skill to delete
    const skill = skillEngine.createSkill({
      name: 'disposable-cleanup-tool',
      description: 'To be deleted via slash command',
      instructions: 'Run cleanups',
      status: 'active',
    });
    expect(skillEngine.getSkill('disposable-cleanup-tool')).toBeDefined();

    // Get active channel
    const channelsRes = await fetch(`http://127.0.0.1:${port}/api/channels`);
    const channelsData: any = await channelsRes.json();
    const channelId = channelsData.channels?.[0]?.id || 'general';

    // Post slash command /skills delete disposable-cleanup-tool
    const msgRes = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/skills delete disposable-cleanup-tool',
      }),
    });
    expect(msgRes.status).toBe(201);

    // Verify skill is deleted from SkillEngine
    expect(skillEngine.getSkill('disposable-cleanup-tool')).toBeUndefined();

    // Fetch messages from channel and verify confirmation
    const historyRes = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`);
    const historyData: any = await historyRes.json();
    const lastMsg = historyData.messages[historyData.messages.length - 1];
    expect(lastMsg.content).toContain('Skill Deleted');
    expect(lastMsg.content).toContain('disposable-cleanup-tool');
  });

  it('slash command /skills delete with no argument returns usage help', async () => {
    const channelsRes = await fetch(`http://127.0.0.1:${port}/api/channels`);
    const channelsData: any = await channelsRes.json();
    const channelId = channelsData.channels?.[0]?.id || 'general';

    const msgRes = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/skills delete',
      }),
    });
    expect(msgRes.status).toBe(201);

    const historyRes = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`);
    const historyData: any = await historyRes.json();
    const lastMsg = historyData.messages[historyData.messages.length - 1];
    expect(lastMsg.content).toContain('💡 **Usage**: `/skills delete <idOrName>`');
  });

  // ============================================================================
  // 7. Edge Cases & Concurrency: export default, main, kebab-case, concurrent disposal
  // ============================================================================
  it('SkillEngine executes export default and main function handlers properly', async () => {
    // 1. export default handler
    const defaultSkill = skillEngine.createSkill({
      name: 'export-default-tester',
      description: 'Tests export default',
      handlerCode: `
        export default async function(params: { val: string }) {
          return { transformed: params.val.toUpperCase() };
        }
      `,
      status: 'active',
    });
    const defaultRes = await skillEngine.executeSkill(defaultSkill.name, { val: 'kin' });
    expect(defaultRes.success).toBe(true);
    expect(defaultRes.output).toEqual({ transformed: 'KIN' });
    skillEngine.deleteSkill(defaultSkill.id);

    // 2. export async function main handler
    const mainSkill = skillEngine.createSkill({
      name: 'export-main-tester',
      description: 'Tests main export',
      handlerCode: `
        export async function main(params: { a: number; b: number }) {
          return { sum: params.a + params.b };
        }
      `,
      status: 'active',
    });
    const mainRes = await skillEngine.executeSkill(mainSkill.name, { a: 15, b: 27 });
    expect(mainRes.success).toBe(true);
    expect(mainRes.output).toEqual({ sum: 42 });
    skillEngine.deleteSkill(mainSkill.id);
  });

  it('Sentinel exempts kebab-case delete-skill and dispose-tool from destructive gate', () => {
    for (const name of ['delete-skill', 'dispose-tool', 'delete_skill', 'dispose_tool']) {
      expect(sentinel.isDestructiveAction(name, {}).isDestructive).toBe(false);
    }
  });

  it('ToolGateway handles tool and target aliases with prefix stripping and concurrent disposal', async () => {
    const ctx = {
      runId: 'run-test-concurrent',
      agentId: 'agent-orchestrator',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO' as const,
      allowedCapabilities: ['skills:manage', '*'],
    };

    // 1. Create temporary skill
    const created = skillEngine.createSkill({
      name: 'concurrent-disposable-tool',
      description: 'Tool to be disposed concurrently',
      handlerCode: 'module.exports = async () => ({ status: "alive" });',
      status: 'active',
    });
    expect(skillEngine.getSkill('concurrent-disposable-tool')).toBeDefined();

    // 2. Test aliases: dispose with { target: 'skill-concurrent-disposable-tool' }
    // Run two simultaneous dispose operations (multi-agent race condition simulation)
    const [res1, res2] = await Promise.all([
      toolGateway.executeTool('dispose_tool', { target: `skill-${created.name}` }, ctx),
      toolGateway.executeTool('dispose_tool', { tool: created.name }, ctx),
    ]);

    // One must succeed, the other should gracefully report not found (or already deleted) without server crash
    const successes = [res1, res2].filter((r) => r.success);
    const failures = [res1, res2].filter((r) => !r.success);

    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(skillEngine.getSkill('concurrent-disposable-tool')).toBeUndefined();
    if (failures.length > 0) {
      expect(failures[0].error).toMatch(/not found/i);
    }
  });
});
