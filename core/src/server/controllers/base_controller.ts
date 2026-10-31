import * as http from 'node:http';
import * as childProcess from 'node:child_process';
import type { CoreServer } from '../core_server.js';
import type { KinDatabase } from '../../storage/db.js';
import type { WorkspaceRepository } from '../../domain/workspace_repository.js';
import type { AgentRepository } from '../../domain/agent_repository.js';
import type { TaskRepository } from '../../domain/task_repository.js';
import type { GoalRepository } from '../../domain/goal_repository.js';
import type { MemoryRepository } from '../../domain/memory_repository.js';
import type { ChannelService } from '../../communication/channel_service.js';
import type { ActivationEngine } from '../../communication/activation_engine.js';
import type { AgentKernel } from '../../kernel/agent_kernel.js';
import type { LoopBreaker } from '../../communication/loop_breaker.js';
import type { ModelGateway } from '../../execution/model_gateway.js';
import type { ContextCompiler } from '../../context/context_compiler.js';
import type { ToolGateway } from '../../execution/tool_gateway.js';
import type { ToolEngine } from '../../execution/tool_engine.js';
import type { SchedulerService } from '../../automation/scheduler.js';
import type { SkillEngine } from '../../skills/skill_engine.js';
import type { McpClientManager } from '../../execution/mcp_client.js';
import type { AgentLoopRunner } from '../../kernel/agent_loop.js';
import type { DesktopController } from '../../computer/desktop_controller.js';
import type { BrowserController } from '../../browser/browser_controller.js';
import type { ComputerSupervisor } from '../../computer/computer_supervisor.js';
import type { RecoveryEngine } from '../../recovery/recovery_engine.js';
import type { FinancialSafetyShield } from '../../policy/financial_safety.js';
import type { WakeupQueue } from '../../kernel/wakeup_queue.js';
import type { TypedRunnerAdapter } from '../../kernel/runner_adapter.js';

export abstract class BaseController {
  constructor(public server: CoreServer) {}

  public get db(): KinDatabase { return this.server.db; }
  public get workspaceRepo(): WorkspaceRepository { return this.server.workspaceRepo; }
  public get agentRepo(): AgentRepository { return this.server.agentRepo; }
  public get taskRepo(): TaskRepository { return this.server.taskRepo; }
  public get goalRepo(): GoalRepository { return this.server.goalRepo; }
  public get memoryRepo(): MemoryRepository { return this.server.memoryRepo; }
  public get channelService(): ChannelService { return this.server.channelService; }
  public get activationEngine(): ActivationEngine { return this.server.activationEngine; }
  public get kernel(): AgentKernel { return this.server.kernel; }
  public get loopBreaker(): LoopBreaker { return this.server.loopBreaker; }
  public get modelGateway(): ModelGateway { return this.server.modelGateway; }
  public get contextCompiler(): ContextCompiler { return this.server.contextCompiler; }
  public get toolGateway(): ToolGateway { return this.server.toolGateway; }
  public get toolEngine(): ToolEngine { return this.server.toolEngine; }
  public get scheduler(): SchedulerService { return this.server.scheduler; }
  public get skillEngine(): SkillEngine { return this.server.skillEngine; }
  public get mcpClient(): McpClientManager { return this.server.mcpClient; }
  public get agentLoopRunner(): AgentLoopRunner { return this.server.agentLoopRunner; }
  public get desktopController(): DesktopController { return this.server.desktopController; }
  public get browserController(): BrowserController { return this.server.browserController; }
  public get computerSupervisor(): ComputerSupervisor { return this.server.computerSupervisor; }
  public get recoveryEngine(): RecoveryEngine { return this.server.recoveryEngine; }
  public get financialSafety(): FinancialSafetyShield { return this.server.financialSafety; }
  public get wakeupQueue(): WakeupQueue { return this.server.wakeupQueue; }
  public get nativeRunnerAdapter(): TypedRunnerAdapter { return this.server.nativeRunnerAdapter; }
  public get checkpointRepo() {
    return {
      getLatestCheckpoint: (runId: string) => this.kernel.getLatestCheckpoint(runId),
    };
  }

  public get activeProjectId(): string { return this.server.activeProjectId; }
  public set activeProjectId(v: string) { this.server.activeProjectId = v; }
  public get dbPath(): string { return this.server.dbPath; }
  public get port(): number { return this.server.port; }
  public get requireIpcAuth(): boolean { return this.server.requireIpcAuth; }
  public get ipcAuthToken(): string { return this.server.ipcAuthToken; }
  public get activeAgentExecutions() { return this.server.activeAgentExecutions; }
  public get runAbortControllers() { return this.server.runAbortControllers; }
  public get agentQueues() { return this.server.agentQueues; }
  public get channelQueues() { return this.server.channelQueues; }
  public get activeDelegations() { return this.server.activeDelegations; }
  public get messageAdmissionFences() { return this.server.messageAdmissionFences; }
  public get lastChannelPromptFingerprints() { return this.server.lastChannelPromptFingerprints; }
  public get isStopping(): boolean { return this.server.isStopping; }
  public get inFlightExecutions() { return this.server.inFlightExecutions; }
  public get pendingSteers() { return this.server.pendingSteers; }
  public get takeoverStates() { return this.server.takeoverStates; }
  public get preservedWorktrees() { return this.server.preservedWorktrees; }
  public get pendingRecoveries() { return this.server.pendingRecoveries; }
  public set pendingRecoveries(v) { this.server.pendingRecoveries = v; }
  public get agentLiveActivity() { return this.server.agentLiveActivity; }
  public get monorepoRoot(): string[] { return this.server.monorepoRoot; }

