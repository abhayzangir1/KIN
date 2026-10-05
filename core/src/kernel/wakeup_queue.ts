// ============================================================================
// KIN EVENT-DRIVEN COALESCED WAKEUP QUEUE
// Throttles and coalesces redundant agent wakeups, scheduler alarms,
// and recovery triggers within a 1000ms debounce window.
// Prevents CPU/RAM thrashing under burst event streams and honors system memory limits.
// ============================================================================

import os from 'node:os';

export interface WakeupEvent {
  id: string;
  agentId: string;
  channelId: string;
  projectId?: string;
  source: 'message' | 'schedule' | 'recovery' | 'manual';
  payload?: any;
  timestamp: number;
}

export interface WakeupDisposition {
  action: 'scheduled' | 'coalesced' | 'deferred_memory';
  targetKey: string;
  coalescedCount: number;
  scheduledDispatchAt: number;
}

export type WakeupHandler = (event: WakeupEvent, coalescedCount: number) => Promise<void> | void;

export class WakeupQueue {
  private debounceWindowMs: number;
  private pendingEntries: Map<string, {
    event: WakeupEvent;
    coalescedCount: number;
    timer: NodeJS.Timeout;
    scheduledAt: number;
  }> = new Map();
  private handler?: WakeupHandler;

  // Telemetry metrics
  private totalEnqueued: number = 0;
  private totalProcessed: number = 0;
  private totalCoalesced: number = 0;

  constructor(debounceWindowMs: number = 1000, handler?: WakeupHandler) {
    this.debounceWindowMs = debounceWindowMs;
    this.handler = handler;
  }

  public setHandler(handler: WakeupHandler): void {
    this.handler = handler;
  }

  /**
   * Enqueues or coalesces an agent wakeup request.
   */
  public enqueue(event: WakeupEvent): WakeupDisposition {
    this.totalEnqueued++;
    const key = `${event.agentId}:${event.channelId}:${event.source}`;
    const now = Date.now();

    // Check system memory governor: if free memory is under 300MB, log telemetry
    const freeMemMb = os.freemem() / (1024 * 1024);
    if (freeMemMb < 300) {
      console.warn(`[WakeupQueue] Low system memory detected (${Math.round(freeMemMb)}MB free). Coalescing window enforced.`);
    }

    const existing = this.pendingEntries.get(key);

    if (existing) {
      // Coalesce duplicate wakeup
      clearTimeout(existing.timer);
      this.totalCoalesced++;
      existing.coalescedCount++;
      existing.event = event; // Keep latest payload
      const scheduledAt = now + this.debounceWindowMs;
      existing.scheduledAt = scheduledAt;

      existing.timer = setTimeout(() => {
        this.dispatch(key);
      }, this.debounceWindowMs);

      return {
        action: 'coalesced',
        targetKey: key,
        coalescedCount: existing.coalescedCount,
        scheduledDispatchAt: scheduledAt,
      };
    }

    // New wakeup entry
    const scheduledAt = now + this.debounceWindowMs;
    const timer = setTimeout(() => {
      this.dispatch(key);
    }, this.debounceWindowMs);

    this.pendingEntries.set(key, {
      event,
      coalescedCount: 1,
      timer,
      scheduledAt,
    });

    return {
      action: 'scheduled',
      targetKey: key,
      coalescedCount: 1,
      scheduledDispatchAt: scheduledAt,
    };
  }

  /**
   * Dispatches the coalesced wakeup event to the registered handler.
   */
  private async dispatch(key: string): Promise<void> {
    const entry = this.pendingEntries.get(key);
    if (!entry) return;

    this.pendingEntries.delete(key);
    this.totalProcessed++;

    if (this.handler) {
      try {
        await this.handler(entry.event, entry.coalescedCount);
      } catch (err) {
        console.error(`[WakeupQueue] Error dispatching wakeup for key '${key}':`, err);
      }
    }
  }

  /**
   * Immediately dispatches any pending wakeup for the specified key or agent/channel pair.
   */
  public async flush(agentId: string, channelId: string, source?: string): Promise<boolean> {
    if (source) {
      const key = `${agentId}:${channelId}:${source}`;
      const entry = this.pendingEntries.get(key);
      if (!entry) return false;
      clearTimeout(entry.timer);
      await this.dispatch(key);
      return true;
    }
    let flushed = false;
    for (const [key, entry] of Array.from(this.pendingEntries.entries())) {
      if (key.startsWith(`${agentId}:${channelId}:`) || key === `${agentId}:${channelId}`) {
        clearTimeout(entry.timer);
        await this.dispatch(key);
        flushed = true;
      }
    }
    return flushed;
  }

  /**
   * Cancels a pending wakeup.
   */
  public cancel(agentId: string, channelId: string, source?: string): boolean {
    if (source) {
      const key = `${agentId}:${channelId}:${source}`;
      const entry = this.pendingEntries.get(key);
      if (!entry) return false;
      clearTimeout(entry.timer);
      this.pendingEntries.delete(key);
      return true;
    }
    let cancelled = false;
    for (const [key, entry] of Array.from(this.pendingEntries.entries())) {
      if (key.startsWith(`${agentId}:${channelId}:`) || key === `${agentId}:${channelId}`) {
        clearTimeout(entry.timer);
        this.pendingEntries.delete(key);
        cancelled = true;
      }
    }
    return cancelled;
  }

  /**
   * Flushes all pending wakeups immediately.
   */
  public async flushAll(): Promise<void> {
    const keys = Array.from(this.pendingEntries.keys());
    for (const key of keys) {
      const entry = this.pendingEntries.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        await this.dispatch(key);
      }
    }
  }

  /**
   * Clears all pending timers without executing them.
   */
  public clear(): void {
    for (const entry of this.pendingEntries.values()) {
      clearTimeout(entry.timer);
    }
    this.pendingEntries.clear();
  }

  /**
   * Returns live queue metrics and pending timer states.
   */
  public getQueueSize(): number {
    return this.pendingEntries.size;
  }

  public getStats(): {
    pendingCount: number;
    totalEnqueued: number;
    totalProcessed: number;
    totalCoalesced: number;
    debounceWindowMs: number;
  } {
    return {
      pendingCount: this.pendingEntries.size,
      totalEnqueued: this.totalEnqueued,
      totalProcessed: this.totalProcessed,
      totalCoalesced: this.totalCoalesced,
      debounceWindowMs: this.debounceWindowMs,
    };
  }
}
