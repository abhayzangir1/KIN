import React, { useState } from 'react';
import { Copy, Check, Terminal, FileCode, CheckCircle2 } from 'lucide-react';
import { useKinStore } from '../store/kinStore.js';

interface CodeBlockProps {
  language?: string;
  code: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language = '', code }) => {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);
  const { addToast, runTerminalCommand } = useKinStore();

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    addToast({ title: 'Copied', message: 'Code copied to clipboard', type: 'info', duration: 2000 });
    setTimeout(() => setCopied(false), 2000);
  };

  const isShellCommand =
    language === 'bash' ||
    language === 'sh' ||
    language === 'zsh' ||
    language === 'powershell' ||
    language === 'cmd';

  const handleRunCommand = async () => {
    if (!code.trim()) return;
    try {
      setApplied(true);
      await runTerminalCommand(code.trim());
      addToast({
        title: 'Command Dispatched',
        message: 'Executed in workspace terminal session.',
        type: 'success',
      });
      setTimeout(() => setApplied(false), 3000);
    } catch (err: any) {
      addToast({
        title: 'Execution Error',
        message: err?.message || 'Failed to dispatch command',
        type: 'error',
      });
      setApplied(false);
    }
  };

  return (
    <div className="my-2.5 rounded-xl border border-[#1e293b] bg-[#090d16] overflow-hidden shadow-lg select-text">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0f172a] border-b border-[#1e293b] text-[11px] font-mono select-none">
        <div className="flex items-center space-x-1.5 text-[#94a3b8]">
          {isShellCommand ? (
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          ) : (
            <FileCode className="w-3.5 h-3.5 text-blue-400" />
          )}
          <span className="font-semibold text-white uppercase text-[10px] tracking-wider">
            {language || 'text'}
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          {isShellCommand && (
            <button
              type="button"
              onClick={handleRunCommand}
              disabled={applied}
              className="px-2 py-0.5 rounded bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-[10px] font-semibold transition cursor-pointer flex items-center space-x-1"
              title="Execute in workspace terminal"
            >
              {applied ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Terminal className="w-3 h-3" />}
              <span>{applied ? 'Sent' : 'Run in Terminal'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="px-2 py-0.5 rounded bg-[#1e293b] hover:bg-[#283548] text-[#cbd5e1] hover:text-white border border-[#2d3748] text-[10px] font-medium transition cursor-pointer flex items-center space-x-1"
            title="Copy code to clipboard"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Code contents */}
      <pre className="p-3.5 text-[11px] font-mono text-[#e2e8f0] overflow-x-auto leading-relaxed bg-[#070b14]/90">
        <code>{code}</code>
      </pre>
    </div>
  );
};
