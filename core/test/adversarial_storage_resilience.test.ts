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

describe('Layer 0 Adversarial Resilience: Defensive JSON Fallback & Prototype Pollution Hardening', () => {
  let db: KinDatabase;
  let tempDir: string;
  let tempDbPath: string;

  let workspaceRepo: WorkspaceRepository;
  let taskRepo: TaskRepository;
  let goalRepo: GoalRepository;
  let channelService: ChannelService;
  let agentRepo: AgentRepository;

  // Extreme adversarial payload suite
  const ADVERSARIAL_PAYLOADS = {
    prototypePollution: [
      '{"__proto__": {"polluted": true, "isAdmin": true}}',
      '{"constructor": {"prototype": {"polluted": true}}}',
      '{"prototype": {"polluted": true}}',
      '{"__proto__": null}',
      '{"__proto__": "string"}',
      '{"__proto__": [1, 2, 3]}',
      '{"nested": {"__proto__": {"polluted": true}}}',
    ],
    typeConfusion: [
      '0',
      '-0',
      '1',
      '-42',
      '3.141592653589793',
      '1e309', // Overflows to Infinity in JS JSON.parse
      '-1e309', // Overflows to -Infinity in JS JSON.parse
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
      '["foo", "bar"]',
      '[{"nested": true}]',
      '{}',
      '{"0": "first", "1": "second", "length": 2}',
      '{"key": "value"}',
    ],
    corruptAndMalformed: [
      '{"unclosed_string": "value',
      '{"unclosed_object": {"nested": 1',
      '{"unclosed_array": [1, 2, 3',
      '{"trailing_comma": 1,}',
      '{"trailing_colon": 1, "k":}',
      '[1, 2, 3,]',
      '{"bad_escape": "\\v"}',
      '{"bad_hex": "\\x41"}',
      '{"bad_unicode": "\\u12"}',
      '{"dangling_backslash": "\\',
      '{"single_quotes": \'value\'}',
      '{unquoted_key: 123}',
      '{"null_byte": "\0"}',
      '{"raw_control": "\x01\x02\x03\x1f"}',
      '{"surrogate": "\uD800"}',
      '\0\0\0\0\0',
      '',
      '   \t\r\n   ',
    ],
    hugeStrings: [
      // 500KB of corrupt garbage
      'A'.repeat(500000),
      // 500KB unclosed JSON
      '{"huge_unclosed": "' + 'B'.repeat(500000),
      // 500KB valid large object
      JSON.stringify({ huge_blob: 'C'.repeat(500000) }),
      // 500KB valid large array
      JSON.stringify(Array.from({ length: 25000 }, (_, i) => `item-${i}`)),
      // Deeply nested JSON that risks recursion depth
      '['.repeat(500) + '1' + ']'.repeat(500),
      // Very deeply nested structure
      '{"a":'.repeat(1000) + '1' + '}'.repeat(1000),
    ],
    sqlInjectionAttempts: [
      '{"id": "1; DROP TABLE tasks; --"}',
      '{"query": "\' OR \'1\'=\'1"}',
      '{"title": "test\\"; DROP TABLE workspaces; --"}',
    ],
  };

  beforeEach(() => {
    // Reset Object.prototype guarantees before each test
    delete (Object.prototype as any).polluted;
    delete (Object.prototype as any).isAdmin;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-adversarial-storage-'));
    tempDbPath = path.join(tempDir, 'adversarial.sqlite');

    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    workspaceRepo = new WorkspaceRepository(db);
    taskRepo = new TaskRepository(db);
    goalRepo = new GoalRepository(db);
    channelService = new ChannelService(db);
    agentRepo = new AgentRepository(db);

    // Bootstrap baseline entities
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-adv', 'Adversarial Workspace', '/adv', 'AUTO', 1000, 1000)`
    );

    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES ('proj-adv', 'ws-adv', 'Adversarial Project', '/adv/proj', '{}', 1000, 1000)`
    );

    db.execute(
      `INSERT INTO channels (id, project_id, name, channel_type, is_private, created_at)
       VALUES ('chan-adv', 'proj-adv', 'adv-channel', 'channel', 0, 1000)`
    );

    db.execute(
      `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, origin_channel_id, created_at, updated_at)
       VALUES ('goal-adv', 'proj-adv', 'Adv Goal', 'Adv Desc', '[]', 'active', 'chan-adv', 1000, 1000)`
    );

    // Bootstrap root parent agent definition and identity for foreign key relations
    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
       VALUES ('def-root', 'Root Agent', 'Lead', 'Prompt', 'ollama/llama3', '[]', '[]', 1000)`
    );

    db.execute(
      `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, parent_agent_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
       VALUES ('parent-agent', 'ws-adv', 'proj-adv', 'def-root', NULL, 'Root Parent', 'ollama/llama3', 1, 0, 1000, 1000)`
    );
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows file unlock delay
    }
    // Verify zero prototype pollution persisted after teardown
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect((Object.prototype as any).isAdmin).toBeUndefined();
  });

  describe('Storage Primitives: Adversarial Edge Cases', () => {
    it('safeJsonParseObject blocks prototype pollution and does not pollute Object.prototype', () => {
      for (const payload of ADVERSARIAL_PAYLOADS.prototypePollution) {
        const result = safeJsonParseObject(payload, { safe: true });
        expect(result).toBeDefined();
        // Crucial invariant: Object.prototype must NEVER be polluted
        expect((Object.prototype as any).polluted).toBeUndefined();
        expect((Object.prototype as any).isAdmin).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined();
        expect(({} as any).isAdmin).toBeUndefined();
      }
    });

    it('safeJsonParseArray blocks prototype pollution and returns clean arrays', () => {
      for (const payload of ADVERSARIAL_PAYLOADS.prototypePollution) {
        const result = safeJsonParseArray(payload, ['fallback']);
        expect(Array.isArray(result)).toBe(true);
        expect((Object.prototype as any).polluted).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined();
      }
    });

    it('safeJsonParseObject handles type confusion and always returns a non-array, non-null object', () => {
      for (const payload of ADVERSARIAL_PAYLOADS.typeConfusion) {
        const result = safeJsonParseObject(payload, { default: true });
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(false);
      }
    });

    it('safeJsonParseArray handles type confusion and always satisfies Array.isArray()', () => {
      for (const payload of ADVERSARIAL_PAYLOADS.typeConfusion) {
        const result = safeJsonParseArray(payload, ['default']);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(() => result.map((x) => x)).not.toThrow();
        expect(() => result.includes('foo' as any)).not.toThrow();
      }
    });

    it('safeJsonParseObject handles huge strings, unclosed quotes, and corrupt escape sequences without crashing', () => {
      const allMalformed = [
        ...ADVERSARIAL_PAYLOADS.corruptAndMalformed,
        ...ADVERSARIAL_PAYLOADS.hugeStrings,
      ];
      for (const payload of allMalformed) {
        expect(() => {
          const res = safeJsonParseObject(payload, { ok: false });
          expect(res).toBeDefined();
          expect(typeof res).toBe('object');
          expect(res).not.toBeNull();
          expect(Array.isArray(res)).toBe(false);
        }).not.toThrow();
      }
    });

    it('safeJsonParse handles primitive non-string inputs (symbols, functions, buffers, dates)', () => {
      expect(safeJsonParseObject(Symbol('test'), { fallback: true })).toEqual({ fallback: true });
      expect(safeJsonParseObject(() => {}, { fallback: true })).toEqual({ fallback: true });
      expect(safeJsonParseArray(Symbol('test'), ['fallback'])).toEqual(['fallback']);
      expect(safeJsonParseArray(() => {}, ['fallback'])).toEqual(['fallback']);
      expect(safeJsonParse(Symbol('test'), 'fallback')).toBe('fallback');
    });
  });

  describe('WorkspaceRepository: Adversarial Input Resilience', () => {
    it('getProject and listProjects survive prototype pollution attempts and corrupt settings_json', () => {
      const payloads = [
        ...ADVERSARIAL_PAYLOADS.prototypePollution,
        ...ADVERSARIAL_PAYLOADS.typeConfusion,
        ...ADVERSARIAL_PAYLOADS.corruptAndMalformed,
        ...ADVERSARIAL_PAYLOADS.hugeStrings,
        ...ADVERSARIAL_PAYLOADS.sqlInjectionAttempts,
      ];

      payloads.forEach((payload, idx) => {
        const pId = `proj-adv-${idx}`;
        db.execute(
          `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
           VALUES (?, 'ws-adv', ?, '/repo', ?, 1000 + ?, 1000 + ?)`,
          pId,
          `Adv Project ${idx}`,
          payload,
          idx,
          idx
        );

        const project = workspaceRepo.getProject(pId);
        expect(project).toBeDefined();
        expect(project!.id).toBe(pId);
        expect(typeof project!.settings).toBe('object');
        expect(project!.settings).not.toBeNull();
        expect(Array.isArray(project!.settings)).toBe(false);

        // Verify zero prototype pollution
        expect((Object.prototype as any).polluted).toBeUndefined();
        expect((Object.prototype as any).isAdmin).toBeUndefined();
      });

      // Batch list verification
      let projects: any[];
      expect(() => {
        projects = workspaceRepo.listProjects('ws-adv');
      }).not.toThrow();
      expect(projects!.length).toBe(1 + payloads.length); // 1 baseline + all payloads

      for (const p of projects!) {
        expect(typeof p.settings).toBe('object');
        expect(p.settings).not.toBeNull();
        expect(Array.isArray(p.settings)).toBe(false);
      }
      expect((Object.prototype as any).polluted).toBeUndefined();
    });
  });

  describe('TaskRepository: Adversarial Input Resilience', () => {
    it('getTask, listTasksByGoal, listTasksByProject survive all adversarial verification_spec_json payloads', () => {
      const payloads = [
        ...ADVERSARIAL_PAYLOADS.prototypePollution,
        ...ADVERSARIAL_PAYLOADS.typeConfusion,
        ...ADVERSARIAL_PAYLOADS.corruptAndMalformed,
        ...ADVERSARIAL_PAYLOADS.hugeStrings,
        ...ADVERSARIAL_PAYLOADS.sqlInjectionAttempts,
      ];

      payloads.forEach((payload, idx) => {
        const taskId = `task-adv-${idx}`;
        db.execute(
          `INSERT INTO tasks (id, goal_id, title, description, status, verification_spec_json, created_at, updated_at)
           VALUES (?, 'goal-adv', 'Adv Task', 'Desc', 'backlog', ?, 1000 + ?, 1000 + ?)`,
          taskId,
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

        expect((Object.prototype as any).polluted).toBeUndefined();
      });

      let byGoal: any[];
      expect(() => {
        byGoal = taskRepo.listTasksByGoal('goal-adv');
      }).not.toThrow();
      expect(byGoal!.length).toBe(payloads.length);

      let byProject: any[];
      expect(() => {
        byProject = taskRepo.listTasksByProject('proj-adv');
      }).not.toThrow();
      expect(byProject!.length).toBe(payloads.length);

      for (const t of byGoal!) {
        expect(typeof t.verificationSpec).toBe('object');
        expect(Array.isArray(t.verificationSpec)).toBe(false);
      }
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('getDecision, listDecisionsByProject, listAllDecisions survive adversarial alternatives_considered_json', () => {
      const payloads = [
        ...ADVERSARIAL_PAYLOADS.prototypePollution,
        ...ADVERSARIAL_PAYLOADS.typeConfusion,
        ...ADVERSARIAL_PAYLOADS.corruptAndMalformed,
        ...ADVERSARIAL_PAYLOADS.hugeStrings,
      ];

      payloads.forEach((payload, idx) => {
        const decId = `dec-adv-${idx}`;
        db.execute(
          `INSERT INTO decisions (id, project_id, decided_by_id, title, rationale, alternatives_considered_json, status, created_at)
           VALUES (?, 'proj-adv', 'agent-adv', 'Title', 'Rationale', ?, 'proposed', 1000 + ?)`,
          decId,
          payload,
          idx
        );

        const decision = taskRepo.getDecision(decId);
        expect(decision).toBeDefined();
        expect(decision!.id).toBe(decId);
        expect(Array.isArray(decision!.alternativesConsidered)).toBe(true);
        // Verify caller array methods never throw TypeError
        expect(() => decision!.alternativesConsidered.includes('test')).not.toThrow();
        expect(() => decision!.alternativesConsidered.map((x) => x)).not.toThrow();
      });

      let byProj: any[];
      expect(() => {
        byProj = taskRepo.listDecisionsByProject('proj-adv');
      }).not.toThrow();
      expect(byProj!.length).toBe(payloads.length);

      let allDec: any[];
      expect(() => {
        allDec = taskRepo.listAllDecisions();
      }).not.toThrow();
      expect(allDec!.length).toBe(payloads.length);

      expect((Object.prototype as any).polluted).toBeUndefined();
    });
  });

  describe('GoalRepository: Adversarial Input Resilience', () => {
    it('getGoal, listGoals, listGoalsByOriginChannel survive adversarial criteria & replanning payloads', () => {
      const payloads = [
        ...ADVERSARIAL_PAYLOADS.prototypePollution,
        ...ADVERSARIAL_PAYLOADS.typeConfusion,
        ...ADVERSARIAL_PAYLOADS.corruptAndMalformed,
        ...ADVERSARIAL_PAYLOADS.hugeStrings,
      ];

      payloads.forEach((payload, idx) => {
        const goalId = `goal-adv-item-${idx}`;
        db.execute(
          `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, proposed_replanning_json, origin_channel_id, created_at, updated_at)
           VALUES (?, 'proj-adv', 'Goal Adv', 'Desc', ?, 'active', ?, 'chan-adv', 1000 + ?, 1000 + ?)`,
          goalId,
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
        expect(() => goal!.acceptanceCriteria.map((c) => c)).not.toThrow();

        expect((Object.prototype as any).polluted).toBeUndefined();
      });

      let goals: any[];
      expect(() => {
        goals = goalRepo.listGoals('proj-adv', false);
      }).not.toThrow();
      expect(goals!.length).toBe(1 + payloads.length); // 1 baseline + payloads

      let chanGoals: any[];
      expect(() => {
        chanGoals = goalRepo.listGoalsByOriginChannel('chan-adv');
      }).not.toThrow();
      expect(chanGoals!.length).toBe(1 + payloads.length);

      expect((Object.prototype as any).polluted).toBeUndefined();
    });
  });

  describe('ChannelService: Adversarial Input Resilience', () => {
    it('getMessage and getMessages survive adversarial mentions_json payloads', () => {
      const payloads = [
        ...ADVERSARIAL_PAYLOADS.prototypePollution,
        ...ADVERSARIAL_PAYLOADS.typeConfusion,
        ...ADVERSARIAL_PAYLOADS.corruptAndMalformed,
        ...ADVERSARIAL_PAYLOADS.hugeStrings,
      ];

      payloads.forEach((payload, idx) => {
        const msgId = `msg-adv-${idx}`;
        db.execute(
          `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, mentions_json, productivity_score, created_at)
           VALUES (?, 'chan-adv', 'user-adv', 'human', 'Adversarial message', ?, 0, 1000 + ?)`,
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

        expect((Object.prototype as any).polluted).toBeUndefined();
      });

      let messages: any[];
      expect(() => {
        messages = channelService.getMessages('chan-adv', 200);
      }).not.toThrow();
      expect(messages!.length).toBe(payloads.length);

      for (const m of messages!) {
        expect(Array.isArray(m.mentions)).toBe(true);
      }
      expect((Object.prototype as any).polluted).toBeUndefined();
    });
  });

  describe('AgentRepository: Adversarial Input Resilience', () => {
    it('getDefinition, getIdentity, getIdentityByName, listIdentitiesByProject, listSubordinates survive adversarial authority & capabilities', () => {
      const payloads = [
        ...ADVERSARIAL_PAYLOADS.prototypePollution,
        ...ADVERSARIAL_PAYLOADS.typeConfusion,
        ...ADVERSARIAL_PAYLOADS.corruptAndMalformed,
        ...ADVERSARIAL_PAYLOADS.hugeStrings,
      ];

      payloads.forEach((payload, idx) => {
        const defId = `def-adv-${idx}`;
        const identityId = `identity-adv-${idx}`;
        const name = `AdvAgent_${idx}`;

        db.execute(
          `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
           VALUES (?, ?, 'AdvRole', 'Prompt', 'ollama/llama3', ?, ?, 1000 + ?)`,
          defId,
          name,
          payload,
          payload,
          idx
        );

        db.execute(
          `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, parent_agent_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
           VALUES (?, 'ws-adv', 'proj-adv', ?, 'parent-agent', ?, 'ollama/llama3', 0, 0, 1000 + ?, 1000 + ?)`,
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
        expect(() => def!.capabilities.map((c) => c)).not.toThrow();

        // 2. getIdentity
        const identity = agentRepo.getIdentity(identityId);
        expect(identity).toBeDefined();
        if (identity!.capabilities) {
          expect(Array.isArray(identity!.capabilities)).toBe(true);
        }

        // 3. getIdentityByProjectAndName
        const identityByName = agentRepo.getIdentityByProjectAndName('proj-adv', name);
        expect(identityByName).toBeDefined();
        if (identityByName!.capabilities) {
          expect(Array.isArray(identityByName!.capabilities)).toBe(true);
        }

        expect((Object.prototype as any).polluted).toBeUndefined();
      });

      // 4. listIdentitiesByProject
      let identities: any[];
      expect(() => {
        identities = agentRepo.listIdentitiesByProject('proj-adv');
      }).not.toThrow();
      expect(identities!.length).toBe(1 + payloads.length);

      // 5. listSubordinates
      let subordinates: any[];
      expect(() => {
        subordinates = agentRepo.listSubordinates('parent-agent');
      }).not.toThrow();
      expect(subordinates!.length).toBe(payloads.length);

      for (const sub of subordinates!) {
        if (sub.capabilities) {
          expect(Array.isArray(sub.capabilities)).toBe(true);
          expect(() => sub.capabilities.map((c: string) => c)).not.toThrow();
        }
      }
      expect((Object.prototype as any).polluted).toBeUndefined();
    });
  });

  describe('Global Prototype Cleanliness Cross-Check', () => {
    it('guarantees zero prototype pollution across the entire runtime environment', () => {
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect((Object.prototype as any).isAdmin).toBeUndefined();
      expect(Object.prototype.hasOwnProperty('polluted')).toBe(false);
      expect(Object.prototype.hasOwnProperty('isAdmin')).toBe(false);
      expect(({} as any).polluted).toBeUndefined();
      expect(({} as any).isAdmin).toBeUndefined();
    });
  });
});
