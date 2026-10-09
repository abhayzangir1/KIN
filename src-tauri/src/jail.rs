// ============================================================================
// KIN NATIVE FILESYSTEM JAIL
// Strict canonical path validation to prevent directory traversal and jailbreaks.
// ============================================================================

use std::path::{Path, PathBuf};

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct JailValidationResult {
    pub is_valid: bool,
    pub canonical_path: Option<String>,
    pub error: Option<String>,
}

pub struct FilesystemJail;

impl FilesystemJail {
    /// Validates that `target_path` is strictly contained within `jail_root`.
    /// Resolves all symlinks, relative segments (`..`), and normalizes path separators.
    pub fn validate_path<P: AsRef<Path>, Q: AsRef<Path>>(
        jail_root: P,
        target_path: Q,
    ) -> JailValidationResult {
        let root = jail_root.as_ref();
        let target = target_path.as_ref();

        // 1. Canonicalize the root directory (must exist)
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

        // 4. Verify that canonical_target starts strictly with canonical_root
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
