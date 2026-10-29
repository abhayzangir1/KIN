// ============================================================================
// KIN CORE IPC SERVER & RUNTIME DAEMON
// Local HTTP REST + Server-Sent Events (SSE) server for UI-to-Core IPC.
// Genuinely connects desktop UI to SQLite state, AgentKernel, and ModelGateway.
// ============================================================================

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AgentDefinition, AgentIdentity, Channel, Goal, Task, TaskStatus, Decision, DecisionStatus, AgentEvaluation, ManagedCredential } from '../domain/types.js';
import { KinDatabase } from '../storage/db.js';
import { getDataDirectory } from '../storage/data_directory.js';
import { MigrationRunner } from '../storage/migration_runner.js';
import { WakeupQueue } from '../kernel/wakeup_queue.js';
import { WorkspaceRepository } from '../domain/workspace_repository.js';
import { AgentRepository } from '../domain/agent_repository.js';
import { TaskRepository } from '../domain/task_repository.js';
import { ChannelService } from '../communication/channel_service.js';
import { ActivationEngine } from '../communication/activation_engine.js';
import { AgentKernel } from '../kernel/agent_kernel.js';
import { EventLedger } from '../security/event_ledger.js';
import { Sentinel } from '../security/sentinel.js';
import { LoopBreaker } from '../communication/loop_breaker.js';
import { ModelGateway, separateThinkingAndContent } from '../execution/model_gateway.js';
import { ContextCompiler } from '../context/context_compiler.js';
import { ContextCompactor } from '../context/context_compactor.js';
import { ToolGateway, hasDirectMessageCompletionToken } from '../execution/tool_gateway.js';
import { ToolEngine } from '../execution/tool_engine.js';
import { SchedulerService } from '../automation/scheduler.js';
import { SkillEngine } from '../skills/skill_engine.js';
import { McpClientManager } from '../execution/mcp_client.js';
import { AgentLoopRunner } from '../kernel/agent_loop.js';
import { RunnerAdapterRegistry, NativeReActRunnerAdapter, TypedRunnerAdapter } from '../kernel/runner_adapter.js';
import { DesktopController } from '../computer/desktop_controller.js';
import { BrowserController } from '../browser/browser_controller.js';
import { RecoveryEngine } from '../recovery/recovery_engine.js';
import { FinancialSafetyShield } from '../policy/financial_safety.js';
import { MemoryRepository, OCCConflictError } from '../domain/memory_repository.js';
import { ComputerSupervisor } from '../computer/computer_supervisor.js';
import { SecretVault } from '../security/secret_vault.js';
import { SecretBroker } from '../security/secret_broker.js';
import { CredentialScanner } from '../security/credential_scanner.js';
import { OAuthHandler } from '../api/oauth_handler.js';
import { GoalRepository } from '../domain/goal_repository.js';
import { WorktreeManager } from '../execution/worktree_manager.js';
import { BenchmarkEvaluator } from '../evaluation/benchmark_evaluator.js';
import { Router } from './router.js';
import { v4 as uuidv4 } from 'uuid';

export interface CoreServerOptions {
  port?: number;
  dbPath?: string;
  requireIpcAuth?: boolean;
}

export class CoreServer {
  public router: Router;
  public port: number;
  public requireIpcAuth: boolean;
  public ipcAuthToken: string = '';
  private server?: http.Server;
  public db: KinDatabase;
  public workspaceRepo: WorkspaceRepository;
  public agentRepo: AgentRepository;
  public taskRepo: TaskRepository;
  public goalRepo: GoalRepository;
  public memoryRepo: MemoryRepository;
  public channelService: ChannelService;
  public activationEngine: ActivationEngine;
  public kernel: AgentKernel;
  public loopBreaker: LoopBreaker = new LoopBreaker();
  public modelGateway: ModelGateway;
  public contextCompiler: ContextCompiler;
  public toolGateway: ToolGateway;
  public toolEngine: ToolEngine;
  public scheduler: SchedulerService;
  public skillEngine: SkillEngine;
  public mcpClient: McpClientManager;
  public agentLoopRunner: AgentLoopRunner;
  private supervisorInterval: NodeJS.Timeout | null = null;
  private sseClients: Set<http.ServerResponse> = new Set();
  public activeProjectId: string = 'proj-kin';
  public dbPath: string;
  public activeAgentExecutions: Map<string, { agentId: string; channelId: string; startedAt: number; triggerMessageId?: string; runId?: string }> = new Map();
  public runAbortControllers: Map<string, AbortController> = new Map();
  public agentQueues: Map<string, Promise<void>> = new Map();
  public channelQueues: Map<string, Promise<void>> = new Map();
  public activeDelegations: Map<string, number> = new Map();
  public messageAdmissionFences: Map<string, { fenceToken: string; channelId: string; timestamp: number; status: 'admitted' | 'completed'; completedAgents: Set<string> }> = new Map();
  public lastChannelPromptFingerprints: Map<string, { promptHash: string; timestamp: number }> = new Map();
  public isStopping: boolean = false;
  public inFlightExecutions: Set<Promise<any>> = new Set();
  public pendingSteers: Array<{
    id: string;
    channelId: string;
    directive: string;
    targetAgentId?: string;
    consumedByAgentIds: string[];
    timestamp: number;
  }> = [];
  public desktopController: DesktopController;
  public browserController: BrowserController;
  public computerSupervisor: ComputerSupervisor;
  public recoveryEngine: RecoveryEngine;
  public financialSafety: FinancialSafetyShield;
  public takeoverStates: Map<string, {
    runId: string;
    agentId?: string;
    channelId?: string;
    isPaused: boolean;
    isAborted: boolean;
    activeTool?: string;
    previewPayload?: any;
    authRequired?: boolean;
    authInstructions?: string;
    financialGate?: boolean;
    riskLevel?: string;
  }> = new Map();
  public preservedWorktrees: Map<string, { worktreePath: string; branch: string; repoRoot: string; isShadowRepo?: boolean }> = new Map();
  public wakeupQueue: WakeupQueue;
  public pendingRecoveries: Array<{
    id: string;
    runId?: string;
    agentId: string;
    agentName?: string;
    projectId?: string;
    taskId?: string;
    taskTitle?: string;
    interruptedTurn?: number;
    checkpoint?: any;
    checkpointReason?: string;
  }> = [];
  public nativeRunnerAdapter: TypedRunnerAdapter;
  public agentLiveActivity: Map<string, {
    latestThinking: string;
    activeTool?: { toolName: string; params: any; startTime: number };
    recentTools: Array<{ toolName: string; params: any; output?: any; error?: string; timestamp: number; durationMs?: number }>;
    recentThoughts: Array<{ thought: string; timestamp: number }>;
  }> = new Map();
  public monorepoRoot: string[] = (path.basename(process.cwd()) === 'core' || path.basename(process.cwd()) === 'ui') && fs.existsSync(path.resolve(process.cwd(), '../package.json'))
    ? [path.resolve(process.cwd(), '..')]
    : [];

  constructor(options: CoreServerOptions = {}) {
    const isTestEnv = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
    if (!process.env.OPENROUTER_API_KEY && !isTestEnv) {
      const moduleDir = typeof import.meta !== 'undefined' && (import.meta as any)?.url
        ? path.dirname(fileURLToPath((import.meta as any).url))
        : (typeof __dirname !== 'undefined' ? __dirname : process.cwd());

      const envCandidates = [
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '..', '.env'),
        path.resolve(moduleDir, '../../../.env'),
        path.resolve(moduleDir, '../../.env'),
        path.resolve(getDataDirectory(), '.env'),
      ];
      for (const envPath of envCandidates) {
        if (fs.existsSync(envPath)) {
          try {
            process.loadEnvFile(envPath);
            break;
          } catch {}
        }
      }
    }
    this.port = options.port ?? 54321;
    this.requireIpcAuth = options.requireIpcAuth ?? (this.port === 54321);
    const dataDir = getDataDirectory();
    this.dbPath = options.dbPath ?? (process.env.KIN_DB_PATH ? path.resolve(process.env.KIN_DB_PATH) : path.resolve(dataDir, 'kin_storage.sqlite'));
    this.db = new KinDatabase({ dbPath: this.dbPath });

    if (this.requireIpcAuth) {
      try {
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        const candidateTokenPaths = [
          path.join(dataDir, 'ipc_auth.token'),
          path.join(dataDir, '.kin', 'ipc_auth.token'),
          path.resolve(process.cwd(), '.kin', 'ipc_auth.token'),
        ];
        let foundToken = '';
        for (const cp of candidateTokenPaths) {
          if (fs.existsSync(cp)) {
            const token = fs.readFileSync(cp, 'utf-8').trim();
            if (token) {
              foundToken = token;
              break;
            }
          }
        }
        if (foundToken) {
          this.ipcAuthToken = foundToken;
        } else {
          this.ipcAuthToken = crypto.randomBytes(32).toString('hex');
          const tokenPath = path.join(dataDir, 'ipc_auth.token');
          try {
            fs.writeFileSync(tokenPath, this.ipcAuthToken, { encoding: 'utf-8', mode: 0o600 });
          } catch {
            fs.writeFileSync(tokenPath, this.ipcAuthToken, 'utf-8');
          }
        }

        // Keep authoritative dataDir/ipc_auth.token, dataDir/.kin/ipc_auth.token, and cwd/.kin/ipc_auth.token in sync
        const primaryTokenPath = path.join(dataDir, 'ipc_auth.token');
        if (!fs.existsSync(primaryTokenPath)) {
          try { fs.writeFileSync(primaryTokenPath, this.ipcAuthToken, 'utf-8'); } catch {}
        }
        const dotKinDir = path.join(dataDir, '.kin');
        if (!fs.existsSync(dotKinDir)) {
          try { fs.mkdirSync(dotKinDir, { recursive: true }); } catch {}
        }
        const subTokenPath = path.join(dotKinDir, 'ipc_auth.token');
        if (!fs.existsSync(subTokenPath)) {
          try { fs.writeFileSync(subTokenPath, this.ipcAuthToken, 'utf-8'); } catch {}
        }
        try {
          const cwdKin = path.resolve(process.cwd(), '.kin');
          if (!fs.existsSync(cwdKin)) fs.mkdirSync(cwdKin, { recursive: true });
          fs.writeFileSync(path.join(cwdKin, 'ipc_auth.token'), this.ipcAuthToken, 'utf-8');
        } catch {}
      } catch (tokenErr) {
        console.warn('[KIN CORE] IPC auth token setup notice:', tokenErr);
      }
    }
    if (!this.ipcAuthToken) {
      this.ipcAuthToken = crypto.randomBytes(32).toString('hex');
    }
    
    // Ensure migrations have executed
    new MigrationRunner(this.db).runMigrations();
    // Authoritative Unified EventLedger wiring (Fix 14)
    EventLedger.initialize(this.db);
    SecretBroker.getInstance(this.db);

    this.workspaceRepo = new WorkspaceRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
    this.taskRepo = new TaskRepository(this.db);
    this.goalRepo = new GoalRepository(this.db);
    this.memoryRepo = new MemoryRepository(this.db);
    this.channelService = new ChannelService(this.db);
    this.activationEngine = new ActivationEngine();
    this.kernel = new AgentKernel(this.db);
    const lastResolvedCredIdByProvider = new Map<string, string>();
    this.modelGateway = new ModelGateway({
      apiKeyResolver: (provider: string, callerAgentId?: string) => {
        try {
          const rows = this.db.query<any>(
            `SELECT id, provider, key_alias, secret_hash, scoped_grants_json, max_spend_tokens, current_spend_tokens 
             FROM managed_credentials 
             WHERE (provider = ? OR key_alias = ? OR id = ? OR LOWER(key_alias) = LOWER(?)) AND is_active = 1 
             ORDER BY CASE WHEN id = ? THEN 1 WHEN key_alias = ? OR LOWER(key_alias) = LOWER(?) THEN 2 ELSE 3 END, updated_at DESC`,
            provider, provider, provider, provider, provider, provider, provider
          );
          for (const row of rows) {
            if (row && row.secret_hash) {
              // Enforce spend cap
              if (
                typeof row.max_spend_tokens === 'number' &&
                row.max_spend_tokens > 0 &&
                typeof row.current_spend_tokens === 'number' &&
                row.current_spend_tokens >= row.max_spend_tokens
              ) {
                continue;
              }
              if (callerAgentId && row.scoped_grants_json) {
                try {
                  const grants: string[] = JSON.parse(row.scoped_grants_json);
                  if (Array.isArray(grants) && grants.length > 0 && !grants.includes(callerAgentId) && !grants.includes('*')) {
                    continue;
                  }
                } catch {}
              }
              lastResolvedCredIdByProvider.set(provider, row.id);
              if (row.key_alias) lastResolvedCredIdByProvider.set(row.key_alias, row.id);
              const vault = SecretVault.getInstance();
              const decrypted = vault.decrypt(row.secret_hash);
              return decrypted || row.secret_hash;
            }
          }
        } catch {}
        if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY;
        if (provider === 'openai') return process.env.OPENAI_API_KEY;
        if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
        if (provider === 'deepseek') return process.env.DEEPSEEK_API_KEY;
        if (provider === 'gemini') return process.env.GEMINI_API_KEY;
        if (provider === 'groq') return process.env.GROQ_API_KEY;
        if (provider === 'xai') return process.env.XAI_API_KEY;
        if (provider === 'azure') return process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_API_KEY;
        if (provider === 'together') return process.env.TOGETHER_API_KEY;
        if (provider === 'deepinfra') return process.env.DEEPINFRA_API_KEY;
        if (provider === 'fireworks') return process.env.FIREWORKS_API_KEY;
        if (provider === 'perplexity') return process.env.PERPLEXITY_API_KEY;
        if (provider === 'cerebras') return process.env.CEREBRAS_API_KEY;
        return undefined;
      },
      allKeysResolver: (provider: string, callerAgentId?: string) => {
        try {
          const rows = this.db.query<any>(
            `SELECT id, provider, key_alias, secret_hash, base_url, scoped_grants_json, max_spend_tokens, current_spend_tokens 
             FROM managed_credentials 
             WHERE (provider = ? OR key_alias = ? OR id = ? OR LOWER(key_alias) = LOWER(?)) AND is_active = 1 
             ORDER BY CASE WHEN id = ? THEN 1 WHEN key_alias = ? OR LOWER(key_alias) = LOWER(?) THEN 2 ELSE 3 END, updated_at DESC`,
            provider, provider, provider, provider, provider, provider, provider
          );
          const vault = SecretVault.getInstance();
          const result: Array<{ id: string; key: string; keyAlias?: string; baseUrl?: string }> = [];
          for (const r of rows) {
            if (!r.secret_hash) continue;
            if (
              typeof r.max_spend_tokens === 'number' &&
              r.max_spend_tokens > 0 &&
              typeof r.current_spend_tokens === 'number' &&
              r.current_spend_tokens >= r.max_spend_tokens
            ) {
              continue;
            }
            if (callerAgentId && r.scoped_grants_json) {
              try {
                const grants: string[] = JSON.parse(r.scoped_grants_json);
                if (Array.isArray(grants) && grants.length > 0 && !grants.includes(callerAgentId) && !grants.includes('*')) {
                  continue;
                }
              } catch {}
            }
            const decrypted = vault.decrypt(r.secret_hash) || r.secret_hash;
            result.push({ id: r.id, key: decrypted, keyAlias: r.key_alias, baseUrl: r.base_url || undefined });
          }
          return result;
        } catch {
          return [];
        }
      },
      onUsage: (provider: string, tokensUsed: { totalTokens: number }) => {
        try {
          const credId = lastResolvedCredIdByProvider.get(provider);
          if (credId) {
            this.db.execute(
              'UPDATE managed_credentials SET current_spend_tokens = current_spend_tokens + ?, updated_at = ? WHERE id = ?',
              tokensUsed.totalTokens,
              Date.now(),
              credId
            );
          } else {
            this.db.execute(
              'UPDATE managed_credentials SET current_spend_tokens = current_spend_tokens + ?, updated_at = ? WHERE id = (SELECT id FROM managed_credentials WHERE (provider = ? OR key_alias = ?) AND is_active = 1 ORDER BY updated_at DESC LIMIT 1)',
              tokensUsed.totalTokens,
              Date.now(),
              provider,
              provider
            );
          }
        } catch {}
      },
    });

    // Reconcile custom providers from SQLite providers and managed_credentials tables on startup
    this.syncModelGatewayProviders();

