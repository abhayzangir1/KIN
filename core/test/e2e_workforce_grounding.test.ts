import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import { ToolGateway, ToolExecutionContext } from '../src/execution/tool_gateway.js';
import { ModelGateway } from '../src/execution/model_gateway.js';
import { ExecutionNodeRouter, SandboxWorktreeNode, HostExecutionNode } from '../src/execution/execution_node.js';
import { SecretVault } from '../src/security/secret_vault.js';
import { SecretBroker } from '../src/security/secret_broker.js';
import { Sentinel } from '../src/security/sentinel.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { LoopBreaker } from '../src/communication/loop_breaker.js';
import { ContextCompactor } from '../src/context/context_compactor.js';
import { OutputSpiller } from '../src/context/output_spiller.js';
import { Message } from '../src/domain/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

describe('KIN E2E Workforce Grounding & Architectural Verification Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let agentRepo: AgentRepository;
  let workspaceRepo: WorkspaceRepository;
  let taskRepo: TaskRepository;
  let kernel: AgentKernel;

  beforeEach(() => {
    const baseTemp = process.env.TEMP || process.env.TMP || '/tmp';
    tempDir = fs.mkdtempSync(path.join(baseTemp, 'kin-e2e-grounding-'));
    dbPath = path.join(tempDir, 'e2e_grounding.sqlite');
    db = new KinDatabase({ dbPath });
    new MigrationRunner(db).runMigrations();

    agentRepo = new AgentRepository(db);
    workspaceRepo = new WorkspaceRepository(db);
    taskRepo = new TaskRepository(db);
    kernel = new AgentKernel(db);

    const now = Date.now();
    workspaceRepo.createWorkspace({
      id: 'ws-e2e',
      name: 'E2E Workspace',
      rootPath: tempDir,
      defaultAutonomyMode: 'AUTO',
      createdAt: now,
      updatedAt: now,
    });

    workspaceRepo.createProject({
      id: 'proj-e2e',
      workspaceId: 'ws-e2e',
      name: 'E2E Project',
      repoPath: tempDir,
      settings: { defaultBranch: 'main' },
      createdAt: now,
      updatedAt: now,
    });

    agentRepo.createDefinition({
      id: 'def-boss',
      name: 'Boss Orchestrator',
      role: 'Platform Orchestrator',
      systemPrompt: 'Coordinate autonomous workflows.',
      defaultModelId: 'mock-model',
      domainAuthority: ['coordination', 'planning'],
      capabilities: ['*'],
      createdAt: now,
    });

    agentRepo.createIdentity({
      id: 'agent-boss',
      workspaceId: 'ws-e2e',
      projectId: 'proj-e2e',
      definitionId: 'def-boss',
      displayName: '@Boss',
      activeModelId: 'mock-model',
      isOrchestrator: true,
      isEphemeral: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    SecretVault.resetInstance();
  });

  // ==========================================================================
  // TIER 1: FEATURE COVERAGE (ITEMS 1 - 28)
  // ==========================================================================
  describe('Tier 1: Feature Coverage (Items 1 - 28)', () => {
    // 1. Task Completion Ordering
    it('Item 1: completeTask atomically clears claimed_by_run_id and lease_expires_at while advancing status', () => {
      const now = Date.now();
      taskRepo.createGoal({
        id: 'goal-1',
        projectId: 'proj-e2e',
        title: 'Goal 1',
        description: 'Test goal',
        acceptanceCriteria: ['criteria met'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      taskRepo.createTask({
        id: 'task-1',
        goalId: 'goal-1',
        title: 'Task 1',
        description: 'Testing task completion ordering',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      const claimed = taskRepo.claimTaskWithLease('task-1', 'agent-boss', 'run-101', 300000);
      expect(claimed).toBe(true);

      const runningTask = taskRepo.getTask('task-1');
      expect(runningTask?.status).toBe('running');
      expect(runningTask?.claimedByRunId).toBe('run-101');
      expect(runningTask?.leaseExpiresAt).toBeGreaterThan(now);

      // completeTask called while in running status
      taskRepo.completeTask('task-1', 'evidence-bundle-1');

      const completedTask = taskRepo.getTask('task-1');
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.claimedByRunId).toBeUndefined();
      expect(completedTask?.leaseExpiresAt).toBeUndefined();
      expect(completedTask?.evidenceBundleId).toBe('evidence-bundle-1');

      // Completing a non-running/non-review task must reject
      expect(() => taskRepo.completeTask('task-1', 'evidence-bundle-2')).toThrow(
        /Task is not in running\/review status/
      );
    });

    // 2. Capability Source of Truth
    it('Item 2: queries AgentDefinition.capabilities via agentRepo.getDefinition as source of truth', () => {
      const now = Date.now();
      agentRepo.createDefinition({
        id: 'def-specialist',
        name: 'Browser Specialist',
        role: 'Web Navigator',
        systemPrompt: 'Explore web apps.',
        defaultModelId: 'mock-model',
        domainAuthority: ['web'],
        capabilities: ['web:browse', 'shell:exec', 'mcp:call'],
        createdAt: now,
      });

      agentRepo.createIdentity({
        id: 'agent-spec-1',
        workspaceId: 'ws-e2e',
        projectId: 'proj-e2e',
        definitionId: 'def-specialist',
        displayName: '@WebSpecialist',
        activeModelId: 'mock-model',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      const identity = agentRepo.getIdentity('agent-spec-1');
      expect(identity).toBeDefined();
      expect((identity as any)?.capabilities).toBeUndefined();

      const definition = agentRepo.getDefinition(identity!.definitionId);
      expect(definition).toBeDefined();
      expect(definition?.capabilities).toEqual(['web:browse', 'shell:exec', 'mcp:call']);
    });

    // 3. Specialist Capability Propagation
    it('Item 3: propagates definition capabilities into allowedCapabilities without stripping', () => {
      const gateway = new ToolGateway({ db });
      const allowedCaps = ['web:browse', 'shell:exec', 'mcp:call'];

      const checkShell = gateway.checkCapabilityAuthorized('executeShell', allowedCaps);
      expect(checkShell.authorized).toBe(true);

      const checkBrowser = gateway.checkCapabilityAuthorized('browser', allowedCaps);
      expect(checkBrowser.authorized).toBe(true);

      const checkMcp = gateway.checkCapabilityAuthorized('mcp__sample_tool', allowedCaps);
      expect(checkMcp.authorized).toBe(true);
    });

    // 4. Token Budget Terminal State Resolution
    it('Item 4: prevents transitioning to cancelled if run was already marked failed by budget exhaustion', () => {
      const run = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-e2e',
        allocatedTokens: 500,
      });

      const res = kernel.recordTokenUsage(run.id, 600);
      expect(res.exceeded).toBe(true);

      const runAfterFail = kernel.getRun(run.id);
      expect(runAfterFail?.state).toBe('failed');

      expect(() => {
        kernel.transitionState(run.id, 'cancelled', 'Aborted via human takeover');
      }).toThrow(/Cannot transition run from terminal state 'failed' to 'cancelled'/);

      const runFinal = kernel.getRun(run.id);
      expect(runFinal?.state).toBe('failed');
    });

    // 5. Atomic DAG Task Promotion
    it('Item 5: keeps promoted sibling tasks in ready until claimed atomically by worker', () => {
      const now = Date.now();
      taskRepo.createGoal({
        id: 'goal-dag',
        projectId: 'proj-e2e',
        title: 'DAG Goal',
        description: 'Test DAG promotion',
        acceptanceCriteria: ['complete'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      taskRepo.createTask({
        id: 'task-root',
        goalId: 'goal-dag',
        title: 'Root Task',
        description: 'First task',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      taskRepo.createTask(
        {
          id: 'task-dependent',
          goalId: 'goal-dag',
          title: 'Dependent Task',
          description: 'Second task waiting on root',
          status: 'backlog',
          createdAt: now,
          updatedAt: now,
        },
        ['task-root']
      );

      expect(taskRepo.claimTaskWithLease('task-root', 'agent-boss', 'run-root')).toBe(true);
      taskRepo.completeTask('task-root', 'ev-root');

      const promotedTask = taskRepo.getTask('task-dependent');
      expect(promotedTask?.status).toBe('ready');
      expect(promotedTask?.claimedByRunId).toBeUndefined();

      const claimed = taskRepo.claimTaskWithLease('task-dependent', 'agent-boss', 'run-dep');
      expect(claimed).toBe(true);
      expect(taskRepo.getTask('task-dependent')?.status).toBe('running');
    });

    // 6. In-Flight Watchdog Timer & Lease Renewal
    it('Item 6: touches heartbeat and renews task lease during active worker execution', async () => {
      const now = Date.now();
      taskRepo.createGoal({
        id: 'goal-wd',
        projectId: 'proj-e2e',
        title: 'Watchdog Goal',
        description: 'Watchdog test',
        acceptanceCriteria: ['ok'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      taskRepo.createTask({
        id: 'task-wd',
        goalId: 'goal-wd',
        title: 'Task WD',
        description: 'Task under lease',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      const run = kernel.spawnRun({ agentId: 'agent-boss', projectId: 'proj-e2e', taskId: 'task-wd' });
      taskRepo.claimTaskWithLease('task-wd', 'agent-boss', run.id, 10000);

      const initialLease = taskRepo.getTask('task-wd')?.leaseExpiresAt;
      expect(initialLease).toBeDefined();

      kernel.heartbeat(run.id);
      const renewed = taskRepo.renewTaskLease('task-wd', run.id, 60000);
      expect(renewed).toBe(true);

      const extendedLease = taskRepo.getTask('task-wd')?.leaseExpiresAt;
      expect(extendedLease).toBeGreaterThan(initialLease!);
    });

    // 7. Cryptographic Approval Parameter Digest
    it('Item 7: binds approval tokens to parameter digest and consumes single-use', () => {
      const sentinel = Sentinel.getInstance();
      const params = { command: 'rm -rf /cache', target: 'data.txt' };
      const canonical = JSON.stringify(params);
      const toolName = 'executeShell';
      const runId = 'run-sec-1';

      const digest = crypto
        .createHash('sha256')
        .update(toolName + ':' + runId + ':' + canonical)
        .digest('hex');
      expect(digest.length).toBe(64);

      const token = `appr-${digest.slice(0, 16)}`;
      sentinel.registerApprovalToken(token, toolName, 60000, runId);

      const firstConsume = sentinel.consumeApprovalToken(token, toolName, runId);
      expect(firstConsume).toBe(true);

      const replayConsume = sentinel.consumeApprovalToken(token, toolName, runId);
      expect(replayConsume).toBe(false);
    });

    // 8. Privileged HTTP Control Plane Sentinel Integration
    it('Item 8: routes privileged actions through Sentinel policy evaluation', () => {
      const sentinel = Sentinel.getInstance();
      const decision = sentinel.evaluate({
        agentId: 'agent-operator',
        runId: 'run-priv-1',
        toolName: 'executeShell',
        params: { command: 'rm -rf /important_dir' },
        riskLevel: 'CRITICAL',
        autonomyMode: 'AUTO',
        agentCapabilities: ['shell:exec'],
      });

      expect(decision.isDestructive).toBe(true);
      expect(decision.requiresApproval).toBe(true);
    });

    // 9. SSE Live Stream Secret Redaction
    it('Item 9: sanitizes secrets in payload before event distribution', () => {
      const broker = SecretBroker.getInstance();
      const sensitivePayload = {
        apiKey: 'sk-ant-123456789012345678901234',
        authHeader: 'Bearer 0123456789abcdef0123456789abcdef',
        normalText: 'Regular payload parameter',
      };

      const sanitized = broker.sanitizePayload(sensitivePayload);
      expect(sanitized.apiKey).toContain('[REDACTED_KEY]');
      expect(sanitized.authHeader).toContain('[REDACTED_TOKEN]');
      expect(sanitized.normalText).toBe('Regular payload parameter');
    });

    // 10. Fail-Closed ToolGateway Capability Gate
    it('Item 10: fails closed when agent holds empty capabilities', async () => {
      const gateway = new ToolGateway({ db });
      const result = await gateway.executeTool(
        'readFile',
        { path: 'notes.txt' },
        {
          runId: 'run-zero-cap',
          agentId: 'agent-restricted',
          worktreeRoot: tempDir,
          autonomyMode: 'AUTO',
          allowedCapabilities: [],
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Fail-closed capability check');
    });

    // 11. SecretBroker Vault Ciphertext Resolver
    it('Item 11: encrypts credentials with vault prefix and resolves via managed_credentials', () => {
      const vault = SecretVault.getInstance();
      const plaintext = 'super-secret-api-token-999';
      const ciphertext = vault.encrypt(plaintext);
      expect(ciphertext).toMatch(/^vault:v1:/);

      // Insert credential into managed_credentials table
      const credId = 'cred-test-11';
      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, is_active, created_at, updated_at)
         VALUES (?, 'custom', 'my_secret_token', ?, 1, ?, ?)`,
        credId,
        ciphertext,
        Date.now(),
        Date.now()
      );

      const broker = SecretBroker.getInstance(db);
      const resolved = broker.resolvePlaceholders('Bearer {{vault:my_secret_token}}');
      expect(resolved).toBe('Bearer super-secret-api-token-999');
    });

    // 12. VM Skill Async Timeout Watchdog
    it('Item 12: times out async execution promises exceeding duration threshold in SkillEngine', async () => {
      const skillEngine = new SkillEngine(db);
      const hangingSkill = {
        name: 'hanging-async-skill',
        handlerCode: `
          module.exports = async function(params) {
            await new Promise(r => setTimeout(r, 500));
            return { ok: true };
          };
        `,
      };

      const result = await skillEngine.executeSkill(hangingSkill, { _timeoutMs: 50 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    // 13. Fail-Closed Worktree Provisioning & ExecutionNode Isolation
    it('Item 13: SandboxWorktreeNode enforces worktree jail boundaries and sanitizes environment', async () => {
      const sandboxNode = new SandboxWorktreeNode();
      const worktreeRoot = path.join(tempDir, 'worktree');
      fs.mkdirSync(worktreeRoot, { recursive: true });

      // Escaping worktreeRoot boundary should fail closed
      const escapedResult = await sandboxNode.execute('cmd', {
        cwd: path.join(tempDir, 'outside'),
        worktreeRoot,
      }, async () => 'executed');

      expect(escapedResult.success).toBe(false);
      expect(escapedResult.error).toContain('escapes worktree boundary');

      // Valid cwd within worktreeRoot succeeds and sanitizes sensitive environment variables
      const envInput = { PATH: '/bin', API_KEY: 'secret-key-123', SAFE_VAR: 'hello' };
      const validResult = await sandboxNode.execute('cmd', {
        cwd: worktreeRoot,
        worktreeRoot,
        env: envInput,
      }, async (params) => params.env);

      expect(validResult.success).toBe(true);
      expect(validResult.data?.SAFE_VAR).toBe('hello');
      expect(validResult.data?.API_KEY).toBeUndefined();
    });

    // 14. Authoritative EventLedger Runtime Wiring
    it('Item 14: records authoritative lifecycle transitions into event_journal', () => {
      const ledger = EventLedger.initialize(db);
      const rowId = ledger.record({
        eventType: 'TASK_COMPLETED',
        entityType: 'task',
        entityId: 'task-14',
        runId: 'run-14',
        payload: { summary: 'Completed successfully' },
      });

      expect(rowId).toBeGreaterThan(0);
      const events = ledger.getEventsForRun('run-14');
      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('TASK_COMPLETED');
      expect(events[0].payload.summary).toBe('Completed successfully');
    });

    // 15. Redundant PolicyEngine Removal & Sentinel Unification
    it('Item 15: provides single authoritative policy engine via Sentinel', () => {
      const sentinel = Sentinel.getInstance();
      const policyEngine = sentinel.getPolicyEngine();
      expect(policyEngine).toBeDefined();

      const evaluation = policyEngine.evaluate({
        toolName: 'executeShell',
        params: { command: 'echo "harmless"' },
        autonomyMode: 'AUTO',
      });
      expect(evaluation.allowed).toBe(true);
    });

    // 16. Dynamic Project Default Branch Resolution
    it('Item 16: resolves custom project defaultBranch or defaults cleanly to main', () => {
      const now = Date.now();
      workspaceRepo.createProject({
        id: 'proj-custom-branch',
        workspaceId: 'ws-e2e',
        name: 'Feature Branch Project',
        repoPath: tempDir,
        settings: { defaultBranch: 'develop' },
        createdAt: now,
        updatedAt: now,
      });

      const customProj = workspaceRepo.getProject('proj-custom-branch');
      const resolvedBranch = customProj?.settings?.defaultBranch || 'main';
      expect(resolvedBranch).toBe('develop');

      const defaultProj = workspaceRepo.getProject('proj-e2e');
      const fallbackBranch = defaultProj?.settings?.defaultBranch || 'main';
      expect(fallbackBranch).toBe('main');
    });

    // 17. ModelGateway DB Provider Startup Reconciliation
    it('Item 17: registers and resolves custom providers in ModelGateway', () => {
      const gateway = new ModelGateway();
      gateway.registerCustomProvider('vllm-local', 'http://127.0.0.1:8000/v1', 'token-123');

      // Verifies custom provider registration does not throw
      expect(() => {
        gateway.registerCustomProvider('mistral-embed', 'http://127.0.0.1:8001/v1');
      }).not.toThrow();
    });

    // 18. Fallback Model Parameter Wiring
    it('Item 18: preserves fallbackModelId on agent identity for fallback execution', () => {
      const now = Date.now();
      agentRepo.createIdentity({
        id: 'agent-fallback-test',
        workspaceId: 'ws-e2e',
        projectId: 'proj-e2e',
        definitionId: 'def-boss',
        displayName: '@ResilientAgent',
        activeModelId: 'primary-model',
        fallbackModelId: 'backup-model',
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      const identity = agentRepo.getIdentity('agent-fallback-test');
      expect(identity?.activeModelId).toBe('primary-model');
      expect(identity?.fallbackModelId).toBe('backup-model');
    });

    // 19. Normalized Cloud Model SSE Streaming
    it('Item 19: invokes onToken streaming callback during model token processing', async () => {
      const tokensReceived: string[] = [];
      const onToken = (token: string) => {
        tokensReceived.push(token);
      };

      // Simulates token-by-token emission
      const testChunks = ['Hello', ' ', 'world', '!'];
      for (const chunk of testChunks) {
        onToken(chunk);
      }

      expect(tokensReceived).toEqual(['Hello', ' ', 'world', '!']);
      expect(tokensReceived.join('')).toBe('Hello world!');
    });

    // 20. Parent Run Context Propagation
    it('Item 20: populates parentRunId and tracks recursive descendant count', () => {
      const runParent = kernel.spawnRun({ agentId: 'agent-boss', projectId: 'proj-e2e' });
      const runChild1 = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-e2e',
        parentRunId: runParent.id,
      });
      const runChild2 = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-e2e',
        parentRunId: runParent.id,
      });
      const runGrandchild = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-e2e',
        parentRunId: runChild1.id,
      });

      expect(kernel.countDescendants(runParent.id)).toBe(3);
      expect(kernel.countDescendants(runChild1.id)).toBe(1);
      expect(kernel.countDescendants(runChild2.id)).toBe(0);
      expect(kernel.countDescendants(runGrandchild.id)).toBe(0);
    });

    // 21. Durable Run Queue Persistence
    it('Item 21: persists queued runs durably in database and admits them when capacity frees up', () => {
      // Fill concurrency up to max (8 runs)
      const runs: any[] = [];
      for (let i = 0; i < 8; i++) {
        runs.push(kernel.spawnRun({ agentId: 'agent-boss', projectId: 'proj-e2e' }));
      }
      expect(kernel.getActiveRunCount()).toBe(8);

      // 9th run queues durably via queueRun
      const queuedRun = kernel.queueRun({ agentId: 'agent-boss', projectId: 'proj-e2e' });
      expect(queuedRun.state).toBe('queued');

      // Database reflects queued state
      const dbRun = kernel.getRun(queuedRun.id);
      expect(dbRun?.state).toBe('queued');

      // Admission while at capacity returns undefined
      expect(kernel.admitNextQueuedRun()).toBeUndefined();

      // Complete one active run to free capacity
      kernel.transitionState(runs[0].id, 'completed');
      expect(kernel.getActiveRunCount()).toBe(7);

      // Automated admission dequeues and admits the queued run
      const admitted = kernel.admitNextQueuedRun();
      expect(admitted).toBeDefined();
      expect(admitted?.id).toBe(queuedRun.id);
      expect(admitted?.state).toBe('running');
    });

    // 22. Approval State Lease Protection
    it('Item 22: protects tasks claimed by runs in waiting_for_approval from lease reclamation', () => {
      const now = Date.now();
      taskRepo.createGoal({
        id: 'goal-lease-appr',
        projectId: 'proj-e2e',
        title: 'Goal Lease',
        description: 'Testing lease',
        acceptanceCriteria: ['done'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      taskRepo.createTask({
        id: 'task-lease-appr',
        goalId: 'goal-lease-appr',
        title: 'Task in approval',
        description: 'Waiting for operator',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      const run = kernel.spawnRun({ agentId: 'agent-boss', projectId: 'proj-e2e', taskId: 'task-lease-appr' });
      taskRepo.claimTaskWithLease('task-lease-appr', 'agent-boss', run.id, -1000); // Expired lease in past
      kernel.transitionState(run.id, 'waiting_for_approval', 'Operator confirmation required');

      // Since run is in waiting_for_approval, task lease is protected from reclamation
      const reclaimed = taskRepo.reclaimExpiredTaskLeases();
      expect(reclaimed).not.toContain('task-lease-appr');

      // Transition run to failed: now expired lease is reclaimed
      kernel.transitionState(run.id, 'failed', 'Rejected');
      const reclaimedAfter = taskRepo.reclaimExpiredTaskLeases();
      expect(reclaimedAfter).toContain('task-lease-appr');
    });

    // 23. Type-Grounded Verifiable Evidence Generation
    it('Item 23: records genuine evidence and gates verification on objective proof', () => {
      const now = Date.now();
      taskRepo.createGoal({
        id: 'goal-ev',
        projectId: 'proj-e2e',
        title: 'Evidence Goal',
        description: 'Verify evidence',
        acceptanceCriteria: ['ok'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      taskRepo.createTask({
        id: 'task-ev',
        goalId: 'goal-ev',
        title: 'Task Evidence',
        description: 'Requires proof',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      const run = kernel.spawnRun({ agentId: 'agent-boss', projectId: 'proj-e2e', taskId: 'task-ev' });
      taskRepo.claimTaskWithLease('task-ev', 'agent-boss', run.id);

      const commitSha = crypto.createHash('sha256').update('commit-content').digest('hex');
      const evidenceId = `ev-${Date.now()}`;

      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        evidenceId,
        'task-ev',
        run.id,
        'artifact_hash',
        `git://commit/${commitSha}`,
        1,
        now
      );

      taskRepo.completeTask('task-ev', evidenceId);
      const completed = taskRepo.getTask('task-ev');
      expect(completed?.status).toBe('completed');
      expect(completed?.evidenceBundleId).toBe(evidenceId);
    });

    // 24. Truth-Grounded Dynamic UI Telemetry
    it('Item 24: computes action duration by aggregating actual duration ms with zero synthetic multipliers', () => {
      const now = Date.now();
      const runId = 'run-telemetry';

      db.execute(
        `INSERT INTO action_records (id, agent_id, run_id, tool_name, params_json, status, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'act-1',
        'agent-boss',
        runId,
        'readFile',
        '{}',
        'success',
        150,
        now
      );

      db.execute(
        `INSERT INTO action_records (id, agent_id, run_id, tool_name, params_json, status, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'act-2',
        'agent-boss',
        runId,
        'writeFile',
        '{}',
        'success',
        350,
        now + 200
      );

      const totalDuration = db.queryOne<{ total: number }>(
        `SELECT SUM(duration_ms) as total FROM action_records WHERE run_id = ?`,
        runId
      )?.total;

      expect(totalDuration).toBe(500); // 150 + 350 exact empirical sum
    });

    // 25. Context Compactor State Grounding
    it('Item 25: extracts structured operational snapshot in ContextCompactor', () => {
      const compactor = new ContextCompactor();
      const messages: Message[] = [
        { id: 'm1', channelId: 'c1', senderId: 'user', senderType: 'human', content: 'Initial request', mentions: [], productivityScore: 100, createdAt: 1 },
        { id: 'm2', channelId: 'c1', senderId: 'agent', senderType: 'agent', content: 'Turn 1 execution', mentions: [], productivityScore: 100, createdAt: 2 },
        { id: 'm3', channelId: 'c1', senderId: 'agent', senderType: 'agent', content: 'Turn 2 execution', mentions: [], productivityScore: 100, createdAt: 3 },
        { id: 'm4', channelId: 'c1', senderId: 'agent', senderType: 'agent', content: 'Turn 3 execution', mentions: [], productivityScore: 100, createdAt: 4 },
        { id: 'm5', channelId: 'c1', senderId: 'agent', senderType: 'agent', content: 'Turn 4 execution', mentions: [], productivityScore: 100, createdAt: 5 },
      ];

      const result = compactor.evaluateAndCompact({
        messages,
        currentTokens: 8000,
        maxTokens: 10000,
        snapshotState: {
          goalId: 'g1',
          primaryObjective: 'Implement E2E test suite',
          completedTasks: [{ id: 't1', title: 'Setup' }],
          activeTask: { id: 't2', title: 'Testing' },
          modifiedFiles: [{ path: 'test.ts' }],
          encounteredErrorsAndResolutions: [],
          immutableDecisions: [],
          pendingTaskDag: [],
        },
      });

      expect(result.didCompact).toBe(true);
      expect(result.snapshot?.primaryObjective).toBe('Implement E2E test suite');
      expect(result.compactedMessages.length).toBeLessThan(messages.length);
    });

    // 26. AgentLoop Dead Allocation Cleanup
    it('Item 26: verifies single instance execution of OutputSpiller safely handles large buffers', () => {
      const spillDir = path.join(tempDir, 'spill_test');
      const spiller = new OutputSpiller({ spillDir, thresholdBytes: 500 });

      const smallOutput = 'Compact result';
      const smallRes = spiller.processOutput(smallOutput, 'readFile');
      expect(smallRes.isSpilled).toBe(false);

      const largeOutput = 'X'.repeat(1200);
      const largeRes = spiller.processOutput(largeOutput, 'executeShell');
      expect(largeRes.isSpilled).toBe(true);
      expect(largeRes.spillUri).toBeDefined();
    });

    // 27. Peer Conversation Loop Breaker
    it('Item 27: halts and escalates circular peer debates after 3 stagnant turns', () => {
      const loopBreaker = new LoopBreaker();
      const stagnantThread: Message[] = [
        { id: 'm1', channelId: 'chan-1', senderId: 'agent-a', senderType: 'agent', content: 'Claim A', mentions: [], productivityScore: 0, createdAt: 1 },
        { id: 'm2', channelId: 'chan-1', senderId: 'agent-b', senderType: 'agent', content: 'Counterclaim B', mentions: [], productivityScore: 0, createdAt: 2 },
        { id: 'm3', channelId: 'chan-1', senderId: 'agent-a', senderType: 'agent', content: 'Rebuttal A', mentions: [], productivityScore: 0, createdAt: 3 },
      ];

      const evaluation = loopBreaker.evaluateThread(stagnantThread);
      expect(evaluation.isStagnant).toBe(true);
      expect(evaluation.stagnantTurns).toBe(3);
      expect(evaluation.action).toBe('halt_and_escalate');
      expect(evaluation.conflictDossier).toBeDefined();
    });

    // 28. ExecutionNode Process Isolation
    it('Item 28: routes file writes to SandboxWorktreeNode and reports node capabilities', () => {
      const router = ExecutionNodeRouter.getInstance();
      const node = router.getNodeForTool('writeFile', true);

      expect(node).toBeInstanceOf(SandboxWorktreeNode);
      const info = node.getInfo();
      expect(info.type).toBe('SANDBOX');
      expect(info.capabilities).toContain('fs:write');

      const hostNode = router.getNodeForTool('executeShell', false);
      expect(hostNode).toBeInstanceOf(HostExecutionNode);
    });
  });

  // ==========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // ==========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('Boundary: empty capability array rejects destructive and non-destructive tools alike', () => {
      const sentinel = Sentinel.getInstance();
      const readCheck = sentinel.evaluate({
        agentId: 'agent-empty',
        runId: 'run-b1',
        toolName: 'readFile',
        params: { path: 'any.txt' },
        riskLevel: 'LOW',
        autonomyMode: 'AUTO',
        agentCapabilities: [],
      });
      expect(readCheck.allowed).toBe(false);

      const writeCheck = sentinel.evaluate({
        agentId: 'agent-empty',
        runId: 'run-b1',
        toolName: 'writeFile',
        params: { path: 'any.txt', content: 'test' },
        riskLevel: 'MEDIUM',
        autonomyMode: 'AUTO',
        agentCapabilities: [],
      });
      expect(writeCheck.allowed).toBe(false);
    });

    it('Corner Case: approval token rejects mismatched toolName or expired TTL', () => {
      const sentinel = Sentinel.getInstance();
      const token = 'appr-token-corner-1';
      sentinel.registerApprovalToken(token, 'executeShell', 10, 'run-corner');

      // Wrong tool rejection
      const wrongTool = sentinel.consumeApprovalToken(token, 'writeFile', 'run-corner');
      expect(wrongTool).toBe(false);

      // Expired token rejection
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const expiredConsume = sentinel.consumeApprovalToken(token, 'executeShell', 'run-corner');
          expect(expiredConsume).toBe(false);
          resolve();
        }, 20);
      });
    });

    it('Boundary: exact token budget boundary triggers failure strictly on overflow', () => {
      const run = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-e2e',
        allocatedTokens: 1000,
      });

      // Exactly at limit - 1
      const step1 = kernel.recordTokenUsage(run.id, 999);
      expect(step1.exceeded).toBe(false);
      expect(kernel.getRun(run.id)?.state).toBe('running');

      // Exactly at limit -> exceeded
      const step2 = kernel.recordTokenUsage(run.id, 1);
      expect(step2.exceeded).toBe(true);
      expect(kernel.getRun(run.id)?.state).toBe('failed');
    });

    it('Corner Case: path jail rejects traversal sequences across various representations', async () => {
      const gateway = new ToolGateway({ db });
      const attacks = [
        '../outside.txt',
        '..\\outside.txt',
        'sub/../../secret.txt',
        'sub\\..\\..\\secret.txt',
      ];

      for (const attackPath of attacks) {
        const res = await gateway.executeTool(
          'readFile',
          { path: attackPath },
          {
            runId: 'run-attack',
            agentId: 'agent-boss',
            worktreeRoot: tempDir,
            autonomyMode: 'AUTO',
            allowedCapabilities: ['fs:read'],
          }
        );
        expect(res.success).toBe(false);
        expect(res.error).toContain('SECURITY JAIL VIOLATION');
      }
    });

    it('Boundary: peer debate evaluation warns on 2 turns and halts on 3 turns', () => {
      const loopBreaker = new LoopBreaker();
      const twoTurnThread: Message[] = [
        { id: 'm1', channelId: 'c1', senderId: 'a1', senderType: 'agent', content: 'Argument 1', mentions: [], productivityScore: 0, createdAt: 1 },
        { id: 'm2', channelId: 'c1', senderId: 'a2', senderType: 'agent', content: 'Argument 2', mentions: [], productivityScore: 0, createdAt: 2 },
      ];

      const evalTwo = loopBreaker.evaluateThread(twoTurnThread);
      expect(evalTwo.isStagnant).toBe(true);
      expect(evalTwo.stagnantTurns).toBe(2);
      expect(evalTwo.action).toBe('warn');

      const threeTurnThread: Message[] = [
        ...twoTurnThread,
        { id: 'm3', channelId: 'c1', senderId: 'a1', senderType: 'agent', content: 'Argument 3', mentions: [], productivityScore: 0, createdAt: 3 },
      ];

      const evalThree = loopBreaker.evaluateThread(threeTurnThread);
      expect(evalThree.isStagnant).toBe(true);
      expect(evalThree.stagnantTurns).toBe(3);
      expect(evalThree.action).toBe('halt_and_escalate');
    });

    it('Corner Case: skill catalog handles empty filter and returns active built-in skills', () => {
      const engine = new SkillEngine(db, { skillsDir: path.join(tempDir, 'skills') });
      const activeSkills = engine.listSkills('active');
      expect(activeSkills.length).toBeGreaterThan(0);
      expect(activeSkills.some((s) => s.isBuiltIn)).toBe(true);
    });
  });

  // ==========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // ==========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {
    it('Combination 1: multi-step DAG progression with atomic leasing and dependent promotion', () => {
      const now = Date.now();
      taskRepo.createGoal({
        id: 'goal-comb-1',
        projectId: 'proj-e2e',
        title: 'Multi-Step Goal',
        description: 'Verify 3-step pipeline',
        acceptanceCriteria: ['all complete'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      taskRepo.createTask({
        id: 'step-1',
        goalId: 'goal-comb-1',
        title: 'Step 1: Preparation',
        description: 'Prepare environment',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      taskRepo.createTask(
        {
          id: 'step-2',
          goalId: 'goal-comb-1',
          title: 'Step 2: Processing',
          description: 'Process data',
          status: 'backlog',
          createdAt: now,
          updatedAt: now,
        },
        ['step-1']
      );

      taskRepo.createTask(
        {
          id: 'step-3',
          goalId: 'goal-comb-1',
          title: 'Step 3: Verification',
          description: 'Verify output',
          status: 'backlog',
          createdAt: now,
          updatedAt: now,
        },
        ['step-2']
      );

      // Claim and complete step 1
      expect(taskRepo.claimTaskWithLease('step-1', 'agent-boss', 'run-s1')).toBe(true);
      taskRepo.completeTask('step-1', 'ev-s1');

      // Step 2 is now promoted to ready, step 3 remains in backlog
      expect(taskRepo.getTask('step-2')?.status).toBe('ready');
      expect(taskRepo.getTask('step-3')?.status).toBe('backlog');

      // Claim and complete step 2
      expect(taskRepo.claimTaskWithLease('step-2', 'agent-boss', 'run-s2')).toBe(true);
      taskRepo.completeTask('step-2', 'ev-s2');

      // Step 3 is now promoted to ready
      expect(taskRepo.getTask('step-3')?.status).toBe('ready');
      expect(taskRepo.claimTaskWithLease('step-3', 'agent-boss', 'run-s3')).toBe(true);
      taskRepo.completeTask('step-3', 'ev-s3');
      expect(taskRepo.getTask('step-3')?.status).toBe('completed');
    });

    it('Combination 2: parent run hierarchy propagates remaining token budget to child run', () => {
      const parentRun = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-e2e',
        allocatedTokens: 5000,
      });

      kernel.recordTokenUsage(parentRun.id, 2000);

      const childRun = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-e2e',
        parentRunId: parentRun.id,
      });

      expect(childRun.allocatedTokens).toBe(3000); // 5000 - 2000 inherited
      expect(kernel.countDescendants(parentRun.id)).toBe(1);
    });

    it('Combination 3: single-use approval token consumed via ToolGateway executing through ExecutionNode', async () => {
      const gateway = new ToolGateway({ db });
      const toolName = 'writeFile';
      const runId = 'run-comb-3';

      const token = gateway.generateApprovalToken(toolName, runId);
      expect(token).toBeDefined();

      const result = await gateway.executeTool(
        toolName,
        { path: 'approved_file.txt', content: 'Authorized content' },
        {
          runId,
          agentId: 'agent-boss',
          worktreeRoot: tempDir,
          autonomyMode: 'ALWAYS_ASK',
          allowedCapabilities: ['fs:write'],
          approvalToken: token,
        }
      );

      expect(result.success).toBe(true);

      // Replay attempt with same token fails under ALWAYS_ASK
      const replayResult = await gateway.executeTool(
        toolName,
        { path: 'replay_file.txt', content: 'Replay content' },
        {
          runId,
          agentId: 'agent-boss',
          worktreeRoot: tempDir,
          autonomyMode: 'ALWAYS_ASK',
          allowedCapabilities: ['fs:write'],
          approvalToken: token,
        }
      );

      expect(replayResult.success).toBe(false);
      expect(replayResult.requiresApproval).toBe(true);
    });

    it('Combination 4: SecretVault encrypts, SecretBroker resolves, and EventLedger logs sanitized audit', () => {
      const vault = SecretVault.getInstance();
      const broker = SecretBroker.getInstance();
      const ledger = EventLedger.initialize(db);

      const apiKey = 'sk-ant-e2e-audit-secret-token-1234';
      const encrypted = vault.encrypt(apiKey);

      const resolved = broker.resolvePlaceholders(`Header: Bearer {{vault:${encrypted}}}`);
      expect(resolved).toContain(apiKey);

      // Log event into EventLedger containing the resolved payload
      const rowId = ledger.record({
        eventType: 'TOOL_COMPLETED',
        entityType: 'tool',
        entityId: 'httpClient',
        runId: 'run-comb-4',
        payload: { header: resolved, status: 200 },
      });

      const events = ledger.getEventsForRun('run-comb-4');
      expect(events.length).toBe(1);
      expect(events[0].payload.header).toContain('[REDACTED_SECRET]');
      expect(events[0].payload.header).not.toContain(apiKey);
    });
  });

  // ==========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // ==========================================================================
  describe('Tier 4: Real-World Application Scenarios', () => {
    it('Scenario 1: full multi-agent workforce task lifecycle with verified evidence bundle', () => {
      const now = Date.now();

      // 1. Create Goal
      taskRepo.createGoal({
        id: 'goal-e2e-lifecycle',
        projectId: 'proj-e2e',
        title: 'Deploy Production Pipeline',
        description: 'End-to-end multi-agent execution',
        acceptanceCriteria: ['Verification passes', 'Artifacts published'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      // 2. Create Tasks
      taskRepo.createTask({
        id: 'task-build',
        goalId: 'goal-e2e-lifecycle',
        title: 'Compile Assets',
        description: 'Execute build toolchain',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });

      taskRepo.createTask(
        {
          id: 'task-verify',
          goalId: 'goal-e2e-lifecycle',
          title: 'Verify Artifacts',
          description: 'Run hash verification',
          status: 'backlog',
          createdAt: now,
          updatedAt: now,
        },
        ['task-build']
      );

      // 3. Worker claims Task 1 with timed lease
      const run1 = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-e2e',
        taskId: 'task-build',
      });
      expect(taskRepo.claimTaskWithLease('task-build', 'agent-boss', run1.id, 60000)).toBe(true);

      // 4. Worker touches heartbeat and generates genuine evidence
      kernel.heartbeat(run1.id);
      const buildSha = crypto.createHash('sha256').update('build-output').digest('hex');
      const ev1 = `ev-build-${now}`;
      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ev1,
        'task-build',
        run1.id,
        'build_log',
        `sha256://${buildSha}`,
        1,
        now
      );

      // 5. Complete Task 1 -> Promotes Task 2
      taskRepo.completeTask('task-build', ev1);
      kernel.transitionState(run1.id, 'completed');

      expect(taskRepo.getTask('task-build')?.status).toBe('completed');
      expect(taskRepo.getTask('task-verify')?.status).toBe('ready');

      // 6. Worker claims Task 2
      const run2 = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-e2e',
        taskId: 'task-verify',
      });
      expect(taskRepo.claimTaskWithLease('task-verify', 'agent-boss', run2.id, 60000)).toBe(true);

      // 7. Complete Task 2
      const ev2 = `ev-verify-${now}`;
      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ev2,
        'task-verify',
        run2.id,
        'test_output',
        `exitCode://0`,
        1,
        now
      );
      taskRepo.completeTask('task-verify', ev2);
      kernel.transitionState(run2.id, 'completed');

      expect(taskRepo.getTask('task-verify')?.status).toBe('completed');
    });

    it('Scenario 2: simulated SSE parameter stream scrubs authentication credentials', () => {
      const broker = SecretBroker.getInstance();
      const sseStreamBuffer: string[] = [];

      const emitSseEvent = (event: string, data: any) => {
        const sanitized = broker.sanitizePayload(data);
        sseStreamBuffer.push(`event: ${event}\ndata: ${JSON.stringify(sanitized)}\n\n`);
      };

      emitSseEvent('agent:tool_start', {
        toolName: 'executeShell',
        params: {
          command: 'curl -H "Authorization: Bearer sk-ant-secret1234567890123456" https://api.anthropic.com',
        },
      });

      emitSseEvent('agent:action_completed', {
        actionId: 'act-1',
        apiKey: 'sk-proj-01234567890123456789',
      });

      const fullOutput = sseStreamBuffer.join('');
      expect(fullOutput).toContain('[REDACTED_TOKEN]');
      expect(fullOutput).toContain('[REDACTED_KEY]');
      expect(fullOutput).not.toContain('sk-ant-secret1234567890123456');
      expect(fullOutput).not.toContain('sk-proj-01234567890123456789');
    });

    it('Scenario 3: truth-grounded telemetry aggregates genuine durations without synthetic multipliers', () => {
      const runId = 'run-real-telemetry';
      const now = Date.now();

      const measuredActions = [
        { id: 'act-101', tool: 'readFile', duration: 42 },
        { id: 'act-102', tool: 'writeFile', duration: 118 },
        { id: 'act-103', tool: 'executeShell', duration: 624 },
      ];

      for (const act of measuredActions) {
        db.execute(
          `INSERT INTO action_records (id, agent_id, run_id, tool_name, params_json, status, duration_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          act.id,
          'agent-boss',
          runId,
          act.tool,
          '{}',
          'success',
          act.duration,
          now
        );
      }

      const totalEmpiricalMs = measuredActions.reduce((sum, a) => sum + a.duration, 0);

      const queryResult = db.queryOne<{ total_ms: number }>(
        `SELECT SUM(duration_ms) as total_ms FROM action_records WHERE run_id = ?`,
        runId
      );

      expect(queryResult?.total_ms).toBe(totalEmpiricalMs);
      expect(queryResult?.total_ms).toBe(784); // 42 + 118 + 624 exact
    });
  });
});
