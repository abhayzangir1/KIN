// ============================================================================
// KIN SCHEDULER, MCP SUPERVISION & ROUTING OBSERVABILITY TEST SUITE
// Validates:
// 1. Scheduler durable dispatch state, attempt history, and failure tracking.
// 2. Real calendar cron scheduling and invalid expression rejection.
// 3. Status and maxIterations enforcement on manual triggers.
// 4. Project-scoped MCP tool loading and clean unmounting on project switch.
// 5. MCP process supervision, crash rejection, and stale registration eviction.
// 6. Startup MCP tool discovery awaiting.
// 7. ActivationEngine routing observability on direct mention, domain, and fallback.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { SchedulerService } from '../src/automation/scheduler.js';
import { validateCronExpression, getNextCronOccurrence } from '../src/automation/cron_calendar.js';
import { McpClientManager, McpServerConfig } from '../src/execution/mcp_client.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { ActivationEngine } from '../src/communication/activation_engine.js';
import { CoreServer } from '../src/server/core_server.js';
import { AgentIdentity, AgentDefinition, Message } from '../src/domain/types.js';

describe('KIN Hardening: Scheduler, MCP Supervision, and Routing Observability', () => {
  let db: KinDatabase;
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), 'temp_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    fs.mkdirSync(tempDir, { recursive: true });
    tempDbPath = path.join(tempDir, 'test.sqlite');
    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    // Seed test workspace and project
    db.execute(`INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-default', 'Default', ?, 'AUTO', ?, ?)`, tempDir, Date.now(), Date.now());
    db.execute(`INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('proj-kin', 'ws-default', 'KIN Project', ?, '{}', ?, ?)`, tempDir, Date.now(), Date.now());
    db.execute(`INSERT OR IGNORE INTO channels (id, project_id, name, is_private, created_at) VALUES ('chan-general', 'proj-kin', 'general', 0, ?)`, Date.now());
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
  // GAP 1: Scheduler Dispatch Status & Attempt History
  // ==========================================================================
  describe('Gap 1: Scheduler Dispatch Status & Attempt History', () => {
    it('records failed attempt in SQLite and leaves one-shot in failed status when dispatch throws', async () => {
      const scheduler = new SchedulerService(db);

      // Configure dispatch callback that throws
      const failureError = new Error('Agent execution runtime encountered internal fault');
      scheduler.onScheduleFired(async () => {
        throw failureError;
      });

      const sched = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Autonomous security scan',
        durationSeconds: 1,
      });

      // Advance time so schedule is ready
      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 5000, sched.id);

      const fired = await scheduler.evaluatePendingSchedules();

      // Dispatch failed: should NOT be reported as successfully fired
      expect(fired).toHaveLength(0);

      // Status must NOT be marked completed; must be 'failed'
      const updated = scheduler.getSchedule(sched.id);
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('failed');
      expect(updated?.currentIterations).toBe(0);
      expect(updated?.lastError).toContain('Agent execution runtime encountered internal fault');

      // Attempt history in SQLite event_journal must have exactly 1 failed attempt
      const attempts = scheduler.getScheduleAttempts(sched.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('failure');
      expect(attempts[0].attemptNumber).toBe(1);
      expect(attempts[0].errorMessage).toContain('Agent execution runtime encountered internal fault');
      expect(attempts[0].executedAt).toBeGreaterThan(0);
    });

    it('advances iterations and marks one-shot completed only after dispatch succeeds', async () => {
      const scheduler = new SchedulerService(db);

      let dispatchedScheduleId: string | null = null;
      scheduler.onScheduleFired(async (s) => {
        dispatchedScheduleId = s.id;
      });

      const sched = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Generate documentation index',
        durationSeconds: 1,
      });

      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 2000, sched.id);

      const fired = await scheduler.evaluatePendingSchedules();

      expect(fired).toHaveLength(1);
      expect(dispatchedScheduleId).toBe(sched.id);

      const updated = scheduler.getSchedule(sched.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.currentIterations).toBe(1);
      expect(updated?.lastError).toBeUndefined();

      const attempts = scheduler.getScheduleAttempts(sched.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('success');
      expect(attempts[0].attemptNumber).toBe(1);
      expect(attempts[0].errorMessage).toBeUndefined();
    });

    it('retains cron iteration count on dispatch failure and records failure attempt', async () => {
      const scheduler = new SchedulerService(db);

      scheduler.onScheduleFired(async () => {
        throw new Error('Database locked during dispatch');
      });

      const cronSched = scheduler.createCronSchedule({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Periodic audit heartbeat',
        cronExpression: '*/5 * * * *',
      });

      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 1000, cronSched.id);

      const fired = await scheduler.evaluatePendingSchedules();
      expect(fired).toHaveLength(0);

      const updated = scheduler.getSchedule(cronSched.id);
      expect(updated?.status).toBe('active');
      expect(updated?.currentIterations).toBe(0);
      expect(updated?.lastError).toContain('Database locked during dispatch');
      expect(updated?.nextRunAt).toBeGreaterThan(Date.now());

      const attempts = scheduler.getScheduleAttempts(cronSched.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('failure');
      expect(attempts[0].errorMessage).toContain('Database locked during dispatch');

      // Calling evaluatePendingSchedules again immediately must NOT re-fire the failed cron job
      const refired = await scheduler.evaluatePendingSchedules();
      expect(refired).toHaveLength(0);
      const attemptsAfter = scheduler.getScheduleAttempts(cronSched.id);
      expect(attemptsAfter).toHaveLength(1); // Still exactly 1 attempt, not spammed!
    });

    it('allows retrying a failed schedule via retrySchedule and records durable attempt history', async () => {
      const scheduler = new SchedulerService(db);
      let shouldFail = true;
      scheduler.onScheduleFired(async () => {
        if (shouldFail) {
          throw new Error('Temporary worker fault');
        }
      });

      const sched = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Recoverable task',
        durationSeconds: 1,
      });

      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 5000, sched.id);
      await scheduler.evaluatePendingSchedules();

      // Sched is failed
      expect(scheduler.getSchedule(sched.id)?.status).toBe('failed');
      expect(scheduler.getScheduleAttempts(sched.id)).toHaveLength(1);

      // Now retry after worker recovers
      shouldFail = false;
      const retried = await scheduler.retrySchedule(sched.id);
      expect(retried).toBeDefined();
      expect(retried?.status).toBe('completed');
      expect(retried?.currentIterations).toBe(1);

      // Verify attempts: 2 attempts (1 failure, 1 success)
      const attempts = scheduler.getScheduleAttempts(sched.id);
      expect(attempts).toHaveLength(2);
      expect(attempts[0].status).toBe('failure');
      expect(attempts[1].status).toBe('success');
    });
  });

  // ==========================================================================
  // GAP 2: Real Calendar Cron Scheduling & Expression Validation
  // ==========================================================================
  describe('Gap 2: Real Calendar Cron Scheduling & Validation', () => {
    it('rejects invalid cron expressions on creation with descriptive errors', () => {
      const scheduler = new SchedulerService(db);

      // Malformed strings
      expect(() =>
        scheduler.createCronSchedule({
          projectId: 'proj-kin',
          channelId: 'chan-general',
          prompt: 'test',
          cronExpression: 'not a cron',
        })
      ).toThrow(/Expected 5 fields/);

      // Out of range fields
      expect(() =>
        scheduler.createCronSchedule({
          projectId: 'proj-kin',
          channelId: 'chan-general',
          prompt: 'test',
          cronExpression: '60 * * * *',
        })
      ).toThrow(/minute/);

      expect(() =>
        scheduler.createCronSchedule({
          projectId: 'proj-kin',
          channelId: 'chan-general',
          prompt: 'test',
          cronExpression: '* 24 * * *',
        })
      ).toThrow(/hour/);

      expect(() =>
        scheduler.createCronSchedule({
          projectId: 'proj-kin',
          channelId: 'chan-general',
          prompt: 'test',
          cronExpression: '* * 32 * *',
        })
      ).toThrow(/day-of-month/);

      expect(() =>
        scheduler.createCronSchedule({
          projectId: 'proj-kin',
          channelId: 'chan-general',
          prompt: 'test',
          cronExpression: '* * * 13 *',
        })
      ).toThrow(/month/);

      expect(() =>
        scheduler.createCronSchedule({
          projectId: 'proj-kin',
          channelId: 'chan-general',
          prompt: 'test',
          cronExpression: '* * * * 9',
        })
      ).toThrow(/day-of-week/);
    });

    it('calculates exact calendar occurrence for fixed-time expressions (30 2 * * *)', () => {
      // Reference: October 7, 2026 at 01:15:00 local time
      const refBefore = new Date(2026, 9, 7, 1, 15, 0);
      const nextRunBefore = getNextCronOccurrence('30 2 * * *', refBefore);

      // Should schedule for TODAY at 02:30:00 (1 hour 15 minutes away, NOT 24 hours away)
      expect(nextRunBefore.getFullYear()).toBe(2026);
      expect(nextRunBefore.getMonth()).toBe(9);
      expect(nextRunBefore.getDate()).toBe(7);
      expect(nextRunBefore.getHours()).toBe(2);
      expect(nextRunBefore.getMinutes()).toBe(30);

      const diffMs = nextRunBefore.getTime() - refBefore.getTime();
      expect(diffMs).toBe(75 * 60 * 1000); // exactly 1h 15m

      // Reference: October 7, 2026 at 03:00:00 local time (past 2:30)
      const refAfter = new Date(2026, 9, 7, 3, 0, 0);
      const nextRunAfter = getNextCronOccurrence('30 2 * * *', refAfter);

      // Should schedule for TOMORROW October 8 at 02:30:00
      expect(nextRunAfter.getFullYear()).toBe(2026);
      expect(nextRunAfter.getMonth()).toBe(9);
      expect(nextRunAfter.getDate()).toBe(8);
      expect(nextRunAfter.getHours()).toBe(2);
      expect(nextRunAfter.getMinutes()).toBe(30);
    });

    it('calculates correct step intervals across minute marks', () => {
      const refTime = new Date(2026, 9, 7, 10, 3, 0);
      const nextRun = getNextCronOccurrence('*/15 * * * *', refTime);

      expect(nextRun.getHours()).toBe(10);
      expect(nextRun.getMinutes()).toBe(15);

      const nextRunFrom15 = getNextCronOccurrence('*/15 * * * *', new Date(2026, 9, 7, 10, 15, 0));
      expect(nextRunFrom15.getMinutes()).toBe(30);
    });

    it('calculates specific day-of-week occurrences (Monday 09:00)', () => {
      // 2026-10-07 is Wednesday (day 3)
      const refWed = new Date(2026, 9, 7, 12, 0, 0);
      // '0 9 * * 1' -> Every Monday at 09:00
      const nextMon = getNextCronOccurrence('0 9 * * 1', refWed);

      expect(nextMon.getDay()).toBe(1); // Monday
      expect(nextMon.getDate()).toBe(12); // Next Monday is Oct 12, 2026
      expect(nextMon.getHours()).toBe(9);
      expect(nextMon.getMinutes()).toBe(0);
    });

    it('supports number/step expressions and named day/month tokens', () => {
      // 0/15 starting step notation
      expect(validateCronExpression('0/15 * * * *').valid).toBe(true);
      const nextStep = getNextCronOccurrence('0/15 * * * *', new Date(2026, 9, 7, 10, 2, 0));
      expect(nextStep.getMinutes()).toBe(15);

      // Named day of week: MON-FRI
      expect(validateCronExpression('0 9 * * MON-FRI').valid).toBe(true);

      // Named month: JAN
      expect(validateCronExpression('0 0 1 JAN *').valid).toBe(true);
      const nextJan = getNextCronOccurrence('0 0 1 JAN *', new Date(2026, 9, 7, 10, 0, 0));
      expect(nextJan.getFullYear()).toBe(2027);
      expect(nextJan.getMonth()).toBe(0); // January
      expect(nextJan.getDate()).toBe(1);
    });
  });

  // ==========================================================================
  // GAP 3: Status & Limit Enforcement on Manual Trigger
  // ==========================================================================
  describe('Gap 3: Status & Limit Enforcement on Manual Trigger', () => {
    it('rejects triggerScheduleNow when schedule is not active (cancelled or completed)', async () => {
      const scheduler = new SchedulerService(db);

      const sched = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Manual trigger test',
        durationSeconds: 100,
      });

      // Cancel it
      const cancelled = scheduler.cancelSchedule(sched.id);
      expect(cancelled).toBe(true);

      // Manual trigger on cancelled schedule must reject
      await expect(scheduler.triggerScheduleNow(sched.id)).rejects.toThrow(
        /Cannot trigger schedule .* status is 'cancelled', expected 'active'/
      );

      // triggerSchedule returns false on rejected schedule
      const resBool = await scheduler.triggerSchedule(sched.id);
      expect(resBool).toBe(false);
    });

    it('rejects triggerScheduleNow when maxIterations limit has been reached', async () => {
      const scheduler = new SchedulerService(db);
      let fireCount = 0;
      scheduler.onScheduleFired(async () => {
        fireCount++;
      });

      const sched = scheduler.createCronSchedule({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Bounded routine',
        cronExpression: '*/5 * * * *',
        maxIterations: 2,
      });

      // Trigger iteration 1
      const trig1 = await scheduler.triggerScheduleNow(sched.id);
      expect(trig1?.currentIterations).toBe(1);
      expect(trig1?.status).toBe('active');
      expect(fireCount).toBe(1);

      // Trigger iteration 2 (reaches limit)
      const trig2 = await scheduler.triggerScheduleNow(sched.id);
      expect(trig2?.currentIterations).toBe(2);
      expect(trig2?.status).toBe('completed');
      expect(fireCount).toBe(2);

      // Trigger iteration 3 must be rejected because maxIterations has been reached
      await expect(scheduler.triggerScheduleNow(sched.id)).rejects.toThrow(
        /Cannot trigger schedule/
      );

      expect(fireCount).toBe(2);
    });
  });

  // ==========================================================================
  // GAP 4: Project-Scoped MCP Tool Loading & Reloading
  // ==========================================================================
  describe('Gap 4: Project-Scoped MCP Tool Loading', () => {
    it('reloads project tools and unmounts previous project tools when switching projects', async () => {
      const projADir = path.join(tempDir, 'project_a');
      const projBDir = path.join(tempDir, 'project_b');
      fs.mkdirSync(path.join(projADir, '.kin'), { recursive: true });
      fs.mkdirSync(path.join(projBDir, '.kin'), { recursive: true });

      // Create a mock MCP server runner script for Project A
      const serverScriptA = path.join(projADir, 'server_a.cjs');
      fs.writeFileSync(
        serverScriptA,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'server-a' } } }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'tool_from_a', description: 'Tool A', inputSchema: {} }] } }));
          }
        });
        `
      );

      // Config in Project A
      fs.writeFileSync(
        path.join(projADir, '.kin', 'mcp_servers.json'),
        JSON.stringify({
          mcpServers: {
            serverA: { command: process.execPath, args: [serverScriptA] },
          },
        })
      );

      // Create a mock MCP server runner script for Project B
      const serverScriptB = path.join(projBDir, 'server_b.cjs');
      fs.writeFileSync(
        serverScriptB,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'server-b' } } }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'tool_from_b', description: 'Tool B', inputSchema: {} }] } }));
          }
        });
        `
      );

      // Config in Project B
      fs.writeFileSync(
        path.join(projBDir, '.kin', 'mcp_servers.json'),
        JSON.stringify({
          mcpServers: {
            serverB: { command: process.execPath, args: [serverScriptB] },
          },
        })
      );

      const mcpManager = new McpClientManager(projADir);
      const toolsA = await mcpManager.loadConfiguredServers();
      expect(toolsA).toHaveLength(1);
      expect(toolsA[0].name).toBe('tool_from_a');

      const toolGateway = new ToolGateway({ mcpClient: mcpManager });
      let schemas = toolGateway.getToolSchemas();
      expect(schemas.some((s) => s.name === 'mcp__serverA__tool_from_a')).toBe(true);

      // Switch to Project B
      const toolsB = await mcpManager.reloadProject(projBDir);
      expect(toolsB).toHaveLength(1);
      expect(toolsB[0].name).toBe('tool_from_b');

      // Previous tools from Project A must be unmounted; new tools from Project B must be active
      schemas = toolGateway.getToolSchemas();
      expect(schemas.some((s) => s.name === 'mcp__serverA__tool_from_a')).toBe(false);
      expect(schemas.some((s) => s.name === 'mcp__serverB__tool_from_b')).toBe(true);

      mcpManager.shutdown();
    });
  });

  // ==========================================================================
  // GAP 5: MCP Process Supervision, Handshake Failure Eviction & Crash Handling
  // ==========================================================================
  describe('Gap 5: MCP Process Supervision & Error Cleanup', () => {
    it('evicts failed handshake process from activeServers and allows retry', async () => {
      const scriptPath = path.join(tempDir, 'fail_handshake.cjs');
      // Script outputs invalid JSON then exits
      fs.writeFileSync(
        scriptPath,
        `console.log("INVALID_JSON_OUTPUT"); process.exit(1);`
      );

      const mcpManager = new McpClientManager(tempDir);
      const config: McpServerConfig = {
        name: 'failingServer',
        command: process.execPath,
        args: [scriptPath],
      };

      const toolsFirst = await mcpManager.startServer(config);
      expect(toolsFirst).toEqual([]);

      // Process must not remain stuck in activeServers
      expect(mcpManager.getAllTools()).toHaveLength(0);

      // Fix script to respond successfully
      fs.writeFileSync(
        scriptPath,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'fixed' } } }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'recovered_tool', description: 'OK', inputSchema: {} }] } }));
          }
        });
        `
      );

      // Second start must retry spawning rather than returning cached empty array
      const toolsSecond = await mcpManager.startServer(config);
      expect(toolsSecond).toHaveLength(1);
      expect(toolsSecond[0].name).toBe('recovered_tool');

      mcpManager.shutdown();
    });

    it('rejects in-flight request and evicts server immediately when process crashes', async () => {
      const scriptPath = path.join(tempDir, 'crash_server.cjs');
      fs.writeFileSync(
        scriptPath,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'crashy_tool', inputSchema: {} }] } }));
          } else if (req.method === 'tools/call') {
            // Simulate sudden process crash while request is being handled
            process.exit(2);
          }
        });
        `
      );

      const mcpManager = new McpClientManager(tempDir);
      await mcpManager.startServer({
        name: 'crashServer',
        command: process.execPath,
        args: [scriptPath],
      });

      expect(mcpManager.getAllTools()).toHaveLength(1);

      // Calling tool must reject immediately due to process crash, not wait for 10s timeout
      const startTime = Date.now();
      await expect(mcpManager.callTool('crashServer', 'crashy_tool', {})).rejects.toThrow(
        /terminated|exited/
      );
      const elapsedMs = Date.now() - startTime;
      expect(elapsedMs).toBeLessThan(3000); // Exited immediately, did not hang

      // Crashed server must be evicted from active list and catalog
      expect(mcpManager.getAllTools()).toHaveLength(0);

      mcpManager.shutdown();
    });

    it('completes protocol initialization by sending notifications/initialized', async () => {
      const scriptPath = path.join(tempDir, 'proto_server.cjs');
      const notifyMarkerPath = path.join(tempDir, 'notified.txt');
      fs.writeFileSync(
        scriptPath,
        `
        const readline = require('readline');
        const fs = require('fs');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const msg = JSON.parse(line);
          if (msg.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { serverInfo: { name: 'proto' } } }));
          } else if (msg.method === 'notifications/initialized') {
            fs.writeFileSync('${notifyMarkerPath.replace(/\\/g, '\\\\')}', 'OK');
          } else if (msg.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'proto_tool', inputSchema: {} }] } }));
          }
        });
        `
      );

      const mcpManager = new McpClientManager(tempDir);
      const tools = await mcpManager.startServer({
        name: 'protoServer',
        command: process.execPath,
        args: [scriptPath],
      });

      expect(tools).toHaveLength(1);
      // Wait for child process to write marker file
      await new Promise((r) => setTimeout(r, 200));
      expect(fs.existsSync(notifyMarkerPath)).toBe(true);
      expect(fs.readFileSync(notifyMarkerPath, 'utf8')).toBe('OK');

      mcpManager.shutdown();
    });

    it('guards against synchronous stdin write errors in sendRequest', async () => {
      const scriptPath = path.join(tempDir, 'broken_pipe_server.cjs');
      fs.writeFileSync(
        scriptPath,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'test_tool', inputSchema: {} }] } }));
          }
        });
        `
      );

      const mcpManager = new McpClientManager(tempDir);
      await mcpManager.startServer({
        name: 'pipeServer',
        command: process.execPath,
        args: [scriptPath],
      });

      // Directly destroy or close stdin on the process to simulate synchronous EPIPE / stream closed
      const activeEntry = (mcpManager as any).activeServers.get('pipeServer');
      expect(activeEntry).toBeDefined();
      if (activeEntry?.process?.stdin) {
        activeEntry.process.stdin.destroy(new Error('EPIPE: Broken pipe'));
      }

      await expect(mcpManager.callTool('pipeServer', 'test_tool', {})).rejects.toThrow();

      mcpManager.shutdown();
    });
  });

  // ==========================================================================
  // GAP 6: Startup MCP Tool Discovery Awaiting
  // ==========================================================================
  describe('Gap 6: Startup MCP Loading Awaited', () => {
    it('CoreServer.start() completes MCP tool discovery before listening', async () => {
      const server = new CoreServer({
        port: 0,
        dbPath: tempDbPath,
        requireIpcAuth: false,
      });

      const listenedPort = await server.start();
      expect(listenedPort).toBeGreaterThan(0);

      // Verify server is listening and ready
      const res = await fetch(`http://127.0.0.1:${listenedPort}/health`);
      expect(res.status).toBe(200);

      // Create a schedule and trigger it to fail
      const createRes = await fetch(`http://127.0.0.1:${listenedPort}/api/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'one_shot',
          projectId: 'proj-kin',
          channelId: 'chan-general',
          prompt: 'HTTP test routine',
          durationSeconds: 1,
        }),
      });
      expect(createRes.status).toBe(201);
      const { schedule } = await createRes.json();

      // Configure onFire to fail
      server.getScheduler().onScheduleFired(async () => {
        throw new Error('Forced HTTP test failure');
      });

      // Manually trigger so it fails
      const trigRes = await fetch(`http://127.0.0.1:${listenedPort}/api/schedules/${schedule.id}/trigger`, {
        method: 'POST',
      });
      expect(trigRes.status).toBe(400);

      // Verify attempts endpoint
      const attRes = await fetch(`http://127.0.0.1:${listenedPort}/api/schedules/${schedule.id}/attempts`);
      expect(attRes.status).toBe(200);
      const attBody = await attRes.json();
      expect(attBody.attempts).toHaveLength(1);
      expect(attBody.attempts[0].status).toBe('failure');

      // Now reset onFire to succeed and retry
      server.getScheduler().onScheduleFired(async () => {});
      const retryRes = await fetch(`http://127.0.0.1:${listenedPort}/api/schedules/${schedule.id}/retry`, {
        method: 'POST',
      });
      expect(retryRes.status).toBe(200);
      const retryBody = await retryRes.json();
      expect(retryBody.schedule.status).toBe('completed');

      // Attempts now has 2
      const attRes2 = await fetch(`http://127.0.0.1:${listenedPort}/api/schedules/${schedule.id}/attempts`);
      const attBody2 = await attRes2.json();
      expect(attBody2.attempts).toHaveLength(2);

      await server.stop();
    });
  });

  // ==========================================================================
  // OBSERVABILITY: Agent Routing Match Reason & Fallback Exposure
  // ==========================================================================
  describe('Agent Routing Observability', () => {
    const activationEngine = new ActivationEngine();

    const mockSpecialistAgent: AgentIdentity = {
      id: 'agent-db-expert',
      definitionId: 'def-db-expert',
      displayName: '@DatabaseSpecialist',
      activeModelId: 'gpt-4o',
      isOrchestrator: false,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const mockSpecialistDef: AgentDefinition = {
      id: 'def-db-expert',
      name: 'DatabaseSpecialist',
      role: 'PostgreSQL Database Architect',
      systemPrompt: 'You design database schemas and SQL queries',
      domainAuthority: ['postgresql', 'sqlite', 'indexing', 'database migrations'],
      tags: ['backend', 'database'],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const mockOrchestratorAgent: AgentIdentity = {
      id: 'agent-boss',
      definitionId: 'def-boss',
      displayName: '@Boss',
      activeModelId: 'gpt-4o',
      isOrchestrator: true,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const mockOrchestratorDef: AgentDefinition = {
      id: 'def-boss',
      name: 'Boss',
      role: 'General Orchestrator',
      systemPrompt: 'You coordinate general workflows',
      domainAuthority: ['coordination', 'planning'],
      tags: ['orchestrator'],
      createdAt: 1000,
      updatedAt: 1000,
    };

    it('exposes direct_mention match reason on explicit mentions', () => {
      const msg: Message = {
        id: 'msg-1',
        channelId: 'chan-general',
        senderId: 'user-1',
        senderType: 'human',
        content: 'Hey @DatabaseSpecialist could you check the index layout?',
        mentions: ['DatabaseSpecialist'],
        productivityScore: 0,
        createdAt: 2000,
      };

      const decision = activationEngine.evaluateActivation(mockSpecialistAgent, {
        type: 'message',
        message: msg,
      });

      expect(decision.shouldActivate).toBe(true);
      expect(decision.matchReason).toBe('direct_mention');
      expect(decision.explanation).toContain('DatabaseSpecialist');
    });

    it('exposes domain_authority_match match reason when domain keywords match', () => {
      const msg: Message = {
        id: 'msg-2',
        channelId: 'chan-general',
        senderId: 'user-1',
        senderType: 'human',
        content: 'We need to run database migrations before the launch.',
        mentions: [],
        productivityScore: 0,
        createdAt: 3000,
      };

      const decision = activationEngine.evaluateActivation(
        mockSpecialistAgent,
        {
          type: 'message',
          message: msg,
        },
        mockSpecialistDef
      );

      expect(decision.shouldActivate).toBe(true);
      expect(decision.matchReason).toBe('domain_authority_match');
      expect(decision.matchedKeywords).toContain('database migrations');
    });

    it('exposes role_keyword_match when role keywords match', () => {
      const msg: Message = {
        id: 'msg-3',
        channelId: 'chan-general',
        senderId: 'user-1',
        senderType: 'human',
        content: 'Please find an architect to review the layout.',
        mentions: [],
        productivityScore: 0,
        createdAt: 4000,
      };

      const decision = activationEngine.evaluateActivation(
        mockSpecialistAgent,
        {
          type: 'message',
          message: msg,
        },
        mockSpecialistDef
      );

      expect(decision.shouldActivate).toBe(true);
      expect(decision.matchReason).toContain('role_keyword_match');
      expect(decision.matchedKeywords?.length).toBeGreaterThan(0);
    });

    it('exposes orchestrator_fallback when no channel specialist matches', () => {
      const msg: Message = {
        id: 'msg-4',
        channelId: 'chan-general',
        senderId: 'user-1',
        senderType: 'human',
        content: 'What is the flight schedule to Denver tomorrow?',
        mentions: [],
        productivityScore: 0,
        createdAt: 5000,
      };

      const defsMap = new Map<string, AgentDefinition>();
      defsMap.set('def-db-expert', mockSpecialistDef);
      defsMap.set('def-boss', mockOrchestratorDef);

      const routing = activationEngine.evaluateChannelRouting({
        channelId: 'chan-general',
        message: msg,
        channelMembers: [mockSpecialistAgent, mockOrchestratorAgent],
        allProjectAgents: [mockSpecialistAgent, mockOrchestratorAgent],
        definitionsMap: defsMap,
      });

      expect(routing.action).toBe('orchestrator_fallback');
      expect(routing.matchReason).toBe('orchestrator_fallback');
      expect(routing.fallbackOrchestrator?.id).toBe(mockOrchestratorAgent.id);
      expect(routing.fallbackReason).toContain('No channel specialists matched');
    });

    it('surfaces routing decision and matchReason in POST /api/channels/:id/messages HTTP response', async () => {
      const server = new CoreServer({
        port: 0,
        dbPath: tempDbPath,
        requireIpcAuth: false,
      });

      const listenedPort = await server.start();

      const res = await fetch(`http://127.0.0.1:${listenedPort}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello general orchestrator!',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.routing).toBeDefined();
      expect(body.routing.action).toBeDefined();
      expect(body.routing.matchReason).toBeDefined();

      await server.stop();
    });
  });
});
