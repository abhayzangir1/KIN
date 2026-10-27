// ============================================================================
// KIN DESKTOP UI — ZUSTAND STATE STORE
// Genuinely wired to KIN Core Server, SQLite persistence, and SSE events.
// Supports multi-project switching, project-isolated agents, DMs, and channels.
// ============================================================================

import { create } from 'zustand';

let cachedIpcToken: string | null = null;
const nativeFetch = typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined;

export async function getIpcToken(): Promise<string | null> {
  if (cachedIpcToken) return cachedIpcToken;
  if (typeof window !== 'undefined') {
    if ('__TAURI__' in window) {
      try {
        const tauri = (window as any).__TAURI__;
        const invoke = tauri?.core?.invoke || tauri?.tauri?.invoke || tauri?.invoke;
        if (typeof invoke === 'function') {
          const token = await invoke('get_ipc_token');
          if (token && typeof token === 'string') {
            cachedIpcToken = token.trim();
            return cachedIpcToken;
          }
        }
      } catch {}
    }
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const urlToken = searchParams.get('token');
      if (urlToken) {
        cachedIpcToken = urlToken.trim();
        try {
          window.sessionStorage.setItem('kin_ipc_token', cachedIpcToken);
          searchParams.delete('token');
          const cleanQuery = searchParams.toString();
          const cleanUrl = window.location.pathname + (cleanQuery ? `?${cleanQuery}` : '') + window.location.hash;
          window.history.replaceState(null, '', cleanUrl);
        } catch {}
        return cachedIpcToken;
      }
      const stored = window.localStorage.getItem('kin_ipc_token') || window.sessionStorage.getItem('kin_ipc_token') || window.localStorage.getItem('ipc_token');
      if (stored) {
        cachedIpcToken = stored.trim();
        return cachedIpcToken;
      }
    } catch {}

    // In web dev mode or loopback browser session, the Vite proxy automatically injects the IPC token
  }
  return null;
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    return 'http://127.0.0.1:54321';
  }
  return '';
}

function sha256Bytes(data: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const len = data.length;
  const bitLen = len * 8;
  const padLen = (len + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 4, bitLen >>> 0, false);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);

  for (let i = 0; i < padLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3);
      const s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function hmacSha256Fallback(keyBytes: Uint8Array, msgBytes: Uint8Array): string {
  const blockSize = 64;
  let key = keyBytes;
  if (key.length > blockSize) {
    key = sha256Bytes(key);
  }
  const keyPadded = new Uint8Array(blockSize);
  keyPadded.set(key);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = keyPadded[i] ^ 0x5c;
    iKeyPad[i] = keyPadded[i] ^ 0x36;
  }

  const inner = new Uint8Array(blockSize + msgBytes.length);
  inner.set(iKeyPad, 0);
  inner.set(msgBytes, blockSize);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(blockSize + 32);
  outer.set(oKeyPad, 0);
  outer.set(innerHash, blockSize);
  const outerHash = sha256Bytes(outer);

  return Array.from(outerHash).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function computeTaskSignature(token: string, taskId: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(token);
  const msgData = enc.encode(`${taskId}:completed`);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
      return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {}
  }
  return hmacSha256Fallback(keyData, msgData);
}

// Global browser fetch interceptor for desktop Tauri support and IPC authentication injection
if (typeof window !== 'undefined' && typeof window.fetch === 'function' && nativeFetch) {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const isTauri = '__TAURI__' in window;
    if (isTauri && url.startsWith('/api/')) {
      url = `http://127.0.0.1:54321${url}`;
    }

    const isLocalApi = url.startsWith('/api/') ||
      url.startsWith('http://127.0.0.1:54321') ||
      url.startsWith('http://localhost:54321') ||
      (typeof window !== 'undefined' && window.location && url.startsWith(window.location.origin + '/api/'));

    const headers = new Headers(init?.headers || (typeof input === 'object' && 'headers' in input ? (input as Request).headers : {}));
    if (isLocalApi && !headers.has('Authorization')) {
      const token = await getIpcToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
        headers.set('x-kin-auth', token);
      }
    }

    if (typeof input === 'string' || input instanceof URL) {
      return nativeFetch(url, { ...init, headers });
    } else {
      return nativeFetch(new Request(url, { ...init, headers }));
    }
  };
}

