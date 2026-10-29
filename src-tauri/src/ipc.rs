// ============================================================================
// KIN SECURE LOCAL IPC & TAURI COMMAND HANDLERS
// Authenticated communication and native bridge capabilities.
// ============================================================================

use crate::supervisor::ProcessSupervisor;
use std::env;

#[tauri::command]
pub fn get_ipc_token() -> Result<String, String> {
    let mut candidates = Vec::new();

    if let Ok(env_dir) = env::var("KIN_DATA_DIR") {
        if !env_dir.trim().is_empty() {
            let p = std::path::PathBuf::from(env_dir.trim());
            candidates.push(p.join("ipc_auth.token"));
            candidates.push(p.join(".kin").join("ipc_auth.token"));
        }
    }

    let supervisor_dir = ProcessSupervisor::resolve_data_dir();
    candidates.push(supervisor_dir.join("ipc_auth.token"));
    candidates.push(supervisor_dir.join(".kin").join("ipc_auth.token"));

    let current_dir = env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    candidates.push(current_dir.join(".kin").join("ipc_auth.token"));
    candidates.push(current_dir.join("..").join(".kin").join("ipc_auth.token"));
    candidates.push(current_dir.join("ipc_auth.token"));

    for path in &candidates {
        if path.exists() {
            if let Ok(token) = std::fs::read_to_string(path) {
                let trimmed = token.trim();
                if !trimmed.is_empty() {
                    return Ok(trimmed.to_string());
                }
            }
        }
    }

    Err("IPC authentication token not found in .kin directory".to_string())
}

#[tauri::command]
pub fn pick_folder() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let output = Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-STA",
                "-Command",
                "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Project or Repository Folder'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }",
            ])
            .output()
            .map_err(|e| e.to_string())?;

        let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !result.is_empty() {
            return Ok(Some(result));
        }
        Ok(None)
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}
