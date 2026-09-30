// ============================================================================
// KIN DESKTOP UI — ZUSTAND STATE STORE
// Manages workspace, channels, active agents, and pending approvals.
// ============================================================================

import { create } from 'zustand';

export interface AgentDisplay {
  id: string;
  name: string;
  role: string;
  displayName: string;
  activeModelId: string;
  fallbackModelId?: string;
  status: 'idle' | 'working' | 'thinking' | 'waiting' | 'needs_approval' | 'recovering';
  isOrchestrator: boolean;
}

export interface ChannelItem {
  id: string;
  name: string;
  topic?: string;
  unreadCount: number;
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
}

export interface ApprovalItem {
  id: string;
  runId: string;
  agentName: string;
  toolName: string;
  actionSummary: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: number;
}

interface KinState {
  activeChannelId: string;
  autonomyMode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS';
  channels: ChannelItem[];
  messages: MessageItem[];
  agents: AgentDisplay[];
  pendingApprovals: ApprovalItem[];
  
  setActiveChannel: (channelId: string) => void;
  setAutonomyMode: (mode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS') => void;
  sendMessage: (content: string) => void;
  updateAgentModel: (agentId: string, modelId: string) => void;
  resolveApproval: (approvalId: string, approved: boolean) => void;
}

export const useKinStore = create<KinState>((set, get) => ({
  activeChannelId: 'chan-architecture',
  autonomyMode: 'AUTO',
  channels: [
    { id: 'chan-architecture', name: 'architecture', topic: 'System schema contracts & API architecture', unreadCount: 0 },
    { id: 'chan-engineering', name: 'engineering', topic: 'Frontend, backend & database execution', unreadCount: 0 },
    { id: 'chan-approvals', name: 'approvals', topic: 'Consequential action approval gate', unreadCount: 1 },
  ],
  agents: [
    {
      id: 'agent-orch',
      name: 'Default Orchestrator',
      displayName: '@Orchestrator',
      role: 'Workspace Coordinator',
      activeModelId: 'anthropic/claude-3-5-sonnet',
      status: 'idle',
      isOrchestrator: true,
    },
    {
      id: 'agent-backend',
      name: 'Backend Lead',
      displayName: '@BackendLead',
      role: 'Backend Architect',
      activeModelId: 'openai/gpt-4o',
      status: 'idle',
      isOrchestrator: false,
    },
    {
      id: 'agent-frontend',
      name: 'Frontend Lead',
      displayName: '@FrontendLead',
      role: 'UI Architect',
      activeModelId: 'deepseek/deepseek-chat',
      status: 'idle',
      isOrchestrator: false,
    },
    {
      id: 'agent-db',
      name: 'Database Worker',
      displayName: '@DatabaseWorker',
      role: 'Database Engineer',
      activeModelId: 'ollama/qwen2.5-coder',
      status: 'idle',
      isOrchestrator: false,
    },
  ],
  messages: [
    {
      id: 'msg-001',
      channelId: 'chan-architecture',
      senderId: 'agent-orch',
      senderName: '@Orchestrator',
      senderType: 'agent',
      content: 'KIN Workforce initialized. Workspace default autonomy mode is set to AUTO. Agents are assigned to their user-configured models.',
      createdAt: Date.now() - 3600000,
      productivityScore: 100,
    },
  ],
  pendingApprovals: [
    {
      id: 'appr-001',
      runId: 'run-902',
      agentName: '@DatabaseWorker',
      toolName: 'executeShell',
      actionSummary: 'rm -rf .kin/worktrees/task-102/cache/db',
      riskLevel: 'HIGH',
      createdAt: Date.now() - 60000,
    },
  ],

  setActiveChannel: (channelId: string) => set({ activeChannelId: channelId }),
  setAutonomyMode: (mode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS') => set({ autonomyMode: mode }),

  sendMessage: (content: string) => {
    const newMessage: MessageItem = {
      id: `msg-${Date.now()}`,
      channelId: get().activeChannelId,
      senderId: 'user-operator',
      senderName: 'You (Human Operator)',
      senderType: 'human',
      content,
      createdAt: Date.now(),
    };
    set((state) => ({ messages: [...state.messages, newMessage] }));
  },

  updateAgentModel: (agentId: string, modelId: string) => {
    set((state) => ({
      agents: state.agents.map((a) => (a.id === agentId ? { ...a, activeModelId: modelId } : a)),
    }));
  },

  resolveApproval: (approvalId: string, _approved: boolean) => {
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.id !== approvalId),
    }));
  },
}));
