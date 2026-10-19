import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { McpClientManager } from '../src/execution/mcp_client.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { SkillEngine } from '../src/skills/skill_engine.js';

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

  it('HTTP MCP remote transport: initializes, lists tools, and invokes tools over HTTP JSON-RPC', async () => {
    // Spin up lightweight Node HTTP server mimicking remote MCP server
    const httpServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const msg = JSON.parse(body);
          if (msg.method === 'initialize') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'remote-http-mcp', version: '1.0.0' }
              }
            }));
          } else if (msg.method === 'notifications/initialized') {
            res.writeHead(204);
            res.end();
          } else if (msg.method === 'tools/list') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                tools: [
                  {
                    name: 'remote_calc',
                    description: 'Performs arithmetic calculation remotely',
                    inputSchema: {
                      type: 'object',
                      properties: {
                        n: { type: 'number' }
                      },
                      required: ['n']
                    }
                  }
                ]
              }
            }));
          } else if (msg.method === 'tools/call') {
            const num = msg.params?.arguments?.n ?? 0;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [
                  { type: 'text', text: `calculated: ${num * 2}` }
                ]
              }
            }));
          } else {
            res.writeHead(404);
            res.end();
          }
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { message: err.message } }));
        }
      });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address() as any;
    const httpPort = address.port;

    try {
      const kinDir = path.join(tempDir, '.kin');
      fs.mkdirSync(kinDir, { recursive: true });

      fs.writeFileSync(
        path.join(kinDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            httpCalc: {
              url: `http://127.0.0.1:${httpPort}/mcp`,
            },
          },
        })
      );

      const client = new McpClientManager(tempDir);
      const tools = await client.loadConfiguredServers();

      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('remote_calc');
      expect(tools[0].serverName).toBe('httpCalc');

      const allServers = client.getAllServers();
      expect(allServers.length).toBe(1);
      expect(allServers[0].name).toBe('httpCalc');
      expect(allServers[0].transport).toBe('http');
      expect(allServers[0].toolsCount).toBe(1);
      expect(allServers[0].tools).toEqual(['remote_calc']);

      const gateway = new ToolGateway({ mcpClient: client });
      const res = await gateway.executeTool('mcp__httpCalc__remote_calc', { n: 21 }, {
        runId: 'r-http',
        agentId: 'ag1',
        projectId: 'p1',
        channelId: 'c1',
        worktreeRoot: tempDir,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['*'],
      });

      expect(res.success).toBe(true);
      expect(res.output).toEqual([{ type: 'text', text: 'calculated: 42' }]);

      client.shutdown();
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('Stdio MCP protocol compliance: responds to server-initiated ping and roots/list requests', async () => {
    const kinDir = path.join(tempDir, '.kin');
    fs.mkdirSync(kinDir, { recursive: true });

    const serverScript = path.join(tempDir, 'bidirectional_server.js');
    fs.writeFileSync(serverScript, `
      let pingAcknowledged = false;
      let rootsAcknowledged = false;

      process.stdin.on('data', (d) => {
        const lines = d.toString().split('\\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line.trim());
          if (msg.id === 'server-ping-req') {
            pingAcknowledged = true;
          }
          if (msg.id === 'server-roots-req' && msg.result && Array.isArray(msg.result.roots)) {
            rootsAcknowledged = true;
          }
          if (msg.method === 'initialize') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
            // Immediately dispatch server-initiated requests to client
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'server-ping-req', method: 'ping' }) + '\\n');
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'server-roots-req', method: 'roots/list' }) + '\\n');
          } else if (msg.method === 'tools/list') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'check_protocol_compliance', description: 'Checks compliance', inputSchema: {} }] } }) + '\\n');
          } else if (msg.method === 'tools/call') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ pingAcknowledged, rootsAcknowledged }) }] } }) + '\\n');
          }
        }
      });
    `);

    fs.writeFileSync(
      path.join(kinDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          bidiServer: {
            command: process.execPath,
            args: [serverScript],
          },
        },
      })
    );

    const client = new McpClientManager(tempDir);
    const tools = await client.loadConfiguredServers();
    expect(tools.length).toBe(1);

    // Call the tool to verify the server received the client's automated ping and roots/list responses
    const gateway = new ToolGateway({ mcpClient: client });
    const res = await gateway.executeTool('mcp__bidiServer__check_protocol_compliance', {}, {
      runId: 'r-bidi',
      agentId: 'ag1',
      projectId: 'p1',
      channelId: 'c1',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO',
      allowedCapabilities: ['*'],
    });

    expect(res.success).toBe(true);
    const parsed = JSON.parse(res.output[0].text);
    expect(parsed.pingAcknowledged).toBe(true);
    expect(parsed.rootsAcknowledged).toBe(true);

    client.shutdown();
  });

  it('Dynamic skill tool routing, name normalization, and capability gating in ToolGateway', async () => {
    const dbPath = path.join(tempDir, 'skills_test.db');
    const db = new KinDatabase({ dbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    const skillEngine = new SkillEngine(db);
    skillEngine.seedDefaultSkills();

    // Verify hyphen/underscore and case-insensitive normalization in SkillEngine.getSkill
    const s1 = skillEngine.getSkill('sqlite-optimization');
    const s2 = skillEngine.getSkill('sqlite_optimization');
    const s3 = skillEngine.getSkill('SQLITE-OPTIMIZATION');
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect(s3).toBeDefined();
    expect(s1?.id).toBe(s2?.id);

    // Create a dynamic tool extension skill
    const skillId = 'skill-calc-ext';
    db.execute(
      `INSERT INTO skills (id, name, version, description, instructions, required_tools_json, trigger_patterns_json, is_built_in, status, evidence_count, success_count, failure_count, parameters_json, handler_code, skill_type, enabled, created_at, updated_at)
       VALUES (?, ?, '1.0.0', 'Dynamic Calc Skill', 'Instructions for calc', '[]', '["calc"]', 0, 'active', 0, 0, 0, ?, ?, 'tool_extension', 1, ?, ?)`,
      skillId,
      'calc_ext',
      JSON.stringify({ type: 'object', properties: { val: { type: 'number' } } }),
      'return { doubled: params.val * 2 };',
      Date.now(),
      Date.now()
    );

    const gateway = new ToolGateway({ skillEngine });

    // Verify getToolSchemas exposes skill__ prefix
    const schemas = gateway.getToolSchemas();
    const calcSchema = schemas.find((s) => s.name === 'skill__calc_ext');
    expect(calcSchema).toBeDefined();
    expect(calcSchema?.description).toBe('Dynamic Calc Skill');

    // Verify capability mappings
    expect(gateway.getRequiredCapability('skill__calc_ext').primary).toBe('skills:manage');
    expect(gateway.getRequiredCapability('skill_calc_ext').primary).toBe('skills:manage');
    expect(gateway.getRequiredCapability('skill__sqlite_optimization').primary).toBe('skills:manage');
    expect(gateway.getRequiredCapability('create_skill').primary).toBe('skills:manage');
    expect(gateway.getRequiredCapability('import_skill').primary).toBe('skills:manage');
    expect(gateway.getRequiredCapability('execute_skill').primary).toBe('skills:manage');

    // Execution rejected when agent lacks skills:manage capability
    const deniedRes = await gateway.executeTool('skill__calc_ext', { val: 10 }, {
      runId: 'r-denied',
      agentId: 'ag1',
      projectId: 'p1',
      channelId: 'c1',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO',
      allowedCapabilities: ['workspace:read'],
    });
    expect(deniedRes.success).toBe(false);
    expect(deniedRes.error).toContain("lacks required capability 'skills:manage'");

    // Execution succeeds when agent has skills:manage capability (using skill__ prefix)
    const allowedRes1 = await gateway.executeTool('skill__calc_ext', { val: 15 }, {
      runId: 'r-allowed-1',
      agentId: 'ag1',
      projectId: 'p1',
      channelId: 'c1',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO',
      allowedCapabilities: ['skills:manage'],
    });
    expect(allowedRes1.success).toBe(true);
    expect(allowedRes1.output).toEqual({ doubled: 30 });

    // Execution succeeds when agent invokes using skill_ prefix (single underscore alias)
    const allowedRes2 = await gateway.executeTool('skill_calc_ext', { val: 20 }, {
      runId: 'r-allowed-2',
      agentId: 'ag1',
      projectId: 'p1',
      channelId: 'c1',
      worktreeRoot: tempDir,
      autonomyMode: 'AUTO',
      allowedCapabilities: ['skills:manage'],
    });
    expect(allowedRes2.success).toBe(true);
    expect(allowedRes2.output).toEqual({ doubled: 40 });

    db.close();
  });

  it('CoreServer GET /api/mcp/servers and /mcp slash commands (overview, inspect, reload)', async () => {
    const kinDir = path.join(tempDir, '.kin');
    fs.mkdirSync(kinDir, { recursive: true });

    const serverScript = path.join(tempDir, 'srv_slash.js');
    fs.writeFileSync(serverScript, `
      process.stdin.on('data', (d) => {
        const lines = d.toString().split('\\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line.trim());
          if (msg.method === 'initialize') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
          } else if (msg.method === 'tools/list') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'inspectable_tool', description: 'Inspectable Tool Description', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] } }) + '\\n');
          }
        }
      });
    `);

    fs.writeFileSync(
      path.join(kinDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          testServer: {
            command: process.execPath,
            args: [serverScript],
          },
        },
      })
    );

    const dbPath = path.join(tempDir, 'server_test.db');
    const server = new CoreServer({ port: 0, dbPath, requireIpcAuth: false });
    const actualPort = await server.start();

    try {
      // 1. Explicitly reload to pick up testServer
      await fetch(`http://127.0.0.1:${actualPort}/api/mcp/reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: tempDir }),
      });

      // 2. GET /api/mcp/servers
      const serversRes = await fetch(`http://127.0.0.1:${actualPort}/api/mcp/servers`);
      expect(serversRes.status).toBe(200);
      const serversData: any = await serversRes.json();
      expect(serversData.success).toBe(true);
      expect(serversData.count).toBe(1);
      expect(serversData.servers[0].name).toBe('testServer');
      expect(serversData.servers[0].transport).toBe('stdio');
      expect(serversData.servers[0].toolsCount).toBe(1);
      expect(serversData.servers[0].tools).toContain('inspectable_tool');

      // 3. Slash command: /mcp overview
      const overviewRes = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '/mcp', senderId: 'user-op' }),
      });
      expect(overviewRes.status).toBe(201);
      const msgsRes1 = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`);
      const msgsData1: any = await msgsRes1.json();
      const overviewReply = msgsData1.messages[msgsData1.messages.length - 1];
      expect(overviewReply.content).toContain('Active MCP Connectors & Tools');
      expect(overviewReply.content).toContain('testServer');

      // 4. Slash command: /mcp inspect inspectable_tool
      const inspectRes = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '/mcp inspect inspectable_tool', senderId: 'user-op' }),
      });
      expect(inspectRes.status).toBe(201);
      const msgsRes2 = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`);
      const msgsData2: any = await msgsRes2.json();
      const inspectReply = msgsData2.messages[msgsData2.messages.length - 1];
      expect(inspectReply.content).toContain('MCP Tool Schema');
      expect(inspectReply.content).toContain('Inspectable Tool Description');

      // 5. Slash command: /mcp reload
      const reloadRes = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '/mcp reload', senderId: 'user-op' }),
      });
      expect(reloadRes.status).toBe(201);
      const msgsRes3 = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`);
      const msgsData3: any = await msgsRes3.json();
      const reloadReply = msgsData3.messages[msgsData3.messages.length - 1];
      expect(reloadReply.content).toContain('MCP Servers Reloaded Successfully');
    } finally {
      await server.stop();
    }
  });
});
