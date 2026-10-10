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
  | 'quota_paused'
  | 'resuming'
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
  projectId: string;
  definitionId: string;
  displayName: string;
  avatarUrl?: string;
  activeModelId: string;
  fallbackModelId?: string;
  isOrchestrator: boolean;
  isEphemeral: boolean;
  roleTitle?: string;
  systemPrompt?: string;
  capabilities?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  projectId?: string;
  parentRunId?: string;
  taskId?: string;
  channelId?: string;
  triggerMessageId?: string;
  state: RunState;
  worktreePath?: string;
  heartbeatAt: number;
  allocatedTokens: number;
  usedTokens: number;
  quotaResetsAt?: number | null;
  interruptedTurn?: number | null;
  createdAt: number;
  completedAt?: number;
}

export interface ActionRecord {
  id: string;
  runId?: string;
  agentId: string;
  toolName: string;
  paramsJson: string;
  outputSnippet?: string;
  status: 'success' | 'failure' | 'requires_approval' | 'aborted';
  durationMs: number;
  createdAt: number;
}

export interface FileRevision {
  id: string;
  projectId: string;
  filePath: string;
  contentHash: string;
  mtime: number;
  lastModifiedBy: string;
  updatedAt: number;
}

export type ChannelType = 'channel' | 'direct_message' | 'meeting';

export interface Channel {
  id: string;
  projectId: string;
  name: string;
  topic?: string;
  channelType?: ChannelType;
  participantIds?: string[];
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
  deadline?: number;
  checkInPolicy?: string;
  progressSummary?: string;
  blockedState?: string;
  proposedReplanning?: any;
  originChannelId?: string;
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
  assignedAgentId?: string | null;
  status: TaskStatus;
  verificationSpec: VerificationSpec;
  evidenceBundleId?: string | null;
  claimedByRunId?: string | null;
  leaseExpiresAt?: number | null;
  retryCount?: number;
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
  verifiedBy?: string;
  verificationPayloadJson?: string;
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

export interface AgentAnalytics {
  messagesCount: number;
  assignedTasksCount: number;
  completedTasksCount: number;
  taskSuccessRate: number;
  agentRunsCount: number;
  usedTokens: number;
  allocatedTokens: number;
  pendingApprovalsCount: number;
  assignedChannelsCount: number;
  avgProductivityScore: number;
  lastActiveAt: number;
}

export interface ProjectAnalytics {
  totalMessages: number;
  humanMessages: number;
  agentMessages: number;
  totalTasks: number;
  completedTasks: number;
  taskCompletionRate: number;
  pendingApprovalsCount: number;
  databaseSizeBytes: number;
}

export type ScheduleType = 'one_shot' | 'cron';
export type ScheduleStatus = 'active' | 'completed' | 'cancelled' | 'expired' | 'failed' | 'paused';

export interface Schedule {
  id: string;
  projectId: string;
  channelId: string;
  targetAgentId?: string;
  type: ScheduleType;
  prompt: string;
  durationSeconds?: number;
  cronExpression?: string;
  timerCondition?: string;
  maxIterations?: number;
  currentIterations?: number;
  status: ScheduleStatus;
  nextRunAt: number;
  lastRunAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleAttempt {
  id: string;
  scheduleId: string;
  attemptNumber: number;
  status: 'success' | 'failure';
  errorMessage?: string;
  executedAt: number;
}

export interface AgentEvaluation {
  id: string;
  agentId: string;
  testSuiteName: string;
  score: number;
  passed: boolean;
  rubricMetricsJson: string;
  testCasesRun?: number;
  testCasesPassed?: number;
  testCasesJson?: string;
  executionLogs?: string;
  evaluatorNotes?: string;
  createdAt: number;
}

export interface ManagedCredential {
  id: string;
  provider: string;
  keyAlias: string;
  secretHash: string;
  maskedKey?: string;
  scopedGrantsJson: string;
  maxSpendTokens?: number;
  currentSpendTokens: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RunnerAdapterInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface RunnerAdapter {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  execute(options: any): Promise<any>;
}
