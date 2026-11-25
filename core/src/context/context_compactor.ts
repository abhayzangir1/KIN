// ============================================================================
// KIN CONTEXT COMPACTOR
// Triggers at 75% context budget; extracts typed JSON operational snapshots
// and masks historical observations to maintain permanent long-running stability.
// ============================================================================

import { Message } from '../domain/types.js';

export interface CompactionSnapshot {
  goalId: string;
  primaryObjective: string;
  completedTasks: Array<{ id: string; title: string; evidenceUri?: string }>;
  activeTask: { id: string; title: string; currentStep?: string };
  modifiedFiles: Array<{ path: string; gitHash?: string }>;
  encounteredErrorsAndResolutions: Array<{ error: string; fixApplied: string }>;
  immutableDecisions: Array<{ key: string; decision: string }>;
  pendingTaskDag: Array<{ id: string; title: string; dependsOn: string[] }>;
  compactedAt: number;
}

export interface CompactionInput {
  messages: Message[];
  currentTokens: number;
  maxTokens: number;
  snapshotState: Omit<CompactionSnapshot, 'compactedAt'>;
  compactionThresholdRatio?: number; // default: 0.75
}

export interface CompactionResult {
  didCompact: boolean;
  compactedMessages: Message[];
  snapshot?: CompactionSnapshot;
  tokensBefore: number;
  tokensAfter: number;
}

export class ContextCompactor {
  private readonly defaultThresholdRatio: number = 0.75;

  /**
   * Evaluates if compaction is needed. If true, produces a structured snapshot
   * and compacts historical turns.
   */
  public evaluateAndCompact(input: CompactionInput): CompactionResult {
    const threshold = input.compactionThresholdRatio ?? this.defaultThresholdRatio;
    const tokenLimit = input.maxTokens * threshold;

    if (input.currentTokens < tokenLimit || input.messages.length <= 4) {
      return {
        didCompact: false,
        compactedMessages: input.messages,
        tokensBefore: input.currentTokens,
        tokensAfter: input.currentTokens,
      };
    }

    const snapshot: CompactionSnapshot = {
      ...input.snapshotState,
      compactedAt: Date.now(),
    };

    // Build the compacted snapshot message
    const snapshotContent = this.formatSnapshot(snapshot);
    const snapshotMessage: Message = {
      id: `snapshot-${snapshot.compactedAt}`,
      channelId: input.messages[0]?.channelId || 'system',
      senderId: 'kin-compactor',
      senderType: 'system',
      content: snapshotContent,
      mentions: [],
      productivityScore: 100,
      createdAt: snapshot.compactedAt,
    };

    // Retain initial goal instruction (first message) and last 2 active messages
    const firstMessage = input.messages[0];
    const recentMessages = input.messages.slice(-2);

    // Apply observation masking to recent messages if they contain verbose tool outputs
    const maskedRecentMessages = recentMessages.map((msg) => this.maskOlderObservations(msg));

    const compactedMessages: Message[] = [
      firstMessage,
      snapshotMessage,
      ...maskedRecentMessages,
    ];

    // Measure actual post-compaction token estimate
    const actualChars = compactedMessages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    const estimatedNewTokens = Math.max(1, Math.ceil(actualChars / 4));

    return {
      didCompact: true,
      compactedMessages,
      snapshot,
      tokensBefore: input.currentTokens,
      tokensAfter: estimatedNewTokens,
    };
  }

  /**
   * Tier-1 zero-LLM-cost microcompaction: strips verbose tool observations older than
   * `preserveRecentTurns` (default 6) when context exceeds 55% of maxTokens.
   */
  public microcompact(messages: Message[], maxTokens: number, currentTokens: number, preserveRecentTurns: number = 6): { didMicrocompact: boolean; messages: Message[]; tokensAfter: number } {
    if (currentTokens < maxTokens * 0.55 || messages.length <= preserveRecentTurns + 1) {
      return { didMicrocompact: false, messages, tokensAfter: currentTokens };
    }
    const cutoffIdx = messages.length - preserveRecentTurns;
    let changed = false;
    const result = messages.map((msg, idx) => {
      if (idx === 0 || idx >= cutoffIdx) return msg;
      const masked = this.maskOlderObservations(msg);
      if (masked.content !== msg.content) {
        changed = true;
        return masked;
      }
      if (msg.content.length > 1200 && msg.content.includes('<observation')) {
        changed = true;
        return {
          ...msg,
          content: `[Microcompacted earlier observation (${msg.content.length} chars) to preserve context budget]`,
        };
      }
      return msg;
    });
    const tokensAfter = Math.max(1, Math.ceil(result.reduce((a, m) => a + (m.content?.length || 0), 0) / 4));
    return { didMicrocompact: changed, messages: result, tokensAfter };
  }

  public maskOlderObservations(message: Message): Message {
    if (message.senderType !== 'system' && message.senderType !== 'agent' && message.senderType !== 'human') {
      return message;
    }

    // Mask out inline logs that have spill references (supports both [Command: ...] and [Tool Output])
    let updatedContent = message.content;
    const spillRegex = /\[(Command: ([^\]]+)|Tool Output)\]\s+([\s\S]*?)\s+\[Full raw output \((\d+) bytes\) persisted at: (file:\/\/\/[^\s.\]]+)[^\]]*\]/g;

    updatedContent = updatedContent.replace(spillRegex, (_match, _header, cmd, _preview, bytes, uri) => {
      const label = cmd || 'Tool Output';
      return `[Tool Observation: ${label} executed (${bytes} bytes). Stored on disk at: ${uri}]`;
    });

    return {
      ...message,
      content: updatedContent,
    };
  }

  public formatSnapshot(snapshot: CompactionSnapshot): string {
    return [
      `### [SYSTEM COMPACTION SNAPSHOT — Working State at ${new Date(snapshot.compactedAt).toISOString()}]`,
      `**Goal**: ${snapshot.primaryObjective} (ID: ${snapshot.goalId})`,
      `**Active Task**: ${snapshot.activeTask.title} (${snapshot.activeTask.id}) ${snapshot.activeTask.currentStep ? `| Step: ${snapshot.activeTask.currentStep}` : ''}`,
      `**Completed Tasks**:`,
      snapshot.completedTasks.length > 0
        ? snapshot.completedTasks.map((t) => ` - [x] ${t.title} (ID: ${t.id})${t.evidenceUri ? ` [Evidence: ${t.evidenceUri}]` : ''}`).join('\n')
        : ` - None yet`,
      `**Files Modified**:`,
      snapshot.modifiedFiles.length > 0
        ? snapshot.modifiedFiles.map((f) => ` - \`${f.path}\`${f.gitHash ? ` (commit: ${f.gitHash})` : ''}`).join('\n')
        : ` - None yet`,
      `**Encountered Errors & Resolutions**:`,
      snapshot.encounteredErrorsAndResolutions.length > 0
        ? snapshot.encounteredErrorsAndResolutions.map((e) => ` - Error: ${e.error} => Resolution: ${e.fixApplied}`).join('\n')
        : ` - None`,
      `**Decisions**:`,
      snapshot.immutableDecisions.length > 0
        ? snapshot.immutableDecisions.map((d) => ` - ${d.key}: ${d.decision}`).join('\n')
        : ` - Standard project conventions`,
      `**Pending Tasks**:`,
      snapshot.pendingTaskDag.length > 0
        ? snapshot.pendingTaskDag.map((p) => ` - [ ] ${p.title} (Depends on: ${p.dependsOn.join(', ') || 'None'})`).join('\n')
        : ` - None remaining`,
    ].join('\n\n');
  }
}
