// ============================================================================
// KIN CONTEXT COMPILER
// Strict 5-block prompt assembly ensuring 90%+ KV cache hit rates on modern providers.
// Dynamic variables are strictly isolated to Block 5.
// ============================================================================

import {
  AgentDefinition,
  AgentIdentity,
  Message,
  Project,
  ChannelType,
  Tier1ProjectMemory,
  Tier2ChannelMemory,
  Tier3PrivateMemory,
  Tier4DirectMessageMemory,
} from '../domain/types.js';
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

export interface ProjectRosterMember {
  id: string;
  displayName: string;
  role: string;
  domainAuthority?: string;
  activeTask?: string;
  status?: string;
  channelIds?: string[];
}

export interface ChannelRosterInfo {
  channelId: string;
  channelName: string;
  topic?: string;
  members: string[];
}

export interface ContextCompileInput {
  agentDefinition: AgentDefinition;
  agentIdentity: AgentIdentity;
  project?: Project;
  toolSchemas: ToolDefinitionSchema[];
  projectDecisions: Array<{ key: string; decision: string }>;
  compactionSnapshot?: CompactionSnapshot;
  trajectoryMessages: Message[];
  activeChannel?: { id: string; name: string; topic?: string; isPrivate?: boolean; channelType?: ChannelType; participantIds?: string[] };
  channelPeers?: string[];
  assignedChannels?: string[];
  projectAgents?: string[];
  projectRoster?: ProjectRosterMember[];
  otherAssignedChannelRosters?: ChannelRosterInfo[];
  crossChannelSummaries?: CrossChannelSummary[];
  scopedMemories?: Tier1ProjectMemory[];
  projectMemories?: Tier1ProjectMemory[];
  channelMemories?: Tier2ChannelMemory[];
  assignedDepartmentMemories?: Array<{ channelId?: string; channelName: string; memories: Tier2ChannelMemory[] }>;
  agentPrivateMemories?: Tier3PrivateMemory[];
  dmContext?: Tier4DirectMessageMemory;
  goalAncestry?: GoalAncestryChain;
  reportingLine?: { manager?: string; subordinates?: string[] };
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
      `You are ${input.agentIdentity.displayName}, an autonomous AI specialist in the KIN Autonomous Workforce Platform.`,
      `Role: ${input.agentDefinition.role}`,
      `Core Responsibilities and Persona:`,
      input.agentDefinition.systemPrompt,
      `Operational Invariants:`,
      `- Do not fabricate task completion: completion strictly requires verifiable test passes or artifacts.`,
      `- Do not delete files outside the project root or jail sandbox.`,
      `- If a debate stalemates for multiple turns, present concrete test evidence rather than repeating arguments.`,
      `- Dynamic Workforce & Team Delegation: You have full access to the 'hireSpecialist' tool. When the operator or mission calls for creating a team or delegating to specialized roles (e.g., Android engineering, QA, Frontend, Backend, Database), use the 'hireSpecialist' tool to onboard specialized agents directly into this project and channel. Both orchestrators and specialists can hire subagents under them as required.`,
      `- Channel Staffing & Coworker Assignment Invariant: Every new channel starts with only the Lead Orchestrator (@Boss). When the operator asks to staff a channel or requests a specialist (e.g. for coding, QA, design, frontend), you have two distinct options: Option 1 (Call Existing Coworker): If a coworker with that expertise already works in another department/channel of this project, use the 'assignCoworker' tool to bring them into this channel (they retain their identity and shared memory across departments). Option 2 (Hire New Specialist): You can hire a brand-new specialist dedicated to this channel using the 'hireSpecialist' tool.`,
      `- Direct Messaging Invariant: When the human operator asks you to message them in DM (e.g. "message me in DM", "DM me"), call the 'sendDirectMessage' tool with recipient="user" or "human" to message them directly. To message a coworker agent privately, call 'sendDirectMessage' with their name or ID.`,
      `- Channel Messaging Invariant: When asked to post a message, announcement, or greeting into a channel (e.g. "say hi in #general", "post update in #qa"), call the 'channel_post' tool with the target channel name and message.`,
      `- Meeting Convening Invariant: When asked to convene or hold a meeting (e.g. "held a meeting about X", "call a meeting on Y"), call the 'callMeeting' tool with the topic, agenda, and invited participant coworker agents.`,
      `- Team & Role Awareness: You are part of an organizational workforce. Refer to the Project Workforce Roster below to know who is responsible for each domain (frontend, backend, QA, database, architecture, etc.) and what tasks they are handling. When asked who is working on a domain, identify the respective coworker accurately.`,
      `- Conversational Memory Invariant: You have full access to the conversational history provided in the messages. When asked about earlier questions, statements, or events from this chat, refer directly to the prior turns in the conversation transcript rather than claiming you have no memory.`,
      `- Project Inspection & Codebase Grounding: You are working inside the repository at '${input.project?.repoPath || '.'}'. When the operator asks about the project architecture, features, codebase, documentation, or implementation, do NOT claim you lack context. Proactively use 'readFile' (e.g. 'README.md', 'docs/ARCHITECTURE.md') or 'listDirectory' to inspect the project repository directly.`,
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

