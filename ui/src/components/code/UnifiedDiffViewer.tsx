import React, { useState, useMemo } from 'react';
import { Copy, Check, FileText, AlertCircle, WrapText } from 'lucide-react';

export interface DiffLine {
  type: 'context' | 'add' | 'delete' | 'hunk-header' | 'file-header';
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  heading?: string;
  lines: DiffLine[];
}

export interface ParsedDiff {
  fileHeader: string[];
  hunks: DiffHunk[];
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Robust pure parser for standard unified diff format (git diff / diff -u).
 * Correctly parses hunk headers `@@ -a,b +c,d @@` and maps dual line numbers.
 */
export function parseUnifiedDiff(rawDiff: string): ParsedDiff {
  const result: ParsedDiff = {
    fileHeader: [],
    hunks: [],
    totalAdditions: 0,
    totalDeletions: 0,
  };

  if (!rawDiff || typeof rawDiff !== 'string') {
    return result;
  }

  const lines = rawDiff.split('\n');
  let currentHunk: DiffHunk | null = null;
  let currentOldLine = 0;
  let currentNewLine = 0;
  let inHunk = false;

  const hunkHeaderRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(hunkHeaderRegex);

    if (match) {
      inHunk = true;
      const oldStart = parseInt(match[1], 10);
      const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
      const newStart = parseInt(match[3], 10);
      const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;
      const heading = (match[5] || '').trim();

      currentOldLine = oldStart;
      currentNewLine = newStart;

      currentHunk = {
        header: line,
        oldStart,
        oldCount,
        newStart,
        newCount,
        heading,
        lines: [],
      };
      result.hunks.push(currentHunk);
      continue;
    }

    if (!inHunk) {
      result.fileHeader.push(line);
      continue;
    }

    if (currentHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        result.totalAdditions++;
        currentHunk.lines.push({
          type: 'add',
          text: line.slice(1),
          newLineNumber: currentNewLine++,
        });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        result.totalDeletions++;
        currentHunk.lines.push({
          type: 'delete',
          text: line.slice(1),
          oldLineNumber: currentOldLine++,
        });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          text: line.slice(1),
          oldLineNumber: currentOldLine++,
          newLineNumber: currentNewLine++,
        });
      } else if (line.startsWith('\\')) {
        // e.g. \ No newline at end of file
        currentHunk.lines.push({
          type: 'context',
          text: line,
        });
      } else if (line.startsWith('diff --git') || line.startsWith('index ')) {
        // Next file diff header
        inHunk = false;
        currentHunk = null;
        result.fileHeader.push(line);
      } else {
        // Treat as context fallback
        currentHunk.lines.push({
          type: 'context',
          text: line,
          oldLineNumber: currentOldLine++,
          newLineNumber: currentNewLine++,
        });
      }
    }
  }

  return result;
}

export interface UnifiedDiffViewerProps {
  diff: string;
  filePath?: string;
  isBinary?: boolean;
  isLoading?: boolean;
  className?: string;
  onStage?: () => void;
  onRevert?: () => void;
}

