// ============================================================================
// KIN CORE IPC SERVER & RUNTIME DAEMON
// Local HTTP REST + Server-Sent Events (SSE) server for UI-to-Core IPC.
// Genuinely connects desktop UI to SQLite state, AgentKernel, and ModelGateway.
// ============================================================================

import * as http from 'node:http';
import * as url from 'node:url';
import { KinDatabase } from '../storage/db.js';
import { MigrationRunner } from '../storage/migration_runner.js';
import { WorkspaceRepository } from '../domain/workspace_repository.js';
import { AgentRepository } from '../domain/agent_repository.js';
import { ChannelService } from '../communication/channel_service.js';
import { ActivationEngine } from '../communication/activation_engine.js';
import { AgentKernel } from '../kernel/agent_kernel.js';
import { PolicyEngine } from '../policy/policy_engine.js';
import { ModelGateway } from '../execution/model_gateway.js';
import { ContextCompiler } from '../context/context_compiler.js';
import { v4 as uuidv4 } from 'uuid';

export interface CoreServerOptions {
  port?: number;
  dbPath?: string;
}

export class CoreServer {
  private port: number;
  private server?: http.Server;
  private db: KinDatabase;
  private workspaceRepo: WorkspaceRepository;
  private agentRepo: AgentRepository;
  private channelService: ChannelService;
  private activationEngine: ActivationEngine;
  private kernel: AgentKernel;
  private policyEngine: PolicyEngine;
  private modelGateway: ModelGateway;
  private contextCompiler: ContextCompiler;
  private sseClients: Set<http.ServerResponse> = new Set();

  constructor(options: CoreServerOptions = {}) {
    this.port = options.port ?? 54321;
    this.db = new KinDatabase({ dbPath: options.dbPath ?? './kin_storage.sqlite' });
    
    // Ensure migrations have executed
    const migrationRunner = new MigrationRunner(this.db);
    migrationRunner.runMigrations();

    this.workspaceRepo = new WorkspaceRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
    this.channelService = new ChannelService(this.db);
    this.activationEngine = new ActivationEngine();
    this.kernel = new AgentKernel(this.db);
    this.policyEngine = new PolicyEngine();
    this.modelGateway = new ModelGateway();
    this.contextCompiler = new ContextCompiler();

    this.seedDefaultStateIfEmpty();
  }

