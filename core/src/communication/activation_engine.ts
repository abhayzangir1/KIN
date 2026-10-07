// ============================================================================
// KIN SELECTIVE ACTIVATION ENGINE
// Decides which agents wake for inference upon incoming messages and events.
// Enforces zero-bot-storm invariant: channel messages do NOT wake members by default.
// Exposes observable match reasons and explicit fallback behavior.
// ============================================================================

import { AgentDefinition, AgentIdentity, Message } from '../domain/types.js';

export interface ActivationEvent {
  type: 'message' | 'task_assigned' | 'task_dependency_ready' | 'human_direct_prompt';
  message?: Message;
  taskId?: string;
  assignedAgentId?: string;
  readyTaskAssignedAgentId?: string;
  definition?: AgentDefinition;
  isOrchestratorFallback?: boolean;
}

export interface ActivationDecision {
  shouldActivate: boolean;
  agentId: string;
  triggerReason?: string;
  matchReason?: string;
  matchedKeywords?: string[];
  explanation?: string;
}

export interface SpecialistMatchInfo {
  agentId: string;
  displayName: string;
  matchReason: string;
  matchedKeywords: string[];
}

export interface ChannelRoutingResult {
  action: 'direct_response' | 'sequential_specialists' | 'orchestrator_fallback';
  targetAgents: AgentIdentity[];
  reason: string;
  matchReason?: string;
  matchedKeywords?: string[];
  matchedSpecialists?: SpecialistMatchInfo[];
  fallbackOrchestrator?: AgentIdentity;
  fallbackReason?: string;
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
   * Records and returns the exact match reason for complete routing observability.
   */
  public evaluateActivation(
    agent: AgentIdentity,
    event: ActivationEvent,
    definition?: AgentDefinition
  ): ActivationDecision {
    // 1. Direct Human Prompt to this specific agent
    if (event.type === 'human_direct_prompt' && event.assignedAgentId === agent.id) {
      return {
        shouldActivate: true,
        agentId: agent.id,
        triggerReason: 'human_direct_prompt',
        matchReason: 'direct_mention',
        explanation: 'Direct human prompt targeting this agent',
      };
    }

    // 2. Direct Task Assignment to this agent
    if (event.type === 'task_assigned' && event.assignedAgentId === agent.id) {
      return {
        shouldActivate: true,
        agentId: agent.id,
        triggerReason: `task_assigned:${event.taskId}`,
        matchReason: 'task_assigned',
        explanation: `Assigned task ${event.taskId}`,
      };
    }

    // 3. Task Dependency Ready for this agent
    if (event.type === 'task_dependency_ready' && event.readyTaskAssignedAgentId === agent.id) {
      return {
        shouldActivate: true,
        agentId: agent.id,
        triggerReason: `task_dependency_ready:${event.taskId}`,
        matchReason: 'task_dependency_ready',
        explanation: `Task dependency cleared for task ${event.taskId}`,
      };
    }

    // 4. Message Event
    if (event.type === 'message' && event.message) {
      // An agent NEVER wakes up from its own messages
      if (event.message.senderId === agent.id) {
        return { shouldActivate: false, agentId: agent.id };
      }

      // 4a. Explicit @mentions
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
          matchReason: 'direct_mention',
          explanation: `Explicitly mentioned by user or peer: @${cleanDisplayName}`,
        };
      }

      // 4b. Orchestrator fallback check
      if (event.isOrchestratorFallback && agent.isOrchestrator) {
        return {
          shouldActivate: true,
          agentId: agent.id,
          triggerReason: 'orchestrator_fallback',
          matchReason: 'orchestrator_fallback',
          explanation: 'No specialist matched channel query; orchestrator stepped in as safety net',
        };
      }

      // 4c. Domain authority & role keyword match (if definition is provided)
      const def = definition || event.definition;
      if (def) {
        const contentLower = event.message.content.toLowerCase();

        // Check domain authority first
        const domainMatches = (def.domainAuthority || []).filter(
          (d) => d.length > 2 && contentLower.includes(d.toLowerCase())
        );
        if (domainMatches.length > 0) {
          return {
            shouldActivate: true,
            agentId: agent.id,
            triggerReason: 'domain_authority_match',
            matchReason: 'domain_authority_match',
            matchedKeywords: domainMatches,
            explanation: `Matched domain authority: ${domainMatches.join(', ')}`,
          };
        }

        // Check role keywords
        const roleWords = (def.role || '')
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);
        const roleMatches = roleWords.filter((w) => contentLower.includes(w));
        if (roleMatches.length > 0) {
          return {
            shouldActivate: true,
            agentId: agent.id,
            triggerReason: `role_keyword_match: ${roleMatches.join(', ')}`,
            matchReason: `role_keyword_match: ${roleMatches.join(', ')}`,
            matchedKeywords: roleMatches,
            explanation: `Matched role keywords: ${roleMatches.join(', ')}`,
          };
        }
      }
    }

    // Default: INACTIVE. Messages without explicit mentions or domain matches DO NOT wake agents.
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
          matchReason: 'direct_mention',
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
          matchReason: 'direct_mention',
        };
      }
    }

    // 3. Condition 3: Domain relevance for channel members
    const specialists = channelMembers.filter((a) => !a.isOrchestrator && a.id !== message.senderId);
    const contentLower = message.content.toLowerCase();
    const matchedSpecialists: SpecialistMatchInfo[] = [];
    const relevantSpecialists: AgentIdentity[] = [];

    for (const agent of specialists) {
      const def = definitionsMap.get(agent.definitionId);
      if (!def) continue;

      const domainMatches = (def.domainAuthority || []).filter(
        (d) => d.length > 2 && contentLower.includes(d.toLowerCase())
      );
      if (domainMatches.length > 0) {
        relevantSpecialists.push(agent);
        matchedSpecialists.push({
          agentId: agent.id,
          displayName: agent.displayName,
          matchReason: 'domain_authority_match',
          matchedKeywords: domainMatches,
        });
        continue;
      }

      const roleWords = (def.role || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      const roleMatches = roleWords.filter((w) => contentLower.includes(w));
      if (roleMatches.length > 0) {
        relevantSpecialists.push(agent);
        matchedSpecialists.push({
          agentId: agent.id,
          displayName: agent.displayName,
          matchReason: `role_keyword_match: ${roleMatches.join(', ')}`,
          matchedKeywords: roleMatches,
        });
      }
    }

    if (relevantSpecialists.length > 0) {
      return {
        action: 'sequential_specialists',
        targetAgents: relevantSpecialists,
        reason: 'domain_relevance',
        matchReason: matchedSpecialists[0].matchReason,
        matchedKeywords: matchedSpecialists[0].matchedKeywords,
        matchedSpecialists,
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
      matchReason: 'orchestrator_fallback',
      fallbackOrchestrator: boss,
      fallbackReason: 'No channel specialists matched request keywords; routing to lead orchestrator',
    };
  }
}