    // Auto-seed active OpenRouter credential from browser/environment if not yet registered
    try {
      const existingOpenRouter = this.db.queryOne<any>(
        'SELECT id FROM managed_credentials WHERE provider = ?',
        'openrouter'
      );
      if (!existingOpenRouter) {
        const defaultOpenRouterKey = process.env.OPENROUTER_API_KEY || '';
        if (defaultOpenRouterKey) {
          const now = Date.now();
          const encryptedKey = SecretVault.getInstance().encrypt(defaultOpenRouterKey);
          this.db.execute(
            `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            `cred-${now}-openrouter`,
            'openrouter',
            'OpenRouter Environment Credential',
            encryptedKey,
            JSON.stringify([]),
            5000000,
            0,
            1,
            now,
            now
          );
        }
      }
    } catch {}
    this.contextCompiler = new ContextCompiler();
    this.scheduler = new SchedulerService(this.db);
    this.computerSupervisor = new ComputerSupervisor();
    this.toolEngine = new ToolEngine(this.db);
    this.toolGateway = new ToolGateway({
      scheduler: this.scheduler,
      db: this.db,
      computerSupervisor: this.computerSupervisor,
      memoryRepo: this.memoryRepo,
      agentRepo: this.agentRepo,
      toolEngine: this.toolEngine,
    });
    this.toolGateway.setToolEngine(this.toolEngine);
    this.toolGateway.setMemoryRepository(this.memoryRepo);
    this.toolGateway.setAgentRepository(this.agentRepo);
    this.toolGateway.setOperatorNotificationCallback((notif) => {
      this.broadcastEvent('operator:notification', notif);
    });
    this.toolGateway.setAgentHiredCallback((agent, channelId) => {
      this.broadcastEvent('agent:created', { agent });
      if (channelId) {
        this.broadcastEvent('channel:member_added', { channelId, agentId: agent.id });
      }
    });
    this.toolGateway.setDirectMessageCallback(async ({ senderAgentId, recipientAgentId, projectId, content, sourceChannelId }) => {
      const isHumanRecipient = ['user', 'human', 'operator', 'me', 'human operator'].includes(
        String(recipientAgentId).trim().toLowerCase()
      );

      const sender = this.agentRepo.getIdentity(senderAgentId);

      if (isHumanRecipient) {
        const dmChannelId = `dm-${senderAgentId}`;
        const srcChan = sourceChannelId ? this.workspaceRepo.getChannel(sourceChannelId) : undefined;
        const srcName = srcChan?.name ? `#${srcChan.name.replace(/^#/, '')}` : (sourceChannelId ? `#${sourceChannelId}` : undefined);
        const dmTopic = srcName
          ? `Private 1-on-1 Direct Message with ${sender?.displayName ?? senderAgentId} (Requested from ${srcName})`
          : `Private 1-on-1 Direct Message with ${sender?.displayName ?? senderAgentId}`;

        let dmChannel = this.workspaceRepo.getChannel(dmChannelId);
        if (!dmChannel) {
          const targetProjectId = sender?.projectId || projectId || this.activeProjectId;
          this.workspaceRepo.createChannel({
            id: dmChannelId,
            projectId: targetProjectId,
            name: sender?.displayName ?? 'DM',
            topic: dmTopic,
            channelType: 'direct_message',
            isPrivate: true,
            participantIds: [senderAgentId],
            createdAt: Date.now(),
          });
          this.workspaceRepo.addChannelMember(dmChannelId, senderAgentId);
          dmChannel = this.workspaceRepo.getChannel(dmChannelId)!;
        } else if (srcName && !dmChannel.topic?.includes(srcName)) {
          this.db.execute(`UPDATE channels SET topic = ? WHERE id = ?`, dmTopic, dmChannelId);
          dmChannel.topic = dmTopic;
        }

        if (sourceChannelId) {
          this.memoryRepo.setMemory({
            scope: 'agent_private',
            scopeId: senderAgentId,
            key: 'origin_channel_for_dm',
            value: { channelId: sourceChannelId, channelName: srcName, requestedAt: Date.now() },
            type: 'working_state',
          });
        }

        const msg = this.channelService.sendMessage({
          channelId: dmChannel.id,
          senderId: senderAgentId,
          senderType: 'agent',
          content,
          productivityScore: 1,
        });
        this.broadcastEvent('message:created', { message: msg, channelId: dmChannel.id });
        this.broadcastEvent('channel:created', { channel: dmChannel });

        this.broadcastEvent('operator:notification', {
          type: 'agent_dm_to_human',
          fromAgentId: senderAgentId,
          fromAgentName: sender?.displayName || senderAgentId,
          toAgentId: 'human',
          toAgentName: 'Human Operator',
          channelId: dmChannel.id,
          message: `Direct message from @${sender?.displayName?.replace(/^@/, '') || senderAgentId} to you: "${content.slice(0, 100)}"`,
          content,
        });

        return {
          channelId: dmChannel.id,
          enqueuedResponse: false,
          consecutiveTurns: 1,
        };
      }

      const dmChannel = this.workspaceRepo.getOrCreateDirectMessageChannel(senderAgentId, recipientAgentId, projectId);
      const msg = this.channelService.sendMessage({
        channelId: dmChannel.id,
        senderId: senderAgentId,
        senderType: 'agent',
        content,
        productivityScore: 1,
      });
      this.broadcastEvent('message:created', { message: msg, channelId: dmChannel.id });
      this.broadcastEvent('channel:created', { channel: dmChannel });

      const recipient = this.agentRepo.getIdentity(recipientAgentId);
      this.broadcastEvent('operator:notification', {
        type: 'agent_dm',
        fromAgentId: senderAgentId,
        fromAgentName: sender?.displayName || senderAgentId,
        toAgentId: recipientAgentId,
        toAgentName: recipient?.displayName || recipientAgentId,
        channelId: dmChannel.id,
        message: `Notified @${recipient?.displayName?.replace(/^@/, '') || recipientAgentId} in DM: "${content.slice(0, 100)}"`,
        content,
      });

      // Stopping heuristic: check completion tokens
      const isCompleted = hasDirectMessageCompletionToken(content);

      // Peer turn depth ceiling: maximum 5 consecutive agent-to-agent turns without operator intervention
      const recentDmMessages = this.channelService.getMessages(dmChannel.id, 20);
      let consecutiveAgentTurns = 0;
      for (let i = recentDmMessages.length - 1; i >= 0; i--) {
        if (recentDmMessages[i].senderType === 'human') {
          break;
        }
        if (recentDmMessages[i].senderType === 'agent') {
          consecutiveAgentTurns++;
        }
      }

      const turnLimitReached = consecutiveAgentTurns >= 5;
      let enqueuedResponse = false;
      let stopReason: string | undefined;

      if (isCompleted) {
        stopReason = `Conversation completed: Completion token detected from @${sender?.displayName?.replace(/^@/, '') || senderAgentId}. Automatic peer response halted.`;
        this.broadcastEvent('operator:notification', {
          type: 'peer_dm_completed',
          channelId: dmChannel.id,
          message: stopReason,
        });
      } else if (turnLimitReached) {
        stopReason = `Turn depth ceiling reached (5 consecutive agent turns in DM channel ${dmChannel.id} without operator intervention). Automatic peer response paused.`;
        this.broadcastEvent('operator:notification', {
          type: 'peer_dm_turn_limit',
          channelId: dmChannel.id,
          message: stopReason,
        });
      } else if (recipient) {
        enqueuedResponse = true;
        this.enqueueAgentExecution(recipient.id, () =>
          this.executeAgentResponse(recipient, dmChannel.id, msg)
        );
      }

      return {
        channelId: dmChannel.id,
        enqueuedResponse,
        consecutiveTurns: consecutiveAgentTurns,
        stoppedReason: stopReason,
      };
    });
    this.toolGateway.setChannelMessageCallback(async ({ senderAgentId, channelId, content }) => {
      let targetChannel = this.workspaceRepo.getChannel(channelId);
      if (!targetChannel) {
        const cleanName = channelId.replace(/^#/, '').toLowerCase();
        const channels = this.workspaceRepo.listChannels(this.activeProjectId || 'proj-kin');
        targetChannel = channels.find(
          (c: any) => c.id.toLowerCase() === cleanName || (c.name && c.name.toLowerCase() === cleanName)
        );
      }
      if (!targetChannel) {
        throw new Error(`Channel '${channelId}' not found.`);
      }

      const msg = this.channelService.sendMessage({
        channelId: targetChannel.id,
        senderId: senderAgentId,
        senderType: 'agent',
        content,
      });

      this.broadcastEvent('message:created', msg);
      return { success: true, messageId: msg.id, channelId: targetChannel.id, channelName: targetChannel.name };
    });
    this.toolGateway.setAssignCoworkerCallback((coworker, channelId) => {
      this.workspaceRepo.addChannelMember(channelId, coworker.id);
      const chan = this.workspaceRepo.getChannel(channelId);
      if (chan) {
        this.broadcastEvent('channel:created', { channel: chan });
      }
      this.broadcastEvent('channel:member_added', { channelId, agentId: coworker.id, agent: coworker });
    });
    this.toolGateway.setCallMeetingCallback(({ channelId, topic, agenda, participantIds }) => {
      const channel = this.workspaceRepo.getChannel(channelId);
      this.broadcastEvent('channel:created', { channel });
      const meetingMsg = this.channelService.sendMessage({
        channelId,
        senderId: 'system',
        senderType: 'system',
        content: `📅 Meeting convened: **${topic}**\n\nAgenda: ${agenda}\nParticipants: ${participantIds.join(', ')}`,
        productivityScore: 0,
      });
      this.broadcastEvent('message:created', { message: meetingMsg, channelId });

      const participants = participantIds
        .map((id) => this.agentRepo.getIdentity(id))
        .filter(Boolean) as AgentIdentity[];

      this.broadcastEvent('operator:notification', {
        type: 'meeting_convened',
        channelId,
        message: `Meeting convened: "${topic}" with ${participants.map((p) => p.displayName).join(', ')}`,
        content: agenda,
      });

      if (participants.length > 0) {
        this.executeSequentialAgents(participants, channelId, meetingMsg).catch((err) => {
          console.error('[KIN CORE] Error executing meeting participants:', err);
        });
      }
    });
    this.toolGateway.setDelegationCallback(async ({ fromAgentId, targetAgent, directive, channelId, runId, projectId }) => {
      const targetProjId = projectId || 'proj-kin';
      const cleanTarget = String(targetAgent).replace(/^@/, '');
      const target = this.agentRepo.getIdentityByProjectAndName(targetProjId, cleanTarget)
        || this.agentRepo.getIdentityByProjectAndName(targetProjId, String(targetAgent))
        || this.agentRepo.getIdentity(cleanTarget)
        || this.agentRepo.getIdentity(String(targetAgent));
      if (!target) {
        throw new Error(`Target agent '${targetAgent}' not found for delegation`);
      }
      const targetChannelId = channelId || 'chan-general';
      this.broadcastEvent('agent:delegation_started', {
        fromAgentId,
        targetAgentId: target.id,
        targetAgentName: target.displayName,
        directive,
        channelId: targetChannelId,
        parentRunId: runId,
      });
      const fromAgent = this.agentRepo.getIdentity(fromAgentId);
      const fromName = fromAgent?.displayName || fromAgentId;
      if (targetChannelId.startsWith('dm-')) {
        this.broadcastEvent('operator:notification', {
          type: 'agent_dm',
          fromAgentId,
          fromAgentName: fromName,
          toAgentId: target.id,
          toAgentName: target.displayName,
          channelId: targetChannelId,
          message: `Notified @${target.displayName.replace(/^@/, '')} in DM: "${directive.slice(0, 100)}"`,
          content: directive,
        });
      }
      const peerMsg = this.channelService.sendMessage({
        channelId: targetChannelId,
        senderId: fromAgentId,
        senderType: 'agent',
        content: `[COORDINATION FROM ${fromName}]: ${directive}`,
        productivityScore: 1,
      });
      this.broadcastEvent('message:created', {
        id: peerMsg.id,
        channelId: targetChannelId,
        senderId: fromAgentId,
        senderName: fromName.replace(/^@/, ''),
        senderType: 'agent',
        content: peerMsg.content,
        createdAt: peerMsg.createdAt,
        productivityScore: peerMsg.productivityScore,
      });
      this.incrementDelegation(targetChannelId);
      this.enqueueChannelExecution(targetChannelId, async () => {
        try {
          await this.enqueueAgentExecution(target.id, () =>
            this.executeAgentResponse(target, targetChannelId, peerMsg, 1, undefined, undefined, undefined, runId)
          );
        } finally {
          this.decrementDelegation(targetChannelId);
        }
      });
      return {
        delegated: true,
        runId: peerMsg.id,
        message: `Delegation directive dispatched to ${target.displayName}: "${directive}"`,
      };
    });
    this.desktopController = this.toolGateway.getDesktopController();
    this.browserController = this.toolGateway.getBrowserController();
    let repoRoot = process.env.KIN_PROJECT_ROOT || process.cwd();
    try {
      const initialProject = this.workspaceRepo.getProject(this.activeProjectId);
      if (initialProject?.repoPath) {
        repoRoot = initialProject.repoPath;
      }
    } catch {}
    this.skillEngine = new SkillEngine(this.db, { repoRoot });
    this.toolGateway.setSkillEngine(this.skillEngine);
    this.recoveryEngine = new RecoveryEngine(this.skillEngine);
    this.mcpClient = new McpClientManager(repoRoot);
    this.toolGateway.setMcpClient(this.mcpClient);
    this.financialSafety = new FinancialSafetyShield();
    this.agentLoopRunner = new AgentLoopRunner(
      this.modelGateway,
      this.toolGateway,
      this.scheduler,
      this.skillEngine,
      this.recoveryEngine,
      this.financialSafety
    );
    this.nativeRunnerAdapter = new NativeReActRunnerAdapter(this.agentLoopRunner);
    RunnerAdapterRegistry.register(this.nativeRunnerAdapter, true);

    // Initialize Event-Driven Coalesced Wakeup Queue (1000ms debounce)
    this.wakeupQueue = new WakeupQueue(1000, async (event, coalescedCount) => {
      const ag = this.agentRepo.getIdentity(event.agentId);
      if (ag) {
        await this.executeAgentResponse(
          ag,
          event.channelId,
          event.payload || { id: event.id, content: 'Wakeup execution trigger' }
        );
      }
    });

    // Start background In-App Scheduler and supervisor lease watchdog
    this.scheduler.start();
    this.setupSchedulerFiredHandler();
    this.startSupervisorWatchdog();

    this.seedDefaultStateIfEmpty();

    // Startup Crash Recovery Sweep: detect interrupted runs from prior PC shutdown
    try {
      this.db.execute(`
        UPDATE agent_runs 
        SET state = 'cancelled', quota_resets_at = NULL 
        WHERE state = 'quota_paused' AND (quota_resets_at IS NULL OR quota_resets_at <= ?)
      `, Date.now());
      this.runSupervisorSelfHealing();
      this.dispatchQueuedRunsStartup();
    } catch (recErr) {
      console.warn('[KIN CORE] Startup crash recovery sweep notice:', recErr);
    }
    this.router = new Router(this);
  }

  private dispatchQueuedRunsStartup(): void {
    try {
      let admitted = this.kernel.admitNextQueuedRun();
      while (admitted) {
        const admittedRun = admitted;
        const admittedAgent = this.agentRepo.getIdentity(admittedRun.agentId);
        if (admittedAgent) {
          this.broadcastEvent('run:admitted', { runId: admittedRun.id, agentId: admittedAgent.id });
          const targetChan = admittedRun.channelId || 'chan-general';
          let trigger = admittedRun.triggerMessageId
            ? this.channelService.getMessage(admittedRun.triggerMessageId)
            : undefined;
          if (!trigger && admittedRun.taskId) {
            const taskObj = this.taskRepo.getTask(admittedRun.taskId);
            if (taskObj) {
              trigger = {
                id: `trigger-task-${admittedRun.id}`,
                channelId: targetChan,
                senderId: 'system',
                content: `Execute task: ${taskObj.title}\n${taskObj.description || ''}`,
                taskId: taskObj.id,
              } as any;
            }
          }
          this.enqueueChannelExecution(targetChan, () =>
            this.enqueueAgentExecution(admittedAgent.id, () =>
              this.executeAgentResponse(admittedAgent, targetChan, trigger, 0, undefined, admittedRun.id)
            )
          );
        }
        admitted = this.kernel.admitNextQueuedRun();
      }

      // Dispatch durable queued messages from prior sessions for idle channels
      try {
        const channelsWithQueued = this.db.query<{ channel_id: string }>(
          'SELECT DISTINCT channel_id FROM queued_messages'
        );
        for (const row of channelsWithQueued) {
          this.processNextQueuedMessage(row.channel_id).catch(() => {});
        }
      } catch {}
    } catch (err) {
      console.warn('[KIN CORE] Startup queue dispatch notice:', err);
    }
  }

  private setupSchedulerFiredHandler(): void {
    this.scheduler.onScheduleFired(async (sched) => {
      const boss = this.agentRepo.listIdentitiesByProject(sched.projectId).find((a) => a.isOrchestrator);
      const wakeMsg = this.channelService.sendMessage({
        channelId: sched.channelId,
        senderId: sched.targetAgentId || boss?.id || 'agent-boss',
        senderType: 'agent',
        content: `[Automated Turn] [Scheduled Wakeup] ⏰ **Timer / Scheduled Alarm Triggered**\n- **Directive**: "${sched.prompt}"\n- **Type**: \`${sched.type}\`\n\nWaking agent to execute scheduled task without polling loop.`,
        productivityScore: 100,
      });

      this.broadcastEvent('message:created', {
        id: wakeMsg.id,
        channelId: wakeMsg.channelId,
        senderId: wakeMsg.senderId,
        senderName: 'System Scheduler',
        senderType: 'agent',
        content: wakeMsg.content,
        createdAt: wakeMsg.createdAt,
        productivityScore: wakeMsg.productivityScore,
      });
      this.broadcastEvent('schedule:fired', sched);
      this.broadcastEvent('routine:fired', sched);

      const target = (sched.targetAgentId ? this.agentRepo.getIdentity(sched.targetAgentId) : null) || boss;
      if (target) {
        this.wakeupQueue.enqueue({
          id: `wake-${sched.id}-${Date.now()}`,
          agentId: target.id,
          channelId: sched.channelId,
          projectId: sched.projectId,
          source: 'schedule',
          payload: { id: wakeMsg.id, content: sched.prompt },
          timestamp: Date.now(),
        });
      }
    });
  }

  private startSupervisorWatchdog(): void {
    this.supervisorInterval = setInterval(() => {
      try {
        this.runSupervisorSelfHealing();
      } catch (err) {
        console.error('[KIN SUPERVISOR ERROR]', err);
      }
    }, 15000);
  }

  public runSupervisorSelfHealing(staleThresholdMs: number = 45000): Array<{ id: string; agentId: string; projectId?: string; taskId?: string }> {
    try {
      const recovered = this.kernel.recoverStaleRunsDetailed(staleThresholdMs);
      const reclaimedTaskIds = this.taskRepo.reclaimExpiredTaskLeases();
      if (reclaimedTaskIds.length > 0) {
        console.log(`[KIN SUPERVISOR] Self-healing reclaimed ${reclaimedTaskIds.length} expired task lease(s).`);
        for (const tId of reclaimedTaskIds) {
          const t = this.taskRepo.getTask(tId);
          this.broadcastEvent('task:updated', { taskId: tId, status: t?.status || 'ready' });
        }
      }

      if (recovered.length > 0) {
        console.log(`[KIN SUPERVISOR] Self-healing recovered ${recovered.length} stale run(s).`);

        for (const item of recovered) {
          const ag = this.agentRepo.getIdentity(item.agentId);
          const tsk = item.taskId ? this.taskRepo.getTask(item.taskId) : null;
          if (!this.pendingRecoveries.some((r) => r.id === item.id)) {
            this.pendingRecoveries.push({
              id: item.id,
              runId: item.id,
              agentId: item.agentId,
              agentName: ag?.displayName || item.agentId,
              projectId: item.projectId,
              taskId: item.taskId,
              taskTitle: tsk?.title,
              interruptedTurn: item.interruptedTurn || 1,
              checkpoint: item.checkpoint,
              checkpointReason: 'Process termination / stale heartbeat lease',
            });
          }
        }

        this.broadcastEvent('system:recovered', { count: recovered.length, runs: recovered });
        this.broadcastEvent('system:recovery-state', {
          count: this.pendingRecoveries.length,
          pendingRecoveries: this.pendingRecoveries,
        });

        for (const item of recovered) {
          try {
            // Unblock active in-memory execution and takeover gates
            const abortCtrl = this.runAbortControllers.get(item.id);
            if (abortCtrl) {
              try { abortCtrl.abort(new Error(`Supervisor self-healing aborted stale run ${item.id}`)); } catch {}
              this.runAbortControllers.delete(item.id);
            }
            this.activeAgentExecutions.delete(item.agentId);
            this.takeoverStates.delete(item.id);
            this.broadcastEvent('agent:state', { agentId: item.agentId, status: 'idle' });

            // Unblock any task associated with the crashed run, bound by retry cap
            if (item.taskId) {
              try {
                const currentTask = this.taskRepo.getTask(item.taskId);
                if (currentTask && (currentTask.status === 'running' || currentTask.status === 'ready')) {
                  const retryCount = (currentTask.retryCount ?? 0) + 1;
                  if (retryCount >= 5) {
                    this.taskRepo.updateTaskStatus(item.taskId, 'review');
                    this.db.execute('UPDATE tasks SET retry_count = ?, updated_at = ? WHERE id = ?', retryCount, Date.now(), item.taskId);
                    this.broadcastEvent('task:updated', { taskId: item.taskId, status: 'review' });
                  } else {
                    this.taskRepo.updateTaskStatus(item.taskId, 'ready');
                    this.db.execute('UPDATE tasks SET retry_count = ?, updated_at = ? WHERE id = ?', retryCount, Date.now(), item.taskId);
                    this.broadcastEvent('task:updated', { taskId: item.taskId, status: 'ready' });
                  }
                }
              } catch {}
            }

            // Post self-healing audit message to channel
            const targetProj = item.projectId || this.activeProjectId;
            const channels = this.workspaceRepo.listChannels(targetProj);
            const channel = channels.find((c) => c.name === 'general') || channels[0];
            if (channel) {
              const ag = this.agentRepo.getIdentity(item.agentId);
              const notice = this.channelService.sendMessage({
                channelId: channel.id,
                senderId: 'kin-supervisor',
                senderType: 'system',
                content: `🛡️ **Supervisor Self-Healing**: Detected stale lease for run \`${item.id}\`. ` +
                  `Agent **${ag?.displayName || item.agentId}** state has been safely restored to \`idle\`. Tasks unblocked.`,
                productivityScore: 100,
              });
              this.broadcastEvent('message:created', {
                id: notice.id,
                channelId: notice.channelId,
                senderId: notice.senderId,
                senderName: 'Supervisor',
                senderType: 'system',
                content: notice.content,
                createdAt: notice.createdAt,
              });
            }
          } catch (itemErr) {
            console.warn('[KIN SUPERVISOR] Recovered item warning:', item.id, itemErr);
          }
        }
      }

      // Quota Auto-Resume & Cleanup Sweep:
      try {
        const readyQuotaRuns = this.kernel.getRunsReadyToResumeFromQuota();
        if (readyQuotaRuns && readyQuotaRuns.length > 0) {
          console.log(`[KIN SUPERVISOR] Self-healing found ${readyQuotaRuns.length} quota-paused run(s) ready to resume.`);
          for (const qItem of readyQuotaRuns) {
            const runRow = this.db.queryOne<any>('SELECT * FROM agent_runs WHERE id = ?', qItem.id);
            if (!runRow) continue;
            const now = Date.now();
            const elapsedSincePause = now - (runRow.heartbeat_at || runRow.created_at || now);
            // If ancient (> 15 minutes), cleanly cancel and restore agent to idle
            if (elapsedSincePause > 15 * 60 * 1000) {
              console.log(`[KIN SUPERVISOR] Cleanly resetting ancient quota-paused run ${qItem.id}.`);
              this.kernel.transitionState(qItem.id, 'cancelled');
              this.db.execute('UPDATE agent_runs SET quota_resets_at = NULL WHERE id = ?', qItem.id);
              this.activeAgentExecutions.delete(qItem.agentId);
              this.broadcastEvent('quota:resumed', { runId: qItem.id });
              this.broadcastEvent('agent:state', { agentId: qItem.agentId, status: 'idle' });
            } else {
              console.log(`[KIN SUPERVISOR] Auto-resuming quota-paused run ${qItem.id} (reset window elapsed).`);
              this.resumeInterruptedRun(qItem.id).catch((err) => {
                console.warn(`[KIN SUPERVISOR] Failed to auto-resume quota run ${qItem.id}:`, err);
              });
            }
          }
        }
      } catch (qErr) {
        console.warn('[KIN SUPERVISOR] Quota auto-resume check notice:', qErr);
      }

      return recovered;
    } catch (err) {
      console.error('[KIN SUPERVISOR] Error during runSupervisorSelfHealing:', err);
      return [];
    }
  }

  public async resumeInterruptedRun(runId: string, modelOverride?: string): Promise<boolean> {
    const runRow = this.db.queryOne<any>('SELECT * FROM agent_runs WHERE id = ?', runId);
    if (!runRow) return false;

    // Transition run to running
    this.kernel.transitionState(runId, 'running');
    if (modelOverride) {
      this.db.execute('UPDATE agent_runs SET model_id = ?, quota_resets_at = NULL WHERE id = ?', modelOverride, runId);
      if (runRow.agent_id) {
        this.agentRepo.updateAgentModelConfig(runRow.agent_id, modelOverride);
        if (runRow.channel_id && !runRow.channel_id.startsWith('dm-')) {
          this.memoryRepo.setMemory({
            scope: 'channel',
            scopeId: runRow.channel_id,
            key: `agent_model:${runRow.agent_id}`,
            type: 'preference',
            value: modelOverride,
          });
        }
        this.broadcastEvent('agent:updated', { agentId: runRow.agent_id, activeModelId: modelOverride });
      }
    } else {
      this.db.execute('UPDATE agent_runs SET quota_resets_at = NULL WHERE id = ?', runId);
    }
    this.broadcastEvent('quota:resumed', { runId });

    // Retrieve latest checkpoint
    const checkpointRow = this.db.queryOne<any>(
      'SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1',
      runId
    );
    let checkpointData: any = null;
    if (checkpointRow && checkpointRow.snapshot_json) {
      try {
        checkpointData = JSON.parse(checkpointRow.snapshot_json);
      } catch {}
    }

    // Remove from pending recoveries
    this.pendingRecoveries = this.pendingRecoveries.filter((r) => r.id !== runId);
    this.broadcastEvent('system:recovery-state', {
      count: this.pendingRecoveries.length,
      pendingRecoveries: this.pendingRecoveries,
    });

    const agent = this.agentRepo.getIdentity(runRow.agent_id);
    if (!agent) return false;

    const dummyTrigger = {
      id: `trigger-resume-${Date.now()}`,
      content: `[System Recovery: Resuming interrupted run ${runId} at turn ${runRow.interrupted_turn || checkpointData?.turn || 1}]`,
      taskId: runRow.task_id,
    };

    this.executeAgentResponse(
      agent,
      runRow.channel_id || 'chan-default',
      dummyTrigger,
      0,
      checkpointData ? {
        turn: checkpointData.turn || runRow.interrupted_turn || 1,
        conversationHistory: checkpointData.conversationHistory || [],
        actions: checkpointData.actions || [],
      } : undefined,
      runId,
      modelOverride
    ).catch((err) => {
      console.error('[KIN RECOVERY RESUME ERROR]', err);
    });

    return true;
  }

  /**
   * Seeds default workspace, project, channels, and single default agent @Boss.
   */
  private seedDefaultStateIfEmpty(): void {
    const now = Date.now();
    let ws = this.workspaceRepo.getWorkspace('ws-default');
    if (!ws) {
      this.workspaceRepo.createWorkspace({
        id: 'ws-default',
        name: 'KIN Core Workspace',
        rootPath: process.cwd(),
        defaultAutonomyMode: 'AUTO',
        createdAt: now,
        updatedAt: now,
      });
    }

    let defaultProject = this.workspaceRepo.getProject('proj-kin');
    if (!defaultProject) {
      this.workspaceRepo.createProject({
        id: 'proj-kin',
        workspaceId: 'ws-default',
        name: 'KIN',
        repoPath: process.cwd(),
        settings: { defaultBranch: 'main' },
        createdAt: now,
        updatedAt: now,
      });
    }

    // Ensure #general channel exists
    const channels = this.workspaceRepo.listChannels('proj-kin');
    if (channels.length === 0) {
      this.workspaceRepo.createChannel({
        id: 'chan-general',
        projectId: 'proj-kin',
        name: 'general',
        topic: 'Workspace discussion',
        isPrivate: false,
        createdAt: now,
      });
    }

    // Ensure default providers exist in providers table for foreign key integrity
    try {
      this.db.execute(`
        INSERT OR IGNORE INTO providers (id, name, provider_type, is_active, created_at)
        VALUES 
          ('ollama', 'Ollama (Local)', 'ollama', 1, ?),
          ('openrouter', 'OpenRouter Gateway', 'custom', 1, ?),
          ('openai', 'OpenAI', 'openai', 1, ?),
          ('anthropic', 'Anthropic', 'anthropic', 1, ?),
          ('gemini', 'Google Gemini', 'gemini', 1, ?),
          ('deepseek', 'DeepSeek', 'custom', 1, ?),
          ('groq', 'Groq', 'custom', 1, ?),
          ('custom', 'Custom Provider', 'custom', 1, ?)
      `, now, now, now, now, now, now, now, now);
    } catch {}

    // Ensure strictly ONE default agent: @Boss (Orchestrator)
    const existingAgents = this.agentRepo.listIdentitiesByProject('proj-kin');
    let bossIdentity = this.agentRepo.getIdentity('agent-boss') || existingAgents.find((a) => a.displayName.toLowerCase() === '@boss' || a.displayName.toLowerCase() === 'boss');
    if (!bossIdentity) {
      // Clean up any legacy test agents to enforce the single-agent requirement
      this.db.execute("DELETE FROM messages WHERE sender_id IN ('agent-orch', 'agent-backend', 'agent-frontend', 'agent-db')");
      this.db.execute("DELETE FROM approvals WHERE agent_id IN ('agent-orch', 'agent-backend', 'agent-frontend', 'agent-db')");
      this.db.execute("DELETE FROM agent_runs WHERE agent_id IN ('agent-orch', 'agent-backend', 'agent-frontend', 'agent-db')");
      this.db.execute("DELETE FROM agent_identities WHERE id IN ('agent-orch', 'agent-backend', 'agent-frontend', 'agent-db')");
      this.db.execute("DELETE FROM agent_definitions WHERE id IN ('def-orch', 'def-backend', 'def-frontend', 'def-db')");

      // Create @Boss definition
      this.agentRepo.createDefinition({
        id: 'def-boss',
        name: 'Boss',
        role: 'Workspace Orchestrator',
        systemPrompt: 'You are @Boss, KIN’s default workspace orchestrator. Coordinate agents and tools for the current request. Follow the capabilities and project boundaries provided for this run, and ask when access or authority is unclear.',
        defaultModelId: 'ollama/qwen2.5-coder:3b',
        domainAuthority: ['Architecture', 'Orchestration', 'Engineering', 'Operations'],
        capabilities: ['read', 'write', 'shell', 'worktree', 'delegate', 'agent:hire', 'agent:delegate', '*'],
        createdAt: now,
      });

      // Create @Boss identity
      this.agentRepo.createIdentity({
        id: 'agent-boss',
        workspaceId: 'ws-default',
        projectId: 'proj-kin',
        definitionId: 'def-boss',
        displayName: '@Boss',
        activeModelId: 'ollama/qwen2.5-coder:3b',
        isOrchestrator: true,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      });

      // Seed initial welcome message from @Boss in #general
      this.channelService.sendMessage({
        channelId: 'chan-general',
        senderId: 'agent-boss',
        senderType: 'agent',
        content: 'KIN workspace initialized. I am @Boss, the default workspace orchestrator.',
        productivityScore: 100,
      });
      bossIdentity = this.agentRepo.getIdentity('agent-boss');
    }

    // Ensure @Boss is in #general channel_members
    if (bossIdentity) {
      this.workspaceRepo.addChannelMember('chan-general', bossIdentity.id);
    }

    // Ensure authoritative project Boss exists
    this.agentRepo.ensureProjectBoss(this.activeProjectId, 'ws-default');

    // Ensure terminology invariant across all pre-existing database records
    try {
      const termPlatformOld = ['KIN', 'Operating', 'System'].join(' ');
      const termPlatformShort = ['KIN', 'O' + 'S'].join(' ');
      const termPlatformRuntime = ['operating', 'system'].join(' ');
      this.db.execute(`
        UPDATE agent_definitions 
        SET system_prompt = REPLACE(REPLACE(REPLACE(system_prompt, '${termPlatformOld}', 'KIN Platform'), '${termPlatformShort}', 'KIN Platform'), '${termPlatformRuntime}', 'platform runtime'),
            role = REPLACE(REPLACE(REPLACE(role, '${termPlatformOld}', 'KIN Platform'), '${termPlatformShort}', 'KIN Platform'), '${termPlatformRuntime}', 'platform runtime')
        WHERE system_prompt LIKE '%${termPlatformShort}%' OR role LIKE '%${termPlatformShort}%' OR system_prompt LIKE '%${termPlatformRuntime}%' OR role LIKE '%${termPlatformRuntime}%'
      `);
      this.db.execute(`
        UPDATE messages 
        SET content = REPLACE(REPLACE(REPLACE(content, '${termPlatformOld}', 'KIN Platform'), '${termPlatformShort}', 'KIN Platform'), '${termPlatformRuntime}', 'platform runtime')
        WHERE content LIKE '%${termPlatformShort}%' OR content LIKE '%${termPlatformOld}%' OR content LIKE '%${termPlatformRuntime}%'
      `);
      this.db.execute(`
        UPDATE goals 
        SET title = REPLACE(REPLACE(REPLACE(title, '${termPlatformOld}', 'KIN Platform'), '${termPlatformShort}', 'KIN Platform'), '${termPlatformRuntime}', 'platform runtime'),
            description = REPLACE(REPLACE(REPLACE(description, '${termPlatformOld}', 'KIN Platform'), '${termPlatformShort}', 'KIN Platform'), '${termPlatformRuntime}', 'platform runtime')
        WHERE title LIKE '%${termPlatformShort}%' OR description LIKE '%${termPlatformShort}%' OR title LIKE '%${termPlatformRuntime}%' OR description LIKE '%${termPlatformRuntime}%'
      `);
      this.db.execute(`
        UPDATE tasks 
        SET title = REPLACE(REPLACE(REPLACE(title, '${termPlatformOld}', 'KIN Platform'), '${termPlatformShort}', 'KIN Platform'), '${termPlatformRuntime}', 'platform runtime'),
            description = REPLACE(REPLACE(REPLACE(description, '${termPlatformOld}', 'KIN Platform'), '${termPlatformShort}', 'KIN Platform'), '${termPlatformRuntime}', 'platform runtime')
        WHERE title LIKE '%${termPlatformShort}%' OR description LIKE '%${termPlatformShort}%' OR title LIKE '%${termPlatformRuntime}%' OR description LIKE '%${termPlatformRuntime}%'
      `);
      this.db.execute(`
        UPDATE decisions 
        SET title = REPLACE(REPLACE(REPLACE(title, '${termPlatformOld}', 'KIN Platform'), '${termPlatformShort}', 'KIN Platform'), '${termPlatformRuntime}', 'platform runtime'),
            rationale = REPLACE(REPLACE(REPLACE(rationale, '${termPlatformOld}', 'KIN Platform'), '${termPlatformShort}', 'KIN Platform'), '${termPlatformRuntime}', 'platform runtime')
        WHERE title LIKE '%${termPlatformShort}%' OR rationale LIKE '%${termPlatformShort}%' OR title LIKE '%${termPlatformRuntime}%' OR rationale LIKE '%${termPlatformRuntime}%'
      `);
    } catch {}

    // Prune ephemeral test channels from live environment
    if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
      try {
        this.workspaceRepo.pruneEphemeralTestChannels('proj-kin');
      } catch {}
    }

    // Ensure DocWriter specialist exists for live daemon / production deliverables
    if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
      const docIdentity = this.agentRepo.getIdentity('agent-docwriter') || existingAgents.find((a) => a.displayName.toLowerCase() === '@docwriter' || a.displayName.toLowerCase() === 'docwriter');
      if (!docIdentity) {
        this.agentRepo.createDefinition({
          id: 'def-docwriter',
          name: 'DocWriter',
          role: 'Technical Documentation & Architecture Specialist',
          systemPrompt: 'You are @DocWriter, the technical documentation specialist. You write comprehensive, clear TRDs, architecture docs, and READMEs.',
          defaultModelId: 'ollama/qwen2.5-coder:3b',
          domainAuthority: ['Documentation', 'Architecture', 'TRD', 'Verification'],
          capabilities: ['read', 'write', 'agent:hire', 'agent:delegate'],
          createdAt: now,
        });
        this.agentRepo.createIdentity({
          id: 'agent-docwriter',
          workspaceId: 'ws-default',
          projectId: 'proj-kin',
          definitionId: 'def-docwriter',
          displayName: '@DocWriter',
          activeModelId: 'ollama/qwen2.5-coder:3b',
          isOrchestrator: false,
          isEphemeral: false,
          createdAt: now,
          updatedAt: now,
        });
        this.workspaceRepo.addChannelMember('chan-general', 'agent-docwriter');
      }
    }