  public sendJson(res: http.ServerResponse, statusCode: number, data: any, req?: http.IncomingMessage): boolean {
    return this.server.sendJson(res, statusCode, data, req);
  }

  public parseJsonBody<T>(req: http.IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<T> {
    return this.server.parseJsonBody<T>(req, maxBytes);
  }

  public broadcastEvent(eventType: string, data: any): void {
    return this.server.broadcastEvent(eventType, data);
  }

  public getEffectiveAutonomyMode(): any {
    return this.server.getEffectiveAutonomyMode();
  }

  public getConfiguredProviders(): { configuredProviders: Set<string>; activeCredsCount: number } {
    return this.server.getConfiguredProviders();
  }

  public computeModelAvailability(
    activeModelId: string | undefined,
    ollamaInfo: { online: boolean; models: string[] },
    configuredProviders: Set<string>,
    activeCredsCount: number
  ): { modelAvailable: boolean; modelStatus: string } {
    return this.server.computeModelAvailability(activeModelId, ollamaInfo, configuredProviders, activeCredsCount);
  }

  public getLocalOllamaModels(): Promise<{ online: boolean; models: string[] }> {
    return this.server.getLocalOllamaModels();
  }

  public syncModelGatewayProviders(): void {
    return this.server.syncModelGatewayProviders();
  }

  public createApprovalRecord(
    toolName: string,
    actionPayload: Record<string, any>,
    reason?: string,
    agentId?: string,
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  ): string {
    return this.server.createApprovalRecord(toolName, actionPayload, reason, agentId, riskLevel);
  }

  public pruneOldAdmissionFences(nowMs: number): void {
    return this.server.pruneOldAdmissionFences(nowMs);
  }

  public resolveDefaultChannelForProject(projectId: string, explicitChannelId?: string): string {
    return this.server.resolveDefaultChannelForProject(projectId, explicitChannelId);
  }

  public isWithinJail(jailRoot: string, targetPath: string): boolean {
    return this.server.isWithinJail(jailRoot, targetPath);
  }

  public assertPathWithinProject(jailRoot: string, targetPath: string): void {
    return this.server.assertPathWithinProject(jailRoot, targetPath);
  }

  public validateProjectBoundary(targetRoot?: string): { valid: boolean; root: string; error?: string } {
    return this.server.validateProjectBoundary(targetRoot);
  }

  public isBinaryFile(filePath: string): boolean {
    return this.server.isBinaryFile(filePath);
  }

  public sanitizeTerminology(text: string): string {
    return this.server.sanitizeTerminology(text);
  }

  public execFileCommand(
    file: string,
    args: string[],
    cwd: string,
    timeoutMs: number = 60000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.server.execFileCommand(file, args, cwd, timeoutMs);
  }

  public execCommand(
    command: string,
    cwd: string,
    timeoutMs: number = 60000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.server.execCommand(command, cwd, timeoutMs);
  }

  public executeSequentialAgents(agents: any[], channelId: string, userMsg: any): Promise<void> {
    return this.server.executeSequentialAgents(agents, channelId, userMsg);
  }

  public executeAgentResponse(
    agent: any,
    channelId: string,
    triggerMsg: any,
    recursionDepth: number = 0,
    resumeCheckpoint?: any,
    existingRunId?: string,
    modelOverride?: string,
    parentRunId?: string
  ): Promise<void> {
    return this.server.executeAgentResponse(agent, channelId, triggerMsg, recursionDepth, resumeCheckpoint, existingRunId, modelOverride, parentRunId);
  }

  public handleOrchestratorAction(
    boss: any,
    channelId: string,
    userMsg: any,
    allProjectAgents: any[]
  ): Promise<void> {
    return this.server.handleOrchestratorAction(boss, channelId, userMsg, allProjectAgents);
  }

  public enqueueChannelExecution(channelId: string, fn: () => Promise<void>): Promise<void> {
    return this.server.enqueueChannelExecution(channelId, fn);
  }

  public enqueueAgentExecution(agentId: string, fn: () => Promise<void>): Promise<void> {
    return this.server.enqueueAgentExecution(agentId, fn);
  }

  public handleCors(res: http.ServerResponse, req?: http.IncomingMessage): void {
    return this.server.handleCors(res, req);
  }

  public resumeInterruptedRun(runId: string, modelOverride?: string): Promise<boolean> {
    return this.server.resumeInterruptedRun(runId, modelOverride);
  }

  public processNextQueuedMessage(channelId: string): Promise<boolean> {
    return this.server.processNextQueuedMessage(channelId);
  }

  public startOllamaServer(): Promise<{ success: boolean; online: boolean; models: string[] }> {
    return this.server.startOllamaServer();
  }

  public parseScheduleDurationAndPrompt(rawParams: string): { durationSeconds: number; prompt: string; formattedDuration: string } | null {
    return this.server.parseScheduleDurationAndPrompt(rawParams);
  }

  public runSupervisorSelfHealing(staleThresholdMs: number = 45000): Array<{ id: string; agentId: string; projectId?: string; taskId?: string }> {
    return this.server.runSupervisorSelfHealing(staleThresholdMs);
  }

  public abstract handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    parsedUrl: URL
  ): Promise<boolean>;
}
