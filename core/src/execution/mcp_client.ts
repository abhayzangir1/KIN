// ============================================================================
// KIN MODEL CONTEXT PROTOCOL (MCP) CLIENT ADAPTER
// Standard JSON-RPC 2.0 transport over stdio for external MCP servers.
// Dynamically discovers tools and registers them into ToolGateway.
// ============================================================================

import { spawn, exec, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: 'stdio' | 'http';
  disabled?: boolean;
}

export interface McpConnectorItem {
  name: string;
  scope: 'global' | 'project';
  configPath: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport: 'stdio' | 'http';
  disabled: boolean;
  status: 'active' | 'stopped' | 'error';
  overridden?: boolean;
  toolsCount: number;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, any>;
  }> | string[];
  error?: string;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
  serverName: string;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
}

export interface ActiveMcpServerEntry {
  process?: ChildProcess;
  url?: string;
  postUrl?: string;
  sseController?: AbortController;
  transport: 'stdio' | 'http';
  tools: McpToolDefinition[];
}

interface PendingRequestEntry {
  serverName: string;
  timeout: NodeJS.Timeout;
  resolve: (res: any) => void;
  reject: (err: any) => void;
  proc?: ChildProcess;
}

export class McpClientManager {
  private activeServers: Map<string, ActiveMcpServerEntry> = new Map();
  private pendingRequests: Map<string | number, PendingRequestEntry> = new Map();
  private inFlightHandshakes: Map<string, Promise<McpToolDefinition[]>> = new Map();
  private lastServerErrors: Map<string, string> = new Map();
  private requestIdCounter = 1;
  private projectRoot: string;

  constructor(projectRootOrOptions: string | { projectRoot?: string } = process.cwd()) {
    const root = typeof projectRootOrOptions === 'string'
      ? projectRootOrOptions
      : (projectRootOrOptions?.projectRoot || process.cwd());
    this.projectRoot = path.resolve(root);
  }

  public setProjectRoot(projectRoot: string): void {
    this.projectRoot = path.resolve(projectRoot);
  }

  public getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Constructs a sanitized environment for MCP subprocesses, stripping host secrets.
   */
  public static sanitizeMcpEnv(configEnv?: Record<string, string>): Record<string, string> {
    const safeSystemKeys = [
      'PATH', 'Path', 'path',
      'HOME', 'USERPROFILE',
      'TEMP', 'TMP',
      'SYSTEMROOT', 'SystemRoot',
      'SystemDrive', 'windir',
      'USER', 'LOGNAME',
      'COMSPEC', 'SHELL',
      'TERM', 'LANG', 'LC_ALL',
      'APPDATA', 'LOCALAPPDATA',
      'HOMEDRIVE', 'HOMEPATH',
      'ProgramData', 'ALLUSERSPROFILE',
      'NODE_PATH',
      'XDG_DATA_HOME', 'XDG_CONFIG_HOME'
    ];
    const safeEnv: Record<string, string> = {};
    for (const key of safeSystemKeys) {
      if (process.env[key] !== undefined) {
        safeEnv[key] = process.env[key]!;
      }
    }
    if (process.platform === 'win32') {
      const comspec = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\system32\\cmd.exe';
      safeEnv['ComSpec'] = comspec;
      safeEnv['COMSPEC'] = comspec;
      const sysRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
      safeEnv['SystemRoot'] = sysRoot;
      safeEnv['SYSTEMROOT'] = sysRoot;
      safeEnv['windir'] = process.env.windir || sysRoot;
    }
    const cleanEnv: Record<string, string> = { ...safeEnv, ...(configEnv || {}) };
    const dangerousEnvKeys = new Set([
      'node_options', 'pythonpath', 'pythonhome', 'ld_preload', 'ld_library_path',
      'dyld_insert_libraries', 'dyld_library_path', 'bash_env', 'env', 'prompt_command',
      'perl5lib', 'rubyopt', 'kin_ipc_token', 'kin_vault_key'
    ]);
    for (const key of Object.keys(cleanEnv)) {
      if (dangerousEnvKeys.has(key.toLowerCase())) {
        delete cleanEnv[key];
        continue;
      }
      if (/api_key|secret|token|kin_/i.test(key)) {
        if (!configEnv || !(key in configEnv)) {
          delete cleanEnv[key];
        }
      }
    }
    return cleanEnv;
  }

  private static fileLocks: Map<string, Promise<any>> = new Map();

