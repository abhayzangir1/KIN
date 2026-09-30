import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { WorktreeManager } from '../src/execution/worktree_manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
});
