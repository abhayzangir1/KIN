// ============================================================================
// KIN DESKTOP SHELL — TAURI 2 NATIVE RUNTIME
// ============================================================================

pub mod ipc;
pub mod jail;
pub mod supervisor;

use ipc::{kin_get_os_info, kin_register_child_process, kin_validate_path};
use supervisor::ProcessSupervisor;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Initialize native Process Supervisor (Job Object on Windows)
    if let Err(e) = ProcessSupervisor::init() {
        eprintln!("[KIN WARNING] Failed to initialize Native Process Supervisor: {}", e);
    } else {
        println!("[KIN CORE] Native Process Supervisor initialized successfully.");
    }

    // 2. Build and run Tauri application
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            kin_get_os_info,
            kin_validate_path,
            kin_register_child_process
        ])
        .setup(|app| {
            println!("[KIN SHELL] Tauri 2 desktop shell ready: version {}", app.package_info().version);
            if let Err(daemon_err) = ProcessSupervisor::spawn_core_daemon_if_needed() {
                eprintln!("[KIN WARNING] Daemon auto-spawn notice: {}", daemon_err);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running KIN Tauri application");
}
