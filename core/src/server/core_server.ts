// ============================================================================
// KIN CORE IPC SERVER & RUNTIME DAEMON
// Local HTTP REST + Server-Sent Events (SSE) server for UI-to-Core IPC.
// Genuinely connects desktop UI to SQLite state, AgentKernel, and ModelGateway.
// ============================================================================

import * as http from 'node:http';
import * as childProcess from 'node:child_process';
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
  private activeProjectId: string = 'proj-kin';

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
        settings: { defaultBranch: 'master' },
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
        topic: 'Workspace Sovereign Discussion',
        isPrivate: false,
        createdAt: now,
      });
    }

    // Ensure strictly ONE default agent: @Boss (Orchestrator)
    const bossIdentity = this.agentRepo.getIdentity('agent-boss');
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
        role: 'Lead Sovereign Orchestrator',
        systemPrompt: 'You are @Boss, the Lead Sovereign Orchestrator of KIN OS. You direct the workforce, execute project plans, manage worktrees, coordinate tools, and verify all technical deliverables. Workspace boundaries are strictly enforced.',
        defaultModelId: 'ollama/qwen2.5-coder:3b',
        domainAuthority: ['Architecture', 'Orchestration', 'Engineering', 'Operations'],
        capabilities: ['read', 'write', 'shell', 'worktree', 'delegate'],
        createdAt: now,
      });

      // Create @Boss identity
      this.agentRepo.createIdentity({
        id: 'agent-boss',
        workspaceId: 'ws-default',
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
        content: 'KIN OS initialized. I am @Boss, your Lead Sovereign Orchestrator. Workspace boundaries are strictly enforced.',
        productivityScore: 100,
      });
    }
  }

  /**
   * Queries Ollama for currently installed models and online status.
   */
  public async getLocalOllamaModels(): Promise<{ online: boolean; models: string[] }> {
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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
          resolve(body ? JSON.parse(body) : ({} as T));
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

      // 2. GET /api/system/models — Check installed local models
      if (req.method === 'GET' && pathname === '/api/system/models') {
        const ollamaInfo = await this.getLocalOllamaModels();
        return this.sendJson(res, 200, ollamaInfo);
      }

      // 3. POST /api/system/ollama/start — Start local Ollama daemon
      if (req.method === 'POST' && pathname === '/api/system/ollama/start') {
        const result = await this.startOllamaServer();
        this.broadcastEvent('ollama:status', result);
        return this.sendJson(res, result.success ? 200 : 500, result);
      }

      // 4. POST /api/system/terminal — Execute shell command in project directory
      if (req.method === 'POST' && pathname === '/api/system/terminal') {
        const body = await this.parseJsonBody<{ command: string; cwd?: string }>(req);
        if (!body.command) {
          return this.sendJson(res, 400, { error: 'Command is required' });
        }

        const project = this.workspaceRepo.getProject(this.activeProjectId);
        const workingDir = body.cwd || project?.repoPath || process.cwd();

        childProcess.exec(
          body.command,
          { cwd: workingDir, timeout: 30000, maxBuffer: 1024 * 1024 * 2 },
          (error, stdout, stderr) => {
            return this.sendJson(res, 200, {
              command: body.command,
              cwd: workingDir,
              stdout: stdout || '',
              stderr: stderr || (error ? error.message : ''),
              exitCode: error ? (error.code ?? 1) : 0,
            });
          }
        );
        return;
      }

      // 5. GET /api/projects — List all projects
      if (req.method === 'GET' && pathname === '/api/projects') {
        const projects = this.workspaceRepo.listProjects('ws-default');
        return this.sendJson(res, 200, { projects, activeProjectId: this.activeProjectId });
      }

      // 6. POST /api/projects — Create a new independent workspace project
      if (req.method === 'POST' && pathname === '/api/projects') {
        const body = await this.parseJsonBody<{ name: string; repoPath?: string }>(req);
        if (!body.name || !body.name.trim()) {
          return this.sendJson(res, 400, { error: 'Project name is required' });
        }

        const id = `proj-${Date.now()}`;
        const now = Date.now();
        const project = {
          id,
          workspaceId: 'ws-default',
          name: body.name.trim(),
          repoPath: body.repoPath?.trim() || `D:\\${body.name.trim()}`,
          settings: { defaultBranch: 'master' },
          createdAt: now,
          updatedAt: now,
        };

        this.workspaceRepo.createProject(project);

        // Create default #general channel for this project
        const channelId = `chan-${Date.now()}`;
        this.workspaceRepo.createChannel({
          id: channelId,
          projectId: id,
          name: 'general',
          topic: `${project.name} Sovereign Discussion`,
          isPrivate: false,
          createdAt: now,
        });

        // Set as active project
        this.activeProjectId = id;

        this.broadcastEvent('project:created', project);
        return this.sendJson(res, 201, { project, channelId });
      }

      // 7. DELETE /api/projects/:id — Remove project
      const projectDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (req.method === 'DELETE' && projectDeleteMatch) {
        const projectId = projectDeleteMatch[1];
        if (projectId === 'proj-kin') {
          return this.sendJson(res, 400, { error: 'Cannot delete primary root project' });
        }

        this.workspaceRepo.deleteProject(projectId);
        if (this.activeProjectId === projectId) {
          this.activeProjectId = 'proj-kin';
        }

        this.broadcastEvent('project:deleted', { projectId });
        return this.sendJson(res, 200, { success: true, activeProjectId: this.activeProjectId });
      }

      // 8. GET /api/state — Full authoritative snapshot from SQLite
      if (req.method === 'GET' && pathname === '/api/state') {
        const requestedProjId = parsedUrl.searchParams.get('projectId');
        if (requestedProjId) {
          const targetProj = this.workspaceRepo.getProject(requestedProjId);
          if (targetProj) {
            this.activeProjectId = requestedProjId;
          }
        }

        const ws = this.workspaceRepo.getWorkspace('ws-default');
        const projects = this.workspaceRepo.listProjects('ws-default');
        const activeProject = this.workspaceRepo.getProject(this.activeProjectId) || projects[0];
        
        let channels = this.workspaceRepo.listChannels(activeProject?.id || 'proj-kin');
        if (channels.length === 0 && activeProject) {
          // Fallback create general channel
          this.workspaceRepo.createChannel({
            id: `chan-${activeProject.id}-gen`,
            projectId: activeProject.id,
            name: 'general',
            topic: 'General Discussion',
            isPrivate: false,
            createdAt: Date.now(),
          });
          channels = this.workspaceRepo.listChannels(activeProject.id);
        }

        const activeChannelId = channels[0]?.id || 'chan-general';
        const messages = this.channelService.getMessages(activeChannelId, 100);

        // Fetch agents in workspace (Single agent: @Boss)
        const agents = this.agentRepo.listIdentities('ws-default');
        const agentDisplays = agents.map((a) => {
          const def = this.agentRepo.getDefinition(a.definitionId);
          return {
            id: a.id,
            name: def?.name ?? a.displayName,
            role: def?.role ?? 'Lead Sovereign Orchestrator',
            displayName: a.displayName,
            activeModelId: a.activeModelId,
            fallbackModelId: a.fallbackModelId,
            systemPrompt: def?.systemPrompt,
            status: 'idle',
            isOrchestrator: a.isOrchestrator,
          };
        });

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
            agentName: agent?.displayName ?? '@Boss',
            toolName: a.tool_name,
            actionSummary: payload?.command || JSON.stringify(payload),
            riskLevel: a.risk_level,
            createdAt: a.created_at,
          };
        });

        // Check Ollama status
        const ollamaInfo = await this.getLocalOllamaModels();

        return this.sendJson(res, 200, {
          workspace: ws,
          activeProject,
          projects,
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
              senderName: m.senderType === 'human' ? 'Human' : agent?.displayName ?? m.senderId,
              senderType: m.senderType,
              content: m.content,
              createdAt: m.createdAt,
              productivityScore: m.productivityScore,
            };
          }),
          pendingApprovals,
          ollamaStatus: ollamaInfo,
        });
      }

      // 9. GET /api/channels/:channelId/messages
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
              senderName: m.senderType === 'human' ? 'Human' : agent?.displayName ?? m.senderId,
              senderType: m.senderType,
              content: m.content,
              createdAt: m.createdAt,
              productivityScore: m.productivityScore,
            };
          }),
        });
      }

      // 10. POST /api/channels/:channelId/messages
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
          senderName: 'Human',
          senderType: 'human',
          content: userMsg.content,
          createdAt: userMsg.createdAt,
        };

        this.broadcastEvent('message:created', formattedUserMsg);

        // In a single-orchestrator environment, @Boss activates on all channel messages
        const activeAgents = this.agentRepo.listIdentities('ws-default');
        const boss = activeAgents.find((a) => a.isOrchestrator) || activeAgents[0];

        // Respond immediately with created user message
        this.sendJson(res, 201, { message: formattedUserMsg, triggeredCount: boss ? 1 : 0 });

        // Trigger @Boss response asynchronously
        if (boss) {
          this.executeAgentResponse(boss, channelId, userMsg);
        }
        return;
      }

      // 11. PATCH /api/agents/:agentId/model — Explicit per-agent model update
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

      // 12. PATCH /api/agents/:agentId/contract — Update agent role title and instructions
      const agentContractMatch = pathname.match(/^\/api\/agents\/([^/]+)\/contract$/);
      if (req.method === 'PATCH' && agentContractMatch) {
        const agentId = agentContractMatch[1];
        const body = await this.parseJsonBody<{ roleTitle?: string; systemPrompt?: string; activeModelId?: string }>(req);

        const identity = this.agentRepo.getIdentity(agentId);
        if (!identity) {
          return this.sendJson(res, 404, { error: 'Agent not found' });
        }

        if (body.roleTitle || body.systemPrompt) {
          const def = this.agentRepo.getDefinition(identity.definitionId);
          if (def) {
            this.db.execute(
              `UPDATE agent_definitions SET role = ?, system_prompt = ? WHERE id = ?`,
              body.roleTitle || def.role,
              body.systemPrompt || def.systemPrompt,
              identity.definitionId
            );
          }
        }

        if (body.activeModelId) {
          this.agentRepo.updateAgentModelConfig(agentId, body.activeModelId);
        }

        this.broadcastEvent('agent:updated', { agentId, ...body });
        return this.sendJson(res, 200, { success: true });
      }

      // 13. PATCH /api/workspace/autonomy — Update autonomy mode
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

      // 14. POST /api/approvals/:approvalId/resolve — Resolve approval gate
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
        projectId: this.activeProjectId,
        allocatedTokens: 50000,
      });

      // 2. Compile prompt
      const compiled = this.contextCompiler.compile({
        agentDefinition: def ?? {
          id: agent.definitionId,
          name: agent.displayName,
          role: 'Lead Sovereign Orchestrator',
          systemPrompt: 'You are @Boss, the Lead Sovereign Orchestrator in KIN OS.',
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
        senderName: agent.displayName.replace(/^@/, ''),
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
