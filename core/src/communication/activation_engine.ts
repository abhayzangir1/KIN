// ============================================================================
// KIN SELECTIVE ACTIVATION ENGINE
// Decides which agents wake for inference upon incoming messages and events.
// Enforces zero-bot-storm invariant: channel messages do NOT wake members by default.
// ============================================================================

import { AgentDefinition, AgentIdentity, Message } from '../domain/types.js';

export interface ActivationEvent {
  type: 'message' | 'task_assigned' | 'task_dependency_ready' | 'human_direct_prompt';
  message?: Message;
  taskId?: string;
  assignedAgentId?: string;
  readyTaskAssignedAgentId?: string;
}

export interface ActivationDecision {
  shouldActivate: boolean;
  agentId: string;
  triggerReason?: string;
}

export interface ChannelRoutingResult {
  action: 'direct_response' | 'sequential_specialists' | 'orchestrator_fallback';
  targetAgents: AgentIdentity[];
  reason: string;
  fallbackOrchestrator?: AgentIdentity;
}

export interface ChannelRoutingInput {
  channelId: string;
  isPrivate?: boolean;
  message: Message;
  channelMembers: AgentIdentity[];
  allProjectAgents: AgentIdentity[];
  definitionsMap: Map<string, AgentDefinition>;
}

export class ActivationEngine {
  /**
   * Evaluates if a given agent should be woken for inference by the incoming event.
   */
  public evaluateActivation(agent: AgentIdentity, event: ActivationEvent): ActivationDecision {
    // 1. Direct Human Prompt to this specific agent
    if (event.type === 'human_direct_prompt' && event.assignedAgentId === agent.id) {
      return {
        shouldActivate: true,
        agentId: agent.id,
        triggerReason: 'human_direct_prompt',
      };
    }

    // 2. Direct Task Assignment to this agent
    if (event.type === 'task_assigned' && event.assignedAgentId === agent.id) {
      return {
        shouldActivate: true,
        agentId: agent.id,
        triggerReason: `task_assigned:${event.taskId}`,
      };
    }

    // 3. Task Dependency Ready for this agent
    if (event.type === 'task_dependency_ready' && event.readyTaskAssignedAgentId === agent.id) {
      return {
        shouldActivate: true,
        agentId: agent.id,
        triggerReason: `task_dependency_ready:${event.taskId}`,
      };
    }

    // 4. Message Event: Check explicit @mentions
    if (event.type === 'message' && event.message) {
      // An agent NEVER wakes up from its own messages
      if (event.message.senderId === agent.id) {
        return { shouldActivate: false, agentId: agent.id };
      }

      const cleanDisplayName = agent.displayName.replace(/^@/, '');
      const isMentioned = event.message.mentions.some(
        (m) =>
          m.toLowerCase() === agent.id.toLowerCase() ||
          m.toLowerCase() === cleanDisplayName.toLowerCase() ||
          m.toLowerCase() === 'all'
      );

      if (isMentioned) {
        return {
          shouldActivate: true,
          agentId: agent.id,
          triggerReason: `explicit_mention:${event.message.id}`,
        };
      }
    }

    // Default: INACTIVE. Messages without explicit mentions DO NOT wake agents.
    return {
      shouldActivate: false,
      agentId: agent.id,
    };
  }

  /**
   * Authoritative 4-condition coordination engine:
   * 1. Direct Messages (DMs): Target recipient always responds directly.
   * 2. Explicit @mentions in Channels: Mentioned agents respond.
   * 3. Multi-domain messages without mentions: Relevant specialists respond sequentially.
   * 4. Zero relevant specialists: Orchestrator (@Boss) steps in as safety net.
   */
  public evaluateChannelRouting(input: ChannelRoutingInput): ChannelRoutingResult {
    const { channelId, isPrivate, message, channelMembers, allProjectAgents, definitionsMap } = input;

    // 1. Condition 1: Direct Message (DM)
    if (isPrivate || channelId.startsWith('dm-')) {
      const targetAgentId = channelId.startsWith('dm-') ? channelId.replace(/^dm-/, '') : channelMembers[0]?.id;
      const targetAgent = allProjectAgents.find((a) => a.id === targetAgentId) || channelMembers.find((a) => a.id === targetAgentId);
      if (targetAgent) {
        return {
          action: 'direct_response',
          targetAgents: [targetAgent],
          reason: 'direct_message',
        };
      }
    }

    // 2. Condition 2: Explicit @mentions
    if (message.mentions && message.mentions.length > 0) {
      const mentionedClean = message.mentions.map((m) => m.toLowerCase().replace(/^@/, ''));
      const isAll = mentionedClean.includes('all');

      const matchedAgents = allProjectAgents.filter((agent) => {
        if (agent.id === message.senderId) return false;
        if (isAll) return true;
        const cleanName = agent.displayName.replace(/^@/, '').toLowerCase();
        return mentionedClean.includes(cleanName) || mentionedClean.includes(agent.id.toLowerCase());
      });

      if (matchedAgents.length > 0) {
        return {
          action: 'sequential_specialists',
          targetAgents: matchedAgents,
          reason: 'explicit_mentions',
        };
      }
    }

    // 3. Condition 3: Domain relevance for channel members
    const specialists = channelMembers.filter((a) => !a.isOrchestrator && a.id !== message.senderId);
    const contentLower = message.content.toLowerCase();

    const relevantSpecialists = specialists.filter((agent) => {
      const def = definitionsMap.get(agent.definitionId);
      if (!def) return false;

      // Extract domain keywords from role and domain authority
      const keywords: string[] = [
        ...def.role.toLowerCase().split(/\s+/),
        ...def.domainAuthority.map((d) => d.toLowerCase()),
      ];

      return keywords.some((k) => k.length > 2 && contentLower.includes(k));
    });

    if (relevantSpecialists.length > 0) {
      return {
        action: 'sequential_specialists',
        targetAgents: relevantSpecialists,
        reason: 'domain_relevance',
      };
    }

    // 4. Condition 4: Zero relevant specialists -> Orchestrator (@Boss) safety net fallback
    const boss =
      channelMembers.find((a) => a.isOrchestrator) ||
      allProjectAgents.find((a) => a.isOrchestrator) ||
      channelMembers[0] ||
      allProjectAgents[0];

    return {
      action: 'orchestrator_fallback',
      targetAgents: boss ? [boss] : [],
      reason: 'orchestrator_safety_net',
      fallbackOrchestrator: boss,
    };
  }
}
