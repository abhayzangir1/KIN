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

export interface ContextCompileInput {
  agentDefinition: AgentDefinition;
  agentIdentity: AgentIdentity;
  project?: Project;
  toolSchemas: ToolDefinitionSchema[];
  projectDecisions: Array<{ key: string; decision: string }>;
  compactionSnapshot?: CompactionSnapshot;
  trajectoryMessages: Message[];
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
    const block1 = [
      `You are ${input.agentIdentity.displayName}, an autonomous AI worker in the KIN Operating System.`,
      `Role: ${input.agentDefinition.role}`,
      `Core Responsibilities and Persona:`,
      input.agentDefinition.systemPrompt,
      `Operational Invariants:`,
      `- Do not fabricate task completion: completion strictly requires verifiable test passes or artifacts.`,
      `- Do not delete files outside the project root or jail sandbox.`,
      `- If a debate stalemates for multiple turns, present concrete test evidence rather than repeating arguments.`,
    ].join('\n\n');

    // Block 2: Immutable Tool Schemas (Alphabetically sorted for deterministic caching)
    const sortedTools = [...input.toolSchemas].sort((a, b) => a.name.localeCompare(b.name));
    const block2 = [
      `### AVAILABLE TOOLS SPECIFICATION:`,
      JSON.stringify(sortedTools, null, 2),
    ].join('\n\n');

    // Block 3: Project Grounding Rules and Immutable Decisions
    const decisionsText =
      input.projectDecisions.length > 0
        ? input.projectDecisions.map((d) => `- ${d.key}: ${d.decision}`).join('\n')
        : 'No specific project constraints configured yet.';

    const block3 = [
      `### PROJECT GROUNDING & CONSTRAINTS:`,
      input.project ? `Project: ${input.project.name} (Repo: ${input.project.repoPath})` : 'Standalone Workspace Mode',
      `Authoritative Decisions:`,
      decisionsText,
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
