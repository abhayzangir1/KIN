import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { Sentinel } from '../src/security/sentinel.js';
import { BrowserController } from '../src/browser/browser_controller.js';
import { KinDatabase } from '../src/storage/db.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';

describe('Phase 1: Deep Security & Perimeter Hardening Audit Tests', () => {
  let tempDir: string;
  let worktreeDir: string;
  let db: KinDatabase;
  let workspaceRepo: WorkspaceRepository;
  let gateway: ToolGateway;
  let sentinel: Sentinel;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-sec-phase1-'));
    worktreeDir = path.join(tempDir, 'worktree');
    fs.mkdirSync(worktreeDir, { recursive: true });

    db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    workspaceRepo = new WorkspaceRepository(db);

    gateway = new ToolGateway({ db });
    sentinel = Sentinel.getInstance();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. ToolGateway.resolveJailedPath Sensitive Files & Database Denial', () => {
    it('blocks direct access to .env, .env.production, and credential config files', () => {
      const sensitiveFiles = [
        '.env',
        '.env.local',
        '.env.production',
        'vault.key',
        'ipc_auth.token',
        'id_rsa',
        'id_ed25519',
        '.npmrc',
        '.pypirc',
        'kin_storage.sqlite',
        'kin_storage.sqlite-wal',
        'kin_storage.sqlite-shm',
        'custom.sqlite3',
        '.git/config',
        '.ssh/id_rsa',
        '.aws/credentials',
        '.kin/state.json',
      ];

      for (const file of sensitiveFiles) {
        expect(() => {
          gateway.resolveJailedPath(file, worktreeDir);
        }, `Expected access to '${file}' to be blocked`).toThrow(/SECURITY JAIL VIOLATION/);
      }
    });

    it('blocks access to symlink pointing to sensitive target inside worktree', () => {
      const realEnv = path.join(worktreeDir, 'real_secret.env');
      fs.writeFileSync(realEnv, 'SECRET_KEY=12345');
      const linkPath = path.join(worktreeDir, 'innocent_alias.txt');

      try {
        fs.symlinkSync(realEnv, linkPath);
        expect(() => {
          gateway.resolveJailedPath('innocent_alias.txt', worktreeDir);
        }).toThrow(/SECURITY JAIL VIOLATION/);
      } catch (err: any) {
        // Skip symlink test if unprivileged on Windows
        if (err.code !== 'EPERM') {
          throw err;
        }
      }
    });

    it('allows access to valid, non-sensitive project files', () => {
      const safeFile = path.join(worktreeDir, 'src', 'index.ts');
      fs.mkdirSync(path.dirname(safeFile), { recursive: true });
      fs.writeFileSync(safeFile, 'console.log("hello");');

      const resolved = gateway.resolveJailedPath('src/index.ts', worktreeDir);
      expect(resolved.toLowerCase()).toBe(fs.realpathSync(safeFile).toLowerCase());
    });
  });

  describe('2. Sentinel Destructive Action & Data Loss Prevention', () => {
    it('detects Windows PowerShell recursive and force deletion patterns as destructive', () => {
      const destructiveCommands = [
        'Remove-Item -Recurse -Force ./build',
        'Remove-Item ./dist -r',
        'del /s /q temp_data',
        'rmdir /s /q old_dir',
        'rd /s /q cache',
        'Clear-Content ./important.txt',
        'Stop-Computer -Force',
        'Restart-Computer',
      ];

      for (const cmd of destructiveCommands) {
        const result = sentinel.isDestructiveAction('executeShell', { command: cmd });
        expect(result.isDestructive, `Command '${cmd}' should be marked destructive`).toBe(true);
      }
    });

    it('detects Git destructive branch deletion and worktree discard as destructive', () => {
      const gitCommands = [
        'git branch -D feature/experimental',
        'git checkout -- .',
        'git restore .',
        'git restore --staged .',
      ];

      for (const cmd of gitCommands) {
        const result = sentinel.isDestructiveAction('executeShell', { command: cmd });
        expect(result.isDestructive, `Command '${cmd}' should be marked destructive`).toBe(true);
      }
    });

    it('detects broad database deletion and cloud storage removal (accidental-data-loss-prevention)', () => {
      const dataLossCommands = [
        'DELETE FROM tasks;',
        'DELETE FROM tasks WHERE 1=1',
        'gsutil rm -r gs://production-bucket/data',
        'gcloud storage rm --recursive gs://prod-assets',
      ];

      for (const cmd of dataLossCommands) {
        const result = sentinel.isDestructiveAction('executeShell', { command: cmd });
        expect(result.isDestructive, `Command '${cmd}' should be marked destructive`).toBe(true);
      }
    });

    it('permits safe non-destructive read commands without destructive classification', () => {
      const safeCommands = [
        'git status',
        'npm test',
        'dir',
        'ls -la',
        'node -v',
        'tsc --noEmit',
      ];

      for (const cmd of safeCommands) {
        const result = sentinel.isDestructiveAction('executeShell', { command: cmd });
        expect(result.isDestructive, `Command '${cmd}' should NOT be marked destructive`).toBe(false);
      }
    });
  });

  describe('3. BrowserController Hardened SSRF & Cloud Metadata Blocking', () => {
    let browser: BrowserController;

    beforeEach(() => {
      browser = new BrowserController();
    });

    it('blocks navigation to cloud metadata IP 169.254.169.254 and decimal integer representations', async () => {
      // 2852039166 is the decimal representation of 169.254.169.254
      const blockedUrls = [
        'http://169.254.169.254/latest/meta-data/',
        'http://2852039166/latest/meta-data/',
        'http://100.100.100.200/latest/meta-data/', // Alibaba IMDS
        'http://metadata.google.internal/computeMetadata/v1/',
        'http://instance-data/latest/',
      ];

      for (const u of blockedUrls) {
        await expect(browser.navigate(u)).rejects.toThrow(/ACCESS_DENIED.*cloud metadata/);
      }
    });
  });

  describe('4. WorkspaceRepository.listAllProjects Multi-Workspace Boundary', () => {
    it('returns all projects across all workspaces', () => {
      workspaceRepo.createWorkspace({
        id: 'ws-default',
        name: 'Default Workspace',
        rootPath: tempDir,
        defaultAutonomyMode: 'AUTO',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      workspaceRepo.createWorkspace({
        id: 'ws-prod',
        name: 'Production Workspace',
        rootPath: path.join(tempDir, 'prod'),
        defaultAutonomyMode: 'AUTO',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      workspaceRepo.createProject({
        id: 'proj-1',
        workspaceId: 'ws-default',
        name: 'Project 1',
        repoPath: path.join(tempDir, 'proj1'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      workspaceRepo.createProject({
        id: 'proj-2',
        workspaceId: 'ws-prod',
        name: 'Project 2',
        repoPath: path.join(tempDir, 'proj2'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const defaultProjects = workspaceRepo.listProjects('ws-default');
      expect(defaultProjects.length).toBe(1);
      expect(defaultProjects[0].id).toBe('proj-1');

      const allProjects = workspaceRepo.listAllProjects();
      expect(allProjects.length).toBe(2);
      expect(allProjects.map((p) => p.id)).toContain('proj-1');
      expect(allProjects.map((p) => p.id)).toContain('proj-2');
    });
  });
});
