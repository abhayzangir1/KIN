import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { Sentinel } from '../src/security/sentinel.js';
import { SecretBroker } from '../src/security/secret_broker.js';
import { McpClientManager } from '../src/execution/mcp_client.js';
import { BrowserController } from '../src/browser/browser_controller.js';
import { GoalRepository } from '../src/domain/goal_repository.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('KIN Convergence & Hardening Verification Suite', () => {
  let db: KinDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `kin_convergence_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.sqlite`);
    db = new KinDatabase(dbPath);
    const migrator = new MigrationRunner(db);
    migrator.runMigrations();
  });

  afterEach(() => {
    if (db && !db.closed) {
      db.close();
    }
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    } catch {}
  });

  it('1. McpClientManager.sanitizeMcpEnv strips host credentials and preserves safe variables', () => {
    process.env.OPENAI_API_KEY = 'sk-test-secret-key-12345';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-99999';
    process.env.KIN_MASTER_KEY = 'kin-internal-vault-key';

    const sanitized = McpClientManager.sanitizeMcpEnv({
      CUSTOM_PORT: '8080',
      EXPLICIT_KEY: 'allowed-explicit-val',
    });

    expect(sanitized.CUSTOM_PORT).toBe('8080');
    expect(sanitized.EXPLICIT_KEY).toBe('allowed-explicit-val');
    expect(sanitized.OPENAI_API_KEY).toBeUndefined();
    expect(sanitized.ANTHROPIC_API_KEY).toBeUndefined();
    expect(sanitized.KIN_MASTER_KEY).toBeUndefined();
    expect(sanitized.PATH || sanitized.Path || sanitized.path).toBeDefined();

    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.KIN_MASTER_KEY;
  });

  it('2. BrowserController blocks file: and data: schemes without explicit permission', async () => {
    const bc = new BrowserController();
    await expect(bc.navigate('file:///etc/passwd')).rejects.toThrow(/ACCESS_DENIED: Scheme navigation to 'file:' is prohibited/);
    await expect(bc.navigate('data:text/html,<h1>Hello</h1>')).rejects.toThrow(/ACCESS_DENIED: Scheme navigation to 'data:' is prohibited/);
  });

  it('3. ToolGateway sanitizes secrets in action_records params_json', async () => {
    const tg = new ToolGateway({ db });
    const context = {
      runId: 'run-test-sanitize',
      agentId: 'agent-boss',
      projectId: 'proj-test',
      channelId: 'chan-1',
      allowedCapabilities: ['*'],
    };

    // Invoke tool with sensitive parameters
    await tg.executeTool('readFile', { path: 'README.md', apiKey: 'sk-proj-super-secret-password-123', password: 'my-db-password' }, context);

    const record = db.queryOne<{ params_json: string }>(
      'SELECT params_json FROM action_records WHERE run_id = ? ORDER BY created_at DESC LIMIT 1',
      'run-test-sanitize'
    );

    expect(record).toBeDefined();
    expect(record!.params_json).not.toContain('sk-proj-super-secret-password-123');
    expect(record!.params_json).not.toContain('my-db-password');
    expect(record!.params_json).toContain('[REDACTED]');
  });

  it('4. Sentinel enforces Hierarchical Attenuation (specialists denied, @Boss permitted)', () => {
    const sentinel = Sentinel.getInstance();

    // Specialist without shell or web permissions attempts executeShell
    const specialistDenied = sentinel.evaluate({
      agentId: 'agent-writer',
      agentCapabilities: ['fs:read', 'fs:write'],
      toolName: 'executeShell',
      params: { command: 'dir' },
    });
    expect(specialistDenied.allowed).toBe(false);
    expect(specialistDenied.reason).toContain('SECURITY DENIAL: FORBIDDEN');

    // Specialist with web capability attempts browserNavigate
    const specialistAllowed = sentinel.evaluate({
      agentId: 'agent-researcher',
      agentCapabilities: ['web:browse'],
      toolName: 'browserNavigate',
      params: { url: 'https://example.com' },
    });
    expect(specialistAllowed.allowed).toBe(true);

    // Lead Orchestrator (@Boss) with full authority (*) is permitted
    const bossAllowed = sentinel.evaluate({
      agentId: 'agent-boss',
      agentCapabilities: ['*'],
      toolName: 'executeShell',
      params: { command: 'git status' },
    });
    expect(bossAllowed.allowed).toBe(true);
  });

  it('5. GoalRepository and TaskRepository persist and retrieve enriched goal lifecycle fields', () => {
    const goalRepo = new GoalRepository(db);
    const taskRepo = new TaskRepository(db);
    const now = Date.now();

    // Insert required foreign key parents: workspace and project
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, ?, ?, 'ALWAYS_ASK', ?, ?)`,
      'ws-test',
      'Test Workspace',
      '/tmp/test',
      now,
      now
    );
    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{}', ?, ?)`,
      'proj-test',
      'ws-test',
      'Test Project',
      '/tmp/test',
      now,
      now
    );

    const goal = {
      id: 'goal-enriched-1',
      projectId: 'proj-test',
      title: 'Enriched Strategic Goal',
      description: 'Test deadline and interactive replanning fields',
      acceptanceCriteria: ['Pass test suite', 'Verify boundary elevation'],
      status: 'active' as const,
      deadline: now + 7200000,
      checkInPolicy: 'daily_7pm',
      progressSummary: '3 of 5 milestone tasks ready',
      blockedState: 'Waiting for operator approval',
      proposedReplanning: {
        adjustedMilestones: ['Phase 1', 'Phase 2 Updated'],
        rationale: 'API rate limits required architecture shift',
      },
      originChannelId: 'chan-dm-worker',
      createdAt: now,
      updatedAt: now,
    };

    goalRepo.createGoal(goal);

    const fetchedFromGoalRepo = goalRepo.getGoal('goal-enriched-1');
    expect(fetchedFromGoalRepo).toBeDefined();
    expect(fetchedFromGoalRepo?.deadline).toBe(now + 7200000);
    expect(fetchedFromGoalRepo?.checkInPolicy).toBe('daily_7pm');
    expect(fetchedFromGoalRepo?.progressSummary).toBe('3 of 5 milestone tasks ready');
    expect(fetchedFromGoalRepo?.blockedState).toBe('Waiting for operator approval');
    expect(fetchedFromGoalRepo?.proposedReplanning?.rationale).toBe('API rate limits required architecture shift');
    expect(fetchedFromGoalRepo?.originChannelId).toBe('chan-dm-worker');

    // Verify TaskRepository retrieves identical enriched fields
    const fetchedFromTaskRepo = taskRepo.getGoal('goal-enriched-1');
    expect(fetchedFromTaskRepo).toBeDefined();
    expect(fetchedFromTaskRepo?.deadline).toBe(now + 7200000);
    expect(fetchedFromTaskRepo?.proposedReplanning?.adjustedMilestones).toEqual(['Phase 1', 'Phase 2 Updated']);
  });

  it('6. SkillEngine candidate skill loop enforces threshold (strategies >= 1 || count >= 2)', () => {
    const skillEngine = new SkillEngine(db, { repoRoot: os.tmpdir() });
    const now = Date.now();

    // Insert parent workspace, project, definition, identity, and run
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, ?, ?, 'ALWAYS_ASK', ?, ?)`,
      'ws-skill',
      'Skill Workspace',
      '/tmp/skill',
      now,
      now
    );
    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{}', ?, ?)`,
      'proj-skill',
      'ws-skill',
      'Skill Project',
      '/tmp/skill',
      now,
      now
    );
    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
       VALUES (?, ?, ?, ?, ?, '[]', '[]', ?)`,
      'def-skill',
      'SkillWorker',
      'Worker',
      'Prompt',
      'model-1',
      now
    );
    db.execute(
      `INSERT INTO agent_identities (id, workspace_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      'agent-skill',
      'ws-skill',
      'def-skill',
      'SkillAgent',
      'model-1',
      now,
      now
    );
    db.execute(
      `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
       VALUES (?, ?, ?, 'completed', ?, 10000, 100, ?)`,
      'run-skill-1',
      'agent-skill',
      'proj-skill',
      now,
      now
    );
    db.execute(
      `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, allocated_tokens, used_tokens, created_at)
       VALUES (?, ?, ?, 'completed', ?, 10000, 100, ?)`,
      'run-skill-2',
      'agent-skill',
      'proj-skill',
      now,
      now
    );

    // 1 single failure with no repair strategy should NOT create candidate skill
    db.execute(
      `INSERT INTO skill_experiences (id, run_id, objective, outcome, failure_reason, repair_strategy, created_at)
       VALUES (?, ?, 'Test network failure', 'failure', ?, ?, ?)`,
      'exp-1',
      'run-skill-1',
      'Execution timeout connecting to server',
      null,
      now
    );

    const res1 = skillEngine.harvestCandidateLessons();
    expect(res1.createdCount).toBe(0);

    // 2 failures in same cluster SHOULD create candidate skill
    db.execute(
      `INSERT INTO skill_experiences (id, run_id, objective, outcome, failure_reason, repair_strategy, created_at)
       VALUES (?, ?, 'Second timeout error', 'failure', ?, ?, ?)`,
      'exp-2',
      'run-skill-2',
      'Connection timeout on port 8000',
      null,
      now
    );

    const res2 = skillEngine.harvestCandidateLessons();
    expect(res2.createdCount).toBeGreaterThanOrEqual(1);
  });

  it('7. ToolGateway registers proposePlanAdjustment and updates goal proposed_replanning_json', async () => {
    const tg = new ToolGateway({ db });
    const schemas = tg.getToolSchemas();
    const planSchema = schemas.find((s) => s.name === 'proposePlanAdjustment');
    expect(planSchema).toBeDefined();
    expect(planSchema?.parameters.properties.goalId).toBeDefined();

    const now = Date.now();
    // Insert parent workspace, project, and goal
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, ?, ?, 'ALWAYS_ASK', ?, ?)`,
      'ws-plan',
      'Plan Workspace',
      '/tmp/plan',
      now,
      now
    );
    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{}', ?, ?)`,
      'proj-plan',
      'ws-plan',
      'Plan Project',
      '/tmp/plan',
      now,
      now
    );
    db.execute(
      `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', 'active', ?, ?)`,
      'goal-plan-1',
      'proj-plan',
      'Initial Plan Goal',
      'Test replanning tool execution',
      now,
      now
    );

    const context = {
      runId: 'run-plan-1',
      agentId: 'agent-boss',
      projectId: 'proj-plan',
      channelId: 'chan-general',
      allowedCapabilities: ['*'],
      autonomyMode: 'AUTO' as const,
      worktreeRoot: os.tmpdir(),
    };

    const res = await tg.executeTool(
      'proposePlanAdjustment',
      {
        goalId: 'goal-plan-1',
        proposal: {
          title: 'Shift from REST to GraphQL',
          topic: 'API contract realignment',
          optionA: { label: 'Adopt GraphQL Schema', pros: 'Unified query surface', cons: 'Requires client upgrade' },
          optionB: { label: 'Maintain REST API', pros: 'Zero breaking changes', cons: 'Multiple roundtrips' },
          recommendation: 'Adopt GraphQL Schema with compatibility adapter',
        },
      },
      context
    );

    expect(res.success).toBe(true);
    expect(res.output.proposed).toBe(true);
    expect(res.output.goalId).toBe('goal-plan-1');

    const updatedGoal = db.queryOne<{ proposed_replanning_json: string }>(
      'SELECT proposed_replanning_json FROM goals WHERE id = ?',
      'goal-plan-1'
    );
    expect(updatedGoal).toBeDefined();
    expect(updatedGoal!.proposed_replanning_json).toContain('Shift from REST to GraphQL');
    expect(updatedGoal!.proposed_replanning_json).toContain('Adopt GraphQL Schema');
  });
});
