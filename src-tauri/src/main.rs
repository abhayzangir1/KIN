// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kin_lib::run();
}

#[cfg(test)]
mod tests {
    use kin_lib::jail::FilesystemJail;
    use std::env;
    use std::fs;

    #[test]
    fn test_valid_contained_path() {
        let temp_dir = env::temp_dir().join("kin_jail_test_valid");
        let _ = fs::create_dir_all(&temp_dir);

        let sub_file = temp_dir.join("subdir").join("test.txt");
        let result = FilesystemJail::validate_path(&temp_dir, &sub_file);
        assert!(result.is_valid);
        assert!(result.error.is_none());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_directory_traversal_attack() {
        let temp_dir = env::temp_dir().join("kin_jail_test_attack");
        let _ = fs::create_dir_all(&temp_dir);

        let malicious_path = temp_dir.join("../../../../../Windows/System32/calc.exe");
        let result = FilesystemJail::validate_path(&temp_dir, &malicious_path);
        assert!(!result.is_valid);
        assert!(result.error.unwrap().contains("SECURITY JAIL VIOLATION"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_process_supervisor_init_and_daemon_detection() {
        use kin_lib::supervisor::ProcessSupervisor;
        let init_result = ProcessSupervisor::init();
        assert!(init_result.is_ok());
        // Inactive port probe returns false
        assert!(!ProcessSupervisor::is_daemon_active(1));
    }

    #[test]
    fn test_validate_jail_path_command() {
        let temp_dir = env::temp_dir().join("kin_jail_test_cmd");
        let _ = fs::create_dir_all(&temp_dir);

        let sub_file = temp_dir.join("safe.txt");
        let valid_res = kin_lib::jail::validate_jail_path(
            temp_dir.to_string_lossy().to_string(),
            sub_file.to_string_lossy().to_string(),
        );
        assert!(valid_res.is_valid);
        assert!(valid_res.error.is_none());

        let malicious_path = temp_dir.join("../../../../../etc/passwd");
        let invalid_res = kin_lib::jail::validate_jail_path(
            temp_dir.to_string_lossy().to_string(),
            malicious_path.to_string_lossy().to_string(),
        );
        assert!(!invalid_res.is_valid);
        assert!(invalid_res.error.is_some());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_dynamic_port_resolution() {
        use kin_lib::supervisor::ProcessSupervisor;
        // With KIN_PORT unset or default
        env::remove_var("KIN_PORT");
        assert_eq!(ProcessSupervisor::resolve_port(), 54321);

        // With custom KIN_PORT
        env::set_var("KIN_PORT", "59123");
        assert_eq!(ProcessSupervisor::resolve_port(), 59123);

        // Clean up
        env::remove_var("KIN_PORT");
    }

    #[test]
    fn test_process_supervisor_shutdown() {
        use kin_lib::supervisor::ProcessSupervisor;
        let _ = ProcessSupervisor::init();
        // Safe idempotent shutdown
        ProcessSupervisor::shutdown();
        ProcessSupervisor::shutdown();
    }
}
