// ============================================================================
// KIN DESKTOP UI — ZUSTAND STATE STORE
// Genuinely wired to KIN Core Server, SQLite persistence, and SSE events.
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
  isConnected: boolean;
  
  fetchState: () => Promise<void>;
  initSSE: () => void;
  setActiveChannel: (channelId: string) => Promise<void>;
  setAutonomyMode: (mode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS') => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  updateAgentModel: (agentId: string, modelId: string) => Promise<void>;
  resolveApproval: (approvalId: string, approved: boolean) => Promise<void>;
}

let eventSourceInstance: EventSource | null = null;

export const useKinStore = create<KinState>((set, get) => ({
  activeChannelId: 'chan-architecture',
  autonomyMode: 'AUTO',
  channels: [],
  messages: [],
  agents: [],
  pendingApprovals: [],
  isConnected: false,

  fetchState: async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();

      set({
        autonomyMode: data.autonomyMode || 'AUTO',
        activeChannelId: data.activeChannelId || 'chan-architecture',
        channels: data.channels || [],
        agents: data.agents || [],
        messages: data.messages || [],
        pendingApprovals: data.pendingApprovals || [],
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
            // Avoid duplicate message appending
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
          const { agentId, activeModelId } = JSON.parse(e.data);
          set((state) => ({
            agents: state.agents.map((a) => (a.id === agentId ? { ...a, activeModelId } : a)),
          }));
        } catch (err) {
          console.error('[KIN UI] Failed to parse agent:updated event', err);
        }
      });

      sse.addEventListener('autonomy:updated', (e) => {
        try {
          const { autonomyMode } = JSON.parse(e.data);
          set({ autonomyMode });
        } catch (err) {
          console.error('[KIN UI] Failed to parse autonomy:updated event', err);
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

      sse.onopen = () => {
        set({ isConnected: true });
      };

      sse.onerror = () => {
        // SSE will automatically attempt reconnection
        set({ isConnected: false });
      };
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

  setAutonomyMode: async (mode: 'AUTO' | 'ALWAYS_ASK' | 'FULL_ACCESS') => {
    // Optimistic UI update
    set({ autonomyMode: mode });
    try {
      const res = await fetch('/api/workspace/autonomy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomyMode: mode }),
      });
      if (!res.ok) {
        get().fetchState(); // Rollback on failure
      }
    } catch (err) {
      console.error('[KIN UI] Failed to update autonomy mode:', err);
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
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
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

  updateAgentModel: async (agentId: string, modelId: string) => {
    // Optimistic UI update
    set((state) => ({
      agents: state.agents.map((a) => (a.id === agentId ? { ...a, activeModelId: modelId } : a)),
    }));

    try {
      const res = await fetch(`/api/agents/${agentId}/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModelId: modelId }),
      });
      if (!res.ok) {
        get().fetchState(); // Rollback on error
      }
    } catch (err) {
      console.error(`[KIN UI] Failed to update model for agent ${agentId}:`, err);
      get().fetchState();
    }
  },

  resolveApproval: async (approvalId: string, approved: boolean) => {
    // Optimistic UI update
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.id !== approvalId),
    }));

    try {
      const res = await fetch(`/api/approvals/${approvalId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      if (!res.ok) {
        get().fetchState();
      }
    } catch (err) {
      console.error(`[KIN UI] Failed to resolve approval ${approvalId}:`, err);
      get().fetchState();
    }
  },
}));
