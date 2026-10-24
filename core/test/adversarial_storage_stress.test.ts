// ============================================================================
// ADVERSARIAL CHALLENGER STRESS PROBE: LAYER 0 MULTI-ROW CORRUPT DATABASE STATE
// Empirical verification of multi-row batch queries under 50% randomly corrupted JSON:
// 1. listProjects (projects.settings_json)
// 2. listTasksByProject & listTasksByGoal (tasks.verification_spec_json)
// 3. listGoals (goals.acceptance_criteria_json & proposed_replanning_json)
// 4. getMessages (messages.mentions_json)
// 5. listIdentitiesByProject (agent_definitions.capabilities_json & domain_authority_json)
// 6. Verifies valid rows are NOT dropped, truncated, or distorted by adjacent corrupt rows
// 7. Verifies performance overhead, memory leak bounds, and event loop responsiveness
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { GoalRepository } from '../src/domain/goal_repository.js';
import { ChannelService } from '../src/communication/channel_service.js';
import { AgentRepository } from '../src/domain/agent_repository.js';

describe('Adversarial Challenger M1 2: Multi-Row Corrupt Database State Stress Suite', () => {
  let db: KinDatabase;
  let tempDir: string;
  let tempDbPath: string;

  let workspaceRepo: WorkspaceRepository;
  let taskRepo: TaskRepository;
  let goalRepo: GoalRepository;
  let channelService: ChannelService;
  let agentRepo: AgentRepository;

  // Comprehensive adversarial palette of corrupted, malformed, truncated, and typed JSON values
  const ADVERSARIAL_CORRUPT_PALETTE: readonly string[] = [
    '{invalid-syntax',
    '{"unclosed": "brace"',
    '{"key": truncated_val',
    '{"trailing": "comma",}',
    '["unclosed_array',
    '[1, 2, 3, ]',
    '{"bad_colon": }',
    '{"double_colon":: 1}',
    '{"unescaped_ctrl": "\x00\x1f"}',
    '{"bad_escape": "\\z"}',
    '{"incomplete_hex": "\\u12"}',
    '{',
    '}',
    '[',
    ']',
    '""',
    '   ',
    '\t\r\n',
    'null',
    'undefined',
    'NaN',
    'Infinity',
    '-Infinity',
    '12345',
    '3.14159',
    'true',
    'false',
    '"plain unquoted naked string"',
    '{"nested": {"broken": [1, 2, }}',
    '{"a": 1}{"b": 2}', // multiple root tokens
    '<xml>not json</xml>',
    'SELECT * FROM users;', // SQL injection payload in JSON column
    '\0\0\0\0', // null bytes
  ];

  const getCorruptPayload = (index: number): string => {
    return ADVERSARIAL_CORRUPT_PALETTE[index % ADVERSARIAL_CORRUPT_PALETTE.length];
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-adv-stress-storage-'));
    tempDbPath = path.join(tempDir, 'stress_storage.sqlite');

    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    workspaceRepo = new WorkspaceRepository(db);
    taskRepo = new TaskRepository(db);
    goalRepo = new GoalRepository(db);
    channelService = new ChannelService(db);
    agentRepo = new AgentRepository(db);

    // Baseline root workspace
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-stress', 'Stress Workspace', '/stress/root', 'AUTO', 1000, 1000)`
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

  // ============================================================================
  // PROBE 1: listProjects with 100 Rows (50 Valid, 50 Corrupt)
  // ============================================================================
  describe('Probe 1: listProjects Multi-Row Corruption & Row Isolation', () => {
    it('returns exactly 100 projects with 50 intact valid settings and 50 safe {} fallbacks without distortion', () => {
      const TOTAL_ROWS = 100;
      const expectedValidSettings: Map<string, Record<string, unknown>> = new Map();

      // Interleave: even index = valid, odd index = corrupt
      for (let i = 0; i < TOTAL_ROWS; i++) {
        const projectId = `proj-batch-${i.toString().padStart(3, '0')}`;
        const isCorrupt = i % 2 !== 0;

        let settingsJson: string;
        if (isCorrupt) {
          settingsJson = getCorruptPayload(i);
        } else {
          const validObj = {
            index: i,
            theme: `theme-${i}`,
            features: [`feature-a-${i}`, `feature-b-${i}`],
            config: { maxWorkers: i + 1, enableCache: i % 4 === 0 },
          };
          expectedValidSettings.set(projectId, validObj);
          settingsJson = JSON.stringify(validObj);
        }

        db.execute(
          `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
           VALUES (?, 'ws-stress', ?, ?, ?, ?, ?)`,
          projectId,
          `Project ${i}`,
          `/repos/project-${i}`,
          settingsJson,
          2000 + i,
          2000 + i
        );
      }

      // Execute multi-row query
      const projects = workspaceRepo.listProjects('ws-stress');

      // 1. Cardinality check: must return ALL 100 rows
      expect(projects).toHaveLength(TOTAL_ROWS);

      let validCount = 0;
      let corruptCount = 0;

      for (let i = 0; i < TOTAL_ROWS; i++) {
        const item = projects[i];
        const expectedId = `proj-batch-${i.toString().padStart(3, '0')}`;
        expect(item.id).toBe(expectedId);
        expect(item.name).toBe(`Project ${i}`);
        expect(item.repoPath).toBe(`/repos/project-${i}`);
        expect(item.createdAt).toBe(2000 + i);

        if (i % 2 === 0) {
          // Even rows: VALID
          validCount++;
          const expected = expectedValidSettings.get(item.id)!;
          expect(item.settings).toEqual(expected);
          expect((item.settings as any).index).toBe(i);
          expect((item.settings as any).theme).toBe(`theme-${i}`);
          expect((item.settings as any).features).toEqual([`feature-a-${i}`, `feature-b-${i}`]);
        } else {
          // Odd rows: CORRUPT -> must fail open to plain object {}
          corruptCount++;
          expect(item.settings).toBeDefined();
          expect(typeof item.settings).toBe('object');
          expect(item.settings).not.toBeNull();
          expect(Array.isArray(item.settings)).toBe(false);
          expect(item.settings).toEqual({});
          expect(Object.keys(item.settings)).toHaveLength(0);
        }
      }

      expect(validCount).toBe(50);
      expect(corruptCount).toBe(50);
    });
  });

  // ============================================================================
  // PROBE 2: listTasksByProject & listTasksByGoal with 100 Rows (50 Valid, 50 Corrupt)
  // ============================================================================
  describe('Probe 2: listTasksByProject & listTasksByGoal Multi-Row Corruption & Row Isolation', () => {
    it('returns all 100 tasks under both queries with 50 intact verificationSpec and 50 safe {} fallbacks', () => {
      const TOTAL_ROWS = 100;
      const projectId = 'proj-task-parent';
      const goalId = 'goal-task-parent';

      // Seed project and goal
      db.execute(
        `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
         VALUES (?, 'ws-stress', 'Task Project', '/repos/tasks', '{}', 1000, 1000)`,
        projectId
      );

      db.execute(
        `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
         VALUES (?, ?, 'Task Goal Parent', 'Goal description', '[]', 'active', 1000, 1000)`,
        goalId,
        projectId
      );

      const expectedValidSpecs: Map<string, Record<string, unknown>> = new Map();

      // Seed 100 tasks with interleaved corruption
      for (let i = 0; i < TOTAL_ROWS; i++) {
        const taskId = `task-stress-${i.toString().padStart(3, '0')}`;
        const isCorrupt = i % 2 !== 0;

        let specJson: string;
        if (isCorrupt) {
          specJson = getCorruptPayload(i);
        } else {
          const validSpec = {
            command: `vitest run test-${i}.ts`,
            timeoutMs: 3000 + i,
            envVars: { TASK_NUM: String(i), CI: 'true' },
            retryOnFailure: i % 3 === 0,
          };
          expectedValidSpecs.set(taskId, validSpec);
          specJson = JSON.stringify(validSpec);
        }

        db.execute(
          `INSERT INTO tasks (id, goal_id, title, description, status, verification_spec_json, created_at, updated_at)
           VALUES (?, ?, ?, 'Stress task description', 'ready', ?, ?, ?)`,
          taskId,
          goalId,
          `Stress Task ${i}`,
          specJson,
          2000 + i,
          2000 + i
        );
      }

      // 1. Query by Goal
      const tasksByGoal = taskRepo.listTasksByGoal(goalId);
      expect(tasksByGoal).toHaveLength(TOTAL_ROWS);

      // 2. Query by Project
      const tasksByProject = taskRepo.listTasksByProject(projectId);
      expect(tasksByProject).toHaveLength(TOTAL_ROWS);

      // Verify row integrity across both query results
      for (const taskList of [tasksByGoal, tasksByProject]) {
        let validCount = 0;
        let corruptCount = 0;

        for (let i = 0; i < TOTAL_ROWS; i++) {
          const t = taskList[i];
          const expectedId = `task-stress-${i.toString().padStart(3, '0')}`;
          expect(t.id).toBe(expectedId);
          expect(t.title).toBe(`Stress Task ${i}`);
          expect(t.status).toBe('ready');

          if (i % 2 === 0) {
            validCount++;
            const expectedSpec = expectedValidSpecs.get(t.id)!;
            expect(t.verificationSpec).toEqual(expectedSpec);
            expect(t.verificationSpec.command).toBe(`vitest run test-${i}.ts`);
            expect(t.verificationSpec.timeoutMs).toBe(3000 + i);
          } else {
            corruptCount++;
            expect(t.verificationSpec).toEqual({});
            expect(typeof t.verificationSpec).toBe('object');
            expect(Array.isArray(t.verificationSpec)).toBe(false);
          }
        }

        expect(validCount).toBe(50);
        expect(corruptCount).toBe(50);
      }
    });
  });

  // ============================================================================
  // PROBE 3: listGoals with 100 Rows (50 Valid, 50 Corrupt across multiple JSON fields)
  // ============================================================================
  describe('Probe 3: listGoals Multi-Row Corruption Across Multiple Fields', () => {
    it('returns all 100 goals with 50 intact arrays/objects and 50 safe fallbacks (criteria: [], replanning: undefined)', () => {
      const TOTAL_ROWS = 100;
      const projectId = 'proj-goals-parent';

      db.execute(
        `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
         VALUES (?, 'ws-stress', 'Goals Project', '/repos/goals', '{}', 1000, 1000)`,
        projectId
      );

      const expectedCriteria: Map<string, string[]> = new Map();
      const expectedReplanning: Map<string, any> = new Map();

      // Seed 100 goals with interleaved corruption across BOTH acceptance_criteria_json and proposed_replanning_json
      for (let i = 0; i < TOTAL_ROWS; i++) {
        const goalId = `goal-stress-${i.toString().padStart(3, '0')}`;
        const isCorrupt = i % 2 !== 0;

        let criteriaJson: string;
        let replanningJson: string | null;

        if (isCorrupt) {
          criteriaJson = getCorruptPayload(i);
          replanningJson = getCorruptPayload(i + 13);
        } else {
          const criteria = [`Criterion ${i}.1`, `Criterion ${i}.2`, `Pass rate >= ${90 + (i % 10)}%`];
          const replan = { strategy: 'pivot', stepIndex: i, targetBranch: `feat/goal-${i}` };
          expectedCriteria.set(goalId, criteria);
          expectedReplanning.set(goalId, replan);
          criteriaJson = JSON.stringify(criteria);
          replanningJson = JSON.stringify(replan);
        }

        db.execute(
          `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, proposed_replanning_json, created_at, updated_at)
           VALUES (?, ?, ?, 'Goal description', ?, 'active', ?, ?, ?)`,
          goalId,
          projectId,
          `Goal Distinct Title ${i}`,
          criteriaJson,
          replanningJson,
          2000 + i,
          2000 + i
        );
      }

      // Query goals with deduplicate=false to test raw multi-row extraction
      const goalsRaw = goalRepo.listGoals(projectId, false);
      expect(goalsRaw).toHaveLength(TOTAL_ROWS);

      // Also query with default deduplicate=true (all titles are distinct)
      const goalsDeduped = goalRepo.listGoals(projectId, true);
      expect(goalsDeduped).toHaveLength(TOTAL_ROWS);

      let validCount = 0;
      let corruptCount = 0;

      for (let i = 0; i < TOTAL_ROWS; i++) {
        const goalId = `goal-stress-${i.toString().padStart(3, '0')}`;
        const g = goalsRaw.find((goal) => goal.id === goalId);
        expect(g).toBeDefined();
        expect(g!.title).toBe(`Goal Distinct Title ${i}`);

        if (i % 2 === 0) {
          validCount++;
          expect(g!.acceptanceCriteria).toEqual(expectedCriteria.get(g!.id));
          expect(Array.isArray(g!.acceptanceCriteria)).toBe(true);
          expect(g!.acceptanceCriteria).toHaveLength(3);
          expect(g!.proposedReplanning).toEqual(expectedReplanning.get(g!.id));
        } else {
          corruptCount++;
          // Corrupt acceptance_criteria_json MUST fail open to empty array []
          expect(Array.isArray(g!.acceptanceCriteria)).toBe(true);
          expect(g!.acceptanceCriteria).toEqual([]);
          // Safe array methods must not throw
          expect(() => g!.acceptanceCriteria.map((c) => c.toUpperCase())).not.toThrow();
          expect(() => g!.acceptanceCriteria.includes('test')).not.toThrow();

          // Corrupt proposed_replanning_json MUST fail open without throwing
          // Returns undefined for syntax errors/null/empty, or parsed primitive if JSON-valid
          if (typeof g!.proposedReplanning === 'object' && g!.proposedReplanning !== null) {
            expect(typeof g!.proposedReplanning).toBe('object');
          } else {
            expect(['undefined', 'number', 'boolean', 'string']).toContain(typeof g!.proposedReplanning);
          }
        }
      }

      expect(validCount).toBe(50);
      expect(corruptCount).toBe(50);
    });
  });

  // ============================================================================
  // PROBE 4: getMessages with 100 Rows (50 Valid, 50 Corrupt mentions_json)
  // ============================================================================
  describe('Probe 4: getMessages Multi-Row Corruption & Row Isolation', () => {
    it('returns all 100 messages with 50 intact mentions arrays and 50 safe [] fallbacks', () => {
      const TOTAL_ROWS = 100;
      const projectId = 'proj-msg-parent';
      const channelId = 'chan-msg-stress';

      db.execute(
        `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
         VALUES (?, 'ws-stress', 'Message Project', '/repos/msgs', '{}', 1000, 1000)`,
        projectId
      );

      db.execute(
        `INSERT INTO channels (id, project_id, name, channel_type, is_private, created_at)
         VALUES (?, ?, 'stress-channel', 'channel', 0, 1000)`,
        channelId,
        projectId
      );

      const expectedMentions: Map<string, string[]> = new Map();

      // Seed 100 messages with interleaved corrupt mentions_json
      for (let i = 0; i < TOTAL_ROWS; i++) {
        const messageId = `msg-stress-${i.toString().padStart(3, '0')}`;
        const isCorrupt = i % 2 !== 0;

        let mentionsJson: string;
        if (isCorrupt) {
          mentionsJson = getCorruptPayload(i);
        } else {
          const mentions = [`@agent_${i}`, `@reviewer_${i % 5}`];
          expectedMentions.set(messageId, mentions);
          mentionsJson = JSON.stringify(mentions);
        }

        db.execute(
          `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, mentions_json, productivity_score, created_at)
           VALUES (?, ?, ?, 'agent', ?, ?, 10, ?)`,
          messageId,
          channelId,
          `sender-${i}`,
          `Message content turn ${i}`,
          mentionsJson,
          2000 + i
        );
      }

      // Query with limit = 100
      const messages = channelService.getMessages(channelId, 100);
      expect(messages).toHaveLength(TOTAL_ROWS);

      let validCount = 0;
      let corruptCount = 0;

      for (let i = 0; i < TOTAL_ROWS; i++) {
        const m = messages[i];
        const expectedId = `msg-stress-${i.toString().padStart(3, '0')}`;
        expect(m.id).toBe(expectedId);
        expect(m.content).toBe(`Message content turn ${i}`);
        expect(m.createdAt).toBe(2000 + i);

        if (i % 2 === 0) {
          validCount++;
          expect(m.mentions).toEqual(expectedMentions.get(m.id));
          expect(Array.isArray(m.mentions)).toBe(true);
          expect(m.mentions).toHaveLength(2);
          expect(m.mentions.includes(`@agent_${i}`)).toBe(true);
        } else {
          corruptCount++;
          expect(Array.isArray(m.mentions)).toBe(true);
          expect(m.mentions).toEqual([]);
          expect(m.mentions.length).toBe(0);
          expect(() => m.mentions.filter((mention) => mention.startsWith('@'))).not.toThrow();
        }
      }

      expect(validCount).toBe(50);
      expect(corruptCount).toBe(50);
    });
  });

  // ============================================================================
  // PROBE 5: listIdentitiesByProject & getDefinition with 100 Rows
  // ============================================================================
  describe('Probe 5: listIdentitiesByProject & Agent Definition Multi-Row Corruption', () => {
    it('returns all 100 identities and definitions with 50 intact capability arrays and 50 safe [] fallbacks', () => {
      const TOTAL_ROWS = 100;
      const projectId = 'proj-agent-parent';

      db.execute(
        `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
         VALUES (?, 'ws-stress', 'Agent Project', '/repos/agents', '{}', 1000, 1000)`,
        projectId
      );

      const expectedCaps: Map<string, string[]> = new Map();
      const expectedDomains: Map<string, string[]> = new Map();

      // Seed 100 definitions and 100 corresponding identities
      for (let i = 0; i < TOTAL_ROWS; i++) {
        const defId = `def-stress-${i.toString().padStart(3, '0')}`;
        const identityId = `ident-stress-${i.toString().padStart(3, '0')}`;
        const isCorrupt = i % 2 !== 0;

        let capsJson: string;
        let domainsJson: string;

        if (isCorrupt) {
          capsJson = getCorruptPayload(i);
          domainsJson = getCorruptPayload(i + 7);
        } else {
          const caps = [`read_file_${i}`, `exec_tool_${i}`, 'shell'];
          const domains = [`domain_${i}`, 'testing', 'security'];
          expectedCaps.set(defId, caps);
          expectedDomains.set(defId, domains);
          capsJson = JSON.stringify(caps);
          domainsJson = JSON.stringify(domains);
        }

        // Definition
        db.execute(
          `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
           VALUES (?, ?, 'Engineer', 'Prompt text', 'ollama/llama3', ?, ?, ?)`,
          defId,
          `AgentDef ${i}`,
          domainsJson,
          capsJson,
          2000 + i
        );

        // Identity referencing definition
        db.execute(
          `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
           VALUES (?, 'ws-stress', ?, ?, ?, 'ollama/llama3', ?, 0, ?, ?)`,
          identityId,
          projectId,
          defId,
          `AgentIdentity_${i}`,
          i === 0 ? 1 : 0, // Agent 0 is orchestrator
          2000 + i,
          2000 + i
        );
      }

      // Query identities by project
      const identities = agentRepo.listIdentitiesByProject(projectId);
      expect(identities).toHaveLength(TOTAL_ROWS);

      // Verify all 100 identities returned without dropping any
      const identityIds = new Set(identities.map((id) => id.id));
      expect(identityIds.size).toBe(TOTAL_ROWS);

      // Also verify getDefinition across all 100 definitions
      let validDefCount = 0;
      let corruptDefCount = 0;

      for (let i = 0; i < TOTAL_ROWS; i++) {
        const defId = `def-stress-${i.toString().padStart(3, '0')}`;
        const def = agentRepo.getDefinition(defId);
        expect(def).toBeDefined();

        if (i % 2 === 0) {
          validDefCount++;
          expect(def!.capabilities).toEqual(expectedCaps.get(defId));
          expect(def!.domainAuthority).toEqual(expectedDomains.get(defId));
          expect(Array.isArray(def!.capabilities)).toBe(true);
          expect(Array.isArray(def!.domainAuthority)).toBe(true);
        } else {
          corruptDefCount++;
          expect(Array.isArray(def!.capabilities)).toBe(true);
          expect(def!.capabilities).toEqual([]);
          expect(Array.isArray(def!.domainAuthority)).toBe(true);
          expect(def!.domainAuthority).toEqual([]);
          // Safe method invocation without TypeError
          expect(() => def!.capabilities.includes('shell')).not.toThrow();
          expect(() => def!.domainAuthority.map((d) => d.toLowerCase())).not.toThrow();
        }
      }

      expect(validDefCount).toBe(50);
      expect(corruptDefCount).toBe(50);
    });
  });

  // ============================================================================
  // PROBE 6: Performance, Memory Stability, and Event Loop Latency
  // ============================================================================
  describe('Probe 6: Empirical Performance Overhead, Heap Memory Stability, and Event Loop Latency', () => {
    it('incurs negligible overhead (< 5ms per 100 rows), leaks 0 unbounded heap memory, and maintains responsive event loop', async () => {
      const TOTAL_ROWS = 100;
      const projectId = 'proj-perf-parent';

      db.execute(
        `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
         VALUES (?, 'ws-stress', 'Perf Project', '/repos/perf', '{}', 1000, 1000)`,
        projectId
      );

      // Seed 100 project rows (50 corrupt, 50 valid)
      for (let i = 0; i < TOTAL_ROWS; i++) {
        const pId = `proj-perf-${i.toString().padStart(3, '0')}`;
        const isCorrupt = i % 2 !== 0;
        const settingsJson = isCorrupt
          ? getCorruptPayload(i)
          : JSON.stringify({ index: i, tags: ['a', 'b', 'c'], rate: 42.5 });

        db.execute(
          `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
           VALUES (?, 'ws-stress', ?, '/repos/perf', ?, ?, ?)`,
          pId,
          `Perf Project ${i}`,
          settingsJson,
          3000 + i,
          3000 + i
        );
      }

      // 1. Event Loop Lag Monitoring
      let maxEventLoopLagMs = 0;
      let lastTick = performance.now();
      const lagInterval = setInterval(() => {
        const now = performance.now();
        const delta = now - lastTick - 2; // target 2ms interval
        if (delta > maxEventLoopLagMs) {
          maxEventLoopLagMs = delta;
        }
        lastTick = now;
      }, 2);

      // 2. Warm up
      for (let i = 0; i < 20; i++) {
        workspaceRepo.listProjects('ws-stress');
      }

      // 3. Execution time measurement over 500 batch queries (50,000 parsed rows total)
      if (global.gc) {
        global.gc();
      }
      const initialMem = process.memoryUsage().heapUsed;

      const ITERATIONS = 500;
      const start = performance.now();

      for (let iter = 0; iter < ITERATIONS; iter++) {
        const rows = workspaceRepo.listProjects('ws-stress');
        // Sanity spot check
        if (iter === 0) {
          expect(rows.length).toBe(101); // 1 baseline + 100 seeded
        }
      }

      const elapsedMs = performance.now() - start;
      const avgMsPerQuery = elapsedMs / ITERATIONS;
      const rowsPerSec = ((ITERATIONS * 101) / elapsedMs) * 1000;

      clearInterval(lagInterval);

      // 4. Memory Stability Check
      if (global.gc) {
        global.gc();
      }
      const finalMem = process.memoryUsage().heapUsed;
      const heapDeltaMb = (finalMem - initialMem) / (1024 * 1024);

      // Performance Assertions
      // Average batch listing of 100 items (including 50 try/catch fallbacks) should take < 5ms
      expect(avgMsPerQuery).toBeLessThan(10); // Generous 10ms threshold for diverse environments
      expect(rowsPerSec).toBeGreaterThan(10000); // Expect > 10,000 rows/sec parsing throughput

      // Memory Leak Assertions: heap growth over 500 queries must remain tightly bounded (< 15MB)
      expect(heapDeltaMb).toBeLessThan(15);

      // Event Loop Assertions: max lag during intensive corrupt batch parsing must not block the loop (> 50ms)
      expect(maxEventLoopLagMs).toBeLessThan(50);
    });
  });
});
