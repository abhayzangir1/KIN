import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { EventLedger } from '../../security/event_ledger.js';
import { safeJsonParseObject } from '../../storage/db.js';
import { DEFAULT_FALLBACK_MODEL_ID } from '../../domain/agent_repository.js';
import { BaseController } from './base_controller.js';

export class WorkspaceController extends BaseController {
  public async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    parsedUrl: URL
  ): Promise<boolean> {
      // 5. GET /api/projects — List all projects
      if (req.method === 'GET' && pathname === '/api/projects') {
        const projects = this.workspaceRepo.listProjects('ws-default');
        return this.sendJson(res, 200, { projects, activeProjectId: this.activeProjectId });
      }

      // 6. POST /api/projects — Create a new independent workspace project
      if (req.method === 'POST' && pathname === '/api/projects') {
        const body = await this.parseJsonBody<{ name: string; repoPath?: string; activate?: boolean }>(req);
        if (!body.name || !body.name.trim()) {
          return this.sendJson(res, 400, { error: 'Project name is required' }, req);
        }

        const rawRepoPath = body.repoPath?.trim();
        if (rawRepoPath) {
          const trimmed = rawRepoPath.replace(/\\/g, '/');
          if (trimmed === '/' || /^[a-zA-Z]:\/?$/.test(trimmed)) {
            return this.sendJson(res, 400, { error: 'Repository path cannot be the root filesystem.' }, req);
          }
        }

        let repoPath = '';
        if (rawRepoPath) {
          const isWinDrive = /^[A-Za-z]:[\\/]/.test(rawRepoPath);
          if (isWinDrive) {
            repoPath = rawRepoPath;
          } else if (!path.isAbsolute(rawRepoPath)) {
            repoPath = path.resolve(process.cwd(), rawRepoPath);
          } else {
            repoPath = path.resolve(rawRepoPath);
          }
        } else {
          repoPath = path.resolve(process.cwd(), body.name.trim());
        }

        try {
          if (!fs.existsSync(repoPath)) {
            fs.mkdirSync(repoPath, { recursive: true });
          }
        } catch (err) { console.debug("[workspace_controller] Suppressed exception in catch block:", err); }

        const workspaceId = 'ws-default';
        const existingProjects = typeof (this.workspaceRepo as any).getProjects === 'function'
          ? (this.workspaceRepo as any).getProjects(workspaceId)
          : this.workspaceRepo.listProjects(workspaceId);

        const targetName = body.name.trim().toLowerCase();
        const targetRepoPath = path.resolve(repoPath).toLowerCase();

        const existingProject = existingProjects.find((p: any) =>
          (p.name && p.name.trim().toLowerCase() === targetName) ||
          (p.repoPath && path.resolve(p.repoPath).toLowerCase() === targetRepoPath)
        );

        if (existingProject) {
          if (body.activate !== false) {
            this.activeProjectId = existingProject.id;
            this.agentRepo.ensureProjectBoss(existingProject.id, workspaceId);
            this.broadcastEvent('project:activated', { projectId: existingProject.id });
          }
          const channels = this.workspaceRepo.listChannels(existingProject.id);
          const channelId = channels.length > 0 ? channels[0].id : `chan-${existingProject.id}`;
          return this.sendJson(res, 200, { project: existingProject, channelId }, req);
        }

        const id = `proj-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const now = Date.now();
        const project = {
          id,
          workspaceId,
          name: body.name.trim(),
          repoPath,
          settings: { defaultBranch: 'main' },
          createdAt: now,
          updatedAt: now,
        };

        this.workspaceRepo.createProject(project);

        // Create default #general channel for this project
        const channelId = `chan-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        this.workspaceRepo.createChannel({
          id: channelId,
          projectId: id,
          name: 'general',
          topic: `${project.name} discussion`,
          isPrivate: false,
          createdAt: now,
        });

        // Seed dedicated project-scoped Boss and add to project general channel
        const projectBoss = this.agentRepo.ensureProjectBoss(id, workspaceId);
        this.workspaceRepo.addChannelMember(channelId, projectBoss.id);
        this.broadcastEvent('agent:created', projectBoss);

        // Set as active project (default to true unless explicitly requested false)
        if (body.activate !== false) {
          this.activeProjectId = id;
        }

        this.broadcastEvent('project:created', project);
        return this.sendJson(res, 201, { project, channelId }, req);
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

      // 7b. POST /api/projects/:id/activate — Explicitly switch active workspace project
      const projectActivateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/activate$/);
      if (req.method === 'POST' && projectActivateMatch) {
        const projectId = projectActivateMatch[1];
        const proj = this.workspaceRepo.getProject(projectId);
        if (!proj) {
          return this.sendJson(res, 404, { error: `Project '${projectId}' not found` });
        }
        this.activeProjectId = projectId;
        this.agentRepo.ensureProjectBoss(projectId);
        const targetRepoRoot = (proj as any).repoRoot || proj.repoPath;
        if (targetRepoRoot) {
          try {
            await this.mcpClient.reloadProject(targetRepoRoot);
            const projectSkillsDir = path.join(targetRepoRoot, '.kin', 'skills');
            if (fs.existsSync(projectSkillsDir)) {
              this.skillEngine.setSkillsDir(projectSkillsDir);
              this.skillEngine.loadSkillsFromDirectory(projectSkillsDir);
            }
          } catch (mcpErr) {
            console.warn(`[KIN CORE] Failed to reload MCP servers or skills for project ${projectId}:`, mcpErr);
          }
        }
        this.broadcastEvent('project:activated', { projectId });
        return this.sendJson(res, 200, { success: true, activeProjectId: this.activeProjectId });
      }

      // 7a. GET /api/projects/:id/agents — List all agents in project
      const projectAgentsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/agents$/);
      if (req.method === 'GET' && projectAgentsMatch) {
        const projectId = projectAgentsMatch[1];
        const urlObj = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        const availableOnly = urlObj.searchParams.get('availableOnly') === '1' || urlObj.searchParams.get('availableOnly') === 'true';

        const ollamaInfo = await this.getLocalOllamaModels();
        const activeCreds = this.db.query<any>('SELECT DISTINCT provider FROM managed_credentials WHERE is_active = 1');
        const configuredProviders = new Set<string>(['ollama', ...activeCreds.map((c: any) => c.provider.toLowerCase())]);

        const agents = this.agentRepo.listIdentitiesByProject(projectId);
        let agentDisplays = agents.map((a) => {
          const def = this.agentRepo.getDefinition(a.definitionId);
          const { modelAvailable, modelStatus } = this.computeModelAvailability(
            a.activeModelId,
            ollamaInfo,
            configuredProviders,
            activeCreds.length
          );

          return {
            id: a.id,
            name: def?.name ?? a.displayName,
            role: def?.role ?? (a.isOrchestrator ? 'Workspace Orchestrator' : 'Specialist'),
            displayName: a.displayName,
            activeModelId: a.activeModelId,
            fallbackModelId: a.fallbackModelId,
            systemPrompt: def?.systemPrompt,
            status: 'idle',
            isOrchestrator: a.isOrchestrator,
            projectId: a.projectId,
            assignedChannels: this.workspaceRepo.listAgentChannelIds(a.id, projectId),
            modelAvailable,
            modelStatus,
            capabilities: def?.capabilities || [],
          };
        });

        if (availableOnly) {
          agentDisplays = agentDisplays.filter((a) => a.modelAvailable);
        }

        return this.sendJson(res, 200, { agents: agentDisplays });
      }

      // 7a-0. GET /api/projects/:id/teamwork-preview or /api/teamwork-preview — Live Workforce Collaboration Matrix & Readiness
      const teamworkMatch = pathname.match(/^\/api\/projects\/([^/]+)\/teamwork-preview$/) || (pathname === '/api/teamwork-preview' ? [null, this.activeProjectId] : null);
      if (req.method === 'GET' && teamworkMatch) {
        const projectId = teamworkMatch[1] || this.activeProjectId;
        const projectAgents = this.agentRepo.listIdentitiesByProject(projectId);
        const goals = this.goalRepo.listGoals(projectId);
        const tasks = this.taskRepo.listTasksByProject(projectId);
        const completedTasks = tasks.filter((t) => t.status === 'completed').length;
        const ollamaInfo = await this.getLocalOllamaModels();

        const agents = projectAgents.map((ag) => {
          const def = this.agentRepo.getDefinition(ag.definitionId);
          const assignedCids = this.workspaceRepo.listAgentChannelIds(ag.id, projectId);
          const assignedNames = Array.from(
            new Set(
              assignedCids.map((cId) => '#' + (this.workspaceRepo.getChannel(cId)?.name || cId))
            )
          );
          const modelName = ag.activeModelId.replace(/^ollama\//, '');
          const isInstalled = ollamaInfo.online && ollamaInfo.models.some((m) => m === modelName || m.startsWith(modelName));
          const modelStatus = !ollamaInfo.online ? 'offline' : isInstalled ? 'ready' : 'needs_download';
          return {
            id: ag.id,
            displayName: ag.displayName,
            isOrchestrator: ag.isOrchestrator,
            role: def?.role || 'Specialist',
            activeModelId: ag.activeModelId,
            modelInstalled: isInstalled,
            modelStatus,
            assignedChannels: assignedNames,
            domainAuthority: def?.domainAuthority || [],
            capabilities: def?.capabilities || [],
          };
        });

        return this.sendJson(res, 200, {
          projectId,
          agents,
          metrics: {
            goalsCount: goals.length,
            totalTasks: tasks.length,
            completedTasks,
            completionPercentage: tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 100,
            ollamaOnline: ollamaInfo.online,
            ollamaModelsCount: ollamaInfo.models.length,
            ollamaModels: ollamaInfo.models,
          },
        });
      }

      // 7a-1. GET /api/projects/:id/artifacts — List project deliverables and files
      const projectArtifactsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/artifacts$/);
      if (req.method === 'GET' && projectArtifactsMatch) {
        const projectId = projectArtifactsMatch[1];
        const project = this.workspaceRepo.getProject(projectId);
        if (!project || !fs.existsSync(project.repoPath)) {
          return this.sendJson(res, 200, { artifacts: [] });
        }

        const artifacts: Array<{
          name: string;
          relativePath: string;
          size: number;
          updatedAt: number;
          type: string;
          category: string;
        }> = [];

        const scanDir = (dir: string, depth = 0) => {
          if (depth > 5 || artifacts.length >= 250) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const lowerName = entry.name.toLowerCase();
              if (
                entry.name.startsWith('.') ||
                entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === 'build' ||
                entry.name === 'coverage' ||
                entry.name === 'tmp' ||
                entry.name === 'temp' ||
                entry.name === 'cache' ||
                lowerName === 'package-lock.json' ||
                lowerName === 'yarn.lock' ||
                lowerName === 'pnpm-lock.yaml' ||
                lowerName === 'bun.lockb' ||
                lowerName.endsWith('.map') ||
                lowerName.endsWith('.tsbuildinfo') ||
                lowerName.endsWith('.d.ts') ||
                lowerName.endsWith('.sqlite') ||
                lowerName.endsWith('.sqlite-wal') ||
                lowerName.endsWith('.sqlite-shm') ||
                lowerName.endsWith('.log')
              ) {
                continue;
              }

              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                scanDir(fullPath, depth + 1);
              } else if (entry.isFile()) {
                const stats = fs.statSync(fullPath);
                const relPath = path.relative(project.repoPath, fullPath).replace(/\\/g, '/');
                const ext = path.extname(entry.name).toLowerCase();
                let category = 'other';
                if (['.md', '.txt', '.rst', '.doc', '.pdf'].includes(ext)) category = 'spec';
                else if (['.ts', '.tsx', '.js', '.jsx', '.rs', '.py', '.sql', '.html', '.css', '.go'].includes(ext)) category = 'code';
                else if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) category = 'config';

                artifacts.push({
                  name: entry.name,
                  relativePath: relPath,
                  size: stats.size,
                  updatedAt: stats.mtimeMs,
                  type: ext.replace(/^\./, '') || 'file',
                  category,
                });
              }
            }
          } catch (e) { console.debug("[workspace_controller] Suppressed exception in catch block:", e); }
        };

        scanDir(project.repoPath);
        artifacts.sort((a, b) => b.updatedAt - a.updatedAt);
        return this.sendJson(res, 200, { artifacts });
      }

      // 7a-2. GET /api/projects/:id/artifacts/file — View specific artifact content
      const projectArtifactFileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/artifacts\/file$/);
      if (req.method === 'GET' && projectArtifactFileMatch) {
        const projectId = projectArtifactFileMatch[1];
        const project = this.workspaceRepo.getProject(projectId);
        const relPath = parsedUrl.searchParams.get('path');
        if (!project || !relPath) {
          return this.sendJson(res, 400, { error: 'Project and path are required' });
        }

        // Jail Confinement check: Prevent Path Traversal
        if (!this.isWithinJail(project.repoPath, relPath)) {
          return this.sendJson(res, 403, { error: 'Forbidden: Path traversal outside project jail' });
        }

        const resolvedPath = path.resolve(project.repoPath, relPath);
        if (!fs.existsSync(resolvedPath)) {
          return this.sendJson(res, 404, { error: 'Artifact file not found' });
        }

        // Sensitive File Denylist: Prevent reading credentials, tokens, database, or repo secrets
        const lowerRel = relPath.toLowerCase().replace(/\\/g, '/');
        let canonicalRel = lowerRel;
        try {
          const canonicalTarget = fs.realpathSync(resolvedPath);
          canonicalRel = path.relative(project.repoPath, canonicalTarget).toLowerCase().replace(/\\/g, '/');
        } catch (err) { console.debug("[workspace_controller] Suppressed exception in catch block:", err); }

        const blockedSensitivePatterns = [
          'vault.key',
          'ipc_auth.token',
          '.env',
          '.git/config',
          'id_rsa',
          'id_ed25519',
          '.npmrc',
          '.pypirc',
          'kin_storage.sqlite',
          'kin_storage.sqlite-wal',
          'kin_storage.sqlite-shm',
        ];
        const isSensitivePattern = (p: string) => {
          return (
            p.endsWith('.sqlite') ||
            p.endsWith('.sqlite3') ||
            p.endsWith('.sqlite-wal') ||
            p.endsWith('.sqlite-shm') ||
            p.includes('/.kin/') ||
            p.startsWith('.kin/') ||
            p.includes('/.ssh/') ||
            p.startsWith('.ssh/') ||
            p.includes('/.aws/') ||
            p.startsWith('.aws/') ||
            blockedSensitivePatterns.some((pattern) =>
              p === pattern || p.endsWith('/' + pattern) || p.includes('.kin/' + pattern)
            )
          );
        };

        if (isSensitivePattern(lowerRel) || isSensitivePattern(canonicalRel)) {
          return this.sendJson(res, 403, { error: 'Forbidden: Access to sensitive credential, database, or repository configuration files is prohibited.' });
        }

        const stats = fs.statSync(resolvedPath);
        const isBinary = this.isBinaryFile(resolvedPath);
        let content = '';
        let truncated = false;

        if (isBinary) {
          content = '[Binary deliverable — content preview unavailable]';
        } else if (stats.size > 1024 * 1024) {
          // Gracefully stream first 1MB of large files instead of failing with 400 error
          const buffer = Buffer.alloc(1024 * 1024);
          const fd = fs.openSync(resolvedPath, 'r');
          const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
          fs.closeSync(fd);
          const sizeMb = Math.round((stats.size / (1024 * 1024)) * 10) / 10;
          content = buffer.toString('utf-8', 0, bytesRead) + `\n\n[NOTICE: Large file (${sizeMb} MB total). Displaying first 1 MB preview.]`;
          truncated = true;
        } else {
          content = fs.readFileSync(resolvedPath, 'utf-8');
        }

        return this.sendJson(res, 200, {
          name: path.basename(resolvedPath),
          relativePath: relPath,
          size: stats.size,
          updatedAt: stats.mtimeMs,
          content,
          truncated,
        });
      }

      // 8. GET /api/state — Full authoritative snapshot from SQLite
      if (req.method === 'GET' && pathname === '/api/state') {
        const requestedProjId = parsedUrl.searchParams.get('projectId');
        const ws = this.workspaceRepo.getWorkspace('ws-default');
        const projects = this.workspaceRepo.listProjects('ws-default');
        const targetProjId = requestedProjId || this.activeProjectId || 'proj-kin';
        const activeProject = this.workspaceRepo.getProject(targetProjId) || projects.find((p) => p.id === targetProjId) || projects[0];
        
        let channels = this.workspaceRepo.listChannels(activeProject?.id || 'proj-kin', true);
        if (channels.length === 0 && activeProject) {
          // Fallback create general channel
          const fallbackChanId = `chan-${activeProject.id}-gen`;
          this.workspaceRepo.createChannel({
            id: fallbackChanId,
            projectId: activeProject.id,
            name: 'general',
            topic: 'General Discussion',
            isPrivate: false,
            createdAt: Date.now(),
          });
          const boss = this.agentRepo.ensureProjectBoss(activeProject.id);
          this.workspaceRepo.addChannelMember(fallbackChanId, boss.id);
          channels = this.workspaceRepo.listChannels(activeProject.id, true);
        }

        const activeChannelId = channels.find((c) => !c.isPrivate)?.id || channels[0]?.id || 'chan-general';
        const messages = this.channelService.getMessages(activeChannelId, 100);

        // Fetch agents in active project
        const ollamaInfo = await this.getLocalOllamaModels();
        const activeCreds = this.db.query<any>('SELECT DISTINCT provider FROM managed_credentials WHERE is_active = 1');
        const configuredProviders = new Set<string>(['ollama', ...activeCreds.map((c: any) => c.provider.toLowerCase())]);

        const currentProjId = activeProject?.id || 'proj-kin';
        const agents = this.agentRepo.listIdentitiesByProject(currentProjId);
        const agentDisplays = agents.map((a) => {
          const def = this.agentRepo.getDefinition(a.definitionId);
          const assignedChannels = this.workspaceRepo.listAgentChannelIds(a.id, currentProjId);
          const { modelAvailable, modelStatus } = this.computeModelAvailability(
            a.activeModelId,
            ollamaInfo,
            configuredProviders,
            activeCreds.length
          );

          const agentMessages = this.db.query<{ count: number; avg_score: number; last_at: number }>(
            `SELECT COUNT(*) as count, COALESCE(AVG(productivity_score), 0) as avg_score, MAX(created_at) as last_at
             FROM messages WHERE sender_id = ?`,
            a.id
          );
          const agentTasks = this.db.query<{ total: number; completed: number }>(
            `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
             FROM tasks WHERE assigned_agent_id = ?`,
            a.id
          );
          const agentRuns = this.db.query<{ count: number; used_tokens: number; allocated_tokens: number }>(
            `SELECT COUNT(*) as count, COALESCE(SUM(used_tokens), 0) as used_tokens, COALESCE(SUM(allocated_tokens), 0) as allocated_tokens
             FROM agent_runs WHERE agent_id = ?`,
            a.id
          );
          const agentApprovals = this.db.query<{ count: number }>(
            `SELECT COUNT(*) as count FROM approvals WHERE agent_id = ? AND status = 'pending'`,
            a.id
          );

          const tasksTotal = agentTasks[0]?.total || 0;
          const tasksCompleted = agentTasks[0]?.completed || 0;
          const taskSuccessRate = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 100;

          return {
            id: a.id,
            name: def?.name ?? a.displayName,
            role: def?.role ?? (a.isOrchestrator ? 'Workspace Orchestrator' : 'Specialist'),
            displayName: a.displayName,
            activeModelId: a.activeModelId,
            fallbackModelId: a.fallbackModelId,
            systemPrompt: def?.systemPrompt,
            status: 'idle',
            isOrchestrator: a.isOrchestrator,
            projectId: a.projectId,
            assignedChannels,
            modelAvailable,
            modelStatus,
            capabilities: def?.capabilities || [],
            analytics: {
              messagesCount: agentMessages[0]?.count || 0,
              assignedTasksCount: tasksTotal,
              completedTasksCount: tasksCompleted,
              taskSuccessRate,
              agentRunsCount: agentRuns[0]?.count || 0,
              usedTokens: agentRuns[0]?.used_tokens || 0,
              allocatedTokens: agentRuns[0]?.allocated_tokens || 0,
              pendingApprovalsCount: agentApprovals[0]?.count || 0,
              assignedChannelsCount: assignedChannels.length,
              avgProductivityScore: Math.round(agentMessages[0]?.avg_score || 0),
              lastActiveAt: agentMessages[0]?.last_at || a.createdAt,
            },
          };
        });

        // Fetch pending approvals scoped to the active project
        const currentProjectId = targetProjId || activeProject?.id || 'proj-kin';
        const rawApprovals = this.db.query<{
          id: string;
          run_id: string;
          agent_id: string;
          tool_name: string;
          action_payload_json: string;
          risk_level: string;
          created_at: number;
          project_id?: string;
        }>(
          `SELECT a.*, COALESCE(r.project_id, ag.project_id) as project_id
           FROM approvals a
           LEFT JOIN agent_runs r ON a.run_id = r.id
           LEFT JOIN agent_identities ag ON a.agent_id = ag.id
           WHERE a.status = 'pending'
             AND (r.project_id = ? OR ag.project_id = ? OR (r.project_id IS NULL AND ag.project_id IS NULL AND ? = 'proj-kin'))
           ORDER BY a.created_at DESC`,
          currentProjectId,
          currentProjectId,
          currentProjectId
        );

        const pendingApprovals = rawApprovals.map((a) => {
          const agent = agents.find((ag) => ag.id === a.agent_id);
          const payload = safeJsonParseObject(a.action_payload_json, {} as Record<string, any>);
          return {
            id: a.id,
            runId: a.run_id,
            agentName: agent?.displayName ?? '@Boss',
            toolName: a.tool_name,
            actionSummary: payload?.command || (payload?.name ? `Create dynamic tool '${payload.name}': ${payload.description || ''}` : JSON.stringify(payload)),
            riskLevel: a.risk_level,
            createdAt: a.created_at,
            projectId: a.project_id || currentProjectId,
            parameters: payload,
          };
        });

        // Fetch goals and tasks for project
        const goals = this.goalRepo.listGoals(currentProjectId);
        const tasks = this.taskRepo.listTasksByProject(currentProjectId);

        // Check Ollama status (ollamaInfo already retrieved above)
        // Calculate Project Analytics
        let dbStat = 0;
        try {
          if (fs.existsSync(this.dbPath)) dbStat += fs.statSync(this.dbPath).size;
          if (fs.existsSync(`${this.dbPath}-wal`)) dbStat += fs.statSync(`${this.dbPath}-wal`).size;
        } catch (err) { console.debug("[workspace_controller] Suppressed exception in catch block:", err); }

        const totalMessagesRow = this.db.query<{ total: number; human: number; agent: number }>(
          `SELECT 
             COUNT(*) as total,
             SUM(CASE WHEN sender_type = 'human' THEN 1 ELSE 0 END) as human,
             SUM(CASE WHEN sender_type = 'agent' THEN 1 ELSE 0 END) as agent
           FROM messages`
        );

        const totalTasksRow = this.db.query<{ total: number; completed: number }>(
          `SELECT 
             COUNT(*) as total,
             SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed
           FROM tasks t
           JOIN goals g ON t.goal_id = g.id
           WHERE g.project_id = ?`,
          activeProject?.id || 'proj-kin'
        );

        const projTasksTotal = totalTasksRow[0]?.total || 0;
        const projTasksCompleted = totalTasksRow[0]?.completed || 0;
        const projTaskRate = projTasksTotal > 0 ? Math.round((projTasksCompleted / projTasksTotal) * 100) : 100;

        const projectAnalytics = {
          totalMessages: totalMessagesRow[0]?.total || 0,
          humanMessages: totalMessagesRow[0]?.human || 0,
          agentMessages: totalMessagesRow[0]?.agent || 0,
          totalTasks: projTasksTotal,
          completedTasks: projTasksCompleted,
          taskCompletionRate: projTaskRate,
          pendingApprovalsCount: pendingApprovals.length,
          databaseSizeBytes: dbStat,
        };

        return this.sendJson(res, 200, {
          workspace: ws,
          activeProject,
          projects,
          autonomyMode: ws?.defaultAutonomyMode ?? 'AUTO',
          activeChannelId,
          channels: channels.map((c) => ({
            id: c.id,
            projectId: c.projectId,
            name: c.name,
            topic: c.topic,
            isPrivate: c.isPrivate,
            channelType: c.channelType || (c.isPrivate ? 'direct_message' : 'channel'),
            unreadCount: 0,
            memberIds: this.workspaceRepo.listChannelMemberIds(c.id),
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
          goals,
          tasks,
          decisions: this.taskRepo.listDecisionsByProject(activeProject?.id || 'proj-kin'),
          projectAnalytics,
          ollamaStatus: ollamaInfo,
          activeAgentChannels: Object.fromEntries(
            Array.from(this.activeAgentExecutions.entries()).map(([aId, e]) => [aId, e.channelId])
          ),
          pendingRecoveries: this.pendingRecoveries,
          queuedMessages: this.db.query<{
            id: string;
            channel_id: string;
            sender_id: string;
            content: string;
            metadata_json: string;
            created_at: number;
          }>('SELECT * FROM queued_messages WHERE channel_id = ? ORDER BY created_at ASC', activeChannelId).map((r) => ({
            id: r.id,
            channelId: r.channel_id,
            senderId: r.sender_id,
            content: r.content,
            metadata: JSON.parse(r.metadata_json || '{}'),
            createdAt: r.created_at,
          })),
        });
      }

      // 13. PATCH /api/workspace/autonomy — Update autonomy mode
      if ((req.method === 'PATCH' || req.method === 'POST') && pathname === '/api/workspace/autonomy') {
        if (req.headers['x-caller-agent-id'] || req.headers['x-agent-id']) {
          return this.sendJson(res, 403, { error: 'Forbidden: Agents cannot alter workspace autonomy modes.' }, req);
        }
        const body = await this.parseJsonBody<{ autonomyMode: string }>(req);
        const validModes = ['AUTO', 'ALWAYS_ASK', 'FULL_ACCESS', 'READ_ONLY'];
        if (!body.autonomyMode || !validModes.includes(body.autonomyMode)) {
          return this.sendJson(res, 400, { error: `Invalid autonomyMode '${body?.autonomyMode}'. Allowed values: ${validModes.join(', ')}` });
        }

        const wsId = (body as any).workspaceId || 'ws-default';
        const updated = this.db.execute(
          `UPDATE workspaces SET default_autonomy_mode = ?, updated_at = ? WHERE id = ? OR id = 'ws-default'`,
          body.autonomyMode,
          Date.now(),
          wsId
        );
        if (Number(updated.changes) === 0) {
          this.db.execute(
            `UPDATE workspaces SET default_autonomy_mode = ?, updated_at = ? WHERE id = (SELECT id FROM workspaces LIMIT 1)`,
            body.autonomyMode,
            Date.now()
          );
        }

        try {
          EventLedger.getInstance().record({
            eventType: 'workspace.autonomy_updated',
            entityType: 'workspace',
            entityId: 'ws-default',
            payload: { autonomyMode: body.autonomyMode },
          });
        } catch (err) { console.debug("[workspace_controller] Suppressed exception in catch block:", err); }

        this.broadcastEvent('autonomy:updated', { autonomyMode: body.autonomyMode });
        return this.sendJson(res, 200, { success: true, autonomyMode: body.autonomyMode });
      }

      // 19. GET /api/projects/:id/analytics — Project-level live analytics
      const projectAnalyticsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/analytics$/);
      if (req.method === 'GET' && projectAnalyticsMatch) {
        const projectId = projectAnalyticsMatch[1];
        const project = this.workspaceRepo.getProject(projectId);
        if (!project) {
          return this.sendJson(res, 404, { error: 'Project not found' });
        }

        let dbStat = 0;
        try {
          if (fs.existsSync(this.dbPath)) dbStat += fs.statSync(this.dbPath).size;
          if (fs.existsSync(`${this.dbPath}-wal`)) dbStat += fs.statSync(`${this.dbPath}-wal`).size;
        } catch (err) { console.debug("[workspace_controller] Suppressed exception in catch block:", err); }

        const totalMessagesRow = this.db.query<{ total: number; human: number; agent: number }>(
          `SELECT 
             COUNT(*) as total,
             SUM(CASE WHEN sender_type = 'human' THEN 1 ELSE 0 END) as human,
             SUM(CASE WHEN sender_type = 'agent' THEN 1 ELSE 0 END) as agent
           FROM messages`
        );

        const totalTasksRow = this.db.query<{ total: number; completed: number }>(
          `SELECT 
             COUNT(*) as total,
             SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed
           FROM tasks t
           JOIN goals g ON t.goal_id = g.id
           WHERE g.project_id = ?`,
          projectId
        );

        const pendingApprovalsRow = this.db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM approvals WHERE status = 'pending'`
        );

        const projTasksTotal = totalTasksRow[0]?.total || 0;
        const projTasksCompleted = totalTasksRow[0]?.completed || 0;
        const projTaskRate = projTasksTotal > 0 ? Math.round((projTasksCompleted / projTasksTotal) * 100) : 100;

        return this.sendJson(res, 200, {
          projectId,
          analytics: {
            totalMessages: totalMessagesRow[0]?.total || 0,
            humanMessages: totalMessagesRow[0]?.human || 0,
            agentMessages: totalMessagesRow[0]?.agent || 0,
            totalTasks: projTasksTotal,
            completedTasks: projTasksCompleted,
            taskCompletionRate: projTaskRate,
            pendingApprovalsCount: pendingApprovalsRow[0]?.count || 0,
            databaseSizeBytes: dbStat,
          },
        });
      }

      // 21. GET /api/projects/:id/git/status — Live Git Status and Changed Files
      const projectGitStatusMatch = pathname.match(/^\/api\/projects\/([^/]+)\/git\/status$/);
      if (req.method === 'GET' && projectGitStatusMatch) {
        const projectId = projectGitStatusMatch[1];
        const project = this.workspaceRepo.getProject(projectId);
        if (!project || !fs.existsSync(project.repoPath)) {
          return this.sendJson(res, 200, {
            isGitRepo: false,
            summary: { totalChanged: 0, modifiedCount: 0, untrackedCount: 0, addedCount: 0, deletedCount: 0, stagedCount: 0 },
            files: [],
          });
        }

        const checkGit = await this.execFileCommand('git', ['rev-parse', '--is-inside-work-tree'], project.repoPath);
        if (checkGit.exitCode !== 0) {
          return this.sendJson(res, 200, {
            isGitRepo: false,
            summary: { totalChanged: 0, modifiedCount: 0, untrackedCount: 0, addedCount: 0, deletedCount: 0, stagedCount: 0 },
            files: [],
          });
        }

        const statusRes = await this.execFileCommand('git', ['status', '--porcelain=v1', '-uall'], project.repoPath);
        const lines = statusRes.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const files: Array<{
          path: string;
          status: 'modified' | 'untracked' | 'added' | 'deleted' | 'renamed';
          staged: boolean;
          code: string;
        }> = [];

        for (const line of lines) {
          const code = line.slice(0, 2);
          let rawPath = line.slice(3).trim().replace(/^"|"$/g, '');
          if (rawPath.includes(' -> ')) {
            const parts = rawPath.split(' -> ');
            rawPath = parts[parts.length - 1].trim().replace(/^"|"$/g, '');
          }
          let staged = false;
          let status: 'modified' | 'untracked' | 'added' | 'deleted' | 'renamed' = 'modified';

          if (code === '??') {
            status = 'untracked';
            staged = false;
          } else if (code.includes('A')) {
            status = 'added';
            staged = code[0] === 'A';
          } else if (code.includes('D')) {
            status = 'deleted';
            staged = code[0] === 'D';
          } else if (code.includes('R')) {
            status = 'renamed';
            staged = code[0] === 'R';
          } else {
            status = 'modified';
            staged = code[0] !== ' ' && code[0] !== '?';
          }

          files.push({
            path: rawPath.replace(/\\/g, '/'),
            code,
            status,
            staged,
          });
        }

        const summary = {
          totalChanged: files.length,
          modifiedCount: files.filter((f) => f.status === 'modified').length,
          untrackedCount: files.filter((f) => f.status === 'untracked').length,
          addedCount: files.filter((f) => f.status === 'added').length,
          deletedCount: files.filter((f) => f.status === 'deleted').length,
          stagedCount: files.filter((f) => f.staged).length,
        };

        return this.sendJson(res, 200, {
          isGitRepo: true,
          summary,
          files,
        });
      }

      // 22. GET /api/projects/:id/git/diff — Unified Git Diff for Review
      const projectGitDiffMatch = pathname.match(/^\/api\/projects\/([^/]+)\/git\/diff$/);
      if (req.method === 'GET' && projectGitDiffMatch) {
        const projectId = projectGitDiffMatch[1];
        const project = this.workspaceRepo.getProject(projectId);
        const relPath = parsedUrl.searchParams.get('path');
        if (!project || !relPath) {
          return this.sendJson(res, 400, { error: 'Project and path are required' });
        }

        if (!this.isWithinJail(project.repoPath, relPath)) {
          return this.sendJson(res, 403, { error: 'Forbidden: Path traversal outside project jail' });
        }

        const fullPath = path.resolve(project.repoPath, relPath);
        const { stdout: statusOut } = await this.execFileCommand('git', ['status', '--porcelain=v1', '--', relPath], project.repoPath);
        const isUntracked = statusOut.trim().startsWith('??');

        let diffText = '';
        let additions = 0;
        let deletions = 0;
        const isBinary = this.isBinaryFile(fullPath);

        if (isBinary) {
          return this.sendJson(res, 200, {
            path: relPath,
            diff: 'Binary file changed — text diff preview unavailable.',
            additions: 0,
            deletions: 0,
            isUntracked,
            isBinary: true,
          });
        }

        if (isUntracked && fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (stats.isDirectory()) {
            return this.sendJson(res, 200, {
              path: relPath,
              diff: `Directory '${relPath}' is untracked.`,
              additions: 0,
              deletions: 0,
              isUntracked,
              isBinary: false,
            });
          }
          if (stats.size > 1024 * 1024) {
            const buffer = Buffer.alloc(100 * 1024);
            const fd = fs.openSync(fullPath, 'r');
            const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
            fs.closeSync(fd);
            const content = buffer.toString('utf-8', 0, bytesRead);
            const lines = content.replace(/\r?\n$/, '').split(/\r?\n/);
            additions = lines.length;
            deletions = 0;
            diffText = [
              `diff --git a/${relPath} b/${relPath}`,
              `new file mode 100644`,
              `--- /dev/null`,
              `+++ b/${relPath}`,
              `@@ -0,0 +1,${lines.length} @@ [Preview of first 100KB — large file (${Math.round(stats.size / 1024)} KB total)]`,
              ...lines.map((l) => `+${l}`),
            ].join('\n');
          } else {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.length > 0 ? content.replace(/\r?\n$/, '').split(/\r?\n/) : [];
            additions = lines.length;
            deletions = 0;
            diffText = [
              `diff --git a/${relPath} b/${relPath}`,
              `new file mode 100644`,
              `--- /dev/null`,
              `+++ b/${relPath}`,
              `@@ -0,0 +1,${lines.length} @@`,
              ...lines.map((l) => `+${l}`),
            ].join('\n');
          }
        } else {
          let diffRes = await this.execFileCommand('git', ['diff', 'HEAD', '--', relPath], project.repoPath);
          if (!diffRes.stdout.trim()) {
            diffRes = await this.execFileCommand('git', ['diff', '--', relPath], project.repoPath);
            if (!diffRes.stdout.trim()) {
              diffRes = await this.execFileCommand('git', ['diff', '--staged', '--', relPath], project.repoPath);
            }
          }
          diffText = diffRes.stdout || '';

          const diffLines = diffText.split(/\r?\n/);
          for (const dl of diffLines) {
            if (dl.startsWith('+') && !dl.startsWith('+++')) additions++;
            else if (dl.startsWith('-') && !dl.startsWith('---')) deletions++;
          }
        }

        return this.sendJson(res, 200, {
          path: relPath,
          diff: diffText,
          additions,
          deletions,
          isUntracked,
          isBinary: false,
        });
      }

      // 23. POST /api/projects/:id/git/revert — Revert Changes on File
      const projectGitRevertMatch = pathname.match(/^\/api\/projects\/([^/]+)\/git\/revert$/);
      if (req.method === 'POST' && projectGitRevertMatch) {
        const projectId = projectGitRevertMatch[1];
        const project = this.workspaceRepo.getProject(projectId);
        const body = await this.parseJsonBody<{ path: string }>(req);
        if (!project || !body.path) {
          return this.sendJson(res, 400, { error: 'Project and path are required' });
        }

        const fullPath = path.resolve(project.repoPath, body.path);
        if (fullPath === path.resolve(project.repoPath)) {
          return this.sendJson(res, 400, { error: 'Invalid path: Cannot revert the entire project root.' });
        }

        if (!this.isWithinJail(project.repoPath, body.path)) {
          return this.sendJson(res, 403, { error: 'Forbidden: Path traversal outside project jail' });
        }

        const lowerPath = body.path.toLowerCase().replace(/\\/g, '/').replace(/^\.?\//, '');
        let canonicalRel = lowerPath;
        try {
          if (fs.existsSync(fullPath)) {
            const canonicalFull = fs.realpathSync(fullPath);
            canonicalRel = path.relative(project.repoPath, canonicalFull).toLowerCase().replace(/\\/g, '/').replace(/^\.?\//, '');
          }
        } catch (err) { console.debug("[workspace_controller] Suppressed exception in catch block:", err); }

        const isProtectedGitPath = (p: string) => {
          return (
            p === '.git' || p.startsWith('.git/') ||
            p === '.kin' || p.startsWith('.kin/') ||
            p === '.env' || p.startsWith('.env.') || p.endsWith('/.env') || p.includes('/.env.')
          );
        };

        if (isProtectedGitPath(lowerPath) || isProtectedGitPath(canonicalRel)) {
          return this.sendJson(res, 403, { error: 'Forbidden: Cannot revert protected repository metadata or credentials.' });
        }

        const { stdout: statusOut } = await this.execFileCommand('git', ['status', '--porcelain=v1', '--', body.path], project.repoPath);
        const statusLines = statusOut.trim().split('\n').filter(Boolean);
        const isUntracked = statusLines.length > 0 && statusLines.every((l) => l.startsWith('?? '));

        if (isUntracked && fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            await this.execFileCommand('git', ['clean', '-f', '-d', '--', body.path], project.repoPath);
          } else {
            fs.rmSync(fullPath, { force: true });
          }
        } else {
          const revertRes = await this.execFileCommand('git', ['restore', '--staged', '--worktree', '--', body.path], project.repoPath);
          if (revertRes.exitCode !== 0) {
            return this.sendJson(res, 500, { error: `Git revert failed: ${revertRes.stderr || 'Unknown git error'}` });
          }
        }

        this.broadcastEvent('git:changed', { projectId, path: body.path, action: 'reverted' });
        return this.sendJson(res, 200, { success: true, path: body.path });
      }

      // 24. POST /api/projects/:id/git/stage — Stage/Unstage File
      const projectGitStageMatch = pathname.match(/^\/api\/projects\/([^/]+)\/git\/stage$/);
      if (req.method === 'POST' && projectGitStageMatch) {
        const projectId = projectGitStageMatch[1];
        const project = this.workspaceRepo.getProject(projectId);
        const body = await this.parseJsonBody<{ path: string; stage: boolean }>(req);
        if (!project || !body.path) {
          return this.sendJson(res, 400, { error: 'Project and path are required' });
        }

        if (!this.isWithinJail(project.repoPath, body.path)) {
          return this.sendJson(res, 403, { error: 'Forbidden: Path traversal outside project jail' });
        }

        const fullPath = path.resolve(project.repoPath, body.path);
        const lowerPath = body.path.toLowerCase().replace(/\\/g, '/').replace(/^\.?\//, '');
        let canonicalRel = lowerPath;
        try {
          if (fs.existsSync(fullPath)) {
            const canonicalFull = fs.realpathSync(fullPath);
            canonicalRel = path.relative(project.repoPath, canonicalFull).toLowerCase().replace(/\\/g, '/').replace(/^\.?\//, '');
          }
        } catch (err) { console.debug("[workspace_controller] Suppressed exception in catch block:", err); }

        const isProtectedGitPath = (p: string) => {
          return (
            p === '.git' || p.startsWith('.git/') ||
            p === '.kin' || p.startsWith('.kin/') ||
            p === '.env' || p.startsWith('.env.') || p.endsWith('/.env') || p.includes('/.env.')
          );
        };

        if (isProtectedGitPath(lowerPath) || isProtectedGitPath(canonicalRel)) {
          return this.sendJson(res, 403, { error: 'Forbidden: Cannot stage protected repository metadata or credentials.' });
        }

        let stageRes;
        if (body.stage) {
          stageRes = await this.execFileCommand('git', ['add', '--', body.path], project.repoPath);
        } else {
          stageRes = await this.execFileCommand('git', ['restore', '--staged', '--', body.path], project.repoPath);
          if (stageRes.exitCode !== 0) {
            stageRes = await this.execFileCommand('git', ['rm', '--cached', '--', body.path], project.repoPath);
          }
        }

        if (stageRes.exitCode !== 0) {
          return this.sendJson(res, 500, { error: `Git stage failed: ${stageRes.stderr || 'Unknown git error'}` });
        }

        this.broadcastEvent('git:changed', { projectId, path: body.path, staged: body.stage });
        return this.sendJson(res, 200, { success: true, path: body.path, staged: body.stage });
      }

      // 24b. POST /api/projects/:id/git/review — AI Code Review of diff/changes
      const projectGitReviewMatch = pathname.match(/^\/api\/projects\/([^/]+)\/git\/review$/);
      if (req.method === 'POST' && projectGitReviewMatch) {
        const projectId = projectGitReviewMatch[1];
        const project = this.workspaceRepo.getProject(projectId);
        const body = await this.parseJsonBody<{ path?: string; channelId?: string }>(req);
        if (!project || !fs.existsSync(project.repoPath)) {
          return this.sendJson(res, 404, { error: 'Project not found' });
        }

        const channelId = body.channelId || (this.workspaceRepo.listChannels(projectId)[0]?.id ?? 'chan-general');
        const projectAgents = this.agentRepo.listIdentitiesByProject(projectId);
        const boss = projectAgents.find((a) => a.isOrchestrator) || projectAgents[0];

        let targetDiff = '';
        let targetLabel = '';

        if (body.path) {
          if (!this.isWithinJail(project.repoPath, body.path)) {
            return this.sendJson(res, 403, { error: 'Forbidden: Path traversal outside project jail' });
          }
          const diffRes = await this.execFileCommand('git', ['diff', 'HEAD', '--', body.path], project.repoPath);
          targetDiff = diffRes.stdout || '';
          if (!targetDiff) {
            const diffUnstaged = await this.execFileCommand('git', ['diff', '--', body.path], project.repoPath);
            targetDiff = diffUnstaged.stdout || '';
          }
          if (!targetDiff && fs.existsSync(path.resolve(project.repoPath, body.path))) {
            const content = fs.readFileSync(path.resolve(project.repoPath, body.path), 'utf-8');
            targetDiff = content.slice(0, 8000);
          }
          targetLabel = `file \`${body.path}\``;
        } else {
          const diffRes = await this.execFileCommand('git', ['diff', 'HEAD'], project.repoPath);
          targetDiff = diffRes.stdout || '';
          targetLabel = 'all changed project files';
        }

        if (!targetDiff.trim()) {
          return this.sendJson(res, 200, {
            review: 'No unstaged or committed differences detected. Working tree is clean.',
            verdict: 'clean',
          });
        }

        const truncatedDiff = targetDiff.slice(0, 8000);
        const reviewPrompt = `You are @Boss, KIN's default workspace orchestrator. Review the following git diff for ${targetLabel}.\n\n` +
          `Provide a concise architectural and code quality review covering:\n` +
          `1. Summary of Changes\n` +
          `2. Potential Bugs, Edge Cases & Regressions\n` +
          `3. Security & Boundary Confinement\n` +
          `4. Architecture Quality\n` +
          `5. Recommendation (APPROVED / NEEDS CHANGES)\n\n` +
          `\`\`\`diff\n${truncatedDiff}\n\`\`\``;

        const modelRes = await this.modelGateway.invoke({
          modelId: boss?.activeModelId || this.agentRepo.getIdentity('agent-boss')?.activeModelId || DEFAULT_FALLBACK_MODEL_ID,
          messages: [{ role: 'user', content: reviewPrompt }],
        });

        const reviewMessage = this.channelService.sendMessage({
          channelId,
          senderId: boss?.id || 'agent-boss',
          senderType: 'agent',
          content: `🔍 **AI Code Review: ${targetLabel}**\n\n${modelRes.content}`,
          productivityScore: 100,
        });

        this.broadcastEvent('message:created', {
          id: reviewMessage.id,
          channelId: reviewMessage.channelId,
          senderId: reviewMessage.senderId,
          senderName: boss?.displayName?.replace(/^@/, '') || 'Boss',
          senderType: 'agent',
          content: reviewMessage.content,
          createdAt: reviewMessage.createdAt,
          productivityScore: reviewMessage.productivityScore,
        });

        const contentUpper = modelRes.content.toUpperCase();
        const verdict = contentUpper.includes('NEEDS CHANGES') || contentUpper.includes('CHANGES REQUESTED') || contentUpper.includes('REJECTED')
          ? 'CHANGES_REQUESTED'
          : 'APPROVED';

        return this.sendJson(res, 200, {
          success: true,
          review: modelRes.content,
          verdict,
          channelId,
        });
      }

      // 25. GET /api/projects/:id/uploads — List Project Attachments
      const projectUploadsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/uploads$/);
      if (req.method === 'GET' && projectUploadsMatch) {
        const projectId = projectUploadsMatch[1];
        const rows = this.db.query<{ value_json: string }>(
          `SELECT value_json FROM memories WHERE scope = 'project' AND scope_id = ? AND key LIKE 'upload:%' ORDER BY created_at DESC`,
          projectId
        );
        const uploads = rows
          .map((r) => {
            try {
              return JSON.parse(r.value_json);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        return this.sendJson(res, 200, { uploads });
      }

      // 26. POST /api/projects/:id/uploads — Upload Project Attachment
      if (req.method === 'POST' && projectUploadsMatch) {
        const projectId = projectUploadsMatch[1];
        const project = this.workspaceRepo.getProject(projectId);
        if (!project) {
          return this.sendJson(res, 404, { error: 'Project not found' });
        }

        const body = await this.parseJsonBody<{
          filename: string;
          contentBase64: string;
          mimeType?: string;
        }>(req, 50 * 1024 * 1024);

        if (!body.filename || !body.contentBase64) {
          return this.sendJson(res, 400, { error: 'filename and contentBase64 are required' });
        }

        const safeFileName = path.basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
        const fileId = `upl-${Date.now()}-${uuidv4().slice(0, 8)}`;
        const uploadsDir = path.join(project.repoPath, '.kin', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const diskPath = path.join(uploadsDir, `${fileId}-${safeFileName}`);
        const buffer = Buffer.from(body.contentBase64, 'base64');
        fs.writeFileSync(diskPath, buffer);

        const uploadRecord = {
          id: fileId,
          projectId,
          filename: safeFileName,
          originalName: body.filename,
          relativePath: `.kin/uploads/${fileId}-${safeFileName}`,
          size: buffer.length,
          mimeType: body.mimeType || 'application/octet-stream',
          createdAt: Date.now(),
        };

        this.db.execute(
          `INSERT INTO memories (id, scope, scope_id, type, key, value_json, version, created_at, updated_at)
           VALUES (?, 'project', ?, 'working_state', ?, ?, 1, ?, ?)`,
          `mem-${fileId}`,
          projectId,
          `upload:${fileId}`,
          JSON.stringify(uploadRecord),
          Date.now(),
          Date.now()
        );

        this.broadcastEvent('upload:created', uploadRecord);
        return this.sendJson(res, 201, { success: true, upload: uploadRecord });
      }

      // 27. DELETE /api/projects/:id/uploads/:uploadId — Delete Project Attachment
      const uploadDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/uploads\/([^/]+)$/);
      if (req.method === 'DELETE' && uploadDeleteMatch) {
        const projectId = uploadDeleteMatch[1];
        const uploadId = uploadDeleteMatch[2];
        const project = this.workspaceRepo.getProject(projectId);

        const row = this.db.queryOne<{ value_json: string }>(
          `SELECT value_json FROM memories WHERE scope = 'project' AND scope_id = ? AND key = ?`,
          projectId,
          `upload:${uploadId}`
        );

        if (row && project) {
          try {
            const record = JSON.parse(row.value_json);
            if (this.isWithinJail(project.repoPath, record.relativePath)) {
              const diskPath = path.resolve(project.repoPath, record.relativePath);
              if (fs.existsSync(diskPath)) {
                fs.unlinkSync(diskPath);
              }
            }
          } catch (err) { console.debug("[workspace_controller] Suppressed exception in catch block:", err); }

          this.db.execute(
            `DELETE FROM memories WHERE scope = 'project' AND scope_id = ? AND key = ?`,
            projectId,
            `upload:${uploadId}`
          );

          this.broadcastEvent('upload:deleted', { projectId, uploadId });
        }

        return this.sendJson(res, 200, { success: true, uploadId });
      }

      // 28. GET /api/projects/:id/uploads/:uploadId/download — Download Attachment
      const uploadDownloadMatch = pathname.match(/^\/api\/projects\/([^/]+)\/uploads\/([^/]+)\/download$/);
      if (req.method === 'GET' && uploadDownloadMatch) {
        const projectId = uploadDownloadMatch[1];
        const uploadId = uploadDownloadMatch[2];
        const project = this.workspaceRepo.getProject(projectId);
        if (!project) return this.sendJson(res, 404, { error: 'Project not found' });

        const row = this.db.queryOne<{ value_json: string }>(
          `SELECT value_json FROM memories WHERE scope = 'project' AND scope_id = ? AND key = ?`,
          projectId,
          `upload:${uploadId}`
        );

        if (!row) return this.sendJson(res, 404, { error: 'Upload not found' });

        const record = JSON.parse(row.value_json);
        if (!this.isWithinJail(project.repoPath, record.relativePath)) {
          return this.sendJson(res, 403, { error: 'Forbidden: Path traversal outside project jail' });
        }

        const diskPath = path.resolve(project.repoPath, record.relativePath);
        if (!fs.existsSync(diskPath)) {
          return this.sendJson(res, 404, { error: 'Physical file not found' });
        }

        this.handleCors(res, req);
        const safeFilename = path.basename(record.originalName || 'download').replace(/["\r\n\x00-\x1f]/g, '_');
        res.writeHead(200, {
          'Content-Type': record.mimeType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeFilename}"`,
          'Content-Length': fs.statSync(diskPath).size,
        });
        fs.createReadStream(diskPath).pipe(res);
        return true;
      }

    return false;
  }
}
