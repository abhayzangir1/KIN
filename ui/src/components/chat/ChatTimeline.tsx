import React, { useEffect, useRef } from 'react';
import { MessageItem as MessageItemType } from '../../store/kinStore.js';
import { MessageItem, cleanProse } from '../messages/MessageItem.js';
import { BackgroundTurnPill } from './BackgroundTurnPill.js';
import { ThinkingAccordion } from '../ThinkingAccordion.js';
import { MessageSquare } from 'lucide-react';

export interface ChatTimelineProps {
  messages: MessageItemType[];
  agents?: any[];
  availableModels?: any[];
  updateAgentModel?: (agentId: string, modelId: string, projectId?: string, channelId?: string) => Promise<boolean>;
  activeProjectId?: string;
  activeChannelId?: string;
  isDm?: boolean;
  targetAgent?: any;
  activeChannelName?: string;
  onQuoteReply?: (quote: string) => void;
  onSelectDecision?: (decisionChoice: string) => void;
  thinkingDraft?: string;
  streamingDrafts?: Record<string, string>;
  children?: React.ReactNode;
}

export const ChatTimeline: React.FC<ChatTimelineProps> = ({
  messages,
  agents = [],
  availableModels = [],
  updateAgentModel,
  activeProjectId,
  activeChannelId,
  isDm,
  targetAgent,
  activeChannelName,
  onQuoteReply,
  onSelectDecision,
  thinkingDraft,
  streamingDrafts,
  children,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, thinkingDraft, Boolean(streamingDrafts && Object.keys(streamingDrafts).length > 0)]);

  const isBackgroundTurn = (msg: MessageItemType): boolean => {
    if (Boolean(msg.is_background) || Boolean(msg.isBackground)) return true;
    if (msg.metadata) {
      if (typeof msg.metadata === 'object') {
        if (Boolean(msg.metadata.is_background) || Boolean(msg.metadata.isBackground)) return true;
      } else if (typeof msg.metadata === 'string') {
        try {
          const parsed = JSON.parse(msg.metadata);
          if (Boolean(parsed.is_background) || Boolean(parsed.isBackground)) return true;
        } catch {}
      }
    }
    // Fallback detection for automated crons and wakeup timers
    return (
      msg.content.includes('[Automated Turn]') ||
      msg.content.includes('[Scheduled Wakeup]') ||
      msg.content.includes('[Background Task]') ||
      msg.content.includes('⏰ Wakeup Timer Fired') ||
      msg.content.includes('Timer / Scheduled Alarm') ||
      msg.content.includes('⏰ **Timer') ||
      msg.content.includes('🔄 Proactive Routine') ||
      msg.content.includes('🤖 [Automated Wakeup]')
    );
  };

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Chat Message History"
      className="flex-1 overflow-y-auto font-sans text-xs select-text"
    >
      <div className="max-w-4xl mx-auto px-6 py-5 space-y-4">
        {messages.length === 0 ? (
          <div className="h-56 flex flex-col items-center justify-center text-center p-6 space-y-2 border border-dashed border-slate-300 dark:border-[#1e293b] rounded-xl bg-slate-50/60 dark:bg-[#0c1222]/40 my-6 select-none">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="font-semibold text-kin-text text-sm">
              {isDm ? `Direct Message with ${targetAgent?.displayName || '@Agent'}` : `Welcome to #${activeChannelName || 'general'}`}
            </div>
            <div className="text-kin-muted text-[11px] max-w-sm">
              {isDm
                ? `${targetAgent?.displayName || 'This agent'} will respond directly to all prompts in this private 1-on-1 thread.`
                : `Start the conversation by sending a message, or mention specific specialists with @ to coordinate their turns.`}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            if (isBackgroundTurn(msg)) {
              return <BackgroundTurnPill key={msg.id} message={msg} />;
            }
            return (
              <MessageItem
                key={msg.id}
                message={msg}
                onQuoteReply={onQuoteReply}
                agents={agents}
                availableModels={availableModels}
                updateAgentModel={updateAgentModel}
                activeProjectId={activeProjectId}
                activeChannelId={activeChannelId}
                onSelectDecision={onSelectDecision}
              />
            );
          })
        )}

        {/* Live In-Flight Streaming Reasoning Accordion */}
        {thinkingDraft && (
          <ThinkingAccordion
            thinking={thinkingDraft}
            isStreaming={true}
          />
        )}

        {/* Live In-Flight Streaming Token Draft Bubble */}
        {streamingDrafts &&
          activeChannelId &&
          Object.entries(streamingDrafts)
            .filter(
              ([key, val]) =>
                (key === activeChannelId || key.startsWith(`${activeChannelId}:`)) && cleanProse(val)
            )
            .map(([draftKey, draftContent]) => {
              const agentIdInKey = draftKey.includes(':') ? draftKey.split(':')[1] : undefined;
              const draftingAgent = agentIdInKey ? agents.find((a: any) => a.id === agentIdInKey) : undefined;
              const agentLabel = draftingAgent?.displayName
                ? `${draftingAgent.displayName} streaming...`
                : 'Streaming Response...';
              return (
                <div
                  key={draftKey}
                  className="p-3.5 rounded-2xl bg-blue-50/90 dark:bg-gradient-to-r dark:from-[#091122]/90 dark:to-[#0c1830]/90 border border-blue-400/40 shadow-xl space-y-2 animate-fadeIn backdrop-blur-md"
                >
                  <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300 font-mono">
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      <span className="font-bold">{agentLabel}</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">
                      Live
                    </span>
                  </div>
                  <div className="font-mono text-xs text-slate-800 dark:text-[#cbd5e1] whitespace-pre-wrap leading-relaxed">
                    {cleanProse(draftContent)}
                    <span className="inline-block w-1.5 h-3.5 bg-blue-500 ml-1 animate-pulse align-middle" />
                  </div>
                </div>
              );
            })}

        {children}

        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
};
