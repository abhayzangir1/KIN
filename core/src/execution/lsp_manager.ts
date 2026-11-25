import { spawn, ChildProcess, execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { HardwareProfiler } from '../evaluation/hardware_profiler.js';

const execFileAsync = promisify(execFile);

export interface LspDiagnostic {
  line: number;
  character: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

export interface LspFileCheckResult {
  available: boolean;
  reason?: string;
  languageId?: string;
  diagnostics: LspDiagnostic[];
}

interface LspServerSpec {
  languageId: string;
  command: string;
  args: string[];
}

interface ActiveLspServer {
  key: string;
  spec: LspServerSpec;
  rootPath: string;
  process: ChildProcess;
  nextId: number;
  lastUsedAt: number;
  initialized: boolean;
  buffer: Buffer;
  pendingRequests: Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>;
  diagnosticsByUri: Map<string, LspDiagnostic[]>;
  diagnosticWaiters: Map<string, Array<(diags: LspDiagnostic[]) => void>>;
  openVersions: Map<string, number>;
}

const MIN_FREE_MEM_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
const MAX_CONCURRENT_SERVERS = 2;
const IDLE_TIMEOUT_MS = 180_000;

/**
 * Hardware-gated, opportunistic LSP client manager.
 * Disabled by default on baseline_laptop tier, skips when free RAM < 1.5 GB,
 * caps concurrent servers at 2, and reaps idle servers after 180s.
 */
export class LspManager {
  private static instance: LspManager;
  private servers: Map<string, ActiveLspServer> = new Map();
  private binaryCache: Map<string, boolean> = new Map();
  private reaperTimer?: NodeJS.Timeout;

  private constructor() {}

  public static getInstance(): LspManager {
    if (!LspManager.instance) {
      LspManager.instance = new LspManager();
    }
    return LspManager.instance;
  }

  public static getSpecForFile(filePath: string): LspServerSpec | null {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
        return { languageId: ext === '.tsx' ? 'typescriptreact' : 'typescript', command: 'typescript-language-server', args: ['--stdio'] };
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return { languageId: ext === '.jsx' ? 'javascriptreact' : 'javascript', command: 'typescript-language-server', args: ['--stdio'] };
      case '.py':
        return { languageId: 'python', command: 'pyright-langserver', args: ['--stdio'] };
      case '.rs':
        return { languageId: 'rust', command: 'rust-analyzer', args: [] };
      case '.go':
        return { languageId: 'go', command: 'gopls', args: [] };
      default:
        return null;
    }
  }

  public checkHardwareEligibility(forceEnable: boolean = false): { eligible: boolean; reason?: string } {
    if (process.env.KIN_DISABLE_LSP === '1') {
      return { eligible: false, reason: 'LSP disabled by KIN_DISABLE_LSP=1' };
    }
    if (!forceEnable && process.env.KIN_ENABLE_LSP !== '1') {
      try {
        const profiler = new HardwareProfiler();
        const tier = profiler.classifyTier(profiler.detectHostHardware());
        if (tier === 'baseline_laptop') {
          return { eligible: false, reason: 'LSP disabled by default on baseline_laptop hardware tier' };
        }
      } catch {
        // Fallback to RAM check below
      }
    }
    const freeMem = os.freemem();
    if (freeMem < MIN_FREE_MEM_BYTES) {
      return {
        eligible: false,
        reason: `Insufficient free RAM for LSP (${Math.round(freeMem / (1024 * 1024))} MB < 1536 MB)`,
      };
    }
    return { eligible: true };
  }

  private async isBinaryAvailable(command: string): Promise<boolean> {
    if (this.binaryCache.has(command)) {
      return this.binaryCache.get(command)!;
    }
    try {
      const locator = process.platform === 'win32' ? 'where' : 'which';
      await execFileAsync(locator, [command], { timeout: 2000, windowsHide: true });
      this.binaryCache.set(command, true);
      return true;
    } catch {
      this.binaryCache.set(command, false);
      return false;
    }
  }

  private startReaper(): void {
    if (this.reaperTimer) return;
    this.reaperTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, srv] of this.servers.entries()) {
        if (now - srv.lastUsedAt > IDLE_TIMEOUT_MS) {
          this.stopServer(key);
        }
      }
      if (this.servers.size === 0 && this.reaperTimer) {
        clearInterval(this.reaperTimer);
        this.reaperTimer = undefined;
      }
    }, 30_000);
    if (typeof this.reaperTimer.unref === 'function') {
      this.reaperTimer.unref();
    }
  }

  private evictOldestIfNeeded(): void {
    while (this.servers.size >= MAX_CONCURRENT_SERVERS) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [k, s] of this.servers.entries()) {
        if (s.lastUsedAt < oldestTime) {
          oldestTime = s.lastUsedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        this.stopServer(oldestKey);
      } else {
        break;
      }
    }
  }

  public stopServer(key: string): void {
    const srv = this.servers.get(key);
    if (!srv) return;
    this.servers.delete(key);
    for (const pending of srv.pendingRequests.values()) {
      pending.reject(new Error('LSP server stopped'));
    }
    srv.pendingRequests.clear();
    try {
      srv.process.kill('SIGTERM');
    } catch {
      // Ignore already exited
    }
  }

  public shutdown(): void {
    for (const key of Array.from(this.servers.keys())) {
      this.stopServer(key);
    }
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = undefined;
    }
  }

  private writeLspMessage(srv: ActiveLspServer, payload: Record<string, any>): void {
    if (!srv.process.stdin || srv.process.killed) return;
    const json = JSON.stringify(payload);
    const body = Buffer.from(json, 'utf-8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
    srv.process.stdin.write(Buffer.concat([header, body]));
  }

  private handleStdoutData(srv: ActiveLspServer, chunk: Buffer): void {
    srv.buffer = Buffer.concat([srv.buffer, chunk]);
    while (true) {
      const headerEnd = srv.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const headerStr = srv.buffer.slice(0, headerEnd).toString('ascii');
      const match = headerStr.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        srv.buffer = srv.buffer.slice(headerEnd + 4);
        continue;
      }
      const contentLen = parseInt(match[1], 10);
      const totalLen = headerEnd + 4 + contentLen;
      if (srv.buffer.length < totalLen) break;

      const bodyStr = srv.buffer.slice(headerEnd + 4, totalLen).toString('utf-8');
      srv.buffer = srv.buffer.slice(totalLen);

      try {
        const msg = JSON.parse(bodyStr);
        if (msg.id !== undefined && srv.pendingRequests.has(msg.id)) {
          const p = srv.pendingRequests.get(msg.id)!;
          srv.pendingRequests.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || 'LSP error'));
          else p.resolve(msg.result);
        } else if (msg.method === 'textDocument/publishDiagnostics' && msg.params?.uri) {
          const uri = String(msg.params.uri);
          const rawDiags = Array.isArray(msg.params.diagnostics) ? msg.params.diagnostics : [];
          const mapped: LspDiagnostic[] = rawDiags.slice(0, 25).map((d: any) => ({
            line: (d.range?.start?.line ?? 0) + 1,
            character: (d.range?.start?.character ?? 0) + 1,
            severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : d.severity === 3 ? 'info' : 'hint',
            message: String(d.message || ''),
            source: d.source ? String(d.source) : undefined,
          }));
          srv.diagnosticsByUri.set(uri, mapped);
          const waiters = srv.diagnosticWaiters.get(uri);
          if (waiters) {
            srv.diagnosticWaiters.delete(uri);
            for (const w of waiters) w(mapped);
          }
        }
      } catch {
        // Ignore malformed frame
      }
    }
  }

  private sendRequest(srv: ActiveLspServer, method: string, params: any, timeoutMs = 4000): Promise<any> {
    const id = srv.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        srv.pendingRequests.delete(id);
        reject(new Error(`LSP request '${method}' timed out`));
      }, timeoutMs);
      srv.pendingRequests.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.writeLspMessage(srv, { jsonrpc: '2.0', id, method, params });
    });
  }

  private async ensureServer(spec: LspServerSpec, rootPath: string): Promise<ActiveLspServer | null> {
    const absRoot = path.resolve(rootPath);
    const key = `${spec.command}:${absRoot}`;
    const existing = this.servers.get(key);
    if (existing && !existing.process.killed) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    const available = await this.isBinaryAvailable(spec.command);
    if (!available) return null;

    this.evictOldestIfNeeded();

    const child = spawn(spec.command, spec.args, {
      cwd: absRoot,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });

    const srv: ActiveLspServer = {
      key,
      spec,
      rootPath: absRoot,
      process: child,
      nextId: 1,
      lastUsedAt: Date.now(),
      initialized: false,
      buffer: Buffer.alloc(0),
      pendingRequests: new Map(),
      diagnosticsByUri: new Map(),
      diagnosticWaiters: new Map(),
      openVersions: new Map(),
    };

    child.stdout?.on('data', (chunk: Buffer) => this.handleStdoutData(srv, chunk));
    child.on('exit', () => {
      if (this.servers.get(key) === srv) {
        this.servers.delete(key);
      }
    });

    this.servers.set(key, srv);
    this.startReaper();

    try {
      await this.sendRequest(srv, 'initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(absRoot).href,
        capabilities: {
          textDocument: {
            publishDiagnostics: { relatedInformation: false },
          },
        },
      });
      this.writeLspMessage(srv, { jsonrpc: '2.0', method: 'initialized', params: {} });
      srv.initialized = true;
      return srv;
    } catch {
      this.stopServer(key);
      return null;
    }
  }

  public async getDiagnosticsForFile(
    filePath: string,
    workspaceRoot: string,
    options?: { forceEnable?: boolean; waitMs?: number }
  ): Promise<LspFileCheckResult> {
    const elig = this.checkHardwareEligibility(options?.forceEnable);
    if (!elig.eligible) {
      return { available: false, reason: elig.reason, diagnostics: [] };
    }

    const spec = LspManager.getSpecForFile(filePath);
    if (!spec) {
      return { available: false, reason: 'No LSP server configured for file extension', diagnostics: [] };
    }

    const absFile = path.resolve(filePath);
    if (!fs.existsSync(absFile)) {
      return { available: false, reason: 'File does not exist on disk', languageId: spec.languageId, diagnostics: [] };
    }

    const srv = await this.ensureServer(spec, workspaceRoot);
    if (!srv) {
      return { available: false, reason: `Language server '${spec.command}' not installed`, languageId: spec.languageId, diagnostics: [] };
    }

    srv.lastUsedAt = Date.now();
    const uri = pathToFileURL(absFile).href;
    const text = fs.readFileSync(absFile, 'utf-8');
    const prevVersion = srv.openVersions.get(uri);

    const waitMs = Math.min(Math.max(options?.waitMs ?? 1200, 100), 3000);
    const diagPromise = new Promise<LspDiagnostic[]>((resolve) => {
      const timer = setTimeout(() => {
        resolve(srv.diagnosticsByUri.get(uri) || []);
      }, waitMs);
      const list = srv.diagnosticWaiters.get(uri) || [];
      list.push((diags) => {
        clearTimeout(timer);
        resolve(diags);
      });
      srv.diagnosticWaiters.set(uri, list);
    });

    if (prevVersion === undefined) {
      srv.openVersions.set(uri, 1);
      this.writeLspMessage(srv, {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: { uri, languageId: spec.languageId, version: 1, text },
        },
      });
    } else {
      const nextVer = prevVersion + 1;
      srv.openVersions.set(uri, nextVer);
      this.writeLspMessage(srv, {
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri, version: nextVer },
          contentChanges: [{ text }],
        },
      });
    }

    const diagnostics = await diagPromise;
    return {
      available: true,
      languageId: spec.languageId,
      diagnostics,
    };
  }
}
