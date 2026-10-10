// ============================================================================
// KIN AUTONOMOUS MULTI-TURN REACT AGENT LOOP
// Multi-turn iterative tool execution, observation parsing, self-correction,
// computer use & persistent browser orchestration, context scrubbing,
// and bounded execution quotas.
// ============================================================================

import { ModelGateway } from '../execution/model_gateway.js';
import { ToolGateway, ToolExecutionContext } from '../execution/tool_gateway.js';
import { SchedulerService } from '../automation/scheduler.js';
import { SkillEngine, Skill } from '../skills/skill_engine.js';
import { RecoveryEngine } from '../recovery/recovery_engine.js';
import { FinancialSafetyShield } from '../policy/financial_safety.js';
import { AutonomyMode } from '../domain/types.js';
import * as path from 'node:path';
import { OutputSpiller } from '../context/output_spiller.js';
import { ContextCompactor } from '../context/context_compactor.js';
import { LoopBreaker } from '../communication/loop_breaker.js';

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
  taskRepo?: any;
  decisionRepo?: any;
  checkTakeoverStatus?: () => 'continue' | 'pause' | 'abort';
  getSteerDirectives?: () => string[];
  getModelId?: () => string;
  agentRepo?: any;
  onModelSwitched?: (newModelId: string) => void;
  getAbortSignal?: () => AbortSignal | undefined;
  renewAbortSignal?: () => AbortSignal | undefined;
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
  success?: boolean;
  interrupted?: boolean;
  reason?: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
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

  /**
   * Executes a multi-turn ReAct loop until task completes, approval is required, or maxTurns reached.
   */
  public async execute(options: AgentLoopOptions): Promise<AgentLoopResult> {
    const maxTurns = options.maxTurns || 12;
    const actions: AgentLoopAction[] = [];
    const promptForSkills = options.userPrompt || (options.initialMessages?.slice(-1)[0]?.content ?? '');
    const standardCapabilities = [
      'readFile',
      'writeFile',
      'listDirectory',
      'executeShell',
      'schedule',
      'cancelSchedule',
      'listSchedules',
      'computer',
      'application',
      'browser',
      'desktopScreenshot',
      'desktopDiscoverApps',
      'desktopLaunchApp',
      'desktopListWindows',
      'desktopFocusWindow',
      'desktopCloseWindow',
      'desktopMouseMove',
      'desktopMouseClick',
      'desktopType',
      'desktopSendKey',
      'browserNavigate',
      'browserClick',
      'browserType',
      'browserInspect',
      'browserScreenshot',
      'browserEvaluate',
      'browserStep',
      'browserClose',
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

    while (currentTurn < maxTurns) {
      // Check instant human takeover status
      if (options.checkTakeoverStatus) {
        const takeover = options.checkTakeoverStatus();
        if (takeover === 'abort') {
          return {
            finalContent: 'Execution aborted immediately via human takeover kill switch.',
            turnCount: currentTurn,
            actions,
            isAborted: true,
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
      if (conversationHistory.length > 4) {
        const estimatedTokens = conversationHistory.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
        const maxTokens = 16000;
        if (estimatedTokens > maxTokens * 0.75) {
          let persistedMessages: Array<{ id: string; content: string }> = [];
          if (options.taskRepo?.db && options.channelId) {
            try {
              persistedMessages = options.taskRepo.db.query(
                'SELECT id, content FROM messages WHERE channel_id = ? ORDER BY created_at ASC',
                options.channelId
              );
            } catch {}
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
                .filter((a) => a.toolName === 'writeFile' && !a.error)
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
                  dependsOn: t.dependencies || [],
                }));

              completedTasks = allTasks
                .filter((t: any) => t.status === 'completed')
                .map((t: any) => ({
                  id: t.id,
                  title: t.title + (t.description ? `: ${t.description}` : ''),
                  evidenceUri: t.evidenceBundleId || undefined,
                }));
            } catch {}
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
            } catch {}
          }

          const activeTaskObj = options.taskId && options.taskRepo ? options.taskRepo.getTask(options.taskId) : undefined;
          const activeTaskTitle = activeTaskObj?.title
            ? (activeTaskObj.description ? `${activeTaskObj.title}: ${activeTaskObj.description}` : activeTaskObj.title)
            : (options.taskId ? `Task ${options.taskId}` : `Turn ${currentTurn}`);

          const compactionResult = this.contextCompactor.evaluateAndCompact({
            messages: compMessages,
            currentTokens: estimatedTokens,
            maxTokens,
            compactionThresholdRatio: 0.75,
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
            }));
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
        try { options.onHeartbeat(); } catch {}
      }
      if (options.taskId && options.onRenewLease) {
        try { await options.onRenewLease(options.taskId); } catch {}
      }

      // 4d. LoopBreaker Action Stagnation Evaluation (Authoritative Halt)
      const loopCheck = this.loopBreaker.evaluateActionRepetition(actions);
      if (loopCheck.isLoop) {
        return {
          finalContent: `Anti-Loop Guard triggered: ${loopCheck.reason}. Execution paused for operator guidance.`,
          turnCount: currentTurn,
          actions,
          success: false,
          interrupted: true,
          requiresApproval: true,
          reason: `Anti-Loop Guard triggered: ${loopCheck.reason}. Execution paused for operator guidance.`,
          history: conversationHistory,
        };
      }

      // Invoke LLM (dynamically resolves active model if changed mid-execution)
      const currentModelId = options.getModelId ? options.getModelId() : options.modelId;
      let response;
      const watchdogIntervalMs = 15000;
      const maxCeilingMs = 60 * 60 * 1000; // 60 minutes maximum ceiling for reasoning models
      const invokeStartTime = Date.now();
      let watchdogTimer: NodeJS.Timeout | null = null;

      let modelLeaseLost = false;
      try {
        watchdogTimer = setInterval(async () => {
          if (Date.now() - invokeStartTime > maxCeilingMs) {
            if (watchdogTimer) {
              clearInterval(watchdogTimer);
              watchdogTimer = null;
            }
            return;
          }
          try {
            options.onHeartbeat?.();
          } catch {}
          if (options.taskId && options.onRenewLease) {
            try {
              const renewed = await options.onRenewLease(options.taskId);
              if (renewed === false) {
                modelLeaseLost = true;
              }
            } catch {
              modelLeaseLost = true;
            }
          }
        }, watchdogIntervalMs);

        if (watchdogTimer && typeof (watchdogTimer as any).unref === 'function') {
          (watchdogTimer as any).unref();
        }

        let abortSignal = options.getAbortSignal ? options.getAbortSignal() : undefined;
        if (abortSignal?.aborted && options.renewAbortSignal) {
          abortSignal = options.renewAbortSignal();
        }
        response = await this.modelGateway.invoke({
          modelId: currentModelId,
          fallbackModelId: options.fallbackModelId,
          messages: conversationHistory,
          onToken: options.onToken,
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
            } catch {}
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
        const isAbort =
          err?.name === 'AbortError' ||
          err === 'steer' ||
          (options.getAbortSignal && options.getAbortSignal()?.aborted);

        if (isAbort) {
          if (options.renewAbortSignal) {
            try { options.renewAbortSignal(); } catch {}
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
        }
        const errMsg = err?.message || String(err);
        if (this.isQuotaError(errMsg)) {
          const resetAt = Date.now() + 15 * 60 * 1000;
          if (options.onTurnCheckpoint) {
            try {
              await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
            } catch {}
          }
          if (options.onQuotaPaused) {
            try {
              await options.onQuotaPaused(currentTurn, resetAt, conversationHistory, actions);
            } catch {}
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
        throw err;
      } finally {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
      }

      if (modelLeaseLost) {
        return {
          finalContent: `Execution halted: Task lease ownership for task '${options.taskId}' was lost or expired during model invocation.`,
          turnCount: currentTurn,
          actions,
          isAborted: true,
          reason: `Lost task lease ownership during model turn execution.`,
        };
      }

      if (response.isError && this.isQuotaError(response.content)) {
        const resetAt = Date.now() + 15 * 60 * 1000;
        if (options.onTurnCheckpoint) {
          try {
            await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
          } catch {}
        }
        if (options.onQuotaPaused) {
          try {
            await options.onQuotaPaused(currentTurn, resetAt, conversationHistory, actions);
          } catch {}
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

      const content = response.content;
      let toolCall = this.extractToolCall(content);
      if (!toolCall && response.thinking) {
        toolCall = this.extractToolCall(response.thinking);
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
            } catch {}
          }
          continue;
        }
        // No tool call requested — agent has reached final response
        finalContent = content.trim();
        if (options.onTurnCheckpoint) {
          try {
            await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
          } catch {}
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
          return {
            finalContent: 'Execution aborted immediately via human takeover kill switch.',
            turnCount: currentTurn,
            actions,
            isAborted: true,
          };
        }
      }

      const startTime = Date.now();
      let toolOutput: any = null;
      let toolError: string | undefined = undefined;

      // 0. Pre-Execution Financial / Destructive Zero-Trust Check
      const finCheck = this.financialSafety.evaluateFinancialRisk(toolCall.name, toolCall.params);
      if (finCheck.requiresHardStop) {
        return {
          finalContent: `🚨 ZERO-TRUST FINANCIAL / DESTRUCTIVE STOP: Action '${toolCall.name}' triggered critical safety gate (${finCheck.reasons.join('; ')}). Interactive human authorization is required.`,
          turnCount: currentTurn,
          actions,
          requiresApproval: true,
          pendingApprovalDetails: { toolName: toolCall.name, params: toolCall.params, riskLevel: 'CRITICAL', reasons: finCheck.reasons },
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
        : (options.agentId === 'agent-boss' ? ['*'] : ['fs:read', 'fs:write', 'agent:hire', 'agent:delegate']);

      // Route to ToolGateway
      const toolCtx: ToolExecutionContext = {
        runId: options.runId,
        agentId: options.agentId,
        projectId: options.projectId,
        channelId: options.channelId,
        worktreeRoot: options.worktreeRoot,
        autonomyMode: options.autonomyMode,
        allowedCapabilities: effectiveCapabilities,
      };

        let toolWatchdogTimer: NodeJS.Timeout | null = null;
        let toolLeaseLost = false;
        if (options.taskId && options.onRenewLease) {
          toolWatchdogTimer = setInterval(async () => {
            try {
              options.onHeartbeat?.();
              const renewed = await options.onRenewLease!(options.taskId!);
              if (renewed === false) {
                toolLeaseLost = true;
              }
            } catch {
              toolLeaseLost = true;
            }
          }, watchdogIntervalMs);
          if (toolWatchdogTimer && typeof (toolWatchdogTimer as any).unref === 'function') {
            (toolWatchdogTimer as any).unref();
          }
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
        }

        if (toolLeaseLost) {
          return {
            finalContent: `Execution halted: Task lease ownership for task '${options.taskId}' was lost or expired during execution of tool '${toolCall.name}'.`,
            turnCount: currentTurn,
            actions,
            isAborted: true,
            reason: `Lost task lease ownership during tool execution.`,
          };
        }

        if (res.requiresApproval) {
          return {
            finalContent: `Action '${toolCall.name}' requires interactive human approval under ${options.autonomyMode} mode.`,
            turnCount: currentTurn,
            actions,
            requiresApproval: true,
            pendingApprovalDetails: { toolName: toolCall.name, params: toolCall.params, riskLevel: res.riskLevel },
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
              return {
                finalContent: `🔒 [HUMAN AUTHORIZATION PROTOCOL TRIGGERED]: ${authCheck.promptInstructions}\nExecution suspended waiting for user authorization.`,
                turnCount: currentTurn,
                actions,
                requiresApproval: true,
                pendingApprovalDetails: {
                  toolName: toolCall.name,
                  params: toolCall.params,
                  riskLevel: 'CRITICAL',
                  authProtocol: true,
                  promptInstructions: authCheck.promptInstructions,
                },
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
        try { options.onHeartbeat(); } catch {}
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

      // Append assistant step & observation to conversation history
      conversationHistory.push({ role: 'assistant', content });

      let displayOutput = toolOutput;
      if (toolOutput && typeof toolOutput === 'object' && typeof toolOutput.base64 === 'string') {
        // Omit massive raw image base64 strings from prompt context to prevent token overflows
        displayOutput = {
          ...toolOutput,
          base64: `[base64 image payload: ${toolOutput.mimeType || 'image/png'}, ${toolOutput.width ? toolOutput.width + 'x' + toolOutput.height + ', ' : ''}${Math.round(toolOutput.base64.length * 0.75 / 1024)} KB omitted from LLM prompt]`,
        };
      }

      let rawObservationStr = toolError
        ? `ERROR: ${toolError}`
        : typeof displayOutput === 'string'
        ? displayOutput
        : JSON.stringify(displayOutput, null, 2);

      // Spill oversized tool output (>4000 characters) to disk using OutputSpiller
      if (rawObservationStr.length > 4000) {
        const spill = this.outputSpiller.processOutput(rawObservationStr, toolCall.name);
        rawObservationStr = spill.content;
      }

      // Sanitize payment details and sensitive tokens before injecting into model context
      rawObservationStr = this.financialSafety.scrubSensitiveContext(rawObservationStr);

      conversationHistory.push({
        role: 'user',
        content: `<observation>\n${rawObservationStr}\n</observation>\nEvaluate this observation and proceed to your next step or provide your final response.`,
      });

      // Save turn checkpoint at each completed turn boundary
      if (options.onTurnCheckpoint) {
        try {
          await options.onTurnCheckpoint(currentTurn, conversationHistory, actions);
        } catch (cpErr) {
          console.warn(`[AgentLoopRunner] Turn ${currentTurn} checkpoint save notice:`, cpErr);
        }
      }
    }

    if (!finalContent) {
      if (actions.length > 0) {
        finalContent = `Execution completed after ${actions.length} action(s).`;
      } else {
        finalContent = 'Task finished without additional tool actions.';
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
    } catch {}

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
      mcpToolsText = `\n\nCONNECTED MCP EXTENSION TOOLS (Active & Ready to Call):\n` +
        mcpSchemas.map((t, idx) => {
          const propNames = Object.keys((t.parameters as any)?.properties || {});
          const argList = propNames.length > 0 ? propNames.join(', ') : '';
          return `${26 + idx}. ${t.name}(${argList}) — ${t.description}`;
        }).join('\n') +
        `\n\nTo invoke a connected MCP tool, use its exact name in <tool_call>:\n<tool_call>\n{"name": "${mcpSchemas[0].name}", "parameters": { ... }}\n</tool_call>`;
    }

    return `${basePrompt}${skillText}

TOOL INSTRUCTIONS:
You have access to the following native and desktop tools:
1. readFile(path: string) — Read file contents from project jail.
2. writeFile(path: string, content: string) — Write or overwrite file in project jail.
3. listDirectory(path?: string) — List files and directories in path.
4. executeShell(command: string) — Run shell/PowerShell command in project jail.
5. schedule(type: "one_shot" | "cron", prompt: string, durationSeconds?: number, cronExpression?: string) — Schedule non-blocking timer/wakeup.
6. computer(action: "screenshot"|"mouse_move"|"left_click"|"right_click"|"double_click"|"type"|"key", x?: number, y?: number, text?: string, key?: string) — Unified standard computer use action.
7. application(action: "list"|"launch"|"list_windows"|"focus"|"close", name?: string, titleOrPid?: string|number, args?: string[]) — Unified application & window manager.
8. browser(action: "navigate"|"click"|"type"|"inspect"|"screenshot"|"evaluate"|"step"|"close"|"status", url?: string, selector?: string, text?: string, script?: string) — Controllable persistent browser session.
9. desktopScreenshot() — Capture desktop screen.
10. desktopDiscoverApps() — Discover installed desktop applications (VS Code, Android Studio, WhatsApp, browsers, etc.).
11. desktopLaunchApp(appNameOrPath: string, args?: string[]) — Launch an installed desktop application.
12. desktopListWindows() — List active GUI windows on host.
13. desktopFocusWindow(titleOrPid: string | number) — Focus/bring window to foreground.
14. desktopMouseMove(x: number, y: number) — Move cursor.
15. desktopMouseClick(x: number, y: number, button?: "left"|"right"|"middle", doubleClick?: boolean) — Click mouse.
16. desktopType(text: string) — Type text at cursor.
17. browserNavigate(url: string) — Open URL in persistent browser session with session cookies.
18. browserClick(selector?: string, x?: number, y?: number) — Click web element by selector or coordinate.
19. browserType(selector: string, text: string, clear?: boolean) — Type into web form input.
20. browserInspect(selector?: string) — Inspect interactive elements on page.
21. browserScreenshot() — Take screenshot of current browser page.
22. browserStep(action: "navigate"|"click"|"type"|"scroll"|"screenshot"|"wait", url?: string, selector?: string, text?: string) — Step-by-step browser automation.
23. browserClose() — Close browser session.
24. delegateToAgent(targetAgent: string, directive: string) [or coordinateWithAgent] — Coordinate or delegate task directive to a peer specialist agent (e.g. @Backend, @Frontend, @QA, @AndroidDev).
25. hireSpecialist(displayName: string, roleTitle: string, systemPrompt?: string, suggestedModel?: string, domainAuthority?: string[]) — Onboard and hire a new specialist or subagent into this project and channel. Both orchestrators and specialists can hire subagents under them as required.${mcpToolsText}

CRITICAL TOOL INVOCATION RULES:
1. When instructed to create files, scaffold projects, build applications, or execute commands, you MUST invoke the appropriate tool (e.g. writeFile, executeShell, or an MCP tool) immediately. NEVER just describe what you plan to do in text without calling the tool.
2. Output tool calls using EXACTLY this XML format:
<tool_call>
{"name": "tool_name", "parameters": {"param1": "val1"}}
</tool_call>

Examples:
To write a file:
<tool_call>
{"name": "writeFile", "parameters": {"path": "app/build.gradle.kts", "content": "// Gradle config"}}
</tool_call>

To call an MCP tool:
<tool_call>
{"name": "mcp__filesystem__list_directory", "parameters": {"path": "."}}
</tool_call>

To delegate or coordinate with another specialist:
<tool_call>
{"name": "delegateToAgent", "parameters": {"targetAgent": "@QAEngineer", "directive": "Review test criteria"}}
</tool_call>

3. When you receive the <observation>, evaluate the result and continue with your next tool or summarize the completed work.`;
  }

  public extractToolCall(content: string): { name: string; params: any } | null {
    return AgentLoopRunner.extractToolCall(content);
  }

  public static extractToolCall(content: string): { name: string; params: any } | null {
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
        /("(?:path|filePath|dirPath|targetPath|worktreeRoot|cwd|appNameOrPath)"\s*:\s*")([^"]*)(")/gi,
        (_m, prefix, pathVal, suffix) => {
          const normalized = pathVal.replace(/\\+/g, '/');
          return `${prefix}${normalized}${suffix}`;
        }
      );

      // 4. Escape unescaped newlines/tabs inside double-quoted string literals
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
        }
        out += ch;
      }
      cleaned = out;

      // 5. Escape stray unescaped backslashes across all strings:
      cleaned = cleaned.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');

      // 6. Pre-clean trailing commas in objects and arrays
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

      return cleaned;
    };

    const parseJsonPayload = (rawPayload: string): { name: string; params: any } | null => {
      const sanitized = sanitizeJsonString(rawPayload);
      try {
        const parsed = JSON.parse(sanitized);
        const toolName = parsed.name || parsed.tool;
        if (toolName && typeof toolName === 'string') {
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
            return { name, params: {} };
          }
        } catch {}
      }
      return null;
    };

    // 1. Explicit tags: <tool_call> or <tool> or <function_call>
    const tagMatch = content.match(/<(tool_call|tool|function_call)>([\s\S]*?)(?:<\/\1>|$)/i);
    if (tagMatch) {
      const res = parseJsonPayload(tagMatch[2]);
      if (res) return res;
    }

    // 2. Markdown code fences
    const codeBlockMatches = content.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
    for (const match of codeBlockMatches) {
      const block = match[1].trim();
      if (block.includes('"name"') || block.includes('"tool"') || block.includes("'name'") || block.includes("'tool'")) {
        const res = parseJsonPayload(block);
        if (res) return res;
      }
    }

    // 3. Balanced JSON blocks anywhere in content (handles raw JSON with any key ordering or surrounding text)
    const blocks = extractBalancedJsonBlocks(content);
    for (const block of blocks) {
      if (block.includes('"name"') || block.includes('"tool"') || block.includes("'name'") || block.includes("'tool'")) {
        const res = parseJsonPayload(block);
        if (res) return res;
      }
    }

    return null;
  }

  private isQuotaError(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (
      lower.includes('429') ||
      lower.includes('resource_exhausted') ||
      lower.includes('rate_limit') ||
      lower.includes('quota') ||
      lower.includes('too many requests')
    );
  }
}