export interface ProjectItem {
  id: string;
  workspaceId: string;
  name: string;
  repoPath: string;
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

export interface AgentDisplay {
  id: string;
  name: string;
  role: string;
  displayName: string;
  activeModelId: string;
  fallbackModelId?: string;
  systemPrompt?: string;
  status: 'idle' | 'working' | 'thinking' | 'waiting' | 'needs_approval' | 'recovering';
  isOrchestrator: boolean;
  projectId?: string;
  assignedChannels?: string[];
  currentTool?: string;
  analytics?: AgentAnalytics;
  modelAvailable?: boolean;
  modelStatus?: string;
}

export interface ChannelItem {
  id: string;
  projectId?: string;
  name: string;
  topic?: string;
  unreadCount: number;
  memberIds?: string[];
  isPrivate?: boolean;
  channelType?: 'channel' | 'direct_message' | 'meeting';
}

export interface MessageItem {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderType: 'human' | 'agent' | 'system';
  content: string;
  createdAt: number;
  productivityScore?: number;
  isSteer?: boolean;
  metadata?: any;
}

export interface AntigravityExecutionItem {
  id: string;
  type: 'thought' | 'file_explore' | 'mcp_tool' | 'command' | 'file_edit' | 'peer_coordination';
  summary: string;
  timestamp: number;
  durationFormatted?: string;
  details?: Record<string, any>;
}

export interface AntigravityPhase {
  id: string;
  title: string;
  durationMs: number;
  durationFormatted: string;
  items: AntigravityExecutionItem[];
}

export interface AgentExecutionDetails {
  agentId: string;
  displayName: string;
  role: string;
  activeModelId: string;
  status: 'idle' | 'working' | 'thinking' | 'recovering';
  totalDurationMs: number;
  durationFormatted: string;
  exploredFiles?: string[];
  metrics: {
    exploredFilesCount: number;
    tasksCount: number;
    actionsCount: number;
    commandsCount: number;
    editedFilesCount: number;
  };
  phases: AntigravityPhase[];
  peerCoordination: Array<{
    targetAgent: string;
    channelName: string;
    action: string;
    timestamp: number;
  }>;
}

export interface ApprovalItem {
  id: string;
  runId: string;
  agentName: string;
  toolName: string;
  actionSummary: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: number;
  projectId?: string;
  parameters?: Record<string, any>;
}

export interface OllamaStatus {
  online: boolean;
  models: string[];
}

export interface AvailableModelItem {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  isFree?: boolean;
  isCustom?: boolean;
  isInstalled?: boolean;
  configured?: boolean;
  validated?: boolean;
  description?: string;
}

export function isAgentAvailable(
  agent: AgentDisplay,
  ollamaStatus: { online: boolean; models: string[] },
  credentials: ManagedCredentialItem[] = [],
  availableModels: AvailableModelItem[] = []
): boolean {
  const modelId = (agent.activeModelId || '').trim();
  if (!modelId || modelId === 'inherit') {
    return Boolean(ollamaStatus.online && ollamaStatus.models?.length > 0) || credentials.some((c) => c.status !== 'revoked');
  }
  const isOllama = modelId.startsWith('ollama/') || !modelId.includes('/');
  if (isOllama) {
    if (!ollamaStatus.online || !ollamaStatus.models || ollamaStatus.models.length === 0) return false;
    const cleanName = modelId.replace(/^ollama\//, '').toLowerCase();
    return ollamaStatus.models.some((m) => {
      const lower = m.toLowerCase();
      return lower === cleanName || lower.startsWith(cleanName) || cleanName.startsWith(lower);
    });
  }
  const provider = modelId.split('/')[0].toLowerCase();
  if (credentials.some((c) => c.provider.toLowerCase() === provider && c.status !== 'revoked')) {
    return true;
  }
  if (availableModels.some((m) => m.id === modelId && (m.configured || m.validated))) {
    return true;
  }
  return Boolean(agent.modelAvailable);
}

export interface ArtifactItem {
  name: string;
  relativePath: string;
  size: number;
  updatedAt: number;
  type: string;
  category?: string;
}

export interface SelectedArtifact {
  name: string;
  relativePath: string;
  size: number;
  updatedAt: number;
  content: string;
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'untracked' | 'added' | 'deleted' | 'renamed';
  staged: boolean;
  code: string;
}

export interface GitStatusSummary {
  totalChanged: number;
  modifiedCount: number;
  untrackedCount: number;
  addedCount: number;
  deletedCount: number;
  stagedCount: number;
}

export interface GitStatusState {
  isGitRepo: boolean;
  summary: GitStatusSummary;
  files: GitFileStatus[];
}

export interface GitDiffState {
  path: string;
  diff: string;
  additions: number;
  deletions: number;
  isUntracked: boolean;
  isBinary?: boolean;
}

export interface UploadItem {
  id: string;
  projectId: string;
  filename: string;
  originalName: string;
  relativePath: string;
  size: number;
  mimeType: string;
  createdAt: number;
}

export interface GoalItem {
  id: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  status: 'draft' | 'active' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
}

export interface ActiveCoordinationLink {
  id: string;
  fromAgentId: string;
  fromAgentName?: string;
  targetAgentId: string;
  targetAgentName?: string;
  directive: string;
  channelId: string;
  type: 'direct_delegation' | 'channel_coordination' | 'mention_request';
  status: 'active' | 'completed';
  timestamp: number;
}

export interface QueuedMessage {
  id: string;
  channelId: string;
  content: string;
  createdAt: number;
}

export interface TaskItem {
  id: string;
  goalId: string;
  title: string;
  description: string;
  assignedAgentId?: string;
  status: 'backlog' | 'ready' | 'assigned' | 'running' | 'blocked' | 'review' | 'completed' | 'failed' | 'cancelled';
  verificationSpec?: any;
  createdAt: number;
  updatedAt: number;
}

export interface DecisionItem {
  id: string;
  projectId: string;
  taskId?: string;
  decidedById: string;
  title: string;
  rationale: string;
  alternativesConsidered: string[];
  status: 'proposed' | 'authoritative' | 'superseded' | 'rejected';
  createdAt: number;
}

export interface PendingRecoveryItem {
  id: string;
  runId?: string;
  agentId: string;
  agentName?: string;
  model?: string;
  projectId?: string;
  taskId?: string;
  taskTitle?: string;
  interruptedTurn?: number;
  checkpointReason?: string;
  checkpoint?: any;
  state?: string;
  interruptedAt?: number;
}

export interface QuotaPauseState {
  isPaused: boolean;
  runId?: string;
  agentId?: string;
  agentName?: string;
  provider?: string;
  channelId?: string;
  modelId?: string;
  turn?: number;
  quotaResetsAt?: number;
  resetsAt?: number;
}

export interface AgentEvaluationItem {
  id: string;
  agentId: string;
  projectId?: string;
  testSuiteName?: string;
  benchmarkSuite?: string;
  score?: number;
  passed?: boolean;
  rubricScores?: {
    accuracy: number;
    reasoning: number;
    toolCompetence: number;
    safetyAdherence: number;
    overall: number;
  };
  rubricMetrics?: Record<string, number>;
  testCasesRun?: number;
  testCasesPassed?: number;
  feedbackNotes?: string;
  evaluatorNotes?: string;
  evaluatedAt?: number;
  createdAt?: number;
}

export interface ManagedCredentialItem {
  id: string;
  provider: string;
  keyName?: string;
  keyAlias?: string;
  maskedKey?: string;
  baseUrl?: string;
  monthlyQuotaTokens?: number;
  maxSpendTokens?: number;
  usedTokens?: number;
  currentSpendTokens?: number;
  quotaResetDay?: number;
  status?: 'active' | 'quota_exhausted' | 'revoked';
  scopedAgentIds?: string[];
  scopedGrants?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface GrillMeQuestion {
  id: string;
  question?: string;
  prompt?: string;
  options: string[];
  recommended?: string;
}

export interface GrillMeSession {
  id: string;
  channelId: string;
  topic: string;
  agentId: string;
  agentName: string;
  messageId?: string;
  questions: GrillMeQuestion[];
  createdAt: number;
}

export interface ScheduleAttemptItem {
  id: string;
  scheduleId: string;
  attemptNumber: number;
  status: 'success' | 'failure';
  errorMessage?: string;
  executedAt: number;
}

export interface RoutingDecisionInfo {
  channelId: string;
  messageId?: string;
  routing: {
    action: string;
    targetAgents: Array<{ id: string; displayName: string }>;
    reason: string;
    matchReason?: string;
    matchedKeywords?: string[];
    matchedSpecialists?: Array<{
      agentId: string;
      displayName: string;
      matchReason: string;
      matchedKeywords: string[];
    }>;
    fallbackOrchestrator?: { id: string; displayName: string };
    fallbackReason?: string;
  };
}

export interface ScheduleItem {
  id: string;
  projectId: string;
  channelId: string;
  targetAgentId?: string;
  type: 'one_shot' | 'cron';
  prompt: string;
  durationSeconds?: number;
  cronExpression?: string;
  timerCondition?: string;
  maxIterations?: number;
  currentIterations?: number;
  status: 'active' | 'completed' | 'cancelled' | 'failed';
  nextRunAt: number;
  lastRunAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  version: string;
  instructions: string;
  tags: string[];
  isBuiltIn?: boolean;
  status?: 'candidate' | 'active' | 'deprecated' | 'disabled';
  evidenceCount?: number;
  successCount?: number;
  failureCount?: number;
  lastValidatedAt?: number;
  validatorRef?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SkillExperienceItem {
  id: string;
  skillId?: string;
  runId: string;
  toolName?: string;
  objective: string;
  outcome: 'success' | 'failure';
  failureReason?: string;
  repairStrategy?: string;
  lessonsLearned?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface SkillVersionItem {
  id: string;
  skillId: string;
  version: string;
  description: string;
  instructions: string;
  triggerPatterns: string[];
  promotedBy: string;
  changeSummary?: string;
  createdAt: number;
}

export interface McpToolItem {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
  serverName: string;
}

export interface McpServerItem {
  name: string;
  transport: 'stdio' | 'http';
  url?: string;
  toolsCount: number;
  tools: string[];
}

export interface McpConnectorItem {
  name: string;
  scope: 'global' | 'project';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
  status: 'running' | 'stopped' | 'failed' | 'disabled' | 'active' | 'error';
  overridden?: boolean;
  configPath?: string;
  toolsCount: number;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, any>;
  }> | string[];
}

export interface McpTestResult {
  success: boolean;
  durationMs: number;
  toolsCount: number;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, any>;
  }> | string[];
  message?: string;
  error?: string;
}

export interface LearningMetricsData {
  totalExperiences: number;
  totalSkills: number;
  activeSkillsCount: number;
  candidateSkillsCount: number;
  deprecatedSkillsCount: number;
  toolReliability: Array<{
    toolName: string;
    invocations: number;
    successes: number;
    failures: number;
    successRate: number;
  }>;
  recoveryStrategies: Array<{
    strategy: string;
    suggestedCount: number;
    successfulCount: number;
    successRate: number;
  }>;
}

export interface TakeoverActionPreview {
  toolName: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  target?: string;
  paramsSummary: Record<string, any>;
  requiresApproval: boolean;
}

export interface TakeoverState {
  runId: string;
  agentId?: string;
  channelId?: string;
  isPaused: boolean;
  isAborted: boolean;
  activeTool?: string;
  previewPayload?: TakeoverActionPreview;
  authRequired?: boolean;
  authInstructions?: string;
  financialGate?: boolean;
  riskLevel?: string;
}

export interface DiscoveredApp {
  name: string;
  executablePath: string;
  source: string;
  category?: string;
}

export interface WindowInfo {
  handle: number;
  title: string;
  processName: string;
  pid: number;
}

export interface BrowserStatus {
  active: boolean;
  currentUrl?: string;
  pageTitle?: string;
  stepHistory?: Array<{
    action: string;
    url?: string;
    selector?: string;
    success: boolean;
    durationMs?: number;
    error?: string;
    timestamp?: number;
  }>;
}

export type RoutineItem = ScheduleItem;

interface KinState {
  // Navigation & Workspace State
  projects: ProjectItem[];
  activeProjectId: string;
  activeProject?: ProjectItem;
  activeChannelId: string;
  channels: ChannelItem[];
  channelMembers: AgentDisplay[];
  schedules: ScheduleItem[];
  agents: AgentDisplay[];
  selectedAgentId: string;
  messages: MessageItem[];
  channelMessagesCache: Record<string, MessageItem[]>;
  pendingApprovals: ApprovalItem[];
  autonomyMode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS';
  latestRoutingByChannel: Record<string, RoutingDecisionInfo>;

  // Instant Human Takeover State
  activeTakeover: TakeoverState | null;
  activeTakeovers: Record<string, TakeoverState>;

  // Skills Engine & Learning Pipeline State
  skills: SkillItem[];
  candidateSkills: SkillItem[];
  skillExperiences: SkillExperienceItem[];
  learningMetrics: LearningMetricsData | null;
  isSkillsModalOpen: boolean;
  isLoadingSkills: boolean;

  // Dynamic Custom Tools State
  customTools: any[];
  isLoadingCustomTools: boolean;

  // MCP Connectors State
  mcpServers: McpServerItem[];
  mcpTools: McpToolItem[];
  mcpConnectors: McpConnectorItem[];
  globalMcpConfigPath: string;
  projectMcpConfigPath: string;
  isLoadingMcp: boolean;
  isLoadingConnectors: boolean;
  isConnectorsModalOpen: boolean;

  // Desktop & Browser Control State
  discoveredApps: DiscoveredApp[];
  activeWindows: WindowInfo[];
  browserStatus: BrowserStatus | null;
  routines: RoutineItem[];
  isDesktopControlModalOpen: boolean;
  
  // Local LLM & System State
  ollamaStatus: OllamaStatus;
  availableModels: AvailableModelItem[];
  providerReadiness: Record<string, any>;
  isLoadingModels: boolean;
  fetchAvailableModels: (options?: { omitUnconfigured?: boolean; provider?: string }) => Promise<void>;
  verifyProviderKey: (provider: string, apiKey?: string, baseUrl?: string) => Promise<{ success: boolean; working: boolean; message: string; modelCount: number; models?: AvailableModelItem[] }>;
  discoverModels: (provider: string, apiKey?: string, baseUrl?: string, keyAlias?: string) => Promise<{ success: boolean; count?: number; error?: string }>;
  addCustomModel: (
    modelId: string,
    optionsOrName?: string | { name?: string; provider?: string; contextWindow?: number; baseUrl?: string; apiKey?: string }
  ) => Promise<{ success: boolean; model?: AvailableModelItem; error?: string }>;
  isConnected: boolean;
  terminalHistory: Array<{ command: string; output: string; exitCode: number }>;
  
  // Artifacts & Files State
  artifacts: ArtifactItem[];
  selectedArtifact: SelectedArtifact | null;
  
  // Git Changes & File Review State
  gitStatus: GitStatusState;
  activeGitDiff: GitDiffState | null;
  isLoadingDiff: boolean;

  // Uploads State
  uploads: UploadItem[];
  isUploading: boolean;

  // Goals & Tasks DAG State
  goals: GoalItem[];
  tasks: TaskItem[];
  isNewGoalModalOpen: boolean;
  isNewTaskModalOpen: boolean;

  // Architecture Decision Records (ADR)
  decisions: DecisionItem[];
  createDecision: (params: { title: string; rationale: string; alternativesConsidered?: string[]; status?: 'proposed' | 'authoritative' | 'superseded' | 'rejected'; taskId?: string }) => Promise<{ success: boolean; decision?: DecisionItem; error?: string }>;
  resolveDecision: (decisionId: string, status: 'proposed' | 'authoritative' | 'superseded' | 'rejected') => Promise<{ success: boolean; error?: string }>;
  deleteDecision: (decisionId: string) => Promise<{ success: boolean; error?: string }>;
  isDecisionsModalOpen: boolean;
  setDecisionsModalOpen: (open: boolean) => void;

  // Project & Live Analytics State
  projectAnalytics?: ProjectAnalytics;

  // UI Tabs & Modals
  activeRightTab: 'Agent' | 'Changes' | 'Review' | 'Artifacts' | 'Uploads' | 'Terminal';
  activeInspectorTab: 'Contract' | 'Telemetry' | 'Teamwork' | 'Evaluations';

  // Crash Recovery & Quota Safety
  pendingRecoveries: PendingRecoveryItem[];
  quotaPauseState: QuotaPauseState | null;
  agentEvaluations: Record<string, AgentEvaluationItem[]>;
  credentials: ManagedCredentialItem[];
  grillMeSession: GrillMeSession | null;
  fetchRecoveryState: () => Promise<void>;
  resumeAllRecoveries: (modelOverride?: string) => Promise<{ success: boolean; count?: number }>;
  discardRecoveries: () => Promise<{ success: boolean }>;
  resumeRun: (runId: string, modelOverride?: string) => Promise<{ success: boolean }>;
  switchRunToModel: (runId: string, targetModelId: string) => Promise<{ success: boolean; model?: string }>;
  switchRunToOllama: (runId: string) => Promise<{ success: boolean; model?: string }>;
  fetchEvaluations: (agentId: string) => Promise<void>;
  evaluationsLoading?: boolean;
  runAgentEvaluation: (agentId: string) => Promise<{ success: boolean; evaluation?: AgentEvaluationItem }>;
  fetchCredentials: () => Promise<void>;
  credentialsLoading?: boolean;
  addCredential: (params: {
    provider: string;
    keyName?: string;
    keyAlias?: string;
    apiKey?: string;
    secret?: string;
    baseUrl?: string;
    monthlyQuotaTokens?: number;
    maxSpendTokens?: number;
    scopedAgentIds?: string[];
    scopedGrants?: string[];
  }) => Promise<{ success: boolean; credential?: ManagedCredentialItem; error?: string; duplicate?: boolean }>;
  updateCredential: (
    id: string,
    params: {
      provider?: string;
      keyName?: string;
      keyAlias?: string;
      apiKey?: string;
      secret?: string;
      baseUrl?: string;
      monthlyQuotaTokens?: number;
      maxSpendTokens?: number;
      scopedAgentIds?: string[];
      scopedGrants?: string[];
    }
  ) => Promise<{ success: boolean; credential?: ManagedCredentialItem; error?: string; duplicate?: boolean }>;
  deleteCredential: (id: string) => Promise<boolean>;
  submitGrillMeAnswers: (
    params: { channelId?: string; topic?: string; answers: Record<string, string> } | Record<string, string>
  ) => Promise<{ success: boolean; decision?: any }>;
  dismissGrillMe: () => void;
  clearQuotaPause: () => void;

  // Queued Messages
  queuedMessages: QueuedMessage[];
  streamingDrafts: Record<string, string>;
  thinkingDrafts: Record<string, string>;
  agentThinkingDrafts: Record<string, string>;
  agentLiveTools: Record<string, { toolName: string; params: any } | null>;
  latestDelegation: {
    fromAgentId: string;
    targetAgentId: string;
    targetAgentName?: string;
    directive: string;
    channelId: string;
    parentRunId?: string;
  } | null;
  latestAntiLoopEvent: {
    runId: string;
    agentId: string;
    channelId: string;
    reason: string;
  } | null;
  // Dynamic Swarm Coordination Links (A -> B -> C)
  coordinationLinks: ActiveCoordinationLink[];
  addCoordinationLink: (link: Omit<ActiveCoordinationLink, 'id' | 'timestamp'>) => void;
  clearCoordinationLinks: () => void;
  // Channel execution tracking (agentId -> channelId)
  activeAgentChannels: Record<string, string>;
  // Swarm Map & Execution Trajectory
  isSwarmMapOpen: boolean;
  selectedSwarmAgentId: string;
  agentExecutionDetails: Record<string, AgentExecutionDetails>;
  isLoadingExecutionDetails: boolean;
  steerNotification: { channelId: string; directive: string } | null;
  isNewProjectModalOpen: boolean;
  isCreateChannelModalOpen: boolean;
  isAddAgentModalOpen: boolean;
  isSettingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;

  // Model Selector & Provider Manager State
  isModelSelectorOpen: boolean;
  modelSelectorTargetAgentId: string | null;
  openModelSelector: (agentId?: string | null) => void;
  closeModelSelector: () => void;
  isAddProviderModalOpen: boolean;
  addProviderPreselected: string | null;
  openAddProviderModal: (provider?: string | null) => void;
  closeAddProviderModal: () => void;
  modelUnavailableNotice: {
    agentId: string;
    agentName: string;
    modelId: string;
    error: string;
    channelId?: string;
  } | null;
  dismissModelUnavailableNotice: () => void;
  updateAgentModel: (agentId: string, activeModelId: string, projectId?: string, channelId?: string) => Promise<boolean>;

  // Resizable Workspace Layout State
  sidebarWidth: number;
  inspectorWidth: number;
  isInspectorOpen: boolean;
  setSidebarWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  resetPanelWidths: () => void;

  // Theme State
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;

  // Main View Navigation
  activeMainView: 'chat' | 'automations';
  setActiveMainView: (view: 'chat' | 'automations') => void;

  // System Diagnostics & Health
  systemHealth: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: number;
    checks: Record<string, { status: string; message?: string }>;
    memory?: { totalMb: number; freeMb: number; freeRatio: number };
    limits?: { maxConcurrentShell: number; maxConcurrentBrowser: number };
    activeAlerts?: string[];
  } | null;
  fetchSystemHealth: () => Promise<void>;

  // Automations & In-App Scheduler
  isAutomationsModalOpen: boolean;
  setAutomationsModalOpen: (open: boolean) => void;
  createSchedule: (params: {
    type: 'one_shot' | 'cron';
    durationSeconds?: number;
    cronExpression?: string;
    prompt: string;
    targetAgentId?: string;
    channelId?: string;
  }) => Promise<{ success: boolean; schedule?: ScheduleItem; error?: string }>;
  triggerScheduleNow: (scheduleId: string) => Promise<{ success: boolean; schedule?: ScheduleItem; error?: string }>;
  retrySchedule: (scheduleId: string) => Promise<{ success: boolean; schedule?: ScheduleItem; error?: string }>;
  fetchScheduleAttempts: (scheduleId: string) => Promise<ScheduleAttemptItem[]>;

  // Actions
  fetchQueuedMessages: (channelId?: string) => Promise<void>;
  queueMessage: (channelId: string, content: string) => void;
  dequeueMessage: (id: string, channelId?: string) => void | Promise<void>;
  promoteQueuedToSteer: (id: string) => Promise<void>;
  setSwarmMapOpen: (open: boolean) => void;
  setSelectedSwarmAgentId: (id: string) => void;
  fetchAgentExecutionDetails: (agentId: string) => Promise<void>;
  clearSteerNotification: () => void;
  fetchState: (projectId?: string) => Promise<void>;
  fetchSchedules: (projectId?: string) => Promise<void>;
  cancelSchedule: (scheduleId: string) => Promise<void>;
  fetchArtifacts: (projectId?: string) => Promise<void>;
  selectArtifact: (relativePath: string) => Promise<void>;
  clearSelectedArtifact: () => void;
  setActiveRightTab: (tab: 'Agent' | 'Changes' | 'Review' | 'Artifacts' | 'Uploads' | 'Terminal') => void;
  initSSE: () => void;
  closeSSE: () => void;
  setActiveChannel: (channelId: string) => Promise<void>;
  setActiveProject: (projectId: string) => Promise<void>;
  createProject: (name: string, repoPath?: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  createGoal: (title: string, description?: string, acceptanceCriteria?: string[]) => Promise<void>;
  deleteGoal: (goalId: string) => Promise<{ success: boolean; error?: string }>;
  createTask: (goalId: string, title: string, description?: string, assignedAgentId?: string, dependsOnTaskIds?: string[]) => Promise<void>;
  deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  updateTaskStatus: (taskId: string, status: 'backlog' | 'ready' | 'assigned' | 'running' | 'blocked' | 'review' | 'completed' | 'failed' | 'cancelled') => Promise<void>;
  setNewGoalModalOpen: (open: boolean) => void;
  setNewTaskModalOpen: (open: boolean) => void;
  fetchChannelMembers: (channelId: string) => Promise<void>;
  createChannel: (name: string, topic?: string) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<{ success: boolean; error?: string }>;
  addChannelMember: (channelId: string, agentId: string) => Promise<void>;
  removeChannelMember: (channelId: string, agentId: string) => Promise<void>;
  hireAgent: (params: {
    displayName: string;
    roleTitle: string;
    systemPrompt?: string;
    activeModelId?: string;
    channelId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  decommissionAgent: (agentId: string) => Promise<{ success: boolean; error?: string }>;
  startOllama: () => Promise<void>;
  runTerminalCommand: (command: string) => Promise<void>;
  clearTerminalHistory: () => void;
  updateAgentContract: (agentId: string, roleTitle: string, activeModelId: string, systemPrompt?: string) => Promise<void>;
  sendMessage: (content: string, overrideChannelId?: string, isSteer?: boolean) => Promise<{ success: boolean; error?: string }>;
  setAutonomyMode: (mode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS') => Promise<void>;
  resolveApproval: (approvalId: string, approved: boolean) => Promise<void>;
  setActiveInspectorTab: (tab: KinState['activeInspectorTab']) => void;
  setSelectedAgentId: (agentId: string) => void;
  setNewProjectModalOpen: (open: boolean) => void;
  setCreateChannelModalOpen: (open: boolean) => void;
  setAddAgentModalOpen: (open: boolean) => void;

  // Git Actions
  fetchGitStatus: (projectId?: string) => Promise<void>;
  fetchGitDiff: (path: string, projectId?: string) => Promise<void>;
  clearGitDiff: () => void;
  revertGitFile: (path: string) => Promise<boolean>;
  stageGitFile: (path: string, stage: boolean) => Promise<boolean>;
  requestAiReview: (filePath?: string) => Promise<{ success: boolean; review?: string; verdict?: string; error?: string }>;

  // Upload Actions
  fetchUploads: (projectId?: string) => Promise<void>;
  uploadFile: (file: File) => Promise<{ success: boolean; error?: string }>;
  deleteUpload: (uploadId: string) => Promise<boolean>;

  // Instant Human Takeover Actions
  pauseAgent: (runId: string) => Promise<boolean>;
  resumeAgent: (runId: string) => Promise<boolean>;
  abortAgent: (runId: string) => Promise<boolean>;
  fetchActiveRuns: () => Promise<void>;
  dismissTakeover: () => void;

  // Skills Engine & Learning Pipeline Actions
  fetchSkills: () => Promise<void>;
  createSkill: (params: { id?: string; name: string; instructions?: string; handlerCode?: string; description?: string; parameters?: any; skillType?: string; enabled?: boolean; tags?: string[]; requiredTools?: string[]; triggerPatterns?: string[] }) => Promise<{ success: boolean; skill?: SkillItem; error?: string }>;
  updateSkill: (skillId: string, params: { name?: string; instructions?: string; handlerCode?: string; description?: string; parameters?: any; skillType?: string; enabled?: boolean; tags?: string[]; requiredTools?: string[]; triggerPatterns?: string[] }) => Promise<{ success: boolean; skill?: SkillItem; error?: string }>;
  deleteSkill: (skillId: string) => Promise<boolean>;
  exportSkill: (skillId: string) => Promise<any>;
  exportAllSkills: () => Promise<any>;
  importSkill: (bundleJson: string | object) => Promise<{ success: boolean; skill?: SkillItem; error?: string; count?: number }>;
  setSkillsModalOpen: (open: boolean) => void;
  fetchCandidates: () => Promise<void>;
  harvestCandidates: () => Promise<{ success: boolean; createdCount: number }>;
  validateCandidate: (candidateId: string, action: 'promote' | 'reject', reviewer?: string, rationale?: string, updatedInstructions?: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  fetchSkillExperiences: () => Promise<void>;
  fetchLearningMetrics: () => Promise<void>;
  fetchSkillVersions: (skillId: string) => Promise<SkillVersionItem[]>;
  rollbackSkill: (skillId: string, versionId: string) => Promise<{ success: boolean; skill?: SkillItem; error?: string }>;

  // Dynamic Custom Tools Actions
  fetchCustomTools: () => Promise<void>;
  deleteCustomTool: (id: string) => Promise<boolean>;

  // MCP Connector Actions
  fetchMcpData: () => Promise<void>;
  reloadMcpServers: () => Promise<{ success: boolean; toolsCount?: number; error?: string }>;
  setConnectorsModalOpen: (open: boolean) => void;
  fetchMcpConnectors: (projectId?: string) => Promise<void>;
  saveMcpConnector: (params: {
    scope: 'global' | 'project';
    name: string;
    config: {
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      disabled?: boolean;
    };
  }) => Promise<{ success: boolean; toolsCount?: number; error?: string }>;
  toggleMcpConnector: (params: {
    scope: 'global' | 'project';
    name: string;
    disabled: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  deleteMcpConnector: (params: {
    scope: 'global' | 'project';
    name: string;
  }) => Promise<{ success: boolean; error?: string }>;
  testMcpConnector: (params: {
    config: {
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
    };
    timeoutMs?: number;
  }) => Promise<McpTestResult>;

  // Desktop & Browser Actions
  fetchDiscoveredApps: () => Promise<void>;
  launchApp: (appNameOrPath: string, args?: string[]) => Promise<{ success: boolean; error?: string }>;
  fetchActiveWindows: () => Promise<void>;
  focusWindow: (titleOrPid: string | number) => Promise<any>;
  closeWindow: (titleOrPid: string | number) => Promise<boolean>;
  fetchBrowserStatus: () => Promise<void>;
  closeBrowser: () => Promise<boolean>;
  navigateBrowser: (url: string) => Promise<boolean>;
  captureDesktopScreenshot: () => Promise<any>;
  setDesktopControlModalOpen: (open: boolean) => void;

  // Routine Actions
  fetchRoutines: (projectId?: string) => Promise<void>;
  createRoutine: (params: { prompt: string; type: 'cron' | 'one_shot'; cronExpression?: string; durationSeconds?: number; channelId?: string; targetAgentId?: string }) => Promise<void>;
  cancelRoutine: (routineId: string) => Promise<void>;
}

let eventSourceInstance: EventSource | null = null;
let sseReconnectTimer: any = null;
let sseReconnectAttempts = 0;
let fetchStateRetryTimer: any = null;

export const useKinStore = create<KinState>((set, get) => ({
  projects: [],
  activeProjectId: 'proj-kin',
  activeChannelId: 'chan-general',
  channels: [],
  channelMembers: [],
  schedules: [],
  agents: [],
  selectedAgentId: '',
  messages: [],
  channelMessagesCache: {},
  pendingApprovals: [],
  goals: [],
  tasks: [],
  decisions: [],
  isDecisionsModalOpen: false,
  activeMainView: 'chat',
  systemHealth: null,
  isAutomationsModalOpen: false,
  isNewGoalModalOpen: false,
  isNewTaskModalOpen: false,
  projectAnalytics: undefined,
  autonomyMode: 'AUTO',
  latestRoutingByChannel: {},
  ollamaStatus: { online: false, models: [] },
  isConnected: false,
  terminalHistory: [],
  artifacts: [],
  selectedArtifact: null,
  gitStatus: {
    isGitRepo: false,
    summary: { totalChanged: 0, modifiedCount: 0, untrackedCount: 0, addedCount: 0, deletedCount: 0, stagedCount: 0 },
    files: [],
  },
  activeGitDiff: null,
  isLoadingDiff: false,
  uploads: [],
  isUploading: false,
  activeRightTab: 'Agent',
  activeInspectorTab: 'Contract',
  pendingRecoveries: [],
  quotaPauseState: null,
  agentEvaluations: {},
  credentials: [],
  grillMeSession: null,
  queuedMessages: [],
  streamingDrafts: {},
  thinkingDrafts: {},
  agentThinkingDrafts: {},
  agentLiveTools: {},
  latestDelegation: null,
  latestAntiLoopEvent: null,
  coordinationLinks: [],
  addCoordinationLink: (link) => {
    const newLink: ActiveCoordinationLink = {
      ...link,
      id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    set((state) => ({
      coordinationLinks: [
        newLink,
        ...state.coordinationLinks.filter(
          (l) => !(l.fromAgentId === link.fromAgentId && l.targetAgentId === link.targetAgentId)
        ),
      ].slice(0, 30),
    }));
  },
  clearCoordinationLinks: () => set({ coordinationLinks: [] }),
  activeAgentChannels: {},
  isSwarmMapOpen: false,
  selectedSwarmAgentId: '',
  agentExecutionDetails: {},
  isLoadingExecutionDetails: false,
  steerNotification: null,
  isNewProjectModalOpen: false,
  isCreateChannelModalOpen: false,
  isAddAgentModalOpen: false,
  isSettingsModalOpen: false,
  setSettingsModalOpen: (open: boolean) => set({ isSettingsModalOpen: open }),

  // Model Selector & Provider Manager State
  isModelSelectorOpen: false,
  modelSelectorTargetAgentId: null,
  openModelSelector: (agentId?: string | null) => set({ isModelSelectorOpen: true, modelSelectorTargetAgentId: agentId || null }),
  closeModelSelector: () => set({ isModelSelectorOpen: false, modelSelectorTargetAgentId: null }),
  isAddProviderModalOpen: false,
  addProviderPreselected: null,
  openAddProviderModal: (provider?: string | null) => set({ isAddProviderModalOpen: true, addProviderPreselected: provider || null }),
  closeAddProviderModal: () => set({ isAddProviderModalOpen: false, addProviderPreselected: null }),
  modelUnavailableNotice: null,
  dismissModelUnavailableNotice: () => set({ modelUnavailableNotice: null }),
  updateAgentModel: async (agentId: string, activeModelId: string, projectId?: string, channelId?: string) => {
    const targetProjId = projectId || get().activeProjectId;
    const targetChanId = channelId || get().activeChannelId;

    // Optimistic state update across all agent structures
    set((state) => ({
      agents: state.agents.map((a) => (a.id === agentId ? { ...a, activeModelId } : a)),
      channelMembers: state.channelMembers.map((a) => (a.id === agentId ? { ...a, activeModelId } : a)),
    }));
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModelId, projectId: targetProjId, channelId: targetChanId }),
      });
      if (res.status === 409) {
        const conflictData = await res.json().catch(() => ({}));
        console.warn('[KIN UI] Model update blocked: agent is active/working', conflictData.error);
        await get().fetchState(targetProjId);
        return false;
      }
      if (!res.ok) {
        const fallbackRes = await fetch(`/api/agents/${encodeURIComponent(agentId)}/model`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeModelId, projectId: targetProjId, channelId: targetChanId }),
        });
        if (!fallbackRes.ok) {
          await get().fetchState(targetProjId);
          return false;
        }
      }
      await get().fetchState(targetProjId);
      return true;
    } catch (err) {
      console.error('[KIN UI] Failed to update agent model:', err);
      get().fetchState(targetProjId);
      return false;
    }
  },

  // Theme State
  theme: (() => {
    try {
      const saved = localStorage.getItem('kin_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'light';
  })(),
  setTheme: (theme: 'dark' | 'light') => {
    try {
      localStorage.setItem('kin_theme', theme);
    } catch {}
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('kin_theme', next);
    } catch {}
    set({ theme: next });
  },

  // Resizable Workspace Layout State
  sidebarWidth: (() => {
    try {
      const saved = localStorage.getItem('kin_sidebar_width');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 180 && val <= 480) return val;
      }
    } catch {}
    return 260;
  })(),
  inspectorWidth: (() => {
    try {
      const saved = localStorage.getItem('kin_inspector_width');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 280 && val <= 720) return val;
      }
    } catch {}
    return 390;
  })(),
  setSidebarWidth: (width: number) => {
    const clamped = Math.max(180, Math.min(480, Math.round(width)));
    try { localStorage.setItem('kin_sidebar_width', clamped.toString()); } catch {}
    set({ sidebarWidth: clamped });
  },
  setInspectorWidth: (width: number) => {
    const clamped = Math.max(280, Math.min(720, Math.round(width)));
    try { localStorage.setItem('kin_inspector_width', clamped.toString()); } catch {}
    set({ inspectorWidth: clamped });
  },
  isInspectorOpen: (() => {
    try {
      const saved = localStorage.getItem('kin_inspector_open');
      if (saved !== null) return saved === 'true';
    } catch {}
    return true;
  })(),
  setInspectorOpen: (open: boolean) => {
    try { localStorage.setItem('kin_inspector_open', String(open)); } catch {}
    set({ isInspectorOpen: open });
  },
  toggleInspector: () => {
    set((state) => {
      const next = !state.isInspectorOpen;
      try { localStorage.setItem('kin_inspector_open', String(next)); } catch {}
      return { isInspectorOpen: next };
    });
  },
  resetPanelWidths: () => {
    try {
      localStorage.setItem('kin_sidebar_width', '260');
      localStorage.setItem('kin_inspector_width', '390');
      localStorage.setItem('kin_inspector_open', 'true');
    } catch {}
    set({ sidebarWidth: 260, inspectorWidth: 390, isInspectorOpen: true });
  },

  // Instant Human Takeover State
  activeTakeover: null,
  activeTakeovers: {},

  // Skills Engine & Self-Improvement Pipeline State
  skills: [],
  candidateSkills: [],
  skillExperiences: [],
  learningMetrics: null,
  isSkillsModalOpen: false,
  isLoadingSkills: false,

  // Dynamic Custom Tools State
  customTools: [],
  isLoadingCustomTools: false,

  // MCP Connectors State
  mcpServers: [],
  mcpTools: [],
  mcpConnectors: [],
  globalMcpConfigPath: '',
  projectMcpConfigPath: '',
  isLoadingMcp: false,
  isLoadingConnectors: false,
  isConnectorsModalOpen: false,
  setConnectorsModalOpen: (open: boolean) => set({ isConnectorsModalOpen: open }),

  // Desktop & Browser Control State
  discoveredApps: [],
  activeWindows: [],
  browserStatus: null,
  routines: [],
  isDesktopControlModalOpen: false,

  // Models State
  availableModels: [],
  providerReadiness: {},
  isLoadingModels: false,

  fetchState: async (projectId?: string) => {
    try {
      const targetProj = projectId || get().activeProjectId;
      const url = targetProj ? `/api/state?projectId=${encodeURIComponent(targetProj)}` : '/api/state';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();

      const rememberedChannelId = (() => {
        try {
          return targetProj ? localStorage.getItem(`kin_last_channel_${targetProj}`) : null;
        } catch {
          return null;
        }
      })();

      const currentActive = get().activeChannelId || rememberedChannelId || '';
      const isDm = currentActive.startsWith('dm-');
      const dmTargetAgentId = isDm ? currentActive.replace(/^dm-/, '') : '';
      const agentBelongsToProject = isDm && data.agents?.some((a: any) => a.id === dmTargetAgentId);
      const channelExists = data.channels?.some((c: any) => c.id === currentActive);
      const chosenChannelId = (channelExists || agentBelongsToProject)
        ? currentActive
        : (data.activeChannelId || (data.channels?.[0]?.id ?? 'chan-general'));

      if (targetProj && chosenChannelId) {
        try {
          localStorage.setItem(`kin_last_channel_${targetProj}`, chosenChannelId);
        } catch {}
      }

      const isViewingStateChannel = !chosenChannelId || chosenChannelId === (data.activeChannelId || 'chan-general');
      const nextCache: Record<string, MessageItem[]> = {
        ...get().channelMessagesCache,
        ...(data.activeChannelId ? { [data.activeChannelId]: data.messages || [] } : {}),
      };
      const activeMessages = isViewingStateChannel
        ? (data.messages || [])
        : (nextCache[chosenChannelId] || get().messages);

      const rememberedAgentId = (() => {
        try {
          return targetProj ? localStorage.getItem(`kin_selected_agent_${targetProj}`) : null;
        } catch {
          return null;
        }
      })();

      const chosenAgentId = (rememberedAgentId && data.agents?.some((a: any) => a.id === rememberedAgentId))
        ? rememberedAgentId
        : (data.agents?.some((a: any) => a.id === get().selectedAgentId)
          ? get().selectedAgentId
          : (data.agents?.find((a: any) => a.isOrchestrator)?.id || data.agents?.[0]?.id || ''));

      if (targetProj && chosenAgentId) {
        try {
          localStorage.setItem(`kin_selected_agent_${targetProj}`, chosenAgentId);
        } catch {}
      }

      const rememberedView = (() => {
        try {
          return targetProj ? (localStorage.getItem(`kin_main_view_${targetProj}`) as 'chat' | 'automations' | null) : null;
        } catch {
          return null;
        }
      })();

      set({
        projects: data.projects || [],
        activeProject: data.activeProject,
        activeProjectId: data.activeProject?.id || 'proj-kin',
        autonomyMode: data.autonomyMode || 'AUTO',
        activeChannelId: chosenChannelId,
        channels: (data.channels || [])
          .map((c: any) => {
            const existing = get().channels.find((ec) => ec.id === c.id);
            return {
              ...c,
              unreadCount: c.id === chosenChannelId ? 0 : (existing?.unreadCount || c.unreadCount || 0),
            };
          }),
        agents: data.agents || [],
        selectedAgentId: chosenAgentId,
        ...(rememberedView ? { activeMainView: rememberedView } : {}),
        messages: activeMessages,
        channelMessagesCache: nextCache,
        pendingApprovals: data.pendingApprovals || [],
        goals: data.goals || [],
        tasks: data.tasks || [],
        decisions: data.decisions || [],
        projectAnalytics: data.projectAnalytics,
        ollamaStatus: data.ollamaStatus || { online: false, models: [] },
        activeAgentChannels: data.activeAgentChannels || {},
        queuedMessages: data.queuedMessages || [],
        isConnected: true,
      });

      if (fetchStateRetryTimer) {
        clearTimeout(fetchStateRetryTimer);
        fetchStateRetryTimer = null;
      }

      if (!chosenChannelId.startsWith('dm-')) {
        await get().fetchChannelMembers(chosenChannelId);
        await get().fetchQueuedMessages(chosenChannelId);
      }

      await get().fetchArtifacts(data.activeProject?.id || targetProj);
      await get().fetchGitStatus(data.activeProject?.id || targetProj);
      await get().fetchUploads(data.activeProject?.id || targetProj);
      await get().fetchSchedules(data.activeProject?.id || targetProj);
      await get().fetchSkills();
      await get().fetchCustomTools();
      await get().fetchRoutines(data.activeProject?.id || targetProj);
      await get().fetchBrowserStatus();
      await get().fetchActiveRuns();
      await get().fetchSystemHealth();
      await get().fetchRecoveryState();
      await get().fetchCredentials();
      await get().fetchAvailableModels();
    } catch (err) {
      console.warn('[KIN UI] Could not connect to Core IPC server, retrying...', err);
      set({ isConnected: false });
      if (!fetchStateRetryTimer) {
        fetchStateRetryTimer = setTimeout(() => {
          fetchStateRetryTimer = null;
          get().fetchState();
        }, 3000);
      }
    }
  },

  setActiveMainView: (view: 'chat' | 'automations') => {
    const projId = get().activeProjectId;
    if (projId) {
      try {
        localStorage.setItem(`kin_main_view_${projId}`, view);
      } catch {}
    }
    set({ activeMainView: view });
  },

  fetchSystemHealth: async () => {
    try {
      const res = await fetch('/api/system/health');
      if (res.ok) {
        const data = await res.json();
        set({ systemHealth: data });
      }
    } catch (err) {
      console.warn('[KIN UI] Failed to fetch system health:', err);
    }
  },

  fetchSchedules: async (projectId?: string) => {
    const projId = projectId || get().activeProjectId;
    try {
      const res = await fetch(`/api/automations`);
      if (res.ok) {
        const data = await res.json();
        const scheds = data.automations || data.schedules || [];
        set({ schedules: scheds, routines: scheds });
      } else {
        const fallbackRes = await fetch(`/api/projects/${projId}/schedules`);
        if (fallbackRes.ok) {
          const fbData = await fallbackRes.json();
          const scheds = fbData.schedules || [];
          set({ schedules: scheds, routines: scheds });
        }
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch schedules:', err);
    }
  },

  setAutomationsModalOpen: (open: boolean) => set({ isAutomationsModalOpen: open }),

  createSchedule: async (params) => {
    const projId = get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projId}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create schedule' }));
        return { success: false, error: err.error || 'Failed to create schedule' };
      }
      const data = await res.json();
      if (data.schedule) {
        set((state) => ({
          schedules: [...state.schedules.filter((s) => s.id !== data.schedule.id), data.schedule],
          routines: [...state.routines.filter((r) => r.id !== data.schedule.id), data.schedule],
        }));
      }
      return { success: true, schedule: data.schedule };
    } catch (err: any) {
      console.error('[KIN UI] Failed to create schedule:', err);
      return { success: false, error: err.message };
    }
  },

  triggerScheduleNow: async (scheduleId: string) => {
    try {
      const res = await fetch(`/api/schedules/${scheduleId}/trigger`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to trigger schedule' }));
        return { success: false, error: err.error || 'Failed to trigger schedule' };
      }
      const data = await res.json();
      if (data.schedule) {
        set((state) => ({
          schedules: state.schedules.map((s) => (s.id === scheduleId ? { ...s, ...data.schedule } : s)),
        }));
      }
      return { success: true, schedule: data.schedule };
    } catch (err: any) {
      console.error('[KIN UI] Failed to trigger schedule:', err);
      return { success: false, error: err.message };
    }
  },

  retrySchedule: async (scheduleId: string) => {
    try {
      const res = await fetch(`/api/schedules/${scheduleId}/retry`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to retry schedule' }));
        return { success: false, error: err.error || 'Failed to retry schedule' };
      }
      const data = await res.json();
      if (data.schedule) {
        set((state) => ({
          schedules: state.schedules.map((s) => (s.id === scheduleId ? { ...s, ...data.schedule } : s)),
        }));
      }
      return { success: true, schedule: data.schedule };
    } catch (err: any) {
      console.error('[KIN UI] Failed to retry schedule:', err);
      return { success: false, error: err.message };
    }
  },

  fetchScheduleAttempts: async (scheduleId: string): Promise<ScheduleAttemptItem[]> => {
    try {
      const res = await fetch(`/api/schedules/${scheduleId}/attempts`);
      if (res.ok) {
        const data = await res.json();
        return data.attempts || [];
      }
      return [];
    } catch (err) {
      console.error('[KIN UI] Failed to fetch schedule attempts:', err);
      return [];
    }
  },

  cancelSchedule: async (scheduleId: string) => {
    try {
      const res = await fetch(`/api/schedules/${scheduleId}`, { method: 'DELETE' });
      if (res.ok) {
        set((state) => ({
          schedules: state.schedules.filter((s) => s.id !== scheduleId),
          routines: state.routines.filter((r) => r.id !== scheduleId),
        }));
      }
    } catch (err) {
      console.error('[KIN UI] Failed to cancel schedule:', err);
    }
  },

  fetchArtifacts: async (projectId?: string) => {
    const projId = projectId || get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projId}/artifacts`);
      if (res.ok) {
        const data = await res.json();
        set({ artifacts: data.artifacts || [] });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch artifacts:', err);
    }
  },

  selectArtifact: async (relativePath: string) => {
    const projId = get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projId}/artifacts/file?path=${encodeURIComponent(relativePath)}`);
      if (res.ok) {
        const data = await res.json();
        set({ selectedArtifact: data });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to load artifact content:', err);
    }
  },

  clearSelectedArtifact: () => set({ selectedArtifact: null }),
  setActiveRightTab: (tab) => set({ activeRightTab: tab }),

  fetchChannelMembers: async (channelId: string) => {
    if (channelId.startsWith('dm-')) return;
    try {
      const res = await fetch(`/api/channels/${channelId}/members`);
      if (res.ok) {
        const data = await res.json();
        set({ channelMembers: data.members || [] });
      }
    } catch (err) {
      console.error(`[KIN UI] Failed to fetch channel members for ${channelId}:`, err);
    }
  },

  createChannel: async (name: string, topic?: string) => {
    const projectId = get().activeProjectId;
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, name, topic }),
      });
      if (res.ok) {
        const data = await res.json();
        set({ isCreateChannelModalOpen: false });
        await get().fetchState();
        await get().setActiveChannel(data.channel.id);
      }
    } catch (err) {
      console.error('[KIN UI] Failed to create channel:', err);
    }
  },

  deleteChannel: async (channelId: string) => {
    try {
      const res = await fetch(`/api/channels/${channelId}`, { method: 'DELETE' });
      if (res.ok) {
        set((state) => ({
          channels: state.channels.filter((c) => c.id !== channelId),
          activeChannelId: state.activeChannelId === channelId ? 'chan-general' : state.activeChannelId,
        }));
        return { success: true };
      }
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || 'Failed to delete channel' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  addChannelMember: async (channelId: string, agentId: string) => {
    try {
      const res = await fetch(`/api/channels/${channelId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      if (res.ok) {
        set({ isAddAgentModalOpen: false });
        await get().fetchChannelMembers(channelId);
        await get().fetchState();
      }
    } catch (err) {
      console.error('[KIN UI] Failed to add channel member:', err);
    }
  },

  removeChannelMember: async (channelId: string, agentId: string) => {
    try {
      const res = await fetch(`/api/channels/${channelId}/members/${agentId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await get().fetchChannelMembers(channelId);
        await get().fetchState();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to remove member');
      }
    } catch (err) {
      console.error('[KIN UI] Failed to remove channel member:', err);
    }
  },

  hireAgent: async (params: {
    displayName: string;
    roleTitle: string;
    systemPrompt?: string;
    activeModelId?: string;
    channelId?: string;
  }) => {
    const projectId = get().activeProjectId;
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...params }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to hire agent' };
      }
      set({ isAddAgentModalOpen: false });
      if (params.channelId) {
        await get().fetchChannelMembers(params.channelId);
      }
      await get().fetchState();
      return { success: true };
    } catch (err: any) {
      console.error('[KIN UI] Failed to hire agent:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  decommissionAgent: async (agentId: string) => {
    try {
      const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to decommission agent' };
      }
      set((state) => {
        const remainingAgents = state.agents.filter((a) => a.id !== agentId);
        const fallbackAgentId = remainingAgents.find((a) => a.isOrchestrator)?.id || remainingAgents[0]?.id || '';
        const nextActive = { ...state.activeAgentChannels };
        delete nextActive[agentId];
        const nextThinking = { ...state.agentThinkingDrafts };
        delete nextThinking[agentId];
        const nextTools = { ...state.agentLiveTools };
        delete nextTools[agentId];
        return {
          agents: remainingAgents,
          channelMembers: state.channelMembers.filter((a) => a.id !== agentId),
          selectedAgentId: state.selectedAgentId === agentId ? fallbackAgentId : state.selectedAgentId,
          selectedSwarmAgentId: state.selectedSwarmAgentId === agentId ? fallbackAgentId : state.selectedSwarmAgentId,
          activeAgentChannels: nextActive,
          agentThinkingDrafts: nextThinking,
          agentLiveTools: nextTools,
          coordinationLinks: state.coordinationLinks.filter(
            (l) => l.fromAgentId !== agentId && l.targetAgentId !== agentId
          ),
        };
      });
      await get().fetchState();
      return { success: true };
    } catch (err: any) {
      console.error('[KIN UI] Failed to decommission agent:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  initSSE: () => {
    if (sseReconnectTimer) {
      clearTimeout(sseReconnectTimer);
      sseReconnectTimer = null;
    }
    if (eventSourceInstance) {
      eventSourceInstance.close();
      eventSourceInstance = null;
    }

    (async () => {
      try {
        const token = await getIpcToken();
        const base = getApiBaseUrl();
        const sseUrl = token ? `${base}/api/events?token=${encodeURIComponent(token)}` : `${base}/api/events`;
        const sse = new EventSource(sseUrl);
        eventSourceInstance = sse;

      sse.addEventListener('agent:deleted', (e) => {
        try {
          const { agentId } = JSON.parse(e.data);
          set((state) => {
            const remainingAgents = state.agents.filter((a) => a.id !== agentId);
            const fallbackAgentId = remainingAgents.find((a) => a.isOrchestrator)?.id || remainingAgents[0]?.id || '';
            const nextActive = { ...state.activeAgentChannels };
            delete nextActive[agentId];
            const nextThinking = { ...state.agentThinkingDrafts };
            delete nextThinking[agentId];
            const nextTools = { ...state.agentLiveTools };
            delete nextTools[agentId];
            return {
              agents: remainingAgents,
              channelMembers: state.channelMembers.filter((a) => a.id !== agentId),
              selectedAgentId: state.selectedAgentId === agentId ? fallbackAgentId : state.selectedAgentId,
              selectedSwarmAgentId: state.selectedSwarmAgentId === agentId ? fallbackAgentId : state.selectedSwarmAgentId,
              activeAgentChannels: nextActive,
              agentThinkingDrafts: nextThinking,
              agentLiveTools: nextTools,
              coordinationLinks: state.coordinationLinks.filter(
                (l) => l.fromAgentId !== agentId && l.targetAgentId !== agentId
              ),
            };
          });
        } catch {}
      });

      sse.addEventListener('agent:model_unavailable', (e) => {
        try {
          const data = JSON.parse(e.data);
          set({
            modelUnavailableNotice: {
              agentId: data.agentId,
              agentName: data.agentName || 'Agent',
              modelId: data.modelId,
              error: data.error,
              channelId: data.channelId,
            },
          });
        } catch {}
      });

      sse.addEventListener('agent:updated', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.agentId && data.activeModelId) {
            set((state) => ({
              agents: state.agents.map((a) => (a.id === data.agentId ? { ...a, activeModelId: data.activeModelId } : a)),
              channelMembers: state.channelMembers.map((a) => (a.id === data.agentId ? { ...a, activeModelId: data.activeModelId } : a)),
            }));
          }
        } catch {}
      });

      sse.addEventListener('models:updated', () => {
        get().fetchAvailableModels();
      });

      sse.addEventListener('autonomy:updated', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.autonomyMode) {
            set({ autonomyMode: data.autonomyMode });
          }
        } catch {}
      });

      sse.addEventListener('message:created', (e) => {
        try {
          const msg: MessageItem = JSON.parse(e.data);
          if (msg.senderType === 'agent' && msg.senderId && msg.content) {
            const allAgents = get().agents;
            const fromAgent = allAgents.find((a) => a.id === msg.senderId);
            const mentionMatches = msg.content.matchAll(/@([a-zA-Z0-9_-]+)/g);
            for (const match of mentionMatches) {
              const handle = match[1].toLowerCase();
              const mentionedAgent = allAgents.find(
                (a) => a.displayName.replace(/^@/, '').toLowerCase() === handle || a.id.toLowerCase() === handle
              );
              if (mentionedAgent && mentionedAgent.id !== msg.senderId) {
                const newLink: ActiveCoordinationLink = {
                  id: `mention-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  fromAgentId: msg.senderId,
                  fromAgentName: fromAgent?.displayName || msg.senderId,
                  targetAgentId: mentionedAgent.id,
                  targetAgentName: mentionedAgent.displayName,
                  directive: msg.content.slice(0, 100),
                  channelId: msg.channelId,
                  type: 'mention_request',
                  status: 'active',
                  timestamp: Date.now(),
                };
                set((state) => ({
                  coordinationLinks: [
                    newLink,
                    ...state.coordinationLinks.filter(
                      (l) => !(l.fromAgentId === newLink.fromAgentId && l.targetAgentId === newLink.targetAgentId)
                    ),
                  ].slice(0, 30),
                }));
              }
            }
          }
          set((state) => {
            const nextCache = { ...state.channelMessagesCache };
            const chanMsgs = nextCache[msg.channelId] || [];
            if (!chanMsgs.some((m) => m.id === msg.id)) {
              const updated = [...chanMsgs, msg];
              nextCache[msg.channelId] = updated.length > 500 ? updated.slice(-500) : updated;
            }

            const updatedChannels = state.channels.map((c) => {
              if (c.id === msg.channelId && c.id !== state.activeChannelId) {
                return { ...c, unreadCount: (c.unreadCount || 0) + 1 };
              }
              return c;
            });

            const shouldAppendToActive = msg.channelId === state.activeChannelId || !msg.channelId;
            const nextActiveMessages = shouldAppendToActive && !state.messages.some((m) => m.id === msg.id)
              ? (state.messages.length >= 500 ? [...state.messages.slice(-499), msg] : [...state.messages, msg])
              : state.messages;

            const nextDrafts = { ...state.streamingDrafts };
            const nextThinking = { ...state.thinkingDrafts };
            if (msg.channelId) {
              delete nextDrafts[msg.channelId];
              delete nextThinking[msg.channelId];
            }

            return {
              streamingDrafts: nextDrafts,
              thinkingDrafts: nextThinking,
              messages: nextActiveMessages,
              channels: updatedChannels,
              channelMessagesCache: nextCache,
            };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse message:created event', err);
        }
      });

      sse.addEventListener('agent:token', (e) => {
        try {
          const { channelId, token } = JSON.parse(e.data);
          if (channelId && token) {
            set((state) => ({
              streamingDrafts: {
                ...state.streamingDrafts,
                [channelId]: (state.streamingDrafts[channelId] || '') + token,
              },
            }));
          }
        } catch {}
      });

      sse.addEventListener('agent:thinking_token', (e) => {
        try {
          const { agentId, channelId, token } = JSON.parse(e.data);
          if (token) {
            set((state) => {
              const nextAgentThinking = { ...state.agentThinkingDrafts };
              if (agentId) {
                nextAgentThinking[agentId] = (nextAgentThinking[agentId] || '') + token;
              }
              const nextChanThinking = channelId
                ? { ...state.thinkingDrafts, [channelId]: (state.thinkingDrafts[channelId] || '') + token }
                : state.thinkingDrafts;

              return {
                agentThinkingDrafts: nextAgentThinking,
                thinkingDrafts: nextChanThinking,
                agents: agentId
                  ? state.agents.map((a) => (a.id === agentId ? { ...a, status: 'thinking' } : a))
                  : state.agents,
              };
            });
          }
        } catch {}
      });

      sse.addEventListener('message:queued', (e) => {
        try {
          const { message } = JSON.parse(e.data);
          if (message) {
            set((state) => ({
              queuedMessages: state.queuedMessages.some((q) => q.id === message.id)
                ? state.queuedMessages
                : [...state.queuedMessages, message],
            }));
          }
        } catch {}
      });

      sse.addEventListener('queue:dequeued', (e) => {
        try {
          const { messageId } = JSON.parse(e.data);
          if (messageId) {
            set((state) => ({
              queuedMessages: state.queuedMessages.filter((q) => q.id !== messageId),
            }));
          }
        } catch {}
      });

      sse.addEventListener('queue:deleted', (e) => {
        try {
          const { messageId } = JSON.parse(e.data);
          if (messageId) {
            set((state) => ({
              queuedMessages: state.queuedMessages.filter((q) => q.id !== messageId),
            }));
          }
        } catch {}
      });

      sse.addEventListener('agent:state', (e) => {
        try {
          const { agentId, channelId, status } = JSON.parse(e.data);
          set((state) => {
            const nextActive = { ...state.activeAgentChannels };
            const nextDrafts = { ...state.streamingDrafts };
            const nextThinking = { ...state.thinkingDrafts };
            const nextAgentThinking = { ...state.agentThinkingDrafts };
            const nextLiveTools = { ...state.agentLiveTools };

            if (status === 'thinking' || status === 'working') {
              if (channelId) nextActive[agentId] = channelId;
            } else {
              delete nextActive[agentId];
              delete nextAgentThinking[agentId];
              delete nextLiveTools[agentId];
              if (channelId) {
                delete nextDrafts[channelId];
                delete nextThinking[channelId];
              }
            }

            // Transition active coordination links involving this agent to 'completed' when agent goes idle
            const nextCoordinationLinks = status === 'idle'
              ? state.coordinationLinks.map((l) =>
                  (l.targetAgentId === agentId || l.fromAgentId === agentId) && l.status === 'active'
                    ? { ...l, status: 'completed' as const }
                    : l
                )
              : state.coordinationLinks;

            return {
              activeAgentChannels: nextActive,
              streamingDrafts: nextDrafts,
              thinkingDrafts: nextThinking,
              agentThinkingDrafts: nextAgentThinking,
              agentLiveTools: nextLiveTools,
              coordinationLinks: nextCoordinationLinks,
              agents: state.agents.map((a) => (a.id === agentId ? { ...a, status } : a)),
              channelMembers: state.channelMembers.map((a) => (a.id === agentId ? { ...a, status } : a)),
            };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:state event', err);
        }
      });

      sse.addEventListener('agent:updated', (e) => {
        try {
          const data = JSON.parse(e.data);
          set((state) => ({
            agents: state.agents.map((a) => (a.id === data.agentId ? { ...a, ...data } : a)),
            channelMembers: state.channelMembers.map((a) => (a.id === data.agentId ? { ...a, ...data } : a)),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:updated event', err);
        }
      });

      sse.addEventListener('system:recovery-state', (e) => {
        try {
          const data = JSON.parse(e.data);
          set({ pendingRecoveries: data.pendingRecoveries || [] });
        } catch {}
      });

      sse.addEventListener('quota:paused', (e) => {
        try {
          const data = JSON.parse(e.data);
          set((state) => {
            const foundAgent = state.agents.find((a) => a.id === data.agentId);
            const agentName = data.agentName || foundAgent?.displayName || data.agentId;
            const provider = data.provider || (data.modelId?.includes('/') ? data.modelId.split('/')[0] : 'frontier API');
            return {
              quotaPauseState: {
                isPaused: true,
                runId: data.runId,
                agentId: data.agentId,
                agentName,
                provider,
                channelId: data.channelId,
                turn: data.turn,
                quotaResetsAt: data.quotaResetsAt,
                modelId: data.modelId,
              },
            };
          });
        } catch {}
      });

      sse.addEventListener('quota:resumed', (e) => {
        try {
          const data = JSON.parse(e.data);
          set((state) => ({
            quotaPauseState: state.quotaPauseState?.runId === data.runId ? null : state.quotaPauseState,
          }));
        } catch {}
      });

      sse.addEventListener('agent:evaluation_created', (e) => {
        try {
          const evalItem: AgentEvaluationItem = JSON.parse(e.data);
          set((state) => {
            const nextEvals = { ...state.agentEvaluations };
            const list = nextEvals[evalItem.agentId] || [];
            nextEvals[evalItem.agentId] = [evalItem, ...list.filter((x) => x.id !== evalItem.id)].slice(0, 50);
            return { agentEvaluations: nextEvals };
          });
        } catch {}
      });

      sse.addEventListener('credential:created', (e) => {
        try {
          const cred: ManagedCredentialItem = JSON.parse(e.data);
          set((state) => ({
            credentials: [cred, ...state.credentials.filter((c) => c.id !== cred.id)],
          }));
        } catch {}
      });

      sse.addEventListener('credential:updated', (e) => {
        try {
          const cred: ManagedCredentialItem = JSON.parse(e.data);
          set((state) => ({
            credentials: state.credentials.map((c) => (c.id === cred.id ? cred : c)),
          }));
        } catch {}
      });

      sse.addEventListener('credential:deleted', (e) => {
        try {
          const { id } = JSON.parse(e.data);
          set((state) => ({
            credentials: state.credentials.filter((c) => c.id !== id),
          }));
        } catch {}
      });

      sse.addEventListener('grill_me:session', (e) => {
        try {
          const session: GrillMeSession = JSON.parse(e.data);
          set({ grillMeSession: session });
        } catch {}
      });

      sse.addEventListener('agent:tool_start', (e) => {
        try {
          const data = JSON.parse(e.data);
          set((state) => ({
            agentLiveTools: {
              ...state.agentLiveTools,
              [data.agentId]: { toolName: data.toolName, params: data.params },
            },
            agents: state.agents.map((a) => (a.id === data.agentId ? { ...a, status: 'working', currentTool: data.toolName } : a)),
            channelMembers: state.channelMembers.map((a) => (a.id === data.agentId ? { ...a, status: 'working', currentTool: data.toolName } : a)),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:tool_start event', err);
        }
      });

      sse.addEventListener('agent:tool_end', (e) => {
        try {
          const data = JSON.parse(e.data);
          set((state) => {
            const nextTools = { ...state.agentLiveTools };
            delete nextTools[data.agentId];
            return {
              agentLiveTools: nextTools,
              agents: state.agents.map((a) => (a.id === data.agentId ? { ...a, currentTool: undefined } : a)),
              channelMembers: state.channelMembers.map((a) => (a.id === data.agentId ? { ...a, currentTool: undefined } : a)),
            };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:tool_end event', err);
        }
      });

      sse.addEventListener('agent:created', () => {
        get().fetchState();
      });

      sse.addEventListener('channel:created', () => {
        get().fetchState();
      });

      sse.addEventListener('channel:deleted', (e) => {
        try {
          const { channelId } = JSON.parse(e.data);
          set((state) => ({
            channels: state.channels.filter((c) => c.id !== channelId),
            activeChannelId: state.activeChannelId === channelId ? 'chan-general' : state.activeChannelId,
          }));
        } catch {
          get().fetchState();
        }
      });

      sse.addEventListener('channel:member_added', (e) => {
        try {
          const { channelId } = JSON.parse(e.data);
          if (channelId === get().activeChannelId) {
            get().fetchChannelMembers(channelId);
          }
          get().fetchState();
        } catch {}
      });

      sse.addEventListener('channel:member_removed', (e) => {
        try {
          const { channelId } = JSON.parse(e.data);
          if (channelId === get().activeChannelId) {
            get().fetchChannelMembers(channelId);
          }
          get().fetchState();
        } catch {}
      });

      sse.addEventListener('ollama:status', (e) => {
        try {
          const status: OllamaStatus = JSON.parse(e.data);
          set({ ollamaStatus: status });
        } catch (err) {
          console.error('[KIN UI] Failed to parse ollama:status event', err);
        }
      });

      sse.addEventListener('project:created', () => {
        get().fetchState();
      });

      sse.addEventListener('project:deleted', () => {
        get().fetchState();
      });

      sse.addEventListener('project:activated', (e) => {
        try {
          const { projectId } = JSON.parse(e.data);
          if (projectId && projectId !== get().activeProjectId) {
            get().setActiveProject(projectId);
          }
        } catch (err) {
          console.error('[KIN UI] Failed to handle project:activated event', err);
        }
      });

      sse.addEventListener('goal:created', (e) => {
        try {
          const goal = JSON.parse(e.data);
          set((state) => {
            if (state.goals.some((g) => g.id === goal.id)) {
              return { goals: state.goals.map((g) => (g.id === goal.id ? { ...g, ...goal } : g)) };
            }
            return { goals: [...state.goals, goal] };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse goal:created event', err);
        }
      });

      sse.addEventListener('goal:updated', (e) => {
        try {
          const goal = JSON.parse(e.data);
          set((state) => {
            const exists = state.goals.some((g) => g.id === goal.id);
            if (exists) {
              return { goals: state.goals.map((g) => (g.id === goal.id ? { ...g, ...goal } : g)) };
            }
            return { goals: [...state.goals, goal] };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse goal:updated event', err);
        }
      });

      sse.addEventListener('goal:deleted', (e) => {
        try {
          const { goalId } = JSON.parse(e.data);
          set((state) => ({
            goals: state.goals.filter((g) => g.id !== goalId),
            tasks: state.tasks.filter((t) => t.goalId !== goalId),
          }));
        } catch {
          get().fetchState();
        }
      });

      sse.addEventListener('decision:created', (e) => {
        try {
          const decision = JSON.parse(e.data);
          set((state) => {
            if (state.decisions.some((d) => d.id === decision.id)) {
              return { decisions: state.decisions.map((d) => (d.id === decision.id ? { ...d, ...decision } : d)) };
            }
            return { decisions: [decision, ...state.decisions] };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse decision:created event', err);
        }
      });

      sse.addEventListener('decision:updated', (e) => {
        try {
          const decision = JSON.parse(e.data);
          set((state) => ({
            decisions: state.decisions.map((d) => (d.id === decision.id ? { ...d, ...decision } : d)),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse decision:updated event', err);
        }
      });

      sse.addEventListener('decision:deleted', (e) => {
        try {
          const { decisionId } = JSON.parse(e.data);
          set((state) => ({
            decisions: state.decisions.filter((d) => d.id !== decisionId),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse decision:deleted event', err);
        }
      });

      sse.addEventListener('task:created', (e) => {
        try {
          const task = JSON.parse(e.data);
          set((state) => {
            if (state.tasks.some((t) => t.id === task.id)) {
              return { tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) };
            }
            return { tasks: [...state.tasks, task] };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse task:created event', err);
        }
      });

      sse.addEventListener('task:updated', (e) => {
        try {
          const payload = JSON.parse(e.data);
          const taskId = payload.taskId || payload.id;
          set((state) => ({
            tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...payload, id: t.id } : t)),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse task:updated event', err);
        }
      });

      sse.addEventListener('task:cleared_for_goal', (e) => {
        try {
          const { goalId } = JSON.parse(e.data);
          set((state) => ({
            tasks: state.tasks.filter((t) => t.goalId !== goalId),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse task:cleared_for_goal event', err);
        }
      });

      sse.addEventListener('task:deleted', (e) => {
        try {
          const { taskId } = JSON.parse(e.data);
          set((state) => ({
            tasks: state.tasks.filter((t) => t.id !== taskId),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse task:deleted event', err);
        }
      });

      sse.addEventListener('system:recovered', () => {
        get().fetchState();
      });

      sse.addEventListener('approval:created', (e) => {
        try {
          const approval = JSON.parse(e.data);
          const apprProj = approval.projectId || approval.project_id;
          set((state) => {
            const currentProj = state.activeProjectId || 'proj-kin';
            if (apprProj && apprProj !== currentProj) return state;
            if (state.pendingApprovals.some((a) => a.id === approval.id)) return state;
            return {
              pendingApprovals: [
                ...state.pendingApprovals,
                { ...approval, projectId: apprProj || currentProj },
              ],
            };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse approval:created event', err);
        }
      });

      sse.addEventListener('approval:resolved', (e) => {
        try {
          const { approvalId } = JSON.parse(e.data);
          set((state) => ({
            pendingApprovals: state.pendingApprovals.filter((a) => a.id !== approvalId),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse approval:resolved event', err);
        }
      });

      sse.addEventListener('steer:received', (e) => {
        try {
          const data = JSON.parse(e.data);
          set({ steerNotification: { channelId: data.channelId, directive: data.directive } });
          setTimeout(() => {
            get().clearSteerNotification();
          }, 5000);
        } catch (err) {
          console.error('[KIN UI] Failed to parse steer:received event', err);
        }
      });

      sse.addEventListener('operator:notification', (e) => {
        try {
          const data = JSON.parse(e.data);
          get().fetchState();
          if (data.channelId && data.message) {
            set({ steerNotification: { channelId: data.channelId, directive: data.message } });
            setTimeout(() => {
              get().clearSteerNotification();
            }, 6000);
          }
        } catch (err) {
          console.error('[KIN UI] Failed to parse operator:notification event', err);
        }
      });

      sse.addEventListener('git:changed', () => {
        get().fetchGitStatus();
        if (get().activeGitDiff) {
          get().fetchGitDiff(get().activeGitDiff!.path);
        }
      });

      sse.addEventListener('upload:created', (e) => {
        try {
          const item: UploadItem = JSON.parse(e.data);
          set((state) => {
            if (state.uploads.some((u) => u.id === item.id)) return state;
            return { uploads: [item, ...state.uploads] };
          });
        } catch {}
      });

      sse.addEventListener('upload:deleted', (e) => {
        try {
          const { uploadId } = JSON.parse(e.data);
          set((state) => ({
            uploads: state.uploads.filter((u) => u.id !== uploadId),
          }));
        } catch {}
      });

      sse.addEventListener('schedule:created', (e) => {
        try {
          const sched: ScheduleItem = JSON.parse(e.data);
          set((state) => ({
            schedules: [...state.schedules.filter((s) => s.id !== sched.id), sched],
            routines: [...state.routines.filter((s) => s.id !== sched.id), sched],
          }));
        } catch {}
      });

      sse.addEventListener('schedule:fired', (e) => {
        try {
          const sched: ScheduleItem = JSON.parse(e.data);
          const update = (items: ScheduleItem[]) => items.map((s) => (s.id === sched.id ? { ...s, ...sched, status: sched.status || (sched.type === 'one_shot' ? 'completed' : s.status) } : s));
          set((state) => ({
            schedules: update(state.schedules),
            routines: update(state.routines),
          }));
        } catch {}
      });

      sse.addEventListener('schedule:cancelled', (e) => {
        try {
          const { scheduleId } = JSON.parse(e.data);
          set((state) => ({
            schedules: state.schedules.filter((s) => s.id !== scheduleId),
            routines: state.routines.filter((s) => s.id !== scheduleId),
          }));
        } catch {}
      });

      sse.addEventListener('channel:routing', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.channelId && data.routing) {
            set((state) => ({
              latestRoutingByChannel: {
                ...state.latestRoutingByChannel,
                [data.channelId]: data,
              },
            }));
          }
        } catch (err) {
          console.error('[KIN UI] Failed to parse channel:routing event', err);
        }
      });

      sse.addEventListener('agent:anti_loop', (e) => {
        try {
          const data = JSON.parse(e.data);
          set((state) => ({
            latestAntiLoopEvent: data,
            steerNotification: data.channelId
              ? {
                  channelId: data.channelId,
                  directive: `Loop intervention: ${data.reason || 'Repeated pattern detected'}`,
                }
              : state.steerNotification,
          }));
          if (data.channelId) {
            setTimeout(() => {
              get().clearSteerNotification();
            }, 5000);
          }
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:anti_loop event', err);
        }
      });

      sse.addEventListener('agent:delegation_started', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.targetAgentId && data.channelId) {
            const allAgents = get().agents;
            const fromAg = allAgents.find((a) => a.id === data.fromAgentId);
            const toAg = allAgents.find((a) => a.id === data.targetAgentId);
            const newLink: ActiveCoordinationLink = {
              id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              fromAgentId: data.fromAgentId,
              fromAgentName: fromAg?.displayName || data.fromAgentId,
              targetAgentId: data.targetAgentId,
              targetAgentName: toAg?.displayName || data.targetAgentName || data.targetAgentId,
              directive: data.directive || 'Active Task Delegation',
              channelId: data.channelId,
              type: 'direct_delegation',
              status: 'active',
              timestamp: Date.now(),
            };
            set((state) => ({
              latestDelegation: data,
              coordinationLinks: [
                newLink,
                ...state.coordinationLinks.filter(
                  (l) => !(l.fromAgentId === newLink.fromAgentId && l.targetAgentId === newLink.targetAgentId)
                ),
              ].slice(0, 30),
              activeAgentChannels: {
                ...state.activeAgentChannels,
                [data.targetAgentId]: data.channelId,
              },
            }));
          }
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:delegation_started event', err);
        }
      });

      sse.addEventListener('routine:created', (e) => {
        try {
          const sched: ScheduleItem = JSON.parse(e.data);
          set((state) => ({
            schedules: [...state.schedules.filter((s) => s.id !== sched.id), sched],
            routines: [...state.routines.filter((s) => s.id !== sched.id), sched],
          }));
        } catch {}
      });

      sse.addEventListener('routine:fired', (e) => {
        try {
          const sched: ScheduleItem = JSON.parse(e.data);
          const update = (items: ScheduleItem[]) => items.map((s) => (s.id === sched.id ? { ...s, ...sched } : s));
          set((state) => ({
            schedules: update(state.schedules),
            routines: update(state.routines),
          }));
        } catch {}
      });

      sse.addEventListener('routine:cancelled', (e) => {
        try {
          const { routineId } = JSON.parse(e.data);
          set((state) => ({
            schedules: state.schedules.filter((s) => s.id !== routineId),
            routines: state.routines.filter((s) => s.id !== routineId),
          }));
        } catch {}
      });

      // Instant Human Takeover & Live Tool Previews
      sse.addEventListener('agent:tool_preview', (e) => {
        try {
          const data = JSON.parse(e.data);
          const isCritical = data.preview?.riskLevel === 'CRITICAL';
          const isAuth =
            data.toolName?.startsWith('browser') &&
            (/login|signin|auth|oauth|verify|account|recaptcha/i.test(data.preview?.target || '') ||
              /login|password|auth/i.test(JSON.stringify(data.preview?.paramsSummary || {})));

          set((state) => {
            const nextTakeover: TakeoverState = {
              runId: data.runId,
              agentId: data.agentId,
              channelId: data.channelId,
              isPaused: state.activeTakeovers[data.runId]?.isPaused || false,
              isAborted: false,
              activeTool: data.toolName,
              previewPayload: data.preview,
              authRequired: isAuth,
              authInstructions: isAuth
                ? 'Authentication / Human sign-in barrier detected. Please complete verification in the browser window, then click Resume.'
                : undefined,
              financialGate: isCritical,
              riskLevel: data.preview?.riskLevel,
            };
            const nextTakeovers: Record<string, TakeoverState> = { ...state.activeTakeovers, [data.runId]: nextTakeover };
            const currentChanTakeover = (Object.values(nextTakeovers) as TakeoverState[]).find((t) => t.channelId === state.activeChannelId) || null;
            return {
              activeTakeovers: nextTakeovers,
              activeTakeover: currentChanTakeover || (state.activeTakeover?.runId === data.runId ? nextTakeover : state.activeTakeover),
            };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:tool_preview event', err);
        }
      });

      sse.addEventListener('run:started', (e) => {
        try {
          const data = JSON.parse(e.data);
          set((state) => {
            const nextTakeover: TakeoverState = {
              runId: data.runId,
              agentId: data.agentId,
              channelId: data.channelId,
              isPaused: false,
              isAborted: false,
            };
            const nextTakeovers: Record<string, TakeoverState> = { ...state.activeTakeovers, [data.runId]: nextTakeover };
            const currentChanTakeover = (Object.values(nextTakeovers) as TakeoverState[]).find((t) => t.channelId === state.activeChannelId) || null;
            return {
              activeTakeovers: nextTakeovers,
              activeTakeover: currentChanTakeover || (data.channelId === state.activeChannelId ? nextTakeover : state.activeTakeover),
            };
          });
        } catch {}
      });

      sse.addEventListener('takeover:paused', (e) => {
        try {
          const { runId } = JSON.parse(e.data);
          set((state) => {
            const existing = state.activeTakeovers[runId];
            const updated: TakeoverState = existing
              ? { ...existing, isPaused: true }
              : { runId, isPaused: true, isAborted: false };
            const nextTakeovers: Record<string, TakeoverState> = { ...state.activeTakeovers, [runId]: updated };
            const currentChanTakeover = (Object.values(nextTakeovers) as TakeoverState[]).find((t) => t.channelId === state.activeChannelId) || null;
            return {
              activeTakeovers: nextTakeovers,
              activeTakeover: currentChanTakeover || (state.activeTakeover?.runId === runId ? updated : state.activeTakeover),
            };
          });
        } catch {}
      });

      sse.addEventListener('takeover:resumed', (e) => {
        try {
          const { runId } = JSON.parse(e.data);
          set((state) => {
            const existing = state.activeTakeovers[runId];
            if (!existing) return state;
            const updated: TakeoverState = { ...existing, isPaused: false, authRequired: false };
            const nextTakeovers: Record<string, TakeoverState> = { ...state.activeTakeovers, [runId]: updated };
            const currentChanTakeover = (Object.values(nextTakeovers) as TakeoverState[]).find((t) => t.channelId === state.activeChannelId) || null;
            return {
              activeTakeovers: nextTakeovers,
              activeTakeover: currentChanTakeover || (state.activeTakeover?.runId === runId ? updated : state.activeTakeover),
            };
          });
        } catch {}
      });

      sse.addEventListener('takeover:aborted', (e) => {
        try {
          const { runId } = JSON.parse(e.data);
          set((state) => {
            const existing = state.activeTakeovers[runId];
            const updated: TakeoverState = existing
              ? { ...existing, isAborted: true, isPaused: false }
              : { runId, isPaused: false, isAborted: true };
            const nextTakeovers: Record<string, TakeoverState> = { ...state.activeTakeovers, [runId]: updated };
            const currentChanTakeover = (Object.values(nextTakeovers) as TakeoverState[]).find((t) => t.channelId === state.activeChannelId) || null;
            return {
              activeTakeovers: nextTakeovers,
              activeTakeover: currentChanTakeover || (state.activeTakeover?.runId === runId ? updated : state.activeTakeover),
            };
          });
          setTimeout(() => {
            set((state) => {
              const nextTakeovers: Record<string, TakeoverState> = { ...state.activeTakeovers };
              delete nextTakeovers[runId];
              const currentChanTakeover = (Object.values(nextTakeovers) as TakeoverState[]).find((t) => t.channelId === state.activeChannelId) || null;
              return {
                activeTakeovers: nextTakeovers,
                activeTakeover: state.activeTakeover?.runId === runId ? currentChanTakeover : state.activeTakeover,
              };
            });
          }, 2500);
        } catch {}
      });

      sse.addEventListener('takeover:finished', (e) => {
        try {
          const { runId } = JSON.parse(e.data);
          set((state) => {
            const nextTakeovers: Record<string, TakeoverState> = { ...state.activeTakeovers };
            delete nextTakeovers[runId];
            const currentChanTakeover = (Object.values(nextTakeovers) as TakeoverState[]).find((t) => t.channelId === state.activeChannelId) || null;
            return {
              activeTakeovers: nextTakeovers,
              activeTakeover: state.activeTakeover?.runId === runId ? currentChanTakeover : state.activeTakeover,
            };
          });
        } catch {}
      });

      // Skills Engine Updates
      sse.addEventListener('skill:created', () => {
        get().fetchSkills();
      });

      // Models Catalog Updates
      sse.addEventListener('models:updated', () => {
        get().fetchAvailableModels();
      });

      sse.addEventListener('skill:updated', () => {
        get().fetchSkills();
      });

      sse.addEventListener('skill:imported', () => {
        get().fetchSkills();
      });

      sse.addEventListener('skill:deleted', (e) => {
        try {
          const { skillId } = JSON.parse(e.data);
          set((state) => ({
            skills: state.skills.filter((s) => s.id !== skillId),
          }));
        } catch {}
      });

      // Custom Tools Dynamic Updates
      sse.addEventListener('custom_tool:created', (e) => {
        try {
          const tool = JSON.parse(e.data);
          set((state) => ({
            customTools: [...state.customTools.filter((t) => t.id !== tool.id), tool],
          }));
        } catch {}
      });

      sse.addEventListener('custom_tool:deleted', (e) => {
        try {
          const { id } = JSON.parse(e.data);
          set((state) => ({
            customTools: state.customTools.filter((t) => t.id !== id),
          }));
        } catch {}
      });

      // MCP Connectors Updates
      sse.addEventListener('mcp:connectors_updated', () => {
        get().fetchMcpConnectors().catch(() => {});
        get().fetchMcpData().catch(() => {});
      });

      // Proactive Routines Updates
      sse.addEventListener('routine:created', () => {
        get().fetchRoutines();
      });

      sse.addEventListener('routine:fired', () => {
        get().fetchRoutines();
      });

      sse.addEventListener('routine:cancelled', (e) => {
        try {
          const { routineId } = JSON.parse(e.data);
          set((state) => ({
            routines: state.routines.filter((r) => r.id !== routineId),
          }));
        } catch {}
      });

      // Browser Telemetry Updates
      sse.addEventListener('browser:navigated', () => {
        get().fetchBrowserStatus();
      });

      sse.addEventListener('browser:step', () => {
        get().fetchBrowserStatus();
      });

      sse.addEventListener('browser:closed', () => {
        get().fetchBrowserStatus();
      });

      sse.onopen = () => {
        sseReconnectAttempts = 0;
        set({ isConnected: true });
        get().fetchState();
        const activeChan = get().activeChannelId;
        if (activeChan) {
          fetch(`/api/channels/${activeChan}/messages`)
            .then((r) => r.json())
            .then((data) => {
              if (get().activeChannelId === activeChan && data.messages) {
                set((state) => ({
                  messages: data.messages,
                  channelMessagesCache: { ...state.channelMessagesCache, [activeChan]: data.messages },
                }));
              }
            })
            .catch(() => {});
        }
      };

      sse.onerror = () => {
        set({ isConnected: false });
        if (eventSourceInstance === sse) {
          try { sse.close(); } catch {}
          eventSourceInstance = null;
        }
        if (sseReconnectTimer) {
          clearTimeout(sseReconnectTimer);
        }
        const delay = Math.min(15000, 1000 * Math.pow(1.5, sseReconnectAttempts++)) + Math.floor(Math.random() * 500);
        sseReconnectTimer = setTimeout(() => {
          sseReconnectTimer = null;
          console.log(`[KIN UI] EventSource connection error or disconnect, auto-reconnecting (attempt ${sseReconnectAttempts}, delay ${delay}ms)...`);
          get().initSSE();
        }, delay);
      };
    } catch (err) {
      console.error('[KIN UI] SSE connection error:', err);
    }
    })();
  },

  closeSSE: () => {
    sseReconnectAttempts = 0;
    if (sseReconnectTimer) {
      clearTimeout(sseReconnectTimer);
      sseReconnectTimer = null;
    }
    if (eventSourceInstance) {
      try {
        eventSourceInstance.close();
      } catch {}
      eventSourceInstance = null;
    }
    set({ isConnected: false });
  },

  setActiveChannel: async (channelId: string) => {
    const projId = get().activeProjectId;
    if (projId && channelId) {
      try {
        localStorage.setItem(`kin_last_channel_${projId}`, channelId);
      } catch {}
    }
    set((state) => {
      const channelTakeover = Object.values(state.activeTakeovers || {}).find((t) => t.channelId === channelId) || null;
      const cached = state.channelMessagesCache[channelId];
      return {
        activeChannelId: channelId,
        channels: state.channels.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)),
        activeTakeover: channelTakeover,
        messages: cached && cached.length > 0 ? cached : state.messages.filter((m) => m.channelId === channelId),
      };
    });
    try {
      const res = await fetch(`/api/channels/${channelId}/messages`);
      if (res.ok) {
        const data = await res.json();
        const serverMsgs: MessageItem[] = data.messages || [];
        set((state) => {
          const nextCache = { ...state.channelMessagesCache, [channelId]: serverMsgs };
          if (state.activeChannelId === channelId) {
            return {
              messages: serverMsgs,
              channelMessagesCache: nextCache,
            };
          }
          return { channelMessagesCache: nextCache };
        });
      }
      if (!channelId.startsWith('dm-')) {
        await get().fetchChannelMembers(channelId);
        await get().fetchQueuedMessages(channelId);
      }
    } catch (err) {
      console.error(`[KIN UI] Failed to load messages for channel ${channelId}:`, err);
    }
  },

  setActiveProject: async (projectId: string) => {
    // 1. Remember the active channel of the project being left
    const currentProj = get().activeProjectId;
    const currentChan = get().activeChannelId;
    if (currentProj && currentChan) {
      try {
        localStorage.setItem(`kin_last_channel_${currentProj}`, currentChan);
      } catch {}
    }

    // 2. Check if the target project already has a remembered active channel, agent, and view
    const rememberedChannelId = (() => {
      try {
        return localStorage.getItem(`kin_last_channel_${projectId}`);
      } catch {
        return null;
      }
    })();

    const rememberedAgentId = (() => {
      try {
        return localStorage.getItem(`kin_selected_agent_${projectId}`);
      } catch {
        return null;
      }
    })();

    const rememberedView = (() => {
      try {
        return localStorage.getItem(`kin_main_view_${projectId}`) as 'chat' | 'automations' | null;
      } catch {
        return null;
      }
    })();

    set({
      activeProjectId: projectId,
      activeChannelId: rememberedChannelId || '',
      selectedAgentId: rememberedAgentId || '',
      ...(rememberedView ? { activeMainView: rememberedView } : {}),
      channelMembers: [],
      activeGitDiff: null,
      selectedArtifact: null,
      channelMessagesCache: {},
      pendingApprovals: [],
      coordinationLinks: [],
      agentThinkingDrafts: {},
      agentLiveTools: {},
      latestDelegation: null,
      selectedSwarmAgentId: '',
    });
    try {
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/activate`, { method: 'POST' });
    } catch {}
    await get().fetchState(projectId);
    await get().fetchGitStatus(projectId);
    await get().fetchUploads(projectId);
    await get().fetchMcpConnectors(projectId);
  },

  createProject: async (name: string, repoPath?: string) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, repoPath }),
      });
      if (res.ok) {
        const data = await res.json();
        set({ isNewProjectModalOpen: false });
        await get().fetchState(data.project.id);
      }
    } catch (err) {
      console.error('[KIN UI] Failed to create project:', err);
    }
  },

  deleteProject: async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (res.ok) {
        await get().fetchState();
      }
    } catch (err) {
      console.error('[KIN UI] Failed to delete project:', err);
    }
  },

  startOllama: async () => {
    try {
      const res = await fetch('/api/system/ollama/start', { method: 'POST' });
      const data = await res.json();
      set({ ollamaStatus: data });
    } catch (err) {
      console.error('[KIN UI] Failed to start Ollama server:', err);
    }
  },

  runTerminalCommand: async (command: string) => {
    try {
      const activeProject = get().activeProject;
      const res = await fetch('/api/system/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, cwd: activeProject?.repoPath }),
      });
      const data = await res.json();
      const combinedOutput = [data.stdout, data.stderr, data.error].filter(Boolean).join('\n');
      const exitCode = typeof data.exitCode === 'number' ? data.exitCode : res.ok ? 0 : 1;
      const output = combinedOutput || (exitCode === 0 ? 'Command completed.' : `Exit code ${exitCode}`);
      set((state) => ({
        terminalHistory: [...state.terminalHistory, { command, output, exitCode }].slice(-100),
      }));
    } catch (err: any) {
      set((state) => ({
        terminalHistory: [...state.terminalHistory, { command, output: err?.message || 'Execution error', exitCode: 1 }].slice(-100),
      }));
    }
  },

  updateAgentContract: async (agentId: string, roleTitle: string, activeModelId: string, systemPrompt?: string) => {
    // Optimistic update
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, role: roleTitle, activeModelId, systemPrompt: systemPrompt || a.systemPrompt } : a
      ),
      channelMembers: state.channelMembers.map((a) =>
        a.id === agentId ? { ...a, role: roleTitle, activeModelId, systemPrompt: systemPrompt || a.systemPrompt } : a
      ),
    }));

    try {
      await fetch(`/api/agents/${agentId}/contract`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleTitle, activeModelId, systemPrompt }),
      });
    } catch (err) {
      console.error('[KIN UI] Failed to update agent contract:', err);
      get().fetchState();
    }
  },

  fetchQueuedMessages: async (channelId?: string) => {
    const cId = channelId || get().activeChannelId;
    if (!cId) return;
    try {
      const res = await fetch(`/api/channels/${cId}/queue`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.queuedMessages)) {
          set({ queuedMessages: data.queuedMessages });
        }
      }
    } catch (err) {
      console.warn('[KIN UI] Notice fetching queued messages:', err);
    }
  },

  queueMessage: async (channelId: string, content: string) => {
    if (!content.trim()) return;
    try {
      const res = await fetch(`/api/channels/${channelId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          set((state) => ({
            queuedMessages: state.queuedMessages.some((q) => q.id === data.message.id)
              ? state.queuedMessages
              : [...state.queuedMessages, data.message],
          }));
          return;
        }
      }
    } catch (err) {
      console.warn('[KIN UI] Notice posting to queue endpoint, using local fallback:', err);
    }
    const item: QueuedMessage = {
      id: `qm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      channelId,
      content: content.trim(),
      createdAt: Date.now(),
    };
    set((state) => ({ queuedMessages: [...state.queuedMessages, item] }));
  },

  dequeueMessage: async (id: string, channelId?: string) => {
    const cId = channelId || get().queuedMessages.find((q) => q.id === id)?.channelId || get().activeChannelId;
    set((state) => ({ queuedMessages: state.queuedMessages.filter((q) => q.id !== id) }));
    try {
      await fetch(`/api/channels/${cId}/queue/${id}`, { method: 'DELETE' });
    } catch {}
  },

  promoteQueuedToSteer: async (id: string) => {
    const item = get().queuedMessages.find((q) => q.id === id);
    if (!item) return;
    get().dequeueMessage(id, item.channelId);
    await get().sendMessage(item.content, item.channelId, true);
  },

  sendMessage: async (content: string, overrideChannelId?: string, isSteer?: boolean): Promise<{ success: boolean; error?: string }> => {
    const channelId = overrideChannelId || get().activeChannelId;
    try {
      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, ...(isSteer ? { isSteer: true } : {}) }),
      });
      if (!res.ok) {
        let errMessage = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const errBody = await res.json();
          if (errBody?.error) errMessage = errBody.error;
        } catch {
          const text = await res.text().catch(() => '');
          if (text) errMessage = text;
        }
        return { success: false, error: errMessage };
      }
      const data = await res.json();
      if (data.routing) {
        set((state) => ({
          latestRoutingByChannel: {
            ...state.latestRoutingByChannel,
            [channelId]: {
              channelId,
              messageId: data.message?.id,
              routing: data.routing,
            },
          },
        }));
      }
      if (data.message) {
        set((state) => {
          const chanId = data.message.channelId || channelId;
          const nextCache = { ...state.channelMessagesCache };
          const chanMsgs = nextCache[chanId] || [];
          if (!chanMsgs.some((m) => m.id === data.message.id)) {
            nextCache[chanId] = [...chanMsgs, data.message];
          }
          if (state.messages.some((m) => m.id === data.message.id)) {
            return { channelMessagesCache: nextCache };
          }
          const isCurrentActive = chanId === state.activeChannelId;
          return {
            messages: isCurrentActive ? [...state.messages, data.message] : state.messages,
            channelMessagesCache: nextCache,
          };
        });
      }
      return { success: true };
    } catch (err: any) {
      console.error('[KIN UI] Failed to send message:', err);
      return { success: false, error: err?.message || 'Network error sending message' };
    }
  },

  setAutonomyMode: async (mode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS') => {
    set({ autonomyMode: mode });
    try {
      await fetch('/api/workspace/autonomy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomyMode: mode }),
      });
    } catch (err) {
      console.error('[KIN UI] Failed to update autonomy mode:', err);
      get().fetchState();
    }
  },

  resolveApproval: async (approvalId: string, approved: boolean) => {
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.id !== approvalId),
    }));

    try {
      await fetch(`/api/approvals/${approvalId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
    } catch (err) {
      console.error(`[KIN UI] Failed to resolve approval ${approvalId}:`, err);
      get().fetchState();
    }
  },

  createGoal: async (title: string, description?: string, acceptanceCriteria?: string[]) => {
    const projectId = get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projectId}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, acceptanceCriteria }),
      });
      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          goals: state.goals.some((g) => g.id === data.goal.id) ? state.goals : [...state.goals, data.goal],
          tasks: data.initialTask && !state.tasks.some((t) => t.id === data.initialTask.id) ? [...state.tasks, data.initialTask] : state.tasks,
          isNewGoalModalOpen: false,
        }));
      }
    } catch (err) {
      console.error('[KIN UI] Failed to create goal:', err);
    }
  },

  deleteGoal: async (goalId: string) => {
    try {
      const res = await fetch(`/api/goals/${goalId}`, { method: 'DELETE' });
      if (res.ok) {
        set((state) => ({
          goals: state.goals.filter((g) => g.id !== goalId),
          tasks: state.tasks.filter((t) => t.goalId !== goalId),
        }));
        return { success: true };
      }
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || 'Failed to delete goal' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  createTask: async (goalId: string, title: string, description?: string, assignedAgentId?: string, dependsOnTaskIds?: string[]) => {
    try {
      const res = await fetch(`/api/goals/${goalId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, assignedAgentId, dependsOnTaskIds }),
      });
      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          tasks: state.tasks.some((t) => t.id === data.task.id) ? state.tasks : [...state.tasks, data.task],
        }));
      }
    } catch (err) {
      console.error('[KIN UI] Failed to create task:', err);
    }
  },

  deleteTask: async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      if (res.ok) {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== taskId),
        }));
        return { success: true };
      }
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || 'Failed to delete task' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  updateTaskStatus: async (taskId: string, status: 'backlog' | 'ready' | 'assigned' | 'running' | 'blocked' | 'review' | 'completed' | 'failed' | 'cancelled') => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
    }));

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const body: Record<string, any> = { status };
      if (status === 'completed') {
        const token = await getIpcToken();
        if (token) {
          const sig = await computeTaskSignature(token, taskId);
          if (sig) {
            headers['x-kin-operator-signature'] = sig;
            body.operatorSignoff = {
              operatorId: 'operator-human',
              signature: sig,
              justification: 'Human operator signoff via UI',
            };
          }
        }
      }
      await fetch(`/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error(`[KIN UI] Failed to update task ${taskId} status:`, err);
      get().fetchState();
    }
  },

  createDecision: async (params) => {
    const projectId = get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projectId}/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create decision');
      if (data.decision) {
        set((state) => ({
          decisions: state.decisions.some((d) => d.id === data.decision.id)
            ? state.decisions
            : [data.decision, ...state.decisions],
        }));
      }
      return { success: true, decision: data.decision };
    } catch (err: any) {
      console.error('[KIN UI] Failed to create decision:', err);
      return { success: false, error: err?.message || 'Failed to create decision' };
    }
  },

  resolveDecision: async (decisionId, status) => {
    try {
      const res = await fetch(`/api/decisions/${decisionId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve decision');
      if (data.decision) {
        set((state) => ({
          decisions: state.decisions.map((d) => (d.id === decisionId ? { ...d, ...data.decision } : d)),
        }));
      }
      return { success: true };
    } catch (err: any) {
      console.error(`[KIN UI] Failed to resolve decision ${decisionId}:`, err);
      return { success: false, error: err?.message || 'Failed to resolve decision' };
    }
  },

  deleteDecision: async (decisionId) => {
    try {
      const res = await fetch(`/api/decisions/${decisionId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete decision');
      set((state) => ({
        decisions: state.decisions.filter((d) => d.id !== decisionId),
      }));
      return { success: true };
    } catch (err: any) {
      console.error(`[KIN UI] Failed to delete decision ${decisionId}:`, err);
      return { success: false, error: err?.message || 'Failed to delete decision' };
    }
  },

  setDecisionsModalOpen: (open) => set({ isDecisionsModalOpen: open }),

  setNewGoalModalOpen: (open) => set({ isNewGoalModalOpen: open }),
  setNewTaskModalOpen: (open) => set({ isNewTaskModalOpen: open }),
  setActiveInspectorTab: (tab) => set({ activeInspectorTab: tab }),
  setSelectedAgentId: (agentId) => {
    const projId = get().activeProjectId;
    if (projId && agentId) {
      try {
        localStorage.setItem(`kin_selected_agent_${projId}`, agentId);
      } catch {}
    }
    set({ selectedAgentId: agentId });
  },
  setNewProjectModalOpen: (open) => set({ isNewProjectModalOpen: open }),
  setCreateChannelModalOpen: (open) => set({ isCreateChannelModalOpen: open }),
  setAddAgentModalOpen: (open) => set({ isAddAgentModalOpen: open }),
  setSwarmMapOpen: (open) => set({ isSwarmMapOpen: open }),
  setSelectedSwarmAgentId: (id) => {
    set({ selectedSwarmAgentId: id });
    get().fetchAgentExecutionDetails(id);
  },
  clearSteerNotification: () => set({ steerNotification: null }),
  fetchAgentExecutionDetails: async (agentId: string) => {
    set({ isLoadingExecutionDetails: true });
    try {
      const res = await fetch(`/api/agents/${agentId}/execution-details`);
      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          agentExecutionDetails: {
            ...state.agentExecutionDetails,
            [agentId]: data.executionDetails,
          },
          isLoadingExecutionDetails: false,
        }));
      } else {
        set({ isLoadingExecutionDetails: false });
      }
    } catch (err) {
      console.error(`[KIN UI] Failed to fetch execution details for ${agentId}:`, err);
      set({ isLoadingExecutionDetails: false });
    }
  },

  // Git Actions
  fetchGitStatus: async (projectId?: string) => {
    const projId = projectId || get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projId}/git/status`);
      if (res.ok) {
        const data = await res.json();
        set({
          gitStatus: {
            isGitRepo: data.isGitRepo ?? false,
            summary: data.summary ?? { totalChanged: 0, modifiedCount: 0, untrackedCount: 0, addedCount: 0, deletedCount: 0, stagedCount: 0 },
            files: data.files ?? [],
          },
        });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch git status:', err);
    }
  },

  fetchGitDiff: async (filePath: string, projectId?: string) => {
    const projId = projectId || get().activeProjectId;
    set({ isLoadingDiff: true });
    try {
      const res = await fetch(`/api/projects/${projId}/git/diff?path=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const data = await res.json();
        set({ activeGitDiff: data, isLoadingDiff: false });
      } else {
        set({ activeGitDiff: null, isLoadingDiff: false });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch git diff:', err);
      set({ activeGitDiff: null, isLoadingDiff: false });
    }
  },

  clearGitDiff: () => set({ activeGitDiff: null }),

  revertGitFile: async (filePath: string) => {
    const projectId = get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projectId}/git/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      if (res.ok) {
        if (get().activeGitDiff?.path === filePath) {
          get().clearGitDiff();
        }
        await get().fetchGitStatus();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to revert git file:', err);
      return false;
    }
  },

  stageGitFile: async (filePath: string, stage: boolean) => {
    const projectId = get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projectId}/git/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, stage }),
      });
      if (res.ok) {
        await get().fetchGitStatus();
        if (get().activeGitDiff?.path === filePath) {
          await get().fetchGitDiff(filePath);
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to stage/unstage git file:', err);
      return false;
    }
  },

  requestAiReview: async (filePath?: string) => {
    const projectId = get().activeProjectId;
    const channelId = get().activeChannelId;
    try {
      const res = await fetch(`/api/projects/${projectId}/git/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, channelId }),
      });
      const data = await res.json();
      if (res.ok) {
        if (channelId) {
          await get().setActiveChannel(channelId);
        }
        return { success: true, review: data.review, verdict: data.verdict };
      }
      return { success: false, error: data.error || 'Failed to generate code review' };
    } catch (err: any) {
      console.error('[KIN UI] Failed to request AI code review:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  // Upload Actions
  fetchUploads: async (projectId?: string) => {
    const projId = projectId || get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projId}/uploads`);
      if (res.ok) {
        const data = await res.json();
        set({ uploads: data.uploads || [] });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch uploads:', err);
    }
  },

  uploadFile: async (file: File) => {
    set({ isUploading: true });
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const commaIdx = result.indexOf(',');
          resolve(commaIdx !== -1 ? result.substring(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const projectId = get().activeProjectId;
      const res = await fetch(`/api/projects/${projectId}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentBase64: base64,
          mimeType: file.type || 'application/octet-stream',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        set({ isUploading: false });
        return { success: false, error: data.error || 'Upload failed' };
      }
      set((state) => ({
        uploads: state.uploads.some((u) => u.id === data.upload.id)
          ? state.uploads
          : [data.upload, ...state.uploads],
        isUploading: false,
      }));
      return { success: true };
    } catch (err: any) {
      set({ isUploading: false });
      return { success: false, error: err?.message || 'Upload error' };
    }
  },

  deleteUpload: async (uploadId: string) => {
    const projectId = get().activeProjectId;
    try {
      const res = await fetch(`/api/projects/${projectId}/uploads/${uploadId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        set((state) => ({
          uploads: state.uploads.filter((u) => u.id !== uploadId),
        }));
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to delete upload:', err);
      return false;
    }
  },

  // Instant Human Takeover Actions
  pauseAgent: async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/pause`, { method: 'POST' });
      if (res.ok) {
        set((state) => {
          const existing = state.activeTakeovers[runId];
          const updated = existing
            ? { ...existing, isPaused: true }
            : { runId, isPaused: true, isAborted: false };
          const nextTakeovers = { ...state.activeTakeovers, [runId]: updated };
          const chanTakeover = Object.values(nextTakeovers).find((t) => t.channelId === state.activeChannelId) || null;
          return {
            activeTakeovers: nextTakeovers,
            activeTakeover: chanTakeover || (state.activeTakeover?.runId === runId ? updated : state.activeTakeover),
          };
        });
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to pause agent:', err);
      return false;
    }
  },

  resumeAgent: async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' });
      if (res.ok) {
        set((state) => {
          const existing = state.activeTakeovers[runId];
          if (!existing) return state;
          const updated = { ...existing, isPaused: false, authRequired: false };
          const nextTakeovers = { ...state.activeTakeovers, [runId]: updated };
          const chanTakeover = Object.values(nextTakeovers).find((t) => t.channelId === state.activeChannelId) || null;
          return {
            activeTakeovers: nextTakeovers,
            activeTakeover: chanTakeover || (state.activeTakeover?.runId === runId ? updated : state.activeTakeover),
          };
        });
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to resume agent:', err);
      return false;
    }
  },

  abortAgent: async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/abort`, { method: 'POST' });
      if (res.ok) {
        set((state) => {
          const existing = state.activeTakeovers[runId];
          const updated = existing
            ? { ...existing, isAborted: true, isPaused: false }
            : { runId, isPaused: false, isAborted: true };
          const nextTakeovers = { ...state.activeTakeovers, [runId]: updated };
          const chanTakeover = Object.values(nextTakeovers).find((t) => t.channelId === state.activeChannelId) || null;
          return {
            activeTakeovers: nextTakeovers,
            activeTakeover: chanTakeover || (state.activeTakeover?.runId === runId ? updated : state.activeTakeover),
          };
        });
        setTimeout(() => {
          set((state) => {
            const nextTakeovers = { ...state.activeTakeovers };
            delete nextTakeovers[runId];
            const chanTakeover = Object.values(nextTakeovers).find((t) => t.channelId === state.activeChannelId) || null;
            return {
              activeTakeovers: nextTakeovers,
              activeTakeover: state.activeTakeover?.runId === runId ? chanTakeover : state.activeTakeover,
            };
          });
        }, 2000);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to abort agent:', err);
      return false;
    }
  },

  fetchActiveRuns: async () => {
    try {
      const res = await fetch('/api/runs/active');
      if (res.ok) {
        const data = await res.json();
        const runs: any[] = data.runs || [];
        const nextMap: Record<string, TakeoverState> = {};
        for (const active of runs) {
          nextMap[active.runId] = {
            runId: active.runId,
            agentId: active.agentId,
            channelId: active.channelId,
            isPaused: active.isPaused,
            isAborted: active.isAborted,
            activeTool: active.activeTool,
            previewPayload: active.previewPayload,
            authRequired: active.authRequired,
            financialGate: active.financialGate,
            riskLevel: active.riskLevel,
          };
        }
        set((state) => {
          const chanTakeover = Object.values(nextMap).find((t) => t.channelId === state.activeChannelId) || null;
          return {
            activeTakeovers: nextMap,
            activeTakeover: chanTakeover,
          };
        });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch active runs:', err);
    }
  },

  dismissTakeover: () => set((state) => {
    const curRunId = state.activeTakeover?.runId;
    if (!curRunId) return { activeTakeover: null };
    const nextMap = { ...state.activeTakeovers };
    delete nextMap[curRunId];
    return {
      activeTakeovers: nextMap,
      activeTakeover: null,
    };
  }),

  // Skills Engine Actions
  fetchSkills: async () => {
    set({ isLoadingSkills: true });
    try {
      const res = await fetch('/api/skills');
      if (res.ok) {
        const data = await res.json();
        set({ skills: data.skills || [], isLoadingSkills: false });
      } else {
        set({ isLoadingSkills: false });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch skills:', err);
      set({ isLoadingSkills: false });
    }
  },

  createSkill: async (params: { id?: string; name: string; instructions?: string; handlerCode?: string; description?: string; parameters?: any; skillType?: string; enabled?: boolean; tags?: string[]; requiredTools?: string[]; triggerPatterns?: string[] }) => {
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (res.ok) {
        set((state) => ({
          skills: [...state.skills.filter((s) => s.id !== data.skill.id), data.skill],
        }));
        return { success: true, skill: data.skill };
      }
      return { success: false, error: data.error || 'Failed to create skill' };
    } catch (err: any) {
      console.error('[KIN UI] Failed to create skill:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  updateSkill: async (skillId: string, params: { name?: string; instructions?: string; handlerCode?: string; description?: string; parameters?: any; skillType?: string; enabled?: boolean; tags?: string[]; requiredTools?: string[]; triggerPatterns?: string[] }) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (res.ok) {
        set((state) => ({
          skills: state.skills.map((s) => (s.id === skillId ? data.skill : s)),
        }));
        return { success: true, skill: data.skill };
      }
      return { success: false, error: data.error || 'Failed to update skill' };
    } catch (err: any) {
      console.error('[KIN UI] Failed to update skill:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  deleteSkill: async (skillId: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}`, { method: 'DELETE' });
      if (res.ok) {
        set((state) => ({ skills: state.skills.filter((s) => s.id !== skillId) }));
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to delete skill:', err);
      return false;
    }
  },

  exportSkill: async (skillId: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}/export`);
      if (res.ok) {
        const data = await res.json();
        return data.bundle;
      }
      return null;
    } catch (err) {
      console.error('[KIN UI] Failed to export skill:', err);
      return null;
    }
  },

  exportAllSkills: async () => {
    try {
      const res = await fetch('/api/skills/export-all');
      if (res.ok) {
        const data = await res.json();
        return data.bundle;
      }
      return null;
    } catch (err) {
      console.error('[KIN UI] Failed to export all skills:', err);
      return null;
    }
  },

  importSkill: async (bundleJson: string | object) => {
    try {
      let payload: any;
      if (typeof bundleJson === 'string') {
        const trimmed = bundleJson.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          payload = JSON.parse(trimmed);
        } else {
          payload = { directoryPath: trimmed };
        }
      } else {
        payload = bundleJson;
      }
      const res = await fetch('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        await get().fetchSkills();
      await get().fetchCustomTools();
        return { success: true, skill: data.skill, count: data.imported };
      }
      return { success: false, error: data.error || 'Failed to import skill bundle' };
    } catch (err: any) {
      console.error('[KIN UI] Failed to import skill bundle:', err);
      return { success: false, error: err?.message || 'Invalid skill bundle JSON' };
    }
  },

  setSkillsModalOpen: (open: boolean) => set({ isSkillsModalOpen: open }),

  fetchCandidates: async () => {
    try {
      const res = await fetch('/api/learning/candidates');
      if (res.ok) {
        const data = await res.json();
        set({ candidateSkills: data.candidates || [] });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch candidate lessons:', err);
    }
  },

  harvestCandidates: async () => {
    try {
      const res = await fetch('/api/learning/harvest', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        set({ candidateSkills: data.candidates || [] });
        return { success: true, createdCount: data.createdCount || 0 };
      }
      return { success: false, createdCount: 0 };
    } catch (err) {
      console.error('[KIN UI] Failed to harvest candidate lessons:', err);
      return { success: false, createdCount: 0 };
    }
  },

  validateCandidate: async (
    candidateId: string,
    action: 'promote' | 'reject',
    reviewer: string = 'human-operator',
    rationale?: string,
    updatedInstructions?: string
  ) => {
    try {
      const res = await fetch(`/api/learning/candidates/${encodeURIComponent(candidateId)}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewer, rationale, updatedInstructions }),
      });
      const data = await res.json();
      if (res.ok) {
        await get().fetchSkills();
      await get().fetchCustomTools();
        await get().fetchCandidates();
        return { success: true, message: data.message };
      }
      return { success: false, error: data.error || 'Failed to validate candidate' };
    } catch (err: any) {
      console.error('[KIN UI] Failed to validate candidate:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  fetchSkillExperiences: async () => {
    try {
      const res = await fetch('/api/skills/experiences');
      if (res.ok) {
        const data = await res.json();
        set({ skillExperiences: data.experiences || [] });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch skill experiences:', err);
    }
  },

  fetchLearningMetrics: async () => {
    try {
      const res = await fetch('/api/learning/metrics');
      if (res.ok) {
        const data = await res.json();
        set({ learningMetrics: data.metrics });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch learning metrics:', err);
    }
  },

  fetchSkillVersions: async (skillId: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}/versions`);
      if (res.ok) {
        const data = await res.json();
        return data.versions || [];
      }
      return [];
    } catch (err) {
      console.error('[KIN UI] Failed to fetch skill versions:', err);
      return [];
    }
  },

  rollbackSkill: async (skillId: string, versionId: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      });
      const data = await res.json();
      if (res.ok) {
        await get().fetchSkills();
        await get().fetchCustomTools();
        await get().fetchSkillVersions(skillId);
        return { success: true, skill: data.skill };
      }
      return { success: false, error: data.error || 'Failed to rollback skill' };
    } catch (err: any) {
      console.error('[KIN UI] Failed to rollback skill:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  // Dynamic Custom Tools Actions
  fetchCustomTools: async () => {
    set({ isLoadingCustomTools: true });
    try {
      const projId = get().activeProjectId;
      const res = await fetch(`/api/custom-tools?status=all${projId ? `&projectId=${projId}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        set({ customTools: data.tools || [], isLoadingCustomTools: false });
      } else {
        set({ isLoadingCustomTools: false });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch custom tools:', err);
      set({ isLoadingCustomTools: false });
    }
  },

  deleteCustomTool: async (id: string) => {
    try {
      const res = await fetch(`/api/custom-tools/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        set((state) => ({ customTools: state.customTools.filter((t) => t.id !== id) }));
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to delete custom tool:', err);
      return false;
    }
  },

  // MCP Connectors Actions
  fetchMcpData: async () => {
    set({ isLoadingMcp: true });
    try {
      const [toolsRes, serversRes] = await Promise.all([
        fetch('/api/mcp/tools').catch(() => null),
        fetch('/api/mcp/servers').catch(() => null),
      ]);
      const toolsData = toolsRes && toolsRes.ok ? await toolsRes.json() : { tools: [] };
      const serversData = serversRes && serversRes.ok ? await serversRes.json() : { servers: [] };
      set({
        mcpTools: toolsData.tools || [],
        mcpServers: serversData.servers || [],
        isLoadingMcp: false,
      });
      // Synchronously sync connectors list as well
      get().fetchMcpConnectors().catch(() => {});
    } catch (err) {
      console.warn('[KIN UI] Failed to fetch MCP data:', err);
      set({ isLoadingMcp: false });
    }
  },

  reloadMcpServers: async () => {
    set({ isLoadingMcp: true });
    try {
      const res = await fetch('/api/mcp/reload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await Promise.all([
          get().fetchMcpData(),
          get().fetchMcpConnectors(),
        ]);
        return { success: true, toolsCount: data.toolsCount || 0 };
      }
      set({ isLoadingMcp: false });
      return { success: false, error: data.error || 'Failed to reload MCP servers' };
    } catch (err: any) {
      set({ isLoadingMcp: false });
      return { success: false, error: err?.message || 'Network error reloading MCP' };
    }
  },

  fetchMcpConnectors: async (projectId?: string) => {
    set({ isLoadingConnectors: true });
    try {
      const projId = projectId || get().activeProjectId;
      const url = `/api/mcp/connectors${projId ? `?projectId=${encodeURIComponent(projId)}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        set({
          mcpConnectors: data.connectors || [],
          globalMcpConfigPath: data.paths?.global || data.globalPath || '',
          projectMcpConfigPath: data.paths?.project || data.projectPath || '',
          isLoadingConnectors: false,
        });
      } else {
        set({ isLoadingConnectors: false });
      }
    } catch (err) {
      console.warn('[KIN UI] Failed to fetch MCP connectors:', err);
      set({ isLoadingConnectors: false });
    }
  },

  saveMcpConnector: async (params) => {
    set({ isLoadingConnectors: true });
    try {
      const projId = get().activeProjectId;
      const res = await fetch('/api/mcp/connectors/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, projectId: projId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (Array.isArray(data.connectors)) {
          set({
            mcpConnectors: data.connectors,
            isLoadingConnectors: false,
          });
        } else {
          await get().fetchMcpConnectors();
        }
        get().fetchMcpData().catch(() => {});
        return { success: true, toolsCount: data.toolsCount };
      }
      set({ isLoadingConnectors: false });
      return { success: false, error: data.error || 'Failed to save connector' };
    } catch (err: any) {
      set({ isLoadingConnectors: false });
      return { success: false, error: err?.message || 'Network error saving connector' };
    }
  },

  toggleMcpConnector: async (params) => {
    try {
      const projId = get().activeProjectId;
      const res = await fetch('/api/mcp/connectors/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, projectId: projId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (Array.isArray(data.connectors)) {
          set({ mcpConnectors: data.connectors });
        } else {
          await get().fetchMcpConnectors();
        }
        get().fetchMcpData().catch(() => {});
        return { success: true };
      }
      return { success: false, error: data.error || 'Failed to toggle connector' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error toggling connector' };
    }
  },

  deleteMcpConnector: async (params) => {
    set({ isLoadingConnectors: true });
    try {
      const projId = get().activeProjectId;
      const res = await fetch('/api/mcp/connectors/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, projectId: projId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (Array.isArray(data.connectors)) {
          set({
            mcpConnectors: data.connectors,
            isLoadingConnectors: false,
          });
        } else {
          await get().fetchMcpConnectors();
        }
        get().fetchMcpData().catch(() => {});
        return { success: true };
      }
      set({ isLoadingConnectors: false });
      return { success: false, error: data.error || 'Failed to delete connector' };
    } catch (err: any) {
      set({ isLoadingConnectors: false });
      return { success: false, error: err?.message || 'Network error deleting connector' };
    }
  },

  testMcpConnector: async (params) => {
    try {
      const projId = get().activeProjectId;
      const res = await fetch('/api/mcp/connectors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, projectId: projId }),
      });
      const data = await res.json();
      return {
        success: Boolean(data.success),
        durationMs: data.durationMs || 0,
        toolsCount: data.toolsCount || 0,
        tools: data.tools || [],
        message: data.message,
        error: data.error || (data.success ? undefined : (data.message || 'Probe failed')),
      };
    } catch (err: any) {
      return {
        success: false,
        durationMs: 0,
        toolsCount: 0,
        tools: [],
        error: err?.message || 'Network error testing connector',
      };
    }
  },

  // Desktop & Browser Actions
  fetchDiscoveredApps: async () => {
    try {
      const res = await fetch('/api/system/apps');
      if (res.ok) {
        const data = await res.json();
        set({ discoveredApps: data.apps || [] });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to discover apps:', err);
    }
  },

  launchApp: async (appNameOrPath: string, args?: string[]) => {
    try {
      const res = await fetch('/api/system/apps/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appNameOrPath, args: args || [] }),
      });
      const data = await res.json();
      return { success: res.ok, error: data.error };
    } catch (err: any) {
      console.error('[KIN UI] Failed to launch app:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  fetchActiveWindows: async () => {
    try {
      const res = await fetch('/api/system/windows');
      if (res.ok) {
        const data = await res.json();
        set({ activeWindows: data.windows || [] });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to list windows:', err);
    }
  },

  focusWindow: async (titleOrPid: string | number) => {
    try {
      const res = await fetch('/api/system/windows/focus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titleOrPid }),
      });
      const data = await res.json();
      return data;
    } catch (err: any) {
      console.error('[KIN UI] Failed to focus window:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  closeWindow: async (titleOrPid: string | number) => {
    try {
      const res = await fetch('/api/system/windows/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titleOrPid }),
      });
      if (res.ok) {
        await get().fetchActiveWindows();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to close window:', err);
      return false;
    }
  },

  fetchBrowserStatus: async () => {
    try {
      const res = await fetch('/api/browser/status');
      if (res.ok) {
        const data = await res.json();
        set({ browserStatus: data });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch browser status:', err);
    }
  },

  closeBrowser: async () => {
    try {
      const res = await fetch('/api/browser/close', { method: 'POST' });
      if (res.ok) {
        set({ browserStatus: null });
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to close browser:', err);
      return false;
    }
  },

  navigateBrowser: async (url: string) => {
    try {
      const res = await fetch('/api/browser/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        await get().fetchBrowserStatus();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to navigate browser:', err);
      return false;
    }
  },

  captureDesktopScreenshot: async () => {
    try {
      const res = await fetch('/api/system/desktop/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'png' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.base64) {
          const dataUri = `data:${data.mimeType || 'image/png'};base64,${data.base64}`;
          return {
            dataUri,
            isHeadless: data.isHeadless,
            notice: data.notice,
            sessionId: data.sessionId,
            width: data.width,
            height: data.height,
          };
        }
      }
      return null;
    } catch (err) {
      console.error('[KIN UI] Failed to capture desktop screenshot:', err);
      return null;
    }
  },

  setDesktopControlModalOpen: (open: boolean) => set({ isDesktopControlModalOpen: open }),

  // Routine Actions (Unified with Schedules)
  fetchRoutines: async (projectId?: string) => {
    return get().fetchSchedules(projectId);
  },

  createRoutine: async (params: {
    prompt: string;
    type: 'cron' | 'one_shot';
    cronExpression?: string;
    durationSeconds?: number;
    channelId?: string;
    targetAgentId?: string;
  }) => {
    await get().createSchedule(params);
  },

  cancelRoutine: async (routineId: string) => {
    await get().cancelSchedule(routineId);
  },

  // Crash Recovery & Quota Safety Actions
  fetchRecoveryState: async () => {
    try {
      const res = await fetch('/api/system/recovery-state');
      if (res.ok) {
        const data = await res.json();
        set({ pendingRecoveries: data.pendingRecoveries || [] });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch recovery state:', err);
    }
  },

  resumeAllRecoveries: async (modelOverride?: string) => {
    try {
      const res = await fetch('/api/system/recovery/resume-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelOverride }),
      });
      if (res.ok) {
        const data = await res.json();
        set({ pendingRecoveries: [] });
        return { success: true, count: data.count };
      }
      return { success: false };
    } catch (err) {
      console.error('[KIN UI] Failed to resume all recoveries:', err);
      return { success: false };
    }
  },

  discardRecoveries: async () => {
    try {
      const res = await fetch('/api/system/recovery/discard', { method: 'POST' });
      if (res.ok) {
        set({ pendingRecoveries: [] });
        return { success: true };
      }
      return { success: false };
    } catch (err) {
      console.error('[KIN UI] Failed to discard recoveries:', err);
      return { success: false };
    }
  },

  resumeRun: async (runId: string, modelOverride?: string) => {
    try {
      const res = await fetch(`/api/system/recovery/resume-run/${encodeURIComponent(runId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelOverride }),
      });
      if (res.ok) {
        set((state) => ({
          pendingRecoveries: state.pendingRecoveries.filter((r) => r.id !== runId),
          quotaPauseState: state.quotaPauseState?.runId === runId ? null : state.quotaPauseState,
        }));
        return { success: true };
      }
      return { success: false };
    } catch (err) {
      console.error('[KIN UI] Failed to resume run:', err);
      return { success: false };
    }
  },

  switchRunToModel: async (runId: string, targetModelId: string) => {
    try {
      const res = await fetch(`/api/system/recovery/switch-model/${encodeURIComponent(runId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetModelId }),
      });
      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          pendingRecoveries: state.pendingRecoveries.filter((r) => r.id !== runId),
          quotaPauseState: state.quotaPauseState?.runId === runId ? null : state.quotaPauseState,
        }));
        return { success: true, model: data.model };
      }
      return { success: false };
    } catch (err) {
      console.error('[KIN UI] Failed to switch run model:', err);
      return { success: false };
    }
  },

  switchRunToOllama: async (runId: string) => {
    try {
      const res = await fetch(`/api/system/recovery/switch-to-ollama/${encodeURIComponent(runId)}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          pendingRecoveries: state.pendingRecoveries.filter((r) => r.id !== runId),
          quotaPauseState: state.quotaPauseState?.runId === runId ? null : state.quotaPauseState,
        }));
        return { success: true, model: data.model };
      }
      return { success: false };
    } catch (err) {
      console.error('[KIN UI] Failed to switch run to Ollama:', err);
      return { success: false };
    }
  },

  fetchEvaluations: async (agentId: string) => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/evaluations`);
      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          agentEvaluations: {
            ...state.agentEvaluations,
            [agentId]: data.evaluations || [],
          },
        }));
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch agent evaluations:', err);
    }
  },

  runAgentEvaluation: async (agentId: string) => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/evaluate`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const evalItem: AgentEvaluationItem = data.evaluation;
        set((state) => {
          const nextMap = { ...state.agentEvaluations };
          const list = nextMap[agentId] || [];
          nextMap[agentId] = [evalItem, ...list.filter((x) => x.id !== evalItem.id)];
          return { agentEvaluations: nextMap };
        });
        return { success: true, evaluation: evalItem };
      }
      return { success: false };
    } catch (err) {
      console.error('[KIN UI] Failed to run agent evaluation:', err);
      return { success: false };
    }
  },

  fetchCredentials: async () => {
    try {
      const res = await fetch('/api/settings/credentials');
      if (res.ok) {
        const data = await res.json();
        set({ credentials: data.credentials || [] });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to fetch credentials:', err);
    }
  },

  addCredential: async (params: {
    provider: string;
    keyName?: string;
    keyAlias?: string;
    apiKey?: string;
    secret?: string;
    baseUrl?: string;
    monthlyQuotaTokens?: number;
    maxSpendTokens?: number;
    scopedAgentIds?: string[];
    scopedGrants?: string[];
  }) => {
    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: params.provider,
          keyAlias: params.keyAlias || params.keyName,
          keyName: params.keyName || params.keyAlias,
          secret: params.secret || params.apiKey,
          apiKey: params.apiKey || params.secret,
          baseUrl: params.baseUrl,
          scopedGrants: params.scopedGrants || params.scopedAgentIds,
          scopedAgentIds: params.scopedAgentIds || params.scopedGrants,
          maxSpendTokens: params.maxSpendTokens || params.monthlyQuotaTokens,
          monthlyQuotaTokens: params.monthlyQuotaTokens || params.maxSpendTokens,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          credentials: [data.credential, ...state.credentials.filter((c) => c.id !== data.credential.id)],
        }));
        return { success: true, credential: data.credential };
      }
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errData.error || 'Failed to add credential',
        duplicate: Boolean(errData.duplicate),
      };
    } catch (err: any) {
      console.error('[KIN UI] Failed to add credential:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  updateCredential: async (
    id: string,
    params: {
      provider?: string;
      keyName?: string;
      keyAlias?: string;
      apiKey?: string;
      secret?: string;
      baseUrl?: string;
      monthlyQuotaTokens?: number;
      maxSpendTokens?: number;
      scopedAgentIds?: string[];
      scopedGrants?: string[];
    }
  ) => {
    try {
      const res = await fetch(`/api/settings/credentials/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: params.provider,
          keyAlias: params.keyAlias || params.keyName,
          keyName: params.keyName || params.keyAlias,
          secret: params.secret || params.apiKey,
          apiKey: params.apiKey || params.secret,
          baseUrl: params.baseUrl,
          scopedGrants: params.scopedGrants || params.scopedAgentIds,
          scopedAgentIds: params.scopedAgentIds || params.scopedGrants,
          maxSpendTokens: params.maxSpendTokens || params.monthlyQuotaTokens,
          monthlyQuotaTokens: params.monthlyQuotaTokens || params.maxSpendTokens,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        set((state) => ({
          credentials: state.credentials.map((c) => (c.id === id ? data.credential : c)),
        }));
        return { success: true, credential: data.credential };
      }
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errData.error || 'Failed to update credential',
        duplicate: Boolean(errData.duplicate),
      };
    } catch (err: any) {
      console.error('[KIN UI] Failed to update credential:', err);
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  deleteCredential: async (id: string) => {
    try {
      const res = await fetch(`/api/settings/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        set((state) => ({
          credentials: state.credentials.filter((c) => c.id !== id),
        }));
        await get().fetchAvailableModels();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[KIN UI] Failed to delete credential:', err);
      return false;
    }
  },

  submitGrillMeAnswers: async (
    params: { channelId?: string; topic?: string; answers: Record<string, string> } | Record<string, string>
  ) => {
    try {
      const state = get();
      const channelId = ('channelId' in params && params.channelId) || state.grillMeSession?.channelId || state.activeChannelId;
      const topic = ('topic' in params && params.topic) || state.grillMeSession?.topic || 'Architecture Assessment';
      const answers = ('answers' in params ? params.answers : params) as Record<string, string>;

      const res = await fetch('/api/decisions/grill-me-answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, topic, answers }),
      });
      if (res.ok) {
        const data = await res.json();
        set({ grillMeSession: null });
        return { success: true, decision: data.decision };
      }
      return { success: false };
    } catch (err) {
      console.error('[KIN UI] Failed to submit grill-me answers:', err);
      return { success: false };
    }
  },

  fetchAvailableModels: async (options?: { omitUnconfigured?: boolean; provider?: string }) => {
    set({ isLoadingModels: true });
    try {
      const params = new URLSearchParams();
      const shouldOmit = options?.omitUnconfigured !== false;
      if (shouldOmit) params.set('omitUnconfigured', 'true');
      if (options?.provider) params.set('provider', options.provider);
      const queryString = params.toString() ? `?${params.toString()}` : '';

      const res = await fetch(`/api/models${queryString}`);
      if (res.ok) {
        const data = await res.json();
        const list: AvailableModelItem[] = data.models || [];
        set({
          availableModels: list,
          providerReadiness: data.providerReadiness || get().providerReadiness,
          isLoadingModels: false,
        });
      } else {
        set({ isLoadingModels: false });
      }
    } catch (err) {
      console.warn('[KIN UI] Failed to fetch available models:', err);
      set({ isLoadingModels: false });
    }
  },

  verifyProviderKey: async (provider: string, apiKey?: string, baseUrl?: string) => {
    try {
      const res = await fetch('/api/models/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, baseUrl }),
      });
      const data = await res.json();
      if (data.models && Array.isArray(data.models)) {
        await get().fetchAvailableModels();
      }
      return {
        success: Boolean(data.success && data.working),
        working: Boolean(data.working),
        message: data.message || (data.working ? 'API connection verified successfully' : 'Verification failed'),
        modelCount: data.modelCount || (data.models?.length ?? 0),
        models: data.models || [],
      };
    } catch (err: any) {
      return {
        success: false,
        working: false,
        message: err?.message || 'Network error verifying provider key',
        modelCount: 0,
        models: [],
      };
    }
  },

  discoverModels: async (provider: string, apiKey?: string, baseUrl?: string, keyAlias?: string) => {
    set({ isLoadingModels: true });
    try {
      const res = await fetch('/api/models/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, baseUrl, keyAlias }),
      });
      const data = await res.json();
      if (res.ok) {
        await get().fetchAvailableModels();
        return { success: true, count: data.count };
      }
      set({ isLoadingModels: false });
      return { success: false, error: data.error || 'Failed to discover models' };
    } catch (err: any) {
      set({ isLoadingModels: false });
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  addCustomModel: async (
    modelId: string,
    optionsOrName?: string | { name?: string; provider?: string; contextWindow?: number; baseUrl?: string; apiKey?: string }
  ) => {
    try {
      const payload = typeof optionsOrName === 'string'
        ? { modelId, name: optionsOrName }
        : { modelId, ...(optionsOrName || {}) };
      const res = await fetch('/api/models/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        await get().fetchAvailableModels();
        return { success: true, model: data.model };
      }
      return { success: false, error: data.error || 'Failed to add custom model' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' };
    }
  },

  dismissGrillMe: () => set({ grillMeSession: null }),
  clearQuotaPause: () => set({ quotaPauseState: null }),

  clearTerminalHistory: () => set({ terminalHistory: [] }),
}));

if (typeof window !== 'undefined') {
  (window as any).kinStore = useKinStore;
}

