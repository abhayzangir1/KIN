import React, { useState, useRef, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import {
  MessageSquare,
  Code2,
  Layers,
  Cpu,
  Search,
  Globe,
  Database,
  BookOpen,
  FileCode,
  Send,
  Mic,
  Paperclip,
  AtSign,
  User,
  Bot,
} from 'lucide-react';

export const CenterView: React.FC = () => {
  const {
    channels,
    activeChannelId,
    messages,
    sendMessage,
    activeCenterTab,
    setActiveCenterTab,
  } = useKinStore();

  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeChannel = channels.find((c) => c.id === activeChannelId) || channels[0];
  const channelMessages = messages.filter((m) => m.channelId === activeChannelId || !m.channelId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendMessage(inputText.trim());
    setInputText('');
  };

  const tabs = [
    { id: 'Chat', icon: MessageSquare },
    { id: 'Code', icon: Code2 },
    { id: 'Swarm', icon: Layers },
    { id: 'Fleet', icon: Cpu },
    { id: 'Research', icon: Search },
    { id: 'Browser', icon: Globe },
    { id: 'Memory', icon: Database },
    { id: 'Docs', icon: BookOpen },
    { id: 'Artifacts', icon: FileCode },
  ] as const;

  return (
    <main className="flex-1 flex flex-col h-full bg-[#0a0f1d] min-w-0">
      {/* Top Sub-Navigation Tabs */}
      <div className="h-10 border-b border-[#1e293b] px-4 flex items-center space-x-1 text-xs select-none bg-[#090d16]/70">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeCenterTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveCenterTab(tab.id)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs transition font-medium ${
                isActive
                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-[#94a3b8] hover:text-kin-text hover:bg-[#131b2e]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.id}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-xs">
        {activeCenterTab === 'Chat' ? (
          <>
            {channelMessages.map((msg) => {
              const isHuman = msg.senderType === 'human';
              return (
                <div key={msg.id} className="flex space-x-3 group">
                  {/* Avatar */}
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-white ${
                      isHuman ? 'bg-emerald-600' : 'bg-[#1e293b] border border-amber-500/40 text-amber-300'
                    }`}
                  >
                    {isHuman ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-amber-300" />}
                  </div>

                  {/* Message Body */}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-kin-text">{isHuman ? 'Human' : 'Boss'}</span>

                      {/* Badge */}
                      {isHuman ? (
                        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-mono font-bold">
                          Human
                        </span>
                      ) : (
                        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono font-bold">
                          Lead Sovereign Orchestrator
                        </span>
                      )}

                      <span className="text-[10px] text-[#64748b]">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="text-[#e2e8f0] text-xs leading-relaxed whitespace-pre-wrap font-sans bg-[#0f172a]/50 p-2.5 rounded-lg border border-[#1e293b]/50">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-kin-muted italic">
            <span>{activeCenterTab} workspace surface is ready for sovereign agent operations.</span>
          </div>
        )}
      </div>

      {/* Bottom Message Input Box */}
      <div className="p-3 border-t border-[#1e293b] bg-[#090d16]">
        <form
          onSubmit={handleSend}
          className="flex items-center bg-[#0f172a] border border-[#2d3748] rounded-xl px-3 py-2 focus-within:border-emerald-500 transition-colors shadow-lg"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Message #${activeChannel?.name || 'general'} (type '/' for slash commands, '@' for agents)...`}
            className="flex-1 bg-transparent text-xs text-kin-text placeholder-[#64748b] focus:outline-none"
          />

          <div className="flex items-center space-x-1.5 ml-2 text-[#64748b]">
            <button type="button" className="p-1 hover:text-kin-text transition" title="Voice Input">
              <Mic className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="p-1 hover:text-kin-text transition" title="Attach File">
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="p-1 hover:text-kin-text transition" title="Mention Agent">
              <AtSign className="w-3.5 h-3.5" />
            </button>
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:hover:bg-emerald-600 text-white transition ml-1"
              title="Send Message"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </main>
  );
};
