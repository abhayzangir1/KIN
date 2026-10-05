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

export class McpClientManager {
  private activeServers: Map<string, { process: ChildProcess; tools: McpToolDefinition[] }> = new Map();
  private pendingRequests: Map<number, { resolve: (res: any) => void; reject: (err: any) => void }> = new Map();
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
   * Constructs a sanitized environment for MCP subprocesses, stripping all host API keys and KIN secrets.
   */
  public static sanitizeMcpEnv(configEnv?: Record<string, string>): Record<string, string> {
    const safeOsKeys = [
      'PATH', 'Path', 'path',
      'HOME', 'USERPROFILE',
      'TEMP', 'TMP',
      'SYSTEMROOT', 'SystemRoot',
      'COMSPEC', 'SHELL',
      'TERM', 'LANG', 'LC_ALL'
    ];
    const safeEnv: Record<string, string> = {};
    for (const key of safeOsKeys) {
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
   * Spawns an MCP server and queries tools/list.
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
            const { resolve, reject } = this.pendingRequests.get(json.id)!;
            this.pendingRequests.delete(json.id);
            if (json.error) {
              reject(new Error(json.error.message || 'JSON-RPC Error'));
            } else {
              resolve(json.result);
            }
          }
        } catch (e) {
          // Non-JSON stdout or partial stream
        }
      }
    });

    proc.on('error', (err) => {
      console.error(`[KIN MCP] Server '${config.name}' error:`, err);
    });

    this.activeServers.set(config.name, { process: proc, tools: [] });

    // 1. Initialize
    try {
      await this.sendRequest(config.name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'kin-core', version: '1.0.0' },
      });

      // 2. Query tools/list
      const listRes = await this.sendRequest(config.name, 'tools/list', {});
      const rawTools = listRes?.tools || [];
      const tools: McpToolDefinition[] = rawTools.map((t: any) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema || {},
        serverName: config.name,
      }));

      this.activeServers.get(config.name)!.tools = tools;
      return tools;
    } catch (err) {
      console.warn(`[KIN MCP] Handshake with '${config.name}' failed or timed out:`, err);
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
        resolve: (val) => {
          clearTimeout(timeout);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      entry.process.stdin?.write(payload + '\n');
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
   * Stops all active MCP server processes.
   */
  public shutdown(): void {
    for (const [name, entry] of this.activeServers.entries()) {
      try {
        entry.process.kill();
      } catch (err) {
        console.error(`[KIN MCP] Error killing ${name}:`, err);
      }
    }
    this.activeServers.clear();
  }
}
