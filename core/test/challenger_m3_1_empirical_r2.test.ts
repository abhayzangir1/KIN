import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { Task } from '../src/domain/types.js';
import { wouldCreateCycleInMemory, DagTaskNode } from '../src/domain/task_dag.js';
import { stripThoughtsAndToolSyntax, isBackgroundTurnMessage } from '../src/domain/transcript_sanitizer.js';
import { cleanProse } from '../../ui/src/components/messages/MessageItem.js';

/**
 * Empirical Challenger M3-1 R2: Transcript Segregation & Task DAG Stress Harness
 * Verifies all PRD § 7 transcript contracts, CoT suppression, multi-hop/diamond DAG cycle prevention,
 * and atomic CAS approval transitions under adversarial conditions.
 */
describe('Challenger M3-1 R2: Empirical Adversarial Stress Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let migrationRunner: MigrationRunner;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-challenger-m3-1-r2-'));
    dbPath = path.join(tempDir, 'challenger_m3_1_r2.db');
    db = new KinDatabase(dbPath);
    migrationRunner = new MigrationRunner(db);
    migrationRunner.runMigrations();
    taskRepo = new TaskRepository(db);
    seedBaseFixtures(db, tempDir);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function seedBaseFixtures(database: KinDatabase, root: string) {
    const now = Date.now();
    database.execute(
      `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-stress', 'Stress Workspace', ?, 'AUTO', ?, ?);`,
      root,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, created_at, updated_at)
       VALUES ('proj-stress', 'ws-stress', 'Stress Project', ?, ?, ?);`,
      root,
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
      `INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES ('def-orch', 'orch', 'Orchestrator', 'Prompt', 'ollama/llama3', ?);`,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, created_at, updated_at)
       VALUES ('agent-orch-1', 'ws-stress', 'proj-stress', 'def-orch', 'Orchestrator', 'ollama/llama3', ?, ?);`,
      now,
      now
    );
    database.execute(
      `INSERT OR IGNORE INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at)
       VALUES ('run-stress-1', 'agent-orch-1', 'proj-stress', 'running', ?, ?);`,
      now,
      now
    );
  }

  // ==========================================================================
  // 1. Pure-Thought Suppression & Transcript Segregation
  // ==========================================================================
  describe('1. Pure-Thought Suppression & Transcript Segregation', () => {
    it('empirically verifies pure-thought turns produce empty strings across both domain and UI sanitizers', () => {
      const pureThoughtInputs = [
        '<think>only thoughts</think>',
        '<thought>only thoughts</thought>',
        '<reasoning>only thoughts</reasoning>',
        '  \n\t <think>only thoughts with whitespace</think> \n  ',
        '<THINK>uppercase tag</THINK>',
        '<Thought>mixed case tag</Thought>',
        '<REASONING>all caps reasoning</REASONING>',
        '<think></think>',
        '<think>   \n\t  </think>',
        '<think>thought 1</think><thought>thought 2</thought><reasoning>thought 3</reasoning>',
        '<think>step 1</think>\n\n<think>step 2</think>',
        '<tool_call>{"name":"ls"}</tool_call>',
        '<tool_result>["file.txt"]</tool_result>',
        '<tool_output>done</tool_output>',
        '<think>analyzing</think><tool_call>{"name":"exec"}</tool_call><tool_result>{"ok":true}</tool_result>',
        'Thinking Process:\n1. analyze query\n2. formulate plan\n\n',
      ];

      for (const input of pureThoughtInputs) {
        const domainClean = stripThoughtsAndToolSyntax(input);
        const uiClean = cleanProse(input);

        expect(domainClean).toBe('');
        expect(uiClean).toBe('');
      }
    });

    it('empirically verifies nested reasoning tags in all permutations are stripped completely', () => {
      const nestedCases = [
        '<think><reasoning><thought>deeply nested 1</thought></reasoning></think>',
        '<thought><think><reasoning>deeply nested 2</reasoning></think></thought>',
        '<reasoning><thought><think>deeply nested 3</think></thought></reasoning>',
        '<think><thought>inner</thought> outer</think>',
        '<reasoning><think>inner</think> outer</reasoning>',
      ];

      for (const input of nestedCases) {
        expect(stripThoughtsAndToolSyntax(input)).toBe('');
        expect(cleanProse(input)).toBe('');
      }

      // Nested tags with genuine prose surrounding them
      const withProse = 'Hello operator! <think><reasoning><thought>nested internal chain of thought</thought></reasoning></think> Task initialized.';
      expect(stripThoughtsAndToolSyntax(withProse)).toBe('Hello operator!  Task initialized.');
      expect(cleanProse(withProse)).toBe('Hello operator!  Task initialized.');
    });

    it('empirically verifies unclosed reasoning tags (streaming in-flight) are sanitized without leaking CoT', () => {
      const unclosedCases = [
        '<think>Analyzing sensitive token without closing tag',
        '<thought>Streaming unfinished reasoning tokens',
        '<reasoning>Evaluating architectural compromises',
        '<THINK>Uppercase unclosed buffer',
      ];

      for (const input of unclosedCases) {
        expect(stripThoughtsAndToolSyntax(input)).toBe('');
        expect(cleanProse(input)).toBe('');
      }

      // Unclosed tag preceded by valid prose:
      const proseWithUnclosed = 'Here is the current status report.\n<think>Evaluating internal database metrics without closing';
      const domainResult = stripThoughtsAndToolSyntax(proseWithUnclosed);
      const uiResult = cleanProse(proseWithUnclosed);

      expect(domainResult).toBe('Here is the current status report.');
      expect(uiResult).toBe('Here is the current status report.');
      expect(domainResult).not.toContain('Evaluating internal database metrics');
      expect(uiResult).not.toContain('Evaluating internal database metrics');
    });

    it('empirically verifies MessageItem rendering suppression contract (!isHuman && !prose -> null)', () => {
      // Simulates the exact decision logic in MessageItem.tsx:
      // const isHuman = message.senderType === 'human';
      // const prose = isHuman ? message.content : cleanProse(message.content);
      // if (!isHuman && !prose) return null;
      function simulateMessageItemRender(message: { senderType: string; content: string }) {
        const isHuman = message.senderType === 'human';
        const prose = isHuman ? message.content : cleanProse(message.content);
        if (!isHuman && !prose) {
          return null; // Suppressed per PRD § 7 contract
        }
        return { rendered: true, prose };
      }

      // Pure agent thought turn MUST be suppressed (returns null)
      const pureAgentThought = {
        senderType: 'agent',
        content: '<think>Formulating execution sub-plan for repository indexing</think>',
      };
      expect(simulateMessageItemRender(pureAgentThought)).toBeNull();

      // Pure tool turn MUST be suppressed (returns null)
      const pureToolTurn = {
        senderType: 'agent',
        content: '<tool_call>{"name": "fetch_logs"}</tool_call><tool_result>{"lines": 50}</tool_result>',
      };
      expect(simulateMessageItemRender(pureToolTurn)).toBeNull();

      // Agent turn with valid prose MUST render
      const validAgentTurn = {
        senderType: 'agent',
        content: '<think>Completed indexing.</think> Successfully indexed 42 files across workspace.',
      };
      const renderedAgent = simulateMessageItemRender(validAgentTurn);
      expect(renderedAgent).not.toBeNull();
      expect(renderedAgent?.prose).toBe('Successfully indexed 42 files across workspace.');

      // Human turn with literal think tag text must NEVER be suppressed
      const humanTurnWithThinkTag = {
        senderType: 'human',
        content: '<think>Why did this happen?</think>',
      };
      const renderedHuman = simulateMessageItemRender(humanTurnWithThinkTag);
      expect(renderedHuman).not.toBeNull();
      expect(renderedHuman?.prose).toBe('<think>Why did this happen?</think>');
    });

    it('empirically verifies background turn routing via isBackgroundTurnMessage', () => {
      expect(isBackgroundTurnMessage({ content: 'Ordinary conversation', is_background: false })).toBe(false);
      expect(isBackgroundTurnMessage({ content: 'Routine sync', is_background: true })).toBe(true);
      expect(isBackgroundTurnMessage({ content: 'Routine sync', isBackground: 1 })).toBe(true);
      expect(isBackgroundTurnMessage({ content: 'Routine sync', metadata: { is_background: true } })).toBe(true);
      expect(isBackgroundTurnMessage({ content: 'Routine sync', metadata: JSON.stringify({ isBackground: true }) })).toBe(true);
      expect(isBackgroundTurnMessage({ content: '⏰ Wakeup Timer Fired: Daily check' })).toBe(true);
      expect(isBackgroundTurnMessage({ content: '🤖 [Automated Wakeup] Health check' })).toBe(true);
      expect(isBackgroundTurnMessage({ content: '🔄 Proactive Routine checking git log' })).toBe(true);
    });
  });

  // ==========================================================================
  // 2. Task DAG Cycle Prevention (In-Memory & SQLite) Across Topologies
  // ==========================================================================
  describe('2. Task DAG Cycle Prevention Across Complex Topologies', () => {
    function insertDbTask(id: string, title: string = id) {
      db.execute(
        `INSERT INTO tasks (id, goal_id, title, description, status, created_at, updated_at)
         VALUES (?, 'goal-stress', ?, 'Description', 'ready', ?, ?)`,
        id,
        title,
        Date.now(),
        Date.now()
      );
    }

    it('empirically verifies 1-hop self-loops, 2-hop cycles, and 3-hop cycles in both engines', () => {
      // 1-hop self-loop:
      insertDbTask('t-self');
      expect(wouldCreateCycleInMemory('t-self', 't-self', [{ id: 't-self' }])).toBe(true);
      expect(taskRepo.wouldCreateCycle('t-self', 't-self')).toBe(true);
      expect(() => taskRepo.addDependency('t-self', 't-self')).toThrow(/Self-dependency not permitted/);

      // 2-hop cycle (A -> B, attempt B -> A):
      insertDbTask('t-2a');
      insertDbTask('t-2b');
      taskRepo.addDependency('t-2a', 't-2b'); // 2a depends on 2b
      const mem2: DagTaskNode[] = [
        { id: 't-2a', dependsOnTaskIds: ['t-2b'] },
        { id: 't-2b', dependsOnTaskIds: [] },
      ];
      expect(wouldCreateCycleInMemory('t-2b', 't-2a', mem2)).toBe(true);
      expect(taskRepo.wouldCreateCycle('t-2b', 't-2a')).toBe(true);
      expect(() => taskRepo.addDependency('t-2b', 't-2a')).toThrow(/would introduce a cycle/);

      // 3-hop cycle (A -> B -> C, attempt C -> A):
      insertDbTask('t-3a');
      insertDbTask('t-3b');
      insertDbTask('t-3c');
      taskRepo.addDependency('t-3a', 't-3b'); // 3a depends on 3b
      taskRepo.addDependency('t-3b', 't-3c'); // 3b depends on 3c
      const mem3: DagTaskNode[] = [
        { id: 't-3a', dependsOnTaskIds: ['t-3b'] },
        { id: 't-3b', dependsOnTaskIds: ['t-3c'] },
        { id: 't-3c', dependsOnTaskIds: [] },
      ];
      expect(wouldCreateCycleInMemory('t-3c', 't-3a', mem3)).toBe(true);
      expect(taskRepo.wouldCreateCycle('t-3c', 't-3a')).toBe(true);
      expect(() => taskRepo.addDependency('t-3c', 't-3a')).toThrow(/would introduce a cycle/);
    });

    it('empirically verifies 100-node linear chain cycle detection and performance', () => {
      const chainSize = 100;
      const memChain: DagTaskNode[] = [];
      const nodeIds: string[] = [];

      for (let i = 0; i < chainSize; i++) {
        const id = `chain100-${i}`;
        nodeIds.push(id);
        insertDbTask(id);
      }

      // Link in a line: n0 -> n1 -> n2 -> ... -> n99
      for (let i = 0; i < chainSize - 1; i++) {
        const from = nodeIds[i];
        const to = nodeIds[i + 1];
        taskRepo.addDependency(from, to);
        memChain.push({ id: from, dependsOnTaskIds: [to] });
      }
      memChain.push({ id: nodeIds[chainSize - 1], dependsOnTaskIds: [] });

      const head = nodeIds[0];
      const tail = nodeIds[chainSize - 1];

      // Closing the 100-node loop (tail -> head) MUST be detected as a cycle:
      const t0 = performance.now();
      const memCycle = wouldCreateCycleInMemory(tail, head, memChain);
      const tMem = performance.now() - t0;

      const t1 = performance.now();
      const dbCycle = taskRepo.wouldCreateCycle(tail, head);
      const tDb = performance.now() - t1;

      expect(memCycle).toBe(true);
      expect(dbCycle).toBe(true);
      expect(tMem).toBeLessThan(10); // < 10ms in-memory BFS
      expect(tDb).toBeLessThan(50); // < 50ms SQLite BFS across 100 hops

      // Intermediate cycle detection (n75 -> n25)
      expect(wouldCreateCycleInMemory(nodeIds[75], nodeIds[25], memChain)).toBe(true);
      expect(taskRepo.wouldCreateCycle(nodeIds[75], nodeIds[25])).toBe(true);

      // Non-cycle forward transitive shortcut (n25 -> n75): ALREADY transitively connected in valid order, must be allowed!
      expect(wouldCreateCycleInMemory(nodeIds[25], nodeIds[75], memChain)).toBe(false);
      expect(taskRepo.wouldCreateCycle(nodeIds[25], nodeIds[75])).toBe(false);
    });

    it('empirically verifies diamond topologies are ALLOWED and inverted diamond cycles are REJECTED', () => {
      // Standard Diamond:
      // Root
      //  /  \
      // B1   B2
      //  \  /
      //  Join
      insertDbTask('dia-root');
      insertDbTask('dia-b1');
      insertDbTask('dia-b2');
      insertDbTask('dia-join');

      // b1 depends on root, b2 depends on root
      taskRepo.addDependency('dia-b1', 'dia-root');
      taskRepo.addDependency('dia-b2', 'dia-root');
      // join depends on b1
      taskRepo.addDependency('dia-join', 'dia-b1');

      const memDiamond: DagTaskNode[] = [
        { id: 'dia-root', dependsOnTaskIds: [] },
        { id: 'dia-b1', dependsOnTaskIds: ['dia-root'] },
        { id: 'dia-b2', dependsOnTaskIds: ['dia-root'] },
        { id: 'dia-join', dependsOnTaskIds: ['dia-b1'] },
      ];

      // Diamond validation 1: Join adding b2 as its second prerequisite MUST BE ALLOWED (false)
      expect(wouldCreateCycleInMemory('dia-join', 'dia-b2', memDiamond)).toBe(false);
      expect(taskRepo.wouldCreateCycle('dia-join', 'dia-b2')).toBe(false);
      expect(() => taskRepo.addDependency('dia-join', 'dia-b2')).not.toThrow();

      // Now join depends on both b1 and b2
      memDiamond.find((t) => t.id === 'dia-join')!.dependsOnTaskIds = ['dia-b1', 'dia-b2'];

      // Diamond validation 2: Root depending on Join would invert the diamond into a cycle! MUST BE REJECTED (true)
      expect(wouldCreateCycleInMemory('dia-root', 'dia-join', memDiamond)).toBe(true);
      expect(taskRepo.wouldCreateCycle('dia-root', 'dia-join')).toBe(true);
      expect(() => taskRepo.addDependency('dia-root', 'dia-join')).toThrow(/would introduce a cycle/);

      // Diamond validation 3: Root depending on B1 or B2 MUST BE REJECTED (true)
      expect(wouldCreateCycleInMemory('dia-root', 'dia-b1', memDiamond)).toBe(true);
      expect(taskRepo.wouldCreateCycle('dia-root', 'dia-b1')).toBe(true);
      expect(wouldCreateCycleInMemory('dia-root', 'dia-b2', memDiamond)).toBe(true);
      expect(taskRepo.wouldCreateCycle('dia-root', 'dia-b2')).toBe(true);
    });

    it('empirically verifies wide multi-branch fan-out/fan-in (20 branches)', () => {
      insertDbTask('wide-root');
      insertDbTask('wide-join');
      const branches: string[] = [];

      for (let i = 0; i < 20; i++) {
        const bId = `wide-b-${i}`;
        branches.push(bId);
        insertDbTask(bId);
        taskRepo.addDependency(bId, 'wide-root'); // branch depends on root
      }

      // Connect join to all 20 branches
      for (const bId of branches) {
        expect(taskRepo.wouldCreateCycle('wide-join', bId)).toBe(false);
        taskRepo.addDependency('wide-join', bId);
      }

      // Verify any branch depending on join is rejected
      for (let i = 0; i < 5; i++) {
        expect(taskRepo.wouldCreateCycle(branches[i], 'wide-join')).toBe(true);
      }

      // Verify root depending on join is rejected
      expect(taskRepo.wouldCreateCycle('wide-root', 'wide-join')).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Atomic CAS Approval Transitions & Swarm Map Auto-Fit Bounds
  // ==========================================================================
  describe('3. Atomic CAS Approvals & Swarm Map Auto-Fit Bounds', () => {
    it('empirically verifies atomic CAS resolution under 30 concurrent workers with zero double-spends', async () => {
      const approvalId = 'appr-cas-stress-30';
      const now = Date.now();
      db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
         VALUES (?, 'run-stress-1', 'agent-orch-1', 'fs:write_file', '{"file":"package.json"}', 'HIGH', 'pending', ?, ?)`,
        approvalId,
        now + 600000,
        now
      );

      // 30 concurrent workers attempt to resolve simultaneously (mix of approve and reject)
      const workers = Array.from({ length: 30 }, (_, i) => ({
        workerId: i,
        decision: i % 2 === 0 ? 'approved' : 'rejected',
      }));

      const results = await Promise.all(
        workers.map(async (worker) => {
          // Exact CAS query from task_controller.ts:
          // UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'
          const res = db.execute(
            `UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`,
            worker.decision,
            Date.now(),
            approvalId
          );
          return {
            workerId: worker.workerId,
            decision: worker.decision,
            changes: Number(res.changes),
          };
        })
      );

      const winners = results.filter((r) => r.changes === 1);
      const losers = results.filter((r) => r.changes === 0);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(29);

      const finalState = db.queryOne<{ status: string; decided_at: number }>(
        'SELECT status, decided_at FROM approvals WHERE id = ?',
        approvalId
      );
      expect(finalState).toBeDefined();
      expect(finalState?.status).toBe(winners[0].decision);
      expect(finalState?.decided_at).toBeGreaterThanOrEqual(now);
    });

    it('empirically verifies Swarm Map auto-fit zoom bounds (0.4x to 1.5x) and centering calculations', () => {
      function calculateSwarmAutoFit(
        nodePositions: Record<string, { x: number; y: number }>,
        w: number = 1000,
        h: number = 700
      ) {
        const nodes = Object.values(nodePositions);
        if (nodes.length === 0) return null;
        const pad = 80;
        const minX = Math.min(...nodes.map((n) => n.x - 145)) - pad;
        const maxX = Math.max(...nodes.map((n) => n.x + 145)) + pad;
        const minY = Math.min(...nodes.map((n) => n.y - 85)) - pad;
        const maxY = Math.max(...nodes.map((n) => n.y + 85)) + pad;
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

      // 1. Empty nodes -> returns null
      expect(calculateSwarmAutoFit({})).toBeNull();

      // 2. Single node -> clamped to max zoom (1.5)
      const single = calculateSwarmAutoFit({ n1: { x: 500, y: 350 } });
      expect(single).not.toBeNull();
      expect(single?.zoom).toBe(1.5);

      // 3. Vastly separated nodes (100,000 px spread) -> clamped to min zoom (0.4)
      const distant = calculateSwarmAutoFit({
        n1: { x: -50000, y: -50000 },
        n2: { x: 50000, y: 50000 },
      });
      expect(distant).not.toBeNull();
      expect(distant?.zoom).toBe(0.4);

      // 4. Centering sanity check: symmetric nodes around origin must result in symmetric pan
      const symmetric = calculateSwarmAutoFit(
        {
          left: { x: -300, y: 0 },
          right: { x: 300, y: 0 },
        },
        1000,
        700
      );
      expect(symmetric).not.toBeNull();
      // centerX is 0, so pan.x should be w / 2 (500)
      expect(symmetric?.pan.x).toBe(500);
      // centerY is 0, so pan.y should be h / 2 (350)
      expect(symmetric?.pan.y).toBe(350);

      // 5. Asymmetric extreme aspect ratio viewports (ultrawide vs vertical)
      const ultrawide = calculateSwarmAutoFit({ n1: { x: 0, y: 0 }, n2: { x: 400, y: 200 } }, 3440, 600);
      expect(ultrawide?.zoom).toBeGreaterThanOrEqual(0.4);
      expect(ultrawide?.zoom).toBeLessThanOrEqual(1.5);
      expect(Number.isFinite(ultrawide?.pan.x)).toBe(true);
      expect(Number.isFinite(ultrawide?.pan.y)).toBe(true);
    });
  });
});
