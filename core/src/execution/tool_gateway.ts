// ============================================================================
// KIN TOOL GATEWAY
// Central tool execution gateway with capability checks, risk classification,
// worktree jail confinement, desktop/GUI control, browser automation,
// and zero-trust financial/destructive safety gates.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { AutonomyMode, RiskLevel } from '../domain/types.js';
import { DesktopController } from '../computer/desktop_controller.js';
import { BrowserController, WebStepAction } from '../browser/browser_controller.js';
import { FinancialSafetyShield } from '../policy/financial_safety.js';
import { PolicyEngine } from '../policy/policy_engine.js';
import { SchedulerService } from '../automation/scheduler.js';
import { ToolDefinitionSchema } from '../context/context_compiler.js';
import { KinDatabase } from '../storage/db.js';
import { ComputerSupervisor } from '../computer/computer_supervisor.js';
import { SkillEngine } from '../skills/skill_engine.js';
import { McpClientManager } from './mcp_client.js';
import { Sentinel } from '../security/sentinel.js';
import { SecretBroker } from '../security/secret_broker.js';
import { ExecutionNodeRouter, ExecutionNodeInfo } from './execution_node.js';
import { EventLedger } from '../security/event_ledger.js';

export class StaleWriteConflictError extends Error {
  public code = 'STALE_WRITE_CONFLICT';
  public filePath: string;
  public expectedHash?: string;
  public currentHash: string;

  constructor(filePath: string, currentHash: string, expectedHash?: string) {
    super(
      `STALE_WRITE_CONFLICT: File '${filePath}' was modified externally or by another agent. Expected hash ${expectedHash || 'none'}, but found ${currentHash}. Conflict must be reviewed and resolved in Workbench.`
    );
    this.name = 'StaleWriteConflictError';
    this.filePath = filePath;
    this.currentHash = currentHash;
    this.expectedHash = expectedHash;
  }
}

export interface ToolExecutionContext {
  runId: string;
  agentId: string;
  parentRunId?: string;
  parentCapabilities?: string[];
  worktreeRoot: string;
  autonomyMode: AutonomyMode;
  allowedCapabilities: string[];
  subagentWhitelist?: {
    permittedPaths?: string[];
    permittedCommands?: string[];
  };
  projectId?: string;
  channelId?: string;
  abortSignal?: AbortSignal;
  expectedHash?: string;
  forceWrite?: boolean;
  approvalToken?: string;
}

export interface ToolInvocationResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
  requiresApproval?: boolean;
  riskLevel: RiskLevel;
  executionNode?: ExecutionNodeInfo;
  degradedNotice?: string;
}

export class ToolGateway {
  private desktopController: DesktopController;
  private browserController: BrowserController;
  private financialSafety: FinancialSafetyShield;
  private policyEngine: PolicyEngine;
  private scheduler?: SchedulerService;
  private db?: KinDatabase;
  private computerSupervisor?: ComputerSupervisor;
  private skillEngine?: SkillEngine;
  private mcpClient?: McpClientManager;
  private singleUseApprovalTokens: Map<string, { toolName: string; runId?: string; expiresAt: number }> = new Map();

  constructor(options?: {
    desktopController?: DesktopController;
    browserController?: BrowserController;
    financialSafety?: FinancialSafetyShield;
    scheduler?: SchedulerService;
    db?: KinDatabase;
    computerSupervisor?: ComputerSupervisor;
    skillEngine?: SkillEngine;
    policyEngine?: PolicyEngine;
    mcpClient?: McpClientManager;
  }) {
    this.desktopController = options?.desktopController ?? new DesktopController();
    this.browserController = options?.browserController ?? new BrowserController();
    this.financialSafety = options?.financialSafety ?? new FinancialSafetyShield();
    this.policyEngine = options?.policyEngine ?? new PolicyEngine();
    this.scheduler = options?.scheduler;
    this.db = options?.db;
    this.computerSupervisor = options?.computerSupervisor;
    this.skillEngine = options?.skillEngine;
    this.mcpClient = options?.mcpClient;
  }

  public setPolicyEngine(policyEngine: PolicyEngine): void {
    this.policyEngine = policyEngine;
  }

  public getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  public setMcpClient(mcpClient: McpClientManager): void {
    this.mcpClient = mcpClient;
  }

  public getMcpClient(): McpClientManager | undefined {
    return this.mcpClient;
  }

