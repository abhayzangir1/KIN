// ============================================================================
// KIN LOOP & DEBATE STAGNATION BREAKER
// 3-turn dynamic early-stopping protocol (ColMAD / CONSENSAGENT standard).
// Prevents infinite agent debate loops and token burn.
// ============================================================================

import { Message } from '../domain/types.js';

export interface StagnationEvaluationResult {
  isStagnant: boolean;
  stagnantTurns: number;
  action: 'continue' | 'warn' | 'halt_and_escalate';
  warningMessage?: string;
  conflictDossier?: ConflictDossier;
}

export interface ConflictDossier {
  channelId: string;
  participants: string[];
  stagnantTurns: number;
  lastMessagesExcerpt: string[];
  detectedIssue: string;
  recommendedEscalation: 'domain_authority_check' | 'supervisor_arbitration' | 'human_decision_card';
  createdAt: number;
}

export class LoopBreaker {
  private readonly maxStagnantTurns: number = 3;

  /**
   * Evaluates the message stream for unproductive debate loops.
   */
  public evaluateThread(messages: Message[]): StagnationEvaluationResult {
    // Only inspect agent-to-agent exchanges
    const agentMessages = messages.filter((m) => m.senderType === 'agent');

    if (agentMessages.length < 2) {
      return { isStagnant: false, stagnantTurns: 0, action: 'continue' };
    }

    // Count backwards from the latest message to count consecutive turns with productivityScore === 0
    let stagnantCount = 0;
    const participants = new Set<string>();

    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const msg = agentMessages[i];
      if (msg.productivityScore === 0) {
        stagnantCount++;
        participants.add(msg.senderId);
      } else {
        // A productive turn breaks the stagnation counter
        break;
      }
    }

    // Single agent talking to themselves is handled by turn cadence, not peer debate breaker
    if (participants.size < 2 && stagnantCount < this.maxStagnantTurns) {
      return { isStagnant: false, stagnantTurns: stagnantCount, action: 'continue' };
    }

    if (stagnantCount === 2) {
      return {
        isStagnant: true,
        stagnantTurns: 2,
        action: 'warn',
        warningMessage:
          '[KIN STEERING WARNING]: 2 consecutive turns without productive state mutation or empirical verification. Propose a concrete benchmark, test, or prototype rather than repeating claims.',
      };
    }

    if (stagnantCount >= this.maxStagnantTurns) {
      const lastExcerpts = agentMessages
        .slice(-3)
        .map((m) => `${m.senderId}: ${m.content.slice(0, 120)}...`);

      const dossier: ConflictDossier = {
        channelId: agentMessages[0].channelId,
        participants: Array.from(participants),
        stagnantTurns: stagnantCount,
        lastMessagesExcerpt: lastExcerpts,
        detectedIssue: 'Persistent peer debate without empirical progress or state mutation',
        recommendedEscalation: 'domain_authority_check',
        createdAt: Date.now(),
      };

      return {
        isStagnant: true,
        stagnantTurns: stagnantCount,
        action: 'halt_and_escalate',
        conflictDossier: dossier,
      };
    }

    return { isStagnant: false, stagnantTurns: stagnantCount, action: 'continue' };
  }

  /**
   * Evaluates action history for identical repetitive tool calls or repeated failing arguments.
   */
  public evaluateActionRepetition(actions: Array<{ toolName: string; params?: any; error?: string }>): { isLoop: boolean; reason?: string } {
    if (actions.length < 3) return { isLoop: false };
    const recent = actions.slice(-3);

    // 1. Check for 3 consecutive identical failing tool invocations
    if (recent.every((a) => a.toolName === recent[0].toolName && a.error && a.error === recent[0].error)) {
      return {
        isLoop: true,
        reason: `Tool '${recent[0].toolName}' failed 3 consecutive times with identical error: ${recent[0].error}`,
      };
    }

    // 2. Check for 3 consecutive identical calls with identical parameters
    const params0 = JSON.stringify(recent[0].params || {});
    if (recent.every((a) => a.toolName === recent[0].toolName && JSON.stringify(a.params || {}) === params0)) {
      return {
        isLoop: true,
        reason: `Tool '${recent[0].toolName}' was invoked 3 consecutive times with identical parameters without progress.`,
      };
    }

    return { isLoop: false };
  }
}

