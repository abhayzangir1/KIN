// ============================================================================
// KIN CONTEXT SPILL ENGINE
// Intercepts oversized tool outputs (>2KB), persists raw content to disk,
// and injects bounded previews to prevent context window bloat.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';

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
    const defaultHome = process.env.KIN_HOME || path.join(os.homedir(), '.kin');
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
    const formattedContent = `${header}\n${previewExcerpt}\n\n[Full raw output (${byteLength} bytes) persisted at: ${fileUri}]`;

    return {
      isSpilled: true,
      content: formattedContent,
      spillUri: fileUri,
      originalBytes: byteLength,
      hash,
    };
  }

  public readSpillFile(hashOrFileName: string): string {
    const fileName = hashOrFileName.endsWith('.log') ? hashOrFileName : `${hashOrFileName}.log`;
    const filePath = path.join(this.spillDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Spill file not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf-8');
  }
}