    const reportingLines: string[] = [];
    if (input.reportingLine?.manager) {
      reportingLines.push(`- Reporting Line / Manager: ${input.reportingLine.manager}`);
    } else if (input.agentIdentity.parentAgentId) {
      reportingLines.push(`- Reporting Line / Manager: ${input.agentIdentity.parentAgentId}`);
    } else if (input.agentIdentity.isOrchestrator) {
      reportingLines.push(`- Reporting Line / Manager: None (Project Orchestrator / Lead)`);
    }
    if (input.reportingLine?.subordinates && input.reportingLine.subordinates.length > 0) {
      reportingLines.push(`- Direct Reports / Subordinates: ${input.reportingLine.subordinates.join(', ')}`);
    }

    if (input.activeChannel) {
      let channelLabel = input.activeChannel.isPrivate
        ? `Direct Message thread with Human`
        : `#${input.activeChannel.name}${input.activeChannel.topic ? ` (${input.activeChannel.topic})` : ''}`;

      if (input.dmContext?.isDirectMessage || input.activeChannel.channelType === 'direct_message') {
        const participantList = input.dmContext?.participants?.length
          ? input.dmContext.participants.join(', ')
          : (input.channelPeers && input.channelPeers.length > 0 ? `${input.agentIdentity.displayName}, ${input.channelPeers.join(', ')}` : 'Participants');
        channelLabel = `Direct Message thread (${participantList})`;
      }

      const channelRoster = [
        input.agentIdentity.displayName,
        ...(input.channelPeers && input.channelPeers.length > 0 ? input.channelPeers : []),
      ];
      const isDirectMessage = Boolean(input.dmContext?.isDirectMessage || input.activeChannel.isPrivate || input.activeChannel.channelType === 'direct_message');

      const orgContextLines = [
        `[ORGANIZATIONAL CONTEXT]`,
        `- Active Channel: ${channelLabel} (Context: ${isDirectMessage ? 'Private Direct Message' : 'Department Workspace Channel'})`,
        `- Active Channel Member Roster: ${channelRoster.join(', ')}`,
        ...(reportingLines.length > 0 ? reportingLines : []),
        `Active Channel Context:`,
        `- Current Channel / Context: ${channelLabel}`,
        `- Peers in this channel: ${input.channelPeers && input.channelPeers.length > 0 ? input.channelPeers.join(', ') : 'Solo'}`,
        `- Channels you are assigned to: ${input.assignedChannels && input.assignedChannels.length > 0 ? input.assignedChannels.join(', ') : 'None'}`,
        `- All Agents in this project: ${input.projectAgents && input.projectAgents.length > 0 ? input.projectAgents.join(', ') : input.agentIdentity.displayName}`,
      ];

      if (isDirectMessage && input.dmContext?.originChannel) {
        const orig = input.dmContext.originChannel;
        orgContextLines.push(
          `- Direct Message Origin Channel: #${orig.name.replace(/^#/, '')} (Members in origin channel: ${orig.members.join(', ')})`,
          `- Origin Channel Invariant: You were asked to message the operator in this DM from #${orig.name.replace(/^#/, '')}. When the operator asks in this DM "which channel did I ask you to DM me from?" or "who is working in that channel?" or "do you know what agents are working here?", explain that this private direct message is strictly 1-on-1 between you and the operator, and that in #${orig.name.replace(/^#/, '')} the assigned members are: ${orig.members.join(', ')}.`
        );
      } else {
        orgContextLines.push(
          `- Workforce Invariant: When asked "who is working here?" or "who is on the team in this channel?", answer strictly according to the active channel member roster (${channelRoster.join(', ')}).`
        );
      }

      block1Parts.push(orgContextLines.join('\n'));
    } else if (reportingLines.length > 0) {
      block1Parts.push(
        `[ORGANIZATIONAL CONTEXT]`,
        ...reportingLines
      );
    }