  /**
   * Seeds default workspace, project, channels, and agents if fresh DB.
   */
  private seedDefaultStateIfEmpty(): void {
    const existingWs = this.workspaceRepo.getWorkspace('ws-default');
    if (!existingWs) {
      const now = Date.now();
      // 1. Workspace
      this.workspaceRepo.createWorkspace({
        id: 'ws-default',
        name: 'KIN Core Workspace',
        rootPath: process.cwd(),
        defaultAutonomyMode: 'AUTO',
        createdAt: now,
        updatedAt: now,
      });

      // 2. Project
      this.workspaceRepo.createProject({
        id: 'proj-kin',
        workspaceId: 'ws-default',
        name: 'KIN System',
        repoPath: process.cwd(),
        settings: { defaultBranch: 'master' },
        createdAt: now,
        updatedAt: now,
      });

      // 3. Channels
      this.workspaceRepo.createChannel({
        id: 'chan-architecture',
        projectId: 'proj-kin',
        name: 'architecture',
        topic: 'System schema contracts & API architecture',
        isPrivate: false,
        createdAt: now,
      });

      this.workspaceRepo.createChannel({
        id: 'chan-engineering',
        projectId: 'proj-kin',
        name: 'engineering',
        topic: 'Frontend, backend & database execution',
        isPrivate: false,
        createdAt: now,
      });

      this.workspaceRepo.createChannel({
        id: 'chan-approvals',
        projectId: 'proj-kin',
        name: 'approvals',
        topic: 'Consequential action approval gate',
        isPrivate: false,
        createdAt: now,
      });

      // 4. Agent Definitions & Identities
      const agents = [
        {
          defId: 'def-orch',
          id: 'agent-orch',
          name: 'Default Orchestrator',
          displayName: '@Orchestrator',
          role: 'Workspace Coordinator',
          modelId: 'anthropic/claude-3-5-sonnet',
          isOrch: true,
        },
        {
          defId: 'def-backend',
          id: 'agent-backend',
          name: 'Backend Lead',
          displayName: '@BackendLead',
          role: 'Backend Architect',
          modelId: 'openai/gpt-4o',
          isOrch: false,
        },
        {
          defId: 'def-frontend',
          id: 'agent-frontend',
          name: 'Frontend Lead',
          displayName: '@FrontendLead',
          role: 'UI Architect',
          modelId: 'deepseek/deepseek-chat',
          isOrch: false,
        },
        {
          defId: 'def-db',
          id: 'agent-db',
          name: 'Database Worker',
          displayName: '@DatabaseWorker',
          role: 'Database Engineer',
          modelId: 'ollama/qwen2.5-coder',
          isOrch: false,
        },
      ];

      for (const a of agents) {
        this.agentRepo.createDefinition({
          id: a.defId,
          name: a.name,
          role: a.role,
          systemPrompt: `You are ${a.displayName}, the ${a.role} of KIN. Maintain strict domain boundaries and verify all solutions.`,
          defaultModelId: a.modelId,
          domainAuthority: [a.role],
          capabilities: ['read', 'write'],
          createdAt: now,
        });

        this.agentRepo.createIdentity({
          id: a.id,
          workspaceId: 'ws-default',
          definitionId: a.defId,
          displayName: a.displayName,
          activeModelId: a.modelId,
          isOrchestrator: a.isOrch,
          isEphemeral: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      // 5. Initial Welcome Message
      this.channelService.sendMessage({
        channelId: 'chan-architecture',
        senderId: 'agent-orch',
        senderType: 'agent',
        content: 'KIN Workforce initialized. Workspace default autonomy mode is set to AUTO. Agents are assigned to their user-configured models.',
        productivityScore: 100,
      });

      // 6. Create a seed run for initial approval demo
      const seedRun = this.kernel.spawnRun({
        agentId: 'agent-db',
        projectId: 'proj-kin',
        allocatedTokens: 50000,
      });

      // 7. Seed pending approval
      this.db.execute(
        `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'appr-001',
        seedRun.id,
        'agent-db',
        'executeShell',
        JSON.stringify({ command: 'rm -rf .kin/worktrees/task-102/cache/db' }),
        'HIGH',
        'pending',
        now + 3600000,
        now
      );
    }
  }

  /**
   * Starts HTTP and SSE server.
   */
  public start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        this.port = actualPort;
        console.log(`[KIN CORE DAEMON] Listening on http://127.0.0.1:${this.port}`);
        resolve(this.port);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.sseClients) {
        client.end();
      }
      this.sseClients.clear();

      if (this.server) {
        this.server.close(() => {
          this.db.close();
          resolve();
        });
      } else {
        this.db.close();
        resolve();
      }
    });
  }

  public getDatabase(): KinDatabase {
    return this.db;
  }

  private broadcastEvent(eventType: string, data: any): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      client.write(payload);
    }
  }

