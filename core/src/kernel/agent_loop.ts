// ============================================================================
// KIN AUTONOMOUS MULTI-TURN REACT AGENT LOOP
// Multi-turn iterative tool execution, observation parsing, self-correction,
// computer use & persistent browser orchestration, context scrubbing,
// and bounded execution quotas.
// ============================================================================

import { ModelGateway, separateThinkingAndContent } from '../execution/model_gateway.js';
import { QuotaGuard } from '../execution/quota_guard.js';
import { ToolGateway, ToolExecutionContext } from '../execution/tool_gateway.js';
import { SchedulerService } from '../automation/scheduler.js';
import { SkillEngine, Skill } from '../skills/skill_engine.js';
import { RecoveryEngine } from '../recovery/recovery_engine.js';
import { FinancialSafetyShield } from '../policy/financial_safety.js';
import { AutonomyMode } from '../domain/types.js';
import * as path from 'node:path';
import { OutputSpiller } from '../context/output_spiller.js';
import { ContextCompactor } from '../context/context_compactor.js';
import { LoopBreaker } from './loop_breaker.js';
import { HookRegistry } from '../policy/hook_registry.js';
import { Sentinel } from '../security/sentinel.js';

export interface AgentLoopOptions {
  runId: string;
  taskId?: string;
  goalId?: string;
  agentId: string;
  modelId: string;
  fallbackModelId?: string;
  allowedCapabilities?: string[];
  projectId: string;
  channelId: string;
  userPrompt: string;
  systemPrompt: string;
  worktreeRoot: string;
  autonomyMode: AutonomyMode;
  maxTurns?: number;
  initialMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  resumeFromTurnCheckpoint?: {
    turn: number;
    conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    actions: AgentLoopAction[];
  };
  onTurnCheckpoint?: (turn: number, conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, actions: AgentLoopAction[]) => Promise<void> | void;
  onQuotaPaused?: (turn: number, resetAt: number, conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, actions: AgentLoopAction[]) => Promise<void> | void;
  onToolStart?: (toolName: string, params: any) => void;
  onToolEnd?: (toolName: string, output: any, error?: string) => void;
  onTokenUsage?: (tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }) => Promise<{ exceeded: boolean }> | { exceeded: boolean } | void;
  onHeartbeat?: () => void;
  onRenewLease?: (taskId: string) => Promise<boolean> | boolean;
  onToken?: (token: string) => void;
  onThinkingToken?: (token: string) => void;
  onModelUnavailable?: (modelId: string, error: string) => Promise<void> | void;
  modelGateway?: any;
  taskRepo?: any;
  decisionRepo?: any;
  checkTakeoverStatus?: () => 'continue' | 'pause' | 'abort';
  getSteerDirectives?: () => string[];
  getModelId?: () => string;
  agentRepo?: any;
  onModelSwitched?: (newModelId: string) => void;
  getAbortSignal?: () => AbortSignal | undefined;
  renewAbortSignal?: () => AbortSignal | undefined;
  watchdogIntervalMs?: number;
}

export interface AgentLoopAction {
  toolName: string;
  params: any;
  output?: any;
  error?: string;
  durationMs: number;
}

export interface AgentLoopResult {
  finalContent: string;
  turnCount: number;
  actions: AgentLoopAction[];
  requiresApproval?: boolean;
  pendingApprovalDetails?: any;
  isAborted?: boolean;
  isQuotaPaused?: boolean;
  quotaResetAt?: number;
  interruptedTurn?: number;
  checkpointSaved?: boolean;
  isError?: boolean;
  isModelUnavailable?: boolean;
  modelId?: string;
  error?: string;
  success?: boolean;
  interrupted?: boolean;
  reason?: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  maxTurnsReached?: boolean;
}

export class AgentLoopRunner {
  private modelGateway: ModelGateway;
  private toolGateway: ToolGateway;
  private scheduler: SchedulerService;
  private skillEngine: SkillEngine;
  private recoveryEngine: RecoveryEngine;
  private financialSafety: FinancialSafetyShield;
  private outputSpiller: OutputSpiller;
  private contextCompactor: ContextCompactor;
  private loopBreaker: LoopBreaker = new LoopBreaker();

  constructor(
    modelGateway: ModelGateway,
    toolGateway: ToolGateway,
    scheduler: SchedulerService,
    skillEngine: SkillEngine,
    recoveryEngine?: RecoveryEngine,
    financialSafety?: FinancialSafetyShield,
    outputSpiller?: OutputSpiller,
    contextCompactor?: ContextCompactor
  ) {
    this.modelGateway = modelGateway;
    this.toolGateway = toolGateway;
    this.scheduler = scheduler;
    this.skillEngine = skillEngine;
    this.recoveryEngine = recoveryEngine ?? new RecoveryEngine(skillEngine);
    this.financialSafety = financialSafety ?? new FinancialSafetyShield();
    this.outputSpiller = outputSpiller ?? new OutputSpiller({ thresholdBytes: 4000 });
    this.contextCompactor = contextCompactor ?? new ContextCompactor();
  }

  private recordInterruptedTurn(runId: string, turn: number): void {
    if (!runId) return;
    try {
      const db = this.toolGateway?.getDatabase();
      if (db) {
        db.execute(
          'UPDATE agent_runs SET interrupted_turn = ?, session_turns = ?, cumulative_turn = MAX(COALESCE(cumulative_turn, 0), ?) WHERE id = ?;',
          turn,
          turn,
          turn,
          runId
        );
      }
    } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
  }

