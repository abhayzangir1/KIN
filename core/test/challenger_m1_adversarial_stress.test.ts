// ============================================================================
// EMPIRICAL CHALLENGER STRESS HARNESS: MILESTONE 1 (R1 & R2)
// Adversarial test suite challenging:
// 1. Scheduler dispatch error handling (non-Error rejections, consecutive failures, journal recording)
// 2. 5-field cron parsing edge cases (POSIX DOM/DOW union, steps, ranges, named tokens, leap years)
// 3. Manual trigger gating (active status enforcement, iteration bounds, failure gating)
// 4. MCP lifecycle supervision (handshake, process exit/kill, stdin EPIPE, malformed streams)
// 5. Dynamic project reload and startup discovery
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { SchedulerService } from '../src/automation/scheduler.js';
import { validateCronExpression, getNextCronOccurrence, parseCron } from '../src/automation/cron_calendar.js';
import { McpClientManager, McpServerConfig } from '../src/execution/mcp_client.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { CoreServer } from '../src/server/core_server.js';

describe('Challenger M1 Adversarial Stress Suite', () => {
  let db: KinDatabase;
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), 'temp_stress_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    fs.mkdirSync(tempDir, { recursive: true });
    tempDbPath = path.join(tempDir, 'stress.sqlite');
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
  // AREA 1: SCHEDULER DISPATCH ERROR HANDLING & DURABLE EVENT JOURNAL
  // ==========================================================================
  describe('Area 1: Scheduler Dispatch Error Handling & Durable History', () => {
    it('handles non-Error primitive and object rejections without swallowing or crashing', async () => {
      const scheduler = new SchedulerService(db);
      let rejectionType: 'string' | 'object' = 'string';

      scheduler.onScheduleFired(async () => {
        if (rejectionType === 'string') {
          return Promise.reject('PRIMITIVE_FATAL_STRING_ERROR');
        } else {
          return Promise.reject({ errorCode: 503, reason: 'SERVICE_UNAVAILABLE' });
        }
      });

      // 1. One-shot with primitive string rejection
      const sched1 = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Primitive string rejection test',
        durationSeconds: 1,
      });

      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 1000, sched1.id);
      const fired1 = await scheduler.evaluatePendingSchedules();
      expect(fired1).toHaveLength(0);

      const updated1 = scheduler.getSchedule(sched1.id);
      expect(updated1?.status).toBe('failed');
      expect(updated1?.lastError).toContain('PRIMITIVE_FATAL_STRING_ERROR');

      const attempts1 = scheduler.getScheduleAttempts(sched1.id);
      expect(attempts1).toHaveLength(1);
      expect(attempts1[0].status).toBe('failure');
      expect(attempts1[0].errorMessage).toContain('PRIMITIVE_FATAL_STRING_ERROR');

      // 2. Recurring cron with object rejection
      rejectionType = 'object';
      const sched2 = scheduler.createCronSchedule({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Object rejection test',
        cronExpression: '*/5 * * * *',
      });

      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 1000, sched2.id);
      const fired2 = await scheduler.evaluatePendingSchedules();
      expect(fired2).toHaveLength(0);

      const updated2 = scheduler.getSchedule(sched2.id);
      expect(updated2?.status).toBe('active');
      expect(updated2?.currentIterations).toBe(0);
      expect(updated2?.lastError).toContain('object');
      expect(updated2?.nextRunAt).toBeGreaterThan(Date.now());

      const attempts2 = scheduler.getScheduleAttempts(sched2.id);
      expect(attempts2).toHaveLength(1);
      expect(attempts2[0].status).toBe('failure');
    });

    it('handles consecutive recurring cron failures with chronological attempt tracking and advances next_run_at', async () => {
      const scheduler = new SchedulerService(db);
      let callCount = 0;

      scheduler.onScheduleFired(async () => {
        callCount++;
        if (callCount <= 3) {
          throw new Error(`Dispatch failure #${callCount}`);
        }
        // Call 4 succeeds
      });

      const sched = scheduler.createCronSchedule({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Multi-failure cron resilience test',
        cronExpression: '*/10 * * * *',
      });

      // Run 3 consecutive failing cycles
      for (let i = 1; i <= 3; i++) {
        db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 1000, sched.id);
        const fired = await scheduler.evaluatePendingSchedules();
        expect(fired).toHaveLength(0);

        const current = scheduler.getSchedule(sched.id);
        expect(current?.status).toBe('active');
        expect(current?.currentIterations).toBe(0);
        expect(current?.lastError).toBe(`Dispatch failure #${i}`);
        expect(current?.nextRunAt).toBeGreaterThan(Date.now());
      }

      // Check event_journal has 3 failure records
      const attemptsAfterFailures = scheduler.getScheduleAttempts(sched.id);
      expect(attemptsAfterFailures).toHaveLength(3);
      expect(attemptsAfterFailures.map((a) => a.errorMessage)).toEqual([
        'Dispatch failure #1',
        'Dispatch failure #2',
        'Dispatch failure #3',
      ]);
      expect(attemptsAfterFailures.map((a) => a.status)).toEqual(['failure', 'failure', 'failure']);

      // 4th cycle: dispatch recovers and succeeds
      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 1000, sched.id);
      const firedSuccess = await scheduler.evaluatePendingSchedules();
      expect(firedSuccess).toHaveLength(1);

      const recovered = scheduler.getSchedule(sched.id);
      expect(recovered?.status).toBe('active');
      expect(recovered?.currentIterations).toBe(1);
      expect(recovered?.lastError).toBeUndefined();

      // Check event_journal now has 4 records, final is success
      const attemptsFinal = scheduler.getScheduleAttempts(sched.id);
      expect(attemptsFinal).toHaveLength(4);
      expect(attemptsFinal[3].status).toBe('success');
      expect(attemptsFinal[3].attemptNumber).toBe(1);
      expect(attemptsFinal[3].errorMessage).toBeUndefined();
    });

    it('enforces timerCondition cancellation before dispatch occurs', async () => {
      const scheduler = new SchedulerService(db);
      let dispatchFired = false;
      scheduler.onScheduleFired(async () => {
        dispatchFired = true;
      });

      // 1. One-shot timer with timerCondition = 'any'
      const schedAny = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Liveness timer with condition any',
        durationSeconds: 10,
        timerCondition: 'any',
      });

      // Insert message into channel after timer creation
      db.execute(
        `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, created_at)
         VALUES ('msg-condition-1', 'chan-general', 'agent-peer', 'agent', 'Message satisfied condition', ?)`,
        Date.now() + 10
      );

      // Advance schedule to trigger time
      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 1000, schedAny.id);

      const fired = await scheduler.evaluatePendingSchedules();
      expect(fired).toHaveLength(0);
      expect(dispatchFired).toBe(false);

      const cancelledSched = scheduler.getSchedule(schedAny.id);
      expect(cancelledSched?.status).toBe('cancelled');
      // No attempt should be recorded for cancelled condition
      expect(scheduler.getScheduleAttempts(schedAny.id)).toHaveLength(0);

      // 2. One-shot timer with specific senderCondition 'agent-worker'
      const schedWorker = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Wait for agent-worker',
        durationSeconds: 10,
        timerCondition: 'agent-worker',
      });

      // Message from 'agent-other' should NOT satisfy condition
      db.execute(
        `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, created_at)
         VALUES ('msg-other', 'chan-general', 'agent-other', 'agent', 'Unrelated message', ?)`,
        Date.now() + 10
      );

      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 1000, schedWorker.id);
      const firedWorker = await scheduler.evaluatePendingSchedules();
      expect(firedWorker).toHaveLength(1);
      expect(dispatchFired).toBe(true);
      expect(scheduler.getSchedule(schedWorker.id)?.status).toBe('completed');
    });
  });

  // ==========================================================================
  // AREA 2: 5-FIELD CRON PARSING EDGE CASES & POSIX UNION MATCHING
  // ==========================================================================
  describe('Area 2: 5-Field Calendar Cron Parsing & POSIX Union Matching', () => {
    it('accurately evaluates POSIX day-of-month and day-of-week union behavior', () => {
      // Cron: '0 10 1,15 * 1' -> 10:00 AM on the 1st, 15th, OR on any Monday (1)
      const expr = '0 10 1,15 * 1';
      const parsed = parseCron(expr);
      expect(parsed.dom.isWildcard).toBe(false);
      expect(parsed.dow.isWildcard).toBe(false);

      // Reference: October 1, 2026 (Thursday) at 09:00 -> 1st matches DOM
      const refOct1 = new Date(2026, 9, 1, 9, 0, 0);
      const hit1 = getNextCronOccurrence(expr, refOct1);
      expect(hit1.getDate()).toBe(1);
      expect(hit1.getDay()).toBe(4); // Thursday, matched by DOM

      // Reference: October 1, 2026 at 11:00 -> next match is Monday Oct 5 (matched by DOW)
      const refOct1After = new Date(2026, 9, 1, 11, 0, 0);
      const hit2 = getNextCronOccurrence(expr, refOct1After);
      expect(hit2.getDate()).toBe(5);
      expect(hit2.getDay()).toBe(1); // Monday, matched by DOW

      // Reference: October 12, 2026 (Monday) at 11:00 -> next match is Thursday Oct 15 (matched by DOM 15)
      const refOct12After = new Date(2026, 9, 12, 11, 0, 0);
      const hit3 = getNextCronOccurrence(expr, refOct12After);
      expect(hit3.getDate()).toBe(15);
      expect(hit3.getDay()).toBe(4); // Thursday, matched by DOM
    });

    it('handles mixed list and step expressions across fields', () => {
      // Minutes: 0,15,30-45/5
      const expr = '0,15,30-45/5 * * * *';
      const valid = validateCronExpression(expr);
      expect(valid.valid).toBe(true);

      const parsed = parseCron(expr);
      const expectedMinutes = new Set([0, 15, 30, 35, 40, 45]);
      expect(parsed.minute.allowedValues).toEqual(expectedMinutes);

      const refTime = new Date(2026, 5, 1, 10, 16, 0);
      const nextRun = getNextCronOccurrence(expr, refTime);
      expect(nextRun.getMinutes()).toBe(30);

      const nextRun2 = getNextCronOccurrence(expr, nextRun);
      expect(nextRun2.getMinutes()).toBe(35);
    });

    it('rejects invalid step and range bounds with informative errors', () => {
      // Step zero
      expect(validateCronExpression('*/0 * * * *').valid).toBe(false);
      // Inverted range
      expect(validateCronExpression('45-15 * * * *').valid).toBe(false);
      // Out of range range
      expect(validateCronExpression('50-70 * * * *').valid).toBe(false);
      // Empty tokens
      expect(validateCronExpression(' , * * * *').valid).toBe(false);
      // Trailing comma
      expect(validateCronExpression('5, * * * *').valid).toBe(false);
      // Missing fields (4 fields)
      expect(validateCronExpression('* * * *').valid).toBe(false);
      // Extra fields (6 fields)
      expect(validateCronExpression('* * * * * *').valid).toBe(false);
    });

    it('parses named month and day tokens case-insensitively and in ranges', () => {
      // Named months in ranges and lists: '0 0 1 JAN,MAR-MAY *'
      const expr1 = '0 0 1 JAN,MAR-MAY *';
      expect(validateCronExpression(expr1).valid).toBe(true);
      const parsed1 = parseCron(expr1);
      expect(parsed1.month.allowedValues).toEqual(new Set([1, 3, 4, 5]));

      // Named DOW: '0 8 * * tue-thu,SAT'
      const expr2 = '0 8 * * tue-thu,SAT';
      expect(validateCronExpression(expr2).valid).toBe(true);
      const parsed2 = parseCron(expr2);
      expect(parsed2.dow.allowedValues).toEqual(new Set([2, 3, 4, 6]));

      // Test next run with named month: 2026-06-01 -> next is 2027-01-01
      const refJune = new Date(2026, 5, 1, 0, 0, 0);
      const nextJan = getNextCronOccurrence(expr1, refJune);
      expect(nextJan.getFullYear()).toBe(2027);
      expect(nextJan.getMonth()).toBe(0); // JAN
      expect(nextJan.getDate()).toBe(1);
    });

    it('correctly handles month length differences and leap years without infinite looping', () => {
      // February 29th leap year test from mid-2026
      const leapExpr = '0 0 29 2 *';
      const refDate = new Date(2026, 5, 15, 0, 0, 0);
      const nextLeap = getNextCronOccurrence(leapExpr, refDate);
      expect(nextLeap.getFullYear()).toBe(2028);
      expect(nextLeap.getMonth()).toBe(1);
      expect(nextLeap.getDate()).toBe(29);

      // April 31st (impossible date! April only has 30 days)
      const impossibleExpr = '0 0 31 4 *';
      expect(() => getNextCronOccurrence(impossibleExpr, refDate)).toThrow(
        /No matching occurrence found within 5 years/
      );
    });
  });

  // ==========================================================================
  // AREA 3: MANUAL TRIGGER GATING & BOUNDS ENFORCEMENT
  // ==========================================================================
  describe('Area 3: Manual Trigger Gating & Iteration Bounds', () => {
    it('prevents manual triggers on completed, cancelled, or failed schedules', async () => {
      const scheduler = new SchedulerService(db);

      // 1. One-shot schedule completed
      const sched = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Completed gating test',
        durationSeconds: 1,
      });

      // Mark completed directly in db
      db.execute(`UPDATE schedules SET status = 'completed' WHERE id = ?`, sched.id);

      await expect(scheduler.triggerScheduleNow(sched.id)).rejects.toThrow(
        /status is 'completed', expected 'active'/
      );
      expect(await scheduler.triggerSchedule(sched.id)).toBe(false);

      // 2. Cancelled schedule
      db.execute(`UPDATE schedules SET status = 'cancelled' WHERE id = ?`, sched.id);
      await expect(scheduler.triggerScheduleNow(sched.id)).rejects.toThrow(
        /status is 'cancelled', expected 'active'/
      );

      // 3. Failed schedule
      db.execute(`UPDATE schedules SET status = 'failed' WHERE id = ?`, sched.id);
      await expect(scheduler.triggerScheduleNow(sched.id)).rejects.toThrow(
        /status is 'failed', expected 'active'/
      );

      // Non-existent ID
      expect(await scheduler.triggerScheduleNow('non-existent-id')).toBeNull();
      expect(await scheduler.triggerSchedule('non-existent-id')).toBe(false);
    });

    it('strictly halts recurring cron manual triggers once maxIterations is satisfied', async () => {
      const scheduler = new SchedulerService(db);
      let executedCount = 0;
      scheduler.onScheduleFired(async () => {
        executedCount++;
      });

      const sched = scheduler.createCronSchedule({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Iteration bounds test',
        cronExpression: '*/5 * * * *',
        maxIterations: 3,
      });

      // Iteration 1
      const res1 = await scheduler.triggerScheduleNow(sched.id);
      expect(res1?.currentIterations).toBe(1);
      expect(res1?.status).toBe('active');
      expect(executedCount).toBe(1);

      // Iteration 2
      const res2 = await scheduler.triggerScheduleNow(sched.id);
      expect(res2?.currentIterations).toBe(2);
      expect(res2?.status).toBe('active');
      expect(executedCount).toBe(2);

      // Iteration 3 (reaches maxIterations bound)
      const res3 = await scheduler.triggerScheduleNow(sched.id);
      expect(res3?.currentIterations).toBe(3);
      expect(res3?.status).toBe('completed');
      expect(executedCount).toBe(3);

      // Iteration 4 must fail because status is completed AND limit is reached
      await expect(scheduler.triggerScheduleNow(sched.id)).rejects.toThrow(
        /Cannot trigger schedule/
      );
      expect(executedCount).toBe(3);

      // Normal evaluation loop also skips completed schedule
      const fired = await scheduler.evaluatePendingSchedules();
      expect(fired).toHaveLength(0);
      expect(executedCount).toBe(3);
    });
  });

  // ==========================================================================
  // AREA 4: SUPERVISED MCP LIFECYCLE & PROCESS FAULT TOLERANCE
  // ==========================================================================
  describe('Area 4: Supervised MCP Lifecycle & Fault Tolerance', () => {
    it('verifies full handshake sequence: initialize -> notifications/initialized -> tools/list', async () => {
      const scriptPath = path.join(tempDir, 'handshake_verifier.cjs');
      const logFile = path.join(tempDir, 'handshake.log');

      fs.writeFileSync(
        scriptPath,
        `
        const readline = require('readline');
        const fs = require('fs');
        const rl = readline.createInterface({ input: process.stdin });
        const log = (msg) => fs.appendFileSync('${logFile.replace(/\\/g, '\\\\')}', msg + '\\n');

        rl.on('line', (line) => {
          const msg = JSON.parse(line);
          log(msg.method || 'response');
          if (msg.method === 'initialize') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { serverInfo: { name: 'verifier' } } }));
          } else if (msg.method === 'notifications/initialized') {
            // Handshake notification
          } else if (msg.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'v_tool', inputSchema: {} }] } }));
          }
        });
        `
      );

      const mcpManager = new McpClientManager(tempDir);
      const tools = await mcpManager.startServer({
        name: 'verifierServer',
        command: process.execPath,
        args: [scriptPath],
      });

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('v_tool');

      // Verify sequence from log file
      const logs = fs.readFileSync(logFile, 'utf8').trim().split('\n');
      expect(logs).toEqual(['initialize', 'notifications/initialized', 'tools/list']);

      mcpManager.shutdown();
    });

    it('purges active server and rejects pending requests on SIGKILL or unexpected exit', async () => {
      const scriptPath = path.join(tempDir, 'sigkill_server.cjs');
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
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'long_tool', inputSchema: {} }] } }));
          }
          // Do not reply to tools/call, wait for kill
        });
        `
      );

      const mcpManager = new McpClientManager(tempDir);
      await mcpManager.startServer({
        name: 'sigkillServer',
        command: process.execPath,
        args: [scriptPath],
      });

      expect(mcpManager.getAllTools()).toHaveLength(1);

      // Start an in-flight tool call that will not respond
      const callPromise = mcpManager.callTool('sigkillServer', 'long_tool', {});

      // Forcibly kill the process externally via SIGKILL
      const activeEntry = (mcpManager as any).activeServers.get('sigkillServer');
      expect(activeEntry).toBeDefined();
      activeEntry.process.kill('SIGKILL');

      // The in-flight call must reject promptly with termination error
      await expect(callPromise).rejects.toThrow(/terminated|exited/);

      // Server must be completely evicted from active servers
      expect(mcpManager.getAllTools()).toHaveLength(0);

      mcpManager.shutdown();
    });

    it('safely catches stdin broken pipe (EPIPE) and rejects synchronously without uncaught crash', async () => {
      const scriptPath = path.join(tempDir, 'epipe_server.cjs');
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
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'pipe_tool', inputSchema: {} }] } }));
          }
        });
        `
      );

      const mcpManager = new McpClientManager(tempDir);
      await mcpManager.startServer({
        name: 'epipeServer',
        command: process.execPath,
        args: [scriptPath],
      });

      const activeEntry = (mcpManager as any).activeServers.get('epipeServer');
      expect(activeEntry?.process?.stdin).toBeDefined();

      // Emulate broken pipe by destroying the stdin stream
      activeEntry.process.stdin.destroy(new Error('EPIPE: Broken pipe'));

      // Calling tool must reject with an error instead of crashing Node process
      await expect(mcpManager.callTool('epipeServer', 'pipe_tool', {})).rejects.toThrow();

      // Ensure no dangling pending requests remain
      expect((mcpManager as any).pendingRequests.size).toBe(0);

      mcpManager.shutdown();
    });

    it('tolerates non-JSON stdout noise and handles JSON-RPC error responses gracefully', async () => {
      const scriptPath = path.join(tempDir, 'fuzz_stdout_server.cjs');
      fs.writeFileSync(
        scriptPath,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            // Emit non-JSON stderr / stdout debugging noise before valid JSON
            console.log("DEBUG: Loading plugins...");
            console.log("DEBUG: Ready.");
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }));
          } else if (req.method === 'tools/list') {
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'error_tool', inputSchema: {} }] } }));
          } else if (req.method === 'tools/call') {
            // Return JSON-RPC error payload
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'Invalid tool arguments supplied' } }));
          }
        });
        `
      );

      const mcpManager = new McpClientManager(tempDir);
      const tools = await mcpManager.startServer({
        name: 'fuzzServer',
        command: process.execPath,
        args: [scriptPath],
      });

      expect(tools).toHaveLength(1);

      // Calling tool must reject with the server's error message
      await expect(mcpManager.callTool('fuzzServer', 'error_tool', {})).rejects.toThrow(
        /Invalid tool arguments supplied/
      );

      mcpManager.shutdown();
    });
  });

  // ==========================================================================
  // AREA 5: DYNAMIC PROJECT RELOAD & STARTUP DISCOVERY
  // ==========================================================================
  describe('Area 5: Dynamic Project Reload & Startup Discovery', () => {
    it('dynamically unmounts and remounts MCP tools via CoreServer project activation', async () => {
      const proj1Dir = path.join(tempDir, 'workspace_proj_1');
      const proj2Dir = path.join(tempDir, 'workspace_proj_2');
      fs.mkdirSync(path.join(proj1Dir, '.kin'), { recursive: true });
      fs.mkdirSync(path.join(proj2Dir, '.kin'), { recursive: true });

      // Script 1
      const script1 = path.join(proj1Dir, 'tool1.cjs');
      fs.writeFileSync(
        script1,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }));
          else if (req.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'project_1_tool', inputSchema: {} }] } }));
        });
        `
      );
      fs.writeFileSync(
        path.join(proj1Dir, '.kin', 'mcp_servers.json'),
        JSON.stringify({ mcpServers: { s1: { command: process.execPath, args: [script1] } } })
      );

      // Script 2
      const script2 = path.join(proj2Dir, 'tool2.cjs');
      fs.writeFileSync(
        script2,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }));
          else if (req.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'project_2_tool', inputSchema: {} }] } }));
        });
        `
      );
      fs.writeFileSync(
        path.join(proj2Dir, '.kin', 'mcp_servers.json'),
        JSON.stringify({ mcpServers: { s2: { command: process.execPath, args: [script2] } } })
      );

      // Register both projects in SQLite
      db.execute(
        `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('p-alpha', 'ws-default', 'Alpha', ?, '{}', ?, ?)`,
        proj1Dir,
        Date.now(),
        Date.now()
      );
      db.execute(
        `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at) VALUES ('p-beta', 'ws-default', 'Beta', ?, '{}', ?, ?)`,
        proj2Dir,
        Date.now(),
        Date.now()
      );

      const server = new CoreServer({
        port: 0,
        dbPath: tempDbPath,
        requireIpcAuth: false,
      });

      const port = await server.start();
      const toolGateway = server.getToolGateway();

      // Activate Project Alpha
      const actAlpha = await fetch(`http://127.0.0.1:${port}/api/projects/p-alpha/activate`, { method: 'POST' });
      expect(actAlpha.status).toBe(200);

      let schemas = toolGateway.getToolSchemas();
      expect(schemas.some((s) => s.name === 'mcp__s1__project_1_tool')).toBe(true);
      expect(schemas.some((s) => s.name === 'mcp__s2__project_2_tool')).toBe(false);

      // Activate Project Beta
      const actBeta = await fetch(`http://127.0.0.1:${port}/api/projects/p-beta/activate`, { method: 'POST' });
      expect(actBeta.status).toBe(200);

      // Tool 1 must be unmounted; Tool 2 must be mounted
      schemas = toolGateway.getToolSchemas();
      expect(schemas.some((s) => s.name === 'mcp__s1__project_1_tool')).toBe(false);
      expect(schemas.some((s) => s.name === 'mcp__s2__project_2_tool')).toBe(true);

      await server.stop();
    });

    it('awaits startup MCP discovery before accepting HTTP traffic in CoreServer.start()', async () => {
      // Create project root with configured MCP server
      const startupProjDir = path.join(tempDir, 'startup_project');
      fs.mkdirSync(path.join(startupProjDir, '.kin'), { recursive: true });

      const startupScript = path.join(startupProjDir, 'startup_tool.cjs');
      fs.writeFileSync(
        startupScript,
        `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const req = JSON.parse(line);
          if (req.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }));
          else if (req.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'startup_available_tool', inputSchema: {} }] } }));
        });
        `
      );
      fs.writeFileSync(
        path.join(startupProjDir, '.kin', 'mcp_servers.json'),
        JSON.stringify({ mcpServers: { startupSrv: { command: process.execPath, args: [startupScript] } } })
      );

      // Update default project 'proj-kin' to point to startupProjDir
      db.execute(`UPDATE projects SET repo_path = ? WHERE id = 'proj-kin'`, startupProjDir);

      const server = new CoreServer({
        port: 0,
        dbPath: tempDbPath,
        requireIpcAuth: false,
      });

      // When start() returns, tools must ALREADY be discovered
      await server.start();

      const mcpTools = server.getMcpClient().getAllTools();
      expect(mcpTools).toHaveLength(1);
      expect(mcpTools[0].name).toBe('startup_available_tool');

      const toolSchemas = server.getToolGateway().getToolSchemas();
      expect(toolSchemas.some((s) => s.name === 'mcp__startupSrv__startup_available_tool')).toBe(true);

      await server.stop();
    });

    it('correctly handles chunked stdout delivery across multiple data events in MCP client', async () => {
      const scriptPath = path.join(tempDir, 'chunked_server.cjs');
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
            console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'chunked_tool', inputSchema: {} }] } }));
          } else if (req.method === 'tools/call') {
            // Write partial chunks with small delays to test buffer stream reassembly
            const fullJson = JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: { content: [{ type: 'text', text: 'chunked_success_payload' }] }
            }) + '\\n';

            const part1 = fullJson.slice(0, 15);
            const part2 = fullJson.slice(15, 45);
            const part3 = fullJson.slice(45);

            process.stdout.write(part1);
            setTimeout(() => {
              process.stdout.write(part2);
              setTimeout(() => {
                process.stdout.write(part3);
              }, 50);
            }, 50);
          }
        });
        `
      );

      const mcpManager = new McpClientManager(tempDir);
      await mcpManager.startServer({
        name: 'chunkedServer',
        command: process.execPath,
        args: [scriptPath],
      });

      const res = await mcpManager.callTool('chunkedServer', 'chunked_tool', {});
      expect(res.content?.[0]?.text).toBe('chunked_success_payload');

      mcpManager.shutdown();
    });
  });

  describe('Area 6: Concurrency & Invariant Stress', () => {
    it('guards against concurrent re-entrant evaluatePendingSchedules execution', async () => {
      const scheduler = new SchedulerService(db);
      let activeDispatches = 0;
      let maxConcurrentDispatches = 0;

      scheduler.onScheduleFired(async () => {
        activeDispatches++;
        maxConcurrentDispatches = Math.max(maxConcurrentDispatches, activeDispatches);
        await new Promise((r) => setTimeout(r, 100));
        activeDispatches--;
      });

      const sched = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Concurrency stress test',
        durationSeconds: 1,
      });

      db.execute(`UPDATE schedules SET next_run_at = ? WHERE id = ?`, Date.now() - 1000, sched.id);

      // Trigger 5 evaluatePendingSchedules calls concurrently
      const evaluations = await Promise.all([
        scheduler.evaluatePendingSchedules(),
        scheduler.evaluatePendingSchedules(),
        scheduler.evaluatePendingSchedules(),
        scheduler.evaluatePendingSchedules(),
        scheduler.evaluatePendingSchedules(),
      ]);

      // Only 1 evaluation cycle should have picked up and fired the schedule
      const totalFired = evaluations.flat().length;
      expect(totalFired).toBe(1);
      expect(maxConcurrentDispatches).toBe(1);

      const attempts = scheduler.getScheduleAttempts(sched.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('success');
    });

    it('rejects double cancellation and cancellation on non-existent schedule', () => {
      const scheduler = new SchedulerService(db);
      const sched = scheduler.createOneShotTimer({
        projectId: 'proj-kin',
        channelId: 'chan-general',
        prompt: 'Cancellation idempotence test',
        durationSeconds: 100,
      });

      // 1st cancel returns true
      expect(scheduler.cancelSchedule(sched.id)).toBe(true);
      // 2nd cancel returns false
      expect(scheduler.cancelSchedule(sched.id)).toBe(false);
      // Non-existent returns false
      expect(scheduler.cancelSchedule('bogus-id')).toBe(false);
    });
  });
});

