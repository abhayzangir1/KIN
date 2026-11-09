// ============================================================================
// KIN DOMAIN: UNIFIED DIFF PARSER
// Robust pure parser for standard unified diff format (git diff / diff -u).
// Correctly parses hunk headers `@@ -a,b +c,d @@` and tracks dual line numbers.
// ============================================================================

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
  additions: number;
  deletions: number;
}

export interface ParsedDiff {
  fileHeader: string[];
  hunks: DiffHunk[];
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Robust pure parser for standard unified diff format.
 * Returns file header, array of hunks with dual line numbers, and total additions/deletions.
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
        additions: 0,
        deletions: 0,
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
        currentHunk.additions++;
        currentHunk.lines.push({
          type: 'add',
          text: line.slice(1),
          newLineNumber: currentNewLine++,
        });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        result.totalDeletions++;
        currentHunk.deletions++;
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
      } else if (line === '') {
        currentHunk.lines.push({
          type: 'context',
          text: '',
          oldLineNumber: currentOldLine++,
          newLineNumber: currentNewLine++,
        });
      }
    }
  }

  return result;
}
