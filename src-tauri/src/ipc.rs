// ============================================================================
// KIN SECURE LOCAL IPC & TAURI COMMAND HANDLERS
// Authenticated communication and native bridge capabilities.
// ============================================================================

use crate::jail::{FilesystemJail, JailValidationResult};
use crate::supervisor::ProcessSupervisor;
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Serialize, Deserialize)]
pub struct OsInfo {
    pub os: String,
    pub arch: String,
    pub pid: u32,
    pub home_dir: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IpcHandshakeResponse {
    pub session_id: String,
    pub auth_token: String,
    pub pipe_or_socket_name: String,
}

#[tauri::command]
pub fn kin_get_os_info() -> OsInfo {
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());

    OsInfo {
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        pid: std::process::id(),
        home_dir: home,
    }
}

#[tauri::command]
pub fn kin_validate_path(jail_root: String, target_path: String) -> JailValidationResult {
    FilesystemJail::validate_path(jail_root, target_path)
}

#[tauri::command]
pub fn kin_register_child_process(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};
        unsafe {
            let handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
                .map_err(|e| format!("Failed to open process PID {}: {:?}", pid, e))?;

            ProcessSupervisor::assign_raw_handle(handle.0 as _)
        }
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
        Ok(())
    }
}
