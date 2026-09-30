// ============================================================================
// KIN CORE — DOMAIN ENTITY CONTRACTS
// Strictly typed domain model aligned with authoritative SQLite schema.
// ============================================================================

export type AutonomyMode = 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS';

export type RunState =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting_for_tool'
  | 'waiting_for_approval'
  | 'waiting_for_agent'
  | 'waiting_for_model'
  | 'recovering'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'assigned'
  | 'running'
  | 'blocked'
  | 'review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GoalStatus = 'draft' | 'active' | 'completed' | 'failed' | 'cancelled';
export type DecisionStatus = 'proposed' | 'authoritative' | 'superseded' | 'rejected';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SenderType = 'human' | 'agent' | 'system';
export type MemoryScope = 'global' | 'workspace' | 'project' | 'team' | 'channel' | 'agent_private' | 'task';
export type MemoryType = 'semantic' | 'episodic' | 'procedural' | 'decision' | 'preference' | 'working_state';

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  defaultAutonomyMode: AutonomyMode;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  repoPath: string;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  defaultModelId: string;
  domainAuthority: string[];
  capabilities: string[];
  createdAt: number;
}

export interface AgentIdentity {
  id: string;
  workspaceId: string;
  definitionId: string;
  displayName: string;
  avatarUrl?: string;
  activeModelId: string;
  fallbackModelId?: string;
  isOrchestrator: boolean;
  isEphemeral: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  projectId?: string;
  parentRunId?: string;
  taskId?: string;
  state: RunState;
  worktreePath?: string;
  heartbeatAt: number;
  allocatedTokens: number;
  usedTokens: number;
  createdAt: number;
  completedAt?: number;
}

export interface Channel {
  id: string;
  projectId: string;
  name: string;
  topic?: string;
  isPrivate: boolean;
  createdAt: number;
}

export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  senderType: SenderType;
  content: string;
  parentMessageId?: string;
  mentions: string[];
  productivityScore: number;
  createdAt: number;
}

export interface Goal {
  id: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
}

export interface VerificationSpec {
  command?: string;
  expectedExitCode?: number;
  expectedArtifactType?: string;
}

export interface Task {
  id: string;
  goalId: string;
  title: string;
  description: string;
  assignedAgentId?: string;
  status: TaskStatus;
  verificationSpec: VerificationSpec;
  evidenceBundleId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Decision {
  id: string;
  projectId: string;
  taskId?: string;
  decidedById: string;
  title: string;
  rationale: string;
  alternativesConsidered: string[];
  status: DecisionStatus;
  createdAt: number;
}

export interface Evidence {
  id: string;
  taskId: string;
  runId: string;
  type: 'test_output' | 'build_log' | 'artifact_hash' | 'human_signoff';
  contentUri: string;
  verified: boolean;
  createdAt: number;
}

export interface Memory {
  id: string;
  scope: MemoryScope;
  scopeId: string;
  type: MemoryType;
  key: string;
  value: unknown;
  version: number;
  evidenceRef?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Approval {
  id: string;
  runId: string;
  agentId: string;
  toolName: string;
  actionPayload: Record<string, unknown>;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  commitSha?: string;
  expiresAt: number;
  createdAt: number;
  decidedAt?: number;
}

export interface EventJournalEntry {
  id: number;
  eventType: string;
  entityType: string;
  entityId: string;
  runId?: string;
  payload: Record<string, unknown>;
  createdAt: number;
}
