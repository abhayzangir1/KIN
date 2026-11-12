import React, { useState, useRef, useEffect } from 'react';
import { useKinStore, isAgentAvailable, FileAttachment } from '../store/kinStore.js';
import {
  Send,
  Mic,
  Paperclip,
  AtSign,
  UserPlus,
  Users,
  X,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Terminal,
  Zap,
  Inbox,
  FileUp,
  Loader2,
  ChevronDown,
  Flame,
  Plus,
  Cpu,
  Wrench,
  CornerDownRight,
} from 'lucide-react';
import { HumanTakeoverBanner } from './HumanTakeoverBanner.js';
import { QuotaPauseBanner } from './banners/QuotaPauseBanner.js';
import { InterruptedRecoveryDock } from './banners/InterruptedRecoveryDock.js';
import { AutomationsView } from './AutomationsView.js';
import { TaskDagView } from './tasks/TaskDagView.js';
import { AgentModelBadge } from './AgentModelBadge.js';
import { ActiveTimersPill, ActiveTimersDrawer, ActiveTimersNewButton } from './ActiveTimersBadge.js';
import { ChatTimeline } from './chat/ChatTimeline.js';

export const CenterView: React.FC = () => {
  const {
    channels,
    activeChannelId,
    channelMembers,
    agents,
    autonomyMode,
    setAutonomyMode,
    ollamaStatus,
    credentials,
    availableModels,
    messages,
    schedules,
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
    thinkingDrafts,
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
    grillMeSession,
    fetchRecoveryState,
    submitGrillMeAnswers,
    dismissGrillMe,
    skills,
    fetchSkills,
    setSettingsModalOpen,
    setConnectorsModalOpen,
    setWorkforceModalOpen,
    replyingToMessage,
    setReplyingToMessage,
    addToast,
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
    (browserStatus?.active && (activeChannelId === 'chan-general' || channels.find((c) => c.id === activeChannelId)?.isGeneral || channels.find((c) => c.id === activeChannelId)?.name?.toLowerCase() === 'general' || activeChannelId.startsWith('dm-')));

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
    } catch (err) {
      console.warn('[KIN UI] Failed to read draft from localStorage:', err);
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
    } catch (err) {
      console.warn('[KIN UI] Failed to read draft from localStorage:', err);
      setInputText('');
    }
  }, [activeChannelId]);

  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [expandedOperationalTab, setExpandedOperationalTab] = useState<'timers' | 'queue' | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isDragOverChat, setIsDragOverChat] = useState(false);
  const [chatUploadStatus, setChatUploadStatus] = useState<string | null>(null);
  const [dismissHealthBanner, setDismissHealthBanner] = useState(() => {
    try {
      return sessionStorage.getItem('kin_dismiss_health_banner') === 'true';
    } catch (err) {
      console.warn('[KIN UI] Failed to read health banner dismissal:', err);
      return false;
    }
  });

  const shouldShowHealthBanner = React.useMemo(() => {
    if (!systemHealth || systemHealth.status === 'healthy' || dismissHealthBanner) {
      return false;
    }
    const isOnlyOllamaDegraded = Boolean(
      (systemHealth.activeAlerts?.length === 1 && systemHealth.activeAlerts[0]?.toLowerCase().includes('ollama')) ||
      (systemHealth.checks && Object.entries(systemHealth.checks).every(([k, v]) => k === 'ollama' || v.status === 'ok'))
    );
    const usesCloudProviders = Boolean(
      (credentials && credentials.some((c) => c.status === 'active' && c.provider !== 'ollama')) ||
      availableModels.some((m) => m.provider !== 'ollama' && (m.configured || m.validated)) ||
      agents.some((a) => a.activeModelId && !a.activeModelId.toLowerCase().includes('ollama'))
    );
    if (isOnlyOllamaDegraded && usesCloudProviders) {
      return false;
    }
    return true;
  }, [systemHealth, dismissHealthBanner, credentials, availableModels, agents]);
  const [grillMeAnswers, setGrillMeAnswers] = useState<Record<string, string>>({});

  const selectableModels = React.useMemo(() => {
    const list: { id: string; name: string; provider: string }[] = [];
    const seen = new Set<string>();

    for (const m of availableModels || []) {
      if (m?.id && !seen.has(m.id)) {
        list.push({ id: m.id, name: m.name || m.id, provider: m.provider || 'custom' });
        seen.add(m.id);
      }
    }

    return list;
  }, [availableModels]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const isSteeringRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const adjustTextareaHeight = () => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(Math.max(inputRef.current.scrollHeight, 38), 180)}px`;
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        handleChatFileUpload(files);
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) {
      handleChatFileUpload(e.dataTransfer.files);
    }
  };
  const recognitionRef = useRef<any>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAttachments, setPendingAttachments] = useState<FileAttachment[]>([]);

  const handleChatFileUpload = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setChatUploadStatus(`Attaching ${files.length} file(s)...`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const res = await uploadFile(file);
      if (res.success && res.upload) {
        const up = res.upload;
        setPendingAttachments((prev) => [
          ...prev,
          {
            id: up.id,
            filename: up.originalName || up.filename || file.name,
            size: up.size || file.size,
            mimeType: up.mimeType || file.type,
            url: `/api/projects/${activeProjectId}/uploads/${up.id}/download`,
            path: up.relativePath,
          },
        ]);
      } else if (res.success) {
        setPendingAttachments((prev) => [
          ...prev,
          {
            filename: file.name,
            size: file.size,
            mimeType: file.type,
          },
        ]);
      } else {
        setChatUploadStatus(`Upload notice: ${res.error || 'Failed'}`);
        setTimeout(() => setChatUploadStatus(null), 3000);
      }
    }

    setChatUploadStatus(null);
    inputRef.current?.focus();
  };

  useEffect(() => {
    setSlashSelectedIndex(0);
    setMentionSelectedIndex(0);
  }, [inputText]);

  useEffect(() => {
    fetchRecoveryState();
  }, []);

  const hasActiveTimers = (schedules || []).some(
    (s) => s.status === 'active' && (s.channelId === activeChannelId || !s.channelId) && s.nextRunAt > Date.now()
  );

  const toggleVoiceDictation = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (err) {
          console.warn('[KIN UI] Failed to stop speech recognition:', err);
        }
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addToast({
        title: 'Voice Input Unavailable',
        message: 'Web Speech API is not supported in this browser.',
        type: 'warning',
      });
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
    } catch (err) {
      console.warn('[KIN UI] Failed to start speech recognition:', err);
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
      } catch (err) {
        console.warn('[KIN UI] Failed to remove draft from localStorage:', err);
      }
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    if (activeChannelId) {
      try {
        if (val.trim()) {
          localStorage.setItem(`kin_draft_${activeChannelId}`, val);
        } else {
          localStorage.removeItem(`kin_draft_${activeChannelId}`);
        }
      } catch (err) {
        console.warn('[KIN UI] Failed to save draft to localStorage:', err);
      }
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




  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && pendingAttachments.length === 0) || isSending) return;
    if (isChannelExecuting && !inputText.trim().startsWith('/') && !inputText.trim().startsWith('>')) {
      handleQueueNext();
      return;
    }
    const textToSend = inputText.trim() || (pendingAttachments.length > 0 ? pendingAttachments.map((a) => a.filename).join(', ') : '');
    const metadata: Record<string, any> = {};
    if (replyingToMessage) {
      metadata.replyTo = {
        messageId: replyingToMessage.id,
        senderName: replyingToMessage.senderName,
        excerpt: replyingToMessage.content.slice(0, 100),
      };
    }
    if (pendingAttachments.length > 0) {
      metadata.attachments = pendingAttachments;
    }

    setSendError(null);
    setIsSending(true);
    const res = await sendMessage(
      textToSend,
      undefined,
      false,
      Object.keys(metadata).length > 0 ? metadata : undefined
    );
    setIsSending(false);
    if (res && !res.success) {
      setSendError(res.error || 'Failed to deliver message');
    } else {
      setInputText('');
      setPendingAttachments([]);
      setReplyingToMessage(null);
      if (activeChannelId) {
        try {
          localStorage.removeItem(`kin_draft_${activeChannelId}`);
        } catch (err) {
          console.warn('[KIN UI] Failed to remove draft from localStorage:', err);
        }
      }
      setSendError(null);
      setShowMentionMenu(false);
      setShowSlashMenu(false);
    }
  };

  if (activeMainView === 'automations') {
    return <AutomationsView />;
  }

  if (activeMainView === 'dag') {
    return <TaskDagView />;
  }

  return (
    <main className="flex-1 flex flex-col h-full bg-kin-bg min-w-0 relative">
      {/* Context Scope Header Bar */}
      <div className="border-b border-kin-border bg-kin-surface py-2.5">
        <div className="max-w-4xl mx-auto w-full px-6 flex items-center justify-between text-xs">
        {isAgentToAgentDm ? (
          <div className="flex items-center space-x-2 truncate">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.5)]" />
            <div className="flex items-center space-x-2">
              <span className="font-bold text-indigo-300 text-sm">{activeChannel?.name || activeChannelId}</span>
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                Operator Inspection Mode
              </span>
            </div>
            <span className="text-kin-muted text-[11px] truncate hidden md:inline">
              Private coworker direct message thread
            </span>
          </div>
        ) : isDm ? (
          <div className="flex items-center justify-between w-full min-w-0 overflow-hidden">
            <div className="flex items-center space-x-2 truncate">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
              <div className="flex items-center space-x-2">
                <span className="font-bold text-kin-text text-sm">{targetAgent?.displayName || '@Agent'}</span>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                  {targetAgent?.role || 'Specialist'}
                </span>
              </div>
              <span className="text-kin-muted text-[11px] truncate hidden md:inline">
                Private 1-on-1 Direct Message thread
              </span>
            </div>
            {targetAgent && (
              <div className="flex items-center space-x-2 shrink-0 ml-2">
                <span className="text-[10px] text-kin-muted hidden sm:inline font-mono">Model:</span>
                <AgentModelBadge
                  agent={targetAgent}
                  availableModels={availableModels}
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
                <span className="text-kin-muted text-[11px] truncate hidden xl:inline max-w-[200px]">
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
                    className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border shrink-0 ${
                      member.isOrchestrator
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        : 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                    }`}
                  >
                    <span
                      onClick={() => setSelectedAgentId(member.id)}
                      className="cursor-pointer hover:underline font-semibold"
                      title={`Inspect ${member.displayName} in Agent Inspector`}
                    >
                      {member.displayName}
                    </span>
                    {member.isOrchestrator ? (
                      <span title="Default Orchestrator (Permanent)">
                        <Shield className="w-3 h-3 text-amber-400 ml-0.5" />
                      </span>
                    ) : (
                      <button
                        onClick={() => removeChannelMember(activeChannelId, member.id)}
                        className="hover:text-red-400 transition ml-0.5 cursor-pointer"
                        title={`Remove ${member.displayName} from this channel`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>

              {/* Workforce Manager Hub Button */}
              <button
                onClick={() => setWorkforceModalOpen(true)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[11px] font-mono transition shrink-0 cursor-pointer"
                title="Open Team Workforce & Specialist Registry"
              >
                <Users className="w-3 h-3 text-blue-400" />
                <span>Team ({agents.length})</span>
              </button>

              {/* Add Agent Button */}
              <button
                onClick={() => setAddAgentModalOpen(true)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-kin-card hover:bg-emerald-600/30 hover:text-emerald-300 text-kin-text border border-kin-border text-[11px] transition shrink-0 cursor-pointer"
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
      {(isAgentToAgentDm || shouldShowHealthBanner) && (
        <div className="w-full max-w-4xl mx-auto px-6 space-y-2 mt-2">
          {/* Operator Inspection Mode Banner for Coworker DMs */}
          {isAgentToAgentDm && (
            <div className="px-3.5 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-500/50 text-indigo-900 dark:text-indigo-200 text-xs flex items-center justify-between shadow-xs animate-fadeIn">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                <span>
                  <strong>Operator Inspection Mode:</strong> Live confidential coworker direct message. Non-member agents cannot access this transcript.
                </span>
              </div>
              <span className="font-mono text-[10px] uppercase bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/30">
                Read-Only Audit Visibility
              </span>
            </div>
          )}

          {/* System Health Diagnostics Subtle Alert */}
          {shouldShowHealthBanner && systemHealth && (
            <div className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 text-[11px] flex items-center justify-between shadow-xs animate-fadeIn">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                <span>
                  <strong>Diagnostics:</strong> Health status is <span className="font-mono uppercase font-bold text-amber-700 dark:text-amber-300">{systemHealth.status}</span>
                  {systemHealth.activeAlerts && systemHealth.activeAlerts.length > 0 && ` (${systemHealth.activeAlerts.join(', ')})`}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setActiveMainView('automations')}
                  className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 font-mono text-[10px] border border-amber-500/30 cursor-pointer"
                >
                  View Details
                </button>
                <button
                  onClick={() => {
                    setDismissHealthBanner(true);
                    try {
                      sessionStorage.setItem('kin_dismiss_health_banner', 'true');
                    } catch (err) {
                      console.warn('[KIN UI] Failed to persist health banner dismissal:', err);
                    }
                  }}
                  className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 p-0.5 cursor-pointer"
                  title="Dismiss alert"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Pure prose transcript: routing telemetry relegated exclusively to Swarm Map */}
        </div>
      )}

      {/* Main Conversation Stream — Rendered via ChatTimeline and MessageItem */}
      <ChatTimeline
        messages={channelMessages}
        agents={agents}
        activeProjectId={activeProjectId}
        activeChannelId={activeChannelId}
        isDm={isDm}
        targetAgent={targetAgent}
        activeChannelName={activeChannel?.name}
        onQuoteReply={(quote) => {
          setInputText((prev) => quote + prev);
          inputRef.current?.focus();
        }}
        onSelectDecision={(choice) => {
          sendMessage(`/decisions choose ${choice}`);
        }}
        thinkingDraft={thinkingDrafts ? thinkingDrafts[activeChannelId] : undefined}
        streamingDrafts={streamingDrafts}
      >
        <div ref={messagesEndRef} className="h-0" />
      </ChatTimeline>

      {/* Bottom Message Input Box & Security Approvals */}
      <div className="border-t border-kin-border bg-kin-surface relative">
        <div className="max-w-4xl mx-auto p-3.5 sm:px-6 space-y-2.5">

        {/* Consolidated Compact Operational Dock (Timers, Machine Control, Queue, Uploads) */}
        {(hasActiveTimers || isMachineControlActive || channelQueuedMessages.length > 0 || chatUploadStatus) && (
          <div className="rounded-xl bg-kin-card border border-kin-border p-2 space-y-2 shadow-xs transition-all">
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {/* 1. Live Machine Control Session Pill */}
                {isMachineControlActive && (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-red-500/10 dark:bg-red-950/60 border border-red-500/30 text-red-600 dark:text-red-300 text-[11px] font-mono">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                    </span>
                    <span className="font-semibold">{activeMachineAgent}</span>
                    <span className="text-kin-muted hidden sm:inline">controlling machine</span>
                    <button
                      type="button"
                      onClick={() => setDesktopControlModalOpen(true)}
                      className="ml-1 text-[10px] font-semibold text-red-500 dark:text-red-300 hover:underline cursor-pointer"
                    >
                      [Inspect]
                    </button>
                  </div>
                )}

                {/* 2. Active In-App Timers Pill */}
                <ActiveTimersPill
                  channelId={activeChannelId}
                  isExpanded={expandedOperationalTab === 'timers'}
                  onToggleExpand={() => setExpandedOperationalTab(expandedOperationalTab === 'timers' ? null : 'timers')}
                />

                {/* 3. Queued Messages Pill */}
                {channelQueuedMessages.length > 0 && (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-300 text-[11px] font-mono">
                    <Inbox className="w-3 h-3 text-blue-500 shrink-0" />
                    <span>{channelQueuedMessages.length} Queued</span>
                    <button
                      type="button"
                      onClick={() => setExpandedOperationalTab(expandedOperationalTab === 'queue' ? null : 'queue')}
                      className="ml-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      {expandedOperationalTab === 'queue' ? 'Hide' : 'View'}
                    </button>
                  </div>
                )}

                {/* 4. Chat File Upload Pill */}
                {chatUploadStatus && (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-600 dark:text-cyan-300 text-[11px] font-mono animate-pulse">
                    <FileUp className="w-3 h-3 text-cyan-500 shrink-0" />
                    <span className="truncate max-w-[160px]">{chatUploadStatus}</span>
                  </div>
                )}
              </div>

              {/* Quick Action Buttons */}
              <div className="flex items-center space-x-2 shrink-0">
                <ActiveTimersNewButton
                  channelId={activeChannelId}
                  onClick={() => setAutomationsModalOpen(true)}
                />
                {chatUploadStatus && (
                  <button
                    type="button"
                    onClick={() => setActiveRightTab('Uploads')}
                    className="text-[10px] text-cyan-500 hover:underline font-mono cursor-pointer"
                  >
                    View Uploads
                  </button>
                )}
              </div>
            </div>

            {/* Expanded Active Timers Drawer */}
            {expandedOperationalTab === 'timers' && (
              <ActiveTimersDrawer
                channelId={activeChannelId}
                onCancelSchedule={cancelSchedule}
              />
            )}

            {/* Expanded Queued Messages Drawer */}
            {expandedOperationalTab === 'queue' && channelQueuedMessages.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1 pt-1 border-t border-kin-border">
                {channelQueuedMessages.map((qm, idx) => (
                  <div
                    key={qm.id}
                    className="flex items-center justify-between p-1.5 rounded-lg bg-kin-surface border border-kin-border text-xs font-mono"
                  >
                    <div className="flex items-center space-x-2 truncate mr-2">
                      <span className="text-blue-500 font-bold shrink-0 text-[10px]">#{idx + 1}</span>
                      <span className="text-kin-text text-[11px] truncate">{qm.content}</span>
                    </div>
                    <div className="flex items-center space-x-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => promoteQueuedToSteer(qm.id)}
                        className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 dark:text-amber-300 border border-amber-500/40 text-[10px] transition cursor-pointer"
                        title="Promote to Immediate Priority Steer Directive"
                      >
                        <Zap className="w-2.5 h-2.5" />
                        <span>Steer Now</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => dequeueMessage(qm.id)}
                        className="p-1 hover:text-red-500 text-kin-muted transition cursor-pointer"
                        title="Remove from queue"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

        {/* Interrupted Run Recovery Dock */}
        <InterruptedRecoveryDock selectableModels={selectableModels} />

        {/* Provider Quota Pause Banner */}
        <QuotaPauseBanner selectableModels={selectableModels} />

        {/* Interactive Adversarial Grill-Me Assessment Card */}
        {grillMeSession && (
          <div className="p-3.5 bg-rose-500/10 dark:bg-rose-950/40 backdrop-blur-sm border border-rose-500/40 rounded-xl space-y-3 shadow-xl animate-fadeIn">
            <div className="flex items-center justify-between border-b border-rose-500/20 pb-2">
              <div className="flex items-center space-x-2">
                <Flame className="w-4 h-4 text-rose-500" />
                <span className="text-[12px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-300 font-mono">
                  Adversarial Assessment: {grillMeSession.topic}
                </span>
              </div>
              <button
                type="button"
                onClick={() => dismissGrillMe()}
                className="p-1 text-kin-muted hover:text-rose-500 transition cursor-pointer"
                title="Dismiss questionnaire"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {grillMeSession.questions.map((q, qIdx) => (
                <div key={q.id} className="p-2.5 rounded-lg bg-kin-card border border-rose-500/20 space-y-1.5">
                  <div className="text-[11px] font-semibold text-rose-600 dark:text-rose-300 font-mono">
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
                              ? 'bg-rose-600/30 border-rose-500 text-kin-text font-bold ring-1 ring-rose-400'
                              : 'bg-kin-surface border-kin-border text-kin-text hover:bg-rose-500/10'
                          }`}
                        >
                          <span className="text-rose-500 mr-1.5">{isSelected ? '◉' : '○'}</span>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-kin-muted font-mono">
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
          <div className="p-3 bg-amber-500/10 dark:bg-amber-950/40 backdrop-blur-sm border border-amber-500/40 rounded-xl space-y-2.5 shadow-xl animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 animate-pulse" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300 font-mono">
                  Security Gate: Action Approval Required ({scopedPendingApprovals.length})
                </span>
              </div>
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30 font-mono">
                Autonomy Gate
              </span>
            </div>

            {scopedPendingApprovals.map((appr) => (
              <div key={appr.id} className="p-2.5 rounded-lg bg-kin-card border border-kin-border space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center space-x-2 font-mono truncate mr-2">
                    <span className="font-bold text-amber-400">{appr.agentName}</span>
                    <span className="text-kin-muted">requests execution:</span>
                    <span className="flex items-center space-x-1 px-1.5 py-0.2 rounded bg-kin-card text-blue-300 font-bold shrink-0">
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

                {appr.toolName === 'create_tool' || appr.toolName === 'createTool' ? (
                  <div className="space-y-2 p-2.5 rounded bg-black/60 border border-blue-500/30 text-xs">
                    <div className="flex items-center justify-between text-blue-300 font-semibold font-mono">
                      <span>✨ Dynamic Tool Proposal: {appr.parameters?.name || 'custom_tool'}</span>
                      <span className="text-[10px] text-kin-muted">Worker Sandbox Isolated</span>
                    </div>
                    {appr.parameters?.description && (
                      <p className="text-[11px] text-kin-muted">{appr.parameters.description}</p>
                    )}
                    {appr.parameters?.rationale && (
                      <div className="text-[11px] text-amber-300/90 font-mono">
                        <span className="font-bold">Rationale:</span> {appr.parameters.rationale}
                      </div>
                    )}
                    {appr.parameters?.handlerCode && (
                      <div className="mt-1">
                        <span className="text-[10px] text-kin-muted font-mono">Sandboxed Code Preview:</span>
                        <pre className="p-2 rounded bg-black/80 font-mono text-[10px] text-emerald-300 overflow-x-auto max-h-36 border border-kin-border">
                          {appr.parameters.handlerCode}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-2 rounded bg-black/60 font-mono text-[11px] text-kin-text break-all border border-kin-border">
                    {appr.actionSummary}
                  </div>
                )}

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    onClick={async () => {
                      const res = await resolveApproval(appr.id, false);
                      if (!res?.success) {
                        addToast(res?.error || 'Failed to reject approval request', 'error');
                      }
                    }}
                    className="flex items-center space-x-1 px-3 py-1 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 text-xs font-medium transition cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject Action</span>
                  </button>
                  <button
                    onClick={async () => {
                      const res = await resolveApproval(appr.id, true);
                      if (!res?.success) {
                        addToast(res?.error || 'Failed to execute approved action', 'error');
                      } else {
                        addToast('Action approved and executing', 'info');
                      }
                    }}
                    className="flex items-center space-x-1 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-900/30 transition cursor-pointer"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Approve & Execute</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}


        {sendError && (
          <div className="px-3 py-2 bg-red-50 dark:bg-red-950/80 border border-red-200 dark:border-red-500/60 rounded-xl text-xs text-red-800 dark:text-red-200 flex items-center justify-between shadow-xs animate-fadeIn">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{sendError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Replying to Context Banner */}
        {replyingToMessage && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-xs text-blue-300 animate-fadeIn select-none shadow-xs">
            <div className="flex items-center space-x-2 truncate min-w-0">
              <CornerDownRight className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="font-semibold text-blue-400 shrink-0">
                Replying to @{replyingToMessage.senderName || 'Agent'}:
              </span>
              <span className="truncate italic text-kin-muted max-w-md">
                "{replyingToMessage.content.slice(0, 100)}"
              </span>
            </div>
            <button
              type="button"
              onClick={() => setReplyingToMessage(null)}
              className="p-1 rounded-lg hover:bg-blue-500/20 text-blue-300 hover:text-white transition cursor-pointer ml-2 shrink-0"
              title="Cancel reply"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Attached Files Tray */}
        {pendingAttachments.length > 0 && (
          <div className="flex items-center space-x-2 overflow-x-auto py-1 px-1 no-scrollbar animate-fadeIn">
            {pendingAttachments.map((att, idx) => (
              <div
                key={att.id || idx}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-kin-surface border border-kin-border text-xs text-kin-text shrink-0 shadow-xs group"
              >
                <Paperclip className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate max-w-[150px] font-medium" title={att.filename}>{att.filename}</span>
                {att.size ? (
                  <span className="text-[10px] font-mono text-kin-muted">
                    ({att.size < 1024 ? `${att.size}B` : `${Math.round(att.size / 1024)}KB`})
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-0.5 rounded hover:bg-kin-card text-kin-muted hover:text-red-400 transition cursor-pointer ml-1"
                  title="Remove attachment"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
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
            <div className="absolute bottom-full mb-2 left-0 bg-kin-surface border border-kin-border rounded-xl shadow-2xl p-2 z-30 w-80 max-h-64 overflow-y-auto space-y-1 animate-fadeIn">
              <div className="text-[10px] text-kin-muted uppercase font-bold px-2 py-0.5 flex items-center justify-between border-b border-kin-border pb-1">
                <span>Project Agents ({matchingAgents.length})</span>
                <span className="text-[9px] font-mono lowercase text-kin-muted">↑↓ Tab/Enter</span>
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
                        : 'hover:bg-kin-card/70 text-kin-text'
                    }`}
                  >
                    <div className="flex items-center space-x-2 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_4px_rgba(52,211,153,0.5)]" />
                      <span className="font-semibold text-kin-text text-xs whitespace-nowrap">{ag.displayName}</span>
                    </div>
                    <span className="text-[10px] text-kin-muted font-mono truncate ml-2 text-right">{ag.role}</span>
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
                          const res = await useKinStore.getState().reloadMcpServers();
                          if (res.success) {
                            addToast({ title: "MCP Servers Reloaded", message: `Tools discovered: ${res.toolsCount || 0}`, type: "success" });
                          } else {
                            addToast({ title: "MCP Reload Failed", message: res.error || 'Failed to reload MCP servers', type: "error" });
                          }
                        } catch (err: any) {
                          console.warn('[KIN UI] MCP reload error:', err);
                          addToast({ title: "MCP Reload Failed", message: err?.message || 'Error reloading MCP servers', type: "error" });
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

          <textarea
            ref={inputRef}
            rows={1}
            value={inputText}
            onChange={(e) => {
              handleInputChange(e);
              adjustTextareaHeight();
            }}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
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
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
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
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
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
                if (inputRef.current) {
                  inputRef.current.style.height = '38px';
                }
              }
            }}
            placeholder={
              isChannelExecuting
                ? `⚡ Steer active execution, or type and click 'Queue' for next...`
                : isDm
                ? `Direct message with ${targetAgent?.displayName || '@Agent'}... (Shift+Enter for newline)`
                : `Message #${activeChannel?.name || 'general'} (Shift+Enter for newline, '/' for commands, '@' for agents)...`
            }
            className="flex-1 bg-transparent text-xs text-kin-text placeholder-kin-subtle focus:outline-none resize-none overflow-y-auto leading-relaxed py-1 min-h-[38px] max-h-[180px]"
          />

          <div className="flex items-center space-x-1.5 ml-2 text-kin-muted">
            <button
              type="button"
              onClick={toggleVoiceDictation}
              className={`p-1 transition ${
                isListening
                  ? 'text-red-400 animate-pulse bg-red-500/20 rounded'
                  : 'hover:text-kin-text text-kin-muted'
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
                        } catch (err) {
                          console.warn('[KIN UI] Failed to remove draft from localStorage:', err);
                        }
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

