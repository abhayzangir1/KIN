// ============================================================================
// KIN TOOL GATEWAY
// Central tool execution gateway with capability checks, risk classification,
// worktree jail confinement, and exponential retry for Windows file locks.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { AutonomyMode, RiskLevel } from '../domain/types.js';

export interface ToolExecutionContext {
  runId: string;
  agentId: string;
  worktreeRoot: string;
  autonomyMode: AutonomyMode;
  allowedCapabilities: string[];
  subagentWhitelist?: {
    permittedPaths?: string[];
    permittedCommands?: string[];
  };
}

export interface ToolInvocationResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
  requiresApproval?: boolean;
  riskLevel: RiskLevel;
}

export class ToolGateway {
  /**
   * Dispatches and executes a tool call through security and autonomy checks.
   */
  public async executeTool<T = unknown>(
    toolName: string,
    params: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolInvocationResult<T>> {
    const risk = this.classifyRisk(toolName, params);

    // 1. Evaluate Autonomy Mode & Risk Gate
    const approvalRequired = this.checkApprovalRequired(risk, context);
    if (approvalRequired) {
      return {
        success: false,
        requiresApproval: true,
        riskLevel: risk,
        error: `Action '${toolName}' classified as ${risk} risk requires interactive human approval under ${context.autonomyMode} mode.`,
      };
    }

    // 2. Route to native execution handlers
    try {
      switch (toolName) {
        case 'readFile': {
          const content = await this.handleReadFile(params.path, context.worktreeRoot);
          return { success: true, output: content as T, riskLevel: risk };
        }

        case 'writeFile': {
          await this.handleWriteFile(params.path, params.content, context.worktreeRoot);
          return { success: true, output: { bytesWritten: Buffer.byteLength(params.content, 'utf-8') } as T, riskLevel: risk };
        }

        case 'listDirectory': {
          const entries = await this.handleListDirectory(params.path || '.', context.worktreeRoot);
          return { success: true, output: entries as T, riskLevel: risk };
        }

        case 'executeShell': {
          const shellResult = await this.handleExecuteShell(params.command, context.worktreeRoot, params.timeoutMs ?? 120000);
          return { success: true, output: shellResult as T, riskLevel: risk };
        }

        default:
          return {
            success: false,
            riskLevel: risk,
            error: `Unknown tool '${toolName}'.`,
          };
      }
    } catch (e: any) {
      return {
        success: false,
        riskLevel: risk,
        error: e.message,
      };
    }
  }

  public classifyRisk(toolName: string, params: Record<string, any>): RiskLevel {
    if (toolName === 'readFile' || toolName === 'listDirectory') {
      return 'LOW';
    }

    if (toolName === 'writeFile') {
      // Writing inside worktree is Medium risk
      return 'MEDIUM';
    }

    if (toolName === 'executeShell') {
      const cmd = (params.command || '').toLowerCase();
      // Destructive, system, or package operations are HIGH/CRITICAL
      if (
        cmd.includes('rm -rf') ||
        cmd.includes('remove-item') ||
        cmd.includes('npm install') ||
        cmd.includes('pip install') ||
        cmd.includes('drop table') ||
        cmd.includes('format') ||
        cmd.includes('curl ') ||
        cmd.includes('wget ')
      ) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    return 'MEDIUM';
  }

  public checkApprovalRequired(risk: RiskLevel, context: ToolExecutionContext): boolean {
    if (context.autonomyMode === 'FULL_ACCESS') {
      // Full access bypasses interactive prompts, but OS boundaries still hold
      return false;
    }

    if (context.autonomyMode === 'ALWAYS_ASK') {
      // Always ask for any state modification
      return risk !== 'LOW';
    }

    // AUTO mode: Auto-approves LOW and MEDIUM (safe/reversible in worktree), prompts on HIGH/CRITICAL
    if (context.autonomyMode === 'AUTO') {
      return risk === 'HIGH' || risk === 'CRITICAL';
    }

    return true;
  }

  /**
   * Validates that target path stays strictly inside worktreeRoot.
   */
  public resolveJailedPath(targetPath: string, worktreeRoot: string): string {
    const root = path.resolve(worktreeRoot);
    const resolved = path.resolve(root, targetPath);

    if (!resolved.startsWith(root)) {
      throw new Error(
        `SECURITY JAIL VIOLATION: Path '${targetPath}' escapes worktree root '${worktreeRoot}'`
      );
    }

    return resolved;
  }

  private async handleReadFile(filePath: string, worktreeRoot: string): Promise<string> {
    const target = this.resolveJailedPath(filePath, worktreeRoot);
    if (!fs.existsSync(target)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(target, 'utf-8');
  }

  /**
   * Writes file with exponential retry to handle Windows file lock delays (antivirus / search indexers).
   */
  private async handleWriteFile(filePath: string, content: string, worktreeRoot: string): Promise<void> {
    const target = this.resolveJailedPath(filePath, worktreeRoot);
    const dir = path.dirname(target);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let attempts = 0;
    const maxAttempts = 3;
    const delays = [50, 150, 300];

    while (attempts < maxAttempts) {
      try {
        fs.writeFileSync(target, content, 'utf-8');
        return;
      } catch (err: any) {
        attempts++;
        if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempts - 1]));
        } else {
          throw new Error(`Failed to write file '${filePath}': ${err.message}`);
        }
      }
    }
  }

  private async handleListDirectory(dirPath: string, worktreeRoot: string): Promise<string[]> {
    const target = this.resolveJailedPath(dirPath, worktreeRoot);
    if (!fs.existsSync(target)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    return fs.readdirSync(target);
  }

  private handleExecuteShell(command: string, worktreeRoot: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = exec(
        command,
        {
          cwd: worktreeRoot,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB max buffer
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error && error.killed) {
            return reject(new Error(`Shell execution timed out after ${timeoutMs}ms: ${command}`));
          }

          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: error ? error.code ?? 1 : 0,
          });
        }
      );
    });
  }
}