    if (input.projectRoster && input.projectRoster.length > 0) {
      const rosterLines = input.projectRoster.map((m) =>
        `- ${m.displayName} (${m.role}): Domain: ${m.domainAuthority || 'General'}, Status: ${m.status || 'Active'}${m.activeTask ? `, Current Task: "${m.activeTask}"` : ''}`
      );
      block1Parts.push(
        `[PROJECT WORKFORCE ROSTER & RESPONSIBILITIES]`,
        rosterLines.join('\n')
      );
    }

    if (input.otherAssignedChannelRosters && input.otherAssignedChannelRosters.length > 0) {
      const otherRosterLines = input.otherAssignedChannelRosters.map((c) =>
        `- #${c.channelName.replace(/^#/, '')}${c.topic ? ` (${c.topic})` : ''}: Members: ${c.members.join(', ')}`
      );
      block1Parts.push(
        `[OTHER ASSIGNED DEPARTMENTS & ROSTERS]`,
        otherRosterLines.join('\n')
      );
    }

    const block1 = block1Parts.join('\n\n');

    // Block 2: Immutable Tool Schemas (Alphabetically sorted for deterministic caching)
    const sortedTools = [...input.toolSchemas].sort((a, b) => a.name.localeCompare(b.name));
    const conciseToolList = sortedTools.map((t) => {
      const paramsObj = (t.parameters as any) || {};
      const propNames = paramsObj.properties ? Object.keys(paramsObj.properties).join(', ') : '';
      const req = Array.isArray(paramsObj.required) && paramsObj.required.length > 0 ? ` [required: ${paramsObj.required.join(', ')}]` : '';
      const shortDesc = t.description ? t.description.split('.')[0] : '';
      return `- ${t.name}(${propNames}): ${shortDesc}.${req}`;
    }).join('\n');
    const block2 = [
      `### AVAILABLE TOOLS SPECIFICATION:`,
      conciseToolList,
    ].join('\n\n');

