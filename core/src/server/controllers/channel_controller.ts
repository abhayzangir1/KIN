import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { AgentDefinition, AgentIdentity, Channel, Goal, Task, Decision } from '../../domain/types.js';
import { ContextCompactor } from '../../context/context_compactor.js';
import { BaseController } from './base_controller.js';

export class ChannelController extends BaseController {
  public async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    parsedUrl: URL
  ): Promise<boolean> {
      // 7a. GET /api/channels — List channels in project
      if (req.method === 'GET' && pathname === '/api/channels') {
        const projectId = parsedUrl.searchParams.get('projectId') || this.activeProjectId;
        const channels = this.workspaceRepo.listChannels(projectId, true);
        const mapped = channels.map((c: Channel) => ({
          id: c.id,
          projectId: c.projectId,
          name: c.name,
          topic: c.topic,
          isPrivate: c.isPrivate,
          channelType: c.channelType || (c.isPrivate ? 'direct_message' : 'channel'),
          createdAt: c.createdAt,
          memberIds: this.workspaceRepo.listChannelMemberIds(c.id),
        }));
        return this.sendJson(res, 200, { channels: mapped });
      }

      // 7b. POST /api/channels — Create channel in project
      if (req.method === 'POST' && pathname === '/api/channels') {
        const body = await this.parseJsonBody<{ projectId?: string; name: string; topic?: string; isPrivate?: boolean; channelType?: 'channel' | 'direct_message' | 'meeting' }>(req);
        if (!body.name || !body.name.trim()) {
          return this.sendJson(res, 400, { error: 'Channel name is required' });
        }

        const projectId = body.projectId || this.activeProjectId;
        const channelId = `chan-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const now = Date.now();
        const cleanName = body.name.trim().toLowerCase().replace(/^#/, '');
        const isPrivate = !!body.isPrivate;
        const channelType = body.channelType || (isPrivate ? 'direct_message' : 'channel');

        const channel: Channel = {
          id: channelId,
          projectId,
          name: cleanName,
          topic: body.topic?.trim() || undefined,
          isPrivate,
          channelType,
          createdAt: now,
        };

        this.workspaceRepo.createChannel(channel);

        // Invariant: By default, a new channel has strictly ONE default agent: @Boss
        const boss = this.agentRepo.ensureProjectBoss(projectId);
        this.workspaceRepo.addChannelMember(channelId, boss.id);

        const channelItem = {
          id: channel.id,
          projectId: channel.projectId,
          name: channel.name,
          topic: channel.topic,
          unreadCount: 0,
          memberIds: [boss.id],
        };

        this.broadcastEvent('channel:created', { channel: channelItem, members: [boss.id] });
        return this.sendJson(res, 201, { channel: channelItem });
      }

      // 7b-2. DELETE /api/channels/:id — Delete a channel and its messages
      const channelDeleteMatch = pathname.match(/^\/api\/channels\/([^/]+)$/);
      if (req.method === 'DELETE' && channelDeleteMatch) {
        const channelId = channelDeleteMatch[1];
        if (channelId === 'chan-general') {
          return this.sendJson(res, 400, { error: 'Cannot delete default general channel' });
        }
        const existing = this.workspaceRepo.getChannel(channelId);
        if (!existing) {
          return this.sendJson(res, 404, { error: 'Channel not found' });
        }
        this.workspaceRepo.deleteChannel(channelId);
        this.broadcastEvent('channel:deleted', { channelId, projectId: existing.projectId });
        return this.sendJson(res, 200, { success: true, channelId });
      }

      // 7c. GET /api/channels/:id/members — List members assigned to channel
      const channelMembersMatch = pathname.match(/^\/api\/channels\/([^/]+)\/members$/);
      if (req.method === 'GET' && channelMembersMatch) {
        const channelId = channelMembersMatch[1];
        let memberIds = this.workspaceRepo.listChannelMemberIds(channelId);

        // If channel has no members recorded and is not a private DM, add project orchestrator
        if (memberIds.length === 0 && !channelId.startsWith('dm-')) {
          const chan = this.workspaceRepo.getChannel(channelId);
          const chanProjId = chan?.projectId || this.activeProjectId;
          const projAgents = this.agentRepo.listIdentitiesByProject(chanProjId);
          const boss = projAgents.find((a) => a.isOrchestrator) || projAgents[0] || this.agentRepo.getIdentity('agent-boss');
          if (boss) {
            this.workspaceRepo.addChannelMember(channelId, boss.id);
            memberIds = [boss.id];
          }
        }

        const ollamaInfo = await this.getLocalOllamaModels();
        const activeCreds = this.db.query<any>('SELECT DISTINCT provider FROM managed_credentials WHERE is_active = 1');
        const configuredProviders = new Set<string>(['ollama', ...activeCreds.map((c: any) => c.provider.toLowerCase())]);

        const members = memberIds
          .map((id) => this.agentRepo.getIdentity(id))
          .filter(Boolean)
          .map((a) => {
            const def = this.agentRepo.getDefinition(a!.definitionId);
            const chanModelOverride = this.memoryRepo.getMemory('channel', channelId, `agent_model:${a!.id}`)?.value as string | undefined;
            const effectiveModel = chanModelOverride || a!.activeModelId;
            const { modelAvailable, modelStatus } = this.computeModelAvailability(
              effectiveModel,
              ollamaInfo,
              configuredProviders,
              activeCreds.length
            );

            return {
              id: a!.id,
              name: def?.name ?? a!.displayName,
              role: def?.role ?? (a!.isOrchestrator ? 'Workspace Orchestrator' : 'Specialist'),
              displayName: a!.displayName,
              activeModelId: effectiveModel,
              fallbackModelId: a!.fallbackModelId,
              systemPrompt: def?.systemPrompt,
              status: 'idle',
              isOrchestrator: a!.isOrchestrator,
              projectId: a!.projectId,
              modelAvailable,
              modelStatus,
            };
          });

        return this.sendJson(res, 200, { members });
      }

      // 7d. POST /api/channels/:id/members — Assign existing project agent to channel
      if (req.method === 'POST' && channelMembersMatch) {
        const channelId = channelMembersMatch[1];
        const body = await this.parseJsonBody<{ agentId: string }>(req);
        if (!body.agentId) {
          return this.sendJson(res, 400, { error: 'agentId is required' });
        }

        const agent = this.agentRepo.getIdentity(body.agentId);
        if (!agent) {
          return this.sendJson(res, 404, { error: 'Agent not found' });
        }

        const channel = this.workspaceRepo.getChannel(channelId);
        if (!channel) {
          return this.sendJson(res, 404, { error: 'Channel not found' });
        }

        // Strict cross-project boundary enforcement:
        // Specialists cannot be assigned to channels outside their bound project.
        if (agent.projectId && channel.projectId && agent.projectId !== channel.projectId && !agent.isOrchestrator && agent.id !== 'agent-boss') {
          return this.sendJson(res, 400, {
            error: `Cross-project boundary violation: Agent ${agent.displayName} belongs to project ${agent.projectId} and cannot be assigned to channel in project ${channel.projectId}.`,
          });
        }

        this.workspaceRepo.addChannelMember(channel.id, agent.id);
        this.broadcastEvent('channel:member_added', { channelId: channel.id, agentId: agent.id });
        return this.sendJson(res, 200, { success: true, channelId: channel.id, agentId: agent.id });
      }

      // 7e. DELETE /api/channels/:id/members/:agentId — Remove agent from channel
      const channelMemberDeleteMatch = pathname.match(/^\/api\/channels\/([^/]+)\/members\/([^/]+)$/);
      if (req.method === 'DELETE' && channelMemberDeleteMatch) {
        const channelId = channelMemberDeleteMatch[1];
        const agentId = channelMemberDeleteMatch[2];

        const agent = this.agentRepo.getIdentity(agentId);
        if (agent?.isOrchestrator) {
          return this.sendJson(res, 400, { error: 'Cannot remove default orchestrator @Boss from channel' });
        }

        this.workspaceRepo.removeChannelMember(channelId, agentId);
        this.broadcastEvent('channel:member_removed', { channelId, agentId });
        return this.sendJson(res, 200, { success: true, channelId, agentId });
      }

      // 8e. GET /api/channels/:channelId/queue — List queued messages for channel
      const channelQueueMatch = pathname.match(/^\/api\/channels\/([^/]+)\/queue$/);
      if (req.method === 'GET' && channelQueueMatch) {
        const channelId = channelQueueMatch[1];
        const rows = this.db.query<{
          id: string;
          channel_id: string;
          sender_id: string;
          content: string;
          metadata_json: string;
          created_at: number;
        }>('SELECT * FROM queued_messages WHERE channel_id = ? ORDER BY created_at ASC', channelId);

        return this.sendJson(res, 200, {
          queuedMessages: rows.map((r) => ({
            id: r.id,
            channelId: r.channel_id,
            senderId: r.sender_id,
            content: r.content,
            metadata: JSON.parse(r.metadata_json || '{}'),
            createdAt: r.created_at,
          })),
        });
      }

      // 8f. POST /api/channels/:channelId/queue — Enqueue message for channel
      if (req.method === 'POST' && channelQueueMatch) {
        const channelId = channelQueueMatch[1];
        const body = await this.parseJsonBody<{ content: string; senderId?: string; metadata?: any }>(req);

        if (!body.content || !body.content.trim()) {
          return this.sendJson(res, 400, { error: 'content cannot be empty' });
        }

        const id = `qmsg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const now = Date.now();
        const senderId = body.senderId || 'user-operator';
        const metadataJson = JSON.stringify(body.metadata || {});

        this.db.execute(
          `INSERT INTO queued_messages (id, channel_id, sender_id, content, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          channelId,
          senderId,
          body.content.trim(),
          metadataJson,
          now
        );

        const queuedMsg = {
          id,
          channelId,
          senderId,
          content: body.content.trim(),
          metadata: body.metadata || {},
          createdAt: now,
        };

        this.broadcastEvent('message:queued', { message: queuedMsg });

        // If channel is completely idle, process immediately
        const activeInChan = Array.from(this.activeAgentExecutions.values()).filter((e) => e.channelId === channelId);
        if (activeInChan.length === 0) {
          this.processNextQueuedMessage(channelId).catch((err) => {
            console.error('[KIN CORE] Immediate queue processing notice:', err);
          });
        }

        return this.sendJson(res, 201, { success: true, message: queuedMsg });
      }

      // 8g. DELETE /api/channels/:channelId/queue/:msgId — Delete specific queued message
      const channelQueueItemMatch = pathname.match(/^\/api\/channels\/([^/]+)\/queue\/([^/]+)$/);
      if (req.method === 'DELETE' && channelQueueItemMatch) {
        const channelId = channelQueueItemMatch[1];
        const msgId = channelQueueItemMatch[2];

        this.db.execute('DELETE FROM queued_messages WHERE channel_id = ? AND id = ?', channelId, msgId);
        this.broadcastEvent('queue:deleted', { channelId, messageId: msgId });

        return this.sendJson(res, 200, { success: true, messageId: msgId });
      }

      // 9. GET /api/channels/:channelId/messages
      const channelMessagesMatch = pathname.match(/^\/api\/channels\/([^/]+)\/messages$/);
      if (req.method === 'GET' && channelMessagesMatch) {
        const channelId = channelMessagesMatch[1];
        const messages = this.channelService.getMessages(channelId, 100);
        const targetChannel = this.workspaceRepo.getChannel(channelId);
        const targetProjectId = targetChannel?.projectId || this.activeProjectId;
        const agents = this.agentRepo.listIdentitiesByProject(targetProjectId);

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

    if (req.method === 'POST' && channelMessagesMatch) {
      const channelId = channelMessagesMatch[1];
      await this.handlePostMessages(req, res, channelId);
      return true;
    }

    return false;
  }

  private async handlePostMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<any> {
        const body = await this.parseJsonBody<{ content: string; senderId?: string; senderType?: 'human' | 'agent' | 'system'; isSteer?: boolean }>(req);

        if (!body.content || !body.content.trim()) {
          return this.sendJson(res, 400, { error: 'Message content cannot be empty' });
        }

        // Auto-provision private DM channel if necessary
        let channel = this.workspaceRepo.getChannel(channelId);
        if (!channel && channelId.startsWith('dm-')) {
          const rawId = channelId.replace(/^dm-/, '');
          let agentA: AgentIdentity | undefined;
          let agentB: AgentIdentity | undefined;

          // Attempt compound agent DM extraction: e.g. dm-agentA-agentB
          const compoundRegex = /^(agent-[\w.-]+?)-(agent-[\w.-]+)$/;
          const match = rawId.match(compoundRegex);
          if (match) {
            const candidateA = this.agentRepo.getIdentity(match[1]);
            const candidateB = this.agentRepo.getIdentity(match[2]);
            if (candidateA && candidateB) {
              agentA = candidateA;
              agentB = candidateB;
            }
          }

          // Fallback parsing across all hyphen split points in compound DM
          if (!agentA || !agentB) {
            const parts = rawId.split('-');
            for (let i = 1; i < parts.length; i++) {
              const p1 = parts.slice(0, i).join('-');
              const p2 = parts.slice(i).join('-');
              const candA = this.agentRepo.getIdentity(p1);
              const candB = this.agentRepo.getIdentity(p2);
              if (candA && candB) {
                agentA = candA;
                agentB = candB;
                break;
              }
            }
          }

          if (agentA && agentB) {
            const targetProjectId = agentA.projectId || agentB.projectId || this.activeProjectId;
            this.workspaceRepo.createChannel({
              id: channelId,
              projectId: targetProjectId,
              name: `dm-${agentA.displayName.replace(/^@/, '')}-${agentB.displayName.replace(/^@/, '')}`,
              topic: `Private 1-on-1 Direct Message between ${agentA.displayName} and ${agentB.displayName}`,
              channelType: 'direct_message',
              isPrivate: true,
              participantIds: [agentA.id, agentB.id],
              createdAt: Date.now(),
            });
            this.workspaceRepo.addChannelMember(channelId, agentA.id);
            this.workspaceRepo.addChannelMember(channelId, agentB.id);
            channel = this.workspaceRepo.getChannel(channelId);
          } else {
            // Single agent ID (human-to-agent DM): preserve existing behavior only when agent exists
            const targetAgentId = rawId;
            const targetAgent = this.agentRepo.getIdentity(targetAgentId);
            if (targetAgent) {
              this.workspaceRepo.createChannel({
                id: channelId,
                projectId: targetAgent.projectId || this.activeProjectId,
                name: targetAgent.displayName ?? 'DM',
                topic: `Private 1-on-1 Direct Message with ${targetAgent.displayName ?? targetAgentId}`,
                channelType: 'direct_message',
                isPrivate: true,
                createdAt: Date.now(),
              });
              this.workspaceRepo.addChannelMember(channelId, targetAgentId);
              channel = this.workspaceRepo.getChannel(channelId);
            }
          }
        }

        if (!channel) {
          return this.sendJson(res, 404, { error: 'Channel not found' });
        }

        // Persist message
        let senderType: 'human' | 'agent' | 'system' = 'human';
        if (body.senderType === 'system') {
          return this.sendJson(res, 400, { error: "External requests cannot forge senderType 'system'" });
        } else if (body.senderType === 'agent' || body.senderId?.startsWith('agent-')) {
          senderType = 'agent';
        } else {
          senderType = 'human';
        }
        const targetProjectId = channel.projectId || this.activeProjectId;
        const allProjectAgents = this.agentRepo.listIdentitiesByProject(targetProjectId);

        // Resolve [📎 filename] attachments in .kin/uploads/
        let effectiveContent = body.content.trim();
        if (effectiveContent.length > 65536) {
          return this.sendJson(res, 400, { error: 'Message content exceeds maximum allowed length of 65536 characters' });
        }
        const attachmentMatches = Array.from(effectiveContent.matchAll(/\[📎\s*([^\]]+)\]/g));
        if (attachmentMatches.length > 0) {
          const project = this.workspaceRepo.getProject(targetProjectId);
          const uploadsDir = path.join(project?.repoPath || process.cwd(), '.kin', 'uploads');
          if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir);
            for (const match of attachmentMatches) {
              const rawFilename = match[1].trim();
              const matchedFile = files.find((f) => f === rawFilename || f.endsWith(`-${rawFilename}`) || f.includes(rawFilename));
              if (matchedFile) {
                const diskPath = path.join(uploadsDir, matchedFile);
                try {
                  const stat = fs.statSync(diskPath);
                  let preview = '';
                  if (stat.size < 64000) {
                    preview = `\n[File Content Preview]:\n${fs.readFileSync(diskPath, 'utf-8').slice(0, 4000)}`;
                  }
                  effectiveContent += `\n\n[System Attachment: '${rawFilename}' resolved on disk at: ${diskPath} (${stat.size} bytes)]${preview}`;
                } catch {}
              }
            }
          }
        }

        const nowMs = Date.now();
        if (!body.isSteer) {
          const senderKey = body.senderId || 'user-operator';
          const promptFingerprint = `${channelId}:${senderKey}:${effectiveContent.trim().toLowerCase()}`;
          const lastFingerprint = this.lastChannelPromptFingerprints.get(promptFingerprint);
          if (lastFingerprint && (nowMs - lastFingerprint.timestamp) < 1500) {
            console.log(`[KIN CORE] Fencing gate: Suppressing duplicate prompt submission in quick succession for channel ${channelId}`);
            return this.sendJson(res, 200, {
              success: true,
              suppressedDuplicate: true,
              message: 'Duplicate prompt submitted in quick succession; admission fencing active.',
            });
          }
          this.lastChannelPromptFingerprints.set(promptFingerprint, { promptHash: promptFingerprint, timestamp: nowMs });
          if (this.lastChannelPromptFingerprints.size > 1000) {
            const excess = this.lastChannelPromptFingerprints.size - 1000;
            let removed = 0;
            for (const k of this.lastChannelPromptFingerprints.keys()) {
              this.lastChannelPromptFingerprints.delete(k);
              removed++;
              if (removed >= excess) break;
            }
          }
          this.pruneOldAdmissionFences(nowMs);
        }

        const userMsg = this.channelService.sendMessage({
          channelId,
          senderId: body.senderId || 'user-operator',
          senderType,
          content: effectiveContent,
        });

        const fenceToken = `fence-${userMsg.id}-${nowMs}`;
        (userMsg as any).fencingToken = fenceToken;
        this.messageAdmissionFences.set(userMsg.id, {
          fenceToken,
          channelId,
          timestamp: nowMs,
          status: 'admitted',
          completedAgents: new Set(),
        });

        const rawContent = userMsg.content;
        const contentTrimmed = rawContent.trim();
        const contentLower = contentTrimmed.toLowerCase();

        // FAST-PATH: /btw <query> — Dedicated Non-Blocking Ephemeral Side-Channel Inquiry
        // Intercepted before steer detection and channel queue locks so side inquiries answer in parallel
        // without waiting for long agent execution loops, without polluting project DAGs or acquiring task leases.
        if (
          contentLower === '/btw' ||
          contentLower.startsWith('/btw ') ||
          contentLower.startsWith('/btw:') ||
          contentLower.startsWith('/btw\n')
        ) {
          const btwQuery = rawContent.replace(/^\/btw[\s:\n]*/i, '').trim();
          const boss = allProjectAgents.find((a) => a.isOrchestrator) || allProjectAgents[0] || this.agentRepo.getIdentity('agent-boss');

          const formattedUserMsg = {
            id: userMsg.id,
            channelId: userMsg.channelId,
            senderId: userMsg.senderId,
            senderName: 'Human',
            senderType: 'human',
            content: userMsg.content,
            createdAt: userMsg.createdAt,
            isSteer: false,
            metadata: { isSideQuery: true },
          };
          this.broadcastEvent('message:created', formattedUserMsg);
          this.sendJson(res, 201, { message: formattedUserMsg, triggeredCount: 1, sideQuery: true });

          // Non-blocking parallel execution on dedicated fast path
          (async () => {
            if (!btwQuery) {
              if (boss) {
                const helpMsg = this.channelService.sendMessage({
                  channelId,
                  senderId: boss.id,
                  senderType: 'agent',
                  content: `💡 **Usage**: \`/btw <question>\`\n\nAsk a quick side-channel question without modifying active tasks, mutating project goals, or claiming work leases.\n\n*Example*: \`/btw What port is the Node daemon running on?\``,
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
                  metadata: { isSideQuery: true },
                });
              }
              return;
            }

            const answeringAgent = allProjectAgents.find((a) =>
              btwQuery.toLowerCase().includes(a.displayName.toLowerCase().replace(/^@/, ''))
            ) || boss;

            if (answeringAgent) {
              let answer = '';
              let modelUsed = answeringAgent.activeModelId;

              // Check if OpenRouter is active in BYOK credentials
              const openRouterKey = this.modelGateway.resolveApiKey('openrouter');
              const ollamaInfo = await this.getLocalOllamaModels();

              try {
                const fastModelPromise = (async () => {
                  if (openRouterKey) {
                    const orRes = await this.modelGateway.invoke({
                      modelId: 'openrouter/qwen/qwen3.8-27b:free',
                      messages: [
                        { role: 'system', content: `You are ${answeringAgent.displayName}, an AI specialist in KIN. The human operator is asking a quick side-channel question (/btw). Provide a sharp, direct, concise answer without proposing tasks.` },
                        { role: 'user', content: btwQuery },
                      ],
                      maxTokens: 512,
                    });
                    if (!orRes.isError && orRes.content) {
                      return { content: orRes.content, model: 'openrouter/qwen/qwen3.8-27b:free' };
                    }
                  }

                  if (ollamaInfo.online) {
                    const res = await this.modelGateway.invoke({
                      modelId: answeringAgent.activeModelId,
                      messages: [
                        { role: 'system', content: `You are ${answeringAgent.displayName}, an AI specialist in KIN. The human operator is asking a quick side-channel question (/btw). Provide a sharp, direct, concise answer without proposing tasks.` },
                        { role: 'user', content: btwQuery },
                      ],
                      maxTokens: 512,
                    });
                    if (!res.isError && res.content) {
                      return { content: res.content, model: answeringAgent.activeModelId };
                    }
                  }
                  return null;
                })();

                const timeoutMs = (process.env.VITEST || process.env.NODE_ENV === 'test') ? 1500 : 8000;
                const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
                const fastResult = await Promise.race([fastModelPromise, timeoutPromise]);
                if (fastResult) {
                  answer = fastResult.content;
                  modelUsed = fastResult.model;
                }
              } catch (err: any) {
                console.warn('[KIN CORE] Fast-path /btw model invocation fallback:', err?.message);
              }

              if (!answer) {
                answer = `The quick query "${btwQuery}" could not be completed because the model is currently unavailable or the request timed out. Please check model provider configuration and try again.`;
              }

              const btwReply = this.channelService.sendMessage({
                channelId,
                senderId: answeringAgent.id,
                senderType: 'agent',
                content: `💡 **[Side Query / BTW]**\n\n${answer}`,
                productivityScore: 100,
              });
              this.broadcastEvent('message:created', {
                id: btwReply.id,
                channelId: btwReply.channelId,
                senderId: btwReply.senderId,
                senderName: answeringAgent.displayName.replace(/^@/, ''),
                senderType: 'agent',
                content: btwReply.content,
                createdAt: btwReply.createdAt,
                productivityScore: btwReply.productivityScore,
                metadata: { isSideQuery: true, modelUsed },
              });
            }
          })().catch((err) => console.error('[KIN CORE] /btw fast-path execution error:', err));

          return;
        }

        // Check if any agent is currently executing IN THIS SPECIFIC CHANNEL
        const activeExecutionsInChan = Array.from(this.activeAgentExecutions.values()).filter(
          (e) => e.channelId === channelId
        );
        const isAgentActiveInChannel = activeExecutionsInChan.length > 0 || this.channelQueues.has(channelId);
        const activeAgentIds = activeExecutionsInChan.map((e) => e.agentId);

        // Check if message is addressing a DIFFERENT specialist in the project that is NOT currently running
        let targetedOtherAgent: AgentIdentity | undefined;
        for (const ag of allProjectAgents) {
          const cleanName = ag.displayName.toLowerCase().replace(/^@/, '');
          const isMentioned = userMsg.mentions.some(
            (m: string) => m.toLowerCase().replace(/^@/, '') === cleanName || m.toLowerCase() === ag.id.toLowerCase()
          );
          const isNamedInContent = body.content.toLowerCase().includes(ag.displayName.toLowerCase()) ||
            body.content.toLowerCase().includes(`@${cleanName}`);

          if ((isMentioned || isNamedInContent) && !activeAgentIds.includes(ag.id)) {
            targetedOtherAgent = ag;
            break;
          }
        }

        const activeAgentNames = allProjectAgents
          .filter((a) => activeAgentIds.includes(a.id))
          .map((a) => a.displayName.toLowerCase().replace(/^@/, ''));

        const hasNonActiveMention = userMsg.mentions.some((m: string) => {
          const clean = m.toLowerCase().replace(/^@/, '');
          return !activeAgentIds.some((id) => id.toLowerCase() === clean) &&
                 !activeAgentNames.some((n) => n === clean);
        }) || (/@([a-zA-Z0-9_-]+)/i.test(body.content) && !activeAgentNames.some((n) => body.content.toLowerCase().includes(`@${n}`)));

        const explicitSteer = body.isSteer === true;
        let isSteer = false;
        // Only treat as a steer if explicitSteer is true OR (channel is currently running an agent AND not directing to another specialist)
        if (explicitSteer || (isAgentActiveInChannel && !targetedOtherAgent && !hasNonActiveMention)) {
          isSteer = true;
          let targetAgentId: string | undefined;
          for (const ag of allProjectAgents) {
            if (activeAgentIds.includes(ag.id) && body.content.toLowerCase().includes(ag.displayName.toLowerCase())) {
              targetAgentId = ag.id;
              break;
            }
          }

          const trimmedDirective = body.content.trim();
          const now = Date.now();
          const isDuplicate = this.pendingSteers.some((s) =>
            s.channelId === channelId &&
            s.directive === trimmedDirective &&
            (now - s.timestamp) < 2000
          );

          if (!isDuplicate) {
            this.pendingSteers.push({
              id: `steer-${now}-${Math.random().toString(36).slice(2, 6)}`,
              channelId,
              directive: trimmedDirective,
              targetAgentId,
              consumedByAgentIds: [],
              timestamp: now,
            });

            // Immediate abort of in-flight inference for active runs in this channel
            for (const exec of this.activeAgentExecutions.values()) {
              if (exec.channelId === channelId && exec.runId) {
                const currentCtrl = this.runAbortControllers.get(exec.runId);
                if (currentCtrl) {
                  try {
                    currentCtrl.abort('steer');
                  } catch {}
                  // Immediately replace with fresh AbortController for subsequent turns of this run
                  this.runAbortControllers.set(exec.runId, new AbortController());
                }
              }
            }
          }

          // Dynamically update active tasks in project DAG for this channel and target agent
          try {
            const activeTasks = this.taskRepo.listTasksByProject(channel.projectId || this.activeProjectId).filter((t) => t.status === 'running');
            for (const t of activeTasks) {
              if (t.assignedAgentId && !activeAgentIds.includes(t.assignedAgentId)) continue;
              if (targetAgentId && t.assignedAgentId && t.assignedAgentId !== targetAgentId) continue;
              const updatedDesc = `${t.description}\n[STEER DIRECTIVE]: ${body.content.trim()}`;
              this.db.execute('UPDATE tasks SET description = ?, updated_at = ? WHERE id = ?', updatedDesc, Date.now(), t.id);
              this.broadcastEvent('task:updated', { taskId: t.id, status: 'running', description: updatedDesc });
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn('[KIN CORE] Steer directive update failed:', message);
          }

          this.broadcastEvent('steer:received', {
            channelId,
            directive: body.content.trim(),
            timestamp: Date.now(),
          });
        }

        const formattedUserMsg = {
          id: userMsg.id,
          channelId: userMsg.channelId,
          senderId: userMsg.senderId,
          senderName: 'Human',
          senderType: 'human',
          content: userMsg.content,
          createdAt: userMsg.createdAt,
          isSteer,
        };

        this.broadcastEvent('message:created', formattedUserMsg);

        // Fetch channel members
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

        // Evaluate channel routing
        const routing = this.activationEngine.evaluateChannelRouting({
          channelId,
          isPrivate: channel?.isPrivate,
          channelType: channel?.channelType,
          message: userMsg,
          channelMembers,
          allProjectAgents,
          definitionsMap,
        });

        // Auto-enroll any activated specialists that were mentioned or targeted
        for (const targetAg of routing.targetAgents) {
          if (!memberIds.includes(targetAg.id) && !channel.isPrivate) {
            this.workspaceRepo.addChannelMember(channelId, targetAg.id);
            this.broadcastEvent('channel:member_added', { channelId, agentId: targetAg.id });
          }
        }

        const triggeredCount = routing.targetAgents.length;
        this.broadcastEvent('channel:routing', { channelId, messageId: userMsg.id, routing });
        this.sendJson(res, 201, { message: formattedUserMsg, triggeredCount, routing });

        const isExplicitCommand = contentLower.startsWith('/') || contentLower.includes('hire') || contentLower.includes('assign');
        if (isSteer && !isExplicitCommand) {
          // Mid-execution steering: the running agent in this channel will ingest the queued directive cleanly without colliding runs
          return;
        }

        // Trigger activated agent(s) asynchronously
        const boss = routing.fallbackOrchestrator || allProjectAgents.find((a) => a.isOrchestrator) || allProjectAgents[0] || this.agentRepo.getIdentity('agent-boss');

        // 0. Compound Multi-Command Pipeline (/plan /boost /teamwork-preview /goal /schedule [optional topic/directive/pipes])
        const cleanForCompound = contentTrimmed.replace(/^task:\s*/i, '');
        const hasPlanCmd = /\/plan\b/i.test(cleanForCompound);
        const hasBoostCmd = /\/boost\b/i.test(cleanForCompound);
        const hasTeamworkCmd = /\/teamwork(-preview)?\b/i.test(cleanForCompound);
        const hasGoalCmd = /\/goal\b/i.test(cleanForCompound);
        const hasScheduleCmd = /\/(schedule|timer)\b/i.test(cleanForCompound);
        const hasRoutineCmd = /\/routine\b/i.test(cleanForCompound);

        // DM-to-Channel Boundary Elevation: Elevate cross-cutting or shared project work requested in DM to #general with @Boss
        const isDmChannel = channelId.startsWith('dm-');
        const isCrossCuttingScope = (hasPlanCmd || hasGoalCmd || hasBoostCmd || hasTeamworkCmd || /cross[- ]cutting|shared project/i.test(cleanForCompound));
        if (isDmChannel && isCrossCuttingScope && boss) {
          const dmAgent = routing.targetAgents[0] || allProjectAgents.find((a) => a.id === channelId.replace(/^dm-/, '')) || boss;
          const dmElevateMsg = this.channelService.sendMessage({
            channelId,
            senderId: dmAgent.id,
            senderType: 'agent',
            content: `Scope encompasses shared workforce activities. Elevating this request to #general so that @Boss can establish the authoritative Goal and milestone DAG.`,
            productivityScore: 100,
          });
          this.broadcastEvent('message:created', {
            id: dmElevateMsg.id,
            channelId: dmElevateMsg.channelId,
            senderId: dmElevateMsg.senderId,
            senderName: dmAgent.displayName.replace(/^@/, ''),
            senderType: 'agent',
            content: dmElevateMsg.content,
            createdAt: dmElevateMsg.createdAt,
            productivityScore: 100,
          });

          const generalChan = this.workspaceRepo.listChannels(targetProjectId).find((c) => c.name === 'general') || { id: 'chan-general' };
          const generalAnnouncement = this.channelService.sendMessage({
            channelId: generalChan.id,
            senderId: dmAgent.id,
            senderType: 'agent',
            content: `📢 **[DM Elevation from ${dmAgent.displayName}]**: Cross-cutting scope requested by operator in DM: "${contentTrimmed}". Elevating to shared project channel.`,
            productivityScore: 100,
          });
          this.broadcastEvent('message:created', {
            id: generalAnnouncement.id,
            channelId: generalChan.id,
            senderId: generalAnnouncement.senderId,
            senderName: dmAgent.displayName.replace(/^@/, ''),
            senderType: 'agent',
            content: generalAnnouncement.content,
            createdAt: generalAnnouncement.createdAt,
            productivityScore: 100,
          });

          const elevatedDirective = {
            id: `msg-elevated-${Date.now()}`,
            channelId: generalChan.id,
            senderId: 'user-operator',
            senderType: 'human' as const,
            content: cleanForCompound,
            createdAt: Date.now(),
            originChannelId: channelId,
          };
          this.executeSequentialAgents([boss], generalChan.id, elevatedDirective as any).catch((err) => {
            console.error('[KIN CORE] Elevated DM execution notice:', err);
          });
          return;
        }

        const compoundCount = (hasPlanCmd ? 1 : 0) + (hasBoostCmd ? 1 : 0) + (hasTeamworkCmd ? 1 : 0) + (hasGoalCmd ? 1 : 0) + (hasScheduleCmd ? 1 : 0) + (hasRoutineCmd ? 1 : 0);

        if (compoundCount >= 2 && boss) {
          // Extract any user-specified topic, directive text, or pipe-separated params
          const strippedTopic = cleanForCompound
            .replace(/\/plan\b/gi, '')
            .replace(/\/boost\b/gi, '')
            .replace(/\/teamwork(-preview)?\b/gi, '')
            .replace(/\/goal\b/gi, '')
            .replace(/\/(schedule|timer)\b/gi, '')
            .replace(/\/routine\b/gi, '')
            .replace(/^[,\s|:\-/]+/, '')
            .trim();

          if (strippedTopic.length === 0) {
            const usageMsg = this.channelService.sendMessage({
              channelId,
              senderId: boss.id,
              senderType: 'agent',
              content: `ℹ️ **Command Directive**: Please provide an objective or directive with your slash command (e.g. \`/plan <objective>\`, \`/boost <verification prompt>\`, or \`/goal <milestone>\`). Commands execute with your prompt.`,
              productivityScore: 100,
            });
            this.broadcastEvent('message:created', {
              id: usageMsg.id,
              channelId: usageMsg.channelId,
              senderId: usageMsg.senderId,
              senderName: boss.displayName.replace(/^@/, ''),
              senderType: 'agent',
              content: usageMsg.content,
              createdAt: usageMsg.createdAt,
              productivityScore: usageMsg.productivityScore,
            });
            return;
          }

          const now = Date.now();
          let objective = strippedTopic.length < 120 ? strippedTopic : (strippedTopic.split(/[.;]/)[0] || strippedTopic.slice(0, 100)).trim();
          let planDesc = `Authoritative multi-phase execution plan for ${objective}`;
          let customCriteria: string[] | null = null;

          if (strippedTopic.includes('|')) {
            const segments = strippedTopic.split('|').map((s) => s.trim()).filter(Boolean);
            if (segments.length >= 1 && segments[0]) {
              objective = segments[0];
            }
            if (segments.length >= 2 && segments[1]) {
              planDesc = segments[1];
            }
            if (segments.length >= 3 && segments[2]) {
              customCriteria = segments[2].split(',').map((c) => c.trim()).filter(Boolean);
            }
          } else if (strippedTopic.includes('\n')) {
            const lines = strippedTopic
              .split('\n')
              .map((s) => s.trim().replace(/^[-*0-9.]+\s*/, '').replace(/^[,\s|:\-/]+/, ''))
              .filter(Boolean);
            if (lines.length > 0) {
              const firstLine = lines[0];
              objective = firstLine.length < 120 ? firstLine : (firstLine.split(/[.;]/)[0] || firstLine.slice(0, 100)).trim();
              if (lines.length > 1) {
                planDesc = lines.slice(1).join('; ');
              }
            }
          } else if (strippedTopic.length > 0) {
            objective = strippedTopic.length < 120 ? strippedTopic : (strippedTopic.split(/[.;]/)[0] || strippedTopic.slice(0, 100)).trim();
            planDesc = `Authoritative multi-phase execution plan for ${objective}`;
          }

          const acceptanceCriteria = customCriteria && customCriteria.length > 0 ? customCriteria : [
            'Architecture, contracts and specifications verified',
            'Implementation deliverables confirmed with zero placeholders',
            'Relevant automated tests pass and known regressions are reported',
          ];

          // A. /teamwork-preview component
          const projectAgents = this.agentRepo.listIdentitiesByProject(targetProjectId);
          const goals = this.goalRepo.listGoals(targetProjectId);
          const tasks = this.taskRepo.listTasksByProject(targetProjectId);
          const completedTasks = tasks.filter((t) => t.status === 'completed').length;
          const ollamaInfo = await this.getLocalOllamaModels();

          let matrix = `👥 **Workforce Collaboration Matrix (${projectAgents.length} Agents)**\n\n`;
          for (const ag of projectAgents) {
            const def = this.agentRepo.getDefinition(ag.definitionId);
            const assignedCids = this.workspaceRepo.listAgentChannelIds(ag.id, targetProjectId);
            const assignedNames = Array.from(
              new Set(
                assignedCids.map((cId) => '#' + (this.workspaceRepo.getChannel(cId)?.name || cId))
              )
            ).join(', ');

            const modelName = ag.activeModelId.replace(/^ollama\//, '');
            const isInstalled = ollamaInfo.online && ollamaInfo.models.some((m) => m === modelName || m.startsWith(modelName));
            const modelBadge = ollamaInfo.online
              ? isInstalled
                ? '🟢 Ready (Installed)'
                : '🟡 Download Needed'
              : '🔴 Offline';

            matrix += `• **${ag.displayName}** (${ag.isOrchestrator ? '👑 Lead Orchestrator' : '🛠️ Specialist'})\n`;
            matrix += `  - **Role**: ${def?.role || 'Specialist'}\n`;
            matrix += `  - **Active Model**: \`${ag.activeModelId}\` [${modelBadge}]\n`;
            matrix += `  - **Channels**: ${assignedNames || 'None'}\n`;
            matrix += `  - **Domains**: ${def?.domainAuthority.join(', ') || 'General'}\n\n`;
          }
          matrix += `📊 **Project Pulse**: ${goals.length} Goals | ${completedTasks}/${tasks.length} Tasks Completed (${tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 100}%)\n`;
          matrix += `⚡ **Engine Status**: Ollama ${ollamaInfo.online ? 'Online' : 'Offline'} (${ollamaInfo.models.length} local models)`;

          // B. /plan & /goal component: Create Goal & Milestone Tasks in DAG (if /plan or /goal specified)
          const shouldCreatePlan = hasPlanCmd || hasGoalCmd;
          const createdTasks: Task[] = [];
          let activeStep = '';
          let planDirectiveText = '';

          if (shouldCreatePlan) {
            const planTitle = `Plan: ${objective}`;
            const existingPlanGoal = this.goalRepo.listGoals(targetProjectId).find(
              (g) => g.title.toLowerCase().trim() === planTitle.toLowerCase().trim() && g.status === 'active'
            );

            const goalId = existingPlanGoal ? existingPlanGoal.id : `goal-${now}`;
            const planGoal: Goal = {
              id: goalId,
              projectId: targetProjectId,
              title: planTitle,
              description: planDesc,
              acceptanceCriteria,
              status: 'active',
              originChannelId: (userMsg as any)?.originChannelId || (channelId.startsWith('dm-') ? channelId : undefined),
              createdAt: existingPlanGoal ? existingPlanGoal.createdAt : now,
              updatedAt: now,
            };

            if (existingPlanGoal) {
              this.goalRepo.updateGoal(planGoal);
              this.broadcastEvent('goal:updated', planGoal);
              this.taskRepo.deleteTasksByGoal(goalId);
              this.broadcastEvent('task:cleared_for_goal', { goalId });
            } else {
              this.goalRepo.createGoal(planGoal);
              this.broadcastEvent('goal:created', planGoal);
            }

            // Distribute milestone tasks across specialist workforce
            const specialistAgents = projectAgents.filter((a) => !a.isOrchestrator);
            const archAgent = boss;
            const implAgent = specialistAgents[0] || boss;
            const verifyAgent = specialistAgents.length > 1 ? specialistAgents[1] : (specialistAgents[0] || boss);
            const phaseAssignments = [archAgent, implAgent, verifyAgent];

            let phaseSteps: string[] = [];
            if (!hasGoalCmd && strippedTopic.includes('|')) {
              const segments = strippedTopic.split('|').map((s) => s.trim()).filter(Boolean);
              if (segments.length >= 2) {
                const remaining = segments.slice(1);
                phaseSteps = remaining.map((s, idx) => s.startsWith('[Phase') || s.startsWith('Phase') ? s : `[Phase ${idx + 1}] ${s}`);
              }
            } else if (hasGoalCmd && strippedTopic.includes('|')) {
              const segments = strippedTopic.split('|').map((s) => s.trim()).filter(Boolean);
              if (segments.length >= 2) {
                const remaining = segments.slice(1);
                const allExplicitPhases = remaining.every((s) => /^(phase|step|milestone|\[phase)/i.test(s));
                if (allExplicitPhases) {
                  phaseSteps = remaining.map((s, idx) => s.startsWith('[Phase') || s.startsWith('Phase') ? s : `[Phase ${idx + 1}] ${s}`);
                }
              }
            }

            if (phaseSteps.length === 0) {
              phaseSteps = [
                `[Phase 1] Architecture, Specifications & Contracts: ${objective}`,
                `[Phase 2] Core Implementation & Refinements: ${objective}`,
                `[Phase 3] Verification, Stress Testing & Edge Cases: ${objective}`,
              ];
            }

            phaseSteps.forEach((stepTitle, idx) => {
              const taskId = `task-${now}-${idx + 1}`;
              const assigned = phaseAssignments[idx % phaseAssignments.length] || boss;
              const task: Task = {
                id: taskId,
                goalId,
                title: stepTitle,
                description: `Milestone execution step ${idx + 1} for ${objective}. Responsible: ${assigned.displayName}`,
                assignedAgentId: assigned.id,
                status: idx === 0 ? 'running' : 'ready',
                verificationSpec: { expectedExitCode: 0 },
                createdAt: now + idx,
                updatedAt: now + idx,
              };
              const dependsOn = idx > 0 && createdTasks[idx - 1] ? [createdTasks[idx - 1].id] : [];
              this.taskRepo.createTask(task, dependsOn);
              this.broadcastEvent('task:created', task);
              createdTasks.push(task);
            });

            activeStep = phaseSteps[0];
            planDirectiveText = `[COMPOUND PIPELINE DIRECTIVE]: Begin executing Phase 1: "${activeStep}" for objective "${objective}". Review requirements, execute tasks with maximum autonomy, verify edge cases, and coordinate deliverables.`;
          } else {
            // Autonomous boost mode across existing project tasks
            const projectTasks = this.taskRepo.listTasksByProject(targetProjectId);
            const runningTask = projectTasks.find((t) => t.status === 'running') || projectTasks.find((t) => t.status === 'ready') || projectTasks[0];
            activeStep = runningTask ? runningTask.title : objective;
            planDirectiveText = `[COMPOUND PIPELINE DIRECTIVE]: Workforce Collaboration & Autonomous Boost engaged for "${objective}". Review requirements, verify edge cases, inspect live state, and coordinate deliverables.`;
            createdTasks.push(...projectTasks.slice(0, 5));
          }

          let breakdownText = '';
          if (createdTasks.length > 0) {
            createdTasks.forEach((t) => {
              const icon = t.status === 'completed' ? '✅' : t.status === 'running' ? '⏳' : '⏱️';
              const assignedName = (projectAgents.find((a) => a.id === t.assignedAgentId)?.displayName || 'Agent').replace(/^@/, '');
              breakdownText += `${icon} \`${t.id}\` — ${t.title} (@${assignedName})\n`;
            });
          } else {
            breakdownText = '*(Operating in autonomous exploratory boost mode)*\n';
          }

          // C. /boost component: Git check and engine summary
          const project = this.workspaceRepo.getProject(targetProjectId);
          const repoPath = project?.repoPath || process.cwd();
          let gitSummaryText = 'Working tree checked';
          try {
            const gitCheck = await this.execFileCommand('git', ['status', '--porcelain=v1'], repoPath);
            if (gitCheck.exitCode === 0) {
              const changedLines = gitCheck.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
              gitSummaryText = changedLines.length === 0 ? 'Working tree clean (0 uncommitted changes)' : `${changedLines.length} uncommitted file(s)`;
            }
          } catch {}

          let dbSizeKb = 0;
          try {
            const dbStat = fs.statSync(this.dbPath || 'kin_storage.sqlite');
            dbSizeKb = Math.round(dbStat.size / 1024);
          } catch {}

          const engineSummary = `WAL (${dbSizeKb} KB) | Ollama: ${ollamaInfo.online ? `${ollamaInfo.models.length} model(s)` : 'offline'}`;

          // If /schedule is part of compound command, parse and schedule timer
          let scheduledTimerInfo: string | null = null;
          if (hasScheduleCmd) {
            const schedParse = this.parseScheduleDurationAndPrompt(strippedTopic);
            if (schedParse) {
              const sched = this.scheduler.createOneShotTimer({
                projectId: targetProjectId,
                channelId,
                targetAgentId: boss?.id,
                prompt: schedParse.prompt,
                durationSeconds: schedParse.durationSeconds,
              });
              this.broadcastEvent('schedule:created', sched);
              scheduledTimerInfo = `Will wake in ${schedParse.formattedDuration} (${schedParse.durationSeconds}s) for directive: "${schedParse.prompt}" [ID: \`${sched.id}\`]`;
            }
          }

          // If /routine is part of compound command, parse and schedule routine
          if (hasRoutineCmd && !scheduledTimerInfo) {
            const schedParse = this.parseScheduleDurationAndPrompt(strippedTopic);
            if (schedParse) {
              const sched = this.scheduler.createOneShotTimer({
                projectId: targetProjectId,
                channelId,
                targetAgentId: boss?.id,
                prompt: schedParse.prompt || 'Proactive workforce routine',
                durationSeconds: schedParse.durationSeconds,
              });
              this.broadcastEvent('schedule:created', sched);
              scheduledTimerInfo = `Proactive routine scheduled in ${schedParse.formattedDuration} (${schedParse.durationSeconds}s): "${sched.prompt}" [ID: \`${sched.id}\`]`;
            }
          }

          // Formulate Unified Master Compound Card with Dynamic Mode Badges
          const engagedModes: string[] = [];
          if (hasTeamworkCmd) engagedModes.push('Teamwork Preview');
          if (hasPlanCmd) engagedModes.push('Plan DAG');
          if (hasBoostCmd) engagedModes.push('Boost Autonomy');
          if (hasGoalCmd) engagedModes.push('Goal Milestone');
          if (hasScheduleCmd) engagedModes.push('Scheduled Timer');
          if (hasRoutineCmd) engagedModes.push('Proactive Routine');

          const modesBadges = [
            hasTeamworkCmd ? '👥 `/teamwork-preview`' : null,
            hasPlanCmd ? '📋 `/plan`' : null,
            hasBoostCmd ? '🚀 `/boost`' : null,
            hasGoalCmd ? '🎯 `/goal`' : null,
            hasScheduleCmd ? '⏱️ `/schedule`' : null,
            hasRoutineCmd ? '🔄 `/routine`' : null,
          ].filter(Boolean).join(' | ');

          const compoundMsgContent =
            `🚀 **Compound Pipeline Engaged**: ${engagedModes.join(', ') || 'Plan, Boost & Teamwork Preview'}\n\n` +
            `**Target Objective**: **${objective}**\n` +
            `- **Project**: \`${targetProjectId}\`\n` +
            `- **Pipeline Modes**: ${modesBadges}\n` +
            `- **Repository Status**: ${gitSummaryText}\n` +
            `- **Engine Status**: ${engineSummary}\n` +
            (scheduledTimerInfo ? `- **Scheduled Timer**: ${scheduledTimerInfo}\n` : '') +
            `\n---\n\n` +
            `${matrix}\n\n` +
            `---\n\n` +
            `📋 **Milestone Breakdown DAG**:\n${breakdownText}\n` +
            `${planDirectiveText}`;

          const compoundReply = this.channelService.sendMessage({
            channelId,
            senderId: boss.id,
            senderType: 'agent',
            content: compoundMsgContent,
            productivityScore: 100,
          });

          this.broadcastEvent('message:created', {
            id: compoundReply.id,
            channelId: compoundReply.channelId,
            senderId: compoundReply.senderId,
            senderName: boss.displayName.replace(/^@/, ''),
            senderType: 'agent',
            content: compoundReply.content,
            createdAt: compoundReply.createdAt,
            productivityScore: compoundReply.productivityScore,
          });

          // Trigger Autonomous Execution Wired to Active Phase 1 Task with authentic LLM formulation
          const compoundExecutionDirective = {
            id: `msg-compound-exec-${now}`,
            channelId,
            senderId: 'user-operator',
            senderType: 'human' as const,
            content: `[COMPOUND PIPELINE DIRECTIVE: ${engagedModes.join(', ')}]\n` +
              `Target Objective: "${objective}"\n` +
              `Project: ${targetProjectId} | Repository Root: ${repoPath}\n` +
              `Active Phase/Step: ${activeStep}\n` +
              `Repository Status: ${gitSummaryText}\n` +
              `Engine Status: ${engineSummary}\n` +
              (scheduledTimerInfo ? `Scheduled Timer: ${scheduledTimerInfo}\n` : '') +
              `Directive: Review requirements, execute tasks with maximum autonomy, verify edge cases, confirm zero runtime errors, and coordinate deliverables.`,
            createdAt: now + 1,
            taskId: createdTasks[0]?.id || undefined,
          };

          this.executeSequentialAgents([boss], channelId, compoundExecutionDirective as any).catch((err) => {
            console.error('[KIN CORE] Compound pipeline execution error:', err);
          });
          return;
        }

        // 1. /goal <title> [| <description>] [| <acceptance criteria>]
        if (
          contentLower === '/goal' ||
          contentLower.startsWith('/goal ') ||
          contentLower.startsWith('/goal:') ||
          contentLower.startsWith('/goal\n')
        ) {
          const rawParams = rawContent.replace(/^\/goal[\s:\n]*/i, '').trim();
          if (!rawParams) {
            if (boss) {
              const helpMsg = this.channelService.sendMessage({
                channelId,
                senderId: boss.id,
                senderType: 'agent',
                content: `ℹ️ **Usage**: \`/goal <title> [| <description>] [| <criterion 1>, <criterion 2>]\`\n\nExample: \`/goal Document the API migration | Review routes and update clients | API contract documented, relevant tests pass\``,
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

          const parts = rawParams.split('|').map((p) => p.trim()).filter(Boolean);
          const goalTitle = parts[0] || 'Project Milestone';
          const goalDesc = parts[1] || `Project goal registered via slash command in #${channel.name}`;
          const criteria = parts[2]
            ? parts[2].split(',').map((c) => c.trim()).filter(Boolean)
            : ['Verification spec passed', 'Deliverables confirmed'];

          // Deduplication: reuse existing active goal if title matches
          const existingGoal = this.goalRepo.listGoals(targetProjectId).find(
            (g) => g.title.toLowerCase().trim() === goalTitle.toLowerCase().trim() && g.status === 'active'
          );

          const now = Date.now();
          const goalId = existingGoal ? existingGoal.id : `goal-${now}`;
          const newGoal: Goal = {
            id: goalId,
            projectId: targetProjectId,
            title: goalTitle,
            description: goalDesc,
            acceptanceCriteria: criteria,
            status: 'active',
            originChannelId: channelId,
            createdAt: existingGoal ? existingGoal.createdAt : now,
            updatedAt: now,
          };

          let initTaskId = `task-${now}-init`;
          if (existingGoal) {
            this.goalRepo.updateGoal(newGoal);
            this.broadcastEvent('goal:updated', newGoal);
          } else {
            this.goalRepo.createGoal(newGoal);
            this.broadcastEvent('goal:created', newGoal);

            const initTask: Task = {
              id: initTaskId,
              goalId,
              title: `Execute: ${goalTitle}`,
              description: goalDesc,
              assignedAgentId: boss?.id,
              status: 'ready',
              verificationSpec: { expectedExitCode: 0 },
              createdAt: now,
              updatedAt: now,
            };
            this.taskRepo.createTask(initTask);
            this.broadcastEvent('task:created', initTask);
          }

          if (boss) {
            const goalReply = this.channelService.sendMessage({
              channelId,
              senderId: boss.id,
              senderType: 'agent',
              content: `🎯 **Goal Registered**: "${goalTitle}"\n- **Goal ID**: \`${goalId}\`\n- **Project**: \`${targetProjectId}\`\n- **Description**: ${goalDesc}\n- **Acceptance Criteria**: ${criteria.join('; ')}\n- **Initial Task**: \`${initTaskId}\` (Ready)\n\nWorkforce objectives and DAG have been updated.`,
              productivityScore: 100,
            });

            this.broadcastEvent('message:created', {
              id: goalReply.id,
              channelId: goalReply.channelId,
              senderId: goalReply.senderId,
              senderName: boss.displayName.replace(/^@/, ''),
              senderType: 'agent',
              content: goalReply.content,
              createdAt: goalReply.createdAt,
              productivityScore: goalReply.productivityScore,
            });

            const goalDirective = {
              id: `msg-goal-exec-${now}`,
              channelId,
              senderId: 'user-operator',
              senderType: 'human',
              content: `[GOAL EXECUTION DIRECTIVE]: Review and initiate Goal "${goalTitle}": ${goalDesc}. Criteria: ${criteria.join('; ')}. Coordinate next steps with the workforce.`,
              createdAt: now + 1,
            };
            this.executeSequentialAgents([boss], channelId, goalDirective).catch((err) => {
              console.error('[KIN CORE] Goal execution error:', err);
            });
          }
          return;
        }

        // 2. /teamwork-preview or /teamwork — Live Workforce Collaboration Matrix & Model Readiness
        if (
          contentLower === '/teamwork-preview' ||
          contentLower.startsWith('/teamwork-preview ') ||
          contentLower.startsWith('/teamwork-preview:') ||
          contentLower.startsWith('/teamwork-preview\n') ||
          contentLower === '/teamwork' ||
          contentLower.startsWith('/teamwork ') ||
          contentLower.startsWith('/teamwork:') ||
          contentLower.startsWith('/teamwork\n')
        ) {
          if (boss) {
            const projectAgents = this.agentRepo.listIdentitiesByProject(targetProjectId);
            const goals = this.goalRepo.listGoals(targetProjectId);
            const tasks = this.taskRepo.listTasksByProject(targetProjectId);
            const completedTasks = tasks.filter((t) => t.status === 'completed').length;
            const ollamaInfo = await this.getLocalOllamaModels();

            let matrix = `👥 **Workforce Collaboration Matrix (${projectAgents.length} Agents)**\n\n`;
            for (const ag of projectAgents) {
              const def = this.agentRepo.getDefinition(ag.definitionId);
              const assignedCids = this.workspaceRepo.listAgentChannelIds(ag.id, targetProjectId);
              const assignedNames = Array.from(
                new Set(
                  assignedCids
                    .map((cId) => '#' + (this.workspaceRepo.getChannel(cId)?.name || cId))
                )
              ).join(', ');

              const modelName = ag.activeModelId.replace(/^ollama\//, '');
              const isInstalled = ollamaInfo.online && ollamaInfo.models.some((m) => m === modelName || m.startsWith(modelName));
              const modelBadge = ollamaInfo.online
                ? isInstalled
                  ? '🟢 Online (Installed)'
                  : '🟡 Online (Download Needed)'
                : '🔴 Offline';

              matrix += `• **${ag.displayName}** (${ag.isOrchestrator ? '👑 Lead Orchestrator' : '🛠️ Specialist'})\n`;
              matrix += `  - **Role**: ${def?.role || 'Specialist'}\n`;
              matrix += `  - **Active Model**: \`${ag.activeModelId}\` [${modelBadge}]\n`;
              matrix += `  - **Channels**: ${assignedNames || 'None'}\n`;
              matrix += `  - **Domains**: ${def?.domainAuthority.join(', ') || 'General'}\n\n`;
            }
            matrix += `📊 **Project Pulse**: ${goals.length} Goals | ${completedTasks}/${tasks.length} Tasks Completed (${tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 100}%)\n`;
            matrix += `⚡ **Engine Status**: Ollama ${ollamaInfo.online ? 'Online' : 'Offline'} (${ollamaInfo.models.length} local models)`;

            const twReply = this.channelService.sendMessage({
              channelId,
              senderId: boss.id,
              senderType: 'agent',
              content: matrix,
              productivityScore: 100,
            });

            this.broadcastEvent('message:created', {
              id: twReply.id,
              channelId: twReply.channelId,
              senderId: twReply.senderId,
              senderName: boss.displayName.replace(/^@/, ''),
              senderType: 'agent',
              content: twReply.content,
              createdAt: twReply.createdAt,
              productivityScore: twReply.productivityScore,
            });
            return;
          }
        }

        // 3. /plan <topic> — Generates milestone breakdown & initializes DAG tasks
        if (
          contentLower === '/plan' ||
          contentLower.startsWith('/plan ') ||
          contentLower.startsWith('/plan:') ||
          contentLower.startsWith('/plan\n')
        ) {
          if (boss) {
            const rawTopic = rawContent.replace(/^\/plan[\s:\n]*/i, '').trim();
            const now = Date.now();
            let objective = rawTopic || 'Core Engineering Roadmap';

            let phaseSteps: string[] = [];
            if (rawTopic.includes('|')) {
              const segments = rawTopic.split('|').map((s) => s.trim()).filter(Boolean);
              if (segments.length >= 2) {
                objective = segments[0];
                phaseSteps = segments.slice(1);
              } else {
                objective = segments[0] || 'Core Engineering Roadmap';
              }
            } else if (rawTopic.includes('\n')) {
              const lines = rawTopic.split('\n').map((s) => s.trim().replace(/^[-*0-9.]+\s*/, '')).filter(Boolean);
              if (lines.length >= 2) {
                objective = lines[0];
                phaseSteps = lines.slice(1);
              } else {
                objective = lines[0] || 'Core Engineering Roadmap';
              }
            } else if (rawTopic.includes(',') && !rawTopic.includes('|')) {
              const parts = rawTopic.split(',').map((s) => s.trim()).filter(Boolean);
              if (parts.length >= 2) {
                objective = parts[0];
                phaseSteps = parts.slice(1);
              } else {
                objective = parts[0] || 'Core Engineering Roadmap';
              }
            }

            if (phaseSteps.length === 0) {
              phaseSteps = [
                `[Phase 1] Architecture & Spec: ${objective}`,
                `[Phase 2] Core Implementation: ${objective}`,
                `[Phase 3] Verification & Stress Testing: ${objective}`,
              ];
            }

            const planTitle = `Plan: ${objective}`;
            const existingPlanGoal = this.goalRepo.listGoals(targetProjectId).find(
              (g) => g.title.toLowerCase().trim() === planTitle.toLowerCase().trim() && g.status === 'active'
            );

            const goalId = existingPlanGoal ? existingPlanGoal.id : `goal-${now}`;
            const planGoal: Goal = {
              id: goalId,
              projectId: targetProjectId,
              title: planTitle,
              description: `Authoritative execution plan for ${objective}`,
              acceptanceCriteria: [
                'Architecture and contracts verified',
                'Implementation deliverables confirmed',
                'Relevant automated tests pass and known regressions are reported',
              ],
              status: 'active',
              createdAt: existingPlanGoal ? existingPlanGoal.createdAt : now,
              updatedAt: now,
            };

            const createdTasks: Task[] = [];
            if (existingPlanGoal) {
              this.goalRepo.updateGoal(planGoal);
              this.broadcastEvent('goal:updated', planGoal);
              this.taskRepo.deleteTasksByGoal(goalId);
              this.broadcastEvent('task:cleared_for_goal', { goalId });
            } else {
              this.goalRepo.createGoal(planGoal);
              this.broadcastEvent('goal:created', planGoal);
            }

            phaseSteps.forEach((stepTitle, idx) => {
              const taskId = `task-${now}-${idx + 1}`;
              const task: Task = {
                id: taskId,
                goalId,
                title: stepTitle,
                description: `Milestone execution step ${idx + 1} for ${objective}`,
                assignedAgentId: boss?.id,
                status: idx === 0 ? 'running' : 'ready',
                verificationSpec: { expectedExitCode: 0 },
                createdAt: now + idx,
                updatedAt: now + idx,
              };
              const dependsOn = idx > 0 && createdTasks[idx - 1] ? [createdTasks[idx - 1].id] : [];
              this.taskRepo.createTask(task, dependsOn);
              this.broadcastEvent('task:created', task);
              createdTasks.push(task);
            });

            let breakdownText = '';
            createdTasks.forEach((t) => {
              const icon = t.status === 'completed' ? '✅' : t.status === 'running' ? '⏳' : '⏱️';
              breakdownText += `${icon} \`${t.id}\` — ${t.title}\n`;
            });

            // Determine active step for execution directive
            const activeStep = phaseSteps[0];

            const planDirectiveText = `[PLAN EXECUTION DIRECTIVE]: Begin executing Phase 1: "${activeStep}" for objective "${objective}". Review requirements, execute tasks, and coordinate deliverables.`;

            // Trigger autonomous execution of Phase 1 milestone wired to active task with authentic LLM formulation
            const executionDirective = {
              id: `msg-plan-exec-${now}`,
              channelId,
              senderId: 'user-operator',
              senderType: 'human' as const,
              content: `[PLAN EXECUTION DIRECTIVE]: Begin executing Phase 1: "${activeStep}" for objective "${objective}". Review requirements, execute tasks, verify implementation, and coordinate deliverables.`,
              createdAt: now + 1,
              taskId: createdTasks[0]?.id || undefined,
            };
            this.executeSequentialAgents([boss], channelId, executionDirective as any).catch((err) => {
              console.error('[KIN CORE] Plan execution error:', err);
            });
            return;
          }
        }

        // 4. /boost <prompt> — Execute with High Autonomy & Verification Directive
        if (
          contentLower === '/boost' ||
          contentLower.startsWith('/boost ') ||
          contentLower.startsWith('/boost:') ||
          contentLower.startsWith('/boost\n')
        ) {
          const boostTopic = rawContent.replace(/^\/boost[\s:\n]*/i, '').trim();
          const project = this.workspaceRepo.getProject(targetProjectId);
          const repoPath = project?.repoPath || process.cwd();

          let gitSummaryText = 'Git check unavailable';
          try {
            const gitCheck = await this.execFileCommand('git', ['status', '--porcelain=v1'], repoPath);
            if (gitCheck.exitCode === 0) {
              const changedLines = gitCheck.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
              gitSummaryText = changedLines.length === 0 ? 'Working tree clean (0 uncommitted changes)' : `${changedLines.length} uncommitted file(s)`;
            }
          } catch {}

          const tasks = this.taskRepo.listTasksByProject(targetProjectId);
          const running = tasks.filter((t) => t.status === 'running').length;
          const pending = tasks.filter((t) => t.status === 'ready').length;

          let dbSizeKb = 0;
          try {
            const dbStat = fs.statSync(this.dbPath || 'kin_storage.sqlite');
            dbSizeKb = Math.round(dbStat.size / 1024);
          } catch {}

          const ollamaInfo = await this.getLocalOllamaModels();
          const engineSummary = `WAL (${dbSizeKb} KB) | Ollama: ${ollamaInfo.online ? `${ollamaInfo.models.length} model(s)` : 'offline'}`;



          const boostDirective = `[🚀 BOOST MODE: MAXIMUM AUTONOMY & ARCHITECTURAL VERIFICATION]\n` +
            `Audit Target: ${boostTopic || 'Complete workspace verification and stress test'}\n` +
            `- Repository Status: ${gitSummaryText}\n` +
            `- Active Tasks: ${running} running, ${pending} ready\n` +
            `- Engine Status: ${engineSummary}\n` +
            `- Directive: Audit all integration paths, verify edge cases, confirm zero runtime errors, and provide execution next steps.`;

          const boostedMsg = {
            ...userMsg,
            content: boostDirective,
          };

          this.executeSequentialAgents(
            routing.targetAgents.length > 0 ? routing.targetAgents : (boss ? [boss] : []),
            channelId,
            boostedMsg
          ).catch((err) => console.error('[KIN CORE] Boost execution error:', err));
          return;
        }

        // 5. /schedule or /timer <duration> [prompt] — Antigravity-Style Timed Autonomy & Sleep/Wakeup
        if (
          contentLower === '/schedule' ||
          contentLower.startsWith('/schedule ') ||
          contentLower.startsWith('/schedule:') ||
          contentLower.startsWith('/schedule\n') ||
          contentLower === '/timer' ||
          contentLower.startsWith('/timer ') ||
          contentLower.startsWith('/timer:') ||
          contentLower.startsWith('/timer\n')
        ) {
          const rawParams = rawContent.replace(/^\/(schedule|timer)[\s:\n]*/i, '').trim();
          const parsedSchedule = this.parseScheduleDurationAndPrompt(rawParams);
          if (parsedSchedule) {
            const { durationSeconds, prompt, formattedDuration } = parsedSchedule;

            const sched = this.scheduler.createOneShotTimer({
              projectId: targetProjectId,
              channelId,
              targetAgentId: boss?.id,
              prompt,
              durationSeconds,
            });

            const reply = this.channelService.sendMessage({
              channelId,
              senderId: boss?.id || 'agent-boss',
              senderType: 'agent',
              content: `⏱️ **Timer Initialized**: Will wake in **${formattedDuration}** (${durationSeconds}s)\n- **Directive**: "${prompt}"\n- **Schedule ID**: \`${sched.id}\`\n\nAgent is now sleeping (zero busy-polling). Wakeup event will dispatch automatically.`,
              productivityScore: 100,
            });
            this.broadcastEvent('message:created', {
              id: reply.id,
              channelId: reply.channelId,
              senderId: reply.senderId,
              senderName: boss?.displayName.replace(/^@/, '') || 'Boss',
              senderType: 'agent',
              content: reply.content,
              createdAt: reply.createdAt,
              productivityScore: reply.productivityScore,
            });
            this.broadcastEvent('schedule:created', sched);
            return;
          } else {
            if (boss) {
              const helpMsg = this.channelService.sendMessage({
                channelId,
                senderId: boss.id,
                senderType: 'agent',
                content: `ℹ️ **Usage**: \`/schedule <duration> [directive]\`\n\nExamples:\n- \`/schedule 10s check test results\`\n- \`/schedule 5m perform repository audit\`\n- \`/schedule 3 hours 15 minutes proceed with task\`\n- \`/schedule this for 3 hours 15 minutes then proceed with this message\``,
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
        }

        // 5b. /routine <cron-or-seconds> <prompt> — Proactive Personal Assistant & Routines
        if (contentLower === '/routine' || contentLower.startsWith('/routine ')) {
          const rawParams = rawContent.replace(/^\/routine\s*/i, '').trim();
          if (!rawParams) {
            if (boss) {
              const helpMsg = this.channelService.sendMessage({
                channelId,
                senderId: boss.id,
                senderType: 'agent',
                content: `ℹ️ **Usage**: \`/routine <interval-seconds | cron-expression> [directive]\`\n\nExamples:\n- \`/routine 30s Check active tasks\`\n- \`/routine */15 * * * * Periodic project audit\``,
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
          let sched;
          if (rawParams.startsWith('*/') || rawParams.startsWith('0 ')) {
            const parts = rawParams.split(/\s+/);
            const cronExpr = parts.slice(0, 5).join(' ');
            const prompt = parts.slice(5).join(' ') || 'Scheduled proactive assistant routine';
            sched = this.scheduler.createCronSchedule({
              projectId: targetProjectId,
              channelId,
              targetAgentId: boss?.id,
              prompt,
              cronExpression: cronExpr,
            });
          } else {
            const parsed = this.parseScheduleDurationAndPrompt(rawParams);
            const dur = parsed ? parsed.durationSeconds : (parseInt(rawParams.split(/\s+/)[0], 10) || 60);
            const prompt = parsed ? parsed.prompt : (rawParams.split(/\s+/).slice(1).join(' ') || 'Scheduled proactive assistant routine');
            sched = this.scheduler.createOneShotTimer({
              projectId: targetProjectId,
              channelId,
              targetAgentId: boss?.id,
              prompt,
              durationSeconds: dur,
            });
          }

          const reply = this.channelService.sendMessage({
            channelId,
            senderId: boss?.id || 'agent-boss',
            senderType: 'agent',
            content: `🔄 **Proactive Personal Routine Configured**\n- **Directive**: "${sched.prompt}"\n- **Type**: \`${sched.type}\`\n- **Schedule ID**: \`${sched.id}\`\n\nWakes agent when scheduled without busy-polling.`,
            productivityScore: 100,
          });
          this.broadcastEvent('message:created', {
            id: reply.id,
            channelId: reply.channelId,
            senderId: reply.senderId,
            senderName: boss?.displayName.replace(/^@/, '') || 'Boss',
            senderType: 'agent',
            content: reply.content,
            createdAt: reply.createdAt,
            productivityScore: reply.productivityScore,
          });
          this.broadcastEvent('schedule:created', sched);
          return;
        }

        // 5c. /skills or /skill — Capabilities & Specialized Extensions Catalog
        if (
          contentLower === '/skills' ||
          contentLower.startsWith('/skills ') ||
          contentLower.startsWith('/skills:') ||
          contentLower.startsWith('/skills\n') ||
          contentLower === '/skill' ||
          contentLower.startsWith('/skill ') ||
          contentLower.startsWith('/skill:') ||
          contentLower.startsWith('/skill\n')
        ) {
          if (boss) {
            const rawSub = rawContent.replace(/^\/(skills|skill)[\s:\n]*/i, '').trim();

            // Subcommand: /skills create <name> | <description> | <instructions> [| <tools> | <tags>]
            if (rawSub.startsWith('create ') || rawSub.startsWith('add ')) {
              const text = rawSub.replace(/^(create|add)\s*/i, '').trim();
              const parts = text.split('|').map((s) => s.trim()).filter(Boolean);
              if (parts.length < 2) {
                const helpMsg = this.channelService.sendMessage({
                  channelId,
                  senderId: boss.id,
                  senderType: 'agent',
                  content: `💡 **Usage**: \`/skills create <name> | <description> | <instructions> [| <tools,comma,sep> | <tags,comma,sep>]\`\n\n*Example*: \`/skills create paper-summarizer | Summarize scientific papers | Read PDF or text and produce executive bullets | readFile | research,summarize\``,
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
                return;
              }

              const skillName = parts[0];
              const skillDesc = parts[1];
              const skillInst = parts[2] || parts[1];
              const skillTools = parts[3] ? parts[3].split(',').map((t) => t.trim()).filter(Boolean) : [];
              const skillTags = parts[4] ? parts[4].split(',').map((t) => t.trim()).filter(Boolean) : [skillName];

              try {
                const created = this.skillEngine.createSkill({
                  name: skillName,
                  description: skillDesc,
                  instructions: skillInst,
                  requiredTools: skillTools,
                  triggerPatterns: skillTags,
                  tags: skillTags,
                  skillType: skillTools.length > 0 ? 'tool_extension' : 'prompt_instruction',
                  status: 'active',
                });
                this.broadcastEvent('skill:created', created);

                const reply = this.channelService.sendMessage({
                  channelId,
                  senderId: boss.id,
                  senderType: 'agent',
                  content: `✅ **Skill Created & Persisted**: "${created.name}" (v${created.version})\n- **ID**: \`${created.id}\`\n- **Description**: ${created.description}\n- **Tools Required**: ${created.requiredTools.length > 0 ? created.requiredTools.map((t) => `\`${t}\``).join(', ') : 'None'}\n- **Persisted To**: SQLite database & \`.kin/skills/${created.name.toLowerCase()}/SKILL.md\``,
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
              } catch (err: any) {
                const errReply = this.channelService.sendMessage({
                  channelId,
                  senderId: boss.id,
                  senderType: 'agent',
                  content: `❌ **Failed to create skill**: ${err.message}`,
                  productivityScore: 100,
                });
                this.broadcastEvent('message:created', {
                  id: errReply.id,
                  channelId: errReply.channelId,
                  senderId: errReply.senderId,
                  senderName: boss.displayName.replace(/^@/, ''),
                  senderType: 'agent',
                  content: errReply.content,
                  createdAt: errReply.createdAt,
                  productivityScore: errReply.productivityScore,
                });
              }
              return;
            }

            // Subcommand: /skills import <pathOrJson>
            if (rawSub.startsWith('import ')) {
              let target = rawSub.replace(/^import\s*/i, '').trim();
              const attachMatch = target.match(/\[📎\s*([^\]]+)\]/);
              if (attachMatch) {
                const rawName = attachMatch[1].trim();
                const project = this.workspaceRepo.getProject(targetProjectId);
                const uploadsDir = path.join(project?.repoPath || process.cwd(), '.kin', 'uploads');
                if (fs.existsSync(uploadsDir)) {
                  const files = fs.readdirSync(uploadsDir);
                  const matchedFile = files.find((f) => f === rawName || f.endsWith(`-${rawName}`) || f.includes(rawName));
                  if (matchedFile) {
                    target = path.join(uploadsDir, matchedFile);
                  }
                }
              }

              try {
                let importedCount = 0;
                let skillNames: string[] = [];

                if (target.startsWith('{') || target.startsWith('[')) {
                  const resBundle = this.skillEngine.importSkillBundle(target);
                  importedCount = resBundle.imported;
                  skillNames = resBundle.skills.map((s) => s.name);
                  this.broadcastEvent('skill:imported', resBundle);
                } else {
                  let targetPath = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
                  if (!fs.existsSync(targetPath)) {
                    const parentResolved = path.resolve(process.cwd(), '..', target);
                    if (fs.existsSync(parentResolved)) {
                      targetPath = parentResolved;
                    }
                  }
                  const boundaryCheck = this.validateProjectBoundary(targetPath);
                  if (!boundaryCheck.valid) {
                    throw new Error(`Skill import rejected: Path '${target}' must reside within an authorized project boundary.`);
                  }
                  targetPath = boundaryCheck.root;
                  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
                    const stats = fs.statSync(targetPath);
                    if (stats.size > 5 * 1024 * 1024) {
                      throw new Error(`Skill import rejected: File '${target}' exceeds maximum allowed size (5MB).`);
                    }
                    const rawFileText = fs.readFileSync(targetPath, 'utf-8');
                    if (rawFileText.trim().startsWith('{') || rawFileText.trim().startsWith('[')) {
                      const resBundle = this.skillEngine.importSkillBundle(rawFileText);
                      importedCount = resBundle.imported;
                      skillNames = resBundle.skills.map((s) => s.name);
                      this.broadcastEvent('skill:imported', resBundle);
                    } else {
                      const baseSkillName = path.basename(targetPath, path.extname(targetPath)).replace(/[^a-zA-Z0-9_-]/g, '_');
                      const importedSkill = this.skillEngine.createSkill({
                        name: baseSkillName,
                        description: `Imported from uploaded file ${path.basename(targetPath)}`,
                        instructions: rawFileText,
                      });
                      importedCount = 1;
                      skillNames = [importedSkill.name];
                      this.broadcastEvent('skill:created', importedSkill);
                    }
                  } else {
                    const dirRes = this.skillEngine.importSkillDirectory(targetPath);
                    importedCount = dirRes.imported;
                    skillNames = dirRes.skills.map((s) => s.name);
                    this.broadcastEvent('skill:imported', dirRes);
                  }
                }

                const reply = this.channelService.sendMessage({
                  channelId,
                  senderId: boss.id,
                  senderType: 'agent',
                  content: `📦 **Skills Imported**: Successfully imported ${importedCount} skill(s) into persistent storage!\n${skillNames.map((n) => `• **${n}**`).join('\n')}`,
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
              } catch (err: any) {
                const errReply = this.channelService.sendMessage({
                  channelId,
                  senderId: boss.id,
                  senderType: 'agent',
                  content: `❌ **Failed to import skill**: ${err.message}`,
                  productivityScore: 100,
                });
                this.broadcastEvent('message:created', {
                  id: errReply.id,
                  channelId: errReply.channelId,
                  senderId: errReply.senderId,
                  senderName: boss.displayName.replace(/^@/, ''),
                  senderType: 'agent',
                  content: errReply.content,
                  createdAt: errReply.createdAt,
                  productivityScore: errReply.productivityScore,
                });
              }
              return;
            }

            // Subcommand: /skills delete <idOrName> or /skills remove <idOrName>
            if (rawSub === 'delete' || rawSub.startsWith('delete ') || rawSub === 'remove' || rawSub.startsWith('remove ')) {
              const target = rawSub.replace(/^(delete|remove)\s*/i, '').trim();
              if (!target) {
                const helpMsg = this.channelService.sendMessage({
                  channelId,
                  senderId: boss.id,
                  senderType: 'agent',
                  content: `💡 **Usage**: \`/skills delete <idOrName>\` or \`/skills remove <idOrName>\`\n\n*Example*: \`/skills delete paper-summarizer\``,
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
                return;
              }

              try {
                const targetSkill = this.skillEngine.getSkill(target) || this.skillEngine.getSkill(target.replace(/^skill[-_]{1,2}/, '').trim());
                if (!targetSkill) {
                  throw new Error(`Skill '${target}' not found.`);
                }
                if (targetSkill.isBuiltIn) {
                  throw new Error(`Cannot delete built-in system skill '${targetSkill.name}'.`);
                }
                const deleted = this.skillEngine.deleteSkill(targetSkill.id);
                if (!deleted) {
                  throw new Error(`Failed to delete skill '${target}'.`);
                }
                this.broadcastEvent('skill:deleted', { skillId: targetSkill.id, name: targetSkill.name });

                const reply = this.channelService.sendMessage({
                  channelId,
                  senderId: boss.id,
                  senderType: 'agent',
                  content: `🗑️ **Skill Deleted**: "${targetSkill.name}" (\`${targetSkill.id}\`) has been removed from persistent storage.`,
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
              } catch (err: any) {
                const errReply = this.channelService.sendMessage({
                  channelId,
                  senderId: boss.id,
                  senderType: 'agent',
                  content: `❌ **Failed to delete skill**: ${err.message}`,
                  productivityScore: 100,
                });
                this.broadcastEvent('message:created', {
                  id: errReply.id,
                  channelId: errReply.channelId,
                  senderId: errReply.senderId,
                  senderName: boss.displayName.replace(/^@/, ''),
                  senderType: 'agent',
                  content: errReply.content,
                  createdAt: errReply.createdAt,
                  productivityScore: errReply.productivityScore,
                });
              }
              return;
            }

            // Subcommand: /skill <name> [instructions] or /skill:<name> [instructions]
            if (rawSub.length > 0) {
              const allSkills = this.skillEngine.listSkills('all');
              const firstSpace = rawSub.indexOf(' ');
              const targetName = (firstSpace === -1 ? rawSub : rawSub.substring(0, firstSpace)).trim().toLowerCase().replace(/^:/, '');
              const userInstructions = firstSpace === -1 ? '' : rawSub.substring(firstSpace + 1).trim();

              const matchedSkill = allSkills.find(
                (s) =>
                  s.name.toLowerCase() === targetName ||
                  s.id.toLowerCase() === targetName ||
                  s.name.toLowerCase().replace(/\s+/g, '-') === targetName
              );
              if (matchedSkill) {
                if (userInstructions) {
                  // Direct execution of skill
                  const skillPrompt = `[SKILL EXECUTION: ${matchedSkill.name}]\nSkill Instructions: ${matchedSkill.instructions}\n\nTask: ${userInstructions}`;
                  const execDirective = {
                    id: `msg-skill-${Date.now()}`,
                    channelId,
                    senderId: 'user-operator',
                    senderType: 'human' as const,
                    content: skillPrompt,
                    createdAt: Date.now(),
                  };
                  this.executeSequentialAgents(routing.targetAgents.length > 0 ? routing.targetAgents : [boss], channelId, execDirective as any).catch((err) => {
                    console.error('[KIN CORE] Skill execution error:', err);
                  });
                  return;
                } else {
                  // Display skill details
                  const skillCard = `🛠️ **Skill: ${matchedSkill.name}** \`v${matchedSkill.version || '1.0.0'}\`\n- **Description**: ${matchedSkill.description}\n- **Instructions**: ${matchedSkill.instructions}\n- **Required Tools**: ${matchedSkill.requiredTools?.length ? matchedSkill.requiredTools.map((t: string) => `\`${t}\``).join(', ') : 'Default tools'}\n\n💡 *To execute*: \`/skill:${matchedSkill.name.toLowerCase().replace(/\s+/g, '-')} <your task>\``;
                  const reply = this.channelService.sendMessage({
                    channelId,
                    senderId: boss.id,
                    senderType: 'agent',
                    content: skillCard,
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
                  return;
                }
              }
            }

            // Default: List all skills
            const allSkills = this.skillEngine.listSkills('all');
            let skillsText = `🛠️ **Registered Agent Skills & Capabilities (${allSkills.length})**\n\n`;
            if (allSkills.length === 0) {
              skillsText += `_No external skills registered. Default platform primitives (bash, git, editor, computer) active._\n`;
            } else {
              for (const sk of allSkills) {
                const badge = sk.isBuiltIn ? ' *(Built-in)*' : ' *(Persistent Custom)*';
                const statusIcon = sk.status === 'active' ? '🟢' : sk.status === 'candidate' ? '🟡' : '⚪';
                skillsText += `${statusIcon} **${sk.name}** \`v${sk.version || '1.0.0'}\`${badge}\n`;
                skillsText += `  - ${sk.description}\n`;
                if (sk.tags && sk.tags.length > 0) {
                  skillsText += `  - *Tags*: ${sk.tags.map((t: string) => `\`${t}\``).join(', ')}\n`;
                }
              }
            }
            skillsText += `\n💡 *Commands*: \`/skills create <name> | <desc> | <instructions>\` • \`/skills delete <name>\` • \`/skills import <path/bundle>\` • \`/skill:<name> <task>\``;

            const reply = this.channelService.sendMessage({
              channelId,
              senderId: boss.id,
              senderType: 'agent',
              content: skillsText,
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
            return;
          }
        }

        // 5c2. /mcp — Model Context Protocol Connector & Tools Supervisor
        if (
          contentLower === '/mcp' ||
          contentLower.startsWith('/mcp ') ||
          contentLower.startsWith('/mcp:') ||
          contentLower.startsWith('/mcp\n')
        ) {
          const effectiveBoss = boss || this.agentRepo.listIdentitiesByProject(targetProjectId)[0] || this.agentRepo.getIdentity('agent-boss');
          if (effectiveBoss) {
            const rawSub = rawContent.replace(/^\/mcp[\s:\n]*/i, '').trim();

            if (rawSub.startsWith('reload') || rawSub === 'refresh') {
              const targetRepo = this.workspaceRepo.getProject(this.activeProjectId)?.repoPath || process.cwd();
              try {
                const tools = await this.mcpClient.reloadProject(targetRepo, true);
                const servers = this.mcpClient.getAllServers();
                let reloadMsg = `🔄 **MCP Servers Reloaded Successfully**\n\n`;
                reloadMsg += `- **Project Root**: \`${targetRepo}\`\n`;
                reloadMsg += `- **Active Servers**: ${servers.length}\n`;
                reloadMsg += `- **Total Discovered Tools**: ${tools.length}\n\n`;
                if (servers.length > 0) {
                  reloadMsg += `**Active MCP Servers**:\n`;
                  for (const s of servers) {
                    reloadMsg += `- **${s.name}** (\`${s.transport}\`${s.url ? ` • ${s.url}` : ''}): ${s.toolsCount} tool(s) registered\n`;
                  }
                } else {
                  reloadMsg += `_No MCP servers found in \`.kin/mcp.json\` or \`mcp.json\`._\n`;
                }

                const reply = this.channelService.sendMessage({
                  channelId,
                  senderId: effectiveBoss.id,
                  senderType: 'agent',
                  content: reloadMsg,
                  productivityScore: 100,
                });
                this.broadcastEvent('message:created', {
                  id: reply.id,
                  channelId: reply.channelId,
                  senderId: reply.senderId,
                  senderName: effectiveBoss.displayName.replace(/^@/, ''),
                  senderType: 'agent',
                  content: reply.content,
                  createdAt: reply.createdAt,
                  productivityScore: reply.productivityScore,
                });
                return;
              } catch (reloadErr: any) {
                const errMsg = this.channelService.sendMessage({
                  channelId,
                  senderId: effectiveBoss.id,
                  senderType: 'agent',
                  content: `⚠️ **MCP Reload Error**: ${reloadErr?.message || String(reloadErr)}`,
                  productivityScore: 100,
                });
                this.broadcastEvent('message:created', {
                  id: errMsg.id,
                  channelId: errMsg.channelId,
                  senderId: errMsg.senderId,
                  senderName: effectiveBoss.displayName.replace(/^@/, ''),
                  senderType: 'agent',
                  content: errMsg.content,
                  createdAt: errMsg.createdAt,
                  productivityScore: errMsg.productivityScore,
                });
                return;
              }
            }

            if (rawSub.startsWith('inspect ') || rawSub.startsWith('tool ')) {
              const toolNameQuery = rawSub.replace(/^(inspect|tool)\s*/i, '').trim();
              const allTools = this.mcpClient.getAllTools();
              const found = allTools.find((t) => t.name.toLowerCase() === toolNameQuery.toLowerCase() || `mcp__${t.serverName}__${t.name}`.toLowerCase() === toolNameQuery.toLowerCase());
              if (!found) {
                const notFoundMsg = this.channelService.sendMessage({
                  channelId,
                  senderId: effectiveBoss.id,
                  senderType: 'agent',
                  content: `❌ MCP Tool \`${toolNameQuery}\` not found across active servers.`,
                  productivityScore: 100,
                });
                this.broadcastEvent('message:created', {
                  id: notFoundMsg.id,
                  channelId: notFoundMsg.channelId,
                  senderId: notFoundMsg.senderId,
                  senderName: effectiveBoss.displayName.replace(/^@/, ''),
                  senderType: 'agent',
                  content: notFoundMsg.content,
                  createdAt: notFoundMsg.createdAt,
                  productivityScore: notFoundMsg.productivityScore,
                });
                return;
              }

              const detail = `🔧 **MCP Tool Schema**: \`mcp__${found.serverName}__${found.name}\`\n- **Server**: \`${found.serverName}\`\n- **Description**: ${found.description || 'No description'}\n\n\`\`\`json\n${JSON.stringify(found.inputSchema, null, 2)}\n\`\`\``;
              const reply = this.channelService.sendMessage({
                channelId,
                senderId: effectiveBoss.id,
                senderType: 'agent',
                content: detail,
                productivityScore: 100,
              });
              this.broadcastEvent('message:created', {
                id: reply.id,
                channelId: reply.channelId,
                senderId: reply.senderId,
                senderName: effectiveBoss.displayName.replace(/^@/, ''),
                senderType: 'agent',
                content: reply.content,
                createdAt: reply.createdAt,
                productivityScore: reply.productivityScore,
              });
              return;
            }

            // Default: list all active servers and registered tools
            const servers = this.mcpClient.getAllServers();
            const tools = this.mcpClient.getAllTools();
            let mcpText = `🔌 **Active MCP Connectors & Tools (${tools.length} Tools, ${servers.length} Servers)**\n\n`;
            if (servers.length === 0) {
              mcpText += `_No external MCP servers currently active._\n\n`;
              mcpText += `To configure MCP servers, create \`.kin/mcp.json\` in your project root:\n`;
              mcpText += `\`\`\`json\n{\n  "mcpServers": {\n    "my-server": {\n      "command": "node",\n      "args": ["server.js"]\n    }\n  }\n}\n\`\`\`\n`;
              mcpText += `Or for remote/HTTP MCP:\n`;
              mcpText += `\`\`\`json\n{\n  "mcpServers": {\n    "remote": {\n      "url": "http://127.0.0.1:8000/sse"\n    }\n  }\n}\n\`\`\`\n`;
            } else {
              for (const s of servers) {
                mcpText += `📦 **Server: ${s.name}** (\`${s.transport}\`${s.url ? ` • ${s.url}` : ''})\n`;
                const serverTools = tools.filter((t) => t.serverName === s.name);
                if (serverTools.length === 0) {
                  mcpText += `  _No tools exposed._\n`;
                } else {
                  for (const st of serverTools) {
                    mcpText += `  - \`mcp__${s.name}__${st.name}\`: ${st.description || st.name}\n`;
                  }
                }
                mcpText += `\n`;
              }
            }
            mcpText += `💡 *Commands*: \`/mcp reload\` • \`/mcp inspect <toolName>\``;

            const reply = this.channelService.sendMessage({
              channelId,
              senderId: boss.id,
              senderType: 'agent',
              content: mcpText,
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
            return;
          }
        }

        // 5d. /decisions or /decision or /adr — Architecture Decision Records (ADR)
        if (
          contentLower === '/decisions' ||
          contentLower.startsWith('/decisions ') ||
          contentLower.startsWith('/decisions:') ||
          contentLower.startsWith('/decisions\n') ||
          contentLower === '/decision' ||
          contentLower.startsWith('/decision ') ||
          contentLower.startsWith('/decision:') ||
          contentLower.startsWith('/decision\n') ||
          contentLower === '/adr' ||
          contentLower.startsWith('/adr ') ||
          contentLower.startsWith('/adr:') ||
          contentLower.startsWith('/adr\n')
        ) {
          if (boss) {
            const rawParams = rawContent.replace(/^\/(decisions|decision|adr)[\s:\n]*/i, '').trim();
            if (rawParams.startsWith('propose ') || rawParams.startsWith('create ')) {
              const text = rawParams.replace(/^(propose|create)\s*/i, '').trim();
              const parts = text.split('|').map((s) => s.trim()).filter(Boolean);
              const title = parts[0] || 'Architectural Decision';
              const rationale = parts[1] || 'Decided via team coordination';
              const alternatives = parts[2] ? parts[2].split(',').map((a) => a.trim()).filter(Boolean) : [];
              const decId = `dec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
              const newDec: Decision = {
                id: decId,
                projectId: targetProjectId,
                decidedById: boss.id,
                title,
                rationale,
                alternativesConsidered: alternatives,
                status: 'proposed',
                createdAt: Date.now(),
              };
              this.taskRepo.createDecision(newDec);
              this.broadcastEvent('decision:created', newDec);

              const decReply = this.channelService.sendMessage({
                channelId,
                senderId: boss.id,
                senderType: 'agent',
                content: `⚖️ **Architectural Decision Proposed**: "${title}"\n- **ID**: \`${decId}\`\n- **Rationale**: ${rationale}\n- **Alternatives**: ${alternatives.join(', ') || 'None stated'}\n- **Status**: \`proposed\`\n\nRecorded to authoritative project records.`,
                productivityScore: 100,
              });
              this.broadcastEvent('message:created', {
                id: decReply.id,
                channelId: decReply.channelId,
                senderId: decReply.senderId,
                senderName: boss.displayName.replace(/^@/, ''),
                senderType: 'agent',
                content: decReply.content,
                createdAt: decReply.createdAt,
                productivityScore: decReply.productivityScore,
              });
              return;
            }

            if (rawParams.startsWith('choose ') || rawParams.startsWith('select ')) {
              const choiceText = rawParams.replace(/^(choose|select)\s*/i, '').trim();
              const decId = `dec-choice-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
              const newDec: Decision = {
                id: decId,
                projectId: targetProjectId,
                decidedById: boss.id,
                title: `Plan Decision: ${choiceText.split(':')[0] || 'Selected Plan'}`,
                rationale: `Selected by operator via DecisionCard: ${choiceText}`,
                alternativesConsidered: [],
                status: 'authoritative',
                createdAt: Date.now(),
              };
              this.taskRepo.createDecision(newDec);
              this.broadcastEvent('decision:created', newDec);

              // Apply proposed_replanning_json and advance status on active goals
              const activeGoals = this.goalRepo.listGoals(targetProjectId).filter((g) => g.proposedReplanning);
              for (const ag of activeGoals) {
                if (ag.proposedReplanning) {
                  this.goalRepo.applyReplanning(ag.id, ag.proposedReplanning);
                }
                this.goalRepo.updateGoalProgress(ag.id, `Operator confirmed plan choice: ${choiceText}`);
              }

              const decReply = this.channelService.sendMessage({
                channelId,
                senderId: boss.id,
                senderType: 'agent',
                content: `✅ **Authoritative Plan Decision Recorded**: ${choiceText}\n- **ADR ID**: \`${decId}\`\n- **Status**: \`authoritative\`\n\nThe workforce has adopted this direction for active goals.`,
                productivityScore: 100,
              });
              this.broadcastEvent('message:created', {
                id: decReply.id,
                channelId: decReply.channelId,
                senderId: decReply.senderId,
                senderName: boss.displayName.replace(/^@/, ''),
                senderType: 'agent',
                content: decReply.content,
                createdAt: decReply.createdAt,
                productivityScore: decReply.productivityScore,
              });
              return;
            }

            const projectDecisions = this.taskRepo.listDecisionsByProject(targetProjectId);
            let decListText = `⚖️ **Project Architectural Decisions (ADR) (${projectDecisions.length})**\n\n`;
            if (projectDecisions.length === 0) {
              decListText += `_No architecture decisions recorded yet._\n\n💡 Propose a decision: \`/decision propose <title> | <rationale> [| <alternative 1>, <alternative 2>]\``;
            } else {
              for (const d of projectDecisions.slice(0, 10)) {
                const icon = d.status === 'authoritative' ? '✅' : d.status === 'proposed' ? '⏳' : d.status === 'superseded' ? '🔄' : '❌';
                decListText += `• ${icon} **${d.title}** (\`${d.status}\`)\n`;
                decListText += `  - **Rationale**: ${d.rationale}\n`;
                if (d.alternativesConsidered && d.alternativesConsidered.length > 0) {
                  decListText += `  - **Alternatives**: ${d.alternativesConsidered.join(', ')}\n`;
                }
              }
              decListText += `\n💡 Propose a decision: \`/decision propose <title> | <rationale> | <alternatives>\``;
            }

            const decReply = this.channelService.sendMessage({
              channelId,
              senderId: boss.id,
              senderType: 'agent',
              content: decListText,
              productivityScore: 100,
            });
            this.broadcastEvent('message:created', {
              id: decReply.id,
              channelId: decReply.channelId,
              senderId: decReply.senderId,
              senderName: boss.displayName.replace(/^@/, ''),
              senderType: 'agent',
              content: decReply.content,
              createdAt: decReply.createdAt,
              productivityScore: decReply.productivityScore,
            });
            return;
          }
        }

        // 5e. /btw is handled on the dedicated non-blocking fast-path channel at the top of handleChannelMessages

        // 5f. /grill-me [topic] — Adversarial Inquiry & Architecture Hardening
        if (
          contentLower === '/grill-me' ||
          contentLower.startsWith('/grill-me ') ||
          contentLower.startsWith('/grill-me:') ||
          contentLower.startsWith('/grill-me\n')
        ) {
          const grillTopic = rawContent.replace(/^\/grill-me[\s:\n]*/i, '').trim() || 'System Architecture, Scalability & Crash Resilience';
          const grillingAgent = routing.targetAgents[0] || boss;

          if (grillingAgent) {
            const sessionId = `grill-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
            let questions: Array<{ id: string; question: string; prompt: string; options: string[]; recommended: string }> = [];
            try {
              let canQueryModel = false;
              if (grillingAgent.activeModelId?.startsWith('ollama/')) {
                const ollamaInfo = await this.getLocalOllamaModels();
                if (ollamaInfo.online && ollamaInfo.models.length > 0) {
                  canQueryModel = true;
                }
              } else if (grillingAgent.activeModelId) {
                canQueryModel = true;
              }

              if (canQueryModel) {
                const grillPrompt = `You are a demanding principal software architect evaluating: "${grillTopic}".
Generate exactly 3 adversarial technical questions to probe edge cases, failure modes, and architectural trade-offs for this topic.
Format strictly as JSON:
[
  {
    "id": "q1",
    "question": "string",
    "options": ["option A", "option B", "option C", "option D"],
    "recommended": "best option"
  },
  ...
]`;
                const modelRes = await this.modelGateway.invoke({
                  modelId: grillingAgent.activeModelId || 'ollama/llama3',
                  fallbackModelId: grillingAgent.fallbackModelId,
                  messages: [{ role: 'user', content: grillPrompt }],
                  temperature: 0.3,
                  maxTokens: 1024,
                  signal: AbortSignal.timeout(3000),
                });
                const rawJson = (modelRes.content || '').replace(/^```json\s*|\s*```$/gi, '').trim();
                const match = rawJson.match(/\[\s*\{[\s\S]*\}\s*\]/);
                if (match) {
                  const parsed = JSON.parse(match[0]);
                  if (Array.isArray(parsed) && parsed.length >= 3) {
                    questions = parsed.slice(0, 3).map((q: any, idx: number) => ({
                      id: `q${idx + 1}`,
                      question: String(q.question || q.prompt || `Architectural probe ${idx + 1}`),
                      prompt: String(q.question || q.prompt || `Architectural probe ${idx + 1}`),
                      options: Array.isArray(q.options) && q.options.length >= 2 ? q.options.map(String) : [
                        'Implement transactional persistence and recovery sweep',
                        'Employ client-side retry with backoff',
                        'Delegate to external cloud service',
                        'Enforce lease fencing and optimistic concurrency',
                      ],
                      recommended: String(q.recommended || q.options?.[0] || 'Implement transactional persistence and recovery sweep'),
                    }));
                  }
                }
              }
            } catch (gErr) {
              console.warn('[GRILL-ME] Dynamic question generation notice, using grounded fallback questions:', gErr);
            }

            if (questions.length === 0) {
              questions = [
                {
                  id: 'q1',
                  question: `How does your design handle catastrophic crash or network partition during active operations on "${grillTopic}"?`,
                  prompt: `How does your design handle catastrophic crash or network partition during active operations on "${grillTopic}"?`,
                  options: [
                    'WAL mode transactional persistence with atomic checkpoints and startup recovery sweep',
                    'In-memory state buffer with eventual synchronization',
                    'Stateless worker architecture with cloud-managed replication',
                    'File system locks with synchronous fsync on every turn',
                  ],
                  recommended: 'WAL mode transactional persistence with atomic checkpoints and startup recovery sweep',
                },
                {
                  id: 'q2',
                  question: `When external upstream quotas or rate limits hit mid-execution while processing "${grillTopic}", what is the fallback strategy?`,
                  prompt: `When external upstream quotas or rate limits hit mid-execution while processing "${grillTopic}", what is the fallback strategy?`,
                  options: [
                    'Automatic state freezing, quota reset countdown, and seamless local model failover',
                    'Immediate retry with exponential backoff up to 10 attempts',
                    'Abort active task DAG and alert operator via notification',
                    'Queue requests in external message broker',
                  ],
                  recommended: 'Automatic state freezing, quota reset countdown, and seamless local model failover',
                },
                {
                  id: 'q3',
                  question: `What prevents concurrent race conditions and split-brain conflicts when multiple agents touch "${grillTopic}"?`,
                  prompt: `What prevents concurrent race conditions and split-brain conflicts when multiple agents touch "${grillTopic}"?`,
                  options: [
                    'Atomic task leases (claimedByRunId + leaseExpiresAt) with auto-reclamation watchdog',
                    'Single-threaded event loop execution without concurrent workers',
                    'Optimistic concurrency control with version fences',
                    'Distributed token lock across agent processes',
                  ],
                  recommended: 'Atomic task leases (claimedByRunId + leaseExpiresAt) with auto-reclamation watchdog',
                },
              ];
            }

            const grillNotice = this.channelService.sendMessage({
              channelId,
              senderId: grillingAgent.id,
              senderType: 'agent',
              content: `🔥 **Adversarial Architecture Grilling: "${grillTopic}"**\n\n` +
                `I am putting your system design through stress testing. Review the challenges in the interactive **Grill-Me Assessment Card** below or select your choices to forge an authoritative Architecture Decision Record (ADR):\n\n` +
                questions.map((q, idx) => `**Q${idx + 1}: ${q.question}**\n` + q.options.map((o) => `  - [ ] ${o}`).join('\n')).join('\n\n'),
              productivityScore: 100,
            });

            const sessionData = {
              id: sessionId,
              channelId,
              topic: grillTopic,
              agentId: grillingAgent.id,
              agentName: grillingAgent.displayName,
              messageId: grillNotice.id,
              questions,
              createdAt: Date.now(),
            };

            this.broadcastEvent('message:created', {
              id: grillNotice.id,
              channelId: grillNotice.channelId,
              senderId: grillNotice.senderId,
              senderName: grillingAgent.displayName.replace(/^@/, ''),
              senderType: 'agent',
              content: grillNotice.content,
              createdAt: grillNotice.createdAt,
              productivityScore: grillNotice.productivityScore,
            });

            this.broadcastEvent('grill_me:session', sessionData);
          }
          return;
        }

        // 5g. /compact — Trigger manual Context Compaction & State Snapshot
        if (
          contentLower === '/compact' ||
          contentLower.startsWith('/compact ') ||
          contentLower.startsWith('/compact:') ||
          contentLower.startsWith('/compact\n')
        ) {
          if (boss) {
            const history = this.channelService.getMessages(channelId, 50);
            const goals = this.goalRepo.listGoals(targetProjectId);
            const primaryGoal = goals[0]?.title || 'Workspace Operations';
            const tasks = this.db.query<{ id: string; title: string; status: string }>(
              'SELECT id, title, status FROM tasks WHERE goal_id IN (SELECT id FROM goals WHERE project_id = ?)',
              targetProjectId
            );
            const completedTasks = tasks.filter((t: any) => t.status === 'completed').map((t: any) => ({ id: t.id, title: t.title }));
            const pendingTasks = tasks.filter((t: any) => t.status !== 'completed').map((t: any) => ({ id: t.id, title: t.title, dependsOn: [] }));
            const activeTask = pendingTasks[0] || { id: 'none', title: 'Awaiting next directive' };

            const compactor = new ContextCompactor();
            const totalChars = history.reduce((sum: number, m: any) => sum + (m.content?.length || 0), 0);
            const estTokens = Math.ceil(totalChars / 4);

            const snapshot = {
              goalId: goals[0]?.id || 'goal-default',
              primaryObjective: primaryGoal,
              completedTasks,
              activeTask,
              modifiedFiles: [],
              encounteredErrorsAndResolutions: [],
              immutableDecisions: [],
              pendingTaskDag: pendingTasks,
            };

            const compactionResult = compactor.evaluateAndCompact({
              messages: history,
              currentTokens: Math.max(estTokens, 7000),
              maxTokens: 8000,
              compactionThresholdRatio: 0.1,
              snapshotState: snapshot,
            });

            try {
              this.memoryRepo.setMemory({
                scope: 'channel',
                scopeId: channelId,
                type: 'semantic',
                key: 'context-compaction-snapshot',
                value: compactionResult.snapshot || snapshot,
              });
            } catch (occErr) {
              console.warn('[COMPACT] Snapshot OCC note:', occErr);
            }

            const reply = this.channelService.sendMessage({
              channelId,
              senderId: boss.id,
              senderType: 'agent',
              content: `📦 **Context Compaction Completed**\n- **Analyzed Messages**: ${history.length} turns (~${estTokens} tokens)\n- **Primary Objective**: "${primaryGoal}"\n- **Active Task**: ${activeTask.title}\n- **Completed Tasks**: ${completedTasks.length}\n- **Pending Tasks**: ${pendingTasks.length}\n- **Context Status**: Older turn history summarized into Tier 2 Channel Memory; active train-of-thought preserved.`,
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
          return;
        }

        // 5h. /browser [url] — Direct Interactive Browser Session Control
        if (
          contentLower === '/browser' ||
          contentLower.startsWith('/browser ') ||
          contentLower.startsWith('/browser:') ||
          contentLower.startsWith('/browser\n')
        ) {
          if (boss) {
            const rawTarget = rawContent.replace(/^\/browser[\s:\n]*/i, '').trim();
            if (rawTarget) {
              const url = rawTarget.startsWith('http://') || rawTarget.startsWith('https://') ? rawTarget : `https://${rawTarget}`;
              let pageTitle = 'Unknown';
              let status = 200;
              try {
                const navResult = await this.browserController.navigate(url);
                pageTitle = navResult.title || 'Page loaded';
                status = navResult.status || 200;
              } catch (bErr: any) {
                pageTitle = `Navigation Notice: ${bErr.message}`;
                status = 500;
              }
              const reply = this.channelService.sendMessage({
                channelId,
                senderId: boss.id,
                senderType: 'agent',
                content: `🌐 **Interactive Browser Navigated**\n- **URL**: ${url}\n- **Status**: ${status}\n- **Title**: "${pageTitle}"\n- **Session**: Active (Agents can now use \`browserNavigate\`, \`browserInspect\`, \`browserClick\`, and \`browserScreenshot\`).`,
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
            } else {
              const bStatus = this.browserController.getStatus();
              const reply = this.channelService.sendMessage({
                channelId,
                senderId: boss.id,
                senderType: 'agent',
                content: `🌐 **Browser Session Status**\n- **Active**: ${bStatus.active ? 'Yes (Live Session)' : 'Idle (Ready on demand)'}\n- **Current URL**: ${bStatus.currentUrl || 'None'}\n\n💡 *Usage*: \`/browser <url>\` to navigate immediately (e.g. \`/browser https://news.ycombinator.com\`).`,
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
          }
          return;
        }

        // 5i. /learn [lesson] — Operational Experience & Learned Rules Retention
        if (
          contentLower === '/learn' ||
          contentLower.startsWith('/learn ') ||
          contentLower.startsWith('/learn:') ||
          contentLower.startsWith('/learn\n')
        ) {
          if (boss) {
            const rawLesson = rawContent.replace(/^\/learn[\s:\n]*/i, '').trim();
            if (rawLesson) {
              const now = Date.now();
              const key = `learned-rule-${now}`;
              try {
                this.memoryRepo.setMemory({
                  scope: 'project',
                  scopeId: targetProjectId,
                  type: 'procedural',
                  key,
                  value: rawLesson,
                });
              } catch (mErr) {
                console.warn('[LEARN] Memory retention note:', mErr);
              }
              const reply = this.channelService.sendMessage({
                channelId,
                senderId: boss.id,
                senderType: 'agent',
                content: `🧠 **Operational Pattern Learned & Persisted**\n- **Lesson**: "${rawLesson}"\n- **Scope**: Tier 1 Project Shared Memory\n- **Key**: \`${key}\`\n\nAll agents in project \`${targetProjectId}\` now retain this rule across long-running turns.`,
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
            } else {
              const memories = this.memoryRepo.listMemories('project', targetProjectId);
              const learned = memories.filter((m) => m.key.startsWith('learned-'));
              const reply = this.channelService.sendMessage({
                channelId,
                senderId: boss.id,
                senderType: 'agent',
                content: `🧠 **Project Learned Memory Knowledgebase**\n- **Total Learned Rules**: ${learned.length}\n${learned.slice(0, 5).map((m) => `  • "${m.value}"`).join('\n') || '  • *No custom learned rules registered yet.*'}\n\n💡 *Usage*: \`/learn <guideline or pattern>\` (e.g. \`/learn Always run type checks before committing\`).`,
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
          }
          return;
        }

        const hasOrchestratorCommand =
          contentLower.startsWith('/hire') ||
          contentLower.startsWith('/assign') ||
          contentLower.includes('hire') ||
          contentLower.includes('recruit') ||
          contentLower.includes('assign');
        const isBossTargeted = routing.targetAgents.some((a) => a.isOrchestrator);

        if (routing.action === 'orchestrator_fallback' || (isBossTargeted && hasOrchestratorCommand && !channelId.startsWith('dm-'))) {
          if (boss) {
            this.handleOrchestratorAction(boss, channelId, userMsg, allProjectAgents);
          }
        } else {
          // Sequential execution for specialists or direct response
          this.executeSequentialAgents(routing.targetAgents, channelId, userMsg);
        }
        return;
  }
}
