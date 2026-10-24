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

describe('Layer 0 Storage Resilience: Defensive JSON Parsing & Fail-Open Integrity', () => {
  let db: KinDatabase;
  let tempDir: string;
  let tempDbPath: string;

  let workspaceRepo: WorkspaceRepository;
  let taskRepo: TaskRepository;
  let goalRepo: GoalRepository;
  let channelService: ChannelService;
  let agentRepo: AgentRepository;

  const CORRUPT_PAYLOADS = [
    '{invalid-json',
    '""',
    '',
    '   ',
    'null',
    '123',
    '[bad',
    '{"unclosed": "value"',
    'undefined',
    'NaN',
    'true',
  ];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-resilient-storage-test-'));
    tempDbPath = path.join(tempDir, 'resilient_storage.sqlite');

    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    workspaceRepo = new WorkspaceRepository(db);
    taskRepo = new TaskRepository(db);
    goalRepo = new GoalRepository(db);
    channelService = new ChannelService(db);
    agentRepo = new AgentRepository(db);

    // Bootstrap baseline workspace, project, goal, and channel to satisfy foreign keys
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-resilience', 'Resilience Workspace', '/workspace', 'AUTO', 1000, 1000)`
    );

    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES ('proj-resilience', 'ws-resilience', 'Resilience Project', '/workspace/proj', '{"theme":"dark"}', 1000, 1000)`
    );

    db.execute(
      `INSERT INTO channels (id, project_id, name, channel_type, is_private, created_at)
       VALUES ('chan-resilience', 'proj-resilience', 'general', 'channel', 0, 1000)`
    );

    db.execute(
      `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, deadline, check_in_policy, progress_summary, blocked_state, proposed_replanning_json, origin_channel_id, created_at, updated_at)
       VALUES ('goal-resilience', 'proj-resilience', 'Resilience Goal', 'Goal for testing', '["criterion 1"]', 'active', NULL, NULL, NULL, NULL, NULL, 'chan-resilience', 1000, 1000)`
    );
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore file unlock delays on Windows
    }
  });

  describe('Storage Helper Primitives (safeJsonParseObject, safeJsonParseArray, safeJsonParse)', () => {
    it('safeJsonParseObject returns fallback for corrupted and non-object inputs', () => {
      const fallback = { fallback: true };

      expect(safeJsonParseObject('{bad-json', fallback)).toEqual(fallback);
      expect(safeJsonParseObject('', fallback)).toEqual(fallback);
      expect(safeJsonParseObject('   ', fallback)).toEqual(fallback);
      expect(safeJsonParseObject('null', fallback)).toEqual(fallback);
      expect(safeJsonParseObject('123', fallback)).toEqual(fallback);
      expect(safeJsonParseObject('[1, 2, 3]', fallback)).toEqual(fallback);
      expect(safeJsonParseObject('"string"', fallback)).toEqual(fallback);
      expect(safeJsonParseObject(null, fallback)).toEqual(fallback);
      expect(safeJsonParseObject(undefined, fallback)).toEqual(fallback);
      expect(safeJsonParseObject(12345, fallback)).toEqual(fallback);
    });

    it('safeJsonParseObject parses valid JSON objects and passes through JS objects', () => {
      expect(safeJsonParseObject('{"theme":"light","retries":3}')).toEqual({
        theme: 'light',
        retries: 3,
      });
      expect(safeJsonParseObject({ already: 'object' })).toEqual({ already: 'object' });
    });

    it('safeJsonParseArray returns fallback for corrupted and non-array inputs', () => {
      const fallback = ['fallback-item'];

      expect(safeJsonParseArray('[bad-array', fallback)).toEqual(fallback);
      expect(safeJsonParseArray('', fallback)).toEqual(fallback);
      expect(safeJsonParseArray('   ', fallback)).toEqual(fallback);
      expect(safeJsonParseArray('null', fallback)).toEqual(fallback);
      expect(safeJsonParseArray('123', fallback)).toEqual(fallback);
      expect(safeJsonParseArray('{"key":"value"}', fallback)).toEqual(fallback);
      expect(safeJsonParseArray('"string"', fallback)).toEqual(fallback);
      expect(safeJsonParseArray(null, fallback)).toEqual(fallback);
      expect(safeJsonParseArray(undefined, fallback)).toEqual(fallback);
      expect(safeJsonParseArray(12345, fallback)).toEqual(fallback);
    });

    it('safeJsonParseArray parses valid JSON arrays and passes through JS arrays', () => {
      expect(safeJsonParseArray('["a", "b", "c"]')).toEqual(['a', 'b', 'c']);
      expect(safeJsonParseArray(['already', 'array'])).toEqual(['already', 'array']);
    });

    it('safeJsonParse handles generic types and fallback behavior', () => {
      expect(safeJsonParse('{bad', 'default-val')).toBe('default-val');
      expect(safeJsonParse('null', { fallback: true })).toEqual({ fallback: true });
      expect(safeJsonParse('{"ok":true}', { fallback: false })).toEqual({ ok: true });
    });
  });

  describe('WorkspaceRepository: projects.settings_json Resilience', () => {
    it('getProject fails open gracefully to {} on corrupt settings_json rows', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        const projectId = `proj-corrupt-${idx}`;
        db.execute(
          `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
           VALUES (?, 'ws-resilience', ?, '/workspace/corrupt', ?, 1000 + ?, 1000 + ?)`,
          projectId,
          `Corrupt Project ${idx}`,
          corruptVal,
          idx,
          idx
        );

        const project = workspaceRepo.getProject(projectId);
        expect(project).toBeDefined();
        expect(project!.id).toBe(projectId);
        expect(project!.settings).toEqual({});
        expect(typeof project!.settings).toBe('object');
        expect(Array.isArray(project!.settings)).toBe(false);
      });
    });

    it('listProjects survives multiple corrupt project rows and preserves valid project settings', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        db.execute(
          `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
           VALUES (?, 'ws-resilience', ?, '/workspace/corrupt', ?, 2000 + ?, 2000 + ?)`,
          `proj-batch-${idx}`,
          `Batch Project ${idx}`,
          corruptVal,
          idx,
          idx
        );
      });

      // Also add a healthy project with rich settings
      db.execute(
        `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
         VALUES ('proj-healthy', 'ws-resilience', 'Healthy Project', '/workspace/healthy', '{"autoMerge":true,"timeout":45}', 9999, 9999)`
      );

      let projects: any[];
      expect(() => {
        projects = workspaceRepo.listProjects('ws-resilience');
      }).not.toThrow();

      expect(projects!).toBeDefined();
      // Total projects = 1 (baseline) + CORRUPT_PAYLOADS.length + 1 (healthy)
      expect(projects!.length).toBe(1 + CORRUPT_PAYLOADS.length + 1);

      const healthy = projects!.find((p) => p.id === 'proj-healthy');
      expect(healthy).toBeDefined();
      expect(healthy.settings).toEqual({ autoMerge: true, timeout: 45 });

      // Every single project should have an object for settings
      for (const p of projects!) {
        expect(p.settings).toBeDefined();
        expect(typeof p.settings).toBe('object');
        expect(Array.isArray(p.settings)).toBe(false);
      }
    });
  });

  describe('TaskRepository: tasks.verification_spec_json Resilience', () => {
    it('getTask fails open gracefully to {} on corrupt verification_spec_json rows', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        const taskId = `task-corrupt-${idx}`;
        db.execute(
          `INSERT INTO tasks (id, goal_id, title, description, status, verification_spec_json, created_at, updated_at)
           VALUES (?, 'goal-resilience', ?, 'Task Desc', 'backlog', ?, 1000 + ?, 1000 + ?)`,
          taskId,
          `Corrupt Task ${idx}`,
          corruptVal,
          idx,
          idx
        );

        const task = taskRepo.getTask(taskId);
        expect(task).toBeDefined();
        expect(task!.id).toBe(taskId);
        expect(task!.verificationSpec).toEqual({});
        expect(typeof task!.verificationSpec).toBe('object');
        expect(Array.isArray(task!.verificationSpec)).toBe(false);
      });
    });

    it('listTasksByGoal and listTasksByProject survive corrupt rows without throwing', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        db.execute(
          `INSERT INTO tasks (id, goal_id, title, description, status, verification_spec_json, created_at, updated_at)
           VALUES (?, 'goal-resilience', ?, 'Task Desc', 'ready', ?, 2000 + ?, 2000 + ?)`,
          `task-batch-${idx}`,
          `Task Batch ${idx}`,
          corruptVal,
          idx,
          idx
        );
      });

      // Healthy task with valid verification spec
      db.execute(
        `INSERT INTO tasks (id, goal_id, title, description, status, verification_spec_json, created_at, updated_at)
         VALUES ('task-healthy', 'goal-resilience', 'Healthy Task', 'Task Desc', 'running', '{"command":"npm test","timeoutMs":5000}', 9999, 9999)`
      );

      let byGoal: any[];
      expect(() => {
        byGoal = taskRepo.listTasksByGoal('goal-resilience');
      }).not.toThrow();
      expect(byGoal!.length).toBe(CORRUPT_PAYLOADS.length + 1);

      let byProject: any[];
      expect(() => {
        byProject = taskRepo.listTasksByProject('proj-resilience');
      }).not.toThrow();
      expect(byProject!.length).toBe(CORRUPT_PAYLOADS.length + 1);

      const healthy = byGoal!.find((t) => t.id === 'task-healthy');
      expect(healthy.verificationSpec).toEqual({ command: 'npm test', timeoutMs: 5000 });

      for (const t of byGoal!) {
        expect(t.verificationSpec).toBeDefined();
        expect(typeof t.verificationSpec).toBe('object');
        expect(Array.isArray(t.verificationSpec)).toBe(false);
      }
    });
  });

  describe('TaskRepository: decisions.alternatives_considered_json Resilience', () => {
    it('getDecision fails open gracefully to [] on corrupt alternatives_considered_json rows', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        const decisionId = `dec-corrupt-${idx}`;
        db.execute(
          `INSERT INTO decisions (id, project_id, decided_by_id, title, rationale, alternatives_considered_json, status, created_at)
           VALUES (?, 'proj-resilience', 'agent-tester', ?, 'Rationale', ?, 'proposed', 1000 + ?)`,
          decisionId,
          `Decision ${idx}`,
          corruptVal,
          idx
        );

        const decision = taskRepo.getDecision(decisionId);
        expect(decision).toBeDefined();
        expect(decision!.id).toBe(decisionId);
        expect(decision!.alternativesConsidered).toEqual([]);
        expect(Array.isArray(decision!.alternativesConsidered)).toBe(true);
        expect(() => decision!.alternativesConsidered.map((a) => a.toUpperCase())).not.toThrow();
      });
    });

    it('listDecisionsByProject and listAllDecisions survive corrupt rows without throwing', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        db.execute(
          `INSERT INTO decisions (id, project_id, decided_by_id, title, rationale, alternatives_considered_json, status, created_at)
           VALUES (?, 'proj-resilience', 'agent-tester', ?, 'Rationale', ?, 'authoritative', 2000 + ?)`,
          `dec-batch-${idx}`,
          `Batch Decision ${idx}`,
          corruptVal,
          idx
        );
      });

      // Healthy decision with valid alternatives array
      db.execute(
        `INSERT INTO decisions (id, project_id, decided_by_id, title, rationale, alternatives_considered_json, status, created_at)
         VALUES ('dec-healthy', 'proj-resilience', 'agent-tester', 'Healthy Decision', 'Sound Rationale', '["Alt A","Alt B"]', 'authoritative', 9999)`
      );

      let byProject: any[];
      expect(() => {
        byProject = taskRepo.listDecisionsByProject('proj-resilience');
      }).not.toThrow();
      expect(byProject!.length).toBe(CORRUPT_PAYLOADS.length + 1);

      let allDecisions: any[];
      expect(() => {
        allDecisions = taskRepo.listAllDecisions();
      }).not.toThrow();
      expect(allDecisions!.length).toBe(CORRUPT_PAYLOADS.length + 1);

      const healthy = byProject!.find((d) => d.id === 'dec-healthy');
      expect(healthy.alternativesConsidered).toEqual(['Alt A', 'Alt B']);

      for (const d of allDecisions!) {
        expect(Array.isArray(d.alternativesConsidered)).toBe(true);
        expect(() => d.alternativesConsidered.includes('test')).not.toThrow();
      }
    });
  });

  describe('GoalRepository: goals.acceptance_criteria_json Resilience', () => {
    it('getGoal fails open gracefully without throwing on corrupt acceptance_criteria_json and proposed_replanning_json', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        const goalId = `goal-corrupt-${idx}`;
        db.execute(
          `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, deadline, check_in_policy, progress_summary, blocked_state, proposed_replanning_json, origin_channel_id, created_at, updated_at)
           VALUES (?, 'proj-resilience', ?, 'Goal Description', ?, 'active', NULL, NULL, NULL, NULL, ?, 'chan-resilience', 1000 + ?, 1000 + ?)`,
          goalId,
          `Goal ${idx}`,
          corruptVal,
          corruptVal,
          idx,
          idx
        );

        const goal = goalRepo.getGoal(goalId);
        expect(goal).toBeDefined();
        expect(goal!.id).toBe(goalId);
        expect(goal!.acceptanceCriteria).toEqual([]);
        expect(Array.isArray(goal!.acceptanceCriteria)).toBe(true);
        expect(() => goal!.acceptanceCriteria.includes('crit')).not.toThrow();
      });
    });

    it('listGoals and listGoalsByOriginChannel survive corrupt rows without throwing', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        db.execute(
          `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, deadline, check_in_policy, progress_summary, blocked_state, proposed_replanning_json, origin_channel_id, created_at, updated_at)
           VALUES (?, 'proj-resilience', ?, 'Goal Description', ?, 'active', NULL, NULL, NULL, NULL, ?, 'chan-resilience', 2000 + ?, 2000 + ?)`,
          `goal-batch-${idx}`,
          `Batch Goal ${idx}`,
          corruptVal,
          corruptVal,
          idx,
          idx
        );
      });

      // Healthy goal with valid criteria array and replanning object
      db.execute(
        `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, deadline, check_in_policy, progress_summary, blocked_state, proposed_replanning_json, origin_channel_id, created_at, updated_at)
         VALUES ('goal-healthy', 'proj-resilience', 'Healthy Goal', 'Goal Description', '["Must pass CI","Zero leaks"]', 'completed', NULL, NULL, NULL, NULL, '{"reason":"pivot"}', 'chan-resilience', 9999, 9999)`
      );

      let goals: any[];
      expect(() => {
        goals = goalRepo.listGoals('proj-resilience', false);
      }).not.toThrow();
      // Total goals = 1 (baseline) + CORRUPT_PAYLOADS.length + 1 (healthy)
      expect(goals!.length).toBe(1 + CORRUPT_PAYLOADS.length + 1);

      let channelGoals: any[];
      expect(() => {
        channelGoals = goalRepo.listGoalsByOriginChannel('chan-resilience');
      }).not.toThrow();
      expect(channelGoals!.length).toBe(1 + CORRUPT_PAYLOADS.length + 1);

      const healthy = goals!.find((g) => g.id === 'goal-healthy');
      expect(healthy.acceptanceCriteria).toEqual(['Must pass CI', 'Zero leaks']);
      expect(healthy.proposedReplanning).toEqual({ reason: 'pivot' });

      for (const g of goals!) {
        expect(Array.isArray(g.acceptanceCriteria)).toBe(true);
        expect(() => g.acceptanceCriteria.map((c: string) => c)).not.toThrow();
      }
    });
  });

  describe('ChannelService: messages.mentions_json Resilience', () => {
    it('getMessage fails open gracefully to [] on corrupt mentions_json rows', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        const msgId = `msg-corrupt-${idx}`;
        db.execute(
          `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, mentions_json, productivity_score, created_at)
           VALUES (?, 'chan-resilience', 'user-test', 'human', 'Test message content', ?, 0, 1000 + ?)`,
          msgId,
          corruptVal,
          idx
        );

        const msg = channelService.getMessage(msgId);
        expect(msg).toBeDefined();
        expect(msg!.id).toBe(msgId);
        expect(msg!.mentions).toEqual([]);
        expect(Array.isArray(msg!.mentions)).toBe(true);
        expect(() => msg!.mentions.includes('@Boss')).not.toThrow();
      });
    });

    it('getMessages survives corrupt mentions_json rows and correctly maps healthy mentions', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        db.execute(
          `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, mentions_json, productivity_score, created_at)
           VALUES (?, 'chan-resilience', 'user-test', 'human', 'Burst message content', ?, 0, 2000 + ?)`,
          `msg-batch-${idx}`,
          corruptVal,
          idx
        );
      });

      // Healthy message with valid mentions
      db.execute(
        `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, mentions_json, productivity_score, created_at)
         VALUES ('msg-healthy', 'chan-resilience', 'user-test', 'human', 'Healthy message', '["@Boss","@Architect"]', 10, 9999)`
      );

      let messages: any[];
      expect(() => {
        messages = channelService.getMessages('chan-resilience', 100);
      }).not.toThrow();

      expect(messages!.length).toBe(CORRUPT_PAYLOADS.length + 1);

      const healthy = messages!.find((m) => m.id === 'msg-healthy');
      expect(healthy.mentions).toEqual(['@Boss', '@Architect']);

      for (const m of messages!) {
        expect(Array.isArray(m.mentions)).toBe(true);
        expect(() => m.mentions.map((mention: string) => mention.toLowerCase())).not.toThrow();
      }
    });
  });

  describe('AgentRepository: agent_definitions.domain_authority_json and capabilities_json Resilience', () => {
    it('getDefinition returns arrays for domainAuthority and capabilities on corrupt rows without throwing TypeError', () => {
      CORRUPT_PAYLOADS.forEach((corruptVal, idx) => {
        const defId = `def-corrupt-${idx}`;
        db.execute(
          `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
           VALUES (?, ?, 'Engineer', 'Prompt', 'ollama/llama3', ?, ?, 1000 + ?)`,
          defId,
          `Corrupt Agent Def ${idx}`,
          corruptVal,
          corruptVal,
          idx
        );

        const def = agentRepo.getDefinition(defId);
        expect(def).toBeDefined();
        expect(def!.id).toBe(defId);

        // Verify domainAuthority is a genuine Array
        expect(Array.isArray(def!.domainAuthority)).toBe(true);
        expect(def!.domainAuthority).toEqual([]);
        expect(() => def!.domainAuthority.includes('Architecture')).not.toThrow();
        expect(() => def!.domainAuthority.map((d) => d.toLowerCase())).not.toThrow();

        // Verify capabilities is a genuine Array
        expect(Array.isArray(def!.capabilities)).toBe(true);
        expect(def!.capabilities).toEqual([]);
        expect(() => def!.capabilities.includes('shell')).not.toThrow();
        expect(() => def!.capabilities.map((c) => c.toUpperCase())).not.toThrow();
      });
    });

    it('preserves valid domainAuthority and capabilities on healthy definitions', () => {
      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
         VALUES ('def-healthy', 'Healthy Architect', 'Architect', 'Prompt', 'ollama/qwen', '["Architecture","Security"]', '["read","write","shell"]', 5000)`
      );

      const def = agentRepo.getDefinition('def-healthy');
      expect(def).toBeDefined();
      expect(def!.domainAuthority).toEqual(['Architecture', 'Security']);
      expect(def!.capabilities).toEqual(['read', 'write', 'shell']);
      expect(def!.domainAuthority.includes('Architecture')).toBe(true);
      expect(def!.capabilities.includes('shell')).toBe(true);
    });

    it('getIdentity and listIdentitiesByProject handle joined corrupt def_capabilities_json without TypeError', () => {
      // Seed a definition with corrupt capabilities
      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
         VALUES ('def-joined-corrupt', 'Worker', 'Worker', 'Prompt', 'ollama/llama3', '{invalid', '[bad', 6000)`
      );

      // Seed an identity referencing that definition
      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
         VALUES ('agent-corrupt-identity', 'ws-resilience', 'proj-resilience', 'def-joined-corrupt', 'CorruptWorker', 'ollama/llama3', 0, 0, 6000, 6000)`
      );

      const identity = agentRepo.getIdentity('agent-corrupt-identity');
      expect(identity).toBeDefined();
      expect(identity!.displayName).toBe('CorruptWorker');

      const projectIdentities = agentRepo.listIdentitiesByProject('proj-resilience');
      const found = projectIdentities.find((i) => i.id === 'agent-corrupt-identity');
      expect(found).toBeDefined();
    });
  });
});
