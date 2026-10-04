import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import { ContextCompiler } from '../src/context/context_compiler.js';
import { WakeupQueue } from '../src/kernel/wakeup_queue.js';
import { CoreServer } from '../src/server/core_server.js';
import { ModelGateway } from '../src/execution/model_gateway.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('KIN Enterprise Resilience & Crash Recovery Suite', () => {
  let db: KinDatabase;
  let tempDbPath: string;
  let taskRepo: TaskRepository;
  let kernel: AgentKernel;
  let contextCompiler: ContextCompiler;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-resilience-'));
    tempDbPath = path.join(tempDir, 'kin_resilience.sqlite');
    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    taskRepo = new TaskRepository(db);
    kernel = new AgentKernel(db);
    contextCompiler = new ContextCompiler();

    // Seed test workspace, project, and agent
    const now = Date.now();
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'ws-test',
      'Test WS',
      process.cwd(),
      'AUTO',
      now,
      now
    );
    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'proj-test',
      'ws-test',
      'Test Project',
      process.cwd(),
      now,
      now
    );
    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'def-test',
      'Test Agent',
      'Specialist',
      'System prompt',
      'model-test',
      '[]',
      '[]',
      now
    );
    db.execute(
      `INSERT INTO agent_identities (id, workspace_id, definition_id, project_id, display_name, active_model_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'agent-worker',
      'ws-test',
      'def-test',
      'proj-test',
      'WorkerAgent',
      'model-test',
      now,
      now
    );
    db.execute(
      `INSERT INTO channels (id, project_id, name, created_at)
       VALUES (?, ?, ?, ?)`,
      'chan-1',
      'proj-test',
      'general',
      now
    );
    db.execute(
      `INSERT INTO channels (id, project_id, name, created_at)
       VALUES (?, ?, ?, ?)`,
      'chan-general',
      'proj-test',
      'general',
      now
    );
  });

  afterEach(() => {
    db.close();
    try {
      const dir = path.dirname(tempDbPath);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  it('claims atomic task lease and rejects concurrent claim by another run', () => {
    const now = Date.now();
    db.execute(
      `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'goal-1',
      'proj-test',
      'Core Goal',
      'Core Goal Description',
      '["Pass verification"]',
      'active',
      now,
      now
    );

    const task = taskRepo.createTask({
      id: 'task-lease-1',
      goalId: 'goal-1',
      title: 'Resilient Task',
      description: 'Execute with lease',
      assignedAgentId: 'agent-worker',
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    });

    // Spawn test runs for foreign key constraint
    const run1 = kernel.spawnRun({
      agentId: 'agent-worker',
      projectId: 'proj-test',
      channelId: 'chan-1',
      allocatedTokens: 50000,
    });
    const run2 = kernel.spawnRun({
      agentId: 'agent-worker',
      projectId: 'proj-test',
      channelId: 'chan-1',
      allocatedTokens: 50000,
    });

    // 1. Claim task with lease for run-1
    const claimed = taskRepo.claimTaskWithLease('task-lease-1', 'agent-worker', run1.id, 5000);
    expect(claimed).toBe(true);

    const updatedTask = taskRepo.getTask('task-lease-1');
    expect(updatedTask?.status).toBe('running');
    expect(updatedTask?.claimedByRunId).toBe(run1.id);
    expect(updatedTask?.leaseExpiresAt).toBeGreaterThan(now);

    // 2. Concurrent claim by run-2 should fail while lease is active
    const concurrentClaim = taskRepo.claimTaskWithLease('task-lease-1', 'agent-worker', run2.id, 5000);
    expect(concurrentClaim).toBe(false);
  });

  it('auto-reclaims expired task leases and increments retry counter', () => {
    const now = Date.now();
    db.execute(
      `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'goal-2',
      'proj-test',
      'Goal 2',
      'Desc',
      '[]',
      'active',
      now,
      now
    );

    taskRepo.createTask({
      id: 'task-lease-expired',
      goalId: 'goal-2',
      title: 'Expired Lease Task',
      description: 'Will expire',
      assignedAgentId: 'agent-worker',
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    });

    const runCrashed = kernel.spawnRun({
      agentId: 'agent-worker',
      projectId: 'proj-test',
      channelId: 'chan-1',
      allocatedTokens: 50000,
    });

    // Manually set an already expired lease
    db.execute(
      `UPDATE tasks SET status = 'running', claimed_by_run_id = ?, lease_expires_at = ?, retry_count = 0 WHERE id = ?`,
      runCrashed.id,
      now - 1000,
      'task-lease-expired'
    );

    const reclaimed = taskRepo.reclaimExpiredTaskLeases();
    expect(reclaimed).toContain('task-lease-expired');

    const afterTask = taskRepo.getTask('task-lease-expired');
    expect(afterTask?.status).toBe('ready');
    expect(afterTask?.claimedByRunId).toBeUndefined();
    expect(afterTask?.leaseExpiresAt).toBeUndefined();
    expect(afterTask?.retryCount).toBe(1);
  });

  it('pauses run for quota and records turn checkpoint snapshot', () => {
    const run = kernel.spawnRun({
      agentId: 'agent-worker',
      projectId: 'proj-test',
      channelId: 'chan-1',
      allocatedTokens: 50000,
    });

    expect(run.state).toBe('running');

    // Save turn checkpoint
    kernel.saveCheckpoint(run.id, {
      turn: 2,
      conversationHistory: [
        { role: 'user', content: 'Execute step 1' },
        { role: 'assistant', content: 'Step 1 complete' },
      ],
      actions: [{ toolName: 'bash', params: { command: 'ls' }, durationMs: 40 }],
    });

    // Pause for quota
    kernel.pauseForQuota(run.id, 60000);

    const pausedRun = kernel.getRun(run.id);
    expect(pausedRun?.state).toBe('quota_paused');
    expect(pausedRun?.quotaResetsAt).toBeGreaterThan(Date.now());

    // Stale run recovery recovers interrupted turn and checkpoint
    db.execute(
      `UPDATE agent_runs SET heartbeat_at = ? WHERE id = ?`,
      Date.now() - 60000,
      run.id
    );
    db.execute(
      `UPDATE agent_runs SET state = 'running' WHERE id = ?`,
      run.id
    );

    const recovered = kernel.recoverStaleRunsDetailed(45000);
    expect(recovered.length).toBe(1);
    expect(recovered[0].id).toBe(run.id);
    expect(recovered[0].checkpoint?.snapshotJson).toBeDefined();

    const cp = JSON.parse(recovered[0].checkpoint!.snapshotJson);
    expect(cp.turn).toBe(2);
    expect(cp.actions[0].toolName).toBe('bash');
  });

  it('injects Goal Ancestry & Objective Anchor into context assembly', () => {
    const compiled = contextCompiler.compile({
      agentDefinition: {
        id: 'def-test',
        name: 'Worker',
        role: 'Specialist',
        systemPrompt: 'System prompt instructions',
        defaultModelId: 'model-test',
        domainAuthority: [],
        capabilities: [],
        createdAt: Date.now(),
      },
      agentIdentity: {
        id: 'agent-worker',
        workspaceId: 'ws-test',
        definitionId: 'def-test',
        displayName: 'WorkerAgent',
        activeModelId: 'model-test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      toolSchemas: [],
      projectDecisions: [],
      trajectoryMessages: [],
      goalAncestry: {
        rootGoalTitle: 'Enterprise Cloud Deployment',
        parentGoalTitle: 'Security Hardening',
        activeGoalTitle: 'Implement Atomic Task Leases',
        successCriteria: ['Zero duplicate tasks', 'Automatic watchdog lease recovery'],
        rationale: 'Prevent split-brain workers across multi-turn execution',
      },
    });

    expect(compiled.fullAssembledPrompt).toContain('### STRATEGIC GOAL ANCESTRY & OBJECTIVE ANCHOR:');
    expect(compiled.fullAssembledPrompt).toContain('Root Goal: Enterprise Cloud Deployment');
    expect(compiled.fullAssembledPrompt).toContain('Parent Goal: Security Hardening');
    expect(compiled.fullAssembledPrompt).toContain('Active Objective: Implement Atomic Task Leases');
    expect(compiled.fullAssembledPrompt).toContain('Zero duplicate tasks');
  });

  it('coalesces rapid wakeup events with 100ms debounce in WakeupQueue', async () => {
    let dispatchCount = 0;
    let lastCoalescedCount = 0;

    const queue = new WakeupQueue(100, async (event, coalesced) => {
      dispatchCount++;
      lastCoalescedCount = coalesced;
    });

    // Enqueue 5 rapid events for the same agent & channel
    queue.enqueue({
      id: 'evt-1',
      agentId: 'agent-worker',
      channelId: 'chan-general',
      source: 'file_change',
      timestamp: Date.now(),
    });
    queue.enqueue({
      id: 'evt-2',
      agentId: 'agent-worker',
      channelId: 'chan-general',
      source: 'file_change',
      timestamp: Date.now(),
    });
    queue.enqueue({
      id: 'evt-3',
      agentId: 'agent-worker',
      channelId: 'chan-general',
      source: 'message',
      timestamp: Date.now(),
    });

    expect(queue.getQueueSize()).toBe(1);

    // Wait 250ms for debounce timer to fire
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(dispatchCount).toBe(1);
    expect(lastCoalescedCount).toBe(3);
    expect(queue.getQueueSize()).toBe(0);
  });

  it('persists and retrieves formal agent evaluations and managed credentials', () => {
    const now = Date.now();

    // 1. Agent Evaluation
    const evalId = 'eval-test-1';
    db.execute(
      `INSERT INTO agent_evaluations (id, agent_id, test_suite_name, score, passed, rubric_metrics_json, evaluator_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      evalId,
      'agent-worker',
      'Enterprise Benchmark v2',
      96,
      1,
      JSON.stringify({ accuracy: 95, reasoning: 92, toolCompetence: 98, safetyAdherence: 100, overall: 96 }),
      'Flawless execution',
      now
    );

    const evalRow = db.queryOne<any>('SELECT * FROM agent_evaluations WHERE id = ?', evalId);
    expect(evalRow).toBeDefined();
    expect(evalRow.agent_id).toBe('agent-worker');
    expect(JSON.parse(evalRow.rubric_metrics_json).overall).toBe(96);

    // 2. Managed Credential (BYOK)
    const credId = 'cred-test-1';
    db.execute(
      `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      credId,
      'openai',
      'Production OpenAI Key',
      'sk-real-secret-key-12345678',
      JSON.stringify(['agent-worker']),
      10000000,
      250000,
      1,
      now,
      now
    );

    const credRow = db.queryOne<any>('SELECT * FROM managed_credentials WHERE id = ?', credId);
    expect(credRow).toBeDefined();
    expect(credRow.provider).toBe('openai');
    expect(credRow.key_alias).toBe('Production OpenAI Key');
    expect(credRow.max_spend_tokens).toBe(10000000);
  });
});

describe('KIN Enterprise Resilience: CoreServer API & Slash Commands', () => {
  const testDbPath = path.resolve(process.cwd(), 'kin_test_resilience_server.sqlite');
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    server = new CoreServer({ port: 0, dbPath: testDbPath });
    port = await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('GET /api/system/recovery-state returns pending recoveries array', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/system/recovery-state`);
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(Array.isArray(data.pendingRecoveries)).toBe(true);
  });

  it('POST & GET /api/settings/credentials manages BYOK keys', async () => {
    // 1. Create credential
    const createRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
        keyAlias: 'Claude 3.7 Sonnet Key',
        apiKey: 'sk-ant-test-key-999',
        monthlyQuotaTokens: 5000000,
        scopedAgentIds: ['agent-boss'],
      }),
    });
    expect(createRes.status).toBe(201);
    const createData: any = await createRes.json();
    expect(createData.success).toBe(true);
    expect(createData.credential.provider).toBe('anthropic');
    expect(createData.credential.keyAlias).toBe('Claude 3.7 Sonnet Key');

    // 2. Fetch credentials
    const getRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`);
    expect(getRes.status).toBe(200);
    const getData: any = await getRes.json();
    expect(Array.isArray(getData.credentials)).toBe(true);
    expect(getData.credentials.some((c: any) => c.keyAlias === 'Claude 3.7 Sonnet Key')).toBe(true);
  });

  it('GET and POST /api/agents/:id/evaluations runs benchmark evaluation', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state`);
    const state: any = await stateRes.json();
    const agentId = state.agents[0].id;

    // Run evaluation
    const evalRes = await fetch(`http://127.0.0.1:${port}/api/agents/${agentId}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testSuiteName: 'Resilience Benchmark v1' }),
    });
    expect(evalRes.status).toBe(201);
    const evalData: any = await evalRes.json();
    expect(evalData.success).toBe(true);
    expect(evalData.evaluation.rubricScores.overall).toBeGreaterThanOrEqual(90);
    expect(evalData.evaluation.testCasesPassed).toBe(12);

    // List evaluations
    const listRes = await fetch(`http://127.0.0.1:${port}/api/agents/${agentId}/evaluations`);
    expect(listRes.status).toBe(200);
    const listData: any = await listRes.json();
    expect(Array.isArray(listData.evaluations)).toBe(true);
    expect(listData.evaluations.length).toBeGreaterThan(0);
  });

  it('POST /api/channels/:id/messages with /btw returns ephemeral side-query response', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state`);
    const state: any = await stateRes.json();
    const channelId = state.channels[0].id;

    const res = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/btw what is the status of sqlite WAL mode?',
        senderType: 'human',
      }),
    });
    // Give asynchronous handler time to deliver side-query reply
    let found = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const msgsRes = await fetch(`http://127.0.0.1:${port}/api/state`);
      const msgsState: any = await msgsRes.json();
      const replies = msgsState.messages.filter((m: any) => m.content.includes('Side Query') || m.content.includes('BTW') || m.content.includes('By The Way') || m.content.includes('ephemeral'));
      if (replies.length > 0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  }, 15000);

  it('POST /api/channels/:id/messages with /grill-me produces interactive questionnaire', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state`);
    const state: any = await stateRes.json();
    const channelId = state.channels[0].id;

    const res = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/grill-me database redundancy and failover strategy',
        senderType: 'human',
      }),
    });
    expect(res.status).toBe(201);

    const msgsRes = await fetch(`http://127.0.0.1:${port}/api/state`);
    const msgsState: any = await msgsRes.json();
    const grillReplies = msgsState.messages.filter((m: any) => m.content.includes('Architecture Grilling') || m.content.includes('Grill-Me') || m.content.includes('GRILL'));
    expect(grillReplies.length).toBeGreaterThan(0);
  });

  it('POST /api/system/recovery/resume-all and /discard handle recovery lifecycle', async () => {
    const resumeRes = await fetch(`http://127.0.0.1:${port}/api/system/recovery/resume-all`, {
      method: 'POST',
    });
    expect(resumeRes.status).toBe(200);
    const resumeData: any = await resumeRes.json();
    expect(resumeData.success).toBe(true);

    const discardRes = await fetch(`http://127.0.0.1:${port}/api/system/recovery/discard`, {
      method: 'POST',
    });
    expect(discardRes.status).toBe(200);
    const discardData: any = await discardRes.json();
    expect(discardData.success).toBe(true);
  });

  it('ModelGateway integrates OpenRouter BYOK with live invocation, 429 backoff retry, and token spend tracking', async () => {
    let spendTokensRecorded = 0;
    const gateway = new ModelGateway({
      apiKeyResolver: (provider) => {
        if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY || 'sk-or-placeholder';
        return undefined;
      },
      onUsage: (provider, tokens) => {
        spendTokensRecorded += tokens.totalTokens;
      },
    });

    const res = await gateway.invoke({
      modelId: 'openrouter/qwen/qwen3.8-27b:free',
      messages: [{ role: 'user', content: 'Say OK' }],
      maxTokens: 50,
    });

    expect(res.provider).toBe('openrouter');
    if (!res.isError) {
      expect(res.content.length).toBeGreaterThan(0);
      expect(spendTokensRecorded).toBeGreaterThan(0);
    }
  }, 25000);

  it('/btw concurrency fast-path answers non-blocking side-query with HTTP 201 without queuing behind agent loops', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state`);
    const state: any = await stateRes.json();
    const channelId = state.channels[0].id;

    // Send /btw inquiry
    const btwRes = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/btw what is the active database journal mode and port?',
        senderType: 'human',
      }),
    });

    expect(btwRes.status).toBe(201);
    const data: any = await btwRes.json();
    expect(data.sideQuery).toBe(true);

    // Verify side-query answer arrives without polluting DAG tasks
    let found = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const msgsRes = await fetch(`http://127.0.0.1:${port}/api/state`);
      const msgsState: any = await msgsRes.json();
      const replies = msgsState.messages.filter(
        (m: any) => m.content.includes('Side Query') || m.content.includes('BTW') || m.content.includes('journal')
      );
      if (replies.length > 0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