export const UnifiedDiffViewer: React.FC<UnifiedDiffViewerProps> = ({
  diff,
  filePath,
  isBinary,
  isLoading,
  className = '',
  onStage,
  onRevert,
}) => {
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);

  const parsed = useMemo(() => parseUnifiedDiff(diff || ''), [diff]);

  const handleCopy = () => {
    if (!diff) return;
    navigator.clipboard.writeText(diff);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className={`p-8 text-center text-slate-500 font-mono text-xs ${className}`}>
        <div className="inline-block animate-spin mr-2">⚙️</div> Loading diff...
      </div>
    );
  }

  if (isBinary || (diff && (diff.includes('Binary files ') || diff.includes('\0') || diff.startsWith('GIT binary patch')))) {
    return (
      <div className={`p-8 text-center space-y-2 font-mono text-xs bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-800 ${className}`}>
        <AlertCircle className="w-8 h-8 mx-auto text-amber-500" />
        <p className="font-semibold text-slate-800 dark:text-slate-200">Binary File Detected</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Unified text diff cannot be computed for binary asset files ({filePath || 'active file'}).
        </p>
      </div>
    );
  }

  if (!diff || parsed.hunks.length === 0) {
    return (
      <div className={`p-8 text-center space-y-2 font-mono text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/20 rounded-lg border border-slate-200 dark:border-slate-800 ${className}`}>
        <FileText className="w-8 h-8 mx-auto text-slate-400 dark:text-slate-600" />
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">No Differences Detected</p>
        <p className="text-[11px]">Working tree matches HEAD or file is clean.</p>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={`Diff view for ${filePath || 'file'}`}
      className={`flex flex-col bg-white dark:bg-[#060911] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden font-mono text-xs shadow-xs ${className}`}
    >
      {/* Diff Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-100 dark:bg-[#0c1322] border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 gap-2">
        <div className="flex items-center space-x-2 min-w-0">
          <FileText className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="font-bold text-slate-800 dark:text-slate-200 truncate" title={filePath}>
            {filePath || 'Diff Viewer'}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-300 dark:border-emerald-800/40">
            +{parsed.totalAdditions}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400 font-bold border border-red-300 dark:border-red-800/40">
            -{parsed.totalDeletions}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {onStage && (
            <button
              type="button"
              onClick={onStage}
              className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition cursor-pointer"
              title="Stage these changes to git index"
            >
              Stage File
            </button>
          )}
          {onRevert && (
            <button
              type="button"
              onClick={onRevert}
              className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold transition cursor-pointer"
              title="Discard / revert uncommitted changes in this file"
            >
              Discard Changes
            </button>
          )}
          <button
            type="button"
            onClick={() => setWrapLines(!wrapLines)}
            className={`p-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-white transition cursor-pointer ${
              wrapLines ? 'bg-slate-200 dark:bg-slate-800 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Toggle line wrapping"
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-white transition cursor-pointer"
            title="Copy raw unified diff to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Diff Table */}
      <div className="overflow-x-auto overflow-y-auto max-h-[600px] select-text">
        <div className="min-w-full inline-block">
          {parsed.hunks.map((hunk, hIdx) => (
            <div key={hIdx} className="border-b border-slate-200 dark:border-slate-800/60 last:border-b-0">
              {/* Hunk Header */}
              <div className="px-3 py-1 bg-blue-50/80 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-bold border-y border-blue-200/50 dark:border-blue-900/30 text-[11px] flex items-center justify-between">
                <span>{hunk.header}</span>
                {hunk.heading && (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal truncate max-w-xs">
                    {hunk.heading}
                  </span>
                )}
              </div>

              {/* Hunk Lines */}
              <div className="divide-y divide-slate-100 dark:divide-slate-900/30">
                {hunk.lines.map((line, lIdx) => {
                  const isAdd = line.type === 'add';
                  const isDel = line.type === 'delete';

                  let rowBg = 'hover:bg-slate-50 dark:hover:bg-slate-900/40 text-slate-700 dark:text-slate-300';
                  let symbol = ' ';
                  let borderLeft = 'border-l-2 border-transparent';

                  if (isAdd) {
                    rowBg = 'bg-emerald-50/80 dark:bg-emerald-950/35 text-emerald-900 dark:text-emerald-300 hover:bg-emerald-100/60 dark:hover:bg-emerald-950/50';
                    symbol = '+';
                    borderLeft = 'border-l-2 border-emerald-500';
                  } else if (isDel) {
                    rowBg = 'bg-red-50/80 dark:bg-red-950/35 text-red-900 dark:text-red-300 hover:bg-red-100/60 dark:hover:bg-red-950/50';
                    symbol = '-';
                    borderLeft = 'border-l-2 border-red-500';
                  }

                  return (
                    <div
                      key={lIdx}
                      className={`flex items-start text-[11px] leading-5 font-mono ${rowBg} ${borderLeft} transition-colors`}
                    >
                      {/* Old Line Number */}
                      <span className="w-10 text-right pr-2 text-slate-400 dark:text-slate-600 select-none shrink-0 font-mono text-[10px]">
                        {line.oldLineNumber !== undefined ? line.oldLineNumber : ''}
                      </span>
                      {/* New Line Number */}
                      <span className="w-10 text-right pr-2 text-slate-400 dark:text-slate-600 select-none shrink-0 font-mono text-[10px] border-r border-slate-200 dark:border-slate-800">
                        {line.newLineNumber !== undefined ? line.newLineNumber : ''}
                      </span>
                      {/* Operation Symbol (+/-/space) */}
                      <span
                        className={`w-5 text-center select-none shrink-0 font-bold ${
                          isAdd ? 'text-emerald-600 dark:text-emerald-400' : isDel ? 'text-red-600 dark:text-red-400' : 'text-slate-400'
                        }`}
                      >
                        {symbol}
                      </span>
                      {/* Line Content */}
                      <span className={`flex-1 pr-3 ${wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
                        {line.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
