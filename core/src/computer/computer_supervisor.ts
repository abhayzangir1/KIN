// ============================================================================
// KIN DYNAMIC COMPUTER SUPERVISOR & HARDWARE CONCURRENCY GOVERNOR
// Shared Chromium engine with isolated BrowserContext per agent,
// per-agent persistent profile directories, 3-minute idle eviction,
// dynamic adaptive RAM concurrency limiter, and Win32 DesktopLock mutex.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer-core';
import { BrowserController, WebStepAction, WebStepResult } from '../browser/browser_controller.js';

export type ComputerTier = 'TIER_0' | 'TIER_1' | 'TIER_2';

export interface GovernorStatus {
  totalMemBytes: number;
  freeMemBytes: number;
  freeMemGB: number;
  tier: 'low' | 'medium' | 'high';
  maxBrowserContexts: number;
  maxShellProcesses: number;
  activeBrowserContexts: number;
  activeShellProcesses: number;
  queuedBrowserRequests: number;
  queuedShellRequests: number;
}

export interface AgentBrowserSession {
  agentId: string;
  context: BrowserContext;
  page: Page;
  profileDir: string;
  createdAt: number;
  lastActiveAt: number;
  stepHistory: WebStepResult[];
}

export class ComputerSupervisor {
  private masterBrowser: Browser | null = null;
  private masterBrowserLaunchPromise: Promise<Browser> | null = null;
  private agentSessions: Map<string, AgentBrowserSession> = new Map();
  private baseProfileDir: string;
  private idleEvictionInterval: NodeJS.Timeout | null = null;
  private readonly idleThresholdMs: number = 3 * 60 * 1000; // 3 minutes

  // DesktopLock Mutex for Win32 GUI Control
  private desktopLockOwner: string | null = null;
  private desktopLockAcquiredAt: number | null = null;
  private desktopLockWaiters: Array<{
    agentId: string;
    resolve: (acquired: boolean) => void;
    timer: NodeJS.Timeout;
  }> = [];

  // Hardware Concurrency Governor Queues
  private activeShellCount: number = 0;
  private shellQueue: Array<() => void> = [];
  private browserQueue: Array<() => void> = [];
  private pendingBrowserAllocations: Set<string> = new Set();
  private agentControllers: Map<string, BrowserController> = new Map();

  // Per-Agent Active Tiers
  private agentTiers: Map<string, ComputerTier> = new Map();

  constructor(options?: { baseProfileDir?: string; idleThresholdMs?: number }) {
    this.baseProfileDir = options?.baseProfileDir || path.resolve(process.cwd(), '.kin', 'browser_profiles');
    if (options?.idleThresholdMs) {
      this.idleThresholdMs = options.idleThresholdMs;
    }

    if (!fs.existsSync(this.baseProfileDir)) {
      fs.mkdirSync(this.baseProfileDir, { recursive: true });
    }

    // Start 30-second interval for 3-minute idle context eviction
    this.startIdleEvictionWatchdog();
  }

  // ---------------------------------------------------------------------------
  // 1. Hardware Concurrency Governor (Dynamic Adaptive Limiter)
  // ---------------------------------------------------------------------------

  public getGovernorStatus(): GovernorStatus {
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const freeMemGB = Number((freeMemBytes / (1024 * 1024 * 1024)).toFixed(2));

    let tier: 'low' | 'medium' | 'high' = 'medium';
    let maxBrowserContexts = 2;
    let maxShellProcesses = 2;

    if (freeMemGB < 2.5) {
      tier = 'low';
      maxBrowserContexts = 1;
      maxShellProcesses = 1;
    } else if (freeMemGB > 6.0) {
      tier = 'high';
      maxBrowserContexts = 3;
      maxShellProcesses = 4;
    }

    return {
      totalMemBytes,
      freeMemBytes,
      freeMemGB,
      tier,
      maxBrowserContexts,
      maxShellProcesses,
      activeBrowserContexts: this.agentSessions.size,
      activeShellProcesses: this.activeShellCount,
      queuedBrowserRequests: this.browserQueue.length,
      queuedShellRequests: this.shellQueue.length,
    };
  }

