// ============================================================================
// KIN END-TO-END VERIFICATION: SCHEDULER, CRON SPECIFICATIONS & MCP LIFECYCLE
// 
// Validates end-to-end integration:
// 1. Schedule dispatch reaching an agent, and failed dispatch recovery/retry.
// 2. Calendar cron timing calculation against known POSIX specifications.
// 3. MCP supervisor lifecycle: process exit cleanup, reload on project activation,
//    and awaited startup discovery.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { CoreServer } from '../src/server/core_server.js';
import { SchedulerService } from '../src/automation/scheduler.js';
import { getNextCronOccurrence, validateCronExpression } from '../src/automation/cron_calendar.js';
import { McpClientManager } from '../src/execution/mcp_client.js';

describe('KIN End-to-End Suite: Scheduler Dispatch, POSIX Cron, and MCP Supervisor', () => {
  let tempDir: string;
  let tempDbPath: string;
  let db: KinDatabase;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), 'temp_e2e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    fs.mkdirSync(tempDir, { recursive: true });
    tempDbPath = path.join(tempDir, 'test.sqlite');
    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    // Seed test workspace and default project
    db.execute(
      `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-default', 'Default', ?, 'AUTO', ?, ?)`,
      tempDir,
      Date.now(),
      Date.now()
    );
    db.execute(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('proj-kin', 'ws-default', 'KIN Project', ?, '{}', ?, ?)`,
      tempDir,
      Date.now(),
      Date.now()
    );
    db.execute(
      `INSERT OR IGNORE INTO channels (id, project_id, name, is_private, created_at) VALUES ('chan-general', 'proj-kin', 'general', 0, ?)`,
      Date.now()
    );
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // PART 1: Schedule Dispatch Reaching an Agent & Failed Recovery/Retry
  // ==========================================================================
  describe('1. Schedule Dispatch Reaching an Agent & Recovery Flows', () => {
    it('dispatches schedule to channel, notifies target agent, and enqueues wakeup without polling', async () => {
      const now = Date.now();
      // Register specialist agent and orchestrator with definitions
      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-sec', 'Security Specialist', 'Security Specialist', 'System prompt', 'ollama/qwen2.5-coder:3b', ?)`,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at) VALUES ('agent-sec', 'ws-default', 'proj-kin', 'def-sec', '@SecSpecialist', 'ollama/qwen2.5-coder:3b', 0, ?, ?)`,
        now,
        now
      );
      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-boss', 'Lead Orchestrator', 'Lead Orchestrator', 'System prompt', 'ollama/qwen2.5-coder:3b', ?)`,
        now
      );
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at) VALUES ('agent-boss', 'ws-default', 'proj-kin', 'def-boss', '@Orchestrator', 'ollama/qwen2.5-coder:3b', 1, ?, ?)`,
        now,
        now
      );

      const server = new CoreServer({
        port: 0,
        dbPath: tempDbPath,
        requireIpcAuth: false,
      });
      await server.start();

      const scheduler = server.getScheduler();
      const sched = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        targetAgentId: 'agent-sec',
        prompt: 'Audit workspace configurations and file permissions',
        durationSeconds: 1,
      });

      // Advance schedule next_run_at into the past so it triggers immediately
      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 5000, sched.id);

      const fired = await scheduler.evaluatePendingSchedules();
      expect(fired).toHaveLength(1);
      expect(fired[0].id).toBe(sched.id);

      // Verify schedule transitioned to completed with iteration count 1
      const updatedSched = scheduler.getSchedule(sched.id);
      expect(updatedSched?.status).toBe('completed');
      expect(updatedSched?.currentIterations).toBe(1);

      // Verify attempt history was recorded in SQLite
      const attempts = scheduler.getScheduleAttempts(sched.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('success');
      expect(attempts[0].attemptNumber).toBe(1);

      // Verify automated channel message was generated by agent-sec
      const messages = db.query<any>(
        'SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC',
        'chan-general'
      );
      expect(messages.length).toBeGreaterThan(0);
      const wakeMsg = messages[0];
      expect(wakeMsg.sender_id).toBe('agent-sec');
      expect(wakeMsg.content).toContain('Audit workspace configurations and file permissions');

      // Verify wakeup item was recorded for the agent
      const queueStats = (server as any).wakeupQueue.getStats();
      expect(queueStats.totalEnqueued).toBeGreaterThan(0);

      await server.stop();
    });

    it('records failed attempt on dispatch exception and successfully recovers on retry via HTTP API', async () => {
      const server = new CoreServer({
        port: 0,
        dbPath: tempDbPath,
        requireIpcAuth: false,
      });
      const port = await server.start();
      const scheduler = server.getScheduler();

      let shouldFail = true;
      // Configure dispatch hook to fail initially
      scheduler.onScheduleFired(async () => {
        if (shouldFail) {
          throw new Error('Downstream worker capacity exhausted');
        }
      });

      const sched = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Execute dynamic integration analysis',
        durationSeconds: 1,
      });

      // Force schedule into past
      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 5000, sched.id);

      const fired = await scheduler.evaluatePendingSchedules();
      expect(fired).toHaveLength(0); // Failed dispatch not counted as fired

      // Status must be failed with lastError captured
      const failedSched = scheduler.getSchedule(sched.id);
      expect(failedSched?.status).toBe('failed');
      expect(failedSched?.lastError).toContain('Downstream worker capacity exhausted');

      // Attempt history has 1 failed attempt
      let attempts = scheduler.getScheduleAttempts(sched.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('failure');
      expect(attempts[0].errorMessage).toContain('Downstream worker capacity exhausted');

      // Now recover: resolve downstream issue and call POST /api/schedules/:id/retry
      shouldFail = false;
      const retryRes = await fetch(`http://127.0.0.1:${port}/api/schedules/${sched.id}/retry`, {
        method: 'POST',
      });
      expect(retryRes.status).toBe(200);
      const retryBody = await retryRes.json();
      expect(retryBody.schedule.status).toBe('completed');
      expect(retryBody.schedule.currentIterations).toBe(1);

      // Verify attempts history now has 2 attempts (1 failure, 1 success)
      attempts = scheduler.getScheduleAttempts(sched.id);
      expect(attempts).toHaveLength(2);
      expect(attempts[0].status).toBe('failure');
      expect(attempts[1].status).toBe('success');

      // Verify GET /api/schedules/:id/attempts and /api/automations/:id/attempts HTTP endpoints return both attempts
      const attemptsRes = await fetch(`http://127.0.0.1:${port}/api/schedules/${sched.id}/attempts`);
      expect(attemptsRes.status).toBe(200);
      const attemptsBody = await attemptsRes.json();
      expect(attemptsBody.attempts).toHaveLength(2);

      const automationsAttemptsRes = await fetch(`http://127.0.0.1:${port}/api/automations/${sched.id}/attempts`);
      expect(automationsAttemptsRes.status).toBe(200);
      const automationsAttemptsBody = await automationsAttemptsRes.json();
      expect(automationsAttemptsBody.attempts).toHaveLength(2);

      await server.stop();
    });

    it('rejects manual trigger when schedule is completed or exceeds iteration boundary', async () => {
      const server = new CoreServer({
        port: 0,
        dbPath: tempDbPath,
        requireIpcAuth: false,
      });
      const port = await server.start();
      const scheduler = server.getScheduler();

      const cronSched = scheduler.createCronSchedule({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Bounded recurring check',
        cronExpression: '*/10 * * * *',
        maxIterations: 1,
      });

      // Trigger 1: completes iteration 1 (reaching maxIterations: 1, so status becomes completed)
      const trigRes1 = await fetch(`http://127.0.0.1:${port}/api/schedules/${cronSched.id}/trigger`, {
        method: 'POST',
      });
      expect(trigRes1.status).toBe(200);

      // Trigger 2: fails because schedule is no longer active
      const trigRes2 = await fetch(`http://127.0.0.1:${port}/api/schedules/${cronSched.id}/trigger`, {
        method: 'POST',
      });
      expect(trigRes2.status).toBe(400);
      const body2 = await trigRes2.json();
      expect(body2.error).toMatch(/status is 'completed'|max_iterations/);

      await server.stop();
    });
  });

  // ==========================================================================
  // PART 2: Calendar Cron Timing Calculation against Known POSIX Specifications
  // ==========================================================================
  describe('2. Calendar Cron Timing Calculation against POSIX Specifications', () => {
    it('computes next calendar occurrence for fixed-time expressions (30 2 * * *)', () => {
      const expr = '30 2 * * *';
      expect(validateCronExpression(expr).valid).toBe(true);

      // From 01:15 AM on May 10, 2026 local time -> should fire at 02:30 AM on the same day
      const fromTime1 = new Date(2026, 4, 10, 1, 15, 0);
      const next1 = getNextCronOccurrence(expr, fromTime1);
      expect(next1.getFullYear()).toBe(2026);
      expect(next1.getMonth()).toBe(4);
      expect(next1.getDate()).toBe(10);
      expect(next1.getHours()).toBe(2);
      expect(next1.getMinutes()).toBe(30);

      // From 02:35 AM on May 10, 2026 local time -> should advance to 02:30 AM on the next day (May 11)
      const fromTime2 = new Date(2026, 4, 10, 2, 35, 0);
      const next2 = getNextCronOccurrence(expr, fromTime2);
      expect(next2.getDate()).toBe(11);
      expect(next2.getHours()).toBe(2);
      expect(next2.getMinutes()).toBe(30);
    });

    it('computes workday intervals and advances past weekends (0 9 * * 1-5)', () => {
      const expr = '0 9 * * 1-5';
      expect(validateCronExpression(expr).valid).toBe(true);

      // July 10, 2026 is a Friday. Evaluate at 10:00 AM (after 09:00 AM run)
      const fridayAfternoon = new Date(2026, 6, 10, 10, 0, 0);
      expect(fridayAfternoon.getDay()).toBe(5); // Friday

      const nextWorkday = getNextCronOccurrence(expr, fridayAfternoon);
      // Next occurrence must be Monday July 13, 2026 at 09:00 AM
      expect(nextWorkday.getDay()).toBe(1); // Monday
      expect(nextWorkday.getDate()).toBe(13);
      expect(nextWorkday.getHours()).toBe(9);
      expect(nextWorkday.getMinutes()).toBe(0);
    });

    it('enforces POSIX dual day-of-month and day-of-week union behavior (0 12 15 * 1)', () => {
      // POSIX standard rule: when both DOM and DOW are specified, fire if EITHER condition matches
      const expr = '0 12 15 * 1';
      expect(validateCronExpression(expr).valid).toBe(true);

      // September 1, 2026 is Tuesday. 15th is Tuesday. First Monday is September 7.
      const fromStart = new Date(2026, 8, 1, 0, 0, 0);
      const firstHit = getNextCronOccurrence(expr, fromStart);

      // Monday Sept 7 should match by day-of-week
      expect(firstHit.getDate()).toBe(7);
      expect(firstHit.getDay()).toBe(1); // Monday
      expect(firstHit.getHours()).toBe(12);

      // Now evaluate from Monday Sept 7 at 13:00 -> next hit is Monday Sept 14
      const secondHit = getNextCronOccurrence(expr, new Date(2026, 8, 7, 13, 0, 0));
      expect(secondHit.getDate()).toBe(14);
      expect(secondHit.getDay()).toBe(1);

      // Now evaluate from Monday Sept 14 at 13:00 -> next hit is 15th (Tuesday) by day-of-month
      const thirdHit = getNextCronOccurrence(expr, new Date(2026, 8, 14, 13, 0, 0));
      expect(thirdHit.getDate()).toBe(15);
      expect(thirdHit.getDay()).toBe(2); // Tuesday, but matched by DOM!
    });

    it('supports step ranges and calculates exact minute boundaries (10-30/10 * * * *)', () => {
      const expr = '10-30/10 * * * *';
      expect(validateCronExpression(expr).valid).toBe(true);

      const fromTime = new Date(2026, 2, 1, 14, 5, 0);
      const hit1 = getNextCronOccurrence(expr, fromTime);
      expect(hit1.getMinutes()).toBe(10);

      const hit2 = getNextCronOccurrence(expr, hit1);
      expect(hit2.getMinutes()).toBe(20);

      const hit3 = getNextCronOccurrence(expr, hit2);
      expect(hit3.getMinutes()).toBe(30);

      const hit4 = getNextCronOccurrence(expr, hit3);
      expect(hit4.getHours()).toBe(15);
      expect(hit4.getMinutes()).toBe(10);
    });

    it('correctly handles leap year leap day (0 0 29 2 *)', () => {
      const expr = '0 0 29 2 *';
      expect(validateCronExpression(expr).valid).toBe(true);

      // Starting from 2026 (non-leap year)
      const fromTime = new Date(2026, 0, 1, 0, 0, 0);
      const nextLeapDay = getNextCronOccurrence(expr, fromTime);

      expect(nextLeapDay.getFullYear()).toBe(2028);
      expect(nextLeapDay.getMonth()).toBe(1); // February (0-indexed)
      expect(nextLeapDay.getDate()).toBe(29);
      expect(nextLeapDay.getHours()).toBe(0);
      expect(nextLeapDay.getMinutes()).toBe(0);
    });

    it('treats both 0 and 7 as Sunday per POSIX specification', () => {
      const expr0 = '0 6 * * 0';
      const expr7 = '0 6 * * 7';
      expect(validateCronExpression(expr0).valid).toBe(true);
      expect(validateCronExpression(expr7).valid).toBe(true);

      const fromTime = new Date(2026, 3, 15, 0, 0, 0); // Wednesday April 15, 2026
      const hit0 = getNextCronOccurrence(expr0, fromTime);
      const hit7 = getNextCronOccurrence(expr7, fromTime);

      expect(hit0.getTime()).toBe(hit7.getTime());
      expect(hit0.getDay()).toBe(0); // Sunday
      expect(hit0.getDate()).toBe(19); // April 19, 2026
    });

    it('rejects invalid or out-of-range cron expressions', () => {
      expect(validateCronExpression('').valid).toBe(false);
      expect(validateCronExpression('* * *').valid).toBe(false);
      expect(validateCronExpression('* * * * * *').valid).toBe(false);
      expect(validateCronExpression('60 * * * *').valid).toBe(false); // Minute out of range
      expect(validateCronExpression('* 24 * * *').valid).toBe(false); // Hour out of range
      expect(validateCronExpression('* * 32 * *').valid).toBe(false); // DOM out of range
      expect(validateCronExpression('* * * 13 *').valid).toBe(false); // Month out of range
      expect(validateCronExpression('* * * 0 *').valid).toBe(false);  // Month 0 invalid
      expect(validateCronExpression('* * * * 8').valid).toBe(false);  // DOW out of range
      expect(validateCronExpression('invalid_text').valid).toBe(false);
    });
  });

  // ==========================================================================
  // PART 3: MCP Supervisor Lifecycle & Project Reloading
  // ==========================================================================
  describe('3. MCP Supervisor Lifecycle: Supervision, Reloading & Discovery', () => {
    it('cleans up resources and unmounts tools immediately when MCP process is stopped', async () => {
      const scriptPath = path.join(tempDir, 'supervised_mcp.cjs');
      fs.writeFileSync(
        scriptPath,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'supervised' } } }));
          } else if (req.method === 'notifications/initialized') {
            // Handshake completed
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'ping_tool', description: 'Ping', inputSchema: {} }] } }));
          } else if (req.method === 'tools/call') {
            if (req.params.name === 'ping_tool') {
              console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { pong: true } }));
            }
          }
        });
        `
      );

      const mcpManager = new McpClientManager(tempDir);
      const tools = await mcpManager.startServer({
        name: 'supervisedServer',
        command: process.execPath,
        args: [scriptPath],
      });
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('ping_tool');

      // Call tool successfully
      const res = await mcpManager.callTool('supervisedServer', 'ping_tool', {});
      expect((res as any).pong).toBe(true);

      // Now terminate the server process via stopServer
      mcpManager.stopServer('supervisedServer');

      // Tools should be immediately cleared
      expect(mcpManager.getAllTools()).toHaveLength(0);

      // Calling tool now should fail immediately
      await expect(mcpManager.callTool('supervisedServer', 'ping_tool', {})).rejects.toThrow(
        /not running|not found|not connected/
      );

      mcpManager.shutdown();
    });

    it('reloads MCP servers when switching active project', async () => {
      const projectADir = path.join(tempDir, 'projectA');
      const projectBDir = path.join(tempDir, 'projectB');
      fs.mkdirSync(projectADir, { recursive: true });
      fs.mkdirSync(projectBDir, { recursive: true });

      const scriptA = path.join(projectADir, 'mcp_a.cjs');
      fs.writeFileSync(
        scriptA,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'serverA' } } }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'tool_from_project_a', description: 'Tool A', inputSchema: {} }] } }));
          }
        });
        `
      );

      const scriptB = path.join(projectBDir, 'mcp_b.cjs');
      fs.writeFileSync(
        scriptB,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'serverB' } } }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'tool_from_project_b', description: 'Tool B', inputSchema: {} }] } }));
          }
        });
        `
      );

      // Configure .kin/mcp_servers.json in each project
      const dotKinA = path.join(projectADir, '.kin');
      fs.mkdirSync(dotKinA, { recursive: true });
      fs.writeFileSync(
        path.join(dotKinA, 'mcp_servers.json'),
        JSON.stringify({
          mcpServers: {
            serverA: {
              command: process.execPath,
              args: [scriptA],
            },
          },
        })
      );

      const dotKinB = path.join(projectBDir, '.kin');
      fs.mkdirSync(dotKinB, { recursive: true });
      fs.writeFileSync(
        path.join(dotKinB, 'mcp_servers.json'),
        JSON.stringify({
          mcpServers: {
            serverB: {
              command: process.execPath,
              args: [scriptB],
            },
          },
        })
      );

      // Point initial active project 'proj-kin' to projectADir
      db.execute(`UPDATE projects SET repo_path = ? WHERE id = 'proj-kin'`, projectADir);

      // Register project B in database
      db.execute(
        `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('proj-b', 'ws-default', 'Project Beta', ?, '{}', ?, ?)`,
        projectBDir,
        Date.now(),
        Date.now()
      );

      // Start CoreServer with initial project A (from proj-kin)
      const server = new CoreServer({
        port: 0,
        dbPath: tempDbPath,
        requireIpcAuth: false,
      });
      const port = await server.start();

      // Tool catalog for Project A must have tool_from_project_a
      const toolsResA = await fetch(`http://127.0.0.1:${port}/api/mcp/tools`);
      const toolsBodyA = await toolsResA.json();
      expect(toolsBodyA.tools.some((t: any) => t.name === 'tool_from_project_a')).toBe(true);
      expect(toolsBodyA.tools.some((t: any) => t.name === 'tool_from_project_b')).toBe(false);

      // Now activate Project B via POST /api/projects/:id/activate
      const activateRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-b/activate`, {
        method: 'POST',
      });
      expect(activateRes.status).toBe(200);

      // Tool catalog must now reflect Project B's tools, with Project A's tools evicted
      const toolsResB = await fetch(`http://127.0.0.1:${port}/api/mcp/tools`);
      const toolsBodyB = await toolsResB.json();
      expect(toolsBodyB.tools.some((t: any) => t.name === 'tool_from_project_a')).toBe(false);
      expect(toolsBodyB.tools.some((t: any) => t.name === 'tool_from_project_b')).toBe(true);

      await server.stop();
    });

    it('awaits MCP tool discovery during server start before serving requests', async () => {
      const projectDir = path.join(tempDir, 'projectStartup');
      fs.mkdirSync(projectDir, { recursive: true });

      const script = path.join(projectDir, 'startup_mcp.cjs');
      fs.writeFileSync(
        script,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'startupServer' } } }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'startup_ready_tool', description: 'Startup Tool', inputSchema: {} }] } }));
          }
        });
        `
      );

      const dotKin = path.join(projectDir, '.kin');
      fs.mkdirSync(dotKin, { recursive: true });
      fs.writeFileSync(
        path.join(dotKin, 'mcp_servers.json'),
        JSON.stringify({
          mcpServers: {
            startupServer: {
              command: process.execPath,
              args: [script],
            },
          },
        })
      );

      // Point initial project 'proj-kin' to projectDir
      db.execute(`UPDATE projects SET repo_path = ? WHERE id = 'proj-kin'`, projectDir);

      const server = new CoreServer({
        port: 0,
        dbPath: tempDbPath,
        requireIpcAuth: false,
      });

      // When start() resolves, startup tool discovery was fully awaited
      const port = await server.start();

      // Tool must be immediately present without delay or polling
      const toolsRes = await fetch(`http://127.0.0.1:${port}/api/mcp/tools`);
      const toolsBody = await toolsRes.json();
      expect(toolsBody.tools.some((t: any) => t.name === 'startup_ready_tool')).toBe(true);

      await server.stop();
    });
  });
});
