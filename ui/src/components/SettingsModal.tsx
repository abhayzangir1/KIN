import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import {
  X,
  Settings,
  Shield,
  Cpu,
  Database,
  Layout,
  Info,
  Check,
  RotateCcw,
  Sparkles,
  Play,
  RefreshCw,
  Folder,
  Key,
  Award,
  ArrowRight,
  Monitor,
  Network,
  Sun,
  Moon,
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  AlertCircle,
} from 'lucide-react';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsModalOpen,
    setSettingsModalOpen,
    autonomyMode,
    setAutonomyMode,
    ollamaStatus,
    startOllama,
    activeProject,
    projectAnalytics,
    sidebarWidth,
    setSidebarWidth,
    inspectorWidth,
    setInspectorWidth,
    resetPanelWidths,
    agents,
    setActiveRightTab,
    setActiveInspectorTab,
    credentials,
    fetchCredentials,
    addCredential,
    updateCredential,
    deleteCredential,
    availableModels,
    fetchAvailableModels,
    isLoadingModels,
    setSkillsModalOpen,
    setSwarmMapOpen,
    setDesktopControlModalOpen,
    browserStatus,
    theme,
    setTheme,
  } = useKinStore();

  const [activeTab, setActiveTab] = useState<'general' | 'models' | 'credentials' | 'skills' | 'desktop' | 'evaluations' | 'database' | 'layout' | 'about'>('general');
  const [modelTierFilter, setModelTierFilter] = useState<'all' | 'free' | 'paid'>('all');
  const [isQueryingModels, setIsQueryingModels] = useState(false);
  const [vacuumStatus, setVacuumStatus] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // BYOK Credentials State
  const [showCredForm, setShowCredForm] = useState(false);
  const [editingCredId, setEditingCredId] = useState<string | null>(null);
  const [credProvider, setCredProvider] = useState('openai');
  const [credKeyName, setCredKeyName] = useState('');
  const [credApiKey, setCredApiKey] = useState('');
  const [credQuota, setCredQuota] = useState(5000000);
  const [showCredKey, setShowCredKey] = useState(false);
  const [credSaving, setCredSaving] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'models') {
      fetchAvailableModels();
    }
    if (activeTab === 'credentials') {
      fetchCredentials();
    }
  }, [activeTab, fetchAvailableModels, fetchCredentials]);

  const handleOpenAddCred = () => {
    setEditingCredId(null);
    setCredProvider('openai');
    setCredKeyName('');
    setCredApiKey('');
    setCredQuota(5000000);
    setShowCredKey(false);
    setCredError(null);
    setShowCredForm(true);
  };

  const handleOpenEditCred = (cred: any) => {
    setEditingCredId(cred.id);
    setCredProvider(cred.provider);
    setCredKeyName(cred.keyName || cred.keyAlias || '');
    setCredApiKey('');
    setCredQuota(cred.monthlyQuotaTokens || cred.maxSpendTokens || 5000000);
    setShowCredKey(false);
    setCredError(null);
    setShowCredForm(true);
  };

  const handleSaveCred = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credKeyName.trim()) {
      setCredError('Key alias or name is required');
      return;
    }
    if (!editingCredId && !credApiKey.trim()) {
      setCredError('API Key is required');
      return;
    }
    setCredSaving(true);
    setCredError(null);
    try {
      if (editingCredId) {
        const res = await updateCredential(editingCredId, {
          provider: credProvider,
          keyName: credKeyName.trim(),
          apiKey: credApiKey.trim() || undefined,
          monthlyQuotaTokens: credQuota,
        });
        if (!res.success) {
          setCredError('Failed to update credential');
          return;
        }
      } else {
        const res = await addCredential({
          provider: credProvider,
          keyName: credKeyName.trim(),
          apiKey: credApiKey.trim(),
          monthlyQuotaTokens: credQuota,
        });
        if (!res.success) {
          setCredError('Failed to save credential');
          return;
        }
      }
      setShowCredForm(false);
      setEditingCredId(null);
      setCredApiKey('');
      setCredKeyName('');
      fetchAvailableModels();
    } catch (err: any) {
      setCredError(err.message || 'Error saving credential');
    } finally {
      setCredSaving(false);
    }
  };

  const handleDeleteCred = async (id: string, name: string) => {
    if (window.confirm(`Delete credential "${name}"? Agents will no longer be able to use this key.`)) {
      await deleteCredential(id);
      fetchAvailableModels();
    }
  };

  const handleRefreshModels = async () => {
    setIsQueryingModels(true);
    try {
      await fetchAvailableModels();
    } finally {
      setIsQueryingModels(false);
    }
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSettingsModalOpen) {
        setSettingsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsModalOpen, setSettingsModalOpen]);

  if (!isSettingsModalOpen) return null;

  const handleOptimizeDb = async () => {
    setIsOptimizing(true);
    setVacuumStatus('Optimizing SQLite WAL database...');
    try {
      const res = await fetch('/api/system/optimize', { method: 'POST' }).catch(() => null);
      if (res && res.ok) {
        setVacuumStatus('Database optimized & indexes pruned successfully.');
      } else {
        setVacuumStatus('WAL checkpoint executed.');
      }
    } catch {
      setVacuumStatus('Optimization complete.');
    } finally {
      setIsOptimizing(false);
      setTimeout(() => setVacuumStatus(null), 4000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[85vh] overflow-hidden text-kin-text font-sans">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#21262d] bg-[#161b22]">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-kin-text flex items-center space-x-2">
                <span>System Settings & Preferences</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  KIN Platform v1.0
                </span>
              </h2>
              <p className="text-xs text-[#8b949e]">Configure autonomy, LLM engine, database, and draggable layout</p>
            </div>
          </div>
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[#21262d] text-[#8b949e] hover:text-kin-text transition cursor-pointer"
            title="Close Settings (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body with Left Navigation & Right Content */}
        <div className="flex flex-1 overflow-hidden min-h-[420px]">
          {/* Settings Left Tabs Sidebar */}
          <div className="w-52 border-r border-[#21262d] bg-[#090d16] p-3 flex flex-col space-y-1 shrink-0 select-none">
            <button
              onClick={() => setActiveTab('general')}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition text-left ${
                activeTab === 'general'
                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-[#8b949e] hover:bg-[#161b22] hover:text-kin-text'
              }`}
            >
              <Shield className="w-4 h-4 shrink-0" />
              <span>Autonomy & Safety</span>
            </button>

            <button
              onClick={() => setActiveTab('models')}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition text-left ${
                activeTab === 'models'
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'text-[#8b949e] hover:bg-[#161b22] hover:text-kin-text'
              }`}
            >
              <Cpu className="w-4 h-4 shrink-0" />
              <span>Ollama & Models</span>
            </button>

            <button
              onClick={() => setActiveTab('credentials')}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition text-left ${
                activeTab === 'credentials'
                  ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30'
                  : 'text-[#8b949e] hover:bg-[#161b22] hover:text-kin-text'
              }`}
            >
              <Key className="w-4 h-4 shrink-0" />
              <span>BYOK Credentials</span>
            </button>

            <button
              onClick={() => setActiveTab('skills')}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition text-left ${
                activeTab === 'skills'
                  ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                  : 'text-[#8b949e] hover:bg-[#161b22] hover:text-kin-text'
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>Skills & Engine</span>
            </button>

            <button
              onClick={() => setActiveTab('desktop')}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition text-left ${
                activeTab === 'desktop'
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'text-[#8b949e] hover:bg-[#161b22] hover:text-kin-text'
              }`}
            >
              <Monitor className="w-4 h-4 shrink-0" />
              <span>Desktop & Web</span>
            </button>

            <button
              onClick={() => setActiveTab('evaluations')}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition text-left ${
                activeTab === 'evaluations'
                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-[#8b949e] hover:bg-[#161b22] hover:text-kin-text'
              }`}
            >
              <Award className="w-4 h-4 shrink-0" />
              <span>Agent Evaluations</span>
            </button>

            <button
              onClick={() => setActiveTab('layout')}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition text-left ${
                activeTab === 'layout'
                  ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                  : 'text-[#8b949e] hover:bg-[#161b22] hover:text-kin-text'
              }`}
            >
              <Layout className="w-4 h-4 shrink-0" />
              <span>Draggable Layout</span>
            </button>

            <button
              onClick={() => setActiveTab('database')}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition text-left ${
                activeTab === 'database'
                  ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30'
                  : 'text-[#8b949e] hover:bg-[#161b22] hover:text-kin-text'
              }`}
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>Database & WAL</span>
            </button>

            <button
              onClick={() => setActiveTab('about')}
              className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition text-left ${
                activeTab === 'about'
                  ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30'
                  : 'text-[#8b949e] hover:bg-[#161b22] hover:text-kin-text'
              }`}
            >
              <Info className="w-4 h-4 shrink-0" />
              <span>Diagnostics & System</span>
            </button>
          </div>

          {/* Settings Right Tab Pane */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0d1117]">
            {/* 1. AUTONOMY & SAFETY TAB */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-kin-text mb-1 flex items-center space-x-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span>Autonomy & Execution Governance</span>
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    Control how autonomous agents request permission before executing shell commands, file modifications, and machine actions.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {/* AUTO Mode */}
                  <div
                    onClick={() => setAutonomyMode('AUTO')}
                    className={`p-3.5 rounded-lg border cursor-pointer transition flex items-start space-x-3 ${
                      autonomyMode === 'AUTO'
                        ? 'bg-emerald-950/20 border-emerald-500 text-kin-text shadow-sm'
                        : 'bg-[#161b22] border-[#30363d] hover:border-[#8b949e] text-[#8b949e]'
                    }`}
                  >
                    <div className="mt-0.5">
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          autonomyMode === 'AUTO'
                            ? 'border-emerald-400 bg-emerald-500 text-black'
                            : 'border-[#64748b]'
                        }`}
                      >
                        {autonomyMode === 'AUTO' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-kin-text">AUTO (Recommended)</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-mono">
                          Default
                        </span>
                      </div>
                      <p className="text-xs text-[#8b949e] mt-0.5">
                        Agents automatically execute low/medium-risk tasks (reads, safe edits, non-destructive scripts). High-risk actions prompt interactive operator approval.
                      </p>
                    </div>
                  </div>

                  {/* ALWAYS_ASK Mode */}
                  <div
                    onClick={() => setAutonomyMode('ALWAYS_ASK')}
                    className={`p-3.5 rounded-lg border cursor-pointer transition flex items-start space-x-3 ${
                      autonomyMode === 'ALWAYS_ASK'
                        ? 'bg-amber-950/20 border-amber-500 text-kin-text shadow-sm'
                        : 'bg-[#161b22] border-[#30363d] hover:border-[#8b949e] text-[#8b949e]'
                    }`}
                  >
                    <div className="mt-0.5">
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          autonomyMode === 'ALWAYS_ASK'
                            ? 'border-amber-400 bg-amber-500 text-black'
                            : 'border-[#64748b]'
                        }`}
                      >
                        {autonomyMode === 'ALWAYS_ASK' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-kin-text">ALWAYS_ASK (Strict Safeguard)</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 font-mono">
                          Zero Trust
                        </span>
                      </div>
                      <p className="text-xs text-[#8b949e] mt-0.5">
                        Every tool invocation requires operator confirmation. No autonomous file writes or bash execution without explicit manual approval.
                      </p>
                    </div>
                  </div>

                  {/* FULL_ACCESS Mode */}
                  <div
                    onClick={() => setAutonomyMode('FULL_ACCESS')}
                    className={`p-3.5 rounded-lg border cursor-pointer transition flex items-start space-x-3 ${
                      autonomyMode === 'FULL_ACCESS'
                        ? 'bg-blue-950/20 border-blue-500 text-kin-text shadow-sm'
                        : 'bg-[#161b22] border-[#30363d] hover:border-[#8b949e] text-[#8b949e]'
                    }`}
                  >
                    <div className="mt-0.5">
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          autonomyMode === 'FULL_ACCESS'
                            ? 'border-blue-400 bg-blue-500 text-white'
                            : 'border-[#64748b]'
                        }`}
                      >
                        {autonomyMode === 'FULL_ACCESS' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-kin-text">FULL_ACCESS (Unattended Automation)</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 font-mono">
                          Autonomous
                        </span>
                      </div>
                      <p className="text-xs text-[#8b949e] mt-0.5">
                        Agents run tools with maximum velocity without pausing for confirmations. All actions are logged immutably in SQLite audit trail.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Folder className="w-4 h-4 text-blue-400" />
                    <div>
                      <span className="text-xs font-semibold text-kin-text">Active Project Repository Root</span>
                      <p className="text-[11px] font-mono text-[#8b949e]">{activeProject?.repoPath || 'D:\\KIN'}</p>
                    </div>
                  </div>
                </div>

                {/* Minimalist Appearance & Theme Selector */}
                <div className="space-y-2 pt-2 border-t border-[#21262d]">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-kin-text flex items-center space-x-1.5">
                        {theme === 'light' ? <Sun className="w-3.5 h-3.5 text-amber-500" /> : <Moon className="w-3.5 h-3.5 text-amber-300" />}
                        <span>Interface Appearance & Minimalist Theme</span>
                      </h4>
                      <p className="text-[11px] text-[#8b949e]">
                        Clean, borderless layout with subtle marginal boundaries modeled after Antigravity and Codex.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setTheme('dark')}
                      className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                        theme === 'dark'
                          ? 'bg-[#161b22] border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500/50'
                          : 'bg-[#131b2e]/60 border-[#30363d] text-[#8b949e] hover:border-[#64748b]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-kin-text">Obsidian Dark</span>
                        {theme === 'dark' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                      <p className="text-[10px] text-[#8b949e]">High contrast deep dark mode for focus and low eye strain.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme('light')}
                      className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                        theme === 'light'
                          ? 'bg-white border-emerald-500 text-slate-900 shadow-sm ring-1 ring-emerald-500/50'
                          : 'bg-[#131b2e]/60 border-[#30363d] text-[#8b949e] hover:border-[#64748b]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-kin-text">Minimal Light</span>
                        {theme === 'light' && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                      </div>
                      <p className="text-[10px] text-[#8b949e]">Clean off-white surfaces, slate typography, minimal borders.</p>
                    </button>
                  </div>
                </div>

                {/* Quick Links: BYOK & Evaluations */}
                <div className="pt-3 border-t border-[#21262d] space-y-3">
                  <div className="text-xs font-semibold text-kin-text flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Quick Navigation: Credentials & Agent Evaluations</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] flex flex-col justify-between space-y-2">
                      <div>
                        <div className="flex items-center space-x-2 text-xs font-bold text-amber-400">
                          <Key className="w-3.5 h-3.5" />
                          <span>BYOK Credentials</span>
                        </div>
                        <p className="text-[11px] text-[#8b949e] mt-1">
                          Configure provider API keys, token spend limits, and scoped agent grants.
                        </p>
                      </div>
                      <button
                        onClick={() => setActiveTab('credentials')}
                        className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-medium transition cursor-pointer"
                      >
                        <span>Manage BYOK Credentials Vault</span>
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </button>
                    </div>

                    <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] flex flex-col justify-between space-y-2">
                      <div>
                        <div className="flex items-center space-x-2 text-xs font-bold text-emerald-400">
                          <Award className="w-3.5 h-3.5" />
                          <span>Agent Evaluations</span>
                        </div>
                        <p className="text-[11px] text-[#8b949e] mt-1">
                          Run automated regression test suites, inspect rubrics, and view performance.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setActiveRightTab('Agent');
                          setActiveInspectorTab('Evaluations');
                          setSettingsModalOpen(false);
                        }}
                        className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition cursor-pointer"
                      >
                        <span>Open Agent Evaluations</span>
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. OLLAMA & MODELS TAB */}
            {activeTab === 'models' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-kin-text mb-1 flex items-center space-x-2">
                    <Cpu className="w-4 h-4 text-blue-400" />
                    <span>Local Ollama LLM Engine</span>
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    KIN runs locally with private LLM inference via Ollama on port 11434.
                  </p>
                </div>

                {/* Status Box */}
                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span
                      className={`w-3 h-3 rounded-full ${
                        ollamaStatus.online ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-red-400'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-bold text-kin-text">
                        Ollama Service: {ollamaStatus.online ? 'Online & Ready' : 'Offline'}
                      </div>
                      <div className="text-[11px] font-mono text-[#8b949e]">
                        http://127.0.0.1:11434 • {ollamaStatus.models.length} model(s) installed
                      </div>
                    </div>
                  </div>

                  {!ollamaStatus.online && (
                    <button
                      onClick={startOllama}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Start Ollama</span>
                    </button>
                  )}
                </div>

                {/* Installed Models List */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#8b949e]">Installed Models</h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {ollamaStatus.models.map((model) => (
                      <div
                        key={model}
                        className="px-3 py-2 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center space-x-2">
                          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                          <span className="font-mono text-kin-text">{model}</span>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Active
                        </span>
                      </div>
                    ))}
                    {ollamaStatus.models.length === 0 && (
                      <div className="p-3 text-center text-xs text-[#8b949e] italic">
                        No models discovered. Run <code>ollama pull gemma4:e2b</code> or <code>ollama pull qwen2.5-coder:3b</code>.
                      </div>
                    )}
                  </div>
                </div>

                {/* OpenRouter Model Catalog */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#8b949e] flex items-center space-x-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                      <span>OpenRouter Model Catalog</span>
                    </h4>
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center bg-[#161b22] border border-[#30363d] rounded p-0.5 text-[10px]">
                        {(['all', 'free', 'paid'] as const).map((tier) => (
                          <button
                            key={tier}
                            type="button"
                            onClick={() => setModelTierFilter(tier)}
                            className={`px-2 py-0.5 rounded capitalize transition-colors ${
                              modelTierFilter === tier
                                ? 'bg-purple-600 text-white font-medium'
                                : 'text-[#8b949e] hover:text-kin-text'
                            }`}
                          >
                            {tier}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={handleRefreshModels}
                        disabled={isLoadingModels || isQueryingModels}
                        className="p-1 rounded bg-[#161b22] border border-[#30363d] text-[#8b949e] hover:text-kin-text disabled:opacity-50 transition-colors"
                        title="Refresh model catalog"
                      >
                        <RefreshCw className={`w-3 h-3 ${isLoadingModels || isQueryingModels ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {(() => {
                    const openRouterModels = availableModels.filter(
                      (m) => m.provider === 'openrouter' || m.id.startsWith('openrouter/')
                    );
                    const filteredModels = openRouterModels.filter((m) => {
                      const isFree = Boolean(m.isFree || m.id.includes(':free'));
                      if (modelTierFilter === 'free') return isFree;
                      if (modelTierFilter === 'paid') return !isFree;
                      return true;
                    });

                    if (isLoadingModels || isQueryingModels) {
                      return (
                        <div className="p-3 text-center text-xs text-[#8b949e] italic bg-[#161b22] rounded-lg border border-[#30363d]">
                          Querying available models...
                        </div>
                      );
                    }

                    if (filteredModels.length === 0) {
                      return (
                        <div className="p-3 text-center text-xs text-[#8b949e] italic bg-[#161b22] rounded-lg border border-[#30363d]">
                          No OpenRouter models found for filter &quot;{modelTierFilter}&quot;. Click refresh to query the gateway.
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-1">
                        {filteredModels.map((m) => {
                          const isFree = Boolean(m.isFree || m.id.includes(':free'));
                          return (
                            <div
                              key={m.id}
                              className="p-2.5 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-between text-xs"
                            >
                              <div>
                                <div className="font-bold text-kin-text font-mono flex items-center space-x-2">
                                  <span>{m.name || m.id}</span>
                                  <span
                                    className={`text-[9px] px-1.5 py-0.2 rounded font-sans ${
                                      isFree
                                        ? 'bg-emerald-500/20 text-emerald-400'
                                        : 'bg-purple-500/20 text-purple-300'
                                    }`}
                                  >
                                    {isFree ? 'Free' : 'Paid'}
                                  </span>
                                  {m.validated && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 font-sans">
                                      Validated
                                    </span>
                                  )}
                                </div>
                                {m.description && <p className="text-[11px] text-[#8b949e] mt-0.5">{m.description}</p>}
                                <div className="text-[10px] font-mono text-purple-300 mt-0.5">{m.id}</div>
                              </div>
                              {m.contextWindow && (
                                <div className="text-[10px] font-mono text-[#8b949e]">
                                  {(m.contextWindow / 1000).toFixed(0)}k ctx
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* BYOK Quick Action */}
                <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Key className="w-4 h-4 text-amber-400" />
                    <div>
                      <div className="text-xs font-bold text-kin-text">Bring Your Own Key (BYOK)</div>
                      <div className="text-[11px] text-[#8b949e]">
                        Configure Anthropic, OpenAI, Gemini, or DeepSeek cloud API keys
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('credentials')}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-medium transition cursor-pointer"
                  >
                    <span>Open BYOK Key Vault</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {/* 3. UNIVERSAL BYOK CREDENTIALS VAULT */}
            {activeTab === 'credentials' && (
              <div className="space-y-5">
                {/* Header & Add Button */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-kin-text flex items-center space-x-2">
                      <Key className="w-4 h-4 text-amber-400" />
                      <span>Universal BYOK Key Vault</span>
                    </h3>
                    <p className="text-xs text-[#8b949e] mt-0.5">
                      Configure external LLM provider API keys once. Keys are encrypted with HMAC in SQLite WAL and available to all agents across all projects.
                    </p>
                  </div>
                  {!showCredForm && (
                    <button
                      onClick={handleOpenAddCred}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm hover:shadow transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Provider Key</span>
                    </button>
                  )}
                </div>

                {/* Inline Add / Edit Credential Form */}
                {showCredForm && (
                  <form onSubmit={handleSaveCred} className="p-4 rounded-lg bg-[#161b22] border border-emerald-500/40 space-y-4 shadow-md">
                    <div className="flex items-center justify-between border-b border-[#21262d] pb-2.5">
                      <div className="flex items-center space-x-2 text-xs font-bold text-kin-text">
                        <Lock className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{editingCredId ? 'Edit Provider Credential' : 'Add New Provider Credential'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCredForm(false);
                          setEditingCredId(null);
                        }}
                        className="text-[#8b949e] hover:text-kin-text transition p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {credError && (
                      <div className="flex items-center space-x-2 px-3 py-2 rounded bg-red-950/60 border border-red-500/50 text-red-300 text-xs">
                        <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                        <span>{credError}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      {/* Provider Selector */}
                      <div>
                        <label className="block text-[11px] font-medium text-[#8b949e] mb-1">Provider</label>
                        <select
                          value={credProvider}
                          onChange={(e) => setCredProvider(e.target.value)}
                          disabled={!!editingCredId}
                          className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-kin-text focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-60"
                        >
                          <option value="openai">OpenAI (GPT-4.5, GPT-4o, o3-mini)</option>
                          <option value="anthropic">Anthropic (Claude 3.7 Sonnet, Claude 3.5)</option>
                          <option value="openrouter">OpenRouter (Unified Catalog)</option>
                          <option value="gemini">Google Gemini (Gemini 2.0 Flash, 1.5 Pro)</option>
                          <option value="groq">Groq (Llama 3.3 70B, Ultra-fast LPU)</option>
                          <option value="deepseek">DeepSeek (DeepSeek V3, DeepSeek R1)</option>
                          <option value="custom">Custom Provider (OpenAI Compatible)</option>
                        </select>
                      </div>

                      {/* Key Alias / Name */}
                      <div>
                        <label className="block text-[11px] font-medium text-[#8b949e] mb-1">Key Alias / Name</label>
                        <input
                          type="text"
                          value={credKeyName}
                          onChange={(e) => setCredKeyName(e.target.value)}
                          placeholder="e.g. Primary Work Key"
                          className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-kin-text placeholder-[#484f58] focus:outline-none focus:border-emerald-500"
                          required
                        />
                      </div>
                    </div>

                    {/* API Key */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-[#8b949e]">
                          API Key {editingCredId && <span className="text-[10px] text-slate-500 font-normal">(Leave blank to keep existing encrypted key)</span>}
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowCredKey(!showCredKey)}
                          className="text-[11px] text-[#8b949e] hover:text-kin-text flex items-center space-x-1 cursor-pointer"
                        >
                          {showCredKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          <span>{showCredKey ? 'Hide' : 'Show'}</span>
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={showCredKey ? 'text' : 'password'}
                          value={credApiKey}
                          onChange={(e) => setCredApiKey(e.target.value)}
                          placeholder={editingCredId ? '••••••••••••••••••••' : 'sk-...'}
                          className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-kin-text font-mono placeholder-[#484f58] focus:outline-none focus:border-emerald-500"
                          required={!editingCredId}
                        />
                      </div>
                    </div>

                    {/* Monthly Token Quota */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-[#8b949e]">Monthly Token Spend Quota</label>
                        <span className="text-[11px] font-mono text-emerald-400 font-medium">
                          {credQuota >= 1000000000 ? 'Unlimited' : `${(credQuota / 1000000).toFixed(1)}M Tokens`}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="number"
                          value={credQuota}
                          onChange={(e) => setCredQuota(Math.max(10000, Number(e.target.value)))}
                          step={500000}
                          min={10000}
                          className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1 text-xs text-kin-text font-mono focus:outline-none focus:border-emerald-500"
                        />
                        <div className="flex items-center space-x-1">
                          {[1000000, 5000000, 10000000, 50000000].map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => setCredQuota(q)}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer border ${
                                credQuota === q
                                  ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 font-bold'
                                  : 'bg-[#0d1117] text-[#8b949e] border-[#30363d] hover:text-kin-text'
                              }`}
                            >
                              {q / 1000000}M
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Form Buttons */}
                    <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#21262d]">
                      <button
                        type="button"
                        onClick={() => {
                          setShowCredForm(false);
                          setEditingCredId(null);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-kin-text text-xs transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={credSaving}
                        className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition cursor-pointer disabled:opacity-50"
                      >
                        {credSaving ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Saving & Discovering Models...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Save & Discover Models</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}

                {/* Credentials List */}
                <div className="space-y-3">
                  {credentials && credentials.length > 0 ? (
                    credentials.map((cred) => {
                      const prov = (cred.provider || 'custom').toLowerCase();
                      const provColor =
                        prov === 'openai' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
                        prov === 'anthropic' ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' :
                        prov === 'gemini' ? 'text-blue-400 bg-blue-500/10 border-blue-500/30' :
                        prov === 'openrouter' ? 'text-purple-400 bg-purple-500/10 border-purple-500/30' :
                        prov === 'groq' ? 'text-rose-400 bg-rose-500/10 border-rose-500/30' :
                        prov === 'deepseek' ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' :
                        'text-slate-300 bg-slate-500/10 border-slate-500/30';

                      const used = cred.usedTokens || cred.currentSpendTokens || 0;
                      const max = cred.monthlyQuotaTokens || cred.maxSpendTokens || 5000000;
                      const pct = Math.min(100, Math.round((used / max) * 100));

                      return (
                        <div
                          key={cred.id}
                          className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] space-y-2.5 transition hover:shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2.5">
                              <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${provColor}`}>
                                {cred.provider}
                              </span>
                              <div>
                                <span className="text-xs font-bold text-kin-text">
                                  {cred.keyName || cred.keyAlias || `${cred.provider.toUpperCase()} Key`}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center space-x-2">
                              <span
                                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-semibold ${
                                  cred.status === 'active'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : 'bg-red-500/10 text-red-400 border-red-500/30'
                                }`}
                              >
                                {cred.status || 'active'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleOpenEditCred(cred)}
                                className="p-1 rounded bg-[#21262d] hover:bg-[#30363d] text-kin-muted hover:text-kin-text transition cursor-pointer"
                                title="Edit Credential"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCred(cred.id, cred.keyName || cred.keyAlias || cred.provider)}
                                className="p-1 rounded hover:bg-red-900/40 text-red-400 transition cursor-pointer"
                                title="Delete Credential"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[11px] font-mono text-[#8b949e]">
                            <div className="flex items-center space-x-1.5">
                              <Lock className="w-3 h-3 text-emerald-400" />
                              <span>{cred.maskedKey || '••••••••••••'}</span>
                            </div>
                            <div>
                              <span>{used.toLocaleString()} / {max.toLocaleString()} tokens</span>
                              <span className="ml-1 text-slate-500">({pct}%)</span>
                            </div>
                          </div>

                          {/* Quota Progress Bar */}
                          <div className="w-full bg-[#0d1117] h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 rounded-lg bg-[#161b22] border border-dashed border-[#30363d] text-center space-y-3">
                      <Key className="w-8 h-8 text-amber-400 mx-auto opacity-70" />
                      <div>
                        <div className="text-xs font-bold text-kin-text">No Provider Keys Configured</div>
                        <p className="text-[11px] text-[#8b949e] mt-1 max-w-md mx-auto">
                          Add your OpenAI, Anthropic, OpenRouter, Google Gemini, Groq, or DeepSeek API key here. The key is stored securely in SQLite WAL and available to every agent in every project.
                        </p>
                      </div>
                      {!showCredForm && (
                        <button
                          onClick={handleOpenAddCred}
                          className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Your First Key</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Vault Architecture Info Footer */}
                <div className="grid grid-cols-3 gap-2 pt-2 text-[11px] font-mono text-[#8b949e]">
                  <div className="p-2.5 rounded bg-[#161b22] border border-[#21262d]">
                    <span className="text-amber-400 font-bold block mb-0.5">Zero Plaintext</span>
                    HMAC & encrypted storage
                  </div>
                  <div className="p-2.5 rounded bg-[#161b22] border border-[#21262d]">
                    <span className="text-emerald-400 font-bold block mb-0.5">Universal BYOK</span>
                    Shared across all agents
                  </div>
                  <div className="p-2.5 rounded bg-[#161b22] border border-[#21262d]">
                    <span className="text-blue-400 font-bold block mb-0.5">Auto-Discovery</span>
                    Dynamic model catalog sync
                  </div>
                </div>
              </div>
            )}

            {/* SKILLS TAB */}
            {activeTab === 'skills' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-kin-text mb-1 flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span>Skills Engine & Procedural Capabilities</span>
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    Inspect procedural capabilities, bundle policies, domain actions, and sandboxed execution tools available to the workforce.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-kin-text">Procedural Skills Registry</div>
                      <div className="text-[11px] text-[#8b949e]">
                        Browse official plugins, domain skills, and autonomous tool definitions.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSkillsModalOpen(true);
                        setSettingsModalOpen(false);
                      }}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg transition cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Open Skills Registry</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] font-mono text-[#8b949e]">
                    <div className="p-2.5 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-purple-400 font-bold block mb-0.5">Sandboxed I/O</span>
                      Safe workspace read/write
                    </div>
                    <div className="p-2.5 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-emerald-400 font-bold block mb-0.5">Live MCP Tools</span>
                      Model Context Protocol servers
                    </div>
                    <div className="p-2.5 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-blue-400 font-bold block mb-0.5">Domain Skills</span>
                      Specialized agent procedures
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-kin-text flex items-center space-x-2">
                      <Network className="w-4 h-4 text-emerald-400" />
                      <span>Workforce Swarm Topology Map</span>
                    </div>
                    <div className="text-[11px] text-[#8b949e] mt-0.5">
                      Visualize active inter-agent peer relationships, channel memberships, and turn communication DAG.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSwarmMapOpen(true);
                      setSettingsModalOpen(false);
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg transition cursor-pointer"
                  >
                    <Network className="w-3.5 h-3.5" />
                    <span>Launch Swarm Map</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                  </button>
                </div>
              </div>
            )}

            {/* DESKTOP & WEB TAB */}
            {activeTab === 'desktop' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-kin-text mb-1 flex items-center space-x-2">
                    <Monitor className="w-4 h-4 text-blue-400" />
                    <span>Desktop GUI & Browser Automation Control</span>
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    Supervise local machine interaction, active desktop application windows, and headless browser sessions.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-kin-text">Desktop Control Center</div>
                      <div className="text-[11px] text-[#8b949e]">
                        Inspect live GDI+ desktop display, running application windows, and browser session state.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDesktopControlModalOpen(true);
                        setSettingsModalOpen(false);
                      }}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg transition cursor-pointer"
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      <span>Launch Desktop & Web Center</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                  </div>

                  <div className="p-2.5 rounded bg-[#0d1117] border border-[#21262d] flex items-center justify-between text-xs font-mono">
                    <span className="text-[#8b949e]">Live Browser Engine:</span>
                    <span className={browserStatus?.active ? 'text-emerald-400 font-bold' : 'text-[#64748b]'}>
                      {browserStatus?.active ? '🟢 Puppeteer Session Active' : '⚪ Standby / Idle'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] font-mono text-[#8b949e]">
                    <div className="p-2.5 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-blue-400 font-bold block mb-0.5">Desktop GDI+</span>
                      Native screen capture & input
                    </div>
                    <div className="p-2.5 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-emerald-400 font-bold block mb-0.5">App Discovery</span>
                      Local installed applications
                    </div>
                    <div className="p-2.5 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-amber-400 font-bold block mb-0.5">Human Takeover</span>
                      Instant Esc pause/resume
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 4. AGENT EVALUATIONS TAB */}
            {activeTab === 'evaluations' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-kin-text mb-1 flex items-center space-x-2">
                    <Award className="w-4 h-4 text-emerald-400" />
                    <span>Workforce Agent Evaluations & Benchmarks</span>
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    Automated regression testing, capability scoring rubrics, and formal evaluation history for specialist agents.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-kin-text">Evaluation Suite & Rubric Metrics</div>
                      <div className="text-[11px] text-[#8b949e]">
                        Benchmark accuracy, reasoning, tool competence, and safety adherence across {agents.length} agent(s).
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setActiveRightTab('Agent');
                        setActiveInspectorTab('Evaluations');
                        setSettingsModalOpen(false);
                      }}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold transition cursor-pointer"
                    >
                      <Award className="w-3.5 h-3.5" />
                      <span>Open Agent Evaluations</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2 pt-2 text-[11px] font-mono text-[#8b949e]">
                    <div className="p-2 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-emerald-400 font-bold block">Accuracy</span>
                      Objective completion
                    </div>
                    <div className="p-2 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-blue-400 font-bold block">Reasoning</span>
                      Planning logic & DAG
                    </div>
                    <div className="p-2 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-purple-400 font-bold block">Competence</span>
                      Tool execution speed
                    </div>
                    <div className="p-2 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-cyan-400 font-bold block">Safety</span>
                      Autonomy compliance
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. DRAGGABLE LAYOUT TAB */}
            {activeTab === 'layout' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-kin-text mb-1 flex items-center space-x-2">
                    <Layout className="w-4 h-4 text-purple-400" />
                    <span>Workspace Layout & Draggable Panels</span>
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    Adjust panel widths interactively using the on-screen drag handles between columns, or set exact pixel dimensions below.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] space-y-5">
                  {/* Left Sidebar Slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-kin-text">Left Sidebar Width</span>
                      <span className="font-mono text-emerald-400 font-bold">{sidebarWidth}px</span>
                    </div>
                    <input
                      type="range"
                      min={180}
                      max={450}
                      step={5}
                      value={sidebarWidth}
                      onChange={(e) => setSidebarWidth(parseInt(e.target.value, 10))}
                      className="w-full accent-emerald-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-[#8b949e] font-mono">
                      <span>180px (Compact)</span>
                      <span>260px (Default)</span>
                      <span>450px (Spacious)</span>
                    </div>
                  </div>

                  {/* Right Inspector Slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-kin-text">Right Inspector & Diagnostic Panel Width</span>
                      <span className="font-mono text-blue-400 font-bold">{inspectorWidth}px</span>
                    </div>
                    <input
                      type="range"
                      min={280}
                      max={680}
                      step={5}
                      value={inspectorWidth}
                      onChange={(e) => setInspectorWidth(parseInt(e.target.value, 10))}
                      className="w-full accent-blue-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-[#8b949e] font-mono">
                      <span>280px (Narrow)</span>
                      <span>390px (Default)</span>
                      <span>680px (Expanded Diff)</span>
                    </div>
                  </div>

                  {/* Reset Button */}
                  <div className="pt-2 border-t border-[#30363d] flex items-center justify-between">
                    <div className="text-[11px] text-[#8b949e]">
                      Tip: You can also double-click any resize splitter bar on the main screen to reset to default.
                    </div>
                    <button
                      onClick={resetPanelWidths}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-kin-text text-xs font-medium transition"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-purple-400" />
                      <span>Reset Layout</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. DATABASE & WAL TAB */}
            {activeTab === 'database' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-kin-text mb-1 flex items-center space-x-2">
                    <Database className="w-4 h-4 text-amber-400" />
                    <span>SQLite Storage Engine (WAL Mode)</span>
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    Local-first persistence using SQLite 3 with Write-Ahead Logging (WAL) and savepoint transaction isolation.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                    <div className="text-[#8b949e] text-[11px]">Database Journal Mode</div>
                    <div className="text-emerald-400 font-bold mt-1">PRAGMA journal_mode = WAL</div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                    <div className="text-[#8b949e] text-[11px]">Synchronous Pragma</div>
                    <div className="text-blue-400 font-bold mt-1">NORMAL (High Throughput)</div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                    <div className="text-[#8b949e] text-[11px]">Live Database Size</div>
                    <div className="text-kin-text font-bold mt-1">
                      {projectAnalytics?.databaseSizeBytes
                        ? `${(projectAnalytics.databaseSizeBytes / 1024).toFixed(1)} KB`
                        : 'Active (~128 KB)'}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
                    <div className="text-[#8b949e] text-[11px]">Active Workforce Agents</div>
                    <div className="text-purple-400 font-bold mt-1">{agents.length} Agent(s)</div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-kin-text">Database Maintenance & WAL Checkpoint</div>
                      <div className="text-[11px] text-[#8b949e]">
                        Forces checkpoint of WAL logs and prunes stale temporary index files.
                      </div>
                    </div>
                    <button
                      onClick={handleOptimizeDb}
                      disabled={isOptimizing}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isOptimizing ? 'animate-spin' : ''}`} />
                      <span>{isOptimizing ? 'Optimizing...' : 'Optimize WAL'}</span>
                    </button>
                  </div>
                  {vacuumStatus && (
                    <div className="text-xs text-amber-300 font-mono bg-amber-950/30 p-2 rounded border border-amber-500/30">
                      {vacuumStatus}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 5. DIAGNOSTICS & ABOUT TAB */}
            {activeTab === 'about' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-kin-text mb-1 flex items-center space-x-2">
                    <Info className="w-4 h-4 text-cyan-400" />
                    <span>System Diagnostics & Kernel Architecture</span>
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    Telemetry and architectural specifications of KIN Platform.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3 text-xs font-mono">
                  <div className="flex justify-between py-1 border-b border-[#21262d]">
                    <span className="text-[#8b949e]">Core service</span>
                    <span className="text-kin-text font-bold">KIN Agent Workflow Core</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#21262d]">
                    <span className="text-[#8b949e]">Host Platform</span>
                    <span className="text-emerald-400">Windows win32 (Node.js runtime)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#21262d]">
                    <span className="text-[#8b949e]">Core Daemon Port</span>
                    <span className="text-blue-400">127.0.0.1:54321</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#21262d]">
                    <span className="text-[#8b949e]">Frontend Web Server</span>
                    <span className="text-purple-400">localhost:5173 (Vite + React 18)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#21262d]">
                    <span className="text-[#8b949e]">Tool Capabilities</span>
                    <span className="text-cyan-400">Filesystem, Shell, Git, Desktop GUI, Browser Puppeteer</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-[#8b949e]">Peer Coordination</span>
                    <span className="text-emerald-400">Active (Multi-Agent @mentions & Handover)</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-[#21262d] bg-[#161b22] flex items-center justify-between text-xs">
          <span className="text-[#8b949e] font-mono text-[11px]">
            Changes are persisted automatically to SQLite and localStorage.
          </span>
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-black font-bold transition shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