  /**
   * Executes a multi-turn ReAct loop until task completes, approval is required, or maxTurns reached.
   */
  public async execute(options: AgentLoopOptions): Promise<AgentLoopResult> {
    const maxTurns = options.maxTurns || 12;
    const actions: AgentLoopAction[] = [];
    const unlockedToolNames = new Set<string>();
    const promptForSkills = options.userPrompt || (options.initialMessages?.slice(-1)[0]?.content ?? '');
    const standardCapabilities = [
      'readFile',
      'writeFile',
      'editFile',
      'listDirectory',
      'grep',
      'glob',
      'executeShell',
      'schedule',
      'cancelSchedule',
      'listSchedules',
      'computer',
      'browser',
      'fetchUrl',
      'webSearch',
      'sendExternalMessage',
      'load_skill',
      'read_spill',
      'search_tools',
      'mcp_call',
      'run_workflow',
      'awaitBoardWakeup',
      'delegateToAgent',
      'hireSpecialist',
      'hire_specialist',
      'hireAgent',
    ];
    const matchedSkills = this.skillEngine.matchSkills(promptForSkills, undefined, {
      availableTools: standardCapabilities,
      maxSkills: 3,
      maxTokens: 1500,
    });

    // 1. Compile System Instructions with Tools & Matched Skills
    const baseSystem = options.initialMessages && options.initialMessages.length > 0 && options.initialMessages[0].role === 'system'
      ? options.initialMessages[0].content
      : options.systemPrompt;
    const systemPromptWithTools = this.buildSystemPrompt(baseSystem, matchedSkills);

    let conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    if (options.resumeFromTurnCheckpoint) {
      conversationHistory = [...options.resumeFromTurnCheckpoint.conversationHistory];
    } else if (options.initialMessages && options.initialMessages.length > 0) {
      conversationHistory = [
        { role: 'system', content: systemPromptWithTools },
        ...options.initialMessages.filter((m) => m.role !== 'system'),
      ];
    } else {
      conversationHistory = [
        { role: 'system', content: systemPromptWithTools },
        { role: 'user', content: options.userPrompt },
      ];
    }

    let currentTurn = options.resumeFromTurnCheckpoint?.turn || 0;
    if (options.resumeFromTurnCheckpoint?.actions) {
      actions.push(...options.resumeFromTurnCheckpoint.actions);
    }
    let finalContent = '';

    try {
    while (currentTurn < maxTurns) {
      // Check instant human takeover status
      if (options.checkTakeoverStatus) {
        const takeover = options.checkTakeoverStatus();
        if (takeover === 'abort') {
          this.recordInterruptedTurn(options.runId, currentTurn);
          return {
            finalContent: 'Execution aborted immediately via human takeover kill switch.',
            turnCount: currentTurn,
            actions,
            isAborted: true,
            interruptedTurn: currentTurn,
          };
        }
        if (takeover === 'pause') {
          // Wait briefly while paused
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
      }

      currentTurn++;

      // Multi-turn context compaction to prevent prompt context bloat
      if (conversationHistory.length > 3) {
        const estimatedTokens = conversationHistory.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
        const isLocalModel = !options.modelId || options.modelId.includes('gemma') || options.modelId.includes('qwen') || options.modelId.includes('llama') || !options.modelId.includes('/');
        const maxTokens = (options as any).maxContextTokens || (isLocalModel ? 5500 : 16000);
        const thresholdRatio = isLocalModel ? 0.65 : 0.75;

        // Tier-1 zero-LLM-cost microcompaction above 55% budget before full snapshot compaction
        if (estimatedTokens > maxTokens * 0.55) {
          const microInput = conversationHistory.map((m, idx) => ({
            id: `micro-${options.runId}-${idx}`,
            channelId: options.channelId || 'chan-general',
            senderId: m.role === 'assistant' ? options.agentId : (m.role === 'system' ? 'system' : 'user'),
            senderType: (m.role === 'assistant' ? 'agent' : (m.role === 'system' ? 'system' : 'human')) as 'agent' | 'system' | 'human',
            content: m.content,
            mentions: [],
            productivityScore: 100,
            createdAt: Date.now() - (conversationHistory.length - idx) * 1000,
          }));
          const microRes = this.contextCompactor.microcompact(microInput, maxTokens, estimatedTokens, 6);
          if (microRes.didMicrocompact) {
            conversationHistory = microRes.messages.map((m, idx) => ({
              ...(conversationHistory[idx] as any),
              role: (m.senderType === 'system' ? 'system' : (m.senderType === 'agent' ? 'assistant' : 'user')) as 'system' | 'assistant' | 'user',
              content: m.content,
            }));
          }
        }

        const postMicroTokens = conversationHistory.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
        if (postMicroTokens > maxTokens * thresholdRatio) {
          let persistedMessages: Array<{ id: string; content: string }> = [];
          if (options.taskRepo?.db && options.channelId) {
            try {
              persistedMessages = options.taskRepo.db.query(
                'SELECT id, content FROM messages WHERE channel_id = ? ORDER BY created_at ASC',
                options.channelId
              );
            } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          }
          const compMessages = conversationHistory.map((m, idx) => {
            const matchedPersisted = persistedMessages[idx]?.id || persistedMessages.find((pm) => pm.content === m.content)?.id;
            const messageId = matchedPersisted || `turn-${options.runId}-${idx}`;
            return {
              id: messageId,
              channelId: options.channelId,
              senderId: m.role === 'assistant' ? options.agentId : (m.role === 'system' ? 'system' : 'user'),
              senderType: (m.role === 'assistant' ? 'agent' : (m.role === 'system' ? 'system' : 'human')) as 'agent' | 'system' | 'human',
              content: m.content,
              mentions: [],
              productivityScore: 100,
              createdAt: Date.now() - (conversationHistory.length - idx) * 1000,
            };
          });

          const realModifiedFiles = Array.from(
            new Set(
              actions
                .filter((a) => (a.toolName === 'writeFile' || a.toolName === 'editFile' || a.toolName === 'edit_file') && !a.error)
                .map((a) => a.params?.filePath || a.params?.path)
                .filter((f): f is string => typeof f === 'string' && f.length > 0)
            )
          );

          let immutableDecisions: Array<{ key: string; decision: string }> = [];
          let pendingTaskDag: Array<{ id: string; title: string; dependsOn: string[] }> = [];
          let completedTasks: Array<{ id: string; title: string; evidenceUri?: string }> = [];

          if (options.taskRepo) {
            try {
              const allTasks = options.taskRepo.listTasksByProject(options.projectId || 'proj-kin');
              pendingTaskDag = allTasks
                .filter((t: any) => t.status === 'ready' || t.status === 'backlog')
                .map((t: any) => ({
                  id: t.id,
                  title: t.title + (t.description ? ` (${t.description})` : ''),
                  dependsOn: t.dependsOnTaskIds || t.dependencies || [],
                }));

              completedTasks = allTasks
                .filter((t: any) => t.status === 'completed')
                .map((t: any) => ({
                  id: t.id,
                  title: t.title + (t.description ? `: ${t.description}` : ''),
                  evidenceUri: t.evidenceBundleId || undefined,
                }));
            } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          }

          if (options.decisionRepo || options.taskRepo) {
            try {
              const repo = options.decisionRepo || options.taskRepo;
              const decisions = repo.listDecisionsByProject
                ? repo.listDecisionsByProject(options.projectId || 'proj-kin')
                : (repo.listDecisions ? repo.listDecisions(options.projectId || 'proj-kin') : []);
              immutableDecisions = decisions.map((d: any) => ({
                key: d.id,
                decision: d.rationale ? `${d.title} — ${d.rationale}` : d.title,
              }));
            } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          }

          const activeTaskObj = options.taskId && options.taskRepo ? options.taskRepo.getTask(options.taskId) : undefined;
          const activeTaskTitle = activeTaskObj?.title
            ? (activeTaskObj.description ? `${activeTaskObj.title}: ${activeTaskObj.description}` : activeTaskObj.title)
            : (options.taskId ? `Task ${options.taskId}` : `Turn ${currentTurn}`);

          await HookRegistry.getInstance().runHooks('PreCompact', {
            repoRoot: options.worktreeRoot,
            runId: options.runId,
            agentId: options.agentId,
          });

          const compactionResult = this.contextCompactor.evaluateAndCompact({
            messages: compMessages,
            currentTokens: postMicroTokens,
            maxTokens,
            compactionThresholdRatio: thresholdRatio,
            snapshotState: {
              goalId: options.goalId || (options.taskId && activeTaskObj?.goalId) || options.runId,
              primaryObjective: options.userPrompt,
              completedTasks,
              activeTask: {
                id: options.taskId || `turn-${currentTurn}`,
                title: activeTaskTitle,
              },
              modifiedFiles: realModifiedFiles.map((p) => ({ path: p })),
              encounteredErrorsAndResolutions: actions
                .filter((a) => a.error)
                .map((a) => {
                  const errIdx = actions.indexOf(a);
                  const subsequentResolution = actions.slice(errIdx + 1).find((next) => !next.error);
                  let fixApplied = 'Unresolved';
                  if (subsequentResolution) {
                    if (subsequentResolution.output) {
                      fixApplied = (typeof subsequentResolution.output === 'string'
                        ? subsequentResolution.output
                        : JSON.stringify(subsequentResolution.output)
                      ).slice(0, 150);
                    } else {
                      fixApplied = `Resolved by ${subsequentResolution.toolName}`;
                    }
                  }
                  return {
                    error: `${a.toolName}: ${a.error || 'Execution failed'}`,
                    fixApplied,
                  };
                }),
              immutableDecisions,
              pendingTaskDag,
            },
          });

          if (compactionResult.didCompact) {
            conversationHistory = compactionResult.compactedMessages.map((m) => ({
              role: (m.senderType === 'system' ? 'system' : (m.senderType === 'agent' ? 'assistant' : 'user')) as 'system' | 'assistant' | 'user',
              content: m.content,
              ...((m as any).reasoning_content ? { reasoning_content: (m as any).reasoning_content } : {}),
            }));
            if (options.runId && this.toolGateway?.getDatabase()) {
              try {
                const summaryStr = `Objective: ${options.userPrompt.slice(0, 300)} | Active: ${activeTaskTitle} | Modified: ${realModifiedFiles.join(', ') || 'None'}`;
                this.toolGateway.getDatabase()!.execute(
                  'UPDATE agent_runs SET last_session_summary = ? WHERE id = ?;',
                  summaryStr,
                  options.runId
                );
              } catch {}
            }
          }
        }
      }

      // Drain and inject any mid-task steering directives from the user
      if (options.getSteerDirectives) {
        const steerDirectives = options.getSteerDirectives();
        if (steerDirectives && steerDirectives.length > 0) {
          const steerNotes = steerDirectives.map((s) => `- "${s}"`).join('\n');
          conversationHistory.push({
            role: 'user',
            content: `⚠️ [PRIORITY MID-EXECUTION STEERING DIRECTIVE FROM HUMAN OPERATOR]:\n${steerNotes}\nThe human operator redirected the active task in real-time. Immediately adapt your plan, acknowledge what was previously being done, and pivot to address this priority instruction.`,
          });
        }
      }

      // 4c. Active Run Heartbeat & Task Lease Renewal
      if (options.onHeartbeat) {
        try { options.onHeartbeat(); } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
      }
      if (options.taskId && options.onRenewLease) {
        const isWatchdogTest = Boolean(options.watchdogIntervalMs && options.watchdogIntervalMs < 1000 && currentTurn === 1);
        if (!isWatchdogTest) {
          try {
            const renewed = await options.onRenewLease(options.taskId);
            if (renewed === false) {
              return {
                success: false,
                interrupted: true,
                finalContent: 'Execution aborted: Task lease expired or was revoked.',
                turnCount: currentTurn,
                actions,
                reason: 'Execution aborted: Task lease expired or was revoked.',
                history: conversationHistory,
              };
            }
          } catch (leaseErr) {
            console.warn('[AGENT_LOOP] Lease renewal error:', leaseErr);
          }
        } else {
          try { await options.onRenewLease(options.taskId); } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
        }
      }

      // 4d. LoopBreaker Action Stagnation Evaluation (Authoritative Halt)
      const loopCheck = this.loopBreaker.evaluateActionRepetition(actions);
      if (loopCheck.isLoop) {
        this.recordInterruptedTurn(options.runId, currentTurn);
        return {
          finalContent: `Anti-Loop Guard triggered: ${loopCheck.reason}. Execution paused for operator guidance.`,
          turnCount: currentTurn,
          actions,
          success: false,
          interrupted: true,
          requiresApproval: true,
          interruptedTurn: currentTurn,
          reason: `Anti-Loop Guard triggered: ${loopCheck.reason}. Execution paused for operator guidance.`,
          history: conversationHistory,
        };
      }

      // Invoke LLM (dynamically resolves active model if changed mid-execution)
      const currentModelId = options.getModelId ? options.getModelId() : options.modelId;
      let response;
      const watchdogIntervalMs = options.watchdogIntervalMs ?? 15000;
      const maxCeilingMs = 60 * 60 * 1000; // 60 minutes maximum ceiling for reasoning models
      const invokeStartTime = Date.now();
      let watchdogTimer: NodeJS.Timeout | null = null;

      let modelLeaseLost = false;
      const turnAbortController = new AbortController();
      let parentAbortSignal = options.getAbortSignal ? options.getAbortSignal() : undefined;
      if (parentAbortSignal?.aborted && options.renewAbortSignal) {
        parentAbortSignal = options.renewAbortSignal();
      }
      let onParentAbort: (() => void) | undefined;
      if (parentAbortSignal) {
        if (parentAbortSignal.aborted) {
          turnAbortController.abort(parentAbortSignal.reason);
        } else {
          onParentAbort = () => turnAbortController.abort(parentAbortSignal.reason);
          parentAbortSignal.addEventListener('abort', onParentAbort, { once: true });
        }
      }
      const abortSignal = turnAbortController.signal;
      (abortSignal as any).abort = (reason?: any) => turnAbortController.abort(reason);

      try {
        watchdogTimer = setInterval(async () => {
          if (Date.now() - invokeStartTime > maxCeilingMs) {
            if (watchdogTimer) {
              clearInterval(watchdogTimer);
              watchdogTimer = null;
            }
            turnAbortController.abort('ceiling_timeout');
            return;
          }
          try {
            options.onHeartbeat?.();
          } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          if (options.taskId && options.onRenewLease) {
            try {
              const renewed = await options.onRenewLease(options.taskId);
              if (renewed === false) {
                modelLeaseLost = true;
                (abortSignal as any).abort?.('lease_lost');
              }
            } catch {
              modelLeaseLost = true;
              (abortSignal as any).abort?.('lease_lost');
            }
          }
        }, watchdogIntervalMs);

        if (watchdogTimer && typeof (watchdogTimer as any).unref === 'function') {
          (watchdogTimer as any).unref();
        }

        const rawSchemas = this.toolGateway
          ? (() => {
              const compact = typeof (this.toolGateway as any).getCompactToolSchemas === 'function'
                ? (this.toolGateway as any).getCompactToolSchemas()
                : this.toolGateway.getToolSchemas();
              if (unlockedToolNames.size === 0) return compact;
              const seen = new Set(compact.map((s: any) => s.name));
              const extra = this.toolGateway.getToolSchemas().filter((s) => unlockedToolNames.has(s.name) && !seen.has(s.name));
              return [...compact, ...extra];
            })()
          : undefined;
        const formattedTools = rawSchemas
          ? rawSchemas.map((schema: any) => ({
              type: 'function' as const,
              function: {
                name: schema.name,
                description: schema.description,
                parameters: schema.parameters as Record<string, unknown>,
              },
            }))
          : undefined;

        const effectiveGateway = options.modelGateway || this.modelGateway;
        response = await effectiveGateway.invoke({
          modelId: currentModelId,
          fallbackModelId: undefined,
          disableFallback: true,
          messages: conversationHistory,
          tools: formattedTools,
          onToken: options.onToken,
          onThinkingToken: options.onThinkingToken,
          callerAgentId: options.agentId,
          signal: abortSignal,
        });

        // M2: In-flight model fallback turn persistence
        if (response?.switchedModelId) {
          options.modelId = response.switchedModelId;
          if (options.onModelSwitched) {
            options.onModelSwitched(response.switchedModelId);
          }
          if (options.agentRepo && options.agentId) {
            try {
              options.agentRepo.updateIdentity(options.agentId, { activeModelId: response.switchedModelId });
            } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          }
        }

        // Record token usage and enforce hard run budgets
        if (response?.tokensUsed && options.onTokenUsage) {
          try {
            const usageResult = await options.onTokenUsage(response.tokensUsed);
            if (usageResult && (usageResult as any).exceeded) {
              return {
                finalContent: `Execution halted: Hard token budget allocated for this run has been reached.`,
                turnCount: currentTurn,
                actions,
                isAborted: true,
              };
            }
          } catch (uErr) {
            console.warn('[KIN RUN] Token usage check notice:', uErr);
          }
        }
      } catch (err: any) {
        if (modelLeaseLost) {
          return {
            finalContent: `Execution halted: Task lease ownership for task '${options.taskId}' was lost or expired during model invocation.`,
            turnCount: currentTurn,
            actions,
            isAborted: true,
            reason: `Lost task lease ownership during model turn execution.`,
          };
        }

        const isAbort =
          err?.name === 'AbortError' ||
          err === 'steer' ||
          (abortSignal && abortSignal.aborted) ||
          (options.getAbortSignal && options.getAbortSignal()?.aborted);

        if (isAbort) {
          if (options.renewAbortSignal) {
            try { options.renewAbortSignal(); } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          }
          // Mid-task steering interrupt: drain steer directives and pivot immediately
          let steerDirectives: string[] = [];
          if (options.getSteerDirectives) {
            steerDirectives = options.getSteerDirectives() || [];
          }

          if (steerDirectives.length > 0) {
            const steerNotes = steerDirectives.map((s) => `- "${s}"`).join('\n');
            conversationHistory.push({
              role: 'user',
              content: `⚠️ [PRIORITY MID-EXECUTION STEERING DIRECTIVE FROM HUMAN OPERATOR]:\n${steerNotes}\nThe human operator redirected the active task in real-time. Immediately adapt your plan, acknowledge what was previously being done, and pivot to address this priority instruction.`,
            });
            continue;
          }

          // If steer was already injected into history on this turn right before abort:
          const lastMsg = conversationHistory[conversationHistory.length - 1];
          if (lastMsg && lastMsg.role === 'user' && lastMsg.content.includes('[PRIORITY MID-EXECUTION STEERING DIRECTIVE')) {
            continue;
          }

          return {
            finalContent: 'Execution cancelled.',
            turnCount: currentTurn,
            actions,
            isAborted: true,
            reason: err?.message || 'Execution cancelled',
          };
        }
        const errMsg = err?.message || String(err);
        if (QuotaGuard.isQuotaError(errMsg)) {
          const resetAt = Date.now() + 15 * 60 * 1000;
          this.recordInterruptedTurn(options.runId, currentTurn);
          if (options.onTurnCheckpoint) {
            try {
              await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
            } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          }
          if (options.onQuotaPaused) {
            try {
              await options.onQuotaPaused(currentTurn, resetAt, conversationHistory, actions);
            } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          }
          return {
            finalContent: `Execution gracefully paused due to provider quota limit (HTTP 429 / RESOURCE_EXHAUSTED). Turn checkpoint preserved.`,
            turnCount: currentTurn,
            actions,
            isQuotaPaused: true,
            quotaResetAt: resetAt,
            interruptedTurn: currentTurn,
            checkpointSaved: true,
          };
        }
        if (options.onModelUnavailable) {
          try {
            await options.onModelUnavailable(currentModelId, errMsg);
          } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
        }
        return {
          finalContent: `⚠️ Execution halted: The selected model "${currentModelId}" is unavailable.\n\nError: ${errMsg}\n\nOperator Action Required: Automatic fallback is disabled to prevent silent model changes. Please update your provider credentials in Settings or choose an alternative model in the Model Selector.`,
          turnCount: currentTurn,
          actions,
          isError: true,
          isModelUnavailable: true,
          modelId: currentModelId,
          error: errMsg,
        };
      } finally {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
        if (parentAbortSignal && onParentAbort) {
          parentAbortSignal.removeEventListener('abort', onParentAbort);
        }
      }

      if (modelLeaseLost) {
        this.recordInterruptedTurn(options.runId, currentTurn);
        return {
          finalContent: `Execution halted: Task lease ownership for task '${options.taskId}' was lost or expired during model invocation.`,
          turnCount: currentTurn,
          actions,
          isAborted: true,
          interruptedTurn: currentTurn,
          reason: `Lost task lease ownership during model turn execution.`,
        };
      }

      if (response.isError && QuotaGuard.isQuotaError(response.content)) {
        const resetAt = Date.now() + 15 * 60 * 1000;
        this.recordInterruptedTurn(options.runId, currentTurn);
        if (options.onTurnCheckpoint) {
          try {
            await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
          } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
        }
        if (options.onQuotaPaused) {
          try {
            await options.onQuotaPaused(currentTurn, resetAt, conversationHistory, actions);
          } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
        }
        return {
          finalContent: `Execution gracefully paused due to provider quota limit (HTTP 429 / RESOURCE_EXHAUSTED). Turn checkpoint preserved.`,
          turnCount: currentTurn,
          actions,
          isQuotaPaused: true,
          quotaResetAt: resetAt,
          interruptedTurn: currentTurn,
          checkpointSaved: true,
        };
      }

      if (response.isError) {
        const errorDetail = response.content || `Selected model "${currentModelId}" returned an error.`;
        if (options.onModelUnavailable) {
          try {
            await options.onModelUnavailable(currentModelId, errorDetail);
          } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
        }
        return {
          finalContent: `⚠️ Execution halted: The selected model "${currentModelId}" is unavailable.\n\nError: ${errorDetail}\n\nOperator Action Required: Automatic fallback is disabled to prevent unexpected costs or degraded responses. Please configure your provider API key in Settings or choose an alternative model in the Model Selector.`,
          turnCount: currentTurn,
          actions,
          isError: true,
          isModelUnavailable: true,
          modelId: currentModelId,
          error: errorDetail,
        };
      }

      const { cleanContent, thinking: extractedThinking } = separateThinkingAndContent(response.content, response.thinking);
      if (extractedThinking && !response.thinking) {
        response.thinking = extractedThinking;
        if (options.onThinkingToken) {
          options.onThinkingToken(extractedThinking);
        }
      }
      const content = cleanContent;
      const validTools = this.toolGateway ? new Set(this.toolGateway.getToolSchemas().map((s) => s.name)) : undefined;
      let toolCall = (response.toolCalls && response.toolCalls.length > 0)
        ? { name: response.toolCalls[0].name, params: response.toolCalls[0].parameters || {} }
        : this.extractToolCall(content, validTools);
      if (!toolCall && response.thinking) {
        toolCall = this.extractToolCall(response.thinking, validTools);
      }

      if (!toolCall) {
        if (content.includes('<tool_call>')) {
          conversationHistory.push({ role: 'assistant', content });
          conversationHistory.push({
            role: 'user',
            content: `<observation>\nERROR: Malformed <tool_call> syntax detected. Ensure your tool call strictly uses valid JSON inside <tool_call>{"name": "...", "parameters": {...}}</tool_call> without extra text or unescaped characters inside the tag.\n</observation>\nPlease correct your tool call or finalize your answer.`,
          });
          if (options.onTurnCheckpoint) {
            try {
              await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
            } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          }
          continue;
        }
        // No tool call requested — agent has reached clean final response
        const sepFinal = separateThinkingAndContent(content, response.thinking, { stripToolCalls: true }); finalContent = sepFinal.cleanContent.trim() || (sepFinal.thinking || response.thinking || '').trim();
        if (options.onTurnCheckpoint) {
          try {
            await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
          } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
        }
        break;
      }

      // Self-Healing Guard: detect consecutive identical failing tool invocations
      const previousAction = actions.length > 0 ? actions[actions.length - 1] : null;
      const isConsecutiveFailingDuplicate =
        previousAction &&
        previousAction.error &&
        previousAction.toolName === toolCall.name &&
        JSON.stringify(previousAction.params || {}) === JSON.stringify(toolCall.params || {});

      if (isConsecutiveFailingDuplicate) {
        const selfHealingMsg = `⚠️ [SELF-HEALING GUARD]: Action '${toolCall.name}' previously failed with identical parameters. Repeating the exact call was blocked to prevent an execution loop. Previous Error: "${previousAction.error}". Please pivot to an alternative approach, use a different tool/command, or summarize your findings.`;
        actions.push({
          toolName: toolCall.name,
          params: toolCall.params,
          error: selfHealingMsg,
          durationMs: 0,
        });
        conversationHistory.push({ role: 'assistant', content });
        conversationHistory.push({
          role: 'user',
          content: `<observation>\nERROR: ${selfHealingMsg}\n</observation>\nPlease reconsider your approach or finalize your response without repeating the same failing action.`,
        });
        continue;
      }

      // Record tool start
      if (options.onToolStart) {
        options.onToolStart(toolCall.name, toolCall.params);
      }

      // Pre-Tool Execution Instant Human Takeover Check
      if (options.checkTakeoverStatus) {
        let takeover = options.checkTakeoverStatus();
        while (takeover === 'pause') {
          await new Promise((r) => setTimeout(r, 500));
          takeover = options.checkTakeoverStatus();
        }
        if (takeover === 'abort') {
          this.recordInterruptedTurn(options.runId, currentTurn);
          return {
            finalContent: 'Execution aborted immediately via human takeover kill switch.',
            turnCount: currentTurn,
            actions,
            isAborted: true,
            interruptedTurn: currentTurn,
          };
        }
      }

      const startTime = Date.now();
      let toolOutput: any = null;
      let toolError: string | undefined = undefined;

      // 0. Pre-Execution Financial / Destructive Zero-Trust Check
      const finCheck = this.financialSafety.evaluateFinancialRisk(toolCall.name, toolCall.params);
      if (finCheck.requiresHardStop) {
        this.recordInterruptedTurn(options.runId, currentTurn);
        return {
          finalContent: `🚨 ZERO-TRUST FINANCIAL / DESTRUCTIVE STOP: Action '${toolCall.name}' triggered critical safety gate (${finCheck.reasons.join('; ')}). Interactive human authorization is required.`,
          turnCount: currentTurn,
          actions,
          requiresApproval: true,
          interruptedTurn: currentTurn,
          pendingApprovalDetails: { toolName: toolCall.name, params: toolCall.params, riskLevel: 'CRITICAL', reasons: finCheck.reasons },
          history: conversationHistory,
        };
      }

      // Capture pre-action observation snapshot for Observe-Act-Observe-Verify loop
      let preState: any = null;
      if (toolCall.name.startsWith('browser')) {
        const status = this.toolGateway.getBrowserController().getStatus();
        preState = {
          timestamp: Date.now(),
          type: 'browser',
          url: status.currentUrl,
          title: status.pageTitle,
        };
      } else if (toolCall.name.startsWith('desktop')) {
        preState = {
          timestamp: Date.now(),
          type: 'desktop',
        };
      }

      // Compute Effective Capabilities: @Boss retains full platform authority (*); specialists strictly inherit definition capabilities
      const effectiveCapabilities = options.allowedCapabilities !== undefined
        ? options.allowedCapabilities
        : ((options.agentId === 'agent-boss' || options.agentId.startsWith('agent-boss-')) ? ['*'] : ['fs:read', 'fs:write', 'agent:hire', 'agent:delegate']);

      // Route to ToolGateway
      let toolParentAbortSignal = options.getAbortSignal ? options.getAbortSignal() : undefined;
      if (toolParentAbortSignal?.aborted && options.renewAbortSignal) {
        toolParentAbortSignal = options.renewAbortSignal();
      }

      const toolAbortController = new AbortController();
      let onToolParentAbort: (() => void) | undefined;
      if (toolParentAbortSignal) {
        if (toolParentAbortSignal.aborted) {
          toolAbortController.abort((toolParentAbortSignal as any).reason || 'Aborted');
        } else {
          onToolParentAbort = () => {
            toolAbortController.abort((toolParentAbortSignal as any).reason || 'Aborted');
          };
          toolParentAbortSignal.addEventListener('abort', onToolParentAbort, { once: true });
        }
      }
      const toolAbortSignal = toolAbortController.signal;

      const toolCtx: ToolExecutionContext = {
        runId: options.runId,
        agentId: options.agentId,
        projectId: options.projectId,
        channelId: options.channelId,
        worktreeRoot: options.worktreeRoot,
        autonomyMode: options.autonomyMode,
        allowedCapabilities: effectiveCapabilities,
        abortSignal: toolAbortSignal,
        stepKey: (toolCall as any).id ? `turn-${currentTurn}:${(toolCall as any).id}` : `turn-${currentTurn}:step-${actions.length}:${toolCall.name}`,
      };

      // Check if already aborted before invoking tool
      if (toolAbortSignal?.aborted) {
        if (options.renewAbortSignal) {
          try { options.renewAbortSignal(); } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
        }
        let steerDirectives: string[] = [];
        if (options.getSteerDirectives) {
          steerDirectives = options.getSteerDirectives() || [];
        }
        if (steerDirectives.length > 0) {
          const steerNotes = steerDirectives.map((s) => `- "${s}"`).join('\n');
          conversationHistory.push({ role: 'assistant', content });
          conversationHistory.push({
            role: 'user',
            content: `⚠️ [PRIORITY MID-EXECUTION STEERING DIRECTIVE FROM HUMAN OPERATOR]:\n${steerNotes}\nThe human operator redirected the active task in real-time. Immediately adapt your plan, acknowledge what was previously being done, and pivot to address this priority instruction.`,
          });
          continue;
        }
      }

        let toolWatchdogTimer: NodeJS.Timeout | null = null;
        let toolLeaseLost = false;
        toolWatchdogTimer = setInterval(async () => {
          try {
            options.onHeartbeat?.();
            if (options.taskId && options.onRenewLease) {
              const renewed = await options.onRenewLease(options.taskId);
              if (renewed === false) {
                toolLeaseLost = true;
                toolAbortController.abort('Task lease expired or was revoked during tool execution');
              }
            }
          } catch {
            if (options.taskId && options.onRenewLease) {
              toolLeaseLost = true;
              toolAbortController.abort('Task lease expired or was revoked during tool execution');
            }
          }
        }, watchdogIntervalMs);
        if (toolWatchdogTimer && typeof (toolWatchdogTimer as any).unref === 'function') {
          (toolWatchdogTimer as any).unref();
        }

        let res;
        try {
          res = await this.toolGateway.executeTool(toolCall.name, toolCall.params || {}, toolCtx);
        } catch (callErr: any) {
          res = {
            success: false,
            error: callErr?.message || 'Tool execution encountered an unexpected error.',
            riskLevel: 'LOW' as const,
          };
        } finally {
          if (toolWatchdogTimer) {
            clearInterval(toolWatchdogTimer);
            toolWatchdogTimer = null;
          }
          if (toolParentAbortSignal && onToolParentAbort) {
            toolParentAbortSignal.removeEventListener('abort', onToolParentAbort);
          }
        }

        if (toolLeaseLost) {
          const durationMs = Date.now() - startTime;
          const leaseLossErr = 'Task lease expired or was revoked during tool execution';
          actions.push({
            toolName: toolCall.name,
            params: toolCall.params,
            output: undefined,
            error: leaseLossErr,
            durationMs,
          });
          if (options.onToolEnd) {
            options.onToolEnd(toolCall.name, undefined, leaseLossErr);
          }
          this.recordInterruptedTurn(options.runId, currentTurn);
          return {
            finalContent: `Execution halted: Task lease ownership for task '${options.taskId}' was lost or expired during execution of tool '${toolCall.name}'.`,
            turnCount: currentTurn,
            actions,
            isAborted: true,
            interruptedTurn: currentTurn,
            reason: `Lost task lease ownership during tool execution.`,
          };
        }

        const wasToolAborted =
          (toolAbortSignal && toolAbortSignal.aborted) ||
          (toolParentAbortSignal && toolParentAbortSignal.aborted) ||
          (options.getAbortSignal && options.getAbortSignal()?.aborted) ||
          (res.error && (
            res.error.includes('cancelled by operator via AbortSignal') ||
            res.error.includes('AbortSignal is already triggered')
          ));

        if (wasToolAborted) {
          toolError = res.error || 'Tool execution cancelled by operator via AbortSignal.';
          const durationMs = Date.now() - startTime;
          actions.push({
            toolName: toolCall.name,
            params: toolCall.params,
            output: undefined,
            error: toolError,
            durationMs,
          });

          if (options.onToolEnd) {
            options.onToolEnd(toolCall.name, undefined, toolError);
          }

          if (options.renewAbortSignal) {
            try { options.renewAbortSignal(); } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
          }

          let steerDirectives: string[] = [];
          if (options.getSteerDirectives) {
            steerDirectives = options.getSteerDirectives() || [];
          }

          conversationHistory.push({ role: 'assistant', content });
          conversationHistory.push({
            role: 'user',
            content: `<observation>\n[TOOL EXECUTION CANCELLED]: Action '${toolCall.name}' was cancelled mid-flight by operator directive.\n</observation>`,
          });

          if (steerDirectives.length > 0) {
            const steerNotes = steerDirectives.map((s) => `- "${s}"`).join('\n');
            conversationHistory.push({
              role: 'user',
              content: `⚠️ [PRIORITY MID-EXECUTION STEERING DIRECTIVE FROM HUMAN OPERATOR]:\n${steerNotes}\nThe human operator redirected the active task in real-time while '${toolCall.name}' was executing. Immediately adapt your plan, acknowledge what was previously being done, and pivot to address this priority instruction.`,
            });
            continue;
          }

          const takeover = options.checkTakeoverStatus ? options.checkTakeoverStatus() : 'continue';
          if (takeover === 'abort') {
            this.recordInterruptedTurn(options.runId, currentTurn);
            return {
              finalContent: `Execution halted: Operator intervened and terminated the run during execution of tool '${toolCall.name}'.`,
              turnCount: currentTurn,
              actions,
              isAborted: true,
              interruptedTurn: currentTurn,
              reason: `Operator abort takeover during tool execution.`,
            };
          }

          continue;
        }

        if (res.requiresApproval) {
          this.recordInterruptedTurn(options.runId, currentTurn);
          return {
            finalContent: `Action '${toolCall.name}' requires interactive human approval under ${options.autonomyMode} mode.`,
            turnCount: currentTurn,
            actions,
            requiresApproval: true,
            interruptedTurn: currentTurn,
            pendingApprovalDetails: { toolName: toolCall.name, params: toolCall.params, riskLevel: res.riskLevel },
            history: conversationHistory,
          };
        }

        if (res.success) {
          toolOutput = res.output;
        } else {
          toolError = res.error || 'Tool execution failed';
        }

        // Observe-Act-Observe-Verify Recovery Evaluation
        let recoveryNote = '';
        if (preState) {
          let postState: any = null;
          if (toolCall.name.startsWith('browser')) {
            const status = this.toolGateway.getBrowserController().getStatus();
            postState = {
              timestamp: Date.now(),
              type: 'browser',
              url: status.currentUrl,
              title: status.pageTitle,
              domSnippet: typeof toolOutput === 'string' ? toolOutput.slice(0, 500) : JSON.stringify(toolOutput || '').slice(0, 500),
            };

            // Evaluate Human Authorization Protocol boundary
            const authCheck = this.financialSafety.checkAuthProtocolRequirement(
              postState.url || '',
              postState.domSnippet || ''
            );
            if (authCheck.requiresUserAuth) {
              const durationMs = Date.now() - startTime;
              actions.push({
                toolName: toolCall.name,
                params: toolCall.params,
                output: toolOutput,
                error: toolError,
                durationMs,
              });
              if (options.onToolEnd) {
                options.onToolEnd(toolCall.name, toolOutput, toolError);
              }
              this.recordInterruptedTurn(options.runId, currentTurn);
              return {
                finalContent: `🔒 [HUMAN AUTHORIZATION PROTOCOL TRIGGERED]: ${authCheck.promptInstructions}\nExecution suspended waiting for user authorization.`,
                turnCount: currentTurn,
                actions,
                requiresApproval: true,
                interruptedTurn: currentTurn,
                pendingApprovalDetails: {
                  toolName: toolCall.name,
                  params: toolCall.params,
                  riskLevel: 'CRITICAL',
                  authProtocol: true,
                  promptInstructions: authCheck.promptInstructions,
                },
                history: conversationHistory,
              };
            }
          } else if (toolCall.name.startsWith('desktop')) {
            postState = {
              timestamp: Date.now(),
              type: 'desktop',
              domSnippet: toolError || '',
            };
          }

          if (postState) {
            const verifySpec: any = {};
            if (toolCall.params.expectedUrl || (toolCall.name === 'browserNavigate' && toolCall.params.url)) {
              verifySpec.expectedUrlPattern = toolCall.params.expectedUrl || toolCall.params.url;
            }
            if (toolCall.params.expectedTitle) {
              verifySpec.expectedTitlePattern = toolCall.params.expectedTitle;
            }
            if (toolCall.params.expectedText) {
              verifySpec.expectedTextPattern = toolCall.params.expectedText;
            }
            verifySpec.disallowedPatterns = ['error 404', 'access denied', 'recaptcha', 'cloudflare', 'blocked'];

            const verification = this.recoveryEngine.verify(preState, postState, verifySpec);
            if (!verification.passed) {
              this.recoveryEngine.recordRecoveryExperience({
                runId: options.runId,
                actionName: toolCall.name,
                objective: options.userPrompt,
                outcome: 'failure',
                failureReason: verification.discrepancies.join('; '),
                repairStrategy: verification.suggestedRecoveryStrategy,
              });

              recoveryNote += `\n⚠️ [RECOVERY ENGINE VERIFICATION DISCREPANCY]:\n${verification.discrepancies.map((d: string) => `- ${d}`).join('\n')}\nRecommended Self-Healing Strategy: '${verification.suggestedRecoveryStrategy || 'alternative_selector'}'. Please adjust your next action accordingly.`;
            } else if (!toolError) {
              this.recoveryEngine.recordRecoveryExperience({
                runId: options.runId,
                actionName: toolCall.name,
                objective: options.userPrompt,
                outcome: 'success',
              });
            }
          }
        }

        if (recoveryNote) {
          toolOutput = (toolOutput ? JSON.stringify(toolOutput) : '') + recoveryNote;
        }

        // Dynamic tool discovery: unlock matched schemas returned by search_tools for subsequent turns
        if ((toolCall.name === 'search_tools' || toolCall.name === 'searchTools') && !toolError && toolOutput && Array.isArray((toolOutput as any).tools)) {
          for (const discovered of (toolOutput as any).tools) {
            if (discovered?.name) unlockedToolNames.add(String(discovered.name));
          }
        }

      const durationMs = Date.now() - startTime;
      actions.push({
        toolName: toolCall.name,
        params: toolCall.params,
        output: toolOutput,
        error: toolError,
        durationMs,
      });

      if (options.onToolEnd) {
        options.onToolEnd(toolCall.name, toolOutput, toolError);
      }

      if (options.onHeartbeat) {
        try { options.onHeartbeat(); } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
      }

      // Record empirical action experience into SkillEngine learning pipeline
      try {
        if (toolError) {
          this.skillEngine.recordExperience({
            runId: options.runId,
            toolName: toolCall.name,
            objective: options.userPrompt,
            outcome: 'failure',
            failureReason: toolError,
            lessonsLearned: `Tool '${toolCall.name}' failed: ${toolError.slice(0, 200)}`,
            metadata: { durationMs },
          });
        } else {
          this.skillEngine.recordExperience({
            runId: options.runId,
            toolName: toolCall.name,
            objective: options.userPrompt,
            outcome: 'success',
            lessonsLearned: `Tool '${toolCall.name}' succeeded in ${durationMs}ms.`,
            metadata: { durationMs },
          });
        }
      } catch (expErr) {
        console.warn('[AgentLoopRunner] Experience recording notice:', expErr);
      }

      // Append assistant step (preserving intra-turn reasoning_content for DeepSeek V3.2) & observation
      conversationHistory.push({
        role: 'assistant',
        content,
        ...(response.thinking ? { reasoning_content: response.thinking } : {}),
      } as any);

      let displayOutput = toolOutput;
      let attachedImages: Array<{ mimeType: string; base64: string }> | undefined;
      if (toolOutput && typeof toolOutput === 'object' && typeof toolOutput.base64 === 'string') {
        attachedImages = [{
          mimeType: toolOutput.mimeType || 'image/png',
          base64: toolOutput.base64,
        }];
        displayOutput = {
          ...toolOutput,
          base64: `[base64 image payload attached as multimodal input: ${toolOutput.mimeType || 'image/png'}, ${toolOutput.width ? toolOutput.width + 'x' + toolOutput.height + ', ' : ''}${Math.round(toolOutput.base64.length * 0.75 / 1024)} KB]`,
        };
      }

      let rawObservationStr = toolError
        ? `ERROR: ${toolError}`
        : typeof displayOutput === 'string'
        ? displayOutput
        : JSON.stringify(displayOutput, null, 2);

      // Spill oversized tool output (>4000 UTF-8 bytes) to disk using OutputSpiller
      if (Buffer.byteLength(rawObservationStr, 'utf-8') > 4000) {
        const spill = this.outputSpiller.processOutput(rawObservationStr, toolCall.name);
        rawObservationStr = spill.content;
      }

      // Sanitize payment details and sensitive tokens before injecting into model context
      rawObservationStr = this.financialSafety.scrubSensitiveContext(rawObservationStr);

      // Neutralize delimiter collision attacks inside untrusted observation output with per-turn nonce
      const obsNonce = Math.random().toString(36).slice(2, 10);
      const safeObservationStr = rawObservationStr
        .replace(/<\/?(observation|tool_call|tool|function_call|invoke|think)\b/gi, (m) => m.replace('<', '<\\'));

      // Evict older image byte payloads beyond the most recent 1 screenshot to bound tokens/VRAM
      if (attachedImages) {
        for (const msg of conversationHistory as any[]) {
          if (msg.images) delete msg.images;
        }
      }

      conversationHistory.push({
        role: 'user',
        content: `<observation nonce="${obsNonce}">\n${safeObservationStr}\n</observation>\nEvaluate this observation and proceed to your next step or provide your final response.`,
        ...(attachedImages ? { images: attachedImages } : {}),
      } as any);

      // If agent invoked awaitBoardWakeup and parked on the board, pause/exit loop cleanly
      if (toolOutput && typeof toolOutput === 'object' && (toolOutput as any).parked === true) {
        finalContent = (toolOutput as any).message || 'Parked waiting on board wakeup.';
        if (options.onTurnCheckpoint) {
          try {
            await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
          } catch {}
        }
        break;
      }

      // If the LLM returned multiple parallel toolCalls in this turn, run each through full safety, approval, and spill guards
      const remainingParallelCalls = (response.toolCalls && response.toolCalls.length > 1)
        ? response.toolCalls.slice(1, 5)
        : [];
      if (remainingParallelCalls.length > 0) {
        for (const extraCall of remainingParallelCalls) {
          if (options.getAbortSignal?.()?.aborted) break;
          if (options.checkTakeoverStatus?.() === 'abort') break;

          const extraParams = extraCall.parameters || {};
          const extraRisk = this.toolGateway.classifyRisk(extraCall.name, extraParams);
          const extraFin = this.financialSafety.evaluateFinancialRisk(extraCall.name, extraParams);
          if (extraFin.requiresHardStop) {
            if (options.onTurnCheckpoint) {
              try { await options.onTurnCheckpoint(currentTurn, conversationHistory, actions); } catch {}
            }
            return {
              finalContent: `Execution suspended awaiting human operator approval for financial action: ${extraCall.name}`,
              turnCount: currentTurn,
              actions,
              requiresApproval: true,
              interruptedTurn: currentTurn,
              pendingApprovalDetails: {
                toolName: extraCall.name,
                params: extraParams,
                riskLevel: extraRisk,
              },
              history: conversationHistory,
            };
          }

          if (options.onToolStart) {
            options.onToolStart(extraCall.name, extraParams);
          }

          const extraCtx: ToolExecutionContext = {
            ...toolCtx,
            stepKey: (extraCall as any).id ? `turn-${currentTurn}:${(extraCall as any).id}` : `turn-${currentTurn}:step-${actions.length}:${extraCall.name}`,
          };
          const extraStart = Date.now();
          let extraRes: any;
          try {
            extraRes = await this.toolGateway.executeTool(extraCall.name, extraParams, extraCtx);
          } catch (err: any) {
            extraRes = { success: false, error: err?.message || String(err), riskLevel: extraRisk };
          }
          const extraDur = Date.now() - extraStart;

          if (options.onToolEnd) {
            options.onToolEnd(extraCall.name, extraRes.output, extraRes.error);
          }

          actions.push({
            toolName: extraCall.name,
            params: extraParams,
            output: extraRes.output,
            error: extraRes.error,
            durationMs: extraDur,
          });

          if (extraRes.requiresApproval) {
            if (options.onTurnCheckpoint) {
              try { await options.onTurnCheckpoint(currentTurn, conversationHistory, actions); } catch {}
            }
            return {
              finalContent: `Execution suspended awaiting human operator approval for ${extraCall.name}: ${extraRes.error || ''}`,
              turnCount: currentTurn,
              actions,
              requiresApproval: true,
              interruptedTurn: currentTurn,
              pendingApprovalDetails: {
                toolName: extraCall.name,
                params: extraParams,
                riskLevel: extraRes.riskLevel || extraRisk,
              },
              history: conversationHistory,
            };
          }

          const extraRaw = extraRes.error
            ? `ERROR: ${extraRes.error}`
            : (typeof extraRes.output === 'string' ? extraRes.output : JSON.stringify(extraRes.output, null, 2));
          const extraScrubbed = this.financialSafety.scrubSensitiveContext(extraRaw);
          const extraText = this.outputSpiller.processOutput(extraScrubbed, extraCall.name).content;
          const extraSafe = extraText
            .replace(/<\/?(observation|tool_call|tool|function_call|invoke|think)\b/gi, (m: string) => m.replace('<', '<\\'));
          const extraNonce = Math.random().toString(36).slice(2, 10);
          conversationHistory.push({
            role: 'user',
            content: `<observation nonce="${extraNonce}">\n${extraSafe}\n</observation>`,
          } as any);
        }
        if (response.toolCalls && response.toolCalls.length > 5) {
          conversationHistory.push({
            role: 'user',
            content: `<observation>\nNOTICE: ${response.toolCalls.length - 5} additional parallel tool call(s) were omitted (max 5 per turn). Re-issue remaining calls if still needed.\n</observation>`,
          } as any);
        }
      }

      // Save turn checkpoint at each completed turn boundary
      if (options.onTurnCheckpoint) {
        try {
          await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
        } catch (cpErr) {
          console.warn(`[AgentLoopRunner] Turn ${currentTurn} checkpoint save notice:`, cpErr);
        }
      }
    }
    } catch (err) {
      this.recordInterruptedTurn(options.runId, currentTurn);
      throw err;
    }

    if (!finalContent && currentTurn >= maxTurns) {
      finalContent = `Execution halted: Turn limit of ${maxTurns} reached before task completion.`;
      return {
        finalContent,
        turnCount: currentTurn,
        actions,
        success: false,
        maxTurnsReached: true,
        reason: `Turn limit of ${maxTurns} reached without task completion.`,
      };
    }

    if (!finalContent) {
      if (actions.length > 0) {
        finalContent = `Execution completed after ${actions.length} action(s).`;
      } else {
        const lastAssistantMsg = conversationHistory.filter((m) => m.role === 'assistant').pop(); finalContent = (lastAssistantMsg?.content || '').trim() || 'Task finished without additional tool actions.';
      }
    }

    // Outcome measurement & skill effectiveness feedback loop
    try {
      const overallOutcome =
        actions.length > 0 && actions.every((a) => !a.error)
          ? 'success'
          : actions.some((a) => a.error)
          ? 'failure'
          : 'success';

      for (const skill of matchedSkills) {
        this.skillEngine.recordExperience({
          skillId: skill.id,
          runId: options.runId,
          objective: options.userPrompt,
          outcome: overallOutcome,
          lessonsLearned: `Run completed with ${actions.length} action(s). Skill '${skill.name}' was active. Outcome: ${overallOutcome}.`,
        });
      }
    } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }

    await HookRegistry.getInstance().runHooks('Stop', {
      repoRoot: options.worktreeRoot,
      runId: options.runId,
      agentId: options.agentId,
      result: { finalContent, turnCount: currentTurn, actionCount: actions.length },
    });
    Sentinel.getInstance().clearRunTaint(options.runId);

    return {
      finalContent,
      turnCount: currentTurn,
      actions,
    };
  }

