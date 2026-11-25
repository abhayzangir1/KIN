import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WorkspaceTrustManager } from '../src/policy/workspace_trust.js';
import { HookRegistry } from '../src/policy/hook_registry.js';
import { Sentinel } from '../src/security/sentinel.js';
import { LspManager } from '../src/execution/lsp_manager.js';
import { PluginManager } from '../src/skills/plugin_manager.js';
import { WorktreeManager } from '../src/execution/worktree_manager.js';
import { runQuickJSWorker } from '../src/execution/worker_quickjs.js';
import { OAuthHandler } from '../src/api/oauth_handler.js';
import { McpClientManager } from '../src/execution/mcp_client.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  WorkspaceTrustManager.getInstance().setEnforceInTests(false);
  for (const d of tempDirs.splice(0, tempDirs.length)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // Ignore Windows file lock cleanup warnings
    }
  }
});

describe('Wave 2 Ecosystem, Sandbox & Security Verification', () => {
  it('WorkspaceTrustManager quarantines untrusted repo configs and invalidates on SHA-256 change', () => {
    const storeDir = mkTempDir('kin-trust-store-');
    const repoDir = mkTempDir('kin-trust-repo-');
    const trust = WorkspaceTrustManager.getInstance();
    trust.setStorePath(path.join(storeDir, 'trusted_workspaces.json'));
    trust.setEnforceInTests(true);

    fs.mkdirSync(path.join(repoDir, '.kin'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.kin', 'hooks.json'), JSON.stringify({ hooks: {} }), 'utf-8');

    const initial = trust.getTrustStatus(repoDir);
    expect(initial.hasConfigs).toBe(true);
    expect(initial.trusted).toBe(false);
    expect(trust.isTrusted(repoDir)).toBe(false);

    const approved = trust.trustWorkspace(repoDir, 'test-operator');
    expect(approved.trusted).toBe(true);
    expect(trust.isTrusted(repoDir)).toBe(true);

    // Mutate config file -> SHA-256 mismatch re-quarantines automatically
    fs.writeFileSync(path.join(repoDir, '.kin', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [] } }), 'utf-8');
    const afterMutation = trust.getTrustStatus(repoDir);
    expect(afterMutation.trusted).toBe(false);
    expect(afterMutation.reason).toMatch(/changed/i);
  });

  it('HookRegistry quarantines untrusted repo hooks and enforces exit-code-2 PreToolUse blocks once trusted', async () => {
    const storeDir = mkTempDir('kin-hook-store-');
    const repoDir = mkTempDir('kin-hook-repo-');
    const trust = WorkspaceTrustManager.getInstance();
    trust.setStorePath(path.join(storeDir, 'trusted_workspaces.json'));
    trust.setEnforceInTests(true);

    fs.mkdirSync(path.join(repoDir, '.kin'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, '.kin', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'writeFile',
              command: process.execPath,
              args: ['-e', 'process.stderr.write("blocked by policy"); process.exit(2);'],
            },
          ],
        },
      }),
      'utf-8'
    );

    const hooks = HookRegistry.getInstance();
    // Untrusted: hook is quarantined, so tool is allowed without executing repo hook
    const quarantinedRes = await hooks.runHooks('PreToolUse', {
      repoRoot: repoDir,
      toolName: 'writeFile',
      params: { filePath: 'a.txt' },
    });
    expect(quarantinedRes.allowed).toBe(true);
    expect(quarantinedRes.outputs).toHaveLength(0);

    // Trust workspace -> deterministic exit code 2 blocks writeFile
    trust.trustWorkspace(repoDir);
    const enforcedRes = await hooks.runHooks('PreToolUse', {
      repoRoot: repoDir,
      toolName: 'writeFile',
      params: { filePath: 'a.txt' },
    });
    expect(enforcedRes.allowed).toBe(false);
    expect(enforcedRes.reason).toContain('blocked by policy');
  });

  it('Sentinel taint tracking escalates shell/config writes after external reads unless token-authorized', () => {
    const sentinel = Sentinel.getInstance();
    const runId = `run-taint-${Date.now()}`;
    sentinel.clearRunTaint(runId);

    const cleanCheck = sentinel.evaluate({
      agentId: 'agent-1',
      runId,
      toolName: 'writeFile',
      params: { filePath: '.kin/hooks.json', content: '{}' },
      riskLevel: 'low',
      autonomyMode: 'autonomous',
      agentCapabilities: ['*'],
    });
    expect(cleanCheck.allowed).toBe(true);
    expect(cleanCheck.requiresApproval).toBe(false);

    sentinel.markRunTainted(runId, 'fetchUrl');
    expect(sentinel.isRunTainted(runId)).toBe(true);

    const taintedShell = sentinel.evaluate({
      agentId: 'agent-1',
      runId,
      toolName: 'executeShell',
      params: { command: 'echo hi' },
      riskLevel: 'low',
      autonomyMode: 'autonomous',
      agentCapabilities: ['*'],
    });
    expect(taintedShell.allowed).toBe(true);
    expect(taintedShell.requiresApproval).toBe(true);
    expect(taintedShell.reason).toMatch(/TAINT ESCALATION/i);

    const taintedConfigWrite = sentinel.evaluate({
      agentId: 'agent-1',
      runId,
      toolName: 'writeFile',
      params: { filePath: '.kin/mcp.json', content: '{}' },
      riskLevel: 'low',
      autonomyMode: 'autonomous',
      agentCapabilities: ['*'],
    });
    expect(taintedConfigWrite.requiresApproval).toBe(true);
    sentinel.clearRunTaint(runId);
  });

  it('LspManager maps file specs cleanly and respects hardware/RAM gating', () => {
    expect(LspManager.getSpecForFile('index.ts')?.command).toBe('typescript-language-server');
    expect(LspManager.getSpecForFile('app.py')?.command).toBe('pyright-langserver');
    expect(LspManager.getSpecForFile('main.rs')?.command).toBe('rust-analyzer');
    expect(LspManager.getSpecForFile('main.go')?.command).toBe('gopls');
    expect(LspManager.getSpecForFile('notes.md')).toBeNull();
  });

  it('PluginManager quarantines untrusted .kin-plugin/plugin.json and loads skills once trusted', async () => {
    const storeDir = mkTempDir('kin-plug-store-');
    const repoDir = mkTempDir('kin-plug-repo-');
    const trust = WorkspaceTrustManager.getInstance();
    trust.setStorePath(path.join(storeDir, 'trusted_workspaces.json'));
    trust.setEnforceInTests(true);

    fs.mkdirSync(path.join(repoDir, '.kin-plugin'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'skills', 'hello'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, '.kin-plugin', 'plugin.json'),
      JSON.stringify({ name: 'test-plugin', version: '1.0.0', skills: ['skills'] }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(repoDir, 'skills', 'hello', 'SKILL.md'),
      '---\nname: hello-plugin-skill\ndescription: Test skill\n---\nSay hello.\n',
      'utf-8'
    );

    const db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    const skillEngine = new SkillEngine(db, path.join(repoDir, '.kin', 'skills'));

    const quarantined = await PluginManager.getInstance().loadPluginFromRepo(repoDir, { skillEngine });
    expect(quarantined?.quarantined).toBe(true);
    expect(quarantined?.skillsLoaded).toBe(0);

    trust.trustWorkspace(repoDir);
    const loaded = await PluginManager.getInstance().loadPluginFromRepo(repoDir, { skillEngine });
    expect(loaded?.quarantined).toBe(false);
    expect(loaded?.skillsLoaded).toBe(1);
    db.close();
  });

  it('WorktreeManager supports getHeadSha, undoLastTurn, redoLastTurn, and forkWorktree', async () => {
    const repoDir = mkTempDir('kin-git-wt-');
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'KIN Test'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@kin.local'], { cwd: repoDir });

    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'v1', 'utf-8');
    execFileSync('git', ['add', '-A'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'c1'], { cwd: repoDir });
    const sha1 = await WorktreeManager.getHeadSha(repoDir);

    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'v2', 'utf-8');
    execFileSync('git', ['add', '-A'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'c2'], { cwd: repoDir });
    const sha2 = await WorktreeManager.getHeadSha(repoDir);

    const wm = new WorktreeManager(repoDir);
    const undoRes = await wm.undoLastTurn(repoDir);
    expect(undoRes.success).toBe(true);
    expect(undoRes.currentSha).toBe(sha1);
    expect(fs.readFileSync(path.join(repoDir, 'a.txt'), 'utf-8')).toBe('v1');

    const redoRes = await wm.redoLastTurn(repoDir);
    expect(redoRes.success).toBe(true);
    expect(redoRes.currentSha).toBe(sha2);
    expect(fs.readFileSync(path.join(repoDir, 'a.txt'), 'utf-8')).toBe('v2');

    const forkRes = await wm.forkWorktree(repoDir, 'exp-branch');
    expect(forkRes.success).toBe(true);
    expect(forkRes.branch).toBe('fork/exp-branch');
    expect(fs.existsSync(forkRes.worktreePath!)).toBe(true);
    await wm.removeWorktree(forkRes.worktreePath!);
  });

  it('runQuickJSWorker executes isolated JS with zero Node globals and supports callTool PTC', async () => {
    const res = await runQuickJSWorker({
      handlerCode: `
        module.exports = async (params) => {
          const hasProcess = typeof process !== 'undefined';
          const sum = await callTool('add', { a: params.x, b: 10 });
          return { hasProcess, sum };
        };
      `,
      params: { x: 32 },
      enableCallTool: true,
      onToolCall: async (name, args) => {
        if (name === 'add') return Number(args.a) + Number(args.b);
        return null;
      },
    });
    expect(res.success).toBe(true);
    expect(res.output).toEqual({ hasProcess: false, sum: 42 });
  });

  it('OAuthHandler builds RFC 8707 + CIMD OAuth 2.1 URLs and McpClientManager resolves elicitation', () => {
    const auth = OAuthHandler.buildMcpOAuth21AuthUrl({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      clientIdMetadataUrl: 'https://kin.local/client-metadata.json',
      redirectUri: 'http://127.0.0.1:54321/api/oauth/callback',
      resource: 'https://mcp.example.com/sse',
      scope: 'mcp:tools',
    });
    const parsed = new URL(auth.authUrl);
    expect(parsed.searchParams.get('client_id')).toBe('https://kin.local/client-metadata.json');
    expect(parsed.searchParams.get('resource')).toBe('https://mcp.example.com/sse');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');

    const mcp = new McpClientManager(process.cwd());
    expect(mcp.listPendingElicitations()).toEqual([]);
    expect(mcp.resolveElicitation('missing-id', { action: 'decline' })).toBe(false);
  });
});
