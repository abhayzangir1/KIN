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
      let overviewReply: any = null;
      for (let i = 0; i < 25; i++) {
        const msgsRes1 = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`);
        const msgsData1: any = await msgsRes1.json();
        const candidate = msgsData1.messages.find((m) => m.content && m.content.includes('Active MCP Connectors & Tools'));
        if (candidate) {
          overviewReply = candidate;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(overviewReply?.content).toContain('Active MCP Connectors & Tools');
      expect(overviewReply?.content).toContain('testServer');

      // 4. Slash command: /mcp inspect inspectable_tool
      const inspectRes = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '/mcp inspect inspectable_tool', senderId: 'user-op' }),
      });
      expect(inspectRes.status).toBe(201);
      let inspectReply: any = null;
      for (let i = 0; i < 25; i++) {
        const msgsRes2 = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`);
        const msgsData2: any = await msgsRes2.json();
        const candidate = msgsData2.messages.find((m) => m.content && m.content.includes('MCP Tool Schema'));
        if (candidate) {
          inspectReply = candidate;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(inspectReply?.content).toContain('MCP Tool Schema');
      expect(inspectReply?.content).toContain('Inspectable Tool Description');

      // 5. Slash command: /mcp reload
      const reloadRes = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '/mcp reload', senderId: 'user-op' }),
      });
      expect(reloadRes.status).toBe(201);
      let reloadReply: any = null;
      for (let i = 0; i < 25; i++) {
        const msgsRes3 = await fetch(`http://127.0.0.1:${actualPort}/api/channels/chan-general/messages`);
        const msgsData3: any = await msgsRes3.json();
        const candidate = msgsData3.messages.find((m) => m.content && m.content.includes('MCP Servers Reloaded Successfully'));
        if (candidate) {
          reloadReply = candidate;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(reloadReply?.content).toContain('MCP Servers Reloaded Successfully');
    } finally {
      await server.stop();
    }
  });

  it('True MCP SSE transport: connects to /sse, negotiates endpoint, processes asynchronous responses, keep-alives, and bidirectional ping', async () => {
    let sseResponseStream: http.ServerResponse | null = null;
    let ssePingAcknowledged = false;

    const sseServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && parsedUrl.pathname === '/sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        sseResponseStream = res;
        // 1. Initial endpoint discovery event
        res.write(`event: endpoint\ndata: /messages?sessionId=test-sess-1\n\n`);
        // 2. Keep-alive heartbeat comment
        res.write(`: keepalive heartbeat\n\n`);
        return;
      }

      if (req.method === 'POST' && parsedUrl.pathname === '/messages') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const json = JSON.parse(body);

            // Handle client responding to server-initiated ping
            if (json.id === 'server-sse-ping-1') {
              ssePingAcknowledged = true;
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            // Standard MCP SSE asynchronous pattern: acknowledge with 202 Accepted and stream result via SSE
            res.writeHead(202);
            res.end();

            if (json.method === 'initialize') {
              sseResponseStream?.write(
                `event: message\ndata: ${JSON.stringify({
                  jsonrpc: '2.0',
                  id: json.id,
                  result: { protocolVersion: '2024-11-05', capabilities: {} },
                })}\n\n`
              );
              // Send server-to-client ping over SSE stream
              sseResponseStream?.write(
                `event: message\ndata: ${JSON.stringify({
                  jsonrpc: '2.0',
                  id: 'server-sse-ping-1',
                  method: 'ping',
                })}\n\n`
              );
            } else if (json.method === 'tools/list') {
              sseResponseStream?.write(
                `event: message\ndata: ${JSON.stringify({
                  jsonrpc: '2.0',
                  id: json.id,
                  result: {
                    tools: [
                      {
                        name: 'sse_action',
                        description: 'Action executed via SSE',
                        inputSchema: { type: 'object', properties: { val: { type: 'string' } } },
                      },
                    ],
                  },
                })}\n\n`
              );
            } else if (json.method === 'tools/call') {
              sseResponseStream?.write(
                `event: message\ndata: ${JSON.stringify({
                  jsonrpc: '2.0',
                  id: json.id,
                  result: {
                    content: [{ type: 'text', text: `received:${json.params?.arguments?.val}` }],
                  },
                })}\n\n`
              );
            }
          } catch {
            res.writeHead(400);
            res.end();
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => sseServer.listen(0, '127.0.0.1', () => resolve()));
    const address = sseServer.address() as any;
    const ssePort = address.port;

    try {
      const kinDir = path.join(tempDir, '.kin');
      fs.mkdirSync(kinDir, { recursive: true });

      fs.writeFileSync(
        path.join(kinDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            sseServer: {
              url: `http://127.0.0.1:${ssePort}/sse`,
            },
          },
        })
      );

      const client = new McpClientManager(tempDir);
      const tools = await client.loadConfiguredServers();

      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('sse_action');
      expect(tools[0].serverName).toBe('sseServer');

      const gateway = new ToolGateway({ mcpClient: client });
      const res = await gateway.executeTool('mcp__sseServer__sse_action', { val: 'alpha-test' }, {
        runId: 'r-sse',
        agentId: 'ag1',
        projectId: 'p1',
        channelId: 'c1',
        worktreeRoot: tempDir,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['*'],
      });

      expect(res.success).toBe(true);
      expect(res.output).toEqual([{ type: 'text', text: 'received:alpha-test' }]);
      expect(ssePingAcknowledged).toBe(true);

      client.shutdown();
    } finally {
      if (sseResponseStream) {
        try { (sseResponseStream as any).end(); } catch {}
      }
      await new Promise<void>((resolve) => sseServer.close(() => resolve()));
    }
  });

  it('MCP tools/list pagination: gathers tools across multiple pages using nextCursor', async () => {
    const pagedServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const json = JSON.parse(body || '{}');
        if (json.method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }));
        } else if (json.method === 'notifications/initialized') {
          res.writeHead(204);
          res.end();
        } else if (json.method === 'tools/list') {
          if (!json.params?.cursor) {
            // First page returns tool1 and cursor for page2
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: json.id,
              result: {
                tools: [{ name: 'tool_page_1', description: 'Page 1 Tool', inputSchema: {} }],
                nextCursor: 'cursor_page_2',
              },
            }));
          } else if (json.params.cursor === 'cursor_page_2') {
            // Second page returns tool2 and no nextCursor
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: json.id,
              result: {
                tools: [{ name: 'tool_page_2', description: 'Page 2 Tool', inputSchema: {} }],
              },
            }));
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    await new Promise<void>((resolve) => pagedServer.listen(0, '127.0.0.1', () => resolve()));
    const pagedPort = (pagedServer.address() as any).port;

    try {
      const client = new McpClientManager(tempDir);
      const tools = await client.startServer({
        name: 'pagedServer',
        url: `http://127.0.0.1:${pagedPort}/mcp`,
      });

      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.name)).toEqual(['tool_page_1', 'tool_page_2']);
      client.shutdown();
    } finally {
      await new Promise<void>((resolve) => pagedServer.close(() => resolve()));
    }
  });

  it('Server and tool name normalization in ToolGateway and McpClientManager', async () => {
    const normServer = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const json = JSON.parse(body || '{}');
        if (json.method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }));
        } else if (json.method === 'notifications/initialized') {
          res.writeHead(204);
          res.end();
        } else if (json.method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: {
              tools: [{ name: 'database-query', description: 'Runs DB query', inputSchema: {} }],
            },
          }));
        } else if (json.method === 'tools/call') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: { content: [{ type: 'text', text: `executed:${json.params.name}` }] },
          }));
        }
      });
    });

    await new Promise<void>((resolve) => normServer.listen(0, '127.0.0.1', () => resolve()));
    const normPort = (normServer.address() as any).port;

    try {
      const client = new McpClientManager(tempDir);
      // Server registered with hyphenated name
      await client.startServer({
        name: 'cloud-db',
        url: `http://127.0.0.1:${normPort}/mcp`,
      });

      const gateway = new ToolGateway({ mcpClient: client });

      // 1. Invocation using underscored server name: cloud_db
      const res1 = await gateway.executeTool('mcp__cloud_db__database_query', {}, {
        runId: 'r-norm-1',
        agentId: 'ag1',
        projectId: 'p1',
        channelId: 'c1',
        worktreeRoot: tempDir,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['*'],
      });
      expect(res1.success).toBe(true);
      expect(res1.output).toEqual([{ type: 'text', text: 'executed:database-query' }]);

      // 2. Invocation using mcp:call with normalized names and stringified arguments
      const res2 = await gateway.executeTool('mcp:call', {
        server: 'cloud_db',
        tool: 'database_query',
        arguments: '{"limit": 10}',
      }, {
        runId: 'r-norm-2',
        agentId: 'ag1',
        projectId: 'p1',
        channelId: 'c1',
        worktreeRoot: tempDir,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['*'],
      });
      expect(res2.success).toBe(true);
      expect(res2.output).toEqual([{ type: 'text', text: 'executed:database-query' }]);

      client.shutdown();
    } finally {
      await new Promise<void>((resolve) => normServer.close(() => resolve()));
    }
  });

  it('In-flight tool execution abort via AbortSignal cancels immediately without hanging', async () => {
    let callReceived = false;
    const hangServer = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const json = JSON.parse(body || '{}');
        if (json.method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }));
        } else if (json.method === 'notifications/initialized') {
          res.writeHead(204);
          res.end();
        } else if (json.method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: { tools: [{ name: 'long_task', description: 'Hangs', inputSchema: {} }] },
          }));
        } else if (json.method === 'tools/call') {
          callReceived = true;
          // Purposely do not respond immediately to simulate long-running process
          setTimeout(() => {
            try {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: { content: [] } }));
            } catch {}
          }, 5000);
        }
      });
    });

    await new Promise<void>((resolve) => hangServer.listen(0, '127.0.0.1', () => resolve()));
    const hangPort = (hangServer.address() as any).port;

    try {
      const client = new McpClientManager(tempDir);
      await client.startServer({
        name: 'hangSrv',
        url: `http://127.0.0.1:${hangPort}/mcp`,
      });

      const gateway = new ToolGateway({ mcpClient: client });
      const abortCtrl = new AbortController();

      const callPromise = gateway.executeTool('mcp__hangSrv__long_task', {}, {
        runId: 'r-abort',
        agentId: 'ag1',
        projectId: 'p1',
        channelId: 'c1',
        worktreeRoot: tempDir,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['*'],
        abortSignal: abortCtrl.signal,
      });

      // Abort after 50ms
      setTimeout(() => {
        abortCtrl.abort('User clicked cancel');
      }, 50);

      const res = await callPromise;
      expect(res.success).toBe(false);
      expect(res.error).toContain('aborted');

      client.shutdown();
    } finally {
      await new Promise<void>((resolve) => hangServer.close(() => resolve()));
    }
  });

  it('POST /api/mcp/reload forces reload of config file changes within the same project root', async () => {
    const kinDir = path.join(tempDir, '.kin');
    fs.mkdirSync(kinDir, { recursive: true });

    const mcpConfigFile = path.join(kinDir, 'mcp.json');
    // Start with empty mcpServers
    fs.writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: {} }));

    const dbPath = path.join(tempDir, 'reload_test.db');
    const server = new CoreServer({ port: 0, dbPath, requireIpcAuth: false });
    const actualPort = await server.start();

    try {
      // 1. Initial reload returns 0 tools
      const res1 = await fetch(`http://127.0.0.1:${actualPort}/api/mcp/reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: tempDir }),
      });
      const data1 = await res1.json();
      expect(data1.toolsCount).toBe(0);

      // 2. Now write a new server into .kin/mcp.json without changing projectRoot
      const srvScript = path.join(tempDir, 'new_tool_srv.js');
      fs.writeFileSync(srvScript, `
        process.stdin.on('data', (d) => {
          const lines = d.toString().split('\\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line.trim());
            if (msg.method === 'initialize') {
              process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
            } else if (msg.method === 'tools/list') {
              process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'brand_new_tool', inputSchema: {} }] } }) + '\\n');
            }
          }
        });
      `);

      fs.writeFileSync(mcpConfigFile, JSON.stringify({
        mcpServers: {
          hotReloadedServer: {
            command: process.execPath,
            args: [srvScript],
          },
        },
      }));

      // 3. POST /api/mcp/reload must force reload and pick up the new tool even though projectRoot is identical
      const res2 = await fetch(`http://127.0.0.1:${actualPort}/api/mcp/reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: tempDir }),
      });
      const data2 = await res2.json();
      expect(data2.success).toBe(true);
      expect(data2.toolsCount).toBe(1);
      expect(data2.tools[0].name).toBe('brand_new_tool');
      expect(data2.servers.length).toBe(1);
      expect(data2.servers[0].name).toBe('hotReloadedServer');
    } finally {
      await server.stop();
    }
  });

  it('loads global user connectors from ~/.kin/mcp.json and allows project-level overrides and disabled flags', async () => {
    const origUserProfile = process.env.USERPROFILE;
    const origHome = process.env.HOME;
    const globalHome = path.join(tempDir, 'global_home');
    const projectDir = path.join(tempDir, 'project_dir');
    const globalKinDir = path.join(globalHome, '.kin');
    const projectKinDir = path.join(projectDir, '.kin');
    fs.mkdirSync(globalKinDir, { recursive: true });
    fs.mkdirSync(projectKinDir, { recursive: true });

    process.env.USERPROFILE = globalHome;
    process.env.HOME = globalHome;

    try {
      // 1. Script for global server
      const globalScript = path.join(tempDir, 'global_srv.js');
      fs.writeFileSync(globalScript, `
        process.stdin.on('data', (d) => {
          const lines = d.toString().split('\\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line.trim());
            if (msg.method === 'initialize') {
              process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
            } else if (msg.method === 'tools/list') {
              process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'global_tool', inputSchema: {} }] } }) + '\\n');
            }
          }
        });
      `);

      // Write global config
      fs.writeFileSync(path.join(globalKinDir, 'mcp.json'), JSON.stringify({
        mcpServers: {
          globalService: {
            command: process.execPath,
            args: [globalScript],
          },
        },
      }));

      // Project initially has no config -> global servers are discovered
      const client = new McpClientManager(projectDir);
      const tools1 = await client.loadConfiguredServers();
      expect(tools1.length).toBe(1);
      expect(tools1[0].name).toBe('global_tool');
      expect(tools1[0].serverName).toBe('globalService');
      client.shutdown();

      // Now project config disables the global service
      fs.writeFileSync(path.join(projectKinDir, 'mcp.json'), JSON.stringify({
        mcpServers: {
          globalService: {
            disabled: true,
          },
        },
      }));

      const client2 = new McpClientManager(projectDir);
      const tools2 = await client2.loadConfiguredServers();
      expect(tools2.length).toBe(0);
      client2.shutdown();
    } finally {
      process.env.USERPROFILE = origUserProfile;
      process.env.HOME = origHome;
    }
  });
});