  private handleCors(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
    this.handleCors(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private async parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.handleCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;

    try {
      // 1. SSE Stream
      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(': connected\n\n');
        this.sseClients.add(res);

        req.on('close', () => {
          this.sseClients.delete(res);
        });
        return;
      }

      // 2. GET /api/state — Full authoritative snapshot from SQLite
      if (req.method === 'GET' && pathname === '/api/state') {
        const ws = this.workspaceRepo.getWorkspace('ws-default');
        const channels = this.workspaceRepo.listChannels('proj-kin');
        const agents = this.agentRepo.listIdentities('ws-default');
        const activeChannelId = channels[0]?.id || 'chan-architecture';
        const messages = this.channelService.getMessages(activeChannelId, 100);

        // Fetch pending approvals
        const rawApprovals = this.db.query<{
          id: string;
          run_id: string;
          agent_id: string;
          tool_name: string;
          action_payload_json: string;
          risk_level: string;
          created_at: number;
        }>("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC");

        const pendingApprovals = rawApprovals.map((a) => {
          const agent = agents.find((ag) => ag.id === a.agent_id);
          const payload = JSON.parse(a.action_payload_json);
          return {
            id: a.id,
            runId: a.run_id,
            agentName: agent?.displayName ?? '@UnknownAgent',
            toolName: a.tool_name,
            actionSummary: payload?.command || JSON.stringify(payload),
            riskLevel: a.risk_level,
            createdAt: a.created_at,
          };
        });

        // Enrich agents with runtime role & definition
        const agentDisplays = agents.map((a) => {
          const def = this.agentRepo.getDefinition(a.definitionId);
          return {
            id: a.id,
            name: def?.name ?? a.displayName,
            role: def?.role ?? 'Agent',
            displayName: a.displayName,
            activeModelId: a.activeModelId,
            fallbackModelId: a.fallbackModelId,
            status: 'idle',
            isOrchestrator: a.isOrchestrator,
          };
        });

        return this.sendJson(res, 200, {
          workspace: ws,
          autonomyMode: ws?.defaultAutonomyMode ?? 'AUTO',
          activeChannelId,
          channels: channels.map((c) => ({
            id: c.id,
            name: c.name,
            topic: c.topic,
            unreadCount: 0,
          })),
          agents: agentDisplays,
          messages: messages.map((m) => {
            const agent = agents.find((a) => a.id === m.senderId);
            return {
              id: m.id,
              channelId: m.channelId,
              senderId: m.senderId,
              senderName: m.senderType === 'human' ? 'You (Human Operator)' : agent?.displayName ?? m.senderId,
              senderType: m.senderType,
              content: m.content,
              createdAt: m.createdAt,
              productivityScore: m.productivityScore,
            };
          }),
          pendingApprovals,
        });
      }

      // 3. GET /api/channels/:channelId/messages
      const channelMessagesMatch = pathname.match(/^\/api\/channels\/([^/]+)\/messages$/);
      if (req.method === 'GET' && channelMessagesMatch) {
        const channelId = channelMessagesMatch[1];
        const messages = this.channelService.getMessages(channelId, 100);
        const agents = this.agentRepo.listIdentities('ws-default');

        return this.sendJson(res, 200, {
          messages: messages.map((m) => {
            const agent = agents.find((a) => a.id === m.senderId);
            return {
              id: m.id,
              channelId: m.channelId,
              senderId: m.senderId,
              senderName: m.senderType === 'human' ? 'You (Human Operator)' : agent?.displayName ?? m.senderId,
              senderType: m.senderType,
              content: m.content,
              createdAt: m.createdAt,
              productivityScore: m.productivityScore,
            };
          }),
        });
      }

      // 4. POST /api/channels/:channelId/messages
      if (req.method === 'POST' && channelMessagesMatch) {
        const channelId = channelMessagesMatch[1];
        const body = await this.parseJsonBody<{ content: string; senderId?: string }>(req);

        if (!body.content || !body.content.trim()) {
          return this.sendJson(res, 400, { error: 'Message content cannot be empty' });
        }

        // Persist human message
        const userMsg = this.channelService.sendMessage({
          channelId,
          senderId: body.senderId || 'user-operator',
          senderType: 'human',
          content: body.content.trim(),
        });

        const formattedUserMsg = {
          id: userMsg.id,
          channelId: userMsg.channelId,
          senderId: userMsg.senderId,
          senderName: 'You (Human Operator)',
          senderType: 'human',
          content: userMsg.content,
          createdAt: userMsg.createdAt,
        };

        this.broadcastEvent('message:created', formattedUserMsg);

        // Run activation engine to see which agents need to react
        const activeAgents = this.agentRepo.listIdentities('ws-default');
        const triggeredAgents = activeAgents.filter((agent) => {
          const decision = this.activationEngine.evaluateActivation(agent, {
            type: 'message',
            message: userMsg,
          });
          return decision.shouldActivate;
        });

        // Respond immediately to the HTTP request with the created user message
        this.sendJson(res, 201, { message: formattedUserMsg, triggeredCount: triggeredAgents.length });

        // Trigger agent runs asynchronously for each activated agent
        for (const agent of triggeredAgents) {
          this.executeAgentResponse(agent, channelId, userMsg);
        }
        return;
      }

      // 5. PATCH /api/agents/:agentId/model — Explicit per-agent model update
      const agentModelMatch = pathname.match(/^\/api\/agents\/([^/]+)\/model$/);
      if (req.method === 'PATCH' && agentModelMatch) {
        const agentId = agentModelMatch[1];
        const body = await this.parseJsonBody<{ activeModelId: string; fallbackModelId?: string }>(req);

        if (!body.activeModelId) {
          return this.sendJson(res, 400, { error: 'activeModelId is required' });
        }

        this.agentRepo.updateAgentModelConfig(agentId, body.activeModelId, body.fallbackModelId);
        this.broadcastEvent('agent:updated', { agentId, activeModelId: body.activeModelId });
        return this.sendJson(res, 200, { success: true, agentId, activeModelId: body.activeModelId });
      }

      // 6. PATCH /api/workspace/autonomy — Update autonomy mode
      if (req.method === 'PATCH' && pathname === '/api/workspace/autonomy') {
        const body = await this.parseJsonBody<{ autonomyMode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS' }>(req);
        if (!body.autonomyMode) {
          return this.sendJson(res, 400, { error: 'autonomyMode is required' });
        }

        this.db.execute(
          `UPDATE workspaces SET default_autonomy_mode = ?, updated_at = ? WHERE id = 'ws-default'`,
          body.autonomyMode,
          Date.now()
        );

        this.broadcastEvent('autonomy:updated', { autonomyMode: body.autonomyMode });
        return this.sendJson(res, 200, { success: true, autonomyMode: body.autonomyMode });
      }

      // 7. POST /api/approvals/:approvalId/resolve — Resolve approval gate
      const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/resolve$/);
      if (req.method === 'POST' && approvalMatch) {
        const approvalId = approvalMatch[1];
        const body = await this.parseJsonBody<{ approved: boolean }>(req);

        const status = body.approved ? 'approved' : 'rejected';
        const now = Date.now();

        this.db.execute(
          `UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?`,
          status,
          now,
          approvalId
        );

        this.broadcastEvent('approval:resolved', { approvalId, approved: body.approved });
        return this.sendJson(res, 200, { success: true, approvalId, status });
      }

      return this.sendJson(res, 404, { error: 'Route not found' });
    } catch (err: any) {
      console.error('[KIN CORE SERVER ERROR]', err);
      return this.sendJson(res, 500, { error: err?.message || 'Internal Server Error' });
    }
  }

