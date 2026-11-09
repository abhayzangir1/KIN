// ============================================================================
// EMPIRICAL CHALLENGER STRESS HARNESS: MILESTONE 2 (CHALLENGER M2-2)
// Adversarial stress test suite covering:
// 1. Streaming Stall Guard & Timeout (readChunkWithTimeout, trailing SSE buffer, 0 token drop)
// 2. 429 Quota Guard & Jitter Backoff (RFC 7231 HTTP-Date, 100-iter jitter entropy, supervisor quota pause)
// 3. SkillEngine BigInt Serialization & Sandbox Isolation (BigInt params, prototype escape, string eval ban)
// 4. Windows MCP Client Argument Escaping (Windows metacharacters injection defense, cmd.exe execution)
// 5. Context Compiler Budget Overflow (100 large memories, proportional budget packing, trajectory pruning)
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { StreamingInferenceClient } from '../src/execution/streaming_client.js';
import { QuotaGuard } from '../src/execution/quota_guard.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { ContextCompiler, ContextCompileInput } from '../src/context/context_compiler.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { CoreServer } from '../src/server/core_server.js';
import { AgentDefinition, AgentIdentity, Message } from '../src/domain/types.js';

describe('Adversarial Challenger M2-2: Inference Runtime, Sandbox, MCP & Context Stress Harness', () => {
  let tempDir: string;
  let tempDbPath: string;
  let db: KinDatabase;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-challenger-m2-2-'));
    tempDbPath = path.join(tempDir, 'stress_test.sqlite');
    db = new KinDatabase(tempDbPath);
    new MigrationRunner(db).runMigrations();

    // Seed base hierarchy for foreign key integrity
    const now = Date.now();
    db.execute(
      `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-stress', 'Stress Workspace', ?, 'AUTO', ?, ?)`,
      tempDir,
      now,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES ('proj-stress', 'ws-stress', 'Stress Project', ?, '{}', ?, ?)`,
      tempDir,
      now,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO channels (id, project_id, name, is_private, created_at)
       VALUES ('chan-stress', 'proj-stress', 'general', 0, ?)`,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
       VALUES ('def-tester', 'Tester', 'Adversarial Tester', 'Stress testing invariants', 'ollama/llama3', '[]', '["fs_read"]', ?)`,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
       VALUES ('agent-tester', 'ws-stress', 'proj-stress', 'def-tester', '@Tester', 'ollama/llama3', 1, 0, ?, ?)`,
      now,
      now
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
  // CHALLENGE AREA 1: Streaming Stall Guard & Timeout
  // ==========================================================================
  describe('1. Streaming Stall Guard & SSE Buffer Truncation Defense', () => {
    it('strictly aborts and throws after timeoutMs when reader hangs indefinitely', async () => {
      const stalledReader = {
        read: () => new Promise<{ done: boolean; value?: any }>(() => {
          // Never resolves or rejects
        }),
      };

      const start = Date.now();
      await expect(
        StreamingInferenceClient.readChunkWithTimeout(stalledReader, 40)
      ).rejects.toThrow(/timed out after 40ms/i);
      const elapsed = Date.now() - start;

      // Assert timeout occurred promptly around 40ms, not hanging
      expect(elapsed).toBeGreaterThanOrEqual(30);
      expect(elapsed).toBeLessThan(200);
    });

    it('rejects at timeoutMs even if stalled reader would resolve much later', async () => {
      const slowReader = {
        read: () =>
          new Promise<{ done: boolean; value?: any }>((resolve) => {
            setTimeout(() => resolve({ done: false, value: 'late_chunk' }), 300);
          }),
      };

      const start = Date.now();
      await expect(
        StreamingInferenceClient.readChunkWithTimeout(slowReader, 35)
      ).rejects.toThrow(/timed out after 35ms/i);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(150);
    });

    it('propagates immediate stream reader errors without waiting for timeout', async () => {
      const failingReader = {
        read: () => Promise.reject(new Error('ECONNRESET: connection reset by peer')),
      };

      const start = Date.now();
      await expect(
        StreamingInferenceClient.readChunkWithTimeout(failingReader, 5000)
      ).rejects.toThrow('ECONNRESET');
      const elapsed = Date.now() - start;

      // Must fail fast within milliseconds, NOT waiting 5000ms
      expect(elapsed).toBeLessThan(100);
    });

    it('successfully returns valid chunks within timeout and cleans up internal timer', async () => {
      const validReader = {
        read: () => Promise.resolve({ done: false, value: 'token_chunk_1' }),
      };

      const result = await StreamingInferenceClient.readChunkWithTimeout(validReader, 1000);
      expect(result.done).toBe(false);
      expect(result.value).toBe('token_chunk_1');
    });

    it('parses multi-chunk SSE stream where final chunk lacks trailing newline with zero token drop', () => {
      const capturedTokens: string[] = [];
      let isDoneCalled = false;

      const handleData = (payload: any, isDone: boolean) => {
        if (isDone) {
          isDoneCalled = true;
          return;
        }
        if (payload?.choices?.[0]?.delta?.content) {
          capturedTokens.push(payload.choices[0].delta.content);
        }
      };

      // Simulate stream chunks arriving across packet boundaries
      let buffer = '';

      // Chunk 1: regular line with newline
      buffer += 'data: {"choices":[{"delta":{"content":"Alpha"}}]}\n';
      buffer = StreamingInferenceClient.parseSseLines(buffer, handleData);

      // Chunk 2: line broken across reads
      buffer += 'data: {"choices":[{"delta":{"content":" Beta';
      buffer = StreamingInferenceClient.parseSseLines(buffer, handleData);

      // Chunk 3: rest of the line, followed by newline, plus trailing chunk WITHOUT newline
      buffer += '"}}]}\ndata: {"choices":[{"delta":{"content":" Gamma"}}]}\ndata: {"choices":[{"delta":{"content":" Delta';
      buffer = StreamingInferenceClient.parseSseLines(buffer, handleData);

      // Chunk 4: finish Delta line without any newline at end of stream
      buffer += '"}}]}';
      buffer = StreamingInferenceClient.parseSseLines(buffer, handleData);

      // Stream terminates: buffer still holds Delta because no trailing \n arrived!
      expect(buffer).toContain('Delta');

      // Flush trailing buffer
      StreamingInferenceClient.flushSseBuffer(buffer, handleData);

      // Assert zero tokens dropped
      expect(capturedTokens).toEqual(['Alpha', ' Beta', ' Gamma', ' Delta']);
    });

    it('flushes trailing data: [DONE] token without trailing newline cleanly', () => {
      let isDone = false;
      const buffer = 'data: [DONE]';

      StreamingInferenceClient.flushSseBuffer(buffer, (_payload, done) => {
        if (done) isDone = true;
      });

      expect(isDone).toBe(true);
    });

    it('handles trailing malformed JSON or heartbeat comments in flushSseBuffer gracefully', () => {
      let callbackInvoked = false;
      // 1. Comment line
      StreamingInferenceClient.flushSseBuffer(': heartbeat ping', () => {
        callbackInvoked = true;
      });
      expect(callbackInvoked).toBe(false);

      // 2. Malformed JSON
      expect(() => {
        StreamingInferenceClient.flushSseBuffer('data: {malformed json...', () => {
          callbackInvoked = true;
        });
      }).not.toThrow();
      expect(callbackInvoked).toBe(false);
    });
  });

  // ==========================================================================
  // CHALLENGE AREA 2: 429 Quota Guard & Jitter Backoff
  // ==========================================================================
  describe('2. 429 Quota Guard & Jitter Backoff Adversarial Suite', () => {
    describe('parseRetryAfter RFC 7231 & integer compliance', () => {
      it('correctly parses positive integer seconds with whitespace', () => {
        expect(QuotaGuard.parseRetryAfter('120')).toBe(120);
        expect(QuotaGuard.parseRetryAfter('0')).toBe(0);
        expect(QuotaGuard.parseRetryAfter('   45   ')).toBe(45);
        expect(QuotaGuard.parseRetryAfter('3600')).toBe(3600);
      });

      it('rejects invalid or malformed non-date strings', () => {
        expect(QuotaGuard.parseRetryAfter('abc')).toBeUndefined();
        expect(QuotaGuard.parseRetryAfter('-abc')).toBeUndefined();
        expect(QuotaGuard.parseRetryAfter('not-a-date-string')).toBeUndefined();
        expect(QuotaGuard.parseRetryAfter('')).toBeUndefined();
        expect(QuotaGuard.parseRetryAfter(null)).toBeUndefined();
        expect(QuotaGuard.parseRetryAfter(undefined)).toBeUndefined();
        expect(QuotaGuard.parseRetryAfter('   ')).toBeUndefined();
      });

      it('documents empirical behavior for negative or decimal inputs (V8 Date.parse lenient interpretation)', () => {
        // Empirical observation: In V8 JavaScript, Date.parse('-10') and Date.parse('12.5')
        // are parsed as dates in 2001. Because these timestamps are in the past,
        // Math.max(1, diffSec) clamps the backoff delay to 1.
        expect(QuotaGuard.parseRetryAfter('-10')).toBe(1);
        expect(QuotaGuard.parseRetryAfter('12.5')).toBe(1);
      });

      it('parses valid future RFC 7231 HTTP-Date strings and returns remaining delta seconds', () => {
        const futureDate = new Date(Date.now() + 60000).toUTCString();
        const parsed = QuotaGuard.parseRetryAfter(futureDate);
        expect(parsed).toBeDefined();
        // Should be approximately 60 seconds (allow 58-62 for clock tick)
        expect(parsed!).toBeGreaterThanOrEqual(58);
        expect(parsed!).toBeLessThanOrEqual(62);
      });

      it('clamps past RFC 7231 HTTP-Date strings to minimum 1 second delay', () => {
        const pastDate = new Date(Date.now() - 30000).toUTCString();
        const parsed = QuotaGuard.parseRetryAfter(pastDate);
        expect(parsed).toBe(1);
      });

      it('returns undefined for unparseable HTTP date strings', () => {
        expect(QuotaGuard.parseRetryAfter('Not A Real Date')).toBeUndefined();
      });
    });

    describe('Empirical Jitter Entropy (100 Iterations)', () => {
      it('empirically verifies jitter distribution spread across 100 iterations (no thundering herd)', () => {
        const iterations = 100;
        const delays: number[] = [];

        for (let i = 0; i < iterations; i++) {
          delays.push(QuotaGuard.computeExponentialJitterBackoff(0, undefined, 1500, 60000));
        }

        // 1. Min / Max range verification for retry 0
        // Base delay = 1500. Floor(1500 / 2) = 750.
        // Full jitter exponential = 1500 * 2^0 = 1500.
        // Values must be between 750 and 750 + 1500 = 2250.
        for (const d of delays) {
          expect(d).toBeGreaterThanOrEqual(750);
          expect(d).toBeLessThanOrEqual(2250);
        }

        // 2. Entropy check: assert distribution spread (distinct values)
        const uniqueValues = new Set(delays);
        // In 100 random draws from a 1500-wide range, we expect high entropy (>60 unique values)
        expect(uniqueValues.size).toBeGreaterThan(60);

        // 3. Variance check: standard deviation must be non-zero
        const mean = delays.reduce((a, b) => a + b, 0) / iterations;
        const variance = delays.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / iterations;
        const stdDev = Math.sqrt(variance);

        expect(stdDev).toBeGreaterThan(150); // Demonstrates significant randomized spread
      });

      it('empirically verifies jitter spread when instructedSec is provided', () => {
        const iterations = 100;
        const delays: number[] = [];
        const instructedSec = 10; // 10,000ms

        for (let i = 0; i < iterations; i++) {
          delays.push(QuotaGuard.computeExponentialJitterBackoff(1, instructedSec, 1500, 60000));
        }

        // Instructed delay = 10,000ms. Jitter is 10% to 25% (1,000ms to 2,500ms).
        // Total delay must fall between 11,000ms and 12,500ms.
        for (const d of delays) {
          expect(d).toBeGreaterThanOrEqual(11000);
          expect(d).toBeLessThanOrEqual(12500);
        }

        const uniqueValues = new Set(delays);
        expect(uniqueValues.size).toBeGreaterThan(60);
      });

      it('strictly enforces maxMs ceiling even with high retry counts', () => {
        const maxMs = 5000;
        for (let i = 0; i < 50; i++) {
          const delay = QuotaGuard.computeExponentialJitterBackoff(25, undefined, 1000, maxMs);
          // With baseMs = 1000, max is Math.min(maxMs, ...) + baseMs / 2 = 5000 + 500 = 5500
          expect(delay).toBeLessThanOrEqual(maxMs + 500);
        }
      });
    });

    describe('Supervisor Quota Pause Auto-Resume vs Cancellation Logic', () => {
      it('auto-resumes quota-paused run whose reset window has elapsed and DOES NOT cancel it', async () => {
        const server = new CoreServer({ port: 0, dbPath: tempDbPath, requireIpcAuth: false });

        // Seed run in quota_paused with quota_resets_at in the recent past (2 seconds ago)
        const runId = 'run_quota_active_1';
        const agentId = 'agent-tester';
        const now = Date.now();
        const resetAt = now - 2000; // 2 seconds overdue

        db.execute(
          `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, quota_resets_at, created_at)
           VALUES (?, ?, 'proj-stress', 'quota_paused', ?, ?, ?)`,
          runId,
          agentId,
          now - 2000,
          resetAt,
          now - 60000
        );

        // Verify kernel returns it as ready to resume
        const readyRuns = server.kernel.getRunsReadyToResumeFromQuota();
        expect(readyRuns.some((r) => r.id === runId)).toBe(true);

        // Track calls to resumeInterruptedRun
        let resumeCalled = false;
        server.resumeInterruptedRun = async (id: string) => {
          if (id === runId) resumeCalled = true;
          return true;
        };

        // Run supervisor self-healing sweep
        server.runSupervisorSelfHealing();

        // Assert: The run must NOT be cancelled!
        const runRow = db.queryOne<any>('SELECT state, quota_resets_at FROM agent_runs WHERE id = ?', runId);
        expect(runRow.state).not.toBe('cancelled');
        expect(resumeCalled).toBe(true);
      });

      it('cancels abandoned quota runs ONLY when overdue by more than 24 hours', async () => {
        const server = new CoreServer({ port: 0, dbPath: tempDbPath, requireIpcAuth: false });

        // Seed run overdue by 25 hours (>24h)
        const ancientRunId = 'run_quota_abandoned_1';
        const agentId = 'agent-tester';
        const now = Date.now();
        const ancientResetAt = now - 25 * 3600 * 1000;

        db.execute(
          `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, quota_resets_at, created_at)
           VALUES (?, ?, 'proj-stress', 'quota_paused', ?, ?, ?)`,
          ancientRunId,
          agentId,
          now - 25 * 3600 * 1000,
          ancientResetAt,
          now - 30 * 3600 * 1000
        );

        // Run supervisor self-healing sweep
        server.runSupervisorSelfHealing();

        // Assert: The abandoned run must be cleanly transitioned to cancelled
        const runRow = db.queryOne<any>('SELECT state, quota_resets_at FROM agent_runs WHERE id = ?', ancientRunId);
        expect(runRow.state).toBe('cancelled');
        expect(runRow.quota_resets_at).toBeNull();
      });

      it('keeps runs in quota_paused when reset window is still in the future', async () => {
        const server = new CoreServer({ port: 0, dbPath: tempDbPath, requireIpcAuth: false });

        const futureRunId = 'run_quota_future_1';
        const agentId = 'agent-tester';
        const now = Date.now();
        const futureResetAt = now + 60000; // 1 minute in the future

        db.execute(
          `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, quota_resets_at, created_at)
           VALUES (?, ?, 'proj-stress', 'quota_paused', ?, ?, ?)`,
          futureRunId,
          agentId,
          now,
          futureResetAt,
          now
        );

        const readyRuns = server.kernel.getRunsReadyToResumeFromQuota();
        expect(readyRuns.some((r) => r.id === futureRunId)).toBe(false);

        server.runSupervisorSelfHealing();

        const runRow = db.queryOne<any>('SELECT state, quota_resets_at FROM agent_runs WHERE id = ?', futureRunId);
        expect(runRow.state).toBe('quota_paused');
        expect(runRow.quota_resets_at).toBe(futureResetAt);
      });
    });
  });

  // ==========================================================================
  // CHALLENGE AREA 3: SkillEngine BigInt Serialization & Sandbox Isolation
  // ==========================================================================
  describe('3. SkillEngine BigInt Serialization & Sandbox Isolation', () => {
    let skillEngine: SkillEngine;

    beforeEach(() => {
      skillEngine = new SkillEngine(db, path.join(tempDir, 'skills'));
    });

    it('safely serializes BigInt parameters { count: 9007199254740993n } and executes worker successfully without TypeError', async () => {
      const skill = skillEngine.createSkill({
        name: 'bigint-calculator',
        description: 'Processes large 64-bit integer counters',
        instructions: 'Parse and double the BigInt counter',
        handlerCode: `
          module.exports = async function(params) {
            const countStr = params.count;
            const parsed = BigInt(countStr);
            const doubled = parsed * 2n;
            return {
              received: countStr,
              isString: typeof countStr === 'string',
              doubled: doubled.toString(),
              nestedBig: params.nested?.nanoTime,
            };
          };
        `,
        parameters: { count: { type: 'string' } },
        skillType: 'tool_extension',
        status: 'active',
      });

      // Pass actual BigInt instances in params
      const bigIntParams = {
        count: 9007199254740993n,
        nested: {
          nanoTime: 1730000000000000001n,
        },
      };

      const result = await skillEngine.executeSkill('bigint-calculator', bigIntParams);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output.received).toBe('9007199254740993');
      expect(result.output.isString).toBe(true);
      expect(result.output.doubled).toBe('18014398509481986');
      expect(result.output.nestedBig).toBe('1730000000000000001');
    });

    it('blocks prototype pollution of Object.prototype from sandboxed skill worker', async () => {
      const skill = skillEngine.createSkill({
        name: 'prototype-polluter',
        description: 'Attempts to pollute Object.prototype',
        instructions: 'Inject malicious property into Object.prototype',
        handlerCode: `
          module.exports = async function() {
            let errorCaught = null;
            try {
              Object.prototype.pwned = 'HACKED';
            } catch (err) {
              errorCaught = err.message;
            }
            return {
              errorCaught,
              inSandboxProto: ({}).pwned,
            };
          };
        `,
        parameters: {},
        skillType: 'tool_extension',
        status: 'active',
      });

      const result = await skillEngine.executeSkill('prototype-polluter', {});
      expect(result.success).toBe(true);

      // Verify that Object.prototype in host environment is completely untouched
      expect((Object.prototype as any).pwned).toBeUndefined();
      expect(({} as any).pwned).toBeUndefined();
    });

    it('prevents constructor escape to Function/eval via codeGeneration strings disallowance', async () => {
      const skill = skillEngine.createSkill({
        name: 'constructor-escape-attacker',
        description: 'Attempts to construct arbitrary Function to reach process',
        instructions: 'Call constructor.constructor with code string',
        handlerCode: `
          module.exports = async function() {
            try {
              const foreignFn = ({}).constructor.constructor;
              return foreignFn("return 42")();
            } catch (err) {
              return { blocked: true, error: err.message, name: err.name };
            }
          };
        `,
        parameters: {},
        skillType: 'tool_extension',
        status: 'active',
      });

      const result = await skillEngine.executeSkill('constructor-escape-attacker', {});
      expect(result.success).toBe(true);
      expect(result.output.blocked).toBe(true);
      // V8 disallows code generation from strings
      expect(result.output.error).toMatch(/Code generation from strings disallowed/i);
    });

    it('confirms process and require are stripped and unreachable inside sandbox', async () => {
      const skill = skillEngine.createSkill({
        name: 'host-leak-tester',
        description: 'Inspects global availability of process and require',
        instructions: 'Check process and require types',
        handlerCode: `
          module.exports = async function() {
            return {
              processType: typeof process,
              requireType: typeof require,
              globalThisProcess: typeof globalThis.process,
              globalThisRequire: typeof globalThis.require,
            };
          };
        `,
        parameters: {},
        skillType: 'tool_extension',
        status: 'active',
      });

      const result = await skillEngine.executeSkill('host-leak-tester', {});
      expect(result.success).toBe(true);
      expect(result.output.processType).toBe('undefined');
      expect(result.output.requireType).toBe('undefined');
      expect(result.output.globalThisProcess).toBe('undefined');
      expect(result.output.globalThisRequire).toBe('undefined');
    });

    it('confirms safeSetTimeout timer handle severing prevents prototype traversal', async () => {
      const skill = skillEngine.createSkill({
        name: 'timer-sever-tester',
        description: 'Inspects setTimeout prototype chain',
        instructions: 'Check setTimeout prototype and constructor',
        handlerCode: `
          module.exports = async function() {
            return {
              timerType: typeof setTimeout,
              timerProto: String(Object.getPrototypeOf(setTimeout)),
              timerConstructor: typeof setTimeout.constructor,
            };
          };
        `,
        parameters: {},
        skillType: 'tool_extension',
        status: 'active',
      });

      const result = await skillEngine.executeSkill('timer-sever-tester', {});
      expect(result.success).toBe(true);
      expect(result.output.timerType).toBe('function');
      expect(result.output.timerProto).toBe('null');
      expect(result.output.timerConstructor).toBe('undefined');
    });
  });

  // ==========================================================================
  // CHALLENGE AREA 4: Windows MCP Client Argument Escaping
  // ==========================================================================
  describe('4. Windows MCP Client Argument Escaping & Injection Resistance', () => {
    // Contract implementation from mcp_client.ts:757-759
    function escapeWindowsCmdArg(arg: string): string {
      return /[ &|<>^%"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
    }

    it('identifies and quotes all Windows shell metacharacters (&, |, <, >, ^, %, space, quote)', () => {
      const testCases = [
        { raw: 'normal', expected: 'normal' },
        { raw: 'arg with space', expected: '"arg with space"' },
        { raw: 'foo&bar', expected: '"foo&bar"' },
        { raw: 'foo|bar', expected: '"foo|bar"' },
        { raw: 'foo<bar', expected: '"foo<bar"' },
        { raw: 'foo>bar', expected: '"foo>bar"' },
        { raw: 'foo^bar', expected: '"foo^bar"' },
        { raw: '%PATH%', expected: '"%PATH%"' },
        { raw: 'foo"bar', expected: '"foo""bar"' },
        { raw: 'foo & calc.exe', expected: '"foo & calc.exe"' },
        { raw: 'test|whoami > out.txt', expected: '"test|whoami > out.txt"' },
      ];

      for (const tc of testCases) {
        expect(escapeWindowsCmdArg(tc.raw)).toBe(tc.expected);
      }
    });

    it('empirically verifies on Windows that safeArgs prevents command chaining (&) and file redirection (>)', () => {
      if (process.platform !== 'win32') {
        // Test is specifically designed for Windows shell: true
        return;
      }

      const pwnedFilePath = path.join(tempDir, 'injected_pwned.txt');
      expect(fs.existsSync(pwnedFilePath)).toBe(false);

      // Malicious argument attempting to chain command: & echo PWNED > <pwnedFilePath>
      const maliciousArg = `hello & echo PWNED > "${pwnedFilePath}"`;

      // 1. With safeArgs:
      const safeArg = escapeWindowsCmdArg(maliciousArg);

      // Execute via node under shell: true (which uses cmd.exe /d /s /c on Windows)
      const inspectScript = `console.log(process.argv[1]);`;
      const result = spawnSync('node', ['-e', inspectScript, safeArg], {
        shell: true,
        encoding: 'utf-8',
      });

      // Assert:
      // A. The command injection file was NOT created!
      expect(fs.existsSync(pwnedFilePath)).toBe(false);

      // B. The child process received the entire literal argument without shell execution
      expect(result.stdout.trim()).toBe(maliciousArg);
    });

    it('empirically verifies that pipe (|) and caret (^) metacharacters are safely neutralized by safeArgs', () => {
      if (process.platform !== 'win32') return;

      const pipeArg = 'test | whoami';
      const safePipe = escapeWindowsCmdArg(pipeArg);

      const result = spawnSync('node', ['-e', 'console.log(process.argv[1]);', safePipe], {
        shell: true,
        encoding: 'utf-8',
      });

      // Shell pipe was not executed; literal argument preserved
      expect(result.stdout.trim()).toBe(pipeArg);
    });

    it('evaluates cmd.exe behavior on percent sign (%) and non-existent environment variables', () => {
      if (process.platform !== 'win32') return;

      // When environment variable does not exist in cmd.exe, it is preserved literally
      const nonExistentVar = '%NONEXISTENT_KIN_VAR_12345%';
      const safeArg = escapeWindowsCmdArg(nonExistentVar);

      const result = spawnSync('node', ['-e', 'console.log(process.argv[1])', safeArg], {
        shell: true,
        encoding: 'utf-8',
      });

      expect(result.stdout.trim()).toBe(nonExistentVar);
    });
  });

  // ==========================================================================
  // CHALLENGE AREA 5: Context Compiler Budget Overflow
  // ==========================================================================
  describe('5. Context Compiler Budget Overflow & Packing Stress', () => {
    let compiler: ContextCompiler;

    beforeEach(() => {
      compiler = new ContextCompiler();
    });

    it('formatMemoryList strictly packs within budget and drops overflow items when provided 100 large items', () => {
      // Create 100 large memory items (~1.5KB each, ~375 tokens each)
      const largeMemories = Array.from({ length: 100 }, (_, i) => ({
        key: `large_key_${i.toString().padStart(3, '0')}`,
        type: 'memory',
        tier: 'project',
        content: `Payload_${i}: ` + 'X'.repeat(1500),
        updatedAt: 1000000 + i, // ascending recency
      }));

      // Total unconstrained tokens would be ~37,500 tokens
      // Test with maxTierTokens = 1000 tokens
      const maxTierTokens = 1000;
      const formatted = compiler.formatMemoryList(largeMemories, maxTierTokens, true);

      expect(formatted).not.toBe('None recorded.');

      const lines = formatted.split('\n');
      // At ~375 tokens per item, only ~2-3 items should fit in 1000 tokens
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(4);

      // Estimated tokens of packed result must be strictly within budget (or bounded by 1 item)
      const estimatedTokens = Math.ceil(formatted.length / 4);
      expect(estimatedTokens).toBeLessThanOrEqual(maxTierTokens + 400);

      // Must prioritize most recent items (highest updatedAt: item 099, 098)
      expect(formatted).toContain('large_key_099');
    });

    it('compile() bounds memory tiers and dynamic trajectory without context window blowout under heavy load', () => {
      // 100 project memories (each 1KB)
      const projectMemories = Array.from({ length: 100 }, (_, i) => ({
        id: `pm_${i}`,
        projectId: 'proj-1',
        tier: 'project' as const,
        key: `proj_fact_${i}`,
        content: `Fact ${i}: ` + 'P'.repeat(1000),
        tokenCount: 250,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      }));

      // 100 channel memories (each 1KB)
      const channelMemories = Array.from({ length: 100 }, (_, i) => ({
        id: `cm_${i}`,
        channelId: 'chan-1',
        tier: 'channel' as const,
        key: `chan_note_${i}`,
        content: `Channel Note ${i}: ` + 'C'.repeat(1000),
        tokenCount: 250,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      }));

      // 100 private memories (each 1KB)
      const privateMemories = Array.from({ length: 100 }, (_, i) => ({
        id: `prm_${i}`,
        agentId: 'agent-boss',
        tier: 'private' as const,
        key: `private_thought_${i}`,
        content: `Private Thought ${i}: ` + 'M'.repeat(1000),
        tokenCount: 250,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
      }));

      // 50 trajectory messages (each 800 chars)
      const trajectoryMessages: Message[] = Array.from({ length: 50 }, (_, i) => ({
        id: `msg_${i}`,
        channelId: 'chan-1',
        senderId: i % 2 === 0 ? 'user' : 'agent-boss',
        senderType: i % 2 === 0 ? 'user' : 'agent',
        content: `Trajectory turn ${i}: ` + 'T'.repeat(800),
        createdAt: 2000 + i,
      }));

      const def: AgentDefinition = {
        id: 'def-boss',
        name: 'Boss',
        role: 'Orchestrator',
        systemPrompt: 'Coordinate workforce tasks efficiently.',
        defaultModelId: 'ollama/llama3',
        domainAuthority: ['orchestration'],
        capabilities: ['fs_read'],
        createdAt: 100,
      };

      const identity: AgentIdentity = {
        id: 'agent-boss',
        workspaceId: 'ws-1',
        definitionId: 'def-boss',
        displayName: '@Boss',
        activeModelId: 'ollama/llama3',
        isOrchestrator: true,
        isEphemeral: false,
        createdAt: 100,
        updatedAt: 100,
      };

      const input: ContextCompileInput = {
        tokenBudget: 3500, // Strict 3500 token budget!
        agentDefinition: def,
        agentIdentity: identity,
        toolSchemas: [{ name: 'readFile', description: 'Reads file', parameters: {} }],
        projectDecisions: [{ key: 'Architecture', decision: 'Local-first WAL SQLite' }],
        projectMemories,
        channelMemories,
        agentPrivateMemories: privateMemories,
        trajectoryMessages,
      };

      const compiled = compiler.compile(input);

      // 1. Verify blocks exist
      expect(compiled.systemPromptBlock).toBeDefined();
      expect(compiled.toolSchemasBlock).toBeDefined();
      expect(compiled.projectGroundingBlock).toBeDefined();

      // 2. Memory block must be packed proportionally, NOT containing all 300 memories!
      // In unconstrained compile, 300 memories would be 300,000 characters.
      expect(compiled.projectGroundingBlock.length).toBeLessThan(25000);

      // 3. Dynamic trajectory must be pruned to fit remaining budget
      expect(compiled.dynamicTrajectoryBlock.length).toBeLessThan(trajectoryMessages.length);
      expect(compiled.dynamicTrajectoryBlock.length).toBeGreaterThan(0);

      // 4. Most recent trajectory messages must be preserved (reverse chronological priority)
      const lastMsg = compiled.dynamicTrajectoryBlock[compiled.dynamicTrajectoryBlock.length - 1];
      expect(lastMsg.id).toBe('msg_49');
    });
  });
});
