import React, { useState, useRef, useEffect } from 'react';
import { useKinStore, isAgentAvailable } from '../store/kinStore.js';
import {
  MessageSquare,
  Send,
  Mic,
  Paperclip,
  AtSign,
  User,
  Bot,
  UserPlus,
  X,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Terminal,
  Zap,
  Inbox,
  Timer,
  Clock,
  Monitor,
  Quote,
  FileUp,
  Loader2,
  ChevronDown,
  ChevronRight,
  Flame,
  Lightbulb,
  Info,
  Compass,
  Plus,
  Cpu,
  Wrench,
} from 'lucide-react';
import { HumanTakeoverBanner } from './HumanTakeoverBanner.js';
import { AutomationsView } from './AutomationsView.js';
import { DecisionCard } from './DecisionCard.js';
import { AgentModelQuickSwitch } from './AgentModelQuickSwitch.js';

export const CenterView: React.FC = () => {
  const {
    channels,
    activeChannelId,
    channelMembers,
    agents,
    autonomyMode,
    setAutonomyMode,
    updateAgentModel,
    ollamaStatus,
    credentials,
    availableModels,
    messages,
    schedules,
    latestRoutingByChannel,
    cancelSchedule,
    sendMessage,
    removeChannelMember,
    setAddAgentModalOpen,
    setSelectedAgentId,
    activeProjectId,
    pendingApprovals,
    resolveApproval,
    setActiveRightTab,
    steerNotification,
    queuedMessages,
    streamingDrafts,
    activeAgentChannels,
    queueMessage,
    dequeueMessage,
    promoteQueuedToSteer,
    browserStatus,
    activeTakeover,
    activeTakeovers,
    setDesktopControlModalOpen,
    setAutomationsModalOpen,
    uploadFile,
    isUploading,
    activeMainView,
    setActiveMainView,
    systemHealth,
    pendingRecoveries,
    quotaPauseState,
    grillMeSession,
    fetchRecoveryState,
    resumeAllRecoveries,
    discardRecoveries,
    resumeRun,
    switchRunToOllama,
    submitGrillMeAnswers,
    dismissGrillMe,
    clearQuotaPause,
    skills,
    fetchSkills,
    setSettingsModalOpen,
    setConnectorsModalOpen,
  } = useKinStore();

  const isMachineTool = (tool?: string) => {
    if (!tool) return false;
    return (
      ['computer', 'application', 'browser'].includes(tool) ||
      tool.startsWith('desktop') ||
      tool.startsWith('browser')
    );
  };

  const channelTakeover =
    activeTakeover?.channelId === activeChannelId
      ? activeTakeover
      : Object.values(activeTakeovers || {}).find((t) => t.channelId === activeChannelId);

  const activeMachineTool =
    (channelTakeover?.activeTool && isMachineTool(channelTakeover.activeTool) ? channelTakeover.activeTool : undefined) ||
    (channelTakeover?.previewPayload?.toolName && isMachineTool(channelTakeover.previewPayload.toolName) ? channelTakeover.previewPayload.toolName : undefined) ||
    (browserStatus?.active ? 'browser' : undefined);

  const isMachineControlActive =
    !!activeMachineTool ||
    (browserStatus?.active && (activeChannelId === 'chan-general' || activeChannelId.startsWith('dm-')));

  const activeMachineAgent =
    (channelTakeover?.agentId && agents.find((a) => a.id === channelTakeover.agentId)?.displayName) ||
    '@Agent';

  const isDm = activeChannelId.startsWith('dm-');
  const activeChanObj = channels.find((c) => c.id === activeChannelId);
  const isAgentToAgentDm = React.useMemo(() => {
    if (!activeChannelId) return false;
    if (activeChanObj?.channelType === 'direct_message' || activeChanObj?.isPrivate) {
      if (activeChannelId.startsWith('dm-') && activeChannelId.replace(/^dm-/, '').split('-agent-').length > 1) return true;
      if (activeChanObj?.memberIds && activeChanObj.memberIds.length >= 2) return true;
      if (activeChannelId.startsWith('dm-') && !agents.some((a) => `dm-${a.id}` === activeChannelId)) return true;
    }
    return false;
  }, [activeChannelId, activeChanObj, agents]);
  const targetAgentId = (isDm && !isAgentToAgentDm) ? activeChannelId.replace(/^dm-/, '') : null;
  const isChannelExecuting =
    Object.values(activeAgentChannels).includes(activeChannelId) ||
    (isDm && !!targetAgentId && (activeAgentChannels[targetAgentId] === activeChannelId || agents.some((a) => a.id === targetAgentId && (a.status === 'thinking' || a.status === 'working')))) ||
    (!isDm && (
      agents.some((a) => (a.status === 'thinking' || a.status === 'working') && activeAgentChannels[a.id] === activeChannelId) ||
      channelMembers.some((m) => m.status === 'thinking' || m.status === 'working')
    ));
  const channelQueuedMessages = queuedMessages.filter((q) => q.channelId === activeChannelId);

  const [inputText, setInputText] = useState(() => {
    try {
      return activeChannelId ? (localStorage.getItem(`kin_draft_${activeChannelId}`) || '') : '';
    } catch {
      return '';
    }
  });

  // Restore unsent message draft whenever activeChannelId changes
  useEffect(() => {
    if (!activeChannelId) {
      setInputText('');
      return;
    }
    try {
      const saved = localStorage.getItem(`kin_draft_${activeChannelId}`);
      setInputText(saved || '');
    } catch {
      setInputText('');
    }
  }, [activeChannelId]);

  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [isListening, setIsListening] = useState(false);
  const [isDragOverChat, setIsDragOverChat] = useState(false);
  const [chatUploadStatus, setChatUploadStatus] = useState<string | null>(null);
  const [expandedBackgroundTurns, setExpandedBackgroundTurns] = useState<Record<string, boolean>>({});
  const [dismissHealthBanner, setDismissHealthBanner] = useState(false);
  const [dismissedRoutingChannels, setDismissedRoutingChannels] = useState<Record<string, boolean>>({});
  const [grillMeAnswers, setGrillMeAnswers] = useState<Record<string, string>>({});
  const [inspectingRecovery, setInspectingRecovery] = useState<any | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const isSteeringRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  const handleChatFileUpload = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setChatUploadStatus(`Uploading ${files.length} file(s)...`);
    const attachedLinks: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const res = await uploadFile(file);
      if (res.success) {
        attachedLinks.push(`[📎 ${file.name}]`);
      } else {
        setChatUploadStatus(`Upload error: ${res.error || 'Failed'}`);
        setTimeout(() => setChatUploadStatus(null), 3000);
      }
    }

    if (attachedLinks.length > 0) {
      setInputText((prev) => (prev ? `${prev} ${attachedLinks.join(' ')} ` : `${attachedLinks.join(' ')} `));
      setChatUploadStatus(`Attached ${attachedLinks.length} file(s)`);
      setTimeout(() => setChatUploadStatus(null), 2500);
      inputRef.current?.focus();
    }
  };

  useEffect(() => {
    setSlashSelectedIndex(0);
    setMentionSelectedIndex(0);
  }, [inputText]);

  useEffect(() => {
    fetchRecoveryState();
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const activeSchedules = (schedules || []).filter(
    (s) => s.status === 'active' && (s.channelId === activeChannelId || !s.channelId) && s.nextRunAt > now
  );

  const toggleVoiceDictation = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Web Speech API is not supported in this browser.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => (result[0] as any).transcript)
          .join('');
        setInputText(transcript);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const targetAgent = isDm ? agents.find((a) => a.id === targetAgentId) : null;
  const activeChannel = channels.find((c) => c.id === activeChannelId) || channels[0];

  const channelMessages = messages.filter((m) => m.channelId === activeChannelId || !m.channelId);

  const handleQueueNext = () => {
    if (!inputText.trim()) return;
    queueMessage(activeChannelId, inputText.trim());
    setInputText('');
    if (activeChannelId) {
      try {
        localStorage.removeItem(`kin_draft_${activeChannelId}`);
      } catch {}
    }
    setShowMentionMenu(false);
    setShowSlashMenu(false);
  };

  const scopedPendingApprovals = React.useMemo(() => {
    return pendingApprovals.filter(
      (appr) => (appr.projectId || (appr as any).project_id) === activeProjectId
    );
  }, [pendingApprovals, activeProjectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [activeChannelId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length, channelMessages[channelMessages.length - 1]?.content]);

  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const [showAutonomyMenu, setShowAutonomyMenu] = useState(false);
  const autonomyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setShowPlusMenu(false);
      }
      if (autonomyMenuRef.current && !autonomyMenuRef.current.contains(e.target as Node)) {
        setShowAutonomyMenu(false);
      }
    };
    if (showPlusMenu || showAutonomyMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPlusMenu, showAutonomyMenu]);

  const baseSlashCommands = [
    { cmd: '/plan', desc: 'Generate multi-phase plan in DAG (e.g. /plan Core Architecture)' },
    { cmd: '/boost', desc: 'Deep architecture audit & autonomous verification directive' },
    { cmd: '/teamwork-preview', desc: 'Inspect workforce topology & model readiness' },
    { cmd: '/goal', desc: 'Create milestone & orchestrate subtasks (e.g. /goal Ship Feature)' },
    { cmd: '/schedule', desc: 'Schedule timed wakeup alarm (e.g. /schedule 5s check)' },
    { cmd: '/routine', desc: 'Schedule proactive recurring routine' },
    { cmd: '/timer', desc: 'Alias for /schedule' },
    { cmd: '/compact', desc: 'Compact active channel turns into structured summary' },
    { cmd: '/browser', desc: 'Control persistent browser session (e.g. /browser <url>)' },
    { cmd: '/learn', desc: 'Persist operational pattern into Tier 1 Project Memory' },
    { cmd: '/skills', desc: 'Browse and inspect installed agent skills' },
    { cmd: '/mcp', desc: 'Manage MCP connectors & inspect live tools (/mcp reload)' },
    { cmd: '/connectors', desc: 'Open MCP Connectors & Servers management modal' },
    { cmd: '/decisions', desc: 'Architecture Decision Records (ADR)' },
    { cmd: '/hire', desc: 'Hire new specialist' },
    { cmd: '/assign', desc: 'Assign agent to channel' },
    { cmd: '/btw', desc: 'Ephemeral side query without polluting active context' },
    { cmd: '/grill-me', desc: 'Adversarial architectural assessment & tradeoff analysis' },
    { cmd: '/clear', desc: 'Clear input' },
  ];

  const slashCommands = React.useMemo(() => {
    const list: Array<{ cmd: string; desc: string; isSkill?: boolean }> = [...baseSlashCommands];
    if (Array.isArray(skills) && skills.length > 0) {
      skills.forEach((sk) => {
        const slug = sk.name.toLowerCase().replace(/\s+/g, '-');
        list.push({
          cmd: `/skill:${slug}`,
          desc: `Skill: ${sk.description || sk.name}`,
          isSkill: true,
        });
      });
    }
    return list;
  }, [skills]);

  const lastSlashWord = inputText.split(/\s/).pop() || '';
  const matchingSlashCommands = slashCommands.filter((c) => {
    if (!lastSlashWord.startsWith('/')) return false;
    const q = lastSlashWord.slice(1).toLowerCase();
    if (!q) return true;
    return c.cmd.toLowerCase().slice(1).startsWith(q) || c.cmd.toLowerCase().slice(1).includes(q);
  });

  const matchingAgents = agents
    .filter((ag) => isAgentAvailable(ag, ollamaStatus, credentials, availableModels))
    .filter((ag) => {
      const lastWord = inputText.split(/\s/).pop() || '';
      const query = lastWord.startsWith('@') ? lastWord.slice(1).toLowerCase() : '';
      return ag.displayName.toLowerCase().replace(/^@/, '').includes(query);
    });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);
    if (activeChannelId) {
      try {
        if (val.trim()) {
          localStorage.setItem(`kin_draft_${activeChannelId}`, val);
        } else {
          localStorage.removeItem(`kin_draft_${activeChannelId}`);
        }
      } catch {}
    }

    // Mention trigger check
    const lastWord = val.split(/\s/).pop() || '';
    if (lastWord.startsWith('@')) {
      setShowMentionMenu(true);
      setShowSlashMenu(false);
      setMentionSelectedIndex(0);
    } else if (lastWord.startsWith('/')) {
      setShowSlashMenu(true);
      setShowMentionMenu(false);
      setSlashSelectedIndex(0);
    } else {
      setShowMentionMenu(false);
      setShowSlashMenu(false);
    }
  };

  const handleInsertMention = (agentName: string) => {
    const words = inputText.split(/\s/);
    words.pop();
    const cleanHandle = agentName.startsWith('@') ? agentName : `@${agentName}`;
    const newText = (words.length > 0 ? words.join(' ') + ' ' : '') + cleanHandle + ' ';
    setInputText(newText);
    setShowMentionMenu(false);
    inputRef.current?.focus();
  };

  const handleSlashCommand = (cmd: string) => {
    setShowSlashMenu(false);
    if (cmd === '/clear') {
      setInputText('');
      inputRef.current?.focus();
      return;
    }
    if (cmd === '/connectors') {
      setConnectorsModalOpen(true);
      setInputText('');
      inputRef.current?.focus();
      return;
    }
    // Antigravity style: replace active slash token with selected command and trailing space
    const words = inputText.split(/\s/);
    words.pop();
    const newText = (words.length > 0 ? words.join(' ') + ' ' : '') + `${cmd} `;
    setInputText(newText);
    inputRef.current?.focus();
  };

  const handleQuoteMessage = (msg: any) => {
    let sender = msg.senderType === 'human' ? 'Human' : msg.senderName;
    if (sender && sender.startsWith('@')) {
      sender = sender.slice(1);
    }
    const cleanContent = msg.content.length > 250 ? msg.content.slice(0, 250) + '...' : msg.content;
    const formatted = `> [Quote @${sender}]: "${cleanContent.replace(/\r?\n/g, ' ')}"\n\n`;
    setInputText((prev) => formatted + prev);
    inputRef.current?.focus();
  };

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

  const isSlashCard = (text: string) => {
    return (
      text.includes('🚀 **Compound Pipeline Engaged**') ||
      text.includes('⚡ **Compound Pipeline Engaged**') ||
      text.includes('🎯 **Compound Pipeline Engaged**') ||
      text.includes('🚀 **Boost Mode Engaged**') ||
      text.includes('👥 **Workforce Collaboration Matrix**') ||
      text.includes('📋 **Execution Plan Initialized**') ||
      text.includes('🎯 **Goal Registered**') ||
      text.includes('⏱️ **Timer Initialized**') ||
      text.includes('🔄 **Proactive Personal Routine Configured**') ||
      text.includes('🛡️ **Supervisor Self-Healing**') ||
      text.includes('💡 **[Side Query / BTW]**') ||
      text.includes('🔥 **Adversarial Architectural Assessment (/grill-me)**') ||
      text.includes('🛡️ **Hardened Architecture Decision Record (ADR)**')
    );
  };

  const stripThoughtsAndToolSyntax = (raw: string): string => {
    if (!raw) return '';
    let text = raw;
    // Strip <think>...</think>, <thought>...</thought>, <reasoning>...</reasoning>, <tool_call>...</tool_call>
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
    text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
    text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    // Strip unclosed <think> or <reasoning> tags
    text = text.replace(/<(?:think|thought|reasoning)>[\s\S]*$/gi, '');
    // Strip leading "Thinking Process: ... \n\n"
    text = text.replace(/^Thinking Process:[\s\S]*?\n\n/i, '');
    return text.trim();
  };

  const renderMessageContent = (content: string, isHumanMsg?: boolean) => {
    const cleaned = isHumanMsg ? content : stripThoughtsAndToolSyntax(content);
    const textToRender = cleaned || content;

    // Check for fenced code blocks ```lang ... ```
    if (textToRender.includes('```')) {
      const segments = textToRender.split(/(```[a-zA-Z0-9_-]*[\s\S]*?```)/g);
      return segments.map((seg, sIdx) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const firstLineBreak = seg.indexOf('\n');
          const lang = firstLineBreak !== -1 ? seg.slice(3, firstLineBreak).trim() : '';
          const codeBody = firstLineBreak !== -1 ? seg.slice(firstLineBreak + 1, -3) : seg.slice(3, -3);
          return (
            <div key={sIdx} className="my-2 rounded-lg border border-slate-300 dark:border-[#30363d] bg-slate-100 dark:bg-[#0d1117] overflow-hidden shadow-xs">
              {lang && (
                <div className="flex items-center justify-between px-3 py-1 bg-slate-200/70 dark:bg-[#161b22] border-b border-slate-300 dark:border-[#30363d] text-[10px] font-mono text-slate-700 dark:text-[#8b949e]">
                  <span>{lang}</span>
                </div>
              )}
              <pre className="p-3 text-[11px] font-mono text-slate-800 dark:text-[#e2e8f0] overflow-x-auto leading-relaxed">
                <code>{codeBody}</code>
              </pre>
            </div>
          );
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

    const paragraphs = textToRender.split(/\n\n+/);
    return paragraphs.map((para, pIdx) => {
      const trimmed = para.trim();
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

  const parseDecisionProposal = (content: string) => {
    const cardMatch = content.match(/\[DECISION_CARD\]([\s\S]*?)\[\/DECISION_CARD\]/);
    if (cardMatch) {
      try {
        return JSON.parse(cardMatch[1]);
      } catch {}
    }
    if (content.includes('### Architectural Tie-Breaker') || content.includes('Tie-Breaker Escalation') || content.includes('Decision Card:')) {
      const titleMatch = content.match(/(?:### Architectural Tie-Breaker|Proposed Plan Decision|Decision Card:)\s*([^\n]+)/);
      const optAMatch = content.match(/Option A:\s*([^\n]+)/);
      const optBMatch = content.match(/Option B:\s*([^\n]+)/);
      if (optAMatch && optBMatch) {
        return {
          title: titleMatch ? titleMatch[1].trim() : 'Architectural Plan Decision',
          topic: 'Interactive plan review',
          optionA: { label: optAMatch[1].trim(), pros: 'Primary recommended path', cons: 'May require verification' },
          optionB: { label: optBMatch[1].trim(), pros: 'Alternative implementation', cons: 'Different trade-offs' },
          recommendation: 'Evaluate tradeoffs before selection',
        };
      }
    }
    return null;
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending) return;
    if (isChannelExecuting && !inputText.trim().startsWith('/') && !inputText.trim().startsWith('>')) {
      handleQueueNext();
      return;
    }
    const textToSend = inputText.trim();
    setSendError(null);
    setIsSending(true);
    const res = await sendMessage(textToSend);
    setIsSending(false);
    if (res && !res.success) {
      setSendError(res.error || 'Failed to deliver message');
    } else {
      setInputText('');
      if (activeChannelId) {
        try {
          localStorage.removeItem(`kin_draft_${activeChannelId}`);
        } catch {}
      }
      setSendError(null);
      setShowMentionMenu(false);
      setShowSlashMenu(false);
    }
  };

  if (activeMainView === 'automations') {
    return <AutomationsView />;
  }

  return (
    <main className="flex-1 flex flex-col h-full bg-kin-bg min-w-0 relative">
      {/* Context Scope Header Bar */}
      <div className="border-b border-kin-border bg-kin-surface py-2.5">
        <div className="max-w-4xl mx-auto w-full px-6 flex items-center justify-between text-xs">
        {isAgentToAgentDm ? (
          <div className="flex items-center space-x-2 truncate">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 shadow-[0_0_6px_#818cf8]" />
            <div className="flex items-center space-x-2">
              <span className="font-bold text-indigo-300 text-sm">{activeChannel?.name || activeChannelId}</span>
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                Operator Inspection Mode
              </span>
            </div>
            <span className="text-[#64748b] text-[11px] truncate hidden md:inline">
              Private coworker direct message thread
            </span>
          </div>
        ) : isDm ? (
          <div className="flex items-center justify-between w-full min-w-0 overflow-hidden">
            <div className="flex items-center space-x-2 truncate">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
              <div className="flex items-center space-x-2">
                <span className="font-bold text-kin-text text-sm">{targetAgent?.displayName || '@Agent'}</span>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                  {targetAgent?.role || 'Specialist'}
                </span>
              </div>
              <span className="text-[#64748b] text-[11px] truncate hidden md:inline">
                Private 1-on-1 Direct Message thread
              </span>
            </div>
            {targetAgent && (
              <div className="flex items-center space-x-2 shrink-0 ml-2">
                <span className="text-[10px] text-kin-muted hidden sm:inline font-mono">Model:</span>
                <AgentModelQuickSwitch
                  agent={targetAgent}
                  availableModels={availableModels}
                  updateAgentModel={updateAgentModel}
                  projectId={activeProjectId}
                  channelId={activeChannelId}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between w-full min-w-0 overflow-hidden">
            {/* Channel Info */}
            <div className="flex items-center space-x-2 shrink-0 mr-3 min-w-0">
              <span className="text-emerald-400 font-mono font-bold text-sm shrink-0">#</span>
              <span className="font-bold text-kin-text text-sm shrink-0 truncate max-w-[160px]">{activeChannel?.name || 'general'}</span>
              {activeChannel?.topic && (
                <span className="text-[#64748b] text-[11px] truncate hidden xl:inline max-w-[200px]">
                  — {activeChannel.topic}
                </span>
              )}
            </div>

            {/* Channel Members Pill Bar & Action */}
            <div className="flex items-center space-x-2 min-w-0 overflow-hidden shrink">
              <div className="flex items-center space-x-1.5 overflow-x-auto max-w-xs md:max-w-md py-0.5 no-scrollbar shrink">
                {channelMembers.map((member) => (
                  <span
                    key={member.id}
                    className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono border shrink-0 ${
                      member.isOrchestrator
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        : 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                    }`}
                  >
                    <span
                      onClick={() => setSelectedAgentId(member.id)}
                      className="cursor-pointer hover:underline"
                      title={`Inspect ${member.displayName} in Agent Inspector`}
                    >
                      {member.displayName}
                    </span>
                    <AgentModelQuickSwitch
                      agent={member}
                      availableModels={availableModels}
                      updateAgentModel={updateAgentModel}
                      projectId={activeProjectId}
                      channelId={activeChannelId}
                      compact
                    />
                    {member.isOrchestrator ? (
                      <span title="Default Orchestrator (Permanent)">
                        <Shield className="w-2.5 h-2.5 text-amber-400 ml-0.5" />
                      </span>
                    ) : (
                      <button
                        onClick={() => removeChannelMember(activeChannelId, member.id)}
                        className="hover:text-red-400 transition ml-0.5 cursor-pointer"
                        title={`Remove ${member.displayName} from this channel`}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>

              {/* Add Agent Button */}
              <button
                onClick={() => setAddAgentModalOpen(true)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-[#1e293b] hover:bg-emerald-600/30 hover:text-emerald-300 text-kin-text border border-[#2d3748] text-[11px] transition shrink-0"
                title="Assign Existing Agent or Hire Specialist"
              >
                <UserPlus className="w-3 h-3 text-emerald-400" />
                <span>+ Add Agent</span>
              </button>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Notifications and Diagnostics Banners */}
      {(isAgentToAgentDm || (systemHealth && systemHealth.status !== 'healthy' && !dismissHealthBanner) || (latestRoutingByChannel[activeChannelId] && !dismissedRoutingChannels[activeChannelId])) && (
        <div className="w-full max-w-4xl mx-auto px-6 space-y-2 mt-2">
          {/* Operator Inspection Mode Banner for Coworker DMs */}
          {isAgentToAgentDm && (
            <div className="px-3.5 py-2 rounded-xl bg-indigo-950/70 border border-indigo-500/50 text-indigo-200 text-xs flex items-center justify-between shadow-lg animate-fadeIn">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>
                  <strong>Operator Inspection Mode:</strong> Live confidential coworker direct message. Non-member agents cannot access this transcript.
                </span>
              </div>
              <span className="font-mono text-[10px] uppercase bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/30">
                Read-Only Audit Visibility
              </span>
            </div>
          )}

          {/* System Health Diagnostics Warning Banner */}
          {systemHealth && systemHealth.status !== 'healthy' && !dismissHealthBanner && (
            <div className="px-3.5 py-2 rounded-xl bg-amber-950/70 border border-amber-500/50 text-amber-200 text-xs flex items-center justify-between shadow-lg animate-fadeIn">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>System Diagnostics:</strong> Health status is <span className="font-mono uppercase font-bold text-amber-300">{systemHealth.status}</span>.
                  {systemHealth.activeAlerts && systemHealth.activeAlerts.length > 0 && ` Active Alerts: [${systemHealth.activeAlerts.join(', ')}]`}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setActiveMainView('automations')}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-mono text-[10px] border border-amber-500/30 cursor-pointer"
                >
                  Governor Telemetry
                </button>
                <button
                  onClick={() => setDismissHealthBanner(true)}
                  className="text-amber-400 hover:text-amber-200 p-0.5 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Dynamic Agent Routing Observability Banner */}
          {latestRoutingByChannel[activeChannelId] && !dismissedRoutingChannels[activeChannelId] && (
            <div className="px-3 py-1.5 rounded-lg bg-cyan-50 dark:bg-[#0e1628] border border-cyan-200 dark:border-cyan-800/40 text-[11px] text-cyan-900 dark:text-cyan-300 flex items-center justify-between shadow-sm">
              <div className="flex items-center space-x-2 truncate">
                <Compass className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                <span className="font-semibold text-cyan-950 dark:text-white">Agent Routing:</span>
                <span className="truncate">
                  {latestRoutingByChannel[activeChannelId].routing.reason}
                  {latestRoutingByChannel[activeChannelId].routing.matchReason && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-400 font-mono text-[10px] border border-cyan-300 dark:border-cyan-700/50">
                      {latestRoutingByChannel[activeChannelId].routing.matchReason}
                    </span>
                  )}
                </span>
                {latestRoutingByChannel[activeChannelId].routing.matchedKeywords &&
                  latestRoutingByChannel[activeChannelId].routing.matchedKeywords.length > 0 && (
                    <div className="flex items-center space-x-1 shrink-0 ml-1.5">
                      {latestRoutingByChannel[activeChannelId].routing.matchedKeywords.map((kw, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded bg-cyan-200/60 dark:bg-cyan-900/60 text-cyan-900 dark:text-cyan-200 font-mono text-[9px] border border-cyan-400/40 dark:border-cyan-600/40"
                          title={`Matched keyword: ${kw}`}
                        >
                          #{kw}
                        </span>
                      ))}
                    </div>
                  )}
              </div>
              <div className="flex items-center space-x-2 shrink-0 ml-2">
                <span className="text-kin-muted text-[10px] font-mono">
                  {latestRoutingByChannel[activeChannelId].routing.action}
                </span>
                <button
                  onClick={() => setDismissedRoutingChannels((prev) => ({ ...prev, [activeChannelId]: true }))}
                  className="text-cyan-700 dark:text-[#64748b] hover:text-cyan-950 dark:hover:text-white p-0.5 cursor-pointer"
                  title="Dismiss routing info"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Conversation Stream */}
      <div className="flex-1 overflow-y-auto font-sans text-xs">
        <div className="max-w-4xl mx-auto px-6 py-5 space-y-4">
        {channelMessages.map((msg) => {
          const isHuman = msg.senderType === 'human';
          const agent = agents.find((a) => a.id === msg.senderId);

          const isBackgroundTurn =
            msg.content.includes('[Automated Turn]') ||
            msg.content.includes('[Scheduled Wakeup]') ||
            msg.content.includes('[Background Task]') ||
            msg.content.includes('⏰ Wakeup Timer Fired') ||
            msg.content.includes('Timer / Scheduled Alarm') ||
            msg.content.includes('⏰ **Timer') ||
            msg.content.includes('🔄 Proactive Routine') ||
            msg.content.includes('🤖 [Automated Wakeup]');

          if (isBackgroundTurn) {
            const isExpanded = !!expandedBackgroundTurns[msg.id];
            return (
              <div
                key={msg.id}
                className="p-3 rounded-xl bg-cyan-50/90 dark:bg-[#090f1d] border border-cyan-200 dark:border-cyan-500/40 shadow-sm space-y-2"
              >
                <div
                  onClick={() =>
                    setExpandedBackgroundTurns((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                  }
                  className="flex items-center justify-between cursor-pointer select-none group"
                >
                  <div className="flex items-center space-x-2">
                    <span className="p-1 rounded bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300">
                      <Clock className="w-3.5 h-3.5" />
                    </span>
                    <span className="text-[11px] font-bold text-cyan-900 dark:text-cyan-200">
                      Background Turn — {agent?.displayName || msg.senderName}
                    </span>
                    <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-cyan-100 dark:bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 font-mono border border-cyan-300 dark:border-cyan-500/30">
                      Automated
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] text-kin-muted">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-kin-muted group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition" />
                    )}
                  </div>
                </div>

                {isExpanded ? (
                  <div className="text-kin-text text-xs leading-relaxed font-sans p-2.5 rounded-lg border bg-white dark:bg-[#0f172a]/90 border-cyan-500/20 dark:border-[#1e293b]">
                    {renderMessageContent(msg.content)}
                  </div>
                ) : (
                  <div
                    onClick={() =>
                      setExpandedBackgroundTurns((prev) => ({ ...prev, [msg.id]: true }))
                    }
                    className="text-[11px] text-kin-muted truncate italic pl-6 cursor-pointer hover:text-cyan-700 dark:hover:text-cyan-300 transition"
                  >
                    {msg.content.slice(0, 140)}... (click to expand)
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex space-x-3 group relative">
              {/* Avatar */}
              <div
                className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-white ${
                  isHuman
                    ? 'bg-emerald-600'
                    : agent?.isOrchestrator
                    ? 'bg-[#1e293b] border border-amber-500/40 text-amber-300 font-bold'
                    : 'bg-[#1e293b] border border-blue-500/40 text-blue-300 font-bold'
                }`}
              >
                {isHuman ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Body */}
              <div className="flex-1 space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-kin-text">
                    {isHuman ? 'Human' : agent?.displayName || msg.senderName}
                  </span>

                  {/* Role Badge */}
                  {isHuman ? (
                    <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-mono font-bold">
                      Human
                    </span>
                  ) : agent?.isOrchestrator ? (
                    <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono font-bold">
                      Workspace Orchestrator
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono font-bold">
                      {agent?.role || 'Specialist'}
                    </span>
                  )}

                  {/* Model Tag & Quick Switch for Agents */}
                  {!isHuman && agent && (
                    <AgentModelQuickSwitch
                      agent={agent}
                      availableModels={availableModels}
                      updateAgentModel={updateAgentModel}
                      projectId={activeProjectId}
                      channelId={activeChannelId}
                      compact
                    />
                  )}

                  <span className="text-[10px] text-[#64748b]">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>

                  {/* Steering Directive Badge */}
                  {msg.isSteer && (
                    <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono font-bold flex items-center space-x-1 border border-amber-500/30">
                      <Zap className="w-2.5 h-2.5 text-amber-400" />
                      <span>Steer Directive</span>
                    </span>
                  )}

                  {/* Quote action button on hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => handleQuoteMessage(msg)}
                      className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#1e293b] hover:bg-emerald-600/30 hover:text-emerald-300 text-[#94a3b8] text-[10px] font-mono transition"
                      title="Quote this message in reply"
                    >
                      <Quote className="w-2.5 h-2.5 text-emerald-400" />
                      <span>Quote</span>
                    </button>
                  </div>
                </div>

                {(() => {
                  const isSideQuery = msg.content.startsWith('/btw') || msg.content.includes('💡 **[Side Query / BTW]**') || (msg.metadata && msg.metadata.isSideQuery);
                  const decision = parseDecisionProposal(msg.content);
                  return (
                    <div
                      className={`text-kin-text text-xs leading-relaxed font-sans p-3 rounded-xl border transition ${
                        isSideQuery
                          ? 'bg-amber-500/10 border-amber-500/30'
                          : isSlashCard(msg.content)
                          ? 'bg-blue-500/10 border-blue-500/30'
                          : isHuman
                          ? 'bg-emerald-500/10 border-emerald-500/20'
                          : 'bg-kin-card border-kin-border'
                      }`}
                    >
                      {isSideQuery && (
                        <div className="flex items-center space-x-1.5 mb-2 pb-1.5 border-b border-amber-500/30 text-amber-300 font-mono text-[10px] font-bold">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>EPHEMERAL SIDE QUERY (/btw) — UNPOLLUTED ACTIVE CONTEXT</span>
                        </div>
                      )}
                      {renderMessageContent(msg.content, isHuman)}
                      {decision && (
                        <DecisionCard
                          title={decision.title}
                          topic={decision.topic || 'Workforce Plan Review'}
                          optionA={decision.optionA}
                          optionB={decision.optionB}
                          recommendation={decision.recommendation}
                          onSelect={(opt) => {
                            sendMessage(`/decisions choose ${opt === 'compromise' ? 'Compromise' : `Option ${opt}`}: ${opt === 'A' ? decision.optionA.label : opt === 'B' ? decision.optionB.label : decision.recommendation || 'Compromise'}`);
                          }}
                        />
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
        {channelMessages.length === 0 && (
          <div className="h-56 flex flex-col items-center justify-center text-center p-6 space-y-2 border border-dashed border-slate-300 dark:border-[#1e293b] rounded-xl bg-slate-50/60 dark:bg-[#0c1222]/40 my-6">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="font-semibold text-kin-text text-sm">
              {isDm ? `Direct Message with ${targetAgent?.displayName || '@Agent'}` : `Welcome to #${activeChannel?.name || 'general'}`}
            </div>
            <div className="text-kin-muted text-[11px] max-w-sm">
              {isDm
                ? `${targetAgent?.displayName || 'This agent'} will respond directly to all prompts in this private 1-on-1 thread.`
                : `Start the conversation by sending a message, or mention specific specialists with @ to coordinate their turns.`}
            </div>
          </div>
        )}

        {/* Live In-Flight Streaming Token Draft Bubble */}
        {streamingDrafts && streamingDrafts[activeChannelId] && stripThoughtsAndToolSyntax(streamingDrafts[activeChannelId]) && (
          <div className="p-3.5 rounded-2xl bg-blue-50/90 dark:bg-gradient-to-r dark:from-[#091122]/90 dark:to-[#0c1830]/90 border border-blue-400/40 shadow-xl space-y-2 animate-fadeIn backdrop-blur-md">
            <div className="flex items-center justify-between text-xs text-blue-700 dark:text-blue-300 font-mono">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="font-bold">Streaming Response...</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">Live</span>
            </div>
            <div className="font-mono text-xs text-slate-800 dark:text-[#cbd5e1] whitespace-pre-wrap leading-relaxed">
              {stripThoughtsAndToolSyntax(streamingDrafts[activeChannelId])}
              <span className="inline-block w-1.5 h-3.5 bg-blue-500 ml-1 animate-pulse align-middle" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom Message Input Box & Security Approvals */}
      <div className="border-t border-kin-border bg-kin-surface relative">
        <div className="max-w-4xl mx-auto p-3.5 sm:px-6 space-y-2.5">

        {/* Antigravity In-App Scheduler & Timers Bar */}
        {activeSchedules.length > 0 && (
          <div className="p-2.5 bg-emerald-500/10 dark:bg-[#071318] border border-emerald-500/30 rounded-xl space-y-1.5 shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center space-x-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setAutomationsModalOpen(true)}
                  className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-mono text-[10px] font-bold border border-emerald-500/30 transition cursor-pointer whitespace-nowrap shrink-0"
                  title="Open Automations & Routines Manager"
                >
                  <Timer className="w-3 h-3 text-emerald-400" />
                  <span>ACTIVE TIMERS ({activeSchedules.length})</span>
                </button>
                <span className="text-[#64748b] text-[10px] truncate hidden sm:inline">
                  Non-blocking sleeping agents will wake automatically
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAutomationsModalOpen(true)}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 font-mono hover:underline cursor-pointer whitespace-nowrap"
              >
                + New / Manage
              </button>
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {activeSchedules.map((s) => {
                const remainingSec = Math.max(0, Math.ceil((s.nextRunAt - now) / 1000));
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-1.5 bg-[#060a12] border border-[#1e293b] rounded-lg text-xs"
                  >
                    <div className="flex items-center space-x-2 min-w-0 pr-2">
                      <span className="flex items-center space-x-1 text-emerald-400 font-mono font-bold shrink-0 text-[10px] bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{remainingSec}s</span>
                      </span>
                      <span className="text-[#cbd5e1] text-[11px] truncate font-sans">{s.prompt}</span>
                      <span className="text-[#64748b] text-[9px] font-mono shrink-0 uppercase">[{s.type}]</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => cancelSchedule(s.id)}
                      className="p-1 hover:text-red-400 text-[#64748b] transition shrink-0"
                      title="Cancel timer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Live Machine Control Session Indicator */}
        {isMachineControlActive && (
          <div className="p-2.5 rounded-xl bg-red-50 dark:bg-[#1c080d]/90 border border-red-200 dark:border-red-500/80 text-red-900 dark:text-red-200 text-xs flex flex-wrap items-center justify-between gap-2 shadow-xs dark:shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-fadeIn overflow-hidden">
            <div className="flex items-center space-x-2.5 min-w-0">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 shadow-[0_0_8px_#ef4444]" />
              </span>
              <div className="flex items-center space-x-1.5 font-mono truncate">
                <span className="font-bold text-red-700 dark:text-red-300 text-[12px] shrink-0">🔴 {activeMachineAgent}</span>
                <span className="text-slate-700 dark:text-gray-300 truncate font-sans">Controlling Local Machine</span>
                <span className="text-slate-500 dark:text-gray-400 text-[11px] shrink-0">({activeMachineTool || 'Desktop & Browser'})</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDesktopControlModalOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200 dark:bg-red-600/30 dark:hover:bg-red-600/50 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-500/50 text-xs font-semibold transition flex items-center space-x-1 cursor-pointer whitespace-nowrap shrink-0"
              title="Inspect live machine interaction and windows"
            >
              <Monitor className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
              <span>[Inspect Session]</span>
            </button>
          </div>
        )}

        {/* Human Takeover & Execution Control Bar */}
        <HumanTakeoverBanner />

        {/* Steering Feedback Notification */}
        {steerNotification && steerNotification.channelId === activeChannelId && (
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 font-mono animate-fadeIn overflow-hidden">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">Steering directive injected into active loop: "{steerNotification.directive}"</span>
          </div>
        )}

        {/* Interrupted run recovery banner */}
        {pendingRecoveries.length > 0 && (
          <div className="p-3 bg-[#1e1008]/95 backdrop-blur-sm border border-amber-500/60 rounded-xl space-y-2.5 shadow-2xl animate-fadeIn overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 font-mono truncate">
                  Interrupted run recovery ({pendingRecoveries.length} run{pendingRecoveries.length > 1 ? 's' : ''})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setInspectingRecovery(inspectingRecovery ? null : pendingRecoveries[0])}
                  className="px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-[10px] font-mono transition cursor-pointer whitespace-nowrap"
                  title="Inspect turn checkpoint state and execution snapshot"
                >
                  {inspectingRecovery ? 'Close Inspection' : 'Inspect State'}
                </button>
                <button
                  type="button"
                  onClick={() => discardRecoveries()}
                  className="px-2.5 py-1 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 text-[10px] font-mono transition cursor-pointer whitespace-nowrap"
                  title="Discard interrupted runs and start clean"
                >
                  Discard All
                </button>
                <button
                  type="button"
                  onClick={() => resumeAllRecoveries()}
                  className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold font-mono transition flex items-center space-x-1 shadow-lg shadow-amber-900/40 cursor-pointer whitespace-nowrap"
                  title="Resume all runs from their exact saved turn checkpoints"
                >
                  <Zap className="w-3 h-3 text-black fill-current shrink-0" />
                  <span>Resume All ({pendingRecoveries.length})</span>
                </button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {pendingRecoveries.map((rec) => (
                <div
                  key={rec.runId || rec.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-[#0b0805] border border-amber-900/40 text-xs font-mono"
                >
                  <div className="flex items-center space-x-2 min-w-0 pr-2 flex-1">
                    <span className="text-amber-400 font-bold shrink-0">{rec.agentName}</span>
                    <span className="text-[#94a3b8] text-[11px] truncate">
                      Turn #{rec.interruptedTurn} ({rec.model || 'default'})
                    </span>
                    <span className="text-[#64748b] text-[10px] truncate max-w-[200px]">
                      {rec.checkpointReason}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setInspectingRecovery(rec)}
                      className="px-2 py-0.5 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-[10px] transition cursor-pointer whitespace-nowrap"
                      title="Inspect turn snapshot"
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      onClick={() => switchRunToOllama(rec.runId || rec.id)}
                      className="px-2 py-0.5 rounded bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-[10px] transition cursor-pointer whitespace-nowrap"
                      title="Switch to local Ollama fallback and resume"
                    >
                      Fallback Ollama
                    </button>
                    <button
                      type="button"
                      onClick={() => resumeRun(rec.runId || rec.id)}
                      className="px-2 py-0.5 rounded bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/50 text-[10px] font-bold transition cursor-pointer whitespace-nowrap"
                      title="Resume this specific run"
                    >
                      Resume
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Detailed State Inspector Panel */}
            {inspectingRecovery && (
              <div className="p-3 rounded-lg bg-[#070503] border border-amber-500/40 space-y-2 text-xs font-mono animate-fadeIn">
                <div className="flex items-center justify-between border-b border-amber-900/40 pb-1.5 text-amber-300 font-bold">
                  <div className="flex items-center space-x-1.5">
                    <Info className="w-3.5 h-3.5 text-amber-400" />
                    <span>Turn Checkpoint State: {inspectingRecovery.agentName} ({inspectingRecovery.id || inspectingRecovery.runId})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectingRecovery(null)}
                    className="p-0.5 hover:text-white text-[#94a3b8] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-[#cbd5e1] pt-1">
                  <div>
                    <span className="text-[#64748b] block text-[9px] uppercase">Interrupted Turn</span>
                    <strong className="text-amber-300">Turn #{inspectingRecovery.interruptedTurn || 1}</strong>
                  </div>
                  <div>
                    <span className="text-[#64748b] block text-[9px] uppercase">Active Model</span>
                    <span>{inspectingRecovery.model || 'qwen2.5-coder'}</span>
                  </div>
                  <div>
                    <span className="text-[#64748b] block text-[9px] uppercase">Associated Task</span>
                    <span>{inspectingRecovery.taskId || inspectingRecovery.taskTitle || 'Autonomous task'}</span>
                  </div>
                  <div>
                    <span className="text-[#64748b] block text-[9px] uppercase">Interruption Reason</span>
                    <span className="text-amber-200/90">{inspectingRecovery.checkpointReason || 'Process termination / stale heartbeat lease'}</span>
                  </div>
                </div>
                {inspectingRecovery.checkpoint?.snapshotJson && (
                  <div className="space-y-1 pt-1">
                    <span className="text-[#64748b] block text-[9px] uppercase">Persisted Snapshot Preview</span>
                    <pre className="p-2 rounded bg-black/60 border border-amber-950/60 text-[10px] text-amber-200/80 overflow-x-auto max-h-24">
                      {inspectingRecovery.checkpoint.snapshotJson.slice(0, 500)}
                    </pre>
                  </div>
                )}
                <div className="flex items-center justify-end space-x-2 pt-1 border-t border-amber-900/30">
                  <button
                    type="button"
                    onClick={() => switchRunToOllama(inspectingRecovery.runId || inspectingRecovery.id)}
                    className="px-2.5 py-1 rounded bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 text-[10px] font-bold cursor-pointer"
                  >
                    Switch to Ollama
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resumeRun(inspectingRecovery.runId || inspectingRecovery.id);
                      setInspectingRecovery(null);
                    }}
                    className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black text-[10px] font-bold cursor-pointer"
                  >
                    Resume Run from Turn #{inspectingRecovery.interruptedTurn || 1}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Provider quota pause banner */}
        {quotaPauseState?.isPaused && (
          <div className="p-3 bg-[#130d22]/95 backdrop-blur-sm border border-purple-500/60 rounded-xl space-y-2 shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Timer className="w-4 h-4 text-purple-400 animate-spin" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300 font-mono">
                  Quota Guard: Execution Paused (HTTP 429 Rate Limit)
                </span>
                <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px] border border-purple-500/30">
                  Auto-resumes in {Math.max(0, Math.ceil(((quotaPauseState.resetsAt || quotaPauseState.quotaResetsAt || now) - now) / 1000))}s
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => clearQuotaPause()}
                  className="p-1 text-[#64748b] hover:text-purple-300 transition cursor-pointer"
                  title="Dismiss Quota Banner"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs font-mono p-2 rounded-lg bg-[#0b0616] border border-purple-900/40">
              <div className="text-[#cbd5e1] text-[11px] truncate mr-2">
                Agent <strong className="text-purple-300">{quotaPauseState.agentName || 'Agent'}</strong> on provider <strong className="text-purple-300">{quotaPauseState.provider || 'frontier API'}</strong> hit token rate limits. State preserved atomically in SQLite.
              </div>
              <div className="flex items-center space-x-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => switchRunToOllama(quotaPauseState.runId || '')}
                  className="px-2.5 py-1 rounded bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 text-[10px] font-bold transition cursor-pointer"
                  title="Failover to local unmetered Ollama model"
                >
                  🦙 Switch to Ollama
                </button>
                <button
                  type="button"
                  onClick={() => resumeRun(quotaPauseState.runId || '')}
                  className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold transition shadow cursor-pointer"
                  title="Force resume execution now"
                >
                  Resume Now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Interactive Adversarial Grill-Me Assessment Card */}
        {grillMeSession && (
          <div className="p-3.5 bg-[#170a0f]/95 backdrop-blur-sm border border-rose-500/60 rounded-xl space-y-3 shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b border-rose-900/40 pb-2">
              <div className="flex items-center space-x-2">
                <Flame className="w-4 h-4 text-rose-400" />
                <span className="text-[12px] font-bold uppercase tracking-wider text-rose-300 font-mono">
                  Adversarial Assessment: {grillMeSession.topic}
                </span>
              </div>
              <button
                type="button"
                onClick={() => dismissGrillMe()}
                className="p-1 text-[#64748b] hover:text-rose-300 transition cursor-pointer"
                title="Dismiss questionnaire"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {grillMeSession.questions.map((q, qIdx) => (
                <div key={q.id} className="p-2.5 rounded-lg bg-[#0d0508] border border-rose-900/30 space-y-1.5">
                  <div className="text-[11px] font-semibold text-rose-200 font-mono">
                    {qIdx + 1}. {q.prompt || q.question || 'Architecture Specification'}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                    {q.options.map((opt) => {
                      const isSelected = grillMeAnswers[q.id] === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setGrillMeAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                          className={`px-2.5 py-1.5 rounded text-left text-[11px] font-mono transition border cursor-pointer ${
                            isSelected
                              ? 'bg-rose-600/30 border-rose-500 text-white font-bold ring-1 ring-rose-400'
                              : 'bg-[#150a0f] border-rose-900/40 text-[#cbd5e1] hover:bg-rose-950/40'
                          }`}
                        >
                          <span className="text-rose-400 mr-1.5">{isSelected ? '◉' : '○'}</span>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-[#64748b] font-mono">
                {Object.keys(grillMeAnswers).length} of {grillMeSession.questions.length} questions answered
              </span>
              <button
                type="button"
                onClick={async () => {
                  const mappedAnswers: Record<string, string> = {};
                  grillMeSession.questions.forEach((q) => {
                    if (grillMeAnswers[q.id]) {
                      const label = q.prompt || q.question || q.id;
                      mappedAnswers[label] = grillMeAnswers[q.id];
                    }
                  });
                  await submitGrillMeAnswers(mappedAnswers);
                  setGrillMeAnswers({});
                }}
                disabled={Object.keys(grillMeAnswers).length === 0}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold font-mono transition shadow-lg shadow-rose-950/40 flex items-center space-x-1.5 disabled:opacity-40 disabled:hover:bg-rose-600 cursor-pointer"
              >
                <span>Hardened ADR Synthesis →</span>
              </button>
            </div>
          </div>
        )}

        {/* Security Gate: Action Approval Required - docked right above message box */}
        {scopedPendingApprovals.length > 0 && (
          <div className="p-3 bg-[#1e1307]/95 backdrop-blur-sm border border-amber-500/40 rounded-xl space-y-2.5 shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 font-mono">
                  Security Gate: Action Approval Required ({scopedPendingApprovals.length})
                </span>
              </div>
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                Autonomy Gate
              </span>
            </div>

            {scopedPendingApprovals.map((appr) => (
              <div key={appr.id} className="p-2.5 rounded-lg bg-[#0b0f19] border border-[#2d3748] space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center space-x-2 font-mono truncate mr-2">
                    <span className="font-bold text-amber-400">{appr.agentName}</span>
                    <span className="text-[#64748b]">requests execution:</span>
                    <span className="flex items-center space-x-1 px-1.5 py-0.2 rounded bg-[#1e293b] text-blue-300 font-bold shrink-0">
                      <Terminal className="w-3 h-3 text-blue-400" />
                      <span>{appr.toolName}</span>
                    </span>
                  </div>
                  <span
                    className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ${
                      appr.riskLevel === 'CRITICAL'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : appr.riskLevel === 'HIGH'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    }`}
                  >
                    {appr.riskLevel} RISK
                  </span>
                </div>

                <div className="p-2 rounded bg-black/60 font-mono text-[11px] text-[#e2e8f0] break-all border border-[#1e293b]">
                  {appr.actionSummary}
                </div>

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    onClick={() => resolveApproval(appr.id, false)}
                    className="flex items-center space-x-1 px-3 py-1 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 text-xs font-medium transition"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject Action</span>
                  </button>
                  <button
                    onClick={() => resolveApproval(appr.id, true)}
                    className="flex items-center space-x-1 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-900/30 transition"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Approve & Execute</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Antigravity Queued Messages Tray - docked directly above the composer input box */}
        {channelQueuedMessages.length > 0 && (
          <div className="p-2.5 bg-[#0b1020]/95 backdrop-blur-sm border border-blue-500/40 rounded-xl space-y-1.5 shadow-xl animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono text-[10px] font-bold border border-blue-500/30">
                  <Inbox className="w-3 h-3 text-blue-400" />
                  <span>QUEUED ({channelQueuedMessages.length})</span>
                </span>
                <span className="text-[#64748b] text-[10px] hidden sm:inline">
                  Will execute automatically once active agent finishes
                </span>
              </div>
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {channelQueuedMessages.map((qm, idx) => (
                <div
                  key={qm.id}
                  className="flex items-center justify-between p-1.5 rounded bg-[#070b14] border border-[#1e293b] text-xs font-mono"
                >
                  <div className="flex items-center space-x-2 truncate mr-2">
                    <span className="text-blue-400 font-bold shrink-0 text-[10px]">#{idx + 1}</span>
                    <span className="text-[#cbd5e1] text-[11px] truncate">{qm.content}</span>
                  </div>
                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => promoteQueuedToSteer(qm.id)}
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] transition"
                      title="Promote to Immediate Priority Steer Directive"
                    >
                      <Zap className="w-2.5 h-2.5" />
                      <span>Steer Now</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => dequeueMessage(qm.id)}
                      className="p-1 hover:text-red-400 text-[#64748b] transition"
                      title="Remove from queue"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {chatUploadStatus && (
          <div className="px-3 py-1 bg-cyan-950/60 border border-cyan-500/30 rounded-lg text-[11px] text-cyan-300 flex items-center justify-between animate-pulse">
            <div className="flex items-center space-x-1.5">
              <FileUp className="w-3 h-3 text-cyan-400" />
              <span>{chatUploadStatus}</span>
            </div>
            <button
              type="button"
              onClick={() => setActiveRightTab('Uploads')}
              className="text-[10px] text-cyan-400 hover:text-cyan-200 underline font-mono ml-2 cursor-pointer"
            >
              View Uploads
            </button>
          </div>
        )}

        {sendError && (
          <div className="px-3 py-2 bg-red-950/80 border border-red-500/60 rounded-xl text-xs text-red-200 flex items-center justify-between shadow-lg animate-fadeIn">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{sendError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="text-red-400 hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <form
          onSubmit={handleSend}
          className="relative"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOverChat(true);
          }}
          onDragLeave={() => setIsDragOverChat(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOverChat(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              handleChatFileUpload(e.dataTransfer.files);
            }
          }}
        >
          {/* Mention Autocomplete Overlay */}
          {showMentionMenu && matchingAgents.length > 0 && (
            <div className="absolute bottom-full mb-2 left-0 bg-[#0f172a] border border-[#2d3748] rounded-xl shadow-2xl p-2 z-30 w-80 max-h-64 overflow-y-auto space-y-1 animate-fadeIn">
              <div className="text-[10px] text-[#64748b] uppercase font-bold px-2 py-0.5 flex items-center justify-between border-b border-[#1e293b] pb-1">
                <span>Project Agents ({matchingAgents.length})</span>
                <span className="text-[9px] font-mono lowercase text-[#94a3b8]">↑↓ Tab/Enter</span>
              </div>
              <div className="space-y-0.5 pt-1">
                {matchingAgents.map((ag, idx) => (
                  <button
                    key={ag.id}
                    type="button"
                    onClick={() => handleInsertMention(ag.displayName)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition cursor-pointer ${
                      idx === mentionSelectedIndex
                        ? 'bg-blue-600/25 ring-1 ring-blue-500/50 text-white'
                        : 'hover:bg-[#1e293b]/70 text-[#cbd5e1]'
                    }`}
                  >
                    <div className="flex items-center space-x-2 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_4px_#34d399]" />
                      <span className="font-semibold text-kin-text text-xs whitespace-nowrap">{ag.displayName}</span>
                    </div>
                    <span className="text-[10px] text-[#64748b] font-mono truncate ml-2 text-right">{ag.role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Antigravity-Style Slash Commands Autocomplete Popup */}
          {showSlashMenu && matchingSlashCommands.length > 0 && (
            <div className="absolute bottom-full mb-2 left-0 bg-kin-surface border border-kin-border rounded-xl shadow-2xl p-2 z-30 w-96 max-h-72 overflow-y-auto space-y-1 text-xs animate-fadeIn select-none">
              <div className="text-[10px] text-kin-muted uppercase font-bold px-2 py-1 flex items-center justify-between border-b border-kin-border pb-1">
                <span className="flex items-center space-x-1.5">
                  <Terminal className="w-3 h-3 text-emerald-500" />
                  <span>Slash Commands & Skills ({matchingSlashCommands.length})</span>
                </span>
                <span className="text-[9px] font-mono lowercase text-kin-muted">↑↓ to navigate, Tab/Enter</span>
              </div>
              <div className="space-y-0.5 pt-1">
                {matchingSlashCommands.map((c, idx) => (
                  <button
                    key={c.cmd}
                    type="button"
                    onClick={() => handleSlashCommand(c.cmd)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition cursor-pointer ${
                      idx === slashSelectedIndex
                        ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 shadow-xs'
                        : 'hover:bg-kin-card text-kin-text'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      {c.isSkill ? (
                        <Wrench className="w-3 h-3 text-cyan-500 shrink-0" />
                      ) : (
                        <Terminal className="w-3 h-3 text-emerald-500 shrink-0" />
                      )}
                      <span className={`font-mono font-bold text-xs ${c.isSkill ? 'text-cyan-500' : 'text-emerald-500'}`}>
                        {c.cmd}
                      </span>
                      {c.isSkill && (
                        <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 font-bold uppercase">
                          Skill
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-kin-muted truncate ml-2 text-right">{c.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            className={`flex items-center bg-kin-card border rounded-xl px-3 py-2 transition-colors ${
            isDragOverChat
              ? 'border-kin-primary bg-kin-primary/10 ring-2 ring-kin-primary/30'
              : 'border-kin-border focus-within:border-kin-primary'
          }`}
        >
          {/* Plus Capabilities Button & Popover */}
          <div className="relative shrink-0" ref={plusMenuRef}>
            <button
              type="button"
              onClick={() => setShowPlusMenu(!showPlusMenu)}
              className={`p-1 rounded-lg transition mr-2 cursor-pointer ${
                showPlusMenu
                  ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
                  : 'text-kin-muted hover:text-kin-text hover:bg-kin-surface'
              }`}
              title="Capabilities & Integrations (Connectors, MCP, Skills, Uploads)"
            >
              <Plus className={`w-4 h-4 transition-transform duration-200 ${showPlusMenu ? 'rotate-45' : ''}`} />
            </button>

            {/* Popover Menu */}
            {showPlusMenu && (
              <div className="absolute bottom-full mb-2 left-0 w-80 bg-kin-surface border border-kin-border rounded-xl shadow-2xl p-2.5 z-40 animate-fadeIn space-y-2.5 select-none text-xs">
                <div className="flex items-center justify-between pb-1.5 border-b border-kin-border">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-kin-muted">
                    Capabilities & Integrations
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPlusMenu(false)}
                    className="p-0.5 rounded hover:bg-kin-card text-kin-muted hover:text-kin-text transition cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {/* Section 1: Connectors & Models */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-kin-muted">
                    <div className="flex items-center space-x-1.5">
                      <Cpu className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Model Connectors</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        setSettingsModalOpen(true);
                      }}
                      className="text-[10px] text-emerald-500 hover:underline cursor-pointer font-medium"
                    >
                      Settings
                    </button>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-kin-card border border-kin-border flex items-center justify-between">
                    <span className="font-mono text-kin-text text-[11px] truncate mr-2">
                      {agents.find((a) => a.isOrchestrator)?.activeModelId || 'Ollama (Local)'}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-bold shrink-0">
                      ACTIVE
                    </span>
                  </div>
                </div>

                {/* Section 2: MCP Tools */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-kin-muted">
                    <div className="flex items-center space-x-1.5">
                      <Terminal className="w-3.5 h-3.5 text-purple-500" />
                      <span>MCP Servers & Tools</span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/mcp/reload', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({}),
                          });
                          const data = await res.json();
                          alert(`MCP Servers reloaded! Tools discovered: ${data.toolsCount || 0}`);
                        } catch (err: any) {
                          alert(`Failed to reload MCP: ${err.message}`);
                        }
                      }}
                      className="text-[10px] text-purple-500 hover:underline cursor-pointer font-medium"
                    >
                      Reload
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlusMenu(false);
                      setConnectorsModalOpen(true);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg bg-kin-card hover:bg-kin-surface border border-kin-border flex items-center justify-between text-kin-text transition cursor-pointer"
                  >
                    <span className="truncate">Manage MCP Connectors & Tools</span>
                    <span className="text-[10px] text-emerald-400 font-mono font-medium">Connectors</span>
                  </button>
                </div>

                {/* Section 3: Workforce Skills */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-kin-muted">
                    <div className="flex items-center space-x-1.5">
                      <Wrench className="w-3.5 h-3.5 text-cyan-500" />
                      <span>Workforce Skills ({skills.length})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        handleSlashCommand('/skills');
                      }}
                      className="text-[10px] text-cyan-500 hover:underline cursor-pointer font-medium"
                    >
                      Browse
                    </button>
                  </div>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {skills.slice(0, 3).map((sk) => (
                      <button
                        key={sk.id}
                        type="button"
                        onClick={() => {
                          setShowPlusMenu(false);
                          handleSlashCommand(`/skill:${sk.name.toLowerCase().replace(/\s+/g, '-')}`);
                        }}
                        className="w-full text-left px-2 py-1 rounded-md hover:bg-kin-card flex items-center justify-between text-kin-text transition cursor-pointer group"
                      >
                        <span className="font-mono text-cyan-500 text-[11px] truncate mr-2 font-medium">{sk.name}</span>
                        <span className="text-[10px] text-kin-muted truncate">{sk.description}</span>
                      </button>
                    ))}
                    {skills.length === 0 && (
                      <div className="text-[10px] text-kin-muted px-2 py-1 italic">
                        Default platform primitives active
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 4: Quick Actions */}
                <div className="pt-1.5 border-t border-kin-border grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlusMenu(false);
                      chatFileInputRef.current?.click();
                    }}
                    className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-kin-card hover:bg-kin-surface border border-kin-border text-kin-text transition cursor-pointer"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-kin-muted" />
                    <span className="truncate">Attach File</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlusMenu(false);
                      handleSlashCommand('/plan');
                    }}
                    className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-kin-card hover:bg-kin-surface border border-kin-border text-kin-text transition cursor-pointer"
                  >
                    <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                    <span>/plan</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Autonomy / Permissions Mode Selector */}
          <div className="relative shrink-0 mr-2" ref={autonomyMenuRef}>
            <button
              type="button"
              onClick={() => setShowAutonomyMenu(!showAutonomyMenu)}
              className={`flex items-center space-x-1 px-2 py-1 rounded-lg border text-[11px] font-mono transition cursor-pointer ${
                autonomyMode === 'FULL_ACCESS'
                  ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                  : autonomyMode === 'ALWAYS_ASK'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
              }`}
              title={`Permissions Mode: ${autonomyMode} (Click to change)`}
            >
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span className="font-semibold">{autonomyMode}</span>
              <ChevronDown className={`w-3 h-3 opacity-60 transition-transform duration-200 ${showAutonomyMenu ? 'rotate-180' : ''}`} />
            </button>

            {/* Autonomy Popover Menu */}
            {showAutonomyMenu && (
              <div className="absolute bottom-full mb-2 left-0 w-72 bg-kin-surface border border-kin-border rounded-xl shadow-2xl p-2.5 z-40 animate-fadeIn space-y-1.5 select-none text-xs">
                <div className="flex items-center justify-between pb-1 border-b border-kin-border">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-kin-muted flex items-center space-x-1">
                    <Shield className="w-3 h-3 text-emerald-400" />
                    <span>Permissions / Autonomy Mode</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAutonomyMenu(false)}
                    className="p-0.5 rounded hover:bg-kin-card text-kin-muted hover:text-kin-text transition cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                <div className="space-y-1">
                  {[
                    {
                      mode: 'AUTO' as const,
                      label: 'AUTO (Autonomous)',
                      desc: 'Runs autonomously with safety guards; prompts only on destructive actions.',
                      color: 'emerald',
                    },
                    {
                      mode: 'ALWAYS_ASK' as const,
                      label: 'ALWAYS_ASK (Supervised)',
                      desc: 'Explicit user confirmation required for every single tool and file edit.',
                      color: 'amber',
                    },
                    {
                      mode: 'FULL_ACCESS' as const,
                      label: 'FULL_ACCESS (Unrestricted)',
                      desc: 'Zero approval barriers; continuous tool execution without interruptions.',
                      color: 'red',
                    },
                  ].map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => {
                        setAutonomyMode(item.mode);
                        setShowAutonomyMenu(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg border transition cursor-pointer ${
                        autonomyMode === item.mode
                          ? item.color === 'emerald'
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                            : item.color === 'amber'
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                            : 'bg-red-500/15 border-red-500/40 text-red-300'
                          : 'bg-kin-card hover:bg-kin-surface border-kin-border text-kin-text'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-bold text-xs font-mono">{item.label}</span>
                        {autonomyMode === item.mode && <CheckCircle className="w-3.5 h-3.5" />}
                      </div>
                      <p className="text-[10px] text-kin-muted leading-tight">{item.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (showSlashMenu && matchingSlashCommands.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSlashSelectedIndex((prev) => (prev + 1) % matchingSlashCommands.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSlashSelectedIndex((prev) => (prev - 1 + matchingSlashCommands.length) % matchingSlashCommands.length);
                  return;
                }
                if (e.key === 'Tab' || e.key === 'Enter') {
                  e.preventDefault();
                  const targetCmd = matchingSlashCommands[slashSelectedIndex]?.cmd || matchingSlashCommands[0].cmd;
                  handleSlashCommand(targetCmd);
                  return;
                }
              }

              if (showMentionMenu && matchingAgents.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionSelectedIndex((prev) => (prev + 1) % matchingAgents.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionSelectedIndex((prev) => (prev - 1 + matchingAgents.length) % matchingAgents.length);
                  return;
                }
                if (e.key === 'Tab' || e.key === 'Enter') {
                  e.preventDefault();
                  const targetAgentName = matchingAgents[mentionSelectedIndex]?.displayName || matchingAgents[0].displayName;
                  handleInsertMention(targetAgentName);
                  return;
                }
              }

              if (e.key === 'Escape') {
                setShowSlashMenu(false);
                setShowMentionMenu(false);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder={
              isChannelExecuting
                ? `⚡ Steer active execution, or type and click 'Queue' for next...`
                : isDm
                ? `Direct message with ${targetAgent?.displayName || '@Agent'}...`
                : `Message #${activeChannel?.name || 'general'} (type '/' for commands, '@' for agents)...`
            }
            className="flex-1 bg-transparent text-xs text-kin-text placeholder-[#64748b] focus:outline-none"
          />

          <div className="flex items-center space-x-1.5 ml-2 text-[#64748b]">
            <button
              type="button"
              onClick={toggleVoiceDictation}
              className={`p-1 transition ${
                isListening
                  ? 'text-red-400 animate-pulse bg-red-500/20 rounded'
                  : 'hover:text-kin-text text-[#64748b]'
              }`}
              title={isListening ? 'Voice recording active... (click to stop)' : 'Voice Input (Web Speech API)'}
            >
              <Mic className="w-3.5 h-3.5" />
            </button>
            <input
              type="file"
              ref={chatFileInputRef}
              multiple
              onChange={(e) => {
                if (e.target.files) handleChatFileUpload(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => chatFileInputRef.current?.click()}
              className="p-1 hover:text-kin-text text-cyan-400 hover:text-cyan-300 transition"
              title="Attach File to Chat & Project Uploads"
            >
              {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" /> : <Paperclip className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setShowMentionMenu(!showMentionMenu)}
              className="p-1 hover:text-kin-text transition"
              title="Mention Agent"
            >
              <AtSign className="w-3.5 h-3.5 text-blue-400" />
            </button>

            {/* When channel is executing, provide explicit Steer Now button */}
            {isChannelExecuting && inputText.trim() && (
              <button
                type="button"
                disabled={isSending || isSteeringRef.current}
                onClick={async () => {
                  if (isSteeringRef.current || isSending || !inputText.trim()) return;
                  isSteeringRef.current = true;
                  const textToSend = inputText.trim();
                  setSendError(null);
                  setIsSending(true);
                  try {
                    const res = await sendMessage(textToSend, undefined, true);
                    if (res && !res.success) {
                      setSendError(res.error || 'Failed to deliver steer directive');
                    } else {
                      setInputText('');
                      if (activeChannelId) {
                        try {
                          localStorage.removeItem(`kin_draft_${activeChannelId}`);
                        } catch {}
                      }
                      setSendError(null);
                    }
                  } finally {
                    setIsSending(false);
                    setTimeout(() => {
                      isSteeringRef.current = false;
                    }, 600);
                  }
                }}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/50 text-xs font-semibold transition shrink-0 cursor-pointer disabled:opacity-50"
                title="Inject as immediate priority steer directive right into active loop"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Steer</span>
              </button>
            )}

            <button
              type="submit"
              disabled={!inputText.trim()}
              className={`rounded-lg text-white transition ml-1 flex items-center space-x-1 ${
                isChannelExecuting
                  ? 'bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-900/40 px-2.5 py-1'
                  : 'p-1.5 bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-900/40'
              } disabled:opacity-30 disabled:hover:bg-emerald-600`}
              title={isChannelExecuting ? 'Queue message for next turn (or click Steer to inject immediately)' : 'Send Message'}
            >
              {isChannelExecuting ? (
                <>
                  <Inbox className="w-3.5 h-3.5 text-blue-100" />
                  <span className="font-semibold text-xs ml-1">Queue</span>
                </>
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </form>
        </div>
      </div>
  </main>
);
};
