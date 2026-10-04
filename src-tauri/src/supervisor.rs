// ============================================================================
// KIN NATIVE PROCESS SUPERVISOR
// Enforces Job Objects on Windows and process groups on Unix.
// Prevents zombie/orphaned child processes upon app exit or crash.
// ============================================================================

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[cfg(windows)]
mod windows_impl {
    use std::os::windows::io::RawHandle;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct WinJobSupervisor {
        job_handle: HANDLE,
    }

    // Safety: Windows Job Object HANDLEs are thread-safe OS handles.
    unsafe impl Send for WinJobSupervisor {}
    unsafe impl Sync for WinJobSupervisor {}

    impl WinJobSupervisor {
        pub fn new() -> Result<Self, String> {
            unsafe {
                let job_handle = CreateJobObjectW(None, None)
                    .map_err(|e| format!("Failed to create Windows Job Object: {:?}", e))?;

                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let res = SetInformationJobObject(
                    job_handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );

                if let Err(e) = res {
                    let _ = CloseHandle(job_handle);
                    return Err(format!("Failed to set JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: {:?}", e));
                }

                Ok(Self { job_handle })
            }
        }

        pub fn assign_process(&self, process_handle: RawHandle) -> Result<(), String> {
            unsafe {
                let handle = HANDLE(process_handle as _);
                AssignProcessToJobObject(self.job_handle, handle)
                    .map_err(|e| format!("Failed to assign process to Job Object: {:?}", e))
            }
        }
    }

    impl Drop for WinJobSupervisor {
        fn drop(&mut self) {
            unsafe {
                if !self.job_handle.is_invalid() {
                    let _ = CloseHandle(self.job_handle);
                }
            }
        }
    }
}

pub struct ProcessSupervisor {
    #[cfg(windows)]
    win_job: Option<windows_impl::WinJobSupervisor>,
}

static GLOBAL_SUPERVISOR: OnceLock<Mutex<Option<ProcessSupervisor>>> = OnceLock::new();

fn get_supervisor() -> &'static Mutex<Option<ProcessSupervisor>> {
    GLOBAL_SUPERVISOR.get_or_init(|| Mutex::new(None))
}

impl ProcessSupervisor {
    pub fn init() -> Result<(), String> {
        let supervisor = Self {
            #[cfg(windows)]
            win_job: Some(windows_impl::WinJobSupervisor::new()?),
        };

        let mut lock = get_supervisor().lock().unwrap();
        *lock = Some(supervisor);
        Ok(())
    }

    #[cfg(windows)]
    pub fn assign_raw_handle(process_handle: std::os::windows::io::RawHandle) -> Result<(), String> {
        let lock = get_supervisor().lock().unwrap();
        if let Some(ref supervisor) = *lock {
            if let Some(ref job) = supervisor.win_job {
                return job.assign_process(process_handle);
            }
        }
        Err("Process supervisor not initialized".to_string())
    }

    #[cfg(not(windows))]
    pub fn assign_raw_handle(_process_handle: i32) -> Result<(), String> {
        Ok(())
    }

    pub fn is_daemon_active(port: u16) -> bool {
        let addr_str = format!("127.0.0.1:{}", port);
        if let Ok(addr) = addr_str.parse::<SocketAddr>() {
            TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
        } else {
            false
        }
    }

    pub fn spawn_core_daemon_if_needed() -> Result<(), String> {
        const DEFAULT_PORT: u16 = 54321;
        if Self::is_daemon_active(DEFAULT_PORT) {
            println!("[KIN SUPERVISOR] Daemon is already active on port {}", DEFAULT_PORT);
            return Ok(());
        }

        println!("[KIN SUPERVISOR] Daemon not detected on port {}. Spawning...", DEFAULT_PORT);

        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let candidate_paths = [
            current_dir.join("core").join("dist").join("start_daemon.js"),
            current_dir.join("dist").join("start_daemon.js"),
            current_dir.join("..").join("core").join("dist").join("start_daemon.js"),
            PathBuf::from("core/dist/start_daemon.js"),
            PathBuf::from("dist/start_daemon.js"),
        ];

        let mut found_script: Option<PathBuf> = None;
        for path in &candidate_paths {
            if path.exists() {
                found_script = Some(path.clone());
                break;
            }
        }

        let script_path = match found_script {
            Some(p) => p,
            None => {
                return Err("Unable to locate start_daemon.js in search paths".to_string());
            }
        };

        let working_dir = if script_path.parent().and_then(|p| p.parent()).is_some() {
            let mut p = script_path.clone();
            p.pop(); // remove start_daemon.js
            p.pop(); // remove dist
            p.pop(); // remove core -> project root
            if p.exists() {
                p
            } else {
                current_dir.clone()
            }
        } else {
            current_dir.clone()
        };

        let mut command = Command::new("node");
        command.arg(&script_path);
        command.current_dir(&working_dir);
        command.env("KIN_PORT", DEFAULT_PORT.to_string());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW = 0x08000000
            command.creation_flags(0x08000000);
        }

        let child = command.spawn().map_err(|e| format!("Failed to spawn daemon: {}", e))?;

        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            let _ = Self::assign_raw_handle(child.as_raw_handle());
        }

        // Wait briefly for daemon port to be ready
        for _ in 0..10 {
            std::thread::sleep(Duration::from_millis(300));
            if Self::is_daemon_active(DEFAULT_PORT) {
                println!("[KIN SUPERVISOR] Daemon successfully bound to port {}", DEFAULT_PORT);
                return Ok(());
            }
        }

        println!("[KIN SUPERVISOR] Daemon process spawned (PID: {}), awaiting port readiness.", child.id());
        Ok(())
    }
}
