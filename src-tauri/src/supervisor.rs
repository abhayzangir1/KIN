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

#[cfg(unix)]
pub mod unix_impl {
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    // Up to 64 tracked process groups for lock-free async-signal-safe fallback in signal handlers
    const MAX_ATOMIC_PGIDS: usize = 64;
    static ATOMIC_PGIDS: [AtomicI32; MAX_ATOMIC_PGIDS] = {
        const INIT: AtomicI32 = AtomicI32::new(0);
        [INIT; MAX_ATOMIC_PGIDS]
    };

    fn get_child_pgids() -> &'static Mutex<Vec<i32>> {
        static CHILD_PGIDS: OnceLock<Mutex<Vec<i32>>> = OnceLock::new();
        CHILD_PGIDS.get_or_init(|| Mutex::new(Vec::new()))
    }

    static HANDLERS_INSTALLED: OnceLock<()> = OnceLock::new();

    extern "C" fn handle_termination_signal(sig: libc::c_int) {
        UnixProcessSupervisor::cleanup_signal_safe();
        unsafe {
            libc::signal(sig, libc::SIG_DFL);
            libc::raise(sig);
        }
    }

    extern "C" fn handle_process_exit() {
        UnixProcessSupervisor::cleanup();
    }

    fn install_signal_handlers_once() {
        HANDLERS_INSTALLED.get_or_init(|| {
            unsafe {
                libc::signal(libc::SIGINT, handle_termination_signal as _);
                libc::signal(libc::SIGTERM, handle_termination_signal as _);
                libc::signal(libc::SIGHUP, handle_termination_signal as _);
                libc::atexit(handle_process_exit);
            }
        });
    }

    pub struct UnixProcessSupervisor;

    impl UnixProcessSupervisor {
        pub fn new() -> Self {
            install_signal_handlers_once();
            Self
        }

        pub fn register_child_pgid(pgid: i32) {
            if pgid <= 1 {
                return;
            }
            install_signal_handlers_once();

            // 1. Primary thread-safe tracking via Mutex<Vec<i32>>
            if let Ok(mut lock) = get_child_pgids().lock() {
                if !lock.contains(&pgid) {
                    lock.push(pgid);
                }
            }

            // 2. Lockless atomic mirror for signal handlers
            for slot in &ATOMIC_PGIDS {
                let current = slot.load(Ordering::Relaxed);
                if current == pgid {
                    break;
                }
                if current == 0 {
                    if slot.compare_exchange(0, pgid, Ordering::SeqCst, Ordering::Relaxed).is_ok() {
                        break;
                    }
                }
            }
        }

        /// Comprehensive two-phase cleanup: SIGTERM, brief grace delay, then SIGKILL.
        /// Invoked on Drop, upon process exit (atexit), or explicitly.
        pub fn cleanup() {
            let pgids: Vec<i32> = {
                if let Ok(mut lock) = get_child_pgids().lock() {
                    lock.drain(..).filter(|&p| p > 1).collect()
                } else if let Ok(mut lock) = get_child_pgids().try_lock() {
                    lock.drain(..).filter(|&p| p > 1).collect()
                } else {
                    Vec::new()
                }
            };

            for slot in &ATOMIC_PGIDS {
                slot.store(0, Ordering::SeqCst);
            }

            if pgids.is_empty() {
                return;
            }

            // Phase 1: Graceful termination via SIGTERM
            for &pgid in &pgids {
                unsafe {
                    libc::kill(-pgid, libc::SIGTERM);
                }
            }

            // Grace period for graceful shutdown
            std::thread::sleep(Duration::from_millis(200));

            // Phase 2: Unconditional kill via SIGKILL to eliminate any lingering orphans
            for &pgid in &pgids {
                unsafe {
                    libc::kill(-pgid, libc::SIGKILL);
                }
            }
        }

        /// Async-signal-safe cleanup invoked directly from signal handlers
        pub fn cleanup_signal_safe() {
            if let Ok(mut lock) = get_child_pgids().try_lock() {
                for pgid in lock.drain(..).filter(|&p| p > 1) {
                    unsafe {
                        libc::kill(-pgid, libc::SIGTERM);
                    }
                }
            } else {
                for slot in &ATOMIC_PGIDS {
                    let pgid = slot.swap(0, Ordering::SeqCst);
                    if pgid > 1 {
                        unsafe {
                            libc::kill(-pgid, libc::SIGTERM);
                        }
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(200));

            for slot in &ATOMIC_PGIDS {
                let pgid = slot.swap(0, Ordering::SeqCst);
                if pgid > 1 {
                    unsafe {
                        libc::kill(-pgid, libc::SIGKILL);
                    }
                }
            }
        }
    }

    impl Drop for UnixProcessSupervisor {
        fn drop(&mut self) {
            Self::cleanup();
        }
    }
}

pub struct ProcessSupervisor {
    #[cfg(windows)]
    win_job: Option<windows_impl::WinJobSupervisor>,
    #[cfg(unix)]
    unix_sup: Option<unix_impl::UnixProcessSupervisor>,
}

impl Drop for ProcessSupervisor {
    fn drop(&mut self) {
        #[cfg(unix)]
        unix_impl::UnixProcessSupervisor::cleanup();
    }
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
            #[cfg(unix)]
            unix_sup: Some(unix_impl::UnixProcessSupervisor::new()),
        };

        let mut lock = get_supervisor().lock().unwrap();
        *lock = Some(supervisor);
        Ok(())
    }

    pub fn shutdown() {
        #[cfg(unix)]
        unix_impl::UnixProcessSupervisor::cleanup();
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
    pub fn assign_raw_handle(pid: i32) -> Result<(), String> {
        #[cfg(unix)]
        unix_impl::UnixProcessSupervisor::register_child_pgid(pid);
        let _ = pid;
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

    pub fn resolve_data_dir() -> PathBuf {
        #[cfg(windows)]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                return PathBuf::from(appdata).join("kin");
            }
            if let Ok(userprofile) = std::env::var("USERPROFILE") {
                return PathBuf::from(userprofile).join("AppData").join("Roaming").join("kin");
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Ok(home) = std::env::var("HOME") {
                return PathBuf::from(home).join("Library").join("Application Support").join("kin");
            }
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
                return PathBuf::from(xdg).join("kin");
            }
            if let Ok(home) = std::env::var("HOME") {
                return PathBuf::from(home).join(".local").join("share").join("kin");
            }
        }
        PathBuf::from(".kin")
    }

    pub fn spawn_core_daemon_if_needed() -> Result<(), String> {
        const DEFAULT_PORT: u16 = 54321;
        if Self::is_daemon_active(DEFAULT_PORT) {
            println!("[KIN SUPERVISOR] Daemon is already active on port {}", DEFAULT_PORT);
            return Ok(());
        }

        println!("[KIN SUPERVISOR] Daemon not detected on port {}. Checking for sidecar or dev script...", DEFAULT_PORT);

        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()));

        // 1. Check for standalone sidecar binary
        let sidecar_names = [
            "kin-core.exe",
            "kin-core",
            "kin-core-x86_64-pc-windows-msvc.exe",
            "kin-core-x86_64-pc-windows-gnu.exe",
            "kin-core-x86_64-unknown-linux-gnu",
            "kin-core-aarch64-unknown-linux-gnu",
            "kin-core-x86_64-apple-darwin",
            "kin-core-aarch64-apple-darwin",
        ];

        let mut sidecar_search_dirs = Vec::new();
        if let Some(ref ed) = exe_dir {
            sidecar_search_dirs.push(ed.clone());
            sidecar_search_dirs.push(ed.join("binaries"));
            sidecar_search_dirs.push(ed.join("../Resources"));
            sidecar_search_dirs.push(ed.join("../MacOS"));
        }
        sidecar_search_dirs.push(current_dir.join("src-tauri").join("binaries"));
        sidecar_search_dirs.push(current_dir.join("binaries"));
        sidecar_search_dirs.push(current_dir.clone());

        let mut found_sidecar: Option<PathBuf> = None;
        'outer: for dir in &sidecar_search_dirs {
            for name in &sidecar_names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    found_sidecar = Some(candidate);
                    break 'outer;
                }
            }
        }

        if let Some(sidecar_path) = found_sidecar {
            println!("[KIN SUPERVISOR] Found standalone sidecar binary at: {:?}", sidecar_path);
            let mut command = Command::new(&sidecar_path);
            command.env("KIN_PORT", DEFAULT_PORT.to_string());
            let kin_data_dir = Self::resolve_data_dir();
            let _ = std::fs::create_dir_all(&kin_data_dir);
            command.env("KIN_DATA_DIR", kin_data_dir.to_string_lossy().to_string());
            if let Some(parent) = sidecar_path.parent() {
                command.current_dir(parent);
            }

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                // CREATE_NO_WINDOW = 0x08000000
                command.creation_flags(0x08000000);
            }
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                command.process_group(0);
            }

            let mut child = command.spawn().map_err(|e| format!("Failed to spawn sidecar daemon: {}", e))?;

            #[cfg(windows)]
            {
                use std::os::windows::io::AsRawHandle;
                let _ = Self::assign_raw_handle(child.as_raw_handle());
            }
            #[cfg(unix)]
            {
                let pid = child.id() as i32;
                unix_impl::UnixProcessSupervisor::register_child_pgid(pid);
            }

            // Wait briefly for daemon port to be ready
            for _ in 0..15 {
                std::thread::sleep(Duration::from_millis(300));
                if let Ok(Some(status)) = child.try_wait() {
                    eprintln!("[KIN SUPERVISOR] Sidecar daemon exited prematurely with status: {:?}", status);
                    break;
                }
                if Self::is_daemon_active(DEFAULT_PORT) {
                    println!("[KIN SUPERVISOR] Sidecar daemon successfully bound to port {}", DEFAULT_PORT);
                    return Ok(());
                }
            }

            println!("[KIN SUPERVISOR] Sidecar failed to bind to port {}. Falling back to development runner...", DEFAULT_PORT);
        }

        // 2. Fall back to development start_daemon.js via Node
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
                return Err("Unable to locate start_daemon.js or sidecar binary in search paths".to_string());
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
        let kin_data_dir = Self::resolve_data_dir();
        let _ = std::fs::create_dir_all(&kin_data_dir);
        command.env("KIN_DATA_DIR", kin_data_dir.to_string_lossy().to_string());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW = 0x08000000
            command.creation_flags(0x08000000);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        let child = command.spawn().map_err(|e| format!("Failed to spawn daemon: {}", e))?;

        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            let _ = Self::assign_raw_handle(child.as_raw_handle());
        }
        #[cfg(unix)]
        {
            let pid = child.id() as i32;
            unix_impl::UnixProcessSupervisor::register_child_pgid(pid);
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
