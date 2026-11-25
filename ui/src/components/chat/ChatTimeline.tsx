import React, { useEffect, useRef, useState } from 'react';
import { MessageItem as MessageItemType } from '../../store/kinStore.js';
import { MessageItem, cleanProse } from '../messages/MessageItem.js';
import { BackgroundTurnPill } from './BackgroundTurnPill.js';
import { ThinkingAccordion } from '../ThinkingAccordion.js';
import { MessageSquare } from 'lucide-react';

const DEFAULT_VISIBLE_WINDOW = 120;

const StreamingTurnOverlay: React.FC<{
  thinkingDraft?: string;
  streamingDrafts?: Record<string, string>;
  activeChannelId?: string;
  agents: any[];
}> = React.memo(({ thinkingDraft, streamingDrafts, activeChannelId, agents }) => {
  return (
    <>
      {thinkingDraft && (
        <ThinkingAccordion
          thinking={thinkingDraft}
          isStreaming={true}
        />
      )}

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
                className="p-3.5 rounded-2xl bg-kin-surface border border-blue-500/40 shadow-xl space-y-2 animate-fadeIn backdrop-blur-md"
              >
                <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-300 font-mono">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="font-bold">{agentLabel}</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-300 border border-blue-500/20">
                    Live
                  </span>
                </div>
                <div className="font-mono text-xs text-kin-text whitespace-pre-wrap leading-relaxed">
                  {cleanProse(draftContent)}
                  <span className="inline-block w-1.5 h-3.5 bg-blue-500 ml-1 animate-pulse align-middle" />
                </div>
              </div>
            );
          })}
    </>
  );
});

export interface ChatTimelineProps {
  messages: MessageItemType[];
  agents?: any[];
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_WINDOW);

  useEffect(() => {
    setVisibleCount(DEFAULT_VISIBLE_WINDOW);
    isNearBottomRef.current = true;
    setShowJumpToLatest(false);
    prevScrollHeightRef.current = null;
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [activeChannelId]);

  const expandWindow = (increment: number) => {
    const el = scrollContainerRef.current;
    if (el) prevScrollHeightRef.current = el.scrollHeight;
    setVisibleCount((prev) => Math.min(messages.length, prev + increment));
  };

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el && prevScrollHeightRef.current !== null) {
      const delta = el.scrollHeight - prevScrollHeightRef.current;
      if (delta > 0) el.scrollTop += delta;
      prevScrollHeightRef.current = null;
    }
  }, [visibleCount]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isNearBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom && el.scrollHeight > el.clientHeight + 200);
    if (el.scrollTop < 80 && visibleCount < messages.length && prevScrollHeightRef.current === null) {
      expandWindow(80);
    }
  };

  const activeDraftChars =
    streamingDrafts && activeChannelId
      ? Object.entries(streamingDrafts)
          .filter(([k]) => k === activeChannelId || k.startsWith(`${activeChannelId}:`))
          .reduce((sum, [, v]) => sum + (v?.length || 0), 0)
      : 0;

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, Boolean(thinkingDraft), activeDraftChars]);

  const hiddenCount = Math.max(0, messages.length - visibleCount);
  const visibleMessages = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;

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
      ref={scrollContainerRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Chat Message History"
      className="flex-1 overflow-y-auto font-sans text-xs select-text"
    >
      <div className="max-w-4xl mx-auto px-6 py-5 space-y-4">
        {hiddenCount > 0 && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => expandWindow(100)}
              className="px-3 py-1 rounded-full text-[11px] bg-kin-card border border-kin-border text-kin-muted hover:text-kin-text transition"
            >
              Show earlier messages ({hiddenCount} hidden)
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="h-56 flex flex-col items-center justify-center text-center p-6 space-y-2 border border-dashed border-kin-border rounded-xl bg-kin-card/40 my-6 select-none">
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
          visibleMessages.map((msg) => {
            if (isBackgroundTurn(msg)) {
              return <BackgroundTurnPill key={msg.id} message={msg} />;
            }
            return (
              <MessageItem
                key={msg.id}
                message={msg}
                onQuoteReply={onQuoteReply}
                agents={agents}
                activeProjectId={activeProjectId}
                activeChannelId={activeChannelId}
                onSelectDecision={onSelectDecision}
              />
            );
          })
        )}

        <StreamingTurnOverlay
          thinkingDraft={thinkingDraft}
          streamingDrafts={streamingDrafts}
          activeChannelId={activeChannelId}
          agents={agents}
        />

        {children}

        <div ref={bottomRef} className="h-1" />
      </div>
      {showJumpToLatest && (
        <div className="sticky bottom-3 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={() => {
              isNearBottomRef.current = true;
              setShowJumpToLatest(false);
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="pointer-events-auto px-3 py-1.5 rounded-full bg-kin-surface/95 border border-kin-border shadow-lg text-[11px] font-medium text-kin-text hover:border-emerald-500/50 transition"
          >
            Jump to latest ↓
          </button>
        </div>
      )}
    </div>
  );
};
