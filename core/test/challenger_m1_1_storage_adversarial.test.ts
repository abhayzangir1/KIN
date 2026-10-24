// ============================================================================
// EMPIRICAL CHALLENGER M1 1 GEN 2: ADVERSARIAL STORAGE RESILIENCE SUITE
// Deep stress testing of defensive fallback JSON parsing in core/src/storage/db.ts
// and all domain repositories:
// 1. WorkspaceRepository (projects.settings_json)
// 2. TaskRepository (tasks.verification_spec_json, decisions.alternatives_considered_json)
// 3. GoalRepository (goals.acceptance_criteria_json, goals.proposed_replanning_json)
// 4. ChannelService (messages.mentions_json, extractMentions)
// 5. AgentRepository (agent_definitions.domain_authority_json, capabilities_json, def_capabilities_json)
//
// Adversarial Attack Vectors:
// - Prototype pollution (__proto__, constructor.prototype, prototype)
// - Type confusion (primitives where objects expected, objects where arrays expected, NaN, Infinity, null, undefined)
// - Malformed JSON, unclosed quotes, escape sequences, null bytes
// - Huge payloads (1MB+ strings, deep nesting)
// - Concurrency / mixed batch queries
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  KinDatabase,
  safeJsonParseObject,
  safeJsonParseArray,
  safeJsonParse,
} from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { GoalRepository } from '../src/domain/goal_repository.js';
import { ChannelService } from '../src/communication/channel_service.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { Task, Goal, Decision, AgentDefinition, AgentIdentity } from '../src/domain/types.js';