  /**
   * Acquires a concurrency slot for shell execution based on free host memory.
   */
  public async acquireShellSlot(timeoutMs: number = 60000): Promise<() => void> {
    const status = this.getGovernorStatus();

    if (this.activeShellCount < status.maxShellProcesses) {
      this.activeShellCount++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.activeShellCount--;
          const next = this.shellQueue.shift();
          if (next) next();
        }
      };
    }

    // Queue request
    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.shellQueue.indexOf(grant);
        if (idx !== -1) this.shellQueue.splice(idx, 1);
        reject(new Error(`Shell execution slot request timed out after ${timeoutMs}ms due to host memory throttle.`));
      }, timeoutMs);

      const grant = () => {
        clearTimeout(timer);
        this.activeShellCount++;
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.activeShellCount--;
            const next = this.shellQueue.shift();
            if (next) next();
          }
        });
      };

      this.shellQueue.push(grant);
    });
  }

  /**
   * Acquires a browser context slot based on free host memory.
   */
  public async acquireBrowserSlot(agentId: string, timeoutMs: number = 60000): Promise<() => void> {
    // If agent already has an active session, no new slot needed
    if (this.agentSessions.has(agentId)) {
      return () => {};
    }

    const status = this.getGovernorStatus();
    const effectiveActive = this.agentSessions.size + this.pendingBrowserAllocations.size;

    if (effectiveActive < status.maxBrowserContexts) {
      this.pendingBrowserAllocations.add(agentId);
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.pendingBrowserAllocations.delete(agentId);
          const next = this.browserQueue.shift();
          if (next) next();
        }
      };
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.browserQueue.indexOf(grant);
        if (idx !== -1) this.browserQueue.splice(idx, 1);
        reject(new Error(`Browser context slot allocation timed out after ${timeoutMs}ms due to memory pressure.`));
      }, timeoutMs);

      const grant = () => {
        clearTimeout(timer);
        this.pendingBrowserAllocations.add(agentId);
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.pendingBrowserAllocations.delete(agentId);
            const next = this.browserQueue.shift();
            if (next) next();
          }
        });
      };

      this.browserQueue.push(grant);
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Shared Chromium Engine & Isolated Per-Agent BrowserContext Pool
  // ---------------------------------------------------------------------------

  private async ensureMasterBrowser(headless = true): Promise<Browser> {
    if (this.masterBrowser && this.masterBrowser.connected) {
      return this.masterBrowser;
    }

    if (this.masterBrowserLaunchPromise) {
      return this.masterBrowserLaunchPromise;
    }

    this.masterBrowserLaunchPromise = (async () => {
      try {
        const dummyController = new BrowserController();
        const executablePath = dummyController.findBrowserExecutable();
        if (!executablePath) {
          throw new Error('No compatible browser executable found (Google Chrome or Microsoft Edge required).');
        }

        const masterUserDataDir = path.resolve(process.cwd(), '.kin', 'master_browser_engine');
        if (!fs.existsSync(masterUserDataDir)) {
          fs.mkdirSync(masterUserDataDir, { recursive: true });
        }

        this.masterBrowser = await puppeteer.launch({
          executablePath,
          headless: headless ? true : false,
          userDataDir: masterUserDataDir,
          defaultViewport: { width: 1280, height: 800 },
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-size=1280,800',
          ],
        });

        this.masterBrowser.on('disconnected', () => {
          this.masterBrowser = null;
          this.agentSessions.clear();
        });

        return this.masterBrowser;
      } finally {
        this.masterBrowserLaunchPromise = null;
      }
    })();

    return this.masterBrowserLaunchPromise;
  }

  /**
   * Retrieves or provisions an isolated BrowserContext for a specific agent with profile persistence.
   */
  public async getAgentBrowserSession(agentId: string, options: { headless?: boolean } = {}): Promise<AgentBrowserSession> {
    // 1. Check if already active
    const existing = this.agentSessions.get(agentId);
    if (existing && !existing.page.isClosed()) {
      existing.lastActiveAt = Date.now();
      this.agentTiers.set(agentId, 'TIER_1');
      return existing;
    }

    // 2. Memory governor check
    const releaseSlot = await this.acquireBrowserSlot(agentId);

    try {
      // 3. Ensure master browser
      const browser = await this.ensureMasterBrowser(options.headless ?? true);

      // 4. Setup partitioned profile directory: .kin/browser_profiles/<agentId>
      const agentProfileDir = path.join(this.baseProfileDir, agentId);
      if (!fs.existsSync(agentProfileDir)) {
        fs.mkdirSync(agentProfileDir, { recursive: true });
      }

      // 5. Create isolated BrowserContext (incognito context within master browser)
      const context = await browser.createBrowserContext();
      const page = await context.newPage();

      // 6. Restore persisted cookies if present
      const cookiePath = path.join(agentProfileDir, 'cookies.json');
      if (fs.existsSync(cookiePath)) {
        try {
          const rawCookies = fs.readFileSync(cookiePath, 'utf-8');
          const cookies = JSON.parse(rawCookies);
          if (Array.isArray(cookies) && cookies.length > 0) {
            await page.setCookie(...cookies);
          }
        } catch (err) {
          console.warn(`[COMPUTER SUPERVISOR] Could not restore cookies for agent ${agentId}:`, err);
        }
      }

      const session: AgentBrowserSession = {
        agentId,
        context,
        page,
        profileDir: agentProfileDir,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        stepHistory: [],
      };

      this.agentSessions.set(agentId, session);
      this.agentTiers.set(agentId, 'TIER_1');
      return session;
    } finally {
      releaseSlot();
    }
  }

  /**
   * Retrieves or constructs a BrowserController bound to an agent's isolated BrowserContext.
   */
  public async getAgentBrowserController(
    agentId: string,
    options: { headless?: boolean } = {}
  ): Promise<BrowserController> {
    const existingCtrl = this.agentControllers.get(agentId);
    const existingSession = this.agentSessions.get(agentId);
    if (existingCtrl && existingSession && !existingSession.page.isClosed()) {
      existingSession.lastActiveAt = Date.now();
      return existingCtrl;
    }

    const session = await this.getAgentBrowserSession(agentId, options);
    const ctrl = new BrowserController({
      agentId,
      profileDir: session.profileDir,
      page: session.page,
      browser: this.masterBrowser || undefined,
      pageProvider: async () => {
        const s = await this.getAgentBrowserSession(agentId, options);
        return { page: s.page, browser: this.masterBrowser || undefined };
      },
    });

    this.agentControllers.set(agentId, ctrl);
    return ctrl;
  }

  /**
   * Flushes agent session cookies and state to disk.
   */
  public async flushAgentSession(agentId: string): Promise<void> {
    const session = this.agentSessions.get(agentId);
    if (!session || session.page.isClosed()) return;

    try {
      const cookies = await session.page.cookies();
      const cookiePath = path.join(session.profileDir, 'cookies.json');
      fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[COMPUTER SUPERVISOR] Failed to flush cookies for agent ${agentId}:`, err);
    }
  }

  /**
   * Closes an agent's browser context, flushes state to disk, and returns RAM to the host.
   */
  public async closeAgentSession(agentId: string): Promise<void> {
    const session = this.agentSessions.get(agentId);
    if (!session) return;

    await this.flushAgentSession(agentId);

    try {
      await session.context.close();
    } catch {}

    this.agentSessions.delete(agentId);
    this.agentControllers.delete(agentId);
    if (this.agentTiers.get(agentId) === 'TIER_1') {
      this.agentTiers.set(agentId, 'TIER_0');
    }

    // Notify any queued browser allocation
    const next = this.browserQueue.shift();
    if (next) next();
  }

  // ---------------------------------------------------------------------------
  // 3. 3-Minute Idle Eviction Watchdog
  // ---------------------------------------------------------------------------

  private startIdleEvictionWatchdog(): void {
    this.idleEvictionInterval = setInterval(() => {
      this.evictIdleSessions().catch((err) => {
        console.error('[COMPUTER SUPERVISOR EVICTION ERROR]', err);
      });
    }, 30000);
  }

  /**
   * Scans all active agent sessions and evicts those idle past the threshold.
   */
  public async evictIdleSessions(forcedThresholdMs?: number): Promise<string[]> {
    const threshold = forcedThresholdMs ?? this.idleThresholdMs;
    const now = Date.now();
    const evicted: string[] = [];

    for (const [agentId, session] of Array.from(this.agentSessions.entries())) {
      if (now - session.lastActiveAt > threshold) {
        console.log(`[COMPUTER SUPERVISOR] Evicting idle browser context for agent '${agentId}' (idle for ${Math.round((now - session.lastActiveAt) / 1000)}s). Reclaiming RAM.`);
        await this.closeAgentSession(agentId);
        evicted.push(agentId);
      }
    }

    return evicted;
  }

  // ---------------------------------------------------------------------------
  // 4. DesktopLock Mutual Exclusion (Win32 GUI Interactive Control)
  // ---------------------------------------------------------------------------

  public isDesktopLocked(): boolean {
    return this.desktopLockOwner !== null;
  }

  public getDesktopLockOwner(): string | null {
    return this.desktopLockOwner;
  }

  public async acquireDesktopLock(agentId: string, timeoutMs: number = 30000): Promise<boolean> {
    if (this.desktopLockOwner === agentId) {
      return true; // Already holds lock
    }

    if (!this.desktopLockOwner) {
      this.desktopLockOwner = agentId;
      this.desktopLockAcquiredAt = Date.now();
      this.agentTiers.set(agentId, 'TIER_2');
      return true;
    }

    // Lock is held by another agent, wait in serialized queue
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.desktopLockWaiters.findIndex((w) => w.agentId === agentId);
        if (idx !== -1) {
          this.desktopLockWaiters.splice(idx, 1);
        }
        resolve(false);
      }, timeoutMs);

      this.desktopLockWaiters.push({
        agentId,
        resolve,
        timer,
      });
    });
  }

  public releaseDesktopLock(agentId: string): boolean {
    if (this.desktopLockOwner !== agentId) {
      return false;
    }

    this.desktopLockOwner = null;
    this.desktopLockAcquiredAt = null;
    if (this.agentTiers.get(agentId) === 'TIER_2') {
      this.agentTiers.set(agentId, this.agentSessions.has(agentId) ? 'TIER_1' : 'TIER_0');
    }

    // Process next waiter in line
    const nextWaiter = this.desktopLockWaiters.shift();
    if (nextWaiter) {
      clearTimeout(nextWaiter.timer);
      this.desktopLockOwner = nextWaiter.agentId;
      this.desktopLockAcquiredAt = Date.now();
      this.agentTiers.set(nextWaiter.agentId, 'TIER_2');
      nextWaiter.resolve(true);
    }

    return true;
  }

  public async withDesktopLock<T>(agentId: string, fn: () => Promise<T>, timeoutMs: number = 30000): Promise<T> {
    const acquired = await this.acquireDesktopLock(agentId, timeoutMs);
    if (!acquired) {
      throw new Error(`Failed to acquire Win32 DesktopLock for agent '${agentId}' within ${timeoutMs}ms.`);
    }
    try {
      return await fn();
    } finally {
      this.releaseDesktopLock(agentId);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Physical Computer Tiering
  // ---------------------------------------------------------------------------

  public getAgentComputerTier(agentId: string): ComputerTier {
    return this.agentTiers.get(agentId) || 'TIER_0';
  }

  public setAgentComputerTier(agentId: string, tier: ComputerTier): void {
    this.agentTiers.set(agentId, tier);
  }

  // ---------------------------------------------------------------------------
  // 6. Graceful Shutdown & Cleanup
  // ---------------------------------------------------------------------------

  public async shutdown(): Promise<void> {
    if (this.idleEvictionInterval) {
      clearInterval(this.idleEvictionInterval);
      this.idleEvictionInterval = null;
    }

    for (const agentId of Array.from(this.agentSessions.keys())) {
      try {
        await this.closeAgentSession(agentId);
      } catch {}
    }

    if (this.masterBrowser) {
      try {
        await this.masterBrowser.close();
      } catch {}
      this.masterBrowser = null;
    }

    this.desktopLockOwner = null;
    this.desktopLockWaiters.forEach((w) => clearTimeout(w.timer));
    this.desktopLockWaiters = [];
    this.agentControllers.clear();
    this.pendingBrowserAllocations.clear();
  }
}
