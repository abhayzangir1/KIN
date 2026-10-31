import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Milestone 14: Desktop Supervisor, Tauri Shell & Runtime Launch Wiring Test Suite', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const tauriConfPath = path.join(rootDir, 'src-tauri/tauri.conf.json');
  const supervisorRsPath = path.join(rootDir, 'src-tauri/src/supervisor.rs');
  const libRsPath = path.join(rootDir, 'src-tauri/src/lib.rs');
  const jailRsPath = path.join(rootDir, 'src-tauri/src/jail.rs');
  const mainRsPath = path.join(rootDir, 'src-tauri/src/main.rs');
  const viteConfigPath = path.join(rootDir, 'ui/vite.config.ts');

  // --------------------------------------------------------------------------
  // Feature 68: Dev URL Host Alignment in tauri.conf.json
  // --------------------------------------------------------------------------
  describe('Feature 68: Dev URL Host Alignment', () => {
    it('configures devUrl strictly to IPv4 127.0.0.1:5173 to prevent Windows IPv6 connection failures', () => {
      expect(fs.existsSync(tauriConfPath)).toBe(true);
      const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
      expect(conf.build).toBeDefined();
      expect(conf.build.devUrl).toBe('http://127.0.0.1:5173');
      expect(conf.build.devUrl).not.toBe('http://localhost:5173');
    });

    it('aligns with Vite host and strictPort configuration in ui/vite.config.ts', () => {
      expect(fs.existsSync(viteConfigPath)).toBe(true);
      const viteContent = fs.readFileSync(viteConfigPath, 'utf8');
      expect(viteContent).toContain("host: '127.0.0.1'");
      expect(viteContent).toContain('port: 5173');
      expect(viteContent).toContain('strictPort: true');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 69: Cold-Clone Dev Build Command in tauri.conf.json
  // --------------------------------------------------------------------------
  describe('Feature 69: Cold-Clone Dev Build Command', () => {
    it('ensures @kin/core is built before launching UI dev server in beforeDevCommand', () => {
      const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
      expect(conf.build.beforeDevCommand).toBeDefined();
      expect(conf.build.beforeDevCommand).toContain('npm run build --workspace=@kin/core');
      expect(conf.build.beforeDevCommand).toContain('npm run dev --workspace=ui');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 66: Dynamic KIN_PORT Resolution in Native Supervisor
  // --------------------------------------------------------------------------
  describe('Feature 66: Native Supervisor Dynamic Port', () => {
    it('implements resolve_port checking KIN_PORT env var with 54321 fallback', () => {
      const supervisorContent = fs.readFileSync(supervisorRsPath, 'utf8');
      expect(supervisorContent).toContain('pub fn resolve_port() -> u16');
      expect(supervisorContent).toContain('std::env::var("KIN_PORT")');
      expect(supervisorContent).toContain('.unwrap_or(54321)');
    });

    it('uses resolve_port in spawn_core_daemon_if_needed and sets KIN_PORT env on spawned processes', () => {
      const supervisorContent = fs.readFileSync(supervisorRsPath, 'utf8');
      expect(supervisorContent).toContain('let port = Self::resolve_port();');
      expect(supervisorContent).toContain('command.env("KIN_PORT", port.to_string());');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 71: Safe Mutex Poison Handling in Rust Supervisor
  // --------------------------------------------------------------------------
  describe('Feature 71: Safe Mutex Poison Handling in Rust', () => {
    it('uses poison recovery (unwrap_or_else into_inner) on get_supervisor().lock()', () => {
      const supervisorContent = fs.readFileSync(supervisorRsPath, 'utf8');
      expect(supervisorContent).toContain(
        'get_supervisor().lock().unwrap_or_else(|poisoned| poisoned.into_inner())'
      );
      // Ensure no raw unwrap() calls on get_supervisor().lock()
      expect(supervisorContent).not.toMatch(/get_supervisor\(\)\.lock\(\)\.unwrap\(\)/);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 62: Windows Job Object Error Propagation & Logging
  // --------------------------------------------------------------------------
  describe('Feature 62: Windows Job Object Error Propagation', () => {
    it('returns structured Result<(), String> and logs diagnostics on Job Object assignment', () => {
      const supervisorContent = fs.readFileSync(supervisorRsPath, 'utf8');
      expect(supervisorContent).toContain('AssignProcessToJobObject(self.job_handle, handle)');
      expect(supervisorContent).toContain('crate::log_diagnostic');
      expect(supervisorContent).toContain('[KIN SUPERVISOR ERROR]');
    });

    it('checks assign_raw_handle and logs diagnostic warnings at child spawn call sites instead of let _ =', () => {
      const supervisorContent = fs.readFileSync(supervisorRsPath, 'utf8');
      // Verify both sidecar and daemon spawn sites handle the Result
      expect(supervisorContent).toContain('Could not assign sidecar process to Job Object');
      expect(supervisorContent).toContain('Could not assign daemon process to Job Object');
      expect(supervisorContent).not.toMatch(/let _ = Self::assign_raw_handle/);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 63: Tauri Exit Cleanup on Unix
  // --------------------------------------------------------------------------
  describe('Feature 63: Tauri Exit Cleanup on Unix', () => {
    it('invokes ProcessSupervisor::shutdown() on ExitRequested and Exit events in lib.rs', () => {
      const libContent = fs.readFileSync(libRsPath, 'utf8');
      expect(libContent).toContain('tauri::RunEvent::ExitRequested');
      expect(libContent).toContain('supervisor::ProcessSupervisor::shutdown();');
      expect(libContent).toContain('tauri::RunEvent::Exit');
    });

    it('implements shutdown() with diagnostic logging in ProcessSupervisor', () => {
      const supervisorContent = fs.readFileSync(supervisorRsPath, 'utf8');
      expect(supervisorContent).toContain('pub fn shutdown()');
      expect(supervisorContent).toContain('[KIN SUPERVISOR] ProcessSupervisor shutdown invoked.');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 72: Webview Event on Daemon Failure
  // --------------------------------------------------------------------------
  describe('Feature 72: Webview Event on Daemon Failure', () => {
    it('emits daemon-error event to webview via app_handle when spawn_core_daemon_if_needed fails', () => {
      const libContent = fs.readFileSync(libRsPath, 'utf8');
      expect(libContent).toContain('use tauri::Emitter;');
      expect(libContent).toContain('app_handle.emit("daemon-error", daemon_err.to_string())');
      expect(libContent).toContain('app_handle.emit("daemon-ready", ())');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 74: Expose FilesystemJail in jail.rs and lib.rs
  // --------------------------------------------------------------------------
  describe('Feature 74: Expose FilesystemJail as Registered Tauri Command', () => {
    it('defines #[tauri::command] pub fn validate_jail_path in src-tauri/src/jail.rs', () => {
      const jailContent = fs.readFileSync(jailRsPath, 'utf8');
      expect(jailContent).toContain('#[tauri::command]');
      expect(jailContent).toContain('pub fn validate_jail_path(jail_root: String, target_path: String) -> JailValidationResult');
    });

    it('registers validate_jail_path in tauri::generate_handler! in lib.rs', () => {
      const libContent = fs.readFileSync(libRsPath, 'utf8');
      expect(libContent).toContain('use jail::validate_jail_path;');
      expect(libContent).toMatch(/tauri::generate_handler!\[[\s\S]*validate_jail_path[\s\S]*\]/);
    });

    it('verifies JailValidationResult serialization and fields', () => {
      const jailContent = fs.readFileSync(jailRsPath, 'utf8');
      expect(jailContent).toContain('pub is_valid: bool');
      expect(jailContent).toContain('pub canonical_path: Option<String>');
      expect(jailContent).toContain('pub error: Option<String>');
    });

    it('includes unit test coverage for validate_jail_path in main.rs test suite', () => {
      const mainContent = fs.readFileSync(mainRsPath, 'utf8');
      expect(mainContent).toContain('test_validate_jail_path_command');
      expect(mainContent).toContain('test_dynamic_port_resolution');
      expect(mainContent).toContain('test_process_supervisor_shutdown');
    });
  });
});
