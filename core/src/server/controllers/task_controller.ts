import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Goal, Task, TaskStatus, Decision, DecisionStatus } from '../../domain/types.js';
import { EventLedger } from '../../security/event_ledger.js';
import { SecretBroker } from '../../security/secret_broker.js';
import { WorktreeManager } from '../../execution/worktree_manager.js';
import { BaseController } from './base_controller.js';

export class TaskController extends BaseController {
  public async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    parsedUrl: URL
  ): Promise<boolean> {
      // 13b. GET /api/approvals — List approvals
      if (req.method === 'GET' && pathname === '/api/approvals') {
        const statusFilter = parsedUrl.searchParams.get('status');
        const projFilter = parsedUrl.searchParams.get('projectId');
        let sql = `SELECT a.*, COALESCE(r.project_id, ag.project_id) as project_id
                   FROM approvals a
                   LEFT JOIN agent_runs r ON a.run_id = r.id
                   LEFT JOIN agent_identities ag ON a.agent_id = ag.id`;
        const params: any[] = [];
        const wheres: string[] = [];

        if (statusFilter) {
          wheres.push('a.status = ?');
          params.push(statusFilter);
        }
        if (projFilter) {
          wheres.push('(r.project_id = ? OR ag.project_id = ? OR (r.project_id IS NULL AND ag.project_id IS NULL AND ? = \'proj-kin\'))');
          params.push(projFilter, projFilter, projFilter);
        }
        if (wheres.length > 0) {
          sql += ' WHERE ' + wheres.join(' AND ');
        }
        sql += ' ORDER BY a.created_at DESC';

        const rows = this.db.query<any>(sql, ...params);
        const mappedRows = rows.map((r: any) => ({
          ...r,
          projectId: r.project_id || (projFilter || 'proj-kin'),
        }));
        return this.sendJson(res, 200, { approvals: mappedRows });
      }

      // 14. POST /api/approvals/:approvalId/resolve — Resolve approval gate
      const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/resolve$/);
      if (req.method === 'POST' && approvalMatch) {
        if (req.headers['x-caller-agent-id'] || req.headers['x-agent-id']) {
          return this.sendJson(res, 403, { error: 'Forbidden: Agents cannot self-resolve approval gates.' }, req);
        }
        const approvalId = approvalMatch[1];
        const body = await this.parseJsonBody<{ approved?: boolean; status?: string; decision?: string }>(req);

        const approvalRow = this.db.queryOne<{
          run_id: string;
          agent_id: string;
          tool_name: string;
          action_payload_json: string;
          status: string;
          expires_at?: number;
        }>('SELECT run_id, agent_id, tool_name, action_payload_json, status, expires_at FROM approvals WHERE id = ?', approvalId);

        if (!approvalRow) {
          return this.sendJson(res, 404, { error: `Approval '${approvalId}' not found.` });
        }

        if (approvalRow.status !== 'pending') {
          return this.sendJson(res, 400, { error: `Approval '${approvalId}' is not pending (current status: '${approvalRow.status}').` });
        }

        if (approvalRow.expires_at && approvalRow.expires_at < Date.now()) {
          this.db.execute(`UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ?`, Date.now(), approvalId);
          return this.sendJson(res, 400, { error: `Approval '${approvalId}' has expired.` });
        }

        const isApproved = body.approved === true || body.status === 'approved' || body.decision === 'approve';
        const status = isApproved ? 'approved' : 'rejected';
        const now = Date.now();

        const updateRes = this.db.execute(
          `UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`,
          status,
          now,
          approvalId
        );
        if (Number(updateRes.changes) === 0) {
          return this.sendJson(res, 409, { error: 'Approval was already resolved by another request.' });
        }

        // If this was a custom tool proposal, synchronize ToolEngine status
        try {
          this.toolEngine?.resolveToolApproval(approvalId, isApproved ? 'approved' : 'denied');
        } catch (toolResErr) {
          console.warn('[KIN CORE] Notice synchronizing ToolEngine on approval resolution:', toolResErr);
        }

        try {
          EventLedger.getInstance().record({
            eventType: isApproved ? 'approval.granted' : 'approval.rejected',
            entityType: 'approval',
            entityId: approvalId,
            payload: {
              runId: approvalRow.run_id,
              agentId: approvalRow.agent_id,
              toolName: approvalRow.tool_name,
              status,
            },
          });
        } catch {}

        let toolExecutionResult: any = null;
        if (approvalRow) {
          const run = this.kernel.getRun(approvalRow.run_id);
          const agentIdentity = this.agentRepo.getIdentity(approvalRow.agent_id);
          const projId = run?.projectId || agentIdentity?.projectId || this.activeProjectId;
          const proj = this.workspaceRepo.getProject(projId);
          const projectRoot = proj?.repoPath || process.cwd();

          // Locate preserved worktree path if present
          const payload = JSON.parse(approvalRow.action_payload_json || '{}');
          const preserved = this.preservedWorktrees.get(approvalId) || this.preservedWorktrees.get(approvalRow.run_id);
          const targetWorktree = preserved?.worktreePath || payload._worktreePath || payload.worktreePath;
          let worktreeRoot = targetWorktree || run?.worktreePath || projectRoot;

          const cleanPayload = { ...payload };
          delete cleanPayload._worktreePath;
          delete cleanPayload._worktreeBranch;
          delete cleanPayload._isShadowRepo;

          // Locate channel to notify
          const latestMsg = this.db.queryOne<{ channel_id: string }>(
            'SELECT channel_id FROM messages WHERE sender_id = ? ORDER BY created_at DESC LIMIT 1',
            approvalRow.agent_id
          );
          const targetChanId = run?.channelId || latestMsg?.channel_id || 'chan-general';

          if (isApproved) {
            this.preservedWorktrees.delete(approvalId);
            let toolSuccess = false;
            let toolOutput: any = null;
            let safeOutput = '';
            let toolError: string | undefined;

            if (approvalRow.tool_name === 'create_tool' || approvalRow.tool_name === 'createTool') {
              const toolName = payload.name || cleanPayload.name || 'custom_tool';
              toolSuccess = true;
              toolOutput = {
                success: true,
                status: 'active',
                toolName,
                message: `Tool '${toolName}' approved and activated for the swarm. Any agent can now invoke it via 'custom__${toolName}' or 'execute_custom_tool'.`,
              };
              safeOutput = JSON.stringify(toolOutput, null, 2);
              toolExecutionResult = toolOutput;
              if (run) {
                this.kernel.transitionState(approvalRow.run_id, 'running', `Action ${approvalRow.tool_name} approved and tool '${toolName}' activated by operator.`);
              }
              this.channelService.sendMessage({
                channelId: targetChanId,
                senderId: approvalRow.agent_id,
                senderType: 'system',
                content: `✅ **OPERATOR AUTHORIZED & ACTIVATED TOOL**\nTool: \`${toolName}\`\nStatus: \`active\`\nRationale: ${cleanPayload.rationale || 'Specialized task execution'}\nThe custom tool is now live and available across the agent swarm.`,
                productivityScore: 100,
              });
            } else {
              try {
                if (targetWorktree || run?.worktreePath) {
                  const expectedPath = targetWorktree || run?.worktreePath;
                  if (!expectedPath || !fs.existsSync(expectedPath)) {
                    throw new Error(`SECURITY_ABORT: Worktree path '${expectedPath}' no longer exists on disk. Aborting execution to protect the project root.`);
                  }
                  const boundaryCheck = this.validateProjectBoundary(expectedPath);
                  if (!boundaryCheck.valid) {
                    throw new Error(`SECURITY_DENIAL: Approval worktree path '${expectedPath}' is outside project boundary.`);
                  }
                  worktreeRoot = expectedPath;
                } else {
                  worktreeRoot = projectRoot;
                }
                const approvalToken = this.toolGateway.generateApprovalToken(
                  approvalRow.tool_name,
                  approvalRow.run_id,
                  60000,
                  cleanPayload
                );
                toolExecutionResult = await this.toolGateway.executeTool(
                  approvalRow.tool_name,
                  cleanPayload,
                  {
                    runId: approvalRow.run_id,
                    agentId: approvalRow.agent_id,
                    projectId: projId,
                    worktreeRoot,
                    autonomyMode: 'FULL_ACCESS', // Explicit operator authorization overrides gate
                    allowedCapabilities: ['*'],
                    approvalToken,
                  }
                );
                if (toolExecutionResult && toolExecutionResult.success === false) {
                  throw new Error(toolExecutionResult.error || `Execution failed for tool ${approvalRow.tool_name}`);
                }
                toolSuccess = true;
                toolOutput = toolExecutionResult?.output !== undefined ? toolExecutionResult.output : toolExecutionResult;

                if (run) {
                  this.kernel.transitionState(approvalRow.run_id, 'running', `Action ${approvalRow.tool_name} approved and executed by operator.`);
                }

                const sanitizedToolOutput = SecretBroker.getInstance().sanitizePayload(toolOutput);
                const outputStr = typeof sanitizedToolOutput === 'string' ? sanitizedToolOutput : JSON.stringify(sanitizedToolOutput, null, 2);
                safeOutput = outputStr.length > 50000 ? outputStr.slice(0, 50000) + '\n...[TRUNCATED]' : outputStr;

                this.channelService.sendMessage({
                  channelId: targetChanId,
                  senderId: approvalRow.agent_id,
                  senderType: 'system',
                  content: `✅ **OPERATOR AUTHORIZED & EXECUTED**\nTool: \`${approvalRow.tool_name}\`\nOutput:\n\`\`\`json\n${safeOutput}\n\`\`\``,
                  productivityScore: 100,
                });
              } catch (execErr: any) {
                this.preservedWorktrees.delete(approvalRow.run_id);
                try {
                  this.db.execute(`UPDATE approvals SET status = 'failed', decided_at = ? WHERE id = ?`, Date.now(), approvalId);
                } catch {}
                toolSuccess = false;
                toolError = execErr.message || String(execErr);
                toolExecutionResult = { success: false, error: toolError };

                if (run) {
                  this.kernel.transitionState(approvalRow.run_id, 'running', `Approved action ${approvalRow.tool_name} returned error: ${toolError}. Resuming agent loop for self-correction.`);
                }

                this.channelService.sendMessage({
                  channelId: targetChanId,
                  senderId: approvalRow.agent_id,
                  senderType: 'system',
                  content: `⚠️ **EXECUTION ERROR ON OPERATOR APPROVAL**\nTool: \`${approvalRow.tool_name}\` failed: ${toolError}`,
                  productivityScore: 0,
                });
              }
            }

            // Resume agent execution with the tool observation (success or error)
            if (agentIdentity) {
              const observationTrigger = {
                id: `approval-obs-${Date.now()}`,
                channelId: targetChanId,
                senderId: 'system',
                senderType: 'system' as const,
                content: toolSuccess
                  ? `[OPERATOR APPROVED TOOL OBSERVATION]: Tool '${approvalRow.tool_name}' executed successfully with output:\n${safeOutput}\nPlease incorporate this observation and proceed with the task.`
                  : `[OPERATOR APPROVED TOOL ERROR]: Tool '${approvalRow.tool_name}' failed with error:\n${toolError}\nPlease self-correct or report the issue.`,
                taskId: run?.taskId,
                createdAt: Date.now(),
              };
              const latestCheckpoint = this.checkpointRepo.getLatestCheckpoint(approvalRow.run_id);
              this.enqueueChannelExecution(targetChanId, () =>
                this.enqueueAgentExecution(agentIdentity.id, () =>
                  this.executeAgentResponse(agentIdentity, targetChanId, observationTrigger, 0, latestCheckpoint, approvalRow.run_id)
                )
              ).catch((resumeErr) => {
                this.preservedWorktrees.delete(approvalRow.run_id);
                console.error('[KIN CORE] Error resuming agent response after approval:', resumeErr);
              });
            }
          } else {
            const preserved = this.preservedWorktrees.get(approvalId) || this.preservedWorktrees.get(approvalRow.run_id);
            if (preserved) {
              try {
                const worktreeManager = new WorktreeManager(preserved.repoRoot || projectRoot);
                await worktreeManager.removeWorktree(preserved.worktreePath);
                await worktreeManager.deleteBranch(preserved.branch);
              } catch (cleanErr) {
                console.warn('[KIN CORE] Notice cleaning rejected approval worktree:', cleanErr);
              }
              this.preservedWorktrees.delete(approvalId);
              this.preservedWorktrees.delete(approvalRow.run_id);
            }

            if (approvalRow.tool_name === 'create_tool' || approvalRow.tool_name === 'createTool') {
              const toolName = payload.name || cleanPayload.name || 'custom_tool';
              if (run) {
                this.kernel.transitionState(approvalRow.run_id, 'running', `Action ${approvalRow.tool_name} rejected by operator. Resuming agent loop with graceful fallback.`);
              }
              this.channelService.sendMessage({
                channelId: targetChanId,
                senderId: approvalRow.agent_id,
                senderType: 'system',
                content: `🛑 **TOOL PROPOSAL DENIED**\nOperator declined creation of custom tool \`${toolName}\`. Agent will gracefully continue using existing built-in tools.`,
                productivityScore: 50,
              });

              if (agentIdentity) {
                const observationTrigger = {
                  id: `approval-denied-${Date.now()}`,
                  channelId: targetChanId,
                  senderId: 'system',
                  senderType: 'system' as const,
                  content: `[OPERATOR TOOL PROPOSAL DENIED]: Operator rejected the creation of custom tool '${toolName}'. Please gracefully fall back to existing built-in tools (execute_command, run_node_code, write_file) to accomplish your objective without halting.`,
                  taskId: run?.taskId,
                  createdAt: Date.now(),
                };
                const latestCheckpoint = this.checkpointRepo.getLatestCheckpoint(approvalRow.run_id);
                this.enqueueChannelExecution(targetChanId, () =>
                  this.enqueueAgentExecution(agentIdentity.id, () =>
                    this.executeAgentResponse(agentIdentity, targetChanId, observationTrigger, 0, latestCheckpoint, approvalRow.run_id)
                  )
                ).catch((resumeErr) => {
                  console.error('[KIN CORE] Error resuming agent response after tool denial:', resumeErr);
                });
              }
            } else {
              if (run) {
                this.kernel.transitionState(approvalRow.run_id, 'cancelled', `Action ${approvalRow.tool_name} rejected by operator.`);
                if (run.taskId) {
                  try {
                    this.taskRepo.releaseTaskLease(run.taskId, run.id, false);
                    this.taskRepo.updateTaskStatus(run.taskId, 'blocked');
                    this.broadcastEvent('task:updated', { taskId: run.taskId, status: 'blocked', reason: `Action ${approvalRow.tool_name} rejected by operator.` });
                  } catch (tErr) {
                    console.warn('[KIN CORE] Notice releasing task lease on approval reject:', tErr);
                  }
                }
              }
              this.channelService.sendMessage({
                channelId: targetChanId,
                senderId: approvalRow.agent_id,
                senderType: 'system',
                content: `🛑 **OPERATOR REJECTED**\nAction \`${approvalRow.tool_name}\` was explicitly denied by human operator. Execution halted.`,
                productivityScore: 50,
              });
            }
          }
        }

        this.broadcastEvent('approval:resolved', {
          approvalId,
          approved: isApproved,
          toolName: approvalRow?.tool_name,
          result: toolExecutionResult,
        });

        return this.sendJson(res, 200, {
          success: true,
          approvalId,
          status,
          result: toolExecutionResult,
        });
      }

      // 14b. POST /api/approvals — Create a pending approval gate
      if (req.method === 'POST' && pathname === '/api/approvals') {
        const body = await this.parseJsonBody<{
          agentId?: string;
          toolName: string;
          actionPayload: Record<string, any>;
          riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
        }>(req);

        if (!body.toolName) {
          return this.sendJson(res, 400, { error: 'toolName is required' });
        }

        const id = `appr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const runId = (body as any).runId || `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const agentId = body.agentId || 'agent-boss';
        const riskLevel = body.riskLevel || 'HIGH';
        const now = Date.now();

        // Validate worktreePath if provided in actionPayload
        const actionPayload = { ...(body.actionPayload || {}) };
        if (actionPayload._worktreePath) {
          const boundary = this.validateProjectBoundary(actionPayload._worktreePath);
          if (!boundary.valid || !fs.existsSync(actionPayload._worktreePath)) {
            delete actionPayload._worktreePath;
          }
        }
        if (actionPayload.worktreePath) {
          const boundary = this.validateProjectBoundary(actionPayload.worktreePath);
          if (!boundary.valid || !fs.existsSync(actionPayload.worktreePath)) {
            delete actionPayload.worktreePath;
          }
        }

        const agent = this.agentRepo.getIdentity(agentId);
        const existingRun = this.db.query<{ id: string }>('SELECT id FROM agent_runs WHERE id = ?', runId);
        if (existingRun.length === 0) {
          this.db.execute(
            `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at)
             VALUES (?, ?, ?, 'waiting_for_approval', ?, ?)`,
            runId,
            agentId,
            agent?.projectId || this.activeProjectId,
            now,
            now
          );
        } else {
          this.kernel.transitionState(runId, 'waiting_for_approval', 'Requires interactive human approval');
        }

        const sanitizedPayload = SecretBroker.getInstance().sanitizePayload(actionPayload);
        this.db.execute(
          `INSERT INTO approvals (id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          id,
          runId,
          agentId,
          body.toolName,
          JSON.stringify(sanitizedPayload),
          riskLevel,
          now + 86400000,
          now
        );

        const approvalItem = {
          id,
          runId,
          agentId,
          agentName: agent?.displayName ?? '@Boss',
          toolName: body.toolName,
          actionSummary: body.actionPayload?.command || body.actionPayload?.path || JSON.stringify(body.actionPayload),
          riskLevel,
          status: 'pending',
          createdAt: now,
          projectId: agent?.projectId || this.activeProjectId,
        };

        this.broadcastEvent('approval:created', approvalItem);
        return this.sendJson(res, 201, { approval: approvalItem });
      }

      // 15. GET /api/projects/:id/goals — List goals and tasks
      const projectGoalsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/goals$/);
      if (req.method === 'GET' && projectGoalsMatch) {
        const projectId = projectGoalsMatch[1];
        const goals = this.goalRepo.listGoals(projectId);
        const tasks = this.taskRepo.listTasksByProject(projectId);
        return this.sendJson(res, 200, { goals, tasks });
      }

      // 15b. GET /api/goals — List goals for project
      if (req.method === 'GET' && pathname === '/api/goals') {
        const projectId = parsedUrl.searchParams.get('projectId') || this.activeProjectId;
        const goals = this.goalRepo.listGoals(projectId);
        return this.sendJson(res, 200, { goals });
      }

      // 15c. GET /api/tasks — List tasks for project
      if (req.method === 'GET' && pathname === '/api/tasks') {
        const projectId = parsedUrl.searchParams.get('projectId') || this.activeProjectId;
        const tasks = this.taskRepo.listTasksByProject(projectId);
        return this.sendJson(res, 200, { tasks });
      }

      // 16. POST /api/projects/:id/goals — Create a goal
      if (req.method === 'POST' && projectGoalsMatch) {
        const projectId = projectGoalsMatch[1];
        const body = await this.parseJsonBody<{
          title: string;
          description?: string;
          acceptanceCriteria?: string[];
        }>(req);

        if (!body.title || !body.title.trim()) {
          return this.sendJson(res, 400, { error: 'Goal title is required' });
        }

        const id = `goal-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const now = Date.now();
        const goal: Goal = {
          id,
          projectId,
          title: body.title.trim(),
          description: body.description?.trim() || '',
          acceptanceCriteria: body.acceptanceCriteria || [],
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };

        this.goalRepo.createGoal(goal);
        this.broadcastEvent('goal:created', goal);

        // Auto-provision initial milestone task in DAG
        const initTaskId = `task-${now}-init`;
        const initTask: Task = {
          id: initTaskId,
          goalId: id,
          title: `Milestone 1: ${body.title.trim()}`,
          description: body.description?.trim() || `Execution milestone for ${body.title.trim()}`,
          status: 'ready',
          verificationSpec: { expectedExitCode: 0 },
          createdAt: now,
          updatedAt: now,
        };
        this.taskRepo.createTask(initTask);
        this.broadcastEvent('task:created', initTask);

        return this.sendJson(res, 201, { goal, initialTask: initTask });
      }

      // 16-1. GET /api/goals/:id — Get a single goal
      const goalGetMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
      if (req.method === 'GET' && goalGetMatch) {
        const goalId = goalGetMatch[1];
        const existing = this.goalRepo.getGoal(goalId);
        if (!existing) {
          return this.sendJson(res, 404, { error: 'Goal not found' });
        }
        return this.sendJson(res, 200, { goal: existing });
      }

      // 16-2. DELETE /api/goals/:id — Delete a goal and its tasks
      const goalDeleteMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
      if (req.method === 'DELETE' && goalDeleteMatch) {
        const goalId = goalDeleteMatch[1];
        const existing = this.goalRepo.getGoal(goalId);
        if (!existing) {
          return this.sendJson(res, 404, { error: 'Goal not found' });
        }
        this.goalRepo.deleteGoal(goalId);
        this.broadcastEvent('goal:deleted', { goalId, projectId: existing.projectId });
        return this.sendJson(res, 200, { success: true, goalId });
      }

      // 16-3. PATCH /api/goals/:id — Update a goal
      const goalPatchMatch = pathname.match(/^\/api\/goals\/([^/]+)$/);
      if (req.method === 'PATCH' && goalPatchMatch) {
        const goalId = goalPatchMatch[1];
        const existing = this.goalRepo.getGoal(goalId);
        if (!existing) {
          return this.sendJson(res, 404, { error: 'Goal not found' });
        }
        const body = await this.parseJsonBody<Partial<Goal>>(req);
        const updated: Goal = {
          ...existing,
          title: body.title !== undefined ? String(body.title).trim() : existing.title,
          description: body.description !== undefined ? String(body.description).trim() : existing.description,
          acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria : existing.acceptanceCriteria,
          status: body.status || existing.status,
          deadline: body.deadline !== undefined ? body.deadline : existing.deadline,
          checkInPolicy: body.checkInPolicy !== undefined ? body.checkInPolicy : existing.checkInPolicy,
          progressSummary: body.progressSummary !== undefined ? body.progressSummary : existing.progressSummary,
          blockedState: body.blockedState !== undefined ? body.blockedState : existing.blockedState,
          updatedAt: Date.now(),
        };
        this.goalRepo.updateGoal(updated);
        this.broadcastEvent('goal:updated', updated);
        return this.sendJson(res, 200, { goal: updated });
      }

      // 16a-2. GET /api/decisions — List all decisions across projects
      if (req.method === 'GET' && pathname === '/api/decisions') {
        const decisions = this.taskRepo.listAllDecisions();
        return this.sendJson(res, 200, decisions);
      }

      // 16a-3. POST /api/decisions — Record Architecture Decision for default project
      if (req.method === 'POST' && pathname === '/api/decisions') {
        const body = await this.parseJsonBody<{
          title: string;
          rationale: string;
          alternativesConsidered?: string[];
          status?: DecisionStatus;
          taskId?: string;
          decidedById?: string;
          projectId?: string;
        }>(req);

        if (!body.title || !body.rationale) {
          return this.sendJson(res, 400, { error: 'title and rationale are required' });
        }

        const projectId = body.projectId || this.activeProjectId;
        const decision: Decision = {
          id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          projectId,
          taskId: body.taskId,
          decidedById: body.decidedById || 'agent-boss',
          title: body.title.trim(),
          rationale: body.rationale.trim(),
          alternativesConsidered: body.alternativesConsidered || [],
          status: body.status || 'proposed',
          createdAt: Date.now(),
        };

        this.taskRepo.createDecision(decision);
        this.broadcastEvent('decision:created', decision);
        return this.sendJson(res, 201, { success: true, decision });
      }

      // 16b. GET /api/projects/:id/decisions — List Architecture Decision Records (ADR)
      const projectDecisionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/decisions$/);
      if (req.method === 'GET' && projectDecisionsMatch) {
        const projectId = projectDecisionsMatch[1];
        const decisions = this.taskRepo.listDecisionsByProject(projectId);
        return this.sendJson(res, 200, { decisions });
      }

      // 16c. POST /api/projects/:id/decisions — Record Architecture Decision
      if (req.method === 'POST' && projectDecisionsMatch) {
        const projectId = projectDecisionsMatch[1];
        const body = await this.parseJsonBody<{
          title: string;
          rationale: string;
          alternativesConsidered?: string[];
          status?: DecisionStatus;
          taskId?: string;
          decidedById?: string;
        }>(req);

        if (!body.title || !body.rationale) {
          return this.sendJson(res, 400, { error: 'title and rationale are required' });
        }

        const decision: Decision = {
          id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          projectId,
          taskId: body.taskId,
          decidedById: body.decidedById || 'agent-boss',
          title: body.title.trim(),
          rationale: body.rationale.trim(),
          alternativesConsidered: body.alternativesConsidered || [],
          status: body.status || 'proposed',
          createdAt: Date.now(),
        };

        this.taskRepo.createDecision(decision);
        this.broadcastEvent('decision:created', decision);
        return this.sendJson(res, 201, { success: true, decision });
      }

      // 16d. PATCH /api/decisions/:id/status — Resolve or update ADR status
      const decisionStatusMatch = pathname.match(/^\/api\/decisions\/([^/]+)\/status$/);
      if (req.method === 'PATCH' && decisionStatusMatch) {
        const decisionId = decisionStatusMatch[1];
        const body = await this.parseJsonBody<{ status: DecisionStatus }>(req);
        if (!body.status) {
          return this.sendJson(res, 400, { error: 'status is required' });
        }
        this.taskRepo.updateDecisionStatus(decisionId, body.status);
        const updated = this.taskRepo.getDecision(decisionId);
        if (updated) {
          this.broadcastEvent('decision:updated', updated);
        }
        return this.sendJson(res, 200, { success: true, decision: updated });
      }

      // 16e. DELETE /api/decisions/:id — Remove or revoke ADR record
      const decisionDeleteMatch = pathname.match(/^\/api\/decisions\/([^/]+)$/);
      if (req.method === 'DELETE' && decisionDeleteMatch) {
        const decisionId = decisionDeleteMatch[1];
        const existing = this.taskRepo.getDecision(decisionId);
        if (!existing) {
          return this.sendJson(res, 404, { error: 'Decision not found' });
        }
        this.taskRepo.deleteDecision(decisionId);
        this.broadcastEvent('decision:deleted', { decisionId, projectId: existing.projectId });
        return this.sendJson(res, 200, { success: true, decisionId });
      }

      // 17. POST /api/goals/:goalId/tasks — Create a task under a goal
      const goalTasksMatch = pathname.match(/^\/api\/goals\/([^/]+)\/tasks$/);
      if (req.method === 'POST' && goalTasksMatch) {
        const goalId = goalTasksMatch[1];
        const body = await this.parseJsonBody<{
          title: string;
          description?: string;
          assignedAgentId?: string;
          status?: TaskStatus | 'pending';
          dependsOnTaskIds?: string[];
          verificationSpec?: any;
        }>(req);

        if (!body.title || !body.title.trim()) {
          return this.sendJson(res, 400, { error: 'Task title is required' });
        }

        const id = `task-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const now = Date.now();
        const hasDependencies = Array.isArray(body.dependsOnTaskIds) && body.dependsOnTaskIds.length > 0;
        let initialStatus: TaskStatus = 'ready';
        if (body.status === 'pending') {
          initialStatus = 'backlog';
        } else if (body.status) {
          initialStatus = body.status as TaskStatus;
        } else if (hasDependencies) {
          initialStatus = 'backlog';
        }

        const task: Task = {
          id,
          goalId,
          title: body.title.trim(),
          description: body.description?.trim() || '',
          assignedAgentId: body.assignedAgentId || undefined,
          status: initialStatus,
          verificationSpec: body.verificationSpec || {},
          createdAt: now,
          updatedAt: now,
        };

        this.taskRepo.createTask(task, body.dependsOnTaskIds || []);
        this.broadcastEvent('task:created', task);
        return this.sendJson(res, 201, { task, dependsOnTaskIds: body.dependsOnTaskIds || [] });
      }

      // 18. PATCH /api/tasks/:taskId/status — Update task status
      const taskStatusMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
      if (req.method === 'PATCH' && taskStatusMatch) {
        const taskId = taskStatusMatch[1];
        const body = await this.parseJsonBody<{
          status: TaskStatus;
          evidenceId?: string;
          operatorSignoff?: {
            operatorId: string;
            signature: string;
            justification: string;
          };
        }>(req);

        if (!body.status) {
          return this.sendJson(res, 400, { error: 'status is required' });
        }

        const currentTask = this.taskRepo.getTask(taskId);
        if (!currentTask) {
          return this.sendJson(res, 404, { error: `Task '${taskId}' not found` });
        }

        let goalCompleted = false;

        if (body.status === 'completed') {
          // 1. Authenticate operator request against IPC auth token / session
          const authHeader = (req.headers['authorization'] as string) || '';
          const xIpcToken = req.headers['x-ipc-token'] as string;
          const xKinAuth = req.headers['x-kin-auth-token'] as string;
          const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
          const signoff = body.operatorSignoff || (
            (req.headers['x-kin-operator-signature'] || (body as any).signature) ? {
              operatorId: (req.headers['x-kin-operator-id'] as string) || (body as any).operatorId || 'operator-admin',
              signature: ((req.headers['x-kin-operator-signature'] as string) || (body as any).signature || '').trim(),
              justification: (body as any).signoffNotes || (body as any).justification || 'Operator verified completion',
            } : undefined
          );
          const providedAuthToken = bearerToken || xIpcToken || xKinAuth || (body as any).authToken || (signoff as any)?.authToken || (signoff as any)?.sessionToken;

          const validServerToken = this.ipcAuthToken;
          if (!providedAuthToken) {
            if (currentTask.status !== 'review') {
              this.taskRepo.updateTaskStatus(taskId, 'review');
              this.broadcastEvent('task:updated', { taskId, status: 'review' });
            }
            return this.sendJson(res, 401, {
              error: 'Unauthorized: Manual task sign-off requires authenticated operator session and valid IPC auth token. Task placed in review status.',
              status: 'review',
            });
          }

          let isTokenValid = false;
          if (providedAuthToken && validServerToken) {
            const provBuf = Buffer.from(String(providedAuthToken));
            const validBuf = Buffer.from(String(validServerToken));
            if (provBuf.length === validBuf.length && crypto.timingSafeEqual(provBuf, validBuf)) {
              isTokenValid = true;
            }
          }

          if (!isTokenValid) {
            if (currentTask.status !== 'review') {
              this.taskRepo.updateTaskStatus(taskId, 'review');
              this.broadcastEvent('task:updated', { taskId, status: 'review' });
            }
            return this.sendJson(res, 403, {
              error: 'Forbidden: Invalid operator IPC authentication token. Task placed in review status.',
              status: 'review',
            });
          }

          let evidenceId = body.evidenceId || currentTask.evidenceBundleId;

          if (!evidenceId) {
            if (signoff?.operatorId && signoff?.signature && signoff?.justification) {
              let runId = currentTask.claimedByRunId;
              if (!runId) {
                const runRow = this.db.queryOne<{ id: string }>(
                  'SELECT id FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
                  taskId
                );
                if (runRow) {
                  runId = runRow.id;
                } else {
                  runId = `run-operator-${taskId}`;
                  try {
                    this.db.execute(
                      `INSERT OR IGNORE INTO agent_runs (id, agent_id, project_id, task_id, state, heartbeat_at, created_at)
                       VALUES (?, 'agent-boss', ?, ?, 'completed', ?, ?)`,
                      runId,
                      this.activeProjectId,
                      taskId,
                      Date.now(),
                      Date.now()
                    );
                  } catch {}
                }
              }

              // 2. Cryptographically verify operator signature against session/token binding
              const operatorSig = signoff.signature || (req.headers['x-kin-operator-signature'] as string);
              const expectedHmac = crypto.createHmac('sha256', validServerToken).update(`${signoff.operatorId}:${taskId}:${runId}:${signoff.justification}`).digest('hex');
              const expectedHmacCompact = crypto.createHmac('sha256', validServerToken).update(`${taskId}:completed`).digest('hex');
              const expectedTokenDigest = crypto.createHash('sha256').update(`${signoff.operatorId}:${validServerToken}:${taskId}`).digest('hex');
              const isSignatureValid = Boolean(operatorSig && (operatorSig === expectedHmac || operatorSig === expectedHmacCompact || operatorSig === expectedTokenDigest));

              if (!isSignatureValid) {
                if (currentTask.status !== 'review') {
                  this.taskRepo.updateTaskStatus(taskId, 'review');
                  this.broadcastEvent('task:updated', { taskId, status: 'review' });
                }
                return this.sendJson(res, 403, {
                  error: 'Forbidden: Operator signature verification failed. Task placed in review status.',
                  status: 'review',
                });
              }

              evidenceId = `ev-signoff-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
              const signoffUri = `operator://signoff/${encodeURIComponent(signoff.operatorId)}?sig=${encodeURIComponent(signoff.signature)}&reason=${encodeURIComponent(signoff.justification)}`;
              this.db.execute(
                `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
                 VALUES (?, ?, ?, 'human_signoff', ?, 1, ?)`,
                evidenceId,
                taskId,
                runId,
                signoffUri,
                Date.now()
              );
              EventLedger.getInstance().record({
                eventType: 'EVIDENCE_RECORDED',
                entityType: 'task',
                entityId: taskId,
                payload: {
                  evidenceId,
                  type: 'human_signoff',
                  contentUri: signoffUri,
                  operatorId: signoff.operatorId,
                  runId,
                  justification: signoff.justification,
                },
              });
            } else {
              // Refuse synthetic sign-off; task must remain in review until signed off
              if (currentTask.status !== 'review') {
                this.taskRepo.updateTaskStatus(taskId, 'review');
                this.broadcastEvent('task:updated', { taskId, status: 'review' });
              }
              return this.sendJson(res, 400, {
                error: 'Task completion requires verified evidenceId or explicit operator sign-off with operatorId, signature, and justification. Task placed in review status.',
                status: 'review',
              });
            }
          }

          if (currentTask.status !== 'running' && currentTask.status !== 'review') {
            this.taskRepo.updateTaskStatus(taskId, 'review');
          }

          let promotedTaskIds: string[] = [];
          try {
            promotedTaskIds = this.taskRepo.completeTask(taskId, evidenceId);
          } catch (completeErr: any) {
            return this.sendJson(res, 400, { error: completeErr.message });
          }

          for (const pId of promotedTaskIds) {
            this.broadcastEvent('task:updated', { taskId: pId, status: 'ready' });
            const nextReady = this.taskRepo.getTask(pId);
            if (nextReady && nextReady.status === 'ready') {
              let nextWorker = nextReady.assignedAgentId ? this.agentRepo.getIdentity(nextReady.assignedAgentId) : undefined;
              if (!nextWorker) {
                const targetProj = this.activeProjectId || 'proj-kin';
                nextWorker = this.agentRepo.ensureProjectBoss(targetProj);
              }
              if (nextWorker) {
                const targetChannelId = (nextReady as any).channelId || this.workspaceRepo.listChannels(this.activeProjectId || 'proj-kin')[0]?.id || 'chan-general';
                const taskTrigger = {
                  id: `task-advance-${Date.now()}-${nextReady.id}`,
                  channelId: targetChannelId,
                  senderId: 'system-dag-advancer',
                  senderType: 'system' as const,
                  content: `[Automated DAG Dispatch] Initiating promoted task: "${nextReady.title}". ${nextReady.description || ''}`,
                  taskId: nextReady.id,
                  createdAt: Date.now(),
                };
                this.enqueueChannelExecution(targetChannelId, () =>
                  this.enqueueAgentExecution(nextWorker.id, () =>
                    this.executeAgentResponse(nextWorker, targetChannelId, taskTrigger)
                  )
                );
              }
            }
          }
          this.broadcastEvent('task:updated', { taskId, status: 'completed', evidenceBundleId: evidenceId });

          if (currentTask.goalId) {
            const siblingTasks = this.taskRepo.listTasksByGoal(currentTask.goalId);
            const allDone = siblingTasks.every((t) => (t.id === taskId ? true : t.status === 'completed'));
            if (allDone) {
              this.db.execute("UPDATE goals SET status = 'completed', updated_at = ? WHERE id = ?", Date.now(), currentTask.goalId);
              const updatedGoal = this.goalRepo.getGoal(currentTask.goalId);
              if (updatedGoal) {
                this.broadcastEvent('goal:updated', updatedGoal);
                goalCompleted = true;
              }
            }
          }

          return this.sendJson(res, 200, {
            success: true,
            taskId,
            status: 'completed',
            evidenceBundleId: evidenceId,
            promotedTaskIds,
            goalCompleted,
          });
        } else if (body.status === 'running') {
          return this.sendJson(res, 400, {
            error: 'Cannot manually force task to running status without worker lease claim.',
          });
        } else {
          this.taskRepo.updateTaskStatus(taskId, body.status);
          this.broadcastEvent('task:updated', { taskId, status: body.status });
        }

        return this.sendJson(res, 200, {
          success: true,
          taskId,
          status: body.status,
          goalCompleted,
        });
      }

      // 18b. DELETE /api/tasks/:id — Delete a single task
      const taskDeleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (req.method === 'DELETE' && taskDeleteMatch) {
        const taskId = taskDeleteMatch[1];
        const existing = this.taskRepo.getTask(taskId);
        if (!existing) {
          return this.sendJson(res, 404, { error: 'Task not found' });
        }
        this.taskRepo.deleteTask(taskId);
        this.broadcastEvent('task:deleted', { taskId, goalId: existing.goalId });
        return this.sendJson(res, 200, { success: true, taskId });
      }

      // 72. POST /api/decisions/grill-me-answers — Receive answers from GrillMe card & record authoritative ADR
      if (req.method === 'POST' && pathname === '/api/decisions/grill-me-answers') {
        const body = await this.parseJsonBody<{
          channelId: string;
          topic: string;
          answers: Record<string, string>;
        }>(req);

        const now = Date.now();
        const decisionId = `dec-grill-${now}`;
        const targetProj = this.activeProjectId;
        const boss = this.agentRepo.listIdentitiesByProject(targetProj).find((a) => a.isOrchestrator);

        const summaryLines = Object.entries(body.answers || {}).map(([q, a]) => {
          const label = q.startsWith('q') && !isNaN(Number(q.slice(1))) ? `Question ${q.slice(1)}` : q;
          return `• **${label}**: ${a}`;
        });
        const rationale = `Hardened architectural decisions validated via /grill-me adversarial review for: ${body.topic || 'System Architecture'}.\n${summaryLines.join('\n')}`;

        const newDec: Decision = {
          id: decisionId,
          projectId: targetProj,
          decidedById: boss?.id || 'agent-boss',
          title: `Hardened Architecture: ${body.topic || 'Resilience & Quota Safety'}`,
          rationale,
          alternativesConsidered: ['Ad-hoc error handling', 'Naive retry without state checkpoints', 'Manual operator intervention'],
          status: 'authoritative',
          createdAt: now,
        };

        this.taskRepo.createDecision(newDec);
        this.broadcastEvent('decision:created', newDec);

        const confirmMsg = this.channelService.sendMessage({
          channelId: body.channelId || 'chan-default',
          senderId: boss?.id || 'agent-boss',
          senderType: 'agent',
          content: `🛡️ **Architecture Hardened & Authoritative Decision Recorded!**\n\n` +
            `Your responses have been validated and minted as authoritative ADR: **"${newDec.title}"** (\`${newDec.id}\`).\n\n` +
            `**Key Trade-offs Solidified**:\n${summaryLines.join('\n')}\n\n` +
            `The autonomous workforce will strictly adhere to these hardened constraints.`,
          productivityScore: 100,
        });

        this.broadcastEvent('message:created', {
          id: confirmMsg.id,
          channelId: confirmMsg.channelId,
          senderId: confirmMsg.senderId,
          senderName: boss?.displayName.replace(/^@/, '') || 'Boss',
          senderType: 'agent',
          content: confirmMsg.content,
          createdAt: confirmMsg.createdAt,
          productivityScore: confirmMsg.productivityScore,
        });

        return this.sendJson(res, 200, {
          success: true,
          decision: newDec,
        });
      }

    return false;
  }
}
