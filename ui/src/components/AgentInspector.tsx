import React, { useState, useEffect, useRef } from 'react';
import { useKinStore } from '../store/kinStore.js';
import {
  Terminal,
  ShieldCheck,
  FileText,
  Save,
  Check,
  Send,
  Hash,
  Activity,
  FileCode,
  Search,
  Copy,
  ArrowLeft,
  RefreshCw,
  Bot,
  Code2,
  Zap,
  CheckCircle2,
  MessageSquare,
  Clock,
  Cpu,
  GitBranch,
  UploadCloud,
  Download,
  Trash2,
  Undo2,
  CheckSquare,
  Square,
  RotateCcw,
  FileUp,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  AlertCircle,
  Users,
  Network,
  Target,
  Award,
  Key,
  Lock,
  Plus,
} from 'lucide-react';

export const AgentInspector: React.FC = () => {
  const {
    agents,
    selectedAgentId,
    activeProject,
    channels,
    activeChannelId,
    setActiveChannel,
    goals,
    tasks,
    sendMessage,
    ollamaStatus,
    activeRightTab,
    setActiveRightTab,
    activeInspectorTab,
    setActiveInspectorTab,
    updateAgentContract,
    terminalHistory,
    runTerminalCommand,
    clearTerminalHistory,
    artifacts,
    selectedArtifact,
    fetchArtifacts,
    selectArtifact,
    clearSelectedArtifact,
    gitStatus,
    activeGitDiff,
    isLoadingDiff,
    fetchGitStatus,
    fetchGitDiff,
    clearGitDiff,
    revertGitFile,
    stageGitFile,
    requestAiReview,
    uploads,
    isUploading,
    fetchUploads,
    uploadFile,
    deleteUpload,
    inspectorWidth,
    agentEvaluations,
    evaluationsLoading,
    credentials,
    fetchEvaluations,
    runAgentEvaluation,
    fetchCredentials,
    addCredential,
    deleteCredential,
    availableModels,
    isLoadingModels,
    discoverModels,
    addCustomModel,
  } = useKinStore();

  const currentAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  // Contract form state
  const [roleTitle, setRoleTitle] = useState(currentAgent?.role || 'Lead Sovereign Orchestrator');
  const [activeModelId, setActiveModelId] = useState(currentAgent?.activeModelId || 'ollama/qwen2.5-coder:3b');
  const [customInstructions, setCustomInstructions] = useState(
    currentAgent?.systemPrompt || 'Optional custom instructions specific to this agent'
  );
  const [isSaved, setIsSaved] = useState(false);

  // Dynamic models & discovery state
  const [customModelInput, setCustomModelInput] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryProvider, setDiscoveryProvider] = useState('openrouter');
  const [discoveryFeedback, setDiscoveryFeedback] = useState<string | null>(null);

  // Credentials BYOK state
  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [credProvider, setCredProvider] = useState('anthropic');
  const [credAlias, setCredAlias] = useState('');
  const [credSecret, setCredSecret] = useState('');
  const [credMaxTokens, setCredMaxTokens] = useState('500000');
  const [credGrants, setCredGrants] = useState<string[]>(['tools:read', 'tools:exec', 'models:fast']);
  const [credSubmitting, setCredSubmitting] = useState(false);

  // Terminal state
  const [terminalInput, setTerminalInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Artifacts state
  const [artifactSearch, setArtifactSearch] = useState('');
  const [artifactCategory, setArtifactCategory] = useState<'all' | 'spec' | 'code' | 'config'>('all');
  const [copiedFile, setCopiedFile] = useState(false);

  // Changes / Git state
  const [changesSearch, setChangesSearch] = useState('');
  const [revertingPath, setRevertingPath] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);

  // Review / AI state
  const [isAiReviewing, setIsAiReviewing] = useState(false);
  const [aiReviewResult, setAiReviewResult] = useState<{ path?: string; review?: string; verdict?: string } | null>(null);
  const [showAiReviewCard, setShowAiReviewCard] = useState(true);

  // Uploads state
  const [uploadSearch, setUploadSearch] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeRightTab === 'Agent') {
      if (activeInspectorTab === 'Evaluations' && currentAgent?.id) {
        fetchEvaluations(currentAgent.id);
      } else if (activeInspectorTab === 'Credentials') {
        fetchCredentials();
      }
    }
  }, [activeRightTab, activeInspectorTab, currentAgent?.id]);

  useEffect(() => {
    if (currentAgent) {
      setRoleTitle(currentAgent.role);
      setActiveModelId(currentAgent.activeModelId);
      if (currentAgent.systemPrompt) {
        setCustomInstructions(currentAgent.systemPrompt);
      }
    }
  }, [currentAgent?.id, currentAgent?.activeModelId, currentAgent?.role]);

  useEffect(() => {
    if (activeRightTab === 'Terminal') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalHistory.length, activeRightTab]);

  const handleSaveContract = async () => {
    if (!currentAgent) return;
    await updateAgentContract(currentAgent.id, roleTitle, activeModelId, customInstructions);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleTerminalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalInput.trim()) return;
    const cmd = terminalInput.trim();
    setTerminalInput('');
    setHistoryIndex(null);
    await runTerminalCommand(cmd);
  };

  const handleTerminalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (terminalHistory.length === 0) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = historyIndex === null ? terminalHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setTerminalInput(terminalHistory[nextIdx]?.command || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === null || historyIndex >= terminalHistory.length - 1) {
        setHistoryIndex(null);
        setTerminalInput('');
      } else {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setTerminalInput(terminalHistory[nextIdx]?.command || '');
      }
    }
  };

  const handleCopyArtifactContent = () => {
    if (!selectedArtifact?.content) return;
    navigator.clipboard.writeText(selectedArtifact.content);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 2000);
  };

  const handleCopyPath = (pathText: string) => {
    navigator.clipboard.writeText(pathText);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  // Upload handlers
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const res = await uploadFile(file);
        if (!res.success) {
          setUploadFeedback(`Failed: ${res.error}`);
          setTimeout(() => setUploadFeedback(null), 3000);
        }
      }
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      for (let i = 0; i < e.target.files.length; i++) {
        const file = e.target.files[i];
        const res = await uploadFile(file);
        if (!res.success) {
          setUploadFeedback(`Failed: ${res.error}`);
          setTimeout(() => setUploadFeedback(null), 3000);
        }
      }
      e.target.value = '';
    }
  };

  // Revert file confirmation
  const handleRevert = async (filePath: string) => {
    if (window.confirm(`Are you sure you want to revert all changes to "${filePath}"? This action cannot be undone.`)) {
      setRevertingPath(filePath);
      await revertGitFile(filePath);
      setRevertingPath(null);
    }
  };

  // Filtered lists
  const assignedChannels = channels.filter(
    (c) =>
      !c.id.startsWith('dm-') &&
      (c.memberIds?.includes(currentAgent?.id) ||
        currentAgent?.assignedChannels?.includes(c.id) ||
        (currentAgent?.isOrchestrator && !c.id.startsWith('dm-')))
  );

  const filteredArtifacts = artifacts.filter((a) => {
    const matchesSearch =
      a.name.toLowerCase().includes(artifactSearch.toLowerCase()) ||
      a.relativePath.toLowerCase().includes(artifactSearch.toLowerCase());
    const matchesCat = artifactCategory === 'all' || a.category === artifactCategory;
    return matchesSearch && matchesCat;
  });

  const filteredGitFiles = gitStatus.files.filter((f) =>
    f.path.toLowerCase().includes(changesSearch.toLowerCase())
  );

  const filteredUploads = uploads.filter((u) =>
    u.originalName.toLowerCase().includes(uploadSearch.toLowerCase())
  );

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const cleanAnsiOutput = (text: string): string => {
    if (!text) return '';
    return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\[\d+m/g, '');
  };

  // Review handlers
  const handleRequestReview = async (filePath?: string) => {
    setIsAiReviewing(true);
    setAiReviewResult(null);
    const res = await requestAiReview(filePath);
    setIsAiReviewing(false);
    if (res.success && res.review) {
      setAiReviewResult({ path: filePath, review: res.review, verdict: res.verdict });
      setShowAiReviewCard(true);
    }
  };

  const currentDiffIndex = gitStatus.files.findIndex((f) => f.path === activeGitDiff?.path);
  const handlePrevReviewFile = () => {
    if (gitStatus.files.length === 0) return;
    const prevIdx = currentDiffIndex <= 0 ? gitStatus.files.length - 1 : currentDiffIndex - 1;
    fetchGitDiff(gitStatus.files[prevIdx].path);
  };
  const handleNextReviewFile = () => {
    if (gitStatus.files.length === 0) return;
    const nextIdx = currentDiffIndex === -1 || currentDiffIndex >= gitStatus.files.length - 1 ? 0 : currentDiffIndex + 1;
    fetchGitDiff(gitStatus.files[nextIdx].path);
  };

  return (
    <aside
      style={{ width: `${inspectorWidth}px` }}
      className="shrink-0 bg-[#090d16] border-l border-[#1e293b] flex flex-col h-full text-xs select-none"
    >
      {/* Top Header: 6 Antigravity Primary Tabs (Agent, Changes, Review, Artifacts, Uploads, Terminal) */}
      <div className="h-10 border-b border-[#1e293b] px-2 flex items-center justify-between bg-[#070b12] overflow-x-auto shrink-0">
        <div className="flex items-center space-x-0.5">
          {/* 1. Agent */}
          <button
            onClick={() => setActiveRightTab('Agent')}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-semibold transition shrink-0 ${
              activeRightTab === 'Agent'
                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
            title="Agent Contract & Telemetry"
          >
            <Bot className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Agent</span>
          </button>

          {/* 2. Changes */}
          <button
            onClick={() => {
              setActiveRightTab('Changes');
              fetchGitStatus();
            }}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-semibold transition shrink-0 ${
              activeRightTab === 'Changes'
                ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
            title="Files Changed & Git Status"
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Changes</span>
            {gitStatus.summary.totalChanged > 0 && (
              <span className="text-[10px] px-1 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                {gitStatus.summary.totalChanged}
              </span>
            )}
          </button>

          {/* 3. Review */}
          <button
            onClick={() => {
              setActiveRightTab('Review');
              fetchGitStatus();
              if (!activeGitDiff && gitStatus.files.length > 0) {
                fetchGitDiff(gitStatus.files[0].path);
              }
            }}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-semibold transition shrink-0 ${
              activeRightTab === 'Review'
                ? 'bg-rose-600/20 text-rose-400 border border-rose-500/30'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
            title="Code Review & AI Diff Analysis"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Review</span>
          </button>

          {/* 3. Artifacts */}
          <button
            onClick={() => {
              setActiveRightTab('Artifacts');
              fetchArtifacts();
            }}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-semibold transition shrink-0 ${
              activeRightTab === 'Artifacts'
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
            title="Project Deliverables & Artifacts"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Artifacts</span>
            {artifacts.length > 0 && (
              <span className="text-[10px] px-1 rounded-full bg-[#1e293b] text-[#94a3b8]">
                {artifacts.length}
              </span>
            )}
          </button>

          {/* 4. Uploads */}
          <button
            onClick={() => {
              setActiveRightTab('Uploads');
              fetchUploads();
            }}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-semibold transition shrink-0 ${
              activeRightTab === 'Uploads'
                ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
            title="Project Uploads & Attachments"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Uploads</span>
            {uploads.length > 0 && (
              <span className="text-[10px] px-1 rounded-full bg-[#1e293b] text-[#94a3b8]">
                {uploads.length}
              </span>
            )}
          </button>

          {/* 5. Terminal */}
          <button
            onClick={() => setActiveRightTab('Terminal')}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-semibold transition shrink-0 ${
              activeRightTab === 'Terminal'
                ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
            title="Interactive PowerShell Terminal"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>
        </div>
      </div>

      {/* Sub-header for Agent Tab Views */}
      {activeRightTab === 'Agent' && (
        <div className="h-8 border-b border-[#1e293b] px-3 flex items-center justify-between bg-[#0a0f1d] shrink-0 select-none">
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[#64748b] mr-1">View:</span>
            <button
              onClick={() => setActiveInspectorTab('Telemetry')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                activeInspectorTab === 'Telemetry'
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 font-semibold shadow-sm'
                  : 'text-[#8b949e] hover:text-kin-text hover:bg-[#161b22]'
              }`}
            >
              Telemetry
            </button>
            <button
              onClick={() => setActiveInspectorTab('Contract')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                activeInspectorTab === 'Contract'
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 font-semibold shadow-sm'
                  : 'text-[#8b949e] hover:text-kin-text hover:bg-[#161b22]'
              }`}
            >
              Contract
            </button>
            <button
              onClick={() => setActiveInspectorTab('Teamwork')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                activeInspectorTab === 'Teamwork'
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 font-semibold shadow-sm'
                  : 'text-[#8b949e] hover:text-kin-text hover:bg-[#161b22]'
              }`}
            >
              Teamwork
            </button>
            <button
              onClick={() => {
                setActiveInspectorTab('Evaluations');
                if (currentAgent?.id) fetchEvaluations(currentAgent.id);
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer flex items-center space-x-1 ${
                activeInspectorTab === 'Evaluations'
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 font-semibold shadow-sm'
                  : 'text-[#8b949e] hover:text-kin-text hover:bg-[#161b22]'
              }`}
            >
              <Award className="w-3 h-3 text-amber-400" />
              <span>Evals</span>
            </button>
            <button
              onClick={() => {
                setActiveInspectorTab('Credentials');
                fetchCredentials();
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer flex items-center space-x-1 ${
                activeInspectorTab === 'Credentials'
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 font-semibold shadow-sm'
                  : 'text-[#8b949e] hover:text-kin-text hover:bg-[#161b22]'
              }`}
            >
              <Key className="w-3 h-3 text-emerald-400" />
              <span>BYOK</span>
            </button>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#161b22] text-kin-muted border border-[#30363d] truncate max-w-[120px]">
            {currentAgent?.displayName}
          </span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: CHANGES (FILES CHANGED, STATUS & REVIEW OPTION DIFF)               */}
      {/* ========================================================================= */}
      {activeRightTab === 'Changes' && (
        <div className="flex-1 flex flex-col min-h-0">
          {activeGitDiff ? (
            /* REVIEW OPTION: UNIFIED GIT DIFF VIEW */
            <div className="flex-1 flex flex-col min-h-0 bg-[#070b12]">
              {/* Header with Back, File Info, Additions/Deletions, Revert & Stage */}
              <div className="p-2 border-b border-[#1e293b] bg-[#0c1222] flex items-center justify-between">
                <div className="flex items-center space-x-1.5 truncate mr-2">
                  <button
                    onClick={clearGitDiff}
                    className="p-1 rounded hover:bg-[#1e293b] text-[#94a3b8] hover:text-kin-text transition shrink-0"
                    title="Back to changed files"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-semibold text-kin-text truncate font-mono text-[11px]">
                    {activeGitDiff.path}
                  </span>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                    +{activeGitDiff.additions}
                  </span>
                  <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-bold">
                    -{activeGitDiff.deletions}
                  </span>
                  <button
                    onClick={() => handleCopyPath(activeGitDiff.path)}
                    className="p-1 rounded hover:bg-[#1e293b] text-[#94a3b8] hover:text-emerald-400 transition"
                    title="Copy File Path"
                  >
                    {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleRevert(activeGitDiff.path)}
                    disabled={revertingPath === activeGitDiff.path}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 text-[10px] font-medium transition"
                    title="Revert file changes"
                  >
                    <Undo2 className="w-3 h-3" />
                    <span>Revert</span>
                  </button>
                </div>
              </div>

              {/* Status Banner */}
              <div className="px-3 py-1 bg-[#090d16] text-[10px] text-[#64748b] font-mono flex items-center justify-between border-b border-[#1e293b]">
                <span>
                  {activeGitDiff.isUntracked
                    ? '⚠️ Untracked New File (Full Content Displayed)'
                    : 'Unified Git Diff (Relative to HEAD)'}
                </span>
                <span className="text-[#94a3b8]">Review Mode</span>
              </div>

              {/* Diff Lines Container */}
              <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-[#cbd5e1] whitespace-pre bg-[#04060b]">
                {isLoadingDiff ? (
                  <div className="p-8 text-center text-[#64748b]">Loading diff...</div>
                ) : activeGitDiff?.isBinary ? (
                  <div className="p-8 text-center text-[#64748b]">
                    <div className="text-amber-400 font-medium mb-1">Binary File Detected</div>
                    <div>Text diff preview unavailable for binary files.</div>
                  </div>
                ) : activeGitDiff.diff ? (
                  activeGitDiff.diff.split('\n').map((line, idx) => {
                    const isAdd = line.startsWith('+') && !line.startsWith('+++');
                    const isDel = line.startsWith('-') && !line.startsWith('---');
                    const isHeader = line.startsWith('@@') || line.startsWith('diff --git');

                    let lineStyle = 'text-[#94a3b8] px-2 py-0.5';
                    if (isAdd) lineStyle = 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5';
                    else if (isDel) lineStyle = 'bg-red-950/40 text-red-300 border-l-2 border-red-500 px-2 py-0.5';
                    else if (isHeader) lineStyle = 'bg-blue-950/40 text-blue-400 font-bold border-y border-blue-900/30 px-2 py-0.5';

                    return (
                      <div key={idx} className={`${lineStyle} hover:bg-white/5 transition-colors`}>
                        <span className="inline-block w-8 text-[#475569] text-right pr-2 select-none">
                          {idx + 1}
                        </span>
                        <span>{line}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-[#64748b]">No changes found for this file.</div>
                )}
              </div>
            </div>
          ) : (
            /* CHANGED FILES LIST & STATUS */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Summary Header */}
              <div className="p-2.5 border-b border-[#1e293b] bg-[#0c1222] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-kin-text text-xs">Live Changes</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                      {gitStatus.summary.totalChanged} changed
                    </span>
                  </div>
                  <button
                    onClick={() => fetchGitStatus()}
                    className="p-1 rounded bg-[#1e293b] hover:bg-[#253248] text-[#94a3b8] hover:text-kin-text transition"
                    title="Refresh Git Status"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>

                {/* Status Breakdown Badges */}
                <div className="flex flex-wrap gap-1 text-[10px] font-mono">
                  {gitStatus.summary.modifiedCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      Modified: {gitStatus.summary.modifiedCount}
                    </span>
                  )}
                  {gitStatus.summary.untrackedCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                      Untracked: {gitStatus.summary.untrackedCount}
                    </span>
                  )}
                  {gitStatus.summary.addedCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                      Added: {gitStatus.summary.addedCount}
                    </span>
                  )}
                  {gitStatus.summary.deletedCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20">
                      Deleted: {gitStatus.summary.deletedCount}
                    </span>
                  )}
                  {gitStatus.summary.stagedCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                      Staged: {gitStatus.summary.stagedCount}
                    </span>
                  )}
                </div>

                {/* Filter / Search */}
                <div className="relative">
                  <Search className="w-3 h-3 text-[#64748b] absolute left-2 top-2" />
                  <input
                    type="text"
                    value={changesSearch}
                    onChange={(e) => setChangesSearch(e.target.value)}
                    placeholder="Filter changed files..."
                    className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded pl-7 pr-2 py-1 text-xs text-kin-text placeholder-[#64748b] focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
              </div>

              {/* Changed Files Scrollable List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredGitFiles.length > 0 ? (
                  filteredGitFiles.map((file) => {
                    const statusColor =
                      file.status === 'modified'
                        ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                        : file.status === 'untracked'
                        ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
                        : file.status === 'added'
                        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                        : 'text-red-400 bg-red-500/10 border-red-500/30';

                    const statusLetter =
                      file.status === 'untracked' ? '??' : file.status.charAt(0).toUpperCase();

                    return (
                      <div
                        key={file.path}
                        className="p-2 rounded bg-[#0f172a] border border-[#1e293b] hover:border-amber-500/40 transition group flex items-center justify-between"
                      >
                        <div
                          onClick={() => {
                            setActiveRightTab('Review');
                            fetchGitDiff(file.path);
                          }}
                          className="flex items-center space-x-2 truncate flex-1 cursor-pointer mr-2"
                          title={`Click to review unified diff: ${file.path}`}
                        >
                          <span
                            className={`w-5 h-5 rounded flex items-center justify-center font-mono font-bold text-[10px] border shrink-0 ${statusColor}`}
                          >
                            {statusLetter}
                          </span>
                          <div className="truncate">
                            <div className="font-semibold text-kin-text truncate group-hover:text-amber-300">
                              {file.path.split('/').pop()}
                            </div>
                            <div className="text-[10px] text-[#64748b] font-mono truncate">
                              {file.path}
                            </div>
                          </div>
                        </div>

                        {/* Actions: Stage/Unstage, Revert, Review */}
                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            onClick={() => stageGitFile(file.path, !file.staged)}
                            className={`p-1 rounded text-[10px] transition ${
                              file.staged
                                ? 'bg-purple-600/30 text-purple-300 hover:bg-purple-600/50'
                                : 'bg-[#1e293b] text-[#94a3b8] hover:text-kin-text hover:bg-[#253248]'
                            }`}
                            title={file.staged ? 'Unstage file' : 'Stage file'}
                          >
                            {file.staged ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                          </button>

                          <button
                            onClick={() => handleRevert(file.path)}
                            disabled={revertingPath === file.path}
                            className="p-1 rounded bg-[#1e293b] hover:bg-red-950/60 text-[#94a3b8] hover:text-red-300 transition"
                            title="Revert file changes"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => {
                              setActiveRightTab('Review');
                              fetchGitDiff(file.path);
                            }}
                            className="px-2 py-0.5 rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-[10px] font-medium transition"
                            title="Review Diff & AI Code Review"
                          >
                            Review
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-[#64748b] space-y-2">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500/60" />
                    <p className="text-xs font-semibold text-kin-text">Working tree clean</p>
                    <p className="text-[11px]">No modified, added, or untracked files detected in this repository.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: REVIEW (INTERACTIVE CODE REVIEW & AI DIFF ANALYSIS)                */}
      {/* ========================================================================= */}
      {activeRightTab === 'Review' && (
        <div className="flex-1 flex flex-col min-h-0 bg-[#070b12]">
          {gitStatus.files.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#64748b] space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <div className="text-sm font-semibold text-kin-text">No Files to Review</div>
              <p className="text-xs text-[#94a3b8] max-w-[260px]">
                Your git working tree is completely clean. Make changes to project files or check out another branch to review diffs.
              </p>
              <button
                onClick={() => fetchGitStatus()}
                className="flex items-center space-x-1 px-3 py-1.5 rounded bg-[#1e293b] hover:bg-[#253248] text-kin-text font-medium text-xs transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Check Again</span>
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Review Top Control Bar */}
              <div className="p-2 border-b border-[#1e293b] bg-[#0c1222] space-y-2">
                {/* File Navigator Row */}
                <div className="flex items-center space-x-1.5">
                  {/* Prev File Button */}
                  <button
                    onClick={handlePrevReviewFile}
                    className="p-1 rounded bg-[#1e293b] hover:bg-[#253248] text-[#94a3b8] hover:text-kin-text transition shrink-0"
                    title="Previous Changed File"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>

                  {/* File Selector Dropdown */}
                  <select
                    value={activeGitDiff?.path || ''}
                    onChange={(e) => {
                      if (e.target.value) fetchGitDiff(e.target.value);
                    }}
                    className="flex-1 min-w-0 bg-[#070b12] border border-[#1e293b] rounded px-2 py-1 text-xs text-kin-text focus:outline-none focus:border-rose-500 font-mono truncate"
                  >
                    {!activeGitDiff && <option value="">Select a file to review...</option>}
                    {gitStatus.files.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.staged ? '● ' : '○ '} {f.path} ({f.status})
                      </option>
                    ))}
                  </select>

                  {/* Next File Button */}
                  <button
                    onClick={handleNextReviewFile}
                    className="p-1 rounded bg-[#1e293b] hover:bg-[#253248] text-[#94a3b8] hover:text-kin-text transition shrink-0"
                    title="Next Changed File"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>

                  {/* Refresh Git Status */}
                  <button
                    onClick={() => {
                      fetchGitStatus();
                      if (activeGitDiff) fetchGitDiff(activeGitDiff.path);
                    }}
                    className="p-1 rounded bg-[#1e293b] hover:bg-[#253248] text-[#94a3b8] hover:text-kin-text transition shrink-0"
                    title="Refresh Diff"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* File Action & Review Bar */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    {activeGitDiff && (
                      <>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                          +{activeGitDiff.additions}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-bold">
                          -{activeGitDiff.deletions}
                        </span>
                        <button
                          onClick={() => handleCopyPath(activeGitDiff.path)}
                          className="p-1 rounded hover:bg-[#1e293b] text-[#94a3b8] hover:text-emerald-400 transition"
                          title="Copy File Path"
                        >
                          {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex items-center space-x-1.5">
                    {activeGitDiff && (
                      <>
                        {/* Stage/Unstage Toggle */}
                        {(() => {
                          const currentFile = gitStatus.files.find((f) => f.path === activeGitDiff.path);
                          const isStaged = currentFile?.staged ?? false;
                          return (
                            <button
                              onClick={() => stageGitFile(activeGitDiff.path, !isStaged)}
                              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-medium border transition ${
                                isStaged
                                  ? 'bg-purple-600/20 text-purple-300 border-purple-500/30 hover:bg-purple-600/30'
                                  : 'bg-[#1e293b] text-[#94a3b8] border-[#334155] hover:text-kin-text'
                              }`}
                              title={isStaged ? 'Unstage file' : 'Stage file'}
                            >
                              {isStaged ? <CheckSquare className="w-3 h-3 text-purple-400" /> : <Square className="w-3 h-3" />}
                              <span>{isStaged ? 'Staged' : 'Stage'}</span>
                            </button>
                          );
                        })()}

                        {/* Revert Button */}
                        <button
                          onClick={() => handleRevert(activeGitDiff.path)}
                          disabled={revertingPath === activeGitDiff.path}
                          className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 text-[10px] font-medium transition"
                          title="Revert file changes"
                        >
                          <Undo2 className="w-3 h-3" />
                          <span>Revert</span>
                        </button>
                      </>
                    )}

                    {/* AI Review with @Boss Button */}
                    <button
                      onClick={() => handleRequestReview(activeGitDiff?.path)}
                      disabled={isAiReviewing}
                      className="flex items-center space-x-1 px-2.5 py-0.5 rounded bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-semibold text-[10px] shadow-sm transition disabled:opacity-50"
                      title="Request @Boss to perform autonomous architectural review of this diff"
                    >
                      {isAiReviewing ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Reviewing...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3 text-amber-200" />
                          <span>Review with @Boss</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Collapsible AI Review Verdict Card */}
              {aiReviewResult && showAiReviewCard && (
                <div className="p-3 bg-[#0f172a] border-b border-rose-500/30 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span className="font-bold text-kin-text">AI Code Review (@Boss)</span>
                      {aiReviewResult.verdict && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border ${
                            aiReviewResult.verdict === 'APPROVED' || aiReviewResult.verdict === 'clean'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          }`}
                        >
                          {aiReviewResult.verdict}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setShowAiReviewCard(false)}
                      className="text-[#64748b] hover:text-kin-text text-[11px]"
                      title="Dismiss review card"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="text-[11px] text-[#cbd5e1] whitespace-pre-wrap font-sans max-h-48 overflow-y-auto bg-[#070b12] p-2.5 rounded border border-[#1e293b]">
                    {aiReviewResult.review}
                  </div>
                  <div className="text-[10px] text-[#64748b] flex items-center justify-between font-mono">
                    <span>Target: {aiReviewResult.path || 'Entire Project'}</span>
                    <span>Dispatched to Channel Stream</span>
                  </div>
                </div>
              )}

              {/* Diff Lines Container */}
              <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-[#cbd5e1] whitespace-pre bg-[#04060b]">
                {isLoadingDiff ? (
                  <div className="p-8 text-center text-[#64748b]">Loading diff...</div>
                ) : activeGitDiff?.isBinary ? (
                  <div className="p-8 text-center text-amber-400/80 space-y-2">
                    <AlertCircle className="w-8 h-8 mx-auto text-amber-400" />
                    <p className="font-semibold">Binary File Detected</p>
                    <p className="text-[11px] text-[#94a3b8]">Unified text diff cannot be computed for binary asset files.</p>
                  </div>
                ) : activeGitDiff?.diff ? (
                  activeGitDiff.diff.split('\n').map((line, idx) => {
                    const isAdd = line.startsWith('+') && !line.startsWith('+++');
                    const isDel = line.startsWith('-') && !line.startsWith('---');
                    const isHeader = line.startsWith('@@') || line.startsWith('diff --git');

                    let lineStyle = 'text-[#94a3b8] px-2 py-0.5';
                    if (isAdd) lineStyle = 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5';
                    else if (isDel) lineStyle = 'bg-red-950/40 text-red-300 border-l-2 border-red-500 px-2 py-0.5';
                    else if (isHeader) lineStyle = 'bg-blue-950/40 text-blue-400 font-bold border-y border-blue-900/30 px-2 py-0.5';

                    return (
                      <div key={idx} className={`${lineStyle} hover:bg-white/5 transition-colors`}>
                        <span className="inline-block w-8 text-[#475569] text-right pr-2 select-none">
                          {idx + 1}
                        </span>
                        <span>{line}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-[#64748b] space-y-2">
                    <FileCode className="w-8 h-8 mx-auto text-[#475569]" />
                    <p className="text-xs">No active file selected or no differences detected.</p>
                    <p className="text-[11px] text-[#64748b]">Select a file from the dropdown above to review its unified diff.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: ARTIFACTS & DELIVERABLES EXPLORER                                  */}
      {/* ========================================================================= */}
      {activeRightTab === 'Artifacts' && (
        <div className="flex-1 flex flex-col min-h-0">
          {selectedArtifact ? (
            /* Deliverable Content View */
            <div className="flex-1 flex flex-col min-h-0 bg-[#070b12]">
              <div className="p-2 border-b border-[#1e293b] bg-[#0c1222] flex items-center justify-between">
                <div className="flex items-center space-x-1.5 truncate mr-2">
                  <button
                    onClick={clearSelectedArtifact}
                    className="p-1 rounded hover:bg-[#1e293b] text-[#94a3b8] hover:text-kin-text transition shrink-0"
                    title="Back to Deliverables list"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-semibold text-kin-text truncate">{selectedArtifact.name}</span>
                </div>
                <div className="flex items-center space-x-1.5 shrink-0">
                  <span className="text-[10px] text-[#64748b] font-mono">
                    {formatFileSize(selectedArtifact.size)}
                  </span>
                  <button
                    onClick={handleCopyArtifactContent}
                    className="p-1 rounded hover:bg-[#1e293b] text-[#94a3b8] hover:text-emerald-400 transition"
                    title="Copy File Content"
                  >
                    {copiedFile ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="px-3 py-1 bg-[#090d16] text-[10px] text-[#64748b] font-mono truncate border-b border-[#1e293b] flex items-center justify-between">
                <span className="truncate">{selectedArtifact.relativePath}</span>
                <span className="text-blue-400 shrink-0 font-medium">Deliverable</span>
              </div>

              <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-[#cbd5e1] whitespace-pre bg-[#04060b]">
                {selectedArtifact.content}
              </div>
            </div>
          ) : (
            /* Deliverables List */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Search & Category Filter */}
              <div className="p-2.5 border-b border-[#1e293b] bg-[#0c1222] space-y-2">
                <div className="flex items-center space-x-2">
                  <div className="relative flex-1">
                    <Search className="w-3 h-3 text-[#64748b] absolute left-2 top-2" />
                    <input
                      type="text"
                      value={artifactSearch}
                      onChange={(e) => setArtifactSearch(e.target.value)}
                      placeholder="Search deliverables..."
                      className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded pl-7 pr-2 py-1 text-xs text-kin-text placeholder-[#64748b] focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <button
                    onClick={() => fetchArtifacts()}
                    className="p-1.5 rounded bg-[#1e293b] hover:bg-[#253248] text-[#94a3b8] hover:text-kin-text transition shrink-0"
                    title="Refresh Artifacts"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>

                {/* Category Pills */}
                <div className="flex items-center space-x-1 text-[10px]">
                  {(['all', 'spec', 'code', 'config'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setArtifactCategory(cat)}
                      className={`px-2 py-0.5 rounded capitalize transition ${
                        artifactCategory === cat
                          ? 'bg-blue-600 text-white font-semibold'
                          : 'bg-[#1e293b] text-[#94a3b8] hover:text-kin-text'
                      }`}
                    >
                      {cat === 'all' ? 'All Files' : cat === 'spec' ? 'Specs/Docs' : cat === 'code' ? 'Code' : 'Configs'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Artifacts Scrollable List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredArtifacts.length > 0 ? (
                  filteredArtifacts.map((art) => (
                    <button
                      key={art.relativePath}
                      onClick={() => selectArtifact(art.relativePath)}
                      className="w-full text-left p-2 rounded bg-[#0f172a] hover:bg-[#162035] border border-[#1e293b] hover:border-blue-500/40 transition group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 truncate">
                          <Code2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="font-semibold text-kin-text truncate group-hover:text-blue-300">
                            {art.name}
                          </span>
                        </div>
                        <span className="text-[10px] text-[#64748b] font-mono shrink-0">
                          {formatFileSize(art.size)}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#64748b] font-mono truncate pt-1 pl-5">
                        {art.relativePath}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-8 text-center text-[#64748b] space-y-2">
                    <FileCode className="w-8 h-8 mx-auto text-[#334155]" />
                    <p className="text-xs">No matching deliverables found.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: UPLOADS & ATTACHMENTS (DROPZONE & PROJECT ASSETS)                  */}
      {/* ========================================================================= */}
      {activeRightTab === 'Uploads' && (
        <div className="flex-1 flex flex-col min-h-0 bg-[#070b12]">
          {/* Dropzone Header */}
          <div className="p-3 border-b border-[#1e293b] bg-[#0c1222] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-kin-text text-xs">Project Uploads</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                  {uploads.length} files
                </span>
              </div>
              <button
                onClick={() => fetchUploads()}
                className="p-1 rounded bg-[#1e293b] hover:bg-[#253248] text-[#94a3b8] hover:text-kin-text transition"
                title="Refresh Uploads"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            {/* Drag & Drop Target Box */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`p-3 rounded-xl border-2 border-dashed text-center cursor-pointer transition ${
                isDragging
                  ? 'border-cyan-400 bg-cyan-500/10'
                  : 'border-[#1e293b] hover:border-cyan-500/50 bg-[#0a0f1d]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileInputChange}
                className="hidden"
              />
              <FileUp className="w-6 h-6 mx-auto text-cyan-400 mb-1" />
              <div className="font-medium text-kin-text text-xs">
                {isUploading ? 'Uploading file...' : 'Drop files here or click to browse'}
              </div>
              <div className="text-[10px] text-[#64748b] mt-0.5">
                Saved in <code className="text-cyan-400">.kin/uploads</code> & persisted in SQLite
              </div>
            </div>

            {uploadFeedback && (
              <div className="text-[10px] text-red-400 bg-red-950/40 p-1.5 rounded border border-red-500/30">
                {uploadFeedback}
              </div>
            )}

            {/* Filter Search */}
            <div className="relative">
              <Search className="w-3 h-3 text-[#64748b] absolute left-2 top-2" />
              <input
                type="text"
                value={uploadSearch}
                onChange={(e) => setUploadSearch(e.target.value)}
                placeholder="Search uploaded files..."
                className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded pl-7 pr-2 py-1 text-xs text-kin-text placeholder-[#64748b] focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          {/* Uploads List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {filteredUploads.length > 0 ? (
              filteredUploads.map((upl) => (
                <div
                  key={upl.id}
                  className="p-2 rounded bg-[#0f172a] border border-[#1e293b] hover:border-cyan-500/40 transition group flex items-center justify-between"
                >
                  <div className="flex items-center space-x-2 truncate flex-1 mr-2">
                    <FolderOpen className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div className="truncate">
                      <div className="font-semibold text-kin-text truncate group-hover:text-cyan-300">
                        {upl.originalName}
                      </div>
                      <div className="text-[10px] text-[#64748b] font-mono flex items-center space-x-2">
                        <span>{formatFileSize(upl.size)}</span>
                        <span>•</span>
                        <span>{new Date(upl.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      onClick={() => handleCopyPath(upl.relativePath)}
                      className="p-1 rounded bg-[#1e293b] hover:bg-[#253248] text-[#94a3b8] hover:text-cyan-300 transition"
                      title="Copy relative path for agents"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    <a
                      href={`/api/projects/${upl.projectId}/uploads/${upl.id}/download`}
                      download={upl.originalName}
                      className="p-1 rounded bg-[#1e293b] hover:bg-[#253248] text-[#94a3b8] hover:text-emerald-400 transition"
                      title="Download file"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>

                    <button
                      onClick={async () => {
                        if (window.confirm(`Delete upload "${upl.originalName}"?`)) {
                          await deleteUpload(upl.id);
                        }
                      }}
                      className="p-1 rounded bg-[#1e293b] hover:bg-red-950/60 text-[#94a3b8] hover:text-red-400 transition"
                      title="Delete upload"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-[#64748b] space-y-2">
                <UploadCloud className="w-8 h-8 mx-auto text-[#334155]" />
                <p className="text-xs">No project uploads yet.</p>
                <p className="text-[10px]">Drop files above to make them accessible to your workforce.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: INTEGRATED POWERSHELL TERMINAL                                     */}
      {/* ========================================================================= */}
      {activeRightTab === 'Terminal' && (
        <div className="flex-1 flex flex-col min-h-0 bg-[#070b12] font-mono text-[11px]">
          {/* Quick preset commands bar */}
          <div className="px-2 py-1.5 border-b border-[#1e293b] bg-[#0c1222] flex items-center justify-between text-[10px] overflow-x-auto">
            <div className="flex items-center space-x-1 shrink-0">
              <span className="text-[#64748b] mr-1">Presets:</span>
              {['git status', 'git diff', 'npm test', 'dir', 'git log -n 5'].map((preset) => (
                <button
                  key={preset}
                  onClick={() => runTerminalCommand(preset)}
                  className="px-1.5 py-0.5 rounded bg-[#1e293b] hover:bg-purple-600/30 hover:text-purple-300 text-[#94a3b8] border border-[#2d3748] transition"
                >
                  {preset}
                </button>
              ))}
            </div>

            <button
              onClick={clearTerminalHistory}
              className="p-1 rounded hover:bg-[#1e293b] text-[#64748b] hover:text-red-300 transition shrink-0 ml-1"
              title="Clear Terminal Output"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>

          {/* Terminal Output */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 text-[#cbd5e1] leading-tight select-text">
            <div className="text-[#64748b]">Windows PowerShell [KIN Integrated Kernel]</div>
            <div className="text-[#64748b]">Jail confinement: {activeProject?.repoPath || '.'}</div>
            <div className="text-emerald-400">PS {activeProject?.repoPath || '.'}&gt;</div>

            {terminalHistory.map((item, idx) => (
              <div key={idx} className="space-y-0.5 pt-1">
                <div className="text-blue-400 font-bold flex items-center justify-between">
                  <span>&gt; {item.command}</span>
                  <span
                    className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                      item.exitCode === 0
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    exit {item.exitCode}
                  </span>
                </div>
                <div
                  className={`whitespace-pre-wrap font-mono break-all ${
                    item.exitCode === 0 ? 'text-[#94a3b8]' : 'text-red-400'
                  }`}
                >
                  {cleanAnsiOutput(item.output)}
                </div>
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>

          {/* Terminal Input Form */}
          <form
            onSubmit={handleTerminalSubmit}
            className="p-2 border-t border-[#1e293b] flex items-center space-x-1 bg-[#0a0f1d]"
          >
            <span className="text-emerald-400 text-xs pl-1 font-bold">&gt;</span>
            <input
              type="text"
              value={terminalInput}
              onChange={(e) => setTerminalInput(e.target.value)}
              onKeyDown={handleTerminalKeyDown}
              placeholder="Run command in project jail..."
              className="flex-1 bg-transparent text-xs text-kin-text placeholder-[#64748b] focus:outline-none font-mono"
            />
            <button
              type="submit"
              disabled={!terminalInput.trim()}
              className="p-1.5 text-emerald-400 hover:text-emerald-300 disabled:opacity-30 rounded hover:bg-[#1e293b] transition"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: AGENT INSPECTOR (CONTRACT & LIVE TELEMETRY)                        */}
      {/* ========================================================================= */}
      {activeRightTab === 'Agent' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Selected Agent Identity Card */}
            <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-6 h-6 rounded flex items-center justify-center font-bold text-xs border ${
                      currentAgent?.isOrchestrator
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        : 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                    }`}
                  >
                    @
                  </div>
                  <div>
                    <div className="font-semibold text-kin-text">{currentAgent?.displayName || '@Boss'}</div>
                    <div className="text-[10px] text-[#64748b]">{currentAgent?.role || 'Specialist'}</div>
                  </div>
                </div>

                <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                  {currentAgent?.status?.toUpperCase() || 'IDLE'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-[#1e293b] text-[10px]">
                <span className="text-[#64748b] flex items-center space-x-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  <span>Workspace Boundary</span>
                </span>
                <span className="text-emerald-400 font-medium">Enforced</span>
              </div>
            </div>

            {/* Assigned Channels Section */}
            <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-kin-text font-semibold text-[11px]">
                  <Hash className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Assigned Channels</span>
                </div>
                <span className="text-[10px] text-[#64748b]">
                  {assignedChannels.length} {assignedChannels.length === 1 ? 'channel' : 'channels'}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1 max-h-24 overflow-y-auto pr-1">
                {assignedChannels.length > 0 ? (
                  assignedChannels.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setActiveChannel(c.id)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono border transition ${
                        c.id === activeChannelId
                          ? 'bg-emerald-600/25 border-emerald-500/50 text-emerald-300 font-semibold'
                          : 'bg-[#1e293b] border-[#2d3748] text-[#94a3b8] hover:text-kin-text hover:bg-[#253248]'
                      }`}
                    >
                      #{c.name}
                    </button>
                  ))
                ) : (
                  <span className="text-[11px] text-[#64748b] italic">No public channels assigned yet</span>
                )}
              </div>
            </div>

            {/* Sub-tab 1: Contract & Prompts */}
            {activeInspectorTab === 'Contract' ? (
              <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-kin-text font-semibold text-[11px]">
                    <FileText className="w-3.5 h-3.5 text-blue-400" />
                    <span>Role Contract & Prompts</span>
                  </div>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">
                    Project Scope
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-[#64748b] uppercase tracking-wider">
                    Specialist Role Title
                  </label>
                  <input
                    type="text"
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded px-2.5 py-1.5 text-kin-text text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Dynamic LLM Model Selector with Live Discovery & Manual Assignment */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-medium text-[#64748b] uppercase tracking-wider">
                      Assigned Model (Tier 1)
                    </label>
                    <span className="text-[9px] text-emerald-400 font-mono truncate max-w-[150px]">
                      {activeModelId.replace(/^ollama\//, '').toUpperCase()}
                    </span>
                  </div>

                  <select
                    value={activeModelId}
                    onChange={(e) => setActiveModelId(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded px-2.5 py-1.5 text-kin-text text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  >
                    {/* 1. Local Ollama Models */}
                    <optgroup label="Local Ollama Models">
                      {availableModels.filter((m) => m.provider === 'ollama').length > 0 ? (
                        availableModels
                          .filter((m) => m.provider === 'ollama')
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name || m.id} (Local)
                            </option>
                          ))
                      ) : ollamaStatus.models.length > 0 ? (
                        ollamaStatus.models
                          .filter((m) => !m.toLowerCase().includes('embed'))
                          .map((m) => (
                            <option key={m} value={`ollama/${m}`}>
                              ollama/{m} (Local)
                            </option>
                          ))
                      ) : (
                        <>
                          <option value="ollama/qwen2.5-coder:3b">ollama/qwen2.5-coder:3b (Local)</option>
                          <option value="ollama/gemma4:e2b">ollama/gemma4:e2b (Local)</option>
                        </>
                      )}
                    </optgroup>

                    {/* 2. Discovered External Providers */}
                    {['anthropic', 'openai', 'gemini', 'deepseek', 'groq', 'openrouter'].map((prov) => {
                      const provModels = availableModels.filter((m) => m.provider === prov);
                      if (provModels.length === 0) return null;
                      const provLabel =
                        prov === 'anthropic' ? 'Anthropic Cloud Models' :
                        prov === 'openai' ? 'OpenAI Cloud Models' :
                        prov === 'gemini' ? 'Google Gemini Models' :
                        prov === 'deepseek' ? 'DeepSeek Models' :
                        prov === 'groq' ? 'Groq LPU Models' :
                        prov === 'openrouter' ? 'OpenRouter Catalog' : `${prov.toUpperCase()} Models`;

                      return (
                        <optgroup key={prov} label={provLabel}>
                          {provModels.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name || m.id} {m.isFree ? '(Zero Cost)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}

                    {/* 3. Custom Registered Models */}
                    {availableModels.filter((m) => m.provider === 'custom' || m.isCustom).length > 0 && (
                      <optgroup label="Custom User Models">
                        {availableModels
                          .filter((m) => m.provider === 'custom' || m.isCustom)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name || m.id} (Custom)
                            </option>
                          ))}
                      </optgroup>
                    )}

                    {/* 4. Active Model Fallback if not listed */}
                    {activeModelId &&
                      activeModelId !== 'inherit' &&
                      !availableModels.some((m) => m.id === activeModelId) &&
                      !ollamaStatus.models.some((m) => `ollama/${m}` === activeModelId) && (
                        <optgroup label="Active Selected Model">
                          <option value={activeModelId}>{activeModelId} (Active)</option>
                        </optgroup>
                      )}

                    <option value="inherit">inherit (Project Default)</option>
                  </select>

                  {/* Manual Model ID Assignment */}
                  <div className="pt-1 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-[#64748b]">
                      <span>Assign Any Model ID</span>
                      <span className="text-[9px] font-mono text-[#475569]">e.g. openai/gpt-4.5 or anthropic/claude-3-7-sonnet</span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="text"
                        placeholder="e.g. openai/gpt-4.5-preview"
                        value={customModelInput}
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        className="flex-1 bg-[#070b14] border border-[#1e293b] rounded px-2 py-1 text-[11px] text-kin-text font-mono placeholder-[#475569] focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!customModelInput.trim()) return;
                          const modelId = customModelInput.trim();
                          await addCustomModel(modelId);
                          setActiveModelId(modelId);
                          setCustomModelInput('');
                        }}
                        className="px-2.5 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono font-medium transition cursor-pointer whitespace-nowrap"
                      >
                        + Set Model
                      </button>
                    </div>
                  </div>

                  {/* Live Provider Models Discovery */}
                  <div className="pt-1 flex items-center justify-between text-[10px]">
                    <div className="flex items-center space-x-1 text-[#64748b]">
                      <span>Discover:</span>
                      <select
                        value={discoveryProvider}
                        onChange={(e) => setDiscoveryProvider(e.target.value)}
                        className="bg-[#070b14] border border-[#1e293b] rounded px-1.5 py-0.5 text-kin-text font-mono text-[10px] focus:outline-none"
                      >
                        <option value="openrouter">OpenRouter</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="gemini">Google Gemini</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="groq">Groq</option>
                        <option value="ollama">Local Ollama</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      disabled={isDiscovering || isLoadingModels}
                      onClick={async () => {
                        setIsDiscovering(true);
                        setDiscoveryFeedback(null);
                        const res = await discoverModels(discoveryProvider);
                        setIsDiscovering(false);
                        if (res.success) {
                          setDiscoveryFeedback(`Discovered ${res.count || 0} models!`);
                        } else {
                          setDiscoveryFeedback(res.error || 'Discovery failed');
                        }
                        setTimeout(() => setDiscoveryFeedback(null), 3000);
                      }}
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 font-mono transition cursor-pointer disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3 h-3 ${isDiscovering ? 'animate-spin' : ''}`} />
                      <span>{isDiscovering ? 'Querying...' : 'Fetch Models'}</span>
                    </button>
                  </div>
                  {discoveryFeedback && (
                    <div className="text-[10px] font-mono text-emerald-400 text-right">
                      {discoveryFeedback}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-[#64748b] uppercase tracking-wider">
                    Custom Specialist Instructions
                  </label>
                  <textarea
                    rows={4}
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-[#1e293b] rounded p-2 text-kin-text text-xs focus:outline-none focus:border-emerald-500 font-mono leading-relaxed resize-none"
                  />
                </div>

                <button
                  onClick={handleSaveContract}
                  className="w-full flex items-center justify-center space-x-1.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition text-xs shadow"
                >
                  {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{isSaved ? 'Contract Saved!' : 'Save Role Contract'}</span>
                </button>
              </div>
            ) : activeInspectorTab === 'Telemetry' ? (
              /* Sub-tab 2: Telemetry */
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-kin-text font-semibold text-[11px]">
                      <Activity className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Live Activity Telemetry</span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      LIVE
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="p-2 rounded bg-[#090d16] border border-[#1e293b]">
                      <div className="text-[#64748b] flex items-center space-x-1 mb-1">
                        <MessageSquare className="w-3 h-3 text-blue-400" />
                        <span>Messages</span>
                      </div>
                      <div className="text-base font-bold text-kin-text font-mono">
                        {currentAgent?.analytics?.messagesCount ?? 0}
                      </div>
                      <div className="text-[9px] text-[#64748b]">Total authored</div>
                    </div>

                    <div className="p-2 rounded bg-[#090d16] border border-[#1e293b]">
                      <div className="text-[#64748b] flex items-center space-x-1 mb-1">
                        <Zap className="w-3 h-3 text-amber-400" />
                        <span>Productivity</span>
                      </div>
                      <div className="text-base font-bold text-amber-300 font-mono">
                        +{currentAgent?.analytics?.avgProductivityScore ?? 0}
                      </div>
                      <div className="text-[9px] text-[#64748b]">Average pts/msg</div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-[11px] pt-1 border-t border-[#1e293b]">
                    <span className="text-[#64748b] flex items-center space-x-1">
                      <Clock className="w-3 h-3 text-[#64748b]" />
                      <span>Last Active</span>
                    </span>
                    <span className="font-mono text-kin-text text-[10px]">
                      {currentAgent?.analytics?.lastActiveAt
                        ? new Date(currentAgent.analytics.lastActiveAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : 'Active now'}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-kin-text font-semibold text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Task Execution</span>
                    </div>
                    <span className="text-[9px] font-mono text-blue-400">
                      {currentAgent?.analytics?.taskSuccessRate ?? 100}% Success
                    </span>
                  </div>

                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-[#64748b]">Assigned Tasks</span>
                      <span className="font-mono text-kin-text font-bold">
                        {currentAgent?.analytics?.completedTasksCount ?? 0} /{' '}
                        {currentAgent?.analytics?.assignedTasksCount ?? 0} completed
                      </span>
                    </div>

                    <div className="w-full bg-[#090d16] rounded-full h-1.5 overflow-hidden border border-[#1e293b]">
                      <div
                        className="bg-blue-500 h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${
                            currentAgent?.analytics?.assignedTasksCount
                              ? (currentAgent.analytics.completedTasksCount /
                                  currentAgent.analytics.assignedTasksCount) *
                                100
                              : 100
                          }%`,
                        }}
                      />
                    </div>

                    <div className="flex justify-between items-center pt-1 border-t border-[#1e293b]">
                      <span className="text-[#64748b]">Agent Execution Runs</span>
                      <span className="font-mono text-emerald-400 font-medium">
                        {currentAgent?.analytics?.agentRunsCount ?? 0} runs
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2">
                  <div className="flex items-center space-x-1.5 text-kin-text font-semibold text-[11px]">
                    <Cpu className="w-3.5 h-3.5 text-purple-400" />
                    <span>Governance & Resources</span>
                  </div>

                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between items-center py-0.5 border-b border-[#1e293b]">
                      <span className="text-[#64748b]">Active Model Engine</span>
                      <span className="font-mono text-emerald-400 font-medium">{activeModelId}</span>
                    </div>

                    <div className="flex justify-between items-center py-0.5 border-b border-[#1e293b]">
                      <span className="text-[#64748b]">Allocated Tokens</span>
                      <span className="font-mono text-kin-text">
                        {(currentAgent?.analytics?.allocatedTokens ?? 100000).toLocaleString()} max
                      </span>
                    </div>

                    <div className="flex justify-between items-center py-0.5 border-b border-[#1e293b]">
                      <span className="text-[#64748b]">Pending Action Gates</span>
                      <span
                        className={`font-mono font-bold ${
                          (currentAgent?.analytics?.pendingApprovalsCount ?? 0) > 0
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {currentAgent?.analytics?.pendingApprovalsCount ?? 0} pending
                      </span>
                    </div>

                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-[#64748b]">Workspace Jail</span>
                      <span className="text-purple-400 font-medium">Enforced ({activeProject?.name || 'KIN'})</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : activeInspectorTab === 'Teamwork' ? (
              /* Sub-tab 3: Teamwork (Workforce Collaboration & Readiness Matrix) */
              <div className="space-y-3 font-sans">
                {/* Project Pulse & Ollama Readiness Card */}
                <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-kin-text font-semibold text-[11px]">
                      <Users className="w-3.5 h-3.5 text-purple-400" />
                      <span>Workforce Pulse & Readiness</span>
                    </div>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                        ollamaStatus.online
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-red-500/10 text-red-400 border border-red-500/30'
                      }`}
                    >
                      {ollamaStatus.online ? `Ollama Online (${ollamaStatus.models.length} models)` : 'Ollama Offline'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="p-2 rounded bg-[#090d16] border border-[#1e293b]">
                      <div className="text-[#64748b]">Agents</div>
                      <div className="text-sm font-bold text-kin-text font-mono mt-0.5">{agents.length}</div>
                    </div>
                    <div className="p-2 rounded bg-[#090d16] border border-[#1e293b]">
                      <div className="text-[#64748b]">Goals</div>
                      <div className="text-sm font-bold text-kin-text font-mono mt-0.5">{goals.length}</div>
                    </div>
                    <div className="p-2 rounded bg-[#090d16] border border-[#1e293b]">
                      <div className="text-[#64748b]">Tasks Done</div>
                      <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                        {tasks.filter((t) => t.status === 'completed').length}/{tasks.length}
                      </div>
                    </div>
                  </div>

                  {/* Task Completion Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-[#64748b]">
                      <span>DAG Execution Progress</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {tasks.length > 0
                          ? Math.round(
                              (tasks.filter((t) => t.status === 'completed').length / tasks.length) * 100
                            )
                          : 100}
                        %
                      </span>
                    </div>
                    <div className="w-full bg-[#090d16] h-1.5 rounded-full overflow-hidden border border-[#1e293b]">
                      <div
                        className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${
                            tasks.length > 0
                              ? (tasks.filter((t) => t.status === 'completed').length / tasks.length) * 100
                              : 100
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex space-x-1 pt-1">
                    <button
                      data-testid="teamwork-post-matrix"
                      onClick={() => sendMessage('/teamwork-preview')}
                      className="flex-1 flex items-center justify-center space-x-1 py-1.5 rounded bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 text-[10px] font-semibold transition shadow cursor-pointer truncate"
                      title="Send /teamwork-preview command to active channel"
                    >
                      <Network className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="truncate">Post Matrix</span>
                    </button>
                    <button
                      data-testid="teamwork-run-pipeline"
                      onClick={() => sendMessage('/plan /boost /teamwork-preview')}
                      className="flex-1 flex items-center justify-center space-x-1 py-1.5 rounded bg-gradient-to-r from-emerald-500/20 via-blue-500/20 to-purple-500/20 hover:from-emerald-500/30 hover:via-blue-500/30 hover:to-purple-500/30 text-emerald-300 border border-emerald-500/40 text-[10px] font-semibold transition shadow cursor-pointer truncate"
                      title="Run Full Compound Pipeline (/plan /boost /teamwork-preview)"
                    >
                      <Zap className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="truncate">Run Pipeline</span>
                    </button>
                    <button
                      data-testid="teamwork-run-goal-pipeline"
                      onClick={() => sendMessage('/plan /boost /teamwork-preview /goal')}
                      className="flex-1 flex items-center justify-center space-x-1 py-1.5 rounded bg-gradient-to-r from-amber-500/20 via-emerald-500/20 to-cyan-500/20 hover:from-amber-500/30 hover:via-emerald-500/30 hover:to-cyan-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-semibold transition shadow cursor-pointer truncate"
                      title="Run 4-Tier Compound Goal Pipeline (/plan /boost /teamwork-preview /goal)"
                    >
                      <Target className="w-3 h-3 text-amber-400 shrink-0" />
                      <span className="truncate">+ Goal Pipeline</span>
                    </button>
                  </div>
                </div>

                {/* Agents Collaboration Matrix List */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] px-1">
                    Topology & Model Readiness ({agents.length})
                  </div>
                  {agents.map((ag) => {
                    const cleanModel = ag.activeModelId?.replace(/^ollama\//, '') || '';
                    const isInstalled =
                      ollamaStatus.online &&
                      ollamaStatus.models.some((m) => m === cleanModel || m.startsWith(cleanModel));
                    const badgeClass = !ollamaStatus.online
                      ? 'bg-red-500/10 text-red-400 border-red-500/30'
                      : isInstalled
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30';
                    const badgeText = !ollamaStatus.online
                      ? '🔴 Offline'
                      : isInstalled
                      ? '🟢 Ready'
                      : '🟡 Needs Pull';

                    return (
                      <div
                        key={ag.id}
                        className={`p-2.5 rounded-lg border transition space-y-1.5 ${
                          ag.id === selectedAgentId
                            ? 'bg-[#131b2e] border-blue-500/50'
                            : 'bg-[#0f172a] border-[#1e293b] hover:border-[#2d3748]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 truncate">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                ag.status === 'working' || ag.status === 'thinking'
                                  ? 'bg-amber-400 animate-pulse'
                                  : 'bg-emerald-400'
                              }`}
                            />
                            <span className="font-semibold text-kin-text text-xs">{ag.displayName}</span>
                            <span
                              className={`text-[9px] uppercase px-1 py-0.2 rounded font-mono font-bold border ${
                                ag.isOrchestrator
                                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                  : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                              }`}
                            >
                              {ag.isOrchestrator ? '👑 Orchestrator' : 'Specialist'}
                            </span>
                          </div>
                          <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${badgeClass}`}>
                            {badgeText}
                          </span>
                        </div>

                        <div className="text-[10px] text-[#94a3b8] flex items-center justify-between">
                          <span>{ag.role}</span>
                          <span className="font-mono text-[#cbd5e1]">{ag.activeModelId}</span>
                        </div>

                        {/* Assigned Channels */}
                        {ag.assignedChannels && ag.assignedChannels.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1 border-t border-[#1e293b]/60">
                            {ag.assignedChannels.map((cId) => {
                              const c = channels.find((ch) => ch.id === cId);
                              const name = c?.name || cId;
                              return (
                                <button
                                  key={cId}
                                  onClick={() => setActiveChannel(cId)}
                                  className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#090d16] text-[#94a3b8] hover:text-emerald-300 border border-[#1e293b] transition"
                                >
                                  #{name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : activeInspectorTab === 'Evaluations' ? (
              <div className="space-y-3 font-sans">
                {/* Header & Run Benchmark Eval Action */}
                <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-kin-text font-semibold text-[11px]">
                      <Award className="w-3.5 h-3.5 text-amber-400" />
                      <span>Formal Benchmark Rubric Evals</span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold">
                      {(agentEvaluations[currentAgent?.id] || []).length} Recorded
                    </span>
                  </div>

                  <p className="text-[10px] text-[#94a3b8] leading-relaxed">
                    Evaluates agent alignment against adversarial test cases, tool sandbox compliance, and verification grounding.
                  </p>

                  <button
                    onClick={() => runAgentEvaluation(currentAgent.id)}
                    disabled={evaluationsLoading}
                    className="w-full flex items-center justify-center space-x-1.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold font-mono transition shadow cursor-pointer disabled:opacity-40"
                  >
                    {evaluationsLoading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span>{evaluationsLoading ? 'Running Benchmark Evaluation...' : 'Run Benchmark Eval'}</span>
                  </button>
                </div>

                {/* Evaluations list */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] px-1">
                    Evaluation History
                  </div>

                  {(agentEvaluations[currentAgent?.id] || []).length > 0 ? (
                    (agentEvaluations[currentAgent?.id] || []).map((ev) => {
                      const score = ev.score ?? (ev.rubricScores ? ev.rubricScores.overall : 1);
                      const passed = ev.passed ?? (score >= 0.7);
                      const createdAt = ev.createdAt || ev.evaluatedAt || Date.now();
                      return (
                        <div
                          key={ev.id}
                          className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2 truncate">
                              <span className="font-semibold text-kin-text text-xs truncate">
                                {ev.testSuiteName || ev.benchmarkSuite || 'Rubric Benchmark'}
                              </span>
                            </div>
                            <span
                              className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded font-bold border ${
                                passed
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-red-500/10 text-red-400 border-red-500/30'
                              }`}
                            >
                              {passed ? 'PASSED' : 'FAILED'} ({score > 1 ? Math.round(score) : Math.round(score * 100)}%)
                            </span>
                          </div>

                          {/* Overall score bar */}
                          <div className="space-y-1">
                            <div className="w-full bg-[#090d16] h-1.5 rounded-full overflow-hidden border border-[#1e293b]">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  (score > 1 ? score / 100 : score) >= 0.8
                                    ? 'bg-emerald-500'
                                    : (score > 1 ? score / 100 : score) >= 0.6
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, score > 1 ? score : score * 100))}%` }}
                              />
                            </div>
                          </div>

                          {/* Rubric Breakdown */}
                          {ev.rubricMetrics && (
                            <div className="space-y-1 pt-1 border-t border-[#1e293b]/60 text-[10px]">
                              {Object.entries(ev.rubricMetrics).map(([metric, val]) => (
                                <div key={metric} className="flex justify-between items-center text-[#94a3b8] font-mono">
                                  <span className="capitalize">{metric.replace(/([A-Z])/g, ' $1')}</span>
                                  <span className="text-white font-bold">{Math.round((val as number) * 100)}%</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {ev.evaluatorNotes && (
                            <div className="p-2 rounded bg-[#090d16] text-[10px] text-[#cbd5e1] font-mono border border-[#1e293b]">
                              {ev.evaluatorNotes}
                            </div>
                          )}

                          <div className="text-[9px] text-[#64748b] text-right font-mono">
                            {new Date(createdAt).toLocaleString()}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-6 text-center text-[#64748b] border border-dashed border-[#1e293b] rounded-lg bg-[#0c1222]/30 space-y-1.5">
                      <Award className="w-6 h-6 mx-auto text-[#334155]" />
                      <div className="text-xs text-kin-text font-medium">No benchmark evaluations recorded yet</div>
                      <div className="text-[10px]">Run a formal evaluation above to assess precision, safety, and rubric scores.</div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Sub-tab 5: Credentials (BYOK) */
              <div className="space-y-3 font-sans">
                {/* Header & Add Credential Button */}
                <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-kin-text font-semibold text-[11px]">
                      <Key className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Managed Credentials (BYOK)</span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                      {credentials.length} Active Key{credentials.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <p className="text-[10px] text-[#94a3b8] leading-relaxed">
                    Bring-Your-Own-Key provider store with HMAC-SHA256 zero-leak vault, capability grants, and token spend quotas.
                  </p>

                  <button
                    onClick={() => setShowAddKeyModal(!showAddKeyModal)}
                    className="w-full flex items-center justify-center space-x-1.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold font-mono transition shadow cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{showAddKeyModal ? 'Cancel' : '+ Add Provider Key'}</span>
                  </button>
                </div>

                {/* Add Key Form */}
                {showAddKeyModal && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!credAlias.trim() || !credSecret.trim()) return;
                      setCredSubmitting(true);
                      await addCredential({
                        provider: credProvider,
                        keyAlias: credAlias.trim(),
                        secret: credSecret.trim(),
                        scopedGrants: credGrants,
                        maxSpendTokens: parseInt(credMaxTokens, 10) || 500000,
                      });
                      setCredSubmitting(false);
                      setCredAlias('');
                      setCredSecret('');
                      setShowAddKeyModal(false);
                    }}
                    className="p-3 rounded-lg bg-[#0c1222] border border-emerald-500/40 space-y-2.5 animate-fadeIn"
                  >
                    <div className="text-[11px] font-bold text-emerald-300 font-mono flex items-center space-x-1">
                      <Lock className="w-3 h-3 text-emerald-400" />
                      <span>Register Provider Credential</span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-[#64748b] uppercase">Provider</label>
                      <select
                        value={credProvider}
                        onChange={(e) => setCredProvider(e.target.value)}
                        className="w-full bg-[#070b14] border border-[#1e293b] rounded px-2 py-1 text-xs text-kin-text focus:outline-none focus:border-emerald-500 font-mono"
                      >
                        <option value="anthropic">Anthropic (Claude 3.7 / 3.5 Sonnet)</option>
                        <option value="openai">OpenAI (GPT-4o / o3-mini)</option>
                        <option value="gemini">Google Gemini (Gemini 2.5 Pro / Flash)</option>
                        <option value="deepseek">DeepSeek (DeepSeek V3 / R1)</option>
                        <option value="mistral">Mistral AI</option>
                        <option value="groq">Groq (LPU Ultra-Fast)</option>
                        <option value="openrouter">OpenRouter Gateway</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-[#64748b] uppercase">Key Alias</label>
                      <input
                        type="text"
                        placeholder="e.g. anthropic-production-primary"
                        value={credAlias}
                        onChange={(e) => setCredAlias(e.target.value)}
                        className="w-full bg-[#070b14] border border-[#1e293b] rounded px-2 py-1 text-xs text-kin-text focus:outline-none focus:border-emerald-500 font-mono"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-[#64748b] uppercase">Secret Key Value</label>
                      <input
                        type="password"
                        placeholder="sk-ant-... or sk-..."
                        value={credSecret}
                        onChange={(e) => setCredSecret(e.target.value)}
                        className="w-full bg-[#070b14] border border-[#1e293b] rounded px-2 py-1 text-xs text-kin-text focus:outline-none focus:border-emerald-500 font-mono"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-[#64748b] uppercase">Max Spend Tokens</label>
                      <input
                        type="number"
                        value={credMaxTokens}
                        onChange={(e) => setCredMaxTokens(e.target.value)}
                        className="w-full bg-[#070b14] border border-[#1e293b] rounded px-2 py-1 text-xs text-kin-text focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-[#64748b] uppercase">Scoped Grants</label>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {['tools:read', 'tools:exec', 'models:fast', 'models:reasoning'].map((grant) => {
                          const hasGrant = credGrants.includes(grant);
                          return (
                            <button
                              key={grant}
                              type="button"
                              onClick={() => {
                                setCredGrants((prev) =>
                                  hasGrant ? prev.filter((g) => g !== grant) : [...prev, grant]
                                );
                              }}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono border transition cursor-pointer ${
                                hasGrant
                                  ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 font-bold'
                                  : 'bg-[#070b14] text-[#64748b] border-[#1e293b]'
                              }`}
                            >
                              {grant}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={credSubmitting || !credAlias.trim() || !credSecret.trim()}
                      className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold transition shadow disabled:opacity-40 cursor-pointer"
                    >
                      {credSubmitting ? 'Storing Safely...' : 'Save & Secure Key'}
                    </button>
                  </form>
                )}

                {/* Credentials List */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] px-1">
                    Configured Keys ({credentials.length})
                  </div>

                  {credentials.length > 0 ? (
                    credentials.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 min-w-0 pr-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            <span className="font-semibold text-kin-text text-xs truncate">
                              {c.keyAlias || c.keyName || 'Provider Key'}
                            </span>
                            <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono font-bold border border-blue-500/30">
                              {c.provider}
                            </span>
                          </div>
                          <button
                            onClick={() => deleteCredential(c.id)}
                            className="p-1 text-[#64748b] hover:text-red-400 transition cursor-pointer shrink-0"
                            title="Delete credential"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Token Budget Usage */}
                        {(() => {
                          const currentTokens = c.currentSpendTokens ?? c.usedTokens ?? 0;
                          const maxTokens = c.maxSpendTokens ?? c.monthlyQuotaTokens ?? 500000;
                          const grants = c.scopedGrants ?? c.scopedAgentIds ?? [];
                          return (
                            <>
                              <div className="space-y-1">
                                <div className="flex justify-between text-[10px] font-mono text-[#94a3b8]">
                                  <span>Token Budget</span>
                                  <span>
                                    {currentTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
                                  </span>
                                </div>
                                <div className="w-full bg-[#090d16] h-1.5 rounded-full overflow-hidden border border-[#1e293b]">
                                  <div
                                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${Math.min(100, (currentTokens / Math.max(1, maxTokens)) * 100)}%`,
                                    }}
                                  />
                                </div>
                              </div>

                              {/* Scoped Grants */}
                              {grants.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1 border-t border-[#1e293b]/60">
                                  {grants.map((grant: string) => (
                                    <span
                                      key={grant}
                                      className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#090d16] text-[#cbd5e1] border border-[#1e293b]"
                                    >
                                      {grant}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-center text-[#64748b] border border-dashed border-[#1e293b] rounded-lg bg-[#0c1222]/30 space-y-1.5">
                      <Key className="w-6 h-6 mx-auto text-[#334155]" />
                      <div className="text-xs text-kin-text font-medium">No provider keys registered</div>
                      <div className="text-[10px]">Add your personal Claude, OpenAI, or Gemini keys to unlock frontier execution.</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
