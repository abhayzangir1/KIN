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

    // 2. Build Tauri application
    let builder = tauri::Builder::default()
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
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    log_diagnostic(&format!("[KIN SHELL] Window close requested: {}", window.label()));
                }
                tauri::WindowEvent::Destroyed => {
                    log_diagnostic(&format!("[KIN SHELL] Window destroyed: {}", window.label()));
                }
                _ => {}
            }
        });

    let app = match builder.build(tauri::generate_context!()) {
        Ok(a) => a,
        Err(e) => {
            log_diagnostic(&format!("[KIN CRITICAL] Failed to build Tauri app: {:?}", e));
            return;
        }
    };

    log_diagnostic("[KIN SHELL] Entering Tauri run loop...");
    app.run(|_app_handle, event| {
        match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                log_diagnostic("[KIN SHELL] RunEvent::ExitRequested received.");
            }
            tauri::RunEvent::Exit => {
                log_diagnostic("[KIN SHELL] RunEvent::Exit received.");
            }
            tauri::RunEvent::Ready => {
                log_diagnostic("[KIN SHELL] RunEvent::Ready received.");
            }
            _ => {}
        }
    });
    log_diagnostic("[KIN SHELL] Tauri run loop exited.");
}
