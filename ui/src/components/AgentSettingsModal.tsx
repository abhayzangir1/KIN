import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import { ProviderIcon } from './ModelSelectorModal.js';
import {
  X,
  User,
  Cpu,
  FileText,
  Shield,
  Check,
  Sparkles,
  Zap,
  Globe,
  Terminal,
  Save,
  Wrench,
  Brain,
} from 'lucide-react';

interface PromptPreset {
  id: string;
  name: string;
  roleTitle: string;
  icon: string;
  description: string;
  prompt: string;
  capabilities: string[];
}

const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'fullstack',
    name: 'Senior Full-Stack Engineer',
    roleTitle: 'Full-Stack Software Engineer',
    icon: '💻',
    description: 'Expert in React, TypeScript, Node.js, databases, and building robust end-to-end features.',
    prompt: `You are the Senior Full-Stack Engineer for {project_name}.
Your primary repository workspace is located at {workspace_path}.

Core Principles:
1. Write clean, modular, and maintainable TypeScript and modern React code.
2. Maintain documentation integrity and preserve all existing codebase comments.
3. Verify changes through automated typechecks and unit tests before completing tasks.
4. Adhere to project architecture decision records (ADRs).`,
    capabilities: ['fs:read', 'fs:write', 'shell:exec', 'mcp:call'],
  },
  {
    id: 'security',
    name: 'Security Auditor & Code Reviewer',
    roleTitle: 'AppSec & Code Quality Specialist',
    icon: '🛡️',
    description: 'Specializes in vulnerability analysis, secret leakage prevention, and code review.',
    prompt: `You are the Security Auditor for {project_name}.
Workspace boundary: {workspace_path}.

Core Mandates:
1. Audit incoming pull requests, diffs, and codebase changes for security risks (CORS, injection, SSRF, secret leakage).
2. Never bypass access controls or perimeter security boundaries.
3. Validate all inputs at network boundaries and ensure cryptographic keys remain in encrypted vaults.
4. Flag high-risk actions with concrete remediation steps.`,
    capabilities: ['fs:read', 'shell:exec'],
  },
  {
    id: 'architect',
    name: 'Technical Architect & ADR Writer',
    roleTitle: 'Systems Architect',
    icon: '🏛️',
    description: 'High-level system design, architecture decision records (ADRs), and component boundaries.',
    prompt: `You are the Systems Architect for {project_name}.
Root directory: {workspace_path}.

Core Responsibilities:
1. Design resilient, decoupled systems with clear module interfaces.
2. Document architectural trade-offs using structured MADR (Markdown Architecture Decision Record) templates.
3. Ensure single sources of truth (WAL persistence) and idempotent workflows.
4. Coordinate multi-agent division of labor across specialists.`,
    capabilities: ['fs:read', 'fs:write', 'agent:delegate'],
  },
  {
    id: 'devops',
    name: 'DevOps & CI/CD Specialist',
    roleTitle: 'Platform & Release Engineer',
    icon: '🚀',
    description: 'Build automation, GitHub Actions, Docker, packaging, and runtime health.',
    prompt: `You are the Platform & Release Engineer for {project_name}.
Environment: {workspace_path}.

Core Responsibilities:
1. Manage build pipelines, release artifacts, and deployment automation.
2. Keep build output clean with zero TypeScript errors and passing test suites.
3. Optimize startup latency and minimize bundle sizes.
4. Monitor process resource utilization and runtime diagnostics.`,
    capabilities: ['fs:read', 'fs:write', 'shell:exec', 'mcp:call'],
  },
];

const VARIABLE_CHIPS = [
  { label: '{project_name}', desc: 'Active project name' },
  { label: '{workspace_path}', desc: 'Absolute repository root path' },
  { label: '{active_channel}', desc: 'Current communication channel' },
  { label: '{user_name}', desc: 'Operator username' },
];

