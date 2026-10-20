import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpClientManager, McpServerConfig } from '../src/execution/mcp_client.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import { AgentLoopRunner } from '../src/kernel/agent_loop.js';

describe('MCP Connectors Management & Scope Lifecycle Suite', () => {
  let tempDir: string;
  let globalHomeDir: string;
  let projectDir: string;
  let origUserProfile: string | undefined;
  let origHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-connectors-test-'));
    globalHomeDir = path.join(tempDir, 'user_home');
    projectDir = path.join(tempDir, 'project_root');
    fs.mkdirSync(globalHomeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    origUserProfile = process.env.USERPROFILE;
    origHome = process.env.HOME;
    process.env.USERPROFILE = globalHomeDir;
    process.env.HOME = globalHomeDir;
    delete process.env.KIN_GLOBAL_CONFIG_DIR;
  });

  afterEach(() => {
    process.env.USERPROFILE = origUserProfile;
    process.env.HOME = origHome;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('manages connectors across Global and Project scopes: save, list, toggle, and delete', async () => {
    const mcpManager = new McpClientManager(projectDir);

    // Create a mock stdio server script
    const mockScript = path.join(tempDir, 'mock_worker.cjs');
    fs.writeFileSync(
      mockScript,
      `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'mock-worker' } } }));
        } else if (req.method === 'tools/list') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'run_action', description: 'Action', inputSchema: {} }] } }));
        }
      });
      `
    );

    // 1. Save global connector
    const saveGlobalRes = await mcpManager.saveConnector('global', 'globalSlack', {
      command: process.execPath,
      args: [mockScript],
      env: { SLACK_BOT_TOKEN: 'xoxb-test-mock' },
    });
    expect(saveGlobalRes.success).toBe(true);
    expect(saveGlobalRes.connector.name).toBe('globalSlack');
    expect(saveGlobalRes.connector.scope).toBe('global');
    expect(saveGlobalRes.tools.length).toBe(1);

    // 2. Save project connector
    const saveProjectRes = await mcpManager.saveConnector('project', 'projectDb', {
      command: process.execPath,
      args: [mockScript],
      env: { DB_PATH: './test.db' },
    });
    expect(saveProjectRes.success).toBe(true);
    expect(saveProjectRes.connector.name).toBe('projectDb');
    expect(saveProjectRes.connector.scope).toBe('project');

    // 3. List connectors returns both scopes
    const list = mcpManager.listConfiguredConnectors();
    expect(list.length).toBe(2);
    const globalItem = list.find((c) => c.name === 'globalSlack');
    const projectItem = list.find((c) => c.name === 'projectDb');
    expect(globalItem).toBeDefined();
    expect(globalItem?.scope).toBe('global');
    expect(projectItem).toBeDefined();
    expect(projectItem?.scope).toBe('project');

    // 4. Toggle connector disabled in project scope
    const toggleRes = await mcpManager.toggleConnector('project', 'projectDb', true);
    expect(toggleRes.success).toBe(true);
    expect(toggleRes.disabled).toBe(true);

    const listAfterToggle = mcpManager.listConfiguredConnectors();
    const disabledItem = listAfterToggle.find((c) => c.name === 'projectDb');
    expect(disabledItem?.disabled).toBe(true);
    expect(disabledItem?.status).toBe('stopped');

    // Re-enable project connector
    const toggleBack = await mcpManager.toggleConnector('project', 'projectDb', false);
    expect(toggleBack.success).toBe(true);
    expect(toggleBack.disabled).toBe(false);

    // 5. Delete connector
    const delRes = await mcpManager.deleteConnector('global', 'globalSlack');
    expect(delRes.success).toBe(true);

    const listAfterDel = mcpManager.listConfiguredConnectors();
    expect(listAfterDel.find((c) => c.name === 'globalSlack')).toBeUndefined();
    expect(listAfterDel.find((c) => c.name === 'projectDb')).toBeDefined();

    mcpManager.shutdown();
  });

  it('tests connector connectivity and tool discovery in complete isolation', async () => {
    const mcpManager = new McpClientManager(projectDir);

    const testScript = path.join(tempDir, 'test_probe.cjs');
    fs.writeFileSync(
      testScript,
      `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'probe' } } }));
        } else if (req.method === 'tools/list') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'probe_tool', description: 'Probe', inputSchema: {} }] } }));
        }
      });
      `
    );

    // Successful test probe
    const testResult = await mcpManager.testConnector({
      name: 'probeService',
      command: process.execPath,
      args: [testScript],
    }, 5000);

    expect(testResult.success).toBe(true);
    expect(testResult.toolsCount).toBe(1);
    expect(testResult.tools).toContain('probe_tool');
    expect(testResult.durationMs).toBeGreaterThanOrEqual(0);

    // Active servers must NOT contain the test probe
    expect(mcpManager.getAllServers().find((s) => s.name.startsWith('__test_'))).toBeUndefined();

    // Failing test probe (invalid executable)
    const failingResult = await mcpManager.testConnector({
      name: 'brokenService',
      command: 'non_existent_binary_xyz_123',
      args: [],
    }, 2000);

    expect(failingResult.success).toBe(false);
    expect(failingResult.toolsCount).toBe(0);
    expect(failingResult.error).toBeDefined();
    expect(failingResult.message).toContain('failed');

    mcpManager.shutdown();
  });

  it('CoreServer REST API: /api/mcp/connectors GET, POST save, toggle, test, and DELETE', async () => {
    const dbPath = path.join(tempDir, 'test_ipc.db');
    const server = new CoreServer({ port: 0, dbPath, requireIpcAuth: false });
    const port = await server.start();

    try {
      const mockScript = path.join(tempDir, 'api_mock.cjs');
      fs.writeFileSync(
        mockScript,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'api-mock' } } }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'api_tool', description: 'API Tool', inputSchema: {} }] } }));
          }
        });
        `
      );

      // 1. POST /api/mcp/connectors/test probe
      const testRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            command: process.execPath,
            args: [mockScript],
          },
        }),
      });
      const testJson = await testRes.json();
      expect(testRes.status).toBe(200);
      expect(testJson.success).toBe(true);
      expect(testJson.toolsCount).toBe(1);
      expect(testJson.tools).toContain('api_tool');

      // 2. POST /api/mcp/connectors/save (Global Scope)
      const saveRes1 = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          name: 'githubPreset',
          config: {
            command: process.execPath,
            args: [mockScript],
            env: { GITHUB_TOKEN: 'ghp_mock_token' },
          },
          projectRoot: projectDir,
        }),
      });
      const saveJson1 = await saveRes1.json();
      expect(saveRes1.status).toBe(200);
      expect(saveJson1.success).toBe(true);
      expect(saveJson1.connector.name).toBe('githubPreset');
      expect(saveJson1.connector.scope).toBe('global');
      expect(Array.isArray(saveJson1.connectors)).toBe(true);
      expect(saveJson1.connectors.some((c: any) => c.name === 'githubPreset')).toBe(true);

      // 3. POST /api/mcp/connectors/save (Project Scope)
      const saveRes2 = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          name: 'projectSqlite',
          config: {
            command: process.execPath,
            args: [mockScript],
            env: { DB_PATH: './project.sqlite' },
          },
          projectRoot: projectDir,
        }),
      });
      const saveJson2 = await saveRes2.json();
      expect(saveRes2.status).toBe(200);
      expect(saveJson2.success).toBe(true);
      expect(saveJson2.connector.name).toBe('projectSqlite');
      expect(saveJson2.connector.scope).toBe('project');
      expect(Array.isArray(saveJson2.connectors)).toBe(true);
      expect(saveJson2.connectors.some((c: any) => c.name === 'projectSqlite')).toBe(true);

      // 4. GET /api/mcp/connectors
      const getRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors?projectRoot=${encodeURIComponent(projectDir)}`);
      const getJson = await getRes.json();
      expect(getRes.status).toBe(200);
      expect(getJson.success).toBe(true);
      expect(getJson.count).toBe(2);
      expect(getJson.connectors.some((c: any) => c.name === 'githubPreset' && c.scope === 'global')).toBe(true);
      expect(getJson.connectors.some((c: any) => c.name === 'projectSqlite' && c.scope === 'project')).toBe(true);

      // 5. POST /api/mcp/connectors/toggle
      const toggleRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          name: 'projectSqlite',
          disabled: true,
          projectRoot: projectDir,
        }),
      });
      const toggleJson = await toggleRes.json();
      expect(toggleRes.status).toBe(200);
      expect(toggleJson.disabled).toBe(true);
      expect(Array.isArray(toggleJson.connectors)).toBe(true);
      expect(toggleJson.connectors.find((c: any) => c.name === 'projectSqlite')?.disabled).toBe(true);

      // 6. DELETE /api/mcp/connectors/:name
      const delRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/githubPreset?scope=global&projectRoot=${encodeURIComponent(projectDir)}`, {
        method: 'DELETE',
      });
      const delJson = await delRes.json();
      expect(delRes.status).toBe(200);
      expect(delJson.success).toBe(true);
      expect(Array.isArray(delJson.connectors)).toBe(true);
      expect(delJson.connectors.some((c: any) => c.name === 'githubPreset')).toBe(false);

      // Verify deletion in GET
      const getAfterDel = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors?projectRoot=${encodeURIComponent(projectDir)}`);
      const getAfterDelJson = await getAfterDel.json();
      expect(getAfterDelJson.count).toBe(1);
      expect(getAfterDelJson.connectors[0].name).toBe('projectSqlite');
    } finally {
      await server.stop();
    }
  });

  it('end-to-end: verifies MCP tool discovery and execution via ToolGateway', async () => {
    const mockCalcScript = path.join(tempDir, 'calc_worker.cjs');
    fs.writeFileSync(
      mockCalcScript,
      `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'calc-service' } } }));
        } else if (req.method === 'tools/list') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {
            tools: [{
              name: 'add_numbers',
              description: 'Adds two numbers',
              inputSchema: {
                type: 'object',
                properties: { a: { type: 'number' }, b: { type: 'number' } },
                required: ['a', 'b']
              }
            }]
          } }));
        } else if (req.method === 'tools/call') {
          const { a, b } = req.params?.arguments || {};
          console.log(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: String((a || 0) + (b || 0)) }]
            }
          }));
        }
      });
      `
    );

    const mcpManager = new McpClientManager(projectDir);
    await mcpManager.saveConnector('project', 'calculator', {
      command: process.execPath,
      args: [mockCalcScript],
    });

    const gateway = new ToolGateway({ mcpClient: mcpManager });
    const schemas = gateway.getToolSchemas();
    const toolSchema = schemas.find((s) => s.name === 'mcp__calculator__add_numbers');
    expect(toolSchema).toBeDefined();
    expect(toolSchema?.description).toContain('Adds two numbers');

    // Execute tool through ToolGateway
    const result = await gateway.executeTool(
      'mcp__calculator__add_numbers',
      { a: 42, b: 58 },
      {
        runId: 'run-e2e-1',
        agentId: 'agent-calc',
        projectId: 'proj-e2e',
        channelId: 'chan-e2e',
        worktreeRoot: projectDir,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['*'],
      }
    );

    expect(result.success).toBe(true);
    expect(result.output).toEqual([{ type: 'text', text: '100' }]);

    mcpManager.shutdown();
  });

  it('end-to-end: AgentLoopRunner discovers MCP tool and invokes it via ToolGateway', async () => {
    const mockCalcScript = path.join(tempDir, 'loop_calc.cjs');
    fs.writeFileSync(
      mockCalcScript,
      `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'calc' } } }));
        } else if (req.method === 'tools/list') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {
            tools: [{
              name: 'multiply',
              description: 'Multiplies two numbers',
              inputSchema: {
                type: 'object',
                properties: { x: { type: 'number' }, y: { type: 'number' } },
                required: ['x', 'y']
              }
            }]
          } }));
        } else if (req.method === 'tools/call') {
          const { x, y } = req.params?.arguments || {};
          console.log(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: String((x || 0) * (y || 0)) }]
            }
          }));
        }
      });
      `
    );

    const mcpManager = new McpClientManager(projectDir);
    await mcpManager.saveConnector('project', 'calculator', {
      command: process.execPath,
      args: [mockCalcScript],
    });

    const gateway = new ToolGateway({ mcpClient: mcpManager });
    const schemas = gateway.getToolSchemas();
    const toolSchema = schemas.find((s) => s.name === 'mcp__calculator__multiply');
    expect(toolSchema).toBeDefined();

    let turns = 0;
    const mockModelGateway: any = {
      invoke: async (params: any) => {
        turns++;
        if (turns === 1) {
          return {
            content: '<tool_call>{"name": "mcp__calculator__multiply", "parameters": {"x": 7, "y": 9}}</tool_call>',
            tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            durationMs: 20,
          };
        }
        // Turn 2: observation contains 63
        const lastMsg = params.messages[params.messages.length - 1];
        expect(lastMsg.content).toContain('63');
        return {
          content: 'The product is 63.',
          tokensUsed: { promptTokens: 30, completionTokens: 10, totalTokens: 40 },
          durationMs: 15,
        };
      },
    };

    const loopRunner = new AgentLoopRunner(
      mockModelGateway,
      gateway,
      {} as any,
      { matchSkills: () => [], recordExperience: () => {} } as any
    );

    const loopResult = await loopRunner.execute({
      modelId: 'test-model',
      userPrompt: 'Multiply 7 by 9',
      systemPrompt: 'You are a helpful assistant with tools.',
      worktreeRoot: projectDir,
      autonomyMode: 'FULL_AUTONOMOUS',
      allowedCapabilities: ['*'],
      maxTurns: 3,
    });

    expect(loopResult.finalContent).toBe('The product is 63.');
    expect(loopResult.actions.length).toBe(1);
    expect(loopResult.actions[0].toolName).toBe('mcp__calculator__multiply');
    expect(loopResult.actions[0].output).toEqual([{ type: 'text', text: '63' }]);

    mcpManager.shutdown();
  });

  it('edge case: rejects invalid connector names with path traversal or illegal characters', async () => {
    const mcpManager = new McpClientManager(projectDir);

    await expect(
      mcpManager.saveConnector('project', '../malicious', { command: 'node' })
    ).rejects.toThrow(/Invalid connector name/);

    await expect(
      mcpManager.saveConnector('project', 'has space', { command: 'node' })
    ).rejects.toThrow(/Invalid connector name/);

    await expect(
      mcpManager.saveConnector('project', 'semi;colon', { command: 'node' })
    ).rejects.toThrow(/Invalid connector name/);

    mcpManager.shutdown();
  });

  it('edge case: survives corrupted or malformed config files without throwing', async () => {
    const mcpManager = new McpClientManager(projectDir);

    // Write malformed JSON in project config
    const projConfigPath = mcpManager.getProjectConfigPath();
    fs.mkdirSync(path.dirname(projConfigPath), { recursive: true });
    fs.writeFileSync(projConfigPath, '{ corrupted json: not valid ...', 'utf-8');

    // listConfiguredConnectors should not crash
    const list = mcpManager.listConfiguredConnectors();
    expect(Array.isArray(list)).toBe(true);

    // loadConfiguredServers should not crash
    const tools = await mcpManager.loadConfiguredServers();
    expect(Array.isArray(tools)).toBe(true);

    mcpManager.shutdown();
  });

  it('edge case: project-scoped connector overrides global connector with the same name', async () => {
    const mcpManager = new McpClientManager(projectDir);

    const scriptA = path.join(tempDir, 'workerA.cjs');
    fs.writeFileSync(
      scriptA,
      `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'global-v1' } } }));
        } else if (req.method === 'tools/list') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'global_action', description: 'Global action', inputSchema: {} }] } }));
        }
      });
      `
    );

    const scriptB = path.join(tempDir, 'workerB.cjs');
    fs.writeFileSync(
      scriptB,
      `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'project-override' } } }));
        } else if (req.method === 'tools/list') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'project_action', description: 'Project action override', inputSchema: {} }] } }));
        }
      });
      `
    );

    // 1. Save global connector named 'serviceX'
    await mcpManager.saveConnector('global', 'serviceX', {
      command: process.execPath,
      args: [scriptA],
    });

    // 2. Save project connector named 'serviceX' (overriding global)
    await mcpManager.saveConnector('project', 'serviceX', {
      command: process.execPath,
      args: [scriptB],
    });

    // 3. Both appear in list with their respective scopes
    const list = mcpManager.listConfiguredConnectors();
    const globalItem = list.find((c) => c.name === 'serviceX' && c.scope === 'global');
    const projectItem = list.find((c) => c.name === 'serviceX' && c.scope === 'project');
    expect(globalItem).toBeDefined();
    expect(projectItem).toBeDefined();

    // 4. In active runtime servers, project config takes precedence
    const activeTools = await mcpManager.loadConfiguredServers();
    const hasProjectAction = activeTools.some((t) => t.name === 'project_action');
    expect(hasProjectAction).toBe(true);

    mcpManager.shutdown();
  });

  it('edge case: saves and toggles remote HTTP/SSE connector without command', async () => {
    const mcpManager = new McpClientManager(projectDir);

    // Save remote HTTP connector
    const saveRes = await mcpManager.saveConnector('project', 'remoteSseService', {
      url: 'http://127.0.0.1:9999/sse',
      transport: 'http',
      disabled: true,
    });

    expect(saveRes.success).toBe(true);
    expect(saveRes.connector.transport).toBe('http');
    expect(saveRes.connector.url).toBe('http://127.0.0.1:9999/sse');
    expect(saveRes.connector.disabled).toBe(true);

    // Toggle disabled
    const toggleRes = await mcpManager.toggleConnector('project', 'remoteSseService', true);
    expect(toggleRes.success).toBe(true);
    expect(toggleRes.disabled).toBe(true);

    mcpManager.shutdown();
  });

  it('edge case: ToolGateway handles MCP tool failure payload gracefully without crashing', async () => {
    const mockErrorScript = path.join(tempDir, 'error_worker.cjs');
    fs.writeFileSync(
      mockErrorScript,
      `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'error-service' } } }));
        } else if (req.method === 'tools/list') {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {
            tools: [{
              name: 'failing_action',
              description: 'Always fails',
              inputSchema: { type: 'object' }
            }]
          } }));
        } else if (req.method === 'tools/call') {
          console.log(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: 'Database query syntax error near SELECT' }],
              isError: true
            }
          }));
        }
      });
      `
    );

    const mcpManager = new McpClientManager(projectDir);
    await mcpManager.saveConnector('project', 'errorDb', {
      command: process.execPath,
      args: [mockErrorScript],
    });

    const gateway = new ToolGateway({ mcpClient: mcpManager });
    const result = await gateway.executeTool(
      'mcp__errorDb__failing_action',
      {},
      {
        runId: 'run-err-1',
        agentId: 'agent-err',
        projectId: 'proj-err',
        channelId: 'chan-err',
        worktreeRoot: projectDir,
        autonomyMode: 'AUTO',
        allowedCapabilities: ['*'],
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Database query syntax error');

    mcpManager.shutdown();
  });

  it('handles rapid concurrent saveConnector operations without race conditions or dropped entries', async () => {
    const mcpManager = new McpClientManager(projectDir);

    // Save 5 connectors concurrently
    const saves = await Promise.all([
      mcpManager.saveConnector('project', 'conn_alpha', { command: 'node', args: ['-e', 'process.exit(0)'], disabled: true }),
      mcpManager.saveConnector('project', 'conn_beta', { command: 'node', args: ['-e', 'process.exit(0)'], disabled: true }),
      mcpManager.saveConnector('project', 'conn_gamma', { command: 'node', args: ['-e', 'process.exit(0)'], disabled: true }),
      mcpManager.saveConnector('project', 'conn_delta', { command: 'node', args: ['-e', 'process.exit(0)'], disabled: true }),
      mcpManager.saveConnector('project', 'conn_epsilon', { command: 'node', args: ['-e', 'process.exit(0)'], disabled: true }),
    ]);

    expect(saves.length).toBe(5);
    for (const s of saves) {
      expect(s.success).toBe(true);
    }

    // Verify all 5 persist in the project config file
    const list = mcpManager.listConfiguredConnectors();
    expect(list.some((c) => c.name === 'conn_alpha')).toBe(true);
    expect(list.some((c) => c.name === 'conn_beta')).toBe(true);
    expect(list.some((c) => c.name === 'conn_gamma')).toBe(true);
    expect(list.some((c) => c.name === 'conn_delta')).toBe(true);
    expect(list.some((c) => c.name === 'conn_epsilon')).toBe(true);

    mcpManager.shutdown();
  });

  it('preserves and updates array-based mcp.json format without losing entries', async () => {
    const mcpManager = new McpClientManager(projectDir);
    const configPath = mcpManager.getProjectConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Seed config as an array of connectors
    const initialArray = [
      { name: 'legacyService1', command: 'node', args: ['-v'], disabled: true },
      { name: 'legacyService2', command: 'node', args: ['--help'], disabled: true },
    ];
    fs.writeFileSync(configPath, JSON.stringify(initialArray, null, 2), 'utf-8');

    // Save a new connector into this array-formatted file
    const saveRes = await mcpManager.saveConnector('project', 'newService3', {
      command: 'node',
      args: ['--version'],
      disabled: true,
    });
    expect(saveRes.success).toBe(true);

    // Verify file remains valid JSON and all 3 exist
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(3);
    expect(parsed.some((s: any) => s.name === 'legacyService1')).toBe(true);
    expect(parsed.some((s: any) => s.name === 'legacyService2')).toBe(true);
    expect(parsed.some((s: any) => s.name === 'newService3')).toBe(true);

    // Update legacyService1 in array
    await mcpManager.saveConnector('project', 'legacyService1', {
      command: 'node',
      args: ['-e', 'console.log(1)'],
      disabled: true,
    });
    const parsedAfterUpdate = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(parsedAfterUpdate.length).toBe(3);
    const updated1 = parsedAfterUpdate.find((s: any) => s.name === 'legacyService1');
    expect(updated1.args).toEqual(['-e', 'console.log(1)']);

    // Delete from array
    await mcpManager.deleteConnector('project', 'legacyService2');
    const parsedAfterDel = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(parsedAfterDel.length).toBe(2);
    expect(parsedAfterDel.some((s: any) => s.name === 'legacyService2')).toBe(false);

    mcpManager.shutdown();
  });

  it('preserves and updates Cursor-style servers dictionary format', async () => {
    const mcpManager = new McpClientManager(projectDir);
    const configPath = mcpManager.getProjectConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Seed Cursor-style { servers: { ... } } format
    const initialCursor = {
      servers: {
        cursorDb: { command: 'node', args: ['db.js'], disabled: true },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(initialCursor, null, 2), 'utf-8');

    // Save connector in project
    await mcpManager.saveConnector('project', 'cursorDb', {
      command: 'node',
      args: ['db_v2.js'],
      disabled: true,
    });

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(parsed.servers.cursorDb.args).toEqual(['db_v2.js']);

    mcpManager.shutdown();
  });

  it('supports case-insensitive connector lookup for toggle and delete', async () => {
    const mcpManager = new McpClientManager(projectDir);

    // Save with mixed case
    await mcpManager.saveConnector('project', 'PostgresDb', {
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      disabled: true,
    });

    // Toggle with lowercase
    const toggleRes = await mcpManager.toggleConnector('project', 'postgresdb', true);
    expect(toggleRes.success).toBe(true);

    // Delete with UPPERCASE
    const delRes = await mcpManager.deleteConnector('project', 'POSTGRESDB');
    expect(delRes.success).toBe(true);

    const list = mcpManager.listConfiguredConnectors();
    expect(list.some((c) => c.name.toLowerCase() === 'postgresdb')).toBe(false);

    mcpManager.shutdown();
  });

  it('accurately marks global connector as overridden when project connector shares the name', async () => {
    const mcpManager = new McpClientManager(projectDir);

    // Save in global
    await mcpManager.saveConnector('global', 'sharedApi', {
      command: 'node',
      args: ['global.js'],
      disabled: true,
    });

    // Save in project
    await mcpManager.saveConnector('project', 'sharedApi', {
      command: 'node',
      args: ['project.js'],
      disabled: true,
    });

    const list = mcpManager.listConfiguredConnectors();
    const globalItem = list.find((c) => c.name === 'sharedApi' && c.scope === 'global');
    const projectItem = list.find((c) => c.name === 'sharedApi' && c.scope === 'project');

    expect(globalItem).toBeDefined();
    expect(projectItem).toBeDefined();
    expect(globalItem?.overridden).toBe(true);
    expect(globalItem?.status).toBe('stopped');
    expect(projectItem?.overridden).toBeFalsy();

    mcpManager.shutdown();
  });

  it('CoreServer blocks directory traversal on connectors API with 403 Forbidden', async () => {
    const dbPath = path.join(tempDir, 'traversal_ipc.db');
    const server = new CoreServer({ port: 0, dbPath, requireIpcAuth: false });
    const port = await server.start();

    try {
      // 1. GET with forbidden traversal projectRoot
      const getRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors?projectRoot=${encodeURIComponent('../../../../dangerous')}`);
      expect(getRes.status).toBe(403);
      const getJson = await getRes.json();
      expect(getJson.error).toContain('Forbidden');

      // 2. POST save with forbidden traversal projectRoot
      const saveRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          name: 'hackedServer',
          projectRoot: '../../../../dangerous',
          config: { command: 'node' },
        }),
      });
      expect(saveRes.status).toBe(403);
      const saveJson = await saveRes.json();
      expect(saveJson.error).toContain('Forbidden');
    } finally {
      await server.stop();
    }
  });
});

