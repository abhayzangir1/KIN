// ============================================================================
// KIN DESKTOP SHELL — TAURI 2 NATIVE RUNTIME
// ============================================================================

pub mod ipc;
pub mod jail;
pub mod supervisor;

use ipc::{
    close_window, get_ipc_token, is_window_maximized, minimize_window, pick_folder,
    toggle_maximize_window,
};
use jail::validate_jail_path;
use supervisor::ProcessSupervisor;
use std::fs::OpenOptions;
use std::io::Write;
use std::panic;
use std::thread;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_maximized: bool,
}

pub const MIN_WINDOW_WIDTH: u32 = 1000;
pub const MIN_WINDOW_HEIGHT: u32 = 650;
pub const DEFAULT_WINDOW_WIDTH: u32 = 1400;
pub const DEFAULT_WINDOW_HEIGHT: u32 = 900;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn clamp_window_state_to_monitors(mut state: WindowState, monitor_bounds: &[MonitorRect]) -> WindowState {
    // 1. Enforce minimum operational window dimensions (minWidth: 1000, minHeight: 650)
    state.width = state.width.max(MIN_WINDOW_WIDTH);
    state.height = state.height.max(MIN_WINDOW_HEIGHT);

    if monitor_bounds.is_empty() {
        state.x = state.x.max(0);
        state.y = state.y.max(0);
        return state;
    }

    // 2. Validate that at least 100x100 of the window lies within an active monitor
    let mut is_on_any_monitor = false;
    for m in monitor_bounds {
        let m_right = m.x + m.width as i32;
        let m_bottom = m.y + m.height as i32;
        let win_right = state.x + state.width as i32;
        let win_bottom = state.y + state.height as i32;

        let overlap_left = state.x.max(m.x);
        let overlap_top = state.y.max(m.y);
        let overlap_right = win_right.min(m_right);
        let overlap_bottom = win_bottom.min(m_bottom);

        if overlap_right > overlap_left + 100 && overlap_bottom > overlap_top + 100 {
            is_on_any_monitor = true;
            break;
        }
    }

    if !is_on_any_monitor {
        // Window was off-screen (e.g. disconnected secondary monitor). Reset to safe primary monitor center.
        let primary = &monitor_bounds[0];
        let clamped_w = state.width.min(primary.width).max(MIN_WINDOW_WIDTH);
        let clamped_h = state.height.min(primary.height).max(MIN_WINDOW_HEIGHT);
        state.width = clamped_w;
        state.height = clamped_h;
        state.x = primary.x + ((primary.width.saturating_sub(clamped_w)) / 2) as i32;
        state.y = primary.y + ((primary.height.saturating_sub(clamped_h)) / 2) as i32;
    }

    state
}

pub fn window_state_path() -> std::path::PathBuf {
    let base = ProcessSupervisor::resolve_data_dir();
    let kin_dir = base.join(".kin");
    if !kin_dir.exists() {
        let _ = std::fs::create_dir_all(&kin_dir);
    }
    kin_dir.join("window_state.json")
}

pub fn save_window_state(window: &tauri::Window) {
    let is_max = window.is_maximized().unwrap_or(false);
    let mut state = WindowState {
        x: 100,
        y: 100,
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        is_maximized: is_max,
    };
    if let Ok(pos) = window.outer_position() {
        state.x = pos.x;
        state.y = pos.y;
    }
    if let Ok(size) = window.inner_size() {
        state.width = size.width;
        state.height = size.height;
    }
    let path = window_state_path();
    if let Ok(json) = serde_json::to_string_pretty(&state) {
        let _ = std::fs::write(path, json);
    }
}

pub fn restore_window_state(window: &tauri::Window) {
    let path = window_state_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(raw_state) = serde_json::from_str::<WindowState>(&content) {
                let monitor_rects: Vec<MonitorRect> = window
                    .available_monitors()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|m| {
                        let pos = m.position();
                        let size = m.size();
                        MonitorRect {
                            x: pos.x,
                            y: pos.y,
                            width: size.width,
                            height: size.height,
                        }
                    })
                    .collect();

                let state = clamp_window_state_to_monitors(raw_state, &monitor_rects);

                let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: state.width,
                    height: state.height,
                }));
                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: state.x,
                    y: state.y,
                }));
                if state.is_maximized {
                    let _ = window.maximize();
                }
            }
        }
    }
}

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
            pick_folder,
            validate_jail_path,
            minimize_window,
            toggle_maximize_window,
            close_window,
            is_window_maximized
        ])
        .setup(|app| {
            log_diagnostic(&format!("[KIN SHELL] Tauri 2 desktop shell ready: version {}", app.package_info().version));

            // Restore window state if available
            if let Some(main_window) = app.get_webview_window("main") {
                restore_window_state(&main_window.as_ref().window());
            }

            // System tray menu
            let show_item = MenuItem::with_id(app, "show", "Show KIN", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit KIN", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        "quit" => {
                            supervisor::ProcessSupervisor::shutdown();
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;

            let app_handle = app.handle().clone();
            // Asynchronously spawn daemon so main UI thread does not freeze or delay WebView2 initialization
            thread::spawn(move || {
                if let Err(daemon_err) = ProcessSupervisor::spawn_core_daemon_if_needed() {
                    log_diagnostic(&format!("[KIN WARNING] Daemon auto-spawn notice: {}", daemon_err));
                    let _ = app_handle.emit("daemon-error", daemon_err.to_string());
                } else {
                    log_diagnostic("[KIN CORE] Daemon confirmed running and port active.");
                    let _ = app_handle.emit("daemon-ready", ());
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    save_window_state(window);
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    log_diagnostic(&format!("[KIN SHELL] Window close requested: {}", window.label()));
                    save_window_state(window);
                    // PRD § 5.4: Close to tray
                    api.prevent_close();
                    let _ = window.hide();
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
            tauri::RunEvent::ExitRequested { api: _, .. } => {
                log_diagnostic("[KIN SHELL] RunEvent::ExitRequested received.");
                supervisor::ProcessSupervisor::shutdown();
            }
            tauri::RunEvent::Exit => {
                log_diagnostic("[KIN SHELL] RunEvent::Exit received.");
                supervisor::ProcessSupervisor::shutdown();
            }
            tauri::RunEvent::Ready => {
                log_diagnostic("[KIN SHELL] RunEvent::Ready received.");
            }
            _ => {}
        }
    });
    log_diagnostic("[KIN SHELL] Tauri run loop exited.");
}
