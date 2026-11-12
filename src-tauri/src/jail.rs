// ============================================================================
// KIN NATIVE FILESYSTEM JAIL
// Strict canonical path validation to prevent directory traversal and jailbreaks.
// ============================================================================

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct JailValidationResult {
    pub is_valid: bool,
    pub canonical_path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn validate_jail_path(jail_root: String, target_path: String) -> JailValidationResult {
    FilesystemJail::validate_path(jail_root, target_path)
}

pub struct FilesystemJail;

impl FilesystemJail {
    /// Checks whether a given path matches sensitive file patterns (credentials, keys, sqlite databases, etc.)
    pub fn is_sensitive_pattern<P: AsRef<Path>>(path: P) -> bool {
        let p = path.as_ref();
        let path_str = p.to_string_lossy().replace('\\', "/").to_lowercase();
        let file_name = p
            .file_name()
            .map(|f| f.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        // 1. Exact or suffix/prefix matches on file/dir name
        if file_name == ".env"
            || file_name.starts_with(".env.")
            || file_name.ends_with(".env")
            || file_name == "vault.key"
            || file_name == "ipc_auth.token"
            || file_name.starts_with("kin_storage.sqlite")
            || file_name.ends_with(".sqlite")
            || file_name.ends_with(".sqlite3")
            || file_name.ends_with(".sqlite-wal")
            || file_name.ends_with(".sqlite-shm")
            || file_name == ".npmrc"
            || file_name == ".pypirc"
            || file_name == "id_rsa"
            || file_name == "id_ed25519"
            || file_name == "id_ecdsa"
            || file_name == "id_dsa"
        {
            return true;
        }

        // 2. Specific directory and full path patterns
        if path_str.ends_with("/.git/config")
            || path_str == ".git/config"
            || path_str.contains("/.ssh/")
            || path_str.ends_with("/.ssh")
            || path_str.contains("/.aws/")
            || path_str.ends_with("/.aws")
            || ((path_str.contains("/.kin/") || path_str.starts_with(".kin/"))
                && !path_str.contains("/.kin/worktrees/"))
        {
            return true;
        }

        false
    }

    /// Validates that `target_path` is strictly contained within `jail_root`.
    /// Resolves all symlinks, relative segments (`..`), and normalizes path separators.
    pub fn validate_path<P: AsRef<Path>, Q: AsRef<Path>>(
        jail_root: P,
        target_path: Q,
    ) -> JailValidationResult {
        let root = jail_root.as_ref();
        let target_raw = target_path.as_ref();

        // 1. Immediate rejection of sensitive file patterns
        if Self::is_sensitive_pattern(target_raw) {
            return JailValidationResult {
                is_valid: false,
                canonical_path: None,
                error: Some(format!(
                    "SECURITY JAIL VIOLATION: Access to sensitive file pattern is prohibited: '{:?}'",
                    target_raw
                )),
            };
        }

        // Normalize path separators from Windows backslashes to forward slashes for cross-platform traversal safety
        let target_norm_str = target_raw.to_string_lossy().replace('\\', "/");
        let target = Path::new(&target_norm_str);

        // Detect Windows drive letter paths on POSIX platforms (e.g. C:/Windows/...)
        let is_win_drive = target_norm_str.len() >= 2
            && target_norm_str.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false)
            && target_norm_str.chars().nth(1) == Some(':');

        if !cfg!(windows) && is_win_drive {
            return JailValidationResult {
                is_valid: false,
                canonical_path: None,
                error: Some(format!(
                    "SECURITY JAIL VIOLATION: Windows drive path prohibited on POSIX: '{:?}'",
                    target_raw
                )),
            };
        }

        // 2. Canonicalize the root directory (must exist)
        let canonical_root = match root.canonicalize() {
            Ok(p) => p,
            Err(e) => {
                return JailValidationResult {
                    is_valid: false,
                    canonical_path: None,
                    error: Some(format!("Invalid jail root directory '{:?}': {}", root, e)),
                };
            }
        };

        // 2. Resolve absolute target path relative to jail_root if relative
        let resolved_target = if target.is_absolute() {
            target.to_path_buf()
        } else {
            root.join(target)
        };

        // 3. For existing files/directories, use canonicalize directly
        // For files that do not exist yet (e.g. before write), canonicalize the parent directory
        let canonical_target = if resolved_target.exists() {
            match resolved_target.canonicalize() {
                Ok(p) => p,
                Err(e) => {
                    return JailValidationResult {
                        is_valid: false,
                        canonical_path: None,
                        error: Some(format!("Failed to canonicalize target path '{:?}': {}", resolved_target, e)),
                    };
                }
            }
        } else {
            // Find the closest existing ancestor
            let mut current = resolved_target.clone();
            let mut suffix = PathBuf::new();

            while !current.exists() {
                if let Some(file_name) = current.file_name() {
                    suffix = Path::new(file_name).join(&suffix);
                    if let Some(parent) = current.parent() {
                        current = parent.to_path_buf();
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            match current.canonicalize() {
                Ok(canonical_ancestor) => canonical_ancestor.join(suffix),
                Err(e) => {
                    return JailValidationResult {
                        is_valid: false,
                        canonical_path: None,
                        error: Some(format!("Failed to resolve path ancestor '{:?}': {}", current, e)),
                    };
                }
            }
        };

        // 4. Verify canonical target does not match sensitive file patterns
        if Self::is_sensitive_pattern(&resolved_target) || Self::is_sensitive_pattern(&canonical_target) {
            return JailValidationResult {
                is_valid: false,
                canonical_path: None,
                error: Some(format!(
                    "SECURITY JAIL VIOLATION: Access to sensitive file pattern is prohibited: '{:?}'",
                    canonical_target
                )),
            };
        }

        // 5. Verify that canonical_target starts strictly with canonical_root
        if canonical_target.starts_with(&canonical_root) {
            JailValidationResult {
                is_valid: true,
                canonical_path: Some(canonical_target.to_string_lossy().into_owned()),
                error: None,
            }
        } else {
            JailValidationResult {
                is_valid: false,
                canonical_path: None,
                error: Some(format!(
                    "SECURITY JAIL VIOLATION: Path '{:?}' escapes root '{:?}'",
                    canonical_target, canonical_root
                )),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;

    #[test]
    fn test_sensitive_patterns_denied() {
        let temp_dir = env::temp_dir().join("kin_jail_sensitive_test");
        let _ = fs::create_dir_all(&temp_dir);

        let sensitive_names = vec![
            ".env",
            ".env.local",
            "production.env",
            "vault.key",
            "ipc_auth.token",
            "kin_storage.sqlite",
            "kin_storage.sqlite-wal",
            "kin_storage.sqlite-shm",
            "app.sqlite",
            ".npmrc",
            "id_rsa",
            "id_ed25519",
        ];

        for name in sensitive_names {
            let res = FilesystemJail::validate_path(&temp_dir, temp_dir.join(name));
            assert!(
                !res.is_valid,
                "Expected '{}' to be blocked by sensitive pattern jail",
                name
            );
            assert!(
                res.error.unwrap().contains("SECURITY JAIL VIOLATION"),
                "Expected SECURITY JAIL VIOLATION error for '{}'",
                name
            );
        }

        let _ = fs::remove_dir_all(&temp_dir);
    }
}

