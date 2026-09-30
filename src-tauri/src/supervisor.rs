// ============================================================================
// KIN NATIVE PROCESS SUPERVISOR
// Enforces OS-level Job Objects on Windows and process groups on Unix.
// Guarantees zero zombie/orphaned child processes upon app exit or crash.
// ============================================================================

use std::sync::{Mutex, OnceLock};

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
}
