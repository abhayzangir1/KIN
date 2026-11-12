import React, { useState } from 'react';
import { Copy, Check, Terminal, FileCode, CheckCircle2, AlertTriangle, Play, ShieldAlert, Hash } from 'lucide-react';
import { useKinStore } from '../../store/kinStore.js';

interface CodeBlockProps {
  language?: string;
  code: string;
}

// Token categories for lightweight syntax highlighting
interface Token {
  text: string;
  type: 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'operator' | 'punctuation' | 'plain';
}

function tokenize(code: string, lang: string): Token[] {
  const cleanLang = (lang || '').toLowerCase().trim();
  const tokens: Token[] = [];
  let i = 0;
  const len = code.length;

  const keywords = new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break',
    'continue', 'new', 'class', 'extends', 'import', 'export', 'from', 'default', 'try', 'catch', 'finally',
    'throw', 'async', 'await', 'yield', 'typeof', 'instanceof', 'void', 'this', 'super', 'null', 'undefined',
    'true', 'false', 'def', 'elif', 'pass', 'lambda', 'with', 'as', 'assert', 'raise', 'except', 'in', 'is',
    'fn', 'pub', 'struct', 'enum', 'impl', 'trait', 'match', 'mut', 'use', 'mod', 'crate', 'self', 'Self',
    'select', 'from', 'where', 'insert', 'into', 'update', 'delete', 'join', 'left', 'right', 'inner', 'group', 'by', 'order'
  ]);

  while (i < len) {
    // 1. Line comments
    if ((code[i] === '/' && code[i + 1] === '/') || (cleanLang === 'python' && code[i] === '#') || (['bash', 'sh', 'zsh'].includes(cleanLang) && code[i] === '#')) {
      const start = i;
      while (i < len && code[i] !== '\n') i++;
      tokens.push({ text: code.slice(start, i), type: 'comment' });
      continue;
    }

    // 2. Block comments
    if (code[i] === '/' && code[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < len && !(code[i - 1] === '*' && code[i] === '/')) i++;
      if (i < len) i++;
      tokens.push({ text: code.slice(start, i), type: 'comment' });
      continue;
    }

    // 3. Strings
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i];
      const start = i;
      i++;
      while (i < len && code[i] !== quote) {
        if (code[i] === '\\' && i + 1 < len) i++;
        i++;
      }
      if (i < len) i++;
      tokens.push({ text: code.slice(start, i), type: 'string' });
      continue;
    }

    // 4. Numbers
    if (/\d/.test(code[i]) && (i === 0 || /[\s,;:()[\]{}=+\-*/<>]/.test(code[i - 1]))) {
      const start = i;
      while (i < len && /[\d.xXa-fA-F_]/.test(code[i])) i++;
      tokens.push({ text: code.slice(start, i), type: 'number' });
      continue;
    }

    // 5. Words / Identifiers
    if (/[a-zA-Z_$]/.test(code[i])) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_$]/.test(code[i])) i++;
      const word = code.slice(start, i);
      if (keywords.has(word)) {
        tokens.push({ text: word, type: 'keyword' });
      } else if (i < len && code[i] === '(') {
        tokens.push({ text: word, type: 'function' });
      } else {
        tokens.push({ text: word, type: 'plain' });
      }
      continue;
    }

    // 6. Operators & punctuation
    if (/[=+\-*/%&|^!<>?:;,.[\]{}()]/.test(code[i])) {
      tokens.push({ text: code[i], type: 'punctuation' });
      i++;
      continue;
    }

    // 7. Whitespace
    tokens.push({ text: code[i], type: 'plain' });
    i++;
  }

  return tokens;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language = '', code }) => {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const { addToast, runTerminalCommand, activeProject } = useKinStore();

  const isShellCommand =
    language === 'bash' ||
    language === 'sh' ||
    language === 'zsh' ||
    language === 'powershell' ||
    language === 'cmd';

  const isDangerousCommand =
    /rm\s+-rf|git\s+reset\s+--hard|format\s+|del\s+\/s|drop\s+database|mkfs/i.test(code);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExecute = async () => {
    setShowPreviewModal(false);
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

  const tokens = tokenize(code, language);
  const lines = code.split('\n');

  return (
    <div className="my-3 rounded-xl border border-kin-border bg-kin-surface/95 overflow-hidden shadow-xs transition-colors">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-kin-card/80 border-b border-kin-border text-[11px] font-mono select-none">
        <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-300">
          {isShellCommand ? (
            <Terminal className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
          ) : (
            <FileCode className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          )}
          <span className="font-semibold uppercase text-[10px] tracking-wider text-slate-700 dark:text-slate-200">
            {language || 'text'}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-sans">
            ({lines.length} {lines.length === 1 ? 'line' : 'lines'})
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Line Numbers Toggle */}
          <button
            type="button"
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            className={`p-1 rounded text-[10px] font-mono transition ${
              showLineNumbers
                ? 'bg-slate-200 dark:bg-kin-card text-slate-800 dark:text-slate-200'
                : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
            title="Toggle Line Numbers"
          >
            <Hash className="w-3 h-3" />
          </button>

          {/* Run in Terminal Button */}
          {isShellCommand && (
            <button
              type="button"
              onClick={() => setShowPreviewModal(true)}
              disabled={applied}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer flex items-center space-x-1 ${
                isDangerousCommand
                  ? 'bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 dark:text-amber-300 dark:border-amber-600/40'
                  : 'bg-cyan-100 hover:bg-cyan-200 text-cyan-800 border border-cyan-300 dark:bg-cyan-950/40 dark:hover:bg-cyan-900/50 dark:text-cyan-300 dark:border-cyan-600/40'
              }`}
              title="Preview and execute command"
            >
              {applied ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              ) : isDangerousCommand ? (
                <AlertTriangle className="w-3 h-3 text-amber-500" />
              ) : (
                <Play className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
              )}
              <span>{applied ? 'Dispatched' : 'Run in Terminal'}</span>
            </button>
          )}

          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopy}
            className="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 dark:bg-kin-card dark:hover:bg-kin-cardHover text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-kin-border text-[10px] font-medium transition cursor-pointer flex items-center space-x-1"
            title="Copy code to clipboard"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Code Area with Syntax Tokens */}
      <div className="flex overflow-x-auto text-[11px] font-mono leading-relaxed select-text p-3">
        {showLineNumbers && (
          <div className="select-none text-slate-400 dark:text-slate-600 text-right pr-3.5 border-r border-slate-200 dark:border-kin-border/40 font-mono shrink-0">
            {lines.map((_, idx) => (
              <div key={idx}>{idx + 1}</div>
            ))}
          </div>
        )}
        <div className="pl-3.5 whitespace-pre flex-1 font-mono text-slate-800 dark:text-[#e6edf3]">
          {tokens.map((token, idx) => {
            let colorClass = '';
            if (token.type === 'keyword') {
              colorClass = 'text-purple-600 dark:text-[#ff7b72] font-semibold';
            } else if (token.type === 'string') {
              colorClass = 'text-emerald-600 dark:text-[#a5d6ff]';
            } else if (token.type === 'comment') {
              colorClass = 'text-slate-400 dark:text-[#8b949e] italic';
            } else if (token.type === 'number') {
              colorClass = 'text-amber-600 dark:text-[#79c0ff]';
            } else if (token.type === 'function') {
              colorClass = 'text-blue-600 dark:text-[#d2a8ff]';
            } else if (token.type === 'punctuation') {
              colorClass = 'text-slate-500 dark:text-[#c9d1d9]';
            }
            return (
              <span key={idx} className={colorClass}>
                {token.text}
              </span>
            );
          })}
        </div>
      </div>

      {/* Command Execution Preview Modal */}
      {showPreviewModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-300 dark:border-kin-border rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center space-x-2.5 pb-2 border-b border-slate-200 dark:border-kin-border">
              <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Terminal Command Execution Preview
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Review parameters before dispatching to the host terminal session
                </p>
              </div>
            </div>

            {/* Target Path */}
            <div className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Target Working Directory:</span>
              <div className="p-2 rounded bg-slate-100 dark:bg-[#0d1117] border border-slate-200 dark:border-kin-border font-mono text-[11px] text-slate-800 dark:text-slate-200 break-all">
                {activeProject?.repoPath || 'Workspace Root (Jail Directory)'}
              </div>
            </div>

            {/* Command preview */}
            <div className="space-y-1 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Command:</span>
              <pre className="p-2.5 rounded bg-slate-100 dark:bg-[#0d1117] border border-slate-200 dark:border-kin-border font-mono text-[11px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-all">
                {code}
              </pre>
            </div>

            {/* Warning if dangerous */}
            {isDangerousCommand && (
              <div className="flex items-start space-x-2.5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-600/40 text-amber-800 dark:text-amber-200 text-xs">
                <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Caution: High Impact Operation</span>
                  <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                    This command contains destructive flags (e.g. forced removal or reset). Verify your parameters before executing.
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end space-x-2.5 pt-2 border-t border-slate-200 dark:border-kin-border">
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-kin-border text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-kin-card transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecute}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-sm transition flex items-center space-x-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Confirm & Dispatch</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
