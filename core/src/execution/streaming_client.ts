// ============================================================================
// KIN STREAMING INFERENCE CLIENT
// Resilient Server-Sent Events (SSE) streaming with stall guards,
// partial token accumulation, thinking token extraction, and clean cancellation.
// Aligned with PRD § 8 and TRD § 7.
// ============================================================================

export interface StreamingChunk {
  type: 'text' | 'thinking' | 'tool_call_chunk' | 'done' | 'error';
  text?: string;
  thinking?: string;
  toolCall?: {
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  raw?: any;
}

export class StreamingInferenceClient {
  public static readonly DEFAULT_CHUNK_TIMEOUT_MS = 30000;

  /**
   * Reads a chunk from a ReadableStreamDefaultReader with a timeout stall guard.
   */
  public static async readChunkWithTimeout<T = any>(
    reader: { read(): Promise<{ done: boolean; value?: T }> },
    timeoutMs: number = StreamingInferenceClient.DEFAULT_CHUNK_TIMEOUT_MS
  ): Promise<{ done: boolean; value?: T }> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<{ done: boolean; value?: T }>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Inference stream chunk read timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    try {
      const readPromise = reader.read();
      const result = await Promise.race([readPromise, timeoutPromise]);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Parses an SSE data buffer, yielding parsed JSON payloads and handling trailing chunks.
   */
  public static parseSseLines(
    buffer: string,
    onData: (payload: any, isDone: boolean) => void
  ): string {
    const lines = buffer.split('\n');
    const remaining = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) continue;

      if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]') {
          onData(null, true);
        } else {
          try {
            const parsed = JSON.parse(dataStr);
            onData(parsed, false);
          } catch {
            // Ignore malformed intermediate JSON fragments
          }
        }
      }
    }

    return remaining;
  }

  /**
   * Flushes any remaining trailing SSE buffer when stream terminates.
   */
  public static flushSseBuffer(
    buffer: string,
    onData: (payload: any, isDone: boolean) => void
  ): void {
    const trimmed = buffer.trim();
    if (!trimmed || trimmed.startsWith(':')) return;

    if (trimmed.startsWith('data:')) {
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') {
        onData(null, true);
      } else {
        try {
          const parsed = JSON.parse(dataStr);
          onData(parsed, false);
        } catch {}
      }
    }
  }

  /**
   * Extracts Anthropic streaming tool call fragments from content block events.
   */
  public static parseAnthropicStreamEvent(event: any): StreamingChunk | null {
    if (!event || typeof event !== 'object') return null;

    if (event.type === 'content_block_start') {
      if (event.content_block?.type === 'tool_use') {
        return {
          type: 'tool_call_chunk',
          toolCall: {
            id: event.content_block.id,
            name: event.content_block.name,
            argumentsDelta: '',
          },
        };
      }
    }

    if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta') {
        return {
          type: 'text',
          text: event.delta.text,
        };
      }
      if (event.delta?.type === 'thinking_delta') {
        return {
          type: 'thinking',
          thinking: event.delta.thinking,
        };
      }
      if (event.delta?.type === 'input_json_delta') {
        return {
          type: 'tool_call_chunk',
          toolCall: {
            argumentsDelta: event.delta.partial_json,
          },
        };
      }
    }

    if (event.type === 'message_stop') {
      return { type: 'done' };
    }

    return null;
  }
}
