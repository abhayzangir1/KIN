import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { CoreServer } from '../src/server/core_server.js';
import { DEFAULT_FALLBACK_MODEL_ID } from '../src/domain/agent_repository.js';
import { safeJsonParseArray } from '../src/storage/db.js';

describe('Milestone 16: Core Subsystems, Multi-Project Isolation & Robustness (Features 85–93)', () => {
  let tempDir: string;
  let testDbPath: string;
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-m16-test-'));
    testDbPath = path.join(tempDir, 'test_m16.sqlite');

    server = new CoreServer({ port: 0, dbPath: testDbPath });
    port = await server.start();
  });

  afterAll(async () => {
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // Feature 85: Unify Model Fallbacks
  // --------------------------------------------------------------------------
  describe('Feature 85: Unify Model Fallbacks', () => {
    it('seeds @Boss and @DocWriter with DEFAULT_FALLBACK_MODEL_ID when no active model is configured', () => {
      const bossDef = server.agentRepo.getDefinition('def-boss');
      const bossIdentity = server.agentRepo.getIdentity('agent-boss');
      expect(bossDef?.defaultModelId).toBe(DEFAULT_FALLBACK_MODEL_ID);
      expect(bossIdentity?.activeModelId).toBe(DEFAULT_FALLBACK_MODEL_ID);
    });

    it('verifies absence of hardcoded raw string "ollama/qwen2.5-coder:3b" across server files', () => {
      const coreServerPath = path.resolve(__dirname, '../src/server/core_server.ts');
      const workspaceControllerPath = path.resolve(__dirname, '../src/server/controllers/workspace_controller.ts');

      const coreServerContent = fs.readFileSync(coreServerPath, 'utf-8');
      const workspaceControllerContent = fs.readFileSync(workspaceControllerPath, 'utf-8');

      expect(coreServerContent).not.toContain("'ollama/qwen2.5-coder:3b'");
      expect(coreServerContent).not.toContain('"ollama/qwen2.5-coder:3b"');
      expect(workspaceControllerContent).not.toContain("'ollama/qwen2.5-coder:3b'");
      expect(workspaceControllerContent).not.toContain('"ollama/qwen2.5-coder:3b"');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 86: Eliminate Synthetic Rubric Mock Scores
  // --------------------------------------------------------------------------
  describe('Feature 86: Eliminate Synthetic Rubric Mock Scores in Evaluations API', () => {
    it('returns authentic evaluation scores derived from r.score when rubric_metrics_json is empty or invalid', async () => {
      const evalId = `eval-test-${Date.now()}`;
      const agentId = 'agent-boss';
      const genuineScore = 65;

      server.db.execute(
        `INSERT INTO agent_evaluations (id, agent_id, test_suite_name, score, passed, rubric_metrics_json, test_cases_run, test_cases_passed, test_cases_json, created_at)
         VALUES (?, ?, 'Unit Benchmark', ?, 0, '{}', 10, 6, '[]', ?)`,
        evalId,
        agentId,
        genuineScore,
        Date.now()
      );

      const res = await fetch(`http://127.0.0.1:${port}/api/agents/${agentId}/evaluations`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.evaluations).toBeDefined();

      const targetEval = data.evaluations.find((e: any) => e.id === evalId);
      expect(targetEval).toBeDefined();
      expect(targetEval.score).toBe(genuineScore);

      // Must NOT be the old synthetic mock grades: { accuracy: 90, reasoning: 90, toolCompetence: 90, safetyAdherence: 95, overall: 91 }
      expect(targetEval.rubricScores.accuracy).toBe(genuineScore);
      expect(targetEval.rubricScores.reasoning).toBe(genuineScore);
      expect(targetEval.rubricScores.toolCompetence).toBe(genuineScore);
      expect(targetEval.rubricScores.overall).toBe(genuineScore);
      expect(targetEval.rubricScores.overall).not.toBe(91);
    });

    it('preserves genuine persisted rubric scores when rubric_metrics_json is valid', async () => {
      const evalId = `eval-valid-${Date.now()}`;
      const agentId = 'agent-boss';
      const persistedRubric = {
        accuracy: 85,
        reasoning: 75,
        toolCompetence: 92,
        safetyAdherence: 100,
        overall: 88,
      };

      server.db.execute(
        `INSERT INTO agent_evaluations (id, agent_id, test_suite_name, score, passed, rubric_metrics_json, test_cases_run, test_cases_passed, test_cases_json, created_at)
         VALUES (?, ?, 'Genuine Rubric Suite', 88, 1, ?, 10, 9, '[]', ?)`,
        evalId,
        agentId,
        JSON.stringify(persistedRubric),
        Date.now()
      );

      const res = await fetch(`http://127.0.0.1:${port}/api/agents/${agentId}/evaluations`);
      expect(res.status).toBe(200);
      const data = await res.json();

      const targetEval = data.evaluations.find((e: any) => e.id === evalId);
      expect(targetEval).toBeDefined();
      expect(targetEval.rubricScores).toEqual(persistedRubric);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 87: Remove Orphaned Dead Code computeProductivityScore
  // --------------------------------------------------------------------------
  describe('Feature 87: Remove Orphaned Dead Code computeProductivityScore', () => {
    it('confirms computeProductivityScore is removed from CoreServer and BaseController', () => {
      expect((server as any).computeProductivityScore).toBeUndefined();

      const coreServerPath = path.resolve(__dirname, '../src/server/core_server.ts');
      const baseControllerPath = path.resolve(__dirname, '../src/server/controllers/base_controller.ts');

      const coreServerContent = fs.readFileSync(coreServerPath, 'utf-8');
      const baseControllerContent = fs.readFileSync(baseControllerPath, 'utf-8');

      expect(coreServerContent).not.toContain('computeProductivityScore');
      expect(baseControllerContent).not.toContain('computeProductivityScore');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 88: Fix Cross-Project DAG Task Promotion Project Leak
  // --------------------------------------------------------------------------
  describe('Feature 88: Fix Cross-Project DAG Task Promotion Project Leak', () => {
    it('promotes dependent tasks preserving parent goal projectId and origin channel', async () => {
      const now = Date.now();
      const projSecId = `proj-sec-${now}`;
      const chanSecId = `chan-sec-${now}`;

      // Create secondary project and dedicated channel
      server.workspaceRepo.createProject({
        id: projSecId,
        workspaceId: 'ws-default',
        name: 'Secondary Isolated Project',
        description: 'Test project for DAG isolation',
        repoPath: tempDir,
        isDefault: false,
        createdAt: now,
      });

      server.workspaceRepo.createChannel({
        id: chanSecId,
        projectId: projSecId,
        name: 'secondary-ops',
        isDefault: false,
        createdAt: now,
      });

      // Create parent goal with origin channel
      const goalId = `goal-sec-${now}`;
      server.goalRepo.createGoal({
        id: goalId,
        projectId: projSecId,
        originChannelId: chanSecId,
        title: 'Secondary Project Goal',
        description: 'Isolated DAG goal',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      // Create Task 1 and Task 2 with dependency: Task 2 depends on Task 1
      const task1Id = `task-dag-1-${now}`;
      const task2Id = `task-dag-2-${now}`;

      server.taskRepo.createTask({
        id: task1Id,
        goalId,
        title: 'Task 1: Upstream Step',
        description: 'First step in pipeline',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      server.taskRepo.createTask(
        {
          id: task2Id,
          goalId,
          title: 'Task 2: Downstream Dependent',
          description: 'Second step waiting for task 1',
          status: 'backlog',
          dependsOnTaskIds: [task1Id],
          createdAt: now,
          updatedAt: now,
        },
        [task1Id]
      );

      // Ensure active project on server is different (e.g. 'proj-kin')
      (server as any).activeProjectId = 'proj-kin';

      // Complete Task 1 via PATCH /api/tasks/:id/status with operator signature
      const ipcToken = (server as any).ipcAuthToken;
      const operatorSig = crypto.createHmac('sha256', ipcToken).update(`${task1Id}:completed`).digest('hex');
      const completeRes = await fetch(`http://127.0.0.1:${port}/api/tasks/${task1Id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ipcToken}`,
          'x-kin-operator-signature': operatorSig,
        },
        body: JSON.stringify({ status: 'completed', signoffNotes: 'Task 1 completed by operator' }),
      });

      expect(completeRes.status).toBe(200);
      const completeData = await completeRes.json();
      expect(completeData.promotedTaskIds).toContain(task2Id);

      // Verify Task 2 is now promoted (ready or running via automated dispatch)
      const task2 = server.taskRepo.getTask(task2Id);
      expect(['ready', 'running']).toContain(task2?.status);

      // Verify the task's parent goal retains true project and channel
      const parentGoal = task2?.goalId ? server.goalRepo.getGoal(task2.goalId) : undefined;
      expect(parentGoal?.projectId).toBe(projSecId);
      expect(parentGoal?.originChannelId).toBe(chanSecId);

      // Ensure project boss for secondary project was created
      const secBoss = server.agentRepo.getIdentityByProjectAndName(projSecId, 'Boss');
      expect(secBoss).toBeDefined();
      expect(secBoss?.projectId).toBe(projSecId);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 89: Fix Cross-Project Channel Leak in Routines & Schedules
  // --------------------------------------------------------------------------
  describe('Feature 89: Fix Cross-Project Channel Leak in Routines & Schedules', () => {
    it('resolves primary channel dynamically for secondary projects', () => {
      const now = Date.now();
      const projId = `proj-sched-${now}`;
      const chanId = `chan-primary-${now}`;

      server.workspaceRepo.createProject({
        id: projId,
        workspaceId: 'ws-default',
        name: 'Sched Project',
        description: 'Project without chan-general',
        repoPath: tempDir,
        isDefault: false,
        createdAt: now,
      });

      server.workspaceRepo.createChannel({
        id: chanId,
        projectId: projId,
        name: 'general',
        isDefault: true,
        createdAt: now,
      });

      const resolved = server.resolveDefaultChannelForProject(projId);
      expect(resolved).toBe(chanId);
      expect(resolved).not.toBe('chan-general');
    });

    it('creates schedule defaulting to project channel instead of chan-general', async () => {
      const now = Date.now();
      const projId = `proj-routine-${now}`;
      const chanId = `chan-routine-primary-${now}`;

      server.workspaceRepo.createProject({
        id: projId,
        workspaceId: 'ws-default',
        name: 'Routine Project',
        repoPath: tempDir,
        isDefault: false,
        createdAt: now,
      });

      server.workspaceRepo.createChannel({
        id: chanId,
        projectId: projId,
        name: 'general',
        isDefault: true,
        createdAt: now,
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projId,
          type: 'cron',
          cronExpression: '*/10 * * * *',
          prompt: 'Isolated periodic check',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.schedule).toBeDefined();
      expect(data.schedule.projectId).toBe(projId);
      expect(data.schedule.channelId).toBe(chanId);
      expect(data.schedule.channelId).not.toBe('chan-general');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 90: Add Diagnostic Logging on Credential Decryption/DB Failure
  // --------------------------------------------------------------------------
  describe('Feature 90: Add Diagnostic Logging on Credential Decryption/DB Failure', () => {
    it('logs console.error when credential retrieval fails unexpectedly', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate invocation with corrupt/broken query table
      const originalQuery = server.db.query.bind(server.db);
      try {
        server.db.query = (() => {
          throw new Error('Simulated SQLite DB failure');
        }) as any;

        // Trigger credential lookup via modelGateway callback
        const credResolver = (server as any).modelGateway.config?.getCredentials;
        if (credResolver) {
          const creds = credResolver('openai');
          expect(creds).toEqual([]);
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('[CoreServer] Failed to load credentials from vault/DB:'),
            expect.any(Error)
          );
        }
      } finally {
        server.db.query = originalQuery;
        errorSpy.mockRestore();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 91: Fix Unsafe JSON.parse in SkillEngine
  // --------------------------------------------------------------------------
  describe('Feature 91: Fix Unsafe JSON.parse in SkillEngine', () => {
    it('safely handles corrupted trigger_patterns_json without throwing SyntaxError', () => {
      const skillId = `skill-corrupted-${Date.now()}`;
      server.db.execute(
        `INSERT INTO skills (id, name, version, description, instructions, trigger_patterns_json, parameters_json, status, created_at, updated_at)
         VALUES (?, 'CorruptPatternSkill', '1.0.0', 'Test malformed JSON', 'Instructions', '{bad_json_not_array}', '{}', 'active', ?, ?)`,
        skillId,
        Date.now(),
        Date.now()
      );

      // Retrieving the skill must not crash
      expect(() => {
        const skill = server.skillEngine.getSkill(skillId);
        expect(skill).toBeDefined();
        expect(Array.isArray(skill?.triggerPatterns)).toBe(true);
        expect(skill?.triggerPatterns.length).toBe(0);
      }).not.toThrow();
    });

    it('verifies safeJsonParseArray utility handles diverse malformed inputs', () => {
      expect(safeJsonParseArray(undefined, ['default'])).toEqual(['default']);
      expect(safeJsonParseArray('not a json', ['default'])).toEqual(['default']);
      expect(safeJsonParseArray('{"key": "value"}', ['default'])).toEqual(['default']);
      expect(safeJsonParseArray('["valid", "pattern"]', [])).toEqual(['valid', 'pattern']);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 92 & 93: Structured Warning Logs for Startup Queue & WebSearch Error
  // --------------------------------------------------------------------------
  describe('Feature 92 & 93: Startup Queue Notice & WebSearch Fallback Logging', () => {
    it('verifies source code includes warning/debug logging for startup queue and webSearch fallback', () => {
      const coreServerPath = path.resolve(__dirname, '../src/server/core_server.ts');
      const toolGatewayPath = path.resolve(__dirname, '../src/execution/tool_gateway.ts');

      const coreServerContent = fs.readFileSync(coreServerPath, 'utf-8');
      const toolGatewayContent = fs.readFileSync(toolGatewayPath, 'utf-8');

      // Feature 92
      expect(coreServerContent).toContain("[CoreServer] Failed to process queued message on startup:");
      expect(coreServerContent).not.toMatch(/this\.processNextQueuedMessage\(row\.channel_id\)\.catch\(\(\)\s*=>\s*\{\}\)/);

      // Feature 93
      expect(toolGatewayContent).toContain("[ToolGateway] HTML parsing error in webSearch fallback:");
    });
  });
});
