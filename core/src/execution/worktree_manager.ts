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
      const { stdout } = await execFileAsync('git', ['diff', baseBranch], {
        cwd: worktreePath,
      });
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
   * Safely merges the feature branch into the target base branch in the root repo.
   */
  public async verifyAndMerge(worktreePath: string, branchName: string, baseBranch: string = 'main'): Promise<MergeResult> {
    try {
      // 1. Dry-run merge check via git merge-tree
      const { stdout: headSha } = await execFileAsync('git', ['rev-parse', baseBranch], { cwd: this.projectRoot });
      const { stdout: branchSha } = await execFileAsync('git', ['rev-parse', branchName], { cwd: this.projectRoot });

      try {
        await execFileAsync('git', ['merge-tree', headSha.trim(), branchSha.trim()], { cwd: this.projectRoot });
      } catch (conflictError: any) {
        return {
          success: false,
          cleanMerge: false,
          error: `Merge conflict detected: ${conflictError.message}`,
        };
      }

      // 2. Perform merge in root repo
      await execFileAsync('git', ['checkout', baseBranch], { cwd: this.projectRoot });
      await execFileAsync('git', ['merge', '--no-ff', '-m', `Merge ${branchName}`, branchName], {
        cwd: this.projectRoot,
      });

      const { stdout: finalCommit } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: this.projectRoot });

      // 3. Post-merge prune: Remove the worktree immediately
      await this.removeWorktree(worktreePath);

      return {
        success: true,
        cleanMerge: true,
        commitSha: finalCommit.trim(),
      };
    } catch (e: any) {
      return {
        success: false,
        cleanMerge: false,
        error: e.message,
      };
    }
  }

  /**
   * Post-merge prune: safely removes the worktree and prunes git metadata.
   */
  public async removeWorktree(worktreePath: string): Promise<void> {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: this.projectRoot,
      });
      await execFileAsync('git', ['worktree', 'prune'], {
        cwd: this.projectRoot,
      });
    } catch {
      // If git worktree command failed (e.g. metadata was already unlinked), clean filesystem directly
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      try {
        await execFileAsync('git', ['worktree', 'prune'], { cwd: this.projectRoot });
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

  private async ensureShadowGitRepo(dir: string): Promise<string> {
    const shadowDir = path.join(dir, '.kin', '.git_shadow');
    if (!fs.existsSync(shadowDir)) {
      fs.mkdirSync(shadowDir, { recursive: true });
      await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: shadowDir });
      await execFileAsync('git', ['config', 'user.name', 'KIN Shadow'], { cwd: shadowDir });
      await execFileAsync('git', ['config', 'user.email', 'kin-shadow@local'], { cwd: shadowDir });
      // Create empty initial commit
      await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial shadow commit'], { cwd: shadowDir });
    }
    return shadowDir;
  }
}