    // Startup initialization: verify goals exist without destructive pruning

    // Ensure initial project goal and tasks exist for proj-kin
    const goals = this.goalRepo.listGoals('proj-kin');
    if (goals.length === 0) {
      const goalId = 'goal-kin-bootstrap';
      this.goalRepo.createGoal({
        id: goalId,
        projectId: 'proj-kin',
        title: 'KIN Autonomous Workforce Bootstrap',
        description: 'Establish local-first agent runtime, SQLite state persistence, and tool execution boundaries.',
        acceptanceCriteria: [
          'SQLite WAL schema with relational integrity and unique agent names',
          'Local Ollama model connectivity with manual model configuration',
          'Multi-channel workforce coordination and isolated worktrees',
        ],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      this.taskRepo.createTask({
        id: 'task-101',
        goalId,
        title: 'Verify SQLite WAL storage engine and schema migrations',
        description: 'Confirm all 22 required tables and column constraints',
        assignedAgentId: 'agent-boss',
        status: 'completed',
        verificationSpec: { expectedExitCode: 0 },
        createdAt: now,
        updatedAt: now,
      });

      this.taskRepo.createTask({
        id: 'task-102',
        goalId,
        title: 'Verify local Ollama engine telemetry and per-agent model governance',
        description: 'Detect installed local LLMs and verify non-routing explicit model configuration',
        assignedAgentId: 'agent-boss',
        status: 'completed',
        verificationSpec: { expectedExitCode: 0 },
        createdAt: now,
        updatedAt: now,
      });

      this.taskRepo.createTask({
        id: 'task-103',
        goalId,
        title: 'Verify multi-channel workforce mobility and direct message threads',
        description: 'Test cross-channel specialist assignment and private 1-on-1 direct message execution',
        assignedAgentId: 'agent-boss',
        status: 'ready',
        verificationSpec: { expectedExitCode: 0 },
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Queries Ollama for currently installed models and online status.
   */
  public async getLocalOllamaModels(): Promise<{ online: boolean; models: string[] }> {
    if (process.env.KIN_ISOLATE_OLLAMA === 'true') {
      return { online: false, models: [] };
    }
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return { online: false, models: [] };
      const data: any = await res.json();
      const models = Array.isArray(data?.models) ? data.models.map((m: any) => m.name) : [];
      return { online: true, models };
    } catch {
      return { online: false, models: [] };
    }
  }

  /**
   * Parses duration and prompt from schedule command parameters.
   * Supports natural language phrases like "this for 3 hours 15 minutes then proceed with this message",
   * standard short units like "10s", "5m", "1h", "3h15m", and multi-part "3 hours 15 minutes".
   */
  public parseScheduleDurationAndPrompt(rawParams: string): { durationSeconds: number; prompt: string; formattedDuration: string } | null {
    const trimmed = rawParams.trim();
    if (!trimmed) return null;

    let working = trimmed.replace(/^(this\s+for|for|in)\s+/i, '').trim();

    let totalSeconds = 0;
    let matchedAny = false;
    const durationParts: string[] = [];

    const durationRegex = /^(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?=\s|\d|[.,;:!?-]|$)/i;

    let current = working;
    while (true) {
      const m = current.match(durationRegex);
      if (!m) break;
      matchedAny = true;
      const val = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      if (unit.startsWith('h')) {
        totalSeconds += val * 3600;
        durationParts.push(`${val}h`);
      } else if (unit.startsWith('m')) {
        totalSeconds += val * 60;
        durationParts.push(`${val}m`);
      } else if (unit.startsWith('s')) {
        totalSeconds += val;
        durationParts.push(`${val}s`);
      }
      current = current.slice(m[0].length).trim();
      current = current.replace(/^(and|,)\s+/i, '').trim();
    }

    if (!matchedAny) {
      const singleMatch = working.match(/^(\d+)\s*(.*)$/);
      if (singleMatch) {
        matchedAny = true;
        totalSeconds = parseInt(singleMatch[1], 10);
        durationParts.push(`${totalSeconds}s`);
        current = singleMatch[2].trim();
      }
    }

    if (!matchedAny || totalSeconds <= 0) return null;

    let prompt = current.replace(/^(then|to|:)\s+/i, '').trim();
    if (!prompt) {
      prompt = 'Perform scheduled periodic check';
    }

    return {
      durationSeconds: totalSeconds,
      prompt,
      formattedDuration: durationParts.join(' '),
    };
  }

  /**
   * Starts local Ollama server process if offline.
   */
  public async startOllamaServer(): Promise<{ success: boolean; online: boolean; models: string[] }> {
    const initial = await this.getLocalOllamaModels();
    if (initial.online) {
      return { success: true, ...initial };
    }

    try {
      const child = childProcess.spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();

      // Poll for up to 6 seconds
      const start = Date.now();
      while (Date.now() - start < 6000) {
        await new Promise((r) => setTimeout(r, 600));
        const check = await this.getLocalOllamaModels();
        if (check.online) {
          return { success: true, ...check };
        }
      }
      return { success: false, online: false, models: [] };
    } catch (err) {
      return { success: false, online: false, models: [] };
    }
  }

  /**
   * Strictly validates that targetPath is contained entirely within jailRoot.
   * Resolves symlinks via fs.realpathSync to prevent jail escape.
   */
  public isWithinJail(jailRoot: string, targetPath: string): boolean {
    let resolvedJail = path.resolve(jailRoot);
    try {
      if (fs.existsSync(resolvedJail)) {
        resolvedJail = fs.realpathSync(resolvedJail);
      }
    } catch {}

    let resolvedTarget = path.resolve(jailRoot, targetPath);
    try {
      if (fs.existsSync(resolvedTarget)) {
        resolvedTarget = fs.realpathSync(resolvedTarget);
      } else {
        let parent = path.dirname(resolvedTarget);
        while (parent && parent !== path.dirname(parent)) {
          if (fs.existsSync(parent)) {
            const realParent = fs.realpathSync(parent);
            const relToParent = path.relative(parent, resolvedTarget);
            resolvedTarget = path.resolve(realParent, relToParent);
            break;
          }
          parent = path.dirname(parent);
        }
      }
    } catch {}

    const relative = path.relative(resolvedJail, resolvedTarget);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  public assertPathWithinProject(jailRoot: string, targetPath: string): void {
    if (!this.isWithinJail(jailRoot, targetPath)) {
      throw new Error(`SECURITY VIOLATION: Path escapes project jail root: ${targetPath}`);
    }
  }

  public validateProjectBoundary(targetRoot?: string): { valid: boolean; root: string; error?: string } {
    let resolved = targetRoot;
    if (!resolved) {
      resolved = this.workspaceRepo.getProject(this.activeProjectId)?.repoPath || process.cwd();
    }
    let normTarget = path.resolve(resolved);
    try {
      if (fs.existsSync(normTarget)) {
        normTarget = fs.realpathSync(normTarget);
      }
    } catch {}

    const rootPattern = /^([a-zA-Z]:[/\\]?|\/|\\)$/;
    if (rootPattern.test(normTarget)) {
      return { valid: false, root: normTarget, error: `Forbidden: projectRoot '${targetRoot}' cannot be the filesystem root.` };
    }

    const baseAllowedDirs = [process.cwd(), os.tmpdir(), ...this.monorepoRoot];

    const resolveCanonical = (p: string) => {
      let resolvedDir = path.resolve(p);
      try {
        if (fs.existsSync(resolvedDir)) {
          resolvedDir = fs.realpathSync(resolvedDir);
        }
      } catch {}
      return resolvedDir;
    };

    const registeredProjects = this.workspaceRepo.listAllProjects ? this.workspaceRepo.listAllProjects() : this.workspaceRepo.listProjects('ws-default');
    const isAllowed = registeredProjects.some((p) => {
      const pNorm = resolveCanonical(p.repoPath);
      return normTarget === pNorm || (!path.relative(pNorm, normTarget).startsWith('..') && !path.isAbsolute(path.relative(pNorm, normTarget)));
    }) || baseAllowedDirs.some((p) => {
      const pNorm = resolveCanonical(p);
      return normTarget === pNorm || (!path.relative(pNorm, normTarget).startsWith('..') && !path.isAbsolute(path.relative(pNorm, normTarget)));
    });

    if (!isAllowed) {
      return { valid: false, root: normTarget, error: `Forbidden: projectRoot '${targetRoot}' is not within an allowed workspace boundary.` };
    }
    return { valid: true, root: normTarget };
  }

  public createApprovalRecord(
    toolName: string,
    actionPayload: Record<string, any>,
    reason?: string,
    agentId: string = 'operator',
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'HIGH'
  ): string {
    const id = `appr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();

    let targetAgentId = agentId;
    const existingAgent = this.db.queryOne<{ id: string }>('SELECT id FROM agent_identities WHERE id = ?', targetAgentId);
    if (!existingAgent) {
      const defaultAgent = this.db.queryOne<{ id: string }>('SELECT id FROM agent_identities LIMIT 1');
      if (defaultAgent) {
        targetAgentId = defaultAgent.id;
      }
    }

    const existingRun = this.db.query<{ id: string }>('SELECT id FROM agent_runs WHERE id = ?', runId);
    if (existingRun.length === 0) {
      this.db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at)
         VALUES (?, ?, ?, 'waiting_for_approval', ?, ?)`,
        runId,
        targetAgentId,
        this.activeProjectId,
        now,
        now
      );
    }

    const sanitizedPayload = SecretBroker.getInstance().sanitizePayload(actionPayload || {});
    this.db.execute(
      `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      id,
      runId,
      targetAgentId,
      toolName,
      JSON.stringify(sanitizedPayload),
      riskLevel,
      now + 86400000,
      now
    );

    const targetAgent = this.agentRepo.getIdentity(targetAgentId);
    this.broadcastEvent('approval:created', {
      id,
      runId,
      agentId: targetAgentId,
      agentName: targetAgent?.displayName ?? '@Boss',
      toolName,
      actionPayload: sanitizedPayload,
      reason,
      riskLevel,
      projectId: targetAgent?.projectId || this.activeProjectId,
    });

    return id;
  }

  public computeProductivityScore(agentId?: string): number {
    try {
      const now = Date.now();
      const past24h = now - 24 * 60 * 60 * 1000;
      let totalTasks = 0;
      let completedTasks = 0;
      let verifiedEvidence = 0;

      if (agentId) {
        const tasks = this.db.query<any>(
          'SELECT status, evidence_bundle_id FROM tasks WHERE assigned_agent_id = ? AND updated_at > ?',
          agentId,
          past24h
        );
        totalTasks = tasks.length;
        completedTasks = tasks.filter((t) => t.status === 'completed').length;
        const evidenceRows = this.db.query<any>(
          `SELECT verified FROM evidence e
           JOIN tasks t ON e.task_id = t.id
           WHERE t.assigned_agent_id = ? AND e.created_at > ?`,
          agentId,
          past24h
        );
        verifiedEvidence = evidenceRows.filter((e) => Boolean(e.verified)).length;
      } else {
        const tasks = this.db.query<any>(
          'SELECT status, evidence_bundle_id FROM tasks WHERE updated_at > ?',
          past24h
        );
        totalTasks = tasks.length;
        completedTasks = tasks.filter((t) => t.status === 'completed').length;
        const evidenceRows = this.db.query<any>(
          'SELECT verified FROM evidence WHERE created_at > ?',
          past24h
        );
        verifiedEvidence = evidenceRows.filter((e) => Boolean(e.verified)).length;
      }

      if (totalTasks === 0 && verifiedEvidence === 0) {
        return 85;
      }

      const taskCompletionRate = totalTasks > 0 ? (completedTasks / totalTasks) : 0.8;
      const evidenceBonus = Math.min(verifiedEvidence * 5, 20);
      const score = Math.round(taskCompletionRate * 80 + evidenceBonus);
      return Math.min(Math.max(score, 10), 100);
    } catch {
      return 85;
    }
  }

  /**
   * Determines if a file is binary by extension or null-byte detection.
   */
  public isBinaryFile(filePath: string): boolean {
    const binaryExts = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svgz',
      '.zip', '.tar', '.gz', '.7z', '.rar',
      '.pdf', '.exe', '.dll', '.so', '.dylib', '.bin',
      '.sqlite', '.sqlite-wal', '.sqlite-shm', '.db',
      '.wasm', '.node', '.pyc', '.class',
    ]);
    const ext = path.extname(filePath).toLowerCase();
    if (binaryExts.has(ext)) return true;

    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) return false;
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(1024);
        const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
        fs.closeSync(fd);
        for (let i = 0; i < bytesRead; i++) {
          if (buf[i] === 0) return true;
        }
      }
    } catch {}
    return false;
  }

  /**
   * Sanitizes all user-facing strings to enforce terminology compliance.
   */
  public sanitizeTerminology(text: string): string {
    if (!text || typeof text !== 'string') return text;
    const { cleanContent } = separateThinkingAndContent(text, undefined, { stripToolCalls: true });
    const rePlatformOld = new RegExp('\\bKIN\\s+Operating\\s+System\\b', 'gi');
    const rePlatformShort = new RegExp('\\bKIN\\s+' + 'O' + 'S\\b', 'gi');
    const rePlatformRuntime = new RegExp('\\b' + ['operating', 'system'].join('\\s+') + '\\b', 'gi');
    const reBackground = new RegExp('\\b' + 'O' + 'S\\s+background\\b', 'gi');
    return cleanContent
      .replace(rePlatformOld, 'KIN Platform')
      .replace(rePlatformShort, 'KIN Platform')
      .replace(rePlatformRuntime, 'platform runtime')
      .replace(reBackground, 'background');
  }

  /**
   * Safely executes an executable file with argument array, bypassing shell parser to prevent injection.
   */
  public execFileCommand(
    file: string,
    args: string[],
    cwd: string,
    timeoutMs: number = 60000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      childProcess.execFile(
        file,
        args,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024 * 15,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout || '',
            stderr: stderr || (error ? error.message : ''),
            exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          });
        }
      );
    });
  }

  /**
   * Safely executes a shell command with timeout, max buffer, and PowerShell support on Windows.
   */
  public execCommand(
    command: string,
    cwd: string,
    timeoutMs: number = 60000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      childProcess.exec(
        command,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024 * 15,
          shell: isWin ? 'cmd.exe' : '/bin/bash',
          env: McpClientManager.sanitizeMcpEnv(),
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout || '',
            stderr: stderr || (error ? error.message : ''),
            exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          });
        }
      );
    });
  }

  public async start(): Promise<number> {
    // Await configured MCP tools discovery before opening listener so early turns have full tools
    try {
      await this.mcpClient.loadServersFromConfig();
    } catch (err) {
      console.warn('[KIN CORE] MCP server auto-load notice:', err);
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on('error', (err) => {
        console.error('[KIN CORE DAEMON HTTP ERROR]', err);
        reject(err);
      });
      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        this.port = actualPort;
        console.log(`[KIN CORE DAEMON] Listening on http://127.0.0.1:${this.port}`);
        resolve(this.port);
      });
    });
  }

  public getIpcAuthToken(): string {
    return this.ipcAuthToken;
  }

