import React from 'react';
import { AvailableModelItem } from '../store/kinStore.js';
import { AgentModelBadge } from './AgentModelBadge.js';

export interface AgentModelQuickSwitchProps {
  agent: {
    id: string;
    displayName?: string;
    name?: string;
    activeModelId?: string;
    status?: string;
  };
  availableModels?: AvailableModelItem[];
  updateAgentModel?: (agentId: string, modelId: string, projectId?: string, channelId?: string) => Promise<boolean>;
  projectId?: string;
  channelId?: string;
  compact?: boolean;
}

/**
 * Replaced cluttered select dropdown with clean unified AgentModelBadge button.
 */
export const AgentModelQuickSwitch: React.FC<AgentModelQuickSwitchProps> = ({
  agent,
  availableModels,
  compact = false,
}) => {
  return <AgentModelBadge agent={agent} availableModels={availableModels} compact={compact} />;
};
