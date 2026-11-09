use kin_lib::jail::{validate_jail_path, FilesystemJail};
use std::env;
use std::fs;

#[test]
fn test_native_jail_adversarial_traversal_payloads() {
    let temp_dir = env::temp_dir().join("kin_jail_adv_traversal");
    let _ = fs::create_dir_all(&temp_dir);

    let traversal_payloads = vec![
        "../outside.txt",
        "../../outside.txt",
        "../../../outside.txt",
        "sub/../../outside.txt",
        "sub/dir/../../../outside.txt",
        "..\\..\\outside.txt",
        "sub\\..\\..\\outside.txt",
        "C:\\Windows\\System32\\cmd.exe",
    ];

    for payload in traversal_payloads {
        let res = FilesystemJail::validate_path(&temp_dir, payload);
        assert!(
            !res.is_valid,
            "Expected traversal payload '{}' to be blocked",
            payload
        );
        assert!(
            res.error.is_some(),
            "Expected error for traversal payload '{}'",
            payload
        );
    }

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_native_jail_adversarial_sensitive_patterns() {
    let temp_dir = env::temp_dir().join("kin_jail_adv_sensitive");
    let _ = fs::create_dir_all(&temp_dir);

    let sensitive_payloads = vec![
        ".env",
        ".env.local",
        ".env.production",
        ".env.staging",
        "test.env",
        "my.env",
        "vault.key",
        "sub/vault.key",
        "ipc_auth.token",
        "sub/ipc_auth.token",
        "kin_storage.sqlite",
        "kin_storage.sqlite-wal",
        "kin_storage.sqlite-shm",
        "database.sqlite",
        "data.sqlite3",
        ".npmrc",
        ".pypirc",
        "id_rsa",
        "id_ed25519",
        "id_ecdsa",
        "id_dsa",
        ".git/config",
        "sub/.git/config",
        ".ssh/id_rsa",
        ".ssh/known_hosts",
        ".aws/credentials",
        ".aws/config",
        ".kin/secret.txt",
        ".kin/config.json",
    ];

    for payload in sensitive_payloads {
        let res = FilesystemJail::validate_path(&temp_dir, payload);
        assert!(
            !res.is_valid,
            "Expected sensitive payload '{}' to be blocked",
            payload
        );
        let err = res.error.unwrap();
        assert!(
            err.contains("SECURITY JAIL VIOLATION") || err.contains("sensitive"),
            "Expected sensitive jail violation error for '{}', got: {}",
            payload,
            err
        );
    }

    // Worktree exception: .kin/worktrees/ is explicitly permitted
    let worktree_valid = temp_dir.join(".kin").join("worktrees").join("run-123");
    let _ = fs::create_dir_all(&worktree_valid);
    let worktree_file = worktree_valid.join("code.rs");
    let _ = fs::write(&worktree_file, "fn main() {}");

    let worktree_res = FilesystemJail::validate_path(&temp_dir, &worktree_file);
    assert!(
        worktree_res.is_valid,
        "Expected .kin/worktrees/ path to be permitted, got error: {:?}",
        worktree_res.error
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_native_validate_jail_path_command_adversarial() {
    let temp_dir = env::temp_dir().join("kin_jail_adv_tauri_cmd");
    let _ = fs::create_dir_all(&temp_dir);

    let root_str = temp_dir.to_string_lossy().to_string();

    // Sensitive file via tauri command
    let res1 = validate_jail_path(root_str.clone(), ".env".to_string());
    assert!(!res1.is_valid);
    assert!(res1.error.unwrap().contains("SECURITY JAIL VIOLATION"));

    // Traversal via tauri command
    let res2 = validate_jail_path(root_str.clone(), "../outside.txt".to_string());
    assert!(!res2.is_valid);

    // Valid path via tauri command
    let safe_file = temp_dir.join("src").join("lib.rs");
    let _ = fs::create_dir_all(temp_dir.join("src"));
    let _ = fs::write(&safe_file, "// safe");

    let res3 = validate_jail_path(root_str.clone(), safe_file.to_string_lossy().to_string());
    assert!(res3.is_valid);
    assert!(res3.error.is_none());

    let _ = fs::remove_dir_all(&temp_dir);
}