  /**
   * Serializes read-modify-write operations per config file path to prevent race conditions.
   */
  public static async withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = path.resolve(filePath);
    const prevLock = McpClientManager.fileLocks.get(key) || Promise.resolve();
    let releaseLock: () => void;
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    McpClientManager.fileLocks.set(key, prevLock.then(() => nextLock, () => nextLock));
    await prevLock;
    try {
      return await fn();
    } finally {
      releaseLock!();
    }
  }

  /**
   * Atomically writes JSON content using a temporary file and rename.
   */
  public static atomicWriteJson(filePath: string, data: any): void {
    const serialized = JSON.stringify(data, null, 2);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      fs.writeFileSync(tempPath, serialized, 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch {
      // Fallback if atomic rename is locked or fails on Windows
      fs.writeFileSync(filePath, serialized, 'utf-8');
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
    }
  }

  /**
   * Parses an MCP config file, detecting whether it uses array format, 'servers' format, or 'mcpServers' format.
   */
  public static parseConfigFile(configPath: string): {
    format: 'array' | 'servers' | 'mcpServers';
    data: any;
  } {
    if (!fs.existsSync(configPath)) {
      return { format: 'mcpServers', data: { mcpServers: {} } };
    }
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return { format: 'array', data: parsed };
      }
      if (parsed && typeof parsed === 'object') {
        if (parsed.servers && !parsed.mcpServers) {
          return { format: 'servers', data: parsed };
        }
        if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
          parsed.mcpServers = {};
        }
        return { format: 'mcpServers', data: parsed };
      }
    } catch {
      // malformed or corrupted JSON falls back to fresh mcpServers structure
    }
    return { format: 'mcpServers', data: { mcpServers: {} } };
  }

  /**
   * Finds a connector key case-insensitively within a dictionary.
   */
  public static findConnectorKeyCaseInsensitive(obj: Record<string, any>, name: string): string | undefined {
    if (!obj || typeof obj !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, name)) return name;
    const lower = name.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower) return k;
    }
    return undefined;
  }

  /**
   * Resolves paths with ~, ${projectRoot}, ${workspaceFolder}, and ${userHome} placeholders.
   */
  public resolveConfigPath(val: string, customRoot?: string): string {
    if (!val || typeof val !== 'string') return val;
    const userHome = process.env.KIN_GLOBAL_CONFIG_DIR || process.env.USERPROFILE || process.env.HOME || os.homedir();
    const targetRoot = customRoot ? path.resolve(customRoot) : this.projectRoot;
    let res = val.trim();
    if (res === '~') {
      res = userHome;
    } else if (res.startsWith('~/') || res.startsWith('~\\')) {
      res = path.join(userHome, res.slice(2));
    }
    res = res.replace(/\$\{projectRoot\}|\$\{workspaceFolder\}/g, targetRoot);
    res = res.replace(/\$\{userHome\}/g, userHome);
    res = res.replace(/~(?=[/\\])/g, userHome);
    return res;
  }

  /**
   * Resolves an active MCP server entry by exact name or normalized (case-insensitive, hyphens/underscores).
   */
  public getServerEntry(name: string): { entry: ActiveMcpServerEntry; actualName: string } | undefined {
    if (this.activeServers.has(name)) {
      return { entry: this.activeServers.get(name)!, actualName: name };
    }
    const normalized = name.toLowerCase().replace(/[-_\s]/g, '');
    for (const [k, v] of this.activeServers.entries()) {
      if (k.toLowerCase().replace(/[-_\s]/g, '') === normalized) {
        return { entry: v, actualName: k };
      }
    }
    return undefined;
  }

  /**
   * Loads configured MCP servers from user-level global and project-level configs.
   * Global connectors (~/.kin/mcp.json) persist across all projects.
   * Project-level configs (.kin/mcp.json) can add project-specific connectors or override globals.
   */
  public async loadConfiguredServers(customRoot?: string): Promise<McpToolDefinition[]> {
    McpClientManager.ensureStandardConnectorsServer();
    const root = customRoot ? path.resolve(customRoot) : this.projectRoot;
    const userHome = process.env.KIN_GLOBAL_CONFIG_DIR || process.env.USERPROFILE || process.env.HOME || os.homedir();
    // Candidate paths listed in priority order from lowest to highest:
    // Global user configs are loaded first; project-level configs override later.
    const isIsolatedInTest = process.env.KIN_ISOLATE_GLOBAL_MCP === 'true' &&
      !process.env.KIN_GLOBAL_CONFIG_DIR &&
      (process.env.USERPROFILE === undefined || process.env.USERPROFILE === os.homedir());

    const rawCandidatePaths = [
      ...(isIsolatedInTest ? [] : [
        // 1. Global user-level MCP configuration (persists across all projects, like Claude Code & Cursor)
        path.join(userHome, '.kin', 'mcp_servers.json'),
        path.join(userHome, '.kin', 'mcp.json'),
      ]),
      // 2. Project-level MCP configuration
      path.join(root, 'mcp.json'),
      path.join(root, '.kin', 'mcp_servers.json'),
      path.join(root, '.kin', 'mcp.json'),
    ];

    // Deduplicate paths in case projectRoot is the user home directory
    const candidatePaths = Array.from(new Set(rawCandidatePaths.map(p => path.resolve(p))));
    const serverMap = new Map<string, McpServerConfig>();

    const deleteCaseInsensitive = (name: string) => {
      const lower = name.toLowerCase();
      for (const k of Array.from(serverMap.keys())) {
        if (k.toLowerCase() === lower) {
          serverMap.delete(k);
        }
      }
    };

    const setCaseInsensitive = (conf: McpServerConfig) => {
      deleteCaseInsensitive(conf.name);
      serverMap.set(conf.name, conf);
    };

    for (const configPath of candidatePaths) {
      if (!fs.existsSync(configPath)) continue;

      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const serverSources = parsed.mcpServers || parsed.servers || {};

        if (Array.isArray(parsed)) {
          for (const s of parsed) {
            if (s.disabled === true || s.enabled === false) {
              if (s.name) deleteCaseInsensitive(s.name);
              continue;
            }
            if (s.name && (s.command || s.url)) {
              setCaseInsensitive({
                name: s.name,
                command: s.command,
                url: s.url,
                transport: s.transport || (s.url ? 'http' : 'stdio'),
                args: s.args || [],
                env: s.env || {},
              });
            }
          }
        } else if (typeof serverSources === 'object' && serverSources !== null) {
          for (const [name, conf] of Object.entries(serverSources)) {
            const serverConfig = conf as any;
            if (serverConfig?.disabled === true || serverConfig?.enabled === false) {
              deleteCaseInsensitive(name);
              continue;
            }
            if (serverConfig?.command || serverConfig?.url) {
              setCaseInsensitive({
                name,
                command: serverConfig.command,
                url: serverConfig.url,
                transport: serverConfig.transport || (serverConfig.url ? 'http' : 'stdio'),
                args: serverConfig.args || [],
                env: serverConfig.env || {},
              });
            }
          }
        }
      } catch (err) {
        console.error(`[KIN MCP] Failed to read ${configPath}:`, err);
      }
    }

    // Stop any active servers that are no longer configured or became disabled
    for (const name of Array.from(this.activeServers.keys())) {
      const lower = name.toLowerCase();
      const stillConfigured = Array.from(serverMap.keys()).some(k => k.toLowerCase() === lower);
      if (!stillConfigured) {
        this.stopServer(name);
      }
    }

    if (serverMap.size === 0) {
      return [];
    }

    const allTools: McpToolDefinition[] = [];
    for (const s of serverMap.values()) {
      try {
        const tools = await this.startServer(s, root);
        allTools.push(...tools);
      } catch (err) {
        console.error(`[KIN MCP] Failed to start server ${s.name}:`, err);
      }
    }
    return allTools;
  }

  /**
   * Alias for loadConfiguredServers.
   */
  public async loadServersFromConfig(customRoot?: string): Promise<McpToolDefinition[]> {
    return this.loadConfiguredServers(customRoot);
  }

  /**
   * Switches project root, shutting down previous MCP servers and loading new ones.
   */
  public async reloadProject(projectRoot: string, force: boolean = false): Promise<McpToolDefinition[]> {
    const target = path.resolve(projectRoot);
    if (!force && this.projectRoot === target && this.activeServers.size > 0) {
      const activeTools = this.getAllTools();
      if (activeTools.length > 0) {
        return activeTools;
      }
    }
    this.shutdown();
    this.setProjectRoot(target);
    return await this.loadConfiguredServers();
  }

  /**
   * Spawns an MCP server, handles supervision lifecycle, and queries tools/list.
   */
  /**
   * Spawns an MCP server, handles supervision lifecycle, and queries tools/list.
   */
  private async queryAllTools(serverName: string): Promise<McpToolDefinition[]> {
    const tools: McpToolDefinition[] = [];
    let nextCursor: string | undefined = undefined;
    do {
      const params = nextCursor ? { cursor: nextCursor } : {};
      const listRes = await this.sendRequest(serverName, 'tools/list', params, 30000);
      const rawTools = listRes?.tools || [];
      for (const t of rawTools) {
        tools.push({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema || { type: 'object', properties: {} },
          serverName,
        });
      }
      nextCursor = listRes?.nextCursor;
    } while (nextCursor);
    return tools;
  }

  private sendJsonRpcResponse(serverName: string, id: string | number, result: any): void {
    const found = this.getServerEntry(serverName);
    if (!found) return;
    const { entry, actualName } = found;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
    if (entry.transport === 'http' && (entry.postUrl || entry.url)) {
      fetch(entry.postUrl || entry.url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch((err) => {
        console.warn(`[KIN MCP] Failed to send JSON-RPC response to '${actualName}':`, err);
      });
      return;
    }
    if (entry.process?.stdin) {
      try {
        entry.process.stdin.write(payload + '\n');
      } catch (err) {
        console.warn(`[KIN MCP] Failed to send JSON-RPC response to '${actualName}':`, err);
      }
    }
  }

  private handleIncomingJsonRpcMessage(serverName: string, rawJson: string): void {
    try {
      const json = JSON.parse(rawJson);
      // 1. Server-initiated request (ping, roots/list)
      if (json.method) {
        if (json.method === 'ping' && json.id !== undefined && json.id !== null) {
          this.sendJsonRpcResponse(serverName, json.id, {});
        } else if (json.method === 'roots/list' && json.id !== undefined && json.id !== null) {
          const rootUri = pathToFileURL(this.projectRoot).toString();
          this.sendJsonRpcResponse(serverName, json.id, {
            roots: [{ uri: rootUri, name: path.basename(this.projectRoot) }],
          });
        }
      }

      // 2. Response to pending client request
      if (json.id !== undefined && json.id !== null) {
        const req = this.pendingRequests.get(json.id) ??
          this.pendingRequests.get(Number(json.id)) ??
          this.pendingRequests.get(String(json.id));
        if (req) {
          clearTimeout(req.timeout);
          this.pendingRequests.delete(json.id);
          this.pendingRequests.delete(Number(json.id));
          this.pendingRequests.delete(String(json.id));
          if (json.error) {
            req.reject(new Error(json.error.message || 'JSON-RPC Error'));
          } else {
            req.resolve(json.result);
          }
        }
      }
    } catch {}
  }

  private async connectSseIfSupported(serverName: string, url: string): Promise<boolean> {
    const entry = this.activeServers.get(serverName);
    if (!entry) return false;

    const sseController = new AbortController();
    const probeTimeout = AbortSignal.timeout(1500);
    const probeSignal = (AbortSignal as any).any ? (AbortSignal as any).any([sseController.signal, probeTimeout]) : sseController.signal;
    try {
      const sseProbe = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: probeSignal,
      });

      const contentType = sseProbe.headers.get('content-type') || '';
      if (!sseProbe.ok || !contentType.includes('text/event-stream') || !sseProbe.body) {
        sseController.abort();
        return false;
      }

      entry.sseController = sseController;
      const reader = sseProbe.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let sseBuffer = '';
      let isEndpointDispatched = false;
      let resolveEndpoint: (postUrl: string) => void = () => {};
      const endpointPromise = new Promise<string>((resolve) => {
        resolveEndpoint = resolve;
      });

      (async () => {
        let currentEventType = 'message';
        let currentData = '';
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) {
                if (currentEventType === 'endpoint' && currentData) {
                  try {
                    const resolvedPostUrl = new URL(currentData.trim(), url).toString();
                    entry.postUrl = resolvedPostUrl;
                    if (!isEndpointDispatched) {
                      isEndpointDispatched = true;
                      resolveEndpoint(resolvedPostUrl);
                    }
                  } catch {
                    entry.postUrl = currentData.trim();
                  }
                } else if (currentEventType === 'message' && currentData) {
                  this.handleIncomingJsonRpcMessage(serverName, currentData);
                }
                currentEventType = 'message';
                currentData = '';
                continue;
              }

              if (line.startsWith(':')) {
                // Keep-alive heartbeat comment
                continue;
              }

              if (line.startsWith('event:')) {
                currentEventType = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                const chunk = line.slice(5).trim();
                currentData = currentData ? currentData + '\n' + chunk : chunk;
              }
            }
          }
        } catch {
          // Stream completed or aborted
        } finally {
          if (!isEndpointDispatched) {
            isEndpointDispatched = true;
            resolveEndpoint(url);
          }
        }
      })();

      const postUrl = await Promise.race([
        endpointPromise,
        new Promise<string>((resolve) => setTimeout(() => resolve(url), 3000)),
      ]);
      entry.postUrl = postUrl;
      return true;
    } catch {
      sseController.abort();
      return false;
    }
  }

  /**
   * Spawns an MCP server, handles supervision lifecycle, and queries tools/list.
   */
  public async startServer(config: McpServerConfig, customRoot?: string): Promise<McpToolDefinition[]> {
    if (this.inFlightHandshakes.has(config.name)) {
      return await this.inFlightHandshakes.get(config.name)!;
    }

    const existing = this.activeServers.get(config.name);
    if (existing && existing.tools.length > 0) {
      return existing.tools;
    }

    const handshakePromise = config.url
      ? this.performStartHttpServer(config)
      : this.performStartServer(config, customRoot);
    this.inFlightHandshakes.set(config.name, handshakePromise);
    try {
      return await handshakePromise;
    } finally {
      this.inFlightHandshakes.delete(config.name);
    }
  }

  private async performStartHttpServer(config: McpServerConfig): Promise<McpToolDefinition[]> {
    const serverUrl = config.url!;
    const entry: ActiveMcpServerEntry = {
      url: serverUrl,
      postUrl: serverUrl,
      transport: 'http',
      tools: [],
    };
    this.activeServers.set(config.name, entry);

    // Try connecting via SSE first
    await this.connectSseIfSupported(config.name, serverUrl);

    try {
      // 1. Initialize
      await this.sendRequest(config.name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'kin-core', version: '1.0.0' },
      }, 30000);

      // Complete initialization notification
      this.sendNotification(config.name, 'notifications/initialized');

      // 2. Query tools/list with pagination
      const tools = await this.queryAllTools(config.name);
      entry.tools = tools;
      this.activeServers.set(config.name, entry);
      this.lastServerErrors.delete(config.name);
      return tools;
    } catch (err: any) {
      this.lastServerErrors.set(config.name, err?.message || String(err));
      console.warn(`[KIN MCP] HTTP Handshake with '${config.name}' failed:`, err);
      if (entry.sseController) {
        entry.sseController.abort();
      }
      this.activeServers.delete(config.name);
      return [];
    }
  }

  private async performStartServer(config: McpServerConfig, customRoot?: string): Promise<McpToolDefinition[]> {
    if (this.activeServers.has(config.name) && this.activeServers.get(config.name)!.tools.length > 0) {
      return this.activeServers.get(config.name)!.tools;
    }

    if (!config.command) {
      console.warn(`[KIN MCP] Server '${config.name}' has no command or url configured.`);
      return [];
    }

    const cmdTrim = config.command.trim();
    if (/[;&|`$<>\r\n]/.test(cmdTrim)) {
      console.warn(`[KIN MCP] Refusing to start MCP server '${config.name}': Command contains prohibited shell characters.`);
      return [];
    }
    const baseCmdCheck = path.basename(cmdTrim).toLowerCase().replace(/\.(exe|cmd|bat)$/i, '');
    const blockedBinaries = new Set([
      'sh', 'bash', 'zsh', 'ksh', 'csh', 'tcsh',
      'cmd', 'powershell', 'pwsh',
      'rm', 'del', 'erase', 'format',
      'curl', 'wget', 'nc', 'netcat', 'socat',
      'touch', 'dd', 'kill', 'taskkill'
    ]);
    if (blockedBinaries.has(baseCmdCheck)) {
      console.warn(`[KIN MCP] Refusing to start MCP server '${config.name}': Binary '${cmdTrim}' is prohibited.`);
      return [];
    }

    const targetRoot = customRoot ? path.resolve(customRoot) : this.projectRoot;
    const resolvedCommand = this.resolveConfigPath(config.command, targetRoot);
    const resolvedArgs = (config.args || []).map((a) => this.resolveConfigPath(a, targetRoot));

    const cleanEnv = McpClientManager.sanitizeMcpEnv(config.env);

    const isWindows = process.platform === 'win32';
    const cmdLower = resolvedCommand.toLowerCase();
    const isShellNeeded = isWindows && (
      cmdLower === 'npx' ||
      cmdLower === 'npm' ||
      cmdLower === 'uvx' ||
      /\.(cmd|bat)$/i.test(resolvedCommand) ||
      (!cmdLower.endsWith('.exe') && cmdLower !== 'node' && cmdLower !== 'python' && cmdLower !== 'python3')
    );

    const spawnCmd = (isWindows && cmdLower === 'node') ? process.execPath : resolvedCommand;
    const proc = spawn(spawnCmd, resolvedArgs, {
      cwd: targetRoot,
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isShellNeeded,
      detached: !isWindows,
    });

    let buffer = '';
    proc.stdout?.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);

          // Server-to-client JSON-RPC requests (ping, roots/list)
          if (json.method) {
            if (json.method === 'ping' && json.id !== undefined && json.id !== null) {
              proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: {} }) + '\n');
            } else if (json.method === 'roots/list' && json.id !== undefined && json.id !== null) {
              const rootUri = pathToFileURL(targetRoot).toString();
              proc.stdin?.write(JSON.stringify({
                jsonrpc: '2.0',
                id: json.id,
                result: {
                  roots: [{ uri: rootUri, name: path.basename(targetRoot) }],
                },
              }) + '\n');
            }
          }

          if (json.id !== undefined && json.id !== null) {
            const req = this.pendingRequests.get(json.id) ??
              this.pendingRequests.get(Number(json.id)) ??
              this.pendingRequests.get(String(json.id));
            if (req) {
              clearTimeout(req.timeout);
              this.pendingRequests.delete(json.id);
              this.pendingRequests.delete(Number(json.id));
              this.pendingRequests.delete(String(json.id));
              if (json.error) {
                req.reject(new Error(json.error.message || 'JSON-RPC Error'));
              } else {
                req.resolve(json.result);
              }
            }
          }
        } catch (e) {
          // Non-JSON stdout or partial stream
        }
      }
    });

    let stderrBuffer = '';
    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      stderrBuffer += text;
      if (stderrBuffer.length > 4096) {
        stderrBuffer = stderrBuffer.slice(-4096);
      }
      const errText = text.trim();
      if (errText) {
        console.warn(`[KIN MCP ${config.name} STDERR]`, errText);
      }
    });

    const cleanupServer = (reason: string) => {
      const active = this.activeServers.get(config.name);
      if (active && active.process === proc) {
        this.activeServers.delete(config.name);
      }
      for (const [id, req] of Array.from(this.pendingRequests.entries())) {
        if (req.serverName === config.name && (!req.proc || req.proc === proc)) {
          clearTimeout(req.timeout);
          this.pendingRequests.delete(id);
          req.reject(new Error(`MCP server '${config.name}' terminated: ${reason}`));
        }
      }
    };

    proc.on('error', (err) => {
      const detail = `Process error: ${err.message}`;
      this.lastServerErrors.set(config.name, detail);
      console.error(`[KIN MCP] Server '${config.name}' error:`, err);
      cleanupServer(detail);
    });

    proc.stdin?.on('error', (err) => {
      console.warn(`[KIN MCP] Stdin error on '${config.name}':`, err);
    });

    proc.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        const stderrLines = stderrBuffer.trim().split('\n').map((l) => l.trim()).filter(Boolean);
        const detail = stderrLines.length > 0 ? stderrLines[stderrLines.length - 1] : `Process exited with code ${code}`;
        this.lastServerErrors.set(config.name, detail);
      }
      console.warn(`[KIN MCP] Server '${config.name}' exited (code ${code}, signal ${signal})`);
      const exitReason = stderrBuffer.trim()
        ? stderrBuffer.trim().split('\n').map((l) => l.trim()).filter(Boolean).pop() || `Process exited with code ${code}`
        : `Process exited (code ${code}, signal ${signal})`;
      cleanupServer(exitReason);
    });

    // Temporarily record proc so sendRequest can communicate with it during handshake
    this.activeServers.set(config.name, { process: proc, transport: 'stdio', tools: [] });

    // 1. Initialize
    try {
      await this.sendRequest(config.name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'kin-core', version: '1.0.0' },
      }, 30000);

      // Complete protocol initialization with initialized notification
      this.sendNotification(config.name, 'notifications/initialized');

      // 2. Query tools/list with pagination
      const tools = await this.queryAllTools(config.name);

      this.activeServers.set(config.name, { process: proc, transport: 'stdio', tools });
      this.lastServerErrors.delete(config.name);
      return tools;
    } catch (err: any) {
      if (!this.lastServerErrors.has(config.name)) {
        this.lastServerErrors.set(config.name, err?.message || String(err));
      }
      console.warn(`[KIN MCP] Handshake with '${config.name}' failed or timed out:`, err);
      try {
        if (process.platform === 'win32' && proc.pid) {
          exec(`taskkill /pid ${proc.pid} /T /F`, () => {});
        } else if (proc.pid) {
          try {
            process.kill(-proc.pid, 'SIGKILL');
          } catch {
            proc.kill('SIGKILL');
          }
        }
        proc.kill();
      } catch {}
      cleanupServer(err?.message || 'Handshake failed');
      return [];
    }
  }

  /**
   * Invokes an MCP tool on the given server.
   */
  public async callTool(serverName: string, toolName: string, args: Record<string, any>, signal?: AbortSignal): Promise<McpToolCallResult> {
    const found = this.getServerEntry(serverName);
    if (!found) {
      throw new Error(`MCP server '${serverName}' is not running.`);
    }
    const { entry, actualName } = found;

    // Normalize tool name within the server's discovered tools
    let actualToolName = toolName;
    const norm = toolName.toLowerCase().replace(/[-_]/g, '');
    const matched = entry.tools.find((t) => t.name === toolName || t.name.toLowerCase().replace(/[-_]/g, '') === norm);
    if (matched) {
      actualToolName = matched.name;
    }

    const timeoutMs = typeof (args as any)?._timeoutMs === 'number' && (args as any)._timeoutMs > 0
      ? (args as any)._timeoutMs
      : 60000;
    const cleanArgs = { ...args };
    delete cleanArgs._timeoutMs;

    const res = await this.sendRequest(actualName, 'tools/call', {
      name: actualToolName,
      arguments: cleanArgs,
    }, timeoutMs, signal);
    return res as McpToolCallResult;
  }

  /**
   * Sends a JSON-RPC notification (without expecting a response) over stdio or HTTP.
   */
  public sendNotification(serverName: string, method: string, params?: Record<string, any>): void {
    const found = this.getServerEntry(serverName);
    if (!found) return;
    const { entry, actualName } = found;
    const payload: Record<string, any> = {
      jsonrpc: '2.0',
      method,
    };
    if (params) {
      payload.params = params;
    }

    if (entry.transport === 'http' && (entry.postUrl || entry.url)) {
      fetch(entry.postUrl || entry.url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch((err) => {
        console.warn(`[KIN MCP] Failed to send HTTP notification '${method}' to '${actualName}':`, err);
      });
      return;
    }

    if (entry.process?.stdin) {
      try {
        entry.process.stdin.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        console.warn(`[KIN MCP] Failed to send notification '${method}' to '${actualName}':`, err);
      }
    }
  }

  /**
   * Sends a JSON-RPC request over stdio or HTTP.
   */
  private sendRequest(
    serverName: string,
    method: string,
    params: Record<string, any>,
    timeoutMs: number = 60000,
    signal?: AbortSignal
  ): Promise<any> {
    const found = this.getServerEntry(serverName);
    if (!found) {
      return Promise.reject(new Error(`MCP server '${serverName}' is not running.`));
    }
    const { entry, actualName } = found;

    if (signal?.aborted) {
      return Promise.reject(new Error(`MCP request '${method}' to '${actualName}' aborted: ${signal.reason}`));
    }

    const id = this.requestIdCounter++;

    if (entry.transport === 'http' && (entry.postUrl || entry.url)) {
      const targetUrl = entry.postUrl || entry.url!;
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combinedSignal = signal ? (AbortSignal as any).any([timeoutSignal, signal]) : timeoutSignal;

      return new Promise((resolve, reject) => {
        let onAbort: (() => void) | undefined;
        const cleanup = () => {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          if (signal && onAbort) {
            signal.removeEventListener('abort', onAbort);
          }
        };

        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`MCP request '${method}' to '${actualName}' timed out (${Math.round(timeoutMs / 1000)}s).`));
        }, timeoutMs);

        if (signal) {
          onAbort = () => {
            cleanup();
            reject(new Error(`MCP request '${method}' to '${actualName}' aborted: ${signal.reason}`));
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }

        // Keep pending request registered for SSE response delivery
        this.pendingRequests.set(id, {
          serverName: actualName,
          timeout,
          resolve: (val) => {
            cleanup();
            resolve(val);
          },
          reject: (err) => {
            cleanup();
            reject(err);
          },
        });

        fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
          },
          body: payload,
          signal: combinedSignal,
        })
          .then(async (res) => {
            if (!res.ok) {
              const errText = await res.text().catch(() => res.statusText);
              throw new Error(`HTTP MCP request '${method}' to '${actualName}' failed (${res.status}): ${errText}`);
            }
            if (res.status === 202) {
              // Standard SSE asynchronous processing — response arrives via SSE stream
              return;
            }
            const text = await res.text();
            if (!text || !text.trim()) {
              // Empty body — response delivered via SSE message event
              return;
            }
            try {
              const json = JSON.parse(text);
              cleanup();
              if (json.error) {
                reject(new Error(json.error.message || `JSON-RPC Error on '${method}'`));
              } else {
                resolve(json.result);
              }
            } catch {
              // Non-JSON response body, will be caught by SSE handler if connected
            }
          })
          .catch((err) => {
            cleanup();
            reject(err);
          });
      });
    }

    if (!entry.process || !entry.process.stdin) {
      return Promise.reject(new Error(`MCP server '${actualName}' stdio transport is unavailable.`));
    }

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return new Promise((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const cleanup = () => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`MCP request '${method}' to '${actualName}' timed out (${Math.round(timeoutMs / 1000)}s).`));
      }, timeoutMs);

      if (signal) {
        onAbort = () => {
          cleanup();
          reject(new Error(`MCP request '${method}' to '${actualName}' aborted: ${signal.reason}`));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pendingRequests.set(id, {
        serverName: actualName,
        timeout,
        proc: entry.process,
        resolve: (val) => {
          cleanup();
          resolve(val);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      });

      try {
        entry.process?.stdin?.write(payload + '\n');
      } catch (err: any) {
        cleanup();
        reject(err);
      }
    });
  }

  /**
   * Returns all discovered tools across active MCP servers.
   */
  public getAllTools(): McpToolDefinition[] {
    const list: McpToolDefinition[] = [];
    for (const entry of this.activeServers.values()) {
      list.push(...entry.tools);
    }
    return list;
  }

  /**
   * Returns active server statuses and tool summaries.
   */
  public getAllServers(): Array<{ name: string; transport: 'stdio' | 'http'; url?: string; postUrl?: string; toolsCount: number; tools: string[] }> {
    const list: Array<{ name: string; transport: 'stdio' | 'http'; url?: string; postUrl?: string; toolsCount: number; tools: string[] }> = [];
    for (const [name, entry] of this.activeServers.entries()) {
      list.push({
        name,
        transport: entry.transport,
        url: entry.url,
        postUrl: entry.postUrl,
        toolsCount: entry.tools.length,
        tools: entry.tools.map((t) => t.name),
      });
    }
    return list;
  }

  /**
   * Stops a specific MCP server process and cleans up registrations and pending requests.
   */
  public stopServer(name: string): void {
    const found = this.getServerEntry(name);
    if (found) {
      const { entry, actualName } = found;
      if (entry.sseController) {
        try {
          entry.sseController.abort();
        } catch {}
      }
      if (entry.process) {
        try {
          entry.process.removeAllListeners('exit');
          entry.process.removeAllListeners('error');
          entry.process.removeAllListeners('close');
          if (process.platform === 'win32' && entry.process.pid) {
            exec(`taskkill /pid ${entry.process.pid} /T /F`, () => {});
          } else if (entry.process.pid) {
            try {
              process.kill(-entry.process.pid, 'SIGKILL');
            } catch {
              entry.process.kill('SIGKILL');
            }
          }
          entry.process.kill();
        } catch {}
      }
      this.activeServers.delete(actualName);
      this.lastServerErrors.delete(actualName);
      this.lastServerErrors.delete(name);
      for (const [id, req] of Array.from(this.pendingRequests.entries())) {
        if (req.serverName === actualName && (!req.proc || req.proc === entry.process)) {
          clearTimeout(req.timeout);
          this.pendingRequests.delete(id);
          req.reject(new Error(`MCP server '${actualName}' stopped`));
        }
      }
    } else {
      this.lastServerErrors.delete(name);
    }
  }

  /**
   * Returns the canonical global configuration path (~/.kin/mcp.json).
   */
  public static getGlobalConfigPath(): string {
    const userHome = process.env.KIN_GLOBAL_CONFIG_DIR || process.env.USERPROFILE || process.env.HOME || os.homedir();
    return path.resolve(path.join(userHome, '.kin', 'mcp.json'));
  }

  /**
   * Ensures that the zero-dependency standard connectors MCP server script and configuration exist in ~/.kin.
   */
  public static ensureStandardConnectorsServer(): string | undefined {
    if (process.env.KIN_ISOLATE_GLOBAL_MCP === 'true') {
      return undefined;
    }
    try {
      const userHome = process.env.KIN_GLOBAL_CONFIG_DIR || process.env.USERPROFILE || process.env.HOME || os.homedir();
      const kinDir = path.resolve(path.join(userHome, '.kin'));
      const serversDir = path.join(kinDir, 'servers');
      const scriptPath = path.join(serversDir, 'kin_standard_connectors.js');

      const needsWrite = !fs.existsSync(scriptPath) ||
        (() => {
          try {
            return fs.readFileSync(scriptPath, 'utf-8').includes('Math.sqrtoePIabsroundfloorceil');
          } catch {
            return false;
          }
        })();

      if (needsWrite) {
        if (!fs.existsSync(serversDir)) {
          fs.mkdirSync(serversDir, { recursive: true });
        }
        const scriptSource = `#!/usr/bin/env node
// KIN STANDARD CONNECTORS MCP SERVER (Zero-dependency stdio server)
import * as readline from 'node:readline';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TOOLS = [
  {
    name: 'get_system_info',
    description: 'Retrieves host environment details, CPU count, memory usage, and runtime environment.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'calculate',
    description: 'Safely evaluates an arithmetic math expression (e.g. "(125 * 8) + 450 / 5", "Math.min(10, 20)", "2^8").',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'The mathematical expression to evaluate.' } },
      required: ['expression']
    }
  },
  {
    name: 'get_time',
    description: 'Returns the current timestamp in ISO format, local formatted string, and epoch milliseconds for a given timezone.',
    inputSchema: {
      type: 'object',
      properties: { timezone: { type: 'string', description: 'Optional IANA timezone (e.g., "UTC", "Asia/Kolkata", "America/New_York"). Defaults to local.' } }
    }
  },
  {
    name: 'query_sqlite',
    description: 'Executes a SQL query or statement on a SQLite database using the native Node.js SQLite engine.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'The SQL statement or query to execute.' },
        dbPath: { type: 'string', description: 'Optional file path to SQLite DB file (supports "~"). Defaults to ":memory:".' },
        params: { type: 'array', description: 'Optional parameters array for prepared statement binding.' }
      },
      required: ['sql']
    }
  }
];

