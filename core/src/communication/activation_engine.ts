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
  action: 'direct_response' | 'sequential_specialists' | 'orchestrator_fallback' | 'none';
  targetAgents: AgentIdentity[];
  reason: string;
  matchReason?: string;
  matchedKeywords?: string[];
  matchedSpecialists?: SpecialistMatchInfo[];
  fallbackOrchestrator?: AgentIdentity;
  fallbackReason?: string;
  explanation?: string;
}

export interface ChannelRoutingInput {
  channelId: string;
  isPrivate?: boolean;
  channelType?: string;
  message: Message;
  channelMembers: AgentIdentity[];
  allProjectAgents: AgentIdentity[];
  definitionsMap: Map<string, AgentDefinition>;
}

export class GreetingClassifier {
  private static readonly DIRECTIVE_PATTERNS = [
    /\b(build|test|deploy|run|fix|create|update|delete|modify|refactor|implement|inspect|check|analyze|investigate|start|stop|restart|pause|resume|cancel|ship|push|commit|rebase|merge|review|write|read|exec|execute|install|download|upload|schedule|assign|hire|verify|lint|eval|benchmark|reproduce|debug)\b/i,
    /\b(pr|pull request|issue|bug|task|goal|error|exception|failure|crash|database|schema|api|endpoint|token|key|branch|repo|worktree|channel|model|ollama|mcp|server|architecture|design|pipeline)\b/i,
    /\b(can you|could you|please|let's|lets|should we|why is|what is the status|how to)\b/i,
    /\/[a-z_]+/i,
  ];

  public static classify(content: string): { isGreeting: boolean } {
    return { isGreeting: this.isPureGreeting(content) };
  }

  public static isPureGreeting(content: string): boolean {
    if (!content || !content.trim()) return false;
    const trimmed = content.trim();

    const withoutMentions = trimmed.replace(/@[a-zA-Z0-9_-]+/g, '').trim();
    if (!withoutMentions) return false;

    for (const pattern of this.DIRECTIVE_PATTERNS) {
      if (pattern.test(withoutMentions)) {
        return false;
      }
    }

    const clean = withoutMentions.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return false;

    const pleasantryPhrases = new Set([
      'hello',
      'hi',
      'hey',
      'hey there',
      'hello there',
      'hi there',
      'good morning',
      'good afternoon',
      'good evening',
      'good day',
      'how are you',
      'how are you doing',
      'how is it going',
      'hows it going',
      'hope you are well',
      'hope all is well',
      'nice to meet you',
      'great to meet you',
      'hello everyone',
      'hi everyone',
      'hey everyone',
      'hello team',
      'hi team',
      'hey team',
      'good morning team',
      'good afternoon team',
      'good evening team',
      'good morning everyone',
      'good afternoon everyone',
      'good evening everyone',
      'good morning all',
      'good afternoon all',
      'good evening all',
      'whats up',
      'sup',
      'yo',
      'happy monday',
      'happy friday',
      'have a good day',
      'have a great day',
      'thank you',
      'thanks',
      'thanks team',
      'thank you team',
    ]);

    if (pleasantryPhrases.has(clean)) {
      return true;
    }

    const greetingWords = new Set(['hi', 'hello', 'hey', 'how', 'greetings', 'howdy', 'hola', 'yo', 'morning', 'afternoon', 'evening', 'welcome', 'thanks', 'thank', 'thx', 'cheers']);
    const fillerWords = new Set(['there', 'all', 'everyone', 'team', 'folks', 'you', 'are', 'doing', 'is', 'it', 'going', 'to', 'hope', 'well', 'good', 'day', 'today', 'tonight', 'a', 'have', 'great', 'nice', 'meet', 'kin', 'bot', 'assistant', 'workforce']);

    const tokens = clean.split(' ').filter(Boolean);
    const allGreetingOrFiller = tokens.every((t) => greetingWords.has(t) || fillerWords.has(t));
    const hasAtLeastOneGreeting = tokens.some((t) => greetingWords.has(t));

    return allGreetingOrFiller && hasAtLeastOneGreeting;
  }
}

export class ActivationEngine {
  /**
   * Evaluates if a given message is strictly a conversational greeting
   * without any substantive task directives or special recipient requests.
   * Per PRD § 6: Pure greetings route exclusively to @Boss without waking specialists.
   */
  public static isPureGreeting(content: string): boolean {
    return GreetingClassifier.isPureGreeting(content);
  }

  public isPureGreeting(content: string): boolean {
    return GreetingClassifier.isPureGreeting(content);
  }

