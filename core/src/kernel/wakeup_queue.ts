// ============================================================================
// KIN EVENT-DRIVEN COALESCED WAKEUP QUEUE
// Throttles and coalesces redundant agent wakeups, scheduler alarms,
// and recovery triggers within a 1000ms debounce window.
// Prevents CPU/RAM thrashing under burst event streams and honors system memory limits.
// ============================================================================

import { freemem } from 'node:os';
import { HardwareProfiler } from '../evaluation/hardware_profiler.js';

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
    firstEnqueuedAt: number;
  }> = new Map();
  private handler?: WakeupHandler;
  private inFlightByKey: Map<string, Promise<void>> = new Map();
  private minFreeMemMb: number = 300;

  // Telemetry metrics
  private totalEnqueued: number = 0;
  private totalProcessed: number = 0;
  private totalCoalesced: number = 0;

  constructor(debounceWindowMs: number = 1000, handler?: WakeupHandler) {
    this.debounceWindowMs = debounceWindowMs;
    this.handler = handler;
    try {
      const profiler = new HardwareProfiler();
      const tier = profiler.classifyTier(profiler.detectHostHardware());
      this.minFreeMemMb = tier === 'baseline_laptop' ? 200 : 300;
    } catch {
      this.minFreeMemMb = 300;
    }
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

    // Check system memory governor: defer wakeup if free memory is critically low
    const freeMemMb = freemem() / (1024 * 1024);
    const isLowMemory = freeMemMb < this.minFreeMemMb;
    if (isLowMemory) {
      console.warn(`[WakeupQueue] Low system memory detected (${Math.round(freeMemMb)}MB free < ${this.minFreeMemMb}MB). Deferring dispatch.`);
    }

    const effectiveDebounceMs = isLowMemory ? Math.max(this.debounceWindowMs, 3000) : this.debounceWindowMs;
    const maxWaitMs = isLowMemory ? 8000 : 5000;
    const existing = this.pendingEntries.get(key);

    if (existing) {
      // Coalesce duplicate wakeup
      this.totalCoalesced++;
      existing.coalescedCount++;
      existing.event = event; // Keep latest payload

      // If maxWait ceiling reached from firstEnqueuedAt, do not postpone timer
      const elapsed = now - existing.firstEnqueuedAt;
      if (elapsed + effectiveDebounceMs > maxWaitMs) {
        return {
          action: isLowMemory ? 'deferred_memory' : 'coalesced',
          targetKey: key,
          coalescedCount: existing.coalescedCount,
          scheduledDispatchAt: existing.scheduledAt,
        };
      }

      clearTimeout(existing.timer);
      const scheduledAt = now + effectiveDebounceMs;
      existing.scheduledAt = scheduledAt;

      existing.timer = setTimeout(() => {
        this.dispatch(key).catch((err) => {
          console.error(`[WakeupQueue] Error dispatching wakeup for key '${key}':`, err);
        });
      }, effectiveDebounceMs);
      if (typeof (existing.timer as any).unref === 'function') {
        (existing.timer as any).unref();
      }

      return {
        action: isLowMemory ? 'deferred_memory' : 'coalesced',
        targetKey: key,
        coalescedCount: existing.coalescedCount,
        scheduledDispatchAt: scheduledAt,
      };
    }

    // New wakeup entry
    const scheduledAt = now + effectiveDebounceMs;
    const timer = setTimeout(() => {
      this.dispatch(key).catch((err) => {
        console.error(`[WakeupQueue] Error dispatching wakeup for key '${key}':`, err);
      });
    }, effectiveDebounceMs);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }

    this.pendingEntries.set(key, {
      event,
      coalescedCount: 1,
      timer,
      scheduledAt,
      firstEnqueuedAt: now,
    });

    return {
      action: isLowMemory ? 'deferred_memory' : 'scheduled',
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

    if (!this.handler) return;

    const prior = this.inFlightByKey.get(key) || Promise.resolve();
    const runNext = prior.then(async () => {
      try {
        await this.handler!(entry.event, entry.coalescedCount);
      } catch (err) {
        console.error(`[WakeupQueue] Error dispatching wakeup for key '${key}':`, err);
      }
    });
    const tracked = runNext.finally(() => {
      if (this.inFlightByKey.get(key) === tracked) {
        this.inFlightByKey.delete(key);
      }
    });
    this.inFlightByKey.set(key, tracked);
    await tracked;
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
    const dispatches: Promise<void>[] = [];
    for (const key of keys) {
      const entry = this.pendingEntries.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        dispatches.push(this.dispatch(key));
      }
    }
    await Promise.all(dispatches);
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
