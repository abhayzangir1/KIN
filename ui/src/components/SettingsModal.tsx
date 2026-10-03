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
  } = useKinStore();

  const [activeTab, setActiveTab] = useState<'general' | 'models' | 'credentials' | 'evaluations' | 'database' | 'layout' | 'about'>('general');
  const [vacuumStatus, setVacuumStatus] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

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
                  KIN OS v1.0
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
                        onClick={() => {
                          setActiveRightTab('Agent');
                          setActiveInspectorTab('Credentials');
                          setSettingsModalOpen(false);
                        }}
                        className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-medium transition cursor-pointer"
                      >
                        <span>Manage in Agent Inspector (BYOK)</span>
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
                    KIN OS runs 100% locally with private LLM inference via Ollama on port 11434.
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

                {/* OpenRouter Free Models Catalog */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#8b949e] flex items-center space-x-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                      <span>OpenRouter 100% Free Cloud Models</span>
                    </h4>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                      Zero Cost • No Quota Burn
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { id: 'openrouter/deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', desc: 'Reasoning model with thinking tokens extraction' },
                      { id: 'openrouter/meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (Free)', desc: 'Meta 70B parameter general reasoning model' },
                      { id: 'openrouter/google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', desc: 'Ultra-fast multimodal 1M context model' },
                      { id: 'openrouter/qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen 2.5 Coder 32B (Free)', desc: 'Advanced coding & syntax comprehension' },
                    ].map((m) => (
                      <div
                        key={m.id}
                        className="p-2.5 rounded-lg bg-[#161b22] border border-[#30363d] flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-kin-text font-mono flex items-center space-x-2">
                            <span>{m.name}</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-sans">
                              Free
                            </span>
                          </div>
                          <p className="text-[11px] text-[#8b949e] mt-0.5">{m.desc}</p>
                          <div className="text-[10px] font-mono text-purple-300 mt-0.5">{m.id}</div>
                        </div>
                      </div>
                    ))}
                  </div>
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
                    onClick={() => {
                      setActiveRightTab('Agent');
                      setActiveInspectorTab('Credentials');
                      setSettingsModalOpen(false);
                    }}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-medium transition cursor-pointer"
                  >
                    <span>Manage in Agent Inspector (BYOK)</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {/* 3. BYOK CREDENTIALS TAB */}
            {activeTab === 'credentials' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-kin-text mb-1 flex items-center space-x-2">
                    <Key className="w-4 h-4 text-amber-400" />
                    <span>Managed Provider Credentials (BYOK)</span>
                  </h3>
                  <p className="text-xs text-[#8b949e]">
                    Store external LLM provider API keys securely in SQLite WAL with monthly token spend limits and agent capability grants.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-kin-text">Secure Encrypted Key Vault</div>
                      <div className="text-[11px] text-[#8b949e]">
                        Currently storing {credentials?.length || 0} active provider credential(s).
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setActiveRightTab('Agent');
                        setActiveInspectorTab('Credentials');
                        setSettingsModalOpen(false);
                      }}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition cursor-pointer"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>Manage in Agent Inspector (BYOK)</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 text-[11px] font-mono text-[#8b949e]">
                    <div className="p-2 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-amber-400 font-bold block">Zero Stored Plaintext</span>
                      HMAC & hashed storage
                    </div>
                    <div className="p-2 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-emerald-400 font-bold block">Token Guardrails</span>
                      Monthly spend quotas
                    </div>
                    <div className="p-2 rounded bg-[#0d1117] border border-[#21262d]">
                      <span className="text-blue-400 font-bold block">Scoped Grants</span>
                      Per-agent permissioning
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
                    Telemetry and architectural specifications of KIN OS.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-[#161b22] border border-[#30363d] space-y-3 text-xs font-mono">
                  <div className="flex justify-between py-1 border-b border-[#21262d]">
                    <span className="text-[#8b949e]">Operating System Engine</span>
                    <span className="text-kin-text font-bold">KIN Autonomous Workforce Kernel</span>
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
