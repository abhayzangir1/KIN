import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { WorkspaceTrustManager } from './workspace_trust.js';

const execFileAsync = promisify(execFile);

export type HookEventName = 'PreToolUse' | 'PostToolUse' | 'PreCompact' | 'Stop';

export interface HookRule {
  matcher?: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
}

export interface HookConfigFile {
  hooks?: Partial<Record<HookEventName, HookRule[]>>;
}

export interface HookExecutionResult {
  allowed: boolean;
  blockedBy?: string;
  reason?: string;
  outputs: Array<{ command: string; exitCode: number; stdout: string; stderr: string }>;
}

const MUTATING_OR_SHELL_TOOLS = new Set([
  'writefile',
  'write_file',
  'editfile',
  'edit_file',
  'executeshell',
  'execute_command',
  'shell',
  'execute',
  'terminal',
  'bash',
  'cmd',
  'run_command',
  'execute_code',
]);

/**
 * Deterministic command hook runner supporting global (~/.kin/hooks.json) and
 * Workspace-Trust-gated repository (.kin/hooks.json) lifecycle hooks.
 */
export class HookRegistry {
  private static instance: HookRegistry;
  private pluginHookFiles: Map<string, Set<string>> = new Map();

  private constructor() {}

  public static getInstance(): HookRegistry {
    if (!HookRegistry.instance) {
      HookRegistry.instance = new HookRegistry();
    }
    return HookRegistry.instance;
  }

  public registerPluginHooksFile(repoRoot: string, hooksFilePath: string): void {
    const root = path.resolve(repoRoot);
    let set = this.pluginHookFiles.get(root);
    if (!set) {
      set = new Set<string>();
      this.pluginHookFiles.set(root, set);
    }
    set.add(path.resolve(hooksFilePath));
  }

  public static isMutatingOrShellTool(toolName: string): boolean {
    return MUTATING_OR_SHELL_TOOLS.has(toolName.toLowerCase());
  }

  private loadHooksFile(filePath: string): Partial<Record<HookEventName, HookRule[]>> {
    try {
      if (!fs.existsSync(filePath)) return {};
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as HookConfigFile;
      return parsed?.hooks && typeof parsed.hooks === 'object' ? parsed.hooks : {};
    } catch (err) {
      console.warn(`[KIN HOOKS] Failed to parse hooks file '${filePath}':`, err);
      return {};
    }
  }

  public getHooksForEvent(event: HookEventName, repoRoot?: string): HookRule[] {
    const collected: HookRule[] = [];
    const globalHome = process.env.KIN_GLOBAL_CONFIG_DIR || process.env.USERPROFILE || process.env.HOME || os.homedir();
    const globalHooksPath = path.join(globalHome, '.kin', 'hooks.json');
    const globalHooks = this.loadHooksFile(globalHooksPath)[event];
    if (Array.isArray(globalHooks)) {
      collected.push(...globalHooks);
    }

    if (repoRoot) {
      const absRoot = path.resolve(repoRoot);
      const trust = WorkspaceTrustManager.getInstance().getTrustStatus(absRoot);
      const repoHooksPath = path.join(absRoot, '.kin', 'hooks.json');
      const extraFiles = Array.from(this.pluginHookFiles.get(absRoot) || []);
      const candidateFiles = Array.from(new Set([repoHooksPath, ...extraFiles]));
      for (const hookFile of candidateFiles) {
        if (fs.existsSync(hookFile)) {
          if (trust.trusted) {
            const repoHooks = this.loadHooksFile(hookFile)[event];
            if (Array.isArray(repoHooks)) {
              collected.push(...repoHooks);
            }
          } else {
            console.warn(`[KIN HOOKS] Quarantined untrusted repo hooks at '${hookFile}' (${trust.reason || 'untrusted'}).`);
          }
        }
      }
    }

    return collected.filter((r) => r && typeof r.command === 'string' && r.command.trim().length > 0);
  }

  private matchesTool(rule: HookRule, toolName?: string): boolean {
    if (!rule.matcher || !toolName) return true;
    try {
      const regex = new RegExp(rule.matcher, 'i');
      return regex.test(toolName);
    } catch {
      return rule.matcher.toLowerCase() === toolName.toLowerCase();
    }
  }

  public async runHooks(
    event: HookEventName,
    payload: {
      repoRoot?: string;
      toolName?: string;
      params?: Record<string, any>;
      result?: any;
      runId?: string;
      agentId?: string;
    }
  ): Promise<HookExecutionResult> {
    const rules = this.getHooksForEvent(event, payload.repoRoot).filter((r) =>
      event === 'PreToolUse' || event === 'PostToolUse' ? this.matchesTool(r, payload.toolName) : true
    );

    if (rules.length === 0) {
      return { allowed: true, outputs: [] };
    }

    const outputs: HookExecutionResult['outputs'] = [];
    const cwd = payload.repoRoot ? path.resolve(payload.repoRoot) : process.cwd();
    const stdinData = JSON.stringify({
      event,
      toolName: payload.toolName,
      params: payload.params,
      result: payload.result,
      runId: payload.runId,
      agentId: payload.agentId,
      repoRoot: cwd,
    });

    for (const rule of rules) {
      const timeoutMs = Math.min(Math.max(Number(rule.timeoutMs) || 5000, 200), 30000);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        KIN_HOOK_EVENT: event,
        KIN_TOOL_NAME: payload.toolName || '',
        KIN_WORKSPACE_ROOT: cwd,
        KIN_RUN_ID: payload.runId || '',
      };

      try {
        const execResult = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
          let cmd: string;
          let args: string[];
          if (Array.isArray(rule.args) && rule.args.length > 0) {
            cmd = rule.command;
            args = rule.args;
          } else if (process.platform === 'win32') {
            cmd = process.env.ComSpec || 'cmd.exe';
            args = ['/d', '/s', '/c', rule.command];
          } else {
            cmd = '/bin/sh';
            args = ['-c', rule.command];
          }

          const child = execFile(
            cmd,
            args,
            { cwd, env, timeout: timeoutMs, maxBuffer: 512 * 1024, windowsHide: true },
            (error, stdout, stderr) => {
              const code = error && typeof (error as any).code === 'number' ? (error as any).code : (error ? 1 : 0);
              resolve({ exitCode: code, stdout: String(stdout || ''), stderr: String(stderr || '') });
            }
          );

          if (child.stdin) {
            child.stdin.write(stdinData);
            child.stdin.end();
          }
        });

        outputs.push({
          command: rule.command,
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
        });

        // Exit code 2 is an explicit deterministic block
        if (execResult.exitCode === 2) {
          return {
            allowed: false,
            blockedBy: rule.command,
            reason: execResult.stderr.trim() || execResult.stdout.trim() || `Blocked by ${event} hook '${rule.command}' (exit 2).`,
            outputs,
          };
        }

        // JSON decision payload on exit 0 can also explicitly block
        if (execResult.exitCode === 0 && execResult.stdout.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(execResult.stdout.trim());
            if (parsed?.decision === 'block' || parsed?.decision === 'deny' || parsed?.continue === false) {
              return {
                allowed: false,
                blockedBy: rule.command,
                reason: parsed.reason || `Blocked by ${event} hook '${rule.command}'.`,
                outputs,
              };
            }
          } catch {
            // Non-JSON stdout on exit 0 is informational
          }
        }
      } catch (err: any) {
        outputs.push({
          command: rule.command,
          exitCode: 1,
          stdout: '',
          stderr: err?.message || String(err),
        });
      }
    }

    return { allowed: true, outputs };
  }
}

export { execFileAsync };
