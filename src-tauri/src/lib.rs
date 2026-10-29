// ============================================================================
// KIN DESKTOP SHELL — TAURI 2 NATIVE RUNTIME
// ============================================================================

pub mod ipc;
pub mod jail;
pub mod supervisor;

use ipc::{get_ipc_token, pick_folder};
use supervisor::ProcessSupervisor;
use std::fs::OpenOptions;
use std::io::Write;
use std::panic;
use std::thread;

pub fn log_diagnostic(msg: &str) {
    println!("{}", msg);
    let log_path = ProcessSupervisor::resolve_data_dir().join("kin-desktop.log");
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "[{}] {}", now, msg);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Panic hook to catch and log any unexpected crashes
    panic::set_hook(Box::new(|info| {
        let err_msg = format!("CRITICAL PANIC: {:?}", info);
        eprintln!("{}", err_msg);
        log_diagnostic(&err_msg);
    }));

    // 1. Initialize native Process Supervisor (Job Object on Windows)
    if let Err(e) = ProcessSupervisor::init() {
        log_diagnostic(&format!("[KIN WARNING] Failed to initialize Native Process Supervisor: {}", e));
    } else {
        log_diagnostic("[KIN CORE] Native Process Supervisor initialized successfully.");
    }

    // 2. Build and run Tauri application
    let tauri_result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_ipc_token,
            pick_folder
        ])
        .setup(|app| {
            log_diagnostic(&format!("[KIN SHELL] Tauri 2 desktop shell ready: version {}", app.package_info().version));

            // Asynchronously spawn daemon so main UI thread does not freeze or delay WebView2 initialization
            thread::spawn(|| {
                if let Err(daemon_err) = ProcessSupervisor::spawn_core_daemon_if_needed() {
                    log_diagnostic(&format!("[KIN WARNING] Daemon auto-spawn notice: {}", daemon_err));
                } else {
                    log_diagnostic("[KIN CORE] Daemon confirmed running and port active.");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log_diagnostic(&format!("[KIN SHELL] Window close requested: {}", window.label()));
            }
        })
        .run(tauri::generate_context!());

    if let Err(e) = tauri_result {
        log_diagnostic(&format!("[KIN CRITICAL] Tauri application run error: {:?}", e));
    }
}