  public routeChannelMessage(input: ChannelRoutingInput): ChannelRoutingResult {
    return this.evaluateChannelRouting(input);
  }

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
      const isSenderAuthorizedForAll = event.message.senderType === 'human' || event.message.senderId === 'user-operator' || event.message.senderId === 'system';
      const isMentioned = event.message.mentions.some(
        (m) =>
          m.toLowerCase() === agent.id.toLowerCase() ||
          m.toLowerCase() === cleanDisplayName.toLowerCase() ||
          (m.toLowerCase() === 'all' && isSenderAuthorizedForAll)
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
    const { channelId, isPrivate, channelType, message, channelMembers, allProjectAgents, definitionsMap } = input;

    // 1. Condition 1: Direct Message (DM)
    // DMs are strictly 1-on-1 private correspondence (either starting with 'dm-' or explicitly marked 'direct_message' / 'dm')
    const isDirectMessage = channelId.startsWith('dm-') || channelType === 'direct_message' || channelType === 'dm';
    if (isDirectMessage) {
      const otherMembers = channelMembers.filter((m) => m.id !== message.senderId);
      let targetAgent: AgentIdentity | undefined = otherMembers[0];

      if (!targetAgent && channelId.startsWith('dm-')) {
        const rawId = channelId.replace(/^dm-/, '');
        targetAgent = allProjectAgents.find((a) => a.id === rawId && a.id !== message.senderId)
          || channelMembers.find((a) => a.id === rawId && a.id !== message.senderId);

        if (!targetAgent) {
          targetAgent = allProjectAgents.find((a) => {
            if (a.id === message.senderId) return false;
            const expectedDm = `dm-${[message.senderId, a.id].sort().join('-')}`;
            return channelId === expectedDm;
          });
        }

        if (!targetAgent) {
          targetAgent = allProjectAgents.find((a) => {
            if (a.id === message.senderId) return false;
            return rawId === a.id ||
              rawId.startsWith(`${a.id}-`) ||
              rawId.endsWith(`-${a.id}`) ||
              rawId.includes(`-${a.id}-`);
          });
        }
      }

      if (targetAgent) {
        return {
          action: 'direct_response',
          targetAgents: [targetAgent],
          reason: 'direct_message',
          matchReason: 'direct_mention',
        };
      }

      return {
        action: 'none',
        targetAgents: [],
        reason: 'private_dm_isolated',
      };
    }

    // Greeting check per PRD § 6:
    // "If the complete meaning is only a greeting, with no task, special recipient, or broader participation request, one brief reply comes from Boss and no specialists are woken."
    if (this.isPureGreeting(message.content)) {
      const boss =
        channelMembers.find((a) => a.isOrchestrator) ||
        channelMembers[0] ||
        allProjectAgents.find((a) => a.isOrchestrator) ||
        allProjectAgents[0];
      return {
        action: 'orchestrator_fallback',
        targetAgents: boss ? [boss] : [],
        reason: 'pure_greeting',
        matchReason: 'greeting_filter',
      };
    }

    // 2. Condition 2: Explicit @mentions
    if (message.mentions && message.mentions.length > 0) {
      const mentionedClean = message.mentions.map((m) => m.toLowerCase().replace(/^@/, ''));
      const isSenderAuthorizedForAll = message.senderType === 'human' || message.senderId === 'user-operator' || message.senderId === 'system';
      const isAll = mentionedClean.includes('all') && isSenderAuthorizedForAll;

      // PRD § 6: Exact agent mention activates that agent only if it is a member of the current channel!
      // All directly selected agents must be channel members.
      const candidatePool = channelMembers;
      const matchedAgents = candidatePool.filter((agent) => {
        if (agent.id === message.senderId) return false;
        if (isAll) return true;
        const cleanName = agent.displayName.replace(/^@/, '').toLowerCase();
        return mentionedClean.includes(cleanName) || mentionedClean.includes(agent.id.toLowerCase());
      });

      if (matchedAgents.length > 0) {
        return {
          action: 'sequential_specialists',
          targetAgents: matchedAgents,
          reason: isAll ? 'all_channel_members' : 'explicit_mentions',
          matchReason: 'direct_mention',
        };
      }

      // Check if non-channel project agents were mentioned
      const nonMemberMatches = allProjectAgents.filter((agent) => {
        if (channelMembers.some((m) => m.id === agent.id)) return false;
        const cleanName = agent.displayName.replace(/^@/, '').toLowerCase();
        return mentionedClean.includes(cleanName) || mentionedClean.includes(agent.id.toLowerCase());
      });

      if (nonMemberMatches.length > 0) {
        // PRD § 6: "A project agent outside the channel cannot be activated directly; Boss explains and offers the ordinary channel-staffing flow."
        const boss =
          channelMembers.find((a) => a.isOrchestrator) ||
          allProjectAgents.find((a) => a.isOrchestrator) ||
          channelMembers[0] ||
          allProjectAgents[0];
        const names = nonMemberMatches
          .map((a) => (a.displayName.startsWith('@') ? a.displayName : `@${a.displayName}`))
          .join(', ');
        return {
          action: 'orchestrator_fallback',
          targetAgents: boss ? [boss] : [],
          reason: 'unassigned_agent_mention',
          matchReason: 'non_member_mention_fallback',
          explanation: `${names} is not a member of this channel. @Boss can staff this channel upon operator confirmation.`,
        };
      }
    }

    // 2b. Condition 2b: Sequential team introductions
    const isTeamIntro = /(introduce\s+(yourselves|yourself|the\s+team)|who\s+is\s+on\s+the\s+team|team\s+introduction|who\s+is\s+working\s+here|meet\s+the\s+team|who\s+are\s+you\s+all|tell\s+me\s+about\s+yourselves|introductions?\b)/i.test(
      message.content
    );
    if (isTeamIntro) {
      const introMembers = channelMembers.filter((m) => m.id !== message.senderId);
      if (introMembers.length > 0) {
        return {
          action: 'sequential_specialists',
          targetAgents: introMembers,
          reason: 'team_introduction',
          matchReason: 'team_introduction',
        };
      }
    }

    // 2c. Condition 2c: Explicit name address in text (e.g. "hey Architect", "Developer please look at this")
    const namedMembers = channelMembers.filter((agent) => {
      if (agent.id === message.senderId) return false;
      const cleanName = agent.displayName.replace(/^@/, '').trim();
      if (cleanName.length < 2) return false;
      try {
        const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|[^\\w])${escaped}($|[^\\w])`, 'i');
        return regex.test(message.content);
      } catch {
        return false;
      }
    });
    if (namedMembers.length > 0) {
      return {
        action: 'sequential_specialists',
        targetAgents: namedMembers,
        reason: 'named_in_text',
        matchReason: 'direct_mention',
      };
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
      (!isPrivate ? allProjectAgents.find((a) => a.isOrchestrator) : undefined) ||
      channelMembers[0] ||
      (!isPrivate ? allProjectAgents[0] : undefined);

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
