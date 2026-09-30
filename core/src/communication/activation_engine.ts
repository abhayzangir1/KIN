// ============================================================================
// KIN SELECTIVE ACTIVATION ENGINE
// Decides which agents wake for inference upon incoming messages and events.
// Enforces zero-bot-storm invariant: channel messages do NOT wake members by default.
// ============================================================================

import { AgentIdentity, Message } from '../domain/types.js';

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
}
