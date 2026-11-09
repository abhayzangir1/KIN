// ============================================================================
// KIN LOOP & DEBATE STAGNATION BREAKER
// 3-turn dynamic early-stopping protocol (ColMAD / CONSENSAGENT standard).
// Prevents infinite agent debate loops, ping-pong repetition, and token burn.
// ============================================================================

import * as crypto from 'node:crypto';
import { Message } from '../domain/types.js';

export interface StagnationEvaluationResult {
  isStagnant: boolean;
  stagnantTurns: number;
  action: 'continue' | 'warn' | 'halt_and_escalate';
  suggestedThrottleMs?: number;
  isPingPong?: boolean;
  isVelocityBreach?: boolean;
  contentHashes?: string[];
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
  contentHashes?: string[];
  createdAt: number;
}

/**
 * Generates a SHA-256 normalized content hash for shingle deduplication
 * and semantic loop detection.
 */
export function calculateMessageHash(content: string): string {
  if (!content) return crypto.createHash('sha256').update('').digest('hex');
  const normalized = content
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export class LoopBreaker {
  private readonly maxStagnantTurns: number = 3;
  private readonly velocityWindowMs: number = 30000;
  private readonly velocityTurnLimit: number = 4;

  public calculateMessageHash(content: string): string {
    return calculateMessageHash(content);
  }

  /**
   * Evaluates the message stream for unproductive debate loops,
   * alternating ping-pong storms, and rapid turn velocity.
   */
  public evaluateThread(messages: Message[]): StagnationEvaluationResult {
    const agentMessages = messages.filter((m) => m.senderType === 'agent');

    if (agentMessages.length < 2) {
      return {
        isStagnant: false,
        stagnantTurns: 0,
        action: 'continue',
        suggestedThrottleMs: 0,
      };
    }

    // 1. Sliding window velocity check: flag if > 4 peer agent turns occur within 30s without human input
    const now = Date.now();
    const recent30sAgentMessages = agentMessages.filter(
      (m) => (m.createdAt || now) >= now - this.velocityWindowMs
    );
    const lastHumanIndex = messages.map((m) => m.senderType).lastIndexOf('human');
    const agentTurnsSinceHuman = lastHumanIndex >= 0 ? messages.length - 1 - lastHumanIndex : messages.length;
    const isVelocityBreach =
      recent30sAgentMessages.length > this.velocityTurnLimit && agentTurnsSinceHuman > this.velocityTurnLimit;

    // 2. Compute normalized content hashes for recent agent turns
    const recentAgentMsgs = agentMessages.slice(-6);
    const contentHashes = recentAgentMsgs.map((m) => this.calculateMessageHash(m.content));

    // 3. Ping-Pong Detector: track alternating sender pairs (A, B, A, B)
    let isPingPong = false;
    if (recentAgentMsgs.length >= 4) {
      const s0 = recentAgentMsgs[recentAgentMsgs.length - 4].senderId;
      const s1 = recentAgentMsgs[recentAgentMsgs.length - 3].senderId;
      const s2 = recentAgentMsgs[recentAgentMsgs.length - 2].senderId;
      const s3 = recentAgentMsgs[recentAgentMsgs.length - 1].senderId;

      if (s0 !== s1 && s0 === s2 && s1 === s3) {
        // Alternating senders detected; check for content hash collision or low productivity
        const h0 = contentHashes[contentHashes.length - 4];
        const h2 = contentHashes[contentHashes.length - 2];
        const h1 = contentHashes[contentHashes.length - 3];
        const h3 = contentHashes[contentHashes.length - 1];

        if (h0 === h2 || h1 === h3 || (recentAgentMsgs[recentAgentMsgs.length - 1].productivityScore === 0 && recentAgentMsgs[recentAgentMsgs.length - 2].productivityScore === 0)) {
          isPingPong = true;
        }
      }
    }

    // 4. Stagnation turn counting: count consecutive turns with productivityScore === 0
    let stagnantCount = 0;
    const participants = new Set<string>();

    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const msg = agentMessages[i];
      if (msg.productivityScore === 0) {
        stagnantCount++;
        participants.add(msg.senderId);
      } else {
        break;
      }
    }

    // If ping-pong with repeated content detected, elevate stagnant turns
    if (isPingPong && stagnantCount < 2) {
      stagnantCount = 2;
    }

    // Single agent talking to themselves is handled by turn cadence
    if (participants.size < 2 && stagnantCount < this.maxStagnantTurns && !isVelocityBreach) {
      return {
        isStagnant: false,
        stagnantTurns: stagnantCount,
        action: 'continue',
        suggestedThrottleMs: 0,
        isPingPong,
        contentHashes,
      };
    }

    // Progressive throttling:
    // Turn 1: 0ms
    // Turn 2: 2500ms warning
    // Turn 3: Halt and escalate
    if (stagnantCount === 2 || isVelocityBreach) {
      const warning = isVelocityBreach
        ? `[KIN VELOCITY WARNING]: Over ${this.velocityTurnLimit} consecutive peer agent turns in 30s without human response. Applying 2500ms safety throttle.`
        : isPingPong
        ? '[KIN PING-PONG WARNING]: Alternating repetitive agent debate detected. Propose concrete changes or tests rather than circular discussions.'
        : '[KIN STEERING WARNING]: 2 consecutive turns without productive state mutation or empirical verification. Propose a concrete benchmark, test, or prototype rather than repeating claims.';

      return {
        isStagnant: true,
        stagnantTurns: stagnantCount,
        action: 'warn',
        suggestedThrottleMs: 2500,
        isPingPong,
        isVelocityBreach,
        contentHashes,
        warningMessage: warning,
      };
    }

    if (stagnantCount >= this.maxStagnantTurns) {
      const lastExcerpts = agentMessages
        .slice(-3)
        .map((m) => `${m.senderId}: ${m.content.slice(0, 120)}...`);

      const dossier: ConflictDossier = {
        channelId: agentMessages[0]?.channelId || 'chan-general',
        participants: Array.from(participants),
        stagnantTurns: stagnantCount,
        lastMessagesExcerpt: lastExcerpts,
        detectedIssue: isPingPong
          ? 'Persistent alternating ping-pong debate without empirical progress or state mutation'
          : 'Persistent peer debate without empirical progress or state mutation',
        recommendedEscalation: 'domain_authority_check',
        contentHashes: contentHashes.slice(-3),
        createdAt: Date.now(),
      };

      return {
        isStagnant: true,
        stagnantTurns: stagnantCount,
        action: 'halt_and_escalate',
        suggestedThrottleMs: 5000,
        isPingPong,
        isVelocityBreach,
        contentHashes,
        conflictDossier: dossier,
      };
    }

    return {
      isStagnant: false,
      stagnantTurns: stagnantCount,
      action: 'continue',
      suggestedThrottleMs: 0,
      isPingPong,
      isVelocityBreach,
      contentHashes,
    };
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
