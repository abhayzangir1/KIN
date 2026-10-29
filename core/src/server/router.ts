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
    if (await this.systemController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.workspaceController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.channelController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.agentController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.taskController.handle(req, res, pathname, parsedUrl)) return true;
    if (await this.mcpController.handle(req, res, pathname, parsedUrl)) return true;
    return false;
  }
}
