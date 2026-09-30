import React, { useState, useEffect } from 'react';
import { useKinStore } from '../store/kinStore.js';
import {
  Zap,
  Terminal,
  ShieldCheck,
  FileText,
  Save,
  Check,
  Send,
} from 'lucide-react';

export const AgentInspector: React.FC = () => {
  const {
    agents,
    selectedAgentId,
    activeProject,
    ollamaStatus,
    activeInspectorTab,
    setActiveInspectorTab,
    updateAgentContract,
    terminalHistory,
    runTerminalCommand,
  } = useKinStore();

  const currentAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  const [roleTitle, setRoleTitle] = useState(currentAgent?.role || 'Lead Sovereign Orchestrator');
  const [activeModelId, setActiveModelId] = useState(currentAgent?.activeModelId || 'ollama/qwen2.5-coder:3b');
  const [customInstructions, setCustomInstructions] = useState(
    currentAgent?.systemPrompt || 'Optional custom instructions specific to this agent'
  );
  const [isSaved, setIsSaved] = useState(false);
  const [terminalInput, setTerminalInput] = useState('');

  useEffect(() => {
    if (currentAgent) {
      setRoleTitle(currentAgent.role);
      setActiveModelId(currentAgent.activeModelId);
      if (currentAgent.systemPrompt) {
        setCustomInstructions(currentAgent.systemPrompt);
      }
    }
  }, [currentAgent?.id, currentAgent?.activeModelId, currentAgent?.role]);

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
    await runTerminalCommand(cmd);
  };

  return (
    <aside className="w-80 bg-[#090d16] border-l border-[#1e293b] flex flex-col h-full text-xs select-none">
      {/* Top Header: AGENT INSPECTOR & Tabs */}
      <div className="h-10 border-b border-[#1e293b] px-3 flex items-center justify-between bg-[#070b12]">
        <div className="flex items-center space-x-1.5 font-bold tracking-wider text-xs text-kin-text">
          <Zap className="w-3.5 h-3.5 text-emerald-400" />
          <span>AGENT INSPECTOR</span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveInspectorTab('Telemetry')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
              activeInspectorTab === 'Telemetry'
                ? 'bg-blue-600/30 text-blue-300'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
          >
            Telemetry
          </button>
          <button
            onClick={() => setActiveInspectorTab('Contract')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
              activeInspectorTab === 'Contract'
                ? 'bg-blue-600 text-white font-semibold'
                : 'text-[#64748b] hover:text-kin-text'
            }`}
          >
            Contract
          </button>
        </div>
      </div>

      {/* Main Inspector Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Selected Agent Identity Card */}
        <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded bg-[#1e293b] border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold text-xs">
                @
              </div>
              <div>
                <div className="font-semibold text-kin-text">{currentAgent?.displayName || '@Boss'}</div>
                <div className="text-[10px] text-[#64748b]">{currentAgent?.name?.toLowerCase() || 'boss'}</div>
              </div>
            </div>

            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
              ACTIVE
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

        {/* Role Contract & Prompts Section */}
        <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2.5">
          <div className="flex items-center space-x-1.5 text-kin-text font-semibold text-[11px]">
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span>Role Contract & Prompts</span>
          </div>

          {/* Sub-tabs */}
          <div className="grid grid-cols-2 gap-1 bg-[#090d16] p-0.5 rounded border border-[#1e293b] text-[11px]">
            <button className="py-0.5 rounded bg-blue-600 text-white font-medium text-center">
              This Agent (Project)
            </button>
            <button className="py-0.5 rounded text-[#64748b] hover:text-kin-text text-center">
              Global Template
            </button>
          </div>

          {/* Specialist Role Title */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-[#64748b] uppercase font-bold tracking-wider">
              <span>Specialist Role Title</span>
              <span>project scope</span>
            </div>
            <input
              type="text"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-2.5 py-1 text-xs text-kin-text focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Model Override (Tier 1) */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-[#64748b] uppercase font-bold tracking-wider">
              <span>Model Override (Tier 1)</span>
              <span className="text-emerald-400 font-mono text-[9px] truncate max-w-[120px]">
                {activeModelId.replace('ollama/', '')}
              </span>
            </div>

            <select
              value={activeModelId}
              onChange={(e) => {
                setActiveModelId(e.target.value);
                if (currentAgent) {
                  updateAgentContract(currentAgent.id, roleTitle, e.target.value, customInstructions);
                }
              }}
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-2 py-1 text-xs text-kin-text focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <optgroup label="Local Detected Models (Ollama)">
                {ollamaStatus.models.length > 0 ? (
                  ollamaStatus.models.map((m) => (
                    <option key={`ollama/${m}`} value={`ollama/${m}`}>
                      {m}
                    </option>
                  ))
                ) : (
                  <option value="ollama/qwen2.5-coder:3b">qwen2.5-coder:3b</option>
                )}
              </optgroup>
              <optgroup label="Cloud Providers">
                <option value="anthropic/claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                <option value="openai/gpt-4o">GPT-4o</option>
                <option value="deepseek/deepseek-chat">DeepSeek V3</option>
                <option value="deepseek/deepseek-reasoner">DeepSeek R1</option>
              </optgroup>
            </select>
            <div className="text-[10px] text-[#64748b]">
              Specify an explicit model name or "inherit" to use project/system defaults.
            </div>
          </div>

          {/* Custom Specialist Instructions */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-[#64748b] uppercase font-bold tracking-wider">
              <span>Custom Specialist Instructions</span>
              <span>Instance Override</span>
            </div>
            <textarea
              rows={3}
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              className="w-full bg-[#090d16] border border-[#2d3748] rounded px-2.5 py-1.5 text-xs text-kin-text focus:outline-none focus:border-blue-500 resize-none font-mono"
            />
          </div>

          <button
            onClick={handleSaveContract}
            className="w-full py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center justify-center space-x-1.5 transition"
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaved ? 'Contract Saved' : 'Save Role Contract'}</span>
          </button>
        </div>
      </div>

      {/* Bottom Section: Integrated Terminal */}
      <div className="h-48 border-t border-[#1e293b] bg-[#070b12] flex flex-col font-mono text-[11px]">
        {/* Terminal Header */}
        <div className="px-3 py-1.5 border-b border-[#1e293b] flex items-center justify-between text-[#8b949e] select-none">
          <div className="flex items-center space-x-1.5 text-kin-text font-bold">
            <Terminal className="w-3 h-3 text-emerald-400" />
            <span>INTEGRATED TERMINAL</span>
          </div>
          <span className="text-[10px] text-emerald-400">PowerShell</span>
        </div>

        {/* Terminal Output */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 text-[#cbd5e1] leading-tight">
          <div className="text-[#64748b]">Windows PowerShell</div>
          <div className="text-[#64748b]">Copyright (C) Microsoft Corporation. All rights reserved.</div>
          <div className="text-emerald-400 pt-1">PS {activeProject?.repoPath || 'D:\\KIN'}&gt;</div>

          {terminalHistory.map((item, idx) => (
            <div key={idx} className="space-y-0.5 pt-1">
              <div className="text-blue-400">&gt; {item.command}</div>
              <div
                className={`whitespace-pre-wrap ${
                  item.exitCode === 0 ? 'text-[#94a3b8]' : 'text-red-400'
                }`}
              >
                {item.output}
              </div>
            </div>
          ))}
        </div>

        {/* Terminal Input Form */}
        <form onSubmit={handleTerminalSubmit} className="p-1.5 border-t border-[#1e293b] flex items-center space-x-1">
          <span className="text-emerald-400 text-xs pl-1">&gt;</span>
          <input
            type="text"
            value={terminalInput}
            onChange={(e) => setTerminalInput(e.target.value)}
            placeholder="Run shell command..."
            className="flex-1 bg-transparent text-xs text-kin-text placeholder-[#64748b] focus:outline-none font-mono"
          />
          <button
            type="submit"
            disabled={!terminalInput.trim()}
            className="p-1 text-emerald-400 hover:text-emerald-300 disabled:opacity-30"
          >
            <Send className="w-3 h-3" />
          </button>
        </form>
      </div>
    </aside>
  );
};
