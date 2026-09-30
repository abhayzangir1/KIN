// ============================================================================
// KIN DESKTOP UI — ZUSTAND STATE STORE
// Genuinely wired to KIN Core Server, SQLite persistence, and SSE events.
// Supports multi-project switching, single-agent @Boss, Ollama detection, and terminal.
// ============================================================================

import { create } from 'zustand';

export interface ProjectItem {
  id: string;
  workspaceId: string;
  name: string;
  repoPath: string;
  createdAt: number;
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

export interface OllamaStatus {
  online: boolean;
  models: string[];
}

interface KinState {
  // Navigation & Workspace State
  projects: ProjectItem[];
  activeProjectId: string;
  activeProject?: ProjectItem;
  activeChannelId: string;
  channels: ChannelItem[];
  agents: AgentDisplay[];
  selectedAgentId: string;
  messages: MessageItem[];
  pendingApprovals: ApprovalItem[];
  autonomyMode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS';
  
  // Local LLM & System State
  ollamaStatus: OllamaStatus;
  isConnected: boolean;
  terminalHistory: Array<{ command: string; output: string; exitCode: number }>;
  
  // UI Tabs & Modals
  activeCenterTab: 'Chat' | 'Code' | 'Swarm' | 'Fleet' | 'Research' | 'Browser' | 'Memory' | 'Docs' | 'Artifacts';
  activeInspectorTab: 'Contract' | 'Telemetry';
  isNewProjectModalOpen: boolean;

  // Actions
  fetchState: (projectId?: string) => Promise<void>;
  initSSE: () => void;
  setActiveChannel: (channelId: string) => Promise<void>;
  setActiveProject: (projectId: string) => Promise<void>;
  createProject: (name: string, repoPath?: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  startOllama: () => Promise<void>;
  runTerminalCommand: (command: string) => Promise<void>;
  updateAgentContract: (agentId: string, roleTitle: string, activeModelId: string, systemPrompt?: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  setAutonomyMode: (mode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS') => Promise<void>;
  resolveApproval: (approvalId: string, approved: boolean) => Promise<void>;
  setActiveCenterTab: (tab: KinState['activeCenterTab']) => void;
  setActiveInspectorTab: (tab: KinState['activeInspectorTab']) => void;
  setSelectedAgentId: (agentId: string) => void;
  setNewProjectModalOpen: (open: boolean) => void;
}

let eventSourceInstance: EventSource | null = null;

export const useKinStore = create<KinState>((set, get) => ({
  projects: [],
  activeProjectId: 'proj-kin',
  activeChannelId: 'chan-general',
  channels: [],
  agents: [],
  selectedAgentId: 'agent-boss',
  messages: [],
  pendingApprovals: [],
  autonomyMode: 'AUTO',
  ollamaStatus: { online: false, models: [] },
  isConnected: false,
  terminalHistory: [],
  activeCenterTab: 'Chat',
  activeInspectorTab: 'Contract',
  isNewProjectModalOpen: false,

  fetchState: async (projectId?: string) => {
    try {
      const targetProj = projectId || get().activeProjectId;
      const url = targetProj ? `/api/state?projectId=${encodeURIComponent(targetProj)}` : '/api/state';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();

      set({
        projects: data.projects || [],
        activeProject: data.activeProject,
        activeProjectId: data.activeProject?.id || 'proj-kin',
        autonomyMode: data.autonomyMode || 'AUTO',
        activeChannelId: data.activeChannelId || (data.channels?.[0]?.id ?? 'chan-general'),
        channels: data.channels || [],
        agents: data.agents || [],
        selectedAgentId: data.agents?.[0]?.id || 'agent-boss',
        messages: data.messages || [],
        pendingApprovals: data.pendingApprovals || [],
        ollamaStatus: data.ollamaStatus || { online: false, models: [] },
        isConnected: true,
      });
    } catch (err) {
      console.warn('[KIN UI] Could not connect to Core IPC server, retrying...', err);
      set({ isConnected: false });
    }
  },

  initSSE: () => {
    if (eventSourceInstance) {
      eventSourceInstance.close();
    }

    try {
      const sse = new EventSource('/api/events');
      eventSourceInstance = sse;

      sse.addEventListener('message:created', (e) => {
        try {
          const msg: MessageItem = JSON.parse(e.data);
          set((state) => {
            if (state.messages.some((m) => m.id === msg.id)) return state;
            return { messages: [...state.messages, msg] };
          });
        } catch (err) {
          console.error('[KIN UI] Failed to parse message:created event', err);
        }
      });

      sse.addEventListener('agent:state', (e) => {
        try {
          const { agentId, status } = JSON.parse(e.data);
          set((state) => ({
            agents: state.agents.map((a) => (a.id === agentId ? { ...a, status } : a)),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:state event', err);
        }
      });

      sse.addEventListener('agent:updated', (e) => {
        try {
          const data = JSON.parse(e.data);
          set((state) => ({
            agents: state.agents.map((a) => (a.id === data.agentId ? { ...a, ...data } : a)),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:updated event', err);
        }
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

      sse.onopen = () => set({ isConnected: true });
      sse.onerror = () => set({ isConnected: false });
    } catch (err) {
      console.error('[KIN UI] SSE connection error:', err);
    }
  },

  setActiveChannel: async (channelId: string) => {
    set({ activeChannelId: channelId });
    try {
      const res = await fetch(`/api/channels/${channelId}/messages`);
      if (res.ok) {
        const data = await res.json();
        set({ messages: data.messages || [] });
      }
    } catch (err) {
      console.error(`[KIN UI] Failed to load messages for channel ${channelId}:`, err);
    }
  },

  setActiveProject: async (projectId: string) => {
    set({ activeProjectId: projectId });
    await get().fetchState(projectId);
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
      const output = data.stdout || data.stderr || (data.exitCode === 0 ? 'Command completed.' : `Exit code ${data.exitCode}`);
      set((state) => ({
        terminalHistory: [...state.terminalHistory, { command, output, exitCode: data.exitCode }],
      }));
    } catch (err: any) {
      set((state) => ({
        terminalHistory: [...state.terminalHistory, { command, output: err?.message || 'Execution error', exitCode: 1 }],
      }));
    }
  },

  updateAgentContract: async (agentId: string, roleTitle: string, activeModelId: string, systemPrompt?: string) => {
    // Optimistic update
    set((state) => ({
      agents: state.agents.map((a) =>
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

  sendMessage: async (content: string) => {
    const channelId = get().activeChannelId;
    try {
      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      if (data.message) {
        set((state) => {
          if (state.messages.some((m) => m.id === data.message.id)) return state;
          return { messages: [...state.messages, data.message] };
        });
      }
    } catch (err) {
      console.error('[KIN UI] Failed to send message:', err);
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

  setActiveCenterTab: (tab) => set({ activeCenterTab: tab }),
  setActiveInspectorTab: (tab) => set({ activeInspectorTab: tab }),
  setSelectedAgentId: (agentId) => set({ selectedAgentId: agentId }),
  setNewProjectModalOpen: (open) => set({ isNewProjectModalOpen: open }),
}));
