// ============================================================================
// KIN CONTEXT SPILL ENGINE
// Intercepts oversized tool outputs (>2KB), persists raw content to disk,
// and injects bounded previews to prevent context window bloat.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { homedir } from 'node:os';

export interface SpillResult {
  isSpilled: boolean;
  content: string; // The inline content (either original or bounded preview)
  spillUri?: string;
  originalBytes: number;
  hash?: string;
}

export class OutputSpiller {
  private readonly spillDir: string;
  private readonly thresholdBytes: number;

  constructor(options: { spillDir?: string; thresholdBytes?: number } = {}) {
    const defaultHome = process.env.KIN_HOME || path.join(homedir(), '.kin');
    this.spillDir = options.spillDir || path.join(defaultHome, 'spill');
    this.thresholdBytes = options.thresholdBytes ?? 2048; // 2KB default

    if (!fs.existsSync(this.spillDir)) {
      fs.mkdirSync(this.spillDir, { recursive: true });
    }
  }

  /**
   * Evaluates tool output. If exceeding threshold, writes raw payload to disk
   * and returns a bounded preview with an unforgeable file pointer.
   */
  public processOutput(output: string, sourceCommand?: string): SpillResult {
    const buffer = Buffer.from(output, 'utf-8');
    const byteLength = buffer.byteLength;

    if (byteLength <= this.thresholdBytes) {
      return {
        isSpilled: false,
        content: output,
        originalBytes: byteLength,
      };
    }

    // Compute cryptographic SHA-256 hash for content-addressed deduplication
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const fileName = `${hash}.log`;
    const filePath = path.join(this.spillDir, fileName);

    // Write raw output to spill file if not already present
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
    }

    // Create a bounded preview (first 10 lines + last 5 lines)
    const lines = output.split(/\r?\n/);
    const totalLines = lines.length;
    let previewExcerpt: string;

    if (totalLines <= 15) {
      previewExcerpt = output;
    } else {
      const head = lines.slice(0, 10).join('\n');
      const tail = lines.slice(-5).join('\n');
      const omitted = totalLines - 15;
      previewExcerpt = `${head}\n... [${omitted} lines (${byteLength} bytes) spilled to disk] ...\n${tail}`;
    }

    const fileUri = `file:///${filePath.replace(/\\/g, '/')}`;
    const header = sourceCommand ? `[Command: ${sourceCommand}]` : `[Tool Output]`;
    const formattedContent = `${header}\n${previewExcerpt}\n\n[Full raw output (${byteLength} bytes) persisted at: ${fileUri}. To read full or segmented contents, invoke tool 'read_spill' with hash "${hash}". Do not call readFile directly on the spill file path.]`;

    return {
      isSpilled: true,
      content: formattedContent,
      spillUri: fileUri,
      originalBytes: byteLength,
      hash,
    };
  }

  public readSpillFile(hashOrFileName: string): string {
    if (!/^[a-f0-9]{64}(\.log)?$/i.test(hashOrFileName.trim())) {
      throw new Error(`Invalid spill hash or file name format: '${hashOrFileName}'`);
    }
    const fileName = hashOrFileName.trim().endsWith('.log') ? hashOrFileName.trim() : `${hashOrFileName.trim()}.log`;
    const filePath = path.join(this.spillDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Spill file not found: ${filePath}`);
    }
    const canonicalPath = fs.realpathSync(filePath);
    const canonicalSpillDir = fs.existsSync(this.spillDir) ? fs.realpathSync(this.spillDir) : path.resolve(this.spillDir);
    const relative = path.relative(canonicalSpillDir, canonicalPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Directory traversal violation: Spill file '${filePath}' escapes spill directory.`);
    }
    return fs.readFileSync(canonicalPath, 'utf-8');
  }
}
