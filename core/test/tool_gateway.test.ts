import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { WorktreeManager } from '../src/execution/worktree_manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { AgentRepository } from '../src/domain/agent_repository.js';

const execFileAsync = promisify(execFile);

describe('KIN Phase 4/5: Tool Gateway & Git Worktree Manager', () => {
  let tempRepoDir: string;
  let worktreeManager: WorktreeManager;
  let toolGateway: ToolGateway;

  beforeEach(async () => {
    tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-wt-test-'));

    // Initialize real git repo
    await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: tempRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tempRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempRepoDir });

    // Initial commit
    fs.writeFileSync(path.join(tempRepoDir, 'README.md'), '# Main Repo\nInitial content\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: tempRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tempRepoDir });

    worktreeManager = new WorktreeManager(tempRepoDir);
    toolGateway = new ToolGateway();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoDir, { recursive: true, force: true });
    } catch {
      // Windows lock delays ignored
    }
  });

  it('provisions isolated worktree, commits changes, and generates unified diff', async () => {
    const { worktreePath, branch } = await worktreeManager.provisionWorktree('task-wt-1', 'frontend');
    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(branch).toBe('feat/kin-task-wt-1-frontend');

    // Agent modifies file inside worktree
    const targetFile = path.join(worktreePath, 'app.ts');
    fs.writeFileSync(targetFile, 'console.log("Hello from worktree");\n');

    // Commit changes in worktree
    const commitSha = await worktreeManager.commitWorktreeChanges(worktreePath, 'feat: add app.ts');
    expect(commitSha).toBeDefined();

    // Generate diff
    const diff = await worktreeManager.generateDiff(worktreePath, 'main');
    expect(diff).toContain('diff --git a/app.ts b/app.ts');
    expect(diff).toContain('+console.log("Hello from worktree");');

    // Clean up worktree
    await worktreeManager.removeWorktree(worktreePath);
    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it('enforces worktree jail path confinement and rejects directory traversal attacks', async () => {
    const { worktreePath } = await worktreeManager.provisionWorktree('task-jail-1');

    // 1. Valid write inside worktree -> succeeds
    const writeResult = await toolGateway.executeTool(
      'writeFile',
      { path: 'src/config.json', content: '{"active": true}' },
      {
        runId: 'run-1',
        agentId: 'agent-1',
        worktreeRoot: worktreePath,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['fs_write'],
      }
    );
    expect(writeResult.success).toBe(true);
    expect(fs.existsSync(path.join(worktreePath, 'src/config.json'))).toBe(true);

    // 2. Traversal attempt trying to escape worktree -> REJECTED
    const escapeResult = await toolGateway.executeTool(
      'writeFile',
      { path: '../../../../malicious.txt', content: 'pwned' },
      {
        runId: 'run-1',
        agentId: 'agent-1',
        worktreeRoot: worktreePath,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['fs_write'],
      }
    );
    expect(escapeResult.success).toBe(false);
    expect(escapeResult.error).toContain('SECURITY JAIL VIOLATION');

    await worktreeManager.removeWorktree(worktreePath);
  });

  it('enforces Autonomy Mode gates against action risk tiers', async () => {
    const { worktreePath } = await worktreeManager.provisionWorktree('task-autonomy-1');

    // 1. High risk command under AUTO mode -> HALTS and requires approval
    const highRiskResult = await toolGateway.executeTool(
      'executeShell',
      { command: 'rm -rf /cache/db' },
      {
        runId: 'run-1',
        agentId: 'agent-1',
        worktreeRoot: worktreePath,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['shell'],
      }
    );
    expect(highRiskResult.success).toBe(false);
    expect(highRiskResult.requiresApproval).toBe(true);
    expect(highRiskResult.riskLevel).toBe('HIGH');

    // 2. Safe file write under AUTO mode -> AUTO-APPROVES
    const autoWriteResult = await toolGateway.executeTool(
      'writeFile',
      { path: 'notes.txt', content: 'test notes' },
      {
        runId: 'run-1',
        agentId: 'agent-1',
        worktreeRoot: worktreePath,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['fs_write'],
      }
    );
    expect(autoWriteResult.success).toBe(true);
    expect(autoWriteResult.requiresApproval).toBeUndefined();

    // 3. File write under ALWAYS_ASK mode -> PROMPTS user
    const alwaysAskResult = await toolGateway.executeTool(
      'writeFile',
      { path: 'notes2.txt', content: 'test notes 2' },
      {
        runId: 'run-1',
        agentId: 'agent-1',
        worktreeRoot: worktreePath,
        autonomyMode: 'ALWAYS_ASK',
        allowedCapabilities: ['fs_write'],
      }
    );
    expect(alwaysAskResult.success).toBe(false);
    expect(alwaysAskResult.requiresApproval).toBe(true);

    await worktreeManager.removeWorktree(worktreePath);
  });

  it('exposes hireSpecialist tool schema and executes hiring with database persistence and callback', async () => {
    // 1. Verify schema exposure
    const schemas = toolGateway.getToolSchemas();
    const hireSchema = schemas.find((s) => s.name === 'hireSpecialist');
    expect(hireSchema).toBeDefined();
    expect(hireSchema?.parameters.required).toContain('displayName');
    expect(hireSchema?.parameters.required).toContain('roleTitle');

    // 2. Initialize in-memory test database with migrations
    const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-hire-test-'));
    const tempDbPath = path.join(tempDbDir, 'test.sqlite');
    const db = new KinDatabase({ dbPath: tempDbPath });
    new MigrationRunner(db).runMigrations();

    const gw = new ToolGateway({ db });
    let callbackInvoked = false;
    let hiredAgentPayload: any = null;
    let hiredChannelPayload: any = null;

    gw.setAgentHiredCallback((agent, channelId) => {
      callbackInvoked = true;
      hiredAgentPayload = agent;
      hiredChannelPayload = channelId;
    });

    // 3. Execute tool
    const result = await gw.executeTool(
      'hireSpecialist',
      {
        displayName: '@AndroidDev',
        roleTitle: 'Senior Android Engineer',
        domainAuthority: ['Android', 'Kotlin', 'Jetpack Compose'],
        suggestedModel: 'ollama/qwen2.5-coder:3b',
        systemPrompt: 'You build top tier Android apps.',
      },
      {
        runId: 'run-hire-1',
        agentId: 'agent-boss',
        projectId: 'proj-mobile',
        channelId: 'chan-mobile-gen',
        worktreeRoot: tempRepoDir,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['agent:hire', '*'],
      }
    );

    expect(result.success).toBe(true);
    expect(result.output.displayName).toBe('@AndroidDev');
    expect(result.output.role).toBe('Senior Android Engineer');
    expect(result.output.projectId).toBe('proj-mobile');
    expect(result.output.channelId).toBe('chan-mobile-gen');

    // 4. Verify callback
    expect(callbackInvoked).toBe(true);
    expect(hiredAgentPayload?.displayName).toBe('@AndroidDev');
    expect(hiredChannelPayload).toBe('chan-mobile-gen');

    // 5. Verify database records
    const identity = db.queryOne<any>(
      `SELECT * FROM agent_identities WHERE display_name = ? AND project_id = ?`,
      '@AndroidDev',
      'proj-mobile'
    );
    expect(identity).toBeDefined();
    expect(identity.project_id).toBe('proj-mobile');

    const member = db.queryOne<any>(
      `SELECT * FROM channel_members WHERE channel_id = ? AND agent_id = ?`,
      'chan-mobile-gen',
      identity.id
    );
    expect(member).toBeDefined();

    db.close();
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {}
  });

  it('strictly scopes WorkspaceRepository.listAgentChannelIds to the specified project', () => {
    const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-scope-test-'));
    const tempDbPath = path.join(tempDbDir, 'test.sqlite');
    const db = new KinDatabase({ dbPath: tempDbPath });
    new MigrationRunner(db).runMigrations();

    const repo = new WorkspaceRepository(db);
    const agentRepo = new AgentRepository(db);
    const now = Date.now();

    // Setup workspace
    repo.createWorkspace({
      id: 'ws-default',
      name: 'Default Workspace',
      rootPath: '.',
      defaultAutonomyMode: 'AUTO',
      createdAt: now,
      updatedAt: now,
    });

    // Setup agent definition and identity
    const bossId = 'agent-boss';
    agentRepo.createDefinition({
      id: 'def-boss',
      name: 'Boss',
      role: 'Orchestrator',
      systemPrompt: 'Lead',
      defaultModelId: 'ollama/qwen2.5-coder:3b',
      domainAuthority: ['boss'],
      capabilities: ['*'],
      createdAt: now,
    });
    // Setup two projects
    repo.createProject({ id: 'proj-a', workspaceId: 'ws-default', name: 'Project A', repoPath: '/a', createdAt: now });
    repo.createProject({ id: 'proj-b', workspaceId: 'ws-default', name: 'Project B', repoPath: '/b', createdAt: now });

    agentRepo.createIdentity({
      id: bossId,
      workspaceId: 'ws-default',
      projectId: 'proj-a',
      definitionId: 'def-boss',
      displayName: '@Boss',
      activeModelId: 'ollama/qwen2.5-coder:3b',
      isOrchestrator: true,
      isEphemeral: false,
      createdAt: now,
      updatedAt: now,
    });

    // Setup channels in both projects
    repo.createChannel({ id: 'chan-a1', projectId: 'proj-a', name: 'general', createdAt: now });
    repo.createChannel({ id: 'chan-a2', projectId: 'proj-a', name: 'dev', createdAt: now });
    repo.createChannel({ id: 'chan-b1', projectId: 'proj-b', name: 'general', createdAt: now });
    repo.createChannel({ id: 'chan-b2', projectId: 'proj-b', name: 'alerts', createdAt: now });

    // Enroll Boss agent in all 4 channels
    repo.addChannelMember('chan-a1', bossId);
    repo.addChannelMember('chan-a2', bossId);
    repo.addChannelMember('chan-b1', bossId);
    repo.addChannelMember('chan-b2', bossId);

    // Global list without projectId includes all 4
    const allChannels = repo.listAgentChannelIds(bossId);
    expect(allChannels).toHaveLength(4);

    // Scoped list for Project A ONLY returns Project A channels
    const projAChannels = repo.listAgentChannelIds(bossId, 'proj-a');
    expect(projAChannels).toEqual(['chan-a1', 'chan-a2']);
    expect(projAChannels).not.toContain('chan-b1');
    expect(projAChannels).not.toContain('chan-b2');

    // Scoped list for Project B ONLY returns Project B channels
    const projBChannels = repo.listAgentChannelIds(bossId, 'proj-b');
    expect(projBChannels).toEqual(['chan-b1', 'chan-b2']);
    expect(projBChannels).not.toContain('chan-a1');
    expect(projBChannels).not.toContain('chan-a2');

    db.close();
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {}
  });
});
