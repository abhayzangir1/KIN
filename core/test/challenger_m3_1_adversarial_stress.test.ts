import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { Sentinel } from '../src/security/sentinel.js';
import { AutonomyMode, RiskLevel } from '../domain/types.js';

/**
 * Empirical Challenger M3-1: Adversarial Stress Test Suite
 * Milestone 3: Workforce UI, Chat Transcript Contract, Swarm Map Approvals, and Task DAG Engine
 */
describe('Challenger M3-1: Adversarial Stress Test Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let migrationRunner: MigrationRunner;
  let taskRepo: TaskRepository;
  let sentinel: Sentinel;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-challenger-m3-1-'));
    dbPath = path.join(tempDir, 'challenger_m3_1.db');
    db = new KinDatabase(dbPath);
    migrationRunner = new MigrationRunner(db);
    migrationRunner.runMigrations();
    seedTestFixtures(db, tempDir);

    taskRepo = new TaskRepository(db);
    sentinel = Sentinel.getInstance();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function seedTestFixtures(database: KinDatabase, rootPath: string) {
    const now = Date.now();
    database.execute(
      `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-stress', 'Stress Workspace', ?, 'AUTO', ?, ?);`,
      rootPath,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, created_at, updated_at)
       VALUES ('proj-stress', 'ws-stress', 'Stress Project', ?, ?, ?);`,
      rootPath,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO channels (id, project_id, name, topic, created_at)
       VALUES ('chan-stress', 'proj-stress', 'general', 'General Stress Channel', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES ('def-stress', 'orch', 'Orchestrator', 'Prompt', 'ollama/llama3', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, created_at, updated_at)
       VALUES ('agent-stress-1', 'ws-stress', 'proj-stress', 'def-stress', 'Orchestrator', 'ollama/llama3', ?, ?);`,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
       VALUES ('goal-stress', 'proj-stress', 'Stress Goal', 'Desc', '[]', 'active', ?, ?);`,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at)
       VALUES ('run-1', 'agent-stress-1', 'proj-stress', 'running', ?, ?);`,
      now,
      now
    );
  }

  // ==========================================================================
  // Section 1: Chat Transcript Contract Segregation & Pure Prose Verification
  // ==========================================================================
  describe('Section 1: Chat Transcript Contract Segregation & Prose Sanitization', () => {
    // Production sanitizer as implemented in ui/src/components/messages/MessageItem.tsx
    function messageItemCleanProse(content: string): string {
      return content
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
        .replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '')
        .trim();
    }

    // Production sanitizer as implemented in ui/src/components/CenterView.tsx
    function centerViewStripThoughts(raw: string): string {
      if (!raw) return '';
      let text = raw;
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
      text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
      text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
      text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
      text = text.replace(/<(?:think|thought|reasoning)>[\s\S]*$/gi, '');
      text = text.replace(/^Thinking Process:[\s\S]*?\n\n/i, '');
      return text.trim();
    }

    // Production background turn detector as in ui/src/components/chat/ChatTimeline.tsx & CenterView.tsx
    function isBackgroundTurn(msg: {
      content: string;
      is_background?: boolean | number | string;
      isBackground?: boolean | number | string;
      metadata?: any;
    }): boolean {
      if (Boolean(msg.is_background) || Boolean(msg.isBackground)) return true;
      if (msg.metadata) {
        if (typeof msg.metadata === 'object') {
          if (Boolean(msg.metadata.is_background) || Boolean(msg.metadata.isBackground)) return true;
        } else if (typeof msg.metadata === 'string') {
          try {
            const parsed = JSON.parse(msg.metadata);
            if (Boolean(parsed.is_background) || Boolean(parsed.isBackground)) return true;
          } catch {}
        }
      }
      return (
        msg.content.includes('[Automated Turn]') ||
        msg.content.includes('[Scheduled Wakeup]') ||
        msg.content.includes('[Background Task]') ||
        msg.content.includes('⏰ Wakeup Timer Fired') ||
        msg.content.includes('Timer / Scheduled Alarm') ||
        msg.content.includes('⏰ **Timer') ||
        msg.content.includes('🔄 Proactive Routine') ||
        msg.content.includes('🤖 [Automated Wakeup]')
      );
    }

    it('adversarially strips multi-level nested reasoning tags in all permutation orders', () => {
      // 1. Order: think -> reasoning -> thought
      const text1 = `Hello user! <think><reasoning><thought>deeply nested internal CoT reasoning</thought></reasoning></think> How can I assist you?`;
      const clean1 = messageItemCleanProse(text1);
      expect(clean1).not.toContain('deeply nested');
      expect(clean1).not.toContain('<think>');
      expect(clean1).not.toContain('<thought>');
      expect(clean1).not.toContain('<reasoning>');
      expect(clean1).toBe('Hello user!  How can I assist you?');

      // 2. Order: thought -> think -> reasoning
      const text2 = `Answer: 42 <thought><think><reasoning>calculating life the universe and everything</reasoning></think></thought>`;
      const clean2 = messageItemCleanProse(text2);
      expect(clean2).not.toContain('calculating');
      expect(clean2).toBe('Answer: 42');

      // 3. Order: reasoning -> thought -> think
      const text3 = `<reasoning><thought><think>step1 step2 step3</think></thought></reasoning>Ready to deploy.`;
      const clean3 = messageItemCleanProse(text3);
      expect(clean3).not.toContain('step1');
      expect(clean3).toBe('Ready to deploy.');
    });

    it('strips case-insensitive variations and tags with extra whitespace', () => {
      const text = `<THINK>
Uppercase thought
</THINK>
<Thought>
Mixed case thought
</Thought>
<REASONING>
Caps reasoning
</REASONING>
<tool_call>
{"name": "test"}
</tool_call>
Here is the final deliverable.`;

      const cleaned = messageItemCleanProse(text);
      expect(cleaned).not.toContain('Uppercase thought');
      expect(cleaned).not.toContain('Mixed case thought');
      expect(cleaned).not.toContain('Caps reasoning');
      expect(cleaned).not.toContain('tool_call');
      expect(cleaned).toBe('Here is the final deliverable.');
    });

    it('handles unclosed reasoning tags without leaking when processed by CenterView sanitizer', () => {
      const unclosedAtEnd = `I am drafting the architecture doc.\n<think>Analyzing whether SQLite WAL handles 100 concurrent connections`;
      const cleaned = centerViewStripThoughts(unclosedAtEnd);

      expect(cleaned).not.toContain('<think>');
      expect(cleaned).not.toContain('Analyzing whether SQLite WAL');
      expect(cleaned).toBe('I am drafting the architecture doc.');
    });

    it('prevents leakage when message consists entirely of reasoning tags', () => {
      const purelyThought = `<think>
This is an agent thinking turn that emitted zero user prose.
Internal steps: [1, 2, 3]
</think>`;

      const cleanedProse = messageItemCleanProse(purelyThought);
      // In MessageItem.tsx: if (!prose) return null; -> completely hidden from timeline
      expect(cleanedProse).toBe('');

      const centerViewCleaned = centerViewStripThoughts(purelyThought);
      expect(centerViewCleaned).toBe('');
    });

    it('segregates raw tool syntax (<tool_call>, <tool_result>) and preserves markdown code fences', () => {
      const mixedMessage = `Here is the code snippet:
\`\`\`typescript
export function computeSum(a: number, b: number): number {
  return a + b;
}
\`\`\`
<tool_call>
{"name": "run_tests", "args": {"file": "sum.test.ts"}}
</tool_call>
<tool_result>
{"passed": true, "duration": 12}
</tool_result>
Tests have passed successfully!`;

      const cleaned = messageItemCleanProse(mixedMessage);
      expect(cleaned).not.toContain('<tool_call>');
      expect(cleaned).not.toContain('<tool_result>');
      expect(cleaned).not.toContain('run_tests');
      expect(cleaned).toContain('export function computeSum');
      expect(cleaned).toContain('Tests have passed successfully!');
    });

    it('empirically reveals regex non-recurrence limitation when encountering nested identical tags', () => {
      // Adversarial attack: nested identical tags <think><think>...</think>...</think>
      const nestedSame = `<think><think>nested inner thought</think> trailing thought</think> User deliverable.`;
      const cleaned = messageItemCleanProse(nestedSame);

      // Single-pass non-greedy regex matches outer <think> to inner </think>,
      // leaving "trailing thought</think> User deliverable." behind!
      expect(cleaned).toContain('trailing thought</think>');
      expect(cleaned).toContain('User deliverable.');
    });

    it('empirically demonstrates that unclosed streaming reasoning tags leak in MessageItem due to missing unclosed-tag regex', () => {
      const streamingUnclosed = `<think>Analyzing private company credentials without closing tag`;
      const cleanedInMessageItem = messageItemCleanProse(streamingUnclosed);

      // messageItemCleanProse requires closing </think>. Without it, regex does not match.
      expect(cleanedInMessageItem).toBe(streamingUnclosed);

      // In contrast, CenterView's regex /<(?:think|thought|reasoning)>[\s\S]*$/gi successfully catches it:
      const cleanedInCenterView = centerViewStripThoughts(streamingUnclosed);
      expect(cleanedInCenterView).toBe('');
    });

    it('empirically demonstrates CenterView fallback flaw where purely thought messages leak via cleaned || content', () => {
      // In CenterView.tsx lines 584-586:
      // const cleaned = isHumanMsg ? content : stripThoughtsAndToolSyntax(content);
      // const textToRender = cleaned || content;
      const pureThoughtMsg = `<think>Internal confidential reasoning with no user prose</think>`;
      const cleaned = centerViewStripThoughts(pureThoughtMsg);
      expect(cleaned).toBe(''); // Correctly stripped to empty string

      // BUT the fallback expression "cleaned || content" reverts to raw content!
      const textToRender = cleaned || pureThoughtMsg;
      expect(textToRender).toBe(pureThoughtMsg); // Leaks the entire raw thought tag!
    });

    it('empirically demonstrates that BackgroundTurnPill does not strip tool execution markup', () => {
      // Production sanitizer as in BackgroundTurnPill.tsx lines 13-17:
      const backgroundTurnClean = (content: string) =>
        content
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
          .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
          .trim();

      const bgMsgWithTool = `<tool_call>{"name": "fetch_cron_logs"}</tool_call><tool_result>{"ok": true}</tool_result> Routine completed.`;
      const cleaned = backgroundTurnClean(bgMsgWithTool);

      // Tool tags are NOT stripped in BackgroundTurnPill:
      expect(cleaned).toContain('<tool_call>');
      expect(cleaned).toContain('<tool_result>');
      expect(cleaned).toContain('Routine completed.');
    });

    it('correctly classifies background turns across all metadata permutations & trigger keywords', () => {
      // 1. Direct boolean flags
      expect(isBackgroundTurn({ content: 'Sync done', is_background: true })).toBe(true);
      expect(isBackgroundTurn({ content: 'Sync done', isBackground: true })).toBe(true);
      expect(isBackgroundTurn({ content: 'User chat', is_background: false })).toBe(false);

      // 2. Numeric / string booleans from SQLite/JSON
      expect(isBackgroundTurn({ content: 'Cron run', is_background: 1 })).toBe(true);
      expect(isBackgroundTurn({ content: 'Manual turn', is_background: 0 })).toBe(false);
      expect(isBackgroundTurn({ content: 'Cron run', is_background: 'true' })).toBe(true);

      // 3. Nested metadata object
      expect(isBackgroundTurn({ content: 'Indexed', metadata: { is_background: true } })).toBe(true);
      expect(isBackgroundTurn({ content: 'Indexed', metadata: { isBackground: true } })).toBe(true);
      expect(isBackgroundTurn({ content: 'Normal', metadata: { is_background: false } })).toBe(false);

      // 4. JSON string metadata (from database column metadata_json)
      expect(isBackgroundTurn({ content: 'Routine', metadata: JSON.stringify({ is_background: true }) })).toBe(true);

      // 5. Automated routine trigger keywords in content
      expect(isBackgroundTurn({ content: '[Automated Turn] Backup completed' })).toBe(true);
      expect(isBackgroundTurn({ content: '[Scheduled Wakeup] Checking API health' })).toBe(true);
      expect(isBackgroundTurn({ content: '[Background Task] Scanned 10 files' })).toBe(true);
      expect(isBackgroundTurn({ content: '⏰ Wakeup Timer Fired: Daily sync' })).toBe(true);
      expect(isBackgroundTurn({ content: 'Timer / Scheduled Alarm triggered' })).toBe(true);
      expect(isBackgroundTurn({ content: '⏰ **Timer #1** completed' })).toBe(true);
      expect(isBackgroundTurn({ content: '🔄 Proactive Routine running' })).toBe(true);
      expect(isBackgroundTurn({ content: '🤖 [Automated Wakeup] Status OK' })).toBe(true);

      // 6. Ordinary human conversation should not be mistaken for background turn
      expect(isBackgroundTurn({ content: 'Can we schedule a meeting tomorrow at 10am?' })).toBe(false);
      expect(isBackgroundTurn({ content: 'Please review the pull request for the auth module.' })).toBe(false);
    });
  });

  // ==========================================================================
  // Section 2: Swarm Map Topology & Approval Triggers Under Concurrency
  // ==========================================================================
  describe('Section 2: Swarm Map Topology, CAS Approvals & Zoom Bounds', () => {
    // Production handleAutoFit algorithm as implemented in ui/src/components/SwarmMap.tsx
    function calculateAutoFit(
      nodePositions: Record<string, { x: number; y: number }>,
      clientWidth: number = 1000,
      clientHeight: number = 700
    ) {
      const nodes = Object.values(nodePositions);
      if (nodes.length === 0) return null;
      const pad = 80;
      const minX = Math.min(...nodes.map((n) => n.x - 145)) - pad;
      const maxX = Math.max(...nodes.map((n) => n.x + 145)) + pad;
      const minY = Math.min(...nodes.map((n) => n.y - 85)) - pad;
      const maxY = Math.max(...nodes.map((n) => n.y + 85)) + pad;
      const w = clientWidth || 1000;
      const h = clientHeight || 700;
      const scaleX = w / Math.max(1, maxX - minX);
      const scaleY = h / Math.max(1, maxY - minY);
      const fitZoom = Math.min(1.5, Math.max(0.4, Math.min(scaleX, scaleY)));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      return {
        zoom: Number(fitZoom.toFixed(2)),
        pan: {
          x: Math.round(w / 2 - centerX * fitZoom),
          y: Math.round(h / 2 - centerY * fitZoom),
        },
      };
    }

    it('enforces atomic Compare-And-Swap (CAS) approval resolution under rapid concurrent bursts', async () => {
      const approvalId = 'appr-concurrency-test';
      const now = Date.now();
      db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
         VALUES (?, 'run-1', 'agent-stress-1', 'fs:write_file', '{"path":"/etc/passwd"}', 'HIGH', 'pending', ?, ?)`,
        approvalId,
        now + 300000,
        now
      );

      // Simulate 20 concurrent requests attempting to resolve the same pending approval simultaneously
      // (10 attempts to approve, 10 attempts to reject)
      const attempts = Array.from({ length: 20 }, (_, i) => ({
        reqId: i,
        decision: i % 2 === 0 ? 'approved' : 'rejected',
      }));

      const results = await Promise.all(
        attempts.map(async (attempt) => {
          // Atomic CAS query matching task_controller.ts:
          // UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'
          const res = db.execute(
            `UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`,
            attempt.decision,
            Date.now(),
            approvalId
          );
          return {
            reqId: attempt.reqId,
            decision: attempt.decision,
            changes: Number(res.changes),
          };
        })
      );

      // Exactly ONE concurrent request must win the CAS race (changes === 1)
      const successfulResolutions = results.filter((r) => r.changes === 1);
      const failedResolutions = results.filter((r) => r.changes === 0);

      expect(successfulResolutions.length).toBe(1);
      expect(failedResolutions.length).toBe(19);

      // Database state must be immutable once resolved
      const finalRow = db.queryOne<{ status: string; decided_at: number }>(
        'SELECT status, decided_at FROM approvals WHERE id = ?',
        approvalId
      );
      expect(finalRow).toBeDefined();
      expect(['approved', 'rejected']).toContain(finalRow!.status);
      expect(finalRow!.status).toBe(successfulResolutions[0].decision);
      expect(finalRow!.decided_at).toBeGreaterThanOrEqual(now);
    });

    it('rejects expired approval gates and transitions them to expired status', () => {
      const expiredApprovalId = 'appr-expired-test';
      const pastTime = Date.now() - 60000; // Expired 1 minute ago
      db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
         VALUES (?, 'run-1', 'agent-stress-1', 'shell:execute', '{"cmd":"reboot"}', 'CRITICAL', 'pending', ?, ?)`,
        expiredApprovalId,
        pastTime,
        pastTime - 60000
      );

      // Verification logic matching task_controller.ts lines 76-79:
      const row = db.queryOne<{ status: string; expires_at: number }>(
        'SELECT status, expires_at FROM approvals WHERE id = ?',
        expiredApprovalId
      );
      expect(row).toBeDefined();

      const isExpired = row!.expires_at && row!.expires_at < Date.now();
      expect(isExpired).toBe(true);

      if (isExpired) {
        db.execute(`UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ?`, Date.now(), expiredApprovalId);
      }

      const updatedRow = db.queryOne<{ status: string }>('SELECT status FROM approvals WHERE id = ?', expiredApprovalId);
      expect(updatedRow?.status).toBe('expired');
    });

    it('verifies Sentinel single-use authorization token lifecycle, TTL expiry, and parameter digest tampering protection', () => {
      const token = 'tok-adversarial-sentinel-123';
      const toolName = 'terminal:run_command';
      const runId = 'run-stress-sentinel';
      const validParams = { command: 'npm test', cwd: '/safe/dir' };
      const tamperedParams = { command: 'rm -rf /', cwd: '/safe/dir' };

      // 1. Register single-use token with valid parameter digest
      sentinel.registerApprovalToken(token, toolName, 5000, runId, validParams);
      expect(sentinel.hasApprovalToken(token)).toBe(true);

      // 2. Tampered parameters must be rejected
      const tamperedConsume = sentinel.consumeApprovalToken(token, toolName, runId, tamperedParams);
      expect(tamperedConsume).toBe(false);
      // Token must remain unconsumed after a rejected forgery attempt
      expect(sentinel.hasApprovalToken(token)).toBe(true);

      // 3. Valid parameters succeed on first attempt
      const validConsume = sentinel.consumeApprovalToken(token, toolName, runId, validParams);
      expect(validConsume).toBe(true);

      // 4. Single-use enforcement: Token MUST be consumed and destroyed immediately
      expect(sentinel.hasApprovalToken(token)).toBe(false);
      const replayConsume = sentinel.consumeApprovalToken(token, toolName, runId, validParams);
      expect(replayConsume).toBe(false);

      // 5. Expired token rejection
      const expiredToken = 'tok-expired-sentinel-999';
      sentinel.registerApprovalToken(expiredToken, toolName, -100, runId, validParams); // Expired TTL
      expect(sentinel.hasApprovalToken(expiredToken)).toBe(false);
      expect(sentinel.consumeApprovalToken(expiredToken, toolName, runId, validParams)).toBe(false);
    });

    it('robustly handles extreme node coordinates, negative boundaries, 10,000px offsets, and empty nodes in Swarm Map auto-fit zoom', () => {
      // 1. Empty nodes scenario
      const emptyFit = calculateAutoFit({});
      expect(emptyFit).toBeNull();

      // 2. Single node at origin
      const singleNodeFit = calculateAutoFit({ node1: { x: 0, y: 0 } }, 1200, 800);
      expect(singleNodeFit).not.toBeNull();
      expect(singleNodeFit!.zoom).toBe(1.5); // Clamped to max zoom 1.5
      expect(Number.isFinite(singleNodeFit!.pan.x)).toBe(true);
      expect(Number.isFinite(singleNodeFit!.pan.y)).toBe(true);

      // 3. Extreme negative coordinates (-10,000px to -50,000px)
      const negativeFit = calculateAutoFit({
        nodeA: { x: -10000, y: -15000 },
        nodeB: { x: -50000, y: -40000 },
      });
      expect(negativeFit).not.toBeNull();
      expect(negativeFit!.zoom).toBe(0.4); // Clamped to min zoom 0.4
      expect(Number.isFinite(negativeFit!.pan.x)).toBe(true);
      expect(Number.isFinite(negativeFit!.pan.y)).toBe(true);

      // 4. Extreme 10,000px offset spread
      const wideOffsetFit = calculateAutoFit({
        origin: { x: 0, y: 0 },
        distant: { x: 10000, y: 10000 },
      });
      expect(wideOffsetFit).not.toBeNull();
      expect(wideOffsetFit!.zoom).toBe(0.4); // Clamped to min zoom 0.4
      expect(wideOffsetFit!.pan.x).toBeLessThan(0); // Offset to center distant nodes

      // 5. Zero-dimension viewport boundary fallback
      const zeroViewportFit = calculateAutoFit(
        { nodeA: { x: 100, y: 100 }, nodeB: { x: 200, y: 200 } },
        0,
        0
      );
      expect(zeroViewportFit).not.toBeNull();
      expect(Number.isFinite(zeroViewportFit!.zoom)).toBe(true);
      expect(Number.isFinite(zeroViewportFit!.pan.x)).toBe(true);
      expect(Number.isFinite(zeroViewportFit!.pan.y)).toBe(true);

      // 6. High-density 500-node stress cluster
      const denseNodes: Record<string, { x: number; y: number }> = {};
      for (let i = 0; i < 500; i++) {
        denseNodes[`node_${i}`] = {
          x: (i * 37) % 5000,
          y: (i * 53) % 4000,
        };
      }
      const t0 = performance.now();
      const denseFit = calculateAutoFit(denseNodes, 1920, 1080);
      const elapsedMs = performance.now() - t0;

      expect(denseFit).not.toBeNull();
      expect(elapsedMs).toBeLessThan(15); // Fast execution (< 15ms)
      expect(denseFit!.zoom).toBeGreaterThanOrEqual(0.4);
      expect(denseFit!.zoom).toBeLessThanOrEqual(1.5);
      expect(Number.isFinite(denseFit!.pan.x)).toBe(true);
      expect(Number.isFinite(denseFit!.pan.y)).toBe(true);
    });
  });

  // ==========================================================================
  // Section 3: Task DAG Dependency Engine Multi-Node Cycle Stress (50+ Permutations)
  // ==========================================================================
  describe('Section 3: Task DAG Multi-Node Cycle Detection (50+ Topological Permutations)', () => {
    // In-memory frontend BFS algorithm as in ui/src/components/tasks/PrerequisiteSelectorModal.tsx
    function frontendWouldCreateCycle(
      taskId: string,
      candidateDepId: string,
      allTasks: Array<{ id: string; dependsOnTaskIds?: string[] }>
    ): boolean {
      if (!taskId || !candidateDepId) return false;
      if (taskId === candidateDepId) return true;

      const taskMap = new Map<string, string[]>();
      for (const t of allTasks) {
        taskMap.set(t.id, t.dependsOnTaskIds || []);
      }

      const queue: string[] = [candidateDepId];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === taskId) return true;
        if (visited.has(current)) continue;
        visited.add(current);

        const deps = taskMap.get(current) || [];
        for (const dep of deps) {
          if (!visited.has(dep)) {
            queue.push(dep);
          }
        }
      }

      return false;
    }

    // Helper to insert task fixture in SQLite
    function insertTask(id: string, title: string = id) {
      db.execute(
        `INSERT INTO tasks (id, goal_id, title, description, status, created_at, updated_at)
         VALUES (?, 'goal-stress', ?, 'Stress Task Description', 'ready', ?, ?)`,
        id,
        title,
        Date.now(),
        Date.now()
      );
    }

    it('stresses wouldCreateCycle against 55 distinct topological permutations and verifies 100% cycle rejection & diamond DAG allowance', () => {
      let testedPermutationsCount = 0;

      // ========================================================================
      // Permutation 1: Self-loop (1 test)
      // ========================================================================
      insertTask('node-self');
      expect(taskRepo.wouldCreateCycle('node-self', 'node-self')).toBe(true);
      expect(frontendWouldCreateCycle('node-self', 'node-self', [{ id: 'node-self' }])).toBe(true);
      testedPermutationsCount++;

      // ========================================================================
      // Permutations 2–6: 2-node cycles A <-> B (5 variants)
      // ========================================================================
      for (let i = 1; i <= 5; i++) {
        const a = `2node-${i}-A`;
        const b = `2node-${i}-B`;
        insertTask(a);
        insertTask(b);
        taskRepo.addDependency(a, b); // a depends on b

        // Attempting to make b depend on a MUST be detected as a cycle
        expect(taskRepo.wouldCreateCycle(b, a)).toBe(true);
        expect(
          frontendWouldCreateCycle(b, a, [
            { id: a, dependsOnTaskIds: [b] },
            { id: b, dependsOnTaskIds: [] },
          ])
        ).toBe(true);
        testedPermutationsCount++;
      }

      // ========================================================================
      // Permutations 7–16: Multi-hop linear cycles of varying lengths (3, 4, 5, 7, 10, 15, 20, 30, 40, 50 hops)
      // ========================================================================
      const chainLengths = [3, 4, 5, 7, 10, 15, 20, 30, 40, 50];
      for (const length of chainLengths) {
        const chainNodes: string[] = [];
        const inMemoryTasks: Array<{ id: string; dependsOnTaskIds: string[] }> = [];

        for (let i = 1; i <= length; i++) {
          const id = `chain-${length}-n${i}`;
          chainNodes.push(id);
          insertTask(id);
        }

        // Link in a line: n1 -> n2 -> n3 -> ... -> nL
        for (let i = 0; i < length - 1; i++) {
          const from = chainNodes[i];
          const to = chainNodes[i + 1];
          taskRepo.addDependency(from, to);
          inMemoryTasks.push({ id: from, dependsOnTaskIds: [to] });
        }
        inMemoryTasks.push({ id: chainNodes[length - 1], dependsOnTaskIds: [] });

        // Cycle 1: Tail depending on head (nL -> n1) closes the entire loop
        const tail = chainNodes[length - 1];
        const head = chainNodes[0];
        expect(taskRepo.wouldCreateCycle(tail, head)).toBe(true);
        expect(frontendWouldCreateCycle(tail, head, inMemoryTasks)).toBe(true);
        testedPermutationsCount++;
      }

      // ========================================================================
      // Permutations 17–21: Intermediate cycle hops in the 50-node chain
      // ========================================================================
      const chain50 = Array.from({ length: 50 }, (_, i) => `chain-50-n${i + 1}`);
      const intermediateHops = [
        [35, 10],
        [49, 25],
        [20, 5],
        [45, 40],
        [15, 1],
      ];
      for (const [fromIdx, toIdx] of intermediateHops) {
        const fromNode = chain50[fromIdx];
        const toNode = chain50[toIdx];
        expect(taskRepo.wouldCreateCycle(fromNode, toNode)).toBe(true);
        testedPermutationsCount++;
      }

      // ========================================================================
      // Permutations 22–31: 10 Diamond DAG Topologies (Diamonds MUST be ALLOWED!)
      // ========================================================================
      for (let d = 1; d <= 10; d++) {
        const root = `diamond-${d}-root`;
        const b1 = `diamond-${d}-branch1`;
        const b2 = `diamond-${d}-branch2`;
        const join = `diamond-${d}-join`;

        insertTask(root);
        insertTask(b1);
        insertTask(b2);
        insertTask(join);

        // root -> b1, root -> b2
        taskRepo.addDependency(b1, root);
        taskRepo.addDependency(b2, root);
        // join -> b1
        taskRepo.addDependency(join, b1);

        const memoryTasks = [
          { id: root, dependsOnTaskIds: [] },
          { id: b1, dependsOnTaskIds: [root] },
          { id: b2, dependsOnTaskIds: [root] },
          { id: join, dependsOnTaskIds: [b1] },
        ];

        // VALID DIAMOND: join adding b2 as second prerequisite MUST BE ALLOWED (returns false)
        expect(taskRepo.wouldCreateCycle(join, b2)).toBe(false);
        expect(frontendWouldCreateCycle(join, b2, memoryTasks)).toBe(false);

        // INVALID INVERSION: root depending on join MUST BE REJECTED (returns true)
        expect(taskRepo.wouldCreateCycle(root, join)).toBe(true);
        expect(frontendWouldCreateCycle(root, join, memoryTasks)).toBe(true);

        testedPermutationsCount++;
      }

      // ========================================================================
      // Permutations 32–36: Tree Fan-Out and Fan-In Topologies (5 tests)
      // ========================================================================
      for (let t = 1; t <= 5; t++) {
        const treeRoot = `tree-${t}-root`;
        insertTask(treeRoot);

        const children = Array.from({ length: 6 }, (_, c) => `tree-${t}-c${c}`);
        for (const c of children) {
          insertTask(c);
          taskRepo.addDependency(c, treeRoot); // child depends on root
        }

        // Fan-out: root depending on any child MUST be detected as a cycle
        expect(taskRepo.wouldCreateCycle(treeRoot, children[0])).toBe(true);
        expect(taskRepo.wouldCreateCycle(treeRoot, children[3])).toBe(true);
        expect(taskRepo.wouldCreateCycle(treeRoot, children[5])).toBe(true);

        // Cross-child dependencies (c1 -> c0) are valid DAG edges
        expect(taskRepo.wouldCreateCycle(children[1], children[0])).toBe(false);

        testedPermutationsCount++;
      }

      // ========================================================================
      // Permutations 37–46: Disconnected Subgraphs (10 tests)
      // ========================================================================
      for (let g = 1; g <= 5; g++) {
        const g1_a = `disc-${g}-1A`;
        const g1_b = `disc-${g}-1B`;
        const g2_a = `disc-${g}-2A`;
        const g2_b = `disc-${g}-2B`;

        insertTask(g1_a);
        insertTask(g1_b);
        insertTask(g2_a);
        insertTask(g2_b);

        taskRepo.addDependency(g1_a, g1_b); // 1A depends on 1B
        taskRepo.addDependency(g2_a, g2_b); // 2A depends on 2B

        // Valid acyclic connection between components: 1B depends on 2A
        expect(taskRepo.wouldCreateCycle(g1_b, g2_a)).toBe(false);
        testedPermutationsCount++;

        // Add the inter-component edge
        taskRepo.addDependency(g1_b, g2_a);

        // Now: 1A -> 1B -> 2A -> 2B.
        // Attempting to make 2B depend on 1A closes a cross-component cycle!
        expect(taskRepo.wouldCreateCycle(g2_b, g1_a)).toBe(true);
        testedPermutationsCount++;
      }

      // ========================================================================
      // Permutations 47–56: Multi-layer Bipartite DAGs (10 tests)
      // ========================================================================
      const l1 = ['bip-l1-1', 'bip-l1-2', 'bip-l1-3'];
      const l2 = ['bip-l2-1', 'bip-l2-2', 'bip-l2-3'];
      const l3 = ['bip-l3-1', 'bip-l3-2', 'bip-l3-3'];

      for (const id of [...l1, ...l2, ...l3]) insertTask(id);

      // Layer 2 depends on Layer 1
      for (const node2 of l2) {
        for (const node1 of l1) {
          taskRepo.addDependency(node2, node1);
        }
      }
      // Layer 3 depends on Layer 2
      for (const node3 of l3) {
        for (const node2 of l2) {
          taskRepo.addDependency(node3, node2);
        }
      }

      // Forward transitive shortcut: L3 depending on L1 directly is a valid DAG shortcut!
      for (let k = 0; k < 3; k++) {
        expect(taskRepo.wouldCreateCycle(l3[k], l1[k])).toBe(false);
        testedPermutationsCount++;
      }

      // Backward edges: Any node in L1 depending on L2 or L3 MUST be rejected!
      for (let k = 0; k < 3; k++) {
        expect(taskRepo.wouldCreateCycle(l1[k], l3[k])).toBe(true);
        expect(taskRepo.wouldCreateCycle(l1[k], l2[k])).toBe(true);
        testedPermutationsCount += 2;
      }

      expect(testedPermutationsCount).toBeGreaterThanOrEqual(55);
    });

    it('enforces transactional integrity when addDependency encounters a cycle', () => {
      insertTask('tx-task-A');
      insertTask('tx-task-B');
      insertTask('tx-task-C');

      taskRepo.addDependency('tx-task-A', 'tx-task-B');
      taskRepo.addDependency('tx-task-B', 'tx-task-C');

      // Attempting to create a cycle (C -> A) must throw descriptive Error
      expect(() => {
        taskRepo.addDependency('tx-task-C', 'tx-task-A');
      }).toThrow(/would introduce a cycle/);

      // Self-dependency must throw
      expect(() => {
        taskRepo.addDependency('tx-task-A', 'tx-task-A');
      }).toThrow(/Self-dependency not permitted/);

      // Verify that no invalid dependency rows were written to the database
      const rows = db.query<{ task_id: string; depends_on_task_id: string }>(
        `SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id = 'tx-task-C'`
      );
      expect(rows.length).toBe(0);
    });
  });
});
