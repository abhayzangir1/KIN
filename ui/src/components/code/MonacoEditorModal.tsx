import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, Check, Save, FileCode, GitCompare, Search, ShieldCheck } from 'lucide-react';
import { UnifiedDiffViewer } from './UnifiedDiffViewer.js';

export interface MonacoEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName?: string;
  filePath?: string;
  initialContent?: string;
  language?: string;
  diffContent?: string;
  readOnly?: boolean;
  onSave?: (content: string) => Promise<boolean | void> | boolean | void;
}

export const MonacoEditorModal: React.FC<MonacoEditorModalProps> = ({
  isOpen,
  onClose,
  fileName = 'file.txt',
  filePath = '',
  initialContent = '',
  language = 'typescript',
  diffContent = '',
  readOnly = false,
  onSave,
}) => {
  const [content, setContent] = useState(initialContent);
  const [activeTab, setActiveTab] = useState<'editor' | 'diff'>('editor');
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  // Synchronize line numbers scroll with textarea
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const lines = content.split('\n');
  const lineCount = lines.length;

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (!onSave || readOnly) return;
    setIsSaving(true);
    try {
      await onSave(content);
    } finally {
      setIsSaving(false);
    }
  };

  // Compute a simple unified diff on the fly if no diffContent is provided
  const computedDiff = diffContent || (content !== initialContent ? `--- a/${fileName}\n+++ b/${fileName}\n@@ -1,${initialContent.split('\n').length} +1,${lines.length} @@\n${initialContent.split('\n').map(l => '-' + l).join('\n')}\n${lines.map(l => '+' + l).join('\n')}` : '');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="monaco-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm animate-fadeIn"
    >
      <div className="relative w-full max-w-5xl h-[85vh] flex flex-col bg-white dark:bg-[#090d16] border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100 dark:bg-[#0d1424] border-b border-slate-200 dark:border-slate-800 text-xs font-mono">
          <div className="flex items-center space-x-3 min-w-0">
            <FileCode className="w-4 h-4 text-blue-500 shrink-0" />
            <div className="min-w-0">
              <span id="monaco-editor-title" className="font-bold text-slate-800 dark:text-slate-200 truncate">
                {fileName}
              </span>
              {filePath && (
                <span className="ml-2 text-[10px] text-slate-500 dark:text-slate-400 truncate hidden sm:inline">
                  {filePath}
                </span>
              )}
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold uppercase border border-blue-200 dark:border-blue-900/50">
              {language}
            </span>
            <div className="flex items-center space-x-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
              <ShieldCheck className="w-3 h-3 shrink-0" />
              <span>Offline / Air-Gapped</span>
            </div>
          </div>

          {/* Tab Switcher & Window Controls */}
          <div className="flex items-center space-x-2 shrink-0">
            <div className="flex rounded-lg bg-slate-200 dark:bg-[#05070d] p-0.5 border border-slate-300 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setActiveTab('editor')}
                className={`px-3 py-1 rounded text-xs font-medium transition cursor-pointer flex items-center space-x-1.5 ${
                  activeTab === 'editor'
                    ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Code Editor</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('diff')}
                className={`px-3 py-1 rounded text-xs font-medium transition cursor-pointer flex items-center space-x-1.5 ${
                  activeTab === 'diff'
                    ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>Diff Review</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Close modal (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#070b14] overflow-hidden">
          {activeTab === 'editor' ? (
            <div className="flex-1 flex flex-col min-h-0 relative">
              {/* Secondary Toolbar */}
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 dark:bg-[#0a0f1d] border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <div className="flex items-center space-x-3">
                  <span>Lines: {lineCount}</span>
                  <span>Chars: {content.length}</span>
                  {readOnly && (
                    <span className="px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/40 text-[9px] uppercase font-bold">
                      Read Only
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsSearchOpen(!isSearchOpen)}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                    title="Find in document (Ctrl+F)"
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold flex items-center space-x-1 cursor-pointer transition"
                    title="Copy full content"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  {onSave && !readOnly && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={handleSave}
                      className="px-3 py-0.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[10px] font-bold flex items-center space-x-1 cursor-pointer shadow-xs transition"
                    >
                      <Save className="w-3 h-3" />
                      <span>{isSaving ? 'Saving...' : 'Save File'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Search Bar Flyout */}
              {isSearchOpen && (
                <div className="flex items-center space-x-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 border-b border-blue-200 dark:border-blue-900/40 animate-fadeIn text-xs">
                  <Search className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Find in file..."
                    className="flex-1 bg-white dark:bg-[#070b14] border border-blue-300 dark:border-blue-700 rounded px-2 py-0.5 text-slate-900 dark:text-slate-100 font-mono text-xs focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setIsSearchOpen(false)}
                    className="p-0.5 hover:text-slate-900 dark:hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Code Canvas with Line Numbers */}
              <div className="flex-1 flex overflow-hidden font-mono text-xs">
                {/* Line Numbers Column */}
                <div
                  ref={lineNumbersRef}
                  className="w-12 py-3 bg-slate-100 dark:bg-[#060a12] border-r border-slate-200 dark:border-slate-800 text-right pr-2 text-slate-400 dark:text-slate-600 select-none overflow-hidden shrink-0"
                >
                  {Array.from({ length: lineCount }).map((_, idx) => (
                    <div key={idx} className="leading-5 h-5 text-[11px]">
                      {idx + 1}
                    </div>
                  ))}
                </div>

                {/* Editor Textarea */}
                <div className="flex-1 relative overflow-hidden bg-white dark:bg-[#04060c]">
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => !readOnly && setContent(e.target.value)}
                    onScroll={handleScroll}
                    readOnly={readOnly}
                    spellCheck={false}
                    className="w-full h-full p-3 font-mono text-xs leading-5 bg-transparent text-slate-900 dark:text-slate-100 resize-none border-none outline-none focus:outline-none focus:ring-0 whitespace-pre overflow-auto"
                    placeholder="Enter or inspect code..."
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 p-3 overflow-y-auto">
              <UnifiedDiffViewer
                diff={computedDiff}
                filePath={fileName}
                className="h-full"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