    // Block 3: 4-Tier Memory Hierarchy & Grounding Rules
    const decisionsText =
      input.projectDecisions.length > 0
        ? input.projectDecisions.slice(0, 50).map((d) => {
            const safeKey = String(d.key || '').slice(0, 256).replace(/[\r\n]/g, ' ');
            let rawVal = String(d.decision || '');
            if (rawVal.length > 2000) {
              rawVal = rawVal.slice(0, 2000) + '... [truncated]';
            }
            const safeVal = rawVal
              .replace(/###\s+/g, '## ')
              .replace(/<(tool_call|tool|function_call)>/gi, '&lt;$1&gt;')
              .replace(/\[(SYSTEM|DEVELOPER|INSTRUCTION)\]/gi, '[$1-CONTEXT]');
            return `- ${safeKey}: ${safeVal}`;
          }).join('\n')
        : 'No specific project constraints configured yet.';

    const formatMemoryList = (mems?: Array<{ key: string; type: string; value: unknown }>) => {
      if (!mems || mems.length === 0) return 'None recorded.';
      return mems.slice(0, 50).map((m) => {
        const safeType = String(m.type || 'memory').slice(0, 32).replace(/[\r\n]/g, ' ');
        const safeKey = String(m.key || '').slice(0, 256).replace(/[\r\n]/g, ' ');
        let rawVal = typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value ?? '');
        if (rawVal.length > 2000) {
          rawVal = rawVal.slice(0, 2000) + '... [truncated]';
        }
        const safeVal = rawVal
          .replace(/###\s+/g, '## ')
          .replace(/<(tool_call|tool|function_call)>/gi, '&lt;$1&gt;')
          .replace(/\[(SYSTEM|DEVELOPER|INSTRUCTION)\]/gi, '[$1-CONTEXT]');
        return `- [${safeType}] ${safeKey}: ${safeVal}`;
      }).join('\n');
    };

    const effectiveProjectMemories = (input.projectMemories && input.projectMemories.length > 0)
      ? input.projectMemories
      : (input.scopedMemories || []);

    const tier2Sections: string[] = [
      `### TIER 2: CONVERSATION & CHANNEL-SCOPED CONTEXT:`,
      `Channel Working Memory:\n${formatMemoryList(input.channelMemories)}`,
    ];

    const departmentMems = input.assignedDepartmentMemories || (input as any).departmentMemories;
    if (Array.isArray(departmentMems) && departmentMems.length > 0) {
      for (const dept of departmentMems) {
        if (dept.memories && dept.memories.length > 0) {
          const deptName = dept.channelName ? (dept.channelName.startsWith('#') ? dept.channelName : `#${dept.channelName}`) : 'Department';
          tier2Sections.push(`Other Assigned Department (${deptName}) Structured Memory:\n${formatMemoryList(dept.memories)}`);
        }
      }
    }

    const block3Sections = [
      `### TIER 1: PROJECT-SHARED GROUNDING & KNOWLEDGE:`,
      input.project ? `Project: ${input.project.name} (Repo: ${input.project.repoPath})` : 'Standalone Workspace Mode',
      `Authoritative Decisions:\n${decisionsText}`,
      `Project Knowledge Base:\n${formatMemoryList(effectiveProjectMemories)}`,
      ...tier2Sections,
      `### TIER 3: AGENT-PRIVATE MEMORY (Confidential to ${input.agentIdentity.displayName}):`,
      `Personal Reflections & Working State:\n${formatMemoryList(input.agentPrivateMemories)}`,
    ];

    if (input.dmContext?.isDirectMessage) {
      block3Sections.push(
        `### TIER 4: PRIVATE DIRECT MESSAGE ISOLATION:`,
        `Privacy Invariant: This conversation is strictly confidential between the participating members (${input.dmContext.participants.join(', ')}). Its contents and transcript are completely excluded from cross-channel summaries and non-member agents.`
      );
    }

    const block3 = block3Sections.join('\n\n');

    // Block 4: Compaction Snapshot & Cross-Channel Operational Memory (Preserves Blocks 1-3 prefix-cache stability)
    const block4Parts: string[] = [];
    if (input.compactionSnapshot) {
      block4Parts.push(
        [
          `### ACTIVE COMPACTION SNAPSHOT (Prior Progress):`,
          `Goal: ${input.compactionSnapshot.primaryObjective}`,
          `Active Task: ${input.compactionSnapshot.activeTask.title}`,
          `Completed: ${input.compactionSnapshot.completedTasks.map((t) => t.title).join(', ') || 'None'}`,
          `Modified Files: ${input.compactionSnapshot.modifiedFiles.map((f) => f.path).join(', ') || 'None'}`,
        ].join('\n\n')
      );
    }

    if (input.crossChannelSummaries && input.crossChannelSummaries.length > 0) {
      const channelLabel = input.activeChannel
        ? (input.activeChannel.name.startsWith('#') ? input.activeChannel.name : `#${input.activeChannel.name}`)
        : 'active channel';
      const summariesText = input.crossChannelSummaries.map((s) => {
        const header = `- Channel #${s.channelName.replace(/^#/, '')}${s.topic ? ` (${s.topic})` : ''}:`;
        const msgs = s.recentMessages && s.recentMessages.length > 0
          ? s.recentMessages.map((m) => `  • [${m.senderName}]: ${m.content}`).join('\n')
          : '  • (No recent messages)';
        return `${header}\n${msgs}`;
      }).join('\n');

      block4Parts.push(
        [
          `Cross-Channel Operational Memory:`,
          `You have active assignments across multiple channels in this project. You retain memory and context of discussions from your other assigned channels:`,
          summariesText,
          `Channel Scoping Rule: Use knowledge from your other assigned channels to inform your work, but execute and respond specifically for the current active channel (${channelLabel}).`,
        ].join('\n\n')
      );
    }

    const block4 = block4Parts.length > 0 ? block4Parts.join('\n\n---\n\n') : undefined;

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
