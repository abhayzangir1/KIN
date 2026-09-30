import React, { useState } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { DecisionCard } from './DecisionCard.js';
import { Send, Hash } from 'lucide-react';

export const ChannelView: React.FC = () => {
  const { channels, activeChannelId, messages, sendMessage, pendingApprovals, resolveApproval } = useKinStore();
  const [inputText, setInputText] = useState('');
  const [showDemoConflict, setShowDemoConflict] = useState(true);

  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const channelMessages = messages.filter((m) => m.channelId === activeChannelId);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <main className="flex-1 flex flex-col h-screen bg-kin-bg">
      {/* Channel Header */}
      <header className="h-14 border-b border-kin-border px-6 flex items-center justify-between bg-kin-surface/50">
        <div className="flex items-center space-x-2">
          <Hash className="w-4 h-4 text-kin-muted" />
          <h2 className="font-semibold text-sm">{activeChannel?.name}</h2>
          {activeChannel?.topic && (
            <>
              <span className="text-kin-border">|</span>
              <span className="text-xs text-kin-muted truncate max-w-md">{activeChannel.topic}</span>
            </>
          )}
        </div>
      </header>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Pending Approvals Section in #approvals channel */}
        {activeChannelId === 'chan-approvals' && (
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase text-amber-400 tracking-wider">
              Pending Consequential Action Approvals ({pendingApprovals.length})
            </div>
            {pendingApprovals.map((appr) => (
              <div
                key={appr.id}
                className="p-4 rounded-xl bg-kin-card border border-amber-500/30 flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">
                      {appr.riskLevel} RISK ACTION
                    </span>
                    <span className="text-xs text-kin-muted">•</span>
                    <span className="text-xs font-medium text-kin-text">{appr.agentName}</span>
                  </div>
                  <div className="font-mono text-xs bg-kin-bg px-2.5 py-1.5 rounded border border-kin-border text-kin-text">
                    {appr.actionSummary}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => resolveApproval(appr.id, false)}
                    className="px-3 py-1.5 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 font-medium transition"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => resolveApproval(appr.id, true)}
                    className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
            {pendingApprovals.length === 0 && (
              <div className="text-xs text-kin-muted italic">No pending approval requests.</div>
            )}
          </div>
        )}

        {/* Normal Messages */}
        {channelMessages.map((msg) => (
          <div key={msg.id} className="flex space-x-3 text-xs leading-relaxed group">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${
                msg.senderType === 'human'
                  ? 'bg-blue-600 text-white'
                  : msg.senderType === 'system'
                  ? 'bg-amber-600/30 text-amber-400'
                  : 'bg-purple-600/30 text-purple-400'
              }`}
            >
              {msg.senderName.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-kin-text">{msg.senderName}</span>
                <span className="text-[10px] text-kin-muted">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.productivityScore !== undefined && msg.productivityScore > 0 && (
                  <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1 py-0.2 rounded font-mono">
                    verified turn
                  </span>
                )}
              </div>
              <div className="text-kin-text whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {/* Tie-Breaker Decision Card Demo in #architecture */}
        {activeChannelId === 'chan-architecture' && showDemoConflict && (
          <DecisionCard
            title="Peer Agent Stalemate Detected"
            topic="Contention: Unnested Flat JSON vs Relational Normalization"
            optionA={{
              label: 'Option A (@FrontendLead): Flat JSON',
              pros: 'High rendering speed, zero client-side selector overhead.',
              cons: 'Relational denormalization, redundant payload bytes.',
            }}
            optionB={{
              label: 'Option B (@BackendLead): Normalized JSON',
              pros: 'Strict domain model consistency, clean DB schema mapping.',
              cons: 'Client selector lag on 10,000+ item renders.',
            }}
            onSelect={(choice) => {
              sendMessage(
                choice === 'compromise'
                  ? 'Human Operator approved Orchestrator compromise: Backend returns normalized JSON, Frontend uses auto-generated fast client selector.'
                  : `Human Operator selected Option ${choice}.`
              );
              setShowDemoConflict(false);
            }}
          />
        )}
      </div>

      {/* Message Composer */}
      <form onSubmit={handleSend} className="p-4 border-t border-kin-border bg-kin-surface/30">
        <div className="flex items-center bg-kin-card border border-kin-border rounded-lg px-3 py-2 focus-within:border-blue-500 transition-colors">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Message #${activeChannel?.name || 'channel'} (mention @FrontendLead, @BackendLead, or @Orchestrator)...`}
            className="flex-1 bg-transparent text-xs text-kin-text placeholder-kin-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="ml-2 text-blue-500 hover:text-blue-400 disabled:opacity-40 transition-opacity"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </main>
  );
};