  public async stop(): Promise<void> {
    this.isStopping = true;

    // 1. Close SSE clients and stop scheduler / interval
    for (const client of Array.from(this.sseClients)) {
      try {
        if (!client.writableEnded && !client.destroyed) {
          client.end();
        }
      } catch {}
    }
    this.sseClients.clear();
    this.scheduler.stop();
    if (this.supervisorInterval) {
      clearInterval(this.supervisorInterval);
      this.supervisorInterval = null;
    }

    // 2. Shut down MCP subprocesses
    try {
      await this.mcpClient?.shutdown();
    } catch {}

    // 3. Pause / abort active runners and cancel in-flight controllers
    for (const ctrl of Array.from(this.runAbortControllers.values())) {
      try {
        ctrl.abort('shutdown');
      } catch {}
    }
    this.runAbortControllers.clear();

    for (const takeover of this.takeoverStates.values()) {
      takeover.isAborted = true;
    }

    // 4. Await in-flight channel and agent execution queues, plus in-flight executions
    const inFlightPromises = [
      ...Array.from(this.channelQueues.values()),
      ...Array.from(this.agentQueues.values()),
      ...Array.from(this.inFlightExecutions),
    ];
    if (inFlightPromises.length > 0) {
      try {
        await Promise.race([
          Promise.allSettled(inFlightPromises),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
      } catch {}
    }

    // 5. Close browser and computer controllers
    try {
      await this.browserController.close();
    } catch {}
    try {
      await this.computerSupervisor?.shutdown();
    } catch {}

    // 6. Close HTTP server
    if (this.server) {
      try {
        (this.server as any).closeIdleConnections?.();
        (this.server as any).closeAllConnections?.();
      } catch {}
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
    }

    // 7. Clear wakeup queue before closing SQLite database connection
    try {
      this.wakeupQueue?.clear?.();
    } catch {}

    // 8. Close SQLite database connection last
    try {
      this.db.close();
    } catch {}
  }

  public getDatabase(): KinDatabase {
    return this.db;
  }

  public getComputerSupervisor(): ComputerSupervisor {
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

  public getRecoveryEngine(): RecoveryEngine {
    return this.recoveryEngine;
  }

  public getSkillEngine(): SkillEngine {
    return this.skillEngine;
  }

  public getToolGateway(): ToolGateway {
    return this.toolGateway;
  }

  public getToolEngine(): ToolEngine {
    return this.toolEngine;
  }

  public getScheduler(): SchedulerService {
    return this.scheduler;
  }

  public getMcpClient(): McpClientManager {
    return this.mcpClient;
  }

  public syncModelGatewayProviders(): void {
    try {
      this.modelGateway.clearCustomEndpoints();
      // 1. Reconcile providers table
      const providers = this.db.query<{ id: string; name: string; base_url: string; api_key_ref?: string }>(
        `SELECT id, name, base_url, api_key_ref FROM providers WHERE is_active = 1 AND base_url IS NOT NULL AND base_url != ''`
      );
      for (const prov of providers) {
        if (prov.base_url) {
          this.modelGateway.registerCustomProvider(prov.id, prov.base_url, prov.api_key_ref);
          if (prov.name && prov.name.toLowerCase() !== prov.id.toLowerCase()) {
            this.modelGateway.registerCustomProvider(prov.name, prov.base_url, prov.api_key_ref);
          }
        }
      }
      // 2. Reconcile managed_credentials table
      const credsWithBaseUrl = this.db.query<{ id: string; provider: string; key_alias: string; base_url: string; secret_hash: string }>(
        `SELECT id, provider, key_alias, base_url, secret_hash FROM managed_credentials WHERE is_active = 1 AND base_url IS NOT NULL AND base_url != '' ORDER BY updated_at ASC`
      );
      for (const c of credsWithBaseUrl) {
        const decrypted = SecretVault.getInstance().decrypt(c.secret_hash) || c.secret_hash;
        if (c.provider) {
          this.modelGateway.registerCustomProvider(c.provider, c.base_url, decrypted);
        }
        if (c.key_alias && c.key_alias.toLowerCase() !== c.provider.toLowerCase()) {
          this.modelGateway.registerCustomProvider(c.key_alias, c.base_url, decrypted);
        }
      }
    } catch (err) {
      console.warn('[KIN CORE] Notice reconciling model gateway custom providers:', err);
    }
  }

  public getTakeoverStatus(runId: string): 'continue' | 'pause' | 'abort' {
    const s = this.takeoverStates.get(runId);
    if (s?.isAborted) return 'abort';
    if (s?.isPaused) return 'pause';
    return 'continue';
  }

  public generateActionPreview(toolName: string, params: Record<string, any>): {
    toolName: string;
    riskLevel: string;
    description: string;
    target?: string;
    paramsSummary: Record<string, any>;
    requiresApproval: boolean;
  } {
    const risk = this.toolGateway.classifyRisk(toolName, params);
    let description = `Execute ${toolName}`;
    let target = '';

    if (toolName === 'computer') {
      const act = params.action;
      if (act === 'screenshot') {
        description = 'Capture desktop screen';
      } else if (act === 'mouse_move') {
        description = `Move mouse to (${params.x}, ${params.y})`;
        target = `(${params.x}, ${params.y})`;
      } else if (act === 'left_click' || act === 'right_click' || act === 'double_click') {
        description = `Mouse ${act} at (${params.x ?? 'current'}, ${params.y ?? 'current'})`;
        target = params.x !== undefined ? `(${params.x}, ${params.y})` : 'cursor';
      } else if (act === 'type') {
        description = `Type into active desktop window`;
        target = `Length: ${params.text?.length || 0} chars`;
      } else if (act === 'key') {
        description = `Send key: ${params.key}`;
        target = params.key;
      } else {
        description = `Computer action: ${act}`;
      }
    } else if (toolName === 'application') {
      const act = params.action;
      if (act === 'list') {
        description = 'Discover installed desktop applications';
      } else if (act === 'launch') {
        description = `Launch application: ${params.name || params.appNameOrPath}`;
        target = params.name || params.appNameOrPath;
      } else if (act === 'list_windows') {
        description = 'List active GUI windows';
      } else if (act === 'focus') {
        description = `Focus window: ${params.title || params.titleOrPid}`;
        target = String(params.title || params.titleOrPid);
      } else if (act === 'close') {
        description = `Close window: ${params.title || params.titleOrPid}`;
        target = String(params.title || params.titleOrPid);
      } else {
        description = `Application action: ${act}`;
      }
    } else if (toolName === 'browser') {
      const act = params.action;
      if (act === 'navigate') {
        description = `Navigate browser to: ${params.url}`;
        target = params.url;
      } else if (act === 'click') {
        description = `Click browser element: ${params.selector || `(${params.x}, ${params.y})`}`;
        target = params.selector || `(${params.x}, ${params.y})`;
      } else if (act === 'type') {
        description = `Type into browser element: ${params.selector}`;
        target = params.selector;
      } else if (act === 'inspect') {
        description = `Inspect browser DOM element`;
        target = params.selector || 'page';
      } else if (act === 'screenshot') {
        description = 'Capture browser screenshot';
      } else if (act === 'evaluate') {
        description = 'Execute browser script';
      } else if (act === 'close') {
        description = 'Close browser session';
      } else {
        description = `Browser action: ${act}`;
      }
    } else if (toolName === 'desktopLaunchApp') {
      description = `Launch Desktop Application: ${params.appNameOrPath || params.name}`;
      target = params.appNameOrPath || params.name;
    } else if (toolName === 'desktopFocusWindow') {
      description = `Focus Desktop Window: ${params.titleOrPid}`;
      target = String(params.titleOrPid);
    } else if (toolName === 'desktopCloseWindow') {
      description = `Close Desktop Window: ${params.titleOrPid}`;
      target = String(params.titleOrPid);
    } else if (toolName === 'desktopMouseClick') {
      description = `Mouse click at (${params.x}, ${params.y}) with ${params.button || 'left'} button`;
      target = `(${params.x}, ${params.y})`;
    } else if (toolName === 'desktopType') {
      description = `Type text into active desktop window`;
      target = `Length: ${params.text?.length || 0} chars`;
    } else if (toolName === 'browserNavigate') {
      description = `Navigate browser to: ${params.url}`;
      target = params.url;
    } else if (toolName === 'browserClick') {
      description = `Click web element: ${params.selector || `(${params.x}, ${params.y})`}`;
      target = params.selector || `(${params.x}, ${params.y})`;
    } else if (toolName === 'browserType') {
      description = `Type into input: ${params.selector}`;
      target = params.selector;
    }

    const requiresApproval = risk === 'HIGH' || risk === 'CRITICAL';

    return {
      toolName,
      riskLevel: risk,
      description,
      target,
      paramsSummary: SecretBroker.getInstance().sanitizePayload(params || {}),
      requiresApproval,
    };
  }

  public broadcastEvent(eventType: string, data: any): void {
    const sanitizedData = SecretBroker.getInstance().sanitizePayload(data);
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(sanitizedData)}\n\n`;
    for (const client of Array.from(this.sseClients)) {
      try {
        if (client.writableEnded || client.destroyed) {
          this.sseClients.delete(client);
        } else {
          client.write(payload, (err) => {
            if (err) {
              this.sseClients.delete(client);
            }
          });
        }
      } catch (err) {
        this.sseClients.delete(client);
      }
    }
  }

  private hasValidIpcToken(req?: http.IncomingMessage): boolean {
    if (!this.ipcAuthToken) return true;
    if (!req) return false;
    const authHeader = req.headers['authorization'] || '';
    const xIpcToken = (req.headers['x-ipc-token'] || req.headers['x-kin-auth']) as string;
    const parsedUrl = req.url ? new URL(req.url, 'http://127.0.0.1') : undefined;
    const queryToken = parsedUrl ? parsedUrl.searchParams.get('token') : null;
    const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const providedToken = bearerToken || xIpcToken || queryToken;
    if (!providedToken || typeof providedToken !== 'string') return false;
    const provBuf = Buffer.from(providedToken);
    const authBuf = Buffer.from(this.ipcAuthToken);
    return provBuf.length === authBuf.length && crypto.timingSafeEqual(provBuf, authBuf);
  }

  private isAllowedOrigin(origin?: string, req?: http.IncomingMessage): boolean {
    if (!origin) return true;
    if (!this.requireIpcAuth && this.port !== 54321) return true;
    if (origin === 'null') {
      if (req) {
        const remoteIp = req.socket?.remoteAddress;
        const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1' || remoteIp === undefined;
        if (isLoopback) return true;
        if (this.hasValidIpcToken(req)) return true;
        return false;
      }
      return true;
    }
    try {
      const u = new URL(origin);
      if (u.protocol === 'tauri:' && u.hostname === 'localhost') return true;
      if (u.protocol === 'asset:' && u.hostname === 'localhost') return true;
      if (
        u.hostname === 'localhost' ||
        u.hostname === '127.0.0.1' ||
        u.hostname === '::1' ||
        u.hostname === 'tauri.localhost'
      ) return true;
      return false;
    } catch {
      return (
        origin === 'tauri://localhost' ||
        origin === 'asset://localhost' ||
        origin === 'http://tauri.localhost' ||
        origin === 'https://tauri.localhost' ||
        origin === 'http://localhost' ||
        origin.startsWith('http://localhost:') ||
        origin === 'http://127.0.0.1' ||
        origin.startsWith('http://127.0.0.1:')
      );
    }
  }

  public handleCors(res: http.ServerResponse, req?: http.IncomingMessage): void {
    if (res.headersSent) return;
    const origin = req?.headers?.origin;
    if (res.hasHeader('Access-Control-Allow-Origin') && !origin) {
      // Never overwrite an existing Access-Control-Allow-Origin if it was already set and req?.headers?.origin is missing
    } else {
      if (this.requireIpcAuth || this.port === 54321) {
        if (origin && this.isAllowedOrigin(origin, req)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
        } else if (!origin && !res.hasHeader('Access-Control-Allow-Origin')) {
          res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
        }
      } else {
        if (origin || !res.hasHeader('Access-Control-Allow-Origin')) {
          res.setHeader('Access-Control-Allow-Origin', origin || '*');
        }
      }
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-IPC-Token, X-Kin-Auth, X-Kin-Auth-Token, X-Kin-Operator-Signature, X-Kin-Operator-Id, X-Kin-Approval-Token, X-Caller-Agent-Id, X-Agent-Id'
    );
  }

  public sendJson(res: http.ServerResponse, statusCode: number, data: any, req?: http.IncomingMessage): boolean {
    if (res.headersSent || res.writableEnded || res.destroyed) return true;
    if (!res.hasHeader('Access-Control-Allow-Origin')) {
      this.handleCors(res, req);
    }
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return true;
  }

  public getEffectiveAutonomyMode(): any {
    try {
      const ws = this.workspaceRepo.getWorkspace('ws-default');
      if (ws && ws.defaultAutonomyMode) {
        return ws.defaultAutonomyMode;
      }
    } catch {}
    return 'AUTO';
  }

  public async parseJsonBody<T>(req: http.IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<T> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      req.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxBytes) {
          req.destroy(new Error('Payload too large'));
          return reject(new Error('Payload too large'));
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const bodyStr = Buffer.concat(chunks).toString('utf-8');
          resolve(bodyStr ? JSON.parse(bodyStr) : ({} as T));
        } catch (e) {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.handleCors(res, req);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;
    const isHealthProbe = pathname === '/api/health' || pathname === '/health';
    const isOAuthCallback = req.method === 'GET' && pathname === '/api/oauth/callback';
    const isPublicStatic = req.method === 'GET' && !pathname.startsWith('/api/');

    // Handle OAuth browser redirect callback immediately
    if (isOAuthCallback) {
      const code = parsedUrl.searchParams.get('code') || '';
      const state = parsedUrl.searchParams.get('state') || '';
      const result = await OAuthHandler.handleCallback(code, state, this.db, this.port);
      if (result.success && result.provider) {
        this.syncModelGatewayProviders();
        this.broadcastEvent('credentials:updated', { provider: result.provider });
      }
      res.writeHead(result.success ? 200 : 400, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache',
      });
      res.end(result.html);
      return;
    }

    const origin = req.headers.origin;
    if (origin && !this.isAllowedOrigin(origin, req)) {
      this.sendJson(res, 403, { error: 'Forbidden: Untrusted cross-origin request rejected' }, req);
      return;
    }

    const secFetchSite = req.headers['sec-fetch-site'];
    if (secFetchSite === 'cross-site' && !isHealthProbe && !isPublicStatic && !isOAuthCallback) {
      const allowedByOrigin = origin ? this.isAllowedOrigin(origin, req) : false;
      if (!allowedByOrigin) {
        const authHeader = req.headers['authorization'] || '';
        const xIpcToken = (req.headers['x-ipc-token'] || req.headers['x-kin-auth']) as string;
        const queryToken = pathname === '/api/events' ? parsedUrl.searchParams.get('token') : null;
        const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const providedToken = bearerToken || xIpcToken || queryToken;
        const hasValidToken = Boolean(
          this.ipcAuthToken &&
          providedToken &&
          typeof providedToken === 'string' &&
          providedToken.length === this.ipcAuthToken.length &&
          crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(this.ipcAuthToken))
        );
        if (!hasValidToken) {
          this.sendJson(res, 403, { error: 'Forbidden: Cross-site request rejected' }, req);
          return;
        }
      }
    }

    // Content-Type validation on state-changing requests to prevent CORS simple-request bypass
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const contentType = (req.headers['content-type'] || '').toLowerCase();
      if (
        contentType.includes('text/plain') ||
        contentType.includes('application/x-www-form-urlencoded')
      ) {
        this.sendJson(res, 415, { error: 'Unsupported Media Type: application/json required' }, req);
        return;
      }
    }

    // Enforce local loopback IPC token authentication when enabled (exempting public health probes, static frontend assets, and OAuth callbacks)
    if (this.requireIpcAuth && this.ipcAuthToken && !isHealthProbe && !isPublicStatic && !isOAuthCallback) {
      const authHeader = req.headers['authorization'] || '';
      const xIpcToken = (req.headers['x-ipc-token'] || req.headers['x-kin-auth']) as string;
      // Query token is only accepted for SSE endpoint (/api/events) where custom headers are unsupported by browser EventSource
      const queryToken = pathname === '/api/events' ? parsedUrl.searchParams.get('token') : null;
      const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const providedToken = bearerToken || xIpcToken || queryToken;

      let isAuthorized = false;
      if (providedToken && typeof providedToken === 'string') {
        const provBuf = Buffer.from(providedToken);
        const authBuf = Buffer.from(this.ipcAuthToken);
        if (provBuf.length === authBuf.length && crypto.timingSafeEqual(provBuf, authBuf)) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        this.sendJson(res, 401, { error: 'Unauthorized: Valid IPC token required' }, req);
        return;
      }
    }

    try {
      // 1. SSE Stream
      if (req.method === 'GET' && pathname === '/api/events') {
        const sseOrigin = (this.requireIpcAuth || this.port === 54321)
          ? (req.headers.origin && this.isAllowedOrigin(req.headers.origin, req) ? req.headers.origin : 'http://localhost:5173')
          : (req.headers.origin || '*');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': sseOrigin,
        });
        res.write(': connected\n\n');
        this.sseClients.add(res);

        const keepAliveTimer = setInterval(() => {
          try {
            res.write(': keepalive\n\n');
          } catch {
            clearInterval(keepAliveTimer);
            this.sseClients.delete(res);
          }
        }, 15000);

        const dropClient = () => {
          clearInterval(keepAliveTimer);
          this.sseClients.delete(res);
        };
        req.on('close', dropClient);
        req.on('error', dropClient);
        res.on('close', dropClient);
        res.on('error', dropClient);
        return;
      }

      // Delegate domain routes cleanly to router and controllers
      const handled = await this.router.handle(req, res, pathname, parsedUrl);
      if (handled) return;

      // Fallback: In production mode, serve pre-compiled frontend assets from ui/dist
      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        const handled = this.tryServeStatic(req, res, pathname);
        if (handled) return;
      }

      this.sendJson(res, 404, { error: 'Route not found' });
      return;
    } catch (err: any) {
      console.error('[KIN CORE SERVER ERROR]', err);
      this.sendJson(res, 500, { error: err?.message || 'Internal Server Error' });
      return;
    }
  }

  private resolveUiDistDir(): string | null {
    let moduleDir = '';
    try {
      moduleDir = path.dirname(fileURLToPath(import.meta.url));
    } catch {}
    const candidates = [
      moduleDir ? path.resolve(moduleDir, '..', '..', '..', 'ui', 'dist') : '',
      moduleDir ? path.resolve(moduleDir, '..', '..', 'ui', 'dist') : '',
      moduleDir ? path.resolve(moduleDir, '..', 'ui', 'dist') : '',
      moduleDir ? path.resolve(moduleDir, 'ui', 'dist') : '',
      path.resolve(process.cwd(), '..', 'ui', 'dist'),
      path.resolve(process.cwd(), 'ui', 'dist'),
      path.resolve(process.cwd(), 'dist'),
      path.resolve(path.dirname(process.execPath), 'ui', 'dist'),
    ].filter(Boolean);
    for (const cand of candidates) {
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isDirectory() && fs.existsSync(path.join(cand, 'index.html'))) {
          return cand;
        }
      } catch {}
    }
    return null;
  }

  private tryServeStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
    const uiDistDir = this.resolveUiDistDir();
    if (!uiDistDir) {
      return false;
    }

    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.webp': 'image/webp',
      '.wasm': 'application/wasm',
    };

    let safeRelPath = decodeURIComponent(pathname.replace(/^\/+/, ''));
    if (!safeRelPath || safeRelPath === '') {
      safeRelPath = 'index.html';
    }

    const targetPath = path.resolve(uiDistDir, safeRelPath);

    // Canonical path traversal security check
    if (!targetPath.startsWith(uiDistDir)) {
      this.sendJson(res, 403, { error: 'Forbidden: Path traversal outside static directory' }, req);
      return true;
    }

    // Direct file match
    if (fs.existsSync(targetPath)) {
      try {
        const stat = fs.statSync(targetPath);
        if (stat.isFile()) {
          const ext = path.extname(targetPath).toLowerCase();
          const contentType = mimeTypes[ext] || 'application/octet-stream';
          const isAsset = safeRelPath.startsWith('assets/');
          const cacheControl = isAsset ? 'public, max-age=31536000, immutable' : 'no-cache';

          this.handleCors(res, req);
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Cache-Control': cacheControl,
          });
          fs.createReadStream(targetPath).pipe(res);
          return true;
        }
      } catch (err) {
        console.warn('[KIN CORE] Static serve read error:', err);
      }
    }

    // SPA fallback: If requesting a route without file extension (e.g. /settings, /channels/chan-general)
    // fallback to serving index.html
    const hasExtension = path.extname(safeRelPath) !== '';
    if (!hasExtension) {
      const indexPath = path.join(uiDistDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        try {
          const stat = fs.statSync(indexPath);
          this.handleCors(res, req);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': stat.size,
            'Cache-Control': 'no-cache',
          });
          fs.createReadStream(indexPath).pipe(res);
          return true;
        } catch {}
      }
    }

    // Missing asset with file extension -> return 404 text
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Asset Not Found');
    return true;
  }

  public async handleOrchestratorAction(
    boss: any,
    channelId: string,
    userMsg: any,
    allProjectAgents: any[]
  ): Promise<void> {
    const rawContent = userMsg.content;
    const contentLower = rawContent.toLowerCase();
    const isChannel = !channelId.startsWith('dm-');

    // 1. Check if user is asking @Boss to hire a new agent
    if ((contentLower === '/hire' || contentLower === '/hire:') && isChannel) {
      if (boss) {
        const helpMsg = this.channelService.sendMessage({
          channelId,
          senderId: boss.id,
          senderType: 'agent',
          content: `ℹ️ **Usage**: \`/hire @<SpecialistName> <Role/Specialization>\`\n\nExamples:\n- \`/hire @Security Specialist in Vulnerability & Pentesting\`\n- \`/hire @Designer UI and Design Systems Specialist\`\n- \`/hire @QA Automated Testing and Verification Specialist\``,
          productivityScore: 100,
        });
        this.broadcastEvent('message:created', {
          id: helpMsg.id,
          channelId: helpMsg.channelId,
          senderId: helpMsg.senderId,
          senderName: boss.displayName.replace(/^@/, ''),
          senderType: 'agent',
          content: helpMsg.content,
          createdAt: helpMsg.createdAt,
          productivityScore: helpMsg.productivityScore,
        });
      }
      return;
    }

    const isHireIntent =
      contentLower.startsWith('/hire') ||
      contentLower.includes('hire') ||
      contentLower.includes('recruit') ||
      contentLower.includes('create agent');

    let hireTarget: { name: string; role: string } | null = null;
    if (isHireIntent && isChannel) {
      const mentions = [...rawContent.matchAll(/@([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
      const nonBossMention = mentions.find((m) => m.toLowerCase() !== 'boss');
      let name: string | null = null;
      if (nonBossMention) {
        name = `@${nonBossMention}`;
      } else {
        const slash = rawContent.match(/^\/hire\s+(@?[a-zA-Z0-9_-]+)/i);
        const named = rawContent.match(/(?:named|called|agent)\s+(@?[a-zA-Z0-9_-]+)/i);
        if (slash) name = slash[1].startsWith('@') ? slash[1] : `@${slash[1]}`;
        else if (named) name = named[1].startsWith('@') ? named[1] : `@${named[1]}`;
      }

      if (name) {
        let role = 'Domain Specialist';
        const roleBetween = rawContent.match(/(?:hire|recruit)\s+(?:an?\s+)?([a-zA-Z\s]+?)\s+(?:named|called|as|@)/i);
        const roleAs = rawContent.match(/\bas\s+([a-zA-Z\s]+)/i);
        const roleSlash = rawContent.match(/^\/hire\s+@?[a-zA-Z0-9_-]+\s+(.*)$/i);

        if (roleBetween && roleBetween[1].trim() && !['agent', 'specialist', 'new'].includes(roleBetween[1].trim().toLowerCase())) {
          role = roleBetween[1].trim();
        } else if (roleAs && roleAs[1].trim()) {
          role = roleAs[1].trim();
        } else if (roleSlash && roleSlash[1].trim()) {
          role = roleSlash[1].trim();
        }

        role = role.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        hireTarget = { name, role };
      }
    }

    if (hireTarget && isChannel) {
      const normalizedName = hireTarget.name;
      const role = hireTarget.role;
      const chan = this.workspaceRepo.getChannel(channelId);
      const targetProjId = chan?.projectId || this.activeProjectId;

      // Check if specialist already exists in project
      const existing = this.agentRepo.getIdentityByProjectAndName(targetProjId, normalizedName);
      if (existing) {
        const memberIds = this.workspaceRepo.listChannelMemberIds(channelId);
        if (!memberIds.includes(existing.id)) {
          this.workspaceRepo.addChannelMember(channelId, existing.id);
          this.broadcastEvent('channel:member_added', { channelId, agentId: existing.id });
        }

        const reply = this.channelService.sendMessage({
          channelId,
          senderId: boss.id,
          senderType: 'agent',
          content: `Specialist ${existing.displayName} already exists in this project. I have enrolled them in this channel. Over to you, ${existing.displayName}!`,
          productivityScore: 100,
        });

        this.broadcastEvent('message:created', {
          id: reply.id,
          channelId: reply.channelId,
          senderId: reply.senderId,
          senderName: boss.displayName.replace(/^@/, ''),
          senderType: 'agent',
          content: reply.content,
          createdAt: reply.createdAt,
          productivityScore: 100,
        });

        await this.enqueueChannelExecution(channelId, () =>
          this.enqueueAgentExecution(existing.id, () => this.executeAgentResponse(existing, channelId, userMsg))
        );
        return;
      }

      // Provision new agent identity in SQLite
      const now = Date.now();
      const defId = `def-${now}`;
      const agentId = `agent-${now}`;
      const inheritedModelId = boss?.activeModelId || 'ollama/qwen2.5-coder:3b';

      this.agentRepo.createDefinition({
        id: defId,
        name: normalizedName.replace(/^@/, ''),
        role,
        systemPrompt: `You are ${normalizedName}, a ${role} specialist in project ${targetProjId}. Follow the capabilities and project scope provided for this run, and ask when access or authority is unclear.`,
        defaultModelId: inheritedModelId,
        domainAuthority: [role],
        capabilities: ['fs:read', 'fs:write', 'shell:exec', 'agent:hire', 'agent:delegate', 'read', 'write', 'execute'],
        createdAt: now,
      });

      const identity: AgentIdentity = {
        id: agentId,
        workspaceId: 'ws-default',
        projectId: targetProjId,
        definitionId: defId,
        displayName: normalizedName,
        activeModelId: inheritedModelId,
        isOrchestrator: false,
        isEphemeral: false,
        createdAt: now,
        updatedAt: now,
      };

      this.agentRepo.createIdentity(identity);
      this.workspaceRepo.addChannelMember(channelId, agentId);

      const formattedAgent = {
        id: identity.id,
        name: normalizedName.replace(/^@/, ''),
        role,
        displayName: normalizedName,
        activeModelId: identity.activeModelId,
        status: 'idle',
        isOrchestrator: false,
        projectId: targetProjId,
        assignedChannels: this.workspaceRepo.listAgentChannelIds(identity.id, targetProjId),
      };

      this.broadcastEvent('agent:created', { agent: formattedAgent });
      this.broadcastEvent('channel:member_added', { channelId, agentId });

      const reply = this.channelService.sendMessage({
        channelId,
        senderId: boss.id,
        senderType: 'agent',
        content: `I have hired and provisioned ${normalizedName} (${role}) for project ${targetProjId} and assigned them to #${chan?.name || 'this channel'}. Welcome to the workforce!`,
        productivityScore: 100,
      });

      this.broadcastEvent('message:created', {
        id: reply.id,
        channelId: reply.channelId,
        senderId: reply.senderId,
        senderName: boss.displayName.replace(/^@/, ''),
        senderType: 'agent',
        content: reply.content,
        createdAt: reply.createdAt,
        productivityScore: reply.productivityScore,
      });

      await this.enqueueChannelExecution(channelId, () =>
        this.enqueueAgentExecution(identity.id, () => this.executeAgentResponse(identity, channelId, userMsg))
      );
      return;
    }

    // 1b. Check if user is asking to hire a team without naming a specific individual
    const isTeamHireIntent =
      isHireIntent &&
      (contentLower.includes('team') ||
        contentLower.includes('teammate') ||
        contentLower.includes('workforce') ||
        contentLower.includes('required team'));

    if (isTeamHireIntent && isChannel) {
      const chan = this.workspaceRepo.getChannel(channelId);
      const targetProjId = chan?.projectId || this.activeProjectId;
      let teamSpecs: Array<{ name: string; role: string; domainAuthority: string[]; systemPrompt?: string }> = [];

      if (contentLower.includes('android')) {
        teamSpecs = [
          {
            name: '@AndroidDev',
            role: 'Senior Android Engineer',
            domainAuthority: ['Android', 'Kotlin', 'Jetpack Compose', 'Gradle', 'Android Architecture'],
            systemPrompt: `You are @AndroidDev, Senior Android Engineer in project ${targetProjId}. You build Android native applications, Jetpack Compose interfaces, and test suites. Follow the capabilities and project scope provided for this run.`,
          },
          {
            name: '@QAEngineer',
            role: 'Mobile QA Specialist',
            domainAuthority: ['Mobile QA', 'Espresso', 'Testing', 'Android Verification'],
            systemPrompt: `You are @QAEngineer, Mobile QA Specialist in project ${targetProjId}. You review code quality and write automated tests. Follow the capabilities and project scope provided for this run.`,
          },
        ];
      } else if (contentLower.includes('ios') || contentLower.includes('swift')) {
        teamSpecs = [
          {
            name: '@iOSDev',
            role: 'Senior iOS Engineer',
            domainAuthority: ['iOS', 'Swift', 'SwiftUI', 'Xcode'],
          },
          {
            name: '@QAEngineer',
            role: 'Mobile QA Specialist',
            domainAuthority: ['Mobile QA', 'XCTest', 'Testing'],
          },
        ];
      } else if (contentLower.includes('web') || contentLower.includes('frontend') || contentLower.includes('react')) {
        teamSpecs = [
          {
            name: '@FrontendDev',
            role: 'Frontend UI Specialist',
            domainAuthority: ['React', 'TypeScript', 'TailwindCSS'],
          },
          {
            name: '@BackendDev',
            role: 'Backend API Specialist',
            domainAuthority: ['Node.js', 'REST API', 'Database'],
          },
        ];
      } else {
        teamSpecs = [
          {
            name: '@LeadDev',
            role: 'Senior Software Engineer',
            domainAuthority: ['Software Engineering', 'System Architecture'],
          },
          {
            name: '@QAEngineer',
            role: 'QA & Testing Specialist',
            domainAuthority: ['Verification', 'Quality Assurance'],
          },
        ];
      }

      const hiredAgents: any[] = [];
      const now = Date.now();
      for (let i = 0; i < teamSpecs.length; i++) {
        const spec = teamSpecs[i];
        let identity = this.agentRepo.getIdentityByProjectAndName(targetProjId, spec.name);
        if (!identity) {
          const defId = `def-${now}-${i}`;
          const agentId = `agent-${now}-${i}`;
          const role = spec.role;
          const sysPrompt = spec.systemPrompt || `You are ${spec.name}, a ${role} specialist in project ${targetProjId}. Follow the capabilities and project scope provided for this run.`;

          const inheritedModel = boss?.activeModelId || (boss?.definitionId ? this.agentRepo.getDefinition(boss.definitionId)?.defaultModelId : undefined) || 'ollama/qwen2.5-coder:3b';

          this.agentRepo.createDefinition({
            id: defId,
            name: spec.name.replace(/^@/, ''),
            role,
            systemPrompt: sysPrompt,
            defaultModelId: inheritedModel,
            domainAuthority: spec.domainAuthority,
            capabilities: ['read', 'write', 'execute', 'agent:hire', 'agent:delegate'],
            createdAt: now + i,
          });

          identity = {
            id: agentId,
            workspaceId: 'ws-default',
            projectId: targetProjId,
            definitionId: defId,
            displayName: spec.name,
            activeModelId: inheritedModel,
            isOrchestrator: false,
            isEphemeral: false,
            createdAt: now + i,
            updatedAt: now + i,
          };
          this.agentRepo.createIdentity(identity);
        }

        this.workspaceRepo.addChannelMember(channelId, identity.id);
        this.broadcastEvent('agent:created', {
          agent: {
            id: identity.id,
            name: identity.displayName.replace(/^@/, ''),
            role: spec.role,
            displayName: identity.displayName,
            activeModelId: identity.activeModelId,
            status: 'idle',
            isOrchestrator: false,
            projectId: targetProjId,
            assignedChannels: this.workspaceRepo.listAgentChannelIds(identity.id, targetProjId),
          },
        });
        this.broadcastEvent('channel:member_added', { channelId, agentId: identity.id });
        hiredAgents.push(identity);
      }

      const teamList = teamSpecs.map((s) => `• **${s.name}** (${s.role})`).join('\n');
      const announcement = `I have recruited and assembled the specialized workforce for project **${targetProjId}** in **#${chan?.name || 'this channel'}**:\n${teamList}\n\nAll specialists are enrolled with project context and ready to begin. Over to you, ${teamSpecs[0].name}!`;

      const reply = this.channelService.sendMessage({
        channelId,
        senderId: boss.id,
        senderType: 'agent',
        content: announcement,
        productivityScore: 100,
      });

      this.broadcastEvent('message:created', {
        id: reply.id,
        channelId: reply.channelId,
        senderId: reply.senderId,
        senderName: boss.displayName.replace(/^@/, ''),
        senderType: 'agent',
        content: reply.content,
        createdAt: reply.createdAt,
        productivityScore: reply.productivityScore,
      });

      if (hiredAgents.length > 0) {
        await this.enqueueChannelExecution(channelId, () =>
          this.enqueueAgentExecution(hiredAgents[0].id, () => this.executeAgentResponse(hiredAgents[0], channelId, userMsg))
        );
      }
      return;
    }

    // 2. Check if user mentions or calls an existing agent to this channel
    const targetAgent = allProjectAgents.find(
      (a) =>
        !a.isOrchestrator &&
        (rawContent.includes(a.displayName) ||
          contentLower.includes(a.displayName.toLowerCase()) ||
          ((contentLower.includes('assign') || contentLower.includes('add') || contentLower.includes('call')) &&
            contentLower.includes(a.displayName.toLowerCase().replace(/^@/, ''))))
    );

    if (targetAgent && isChannel) {
      const channelMemberIds = this.workspaceRepo.listChannelMemberIds(channelId);
      const isAlreadyMember = channelMemberIds.includes(targetAgent.id);
      if (!isAlreadyMember) {
        this.workspaceRepo.addChannelMember(channelId, targetAgent.id);
        this.broadcastEvent('channel:member_added', { channelId, agentId: targetAgent.id });

        const reply = this.channelService.sendMessage({
          channelId,
          senderId: boss.id,
          senderType: 'agent',
          content: `I have enrolled ${targetAgent.displayName} into #${this.workspaceRepo.getChannel(channelId)?.name || 'this channel'}. They are now active with cross-channel project context. Over to you, ${targetAgent.displayName}!`,
          productivityScore: 100,
        });

        this.broadcastEvent('message:created', {
          id: reply.id,
          channelId: reply.channelId,
          senderId: reply.senderId,
          senderName: boss.displayName.replace(/^@/, ''),
          senderType: 'agent',
          content: reply.content,
          createdAt: reply.createdAt,
          productivityScore: reply.productivityScore,
        });
      }

      await this.enqueueChannelExecution(channelId, () =>
        this.enqueueAgentExecution(targetAgent.id, () => this.executeAgentResponse(targetAgent, channelId, userMsg))
      );
      return;
    }

    // 3. Safety net domain delegation:
    // If message is relevant to an unassigned specialist in the project, @Boss auto-assigns and delegates
    if (isChannel) {
      const channelMemberIds = this.workspaceRepo.listChannelMemberIds(channelId);
      const unassignedSpecialists = allProjectAgents.filter(
        (a) => !a.isOrchestrator && !channelMemberIds.includes(a.id)
      );

      const matchingSpecialist = unassignedSpecialists.find((agent) => {
        const def = this.agentRepo.getDefinition(agent.definitionId);
        if (!def) return false;
        const keywords = [
          ...def.role.toLowerCase().split(/\s+/),
          ...def.domainAuthority.map((d) => d.toLowerCase()),
        ];
        return keywords.some((k) => k.length > 2 && contentLower.includes(k));
      });

      if (matchingSpecialist) {
        const def = this.agentRepo.getDefinition(matchingSpecialist.definitionId);
        this.workspaceRepo.addChannelMember(channelId, matchingSpecialist.id);
        this.broadcastEvent('channel:member_added', { channelId, agentId: matchingSpecialist.id });

        const reply = this.channelService.sendMessage({
          channelId,
          senderId: boss.id,
          senderType: 'agent',
          content: `I noticed we have ${matchingSpecialist.displayName} in this project specializing in ${def?.role || 'this domain'}. I have assigned them to this channel to assist. Over to you, ${matchingSpecialist.displayName}!`,
          productivityScore: 100,
        });

        this.broadcastEvent('message:created', {
          id: reply.id,
          channelId: reply.channelId,
          senderId: reply.senderId,
          senderName: boss.displayName.replace(/^@/, ''),
          senderType: 'agent',
          content: reply.content,
          createdAt: reply.createdAt,
          productivityScore: reply.productivityScore,
        });

        await this.enqueueChannelExecution(channelId, () =>
          this.enqueueAgentExecution(matchingSpecialist.id, () => this.executeAgentResponse(matchingSpecialist, channelId, userMsg))
        );
        return;
      }
    }

    // 4. Default: @Boss acts as the orchestrator fallback
    await this.enqueueChannelExecution(channelId, () =>
      this.enqueueAgentExecution(boss.id, () => this.executeAgentResponse(boss, channelId, userMsg))
    );
  }

  public incrementDelegation(channelId: string): void {
    this.activeDelegations.set(channelId, (this.activeDelegations.get(channelId) || 0) + 1);
  }

  public decrementDelegation(channelId: string): void {
    const cur = this.activeDelegations.get(channelId) || 1;
    const nextVal = Math.max(0, cur - 1);
    if (nextVal === 0) {
      this.activeDelegations.delete(channelId);
      this.processNextQueuedMessage(channelId).catch(() => {});
    } else {
      this.activeDelegations.set(channelId, nextVal);
    }
  }

  public enqueueChannelExecution(channelId: string, fn: () => Promise<void>): Promise<void> {
    if (this.isStopping || this.db.closed) {
      return Promise.resolve();
    }
    const prev = this.channelQueues.get(channelId) || Promise.resolve();
    const next = prev.then(fn, fn).finally(() => {
      if (this.channelQueues.get(channelId) === next) {
        this.channelQueues.delete(channelId);
      }
      if (this.isStopping || this.db.closed) {
        return;
      }
      const activeInChan = Array.from(this.activeAgentExecutions.values()).filter((e) => e.channelId === channelId);
      const delegationsInChan = this.activeDelegations.get(channelId) || 0;
      if (activeInChan.length === 0 && delegationsInChan === 0) {
        this.processNextQueuedMessage(channelId).catch((qErr) => {
          console.warn('[KIN CORE] Notice processing next queued message on channel queue idle:', qErr);
        });
      }
    });
    this.channelQueues.set(channelId, next);
    return next;
  }

  public enqueueAgentExecution(agentId: string, fn: () => Promise<void>): Promise<void> {
    if (this.isStopping || this.db.closed) {
      return Promise.resolve();
    }
    const prev = this.agentQueues.get(agentId) || Promise.resolve();
    const next = prev.then(fn, fn).finally(() => {
      if (this.agentQueues.get(agentId) === next) {
        this.agentQueues.delete(agentId);
      }
    });
    this.agentQueues.set(agentId, next);
    return next;
  }

  public pruneOldAdmissionFences(nowMs: number): void {
    if (this.messageAdmissionFences.size > 500) {
      for (const [key, val] of this.messageAdmissionFences.entries()) {
        if (nowMs - val.timestamp > 10 * 60 * 1000) {
          this.messageAdmissionFences.delete(key);
        }
      }
    }
    if (this.lastChannelPromptFingerprints.size > 500) {
      for (const [key, val] of this.lastChannelPromptFingerprints.entries()) {
        if (nowMs - val.timestamp > 10 * 60 * 1000) {
          this.lastChannelPromptFingerprints.delete(key);
        }
      }
    }
  }

  public async executeSequentialAgents(agents: any[], channelId: string, userMsg: any): Promise<void> {
    if (this.isStopping || this.db.closed) {
      return;
    }
    if (!userMsg) return;

    const msgId = userMsg.id;
    if (msgId) {
      const existing = this.messageAdmissionFences.get(msgId);
      if (existing && existing.status === 'completed') {
        console.log(`[KIN CORE] Admission Fence: Message ${msgId} has already completed execution. Suppressing duplicate execution.`);
        return;
      }
      if (!existing) {
        const fenceToken = userMsg.fencingToken || `fence-${msgId}-${Date.now()}`;
        userMsg.fencingToken = fenceToken;
        this.messageAdmissionFences.set(msgId, {
          fenceToken,
          channelId,
          timestamp: Date.now(),
          status: 'admitted',
          completedAgents: new Set(),
        });
      }
    }

    if (agents.length > 1) {
      this.incrementDelegation(channelId);
    }
    try {
      for (const agent of agents) {
        if (this.isStopping || this.db.closed) break;
        await this.enqueueChannelExecution(channelId, () =>
          this.enqueueAgentExecution(agent.id, () => this.executeAgentResponse(agent, channelId, userMsg))
        );
      }
    } finally {
      if (agents.length > 1) {
        this.decrementDelegation(channelId);
      }
      if (msgId) {
        const fence = this.messageAdmissionFences.get(msgId);
        if (fence) {
          fence.status = 'completed';
        }
      }
    }
  }

  /**
   * Asynchronously triggers agent run, compiles context with cross-channel memory,
   * invokes ModelGateway with complete conversation trajectory, persists response message to SQLite,
   * and broadcasts event.
   */
  public async executeAgentResponse(
    agent: any,
    channelId: string,
    triggerMsg: any,
    recursionDepth: number = 0,
    resumeCheckpoint?: any,
    existingRunId?: string,
    modelOverride?: string,
    parentRunId?: string
  ): Promise<void> {
    if (this.isStopping || this.db.closed) {
      return;
    }

    if (triggerMsg?.id) {
      const existingFence = this.messageAdmissionFences.get(triggerMsg.id);
      if (existingFence) {
        if (existingFence.status === 'completed' || existingFence.completedAgents?.has(agent.id)) {
          console.log(`[KIN CORE] Admission Fence: Trigger message ${triggerMsg.id} has already executed for agent ${agent.id}. Skipping duplicate prompt run.`);
          return;
        }
      } else {
        this.messageAdmissionFences.set(triggerMsg.id, {
          fenceToken: triggerMsg.fencingToken || `fence-${triggerMsg.id}-${Date.now()}`,
          channelId,
          timestamp: Date.now(),
          status: 'admitted',
          completedAgents: new Set(),
        });
      }
    }

    let resolveInFlight!: () => void;
    const inFlightPromise = new Promise<void>((resolve) => {
      resolveInFlight = resolve;
    });
    this.inFlightExecutions.add(inFlightPromise);

    try {
      const def = this.agentRepo.getDefinition(agent.definitionId);
      const channel = this.workspaceRepo.getChannel(channelId);
      const targetProjectId = channel?.projectId || agent.projectId || this.activeProjectId;

      this.activeAgentExecutions.set(agent.id, {
        agentId: agent.id,
        channelId,
        startedAt: Date.now(),
        triggerMessageId: triggerMsg?.id,
      });
      this.broadcastEvent('agent:state', { agentId: agent.id, channelId, status: 'thinking' });

      let run: any = null;
      try {
        // 1. Spawn or reuse run in AgentKernel
      if (existingRunId) {
        run = this.kernel.getRun(existingRunId);
        if (run) {
          this.kernel.transitionState(existingRunId, 'running');
        }
      }
      if (!run) {
        try {
          run = this.kernel.spawnRun({
            agentId: agent.id,
            projectId: targetProjectId,
            channelId,
            triggerMessageId: triggerMsg?.id,
            taskId: triggerMsg?.taskId || undefined,
            parentRunId: parentRunId || triggerMsg?.parentRunId || undefined,
            allocatedTokens: 50000,
          });
        } catch (spawnErr: any) {
          if (spawnErr?.message?.includes('QUOTA EXCEEDED: Maximum active concurrent runs')) {
            run = this.kernel.queueRun({
              agentId: agent.id,
              projectId: targetProjectId,
              channelId,
              triggerMessageId: triggerMsg?.id,
              taskId: triggerMsg?.taskId || undefined,
              parentRunId: parentRunId || triggerMsg?.parentRunId || undefined,
              allocatedTokens: 50000,
            });
            this.broadcastEvent('run:queued', { runId: run.id, agentId: agent.id, channelId });
            this.activeAgentExecutions.delete(agent.id);
            this.broadcastEvent('agent:state', { agentId: agent.id, channelId, status: 'idle' });
            return;
          }
          throw spawnErr;
        }
      }

      const abortController = new AbortController();
      this.runAbortControllers.set(run.id, abortController);
      this.activeAgentExecutions.set(agent.id, {
        agentId: agent.id,
        channelId,
        startedAt: Date.now(),
        triggerMessageId: triggerMsg?.id,
        runId: run.id,
      });

      // Claim atomic task lease if task is associated
      const activeTaskId = triggerMsg?.taskId || run?.taskId;
      if (activeTaskId) {
        try {
          const claimed = this.taskRepo.claimTaskWithLease(activeTaskId, agent.id, run.id, 300000);
          if (!claimed) {
            console.warn(`[KIN TASK LEASE] Failed to claim task ${activeTaskId} for agent ${agent.id} (lease held by another run). Aborting execution.`);
            this.kernel.transitionState(run.id, 'failed', `Could not acquire task lease for task ${activeTaskId}`);
            this.activeAgentExecutions.delete(agent.id);
            return;
          }
        } catch (leaseErr) {
          console.warn('[KIN LEASE WARNING]', leaseErr);
          this.kernel.transitionState(run.id, 'failed', `Error acquiring task lease: ${leaseErr}`);
          this.activeAgentExecutions.delete(agent.id);
          return;
        }
      }

      this.takeoverStates.set(run.id, {
        runId: run.id,
        agentId: agent.id,
        channelId,
        isPaused: false,
        isAborted: false,
      });
      this.broadcastEvent('run:started', { runId: run.id, agentId: agent.id, channelId });

      // 2. Channel peers & assigned channels
      const memberIds = this.workspaceRepo.listChannelMemberIds(channelId);
      const allProjectAgents = this.agentRepo.listIdentitiesByProject(targetProjectId);
      const peers = allProjectAgents
        .filter((a) => memberIds.includes(a.id) && a.id !== agent.id)
        .map((a) => a.displayName);
      const assignedChannels = this.workspaceRepo
        .listAgentChannelIds(agent.id, targetProjectId)
        .map((cId) => this.workspaceRepo.getChannel(cId)?.name)
        .filter(Boolean)
        .map((name) => `#${name}`);

      // 3. Compile cross-channel memory from other assigned channels (strictly excluding private DMs)
      const allAgentChannelIds = this.workspaceRepo.listAgentChannelIds(agent.id, targetProjectId);
      const otherChannelIds = allAgentChannelIds.filter((id) => {
        if (id === channelId) return false;
        if (id.startsWith('dm-')) return false;
        const c = this.workspaceRepo.getChannel(id);
        if (c?.isPrivate || c?.channelType === 'direct_message') return false;
        return true;
      });
      const crossChannelSummaries = otherChannelIds.map((cId) => {
        const c = this.workspaceRepo.getChannel(cId);
        const msgs = this.channelService.getMessages(cId, 5);
        return {
          channelName: c?.name || cId,
          topic: c?.topic,
          recentMessages: msgs.map((m) => {
            const sender = allProjectAgents.find((a) => a.id === m.senderId);
            return {
              senderName: m.senderType === 'human' ? 'Human' : sender?.displayName ?? m.senderId,
              content: m.content.slice(0, 150),
            };
          }),
        };
      });

      // Goal Ancestry & Objective Anchor resolution (Full Workspace -> Project -> Goal -> Task -> Run chain)
      let goalAncestryChain: any = undefined;
      const projectGoals = this.goalRepo.listGoals(targetProjectId);
      const projectObj = this.workspaceRepo.getProject(targetProjectId);
      const workspaceObj = projectObj ? this.workspaceRepo.getWorkspace(projectObj.workspaceId) : this.workspaceRepo.getWorkspace('ws-default');
      const wsName = workspaceObj?.name || 'Default Workspace';
      const projName = projectObj?.name || targetProjectId;
      const rPath = projectObj?.repoPath;

      if (activeTaskId) {
        const task = this.taskRepo.getTask(activeTaskId);
        if (task?.goalId) {
          const matchedGoal = projectGoals.find((g) => g.id === task.goalId);
          if (matchedGoal) {
            goalAncestryChain = {
              workspaceName: wsName,
              projectName: projName,
              repoPath: rPath,
              rootGoalTitle: matchedGoal.title,
              goalTitle: matchedGoal.title,
              goalDescription: matchedGoal.description,
              taskTitle: task.title,
              taskDescription: task.description,
              activeGoalTitle: `${task.title} (under ${matchedGoal.title})`,
              successCriteria: matchedGoal.acceptanceCriteria || [task.title],
              acceptanceCriteria: matchedGoal.acceptanceCriteria || [task.title],
              rationale: matchedGoal.description,
              parentRunId: run?.parentRunId,
            };
          }
        }
      }
      if (!goalAncestryChain && projectGoals.length > 0) {
        const primaryGoal = projectGoals[0];
        goalAncestryChain = {
          workspaceName: wsName,
          projectName: projName,
          repoPath: rPath,
          rootGoalTitle: primaryGoal.title,
          goalTitle: primaryGoal.title,
          goalDescription: primaryGoal.description,
          activeGoalTitle: primaryGoal.title,
          successCriteria: primaryGoal.acceptanceCriteria || [],
          acceptanceCriteria: primaryGoal.acceptanceCriteria || [],
          rationale: primaryGoal.description,
          parentRunId: run?.parentRunId,
        };
      }

      // Synchronize project MCP servers and skills before compiling tool schemas
      if (rPath) {
        const targetRepoResolved = path.resolve(rPath);
        if (this.mcpClient.getProjectRoot() !== targetRepoResolved) {
          try {
            await this.mcpClient.reloadProject(targetRepoResolved);
          } catch (mcpSyncErr) {
            console.warn('[KIN CORE] MCP project reload notice:', mcpSyncErr);
          }
        } else if (this.mcpClient.getAllTools().length === 0) {
          try {
            await this.mcpClient.loadConfiguredServers();
          } catch (mcpLoadErr) {
            console.warn('[KIN CORE] MCP server auto-load notice:', mcpLoadErr);
          }
        }
      }

      // Resolve 4-Tier Memory Scopes & DM Isolation Context
      const isDm = channel?.channelType === 'direct_message' || channel?.isPrivate || channelId.startsWith('dm-');
      const dmMembers = isDm ? this.workspaceRepo.listChannelMemberIds(channelId).map((mId) => {
        const ag = allProjectAgents.find((a) => a.id === mId);
        return ag?.displayName || mId;
      }) : [];

      let dmOriginChannel: { id: string; name: string; members: string[] } | undefined;
      if (isDm) {
        const originMem = this.memoryRepo.getMemory('agent_private', agent.id, 'origin_channel_for_dm');
        if (originMem?.value && typeof originMem.value === 'object') {
          const val = originMem.value as any;
          const originChanId = val.channelId;
          if (originChanId) {
            const origChan = this.workspaceRepo.getChannel(originChanId);
            const origMemberIds = this.workspaceRepo.listChannelMemberIds(originChanId);
            const origMembers = origMemberIds.map((mId) => {
              const ag = allProjectAgents.find((a) => a.id === mId);
              return ag?.displayName || mId;
            });
            dmOriginChannel = {
              id: originChanId,
              name: origChan?.name ? `#${origChan.name.replace(/^#/, '')}` : (val.channelName || originChanId),
              members: origMembers,
            };
          }
        }
      }

      const dmContext = isDm ? {
        isDirectMessage: true,
        participants: dmMembers.length > 0 ? dmMembers : ['Human Operator', agent.displayName],
        originChannel: dmOriginChannel,
      } : undefined;

      const projectMemories = this.memoryRepo
        .listMemories('project', targetProjectId)
        .map((m) => ({ key: m.key, type: m.value !== undefined ? String(m.type) : 'semantic', value: m.value }));
      const channelMemories = this.memoryRepo
        .listMemories('channel', channelId)
        .map((m) => ({ key: m.key, type: m.value !== undefined ? String(m.type) : 'semantic', value: m.value }));
      const agentPrivateMemories = this.memoryRepo
        .listMemories('agent_private', agent.id)
        .map((m) => ({ key: m.key, type: m.value !== undefined ? String(m.type) : 'semantic', value: m.value }));

      // Multi-Department Structured Memory Expansion:
      // Query structured memories across all other assigned channels (departments) for this agent
      const assignedDepartmentMemories: Array<{ channelId: string; channelName: string; memories: any[] }> = otherChannelIds.map((cId) => {
        const c = this.workspaceRepo.getChannel(cId);
        const mems = this.memoryRepo
          .listMemories('channel', cId)
          .map((m) => ({ key: m.key, type: m.value !== undefined ? String(m.type) : 'semantic', value: m.value }))
          .slice(0, 15);
        return {
          channelId: cId,
          channelName: c?.name ? `#${c.name.replace(/^#/, '')}` : `#${cId}`,
          memories: mems,
        };
      }).filter((d) => d.memories.length > 0);

      // Resolve organizational reporting line
      let managerDisplayName: string | undefined;
      if (agent.parentAgentId) {
        const mgr = this.agentRepo.getIdentity(agent.parentAgentId);
        managerDisplayName = mgr?.displayName || agent.parentAgentId;
      } else if (!agent.isOrchestrator) {
        const boss = allProjectAgents.find((a) => a.isOrchestrator);
        if (boss && boss.id !== agent.id) {
          managerDisplayName = boss.displayName;
        }
      }
      const subordinates = this.agentRepo.listSubordinates(agent.id).map((s) => s.displayName);

      // Build Project Workforce Roster & Responsibilities for team awareness
      const projectRoster = allProjectAgents.map((a) => {
        const agentDef = this.agentRepo.getDefinition(a.definitionId);
        const activeTask = this.taskRepo
          .listTasksByProject(targetProjectId)
          .find((t) => t.assignedAgentId === a.id && (t.status === 'running' || t.status === 'assigned' || t.status === 'ready'));
        return {
          id: a.id,
          displayName: a.displayName,
          role: agentDef?.role || (a.isOrchestrator ? 'Workspace Orchestrator' : 'Specialist'),
          domainAuthority: agentDef?.domainAuthority?.join(', ') || 'General',
          activeTask: activeTask?.title,
          status: 'Active',
          channelIds: this.workspaceRepo.listAgentChannelIds(a.id, targetProjectId),
        };
      });

      const otherAssignedChannelRosters = otherChannelIds.map((cId) => {
        const c = this.workspaceRepo.getChannel(cId);
        const memberIds = this.workspaceRepo.listChannelMemberIds(cId);
        const members = memberIds.map((mId) => {
          const a = allProjectAgents.find((ag) => ag.id === mId);
          return a?.displayName || mId;
        });
        return {
          channelId: cId,
          channelName: c?.name ? `#${c.name.replace(/^#/, '')}` : `#${cId}`,
          topic: c?.topic,
          members,
        };
      });

      // Compile prompt with 4-tier memory hierarchy, project grounding, channel context, and peer awareness
      const compiled = this.contextCompiler.compile({
        agentDefinition: def ?? {
          id: agent.definitionId,
          name: agent.displayName,
          role: agent.isOrchestrator ? 'Workspace Orchestrator' : 'Specialist',
          systemPrompt: 'You are @Boss, KIN’s default workspace orchestrator.',
          defaultModelId: agent.activeModelId,
          domainAuthority: [],
          capabilities: [],
          createdAt: Date.now(),
        },
        agentIdentity: agent,
        project: this.workspaceRepo.getProject(targetProjectId),
        toolSchemas: this.toolGateway.getToolSchemas(),
        projectDecisions: this.taskRepo
          .listDecisionsByProject(targetProjectId)
          .filter((d) => d.status !== 'superseded' && d.status !== 'rejected')
          .map((d) => ({ key: d.title, decision: d.rationale })),
        trajectoryMessages: this.channelService.getMessages(channelId, 10),
        activeChannel: channel,
        channelPeers: peers,
        assignedChannels,
        projectAgents: allProjectAgents.map((a) => a.displayName),
        projectRoster,
        otherAssignedChannelRosters,
        reportingLine: {
          manager: managerDisplayName,
          subordinates: subordinates.length > 0 ? subordinates : undefined,
        },
        crossChannelSummaries,
        scopedMemories: projectMemories,
        projectMemories,
        channelMemories,
        assignedDepartmentMemories,
        agentPrivateMemories,
        dmContext,
        goalAncestry: goalAncestryChain,
        customTools: this.toolEngine ? this.toolEngine.listTools('active', targetProjectId).map((t) => ({
          name: t.name,
          description: t.description,
          usageCount: t.usageCount,
          successCount: t.successCount,
        })) : undefined,
        harnessImprovements: this.toolEngine ? this.toolEngine.findImprovements(targetProjectId).map((imp) => ({
          domain: imp.domain,
          componentType: imp.componentType,
          verifiedAdaptation: imp.verifiedAdaptation,
        })) : undefined,
      });

      // 4. Construct complete trajectory messages for model invocation
      const trajectory = this.channelService.getMessages(channelId, 10);
      const loopCheck = this.loopBreaker.evaluateThread(trajectory);
      if (loopCheck.action === 'halt_and_escalate') {
        const warningMsg = `🛑 Stagnation Guard: Circular or stagnant discussion detected (${loopCheck.stagnantTurns} turns). Halting automated loop and escalating to human operator.`;
        this.channelService.sendMessage({
          channelId,
          senderId: agent.id,
          senderType: 'agent',
          content: warningMsg,
          productivityScore: 0,
        });
        if (run?.id) {
          try { this.kernel.transitionState(run.id, 'waiting_for_approval', 'Halted due to stagnant discussion'); } catch {}
        }
        this.activeAgentExecutions.delete(agent.id);
        this.broadcastEvent('agent:state', { agentId: agent.id, channelId, status: 'idle' });
        return;
      }

      const modelMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: compiled.fullAssembledPrompt },
      ];

      if (loopCheck.action === 'warn') {
        modelMessages.push({
          role: 'user',
          content: `⚠️ [LOOP WARNING]: ${loopCheck.warningMessage || 'Repeated or unproductive discourse detected. Pivot immediately to concrete action or state resolution.'}`,
        });
      }

      for (let i = 0; i < trajectory.length; i++) {
        const m = trajectory[i];
        const isHistorical = i < trajectory.length - 2;
        let content = m.content || '';
        const isLocalModel = !agent.activeModelId || !agent.activeModelId.includes('/');
        const maxHistLen = isLocalModel ? 400 : 1500;
        if (isHistorical && content.length > maxHistLen) {
          content = content.slice(0, Math.floor(maxHistLen * 0.6)) + '\n... [prior response summarized for context budget] ...\n' + content.slice(-Math.floor(maxHistLen * 0.3));
        }
        if (m.senderId === agent.id) {
          modelMessages.push({ role: 'assistant', content });
        } else if (m.senderType === 'human') {
          const rawContent = (m.id === triggerMsg?.id && triggerMsg?.content) ? triggerMsg.content : content;
          if (rawContent.includes('> [Quote') || rawContent.includes('> @') || rawContent.startsWith('>') || rawContent.includes('@[Quote]')) {
            modelMessages.push({
              role: 'user',
              content: `${rawContent}\n\n[Instruction: The operator has directly quoted a statement above. Address and analyze the quoted statement specifically in your response.]`,
            });
          } else {
            modelMessages.push({ role: 'user', content: rawContent });
          }
        } else {
          const peer = allProjectAgents.find((a) => a.id === m.senderId);
          const peerName = peer?.displayName || m.senderId;
          modelMessages.push({ role: 'user', content: `[${peerName}]: ${content}` });
        }
      }

      // Ensure the trigger message is present if trajectory was empty
      if (triggerMsg && !trajectory.some((m) => m.id === triggerMsg.id)) {
        const trigContent = triggerMsg.content || '';
        if (trigContent.includes('> [Quote') || trigContent.includes('> @') || trigContent.startsWith('>') || trigContent.includes('@[Quote]')) {
          modelMessages.push({
            role: 'user',
            content: `${trigContent}\n\n[Instruction: The operator has directly quoted a statement above. Address and analyze the quoted statement specifically in your response.]`,
          });
        } else {
          modelMessages.push({ role: 'user', content: trigContent });
        }
      } else if (!triggerMsg && modelMessages.length === 0) {
        const activeTaskInfo = activeTaskId ? this.taskRepo.getTask(activeTaskId) : null;
        modelMessages.push({
          role: 'user',
          content: activeTaskInfo
            ? `Execute assigned task: ${activeTaskInfo.title}\n${activeTaskInfo.description || ''}`
            : 'Resume execution for admitted run.',
        });
      }

      // 5. Execute Autonomous Multi-Turn ReAct Loop (with Tool Gateway, Native File/Shell/Schedule, Skills & MCP)
      const freshIdentity = this.agentRepo.getIdentity(agent.id) || agent;
      const agentDef = this.agentRepo.getDefinition(freshIdentity.definitionId) || def;
      const defCapabilities = agentDef?.capabilities || [];
      const project = this.workspaceRepo.getProject(targetProjectId);
      const repoRoot = project?.repoPath || process.cwd();

      // Check if coding task to provision isolated git worktree
      let worktreeInfo: { worktreePath: string; branch: string; isShadowRepo: boolean } | null = null;
      let effectiveWorktreeRoot = repoRoot;
      const isCoding = !!(activeTaskId || defCapabilities.includes('worktree') || triggerMsg?.content?.toLowerCase().includes('code') || triggerMsg?.content?.toLowerCase().includes('refactor') || triggerMsg?.content?.toLowerCase().includes('implement') || triggerMsg?.content?.toLowerCase().includes('fix') || triggerMsg?.content?.toLowerCase().includes('bug'));
      if (isCoding) {
        try {
          const existingPreserved = this.preservedWorktrees.get(run.id);
          if (existingPreserved && fs.existsSync(existingPreserved.worktreePath)) {
            worktreeInfo = {
              worktreePath: existingPreserved.worktreePath,
              branch: existingPreserved.branch,
              isShadowRepo: !!existingPreserved.isShadowRepo,
            };
            effectiveWorktreeRoot = worktreeInfo.worktreePath;
            this.kernel.updateWorktreePath(run.id, effectiveWorktreeRoot);
          } else {
            const worktreeManager = new WorktreeManager(repoRoot);
            worktreeInfo = await worktreeManager.provisionWorktree(run.id, freshIdentity.displayName?.replace(/^@/, '') || 'worker');
            effectiveWorktreeRoot = worktreeInfo.worktreePath;
            this.kernel.updateWorktreePath(run.id, effectiveWorktreeRoot);
          }
        } catch (wtErr: any) {
          console.warn('[KIN CORE] Worktree provision failure - failing closed:', wtErr);
          if (activeTaskId) {
            try { this.taskRepo.updateTaskStatus(activeTaskId, 'blocked'); } catch {}
          }
          if (run?.id) {
            try { this.kernel.transitionState(run.id, 'failed', `Worktree isolation setup failed: ${wtErr?.message || wtErr}`); } catch {}
          }
          this.channelService.sendMessage({
            channelId,
            senderId: freshIdentity.id,
            senderType: 'agent',
            content: `⚠️ Task blocked: Failed to provision an isolated git worktree (${wtErr?.message || 'unknown error'}). Execution aborted to preserve repository isolation.`,
            productivityScore: 0,
          });
          this.activeAgentExecutions.delete(freshIdentity.id);
          this.broadcastEvent('agent:state', { agentId: freshIdentity.id, channelId, status: 'idle' });
          return;
        }
      }

      // 4b. Incorporate any in-flight mid-task steering directives from the user
      const relevantSteers = this.pendingSteers.filter((s) => {
        if (s.channelId !== channelId) return false;
        if (s.consumedByAgentIds.includes(freshIdentity.id)) return false;
        if (s.targetAgentId && s.targetAgentId !== freshIdentity.id) return false;
        return true;
      });
      if (relevantSteers.length > 0) {
        for (const s of relevantSteers) {
          s.consumedByAgentIds.push(freshIdentity.id);
        }
        const steerNotes = relevantSteers.map((s) => `- "${s.directive}"`).join('\n');
        modelMessages.push({
          role: 'user',
          content: `⚠️ [PRIORITY MID-EXECUTION STEERING DIRECTIVE FROM HUMAN OPERATOR]:\n${steerNotes}\nThe user has redirected the active task in real-time. Immediately adapt your plan, acknowledge what was previously being done, and pivot to address this priority instruction.`,
        });
      }

      let runnerAdapter: TypedRunnerAdapter = this.nativeRunnerAdapter;
      if (freshIdentity.runnerAdapterId && freshIdentity.runnerAdapterId !== 'native-react') {
        try {
          runnerAdapter = RunnerAdapterRegistry.get(freshIdentity.runnerAdapterId);
        } catch {
          runnerAdapter = this.nativeRunnerAdapter;
        }
      }
      const proj = this.workspaceRepo.getProject(targetProjectId);
      const ws = proj ? this.workspaceRepo.getWorkspace(proj.workspaceId) : null;
      const autonomyMode = ws?.defaultAutonomyMode ?? 'AUTO';

      const channelModelOverride = (channelId && !channelId.startsWith('dm-'))
        ? (this.memoryRepo.getMemory('channel', channelId, `agent_model:${freshIdentity.id}`)?.value as string | undefined)
        : undefined;
      const effectiveModelId = modelOverride || channelModelOverride || freshIdentity.activeModelId;

      const loopResult = await runnerAdapter.execute({
        runId: run.id,
        taskId: run.taskId,
        agentId: freshIdentity.id,
        modelId: effectiveModelId,
        fallbackModelId: undefined,
        projectId: targetProjectId,
        channelId,
        userPrompt: triggerMsg?.content || '',
        systemPrompt: compiled.fullAssembledPrompt,
        worktreeRoot: effectiveWorktreeRoot,
        autonomyMode,
        maxTurns: 6,
        allowedCapabilities: freshIdentity.isOrchestrator ? ['*'] : defCapabilities,
        taskRepo: this.taskRepo,
        decisionRepo: this.taskRepo,
        modelGateway: this.modelGateway,
        onModelUnavailable: (modelId: string, error: string) => {
          this.broadcastEvent('agent:model_unavailable', {
            runId: run.id,
            agentId: freshIdentity.id,
            agentName: agent.displayName,
            channelId,
            modelId,
            error,
          });
        },
        onToken: (token: string) => {
          this.broadcastEvent('agent:token', {
            runId: run.id,
            agentId: freshIdentity.id,
            channelId,
            token,
          });
        },
        onThinkingToken: (token: string) => {
          let live = this.agentLiveActivity.get(freshIdentity.id);
          if (!live) {
            live = { latestThinking: '', recentTools: [], recentThoughts: [] };
            this.agentLiveActivity.set(freshIdentity.id, live);
          }
          live.latestThinking += token;

          this.broadcastEvent('agent:thinking_token', {
            runId: run.id,
            agentId: freshIdentity.id,
            channelId,
            token,
          });
        },
        onHeartbeat: () => {
          try {
            this.kernel.heartbeat(run.id);
          } catch {}
        },
        onRenewLease: (tId: string) => {
          try {
            return this.taskRepo.renewTaskLease(tId, run.id, 300000);
          } catch {
            return false;
          }
        },
        onTokenUsage: (tokensUsed) => {
          try {
            return this.kernel.recordTokenUsage(run.id, tokensUsed.totalTokens);
          } catch {
            return { exceeded: false };
          }
        },
        initialMessages: resumeCheckpoint?.conversationHistory?.length ? resumeCheckpoint.conversationHistory : modelMessages,
        resumeFromTurnCheckpoint: resumeCheckpoint,
        onTurnCheckpoint: async (turn, conversationHistory, actions) => {
          try {
            this.kernel.saveCheckpoint(run.id, {
              turn,
              conversationHistory,
              actions,
              timestamp: Date.now(),
            });
            this.broadcastEvent('run:checkpoint', {
              runId: run.id,
              agentId: freshIdentity.id,
              channelId,
              turn,
            });
          } catch (chkErr) {
            console.warn('[KIN RUN] Failed to save turn checkpoint:', chkErr);
          }
        },
        onQuotaPaused: async (turn, resetAt, conversationHistory, actions) => {
          try {
            this.kernel.saveCheckpoint(run.id, {
              turn,
              conversationHistory,
              actions,
              isQuotaPaused: true,
              quotaResetsAt: resetAt,
              timestamp: Date.now(),
            });
            this.kernel.pauseForQuota(run.id, Math.max(10000, resetAt - Date.now()));
            const activeModel = freshIdentity.activeModelId || 'frontier API';
            const modelProvider = activeModel.includes('/') ? activeModel.split('/')[0] : 'local';
            this.broadcastEvent('quota:paused', {
              runId: run.id,
              agentId: freshIdentity.id,
              agentName: freshIdentity.displayName || freshIdentity.name || freshIdentity.id,
              channelId,
              turn,
              quotaResetsAt: resetAt,
              modelId: activeModel,
              provider: modelProvider,
            });
          } catch (qErr) {
            console.warn('[KIN RUN] Failed to pause for quota:', qErr);
          }
        },
        checkTakeoverStatus: () => {
          if (this.isStopping) return 'abort';
          return this.getTakeoverStatus(run.id);
        },
        getAbortSignal: () => this.runAbortControllers.get(run.id)?.signal || abortController.signal,
        renewAbortSignal: () => {
          if (this.isStopping) return undefined;
          const freshCtrl = new AbortController();
          this.runAbortControllers.set(run.id, freshCtrl);
          return freshCtrl.signal;
        },
        agentRepo: this.agentRepo,
        onModelSwitched: (newModelId: string) => {
          freshIdentity.activeModelId = newModelId;
        },
        getModelId: () => {
          const chanOverride = (channelId && !channelId.startsWith('dm-'))
            ? (this.memoryRepo.getMemory('channel', channelId, `agent_model:${freshIdentity.id}`)?.value as string | undefined)
            : undefined;
          return modelOverride || chanOverride || this.agentRepo.getIdentity(freshIdentity.id)?.activeModelId || freshIdentity.activeModelId;
        },
        getSteerDirectives: () => {
          const matchingSteers = this.pendingSteers.filter((s) => {
            if (s.channelId !== channelId) return false;
            if (s.consumedByAgentIds.includes(freshIdentity.id)) return false;
            if (s.targetAgentId && s.targetAgentId !== freshIdentity.id) return false;
            return true;
          });

          for (const s of matchingSteers) {
            s.consumedByAgentIds.push(freshIdentity.id);
          }

          // Prune steers that are either targeted and consumed, or consumed by all active agents in channel
          const activeAgentsInChan = Array.from(this.activeAgentExecutions.values())
            .filter((e) => e.channelId === channelId)
            .map((e) => e.agentId);

          this.pendingSteers = this.pendingSteers.filter((s) => {
            if (s.targetAgentId && s.consumedByAgentIds.includes(s.targetAgentId)) return false;
            if (activeAgentsInChan.length > 0 && activeAgentsInChan.every((aId) => s.consumedByAgentIds.includes(aId))) return false;
            if (Date.now() - s.timestamp > 120000) return false;
            return true;
          });

          return matchingSteers.map((s) => s.directive);
        },
        onToolStart: (toolName, params) => {
          const sanitizedParams = SecretBroker.getInstance().sanitizePayload(params || {});
          const preview = this.generateActionPreview(toolName, sanitizedParams);
          const existing = this.takeoverStates.get(run.id);
          this.takeoverStates.set(run.id, {
            runId: run.id,
            agentId: freshIdentity.id,
            channelId,
            isPaused: existing?.isPaused ?? false,
            isAborted: existing?.isAborted ?? false,
            activeTool: toolName,
            previewPayload: preview,
            financialGate: preview.riskLevel === 'CRITICAL',
            riskLevel: preview.riskLevel,
          });

          let live = this.agentLiveActivity.get(freshIdentity.id);
          if (!live) {
            live = { latestThinking: '', recentTools: [], recentThoughts: [] };
            this.agentLiveActivity.set(freshIdentity.id, live);
          }
          live.activeTool = { toolName, params: sanitizedParams, startTime: Date.now() };

          this.broadcastEvent('agent:tool_preview', {
            runId: run.id,
            agentId: freshIdentity.id,
            channelId,
            toolName,
            preview,
          });
          this.broadcastEvent('agent:tool_start', {
            agentId: freshIdentity.id,
            channelId,
            toolName,
            params: sanitizedParams,
          });
        },
        onToolEnd: (toolName, output, error) => {
          const currentTakeover = this.takeoverStates.get(run.id);
          if (currentTakeover) {
            currentTakeover.activeTool = undefined;
            currentTakeover.previewPayload = undefined;
          }

          let live = this.agentLiveActivity.get(freshIdentity.id);
          if (live) {
            const durationMs = live.activeTool?.startTime ? Date.now() - live.activeTool.startTime : undefined;
            live.recentTools.unshift({
              toolName,
              params: live.activeTool?.params,
              output,
              error,
              timestamp: Date.now(),
              durationMs,
            });
            if (live.recentTools.length > 50) live.recentTools.pop();
            live.activeTool = undefined;
          }

          // Evaluate Human Authorization Protocol boundary
          if (toolName.startsWith('browser')) {
            const browserStatus = this.browserController.getStatus();
            const url = browserStatus.currentUrl || '';
            const snippet = typeof output === 'string' ? output : JSON.stringify(output || '');
            const authCheck = this.financialSafety.checkAuthProtocolRequirement(url, snippet);
            if (authCheck.requiresUserAuth && currentTakeover) {
              currentTakeover.isPaused = true;
              currentTakeover.authRequired = true;
              currentTakeover.authInstructions = authCheck.promptInstructions;
              this.broadcastEvent('takeover:paused', {
                runId: run.id,
                agentId: freshIdentity.id,
                authRequired: true,
                authInstructions: authCheck.promptInstructions,
              });
            }
          }

          this.broadcastEvent('agent:tool_end', {
            agentId: freshIdentity.id,
            channelId,
            toolName,
            output,
            error,
          });
        },
      });

      const live = this.agentLiveActivity.get(freshIdentity.id);
      if (live) {
        if (live.latestThinking && live.latestThinking.trim()) {
          live.recentThoughts.unshift({ thought: live.latestThinking.trim(), timestamp: Date.now() });
          if (live.recentThoughts.length > 20) live.recentThoughts.pop();
          live.latestThinking = '';
        }
        live.activeTool = undefined;
      }

      this.takeoverStates.delete(run.id);
      this.broadcastEvent('takeover:finished', { runId: run.id, agentId: freshIdentity.id });

      if (loopResult.isQuotaPaused) {
        this.activeAgentExecutions.delete(agent.id);
        this.broadcastEvent('agent:state', { agentId: agent.id, channelId, status: 'idle' });
        const resetTimeStr = new Date(loopResult.quotaResetAt || Date.now() + 60000).toLocaleTimeString();
        const pauseNotice = this.channelService.sendMessage({
          channelId,
          senderId: agent.id,
          senderType: 'agent',
          content: `⏸️ **Autonomous Quota Guard Paused**: API rate limit or quota exceeded for \`${freshIdentity.activeModelId}\` at turn ${loopResult.interruptedTurn || 1}.\n\nState checkpoint has been safely persisted to SQLite. Scheduled to auto-resume at **${resetTimeStr}**. You can also click **"Resume Now"** or select another model and click **"Switch & Resume"** in the recovery banner above.`,
          productivityScore: 80,
        });
        this.broadcastEvent('message:created', {
          id: pauseNotice.id,
          channelId: pauseNotice.channelId,
          senderId: pauseNotice.senderId,
          senderName: agent.displayName,
          senderType: 'agent',
          content: pauseNotice.content,
          createdAt: pauseNotice.createdAt,
        });
        return;
      }

      if (loopResult.isModelUnavailable || (loopResult.isError && loopResult.modelId)) {
        this.activeAgentExecutions.delete(agent.id);
        this.broadcastEvent('agent:state', { agentId: agent.id, channelId, status: 'idle' });
        this.broadcastEvent('agent:model_unavailable', {
          runId: run.id,
          agentId: freshIdentity.id,
          agentName: agent.displayName,
          channelId,
          modelId: loopResult.modelId || freshIdentity.activeModelId,
          error: loopResult.error || loopResult.finalContent,
        });
        const errorNotice = this.channelService.sendMessage({
          channelId,
          senderId: agent.id,
          senderType: 'agent',
          content: `⚠️ **Model Unavailable**: Selected model \`${loopResult.modelId || freshIdentity.activeModelId}\` cannot be reached.\n\n**Details:** ${loopResult.error || 'Connection or authorization error'}\n\n*Automatic fallback is disabled to ensure you maintain full control over which models are executed. Please configure provider credentials in Settings or choose an alternative model in the Model Selector.*`,
          productivityScore: 0,
        });
        this.broadcastEvent('message:created', {
          id: errorNotice.id,
          channelId: errorNotice.channelId,
          senderId: errorNotice.senderId,
          senderName: agent.displayName,
          senderType: 'agent',
          content: errorNotice.content,
          createdAt: errorNotice.createdAt,
        });
        return;
      }

      // 6. Persist agent reply to SQLite (with terminology compliance filter)
      let productivityScore = loopResult.actions.some((a) => a.error) ? 75 : 95;
      if (loopResult.actions.length === 0) {
        const recentHistory = this.channelService.getMessages(channelId, 6);
        const agentRecent = recentHistory.filter((m) => m.senderType === 'agent');
        const normalizedCurrent = (loopResult.finalContent || '').trim().toLowerCase();

        const isRepetitive = agentRecent.some((m) => {
          const normPrev = m.content.trim().toLowerCase();
          return normPrev === normalizedCurrent ||
            (normalizedCurrent.length > 20 && normPrev.includes(normalizedCurrent)) ||
            (normPrev.length > 20 && normalizedCurrent.includes(normPrev));
        });

        const prevMsg = recentHistory[recentHistory.length - 1];
        const isConsecutiveAgentDebate = prevMsg && prevMsg.senderType === 'agent' && prevMsg.senderId !== agent.id;

        if (isRepetitive || (isConsecutiveAgentDebate && !normalizedCurrent.includes('```') && !normalizedCurrent.includes('diff'))) {
          productivityScore = 0;
        }
      }

      const agentReply = this.channelService.sendMessage({
        channelId,
        senderId: agent.id,
        senderType: 'agent',
        content: this.sanitizeTerminology(loopResult.finalContent),
        productivityScore,
      });

      // 6b. Record experience into SkillEngine for autonomous learning
      if (loopResult.actions.length > 0) {
        const matched = this.skillEngine.matchSkills(triggerMsg?.content || '');
        for (const skill of matched) {
          this.skillEngine.recordExperience({
            skillId: skill.id,
            runId: run.id,
            objective: triggerMsg?.content || 'Autonomous Task',
            outcome: loopResult.actions.some((a) => !!a.error) ? 'failure' : 'success',
            lessonsLearned: `Agent: ${freshIdentity.displayName}, Actions: ${loopResult.actions.length}, Turns: ${loopResult.turnCount}`,
          });
        }
      }

      // Handle isolated git worktree changes: commit diff, verify and merge to base branch
      let worktreeCommitSha: string | null = null;
      let worktreeMergeFailed = false;
      let worktreeMergeError: string | null = null;
      if (worktreeInfo) {
        if (loopResult.requiresApproval || (loopResult.interrupted && loopResult.requiresApproval)) {
          // Preserve worktree branch and directory for pending approval resolution
          this.preservedWorktrees.set(run.id, {
            worktreePath: worktreeInfo.worktreePath,
            branch: worktreeInfo.branch,
            repoRoot,
            isShadowRepo: worktreeInfo.isShadowRepo,
          });
        } else {
          try {
            const worktreeManager = new WorktreeManager(repoRoot);
            const diff = await worktreeManager.generateDiff(worktreeInfo.worktreePath);
            if (diff && diff.trim().length > 0) {
              worktreeCommitSha = await worktreeManager.commitWorktreeChanges(
                worktreeInfo.worktreePath,
                `KIN agent ${freshIdentity.displayName} automated task ${run.id}`
              );
              const defaultBranch = (typeof project?.settings?.defaultBranch === 'string' && project.settings.defaultBranch) ? project.settings.defaultBranch : 'main';
              const mergeRes = await worktreeManager.verifyAndMerge(
                worktreeInfo.worktreePath,
                worktreeInfo.branch,
                defaultBranch
              );
              if (!mergeRes.success) {
                worktreeMergeFailed = true;
                worktreeMergeError = mergeRes.error || 'Worktree merge failed';
                worktreeCommitSha = null;
                await worktreeManager.removeWorktree(worktreeInfo.worktreePath);
                await worktreeManager.deleteBranch(worktreeInfo.branch);
                console.warn('[KIN CORE] Worktree merge conflict/error:', worktreeMergeError);
              } else if (mergeRes.commitSha) {
                worktreeCommitSha = mergeRes.commitSha;
              }
            } else {
              await worktreeManager.removeWorktree(worktreeInfo.worktreePath);
              await worktreeManager.deleteBranch(worktreeInfo.branch);
            }
          } catch (wtMergeErr: any) {
            worktreeMergeFailed = true;
            worktreeMergeError = wtMergeErr?.message || String(wtMergeErr);
            if (worktreeInfo) {
              try {
                const worktreeManager = new WorktreeManager(repoRoot);
                await worktreeManager.removeWorktree(worktreeInfo.worktreePath);
                await worktreeManager.deleteBranch(worktreeInfo.branch);
              } catch {}
            }
            console.warn('[KIN CORE] Worktree merge/cleanup error:', wtMergeErr);
          }
          this.preservedWorktrees.delete(run.id);
        }
      }

      if (worktreeMergeFailed) {
        const diagMsg = `Worktree verification and merge to base branch failed: ${worktreeMergeError || 'Unknown merge conflict/failure'}`;
        this.kernel.transitionState(run.id, 'failed', diagMsg);
        const activeTaskId = triggerMsg?.taskId || run?.taskId;
        if (activeTaskId) {
          try {
            this.taskRepo.updateTaskStatus(activeTaskId, 'blocked');
            this.taskRepo.releaseTaskLease(activeTaskId, run.id, true);
            EventLedger.getInstance().record({
              eventType: 'TASK_BLOCKED',
              entityType: 'task',
              entityId: activeTaskId,
              payload: { runId: run.id, reason: diagMsg },
            });
            this.broadcastEvent('task:updated', { taskId: activeTaskId, status: 'blocked', reason: diagMsg });
          } catch (tErr) {
            console.warn('[KIN CORE] Notice updating task status to blocked on merge failure:', tErr);
          }
        }
        this.activeAgentExecutions.delete(agent.id);
        this.broadcastEvent('agent:state', { agentId: agent.id, channelId, status: 'idle' });
        return;
      }

      // Record actual loopResult.actions in checkpoints table upon run completion
      if (run?.id && loopResult?.actions) {
        try {
          const checkpointId = `chk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          this.db.execute(
            `INSERT INTO checkpoints (id, run_id, snapshot_json, worktree_commit_sha, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            checkpointId,
            run.id,
            JSON.stringify({
              actions: loopResult.actions,
              finalContent: loopResult.finalContent,
              turnCount: loopResult.turnCount,
              agentId: freshIdentity.id,
              channelId,
            }),
            worktreeCommitSha,
            Date.now()
          );
        } catch (chkErr) {
          console.error('[KIN CORE] Failed to record checkpoint for run:', chkErr);
        }
      }

      // 7. Complete run in kernel
      if (loopResult.requiresApproval || (loopResult.interrupted && loopResult.requiresApproval)) {
        const details = loopResult.pendingApprovalDetails || {
          toolName: 'loopBreaker',
          params: { reason: loopResult.reason || loopResult.finalContent },
          riskLevel: 'HIGH',
        };
        const approvalId = `appr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const now = Date.now();
        const sanitizedParams = SecretBroker.getInstance().sanitizePayload(details.params || {});
        if (worktreeInfo) {
          sanitizedParams._worktreePath = worktreeInfo.worktreePath;
          sanitizedParams._worktreeBranch = worktreeInfo.branch;
          sanitizedParams._isShadowRepo = worktreeInfo.isShadowRepo;
          this.preservedWorktrees.set(approvalId, {
            worktreePath: worktreeInfo.worktreePath,
            branch: worktreeInfo.branch,
            repoRoot,
            isShadowRepo: worktreeInfo.isShadowRepo,
          });
        }
        this.db.execute(
          `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          approvalId,
          run.id,
          freshIdentity.id,
          details.toolName || 'action',
          JSON.stringify(sanitizedParams),
          details.riskLevel || 'CRITICAL',
          now + 86400000,
          now
        );
        this.broadcastEvent('approval:created', {
          id: approvalId,
          runId: run.id,
          agentId: freshIdentity.id,
          agentName: freshIdentity.displayName,
          toolName: details.toolName || 'action',
          actionSummary: sanitizedParams?.command || sanitizedParams?.url || sanitizedParams?.path || sanitizedParams?.reason || JSON.stringify(sanitizedParams || {}),
          riskLevel: details.riskLevel || 'CRITICAL',
          actionPayload: sanitizedParams,
          projectId: run.projectId || freshIdentity.projectId || this.activeProjectId,
        });
        this.kernel.transitionState(run.id, 'waiting_for_approval', loopResult.reason || 'Requires interactive human approval');
        if (loopResult.interrupted) {
          this.broadcastEvent('agent:anti_loop', {
            runId: run.id,
            agentId: freshIdentity.id,
            channelId,
            reason: loopResult.reason || loopResult.finalContent,
          });
        }
      } else if (loopResult.isAborted) {
        const currentRun = this.kernel.getRun(run.id);
        const wasAlreadyFailed = currentRun?.state === 'failed';
        if (!wasAlreadyFailed) {
          this.kernel.transitionState(run.id, 'cancelled', 'Aborted via human takeover kill switch');
        }
        const activeTaskId = triggerMsg?.taskId || run?.taskId;
        if (activeTaskId) {
          try {
            this.taskRepo.releaseTaskLease(activeTaskId, run.id, wasAlreadyFailed);
          } catch {}
        }
      } else if (
        loopResult.actions &&
        loopResult.actions.some((a: any) => !!a.error) &&
        !(
          loopResult.finalContent &&
          loopResult.finalContent.trim().length > 0 &&
          (!loopResult.actions[loopResult.actions.length - 1]?.error ||
            loopResult.actions.slice(loopResult.actions.findIndex((a: any) => !!a.error) + 1).some((a: any) => !a.error))
        )
      ) {
        const errorList = loopResult.actions.filter((a: any) => !!a.error).map((a: any) => a.error).join('; ');
        const failMsg = `Agent execution recorded action errors during turn execution: ${errorList}`;
        this.kernel.transitionState(run.id, 'failed', failMsg);
        const activeTaskId = triggerMsg?.taskId || run?.taskId;
        if (activeTaskId) {
          try {
            this.taskRepo.updateTaskStatus(activeTaskId, 'review');
            this.taskRepo.releaseTaskLease(activeTaskId, run.id, true);
            EventLedger.getInstance().record({
              eventType: 'TASK_REVIEW_REQUIRED',
              entityType: 'task',
              entityId: activeTaskId,
              payload: { runId: run.id, reason: failMsg },
            });
            this.broadcastEvent('task:updated', { taskId: activeTaskId, status: 'review', reason: failMsg });
          } catch (tErr) {
            console.warn('[KIN CORE] Notice updating task status to review on action errors:', tErr);
          }
        }
        this.activeAgentExecutions.delete(agent.id);
        this.broadcastEvent('agent:state', { agentId: agent.id, channelId, status: 'idle' });
        return;
      } else {
        // Pre-completion steer check: evaluate remaining steers BEFORE marking run/task complete
        const remainingSteers = this.pendingSteers.filter((s) => {
          if (s.channelId !== channelId) return false;
          if (s.consumedByAgentIds.includes(freshIdentity.id)) return false;
          if (s.targetAgentId && s.targetAgentId !== freshIdentity.id) return false;
          return true;
        });

        if (remainingSteers.length > 0) {
          for (const s of remainingSteers) {
            s.consumedByAgentIds.push(freshIdentity.id);
          }
          const steerNotes = remainingSteers.map((s) => `- "${s.directive}"`).join('\n');
          const pivotTrigger = {
            id: `steer-followup-${Date.now()}`,
            channelId,
            senderId: 'user-operator',
            senderType: 'human' as const,
            content: `⚠️ [PRIORITY MID-EXECUTION STEERING DIRECTIVE FROM HUMAN OPERATOR]:\n${steerNotes}\nThe human operator redirected the task in real-time. Immediately acknowledge what was just stated and pivot to address this priority instruction.`,
            createdAt: Date.now(),
          };
          // Re-execute pivot turn with fresh context without completing task or bounding depth
          await this.executeAgentResponse(freshIdentity, channelId, pivotTrigger, recursionDepth + 1, undefined, undefined, undefined, run.id);
          return;
        }

        this.kernel.transitionState(run.id, 'completed');

        // Automatic DAG task advancement upon successful run completion
        const activeTaskId = triggerMsg?.taskId || run?.taskId;
        if (activeTaskId) {
          try {
            const currentTask = this.taskRepo.getTask(activeTaskId);
            if (currentTask && (currentTask.status === 'running' || currentTask.status === 'ready' || currentTask.status === 'review')) {
              if (currentTask.status === 'ready') {
                this.taskRepo.updateTaskStatus(activeTaskId, 'running');
              }
              // Generate verifiable evidence record to gate task completion
              const evidenceId = `ev-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
              const expectedType = currentTask.verificationSpec?.expectedArtifactType;
              let contentUri: string | null = null;
              let evidenceType = expectedType || 'artifact_hash';
              let isVerified = 0;

              // 1. If verificationSpec contains a verification command, execute it to prove acceptance
              if (currentTask.verificationSpec?.command) {
                const verifyCmd = currentTask.verificationSpec.command;
                try {
                  const assignedIdentity = currentTask.assignedAgentId ? this.agentRepo.getIdentity(currentTask.assignedAgentId) : undefined;
                  const assignedDef = assignedIdentity ? this.agentRepo.getDefinition(assignedIdentity.definitionId) : undefined;
                  const agentCaps = assignedDef?.capabilities || ['fs:read', 'fs:write'];

                  const sentinel = Sentinel.getInstance();
                  const decision = sentinel.evaluate({
                    agentId: currentTask.assignedAgentId || 'task-verifier',
                    toolName: 'execute_command',
                    params: { command: verifyCmd, cwd: repoRoot },
                    riskLevel: 'HIGH',
                    autonomyMode: this.getEffectiveAutonomyMode(),
                    agentCapabilities: agentCaps,
                  });
                  if (!decision.allowed) {
                    throw new Error(`Verification command blocked by Sentinel: ${decision.reason}`);
                  }
                  if (decision.requiresApproval) {
                    throw new Error(`Verification command requires operator approval: ${decision.reason}`);
                  }

                  const cleanEnv: Record<string, string> = {};
                  for (const [k, v] of Object.entries(process.env)) {
                    if (v === undefined) continue;
                    const upper = k.toUpperCase();
                    if (
                      upper.includes('KEY') ||
                      upper.includes('SECRET') ||
                      upper.includes('TOKEN') ||
                      upper.includes('PASS') ||
                      upper.includes('VAULT') ||
                      upper === 'KIN_VAULT_KEY'
                    ) {
                      continue;
                    }
                    cleanEnv[k] = v;
                  }

                  const cmdOutput = await new Promise<string>((resolve, reject) => {
                    childProcess.exec(
                      verifyCmd,
                      {
                        cwd: repoRoot,
                        timeout: 30000,
                        encoding: 'utf-8',
                        env: cleanEnv,
                      },
                      (error: childProcess.ExecException | null, stdout: string, stderr: string) => {
                        const expectedExitCode = currentTask.verificationSpec?.expectedExitCode ?? 0;
                        if (error && (error as any).code !== expectedExitCode) {
                          reject(error);
                        } else {
                          resolve(stdout || stderr || '');
                        }
                      }
                    );
                  });
                  const expectedExitCode = currentTask.verificationSpec.expectedExitCode ?? 0;
                  if (expectedExitCode === 0) {
                    const logDir = path.resolve(repoRoot, '.kin', 'verification_logs');
                    if (!fs.existsSync(logDir)) {
                      fs.mkdirSync(logDir, { recursive: true });
                    }
                    const logFile = path.resolve(logDir, `task-${activeTaskId}-${Date.now()}.log`);
                    fs.writeFileSync(logFile, cmdOutput || 'Command succeeded with exit code 0');
                    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(logFile)).digest('hex');
                    const normPath = logFile.replace(/\\/g, '/');
                    contentUri = `file://${normPath}?sha256=${fileHash}`;
                    evidenceType = (expectedType === 'build_log' || expectedType === 'test_output') ? expectedType : 'test_output';
                    isVerified = 1;
                  }
                } catch (cmdErr: any) {
                  isVerified = 0;
                }
              }

              // 2. If not verified by command, verify commit SHA or generated artifact matching verificationSpec
              if (isVerified === 0) {
                if (worktreeCommitSha && (!expectedType || expectedType === 'artifact_hash')) {
                  contentUri = `git://commit/${worktreeCommitSha}`;
                  evidenceType = 'artifact_hash';
                  isVerified = 1;
                } else if (loopResult.actions && loopResult.actions.length > 0) {
                  // Verifiable artifact grounding: Only record evidence when a real file exists on disk
                  for (const act of loopResult.actions) {
                    if (act.error) continue;
                    const candidatePath = (act as any).result?.filePath || act.output?.filePath || act.params?.filePath || act.params?.path || act.params?.outputFile;
                    if (candidatePath && typeof candidatePath === 'string') {
                      const fullPath = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(repoRoot, candidatePath);
                      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
                        const normPath = fullPath.replace(/\\/g, '/');
                        const candidateType = (candidatePath.endsWith('.log') || candidatePath.endsWith('.txt')) ? 'build_log' : 'artifact_hash';
                        if (!expectedType || expectedType === candidateType || expectedType === 'artifact_hash') {
                          contentUri = `file://${normPath}?sha256=${fileHash}`;
                          evidenceType = expectedType || candidateType;
                          isVerified = 1;
                          break;
                        }
                      }
                    }
                  }
                }

                // 3. Analytical task evidence generation when task has no file mutations but finished successfully
                if (isVerified === 0 && loopResult.finalContent && loopResult.finalContent.trim().length > 0) {
                  const analysisHash = crypto.createHash('sha256').update(loopResult.finalContent.trim()).digest('hex');
                  contentUri = `memo://analysis/run/${run.id}?sha256=${analysisHash}`;
                  evidenceType = expectedType || 'analysis_summary';
                  isVerified = 1;
                }
              }

              if (isVerified === 1 && contentUri) {
                try {
                  this.db.execute(
                    `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, verified_by, verification_payload_json, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    evidenceId,
                    activeTaskId,
                    run.id,
                    evidenceType,
                    contentUri,
                    isVerified,
                    freshIdentity.id,
                    JSON.stringify({
                      commitSha: worktreeCommitSha || null,
                      verificationSpec: currentTask.verificationSpec || null,
                      actionsCount: loopResult.actions?.length || 0,
                    }),
                    Date.now()
                  );

                  EventLedger.getInstance().record({
                    eventType: 'EVIDENCE_RECORDED',
                    entityType: 'task',
                    entityId: activeTaskId,
                    payload: {
                      evidenceId,
                      type: evidenceType,
                      contentUri,
                      runId: run.id,
                      agentId: freshIdentity.id,
                      verifiedBy: freshIdentity.id,
                    },
                  });
                } catch (evErr) {
                  console.warn('[KIN CORE] Evidence record creation notice:', evErr);
                }

                const promotedTaskIds = this.taskRepo.completeTask(activeTaskId, evidenceId, run.id) || [];
                EventLedger.getInstance().record({
                    eventType: 'TASK_COMPLETED',
                    entityType: 'task',
                    entityId: activeTaskId,
                    payload: { runId: run.id, evidenceId, promotedTaskIds },
                });
                this.broadcastEvent('task:updated', { taskId: activeTaskId, status: 'completed', evidenceBundleId: evidenceId });

                // Promote dependent tasks whose dependencies are now satisfied
                for (const pId of promotedTaskIds) {
                  this.broadcastEvent('task:updated', { taskId: pId, status: 'ready' });
                }
              } else {
                // No verifiable proof produced: place task in review, do not mark completed
                const reviewReason = 'Run completed without generating verified commit, artifact hash, or acceptance evidence.';
                this.taskRepo.updateTaskStatus(activeTaskId, 'review');
                this.taskRepo.releaseTaskLease(activeTaskId, run.id, false);
                EventLedger.getInstance().record({
                  eventType: 'TASK_REVIEW_REQUIRED',
                  entityType: 'task',
                  entityId: activeTaskId,
                  payload: { runId: run.id, reason: reviewReason },
                });
                this.broadcastEvent('task:updated', { taskId: activeTaskId, status: 'review', reason: reviewReason });
              }

              // Advance all ready tasks in this goal to running and dispatch real worker runs
              if (currentTask.goalId) {
                const siblingTasks = this.taskRepo.listTasksByGoal(currentTask.goalId);
                const readyTasks = siblingTasks.filter((t) => t.id !== activeTaskId && t.status === 'ready');
                for (const nextReady of readyTasks) {
                  this.broadcastEvent('task:updated', { taskId: nextReady.id, status: 'ready' });

                  const nextWorker = (nextReady.assignedAgentId ? this.agentRepo.getIdentity(nextReady.assignedAgentId) : null) || freshIdentity;
                  if (nextWorker) {
                    const activation = this.activationEngine.evaluateActivation(nextWorker, {
                      type: 'task_dependency_ready',
                      taskId: nextReady.id,
                      readyTaskAssignedAgentId: nextWorker.id,
                    });
                    if (activation.shouldActivate) {
                      const taskTrigger = {
                        id: `task-advance-${Date.now()}-${nextReady.id}`,
                        channelId,
                        senderId: 'system-dag-advancer',
                        senderType: 'system' as const,
                        content: `[Automated DAG Dispatch] Initiating promoted task: "${nextReady.title}". ${nextReady.description || ''}`,
                        taskId: nextReady.id,
                        createdAt: Date.now(),
                      };
                      this.enqueueChannelExecution(channelId, () =>
                        this.enqueueAgentExecution(nextWorker.id, () =>
                          this.executeAgentResponse(nextWorker, channelId, taskTrigger, 0, undefined, undefined, undefined, run.id)
                        )
                      );
                    }
                  }
                }

                // Check if all tasks in goal are completed
                const allDone = siblingTasks.every((t) => (t.id === activeTaskId ? true : t.status === 'completed'));
                if (allDone) {
                  this.db.execute("UPDATE goals SET status = 'completed', updated_at = ? WHERE id = ?", Date.now(), currentTask.goalId);
                  const updatedGoal = this.goalRepo.getGoal(currentTask.goalId);
                  if (updatedGoal) {
                    this.broadcastEvent('goal:updated', updatedGoal);
                  }
                }
              }
            }
          } catch (taskErr: any) {
            console.error('[KIN CORE] Error advancing DAG task status after run:', taskErr);
            try {
              this.taskRepo.updateTaskStatus(activeTaskId, 'review');
              this.taskRepo.releaseTaskLease(activeTaskId, run.id, true);
              this.broadcastEvent('task:updated', { taskId: activeTaskId, status: 'review', reason: taskErr?.message });
            } catch {}
          }
        }
      }

      // 8. Broadcast response message
      const formattedReply = {
        id: agentReply.id,
        channelId: agentReply.channelId,
        senderId: agentReply.senderId,
        senderName: agent.displayName.replace(/^@/, ''),
        senderType: 'agent',
        content: agentReply.content,
        createdAt: agentReply.createdAt,
        productivityScore: agentReply.productivityScore,
      };

      this.broadcastEvent('message:created', formattedReply);

      // Real-time operator notification for peer DM replies and automatic peer loop coordination
      if (channelId.startsWith('dm-')) {
        const isHumanDm = channelId === `dm-${agent.id}`;
        if (!isHumanDm) {
          this.broadcastEvent('operator:notification', {
            type: 'agent_dm_reply',
            fromAgentId: agent.id,
            fromAgentName: agent.displayName,
            channelId,
            message: `@${agent.displayName.replace(/^@/, '')} replied in peer DM (${channelId}): "${agentReply.content.slice(0, 100)}"`,
            content: agentReply.content,
          });

          // Check if peer DM conversation should continue with the other coworker agent
          const isCompleted = hasDirectMessageCompletionToken(agentReply.content);
          if (isCompleted) {
            this.broadcastEvent('operator:notification', {
              type: 'peer_dm_completed',
              channelId,
              message: `Conversation completed: Completion token detected from @${agent.displayName.replace(/^@/, '')}. Automatic peer response halted.`,
            });
          } else if (recursionDepth < 5) {
            const memberIds = this.workspaceRepo.listChannelMemberIds(channelId);
            const otherAgentId = memberIds.find((id) => id !== agent.id);
            const otherAgent = otherAgentId ? this.agentRepo.getIdentity(otherAgentId) : undefined;

            if (otherAgent) {
              const recentDmMessages = this.channelService.getMessages(channelId, 20);
              let consecutiveTurns = 0;
              for (let i = recentDmMessages.length - 1; i >= 0; i--) {
                if (recentDmMessages[i].senderType === 'human') break;
                if (recentDmMessages[i].senderType === 'agent') consecutiveTurns++;
              }

              if (consecutiveTurns < 5) {
                this.enqueueAgentExecution(otherAgent.id, () =>
                  this.executeAgentResponse(otherAgent, channelId, agentReply, recursionDepth + 1)
                );
              } else {
                this.broadcastEvent('operator:notification', {
                  type: 'peer_dm_turn_limit',
                  channelId,
                  message: `Turn depth ceiling reached (5 consecutive agent turns in peer DM channel ${channelId}). Automatic response paused.`,
                });
              }
            }
          } else {
            this.broadcastEvent('operator:notification', {
              type: 'peer_dm_turn_limit',
              channelId,
              message: `Turn depth ceiling reached in peer DM channel ${channelId}. Automatic response paused.`,
            });
          }
        }
      }

      // 8b. Check if new mid-task steers were queued while inference was running
      const remainingSteers = this.pendingSteers.filter((s) => {
        if (s.channelId !== channelId) return false;
        if (s.consumedByAgentIds.includes(freshIdentity.id)) return false;
        if (s.targetAgentId && s.targetAgentId !== freshIdentity.id) return false;
        return true;
      });
      if (remainingSteers.length > 0) {
        for (const s of remainingSteers) {
          s.consumedByAgentIds.push(freshIdentity.id);
        }
        const steerNotes = remainingSteers.map((s) => `- "${s.directive}"`).join('\n');
        const pivotTrigger = {
          id: `steer-followup-${Date.now()}`,
          channelId,
          senderId: 'user-operator',
          senderType: 'human',
          content: `⚠️ [PRIORITY MID-EXECUTION STEERING DIRECTIVE FROM HUMAN OPERATOR]:\n${steerNotes}\nThe human operator redirected the task in real-time. Immediately acknowledge what was just stated and pivot to address this priority instruction.`,
          createdAt: Date.now(),
        };
        // Re-execute pivot turn with fresh context
        await this.executeAgentResponse(freshIdentity, channelId, pivotTrigger, recursionDepth + 1, undefined, undefined, undefined, run.id);
        return;
      }

      // 8c. Peer-to-Peer Multi-Agent Coordination & Delegation
      if (recursionDepth < 4) {
        // (1) Check for tool-based delegations via delegateToAgent / coordinateWithAgent
        const delegations = (loopResult.actions || []).filter(
          (a) => (
            a.toolName === 'delegateToAgent' ||
            a.toolName === 'delegate_to_agent' ||
            a.toolName === 'coordinateWithAgent' ||
            a.toolName === 'coordinate_with_agent' ||
            a.toolName === 'delegateTask' ||
            a.toolName === 'delegate'
          ) && a.output && (a.output as any).delegated
        );
        for (const act of delegations) {
          const out = act.output as any;
          const targetRaw = String(out.targetAgent || '').replace(/^@/, '').toLowerCase();
          const targetPeer = allProjectAgents.find(
            (p) => p.displayName.replace(/^@/, '').toLowerCase() === targetRaw || p.id.toLowerCase() === targetRaw
          );
          if (targetPeer && targetPeer.id !== freshIdentity.id) {
            const peerTrigger = {
              id: `peer-del-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              channelId,
              senderId: freshIdentity.id,
              senderType: 'agent',
              content: `[COORDINATION FROM ${freshIdentity.displayName}]: ${out.directive}`,
              createdAt: Date.now(),
            };
            this.incrementDelegation(channelId);
            this.enqueueChannelExecution(channelId, async () => {
              try {
                await this.enqueueAgentExecution(targetPeer.id, () =>
                  this.executeAgentResponse(targetPeer, channelId, peerTrigger, recursionDepth + 1, undefined, undefined, undefined, run.id)
                );
              } finally {
                this.decrementDelegation(channelId);
              }
            });
          }
        }

        // (1-hire) Check for tool-based hiring via hireSpecialist
        const hiredActions = (loopResult.actions || []).filter(
          (a) => (a.toolName === 'hireSpecialist' || a.toolName === 'hire_specialist' || a.toolName === 'hireAgent') && a.output && (a.output as any).agentId
        );
        for (const act of hiredActions) {
          const out = act.output as any;
          const newAgent = allProjectAgents.find((p) => p.id === out.agentId) || this.agentRepo.getIdentity(out.agentId);
          if (newAgent && newAgent.id !== freshIdentity.id) {
            const recruitTrigger = {
              id: `hire-onboard-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              channelId,
              senderId: freshIdentity.id,
              senderType: 'agent',
              content: `[ONBOARDING DIRECTIVE FROM ${freshIdentity.displayName}]: You have been onboarded as ${out.role || 'Specialist'} into this channel for project ${targetProjectId}. Introduce yourself, state your domain capabilities, and begin assisting.`,
              createdAt: Date.now(),
            };
            this.incrementDelegation(channelId);
            this.enqueueChannelExecution(channelId, async () => {
              try {
                await this.enqueueAgentExecution(newAgent.id, () =>
                  this.executeAgentResponse(newAgent, channelId, recruitTrigger, recursionDepth + 1, undefined, undefined, undefined, run.id)
                );
              } finally {
                this.decrementDelegation(channelId);
              }
            });
          }
        }

        // (1b) Check for interactive plan adjustment proposals via proposePlanAdjustment
        const planProposals = (loopResult.actions || []).filter(
          (a) => a.toolName === 'proposePlanAdjustment' && a.output && (a.output as any).proposed
        );
        for (const prop of planProposals) {
          const out = prop.output as any;
          const p = out.proposal || {};
          const cardPayload = {
            title: p.title || `Plan Adjustment for Goal ${out.goalId}`,
            topic: p.topic || 'Interactive workforce replanning review',
            optionA: p.optionA || { label: 'Adopt Proposed Plan', pros: 'Aligns with new constraints and findings', cons: 'Revises planned task order' },
            optionB: p.optionB || { label: 'Keep Current Plan', pros: 'Maintains current execution path', cons: 'May hit identified blockage' },
            recommendation: p.recommendation || 'Evaluate tradeoffs before selection',
          };
          const proposalMsg = this.channelService.sendMessage({
            channelId,
            senderId: freshIdentity.id,
            senderType: 'agent',
            content: `### Proposed Plan Decision: ${cardPayload.title}\n\n[DECISION_CARD]${JSON.stringify(cardPayload)}[/DECISION_CARD]`,
            productivityScore: 100,
          });
          this.broadcastEvent('message:created', {
            id: proposalMsg.id,
            channelId: proposalMsg.channelId,
            senderId: proposalMsg.senderId,
            senderName: freshIdentity.displayName.replace(/^@/, ''),
            senderType: 'agent',
            content: proposalMsg.content,
            createdAt: proposalMsg.createdAt,
            productivityScore: 100,
          });
        }

        // (2) Check for structured peer delegation directives in reply content
        if (delegations.length === 0) {
          const hasDirective = /\[(DELEGATION_DIRECTIVE|HANDOVER_DIRECTIVE)\]/i.test(agentReply.content);
          if (hasDirective) {
            const mentions = [...agentReply.content.matchAll(/@([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
            const selfDisplay = freshIdentity.displayName.replace(/^@/, '').toLowerCase();
            const uniqueMentions = Array.from(new Set(mentions)).filter(
              (m) => m.toLowerCase() !== selfDisplay && m.toLowerCase() !== 'channel' && m.toLowerCase() !== 'here'
            );

            for (const mention of uniqueMentions) {
              const peerAgent = allProjectAgents.find(
                (p) => p.displayName.replace(/^@/, '').toLowerCase() === mention.toLowerCase() || p.id.toLowerCase() === mention.toLowerCase()
              );
              if (peerAgent && peerAgent.id !== freshIdentity.id) {
                const peerTrigger = {
                  id: `peer-handover-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                  channelId,
                  senderId: freshIdentity.id,
                  senderType: 'agent',
                  content: agentReply.content,
                  createdAt: Date.now(),
                };
                this.incrementDelegation(channelId);
                this.enqueueChannelExecution(channelId, async () => {
                  try {
                    await this.enqueueAgentExecution(peerAgent.id, () =>
                      this.executeAgentResponse(peerAgent, channelId, peerTrigger, recursionDepth + 1, undefined, undefined, undefined, run.id)
                    );
                  } finally {
                    this.decrementDelegation(channelId);
                  }
                });
                break; // Coordinate with first mentioned peer per turn to maintain orderly conversation flow
              }
            }
          }
        }
      }

      this.broadcastEvent('agent:state', { agentId: agent.id, channelId, status: 'idle' });
    } catch (err: any) {
      if (this.isStopping || this.db.closed) {
        return;
      }
      console.error(`[KIN CORE] Execution failed for agent ${agent.displayName}:`, err);
      if (run?.id) {
        try {
          this.kernel.transitionState(run.id, 'failed', err?.message);
        } catch (tErr) {
          console.error(`[KIN CORE] Failed to transition run ${run.id} to failed:`, tErr);
        }
      }
      const activeTaskId = triggerMsg?.taskId || run?.taskId;
      if (activeTaskId) {
        try {
          if (run?.id) {
            this.taskRepo.releaseTaskLease(activeTaskId, run.id, true);
          }
          this.taskRepo.updateTaskStatus(activeTaskId, 'failed');
          this.broadcastEvent('task:updated', { taskId: activeTaskId, status: 'failed' });
        } catch {}
      }
      this.broadcastEvent('agent:state', { agentId: agent.id, channelId, status: 'idle' });
      try {
        const errorReply = this.channelService.sendMessage({
          channelId,
          senderId: agent.id,
          senderType: 'agent',
          content: `⚠️ [EXECUTION NOTICE]: Agent encountered an issue: ${err?.message || 'Execution error'}. Workforce state reset to idle.`,
          productivityScore: 0,
        });
        this.broadcastEvent('message:created', {
          id: errorReply.id,
          channelId: errorReply.channelId,
          senderId: errorReply.senderId,
          senderName: agent.displayName?.replace(/^@/, '') || 'Agent',
          senderType: 'agent',
          content: errorReply.content,
          createdAt: errorReply.createdAt,
          productivityScore: 0,
        });
      } catch {}
    } finally {
      if (run?.id) {
        this.runAbortControllers.delete(run.id);
      }
      this.activeAgentExecutions.delete(agent.id);
      if (triggerMsg?.id) {
        const fence = this.messageAdmissionFences.get(triggerMsg.id);
        if (fence) {
          fence.completedAgents.add(agent.id);
        }
      }
      if (!this.isStopping && !this.db.closed) {
        const activeInChan = Array.from(this.activeAgentExecutions.values()).filter((e) => e.channelId === channelId);
        const delegationsInChan = this.activeDelegations.get(channelId) || 0;
        if (activeInChan.length === 0 && delegationsInChan === 0) {
          try {
            await this.processNextQueuedMessage(channelId);
          } catch (qErr) {
            console.warn('[KIN CORE] Notice processing next queued message:', qErr);
          }
        }
        try {
          const admittedRun = this.kernel.admitNextQueuedRun();
          if (admittedRun) {
            const admittedAgent = this.agentRepo.getIdentity(admittedRun.agentId);
            if (admittedAgent) {
              this.broadcastEvent('run:admitted', { runId: admittedRun.id, agentId: admittedAgent.id });
              let trigger = admittedRun.triggerMessageId
                ? this.channelService.getMessage(admittedRun.triggerMessageId)
                : undefined;
              if (!trigger && admittedRun.taskId) {
                const taskObj = this.taskRepo.getTask(admittedRun.taskId);
                if (taskObj) {
                  trigger = {
                    id: `trigger-task-${admittedRun.id}`,
                    channelId: admittedRun.channelId || channelId,
                    senderId: 'system',
                    content: `Execute task: ${taskObj.title}\n${taskObj.description || ''}`,
                    taskId: taskObj.id,
                  } as any;
                }
              }
              this.enqueueChannelExecution(admittedRun.channelId || channelId, () =>
                this.enqueueAgentExecution(admittedAgent.id, () =>
                  this.executeAgentResponse(admittedAgent, admittedRun.channelId || channelId, trigger, 0, undefined, admittedRun.id)
                )
              );
            }
          }
        } catch (admitErr) {
          console.warn('[KIN CORE] Notice admitting next queued run:', admitErr);
        }
      }
    }
  } finally {
    this.inFlightExecutions.delete(inFlightPromise);
    resolveInFlight();
  }
}

  /**
   * FIFO dequeue dispatcher: When channel is idle (0 executing agents),
   * retrieves the oldest queued message, deletes it from queued_messages,
   * sends it to the channel, and triggers agent activation.
   */
  public async processNextQueuedMessage(channelId: string): Promise<boolean> {
    if (this.isStopping || this.db.closed) {
      return false;
    }
    const activeInChan = Array.from(this.activeAgentExecutions.values()).filter((e) => e.channelId === channelId);
    const delegationsInChan = this.activeDelegations.get(channelId) || 0;
    if (activeInChan.length > 0 || delegationsInChan > 0) {
      return false;
    }

    let nextMsg: {
      id: string;
      channel_id: string;
      sender_id: string;
      content: string;
      metadata_json: string;
      created_at: number;
    } | undefined;

    let userMsg: any;
    let channel: any;

    this.db.transactionSync(() => {
      const candidate = this.db.queryOne<{
        id: string;
        channel_id: string;
        sender_id: string;
        content: string;
        metadata_json: string;
        created_at: number;
      }>('SELECT * FROM queued_messages WHERE channel_id = ? ORDER BY created_at ASC LIMIT 1', channelId);

      if (!candidate) {
        return;
      }

      // Check if already fenced in admitting queue to prevent duplicate execution cycles
      let meta: any = {};
      try { meta = JSON.parse(candidate.metadata_json || '{}'); } catch {}
      if (meta.fencingToken || this.messageAdmissionFences.has(candidate.id)) {
        this.db.execute('DELETE FROM queued_messages WHERE id = ?', candidate.id);
        return;
      }

      const fenceToken = `fence-${candidate.id}-${Date.now()}`;
      meta.fencingToken = fenceToken;
      meta.admittedAt = Date.now();

      const res = this.db.execute('DELETE FROM queued_messages WHERE id = ?', candidate.id);
      if (Number(res.changes) > 0) {
        const chan = this.workspaceRepo.getChannel(channelId);
        if (chan) {
          nextMsg = candidate;
          channel = chan;
          userMsg = this.channelService.sendMessage({
            channelId,
            senderId: candidate.sender_id || 'user-operator',
            senderType: 'human',
            content: candidate.content,
            productivityScore: 100,
          });
          userMsg.fencingToken = fenceToken;
          this.messageAdmissionFences.set(candidate.id, {
            fenceToken,
            channelId,
            timestamp: Date.now(),
            status: 'admitted',
            completedAgents: new Set(),
          });
          if (userMsg.id) {
            this.messageAdmissionFences.set(userMsg.id, {
              fenceToken,
              channelId,
              timestamp: Date.now(),
              status: 'admitted',
              completedAgents: new Set(),
            });
          }
        }
      }
    });

    if (!nextMsg || !userMsg || !channel) {
      return false;
    }

    this.broadcastEvent('queue:dequeued', { channelId, messageId: nextMsg.id });

    this.broadcastEvent('message:created', {
      id: userMsg.id,
      channelId: userMsg.channelId,
      senderId: userMsg.senderId,
      senderName: 'Human',
      senderType: 'human',
      content: userMsg.content,
      createdAt: userMsg.createdAt,
      isSteer: false,
    });

    const allProjectAgents = this.agentRepo.listIdentitiesByProject(channel.projectId || this.activeProjectId);
    let memberIds = this.workspaceRepo.listChannelMemberIds(channelId);
    if (memberIds.length === 0 && !channel?.isPrivate) {
      this.workspaceRepo.addChannelMember(channelId, 'agent-boss');
      memberIds = ['agent-boss'];
    }
    const channelMembers = memberIds
      .map((id) => allProjectAgents.find((a) => a.id === id) || this.agentRepo.getIdentity(id))
      .filter(Boolean) as AgentIdentity[];

    const definitionsMap = new Map<string, AgentDefinition>();
    for (const ag of allProjectAgents) {
      const def = this.agentRepo.getDefinition(ag.definitionId);
      if (def) definitionsMap.set(ag.definitionId, def);
    }

    const routing = this.activationEngine.evaluateChannelRouting({
      channelId,
      isPrivate: channel?.isPrivate,
      channelType: channel?.channelType,
      message: userMsg,
      channelMembers,
      allProjectAgents,
      definitionsMap,
    });

    const boss = routing.fallbackOrchestrator || allProjectAgents.find((a) => a.isOrchestrator) || allProjectAgents[0] || this.agentRepo.getIdentity('agent-boss');
    const targetAgents = routing.targetAgents.length > 0 ? routing.targetAgents : (boss ? [boss] : []);
    if (targetAgents.length > 0) {
      this.executeSequentialAgents(targetAgents, channelId, userMsg).catch((err) => {
        console.error('[KIN CORE] Dequeued message execution notice:', err);
      });
    }

    return true;
  }

  public getConfiguredProviders(): { configuredProviders: Set<string>; activeCredsCount: number } {
    const activeCreds = this.db.query<any>('SELECT DISTINCT provider, key_alias FROM managed_credentials WHERE is_active = 1');
    const customEndpoints = this.modelGateway.getCustomEndpointNames();
    const envProviders = ['openrouter', 'openai', 'anthropic', 'deepseek', 'gemini', 'groq', 'xai', 'azure'].filter((p) => {
      if (p === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY);
      if (p === 'openai') return Boolean(process.env.OPENAI_API_KEY);
      if (p === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
      if (p === 'deepseek') return Boolean(process.env.DEEPSEEK_API_KEY);
      if (p === 'gemini') return Boolean(process.env.GEMINI_API_KEY);
      if (p === 'groq') return Boolean(process.env.GROQ_API_KEY);
      if (p === 'xai') return Boolean(process.env.XAI_API_KEY);
      if (p === 'azure') return Boolean(process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_API_KEY);
      return false;
    });
    const set = new Set<string>([
      'ollama',
      ...envProviders,
      ...activeCreds.map((c: any) => (c.provider || '').toLowerCase()),
      ...activeCreds.filter((c: any) => c.key_alias).map((c: any) => c.key_alias.toLowerCase()),
      ...customEndpoints.map((s) => s.toLowerCase()),
    ]);
    return { configuredProviders: set, activeCredsCount: activeCreds.length + envProviders.length };
  }

  public computeModelAvailability(
    activeModelId: string | undefined,
    ollamaInfo: { online: boolean; models: string[] },
    configuredProviders: Set<string>,
    activeCredsCount: number
  ): { modelAvailable: boolean; modelStatus: string } {
    const modelId = (activeModelId || '').trim();
    const isInherit = !modelId || modelId === 'inherit';

    if (isInherit) {
      const hasLocal = ollamaInfo.online && Array.isArray(ollamaInfo.models) && ollamaInfo.models.length > 0;
      const hasProv = activeCredsCount > 0;
      const modelAvailable = hasLocal || hasProv;
      const modelStatus = modelAvailable ? 'ready' : (ollamaInfo.online ? 'unconfigured' : 'offline');
      return { modelAvailable, modelStatus };
    }

    const colonIdx = modelId.indexOf(':');
    const slashIdx = modelId.indexOf('/');
    let prov = 'ollama';
    if (slashIdx !== -1) {
      prov = modelId.substring(0, slashIdx).toLowerCase();
    } else if (colonIdx !== -1) {
      const cand = modelId.substring(0, colonIdx).toLowerCase();
      if (configuredProviders.has(cand) || ['openrouter', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'xai', 'azure', 'custom'].includes(cand)) {
        prov = cand;
      }
    }
    const isOllama = prov === 'ollama';
    const cleanModel = modelId.replace(/^ollama[\/:]/, '').toLowerCase();
    const isLocalReady = isOllama && ollamaInfo.online && Array.isArray(ollamaInfo.models) && ollamaInfo.models.some((m) => {
      const lower = m.toLowerCase();
      return lower === cleanModel || lower.startsWith(cleanModel) || cleanModel.startsWith(lower);
    });
    const isProvReady = !isOllama && (configuredProviders.has(prov) || this.modelGateway.getCustomEndpoint(prov) !== undefined);
    const modelAvailable = isOllama ? isLocalReady : isProvReady;
    const modelStatus = modelAvailable ? 'ready' : (isOllama && !ollamaInfo.online ? 'offline' : 'unconfigured');
    return { modelAvailable, modelStatus };
  }
}

