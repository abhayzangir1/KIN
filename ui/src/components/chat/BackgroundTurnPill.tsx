import React, { useState } from 'react';
import { Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { MessageItem } from '../../store/kinStore.js';
import { cleanProse } from '../messages/MessageItem.js';

interface BackgroundTurnPillProps {
  message: MessageItem;
}

export const BackgroundTurnPill: React.FC<BackgroundTurnPillProps> = ({ message }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Clean pure prose by stripping internal reasoning and raw tool tags
  const cleanContent = cleanProse(message.content);

  const formattedTime = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="my-2 max-w-4xl mx-auto px-4">
      <div
        className={`rounded-lg border transition-all duration-200 overflow-hidden ${
          isExpanded
            ? 'bg-cyan-50/90 border-cyan-300 dark:bg-cyan-950/40 dark:border-cyan-600/40'
            : 'bg-cyan-50/50 border-cyan-200/80 hover:bg-cyan-50 dark:bg-cyan-950/20 dark:border-cyan-700/30 dark:hover:bg-cyan-950/30'
        }`}
      >
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-left select-none group focus:outline-none"
          aria-expanded={isExpanded}
        >
          <div className="flex items-center space-x-2 truncate">
            <span className="p-1 rounded bg-cyan-100 dark:bg-cyan-900/60 text-cyan-700 dark:text-cyan-300">
              <Clock className="w-3 h-3 animate-pulse" />
            </span>
            <span className="font-semibold text-cyan-800 dark:text-cyan-200 truncate">
              {message.senderName || 'Automated Routine'}
            </span>
            <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.2 rounded bg-cyan-200/60 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300">
              Background Turn
            </span>
            {!isExpanded && (
              <span className="text-[11px] text-cyan-600/70 dark:text-cyan-400/60 truncate font-mono">
                {cleanContent.slice(0, 80) || 'Automated scheduled routine'}
                {cleanContent.length > 80 ? '...' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2 shrink-0 ml-2">
            <span className="text-[10px] text-cyan-600 dark:text-cyan-400 font-mono">
              {formattedTime}
            </span>
            <span className="text-cyan-600 dark:text-cyan-400 group-hover:text-cyan-800 dark:group-hover:text-cyan-200 transition">
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
          </div>
        </button>

        {isExpanded && (
          <div className="px-4 py-3 border-t border-cyan-200/60 dark:border-cyan-700/30 text-xs text-cyan-950 dark:text-cyan-100 whitespace-pre-wrap leading-relaxed font-sans">
            {cleanContent || '(No prose deliverable emitted during this background turn)'}
          </div>
        )}
      </div>
    </div>
  );
};
