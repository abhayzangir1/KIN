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
}