export const AgentSettingsModal: React.FC = () => {
  const {
    isAgentSettingsModalOpen,
    agentSettingsTargetAgentId,
    closeAgentSettings,
    agents,
    availableModels,
    updateAgentContract,
    updateAgentModel,
    activeProject,
    activeChannelId,
    channels,
    addToast,
    openModelSelector,
  } = useKinStore();

  const [activeTab, setActiveTab] = useState<'identity' | 'model' | 'instructions' | 'safety'>('instructions');

  // Form states
  const [roleTitle, setRoleTitle] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const targetAgent = agents.find((a) => a.id === agentSettingsTargetAgentId);

  useEffect(() => {
    if (targetAgent) {
      setRoleTitle(targetAgent.role || 'Specialist');
      setSelectedModelId(targetAgent.activeModelId || 'qwen2.5-coder:3b');
      setInstructions(targetAgent.systemPrompt || '');
      setCapabilities(targetAgent.capabilities || []);
    }
  }, [targetAgent]);

  if (!isAgentSettingsModalOpen || !targetAgent) return null;

  const handleApplyPreset = (preset: PromptPreset) => {
    setRoleTitle(preset.roleTitle);
    setInstructions(preset.prompt);
    setCapabilities(preset.capabilities);
    addToast(`Applied ${preset.name} template!`, 'info');
  };

  const handleInsertVariable = (variable: string) => {
    setInstructions((prev) => `${prev} ${variable}`.trim());
  };

  const toggleCapability = (cap: string) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!targetAgent) return;
    try {
      setIsSaving(true);
      const res = await updateAgentContract(targetAgent.id, roleTitle.trim(), selectedModelId, instructions.trim(), capabilities);
      if (res && !res.success) {
        throw new Error(res.error || 'Failed to save agent settings');
      }
      if (selectedModelId !== targetAgent.activeModelId) {
        await updateAgentModel(targetAgent.id, selectedModelId, activeProject?.id, activeChannelId);
      }
      addToast(`✓ Updated contract for ${targetAgent.displayName}!`, 'success');
      closeAgentSettings();
    } catch (err: any) {
      addToast(err?.message || 'Failed to save agent settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const activeModelItem = availableModels.find((m) => m.id === selectedModelId) || {
    id: selectedModelId,
    name: selectedModelId.split('/').pop() || selectedModelId,
    provider: selectedModelId.includes('/') ? selectedModelId.split('/')[0] : 'ollama',
    contextWindow: 128000,
    supportsTools: true,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-kin-surface border border-kin-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden text-kin-text font-sans">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-kin-border bg-kin-card shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-md shrink-0">
              {targetAgent.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-kin-text">
                  Configure Specialist: {targetAgent.displayName}
                </h2>
                {targetAgent.isOrchestrator ? (
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Workspace Orchestrator
                  </span>
                ) : (
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    Domain Specialist
                  </span>
                )}
              </div>
              <p className="text-xs text-kin-muted">
                Tailor system instructions, LLM engine, prompt templates, and security capabilities
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeAgentSettings}
            className="p-1.5 rounded-lg hover:bg-kin-cardHover text-kin-muted hover:text-kin-text transition cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Tab Navigation */}
        <div className="flex items-center px-6 border-b border-kin-border bg-kin-surface shrink-0 gap-2">
          {[
            { id: 'instructions', label: 'Instructions & Prompts', icon: FileText },
            { id: 'model', label: 'Model Engine', icon: Cpu },
            { id: 'identity', label: 'Identity & Scope', icon: User },
            { id: 'safety', label: 'Safety & Permissions', icon: Shield },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-2 px-4 py-3 text-xs font-semibold border-b-2 transition cursor-pointer ${
                  isActive
                    ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                    : 'border-transparent text-kin-muted hover:text-kin-text hover:bg-kin-cardHover'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-kin-surface">
          {/* TAB 1: INSTRUCTIONS & PROMPTS */}
          {activeTab === 'instructions' && (
            <div className="space-y-4">
              {/* 1-Click Prompt Scaffolds */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-kin-text uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Role Presets & Scaffolds</span>
                  </label>
                  <span className="text-[11px] text-kin-muted">Click any preset to insert proven instructions</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {PROMPT_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleApplyPreset(p)}
                      className="p-3 rounded-xl bg-kin-card hover:bg-kin-cardHover border border-kin-border hover:border-blue-500/50 text-left transition group cursor-pointer flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-base">{p.icon}</span>
                          <span className="text-xs font-bold text-kin-text group-hover:text-blue-400 transition">
                            {p.name}
                          </span>
                        </div>
                        <p className="text-[11px] text-kin-muted line-clamp-2 leading-relaxed">
                          {p.description}
                        </p>
                      </div>
                      <div className="mt-2 pt-2 border-t border-kin-border text-[10px] font-semibold text-blue-400 flex items-center justify-between">
                        <span>Apply Template</span>
                        <span>→</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Variable Insertion Chips */}
              <div className="space-y-1.5 pt-2 border-t border-kin-border">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-kin-text uppercase tracking-wider">
                    Dynamic Variable Chips
                  </span>
                  <span className="text-[11px] text-kin-muted">Click to insert at end of prompt</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {VARIABLE_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => handleInsertVariable(chip.label)}
                      className="px-2.5 py-1 rounded-lg bg-kin-card hover:bg-kin-cardHover border border-kin-border hover:border-blue-500/40 text-xs font-mono text-cyan-500 dark:text-cyan-300 transition cursor-pointer flex items-center space-x-1"
                      title={chip.desc}
                    >
                      <span>+</span>
                      <span>{chip.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Monospace Instructions Editor */}
              <div className="space-y-2 pt-2 border-t border-kin-border">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-kin-text uppercase tracking-wider">
                    Specialist System Instructions (Contract Prompt)
                  </label>
                  <span className="text-[11px] text-kin-muted font-mono">
                    {instructions.length} characters
                  </span>
                </div>
                <textarea
                  rows={13}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Define specialist role, principles, tool usage guidelines, and behavioral constraints..."
                  className="w-full bg-kin-surface border border-kin-border rounded-xl p-3.5 text-xs font-mono text-kin-text placeholder-kin-muted focus:outline-none focus:border-blue-500 leading-relaxed resize-none selection:bg-blue-600/30"
                />
              </div>
            </div>
          )}

          {/* TAB 2: MODEL ENGINE */}
          {activeTab === 'model' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-kin-text uppercase tracking-wider block mb-2">
                  Active Intelligence Model
                </label>
                <div className="p-4 rounded-xl bg-kin-card border border-kin-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-xl bg-kin-surface border border-kin-border flex items-center justify-center text-kin-text shrink-0">
                      <ProviderIcon provider={activeModelItem.provider || activeModelItem.id} className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-kin-text flex items-center space-x-2">
                        <span>{activeModelItem.name || activeModelItem.id}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          Ready
                        </span>
                      </div>
                      <div className="text-xs font-mono text-kin-muted mt-0.5">
                        {activeModelItem.id}
                      </div>
                      <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-kin-muted">
                        <span className="px-1.5 py-0.5 rounded bg-kin-surface border border-kin-border">
                          {Math.round((activeModelItem.contextWindow || 128000) / 1000)}k ctx
                        </span>
                        {activeModelItem.supportsTools && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center space-x-1">
                            <Wrench className="w-2.5 h-2.5" />
                            <span>Tools</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      closeAgentSettings();
                      openModelSelector(targetAgent.id);
                    }}
                    className="px-4 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-600 dark:text-blue-300 hover:text-white border border-blue-500/40 text-xs font-semibold transition cursor-pointer self-start sm:self-center"
                  >
                    Change Model Engine →
                  </button>
                </div>
              </div>

              {/* Quick Select from Available Models */}
              <div className="space-y-2 pt-2 border-t border-kin-border">
                <label className="text-xs font-bold text-kin-text uppercase tracking-wider block">
                  Quick Switch Model
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {availableModels.slice(0, 9).map((m) => {
                    const isSelected = m.id === selectedModelId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedModelId(m.id)}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-blue-600/20 border-blue-500 text-blue-600 dark:text-blue-300 font-semibold'
                            : 'bg-kin-card border-kin-border text-kin-muted hover:text-kin-text hover:bg-kin-cardHover'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <ProviderIcon provider={m.provider || m.id} className="w-4 h-4 shrink-0" />
                          <span className="text-xs truncate">{m.name || m.id.split('/').pop()}</span>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: IDENTITY & SCOPE */}
          {activeTab === 'identity' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-kin-text uppercase tracking-wider block mb-1.5">
                  Specialist Role Title
                </label>
                <input
                  type="text"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. Senior Full-Stack Engineer, AppSec Reviewer"
                  className="w-full bg-kin-surface border border-kin-border rounded-xl px-3.5 py-2.5 text-xs text-kin-text focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 border-t border-kin-border">
                <label className="text-xs font-bold text-kin-text uppercase tracking-wider block mb-2">
                  Channel Assignments in Project
                </label>
                <div className="p-3 rounded-xl bg-kin-card border border-kin-border space-y-2">
                  <p className="text-xs text-kin-muted">
                    This specialist is actively participating in the following channel topics:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {channels
                      .filter((c) => c.channelType !== 'direct_message' && !c.id.startsWith('dm-'))
                      .map((c) => (
                        <span
                          key={c.id}
                          className="px-2.5 py-1 rounded-lg bg-kin-surface border border-kin-border text-xs font-mono text-kin-text flex items-center space-x-1"
                        >
                          <span className="text-kin-muted">#</span>
                          <span>{c.name}</span>
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SAFETY & CAPABILITIES */}
          {activeTab === 'safety' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-kin-text uppercase tracking-wider block mb-1">
                  Autonomous Execution Capabilities
                </label>
                <p className="text-xs text-kin-muted mb-3">
                  Granular permission gates enforced by Sentinel security sandbox. Disable any capability to restrict agent actions.
                </p>

                <div className="space-y-2.5">
                  {[
                    { id: 'fs:read', name: 'File Read (fs:read)', desc: 'Inspect source code, documents, and workspace assets', icon: Globe },
                    { id: 'fs:write', name: 'File Write (fs:write)', desc: 'Create, modify, and delete project files within workspace boundary', icon: Wrench },
                    { id: 'shell:exec', name: 'Shell Execution (shell:exec)', desc: 'Run terminal build commands, linter, test suites, and scripts', icon: Terminal },
                    { id: 'agent:delegate', name: 'Sub-Agent Delegation (agent:delegate)', desc: 'Spawn and delegate subtasks to peer specialists', icon: Brain },
                    { id: 'mcp:call', name: 'MCP Tool Invocations (mcp:call)', desc: 'Query external databases, APIs, and connected Model Context Protocol servers', icon: Zap },
                    { id: 'browser:interact', name: 'Browser Automation (browser:interact)', desc: 'Inspect web apps, execute Puppeteer runs, and preview UI', icon: Globe },
                  ].map((cap) => {
                    const isEnabled = capabilities.includes(cap.id);
                    const Icon = cap.icon;
                    return (
                      <div
                        key={cap.id}
                        onClick={() => toggleCapability(cap.id)}
                        className={`p-3 rounded-xl border flex items-center justify-between transition cursor-pointer ${
                          isEnabled
                            ? 'bg-blue-600/10 border-blue-500/40 text-kin-text'
                            : 'bg-kin-card border-kin-border text-kin-muted opacity-60'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className={`p-2 rounded-lg ${isEnabled ? 'bg-blue-500/20 text-blue-400' : 'bg-kin-surface text-kin-muted'}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-kin-text">{cap.name}</div>
                            <div className="text-[11px] text-kin-muted">{cap.desc}</div>
                          </div>
                        </div>

                        <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition ${
                          isEnabled ? 'bg-blue-600 border-blue-500 text-white' : 'border-kin-border bg-kin-surface'
                        }`}>
                          {isEnabled && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Action Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-kin-border bg-kin-card shrink-0">
          <button
            type="button"
            onClick={closeAgentSettings}
            className="px-4 py-2 rounded-lg bg-kin-surface hover:bg-kin-surfaceHover border border-kin-border text-kin-text text-xs font-semibold transition cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => handleSave()}
            disabled={isSaving}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-lg cursor-pointer flex items-center space-x-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving Contract...' : 'Save Specialist Contract'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
