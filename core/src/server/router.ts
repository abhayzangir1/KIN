import * as http from 'node:http';
import type { CoreServer } from './core_server.js';
import { WorkspaceController } from './controllers/workspace_controller.js';
import { ChannelController } from './controllers/channel_controller.js';
import { AgentController } from './controllers/agent_controller.js';
import { TaskController } from './controllers/task_controller.js';
import { McpController } from './controllers/mcp_controller.js';
import { SystemController } from './controllers/system_controller.js';

export class Router {
  public workspaceController: WorkspaceController;
  public channelController: ChannelController;
  public agentController: AgentController;
  public taskController: TaskController;
  public mcpController: McpController;
  public systemController: SystemController;

  constructor(server: CoreServer) {
    this.workspaceController = new WorkspaceController(server);
    this.channelController = new ChannelController(server);
    this.agentController = new AgentController(server);
    this.taskController = new TaskController(server);
    this.mcpController = new McpController(server);
    this.systemController = new SystemController(server);
  }

  public async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    parsedUrl: URL
  ): Promise<boolean> {
    // Fast O(1) domain prefix dispatch
    if (
      pathname.startsWith('/api/workspaces') ||
      pathname.startsWith('/api/projects') ||
      pathname === '/api/state' ||
      pathname.startsWith('/api/teamwork-preview')
    ) {
      if (await this.workspaceController.handle(req, res, pathname, parsedUrl)) return true;
    } else if (pathname.startsWith('/api/channels') || pathname.startsWith('/api/messages')) {
      if (await this.channelController.handle(req, res, pathname, parsedUrl)) return true;
    } else if (pathname.startsWith('/api/agents')) {
      if (await this.agentController.handle(req, res, pathname, parsedUrl)) return true;
    } else if (pathname.startsWith('/api/tasks') || pathname.startsWith('/api/goals')) {
      if (await this.taskController.handle(req, res, pathname, parsedUrl)) return true;
    } else if (pathname.startsWith('/api/mcp')) {
      if (await this.mcpController.handle(req, res, pathname, parsedUrl)) return true;
    } else if (
      pathname.startsWith('/api/system') ||
      pathname.startsWith('/api/health') ||
      pathname === '/health' ||
      pathname.startsWith('/api/models') ||
      pathname.startsWith('/api/settings') ||
      pathname.startsWith('/api/skills') ||
      pathname.startsWith('/api/automations') ||
      pathname.startsWith('/api/terminal') ||
      pathname.startsWith('/api/credentials')
    ) {
      if (await this.systemController.handle(req, res, pathname, parsedUrl)) return true;
    }

    // Comprehensive fallback ensuring 100% backward-compatibility for all legacy aliases
    if (await this.systemController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.workspaceController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.channelController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.agentController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.taskController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.mcpController.handle(req, res, pathname, parsedUrl)) return true;

    return false;
  }
}
