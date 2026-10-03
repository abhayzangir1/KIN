// ============================================================================
// KIN CONTEXT COMPILER
// Strict 5-block prompt assembly ensuring 90%+ KV cache hit rates on modern providers.
// Dynamic variables are strictly isolated to Block 5.
// ============================================================================

import { AgentDefinition, AgentIdentity, Message, Project } from '../domain/types.js';
import { CompactionSnapshot } from './context_compactor.js';

export interface ToolDefinitionSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CrossChannelSummary {
  channelName: string;
  topic?: string;
  recentMessages: Array<{ senderName: string; content: string }>;
}

export interface GoalAncestryChain {
  workspaceName?: string;
  projectName?: string;
  repoPath?: string;
  goalTitle?: string;
  goalDescription?: string;
  acceptanceCriteria?: string[];
  taskTitle?: string;
  taskDescription?: string;
  parentRunId?: string;
  rootGoalTitle?: string;
  parentGoalTitle?: string;
  activeGoalTitle?: string;
  successCriteria?: string[];
  rationale?: string;
}

export interface ContextCompileInput {
  agentDefinition: AgentDefinition;
  agentIdentity: AgentIdentity;
  project?: Project;
  toolSchemas: ToolDefinitionSchema[];
  projectDecisions: Array<{ key: string; decision: string }>;
  compactionSnapshot?: CompactionSnapshot;
  trajectoryMessages: Message[];
  activeChannel?: { id: string; name: string; topic?: string; isPrivate?: boolean };
  channelPeers?: string[];
  assignedChannels?: string[];
  projectAgents?: string[];
  crossChannelSummaries?: CrossChannelSummary[];
  scopedMemories?: Array<{ key: string; type: string; value: unknown }>;
  goalAncestry?: GoalAncestryChain;
}

export interface CompiledContextBlocks {
  systemPromptBlock: string;       // Block 1 (Cacheable)
  toolSchemasBlock: string;        // Block 2 (Cacheable)
  projectGroundingBlock: string;   // Block 3 (Cacheable)
  compactionBlock?: string;        // Block 4 (Semi-stable)
  dynamicTrajectoryBlock: Message[]; // Block 5 (Dynamic)
  fullAssembledPrompt: string;
}

