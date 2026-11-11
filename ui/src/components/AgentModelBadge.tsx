import React from 'react';
import { useKinStore, AvailableModelItem } from '../store/kinStore.js';
import { Cpu, ChevronDown, Lock } from 'lucide-react';

export interface AgentModelBadgeProps {
  agent: {
    id: string;
    displayName?: string;
    name?: string;
    activeModelId?: string;
    status?: string;
  };
  availableModels?: AvailableModelItem[];
  compact?: boolean;
  className?: string;
}

export const AgentModelBadge: React.FC<AgentModelBadgeProps> = ({
  agent,
  availableModels,
  compact = false,
  className = '',
}) => {
  const openModelSelector = useKinStore((s) => s.openModelSelector);
  const activeAgentChannels = useKinStore((s) => s.activeAgentChannels);
  const storeModels = useKinStore((s) => s.availableModels);

  const models = availableModels && availableModels.length > 0 ? availableModels : storeModels;
  const isBusy = agent.status === 'working' || agent.status === 'thinking' || Boolean(activeAgentChannels[agent.id]);
  const currentModelId = agent.activeModelId || '';

  const activeModelObj = models.find((m) => m.id === currentModelId);
  const displayLabel =
    activeModelObj?.name ||
    currentModelId.replace(/^(ollama|openai|anthropic|openrouter|gemini|groq|deepseek|xai|nvidia)\//i, '') ||
    'Select Model';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openModelSelector(agent.id);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={
        isBusy
          ? `Model: ${currentModelId || 'Default'} (${agent.status || 'working'} - execution in progress)`
          : `Model: ${currentModelId || 'Default'} (Click to change model)`
      }
      className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded font-mono text-[10px] transition cursor-pointer border select-none ${
        compact
          ? 'max-w-[115px] bg-kin-card hover:bg-kin-cardHover text-kin-muted hover:text-kin-text border-kin-border hover:border-kin-borderSubtle'
          : 'max-w-[170px] bg-kin-card hover:bg-kin-cardHover text-kin-muted hover:text-kin-text border-kin-border hover:border-kin-borderSubtle'
      } ${className}`}
    >
      <Cpu className="w-2.5 h-2.5 text-kin-muted shrink-0" />
      <span className="truncate">{displayLabel}</span>
      {isBusy ? (
        <Lock className="w-2.5 h-2.5 text-amber-400 shrink-0 opacity-80" />
      ) : (
        <ChevronDown className="w-2.5 h-2.5 text-kin-muted shrink-0 opacity-60" />
      )}
    </button>
  );
};
