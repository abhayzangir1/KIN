import React from 'react';
import { AvailableModelItem, useKinStore } from '../store/kinStore.js';
import { ChevronDown, Lock } from 'lucide-react';

interface AgentModelQuickSwitchProps {
  agent: {
    id: string;
    displayName?: string;
    name?: string;
    activeModelId?: string;
    status?: string;
  };
  availableModels: AvailableModelItem[];
  updateAgentModel: (agentId: string, modelId: string, projectId?: string, channelId?: string) => Promise<boolean>;
  projectId?: string;
  channelId?: string;
  compact?: boolean;
}

export const AgentModelQuickSwitch: React.FC<AgentModelQuickSwitchProps> = ({
  agent,
  availableModels,
  updateAgentModel,
  projectId,
  channelId,
  compact = false,
}) => {
  const activeAgentChannels = useKinStore((s) => s.activeAgentChannels);
  const openModelSelector = useKinStore((s) => s.openModelSelector);
  const addToast = useKinStore((s) => s.addToast);
  const isBusy = agent.status === 'working' || agent.status === 'thinking' || Boolean(activeAgentChannels[agent.id]);
  const currentModelId = agent.activeModelId || '';

  const activeModelObj = availableModels.find((m) => m.id === currentModelId);
  const displayLabel =
    activeModelObj?.name ||
    currentModelId.replace(/^(ollama|openai|anthropic|openrouter|gemini|groq|deepseek|xai)\//i, '') ||
    'Select Model';

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newModelId = e.target.value;
    if (newModelId === '__open_modal__') {
      openModelSelector(agent.id);
      return;
    }
    if (newModelId && newModelId !== currentModelId) {
      const ok = await updateAgentModel(agent.id, newModelId, projectId, channelId);
      if (!ok) {
        addToast(`Failed to switch model to "${newModelId}". Agent may be busy.`, 'error');
      } else {
        addToast(`Model switched to "${newModelId}" for @${agent.name || agent.displayName || 'agent'}`, 'success');
      }
    }
  };

  return (
    <div
      className="relative inline-flex items-center"
      onClick={(e) => e.stopPropagation()}
      title={
        isBusy
          ? `Agent is currently active (${agent.status || 'running'}). Model switching is blocked until execution completes.`
          : `Model: ${currentModelId || 'Default'} (Click to quick-switch)`
      }
    >
      <select
        value={currentModelId}
        onChange={handleChange}
        disabled={isBusy}
        className={`bg-slate-800/90 hover:bg-slate-700/90 text-kin-text border border-slate-700/80 rounded font-mono text-[10px] py-0.5 pl-1.5 pr-4 appearance-none focus:outline-none focus:border-emerald-500 transition ${
          isBusy
            ? 'cursor-not-allowed opacity-50 bg-slate-900/60 text-slate-400'
            : 'cursor-pointer hover:border-slate-500'
        } ${compact ? 'max-w-[105px]' : 'max-w-[160px]'} truncate`}
      >
        {!currentModelId && <option value="">Default Model</option>}
        {currentModelId && !availableModels.some((m) => m.id === currentModelId) && (
          <option value={currentModelId}>{displayLabel}</option>
        )}
        {availableModels.map((m) => (
          <option key={m.id} value={m.id}>
            {m.provider ? `[${m.provider}] ` : ''}
            {m.name || m.id}
          </option>
        ))}
        <option value="__open_modal__">⚙️ More Models / Providers...</option>
      </select>
      {isBusy ? (
        <Lock className="w-2.5 h-2.5 text-amber-400 absolute right-1 pointer-events-none opacity-80" />
      ) : (
        <ChevronDown className="w-2.5 h-2.5 text-kin-muted absolute right-1 pointer-events-none" />
      )}
    </div>
  );
};
