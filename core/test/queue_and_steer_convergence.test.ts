import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CoreServer } from '../src/server/core_server.js';

describe('Message Queuing & Mid-Execution Steering Convergence', () => {
  const testDbPath = path.resolve(process.cwd(), 'kin_test_queue_steer.sqlite');
  let server: CoreServer;
  let port: number;
  let defaultChannelId: string;

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }

    server = new CoreServer({ port: 0, dbPath: testDbPath });
    port = await server.start();

    // Get default channel
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    const state: any = await res.json();
    defaultChannelId = state.channels[0].id;
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  describe('Durable Message Queuing API', () => {
    it('POST /api/channels/:id/queue durably persists messages into queued_messages table', async () => {
      const db = server.getDatabase();

      // Temporarily mark channel busy so queue message is not immediately dequeued
      (server as any).activeAgentExecutions.set('mock-busy-agent', {
        agentId: 'agent-boss',
        channelId: defaultChannelId,
        startedAt: Date.now(),
      });

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/channels/${defaultChannelId}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: 'First queued directive for agent',
            senderId: 'user-operator',
          }),
        });

        expect(res.status).toBe(201);
        const data: any = await res.json();
        expect(data.success).toBe(true);
        expect(data.message.content).toBe('First queued directive for agent');
        expect(data.message.channelId).toBe(defaultChannelId);

        // Verify in SQLite
        const queuedInDb = db.queryOne<{ id: string; content: string }>(
          'SELECT id, content FROM queued_messages WHERE id = ?',
          data.message.id
        );
        expect(queuedInDb?.content).toBe('First queued directive for agent');
      } finally {
        (server as any).activeAgentExecutions.delete('mock-busy-agent');
      }
    });

    it('GET /api/channels/:id/queue returns messages in FIFO order', async () => {
      // Temporarily mark channel busy
      (server as any).activeAgentExecutions.set('mock-busy-agent', {
        agentId: 'agent-boss',
        channelId: defaultChannelId,
        startedAt: Date.now(),
      });

      try {
        await fetch(`http://127.0.0.1:${port}/api/channels/${defaultChannelId}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Second queued directive' }),
        });

        const res = await fetch(`http://127.0.0.1:${port}/api/channels/${defaultChannelId}/queue`);
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data.queuedMessages.length).toBeGreaterThanOrEqual(2);

        // Verify FIFO order
        expect(data.queuedMessages[0].content).toBe('First queued directive for agent');
        expect(data.queuedMessages[1].content).toBe('Second queued directive');
      } finally {
        (server as any).activeAgentExecutions.delete('mock-busy-agent');
      }
    });

    it('DELETE /api/channels/:id/queue/:msgId deletes specific queued message', async () => {
      const getRes = await fetch(`http://127.0.0.1:${port}/api/channels/${defaultChannelId}/queue`);
      const getData: any = await getRes.json();
      const targetId = getData.queuedMessages[0].id;

      const delRes = await fetch(`http://127.0.0.1:${port}/api/channels/${defaultChannelId}/queue/${targetId}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);

      const db = server.getDatabase();
      const checkRow = db.queryOne<{ id: string }>('SELECT id FROM queued_messages WHERE id = ?', targetId);
      expect(checkRow).toBeFalsy();
    });
  });

  describe('FIFO Dequeue Dispatcher', () => {
    it('processNextQueuedMessage does not dequeue while channel is busy', async () => {
      (server as any).activeAgentExecutions.set('mock-busy-agent', {
        agentId: 'agent-boss',
        channelId: defaultChannelId,
        startedAt: Date.now(),
      });

      try {
        const dequeued = await server.processNextQueuedMessage(defaultChannelId);
        expect(dequeued).toBe(false);
      } finally {
        (server as any).activeAgentExecutions.delete('mock-busy-agent');
      }
    });

    it('processNextQueuedMessage dispatches oldest message when channel becomes idle', async () => {
      const db = server.getDatabase();
      // Clear any prior test messages in queue
      db.execute('DELETE FROM queued_messages WHERE channel_id = ?', defaultChannelId);
      // Ensure there is at least one message in queue
      const qId = `qmsg-test-${Date.now()}`;
      db.execute(
        `INSERT INTO queued_messages (id, channel_id, sender_id, content, metadata_json, created_at)
         VALUES (?, ?, 'user-operator', 'Dispatch this when idle', '{}', ?)`,
        qId, defaultChannelId, Date.now()
      );

      // Verify channel has 0 active executions
      (server as any).activeAgentExecutions.clear();

      const dequeued = await server.processNextQueuedMessage(defaultChannelId);
      expect(dequeued).toBe(true);

      // Verify removed from queued_messages
      const row = db.queryOne<{ id: string }>('SELECT id FROM queued_messages WHERE id = ?', qId);
      expect(row).toBeFalsy();
    });
  });

  describe('Mid-Execution Steering & Inference Abort', () => {
    it('aborts active run AbortController immediately upon receiving a steer message', async () => {
      const runId = `run-steer-${Date.now()}`;
      const mockAbortController = new AbortController();
      let wasAborted = false;
      let abortReason: any = null;

      mockAbortController.signal.addEventListener('abort', () => {
        wasAborted = true;
        abortReason = mockAbortController.signal.reason;
      });

      // Register run in active executions and abort controllers
      (server as any).activeAgentExecutions.set('agent-boss', {
        agentId: 'agent-boss',
        channelId: defaultChannelId,
        startedAt: Date.now(),
        runId,
      });
      (server as any).runAbortControllers.set(runId, mockAbortController);

      try {
        // Send a steer message targeting agent-boss
        const res = await fetch(`http://127.0.0.1:${port}/api/channels/${defaultChannelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: '@Boss stop reading files and run tests immediately',
            isSteer: true,
          }),
        });

        expect(res.status).toBe(201);

        // Verify that the active run inference was immediately aborted with reason 'steer'
        expect(wasAborted).toBe(true);
        expect(abortReason).toBe('steer');

        // Verify that pendingSteers recorded the directive
        const pending = (server as any).pendingSteers as any[];
        expect(pending.some((s) => s.directive.includes('run tests immediately'))).toBe(true);
      } finally {
        (server as any).activeAgentExecutions.delete('agent-boss');
        (server as any).runAbortControllers.delete(runId);
      }
    });

    it('dynamically annotates running tasks in DAG with steer directive', async () => {
      const db = server.getDatabase();
      const defaultAgent = db.queryOne<{ id: string }>('SELECT id FROM agent_identities LIMIT 1');
      const now = Date.now();

      const goalId = 'goal-steer-dag';
      const taskId = 'task-steer-dag';
      db.execute(
        `INSERT OR REPLACE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
         VALUES (?, 'proj-kin', 'Steer DAG Goal', 'Goal description', '[]', 'active', ?, ?)`,
        goalId, now, now
      );
      db.execute(
        `INSERT OR REPLACE INTO tasks (id, goal_id, title, description, status, assigned_agent_id, created_at, updated_at)
         VALUES (?, ?, 'Active task', 'Original requirements', 'running', ?, ?, ?)`,
        taskId, goalId, defaultAgent!.id, now, now
      );

      // Mark agent active in channel so message is recognized as mid-turn steer
      (server as any).activeAgentExecutions.set('agent-boss', {
        agentId: defaultAgent!.id,
        channelId: defaultChannelId,
        startedAt: Date.now(),
      });

      try {
        // Post steer
        await fetch(`http://127.0.0.1:${port}/api/channels/${defaultChannelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: '@Boss change direction to use TypeScript instead of Python',
            isSteer: true,
          }),
        });

        // Verify task description updated in database
        const task = db.queryOne<{ description: string }>('SELECT description FROM tasks WHERE id = ?', taskId);
        expect(task?.description).toContain('[STEER DIRECTIVE]');
        expect(task?.description).toContain('TypeScript instead of Python');
      } finally {
        (server as any).activeAgentExecutions.delete('agent-boss');
      }
    });

    it('deduplicates identical steer directives sent in rapid succession within 2000ms', async () => {
      (server as any).activeAgentExecutions.set('agent-boss', {
        agentId: 'agent-boss',
        channelId: defaultChannelId,
        startedAt: Date.now(),
      });

      try {
        const directiveText = '@Boss rapid double click test directive';

        // Fire two rapid consecutive requests concurrently
        const [res1, res2] = await Promise.all([
          fetch(`http://127.0.0.1:${port}/api/channels/${defaultChannelId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: directiveText, isSteer: true }),
          }),
          fetch(`http://127.0.0.1:${port}/api/channels/${defaultChannelId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: directiveText, isSteer: true }),
          }),
        ]);

        expect(res1.status).toBe(201);
        expect(res2.status).toBe(201);

        const steersWithDirective = ((server as any).pendingSteers as any[]).filter(
          (s) => s.directive === directiveText
        );
        // Must be exactly 1 entry in pendingSteers, not 2
        expect(steersWithDirective.length).toBe(1);
      } finally {
        (server as any).activeAgentExecutions.delete('agent-boss');
      }
    });

    it('GET /api/state includes queuedMessages for the active channel', async () => {
      const db = server.getDatabase();
      const qId = `qmsg-state-${Date.now()}`;
      db.execute(
        `INSERT INTO queued_messages (id, channel_id, sender_id, content, metadata_json, created_at)
         VALUES (?, ?, 'user-operator', 'State check queued content', '{}', ?)`,
        qId, defaultChannelId, Date.now()
      );

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/state`);
        expect(res.status).toBe(200);
        const state: any = await res.json();
        expect(Array.isArray(state.queuedMessages)).toBe(true);
        expect(state.queuedMessages.some((q: any) => q.id === qId)).toBe(true);
      } finally {
        db.execute('DELETE FROM queued_messages WHERE id = ?', qId);
      }
    });

    it('processNextQueuedMessage holds queue while multi-agent delegations are in flight', async () => {
      const db = server.getDatabase();
      const qId = `qmsg-del-${Date.now()}`;
      db.execute(
        `INSERT INTO queued_messages (id, channel_id, sender_id, content, metadata_json, created_at)
         VALUES (?, ?, 'user-operator', 'Queued delegation message', '{}', ?)`,
        qId, defaultChannelId, Date.now()
      );

      (server as any).activeAgentExecutions.clear();
      // Simulate multi-agent delegation in flight
      (server as any).incrementDelegation(defaultChannelId);

      try {
        const blockedDequeue = await server.processNextQueuedMessage(defaultChannelId);
        expect(blockedDequeue).toBe(false);

        // Still in queued_messages table
        const rowBefore = db.queryOne<{ id: string }>('SELECT id FROM queued_messages WHERE id = ?', qId);
        expect(rowBefore).toBeTruthy();

        // Release delegation — this automatically triggers processNextQueuedMessage!
        (server as any).decrementDelegation(defaultChannelId);

        // Wait a brief moment for async dispatch to finalize
        await new Promise((r) => setTimeout(r, 60));

        // Row was automatically dequeued upon delegation finishing!
        const rowAfter = db.queryOne<{ id: string }>('SELECT id FROM queued_messages WHERE id = ?', qId);
        expect(rowAfter).toBeFalsy();
      } finally {
        (server as any).activeDelegations.delete(defaultChannelId);
        db.execute('DELETE FROM queued_messages WHERE id = ?', qId);
      }
    });

    it('AgentLoopRunner recovers from mid-flight AbortError and addresses steer directive on next turn', async () => {
      const { AgentLoopRunner } = await import('../src/kernel/agent_loop.js');

      let turnCount = 0;
      let abortController = new AbortController();

      const mockModelGateway: any = {
        invoke: async (params: any) => {
          turnCount++;
          if (turnCount === 1) {
            // First turn: simulate long generation interrupted by steer
            abortController.abort('steer');
            const err: any = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
          }
          // Turn 2: should receive un-aborted fresh signal and steer directive in messages
          expect(params.signal?.aborted).toBeFalsy();
          expect(params.messages.some((m: any) => m.content.includes('PRIORITY MID-EXECUTION STEERING DIRECTIVE'))).toBe(true);
          return {
            content: 'Acknowledged operator directive and adapted output.',
            tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            durationMs: 50,
          };
        },
      };

      const loopRunner = new AgentLoopRunner(
        mockModelGateway,
        { getToolSchemas: () => [] } as any,
        {} as any,
        { matchSkills: () => [] } as any
      );

      let steerDrained = false;
      const result = await loopRunner.execute({
        modelId: 'ollama/llama3',
        userPrompt: 'Initial user prompt',
        systemPrompt: 'System instructions',
        worktreeRoot: process.cwd(),
        autonomyMode: 'AUTO',
        maxTurns: 3,
        allowedCapabilities: ['*'],
        getAbortSignal: () => abortController.signal,
        renewAbortSignal: () => {
          abortController = new AbortController();
          return abortController.signal;
        },
        getSteerDirectives: () => {
          if (!steerDrained) {
            steerDrained = true;
            return ['Operator priority steer: switch immediately to fast path'];
          }
          return [];
        },
      });

      expect(result.finalContent).toContain('Acknowledged operator directive');
      expect(result.turnCount).toBe(2);
      expect(turnCount).toBe(2);
    });

    it('ToolGateway handleExecuteShell cancels in-flight process tree immediately when AbortSignal triggers', async () => {
      const { ToolGateway } = await import('../src/execution/tool_gateway.js');
      const gateway = new ToolGateway(server.getDatabase());
      const abortCtrl = new AbortController();

      const isWin = process.platform === 'win32';
      const longCommand = isWin ? 'ping 127.0.0.1 -n 30' : 'sleep 30';

      const startTime = Date.now();
      const execPromise = (gateway as any).handleExecuteShell(longCommand, process.cwd(), 30000, abortCtrl.signal);

      // Trigger steer abort after 50ms while command is actively running
      setTimeout(() => {
        abortCtrl.abort('steer');
      }, 50);

      await expect(execPromise).rejects.toThrow(/Shell execution cancelled by operator via AbortSignal/);
      const elapsedMs = Date.now() - startTime;

      // Must terminate child process in well under 3000ms (not waiting 30000ms timeout)
      expect(elapsedMs).toBeLessThan(3000);
    });

    it('AgentLoopRunner terminates in-flight tool immediately on steer abort, records cancellation, and pivots on turn 2', async () => {
      const { AgentLoopRunner } = await import('../src/kernel/agent_loop.js');

      let turnCount = 0;
      let abortController = new AbortController();
      let toolExecutionStarted = false;

      const mockModelGateway: any = {
        invoke: async (params: any) => {
          turnCount++;
          if (turnCount === 1) {
            // Turn 1: Model requests long-running tool execution
            return {
              content: '<tool_call>{"name": "executeShell", "parameters": {"command": "sleep 30"}}</tool_call>',
              tokensUsed: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
              durationMs: 50,
            };
          }
          // Turn 2: Model receives cancelled observation and human steering directive
          expect(params.signal?.aborted).toBeFalsy();
          expect(params.messages.some((m: any) => m.content.includes('[TOOL EXECUTION CANCELLED]'))).toBe(true);
          expect(params.messages.some((m: any) => m.content.includes('PRIORITY MID-EXECUTION STEERING DIRECTIVE'))).toBe(true);
          return {
            content: 'Acknowledged cancellation of sleep tool and pivoted to address steer directive.',
            tokensUsed: { promptTokens: 15, completionTokens: 20, totalTokens: 35 },
            durationMs: 50,
          };
        },
      };

      const mockToolGateway: any = {
        getToolSchemas: () => [{ name: 'executeShell', description: 'Executes shell command' }],
        getBrowserController: () => ({ getStatus: () => ({ currentUrl: '', pageTitle: '' }) }),
        executeTool: async (toolName: string, params: any, context: any) => {
          toolExecutionStarted = true;
          // Simulate in-flight long-running tool that listens to context.abortSignal
          return new Promise((resolve) => {
            const signal = context.abortSignal;
            if (signal?.aborted) {
              return resolve({
                success: false,
                error: 'Shell execution cancelled by operator via AbortSignal.',
                riskLevel: 'LOW',
              });
            }
            if (signal) {
              signal.addEventListener('abort', () => {
                resolve({
                  success: false,
                  error: 'Shell execution cancelled by operator via AbortSignal.',
                  riskLevel: 'LOW',
                });
              }, { once: true });
            }
          });
        },
      };

      const loopRunner = new AgentLoopRunner(
        mockModelGateway,
        mockToolGateway,
        {} as any,
        { matchSkills: () => [] } as any
      );

      let steerDrained = false;
      const startTime = Date.now();

      // Trigger steer abort after 50ms while tool is executing
      setTimeout(() => {
        expect(toolExecutionStarted).toBe(true);
        abortController.abort('steer');
      }, 50);

      const result = await loopRunner.execute({
        modelId: 'ollama/llama3',
        userPrompt: 'Run build command',
        systemPrompt: 'System instructions',
        worktreeRoot: process.cwd(),
        autonomyMode: 'AUTO',
        maxTurns: 3,
        allowedCapabilities: ['*'],
        getAbortSignal: () => abortController.signal,
        renewAbortSignal: () => {
          abortController = new AbortController();
          return abortController.signal;
        },
        getSteerDirectives: () => {
          if (!steerDrained) {
            steerDrained = true;
            return ['Operator priority steer: Cancel build and check git status instead'];
          }
          return [];
        },
      });

      const elapsedMs = Date.now() - startTime;
      expect(elapsedMs).toBeLessThan(3000); // Did not wait for timeout
      expect(result.turnCount).toBe(2);
      expect(turnCount).toBe(2);
      expect(result.actions.length).toBe(1);
      expect(result.actions[0].toolName).toBe('executeShell');
      expect(result.actions[0].error).toContain('cancelled by operator via AbortSignal');
      expect(result.finalContent).toContain('Acknowledged cancellation of sleep tool');
    });
  });
});