  public generateApprovalToken(toolName: string, runId?: string, ttlMs: number = 60000): string {
    const token = `appr-tok-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
    this.singleUseApprovalTokens.set(token, {
      toolName,
      runId,
      expiresAt: Date.now() + ttlMs,
    });
    Sentinel.getInstance().registerApprovalToken(token, toolName, ttlMs, runId);
    return token;
  }

  public consumeApprovalToken(token: string, toolName: string, runId?: string): boolean {
    const record = this.singleUseApprovalTokens.get(token);
    const sentinelHasToken = Sentinel.getInstance().hasApprovalToken(token);
    if (!record && !sentinelHasToken) return false;

    if (record) {
      if (Date.now() > record.expiresAt) {
        this.singleUseApprovalTokens.delete(token);
        return false;
      }
      if (record.toolName !== toolName && record.toolName !== '*') return false;
      if (record.runId && runId && record.runId !== runId) return false;
    }

    const sentinelConsumed = Sentinel.getInstance().consumeApprovalToken(token, toolName, runId);
    if (record) {
      this.singleUseApprovalTokens.delete(token);
      return true;
    }
    return sentinelConsumed;
  }

  public setSkillEngine(skillEngine: SkillEngine): void {
    this.skillEngine = skillEngine;
  }

  public getSkillEngine(): SkillEngine | undefined {
    return this.skillEngine;
  }

  public setDatabase(db: KinDatabase): void {
    this.db = db;
  }

  public getDatabase(): KinDatabase | undefined {
    return this.db;
  }

  public setComputerSupervisor(supervisor: ComputerSupervisor): void {
    this.computerSupervisor = supervisor;
  }

  public getComputerSupervisor(): ComputerSupervisor | undefined {
    return this.computerSupervisor;
  }

  public getDesktopController(): DesktopController {
    return this.desktopController;
  }

  public getBrowserController(): BrowserController {
    return this.browserController;
  }

  public getFinancialSafety(): FinancialSafetyShield {
    return this.financialSafety;
  }

  public getScheduler(): SchedulerService | undefined {
    return this.scheduler;
  }

  public setScheduler(scheduler: SchedulerService): void {
    this.scheduler = scheduler;
  }

  public async getEffectiveBrowserController(context?: ToolExecutionContext): Promise<BrowserController> {
    if (this.computerSupervisor && context?.agentId) {
      return this.computerSupervisor.getAgentBrowserController(context.agentId);
    }
    return this.browserController;
  }

  public async executeWithDesktopLock<R>(context: ToolExecutionContext, fn: () => Promise<R>): Promise<R> {
    if (this.computerSupervisor) {
      return this.computerSupervisor.withDesktopLock(context.agentId || 'system', fn);
    }
    return fn();
  }

  /**
   * Authoritative specification of all active tools available to the multi-agent workforce.
   * Deterministically exported for compilation into Block 2 of LLM context.
   */
  public getToolSchemas(): ToolDefinitionSchema[] {
    const schemas: ToolDefinitionSchema[] = [
      {
        name: 'readFile',
        description: 'Read the contents of a file within the project workspace.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path of the target file within the workspace root' },
            maxBytes: { type: 'number', description: 'Maximum bytes to read (default: 2MB)' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'writeFile',
        description: 'Write content to a file within the project workspace with atomic retry.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path of the target file' },
            content: { type: 'string', description: 'Full text or base64 content to write' },
            encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'Text or base64 binary encoding' },
          },
          required: ['filePath', 'content'],
        },
      },
      {
        name: 'listDirectory',
        description: 'List contents of a directory in the project workspace.',
        parameters: {
          type: 'object',
          properties: {
            dirPath: { type: 'string', description: 'Directory path relative to project root (empty or "." for root)' },
          },
          required: ['dirPath'],
        },
      },
      {
        name: 'executeShell',
        description: 'Execute a shell command with strict timeout inside the project workspace directory.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
            timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds (default: 60000)' },
          },
          required: ['command'],
        },
      },
      {
        name: 'schedule',
        description: 'Schedule a durable one-shot wakeup timer or recurring routine for non-blocking agent sleep.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Directive or reminder prompt to execute upon wakeup' },
            durationSeconds: { type: 'number', description: 'Duration in seconds for one-shot timer' },
            cronExpression: { type: 'string', description: 'Cron expression or interval (e.g. 30s, */5 * * * *)' },
            type: { type: 'string', enum: ['one_shot', 'cron'], description: 'Schedule type' },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'cancelSchedule',
        description: 'Cancel an active timer or recurring schedule by ID.',
        parameters: {
          type: 'object',
          properties: {
            scheduleId: { type: 'string', description: 'Unique identifier of the schedule to cancel' },
          },
          required: ['scheduleId'],
        },
      },
      {
        name: 'listSchedules',
        description: 'List currently active scheduled timers and routines.',
        parameters: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Optional project ID filter' },
            channelId: { type: 'string', description: 'Optional channel ID filter' },
          },
        },
      },
      {
        name: 'desktopScreenshot',
        description: 'Capture screenshot of the desktop screen for visual computer-use inspection.',
        parameters: {
          type: 'object',
          properties: {
            targetDisplay: { type: 'number', description: 'Display index (default: 0)' },
          },
        },
      },
      {
        name: 'desktopMouseMove',
        description: 'Move mouse cursor to absolute screen coordinates.',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X pixel coordinate' },
            y: { type: 'number', description: 'Y pixel coordinate' },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'desktopMouseClick',
        description: 'Click mouse button at specified screen coordinates.',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X pixel coordinate' },
            y: { type: 'number', description: 'Y pixel coordinate' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button to click' },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'desktopType',
        description: 'Type text into active desktop window with keyboard simulation.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text string to type' },
          },
          required: ['text'],
        },
      },
      {
        name: 'browserNavigate',
        description: 'Navigate headless/interactive Chromium browser to URL.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Complete web URL to navigate to' },
          },
          required: ['url'],
        },
      },
      {
        name: 'browserClick',
        description: 'Click an element matching CSS selector on current web page.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of the element' },
          },
          required: ['selector'],
        },
      },
      {
        name: 'browserInspect',
        description: 'Inspect active browser page URL, title, and interactive DOM elements.',
        parameters: {
          type: 'object',
          properties: {
            detailed: { type: 'boolean', description: 'Whether to include full interactive element inventory' },
          },
        },
      },
      {
        name: 'delegateToAgent',
        description: 'Coordinate or delegate a task directive to a peer specialist agent in the project workforce (e.g. @Backend, @Frontend, @QA).',
        parameters: {
          type: 'object',
          properties: {
            targetAgent: { type: 'string', description: 'Name or ID of specialist agent to coordinate with' },
            directive: { type: 'string', description: 'Actionable instructions or question for the peer agent' },
            channelId: { type: 'string', description: 'Optional target channel ID' },
          },
          required: ['targetAgent', 'directive'],
        },
      },
      {
        name: 'create_skill',
        description: 'Dynamically create and persist a new reusable skill or custom tool definition in the application.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Unique identifier or slug for the skill (e.g. data-analyzer)' },
            description: { type: 'string', description: 'Summary of what the skill does and when agents should use it' },
            instructions: { type: 'string', description: 'Step-by-step guidance, procedures, or system instructions for the skill' },
            handlerCode: { type: 'string', description: 'Optional TypeScript or JavaScript executable logic or tool implementation' },
            parameters: { type: 'object', description: 'Optional input parameter schema for the skill' },
            requiredTools: { type: 'array', items: { type: 'string' }, description: 'Tools required by this skill' },
            triggerPatterns: { type: 'array', items: { type: 'string' }, description: 'Keywords or trigger phrases activating this skill' },
            skillType: { type: 'string', enum: ['prompt_instruction', 'tool_extension', 'workflow'], description: 'Category of skill' },
            enabled: { type: 'boolean', description: 'Whether the skill is active immediately (default: true)' },
          },
          required: ['name', 'description'],
        },
      },
      {
        name: 'import_skill',
        description: 'Import an external skill package, bundle, or directory into persistent storage.',
        parameters: {
          type: 'object',
          properties: {
            bundleJson: { type: 'string', description: 'Raw JSON string or object of a portable skill or bundle' },
            directoryPath: { type: 'string', description: 'Path to a directory containing SKILL.md or bundle files' },
          },
        },
      },
      {
        name: 'proposePlanAdjustment',
        description: 'Propose an architectural or milestone plan adjustment to a goal for interactive operator review via a decision card.',
        parameters: {
          type: 'object',
          properties: {
            goalId: { type: 'string', description: 'ID of the goal to adjust' },
            proposal: {
              type: 'object',
              description: 'Structured proposal containing title, topic, optionA, optionB, and recommendation',
            },
          },
          required: ['goalId'],
        },
      },
    ];

    const mcp = this.mcpClient;
    if (mcp) {
      const mcpTools = mcp.getAllTools();
      for (const t of mcpTools) {
        schemas.push({
          name: `mcp__${t.serverName}__${t.name}`,
          description: `[MCP Server: ${t.serverName}] ${t.description || t.name}`,
          parameters: t.inputSchema || { type: 'object', properties: {} },
        });
      }
    }

    return schemas;
  }

  /**
   * Maps every tool to its discrete capability tag and recognized aliases.
   */
  public getRequiredCapability(toolName: string): { primary: string; aliases: string[] } {
    if (toolName.startsWith('mcp__')) {
      return { primary: 'mcp:call', aliases: ['mcp:call', 'mcp', toolName, '*'] };
    }

    switch (toolName) {
      case 'create_skill':
      case 'createSkill':
      case 'import_skill':
      case 'importSkill':
        return { primary: 'skills:manage', aliases: ['skills:manage', 'skills', 'skill', 'agent:coordinate', 'create_skill', 'createSkill', 'import_skill', 'importSkill', '*'] };

      case 'readFile':
      case 'listDirectory':
        return { primary: 'fs:read', aliases: ['fs:read', 'fs_read', 'read', 'fs'] };

      case 'writeFile':
        return { primary: 'fs:write', aliases: ['fs:write', 'fs_write', 'write', 'fs'] };

      case 'executeShell':
        return { primary: 'shell:exec', aliases: ['shell:exec', 'shell', 'exec'] };

      case 'browser':
      case 'browserNavigate':
      case 'browserClick':
      case 'browserType':
      case 'browserInspect':
      case 'browserScreenshot':
      case 'browserEvaluate':
      case 'browserStep':
      case 'browserClose':
        return { primary: 'web:browse', aliases: ['web:browse', 'web', 'browser', 'web_browse'] };

      case 'computer':
      case 'application':
      case 'desktopScreenshot':
      case 'desktopDiscoverApps':
      case 'desktopLaunchApp':
      case 'desktopListWindows':
      case 'desktopFocusWindow':
      case 'desktopCloseWindow':
      case 'desktopMouseMove':
      case 'desktopMouseClick':
      case 'desktopType':
      case 'desktopSendKey':
        return { primary: 'gui:desktop', aliases: ['gui:desktop', 'gui', 'desktop', 'computer', 'gui_desktop'] };

      case 'schedule':
      case 'cancelSchedule':
      case 'listSchedules':
        return { primary: 'schedule:cron', aliases: ['schedule:cron', 'schedule', 'cron'] };

      case 'delegateToAgent':
        return { primary: 'agent:delegate', aliases: ['agent:delegate', 'delegate', 'agent'] };

      default:
        return { primary: 'fs:read', aliases: ['fs:read', 'fs_read', 'read', 'fs'] };
    }
  }

  public checkCapabilityAuthorized(toolName: string, allowedCapabilities?: string[]): { authorized: boolean; requiredTag: string } {
    const capInfo = this.getRequiredCapability(toolName);
    if (!allowedCapabilities || allowedCapabilities.length === 0 || allowedCapabilities.includes('*')) {
      return { authorized: true, requiredTag: capInfo.primary };
    }

    const tName = toolName.trim().toLowerCase();
    const isAllowed = allowedCapabilities.some((allowed) => {
      const norm = allowed.trim().toLowerCase();
      return norm === '*' || norm === tName || capInfo.aliases.map((a) => a.toLowerCase()).includes(norm);
    });

    return { authorized: isAllowed, requiredTag: capInfo.primary };
  }

  private recordActionRecord(
    context: ToolExecutionContext,
    toolName: string,
    params: Record<string, any>,
    result: { success: boolean; output?: any; error?: string },
    status: 'success' | 'failure' | 'requires_approval' | 'aborted',
    durationMs: number
  ): void {
    if (!this.db) return;
    try {
      const id = uuidv4();
      const sanitizedParams = SecretBroker.getInstance().sanitizePayload(params || {});
      const paramsJson = JSON.stringify(sanitizedParams);
      let outputSnippet: string | undefined;
      if (result.output) {
        const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
        outputSnippet = raw.slice(0, 1000);
      } else if (result.error) {
        outputSnippet = result.error.slice(0, 1000);
      }

      this.db.execute(
        `INSERT INTO action_records (id, run_id, agent_id, tool_name, params_json, output_snippet, status, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        context.runId || null,
        context.agentId || 'system',
        toolName,
        paramsJson,
        outputSnippet || null,
        status,
        durationMs,
        Date.now()
      );
    } catch (err) {
      console.warn('[TOOL GATEWAY] Failed to log action_record:', err);
    }
  }

  /**
   * Dispatches and executes a tool call through security and autonomy checks.
   */
  public async executeTool<T = unknown>(
    toolName: string,
    params: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolInvocationResult<T>> {
    const startTime = Date.now();
    const risk = this.classifyRisk(toolName, params);

    // 0. Hard Abort Check
    if (context.abortSignal?.aborted) {
      const res: ToolInvocationResult<T> = {
        success: false,
        riskLevel: risk,
        error: 'ABORTED: Action was cancelled by operator via AbortSignal.',
      };
      this.recordActionRecord(context, toolName, params, res, 'aborted', Date.now() - startTime);
      return res;
    }

    // 1. Sentinel Authoritative Evaluation (fail-closed capabilities, destructive action detection, approval tokens, secret resolution)
    const sentinel = Sentinel.getInstance();
    const sentinelResult = sentinel.evaluate({
      agentId: context.agentId,
      runId: context.runId,
      parentRunId: context.parentRunId,
      toolName,
      params,
      riskLevel: risk,
      autonomyMode: context.autonomyMode,
      agentCapabilities: context.allowedCapabilities,
      authorizationToken: context.approvalToken,
    });

    if (!sentinelResult.allowed) {
      const res: ToolInvocationResult<T> = {
        success: false,
        riskLevel: risk,
        error: sentinelResult.reason,
      };
      this.recordActionRecord(context, toolName, params, res, 'failure', Date.now() - startTime);
      return res;
    }

    if (sentinelResult.requiresApproval) {
      const res: ToolInvocationResult<T> = {
        success: false,
        requiresApproval: true,
        riskLevel: risk,
        error: sentinelResult.reason,
      };
      this.recordActionRecord(context, toolName, params, res, 'requires_approval', Date.now() - startTime);
      return res;
    }

    const effectiveParams = sentinelResult.sanitizedParams || params;

    // 2. Execution Node Routing with Honest Degradation Reporting
    const router = ExecutionNodeRouter.getInstance();
    const node = router.getNodeForTool(toolName, true);

    try {
      const nodeResult = await node.execute<ToolInvocationResult<T>>(toolName, effectiveParams, async (execParams) => {
        return await this.dispatchToolExecution<T>(toolName, execParams, context, risk);
      });

      const rawResult: ToolInvocationResult<T> = nodeResult.data || {
        success: nodeResult.success,
        error: nodeResult.error,
        riskLevel: risk,
      };

      rawResult.executionNode = nodeResult.node;
      if (nodeResult.degradedNotice) {
        rawResult.degradedNotice = nodeResult.degradedNotice;
      }

      // 3. Secret Redaction on Outgoing Observations
      if (typeof rawResult.output === 'string') {
        rawResult.output = sentinel.sanitizeObservation(rawResult.output) as unknown as T;
      } else if (rawResult.output && typeof rawResult.output === 'object') {
        rawResult.output = SecretBroker.getInstance().sanitizePayload(rawResult.output);
      }

      const durationMs = Date.now() - startTime;
      const status = rawResult.success ? 'success' : 'failure';
      this.recordActionRecord(context, toolName, params, rawResult, status, durationMs);
      return rawResult;
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      const res: ToolInvocationResult<T> = {
        success: false,
        riskLevel: risk,
        error: e.message,
        executionNode: node.getInfo(),
      };
      this.recordActionRecord(context, toolName, params, res, 'failure', durationMs);
      return res;
    }
  }

  private async dispatchToolExecution<T>(
    toolName: string,
    params: Record<string, any>,
    context: ToolExecutionContext,
    risk: RiskLevel
  ): Promise<ToolInvocationResult<T>> {
    // Dynamic MCP Tool Invocation
    if (toolName.startsWith('mcp__')) {
      if (!this.mcpClient) {
        throw new Error(`MCP Client is not configured in ToolGateway for '${toolName}'.`);
      }
      const parts = toolName.split('__');
      const serverName = parts[1];
      const mcpTool = parts.slice(2).join('__');
      const callRes = await this.mcpClient.callTool(serverName, mcpTool, params);
      return {
        success: !callRes.isError,
        output: callRes.content as T,
        riskLevel: risk,
        error: callRes.isError ? (callRes.content?.[0]?.text || 'MCP tool execution error') : undefined,
      };
    }

    // Dynamic Executable Skill Tool Invocation (skill__<name>)
    if (toolName.startsWith('skill__')) {
      if (!this.skillEngine) {
        throw new Error('SkillEngine is not configured in ToolGateway.');
      }
      const skillName = toolName.slice(7);
      const sRes = await this.skillEngine.executeSkill(skillName, params);
      return {
        success: sRes.success,
        output: sRes.output as T,
        error: sRes.error,
        riskLevel: risk,
      };
    }

    switch (toolName) {
        case 'execute_skill':
        case 'executeSkill': {
          if (!this.skillEngine) {
            throw new Error('SkillEngine is not configured in ToolGateway.');
          }
          const sRes = await this.skillEngine.executeSkill(params.skillId || params.name, params.params || params.arguments || {});
          return {
            success: sRes.success,
            output: sRes.output as T,
            error: sRes.error,
            riskLevel: risk,
          };
        }
        // Persistent Skills & Dynamic Capability Creation
        case 'create_skill':
        case 'createSkill': {
          if (!this.skillEngine) {
            throw new Error('SkillEngine is not configured in ToolGateway.');
          }
          if (!params.name || (!params.instructions && !params.handlerCode && !params.description)) {
            throw new Error("create_skill requires 'name' and ('instructions' or 'handlerCode' or 'description')");
          }
          const skill = this.skillEngine.createSkill({
            id: params.id,
            name: params.name,
            version: params.version,
            description: params.description || '',
            instructions: params.instructions || params.handlerCode || params.description,
            handlerCode: params.handlerCode,
            parameters: params.parameters,
            requiredTools: params.requiredTools,
            triggerPatterns: params.triggerPatterns || params.tags,
            skillType: params.skillType,
            enabled: params.enabled,
          });
          return {
            success: true,
            output: {
              skillId: skill.id,
              name: skill.name,
              version: skill.version,
              status: skill.status,
              message: `Skill '${skill.name}' successfully created and persisted to SQLite and disk (.kin/skills/${skill.name.toLowerCase()}/).`,
            } as T,
            riskLevel: risk,
          };
        }

        case 'import_skill':
        case 'importSkill': {
          if (!this.skillEngine) {
            throw new Error('SkillEngine is not configured in ToolGateway.');
          }
          if (params.directoryPath || params.dirPath || params.path || params.directory || params.dir) {
            const rawPath = params.directoryPath || params.dirPath || params.path || params.directory || params.dir;
            let targetDir = path.isAbsolute(rawPath)
              ? rawPath
              : path.resolve(context.worktreeRoot, rawPath);
            if (!fs.existsSync(targetDir)) {
              const cwdResolved = path.resolve(process.cwd(), rawPath);
              if (fs.existsSync(cwdResolved)) {
                targetDir = cwdResolved;
              } else {
                const parentResolved = path.resolve(process.cwd(), '..', rawPath);
                if (fs.existsSync(parentResolved)) {
                  targetDir = parentResolved;
                }
              }
            }
            const result = this.skillEngine.importSkillDirectory(targetDir);
            return {
              success: true,
              output: {
                importedCount: result.imported,
                skills: result.skills.map((s) => ({ id: s.id, name: s.name })),
                message: `Successfully imported ${result.imported} skill(s) from directory '${targetDir}'.`,
              } as T,
              riskLevel: risk,
            };
          } else if (params.bundleJson || params.bundle || params.skill) {
            const payload = params.bundleJson || params.bundle || params.skill;
            const result = this.skillEngine.importSkillBundle(payload);
            return {
              success: true,
              output: {
                importedCount: result.imported,
                skills: result.skills.map((s) => ({ id: s.id, name: s.name })),
                message: `Successfully imported ${result.imported} skill(s) into persistent storage.`,
              } as T,
              riskLevel: risk,
            };
          } else {
            throw new Error("import_skill requires either 'directoryPath' or 'bundleJson'");
          }
        }

        // Filesystem & Shell
        case 'readFile': {
          const targetPath = params.filePath || params.path;
          if (!targetPath) throw new Error("readFile requires 'filePath' or 'path' parameter");
          const content = await this.handleReadFile(targetPath, context.worktreeRoot, params.maxBytes ?? (2 * 1024 * 1024), context);
          return { success: true, output: content as T, riskLevel: risk };
        }

        case 'writeFile': {
          const targetPath = params.filePath || params.path;
          if (!targetPath) throw new Error("writeFile requires 'filePath' or 'path' parameter");
          const encoding = params.encoding === 'base64' ? 'base64' : 'utf-8';
          await this.handleWriteFile(targetPath, params.content, context.worktreeRoot, encoding, context);
          const bytesWritten = typeof params.content === 'string'
            ? Buffer.byteLength(params.content, encoding)
            : Buffer.isBuffer(params.content) ? params.content.length : 0;
          return { success: true, output: { bytesWritten } as T, riskLevel: risk };
        }

        case 'listDirectory': {
          const targetDir = params.dirPath || params.path || '.';
          const entries = await this.handleListDirectory(targetDir, context.worktreeRoot);
          return { success: true, output: entries as T, riskLevel: risk };
        }

        case 'executeShell': {
          let releaseSlot: (() => void) | undefined;
          if (this.computerSupervisor) {
            releaseSlot = await this.computerSupervisor.acquireShellSlot(params.timeoutMs ?? 60000);
          }
          try {
            const shellResult = await this.handleExecuteShell(params.command, context.worktreeRoot, params.timeoutMs ?? 120000, context.abortSignal);
            return { success: true, output: shellResult as T, riskLevel: risk };
          } finally {
            if (releaseSlot) releaseSlot();
          }
        }

        // Timed Autonomy & Self-Awakening Scheduler
        case 'schedule': {
          if (!this.scheduler) {
            throw new Error('Scheduler service is not configured in ToolGateway.');
          }
          const projectId = params.projectId || context.projectId || 'proj-kin';
          const channelId = params.channelId || context.channelId || 'general';
          const targetAgentId = params.targetAgentId || context.agentId;
          const prompt = params.prompt || 'Resume scheduled task';

          if (params.type === 'cron' && params.cronExpression) {
            const sched = this.scheduler.createCronSchedule({
              projectId,
              channelId,
              targetAgentId,
              prompt,
              cronExpression: params.cronExpression,
              maxIterations: params.maxIterations,
            });
            return {
              success: true,
              output: {
                scheduleId: sched.id,
                type: 'cron',
                nextRunAt: new Date(sched.nextRunAt).toISOString(),
                prompt: sched.prompt,
                message: `Recurring cron schedule registered (${sched.cronExpression}). The system will automatically wake @${targetAgentId} to execute when triggered without active CPU polling.`,
              } as T,
              riskLevel: risk,
            };
          } else {
            const durationSeconds = Math.max(1, Number(params.durationSeconds) || 60);
            const sched = this.scheduler.createOneShotTimer({
              projectId,
              channelId,
              targetAgentId,
              prompt,
              durationSeconds,
              timerCondition: params.timerCondition || 'never',
            });
            return {
              success: true,
              output: {
                scheduleId: sched.id,
                type: 'one_shot',
                durationSeconds,
                firesAt: new Date(sched.nextRunAt).toISOString(),
                prompt: sched.prompt,
                message: `One-shot timer registered for ${durationSeconds} seconds. The agent can safely end turn / sleep now; the scheduler will wake the agent automatically when the timer expires.`,
              } as T,
              riskLevel: risk,
            };
          }
        }

        case 'cancelSchedule': {
          if (!this.scheduler) throw new Error('Scheduler service is not configured in ToolGateway.');
          const cancelled = this.scheduler.cancelSchedule(params.scheduleId);
          return {
            success: cancelled,
            output: { scheduleId: params.scheduleId, cancelled } as T,
            error: cancelled ? undefined : `Schedule '${params.scheduleId}' not found or already completed/cancelled.`,
            riskLevel: risk,
          };
        }

        case 'listSchedules': {
          if (!this.scheduler) throw new Error('Scheduler service is not configured in ToolGateway.');
          const projectId = params.projectId || context.projectId || 'proj-kin';
          const schedules = this.scheduler.getActiveSchedules(projectId);
          return {
            success: true,
            output: schedules as T,
            riskLevel: risk,
          };
        }

        // Unified Computer Use Capability (First-class Desktop GUI Automation)
        case 'computer': {
          const action = params.action;
          switch (action) {
            case 'screenshot': {
              const res = await this.desktopController.captureScreen(params);
              return { success: true, output: res as T, riskLevel: risk };
            }
            case 'mouse_move':
            case 'move': {
              return this.executeWithDesktopLock(context, async () => {
                const coords = params.coordinate || [params.x, params.y];
                const x = coords[0] ?? params.x;
                const y = coords[1] ?? params.y;
                const res = await this.desktopController.mouseMove(x, y);
                return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
              });
            }
            case 'left_click':
            case 'click': {
              return this.executeWithDesktopLock(context, async () => {
                let x = params.x;
                let y = params.y;
                if (params.coordinate && Array.isArray(params.coordinate)) {
                  x = params.coordinate[0];
                  y = params.coordinate[1];
                }
                const res = await this.desktopController.mouseClick(x, y, {
                  button: params.button || 'left',
                  doubleClick: false,
                });
                return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
              });
            }
            case 'right_click': {
              return this.executeWithDesktopLock(context, async () => {
                let x = params.x;
                let y = params.y;
                if (params.coordinate && Array.isArray(params.coordinate)) {
                  x = params.coordinate[0];
                  y = params.coordinate[1];
                }
                const res = await this.desktopController.mouseClick(x, y, {
                  button: 'right',
                  doubleClick: false,
                });
                return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
              });
            }
            case 'double_click': {
              return this.executeWithDesktopLock(context, async () => {
                let x = params.x;
                let y = params.y;
                if (params.coordinate && Array.isArray(params.coordinate)) {
                  x = params.coordinate[0];
                  y = params.coordinate[1];
                }
                const res = await this.desktopController.mouseClick(x, y, {
                  button: 'left',
                  doubleClick: true,
                });
                return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
              });
            }
            case 'type': {
              return this.executeWithDesktopLock(context, async () => {
                const res = await this.desktopController.typeText(params.text || '');
                return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
              });
            }
            case 'key': {
              return this.executeWithDesktopLock(context, async () => {
                const res = await this.desktopController.sendKey(params.key, params.modifiers || []);
                return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
              });
            }
            case 'cursor_position': {
              return {
                success: true,
                output: { message: 'Cursor position queried' } as T,
                riskLevel: risk,
              };
            }
            default:
              throw new Error(`Unsupported computer action: '${action}'. Expected: screenshot, mouse_move, left_click, right_click, double_click, type, key.`);
          }
        }

        // Unified Application Control Capability (VS Code, WhatsApp, Browsers, etc.)
        case 'application': {
          const action = params.action || 'list';
          switch (action) {
            case 'list':
            case 'discover': {
              const res = await this.desktopController.discoverInstalledApps();
              return { success: true, output: res as T, riskLevel: risk };
            }
            case 'launch':
            case 'open': {
              return this.executeWithDesktopLock(context, async () => {
                const appName = params.name || params.appNameOrPath || params.appName;
                const res = await this.desktopController.launchApp(appName, params.args || []);
                return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
              });
            }
            case 'list_windows': {
              const res = await this.desktopController.listWindows(params.forceRefresh);
              return { success: true, output: res as T, riskLevel: risk };
            }
            case 'focus': {
              return this.executeWithDesktopLock(context, async () => {
                const target = params.target || params.titleOrPid || params.title || params.pid;
                const res = await this.desktopController.focusWindow(target);
                return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
              });
            }
            case 'close': {
              return this.executeWithDesktopLock(context, async () => {
                const target = params.target || params.titleOrPid || params.title || params.pid;
                const res = await this.desktopController.closeWindow(target);
                return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
              });
            }
            default:
              throw new Error(`Unsupported application action: '${action}'. Expected: list, launch, list_windows, focus, close.`);
          }
        }

        // Unified Persistent Browser Automation Capability
        case 'browser': {
          const bc = await this.getEffectiveBrowserController(context);
          const action = params.action || 'navigate';
          switch (action) {
            case 'navigate':
            case 'goto': {
              const allowLocal = context.allowedCapabilities?.includes('browser:local_files') || params.allowLocalFileNavigation === true;
              const res = await bc.navigate(params.url, { allowLocalFileNavigation: allowLocal });
              return { success: true, output: res as T, riskLevel: risk };
            }
            case 'click': {
              const target = params.selector || (params.x !== undefined && params.y !== undefined ? { x: params.x, y: params.y } : undefined);
              if (!target) throw new Error('browser action click requires selector or coordinates (x, y)');
              const res = await bc.click(target);
              return { success: res.success, output: res as T, riskLevel: risk };
            }
            case 'type': {
              const res = await bc.type(params.selector, params.text, { clear: params.clear });
              return { success: res.success, output: res as T, riskLevel: risk };
            }
            case 'inspect': {
              const res = await bc.inspect(params.selector);
              return { success: true, output: res as T, riskLevel: risk };
            }
            case 'screenshot': {
              const res = await bc.screenshot();
              return { success: true, output: res as T, riskLevel: risk };
            }
            case 'evaluate': {
              const res = await bc.evaluate(params.script);
              return { success: true, output: res as T, riskLevel: risk };
            }
            case 'step': {
              const stepAction: WebStepAction = {
                action: params.stepAction || params.action,
                url: params.url,
                selector: params.selector,
                text: params.text,
                script: params.script,
                coordinates: params.coordinates,
              };
              const res = await bc.executeStep(stepAction);
              return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
            }
            case 'close': {
              await bc.close();
              return { success: true, output: { closed: true } as T, riskLevel: risk };
            }
            case 'status': {
              const status = bc.getStatus();
              return { success: true, output: status as T, riskLevel: risk };
            }
            default:
              throw new Error(`Unsupported browser action: '${action}'. Expected: navigate, click, type, inspect, screenshot, evaluate, step, close, status.`);
          }
        }

        // Desktop GUI Control & Application Discovery
        case 'desktopScreenshot': {
          const res = await this.desktopController.captureScreen(params);
          return { success: true, output: res as T, riskLevel: risk };
        }

        case 'desktopDiscoverApps': {
          const res = await this.desktopController.discoverInstalledApps();
          return { success: true, output: res as T, riskLevel: risk };
        }

        case 'desktopLaunchApp': {
          return this.executeWithDesktopLock(context, async () => {
            const res = await this.desktopController.launchApp(params.appNameOrPath || params.name, params.args || []);
            return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
          });
        }

        case 'desktopListWindows': {
          const res = await this.desktopController.listWindows();
          return { success: true, output: res as T, riskLevel: risk };
        }

        case 'desktopFocusWindow': {
          return this.executeWithDesktopLock(context, async () => {
            const res = await this.desktopController.focusWindow(params.titleOrPid);
            return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
          });
        }

        case 'desktopCloseWindow': {
          return this.executeWithDesktopLock(context, async () => {
            const res = await this.desktopController.closeWindow(params.titleOrPid);
            return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
          });
        }

        case 'desktopMouseMove': {
          return this.executeWithDesktopLock(context, async () => {
            const res = await this.desktopController.mouseMove(params.x, params.y);
            return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
          });
        }

        case 'desktopMouseClick': {
          return this.executeWithDesktopLock(context, async () => {
            const res = await this.desktopController.mouseClick(params.x, params.y, {
              button: params.button,
              doubleClick: params.doubleClick,
            });
            return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
          });
        }

        case 'desktopType': {
          return this.executeWithDesktopLock(context, async () => {
            const res = await this.desktopController.typeText(params.text);
            return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
          });
        }

        case 'desktopSendKey': {
          return this.executeWithDesktopLock(context, async () => {
            const res = await this.desktopController.sendKey(params.key, params.modifiers || []);
            return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
          });
        }

        // Persistent Controllable Browser Sessions
        case 'browserNavigate': {
          const bc = await this.getEffectiveBrowserController(context);
          const allowLocal = context.allowedCapabilities?.includes('browser:local_files') || params.allowLocalFileNavigation === true;
          const res = await bc.navigate(params.url, { allowLocalFileNavigation: allowLocal });
          return { success: true, output: res as T, riskLevel: risk };
        }

        case 'browserClick': {
          const target = params.selector || (params.x !== undefined && params.y !== undefined ? { x: params.x, y: params.y } : undefined);
          if (!target) throw new Error('browserClick requires selector or coordinates (x, y)');
          const bc = await this.getEffectiveBrowserController(context);
          const res = await bc.click(target);
          return { success: res.success, output: res as T, riskLevel: risk };
        }

        case 'browserType': {
          const bc = await this.getEffectiveBrowserController(context);
          const res = await bc.type(params.selector, params.text, { clear: params.clear });
          return { success: res.success, output: res as T, riskLevel: risk };
        }

        case 'browserInspect': {
          const bc = await this.getEffectiveBrowserController(context);
          const res = await bc.inspect(params.selector);
          return { success: true, output: res as T, riskLevel: risk };
        }

        case 'browserScreenshot': {
          const bc = await this.getEffectiveBrowserController(context);
          const res = await bc.screenshot();
          return { success: true, output: res as T, riskLevel: risk };
        }

        case 'browserEvaluate': {
          const bc = await this.getEffectiveBrowserController(context);
          const res = await bc.evaluate(params.script);
          return { success: true, output: res as T, riskLevel: risk };
        }

        case 'browserStep': {
          const stepAction: WebStepAction = {
            action: params.action,
            url: params.url,
            selector: params.selector,
            text: params.text,
            script: params.script,
            coordinates: params.coordinates,
          };
          const bc = await this.getEffectiveBrowserController(context);
          const res = await bc.executeStep(stepAction);
          return { success: res.success, output: res as T, error: res.error, riskLevel: risk };
        }

        case 'browserClose': {
          const bc = await this.getEffectiveBrowserController(context);
          await bc.close();
          return { success: true, output: { closed: true } as T, riskLevel: risk };
        }

        case 'delegateToAgent': {
          const target = params.targetAgent || params.agentName || params.target;
          const directive = params.directive || params.instructions || params.task;
          if (!target || !directive) {
            throw new Error("delegateToAgent requires 'targetAgent' and 'directive' parameters");
          }
          return {
            success: true,
            output: {
              delegated: true,
              targetAgent: target,
              directive,
              channelId: params.channelId,
              message: `Delegation directive dispatched to ${target}: "${directive}"`,
            } as T,
            riskLevel: risk,
          };
        }

        case 'proposePlanAdjustment': {
          const goalId = params.goalId;
          const proposal = params.proposal || params;
          if (!goalId) {
            throw new Error("proposePlanAdjustment requires 'goalId' parameter");
          }
          if (this.db) {
            this.db.execute(
              `UPDATE goals SET proposed_replanning_json = ?, updated_at = ? WHERE id = ?`,
              JSON.stringify(proposal),
              Date.now(),
              goalId
            );
          }
          return {
            success: true,
            output: {
              proposed: true,
              goalId,
              proposal,
              message: `Plan adjustment proposal recorded for goal ${goalId}. Proposal card dispatched to channel.`,
            } as T,
            riskLevel: risk,
          };
        }

        default:
          return {
            success: false,
            riskLevel: risk,
            error: `Unknown tool '${toolName}'.`,
          };
      }
  }

  public classifyRisk(toolName: string, params: Record<string, any> = {}): RiskLevel {
    const safeParams = params || {};
    // 0. Financial Safety Shield & Destructive Operation Check
    const financialCheck = this.financialSafety.evaluateFinancialRisk(toolName, safeParams);
    if (financialCheck.requiresHardStop) {
      return 'CRITICAL';
    }

    // Unified first-class capabilities risk classification
    if (toolName === 'computer') {
      const act = safeParams.action;
      if (act === 'screenshot') return 'LOW';
      if (act === 'type' || act === 'key') return 'HIGH';
      return 'MEDIUM'; // mouse_move, left_click, right_click, double_click
    }

    if (toolName === 'application') {
      const act = safeParams.action;
      if (act === 'list' || act === 'list_windows') return 'LOW';
      if (act === 'close') return 'HIGH';
      return 'MEDIUM'; // launch, focus
    }

    if (toolName === 'browser') {
      const act = safeParams.action;
      if (act === 'inspect' || act === 'screenshot' || act === 'status') return 'LOW';
      if (act === 'type' || act === 'evaluate' || act === 'step' || act === 'close') return 'HIGH';
      return 'MEDIUM'; // navigate, click
    }

    // 1. Read-only inspection tools
    if (
      toolName === 'readFile' ||
      toolName === 'listDirectory' ||
      toolName === 'schedule' ||
      toolName === 'cancelSchedule' ||
      toolName === 'listSchedules' ||
      toolName === 'desktopScreenshot' ||
      toolName === 'desktopDiscoverApps' ||
      toolName === 'desktopListWindows' ||
      toolName === 'browserInspect' ||
      toolName === 'browserScreenshot' ||
      toolName === 'delegateToAgent'
    ) {
      return 'LOW';
    }

    // 2. Safe reversible operations
    if (
      toolName === 'writeFile' ||
      toolName === 'create_skill' ||
      toolName === 'createSkill' ||
      toolName === 'import_skill' ||
      toolName === 'importSkill' ||
      toolName === 'desktopMouseMove' ||
      toolName === 'desktopMouseClick' ||
      toolName === 'desktopFocusWindow' ||
      toolName === 'browserNavigate' ||
      toolName === 'browserClick'
    ) {
      return 'MEDIUM';
    }

    // 3. High consequence mutations
    if (
      toolName === 'desktopType' ||
      toolName === 'desktopSendKey' ||
      toolName === 'desktopLaunchApp' ||
      toolName === 'desktopCloseWindow' ||
      toolName === 'browserType' ||
      toolName === 'browserEvaluate' ||
      toolName === 'browserClose' ||
      toolName === 'browserStep'
    ) {
      return 'HIGH';
    }

    if (toolName === 'executeShell') {
      const cmd = (safeParams.command || '').toLowerCase();
      // Destructive, system, or package operations are HIGH/CRITICAL
      if (
        cmd.includes('rm -rf') ||
        cmd.includes('remove-item') ||
        cmd.includes('npm install') ||
        cmd.includes('pip install') ||
        cmd.includes('drop table') ||
        cmd.includes('format') ||
        cmd.includes('curl ') ||
        cmd.includes('wget ')
      ) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    return 'MEDIUM';
  }

  public checkApprovalRequired(risk: RiskLevel, context: ToolExecutionContext, toolName?: string): boolean {
    if (context.approvalToken) {
      const valid = this.consumeApprovalToken(context.approvalToken, toolName || '', context.runId);
      if (valid) {
        return false;
      }
    }

    // Zero-Trust Rule: CRITICAL risk actions without valid single-use operator authorization token
    // cannot be bypassed under any mode (even FULL_ACCESS).
    if (risk === 'CRITICAL') {
      return true;
    }

    if (context.autonomyMode === 'FULL_ACCESS') {
      // Full access bypasses interactive prompts for LOW, MEDIUM, and HIGH
      return false;
    }

    if (context.autonomyMode === 'ALWAYS_ASK') {
      // Always ask for any state modification
      return risk !== 'LOW';
    }

    // AUTO mode: Auto-approves LOW and MEDIUM (safe/reversible in worktree), prompts on HIGH/CRITICAL
    if (context.autonomyMode === 'AUTO') {
      return risk === 'HIGH';
    }

    return true;
  }

  /**
   * Validates that target path stays strictly inside worktreeRoot.
   */
  public resolveJailedPath(targetPath: string, worktreeRoot: string): string {
    const root = path.resolve(worktreeRoot);
    const resolved = path.resolve(root, targetPath);
    const relative = path.relative(root, resolved);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `SECURITY JAIL VIOLATION: Path '${targetPath}' escapes worktree root '${worktreeRoot}'`
      );
    }

    return resolved;
  }

  private async handleReadFile(
    filePath: string,
    worktreeRoot: string,
    maxBytes: number = 2 * 1024 * 1024,
    context?: ToolExecutionContext
  ): Promise<string> {
    const target = this.resolveJailedPath(filePath, worktreeRoot);
    if (!fs.existsSync(target)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      throw new Error(`Cannot read '${filePath}': Target is a directory. Use listDirectory instead.`);
    }

    // Durably record or update baseline file revision hash on read for OCC
    if (this.db && context?.projectId) {
      try {
        const rawBytes = fs.readFileSync(target);
        const readHash = crypto.createHash('sha256').update(rawBytes).digest('hex');
        const now = Date.now();
        this.db.execute(
          `INSERT INTO file_revisions (id, project_id, file_path, content_hash, mtime, last_modified_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id, file_path) DO UPDATE SET
             content_hash = excluded.content_hash,
             mtime = excluded.mtime,
             last_modified_by = excluded.last_modified_by,
             updated_at = excluded.updated_at`,
          uuidv4(),
          context.projectId,
          filePath,
          readHash,
          stat.mtimeMs,
          context.agentId || 'reader',
          now
        );
      } catch (err) {
        console.warn(`[TOOL GATEWAY] Failed to register baseline file_revisions for '${filePath}':`, err);
      }
    }

    if (stat.size > maxBytes) {
      const buffer = Buffer.alloc(maxBytes);
      const fd = fs.openSync(target, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
      fs.closeSync(fd);
      return (
        buffer.toString('utf-8', 0, bytesRead) +
        `\n\n[NOTICE: File '${filePath}' exceeds 2MB (${Math.round(stat.size / 1024)} KB total). First 2MB preview returned.]`
      );
    }
    return fs.readFileSync(target, 'utf-8');
  }

  /**
   * Writes file with exponential retry to handle Windows file lock delays (antivirus / search indexers).
   * Supports both UTF-8 string and base64 binary encoding for large file transfers.
   */
  private async handleWriteFile(
    filePath: string,
    content: string | Buffer = '',
    worktreeRoot: string,
    encoding: BufferEncoding = 'utf-8',
    context?: ToolExecutionContext
  ): Promise<void> {
    const target = this.resolveJailedPath(filePath, worktreeRoot);
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      throw new Error(`Cannot write to '${filePath}': Target is an existing directory.`);
    }

    // Optimistic Concurrency Control (OCC) Stale-Write Protection
    if (fs.existsSync(target)) {
      const existingBytes = fs.readFileSync(target);
      const currentHash = crypto.createHash('sha256').update(existingBytes).digest('hex');

      if (context?.expectedHash && !context.forceWrite) {
        if (currentHash !== context.expectedHash) {
          throw new StaleWriteConflictError(filePath, currentHash, context.expectedHash);
        }
      } else if (this.db && context?.projectId && !context?.forceWrite) {
        const rev = this.db.queryOne<{ content_hash: string }>(
          `SELECT content_hash FROM file_revisions WHERE project_id = ? AND file_path = ?`,
          context.projectId,
          filePath
        );
        if (rev && rev.content_hash !== currentHash) {
          throw new StaleWriteConflictError(filePath, currentHash, rev.content_hash);
        }
      }
    }

    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let attempts = 0;
    const maxAttempts = 3;
    const delays = [50, 150, 300];

    const safeContent = content ?? '';
    const buffer = Buffer.isBuffer(safeContent)
      ? safeContent
      : encoding === 'base64'
      ? Buffer.from(safeContent, 'base64')
      : Buffer.from(safeContent, 'utf-8');

    while (attempts < maxAttempts) {
      try {
        fs.writeFileSync(target, buffer);
        break;
      } catch (err: any) {
        attempts++;
        if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delays[attempts - 1]));
        } else {
          throw new Error(`Failed to write file '${filePath}': ${err.message}`);
        }
      }
    }

    // Durably record or update file revision hash in file_revisions table
    if (this.db && context?.projectId) {
      try {
        const newHash = crypto.createHash('sha256').update(buffer).digest('hex');
        const now = Date.now();
        this.db.execute(
          `INSERT INTO file_revisions (id, project_id, file_path, content_hash, mtime, last_modified_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id, file_path) DO UPDATE SET
             content_hash = excluded.content_hash,
             mtime = excluded.mtime,
             last_modified_by = excluded.last_modified_by,
             updated_at = excluded.updated_at`,
          uuidv4(),
          context.projectId,
          filePath,
          newHash,
          now,
          context.agentId || 'system',
          now
        );
      } catch (err) {
        console.warn(`[TOOL GATEWAY] Failed to update file_revisions for '${filePath}':`, err);
      }
    }
  }

  private async handleListDirectory(dirPath: string, worktreeRoot: string): Promise<string[]> {
    const target = this.resolveJailedPath(dirPath, worktreeRoot);
    if (!fs.existsSync(target)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    return fs.readdirSync(target);
  }

  private handleExecuteShell(
    command: string,
    worktreeRoot: string,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!command || typeof command !== 'string' || !command.trim()) {
      return Promise.reject(new Error('Shell command must be a non-empty string.'));
    }
    if (abortSignal?.aborted) {
      return Promise.reject(new Error('Shell execution cancelled: AbortSignal is already triggered.'));
    }

    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      let hasAborted = false;
      const child = exec(
        command,
        {
          cwd: worktreeRoot,
          timeout: timeoutMs,
          maxBuffer: 15 * 1024 * 1024, // 15MB max buffer
          windowsHide: true,
          shell: isWin ? 'cmd.exe' : '/bin/bash',
        },
        (error, stdout, stderr) => {
          if (hasAborted) return;
          if (error && error.killed) {
            return reject(new Error(`Shell execution timed out after ${timeoutMs}ms: ${command}`));
          }

          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          });
        }
      );

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          hasAborted = true;
          try {
            if (child.pid) {
              if (isWin) {
                exec(`taskkill /pid ${child.pid} /T /F`);
              } else {
                child.kill('SIGKILL');
              }
            }
          } catch {}
          reject(new Error('Shell execution cancelled by operator via AbortSignal.'));
        }, { once: true });
      }
    });
  }
}