export class ContextCompiler {
  /**
   * Assembles the context blocks in strict prefix-stable order.
   */
  public compile(input: ContextCompileInput): CompiledContextBlocks {
    // Block 1: Immutable Base System Prompt
    const block1Parts = [
      `You are ${input.agentIdentity.displayName}, an autonomous AI worker in the KIN Operating System.`,
      `Role: ${input.agentDefinition.role}`,
      `Core Responsibilities and Persona:`,
      input.agentDefinition.systemPrompt,
      `Operational Invariants:`,
      `- Do not fabricate task completion: completion strictly requires verifiable test passes or artifacts.`,
      `- Do not delete files outside the project root or jail sandbox.`,
      `- If a debate stalemates for multiple turns, present concrete test evidence rather than repeating arguments.`,
    ];

    if (input.goalAncestry) {
      const ga = input.goalAncestry;
      const ancestryLines = [
        `### STRATEGIC GOAL ANCESTRY & OBJECTIVE ANCHOR:`,
        ga.workspaceName ? `- Workspace: ${ga.workspaceName}` : null,
        ga.projectName ? `- Project: ${ga.projectName}${ga.repoPath ? ` (${ga.repoPath})` : ''}` : null,
        ga.rootGoalTitle ? `- Root Goal: ${ga.rootGoalTitle}` : (ga.goalTitle ? `- Overarching Goal: "${ga.goalTitle}"` : null),
        ga.parentGoalTitle ? `- Parent Goal: ${ga.parentGoalTitle}` : null,
        ga.activeGoalTitle ? `- Active Objective: ${ga.activeGoalTitle}` : (ga.taskTitle ? `- Current Active Task: "${ga.taskTitle}"` : null),
        ga.taskDescription ? `- Task Objective: "${ga.taskDescription}"` : null,
        ga.rationale || ga.goalDescription ? `- Rationale: "${ga.rationale || ga.goalDescription}"` : null,
        (ga.successCriteria || ga.acceptanceCriteria)?.length ? `- Success Criteria: ${(ga.successCriteria || ga.acceptanceCriteria)!.join('; ')}` : null,
        ga.parentRunId ? `- Parent Run ID: ${ga.parentRunId}` : null,
      ].filter(Boolean) as string[];

      block1Parts.push(ancestryLines.join('\n'));
    }

    if (input.activeChannel) {
      const channelLabel = input.activeChannel.isPrivate
        ? `Direct Message thread with Human`
        : `#${input.activeChannel.name}${input.activeChannel.topic ? ` (${input.activeChannel.topic})` : ''}`;
      block1Parts.push(
        `Active Channel Context:`,
        `- Current Channel / Context: ${channelLabel}`,
        `- Peers in this channel: ${input.channelPeers && input.channelPeers.length > 0 ? input.channelPeers.join(', ') : 'Solo'}`,
        `- Channels you are assigned to: ${input.assignedChannels && input.assignedChannels.length > 0 ? input.assignedChannels.join(', ') : 'None'}`,
        `- All Agents in this project: ${input.projectAgents && input.projectAgents.length > 0 ? input.projectAgents.join(', ') : input.agentIdentity.displayName}`
      );

      if (input.crossChannelSummaries && input.crossChannelSummaries.length > 0) {
        const summariesText = input.crossChannelSummaries.map((s) => {
          const header = `- Channel #${s.channelName}${s.topic ? ` (${s.topic})` : ''}:`;
          const msgs = s.recentMessages && s.recentMessages.length > 0
            ? s.recentMessages.map((m) => `  • [${m.senderName}]: ${m.content}`).join('\n')
            : '  • (No recent messages)';
          return `${header}\n${msgs}`;
        }).join('\n');

        block1Parts.push(
          `Cross-Channel Operational Memory:`,
          `You have active assignments across multiple channels in this project. You retain memory and context of discussions from your other assigned channels:`,
          summariesText,
          `Channel Scoping Rule: Use knowledge from your other assigned channels to inform your work, but execute and respond specifically for the current active channel (${channelLabel}).`
        );
      }
    }

    const block1 = block1Parts.join('\n\n');

    // Block 2: Immutable Tool Schemas (Alphabetically sorted for deterministic caching)
    const sortedTools = [...input.toolSchemas].sort((a, b) => a.name.localeCompare(b.name));
    const block2 = [
      `### AVAILABLE TOOLS SPECIFICATION:`,
      JSON.stringify(sortedTools, null, 2),
    ].join('\n\n');

    // Block 3: Project Grounding Rules, Immutable Decisions & Persistent Memories
    const decisionsText =
      input.projectDecisions.length > 0
        ? input.projectDecisions.map((d) => `- ${d.key}: ${d.decision}`).join('\n')
        : 'No specific project constraints configured yet.';

    const memoriesText =
      input.scopedMemories && input.scopedMemories.length > 0
        ? input.scopedMemories.map((m) => `- [${m.type}] ${m.key}: ${typeof m.value === 'object' ? JSON.stringify(m.value) : m.value}`).join('\n')
        : 'No scoped memories recorded.';

    const block3 = [
      `### PROJECT GROUNDING & CONSTRAINTS:`,
      input.project ? `Project: ${input.project.name} (Repo: ${input.project.repoPath})` : 'Standalone Workspace Mode',
      `Authoritative Decisions:`,
      decisionsText,
      `Persistent Scoped Memories:`,
      memoriesText,
    ].join('\n\n');

    // Block 4: Compaction Snapshot (if present)
    let block4: string | undefined;
    if (input.compactionSnapshot) {
      block4 = [
        `### ACTIVE COMPACTION SNAPSHOT (Prior Progress):`,
        `Goal: ${input.compactionSnapshot.primaryObjective}`,
        `Active Task: ${input.compactionSnapshot.activeTask.title}`,
        `Completed: ${input.compactionSnapshot.completedTasks.map((t) => t.title).join(', ') || 'None'}`,
        `Modified Files: ${input.compactionSnapshot.modifiedFiles.map((f) => f.path).join(', ') || 'None'}`,
      ].join('\n\n');
    }

    // Assemble full prompt text for single-turn or system instructions
    const fullAssembled = [
      block1,
      '---',
      block2,
      '---',
      block3,
      block4 ? `---\n${block4}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      systemPromptBlock: block1,
      toolSchemasBlock: block2,
      projectGroundingBlock: block3,
      compactionBlock: block4,
      dynamicTrajectoryBlock: input.trajectoryMessages,
      fullAssembledPrompt: fullAssembled,
    };
  }
}
