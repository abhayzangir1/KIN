import React, { useState } from 'react';
import { Copy, Check, Quote, User, Bot, Sparkles, Zap, Lightbulb } from 'lucide-react';
import { MessageItem as MessageItemType } from '../../store/kinStore.js';
import { CodeBlock } from '../CodeBlock.js';
import { DecisionCard } from '../DecisionCard.js';

export interface MessageItemProps {
  message: MessageItemType;
  onQuoteReply?: (quote: string) => void;
  agents?: any[];
  activeProjectId?: string;
  activeChannelId?: string;
  onSelectDecision?: (decisionChoice: string) => void;
}

/**
 * Pure prose sanitizer enforcing PRD § 7 transcript contract:
 * Strips internal thinking, reasoning tags, raw tool invocations, and incomplete CoT buffers.
 */
export const cleanProse = (content: string): string => {
  if (!content) return '';
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '')
    .replace(/<tool_output>[\s\S]*?<\/tool_output>/gi, '')
    .replace(/<(?:think|thought|reasoning)>[\s\S]*$/gi, '')
    .replace(/^Thinking Process:[\s\S]*?\n\n/i, '')
    .trim();
};

export const parseDecisionProposal = (content: string) => {
  const cardMatch = content.match(/\[DECISION_CARD\]([\s\S]*?)\[\/DECISION_CARD\]/);
  if (cardMatch) {
    try {
      return JSON.parse(cardMatch[1]);
    } catch (err) {
      console.warn('[KIN UI] Failed to parse decision proposal card:', err);
    }
  }
  if (
    content.includes('### Architectural Tie-Breaker') ||
    content.includes('Tie-Breaker Escalation') ||
    content.includes('Decision Card:')
  ) {
    const titleMatch = content.match(
      /(?:### Architectural Tie-Breaker|Proposed Plan Decision|Decision Card:)\s*:?\s*([^\n]+)/
    );
    const optAMatch = content.match(/Option A:\s*([^\n]+)/);
    const optBMatch = content.match(/Option B:\s*([^\n]+)/);
    if (optAMatch && optBMatch) {
      const optAProsMatch = content.match(/Option A Pros?:\s*([^\n]+)/i);
      const optAConsMatch = content.match(/Option A Cons?:\s*([^\n]+)/i);
      const optBProsMatch = content.match(/Option B Pros?:\s*([^\n]+)/i);
      const optBConsMatch = content.match(/Option B Cons?:\s*([^\n]+)/i);
      const recMatch = content.match(/Recommendation:\s*([^\n]+)/i);
      return {
        title: titleMatch ? titleMatch[1].trim() : 'Architectural Plan Decision',
        topic: 'Interactive plan review',
        optionA: {
          label: optAMatch[1].trim(),
          pros: optAProsMatch ? optAProsMatch[1].trim() : '',
          cons: optAConsMatch ? optAConsMatch[1].trim() : '',
        },
        optionB: {
          label: optBMatch[1].trim(),
          pros: optBProsMatch ? optBProsMatch[1].trim() : '',
          cons: optBConsMatch ? optBConsMatch[1].trim() : '',
        },
        recommendation: recMatch ? recMatch[1].trim() : undefined,
      };
    }
  }
  return null;
};

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  onQuoteReply,
  agents = [],
  activeProjectId: _activeProjectId,
  activeChannelId: _activeChannelId,
  onSelectDecision,
}) => {
  const [copied, setCopied] = useState(false);

  const isHuman = message.senderType === 'human';
  const agent = agents.find((a: any) => a.id === message.senderId);

  // Pure prose enforcement
  const prose = isHuman ? message.content : cleanProse(message.content);
  if (!isHuman && !prose) {
    // If the agent message only contained CoT thoughts or tool calls, suppress bubble per PRD § 7 contract
    return null;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(prose);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleQuote = () => {
    let sender = isHuman ? 'Human' : agent?.displayName || message.senderName || 'Agent';
    if (sender && sender.startsWith('@')) {
      sender = sender.slice(1);
    }
    const cleanContent = prose.length > 250 ? prose.slice(0, 250) + '...' : prose;
    const formatted = `> [Quote @${sender}]: "${cleanContent.replace(/\r?\n/g, ' ')}"\n\n`;
    if (onQuoteReply) {
      onQuoteReply(formatted);
    } else {
      navigator.clipboard.writeText(formatted);
    }
  };

  const formattedTime = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isSideQuery =
    message.content.startsWith('/btw') ||
    message.content.includes('💡 **[Side Query / BTW]**') ||
    (message.metadata && (message.metadata as any).isSideQuery);

  const isSlashCard =
    message.content.includes('🚀 **Compound Pipeline Engaged**') ||
    message.content.includes('⚡ **Compound Pipeline Engaged**') ||
    message.content.includes('🎯 **Compound Pipeline Engaged**') ||
    message.content.includes('🚀 **Boost Mode Engaged**') ||
    message.content.includes('👥 **Workforce Collaboration Matrix**') ||
    message.content.includes('📋 **Execution Plan Initialized**') ||
    message.content.includes('🎯 **Goal Registered**') ||
    message.content.includes('⏱️ **Timer Initialized**') ||
    message.content.includes('🔄 **Proactive Personal Routine Configured**') ||
    message.content.includes('🔥 **Adversarial Architectural Assessment (/grill-me)**') ||
    message.content.includes('🛡️ **Hardened Architecture Decision Record (ADR)**');

  const formatInlineTokens = (text: string) => {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|@[a-zA-Z0-9_-]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code
            key={i}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 dark:bg-[#0d1117] text-emerald-800 dark:text-emerald-300 font-mono text-[11px] border border-slate-300 dark:border-[#30363d]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={i} className="font-bold text-kin-text">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('@') && part.length > 1) {
        return (
          <span
            key={i}
            className="px-1.5 py-0.2 mx-0.5 rounded bg-blue-500/15 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-mono text-[10px] font-bold border border-blue-500/30 inline-flex items-center"
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const renderFormattedBody = (text: string) => {
    if (text.includes('```')) {
      const segments = text.split(/(```[a-zA-Z0-9_-]*[\s\S]*?```)/g);
      return segments.map((seg, sIdx) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const firstLineBreak = seg.indexOf('\n');
          const lang = firstLineBreak !== -1 ? seg.slice(3, firstLineBreak).trim() : '';
          const codeBody = firstLineBreak !== -1 ? seg.slice(firstLineBreak + 1, -3) : seg.slice(3, -3);
          return <CodeBlock key={sIdx} language={lang} code={codeBody} />;
        }
        const paras = seg.split(/\n\n+/);
        return paras.map((p, pIdx) => {
          const trimmed = p.trim();
          if (!trimmed) return null;
          if (trimmed.startsWith('>')) {
            const quoteContent = trimmed.replace(/^>\s*/gm, '');
            return (
              <blockquote
                key={`${sIdx}-${pIdx}`}
                className="border-l-2 border-emerald-500/70 bg-emerald-50 dark:bg-emerald-950/20 pl-2.5 py-1 my-1 text-emerald-800 dark:text-emerald-200/90 font-mono text-[11px] rounded-r italic whitespace-pre-wrap"
              >
                {formatInlineTokens(quoteContent)}
              </blockquote>
            );
          }
          return (
            <div key={`${sIdx}-${pIdx}`} className="whitespace-pre-wrap">
              {formatInlineTokens(p)}
            </div>
          );
        });
      });
    }

    const paragraphs = text.split(/\n\n+/);
    return paragraphs.map((para, pIdx) => {
      const trimmed = para.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith('>')) {
        const quoteContent = trimmed.replace(/^>\s*/gm, '');
        return (
          <blockquote
            key={pIdx}
            className="border-l-2 border-emerald-500/70 bg-emerald-50 dark:bg-emerald-950/20 pl-2.5 py-1 my-1 text-emerald-800 dark:text-emerald-200/90 font-mono text-[11px] rounded-r italic whitespace-pre-wrap"
          >
            {formatInlineTokens(quoteContent)}
          </blockquote>
        );
      }
      return (
        <div key={pIdx} className="whitespace-pre-wrap">
          {formatInlineTokens(para)}
        </div>
      );
    });
  };

  const decision = parseDecisionProposal(message.content);

  return (
    <article
      role="article"
      aria-label={`Message from ${message.senderName || (isHuman ? 'Human Operator' : 'Agent')}`}
      className="flex space-x-3.5 group relative select-text py-1.5"
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-xs border ${
          isHuman
            ? 'bg-emerald-600 border-emerald-500/40 text-white'
            : agent?.isOrchestrator
            ? 'bg-gradient-to-br from-amber-500 to-amber-700 border-amber-400/40 text-white font-bold'
            : 'bg-gradient-to-br from-blue-600 to-indigo-700 border-blue-400/30 text-white font-bold'
        }`}
      >
        {isHuman ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Message Body */}
      <div className="flex-1 space-y-1.5 min-w-0">
        <div className="flex items-center space-x-2.5 select-none">
          <span className="font-bold text-kin-text text-xs">
            {isHuman ? 'Human Operator' : agent?.displayName || message.senderName}
          </span>

          {/* Role Badge */}
          {isHuman ? (
            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono font-bold border border-emerald-500/25">
              Human
            </span>
          ) : agent?.isOrchestrator ? (
            <span className="text-[9px] uppercase px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono font-bold">
              Workspace Orchestrator
            </span>
          ) : (
            <span className="text-[9px] uppercase px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 font-mono font-bold">
              {agent?.role || 'Specialist'}
            </span>
          )}

          {/* Productivity score badge if present */}
          {typeof message.productivityScore === 'number' && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center space-x-1 border border-emerald-500/20"
              title="Productivity Score"
            >
              <Sparkles className="w-2.5 h-2.5" />
              <span>{message.productivityScore.toFixed(1)}</span>
            </span>
          )}

          {/* Static Model Tag for Agents */}
          {!isHuman && (agent?.activeModelId || (message.metadata as any)?.modelId) && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-kin-card text-kin-muted border border-kin-border truncate max-w-[140px]"
              title={`Executed with ${agent?.activeModelId || (message.metadata as any)?.modelId}`}
            >
              {(agent?.activeModelId || (message.metadata as any)?.modelId || '')
                .replace(/^(ollama|openai|anthropic|openrouter|gemini|groq|deepseek|xai|nvidia|azure|copilot|custom|openai_compatible)\//i, '')
                .replace(/^(anthropic|openai|meta-llama|google|mistralai)\//i, '')}
            </span>
          )}

          <time dateTime={new Date(message.createdAt).toISOString()} className="text-[10px] font-mono text-kin-muted">
            {formattedTime}
          </time>

          {/* Steering Directive Badge */}
          {message.isSteer && (
            <span className="text-[9px] uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold flex items-center space-x-1 border border-amber-500/30">
              <Zap className="w-2.5 h-2.5 text-amber-400" />
              <span>Steer Directive</span>
            </span>
          )}

          {/* Quote & Copy action buttons on hover */}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex items-center space-x-1">
            <button
              type="button"
              onClick={handleQuote}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-kin-surface hover:bg-emerald-500/20 hover:text-emerald-300 text-kin-muted text-[10px] font-mono border border-kin-border transition cursor-pointer"
              title="Quote this message in reply"
              aria-label="Quote reply"
            >
              <Quote className="w-2.5 h-2.5 text-emerald-400" />
              <span>Quote</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-kin-surface hover:bg-emerald-500/20 hover:text-emerald-300 text-kin-muted text-[10px] font-mono border border-kin-border transition cursor-pointer"
              title="Copy message text"
              aria-label="Copy message text"
            >
              {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Content Bubble (Non-flat, modern elevation, generous padding) */}
        <div
          className={`text-kin-text text-xs leading-relaxed font-sans p-4 rounded-xl border shadow-xs transition-all ${
            isSideQuery
              ? 'bg-amber-500/10 border-amber-500/30 shadow-amber-950/10'
              : isSlashCard
              ? 'bg-blue-500/10 border-blue-500/30 shadow-blue-950/10'
              : isHuman
              ? 'bg-emerald-500/10 border-emerald-500/25'
              : 'bg-kin-card/90 border-kin-border hover:border-kin-border/80'
          }`}
        >
          {isSideQuery && (
            <div className="flex items-center space-x-1.5 mb-2 pb-1.5 border-b border-amber-500/30 text-amber-300 font-mono text-[10px] font-bold">
              <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>EPHEMERAL SIDE QUERY (/btw) — UNPOLLUTED ACTIVE CONTEXT</span>
            </div>
          )}

          {renderFormattedBody(prose)}

          {decision && onSelectDecision && (
            <DecisionCard
              title={decision.title}
              topic={decision.topic || 'Workforce Plan Review'}
              optionA={decision.optionA}
              optionB={decision.optionB}
              recommendation={decision.recommendation}
              onSelect={(opt) => {
                const choiceStr =
                  opt === 'compromise'
                    ? `Compromise: ${decision.recommendation || 'Compromise'}`
                    : `Option ${opt}: ${opt === 'A' ? decision.optionA.label : decision.optionB.label}`;
                onSelectDecision(choiceStr);
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
};
