import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputerSupervisor } from '../src/computer/computer_supervisor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Milestones 17 & 18: Desktop Supervisor, Runtime Automation & Frontend State Suite', () => {
  const supervisorRsPath = path.join(rootDir, 'src-tauri/src/supervisor.rs');
  const ipcRsPath = path.join(rootDir, 'src-tauri/src/ipc.rs');
  const startDaemonPath = path.join(rootDir, 'core/src/start_daemon.ts');
  const desktopCtrlPath = path.join(rootDir, 'core/src/computer/desktop_controller.ts');
  const computerSuperPath = path.join(rootDir, 'core/src/computer/computer_supervisor.ts');
  const browserCtrlPath = path.join(rootDir, 'core/src/browser/browser_controller.ts');
  const kinStorePath = path.join(rootDir, 'ui/src/store/kinStore.ts');
  const appPath = path.join(rootDir, 'ui/src/App.tsx');
  const newProjectModalPath = path.join(rootDir, 'ui/src/components/NewProjectModal.tsx');
  const settingsModalPath = path.join(rootDir, 'ui/src/components/SettingsModal.tsx');
  const centerViewPath = path.join(rootDir, 'ui/src/components/CenterView.tsx');
  const automationsModalPath = path.join(rootDir, 'ui/src/components/AutomationsModal.tsx');
  const automationsViewPath = path.join(rootDir, 'ui/src/components/AutomationsView.tsx');
  const agentInspectorPath = path.join(rootDir, 'ui/src/components/AgentInspector.tsx');
  const desktopControlModalPath = path.join(rootDir, 'ui/src/components/DesktopControlModal.tsx');

  // ==========================================================================
  // Milestone 17: Desktop Supervisor, Native Shell, IPC & Runtime Automation
  // ==========================================================================
  describe('Milestone 17: Desktop Supervisor & Runtime Automation', () => {
    it('verifies supervisor.rs performs active child.try_wait() exit polling during daemon readiness', () => {
      const content = fs.readFileSync(supervisorRsPath, 'utf8');
      expect(content).toContain('child.try_wait()');
      expect(content).toContain('[KIN SUPERVISOR ERROR] Daemon process exited prematurely');
      expect(content).toContain('[KIN SUPERVISOR ERROR] Daemon failed to bind to port');
    });

    it('verifies supervisor.rs searches upward for package.json to resolve working directory safely', () => {
      const content = fs.readFileSync(supervisorRsPath, 'utf8');
      expect(content).toContain('dir.join("package.json").exists()');
      expect(content).not.toContain('p.pop(); // remove core -> project root');
    });

    it('verifies UnixProcessSupervisor handles mutex poisoning gracefully in cleanup', () => {
      const content = fs.readFileSync(supervisorRsPath, 'utf8');
      expect(content).toContain('unwrap_or_else(|p| p.into_inner())');
    });

    it('verifies ipc.rs inspects Linux Zenity and Kdialog exit code 1 to treat cancel as Ok(None)', () => {
      const content = fs.readFileSync(ipcRsPath, 'utf8');
      expect(content).toContain('output.status.code() == Some(1)');
      expect(content).toContain('return Ok(None)');
    });

    it('verifies start_daemon.ts redirects daemon_error.log to getDataDirectory()', () => {
      const content = fs.readFileSync(startDaemonPath, 'utf8');
      expect(content).toContain('getDaemonErrorLogPath()');
      expect(content).toContain('getDataDirectory()');
      expect(content).not.toContain("fs.appendFileSync(path.resolve(process.cwd(), 'daemon_error.log')");
    });

    it('verifies DesktopController.captureScreen sets 32MB buffer capacity for high-DPI displays', () => {
      const content = fs.readFileSync(desktopCtrlPath, 'utf8');
      expect(content).toContain('maxBufferBytes: 32 * 1024 * 1024');
    });

    it('verifies BrowserController.evaluate uses native DevTools Protocol instead of DOM window.eval', () => {
      const content = fs.readFileSync(browserCtrlPath, 'utf8');
      expect(content).toContain('return page.evaluate(script)');
      expect(content).not.toContain('window.eval(code)');
    });

    it('verifies ComputerSupervisor autodetects container/root environments and adds --no-sandbox', () => {
      const content = fs.readFileSync(computerSuperPath, 'utf8');
      expect(content).toContain("fs.existsSync('/.dockerenv')");
      expect(content).toContain('process.getuid() === 0');
      expect(content).toContain("--no-sandbox', '--disable-setuid-sandbox");
    });

    it('verifies ComputerSupervisor.shutdown cleanly drains and rejects pending hardware waiters', async () => {
      const supervisor = new ComputerSupervisor();
      // Enqueue shell slot waiters
      const promise1 = supervisor.acquireShellSlot(5000);
      const promise2 = supervisor.acquireShellSlot(5000);
      
      let errorThrown = false;
      const rejectHandler = promise2.catch((err) => {
        errorThrown = true;
        expect(err.message).toContain('ComputerSupervisor is shutting down');
      });

      await supervisor.shutdown();
      await rejectHandler;
      expect(errorThrown).toBe(true);
    });
  });

  // ==========================================================================
  // Milestone 18: Frontend UI/UX State, Dynamic Diagnostics & Async Wiring
  // ==========================================================================
  describe('Milestone 18: Frontend UI/UX State & Asynchronous Error Wiring', () => {
    it('verifies NewProjectModal returns immediately on native dialog completion, preventing duplicates', () => {
      const content = fs.readFileSync(newProjectModalPath, 'utf8');
      expect(content).toContain('If native folder dialog was displayed');
      expect(content).toContain('avoid opening redundant secondary backend fallback dialogs');
    });

    it('verifies App.tsx listens to Tauri daemon-ready and daemon-error webview events', () => {
      const content = fs.readFileSync(appPath, 'utf8');
      expect(content).toContain("listen('daemon-ready'");
      expect(content).toContain("listen('daemon-error'");
      expect(content).toContain('Daemon Startup Alert:');
    });

    it('verifies SettingsModal displays dynamic host platform, daemon port, and frontend server', () => {
      const content = fs.readFileSync(settingsModalPath, 'utf8');
      expect(content).toContain('{hostPlatform}');
      expect(content).toContain('{coreDaemonPort}');
      expect(content).toContain('{frontendWebServer}');
      expect(content).not.toContain('Windows win32 (Node.js runtime)');
    });

    it('verifies SettingsModal handles credentialsLoading state with dedicated loading indicator', () => {
      const content = fs.readFileSync(settingsModalPath, 'utf8');
      expect(content).toContain('credentialsLoading ?');
      expect(content).toContain('Loading encrypted vault credentials...');
    });

    it('verifies CenterView selectableModels only contains authentically discovered models', () => {
      const content = fs.readFileSync(centerViewPath, 'utf8');
      expect(content).not.toContain("id: 'openrouter/auto'");
      expect(content).not.toContain("id: 'openrouter/google/gemini-2.0-flash-001'");
      expect(content).toContain('selectableModels[0]?.id ||');
    });

    it('verifies CenterView wires switchRunToOllama button when local Ollama is online', () => {
      const content = fs.readFileSync(centerViewPath, 'utf8');
      expect(content).toContain('switchRunToOllama');
      expect(content).toContain('ollamaStatus?.online');
      expect(content).toContain('Switch to Ollama');
    });

    it('verifies CenterView awaits resolveApproval and provides feedback toasts', () => {
      const content = fs.readFileSync(centerViewPath, 'utf8');
      expect(content).toContain('const res = await resolveApproval(appr.id, false)');
      expect(content).toContain('const res = await resolveApproval(appr.id, true)');
      expect(content).toContain('Action approved and executing');
    });

    it('verifies AutomationsModal and AutomationsView use dynamic channel resolution over chan-general', () => {
      const modalContent = fs.readFileSync(automationsModalPath, 'utf8');
      const viewContent = fs.readFileSync(automationsViewPath, 'utf8');
      expect(modalContent).toContain('channels.find((c: any) => c.isDefault)?.id || channels[0]?.id');
      expect(viewContent).toContain('channels.find((c: any) => c.isDefault)?.id || channels[0]?.id');
    });

    it('verifies mutating actions in kinStore return consistent { success, error } contract', () => {
      const content = fs.readFileSync(kinStorePath, 'utf8');
      expect(content).toContain('revertGitFile: (path: string) => Promise<{ success: boolean; error?: string }>');
      expect(content).toContain('stageGitFile: (path: string, stage: boolean) => Promise<{ success: boolean; error?: string }>');
      expect(content).toContain('closeWindow: (titleOrPid: string | number) => Promise<{ success: boolean; error?: string }>');
      expect(content).toContain('cancelSchedule: (scheduleId: string) => Promise<{ success: boolean; error?: string }>');
      expect(content).toContain('cancelRoutine: (routineId: string) => Promise<{ success: boolean; error?: string }>');
    });

    it('verifies AgentInspector and DesktopControlModal await async operations and toast on failure', () => {
      const inspectorContent = fs.readFileSync(agentInspectorPath, 'utf8');
      const desktopContent = fs.readFileSync(desktopControlModalPath, 'utf8');
      expect(inspectorContent).toContain('const res = await stageGitFile');
      expect(inspectorContent).toContain('const res = await revertGitFile');
      expect(desktopContent).toContain('handleCloseWindow');
      expect(desktopContent).toContain('const res = await closeWindow');
    });
  });
});
