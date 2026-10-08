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
      'TERM', 'LANG', 'LC_ALL'
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
   * Loads configured MCP servers from .kin/mcp_servers.json.
   */
  public async loadConfiguredServers(): Promise<McpToolDefinition[]> {
    const configPath = path.join(this.projectRoot, '.kin', 'mcp_servers.json');
    if (!fs.existsSync(configPath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const servers: McpServerConfig[] = parsed.mcpServers ? Object.entries(parsed.mcpServers).map(([name, conf]: [string, any]) => ({
        name,
        command: conf.command,
        args: conf.args || [],
        env: conf.env || {},
      })) : [];

      const allTools: McpToolDefinition[] = [];
      for (const s of servers) {
        try {
          const tools = await this.startServer(s);
          allTools.push(...tools);
        } catch (err) {
          console.error(`[KIN MCP] Failed to start server ${s.name}:`, err);
        }
      }
      return allTools;
    } catch (err) {
      console.error('[KIN MCP] Failed to read mcp_servers.json:', err);
      return [];
    }
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
  public async reloadProject(projectRoot: string): Promise<McpToolDefinition[]> {
    this.shutdown();
    this.setProjectRoot(projectRoot);
    return await this.loadConfiguredServers();
  }

  /**
   * Spawns an MCP server, handles supervision lifecycle, and queries tools/list.
   */
  public async startServer(config: McpServerConfig): Promise<McpToolDefinition[]> {
    if (this.activeServers.has(config.name)) {
      return this.activeServers.get(config.name)!.tools;
    }

    const cleanEnv = McpClientManager.sanitizeMcpEnv(config.env);

    const proc = spawn(config.command, config.args || [], {
      cwd: this.projectRoot,
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
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
      });

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
  private sendRequest(serverName: string, method: string, params: Record<string, any>): Promise<any> {
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
        reject(new Error(`MCP request '${method}' to '${serverName}' timed out (10s).`));
      }, 10000);

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
