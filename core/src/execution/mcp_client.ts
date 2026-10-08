// ============================================================================
// KIN MODEL CONTEXT PROTOCOL (MCP) CLIENT ADAPTER
// Standard JSON-RPC 2.0 transport over stdio for external MCP servers.
// Dynamically discovers tools and registers them into ToolGateway.
// ============================================================================

import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
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

interface PendingRequestEntry {
  serverName: string;
  timeout: NodeJS.Timeout;
  resolve: (res: any) => void;
  reject: (err: any) => void;
}

export class McpClientManager {
  private activeServers: Map<string, { process: ChildProcess; tools: McpToolDefinition[] }> = new Map();
  private pendingRequests: Map<number, PendingRequestEntry> = new Map();
  private inFlightHandshakes: Map<string, Promise<McpToolDefinition[]>> = new Map();
  private requestIdCounter = 1;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
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
      'COMSPEC', 'SHELL',
      'TERM', 'LANG', 'LC_ALL',
      'APPDATA', 'LOCALAPPDATA',
      'HOMEDRIVE', 'HOMEPATH',
      'ProgramData', 'ALLUSERSPROFILE',
      'NODE_PATH'
    ];
    const safeEnv: Record<string, string> = {};
    for (const key of safeSystemKeys) {
      if (process.env[key] !== undefined) {
        safeEnv[key] = process.env[key]!;
      }
    }
    const cleanEnv: Record<string, string> = { ...safeEnv, ...(configEnv || {}) };
    for (const key of Object.keys(cleanEnv)) {
      if (!configEnv || !(key in configEnv)) {
        if (/api_key|secret|token|kin_/i.test(key)) {
          delete cleanEnv[key];
        }
      }
    }
    return cleanEnv;
  }

  /**
   * Loads configured MCP servers from .kin/mcp.json, .kin/mcp_servers.json, or mcp.json.
   */
  public async loadConfiguredServers(): Promise<McpToolDefinition[]> {
    const candidatePaths = [
      path.join(this.projectRoot, '.kin', 'mcp.json'),
      path.join(this.projectRoot, '.kin', 'mcp_servers.json'),
      path.join(this.projectRoot, 'mcp.json'),
    ];

    const serverMap = new Map<string, McpServerConfig>();

    for (const configPath of candidatePaths) {
      if (!fs.existsSync(configPath)) continue;

      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const serverSources = parsed.mcpServers || parsed.servers || {};

        if (Array.isArray(parsed)) {
          for (const s of parsed) {
            if (s.name && s.command && !serverMap.has(s.name)) {
              serverMap.set(s.name, {
                name: s.name,
                command: s.command,
                args: s.args || [],
                env: s.env || {},
              });
            }
          }
        } else if (typeof serverSources === 'object' && serverSources !== null) {
          for (const [name, conf] of Object.entries(serverSources)) {
            const serverConfig = conf as any;
            if (serverConfig?.command && !serverMap.has(name)) {
              serverMap.set(name, {
                name,
                command: serverConfig.command,
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

    if (serverMap.size === 0) {
      return [];
    }

    const allTools: McpToolDefinition[] = [];
    for (const s of serverMap.values()) {
      try {
        const tools = await this.startServer(s);
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
  public async loadServersFromConfig(): Promise<McpToolDefinition[]> {
    return this.loadConfiguredServers();
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
  public async startServer(config: McpServerConfig): Promise<McpToolDefinition[]> {
    if (this.inFlightHandshakes.has(config.name)) {
      return await this.inFlightHandshakes.get(config.name)!;
    }

    const existing = this.activeServers.get(config.name);
    if (existing && existing.tools.length > 0) {
      return existing.tools;
    }

    const handshakePromise = this.performStartServer(config);
    this.inFlightHandshakes.set(config.name, handshakePromise);
    try {
      return await handshakePromise;
    } finally {
      this.inFlightHandshakes.delete(config.name);
    }
  }

  private async performStartServer(config: McpServerConfig): Promise<McpToolDefinition[]> {
    if (this.activeServers.has(config.name) && this.activeServers.get(config.name)!.tools.length > 0) {
      return this.activeServers.get(config.name)!.tools;
    }

    const cleanEnv = McpClientManager.sanitizeMcpEnv(config.env);

    const isWindows = process.platform === 'win32';
    const isShellNeeded = isWindows && (
      config.command.toLowerCase() === 'npx' ||
      config.command.toLowerCase() === 'npm' ||
      config.command.toLowerCase() === 'uvx' ||
      /\.(cmd|bat)$/i.test(config.command) ||
      !config.command.toLowerCase().endsWith('.exe')
    );

    const proc = spawn(config.command, config.args || [], {
      cwd: this.projectRoot,
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isShellNeeded,
    });

    let buffer = '';
    proc.stdout?.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.id && this.pendingRequests.has(json.id)) {
            const req = this.pendingRequests.get(json.id)!;
            clearTimeout(req.timeout);
            this.pendingRequests.delete(json.id);
            if (json.error) {
              req.reject(new Error(json.error.message || 'JSON-RPC Error'));
            } else {
              req.resolve(json.result);
            }
          }
        } catch (e) {
          // Non-JSON stdout or partial stream
        }
      }
    });

    proc.stderr?.on('data', (data) => {
      const errText = data.toString().trim();
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
        if (req.serverName === config.name) {
          clearTimeout(req.timeout);
          this.pendingRequests.delete(id);
          req.reject(new Error(`MCP server '${config.name}' terminated: ${reason}`));
        }
      }
    };

    proc.on('error', (err) => {
      console.error(`[KIN MCP] Server '${config.name}' error:`, err);
      cleanupServer(`Process error: ${err.message}`);
    });

    proc.stdin?.on('error', (err) => {
      console.warn(`[KIN MCP] Stdin error on '${config.name}':`, err);
    });

    proc.on('exit', (code, signal) => {
      console.warn(`[KIN MCP] Server '${config.name}' exited (code ${code}, signal ${signal})`);
      cleanupServer(`Process exited (code ${code}, signal ${signal})`);
    });

    // Temporarily record proc so sendRequest can communicate with it during handshake
    this.activeServers.set(config.name, { process: proc, tools: [] });

    // 1. Initialize
    try {
      await this.sendRequest(config.name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'kin-core', version: '1.0.0' },
      }, 30000);

      // Complete protocol initialization with initialized notification
      this.sendNotification(config.name, 'notifications/initialized');

      // 2. Query tools/list
      const listRes = await this.sendRequest(config.name, 'tools/list', {});
      const rawTools = listRes?.tools || [];
      const tools: McpToolDefinition[] = rawTools.map((t: any) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema || {},
        serverName: config.name,
      }));

      this.activeServers.set(config.name, { process: proc, tools });
      return tools;
    } catch (err) {
      console.warn(`[KIN MCP] Handshake with '${config.name}' failed or timed out:`, err);
      try {
        proc.kill();
      } catch {}
      cleanupServer('Handshake failed');
      return [];
    }
  }

  /**
   * Invokes an MCP tool on the given server.
   */
  public async callTool(serverName: string, toolName: string, args: Record<string, any>): Promise<McpToolCallResult> {
    const res = await this.sendRequest(serverName, 'tools/call', {
      name: toolName,
      arguments: args,
    });
    return res as McpToolCallResult;
  }

  /**
   * Sends a JSON-RPC notification (without expecting a response) over stdio.
   */
  public sendNotification(serverName: string, method: string, params?: Record<string, any>): void {
    const entry = this.activeServers.get(serverName);
    if (!entry || !entry.process.stdin) return;
    const payload: Record<string, any> = {
      jsonrpc: '2.0',
      method,
    };
    if (params) {
      payload.params = params;
    }
    try {
      entry.process.stdin.write(JSON.stringify(payload) + '\n');
    } catch (err) {
      console.warn(`[KIN MCP] Failed to send notification '${method}' to '${serverName}':`, err);
    }
  }

  /**
   * Sends a JSON-RPC request over stdio.
   */
  private sendRequest(serverName: string, method: string, params: Record<string, any>, timeoutMs: number = 15000): Promise<any> {
    const entry = this.activeServers.get(serverName);
    if (!entry || !entry.process.stdin) {
      return Promise.reject(new Error(`MCP server '${serverName}' is not running.`));
    }

    const id = this.requestIdCounter++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request '${method}' to '${serverName}' timed out (${Math.round(timeoutMs / 1000)}s).`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        serverName,
        timeout,
        resolve: (val) => {
          clearTimeout(timeout);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      try {
        entry.process.stdin?.write(payload + '\n');
      } catch (err: any) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
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
   * Stops a specific MCP server process and cleans up registrations and pending requests.
   */
  public stopServer(name: string): void {
    const entry = this.activeServers.get(name);
    if (entry) {
      try {
        entry.process.kill();
      } catch {}
      this.activeServers.delete(name);
      for (const [id, req] of Array.from(this.pendingRequests.entries())) {
        if (req.serverName === name) {
          clearTimeout(req.timeout);
          this.pendingRequests.delete(id);
          req.reject(new Error(`MCP server '${name}' stopped`));
        }
      }
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
