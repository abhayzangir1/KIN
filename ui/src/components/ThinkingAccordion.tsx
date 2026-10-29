import React, { useState, useEffect } from 'react';
import { Brain, ChevronDown, ChevronRight, Sparkles, Copy, Check } from 'lucide-react';

interface ThinkingAccordionProps {
  thinking: string;
  isStreaming?: boolean;
  initialExpanded?: boolean;
}

export const ThinkingAccordion: React.FC<ThinkingAccordionProps> = ({
  thinking,
  isStreaming = false,
  initialExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(initialExpanded || isStreaming);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  // Live timer while streaming reasoning
  useEffect(() => {
    if (!isStreaming) return;
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - start) / 1000)));
    }, 500);
    return () => clearInterval(timer);
  }, [isStreaming]);

  // When streaming finishes, keep the final duration visible
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(thinking);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!thinking && !isStreaming) return null;

  return (
    <div className="my-2 rounded-xl border border-indigo-500/30 bg-[#090e1d]/80 overflow-hidden shadow-md text-xs transition-all">
      {/* Accordion Toggle Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between bg-[#0e162d]/90 hover:bg-[#131e3d] text-indigo-300 font-mono text-[11px] transition cursor-pointer select-none"
      >
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Brain className={`w-3.5 h-3.5 text-indigo-400 ${isStreaming ? 'animate-pulse' : ''}`} />
            {isStreaming && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
            )}
          </div>
          <span className="font-semibold text-white">
            {isStreaming ? 'Reasoning Engine Active' : 'Internal Chain-of-Thought'}
          </span>
          <span className="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 text-[10px] border border-indigo-800/40">
            {isStreaming ? `${elapsedSeconds}s thinking...` : 'Complete'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {isExpanded && thinking && (
            <button
              type="button"
              onClick={handleCopy}
              className="px-1.5 py-0.5 rounded hover:bg-indigo-900/40 text-indigo-300 text-[10px] flex items-center space-x-1"
              title="Copy reasoning trace"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          )}
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-indigo-400" />
          )}
        </div>
      </button>

      {/* Expanded Reasoning Body */}
      {isExpanded && (
        <div className="p-3 bg-[#060a14] border-t border-indigo-950/60 max-h-64 overflow-y-auto space-y-1.5 font-mono text-[11px] text-[#94a3b8] leading-relaxed whitespace-pre-wrap select-text">
          {thinking || (
            <span className="italic text-[#64748b] flex items-center space-x-1.5">
              <Sparkles className="w-3 h-3 text-cyan-400 animate-spin" />
              <span>Synthesizing multi-agent plan and verifying constraints...</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};