  /**
   * Asynchronously triggers agent run, compiles context, invokes ModelGateway,
   * persists response message to SQLite, and broadcasts event.
   */
  private async executeAgentResponse(agent: any, channelId: string, triggerMsg: any): Promise<void> {
    const def = this.agentRepo.getDefinition(agent.definitionId);
    this.broadcastEvent('agent:state', { agentId: agent.id, status: 'thinking' });

    try {
      // 1. Spawn run in AgentKernel
      const run = this.kernel.spawnRun({
        agentId: agent.id,
        projectId: 'proj-kin',
        allocatedTokens: 50000,
      });

      // 2. Compile prompt
      const compiled = this.contextCompiler.compile({
        agentDefinition: def ?? {
          id: agent.definitionId,
          name: agent.displayName,
          role: 'Agent',
          systemPrompt: 'You are an agent in the KIN workforce.',
          defaultModelId: agent.activeModelId,
          domainAuthority: [],
          capabilities: [],
          createdAt: Date.now(),
        },
        agentIdentity: agent,
        toolSchemas: [],
        projectDecisions: [],
        trajectoryMessages: this.channelService.getMessages(channelId, 10),
      });

      // 3. Invoke ModelGateway with the user's explicitly configured model
      const result = await this.modelGateway.invoke({
        modelId: agent.activeModelId,
        messages: [
          { role: 'system', content: compiled.systemPromptBlock },
          { role: 'user', content: triggerMsg.content },
        ],
      });

      // 4. Persist agent reply to SQLite
      const agentReply = this.channelService.sendMessage({
        channelId,
        senderId: agent.id,
        senderType: 'agent',
        content: result.content,
        productivityScore: result.isError ? 0 : 95,
      });

      // 5. Complete run in kernel
      this.kernel.transitionState(run.id, 'completed');

      // 6. Broadcast response message & update agent status to idle
      const formattedReply = {
        id: agentReply.id,
        channelId: agentReply.channelId,
        senderId: agentReply.senderId,
        senderName: agent.displayName,
        senderType: 'agent',
        content: agentReply.content,
        createdAt: agentReply.createdAt,
        productivityScore: agentReply.productivityScore,
      };

      this.broadcastEvent('message:created', formattedReply);
      this.broadcastEvent('agent:state', { agentId: agent.id, status: 'idle' });
    } catch (err: any) {
      console.error(`[KIN CORE] Execution failed for agent ${agent.displayName}:`, err);
      this.broadcastEvent('agent:state', { agentId: agent.id, status: 'idle' });
    }
  }
}