describe('Empirical Challenger M1 1: Adversarial Storage Resilience & Prototype Hardening', () => {
  let db: KinDatabase;
  let tempDir: string;
  let tempDbPath: string;

  let workspaceRepo: WorkspaceRepository;
  let taskRepo: TaskRepository;
  let goalRepo: GoalRepository;
  let channelService: ChannelService;
  let agentRepo: AgentRepository;

  // Extreme adversarial payload catalog
  const ADVERSARIAL_INPUTS = {
    prototypePollution: [
      '{"__proto__": {"polluted": true, "isAdmin": true, "role": "root"}}',
      '{"constructor": {"prototype": {"polluted": true, "injected": "yes"}}}',
      '{"prototype": {"polluted": true}}',
      '{"__proto__": null}',
      '{"__proto__": "polluted"}',
      '{"__proto__": [1, 2, 3]}',
      '{"nested": {"deep": {"__proto__": {"polluted": true}}}}',
      '{"__proto__": {"toString": "corrupt", "valueOf": "corrupt"}}',
    ],
    typeConfusion: [
      '0',
      '-0',
      '1',
      '-42',
      '3.141592653589793',
      '1e309', // Overflows to Infinity
      '-1e309', // Overflows to -Infinity
      '1e-324',
      'true',
      'false',
      'null',
      'undefined',
      'NaN',
      'Infinity',
      '-Infinity',
      '[]',
      '[1, 2, 3]',
      '["a", "b", "c"]',
      '[{"nested": 1}]',
      '{}',
      '{"key": "val"}',
      '{"0": "first", "length": 1}',
    ],
    malformedAndCorrupt: [
      '{"unclosed_str": "value',
      '{"unclosed_obj": {"a": 1',
      '{"unclosed_arr": [1, 2,',
      '{"trailing_comma": 1,}',
      '{"trailing_colon": 1, "k":}',
      '[1, 2, 3,]',
      '{"invalid_escape": "\\v"}',
      '{"invalid_hex": "\\x41"}',
      '{"truncated_unicode": "\\u12"}',
      '{"dangling_backslash": "\\',
      '{"single_quotes": \'bar\'}',
      '{unquoted_key: 123}',
      '{"null_byte_in_key\\0": 1}',
      '{"null_byte_in_val": "hello\\0world"}',
      '\0\0\0\0\0',
      '',
      '   \t\r\n   ',
      '<!DOCTYPE html><html><body>Error</body></html>',
      'SELECT * FROM tasks WHERE 1=1;',
      '{"a": 1}{"b": 2}', // multiple concatenated JSON roots
    ],
    hugeStrings: [
      'A'.repeat(250000), // 250KB raw text
      '{"huge_val": "' + 'B'.repeat(250000) + '"}', // 250KB valid object
      '[' + Array.from({ length: 10000 }, (_, i) => `"${i}"`).join(',') + ']', // 10k array
      '['.repeat(200) + '1' + ']'.repeat(200), // 200 depth array
      '{"a":'.repeat(200) + '1' + '}'.repeat(200), // 200 depth object
    ],
    nonStringInputs: [
      null,
      undefined,
      12345,
      true,
      false,
      Symbol('test'),
      () => 'lambda',
      new Date(),
      new RegExp('test'),
      Buffer.from('hello world'),
    ],
  };

  beforeEach(() => {
    // Thoroughly scrub Object.prototype of any leftover pollution
    delete (Object.prototype as any).polluted;
    delete (Object.prototype as any).isAdmin;
    delete (Object.prototype as any).injected;
    delete (Object.prototype as any).role;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-challenger-storage-'));
    tempDbPath = path.join(tempDir, 'challenger_storage.sqlite');

    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    workspaceRepo = new WorkspaceRepository(db);
    taskRepo = new TaskRepository(db);
    goalRepo = new GoalRepository(db);
    channelService = new ChannelService(db);
    agentRepo = new AgentRepository(db);

    // Bootstrap root foreign keys
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-chal', 'Challenger Workspace', '/tmp/chal', 'AUTO', 1000, 1000)`
    );

    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES ('proj-chal', 'ws-chal', 'Challenger Project', '/tmp/chal/proj', '{}', 1000, 1000)`
    );

    db.execute(
      `INSERT INTO channels (id, project_id, name, channel_type, is_private, created_at)
       VALUES ('chan-chal', 'proj-chal', 'general', 'channel', 0, 1000)`
    );

    db.execute(
      `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, origin_channel_id, created_at, updated_at)
       VALUES ('goal-chal', 'proj-chal', 'Challenger Goal', 'Desc', '[]', 'active', 'chan-chal', 1000, 1000)`
    );

    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
       VALUES ('def-chal-root', 'Root', 'Lead', 'System Prompt', 'model-root', '[]', '[]', 1000)`
    );

    db.execute(
      `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, parent_agent_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
       VALUES ('agent-chal-parent', 'ws-chal', 'proj-chal', 'def-chal-root', NULL, '@Leader', 'model-root', 1, 0, 1000, 1000)`
    );
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}

    // Verify absolute zero prototype leakage in the Node.js runtime process
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect((Object.prototype as any).isAdmin).toBeUndefined();
    expect((Object.prototype as any).injected).toBeUndefined();
    expect((Object.prototype as any).role).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).isAdmin).toBeUndefined();
  });

  // ==========================================================================
  // SECTION 1: STORAGE PRIMITIVES EMPIRICAL STRESS
  // ==========================================================================
  describe('Section 1: Storage Primitives (safeJsonParseObject, safeJsonParseArray, safeJsonParse)', () => {
    it('safeJsonParseObject never pollutes Object.prototype or leaks prototype properties to new objects', () => {
      for (const payload of ADVERSARIAL_INPUTS.prototypePollution) {
        const parsed = safeJsonParseObject(payload, { safeFallback: true });
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe('object');
        expect(parsed).not.toBeNull();
        expect(Array.isArray(parsed)).toBe(false);

        // Global prototype must remain pristine
        expect((Object.prototype as any).polluted).toBeUndefined();
        expect((Object.prototype as any).isAdmin).toBeUndefined();
        expect((Object.prototype as any).injected).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined();

        // Spreading or cloning parsed output must not trigger global pollution
        const cloned = { ...parsed };
        expect((Object.prototype as any).polluted).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined();
      }
    });

    it('safeJsonParseArray never pollutes Object.prototype and always satisfies Array.isArray()', () => {
      for (const payload of ADVERSARIAL_INPUTS.prototypePollution) {
        const parsed = safeJsonParseArray(payload, ['safe-fallback']);
        expect(Array.isArray(parsed)).toBe(true);
        expect((Object.prototype as any).polluted).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined();
      }
    });

    it('safeJsonParseObject returns fallback object for all type confusion variants without throwing', () => {
      const fallback = { fallback: true };
      for (const payload of ADVERSARIAL_INPUTS.typeConfusion) {
        const res = safeJsonParseObject(payload, fallback);
        expect(typeof res).toBe('object');
        expect(res).not.toBeNull();
        expect(Array.isArray(res)).toBe(false);
      }
    });

    it('safeJsonParseArray returns genuine Array for all type confusion variants and supports array operations', () => {
      const fallback = ['fallback-1', 'fallback-2'];
      for (const payload of ADVERSARIAL_INPUTS.typeConfusion) {
        const res = safeJsonParseArray(payload, fallback);
        expect(Array.isArray(res)).toBe(true);
        // Verify array operations do not throw TypeError
        expect(() => res.map((x) => x)).not.toThrow();
        expect(() => res.filter(Boolean)).not.toThrow();
        expect(() => res.includes('fallback-1' as any)).not.toThrow();
        expect(() => res.slice(0, 1)).not.toThrow();
        expect(() => res.join(',')).not.toThrow();
      }
    });

    it('safeJsonParseObject handles corrupt, unclosed, escape-broken, and null-byte payloads without throwing', () => {
      const fallback = { fallbackKey: 'safe' };
      for (const payload of ADVERSARIAL_INPUTS.malformedAndCorrupt) {
        expect(() => {
          const res = safeJsonParseObject(payload, fallback);
          expect(typeof res).toBe('object');
          expect(res).not.toBeNull();
          expect(Array.isArray(res)).toBe(false);
        }).not.toThrow();
      }
    });

    it('safeJsonParseArray handles corrupt, unclosed, escape-broken, and null-byte payloads without throwing', () => {
      const fallback = ['safe'];
      for (const payload of ADVERSARIAL_INPUTS.malformedAndCorrupt) {
        expect(() => {
          const res = safeJsonParseArray(payload, fallback);
          expect(Array.isArray(res)).toBe(true);
        }).not.toThrow();
      }
    });

    it('safeJsonParse handles all non-string raw inputs gracefully', () => {
      for (const nonStr of ADVERSARIAL_INPUTS.nonStringInputs) {
        expect(() => {
          const obj = safeJsonParseObject(nonStr, { ok: 1 });
          expect(typeof obj).toBe('object');
          expect(obj).not.toBeNull();
        }).not.toThrow();

        expect(() => {
          const arr = safeJsonParseArray(nonStr, ['ok']);
          expect(Array.isArray(arr)).toBe(true);
        }).not.toThrow();

        expect(() => {
          const generic = safeJsonParse(nonStr, 'fallback');
          expect(generic !== null && generic !== undefined).toBe(true);
        }).not.toThrow();
      }
    });

    it('safeJsonParse correctly respects fallback contracts when types mismatch', () => {
      // Fallback is array, parsed is object -> return fallback
      expect(safeJsonParse('{"a": 1}', ['default'])).toEqual(['default']);
      // Fallback is object, parsed is array -> return fallback
      expect(safeJsonParse('[1, 2, 3]', { default: true })).toEqual({ default: true });
      // Fallback is object, parsed is primitive -> return fallback
      expect(safeJsonParse('123', { default: true })).toEqual({ default: true });
      expect(safeJsonParse('"string"', { default: true })).toEqual({ default: true });
      expect(safeJsonParse('true', { default: true })).toEqual({ default: true });
      // Fallback is array, parsed is primitive -> return fallback
      expect(safeJsonParse('123', ['default'])).toEqual(['default']);
      // Valid object parsed as object
      expect(safeJsonParse('{"a": 1}', { default: true })).toEqual({ a: 1 });
      // Valid array parsed as array
      expect(safeJsonParse('[1, 2, 3]', ['default'])).toEqual([1, 2, 3]);
    });
  });

  // ==========================================================================
  // SECTION 2: WORKSPACE REPOSITORY ADVERSARIAL STRESS
  // ==========================================================================
  describe('Section 2: WorkspaceRepository Adversarial Stress', () => {
    it('getProject and listProjects survive adversarial settings_json without throwing or leaking prototype', () => {
      const allAdversarial = [
        ...ADVERSARIAL_INPUTS.prototypePollution,
        ...ADVERSARIAL_INPUTS.typeConfusion,
        ...ADVERSARIAL_INPUTS.malformedAndCorrupt,
        ...ADVERSARIAL_INPUTS.hugeStrings,
      ];

      allAdversarial.forEach((payload, idx) => {
        const projId = `proj-test-${idx}`;
        db.execute(
          `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
           VALUES (?, 'ws-chal', ?, '/tmp/chal', ?, 1000 + ?, 1000 + ?)`,
          projId,
          `Test Project ${idx}`,
          payload,
          idx,
          idx
        );

        const project = workspaceRepo.getProject(projId);
        expect(project).toBeDefined();
        expect(project!.id).toBe(projId);
        expect(typeof project!.settings).toBe('object');
        expect(project!.settings).not.toBeNull();
        expect(Array.isArray(project!.settings)).toBe(false);

        // Verify no prototype leakage
        expect((Object.prototype as any).polluted).toBeUndefined();
      });

      // Multi-row listing
      const listed = workspaceRepo.listProjects('ws-chal');
      expect(listed.length).toBe(1 + allAdversarial.length);
      for (const p of listed) {
        expect(typeof p.settings).toBe('object');
        expect(p.settings).not.toBeNull();
        expect(Array.isArray(p.settings)).toBe(false);
      }
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('createProject and deleteProject safely handle settings without throwing', () => {
      const projId = 'proj-update-test';
      workspaceRepo.createProject({
        id: projId,
        workspaceId: 'ws-chal',
        name: 'Update Test',
        repoPath: '/tmp/chal/update',
        settings: { safeKey: 'safeVal', __proto__: { safe: true } } as any,
        createdAt: 1000,
        updatedAt: 1000,
      });

      const fetched = workspaceRepo.getProject(projId);
      expect(fetched).toBeDefined();
      expect(fetched!.settings).toBeDefined();
      expect((Object.prototype as any).polluted).toBeUndefined();

      workspaceRepo.deleteProject(projId);
      expect(workspaceRepo.getProject(projId)).toBeUndefined();
    });
  });

  // ==========================================================================
  // SECTION 3: TASK REPOSITORY ADVERSARIAL STRESS
  // ==========================================================================
  describe('Section 3: TaskRepository Adversarial Stress', () => {
    it('getTask, listTasksByGoal, listTasksByProject survive adversarial verification_spec_json', () => {
      const allAdversarial = [
        ...ADVERSARIAL_INPUTS.prototypePollution,
        ...ADVERSARIAL_INPUTS.typeConfusion,
        ...ADVERSARIAL_INPUTS.malformedAndCorrupt,
        ...ADVERSARIAL_INPUTS.hugeStrings,
      ];

      allAdversarial.forEach((payload, idx) => {
        const taskId = `task-spec-${idx}`;
        db.execute(
          `INSERT INTO tasks (id, goal_id, title, description, status, verification_spec_json, created_at, updated_at)
           VALUES (?, 'goal-chal', ?, 'Task Desc', 'backlog', ?, 1000 + ?, 1000 + ?)`,
          taskId,
          `Task ${idx}`,
          payload,
          idx,
          idx
        );

        const task = taskRepo.getTask(taskId);
        expect(task).toBeDefined();
        expect(task!.id).toBe(taskId);
        expect(typeof task!.verificationSpec).toBe('object');
        expect(task!.verificationSpec).not.toBeNull();
        expect(Array.isArray(task!.verificationSpec)).toBe(false);
      });

      const byGoal = taskRepo.listTasksByGoal('goal-chal');
      expect(byGoal.length).toBe(allAdversarial.length);
      for (const t of byGoal) {
        expect(typeof t.verificationSpec).toBe('object');
        expect(t.verificationSpec).not.toBeNull();
        expect(Array.isArray(t.verificationSpec)).toBe(false);
      }

      const byProject = taskRepo.listTasksByProject('proj-chal');
      expect(byProject.length).toBe(allAdversarial.length);
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('getDecision, listDecisionsByProject, listAllDecisions survive adversarial alternatives_considered_json', () => {
      const allAdversarial = [
        ...ADVERSARIAL_INPUTS.prototypePollution,
        ...ADVERSARIAL_INPUTS.typeConfusion,
        ...ADVERSARIAL_INPUTS.malformedAndCorrupt,
        ...ADVERSARIAL_INPUTS.hugeStrings,
      ];

      allAdversarial.forEach((payload, idx) => {
        const decId = `dec-${idx}`;
        db.execute(
          `INSERT INTO decisions (id, project_id, decided_by_id, title, rationale, alternatives_considered_json, status, created_at)
           VALUES (?, 'proj-chal', 'agent-chal-parent', ?, 'Rationale', ?, 'proposed', 1000 + ?)`,
          decId,
          `Decision ${idx}`,
          payload,
          idx
        );

        const dec = taskRepo.getDecision(decId);
        expect(dec).toBeDefined();
        expect(dec!.id).toBe(decId);
        expect(Array.isArray(dec!.alternativesConsidered)).toBe(true);
        expect(() => dec!.alternativesConsidered.includes('x')).not.toThrow();
        expect(() => dec!.alternativesConsidered.map(String)).not.toThrow();
      });

      const byProj = taskRepo.listDecisionsByProject('proj-chal');
      expect(byProj.length).toBe(allAdversarial.length);

      const allDec = taskRepo.listAllDecisions();
      expect(allDec.length).toBe(allAdversarial.length);
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('claimTaskWithLease, renewTaskLease, and reclaimExpiredTaskLeases operate cleanly on corrupted tasks', () => {
      // Seed runs for foreign key satisfaction
      db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at)
         VALUES ('run-1', 'agent-chal-parent', 'proj-chal', 'running', 1000, 1000)`
      );
      db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at)
         VALUES ('run-2', 'agent-chal-parent', 'proj-chal', 'running', 1000, 1000)`
      );

      // Seed running task with corrupted verification_spec_json
      db.execute(
        `INSERT INTO tasks (id, goal_id, title, description, status, verification_spec_json, claimed_by_run_id, lease_expires_at, retry_count, created_at, updated_at)
         VALUES ('task-lease-corrupt', 'goal-chal', 'Lease Corrupt Task', 'Desc', 'running', '{"__proto__": {"polluted": true}}', 'run-1', ?, 0, 1000, 1000)`,
        Date.now() - 5000 // expired
      );

      // Reclaim expired lease
      const reclaimed = taskRepo.reclaimExpiredTaskLeases();
      expect(reclaimed).toContain('task-lease-corrupt');

      const taskAfter = taskRepo.getTask('task-lease-corrupt');
      expect(taskAfter?.status).toBe('ready');
      expect(taskAfter?.claimedByRunId).toBeUndefined();

      // Claim task again
      const claimed = taskRepo.claimTaskWithLease('task-lease-corrupt', 'agent-chal-parent', 'run-2', 60000);
      expect(claimed).toBe(true);

      // Renew lease
      const renewed = taskRepo.renewTaskLease('task-lease-corrupt', 'run-2', 60000);
      expect(renewed).toBe(true);

      expect((Object.prototype as any).polluted).toBeUndefined();
    });
  });

  // ==========================================================================
  // SECTION 4: GOAL REPOSITORY ADVERSARIAL STRESS
  // ==========================================================================
  describe('Section 4: GoalRepository Adversarial Stress', () => {
    it('getGoal, listGoals, and listGoalsByOriginChannel survive adversarial acceptance_criteria and proposed_replanning', () => {
      const allAdversarial = [
        ...ADVERSARIAL_INPUTS.prototypePollution,
        ...ADVERSARIAL_INPUTS.typeConfusion,
        ...ADVERSARIAL_INPUTS.malformedAndCorrupt,
        ...ADVERSARIAL_INPUTS.hugeStrings,
      ];

      allAdversarial.forEach((payload, idx) => {
        const goalId = `goal-adv-${idx}`;
        db.execute(
          `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, proposed_replanning_json, origin_channel_id, created_at, updated_at)
           VALUES (?, 'proj-chal', ?, 'Goal Desc', ?, 'active', ?, 'chan-chal', 1000 + ?, 1000 + ?)`,
          goalId,
          `Adv Goal ${idx}`,
          payload,
          payload,
          idx,
          idx
        );

        const goal = goalRepo.getGoal(goalId);
        expect(goal).toBeDefined();
        expect(goal!.id).toBe(goalId);
        expect(Array.isArray(goal!.acceptanceCriteria)).toBe(true);
        expect(() => goal!.acceptanceCriteria.includes('crit')).not.toThrow();
        expect(() => goal!.acceptanceCriteria.map(String)).not.toThrow();
      });

      const listed = goalRepo.listGoals('proj-chal', false);
      expect(listed.length).toBe(1 + allAdversarial.length);

      const deduplicated = goalRepo.listGoals('proj-chal', true);
      expect(deduplicated.length).toBe(1 + allAdversarial.length);

      const byOrigin = goalRepo.listGoalsByOriginChannel('chan-chal');
      expect(byOrigin.length).toBe(1 + allAdversarial.length);

      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('proposeReplanning, applyReplanning, and pruneDuplicateGoals operate reliably under adversarial inputs', () => {
      const gId1 = 'goal-replan-1';
      db.execute(
        `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, proposed_replanning_json, origin_channel_id, created_at, updated_at)
         VALUES (?, 'proj-chal', 'Replan Goal', 'Desc', '["crit 1"]', 'active', NULL, 'chan-chal', 1000, 1000)`,
        gId1
      );

      // Propose replanning with prototype pollution payload
      goalRepo.proposeReplanning(gId1, {
        __proto__: { polluted: true },
        title: 'Replan Goal Title Modified',
        acceptanceCriteria: ['new crit 1', 'new crit 2'],
      });

      const beforeApply = goalRepo.getGoal(gId1);
      expect(beforeApply?.proposedReplanning).toBeDefined();
      expect((Object.prototype as any).polluted).toBeUndefined();

      // Apply replanning
      goalRepo.applyReplanning(gId1, beforeApply!.proposedReplanning);

      const afterApply = goalRepo.getGoal(gId1);
      expect(afterApply?.title).toBe('Replan Goal Title Modified');
      expect(afterApply?.acceptanceCriteria).toEqual(['new crit 1', 'new crit 2']);
      expect(afterApply?.proposedReplanning).toBeUndefined();
      expect((Object.prototype as any).polluted).toBeUndefined();

      // Test pruneDuplicateGoals
      const gId2 = 'goal-replan-2';
      db.execute(
        `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, proposed_replanning_json, origin_channel_id, created_at, updated_at)
         VALUES (?, 'proj-chal', 'Replan Goal Title Modified', 'Desc', '["crit 1"]', 'active', NULL, 'chan-chal', 1001, 1001)`,
        gId2
      );

      const pruned = goalRepo.pruneDuplicateGoals('proj-chal');
      expect(pruned).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // SECTION 5: CHANNEL SERVICE ADVERSARIAL STRESS
  // ==========================================================================
  describe('Section 5: ChannelService Adversarial Stress', () => {
    it('getMessage and getMessages survive adversarial mentions_json without throwing or leaking prototype', () => {
      const allAdversarial = [
        ...ADVERSARIAL_INPUTS.prototypePollution,
        ...ADVERSARIAL_INPUTS.typeConfusion,
        ...ADVERSARIAL_INPUTS.malformedAndCorrupt,
        ...ADVERSARIAL_INPUTS.hugeStrings,
      ];

      allAdversarial.forEach((payload, idx) => {
        const msgId = `msg-chal-${idx}`;
        db.execute(
          `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, mentions_json, productivity_score, created_at)
           VALUES (?, 'chan-chal', 'agent-chal-parent', 'agent', 'Test message', ?, 0, 1000 + ?)`,
          msgId,
          payload,
          idx
        );

        const msg = channelService.getMessage(msgId);
        expect(msg).toBeDefined();
        expect(msg!.id).toBe(msgId);
        expect(Array.isArray(msg!.mentions)).toBe(true);
        expect(() => msg!.mentions.includes('@someone')).not.toThrow();
        expect(() => msg!.mentions.map((m) => String(m).toLowerCase())).not.toThrow();
      });

      const messages = channelService.getMessages('chan-chal', 200);
      expect(messages.length).toBe(allAdversarial.length);
      for (const m of messages) {
        expect(Array.isArray(m.mentions)).toBe(true);
      }

      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('extractMentions handles malicious patterns, code blocks, blockquotes, null bytes, and huge content', () => {
      expect(channelService.extractMentions(null as any)).toEqual([]);
      expect(channelService.extractMentions(undefined as any)).toEqual([]);
      expect(channelService.extractMentions(12345 as any)).toEqual([]);

      // Properly closed code block should have mentions ignored
      const closedBlock = '```typescript\n@bad_mention\nconst x = 1;\n```\n@valid_mention';
      expect(channelService.extractMentions(closedBlock)).toEqual(['valid_mention']);

      // Inline code
      const inlineCode = 'Look at `@code_mention` and then @real_mention';
      expect(channelService.extractMentions(inlineCode)).toEqual(['real_mention']);

      // Mention inside blockquote should be stripped
      const blockquote = '> @quoted_mention\n@actual_mention';
      expect(channelService.extractMentions(blockquote)).toEqual(['actual_mention']);

      // Null bytes in mention
      const nullByteContent = 'Hello @agent\0name and @boss!';
      const extracted = channelService.extractMentions(nullByteContent);
      expect(extracted).toContain('boss');

      // Huge content (100k chars)
      const hugeContent = 'word '.repeat(20000) + ' @valid_agent';
      expect(channelService.extractMentions(hugeContent)).toEqual(['valid_agent']);
    });
  });

  // ==========================================================================
  // SECTION 6: AGENT REPOSITORY ADVERSARIAL STRESS
  // ==========================================================================
  describe('Section 6: AgentRepository Adversarial Stress', () => {
    it('getDefinition, getIdentity, getIdentityByProjectAndName, listIdentities, listSubordinates survive adversarial JSON', () => {
      const allAdversarial = [
        ...ADVERSARIAL_INPUTS.prototypePollution,
        ...ADVERSARIAL_INPUTS.typeConfusion,
        ...ADVERSARIAL_INPUTS.malformedAndCorrupt,
        ...ADVERSARIAL_INPUTS.hugeStrings,
      ];

      allAdversarial.forEach((payload, idx) => {
        const defId = `def-adv-${idx}`;
        const identityId = `identity-adv-${idx}`;
        const name = `AgentAdv_${idx}`;

        db.execute(
          `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
           VALUES (?, ?, 'Role', 'Prompt', 'model-1', ?, ?, 1000 + ?)`,
          defId,
          name,
          payload,
          payload,
          idx
        );

        db.execute(
          `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, parent_agent_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
           VALUES (?, 'ws-chal', 'proj-chal', ?, 'agent-chal-parent', ?, 'model-1', 0, 0, 1000 + ?, 1000 + ?)`,
          identityId,
          defId,
          name,
          idx,
          idx
        );

        // 1. getDefinition
        const def = agentRepo.getDefinition(defId);
        expect(def).toBeDefined();
        expect(Array.isArray(def!.domainAuthority)).toBe(true);
        expect(Array.isArray(def!.capabilities)).toBe(true);
        expect(() => def!.domainAuthority.includes('test')).not.toThrow();
        expect(() => def!.capabilities.map(String)).not.toThrow();

        // 2. getIdentity
        const identity = agentRepo.getIdentity(identityId);
        expect(identity).toBeDefined();
        if (identity!.capabilities) {
          expect(Array.isArray(identity!.capabilities)).toBe(true);
          expect(() => identity!.capabilities!.includes('test')).not.toThrow();
        }

        // 3. getIdentityByProjectAndName
        const identityByName = agentRepo.getIdentityByProjectAndName('proj-chal', name);
        expect(identityByName).toBeDefined();
        if (identityByName!.capabilities) {
          expect(Array.isArray(identityByName!.capabilities)).toBe(true);
        }
      });

      // 4. listIdentities
      const allIdentities = agentRepo.listIdentities('ws-chal');
      expect(allIdentities.length).toBe(1 + allAdversarial.length);

      // 5. listIdentitiesByProject
      const projIdentities = agentRepo.listIdentitiesByProject('proj-chal');
      expect(projIdentities.length).toBe(1 + allAdversarial.length);

      // 6. listSubordinates
      const subordinates = agentRepo.listSubordinates('agent-chal-parent');
      expect(subordinates.length).toBe(allAdversarial.length);
      for (const sub of subordinates) {
        if (sub.capabilities) {
          expect(Array.isArray(sub.capabilities)).toBe(true);
        }
      }

      // 7. ensureProjectBoss
      const boss = agentRepo.ensureProjectBoss('proj-chal', 'ws-chal');
      expect(boss).toBeDefined();
      expect(boss.isOrchestrator).toBe(true);

      expect((Object.prototype as any).polluted).toBeUndefined();
    });
  });

  // ==========================================================================
  // SECTION 7: GLOBAL RUNTIME PROTOTYPE CLEANLINESS VERIFICATION
  // ==========================================================================
  describe('Section 7: Global Runtime Prototype Cleanliness Verification', () => {
    it('confirms zero prototype pollution across the entire JavaScript runtime process', () => {
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect((Object.prototype as any).isAdmin).toBeUndefined();
      expect((Object.prototype as any).injected).toBeUndefined();
      expect((Object.prototype as any).role).toBeUndefined();
      expect(Object.prototype.hasOwnProperty('polluted')).toBe(false);
      expect(Object.prototype.hasOwnProperty('isAdmin')).toBe(false);
      expect(Object.prototype.hasOwnProperty('injected')).toBe(false);
      expect(Object.prototype.hasOwnProperty('role')).toBe(false);
      expect(({} as any).polluted).toBeUndefined();
      expect(({} as any).isAdmin).toBeUndefined();
    });
  });
});
