// ============================================================================
// KIN GIT WORKTREE MANAGER
// Jails concurrent coding agents to isolated git worktrees.
// Enforces post-merge prune (git worktree remove --force && git worktree prune).
// ============================================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

export class AsyncMutex {
  private queue = Promise.resolve();

  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ticket = this.queue.then(() => fn());
    this.queue = this.queue.then(() => wait).catch(() => {});
    try {
      return await ticket;
    } finally {
      release!();
    }
  }
}

export interface WorktreeProvisionResult {
  worktreePath: string;
  branch: string;
  isShadowRepo: boolean;
}

export interface MergeResult {
  success: boolean;
  cleanMerge: boolean;
  conflictFiles?: string[];
  commitSha?: string;
  error?: string;
}

export class WorktreeManager {
  private static mergeMutex = new AsyncMutex();
  private readonly projectRoot: string;
  private readonly worktreesDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.worktreesDir = path.join(this.projectRoot, '.kin', 'worktrees');

    if (!fs.existsSync(this.worktreesDir)) {
      fs.mkdirSync(this.worktreesDir, { recursive: true });
    }
  }

  /**
   * Provisions an isolated git worktree for a task.
   * If projectRoot is not a git repo, initializes an internal shadow git repo.
   */
  public async provisionWorktree(taskId: string, slug: string = 'worker'): Promise<WorktreeProvisionResult> {
    const isGit = await this.checkIsGitRepo(this.projectRoot);
    let workingRepoRoot = this.projectRoot;
    let isShadow = false;

    if (!isGit) {
      workingRepoRoot = await this.ensureShadowGitRepo(this.projectRoot);
      isShadow = true;
    }

    const cleanSlug = slug.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const branchName = `feat/kin-${taskId}-${cleanSlug}`;
    const worktreePath = path.join(this.worktreesDir, `${taskId}-${cleanSlug}`);

    // If worktree folder already exists, remove it cleanly first
    if (fs.existsSync(worktreePath)) {
      await this.removeWorktree(worktreePath);
    }

    // git worktree add -b <branchName> <worktreePath> HEAD
    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], {
        cwd: workingRepoRoot,
      });
    } catch (e: any) {
      // If branch already exists, add worktree without -b
      if (e.message && e.message.includes('already exists')) {
        await execFileAsync('git', ['worktree', 'add', worktreePath, branchName], {
          cwd: workingRepoRoot,
        });
      } else {
        throw new Error(`Failed to provision git worktree: ${e.message}`);
      }
    }

    return {
      worktreePath,
      branch: branchName,
      isShadowRepo: isShadow,
    };
  }

  /**
   * Generates a unified git diff of changes made within the worktree relative to base branch.
   */
  public async generateDiff(worktreePath: string, baseBranch: string = 'HEAD'): Promise<string> {
    try {
      // Register untracked files with intent-to-add so new files are recognized in diff
      try {
        await execFileAsync('git', ['add', '-N', '.'], { cwd: worktreePath });
      } catch {
        // Ignored if intent-to-add fails
      }

      let resolvedBranch = baseBranch;
      try {
        await execFileAsync('git', ['rev-parse', resolvedBranch], { cwd: worktreePath });
      } catch {
        resolvedBranch = 'HEAD';
      }

      let { stdout } = await execFileAsync('git', ['diff', resolvedBranch], {
        cwd: worktreePath,
      });

      // Check status to ensure untracked files are represented
      const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: worktreePath,
      }).catch(() => ({ stdout: '' }));

      if (statusOut.includes('??') || (!stdout.trim() && statusOut.trim())) {
        try {
          await execFileAsync('git', ['add', '-A'], { cwd: worktreePath });
          const diffRes = await execFileAsync('git', ['diff', resolvedBranch], {
            cwd: worktreePath,
          });
          if (diffRes.stdout.trim()) {
            stdout = diffRes.stdout;
          } else {
            const cachedDiff = await execFileAsync('git', ['diff', '--cached', resolvedBranch], {
              cwd: worktreePath,
            });
            stdout = cachedDiff.stdout;
          }
        } catch {}
      }

      return stdout;
    } catch (e: any) {
      throw new Error(`Failed to generate git diff in worktree: ${e.message}`);
    }
  }

  /**
   * Commits all modifications in the worktree.
   */
  public async commitWorktreeChanges(worktreePath: string, message: string): Promise<string> {
    try {
      await execFileAsync('git', ['add', '-A'], { cwd: worktreePath });
      await execFileAsync('git', ['commit', '-m', message], { cwd: worktreePath });
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath });
      return stdout.trim();
    } catch (e: any) {
      // If nothing to commit
      if (e.message && e.message.includes('nothing to commit')) {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath });
        return stdout.trim();
      }
      throw new Error(`Failed to commit changes in worktree: ${e.message}`);
    }
  }

  /**
   * Safely merges the feature branch into the target base branch without touching repoRoot working tree.
   */
  public async verifyAndMerge(
    worktreePath: string,
    branchName: string,
    baseBranch: string = 'main',
    project?: { defaultBranch?: string; settings?: { defaultBranch?: string } }
  ): Promise<MergeResult> {
    let targetBase = project?.defaultBranch || project?.settings?.defaultBranch || baseBranch || 'main';
    return WorktreeManager.mergeMutex.runExclusive(async () => {
      try {
        const isGit = await this.checkIsGitRepo(this.projectRoot);
        const repoRoot = isGit ? this.projectRoot : path.join(this.projectRoot, '.kin', '.git_shadow');

        let headSha = '';
        try {
          const { stdout: headShaOut } = await execFileAsync('git', ['rev-parse', targetBase], { cwd: repoRoot });
          headSha = headShaOut.trim();
        } catch {
          try {
            const { stdout: curBranchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot });
            const curBranch = curBranchOut.trim();
            if (curBranch && curBranch !== 'HEAD') {
              targetBase = curBranch;
              const { stdout } = await execFileAsync('git', ['rev-parse', targetBase], { cwd: repoRoot });
              headSha = stdout.trim();
            } else {
              const alt = targetBase === 'main' ? 'master' : 'main';
              const { stdout } = await execFileAsync('git', ['rev-parse', alt], { cwd: repoRoot });
              headSha = stdout.trim();
              targetBase = alt;
            }
          } catch {
            const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
            headSha = stdout.trim();
            targetBase = 'HEAD';
          }
        }

        const { stdout: branchShaOut } = await execFileAsync('git', ['rev-parse', branchName], { cwd: repoRoot });
        const branchSha = branchShaOut.trim();

        let mergedTreeSha = '';
        try {
          // Modern Git 2.38+ programmatic merge without workspace modification
          const { stdout: treeOut } = await execFileAsync(
            'git',
            ['merge-tree', '--write-tree', targetBase, branchName],
            { cwd: repoRoot }
          );
          mergedTreeSha = treeOut.trim().split(/\r?\n/)[0];
        } catch (writeTreeErr: any) {
          // Check if failure was due to real merge conflicts in Git 2.38+
          const conflictIndicator = (writeTreeErr.stdout || '') + (writeTreeErr.stderr || '') + (writeTreeErr.message || '');
          if (conflictIndicator.includes('CONFLICT') || writeTreeErr.code === 1 && !conflictIndicator.includes('unknown option') && !conflictIndicator.includes('usage:')) {
            return {
              success: false,
              cleanMerge: false,
              error: `Merge conflict detected between ${branchName} and ${targetBase}`,
            };
          }

          // Fallback to 3-arg syntax for older Git: git merge-tree <base> <branch1> <branch2>
          try {
            const { stdout: baseShaOut } = await execFileAsync('git', ['merge-base', targetBase, branchName], { cwd: repoRoot });
            const { stdout: mergeTreeOut } = await execFileAsync(
              'git',
              ['merge-tree', baseShaOut.trim(), headSha, branchSha],
              { cwd: repoRoot }
            );
            if (mergeTreeOut.includes('<<<<<<<') || mergeTreeOut.includes('changed in both')) {
              return {
                success: false,
                cleanMerge: false,
                error: `Merge conflict detected between ${branchName} and ${targetBase}`,
              };
            }
          } catch (fallbackErr: any) {
            return {
              success: false,
              cleanMerge: false,
              error: `Merge conflict detected: ${writeTreeErr?.message || fallbackErr?.message}`,
            };
          }
        }

        // Programmatic commit tree creation: isolates merge strictly to git objects without touching repoRoot workspace
        let finalCommit = '';
        if (mergedTreeSha) {
          const { stdout: commitOut } = await execFileAsync(
            'git',
            ['commit-tree', mergedTreeSha, '-p', headSha, '-p', branchSha, '-m', `Merge ${branchName} into ${targetBase}`],
            { cwd: repoRoot }
          );
          finalCommit = commitOut.trim();
          await execFileAsync('git', ['update-ref', `refs/heads/${targetBase}`, finalCommit], { cwd: repoRoot });
        } else {
          // Merge inside the worktree itself if programmatic commit tree was unavailable
          await execFileAsync('git', ['merge', '--no-ff', '-m', `Merge ${targetBase} into ${branchName}`, targetBase], { cwd: worktreePath });
          const { stdout: wtCommit } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath });
          finalCommit = wtCommit.trim();
          await execFileAsync('git', ['update-ref', `refs/heads/${targetBase}`, finalCommit], { cwd: repoRoot });
        }

        // Synchronize working tree to disk
        if (isGit) {
          // In a repository, checkout the merged tree so working files are updated
          try {
            await execFileAsync('git', ['checkout', '-f', targetBase], { cwd: repoRoot });
          } catch {
            try {
              await execFileAsync('git', ['read-tree', '-u', '-m', `refs/heads/${targetBase}`], { cwd: repoRoot });
            } catch {}
          }
        } else {
          // In a shadow repository (!isGit), checkout the merged branch in repoRoot before calling copyProjectAssets
          try {
            await execFileAsync('git', ['checkout', '-f', targetBase], { cwd: repoRoot });
          } catch {}
          this.copyProjectAssets(repoRoot, this.projectRoot);
        }

        // Post-merge prune: Remove the worktree immediately and delete feature branch
        await this.removeWorktree(worktreePath);
        await this.deleteBranch(branchName);

        return {
          success: true,
          cleanMerge: true,
          commitSha: finalCommit,
        };
      } catch (e: any) {
        return {
          success: false,
          cleanMerge: false,
          error: e.message,
        };
      }
    });
  }

  /**
   * Google Research Harness² Propose-Probe-Compose:
   * Provisions an ephemeral probe worktree, executes an isolated candidate action,
   * captures result/error, and safely prunes the worktree afterwards without leaking changes.
   */
  public async probeWorktree<T>(
    runId: string,
    candidateFn: (worktreePath: string) => Promise<T>
  ): Promise<{ success: boolean; result?: T; output?: T; error?: string }> {
    const probeSlug = `probe-${Date.now().toString(36)}`;
    let worktreePath = '';
    try {
      const provision = await this.provisionWorktree(runId, probeSlug);
      worktreePath = provision.worktreePath;
      const result = await candidateFn(worktreePath);
      return { success: true, result, output: result };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    } finally {
      if (worktreePath) {
        try {
          await this.removeWorktree(worktreePath);
          await this.deleteBranch(`feat/kin-${runId}-${probeSlug}`);
        } catch {}
      }
    }
  }

  /**
   * Safely deletes a git branch.
   */
  public async deleteBranch(branchName: string): Promise<void> {
    const isGit = await this.checkIsGitRepo(this.projectRoot);
    const repoRoot = isGit ? this.projectRoot : path.join(this.projectRoot, '.kin', '.git_shadow');
    try {
      await execFileAsync('git', ['branch', '-D', branchName], { cwd: repoRoot });
    } catch {
      // Branch may already be deleted or unreferenced
    }
  }

  /**
   * Post-merge prune: safely removes the worktree and prunes git metadata.
   */
  public async removeWorktree(worktreePath: string): Promise<void> {
    const isGit = await this.checkIsGitRepo(this.projectRoot);
    const repoRoot = isGit ? this.projectRoot : path.join(this.projectRoot, '.kin', '.git_shadow');
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
      });
      await execFileAsync('git', ['worktree', 'prune'], {
        cwd: repoRoot,
      });
    } catch {
      // If git worktree command failed (e.g. metadata was already unlinked), clean filesystem directly
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      try {
        await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot });
      } catch {
        // Ignored
      }
    }
  }

  private async checkIsGitRepo(dir: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
      return true;
    } catch {
      return false;
    }
  }

  private copyProjectAssets(sourceDir: string, targetDir: string): void {
    if (!fs.existsSync(sourceDir)) return;
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.kin' || entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      const srcPath = path.join(sourceDir, entry.name);
      const dstPath = path.join(targetDir, entry.name);
      try {
        if (entry.isDirectory()) {
          fs.mkdirSync(dstPath, { recursive: true });
          this.copyProjectAssets(srcPath, dstPath);
        } else if (entry.isFile()) {
          fs.copyFileSync(srcPath, dstPath);
        }
      } catch {}
    }
  }

  private async ensureShadowGitRepo(dir: string): Promise<string> {
    const shadowDir = path.join(dir, '.kin', '.git_shadow');
    if (!fs.existsSync(shadowDir)) {
      fs.mkdirSync(shadowDir, { recursive: true });
      await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: shadowDir });
      await execFileAsync('git', ['config', 'user.name', 'KIN Shadow'], { cwd: shadowDir });
      await execFileAsync('git', ['config', 'user.email', 'kin-shadow@local'], { cwd: shadowDir });
      this.copyProjectAssets(dir, shadowDir);
      await execFileAsync('git', ['add', '-A'], { cwd: shadowDir });
      await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial shadow commit with project assets'], { cwd: shadowDir });
    }
    return shadowDir;
  }
}
