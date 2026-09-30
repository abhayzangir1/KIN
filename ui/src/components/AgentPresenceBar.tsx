import React from 'react';
import { useKinStore } from '../store/kinStore.js';
import { Bot, Sparkles } from 'lucide-react';

const AVAILABLE_MODELS = [
  { id: 'anthropic/claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3' },
  { id: 'deepseek/deepseek-reasoner', label: 'DeepSeek R1' },
  { id: 'google/gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'ollama/llama3.1', label: 'Ollama: Llama 3.1 8B' },
  { id: 'ollama/qwen2.5-coder', label: 'Ollama: Qwen 2.5 Coder 7B' },
];

export const AgentPresenceBar: React.FC = () => {
  const { agents, updateAgentModel } = useKinStore();

  return (
    <aside className="w-72 bg-kin-surface border-l border-kin-border flex flex-col h-screen">
      <div className="p-4 border-b border-kin-border flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-kin-muted">
          Active Workforce ({agents.length})
        </h2>
        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="p-3 rounded-lg bg-kin-card border border-kin-border hover:border-kin-border/80 transition-all space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="relative">
                  <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs">
                    <Bot className="w-4 h-4" />
                  </div>
                  <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-kin-card" />
                </div>
                <div>
                  <div className="text-xs font-medium text-kin-text flex items-center space-x-1">
                    <span>{agent.displayName}</span>
                    {agent.isOrchestrator && (
                      <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 rounded font-mono">Lead</span>
                    )}
                  </div>
                  <div className="text-[11px] text-kin-muted">{agent.role}</div>
                </div>
              </div>
            </div>

            {/* Explicit User Model Configuration */}
            <div>
              <label className="text-[10px] uppercase font-semibold text-kin-muted block mb-1">
                Active Model
              </label>
              <select
                value={agent.activeModelId}
                onChange={(e) => updateAgentModel(agent.id, e.target.value)}
                aria-label={`Active Model for ${agent.displayName}`}
                className="w-full bg-kin-bg border border-kin-border rounded px-2 py-1 text-[11px] text-kin-text focus:outline-none focus:border-blue-500"
              >
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
