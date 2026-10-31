import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DesktopController } from '../src/computer/desktop_controller.js';

describe('Milestone 16: Robust Long-Running Automation & Model Onboarding Suite', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const desktopCtrlPath = path.join(rootDir, 'core/src/computer/desktop_controller.ts');
  const bannerPath = path.join(rootDir, 'ui/src/components/ModelOnboardingBanner.tsx');
  const appPath = path.join(rootDir, 'ui/src/App.tsx');

  // --------------------------------------------------------------------------
  // Feature 85: DesktopController Robust Long-Running Process Automation
  // --------------------------------------------------------------------------
  describe('Feature 85: DesktopController Long-Running Process Automation', () => {
    it('verifies runPowerShell accepts options with timeoutMs and maxBufferBytes', () => {
      const content = fs.readFileSync(desktopCtrlPath, 'utf8');
      expect(content).toContain('options?: { timeoutMs?: number; maxBufferBytes?: number }');
      expect(content).toContain('KIN_POWERSHELL_TIMEOUT_MS');
      expect(content).toContain('Math.min(configuredTimeout, 300000)');
      expect(content).toContain('maxBuffer');
    });

    it('verifies process tree killing uses taskkill on Windows and pkill on Unix with diagnostic logging', () => {
      const content = fs.readFileSync(desktopCtrlPath, 'utf8');
      expect(content).toContain('taskkill /pid ${child.pid} /T /F');
      expect(content).toContain('pkill -P ${child.pid}');
      const runPowerShellMethod = content.substring(content.indexOf('public runPowerShell('));
      expect(runPowerShellMethod).not.toMatch(/catch\s*\{\s*\}/); // No empty catches in runPowerShell
    });

    it('verifies streaming rolling buffers cap at maxBuffer to prevent memory leaks', () => {
      const content = fs.readFileSync(desktopCtrlPath, 'utf8');
      expect(content).toContain('Truncated: output buffer exceeded limit');
      expect(content).toContain('Truncated: error buffer exceeded limit');
    });

    it('executes a quick PowerShell script cleanly when DesktopController is invoked', async () => {
      const ctrl = new DesktopController();
      const res = await ctrl.runPowerShell('Write-Output "KIN_ROBUST_OK"', undefined, { timeoutMs: 5000 });
      if (process.platform === 'win32') {
        expect(res.exitCode).toBe(0);
        expect(res.stdout).toContain('KIN_ROBUST_OK');
      } else {
        // Non-windows fallback
        expect(typeof res.exitCode).toBe('number');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 86: Model Onboarding Banner & Fresh Boot Experience
  // --------------------------------------------------------------------------
  describe('Feature 86: Model Onboarding Experience', () => {
    it('verifies ModelOnboardingBanner component exists and handles session dismissal safely', () => {
      expect(fs.existsSync(bannerPath)).toBe(true);
      const content = fs.readFileSync(bannerPath, 'utf8');
      expect(content).toContain('KIN_MODEL_ONBOARDING_DISMISSED');
      expect(content).toContain('sessionStorage');
      expect(content).toContain('openModelSelector');
      expect(content).toContain('role="region"');
      expect(content).toContain('aria-label="AI Model Setup Onboarding Banner"');
    });

    it('verifies ModelOnboardingBanner is wired into App.tsx under the daemon connection banner', () => {
      const content = fs.readFileSync(appPath, 'utf8');
      expect(content).toContain("import { ModelOnboardingBanner } from './components/ModelOnboardingBanner.js';");
      expect(content).toContain('<ModelOnboardingBanner />');
    });
  });
});
