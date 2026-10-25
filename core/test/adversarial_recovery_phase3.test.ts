import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import { AgentLoopRunner } from '../src/kernel/agent_loop.js';
import { RecoveryEngine } from '../src/recovery/recovery_engine.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { SchedulerService } from '../src/automation/scheduler.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Phase 3 Adversarial Recovery, State Machine & Quota Guard', () => {
  let db: KinDatabase;
  let testDir: string;
  let kernel: AgentKernel;
  let skillEngine: SkillEngine;
  let recoveryEngine: RecoveryEngine;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-phase3-'));
    db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    kernel = new AgentKernel(db);
    skillEngine = new SkillEngine(db);
    recoveryEngine = new RecoveryEngine(skillEngine);

    const now = Date.now();
    const wsRepo = new WorkspaceRepository(db);
    wsRepo.createWorkspace({
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: testDir,
      defaultAutonomyMode: 'AUTO',
      createdAt: now,
      updatedAt: now,
    });

    wsRepo.createProject({
      id: 'proj-test',
      workspaceId: 'ws-test',
      name: 'Test Project',
      repoPath: testDir,
      createdAt: now,
      updatedAt: now,
    });

    const agentRepo = new AgentRepository(db);
    agentRepo.createDefinition({
      id: 'def-boss',
      name: 'Boss',
      role: 'Principal Orchestrator',
      systemPrompt: 'You are the orchestrator',
      defaultModelId: 'claude-3-5-sonnet',
      domainAuthority: [],
      capabilities: ['*'],
      createdAt: now,
    });

    agentRepo.createIdentity({
      id: 'agent-boss',
      workspaceId: 'ws-test',
      definitionId: 'def-boss',
      projectId: 'proj-test',
      displayName: '@Boss',
      activeModelId: 'openrouter/anthropic/claude-3.5-sonnet',
      isOrchestrator: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe('AgentKernel State Machine Hardening', () => {
    it('spawns a run with modelId and persists correctly', () => {
      const run = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-test',
        modelId: 'google/gemini-2.5-flash',
      });

      expect(run.id).toBeDefined();
      expect(run.state).toBe('running');
      expect(run.modelId).toBe('google/gemini-2.5-flash');

      const fetched = kernel.getRun(run.id);
      expect(fetched).toBeDefined();
      expect(fetched?.modelId).toBe('google/gemini-2.5-flash');
      expect(fetched?.state).toBe('running');
    });

    it('enforces idempotency on state transitions to identical state', () => {
      const run = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-test',
      });

      // Calling transitionState with current state should safely no-op
      expect(() => {
        kernel.transitionState(run.id, 'running');
      }).not.toThrow();

      expect(kernel.getRun(run.id)?.state).toBe('running');
    });

    it('blocks illegal transitions from terminal states', () => {
      const run = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-test',
      });

      kernel.transitionState(run.id, 'completed', 'Work finished');
      expect(kernel.getRun(run.id)?.state).toBe('completed');

      // Attempting to transition from terminal state must throw
      expect(() => {
        kernel.transitionState(run.id, 'running');
      }).toThrow(/Cannot transition run from terminal state 'completed' to 'running'/);

      expect(() => {
        kernel.pauseForQuota(run.id, 60000);
      }).toThrow(/Cannot pause terminal run/);

      expect(() => {
        kernel.resumeRun(run.id);
      }).toThrow(/Cannot resume terminal run/);
    });

    it('handles quota pause, backoff reset timestamps, and ready-to-resume queries', () => {
      const run1 = kernel.spawnRun({ agentId: 'agent-boss', projectId: 'proj-test' });
      const run2 = kernel.spawnRun({ agentId: 'agent-boss', projectId: 'proj-test' });

      // Pause run1 with reset window in the past (-10 seconds)
      kernel.pauseForQuota(run1.id, -10000);
      // Pause run2 with reset window in the future (+15 minutes)
      kernel.pauseForQuota(run2.id, 900000);

      expect(kernel.getRun(run1.id)?.state).toBe('quota_paused');
      expect(kernel.getRun(run2.id)?.state).toBe('quota_paused');

      const ready = kernel.getRunsReadyToResumeFromQuota();
      expect(ready.some((r) => r.id === run1.id)).toBe(true);
      expect(ready.some((r) => r.id === run2.id)).toBe(false);

      // Resuming run1 clears quota timestamp and resets state to running
      kernel.resumeRun(run1.id);
      const resumed = kernel.getRun(run1.id);
      expect(resumed?.state).toBe('running');
      expect(resumed?.quotaResetsAt).toBeNull();
    });
  });

  describe('Stale Run Recovery and Checkpoint Restoration', () => {
    it('detects dead heartbeat leases and restores turn checkpoint snapshots', () => {
      const run = kernel.spawnRun({
        agentId: 'agent-boss',
        projectId: 'proj-test',
      });

      // Save a turn checkpoint snapshot
      const snapshot = {
        turn: 4,
        conversationHistory: [
          { role: 'user', content: 'Audit the system' },
          { role: 'assistant', content: 'Auditing layer 3' },
        ],
        actions: [{ toolName: 'readFile', params: { filePath: 'package.json' }, durationMs: 40 }],
      };
      kernel.saveCheckpoint(run.id, snapshot);

      // Manually simulate stale heartbeat (stale by 60 seconds)
      const past = Date.now() - 60000;
      db.execute('UPDATE agent_runs SET heartbeat_at = ?, interrupted_turn = 4 WHERE id = ?', past, run.id);

      // Watchdog stale inspection
      const recovered = kernel.recoverStaleRunsDetailed(45000);
      expect(recovered.length).toBeGreaterThan(0);
      const target = recovered.find((r) => r.id === run.id);
      expect(target).toBeDefined();
      expect(target?.agentId).toBe('agent-boss');
      expect(target?.interruptedTurn).toBe(4);
      expect(target?.checkpoint).toBeDefined();

      const parsedCp = JSON.parse(target!.checkpoint!.snapshotJson);
      expect(parsedCp.turn).toBe(4);
      expect(parsedCp.conversationHistory.length).toBe(2);

      // Status in DB should now be 'recovering'
      expect(kernel.getRun(run.id)?.state).toBe('recovering');
    });
  });

  describe('RecoveryEngine Verification & Self-Healing Diagnostics', () => {
    it('detects state stagnation when UI action produced zero mutations', () => {
      const preState = {
        timestamp: Date.now() - 1000,
        type: 'browser' as const,
        url: 'http://localhost:3000/dashboard',
        title: 'KIN Dashboard',
        domSnippet: '<button id="submit">Submit</button>',
      };
      const postState = { ...preState, timestamp: Date.now() };

      const result = recoveryEngine.verify(preState, postState, {
        expectedUrlPattern: 'http://localhost:3000/settings',
      });

      expect(result.passed).toBe(false);
      expect(result.discrepancies.some((d) => d.includes('URL did not match expectation'))).toBe(true);
      expect(result.suggestedRecoveryStrategy).toBeDefined();
    });

    it('verifies filesystem mutations and flags missing changes', () => {
      const preState = {
        timestamp: Date.now() - 500,
        type: 'filesystem' as const,
        hashOrSignature: 'abc123hash',
      };
      const postStateUnchanged = {
        timestamp: Date.now(),
        type: 'filesystem' as const,
        hashOrSignature: 'abc123hash',
      };

      const result = recoveryEngine.verify(preState, postStateUnchanged, {
        expectedFileChange: 'config.json',
      });

      expect(result.passed).toBe(false);
      expect(result.discrepancies.some((d) => d.includes('Expected file mutation'))).toBe(true);
    });

    it('safely handles hostile regex patterns to prevent ReDoS', () => {
      const preState = { timestamp: Date.now(), type: 'browser' as const, title: 'Test' };
      const postState = { timestamp: Date.now(), type: 'browser' as const, title: 'Test Page' };

      // ReDoS pattern with nested quantifiers
      const hostilePattern = '(a+)+$';
      const result = recoveryEngine.verify(preState, postState, {
        expectedTitlePattern: hostilePattern,
      });

      // Must fail safely without locking the thread or throwing unhandled exception
      expect(result.passed).toBe(false);
      expect(result.discrepancies.length).toBeGreaterThan(0);
    });
  });

  describe('AgentLoopRunner Quota Guard & Recovery Flow', () => {
    it('gracefully pauses on HTTP 429 / resource exhausted errors and preserves checkpoint', async () => {
      let checkpointSaved = false;
      let quotaPausedTriggered = false;

      // Mock model gateway returning 429 quota error
      const mockModelGateway = {
        invoke: async () => ({
          content: 'HTTP 429 Rate limit exceeded: RESOURCE_EXHAUSTED',
          isError: true,
          tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          durationMs: 10,
        }),
      };

      const toolGateway = new ToolGateway({ db });
      const runner = new AgentLoopRunner(
        mockModelGateway as any,
        toolGateway,
        new SchedulerService(db),
        skillEngine,
        recoveryEngine
      );

      const run = kernel.spawnRun({ agentId: 'agent-boss', projectId: 'proj-test' });

      const result = await runner.execute({
        runId: run.id,
        agentId: 'agent-boss',
        modelId: 'openrouter/anthropic/claude-3.5-sonnet',
        projectId: 'proj-test',
        channelId: 'chan-test',
        userPrompt: 'Start intensive analysis',
        systemPrompt: 'You are an agent',
        worktreeRoot: testDir,
        autonomyMode: 'AUTO',
        maxTurns: 3,
        onTurnCheckpoint: () => {
          checkpointSaved = true;
        },
        onQuotaPaused: () => {
          quotaPausedTriggered = true;
        },
      });

      expect(result.isQuotaPaused).toBe(true);
      expect(result.quotaResetAt).toBeGreaterThan(Date.now());
      expect(checkpointSaved).toBe(true);
      expect(quotaPausedTriggered).toBe(true);
    });

    it('prevents consecutive identical failing tool invocations with Self-Healing Guard', async () => {
      let turn = 0;
      const mockModelGateway = {
        invoke: async () => {
          turn++;
          if (turn === 1) {
            return {
              content: '<tool_call>{"name": "readFile", "parameters": {"filePath": "non_existent_file.txt"}}</tool_call>',
              tokensUsed: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
              durationMs: 10,
            };
          }
          if (turn === 2) {
            // Model tries to invoke the exact same failing tool with identical parameters
            return {
              content: '<tool_call>{"name": "readFile", "parameters": {"filePath": "non_existent_file.txt"}}</tool_call>',
              tokensUsed: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
              durationMs: 10,
            };
          }
          return {
            content: 'I observed the file does not exist, so I have completed the investigation.',
            tokensUsed: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            durationMs: 10,
          };
        },
      };

      const toolGateway = new ToolGateway({ db });
      const runner = new AgentLoopRunner(
        mockModelGateway as any,
        toolGateway,
        new SchedulerService(db),
        skillEngine,
        recoveryEngine
      );

      const run = kernel.spawnRun({ agentId: 'agent-boss', projectId: 'proj-test' });

      const result = await runner.execute({
        runId: run.id,
        agentId: 'agent-boss',
        modelId: 'openrouter/anthropic/claude-3.5-sonnet',
        projectId: 'proj-test',
        channelId: 'chan-test',
        userPrompt: 'Examine missing file',
        systemPrompt: 'You are an agent',
        worktreeRoot: testDir,
        autonomyMode: 'AUTO',
        maxTurns: 5,
      });

      // Verify that turn 2 encountered the Self-Healing Guard block
      const blockedAction = result.actions.find((a) => a.error && a.error.includes('SELF-HEALING GUARD'));
      expect(blockedAction).toBeDefined();
      expect(result.finalContent).toContain('completed the investigation');
    });
  });
});