function resolvePath(p) {
  if (!p || typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function safeEvalMath(expr) {
  let sanitized = expr.replace(/\\s+/g, '').replace(/\\^/g, '**');
  const checkExpr = sanitized
    .replace(/Math\\.(PI|E|abs|ceil|floor|round|trunc|sqrt|cbrt|pow|min|max|sin|cos|tan|asin|acos|atan|log|log10|log2|exp)/g, '')
    .replace(/(PI|E|abs|ceil|floor|round|trunc|sqrt|cbrt|pow|min|max|sin|cos|tan|asin|acos|atan|log|log10|log2|exp)/g, '');
  if (!/^[0-9+\\-*/%().,]*$/.test(checkExpr)) {
    throw new Error('Invalid or unsafe characters in mathematical expression.');
  }
  const fn = new Function('Math', 'PI,E,abs,ceil,floor,round,trunc,sqrt,cbrt,pow,min,max,sin,cos,tan,asin,acos,atan,log,log10,log2,exp', '"use strict"; return (' + sanitized + ');');
  return fn(Math, Math.PI, Math.E, Math.abs, Math.ceil, Math.floor, Math.round, Math.trunc, Math.sqrt, Math.cbrt, Math.pow, Math.min, Math.max, Math.sin, Math.cos, Math.tan, Math.asin, Math.acos, Math.atan, Math.log, Math.log10, Math.log2, Math.exp);
}

function handleToolCall(name, args = {}) {
  switch (name) {
    case 'get_system_info': {
      const cpus = os.cpus();
      const info = {
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
        cpuModel: cpus[0]?.model || 'Unknown',
        cpuCores: cpus.length,
        totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
        freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        pid: process.pid,
      };
      return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
    }
    case 'calculate': {
      const expr = args.expression;
      if (!expr || typeof expr !== 'string') {
        return { isError: true, content: [{ type: 'text', text: 'Missing required "expression" parameter.' }] };
      }
      try {
        const result = safeEvalMath(expr);
        return { content: [{ type: 'text', text: String(result) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: 'Calculation error: ' + err.message }] };
      }
    }
    case 'get_time': {
      const tz = args.timezone || undefined;
      const now = new Date();
      let formatted;
      let effectiveTz = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
      try {
        formatted = now.toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' });
      } catch (err) {
        formatted = now.toLocaleString('en-US');
        effectiveTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
      const data = {
        iso: now.toISOString(),
        epochMs: now.getTime(),
        timezone: effectiveTz,
        formatted
      };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    case 'query_sqlite': {
      const sql = args.sql;
      const dbPath = resolvePath(args.dbPath || ':memory:');
      const params = Array.isArray(args.params) ? args.params : (args.params !== undefined ? [args.params] : []);
      if (!sql || typeof sql !== 'string') {
        return { isError: true, content: [{ type: 'text', text: 'Missing required "sql" parameter.' }] };
      }
      try {
        const db = new DatabaseSync(dbPath);
        const trimmed = sql.trim();
        if (/^(select|pragma|explain)/i.test(trimmed)) {
          const stmt = db.prepare(trimmed);
          const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
          db.close();
          return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
        } else {
          if (params.length > 0) {
            const stmt = db.prepare(trimmed);
            stmt.run(...params);
          } else {
            db.exec(trimmed);
          }
          db.close();
          return { content: [{ type: 'text', text: 'Statement executed successfully.' }] };
        }
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: 'SQLite error: ' + err.message }] };
      }
    }
    default:
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool: ' + name }] };
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\\n'); }

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    const { id, method, params } = req;
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'kin-standard-connectors', version: '1.0.0' }
        }
      });
      return;
    }
    if (method === 'notifications/initialized') return;
    if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }
    if (method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }
    if (method === 'tools/call') {
      const outcome = handleToolCall(params?.name, params?.arguments || {});
      send({ jsonrpc: '2.0', id, result: outcome });
      return;
    }
    if (id !== undefined && id !== null) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
    }
  } catch {}
});
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
`;
        fs.writeFileSync(scriptPath, scriptSource, 'utf-8');
      }

      const globalConfigPath = path.join(kinDir, 'mcp.json');
      if (!fs.existsSync(globalConfigPath)) {
        const initialConfig = {
          mcpServers: {
            system: {
              command: 'node',
              args: [scriptPath],
              env: {},
            },
          },
        };
        fs.writeFileSync(globalConfigPath, JSON.stringify(initialConfig, null, 2), 'utf-8');
      }

      return scriptPath;
    } catch (err) {
      console.warn('[KIN MCP] Standard connectors auto-provision notice:', err);
      return undefined;
    }
  }

  /**
   * Returns the canonical project-scoped configuration path (<projectRoot>/.kin/mcp.json).
   */
  public getProjectConfigPath(customRoot?: string): string {
    const root = customRoot ? path.resolve(customRoot) : this.projectRoot;
    return path.resolve(path.join(root, '.kin', 'mcp.json'));
  }

  /**
   * Lists all configured connectors from both global (~/.kin/mcp.json) and project (<root>/.kin/mcp.json) scopes.
   */
  public listConfiguredConnectors(customRoot?: string): McpConnectorItem[] {
    const connectors: McpConnectorItem[] = [];
    const seen = new Set<string>();
    const projectNames = new Set<string>();

    const readScopeConfigs = (configPath: string, scope: 'global' | 'project') => {
      if (!fs.existsSync(configPath)) return;
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const serverSources = parsed.mcpServers || parsed.servers || {};

        if (Array.isArray(parsed)) {
          for (const s of parsed) {
            if (!s.name) continue;
            const uniqueKey = `${scope}:${s.name}`;
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);
            if (scope === 'project') {
              projectNames.add(s.name.toLowerCase());
            }
            const isOverridden = scope === 'global' && projectNames.has(s.name.toLowerCase());
            const active = isOverridden ? undefined : this.getServerEntry(s.name);
            const isDisabled = s.disabled === true || s.enabled === false;
            const err = this.lastServerErrors.get(s.name);
            const status: 'active' | 'stopped' | 'error' = isOverridden
              ? 'stopped'
              : (isDisabled ? 'stopped' : (active ? 'active' : (err ? 'error' : 'stopped')));
            const tools = active
              ? active.entry.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  inputSchema: t.inputSchema,
                }))
              : [];
            connectors.push({
              name: s.name,
              scope,
              configPath,
              command: s.command,
              args: s.args,
              env: s.env,
              url: s.url,
              transport: s.transport || (s.url ? 'http' : 'stdio'),
              disabled: isDisabled,
              status,
              overridden: isOverridden,
              toolsCount: active ? active.entry.tools.length : 0,
              tools,
              error: isOverridden ? undefined : err,
            });
          }
        } else if (typeof serverSources === 'object' && serverSources !== null) {
          for (const [name, conf] of Object.entries(serverSources)) {
            const serverConfig = conf as any;
            const uniqueKey = `${scope}:${name}`;
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);
            if (scope === 'project') {
              projectNames.add(name.toLowerCase());
            }
            const isOverridden = scope === 'global' && projectNames.has(name.toLowerCase());
            const active = isOverridden ? undefined : this.getServerEntry(name);
            const isDisabled = serverConfig?.disabled === true || serverConfig?.enabled === false;
            const err = this.lastServerErrors.get(name);
            const status: 'active' | 'stopped' | 'error' = isOverridden
              ? 'stopped'
              : (isDisabled ? 'stopped' : (active ? 'active' : (err ? 'error' : 'stopped')));
            const tools = active
              ? active.entry.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  inputSchema: t.inputSchema,
                }))
              : [];
            connectors.push({
              name,
              scope,
              configPath,
              command: serverConfig?.command,
              args: serverConfig?.args,
              env: serverConfig?.env,
              url: serverConfig?.url,
              transport: serverConfig?.transport || (serverConfig?.url ? 'http' : 'stdio'),
              disabled: isDisabled,
              status,
              overridden: isOverridden,
              toolsCount: active ? active.entry.tools.length : 0,
              tools,
              error: isOverridden ? undefined : err,
            });
          }
        }
      } catch (err: any) {
        console.warn(`[KIN MCP] Failed to read ${scope} config from ${configPath}:`, err);
      }
    };

    // 1. Project-level connectors
    readScopeConfigs(this.getProjectConfigPath(customRoot), 'project');
    const altProjectKin = path.resolve(path.join(customRoot ? path.resolve(customRoot) : this.projectRoot, '.kin', 'mcp_servers.json'));
    if (fs.existsSync(altProjectKin)) {
      readScopeConfigs(altProjectKin, 'project');
    }
    const altProjectRoot = path.resolve(path.join(customRoot ? path.resolve(customRoot) : this.projectRoot, 'mcp.json'));
    if (fs.existsSync(altProjectRoot)) {
      readScopeConfigs(altProjectRoot, 'project');
    }

    // 2. Global user-level connectors
    const isIsolatedInTest = process.env.KIN_ISOLATE_GLOBAL_MCP === 'true' &&
      !process.env.KIN_GLOBAL_CONFIG_DIR &&
      (process.env.USERPROFILE === undefined || process.env.USERPROFILE === os.homedir());

    if (!isIsolatedInTest) {
      readScopeConfigs(McpClientManager.getGlobalConfigPath(), 'global');
      const userHome = process.env.KIN_GLOBAL_CONFIG_DIR || process.env.USERPROFILE || process.env.HOME || os.homedir();
      const altGlobal = path.resolve(path.join(userHome, '.kin', 'mcp_servers.json'));
      if (fs.existsSync(altGlobal)) {
        readScopeConfigs(altGlobal, 'global');
      }
    }

    return connectors;
  }

  /**
   * Saves or updates a connector configuration in the specified scope file.
   * Creates directory if needed and starts or updates server instance.
   */
  public async saveConnector(
    scope: 'global' | 'project',
    name: string,
    config: McpServerConfig,
    customRoot?: string
  ): Promise<{ success: boolean; connector: McpConnectorItem; tools: McpToolDefinition[]; error?: string }> {
    const trimmedName = name.trim();
    if (!trimmedName || !/^[a-zA-Z0-9_\-\.]+$/.test(trimmedName)) {
      throw new Error(`Invalid connector name '${name}'. Only letters, numbers, hyphens, dots, and underscores allowed.`);
    }

    const configPath = scope === 'global'
      ? McpClientManager.getGlobalConfigPath()
      : this.getProjectConfigPath(customRoot);

    return McpClientManager.withFileLock(configPath, async () => {
      const cleanConfig: Record<string, any> = {};
      if (config.command) {
        const cmd = config.command.trim();
        if (/[;&|`$<>\r\n]/.test(cmd)) {
          throw new Error(`Invalid MCP connector command '${cmd}': Shell metacharacters and command chaining are prohibited.`);
        }
        const baseCmd = path.basename(cmd).toLowerCase().replace(/\.(exe|cmd|bat)$/i, '');
        const allowedRunners = new Set([
          'node', 'npx', 'python', 'python3', 'uv', 'uvx', 'docker', 'bun', 'deno'
        ]);
        const isCustomExecutable = cmd.includes('/') || cmd.includes('\\');
        const prohibitedBinaries = new Set([
          'sh', 'bash', 'zsh', 'ksh', 'csh', 'tcsh',
          'cmd', 'powershell', 'pwsh',
          'rm', 'del', 'erase', 'format',
          'curl', 'wget', 'nc', 'netcat', 'socat',
          'touch', 'dd', 'kill', 'taskkill',
          'ruby', 'perl', 'php', 'lua', 'mshta', 'cscript', 'wscript', 'certutil'
        ]);
        if (prohibitedBinaries.has(baseCmd) || (!allowedRunners.has(baseCmd) && !isCustomExecutable)) {
          throw new Error(`Prohibited MCP command binary '${cmd}'. MCP servers must use standard runtime runners (node, npx, python, python3, uv, uvx, docker, bun, deno) or a dedicated executable.`);
        }
        cleanConfig.command = cmd;
      }
      if (config.args && Array.isArray(config.args)) {
        const stringArgs = config.args.filter((a) => typeof a === 'string');
        if (cleanConfig.command) {
          const baseCmd = path.basename(cleanConfig.command).toLowerCase().replace(/\.(exe|cmd|bat)$/i, '');
          const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
          if (!isTest && (baseCmd === 'node' || baseCmd === 'python' || baseCmd === 'python3') && stringArgs.some((a) => a === '-e' || a === '-c' || a === '--eval')) {
            throw new Error(`Arbitrary inline script execution via '${baseCmd}' is prohibited in MCP server configurations.`);
          }
        }
        cleanConfig.args = stringArgs;
      }
      if (config.env && typeof config.env === 'object') {
        const sanitizedEnv: Record<string, string> = {};
        const dangerousEnvKeys = new Set([
          'node_options', 'pythonpath', 'pythonhome', 'ld_preload', 'ld_library_path',
          'dyld_insert_libraries', 'dyld_library_path', 'bash_env', 'env', 'prompt_command',
          'perl5lib', 'rubyopt', 'kin_ipc_token', 'kin_vault_key'
        ]);
        for (const [k, v] of Object.entries(config.env)) {
          if (typeof v === 'string' && !dangerousEnvKeys.has(k.toLowerCase())) {
            sanitizedEnv[k] = v;
          }
        }
        cleanConfig.env = sanitizedEnv;
      }
      if (config.url) cleanConfig.url = config.url.trim();
      if (config.transport) cleanConfig.transport = config.transport;
      if (typeof config.disabled === 'boolean') {
        cleanConfig.disabled = config.disabled;
      }

      const { format, data } = McpClientManager.parseConfigFile(configPath);
      if (format === 'array') {
        const lower = trimmedName.toLowerCase();
        const existingIdx = (data as any[]).findIndex((s) => s?.name && s.name.toLowerCase() === lower);
        const existing = existingIdx >= 0 ? (data as any[])[existingIdx] : {};
        if (typeof config.disabled !== 'boolean' && typeof existing.disabled === 'boolean') {
          cleanConfig.disabled = existing.disabled;
        }
        const item = { ...existing, ...cleanConfig, name: trimmedName };
        if (existingIdx >= 0) {
          data[existingIdx] = item;
        } else {
          data.push(item);
        }
        McpClientManager.atomicWriteJson(configPath, data);
      } else if (format === 'servers') {
        const existingKey = McpClientManager.findConnectorKeyCaseInsensitive(data.servers, trimmedName) || trimmedName;
        const existing = data.servers[existingKey] || {};
        if (typeof config.disabled !== 'boolean' && typeof existing.disabled === 'boolean') {
          cleanConfig.disabled = existing.disabled;
        }
        data.servers[existingKey] = { ...existing, ...cleanConfig };
        McpClientManager.atomicWriteJson(configPath, data);
      } else {
        if (!data.mcpServers) data.mcpServers = {};
        const existingKey = McpClientManager.findConnectorKeyCaseInsensitive(data.mcpServers, trimmedName) || trimmedName;
        const existing = data.mcpServers[existingKey] || {};
        if (typeof config.disabled !== 'boolean' && typeof existing.disabled === 'boolean') {
          cleanConfig.disabled = existing.disabled;
        }
        data.mcpServers[existingKey] = { ...existing, ...cleanConfig };
        if (data.servers && typeof data.servers === 'object') {
          const stale = McpClientManager.findConnectorKeyCaseInsensitive(data.servers, trimmedName);
          if (stale) delete data.servers[stale];
        }
        McpClientManager.atomicWriteJson(configPath, data);
      }

      // Hot-reload the server instance
      this.stopServer(trimmedName);
      let tools: McpToolDefinition[] = [];
      if (!cleanConfig.disabled) {
        try {
          tools = await this.startServer({
            name: trimmedName,
            ...cleanConfig,
          }, customRoot);
        } catch (err: any) {
          console.warn(`[KIN MCP] Could not auto-start newly saved connector '${trimmedName}':`, err);
        }
      }

      const active = this.getServerEntry(trimmedName);
      const connector: McpConnectorItem = {
        name: trimmedName,
        scope,
        configPath,
        command: cleanConfig.command,
        args: cleanConfig.args,
        env: cleanConfig.env,
        url: cleanConfig.url,
        transport: cleanConfig.transport || (cleanConfig.url ? 'http' : 'stdio'),
        disabled: Boolean(cleanConfig.disabled),
        status: cleanConfig.disabled ? 'stopped' : (active ? 'active' : 'stopped'),
        toolsCount: active ? active.entry.tools.length : tools.length,
        tools: (active ? active.entry.tools : tools).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };

      return { success: true, connector, tools };
    });
  }

  /**
   * Deletes a connector configuration from the specified scope file.
   */
  public async deleteConnector(
    scope: 'global' | 'project',
    name: string,
    customRoot?: string
  ): Promise<{ success: boolean; error?: string }> {
    const trimmedName = name.trim();
    const configPath = scope === 'global'
      ? McpClientManager.getGlobalConfigPath()
      : this.getProjectConfigPath(customRoot);

    return McpClientManager.withFileLock(configPath, async () => {
      if (fs.existsSync(configPath)) {
        try {
          const { format, data } = McpClientManager.parseConfigFile(configPath);
          const lower = trimmedName.toLowerCase();
          if (format === 'array') {
            const filtered = (data as any[]).filter((s) => !s?.name || s.name.toLowerCase() !== lower);
            McpClientManager.atomicWriteJson(configPath, filtered);
          } else {
            if (data.mcpServers && typeof data.mcpServers === 'object') {
              const key = McpClientManager.findConnectorKeyCaseInsensitive(data.mcpServers, trimmedName);
              if (key) delete data.mcpServers[key];
            }
            if (data.servers && typeof data.servers === 'object') {
              const key = McpClientManager.findConnectorKeyCaseInsensitive(data.servers, trimmedName);
              if (key) delete data.servers[key];
            }
            McpClientManager.atomicWriteJson(configPath, data);
          }
        } catch (err: any) {
          throw new Error(`Failed to update ${configPath}: ${err.message}`);
        }
      }

      this.stopServer(trimmedName);
      await this.loadConfiguredServers(customRoot);
      return { success: true };
    });
  }

  /**
   * Toggles enabled/disabled state of a connector configuration.
   */
  public async toggleConnector(
    scope: 'global' | 'project',
    name: string,
    disabled: boolean,
    customRoot?: string
  ): Promise<{ success: boolean; disabled: boolean; toolsCount: number }> {
    const trimmedName = name.trim();
    const configPath = scope === 'global'
      ? McpClientManager.getGlobalConfigPath()
      : this.getProjectConfigPath(customRoot);

    return McpClientManager.withFileLock(configPath, async () => {
      if (!fs.existsSync(configPath)) {
        throw new Error(`Config file for ${scope} scope not found at ${configPath}`);
      }

      const { format, data } = McpClientManager.parseConfigFile(configPath);
      let target: any = undefined;
      let targetKey: string | undefined = undefined;

      if (format === 'array') {
        const lower = trimmedName.toLowerCase();
        target = (data as any[]).find((s) => s?.name && s.name.toLowerCase() === lower);
      } else {
        if (data.mcpServers && typeof data.mcpServers === 'object') {
          targetKey = McpClientManager.findConnectorKeyCaseInsensitive(data.mcpServers, trimmedName);
          if (targetKey) target = data.mcpServers[targetKey];
        }
        if (!target && data.servers && typeof data.servers === 'object') {
          targetKey = McpClientManager.findConnectorKeyCaseInsensitive(data.servers, trimmedName);
          if (targetKey) target = data.servers[targetKey];
        }
      }

      if (!target) {
        throw new Error(`Connector '${trimmedName}' not found in ${scope} config.`);
      }

      target.disabled = disabled;
      if (disabled) {
        target.enabled = false;
      } else {
        delete target.enabled;
      }

      McpClientManager.atomicWriteJson(configPath, data);

      if (disabled) {
        this.stopServer(trimmedName);
        return { success: true, disabled: true, toolsCount: 0 };
      } else {
        this.stopServer(trimmedName);
        try {
          const tools = await this.startServer({
            name: trimmedName,
            ...target,
          });
          return { success: true, disabled: false, toolsCount: tools.length };
        } catch (startErr: any) {
          this.lastServerErrors.set(trimmedName, startErr.message || String(startErr));
          throw startErr;
        }
      }
    });
  }

  /**
   * Tests connection to an MCP server (validates initialize handshake and tools/list discovery).
   * Operates completely in isolation without polluting active servers.
   */
  public async testConnector(
    config: McpServerConfig,
    timeoutMs: number = 10000,
    customRoot?: string
  ): Promise<{
    success: boolean;
    message: string;
    error?: string;
    toolsCount: number;
    tools: string[];
    toolDetails?: Array<{ name: string; description?: string; inputSchema?: Record<string, any> }>;
    durationMs: number;
  }> {
    const start = Date.now();
    const testName = `__test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tempConfig: McpServerConfig = { ...config, name: testName };

    try {
      if (!tempConfig.command && !tempConfig.url) {
        return {
          success: false,
          message: 'No command or URL specified for connector test.',
          error: 'No command or URL specified for connector test.',
          toolsCount: 0,
          tools: [],
          toolDetails: [],
          durationMs: Date.now() - start,
        };
      }

      const tools = await Promise.race([
        (tempConfig.url ? this.performStartHttpServer(tempConfig) : this.performStartServer(tempConfig, customRoot)),
        new Promise<McpToolDefinition[]>((_, reject) =>
          setTimeout(() => reject(new Error(`Connector test handshake timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
        ),
      ]);

      const durationMs = Date.now() - start;
      const lastErr = this.lastServerErrors.get(testName);
      if ((!tools || tools.length === 0) && lastErr) {
        return {
          success: false,
          message: `Connection test failed: ${lastErr}`,
          error: lastErr,
          toolsCount: 0,
          tools: [],
          toolDetails: [],
          durationMs,
        };
      }

      if (!tools) {
        return {
          success: false,
          message: `Connector '${config.name || 'test'}' failed protocol handshake.`,
          error: lastErr || 'Protocol handshake failed.',
          toolsCount: 0,
          tools: [],
          toolDetails: [],
          durationMs,
        };
      }

      const toolNames = tools.map((t) => t.name);
      return {
        success: true,
        message: toolNames.length > 0
          ? `Successfully connected and completed protocol handshake (${durationMs}ms). Discovered ${tools.length} tool(s).`
          : `Successfully connected and completed protocol handshake (${durationMs}ms). Server active with 0 tools.`,
        toolsCount: tools.length,
        tools: toolNames,
        toolDetails: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const errText = err?.message || String(err);
      return {
        success: false,
        message: `Connection test failed: ${errText}`,
        error: errText,
        toolsCount: 0,
        tools: [],
        toolDetails: [],
        durationMs,
      };
    } finally {
      this.stopServer(testName);
      this.lastServerErrors.delete(testName);
    }
  }

  /**
   * Stops all active MCP server processes.
   */
  public shutdown(): void {
    for (const name of Array.from(this.activeServers.keys())) {
      this.stopServer(name);
    }
    this.activeServers.clear();
  }
}
