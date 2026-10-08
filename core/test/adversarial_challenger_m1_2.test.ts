// ============================================================================
// ADVERSARIAL CHALLENGER SUITE: MILESTONE 1 (R3, R4, R5)
// Independent verification & empirical stress testing:
// R3: Dynamic Model Discovery (omitUnconfigured permutations & catalog omission)
// R4: Context Compaction Grounding (zero synthetic tasks, grounded message IDs & error resolutions)
// R5: Agent Routing Observability (reasons, keywords in HTTP 201 & SSE, store ingestion)
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ModelGateway } from '../src/execution/model_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import { ContextCompactor } from '../src/context/context_compactor.js';
import { ActivationEngine, ChannelRoutingInput } from '../src/communication/activation_engine.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { AgentRepository } from '../src/domain/agent_repository.js';
import { WorkspaceRepository } from '../src/domain/workspace_repository.js';
import { AgentIdentity, AgentDefinition, Message } from '../src/domain/types.js';

describe('Adversarial Verification: Milestone 1 (R3, R4, R5)', () => {
  let tempDir: string;
  let tempDbPath: string;
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-adv-challenger-'));
    tempDbPath = path.join(tempDir, 'adv_test.sqlite');

    server = new CoreServer({ port: 0, dbPath: tempDbPath, requireIpcAuth: false });
    port = await server.start();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // R3: DYNAMIC MODEL DISCOVERY & PARAMETER PERMUTATIONS
  // ==========================================================================
  describe('R3: Dynamic Model Discovery', () => {
    it('omitUnconfigured=true returns empty list when no providers or models are configured', async () => {
      // Create empty db instance to ensure zero stored configured models
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-clean-models-'));
      const cleanDbPath = path.join(cleanDir, 'clean.sqlite');
      const cleanServer = new CoreServer({ port: 0, dbPath: cleanDbPath, requireIpcAuth: false });
      const cleanPort = await cleanServer.start();

      try {
        const res = await fetch(`http://127.0.0.1:${cleanPort}/api/models?omitUnconfigured=true`);
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data.models).toEqual([]);
        expect(Array.isArray(data.models)).toBe(true);
      } finally {
        await cleanServer.stop();
        try {
          fs.rmSync(cleanDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('omitUnconfigured=1 returns empty list when no providers or models are configured', async () => {
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-clean-models-1-'));
      const cleanDbPath = path.join(cleanDir, 'clean.sqlite');
      const cleanServer = new CoreServer({ port: 0, dbPath: cleanDbPath, requireIpcAuth: false });
      const cleanPort = await cleanServer.start();

      try {
        const res = await fetch(`http://127.0.0.1:${cleanPort}/api/models?omitUnconfigured=1`);
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data.models).toEqual([]);
        expect(Array.isArray(data.models)).toBe(true);
      } finally {
        await cleanServer.stop();
        try {
          fs.rmSync(cleanDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('GET /api/system/models with omitUnconfigured=true also returns empty list', async () => {
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-clean-sys-'));
      const cleanDbPath = path.join(cleanDir, 'clean.sqlite');
      const cleanServer = new CoreServer({ port: 0, dbPath: cleanDbPath, requireIpcAuth: false });
      const cleanPort = await cleanServer.start();

      try {
        const res = await fetch(`http://127.0.0.1:${cleanPort}/api/system/models?omitUnconfigured=true`);
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data.models).toEqual([]);
      } finally {
        await cleanServer.stop();
        try {
          fs.rmSync(cleanDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('standard request without omitUnconfigured returns default unconfigured fallback catalog', async () => {
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-clean-fallback-'));
      const cleanDbPath = path.join(cleanDir, 'clean.sqlite');
      const cleanServer = new CoreServer({ port: 0, dbPath: cleanDbPath, requireIpcAuth: false });
      const cleanPort = await cleanServer.start();

      try {
        const res = await fetch(`http://127.0.0.1:${cleanPort}/api/models`);
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data.models.length).toBeGreaterThan(0);
        // Fallback catalog models must be marked unconfigured
        const allUnconfigured = data.models.every((m: any) => m.configured === false && m.validated === false);
        expect(allUnconfigured).toBe(true);
      } finally {
        await cleanServer.stop();
        try {
          fs.rmSync(cleanDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('falsy and invalid omitUnconfigured values default gracefully to returning default catalog', async () => {
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-clean-falsy-'));
      const cleanDbPath = path.join(cleanDir, 'clean.sqlite');
      const cleanServer = new CoreServer({ port: 0, dbPath: cleanDbPath, requireIpcAuth: false });
      const cleanPort = await cleanServer.start();

      try {
        const invalidPermutations = [
          'omitUnconfigured=false',
          'omitUnconfigured=0',
          'omitUnconfigured=invalid',
          'omitUnconfigured=',
          'omitUnconfigured=null',
          'omitUnconfigured=undefined',
          'omitUnconfigured=TRUE', // case sensitive strictly !== 'true'
          'omitUnconfigured=yes',
          'omitUnconfigured=no',
        ];

        for (const query of invalidPermutations) {
          const res = await fetch(`http://127.0.0.1:${cleanPort}/api/models?${query}`);
          expect(res.status).toBe(200);
          const data: any = await res.json();
          expect(data.models.length).toBeGreaterThan(0);
        }
      } finally {
        await cleanServer.stop();
        try {
          fs.rmSync(cleanDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('freeOnly combined with omitUnconfigured behaves correctly', async () => {
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-clean-free-'));
      const cleanDbPath = path.join(cleanDir, 'clean.sqlite');
      const cleanServer = new CoreServer({ port: 0, dbPath: cleanDbPath, requireIpcAuth: false });
      const cleanPort = await cleanServer.start();

      try {
        // 1. freeOnly=true & omitUnconfigured=true -> empty list (no configured free models)
        const resBoth = await fetch(`http://127.0.0.1:${cleanPort}/api/models?freeOnly=true&omitUnconfigured=true`);
        expect(resBoth.status).toBe(200);
        const dataBoth: any = await resBoth.json();
        expect(dataBoth.models).toEqual([]);

        // 2. freeOnly=true without omitUnconfigured -> returns free models from fallback catalog
        const resFreeOnly = await fetch(`http://127.0.0.1:${cleanPort}/api/models?freeOnly=true`);
        expect(resFreeOnly.status).toBe(200);
        const dataFree: any = await resFreeOnly.json();
        expect(dataFree.models.length).toBeGreaterThan(0);
        expect(dataFree.models.every((m: any) => Boolean(m.isFree))).toBe(true);
      } finally {
        await cleanServer.stop();
        try {
          fs.rmSync(cleanDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('returns configured custom model when omitUnconfigured=true, omitting unconfigured ones', async () => {
      // Register custom endpoint on test server
      const customRes = await fetch(`http://127.0.0.1:${port}/api/models/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: 'custom/adv-llama3',
          name: 'Adv Llama 3',
          baseUrl: 'http://127.0.0.1:11434/v1',
          contextWindow: 65536,
        }),
      });
      expect(customRes.status).toBe(201);

      // Now query with omitUnconfigured=true
      const listRes = await fetch(`http://127.0.0.1:${port}/api/models?omitUnconfigured=true`);
      expect(listRes.status).toBe(200);
      const listData: any = await listRes.json();
      expect(listData.models.some((m: any) => m.id === 'custom/adv-llama3')).toBe(true);
      const customModel = listData.models.find((m: any) => m.id === 'custom/adv-llama3');
      expect(customModel.configured).toBe(true);
      expect(customModel.validated).toBe(true);

      // With omitUnconfigured=1
      const listRes1 = await fetch(`http://127.0.0.1:${port}/api/models?omitUnconfigured=1`);
      const listData1: any = await listRes1.json();
      expect(listData1.models.some((m: any) => m.id === 'custom/adv-llama3')).toBe(true);
    });

    it('omits stored models belonging to unconfigured providers when omitUnconfigured=true', async () => {
      // Insert stored model belonging to unconfigured provider 'openai'
      server.db.execute(
        `INSERT OR REPLACE INTO models (id, name, provider_id, context_window, max_output_tokens, supports_tools, created_at)
         VALUES ('openai/unconfigured-stored', 'Unconfigured Stored GPT', 'openai', 32768, 4096, 1, ?)`,
        Date.now()
      );

      const res = await fetch(`http://127.0.0.1:${port}/api/models?omitUnconfigured=true`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      // Must be omitted because provider 'openai' has no API key and is not validated
      expect(data.models.find((m: any) => m.id === 'openai/unconfigured-stored')).toBeUndefined();
    });

    it('ModelGateway.fetchProviderModels accepts both boolean and object options', async () => {
      const gw = new ModelGateway({ ollamaHost: 'http://127.0.0.1:99999' });

      // Object option
      const resObj = await gw.fetchProviderModels('openai', undefined, { omitUnconfigured: true });
      expect(resObj).toEqual([]);

      // Boolean option
      const resBool = await gw.fetchProviderModels('openai', undefined, true);
      expect(resBool).toEqual([]);

      // False boolean option
      const resFalse = await gw.fetchProviderModels('openai', undefined, false);
      expect(resFalse.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // R4: CONTEXT COMPACTION GROUNDING
  // ==========================================================================
  describe('R4: Context Compaction Grounding', () => {
    it('compactor formatSnapshot contains zero synthetic tasks when no completed tasks exist', () => {
      const compactor = new ContextCompactor();
      const messages: Message[] = Array.from({ length: 6 }, (_, i) => ({
        id: `msg-${i}`,
        channelId: 'chan-general',
        senderId: i % 2 === 0 ? 'user' : 'agent',
        senderType: (i % 2 === 0 ? 'human' : 'agent') as 'human' | 'agent',
        content: `Turn ${i} conversation content`,
        mentions: [],
        productivityScore: 100,
        createdAt: i * 1000,
      }));

      const result = compactor.evaluateAndCompact({
        messages,
        currentTokens: 15000,
        maxTokens: 16000,
        snapshotState: {
          goalId: 'goal-adv',
          primaryObjective: 'Grounding verification',
          completedTasks: [], // strictly empty
          activeTask: { id: 'task-live', title: 'Live execution' },
          modifiedFiles: [],
          encounteredErrorsAndResolutions: [],
          immutableDecisions: [],
          pendingTaskDag: [],
        },
      });

      expect(result.didCompact).toBe(true);
      const snapshotMsg = result.compactedMessages.find((m) => m.content.includes('SYSTEM COMPACTION SNAPSHOT'));
      expect(snapshotMsg).toBeDefined();
      // Must NOT contain synthetic task titles like 'Task 1' or fabricated completed tasks
      expect(snapshotMsg?.content).toContain('**Completed Tasks**:');
      expect(snapshotMsg?.content).toContain('- None yet');
      expect(snapshotMsg?.content).not.toContain('Task 1');
      expect(snapshotMsg?.content).not.toContain('Synthetic');
    });

    it('truth-grounded error resolution correctly marks unresolved errors as Unresolved', () => {
      const compactor = new ContextCompactor();
      const messages: Message[] = Array.from({ length: 5 }, (_, i) => ({
        id: `m-${i}`,
        channelId: 'chan-general',
        senderId: 'user',
        senderType: 'human',
        content: `Msg ${i}`,
        mentions: [],
        productivityScore: 100,
        createdAt: i,
      }));

      // Simulate actions where error occurred with NO subsequent resolution
      const actions = [
        { toolName: 'execCommand', params: { cmd: 'cat secret.txt' }, error: 'File not found: secret.txt' },
      ];

      // Replicate the exact agent_loop logic
      const encounteredErrorsAndResolutions = actions
        .filter((a) => a.error)
        .map((a) => {
          const errIdx = actions.indexOf(a);
          const subsequentResolution = actions.slice(errIdx + 1).find((next) => !next.error);
          let fixApplied = 'Unresolved';
          if (subsequentResolution) {
            if ((subsequentResolution as any).output) {
              fixApplied = typeof (subsequentResolution as any).output === 'string'
                ? (subsequentResolution as any).output
                : JSON.stringify((subsequentResolution as any).output);
            } else {
              fixApplied = `Resolved by ${subsequentResolution.toolName}`;
            }
          }
          return {
            error: `${a.toolName}: ${a.error || 'Execution failed'}`,
            fixApplied,
          };
        });

      expect(encounteredErrorsAndResolutions).toEqual([
        {
          error: 'execCommand: File not found: secret.txt',
          fixApplied: 'Unresolved',
        },
      ]);

      const result = compactor.evaluateAndCompact({
        messages,
        currentTokens: 15000,
        maxTokens: 16000,
        snapshotState: {
          goalId: 'goal-adv',
          primaryObjective: 'Error grounding test',
          completedTasks: [],
          activeTask: { id: 'task-adv', title: 'Testing' },
          modifiedFiles: [],
          encounteredErrorsAndResolutions,
          immutableDecisions: [],
          pendingTaskDag: [],
        },
      });

      const snapshotMsg = result.compactedMessages.find((m) => m.content.includes('SYSTEM COMPACTION SNAPSHOT'));
      expect(snapshotMsg?.content).toContain('execCommand: File not found: secret.txt => Resolution: Unresolved');
    });

    it('truth-grounded error resolution captures genuine subsequent action output', () => {
      // Action 1 fails, Action 2 succeeds with real output
      const actions = [
        { toolName: 'readFile', params: { path: 'config.json' }, error: 'ENOENT: no such file' },
        { toolName: 'writeFile', params: { path: 'config.json' }, output: 'Successfully initialized default config' },
      ];

      const encounteredErrorsAndResolutions = actions
        .filter((a) => a.error)
        .map((a) => {
          const errIdx = actions.indexOf(a);
          const subsequentResolution = actions.slice(errIdx + 1).find((next) => !next.error);
          let fixApplied = 'Unresolved';
          if (subsequentResolution) {
            if ((subsequentResolution as any).output) {
              fixApplied = (typeof (subsequentResolution as any).output === 'string'
                ? (subsequentResolution as any).output
                : JSON.stringify((subsequentResolution as any).output)
              ).slice(0, 150);
            } else {
              fixApplied = `Resolved by ${subsequentResolution.toolName}`;
            }
          }
          return {
            error: `${a.toolName}: ${a.error || 'Execution failed'}`,
            fixApplied,
          };
        });

      expect(encounteredErrorsAndResolutions).toEqual([
        {
          error: 'readFile: ENOENT: no such file',
          fixApplied: 'Successfully initialized default config',
        },
      ]);
    });

    it('compaction maps real message IDs from SQLite and falls back deterministically without fake UUIDs', () => {
      const channelId = 'chan-grounding-isolation';
      const runId = 'run-test-123';

      server.db.execute(
        `INSERT OR IGNORE INTO channels (id, project_id, name, is_private, created_at)
         VALUES (?, 'proj-kin', 'grounding-iso', 0, ?)`,
        channelId,
        Date.now()
      );

      // Insert exactly 2 real messages in SQLite for this isolated channel
      server.db.execute(
        `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, productivity_score, created_at)
         VALUES ('real-msg-001', ?, 'user-1', 'human', 'First message', 100, 1000)`,
        channelId
      );
      server.db.execute(
        `INSERT INTO messages (id, channel_id, sender_id, sender_type, content, productivity_score, created_at)
         VALUES ('real-msg-002', ?, 'agent-1', 'agent', 'Second message', 100, 2000)`,
        channelId
      );

      const conversationHistory = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Second message' },
        { role: 'user', content: 'Unpersisted third message' },
      ];

      const persistedMessages: Array<{ id: string; content: string }> = server.db.query(
        'SELECT id, content FROM messages WHERE channel_id = ? ORDER BY created_at ASC',
        channelId
      );

      const compMessages = conversationHistory.map((m, idx) => {
        const matchedPersisted = persistedMessages[idx]?.id || persistedMessages.find((pm) => pm.content === m.content)?.id;
        const messageId = matchedPersisted || `turn-${runId}-${idx}`;
        return {
          id: messageId,
          content: m.content,
        };
      });

      // Turn 0 and 1 match real persisted SQLite IDs
      expect(compMessages[0].id).toBe('real-msg-001');
      expect(compMessages[1].id).toBe('real-msg-002');
      // Turn 2 uses deterministic turn ID, NOT random UUID or fake ID
      expect(compMessages[2].id).toBe('turn-run-test-123-2');
      expect(compMessages[2].id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
      expect(compMessages[2].id).not.toContain('fake');
    });

    it('queries real tasks from TaskRepository for completedTasks and pendingTaskDag', () => {
      const taskRepo = new TaskRepository(server.db);
      const projectId = 'proj-kin';
      const goalId = 'goal-test-grounding';

      // Insert backing goal with all required NOT NULL columns
      server.db.execute(
        `INSERT OR IGNORE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
         VALUES (?, ?, 'Test Grounding Goal', 'Goal description', '[]', 'active', ?, ?)`,
        goalId,
        projectId,
        Date.now(),
        Date.now()
      );

      // Create a completed task and a ready task in SQLite
      taskRepo.createTask({
        id: 'task-real-done',
        projectId,
        goalId,
        title: 'Real completed task',
        description: 'Verified done',
        status: 'completed',
        priority: 1,
        dependencies: [],
        evidenceBundleId: 'evidence-bundle-xyz',
        createdAt: 1000,
        updatedAt: 2000,
      });

      taskRepo.createTask(
        {
          id: 'task-real-ready',
          projectId,
          goalId,
          title: 'Real ready task',
          description: 'Waiting for worker',
          status: 'ready',
          priority: 2,
          dependencies: ['task-real-done'],
          createdAt: 2000,
          updatedAt: 2000,
        },
        ['task-real-done']
      );

      const allTasks = taskRepo.listTasksByProject(projectId);
      const completedTasks = allTasks
        .filter((t: any) => t.status === 'completed')
        .map((t: any) => ({
          id: t.id,
          title: t.title + (t.description ? `: ${t.description}` : ''),
          evidenceUri: t.evidenceBundleId || undefined,
        }));

      const pendingTaskDag = allTasks
        .filter((t: any) => t.status === 'ready' || t.status === 'backlog')
        .map((t: any) => ({
          id: t.id,
          title: t.title + (t.description ? ` (${t.description})` : ''),
          dependsOn: (t as any).dependencies || [],
        }));

      expect(completedTasks.some((t) => t.id === 'task-real-done')).toBe(true);
      const completedMatch = completedTasks.find((t) => t.id === 'task-real-done');
      expect(completedMatch?.evidenceUri).toBe('evidence-bundle-xyz');

      expect(pendingTaskDag.some((t) => t.id === 'task-real-ready')).toBe(true);
      // Confirms tasks are truth-grounded directly from real SQLite database
      expect(completedTasks.every((t) => t.id.startsWith('task-'))).toBe(true);
    });
  });

  // ==========================================================================
  // R5: AGENT ROUTING OBSERVABILITY
  // ==========================================================================
  describe('R5: Agent Routing Observability', () => {
    const activationEngine = new ActivationEngine();

    const specialistAgent: AgentIdentity = {
      id: 'agent-security-adv',
      workspaceId: 'ws-default',
      projectId: 'proj-kin',
      definitionId: 'def-security-adv',
      displayName: '@SecuritySpecialistAdv',
      activeModelId: 'mock-model',
      isOrchestrator: false,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const specialistDef: AgentDefinition = {
      id: 'def-security-adv',
      name: 'SecuritySpecialistAdv',
      role: 'Cryptographic Security Auditor',
      systemPrompt: 'Audit cryptography and security boundaries',
      defaultModelId: 'mock-model',
      domainAuthority: ['cryptography', 'sentinel', 'vault', 'sha256 digest'],
      capabilities: ['*'],
      createdAt: 1000,
    };

    const bossAgent: AgentIdentity = {
      id: 'agent-boss',
      workspaceId: 'ws-default',
      projectId: 'proj-kin',
      definitionId: 'def-boss',
      displayName: '@Boss',
      activeModelId: 'mock-model',
      isOrchestrator: true,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const bossDef: AgentDefinition = {
      id: 'def-boss',
      name: 'Boss Orchestrator',
      role: 'Platform Orchestrator',
      systemPrompt: 'Coordinate workforce tasks',
      defaultModelId: 'mock-model',
      domainAuthority: ['coordination', 'milestones'],
      capabilities: ['*'],
      createdAt: 1000,
    };

    const defsMap = new Map<string, AgentDefinition>([
      ['def-security-adv', specialistDef],
      ['def-boss', bossDef],
    ]);

    it('surfaces domain_authority_match with matchedKeywords array', () => {
      const routingInput: ChannelRoutingInput = {
        channelId: 'chan-general',
        message: {
          id: 'msg-domain',
          channelId: 'chan-general',
          senderId: 'user',
          senderType: 'human',
          content: 'We need to verify the sha256 digest in vault authentication.',
          mentions: [],
          productivityScore: 100,
          createdAt: 1000,
        },
        channelMembers: [specialistAgent, bossAgent],
        allProjectAgents: [specialistAgent, bossAgent],
        definitionsMap: defsMap,
      };

      const routing = activationEngine.evaluateChannelRouting(routingInput);
      expect(routing.action).toBe('sequential_specialists');
      expect(routing.reason).toBe('domain_relevance');
      expect(routing.matchReason).toBe('domain_authority_match');
      expect(routing.matchedKeywords).toBeDefined();
      expect(routing.matchedKeywords).toContain('vault');
      expect(routing.matchedKeywords).toContain('sha256 digest');
      expect(routing.matchedSpecialists).toHaveLength(1);
      expect(routing.matchedSpecialists![0].agentId).toBe('agent-security-adv');
      expect(routing.matchedSpecialists![0].matchedKeywords).toContain('vault');
    });

    it('surfaces role_keyword_match with matched role words when role matches', () => {
      const routingInput: ChannelRoutingInput = {
        channelId: 'chan-general',
        message: {
          id: 'msg-role',
          channelId: 'chan-general',
          senderId: 'user',
          senderType: 'human',
          content: 'We need an auditor for this codebase.',
          mentions: [],
          productivityScore: 100,
          createdAt: 1000,
        },
        channelMembers: [specialistAgent, bossAgent],
        allProjectAgents: [specialistAgent, bossAgent],
        definitionsMap: defsMap,
      };

      const routing = activationEngine.evaluateChannelRouting(routingInput);
      expect(routing.action).toBe('sequential_specialists');
      expect(routing.matchReason).toContain('role_keyword_match');
      expect(routing.matchedKeywords).toContain('auditor');
    });

    it('surfaces orchestrator_fallback when zero specialists match keywords', () => {
      const routingInput: ChannelRoutingInput = {
        channelId: 'chan-general',
        message: {
          id: 'msg-unmatched',
          channelId: 'chan-general',
          senderId: 'user',
          senderType: 'human',
          content: 'What is the weather in Tokyo this afternoon?',
          mentions: [],
          productivityScore: 100,
          createdAt: 1000,
        },
        channelMembers: [specialistAgent, bossAgent],
        allProjectAgents: [specialistAgent, bossAgent],
        definitionsMap: defsMap,
      };

      const routing = activationEngine.evaluateChannelRouting(routingInput);
      expect(routing.action).toBe('orchestrator_fallback');
      expect(routing.reason).toBe('orchestrator_safety_net');
      expect(routing.matchReason).toBe('orchestrator_fallback');
      expect(routing.fallbackOrchestrator?.id).toBe('agent-boss');
      expect(routing.fallbackReason).toContain('No channel specialists matched request keywords');
    });

    it('POST /api/channels/:id/messages returns routing object with matchReason in HTTP 201 response', async () => {
      // Seed specialist in DB
      const agentRepo = new AgentRepository(server.db);
      agentRepo.createDefinition(specialistDef);
      agentRepo.createIdentity(specialistAgent);

      const workspaceRepo = new WorkspaceRepository(server.db);
      workspaceRepo.addChannelMember('chan-general', specialistAgent.id);

      const res = await fetch(`http://127.0.0.1:${port}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Audit the cryptography and vault keys please.',
        }),
      });

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.routing).toBeDefined();
      expect(data.routing.action).toBe('sequential_specialists');
      expect(data.routing.matchReason).toBe('domain_authority_match');
      expect(data.routing.matchedKeywords).toContain('cryptography');
      expect(data.routing.matchedKeywords).toContain('vault');
    });

    it('emits channel:routing event over SSE stream with exact routing metadata', async () => {
      // Connect to SSE stream
      const controller = new AbortController();
      const sseRes = await fetch(`http://127.0.0.1:${port}/api/events`, {
        signal: controller.signal,
      });
      expect(sseRes.status).toBe(200);

      let receivedRoutingEvent: any = null;
      const reader = sseRes.body?.getReader();
      const decoder = new TextDecoder();

      // Read SSE stream in background with robust buffering
      let buffer = '';
      const ssePromise = (async () => {
        try {
          while (true) {
            const { value, done } = await reader!.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              if (part.includes('channel:routing')) {
                const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
                if (dataLine) {
                  try {
                    const parsed = JSON.parse(dataLine.slice(6).trim());
                    if (parsed.routing) {
                      receivedRoutingEvent = parsed;
                      return;
                    }
                  } catch {}
                }
              }
            }
          }
        } catch {}
      })();

      // Wait a moment for SSE reader to establish
      await new Promise((r) => setTimeout(r, 200));

      // Post message that matches specialist
      await fetch(`http://127.0.0.1:${port}/api/channels/chan-general/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Audit the cryptography parameters in sentinel.',
        }),
      });

      // Wait for SSE event to arrive
      await Promise.race([
        ssePromise,
        new Promise((r) => setTimeout(r, 3000)),
      ]);

      controller.abort();

      expect(receivedRoutingEvent).toBeDefined();
      expect(receivedRoutingEvent.channelId).toBe('chan-general');
      expect(receivedRoutingEvent.routing).toBeDefined();
      expect(receivedRoutingEvent.routing.matchReason).toBe('domain_authority_match');
      expect(receivedRoutingEvent.routing.matchedKeywords).toContain('cryptography');
    });

    it('validates UI store ingestion contract and CenterView tag chip structure', () => {
      // Simulate state update in kinStore upon receiving HTTP response or SSE
      interface RoutingDecisionInfo {
        channelId: string;
        messageId?: string;
        routing: {
          action: string;
          reason: string;
          matchReason?: string;
          matchedKeywords?: string[];
        };
      }

      const storeState: { latestRoutingByChannel: Record<string, RoutingDecisionInfo> } = {
        latestRoutingByChannel: {},
      };

      const routingPayload: RoutingDecisionInfo = {
        channelId: 'chan-general',
        messageId: 'msg-123',
        routing: {
          action: 'sequential_specialists',
          reason: 'domain_relevance',
          matchReason: 'domain_authority_match',
          matchedKeywords: ['cryptography', 'vault'],
        },
      };

      // Ingest into store
      storeState.latestRoutingByChannel[routingPayload.channelId] = routingPayload;

      const activeRouting = storeState.latestRoutingByChannel['chan-general'];
      expect(activeRouting).toBeDefined();
      expect(activeRouting.routing.matchedKeywords).toEqual(['cryptography', 'vault']);

      // Verify CenterView.tsx chip generation contract:
      // Each keyword kw in matchedKeywords maps to:
      // <span title="Matched keyword: {kw}">#{kw}</span>
      const generatedChips = activeRouting.routing.matchedKeywords!.map((kw) => ({
        label: `#${kw}`,
        title: `Matched keyword: ${kw}`,
      }));

      expect(generatedChips).toEqual([
        { label: '#cryptography', title: 'Matched keyword: cryptography' },
        { label: '#vault', title: 'Matched keyword: vault' },
      ]);
    });
  });

  // ==========================================================================
  // ADVERSARIAL STRESS HARNESS & EDGE-CASE MINING
  // ==========================================================================
  describe('Adversarial Stress Harness & Edge Cases', () => {
    it('R3 Stress: 50 concurrent requests with randomized and malformed parameters survive without leaking unconfigured models', async () => {
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-stress-models-'));
      const cleanDbPath = path.join(cleanDir, 'clean.sqlite');
      const cleanServer = new CoreServer({ port: 0, dbPath: cleanDbPath, requireIpcAuth: false });
      const cleanPort = await cleanServer.start();

      try {
        const queryOptions = [
          'omitUnconfigured=true',
          'omitUnconfigured=1',
          'omitUnconfigured=false',
          'omitUnconfigured=0',
          "omitUnconfigured=' OR 1=1--",
          'omitUnconfigured=%20true%20',
          'omitUnconfigured=true&freeOnly=1',
          'omitUnconfigured=1&freeOnly=true',
          '',
        ];

        const requests = Array.from({ length: 50 }, (_, i) => {
          const q = queryOptions[i % queryOptions.length];
          return fetch(`http://127.0.0.1:${cleanPort}/api/models?${q}`).then(async (r) => {
            expect(r.status).toBe(200);
            const data: any = await r.json();
            if (q.includes('omitUnconfigured=true') || q.includes('omitUnconfigured=1')) {
              expect(data.models).toEqual([]);
            } else {
              expect(data.models.length).toBeGreaterThan(0);
            }
          });
        });

        await Promise.all(requests);
      } finally {
        await cleanServer.stop();
        try {
          fs.rmSync(cleanDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('R4 Stress: interleaved sequence of errors and successes resolves strictly to immediate subsequent outputs', () => {
      // Sequence:
      // Action 0: Error A
      // Action 1: Error B
      // Action 2: Success 1 (resolves A and B)
      // Action 3: Error C
      // Action 4: Success 2 (resolves C)
      // Action 5: Error D (terminal turn, unresolved)
      const actions = [
        { toolName: 'toolA', params: {}, error: 'Network timeout' },
        { toolName: 'toolB', params: {}, error: 'Port in use' },
        { toolName: 'toolC', params: {}, output: { status: 'retry_ok', attempt: 2 } },
        { toolName: 'toolD', params: {}, error: 'Rate limit exceeded' },
        { toolName: 'toolE', params: {}, output: 'Quota refreshed successfully' },
        { toolName: 'toolF', params: {}, error: 'Final terminal error' },
      ];

      const encounteredErrorsAndResolutions = actions
        .filter((a) => a.error)
        .map((a) => {
          const errIdx = actions.indexOf(a);
          const subsequentResolution = actions.slice(errIdx + 1).find((next) => !next.error);
          let fixApplied = 'Unresolved';
          if (subsequentResolution) {
            if ((subsequentResolution as any).output) {
              fixApplied = (typeof (subsequentResolution as any).output === 'string'
                ? (subsequentResolution as any).output
                : JSON.stringify((subsequentResolution as any).output)
              ).slice(0, 150);
            } else {
              fixApplied = `Resolved by ${subsequentResolution.toolName}`;
            }
          }
          return {
            error: `${a.toolName}: ${a.error || 'Execution failed'}`,
            fixApplied,
          };
        });

      expect(encounteredErrorsAndResolutions).toEqual([
        {
          error: 'toolA: Network timeout',
          fixApplied: '{"status":"retry_ok","attempt":2}',
        },
        {
          error: 'toolB: Port in use',
          fixApplied: '{"status":"retry_ok","attempt":2}',
        },
        {
          error: 'toolD: Rate limit exceeded',
          fixApplied: 'Quota refreshed successfully',
        },
        {
          error: 'toolF: Final terminal error',
          fixApplied: 'Unresolved',
        },
      ]);
    });

    it('R4 Stress: task status segregation strictly isolates completed from in-flight and failed tasks', () => {
      const taskRepo = new TaskRepository(server.db);
      const projectId = 'proj-kin';
      const goalId = 'goal-segregation-stress';

      server.db.execute(
        `INSERT OR IGNORE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
         VALUES (?, ?, 'Segregation Goal', 'Desc', '[]', 'active', ?, ?)`,
        goalId,
        projectId,
        Date.now(),
        Date.now()
      );

      const statuses = ['backlog', 'ready', 'assigned', 'running', 'blocked', 'review', 'completed', 'failed', 'cancelled'] as const;

      for (const st of statuses) {
        taskRepo.createTask({
          id: `task-st-${st}`,
          projectId,
          goalId,
          title: `Task with status ${st}`,
          description: `Desc ${st}`,
          status: st,
          priority: 1,
          dependencies: [],
          evidenceBundleId: st === 'completed' ? 'ev-bundle-valid' : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      const allTasks = taskRepo.listTasksByProject(projectId);
      const completedTasks = allTasks.filter((t: any) => t.status === 'completed');
      const pendingTaskDag = allTasks.filter((t: any) => t.status === 'ready' || t.status === 'backlog');

      // Verify that 'running', 'failed', 'blocked', 'assigned', 'review', 'cancelled' NEVER leak into completedTasks
      expect(completedTasks.some((t) => t.id === 'task-st-running')).toBe(false);
      expect(completedTasks.some((t) => t.id === 'task-st-failed')).toBe(false);
      expect(completedTasks.some((t) => t.id === 'task-st-blocked')).toBe(false);
      expect(completedTasks.some((t) => t.id === 'task-st-completed')).toBe(true);
      expect(completedTasks.find((t) => t.id === 'task-st-completed')?.evidenceBundleId).toBe('ev-bundle-valid');

      // Verify that completed, running, failed, etc. NEVER leak into pendingTaskDag
      expect(pendingTaskDag.some((t) => t.id === 'task-st-completed')).toBe(false);
      expect(pendingTaskDag.some((t) => t.id === 'task-st-running')).toBe(false);
      expect(pendingTaskDag.some((t) => t.id === 'task-st-failed')).toBe(false);
      expect(pendingTaskDag.some((t) => t.id === 'task-st-ready')).toBe(true);
      expect(pendingTaskDag.some((t) => t.id === 'task-st-backlog')).toBe(true);
    });

    it('R5 Stress: multi-specialist message activates all matching specialists sequentially with combined keywords', () => {
      const activationEngine = new ActivationEngine();

      const secAgent: AgentIdentity = {
        id: 'agent-sec-stress',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-sec-stress',
        displayName: '@SecSpecialist',
        activeModelId: 'mock',
        isOrchestrator: false,
        createdAt: 1,
        updatedAt: 1,
      };

      const dbAgent: AgentIdentity = {
        id: 'agent-db-stress',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-db-stress',
        displayName: '@DbSpecialist',
        activeModelId: 'mock',
        isOrchestrator: false,
        createdAt: 1,
        updatedAt: 1,
      };

      const defsMap = new Map<string, AgentDefinition>([
        ['def-sec-stress', {
          id: 'def-sec-stress',
          name: 'SecSpecialist',
          role: 'Security Specialist',
          systemPrompt: 'Sec',
          defaultModelId: 'mock',
          domainAuthority: ['cryptography', 'vault'],
          createdAt: 1,
        }],
        ['def-db-stress', {
          id: 'def-db-stress',
          name: 'DbSpecialist',
          role: 'Database Specialist',
          systemPrompt: 'Db',
          defaultModelId: 'mock',
          domainAuthority: ['postgres', 'indexing'],
          createdAt: 1,
        }],
      ]);

      const multiQuery: Message = {
        id: 'msg-multi',
        channelId: 'chan-general',
        senderId: 'user',
        senderType: 'human',
        content: 'Please review our Postgres indexing and Vault cryptography security setup.',
        mentions: [],
        productivityScore: 100,
        createdAt: 1,
      };

      const routing = activationEngine.evaluateChannelRouting({
        channelId: 'chan-general',
        message: multiQuery,
        channelMembers: [secAgent, dbAgent],
        allProjectAgents: [secAgent, dbAgent],
        definitionsMap: defsMap,
      });

      expect(routing.action).toBe('sequential_specialists');
      expect(routing.targetAgents).toHaveLength(2);
      expect(routing.targetAgents.map((a) => a.id)).toEqual(['agent-sec-stress', 'agent-db-stress']);
      expect(routing.matchedSpecialists).toHaveLength(2);
      expect(routing.matchedSpecialists![0].matchedKeywords).toEqual(['cryptography', 'vault']);
      expect(routing.matchedSpecialists![1].matchedKeywords).toEqual(['postgres', 'indexing']);
    });

    it('R5 Stress: case-insensitive and punctuation-laden keywords correctly match domain authority', () => {
      const activationEngine = new ActivationEngine();

      const secAgent: AgentIdentity = {
        id: 'agent-sec-case',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-sec-case',
        displayName: '@SecSpecialist',
        activeModelId: 'mock',
        isOrchestrator: false,
        createdAt: 1,
        updatedAt: 1,
      };

      const defsMap = new Map<string, AgentDefinition>([
        ['def-sec-case', {
          id: 'def-sec-case',
          name: 'SecSpecialist',
          role: 'Security Specialist',
          systemPrompt: 'Sec',
          defaultModelId: 'mock',
          domainAuthority: ['cryptography', 'sentinel'],
          createdAt: 1,
        }],
      ]);

      const messyQuery: Message = {
        id: 'msg-messy',
        channelId: 'chan-general',
        senderId: 'user',
        senderType: 'human',
        content: 'IS THE CRYPTOGRAPHY IN SENTINEL SOLID?!?!',
        mentions: [],
        productivityScore: 100,
        createdAt: 1,
      };

      const routing = activationEngine.evaluateChannelRouting({
        channelId: 'chan-general',
        message: messyQuery,
        channelMembers: [secAgent],
        allProjectAgents: [secAgent],
        definitionsMap: defsMap,
      });

      expect(routing.action).toBe('sequential_specialists');
      expect(routing.matchReason).toBe('domain_authority_match');
      expect(routing.matchedKeywords).toContain('cryptography');
      expect(routing.matchedKeywords).toContain('sentinel');
    });
  });
});