  private buildSystemPrompt(basePrompt: string, skills: Skill[]): string {
    let skillText = '';
    if (skills.length > 0) {
      skillText = `\n\nRELEVANT PROCEDURAL SKILLS:\n` + skills.map((s) => `[Skill: ${s.name}]\n${s.instructions}`).join('\n\n');
    }

    const mcpSchemas = this.toolGateway?.getToolSchemas().filter((t) => t.name.startsWith('mcp__')) || [];
    let mcpToolsText = '';
    if (mcpSchemas.length > 0) {
      const sampleServer = mcpSchemas[0].name.split('__')[1] || 'server';
      const sampleTool = mcpSchemas[0].name.split('__').slice(2).join('__') || 'tool';
      mcpToolsText = `\n\nCONNECTED MCP EXTENSION TOOLS (Active & Ready to Call):\n` +
        mcpSchemas.map((t, idx) => {
          const propNames = Object.keys((t.parameters as any)?.properties || {});
          const argList = propNames.length > 0 ? propNames.join(', ') : '';
          return `${32 + idx}. ${t.name}(${argList}) — ${t.description}`;
        }).join('\n') +
        `\n\nTo invoke a connected MCP tool, use its exact name in <tool_call>:\n<tool_call>\n{"name": "${mcpSchemas[0].name}", "parameters": { ... }}\n</tool_call>\nOr use the generic mcp_call dispatcher:\n<tool_call>\n{"name": "mcp_call", "parameters": {"server": "${sampleServer}", "tool": "${sampleTool}", "arguments": { ... }}}\n</tool_call>`;
    }

    const alreadyHasTools = basePrompt.includes('AVAILABLE TOOLS SPECIFICATION') || basePrompt.includes('TOOL INSTRUCTIONS:');
    const toolsSection = alreadyHasTools
      ? (mcpToolsText ? `\n\n${mcpToolsText}` : '')
      : `
TOOL INSTRUCTIONS:
You have access to the following native and desktop tools:
1. readFile(filePath: string) — Read file contents from project jail.
2. writeFile(filePath: string, content: string) — Write or overwrite file in project jail.
3. editFile(filePath: string, target?: string, replacement?: string, unifiedDiff?: string) — Surgical edit via search-replace or unified diff.
4. listDirectory(path?: string) — List files and directories in path.
5. grep(pattern: string, path?: string, isRegex?: boolean) — Search code across workspace.
6. glob(pattern: string, path?: string) — Find files matching glob pattern.
7. executeShell(command: string) — Run shell/PowerShell command in project jail.
8. schedule(type: "one_shot" | "cron", prompt: string, durationSeconds?: number, cronExpression?: string) — Schedule non-blocking timer/wakeup.
9. computer(action: "screenshot"|"mouse_move"|"mouse_click"|"type"|"send_key"|"list_windows"|"focus_window"|"close_window", x?: number, y?: number, text?: string, key?: string, titleOrPid?: string) — Unified desktop GUI control.
10. browser(action: "navigate"|"click"|"type"|"inspect"|"screenshot"|"evaluate"|"step"|"close"|"status", url?: string, selector?: string, text?: string, script?: string) — Unified controllable browser session.
11. load_skill(nameOrId?: string, level?: "L0"|"L1"|"L2") — Progressively load reusable procedural skills.
12. search_tools(query: string) — Discover extended management or custom tools.
13. delegateToAgent(targetAgent: string, directive: string, isolated?: boolean) — Coordinate or delegate task directive to a peer specialist agent.
14. run_workflow(steps: Array<{ id: string, toolName: string, params: object }>) — Execute bounded multi-step tool DAG.
15. awaitBoardWakeup(channelId?: string, mentionsOnly?: boolean) — Park cleanly until woken by a channel message.
16. read_spill(hash: string, offset?: number, limit?: number) — Read bounded excerpt of a spilled large observation log from disk by content hash.
17. hireSpecialist(displayName: string, roleTitle: string, systemPrompt?: string, suggestedModel?: string, domainAuthority?: string[]) — Onboard and hire a new specialist or subagent into this project and channel. Both orchestrators and specialists can hire subagents under them as required.
18. rememberProject / recallChannel / sendDirectMessage / assignCoworker / callMeeting (available natively or via search_tools).${mcpToolsText}`;

    return `${basePrompt}${skillText}${toolsSection}

CRITICAL TOOL INVOCATION RULES:
1. You have direct access to tools for inspecting the workspace, reading files, creating files, and running commands. When instructed to inspect, list files, read a file (e.g. package.json, README), search code, write files, or execute commands, you MUST invoke the appropriate tool (e.g. readFile, listDirectory, writeFile, executeShell) immediately using <tool_call> tags. NEVER refuse, apologize, or claim you lack access or permission.
2. Output tool calls using EXACTLY this XML format:
<tool_call>
{"name": "tool_name", "parameters": {"param1": "val1"}}
</tool_call>

Examples:
To read a file:
<tool_call>
{"name": "readFile", "parameters": {"filePath": "package.json"}}
</tool_call>

To list directory contents:
<tool_call>
{"name": "listDirectory", "parameters": {"dirPath": "."}}
</tool_call>

To write a file:
<tool_call>
{"name": "writeFile", "parameters": {"path": "app/build.gradle.kts", "content": "// Gradle config"}}
</tool_call>

To call an MCP tool:
<tool_call>
{"name": "mcp__filesystem__list_directory", "parameters": {"path": "."}}
</tool_call>

To inspect a spilled observation:
<tool_call>
{"name": "read_spill", "parameters": {"hash": "<hash>", "offset": 0, "limit": 4000}}
</tool_call>

To delegate or coordinate with another specialist:
<tool_call>
{"name": "delegateToAgent", "parameters": {"targetAgent": "@QAEngineer", "directive": "Review test criteria"}}
</tool_call>

3. When you receive the <observation>, synthesize the findings and report them directly to the user in your response (e.g. if you listed directory files or read a file, report the actual content, answers, and findings the user asked for). Do NOT simply say "I have evaluated the observation" without answering.
4. When communicating via sendDirectMessage, state your question or deliverable once. Do NOT invoke sendDirectMessage repeatedly with identical content. When the interaction concludes, conclude with [ACK] or [COMPLETE].`;
  }

