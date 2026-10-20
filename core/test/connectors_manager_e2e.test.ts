import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { McpClientManager, McpServerConfig } from '../src/execution/mcp_client.js';
import { CoreServer } from '../src/server/core_server.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';

describe('Connectors Manager & MCP End-to-End Test Suite', () => {
  let tempDir: string;
  let tempGlobalDir: string;
  let prevGlobalEnv: string | undefined;
  let prevIsolateEnv: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-conn-test-proj-'));
    tempGlobalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-conn-test-global-'));
    prevGlobalEnv = process.env.KIN_GLOBAL_CONFIG_DIR;
    prevIsolateEnv = process.env.KIN_ISOLATE_GLOBAL_MCP;
    process.env.KIN_GLOBAL_CONFIG_DIR = tempGlobalDir;
    delete process.env.KIN_ISOLATE_GLOBAL_MCP;
  });

  afterEach(() => {
    if (prevGlobalEnv !== undefined) {
      process.env.KIN_GLOBAL_CONFIG_DIR = prevGlobalEnv;
    } else {
      delete process.env.KIN_GLOBAL_CONFIG_DIR;
    }
    if (prevIsolateEnv !== undefined) {
      process.env.KIN_ISOLATE_GLOBAL_MCP = prevIsolateEnv;
    } else {
      delete process.env.KIN_ISOLATE_GLOBAL_MCP;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(tempGlobalDir, { recursive: true, force: true });
    } catch {}
  });

  const createMockServerScript = (filename: string, tools: Array<{ name: string; description: string; response: any }>) => {
    const scriptPath = path.join(tempDir, filename);
    const toolsJson = JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: 'object' } })));
    const callsObj: Record<string, any> = {};
    for (const t of tools) {
      callsObj[t.name] = t.response;
    }
    const callsJson = JSON.stringify(callsObj);

    fs.writeFileSync(
      scriptPath,
      `
      const tools = ${toolsJson};
      const responses = ${callsJson};
      process.stdin.on('data', (d) => {
        const lines = d.toString().split('\\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line.trim());
            if (msg.method === 'initialize') {
              process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1.0' } } }) + '\\n');
            } else if (msg.method === 'notifications/initialized') {
              // noop
            } else if (msg.method === 'tools/list') {
              process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools } }) + '\\n');
            } else if (msg.method === 'tools/call') {
              const res = responses[msg.params?.name] || 'ok';
              process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res) }] } }) + '\\n');
            }
          } catch {}
        }
      });
      process.on('SIGTERM', () => process.exit(0));
      process.on('SIGINT', () => process.exit(0));
    `
    );
    return scriptPath;
  };

  it('1. McpClientManager: listConfiguredConnectors reads global and project scopes with tool introspection', async () => {
    const srv1 = createMockServerScript('srv1.js', [{ name: 'global_ping', description: 'Global Ping', response: 'pong' }]);
    const srv2 = createMockServerScript('srv2.js', [{ name: 'project_query', description: 'Project Query', response: 'done' }]);

    // Write global config
    const globalKin = path.join(tempGlobalDir, '.kin');
    fs.mkdirSync(globalKin, { recursive: true });
    fs.writeFileSync(
      path.join(globalKin, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          globalService: {
            command: process.execPath,
            args: [srv1],
            env: { API_KEY: 'secret123' },
          },
        },
      })
    );

    // Write project config
    const projKin = path.join(tempDir, '.kin');
    fs.mkdirSync(projKin, { recursive: true });
    fs.writeFileSync(
      path.join(projKin, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          projectService: {
            command: process.execPath,
            args: [srv2],
          },
        },
      })
    );

    const client = new McpClientManager(tempDir);
    // Start active servers
    await client.loadConfiguredServers();

    const connectors = client.listConfiguredConnectors();
    expect(connectors.length).toBe(2);

    const projConn = connectors.find((c) => c.name === 'projectService');
    const globConn = connectors.find((c) => c.name === 'globalService');

    expect(projConn).toBeDefined();
    expect(projConn!.scope).toBe('project');
    expect(projConn!.status).toBe('active');
    expect(projConn!.toolsCount).toBe(1);
    expect((projConn!.tools[0] as any).name).toBe('project_query');

    expect(globConn).toBeDefined();
    expect(globConn!.scope).toBe('global');
    expect(globConn!.status).toBe('active');
    expect(globConn!.toolsCount).toBe(1);
    expect((globConn!.tools[0] as any).name).toBe('global_ping');

    client.shutdown();
  });

  it('2. McpClientManager: saveConnector creates and hot-reloads new connector in global or project scope', async () => {
    const srv = createMockServerScript('dynamic_srv.js', [{ name: 'calculator', description: 'Calc', response: '42' }]);
    const client = new McpClientManager(tempDir);

    // Save project connector
    const saveRes = await client.saveConnector('project', 'myCalc', {
      command: process.execPath,
      args: [srv],
    });

    expect(saveRes.success).toBe(true);
    expect(saveRes.connector.name).toBe('myCalc');
    expect(saveRes.connector.scope).toBe('project');
    expect(saveRes.tools.length).toBe(1);
    expect(saveRes.tools[0].name).toBe('calculator');

    // Verify config file was written to <tempDir>/.kin/mcp.json
    const writtenPath = path.join(tempDir, '.kin', 'mcp.json');
    expect(fs.existsSync(writtenPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(writtenPath, 'utf-8'));
    expect(parsed.mcpServers.myCalc).toBeDefined();
    expect(parsed.mcpServers.myCalc.command).toBe(process.execPath);

    // Call tool directly
    const callRes = await client.callTool('myCalc', 'calculator', {});
    expect(callRes.content[0].text).toBe('42');

    client.shutdown();
  });

  it('3. McpClientManager: toggleConnector disables and re-enables server with clean process lifecycle', async () => {
    const srv = createMockServerScript('toggle_srv.js', [{ name: 'echo', description: 'Echo', response: 'hello' }]);
    const client = new McpClientManager(tempDir);

    await client.saveConnector('project', 'toggleSrv', {
      command: process.execPath,
      args: [srv],
    });

    expect(client.getAllTools().some((t) => t.name === 'echo')).toBe(true);

    // Disable connector
    const toggleOff = await client.toggleConnector('project', 'toggleSrv', true);
    expect(toggleOff.success).toBe(true);
    expect(toggleOff.disabled).toBe(true);
    expect(toggleOff.toolsCount).toBe(0);
    expect(client.getAllTools().some((t) => t.name === 'echo')).toBe(false);

    // Verify file persists disabled: true
    const parsedOff = JSON.parse(fs.readFileSync(path.join(tempDir, '.kin', 'mcp.json'), 'utf-8'));
    expect(parsedOff.mcpServers.toggleSrv.disabled).toBe(true);

    // Re-enable connector
    const toggleOn = await client.toggleConnector('project', 'toggleSrv', false);
    expect(toggleOn.success).toBe(true);
    expect(toggleOn.disabled).toBe(false);
    expect(toggleOn.toolsCount).toBe(1);
    expect(client.getAllTools().some((t) => t.name === 'echo')).toBe(true);

    client.shutdown();
  });

  it('4. McpClientManager: deleteConnector removes connector from file and terminates active process', async () => {
    const srv = createMockServerScript('del_srv.js', [{ name: 'ephemeral', description: 'Ephemeral', response: 'temp' }]);
    const client = new McpClientManager(tempDir);

    await client.saveConnector('project', 'toDelete', {
      command: process.execPath,
      args: [srv],
    });

    expect(client.getAllTools().some((t) => t.name === 'ephemeral')).toBe(true);

    const delRes = await client.deleteConnector('project', 'toDelete');
    expect(delRes.success).toBe(true);

    // Verify deleted from file
    const parsed = JSON.parse(fs.readFileSync(path.join(tempDir, '.kin', 'mcp.json'), 'utf-8'));
    expect(parsed.mcpServers.toDelete).toBeUndefined();

    // Verify tool evicted
    expect(client.getAllTools().some((t) => t.name === 'ephemeral')).toBe(false);

    client.shutdown();
  });

  it('5. McpClientManager: testConnector probes connection in complete isolation without polluting active servers', async () => {
    const srv = createMockServerScript('test_target.js', [
      { name: 'alpha', description: 'Alpha Tool', response: '1' },
      { name: 'beta', description: 'Beta Tool', response: '2' },
    ]);
    const client = new McpClientManager(tempDir);

    const testRes = await client.testConnector({
      command: process.execPath,
      args: [srv],
    });

    expect(testRes.success).toBe(true);
    expect(testRes.toolsCount).toBe(2);
    expect(testRes.tools).toContain('alpha');
    expect(testRes.tools).toContain('beta');
    expect(testRes.durationMs).toBeGreaterThan(0);

    // Active servers must remain clean (test server was temporary)
    expect(client.getAllServers().length).toBe(0);
    expect(client.getAllTools().length).toBe(0);

    // Invalid executable test
    const failRes = await client.testConnector({
      command: 'non_existent_executable_12345',
      args: [],
    });
    expect(failRes.success).toBe(false);
    expect(failRes.toolsCount).toBe(0);

    client.shutdown();
  });

  it('6. CoreServer REST Endpoints: GET, POST, TOGGLE, DELETE, and TEST for connectors', async () => {
    const dbPath = path.join(tempDir, 'core_test.sqlite');
    const srvScript = createMockServerScript('api_srv.js', [{ name: 'api_tool', description: 'API Tool', response: 'ok' }]);

    const server = new CoreServer({ port: 0, dbPath, requireIpcAuth: false });
    const port = await server.start();

    try {
      // 1. GET /api/mcp/connectors (initially clean)
      const getRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors?projectRoot=${encodeURIComponent(tempDir)}`);
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.success).toBe(true);
      expect(Array.isArray(getJson.connectors)).toBe(true);

      // 2. POST /api/mcp/connectors/save
      const saveRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          name: 'restConnector',
          config: {
            command: process.execPath,
            args: [srvScript],
          },
          projectRoot: tempDir,
        }),
      });
      expect(saveRes.status).toBe(200);
      const saveJson = await saveRes.json();
      expect(saveJson.success).toBe(true);
      expect(saveJson.connector.name).toBe('restConnector');
      expect(saveJson.toolsCount).toBe(1);

      // 3. GET /api/mcp/connectors/:name
      const singleRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/restConnector?projectRoot=${encodeURIComponent(tempDir)}`);
      expect(singleRes.status).toBe(200);
      const singleJson = await singleRes.json();
      expect(singleJson.success).toBe(true);
      expect(singleJson.connector.name).toBe('restConnector');

      // 4. POST /api/mcp/connectors/test
      const testRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            command: process.execPath,
            args: [srvScript],
          },
        }),
      });
      expect(testRes.status).toBe(200);
      const testJson = await testRes.json();
      expect(testJson.success).toBe(true);
      expect(testJson.toolsCount).toBe(1);
      expect(testJson.tools).toContain('api_tool');

      // 5. POST /api/mcp/connectors/toggle
      const toggleRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          name: 'restConnector',
          disabled: true,
          projectRoot: tempDir,
        }),
      });
      expect(toggleRes.status).toBe(200);
      const toggleJson = await toggleRes.json();
      expect(toggleJson.success).toBe(true);
      expect(toggleJson.disabled).toBe(true);

      // 6. DELETE /api/mcp/connectors/:name
      const delRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/restConnector?scope=project&projectRoot=${encodeURIComponent(tempDir)}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);
      const delJson = await delRes.json();
      expect(delJson.success).toBe(true);

      // Verify it's gone
      const verifyRes = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/restConnector?projectRoot=${encodeURIComponent(tempDir)}`);
      expect(verifyRes.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('7. Standard Connectors Server: end-to-end execution of calculate and query_sqlite tools', async () => {
    // Ensure standard connectors script is provisioned in tempGlobalDir
    const scriptPath = McpClientManager.ensureStandardConnectorsServer();
    expect(scriptPath).toBeDefined();
    expect(fs.existsSync(scriptPath!)).toBe(true);

    const client = new McpClientManager(tempDir);
    const testRes = await client.testConnector({
      command: process.execPath,
      args: [scriptPath!],
    });

    expect(testRes.success).toBe(true);
    expect(testRes.toolsCount).toBe(4);
    expect(testRes.tools).toContain('get_system_info');
    expect(testRes.tools).toContain('calculate');
    expect(testRes.tools).toContain('get_time');
    expect(testRes.tools).toContain('query_sqlite');

    // Mount server and call calculate tool
    await client.saveConnector('project', 'sysStandard', {
      command: process.execPath,
      args: [scriptPath!],
    });

    const calcResult = await client.callTool('sysStandard', 'calculate', { expression: '(100 * 2) + 25' });
    expect(calcResult.isError).toBeFalsy();
    expect(calcResult.content[0].text).toBe('225');

    // Call SQLite tool
    const sqlResult = await client.callTool('sysStandard', 'query_sqlite', { sql: 'SELECT 40 + 2 AS answer' });
    expect(sqlResult.isError).toBeFalsy();
    const rows = JSON.parse(sqlResult.content[0].text!);
    expect(rows[0].answer).toBe(42);

    client.shutdown();
  });
});
