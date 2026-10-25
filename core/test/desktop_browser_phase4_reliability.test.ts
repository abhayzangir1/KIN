import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DesktopController } from '../src/computer/desktop_controller.js';
import { ComputerSupervisor } from '../src/computer/computer_supervisor.js';
import { BrowserController } from '../src/browser/browser_controller.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Phase 4 Desktop & Browser Automation Reliability', () => {
  let desktopController: DesktopController;
  let supervisor: ComputerSupervisor;
  let testProfileDir: string;

  beforeEach(() => {
    testProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-phase4-'));
    desktopController = new DesktopController();
    supervisor = new ComputerSupervisor({
      baseProfileDir: testProfileDir,
      idleThresholdMs: 5000,
    });
  });

  afterEach(async () => {
    try {
      await supervisor.shutdown();
      fs.rmSync(testProfileDir, { recursive: true, force: true });
    } catch {}
  });

  describe('DesktopController Coordinate Hardening & Boundaries', () => {
    it('rejects non-finite, NaN, and invalid coordinate types gracefully', async () => {
      const resNaN = await desktopController.mouseMove(NaN, 100);
      expect(resNaN.success).toBe(false);
      expect(resNaN.error).toContain('Invalid coordinates');

      const resInf = await desktopController.mouseClick(100, Infinity);
      expect(resInf.success).toBe(false);
      expect(resInf.error).toContain('Invalid coordinates');

      const resString = await desktopController.mouseMove('50' as any, 100);
      expect(resString.success).toBe(false);
      expect(resString.error).toContain('Invalid coordinates');
    });

    it('clamps coordinates safely to prevent Win32 integer conversion overflow', async () => {
      // Even if extreme coordinates are passed, it should safely clamp rather than throw syntax exceptions
      const res = await desktopController.mouseMove(999999, 999999);
      if (process.platform === 'win32') {
        expect(res.success).toBe(true);
      } else {
        expect(res.success).toBe(false);
      }
    });

    it('excludes dangerous system interpreters from discovered apps', async () => {
      const apps = await desktopController.discoverInstalledApps();
      expect(Array.isArray(apps)).toBe(true);

      const blockedNames = ['cmd', 'powershell', 'pwsh', 'bash', 'regedit', 'certutil'];
      for (const app of apps) {
        const base = path.basename(app.executablePath, path.extname(app.executablePath)).toLowerCase();
        expect(blockedNames.includes(base)).toBe(false);
      }
    });

    it('captures screen surface or returns robust headless fallback', async () => {
      const capture = await desktopController.captureScreen({ format: 'png' });
      expect(capture.base64).toBeDefined();
      expect(capture.base64.length).toBeGreaterThan(0);
      expect(capture.width).toBeGreaterThan(0);
      expect(capture.height).toBeGreaterThan(0);
      expect(capture.mimeType).toBe('image/png');
    });
  });

  describe('ComputerSupervisor DesktopLock Mutex & Deadlock Reclamation', () => {
    it('manages mutual exclusion for interactive Win32 desktop control', async () => {
      const acquired1 = await supervisor.acquireDesktopLock('agent-orchestrator', 5000);
      expect(acquired1).toBe(true);
      expect(supervisor.isDesktopLocked()).toBe(true);
      expect(supervisor.getDesktopLockOwner()).toBe('agent-orchestrator');

      // Re-acquiring with same agent should succeed immediately (re-entrant)
      const reentrant = await supervisor.acquireDesktopLock('agent-orchestrator', 1000);
      expect(reentrant).toBe(true);

      supervisor.releaseDesktopLock('agent-orchestrator');
      expect(supervisor.isDesktopLocked()).toBe(false);
      expect(supervisor.getDesktopLockOwner()).toBeNull();
    });

    it('automatically reclaims stale DesktopLock held past timeout', async () => {
      // Agent 1 acquires lock
      await supervisor.acquireDesktopLock('agent-stalled', 5000);
      expect(supervisor.getDesktopLockOwner()).toBe('agent-stalled');

      // Simulate lock staleness by inspecting with small threshold (0ms)
      expect(supervisor.isDesktopLockStale(0)).toBe(true);

      const reclaimed = supervisor.reclaimStaleDesktopLock(0);
      expect(reclaimed).toBe(true);
      expect(supervisor.getDesktopLockOwner()).toBeNull();

      // Agent 2 can now acquire immediately
      const acquired2 = await supervisor.acquireDesktopLock('agent-active', 1000);
      expect(acquired2).toBe(true);
      expect(supervisor.getDesktopLockOwner()).toBe('agent-active');
      supervisor.releaseDesktopLock('agent-active');
    });

    it('adapts concurrency governor limits based on free memory tiers', () => {
      // Simulate low memory (< 2.5 GB)
      supervisor.setMockFreeMemBytes(1.5 * 1024 * 1024 * 1024);
      let status = supervisor.getGovernorStatus();
      expect(status.tier).toBe('low');
      expect(status.maxBrowserContexts).toBe(1);
      expect(status.maxShellProcesses).toBe(1);

      // Simulate high memory (> 6.0 GB)
      supervisor.setMockFreeMemBytes(8.0 * 1024 * 1024 * 1024);
      status = supervisor.getGovernorStatus();
      expect(status.tier).toBe('high');
      expect(status.maxBrowserContexts).toBe(3);
      expect(status.maxShellProcesses).toBe(4);

      // Reset mock
      supervisor.setMockFreeMemBytes(undefined);
    });
  });

  describe('BrowserController Process Lifecycle & Zombie Guard', () => {
    it('closes browser cleanly without leaking references', async () => {
      const browserCtrl = new BrowserController();
      expect(browserCtrl.getStatus().active).toBe(false);

      // Closing unlaunched controller should safely no-op
      await expect(browserCtrl.close()).resolves.not.toThrow();
    });
  });
});
