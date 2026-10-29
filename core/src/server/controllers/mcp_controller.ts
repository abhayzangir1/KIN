import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpClientManager } from '../../execution/mcp_client.js';
import { BaseController } from './base_controller.js';

export class McpController extends BaseController {
  public async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    parsedUrl: URL
  ): Promise<boolean> {
      // 35. GET /api/mcp/tools
      if (req.method === 'GET' && pathname === '/api/mcp/tools') {
        const tools = this.mcpClient.getAllTools();
        return this.sendJson(res, 200, { tools });
      }

      // 35-c. GET /api/mcp/servers
      if (req.method === 'GET' && pathname === '/api/mcp/servers') {
        const servers = this.mcpClient.getAllServers();
        return this.sendJson(res, 200, { success: true, count: servers.length, servers });
      }

      // 35b. POST /api/mcp/reload — Explicitly reload MCP servers from project configuration
      if (req.method === 'POST' && pathname === '/api/mcp/reload') {
        const body = await this.parseJsonBody<{ projectRoot?: string; projectId?: string }>(req).catch(() => ({} as { projectRoot?: string; projectId?: string }));
        let targetRoot = body?.projectRoot;
        if (!targetRoot && body?.projectId) {
          targetRoot = this.workspaceRepo.getProject(body.projectId)?.repoPath;
        }

        const boundaryCheck = this.validateProjectBoundary(targetRoot);
        if (!boundaryCheck.valid) {
          return this.sendJson(res, 403, { error: boundaryCheck.error });
        }
        targetRoot = boundaryCheck.root;

        if (!fs.existsSync(targetRoot)) {
          return this.sendJson(res, 404, { error: `projectRoot '${targetRoot}' does not exist.` });
        }

        const tools = await this.mcpClient.reloadProject(targetRoot, true);
        const servers = this.mcpClient.getAllServers();
        return this.sendJson(res, 200, { success: true, projectRoot: targetRoot, toolsCount: tools.length, tools, servers });
      }

      // 35d. GET /api/mcp/connectors — Lists configured connectors across Global and Project scopes
      if (req.method === 'GET' && pathname === '/api/mcp/connectors') {
        let customRoot = parsedUrl.searchParams.get('projectRoot') || undefined;
        const queryProjectId = parsedUrl.searchParams.get('projectId');
        if (!customRoot && queryProjectId) {
          customRoot = this.workspaceRepo.getProject(queryProjectId)?.repoPath;
        }
        const boundaryCheck = this.validateProjectBoundary(customRoot);
        if (!boundaryCheck.valid) {
          return this.sendJson(res, 403, { error: boundaryCheck.error });
        }
        customRoot = boundaryCheck.root;

        const connectors = this.mcpClient.listConfiguredConnectors(customRoot);
        const globalPath = McpClientManager.getGlobalConfigPath();
        const projectPath = this.mcpClient.getProjectConfigPath(customRoot);
        return this.sendJson(res, 200, {
          success: true,
          count: connectors.length,
          connectors,
          globalPath,
          projectPath,
          paths: {
            global: globalPath,
            project: projectPath,
          },
          activeProjectId: this.activeProjectId,
        });
      }

      // 35d-2. GET /api/mcp/connectors/:name — Retrieves single connector details
      const connectorGetMatch = pathname.match(/^\/api\/mcp\/connectors\/([^/]+)$/);
      if (req.method === 'GET' && connectorGetMatch) {
        const name = decodeURIComponent(connectorGetMatch[1]);
        const scope = parsedUrl.searchParams.get('scope') as ('global' | 'project' | null);
        let customRoot = parsedUrl.searchParams.get('projectRoot') || undefined;
        const queryProjectId = parsedUrl.searchParams.get('projectId');
        if (!customRoot && queryProjectId) {
          customRoot = this.workspaceRepo.getProject(queryProjectId)?.repoPath;
        }
        const boundaryCheck = this.validateProjectBoundary(customRoot);
        if (!boundaryCheck.valid) {
          return this.sendJson(res, 403, { error: boundaryCheck.error });
        }
        customRoot = boundaryCheck.root;

        const connectors = this.mcpClient.listConfiguredConnectors(customRoot);
        const match = connectors.find((c) => c.name === name && (!scope || c.scope === scope));
        if (!match) {
          return this.sendJson(res, 404, { error: `Connector '${name}' not found` });
        }
        return this.sendJson(res, 200, { success: true, connector: match });
      }

      // 35e. POST /api/mcp/connectors/save — Saves or updates connector configuration in global or project scope
      if (req.method === 'POST' && (pathname === '/api/mcp/connectors/save' || pathname === '/api/mcp/connectors')) {
        const body = await this.parseJsonBody<{
          scope: 'global' | 'project';
          name: string;
          config: any;
          projectRoot?: string;
          projectId?: string;
        }>(req).catch(() => ({} as any));

        if (!body.scope || !body.name || !body.config) {
          return this.sendJson(res, 400, { error: 'scope ("global" | "project"), name, and config are required' });
        }
        let customRoot = body.projectRoot;
        if (!customRoot && body.projectId) {
          customRoot = this.workspaceRepo.getProject(body.projectId)?.repoPath;
        }
        const boundaryCheck = this.validateProjectBoundary(customRoot);
        if (!boundaryCheck.valid) {
          return this.sendJson(res, 403, { error: boundaryCheck.error });
        }
        customRoot = boundaryCheck.root;

        try {
          const result = await this.mcpClient.saveConnector(body.scope, body.name, body.config, customRoot);
          this.broadcastEvent('mcp:connectors_updated', { scope: body.scope, name: body.name, connector: result.connector });
          const connectors = this.mcpClient.listConfiguredConnectors(customRoot);
          return this.sendJson(res, 200, {
            ...result,
            toolsCount: result.tools?.length || result.connector?.toolsCount || 0,
            connectors,
          });
        } catch (saveErr: any) {
          return this.sendJson(res, 400, { error: saveErr.message || 'Failed to save connector configuration' });
        }
      }

      // 35f. POST /api/mcp/connectors/toggle — Enables or disables a connector in global or project scope
      if (req.method === 'POST' && pathname === '/api/mcp/connectors/toggle') {
        const body = await this.parseJsonBody<{
          scope: 'global' | 'project';
          name: string;
          disabled: boolean;
          projectRoot?: string;
          projectId?: string;
        }>(req).catch(() => ({} as any));

        if (!body.scope || !body.name || typeof body.disabled !== 'boolean') {
          return this.sendJson(res, 400, { error: 'scope ("global" | "project"), name, and disabled (boolean) are required' });
        }
        let customRoot = body.projectRoot;
        if (!customRoot && body.projectId) {
          customRoot = this.workspaceRepo.getProject(body.projectId)?.repoPath;
        }
        const boundaryCheck = this.validateProjectBoundary(customRoot);
        if (!boundaryCheck.valid) {
          return this.sendJson(res, 403, { error: boundaryCheck.error });
        }
        customRoot = boundaryCheck.root;

        try {
          const result = await this.mcpClient.toggleConnector(body.scope, body.name, body.disabled, customRoot);
          this.broadcastEvent('mcp:connectors_updated', { scope: body.scope, name: body.name, disabled: body.disabled });
          const connectors = this.mcpClient.listConfiguredConnectors(customRoot);
          return this.sendJson(res, 200, {
            ...result,
            connectors,
          });
        } catch (toggleErr: any) {
          return this.sendJson(res, 400, { error: toggleErr.message || 'Failed to toggle connector' });
        }
      }

      // 35g. DELETE or POST /api/mcp/connectors/delete — Removes connector from config file
      const connectorDeleteMatch = pathname.match(/^\/api\/mcp\/connectors\/([^/]+)$/);
      if ((req.method === 'DELETE' && connectorDeleteMatch) || (req.method === 'POST' && pathname === '/api/mcp/connectors/delete')) {
        let name = connectorDeleteMatch ? decodeURIComponent(connectorDeleteMatch[1]) : '';
        let scope: 'global' | 'project' = (parsedUrl.searchParams.get('scope') as any) || 'project';
        let customRoot = parsedUrl.searchParams.get('projectRoot') || undefined;
        const queryProjectId = parsedUrl.searchParams.get('projectId');
        if (!customRoot && queryProjectId) {
          customRoot = this.workspaceRepo.getProject(queryProjectId)?.repoPath;
        }

        if (req.method === 'POST') {
          const body = await this.parseJsonBody<{ name?: string; scope?: 'global' | 'project'; projectRoot?: string; projectId?: string }>(req).catch(() => ({} as any));
          if (body.name) name = body.name;
          if (body.scope) scope = body.scope;
          if (body.projectRoot) customRoot = body.projectRoot;
          if (!customRoot && body.projectId) {
            customRoot = this.workspaceRepo.getProject(body.projectId)?.repoPath;
          }
        }
        if (!name) {
          return this.sendJson(res, 400, { error: 'Connector name is required' });
        }
        const boundaryCheck = this.validateProjectBoundary(customRoot);
        if (!boundaryCheck.valid) {
          return this.sendJson(res, 403, { error: boundaryCheck.error });
        }
        customRoot = boundaryCheck.root;

        try {
          const result = await this.mcpClient.deleteConnector(scope, name, customRoot);
          this.broadcastEvent('mcp:connectors_updated', { scope, name, deleted: true });
          const connectors = this.mcpClient.listConfiguredConnectors(customRoot);
          return this.sendJson(res, 200, {
            ...result,
            connectors,
          });
        } catch (delErr: any) {
          return this.sendJson(res, 400, { error: delErr.message || 'Failed to delete connector' });
        }
      }

      // 35h. POST /api/mcp/connectors/test — Tests connection and tools discovery for a connector
      if (req.method === 'POST' && (pathname === '/api/mcp/connectors/test' || pathname === '/api/mcp/test')) {
        const body = await this.parseJsonBody<{
          config: any;
          timeoutMs?: number;
          projectRoot?: string;
          projectId?: string;
        }>(req).catch(() => ({} as any));
        if (!body.config || (!body.config.command && !body.config.url)) {
          return this.sendJson(res, 400, { error: 'config with valid command or url is required' });
        }
        let customRoot = body.projectRoot;
        if (!customRoot && body.projectId) {
          customRoot = this.workspaceRepo.getProject(body.projectId)?.repoPath;
        }
        const boundaryCheck = this.validateProjectBoundary(customRoot);
        if (!boundaryCheck.valid) {
          return this.sendJson(res, 403, { error: boundaryCheck.error });
        }
        customRoot = boundaryCheck.root;

        const timeoutMs = typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? body.timeoutMs : 10000;
        const result = await this.mcpClient.testConnector(body.config, timeoutMs, customRoot);
        return this.sendJson(res, 200, result);
      }

    return false;
  }
}