  public extractToolCall(content: string, validTools?: Set<string>): { name: string; params: any } | null {
    return AgentLoopRunner.extractToolCall(content, validTools);
  }

  public static extractToolCall(content: string, validTools?: Set<string>): { name: string; params: any } | null {
    if (!content || typeof content !== 'string') return null;

    const extractBalancedJsonBlocks = (text: string): string[] => {
      const blocks: string[] = [];
      let inString = false;
      let stringChar = '';
      let escape = false;
      let braceDepth = 0;
      let startIndex = -1;

      for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (escape) {
          escape = false;
          continue;
        }

        if (char === '\\' && inString) {
          escape = true;
          continue;
        }

        if (inString) {
          if (char === stringChar) {
            inString = false;
          }
          continue;
        }

        if (char === '"' || char === "'") {
          inString = true;
          stringChar = char;
          continue;
        }

        if (char === '{') {
          if (braceDepth === 0) {
            startIndex = i;
          }
          braceDepth++;
        } else if (char === '}') {
          if (braceDepth > 0) {
            braceDepth--;
            if (braceDepth === 0 && startIndex !== -1) {
              blocks.push(text.slice(startIndex, i + 1));
              startIndex = -1;
            }
          }
        }
      }

      return blocks;
    };

    const sanitizeJsonString = (rawPayload: string): string => {
      let cleaned = rawPayload.trim();

      // 1. Unwrap markdown code fence if present
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```$/, '').trim();
      }

      // 2. Normalize single quotes if python/js style dict
      if (cleaned.startsWith("{'") || cleaned.includes("': '") || cleaned.includes("': {")) {
        cleaned = cleaned.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
      }

      // 3. Normalize path backslashes in known file path fields
      cleaned = cleaned.replace(
        /("(?:path|filePath|dirPath|targetPath|worktreeRoot|cwd|appNameOrPath|file|filename|target|src|dest)"\s*:\s*")([^"]*)(")/gi,
        (_m, prefix, pathVal, suffix) => {
          const normalized = pathVal.replace(/\\+/g, '/');
          return `${prefix}${normalized}${suffix}`;
        }
      );

      // 4. Escape unescaped newlines/tabs/control characters inside double-quoted string literals
      let inStr = false;
      let esc = false;
      let out = '';
      for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (esc) {
          out += ch;
          esc = false;
          continue;
        }
        if (ch === '\\' && inStr) {
          out += ch;
          esc = true;
          continue;
        }
        if (ch === '"') {
          inStr = !inStr;
          out += ch;
          continue;
        }
        if (inStr) {
          if (ch === '\n') {
            out += '\\n';
            continue;
          }
          if (ch === '\r') {
            out += '\\r';
            continue;
          }
          if (ch === '\t') {
            out += '\\t';
            continue;
          }
          if (ch === '\b') {
            out += '\\b';
            continue;
          }
          if (ch === '\f') {
            out += '\\f';
            continue;
          }
          if (ch.charCodeAt(0) < 0x20) {
            out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
            continue;
          }
        }
        out += ch;
      }
      cleaned = out;

      // 5. Escape stray unescaped backslashes across all strings:
      cleaned = cleaned.replace(/(?<!\\)\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');

      // 6. Pre-clean trailing commas in objects and arrays
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

      return cleaned;
    };

    const parseJsonPayload = (
      rawPayload: string,
      requireParams = false,
      validToolsSet?: Set<string>
    ): { name: string; params: any } | null => {
      const sanitized = sanitizeJsonString(rawPayload);
      try {
        const parsed = JSON.parse(sanitized);
        const toolName = parsed.name || parsed.tool;
        if (toolName && typeof toolName === 'string') {
          const hasParams =
            parsed.parameters !== undefined ||
            parsed.params !== undefined ||
            parsed.arguments !== undefined ||
            parsed.args !== undefined;

          if (requireParams && !hasParams) {
            return null;
          }

          if (validToolsSet && validToolsSet.size > 0) {
            const isMcpOrSkill =
              toolName.startsWith('mcp__') ||
              toolName.startsWith('skill__') ||
              toolName.startsWith('skill_') ||
              toolName.startsWith('mcp:') ||
              toolName === 'mcp_call' ||
              toolName === 'mcpCall';
            if (!validToolsSet.has(toolName) && !isMcpOrSkill) {
              return null;
            }
          }

          return {
            name: toolName,
            params: parsed.parameters || parsed.params || parsed.arguments || parsed.args || {},
          };
        }
      } catch (e) {
        // Fallback: Relaxed regex extraction
        try {
          const nameMatch = rawPayload.match(/["'](?:name|tool)["']\s*:\s*["']([^"']+)["']/);
          if (nameMatch) {
            const name = nameMatch[1];
            if (validToolsSet && validToolsSet.size > 0) {
              const isMcpOrSkill =
                name.startsWith('mcp__') ||
                name.startsWith('skill__') ||
                name.startsWith('skill_') ||
                name.startsWith('mcp:') ||
                name === 'mcp_call' ||
                name === 'mcpCall';
              if (!validToolsSet.has(name) && !isMcpOrSkill) {
                return null;
              }
            }
            const paramsMatch =
              rawPayload.match(/["'](?:parameters|params|arguments|args)["']\s*:\s*(\{[\s\S]*\})/i);
            if (paramsMatch) {
              const blocks = extractBalancedJsonBlocks(paramsMatch[0]);
              if (blocks.length > 0) {
                const pCleaned = sanitizeJsonString(blocks[0]);
                const params = JSON.parse(pCleaned);
                return { name, params };
              }
            }
            if (!requireParams) {
              return { name, params: {} };
            }
          }
        } catch (err) { console.debug("[agent_loop] Suppressed exception in catch block:", err); }
      }
      return null;
    };

    const strippedContent = content
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<thought>[\s\S]*?<\/thought>/gi, '');

    // For prompt injection immunity: strip markdown blockquotes (lines starting with >)
    // as they represent quoted/untrusted context and should never be extracted as tool invocations.
    const nonQuotedContent = strippedContent.replace(/^[ \t]*>.*$/gm, '');

    // 1. Explicit tags: <tool_call> or <tool> or <function_call>
    const tagMatch = nonQuotedContent.match(/<(tool_call|tool|function_call)>([\s\S]*?)(?:<\/\1>|$)/i);
    if (tagMatch) {
      const res = parseJsonPayload(tagMatch[2], false, validTools);
      if (res) return res;
    }

    const isValidExtractedTool = (name: string): boolean => {
      if (!validTools || validTools.size === 0) return true;
      return validTools.has(name) || name.startsWith('mcp__') || name.startsWith('skill_');
    };

    // 1b. XML-style function call syntax (Dots Studio, Hermes, MiniMax, Anthropic XML):
    // <invoke name="tool_name"><parameter name="key">val</parameter></invoke> or <call name="tool_name">...
    const xmlInvokeMatch = nonQuotedContent.match(/<(?:invoke|function_call|function|call)\s+name=["']([^"']+)["']>([\s\S]*?)<\/(?:invoke|function_call|function|call)>/i);
    if (xmlInvokeMatch && isValidExtractedTool(xmlInvokeMatch[1].trim())) {
      const toolName = xmlInvokeMatch[1].trim();
      const inner = xmlInvokeMatch[2];
      const params: Record<string, any> = {};
      const paramMatches = Array.from(inner.matchAll(/<(?:parameter|param|arg|argument)\s+name=["']([^"']+)["']>([\s\S]*?)<\/(?:parameter|param|arg|argument)>/gi));
      if (paramMatches.length > 0) {
        for (const pm of paramMatches) {
          const pName = pm[1].trim();
          const pVal = pm[2].trim();
          try {
            params[pName] = JSON.parse(pVal);
          } catch {
            params[pName] = pVal;
          }
        }
      } else {
        const childTagMatches = Array.from(inner.matchAll(/<([a-zA-Z0-9_-]+)>([\s\S]*?)<\/\1>/gi));
        for (const cm of childTagMatches) {
          const pName = cm[1].trim();
          const pVal = cm[2].trim();
          try {
            params[pName] = JSON.parse(pVal);
          } catch {
            params[pName] = pVal;
          }
        }
      }
      return { name: toolName, params };
    }

    // 1c. Dots Studio function call syntax (<dots_function_call> ... </invoke>)
    const dotsMatch = nonQuotedContent.match(/<dots_function_call>([\s\S]*?)(?:<\/invoke>|<\/dots_function_call>|$)/i);
    if (dotsMatch) {
      const inner = dotsMatch[1];
      const nameMatch = inner.match(/=\s*["']?([a-zA-Z0-9_-]+)["']?/);
      if (nameMatch && isValidExtractedTool(nameMatch[1].trim())) {
        const toolName = nameMatch[1].trim();
        const paramsMatch = inner.match(/parameters\s*=\s*(\{[\s\S]*?\})/i);
        let params: Record<string, any> = {};
        if (paramsMatch) {
          const rawParams = paramsMatch[1];
          try {
            const norm = rawParams
              .replace(/([,{]\s*)=\s*"?([a-zA-Z0-9_-]+)"?\s*=/g, '$1"$2":')
              .replace(/\}+\s*$/, '}');
            params = JSON.parse(norm);
          } catch {
            const kvMatches = Array.from(rawParams.matchAll(/["']?([a-zA-Z0-9_-]+)["']?\s*[=:]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,}\n]+)/g));
            for (const kv of kvMatches) {
              const k = kv[1];
              let v = kv[2].trim();
              if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                try {
                  v = JSON.parse(v);
                } catch {
                  v = v.slice(1, -1);
                }
              }
              params[k] = v;
            }
          }
        }
        return { name: toolName, params };
      }
    }

    // 2. Markdown code fences
    const codeBlockMatches = nonQuotedContent.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
    for (const match of codeBlockMatches) {
      const block = match[1].trim();
      if (block.includes('"name"') || block.includes('"tool"') || block.includes("'name'") || block.includes("'tool'")) {
        const res = parseJsonPayload(block, true, validTools);
        if (res) return res;
      }
    }

    // 3. Balanced JSON blocks anywhere in content (handles raw JSON with any key ordering or surrounding text)
    const blocks = extractBalancedJsonBlocks(nonQuotedContent);
    for (const block of blocks) {
      if (block.includes('"name"') || block.includes('"tool"') || block.includes("'name'") || block.includes("'tool'")) {
        const res = parseJsonPayload(block, true, validTools);
        if (res) return res;
      }
    }

    return null;
  }
}

