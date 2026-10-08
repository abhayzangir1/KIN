import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpClientManager } from '../src/execution/mcp_client.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { CoreServer } from '../src/server/core_server.js';

describe('MCP Runtime End-to-End Validation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-mcp-val-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('loads servers configured in .kin/mcp.json as well as .kin/mcp_servers.json', async () => {
    const kinDir = path.join(tempDir, '.kin');
    fs.mkdirSync(kinDir, { recursive: true });

    // Create a minimal Node stdio server script
    const serverScript = path.join(tempDir, 'mock_server.js');
    fs.writeFileSync(serverScript, `
      process.stdin.on('data', (d) => {
        const lines = d.toString().split('\\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line.trim());
          if (msg.method === 'initialize') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
          } else if (msg.method === 'tools/list') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'ping', description: 'Ping tool', inputSchema: {} }] } }) + '\\n');
          } else if (msg.method === 'tools/call') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'pong' }] } }) + '\\n');
          }
        }
      });
    `);

    // Write config to .kin/mcp.json (not mcp_servers.json)
    fs.writeFileSync(
      path.join(kinDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          mockService: {
            command: process.execPath,
            args: [serverScript],
          },
        },
      })
    );

    const client = new McpClientManager(tempDir);
    const tools = await client.loadConfiguredServers();

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('ping');
    expect(tools[0].serverName).toBe('mockService');

    // ToolGateway registration
    const gateway = new ToolGateway({ mcpClient: client });
    const schemas = gateway.getToolSchemas();
    const mcpSchema = schemas.find((s) => s.name === 'mcp__mockService__ping');
    expect(mcpSchema).toBeDefined();
    expect(mcpSchema?.description).toContain('Ping tool');

    // Direct invocation via mcp__ prefix
    const res1 = await gateway.executeTool('mcp__mockService__ping', {}, {
      runId: 'r1',
      agentId: 'ag1',
      projectId: 'p1',
      channelId: 'c1',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO',
      allowedCapabilities: ['*'],
    });
    expect(res1.success).toBe(true);
    expect(res1.output).toEqual([{ type: 'text', text: 'pong' }]);

    // Invocation via mcp:call alias
    const res2 = await gateway.executeTool('mcp:call', { server: 'mockService', tool: 'ping' }, {
      runId: 'r2',
      agentId: 'ag1',
      projectId: 'p1',
      channelId: 'c1',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO',
      allowedCapabilities: ['*'],
    });
    expect(res2.success).toBe(true);
    expect(res2.output).toEqual([{ type: 'text', text: 'pong' }]);

    client.shutdown();
  });

  it('CoreServer exposes POST /api/mcp/reload and mounts newly configured MCP servers', async () => {
    const kinDir = path.join(tempDir, '.kin');
    fs.mkdirSync(kinDir, { recursive: true });

    const serverScript = path.join(tempDir, 'dynamic_server.js');
    fs.writeFileSync(serverScript, `
      process.stdin.on('data', (d) => {
        const lines = d.toString().split('\\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line.trim());
          if (msg.method === 'initialize') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
          } else if (msg.method === 'tools/list') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'dynamic_action', description: 'Dynamic Action', inputSchema: {} }] } }) + '\\n');
          }
        }
      });
    `);

    fs.writeFileSync(
      path.join(kinDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          dynamicSrv: {
            command: process.execPath,
            args: [serverScript],
          },
        },
      })
    );

    const dbPath = path.join(tempDir, 'test.db');
    const server = new CoreServer({ port: 0, dbPath, requireIpcAuth: false });
    const actualPort = await server.start();

    try {
      const reloadRes = await fetch(`http://127.0.0.1:${actualPort}/api/mcp/reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: tempDir }),
      });
      const reloadData = await reloadRes.json();
      expect(reloadRes.status).toBe(200);
      expect(reloadData.success).toBe(true);
      expect(reloadData.toolsCount).toBe(1);
      expect(reloadData.tools[0].name).toBe('dynamic_action');

      const toolsRes = await fetch(`http://127.0.0.1:${actualPort}/api/mcp/tools`);
      const toolsData = await toolsRes.json();
      expect(toolsData.tools.length).toBe(1);
      expect(toolsData.tools[0].name).toBe('dynamic_action');
    } finally {
      await server.stop();
    }
  });
});
