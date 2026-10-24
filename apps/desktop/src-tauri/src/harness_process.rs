use crate::error::{Error, Result};
use std::{
    ffi::OsString,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

const MAX_INPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 1024 * 1024;
type Observer = Arc<dyn Fn(bool, &[u8]) + Send + Sync>;

pub(crate) struct Output {
    pub stdout: Vec<u8>,
    pub success: bool,
}

// 与 run 的受控执行参数保持一致，增加仅用于解析授权状态的有界输出观察器。
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_observed(
    executable: &Path,
    args: &[String],
    env: &[(OsString, OsString)],
    cwd: &Path,
    input: &[u8],
    cancel: &AtomicBool,
    timeout: Duration,
    observer: Observer,
) -> Result<Output> {
    if input.len() > MAX_INPUT_BYTES
        || timeout.is_zero()
        || !executable.is_absolute()
        || !executable
            .extension()
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        || !cwd.is_absolute()
    {
        return Err(Error::new("invalid_input"));
    }
    if cancel.load(Ordering::Acquire) {
        return Err(Error::new("cancelled"));
    }
    #[cfg(windows)]
    {
        windows::run(executable, args, env, cwd, input, cancel, timeout, observer)
    }
    #[cfg(not(windows))]
    {
        let _ = (args, env, observer);
        Err(Error::new("harness_platform_unsupported"))
    }
}

pub(crate) fn run(
    executable: &Path,
    args: &[String],
    env: &[(OsString, OsString)],
    cwd: &Path,
    input: &[u8],
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<Output> {
    run_observed(
        executable,
        args,
        env,
        cwd,
        input,
        cancel,
        timeout,
        Arc::new(|_, _| {}),
    )
}

#[cfg(windows)]
mod windows {
    use super::{
        Error, Observer, OsString, Output, Path, Result, MAX_STDERR_BYTES, MAX_STDOUT_BYTES,
    };
    use std::{
        io::{self, Read, Write},
        mem::size_of,
        os::windows::{
            io::{AsRawHandle, FromRawHandle, OwnedHandle},
            process::CommandExt,
        },
        process::{Child, Command, ExitStatus, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD,
                THREADENTRY32,
            },
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
                JobObjectExtendedLimitInformation, QueryInformationJobObject,
                SetInformationJobObject, TerminateJobObject,
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{
                OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
            },
        },
    };

    const POLL_INTERVAL: Duration = Duration::from_millis(10);
    const STOP_TIMEOUT: Duration = Duration::from_secs(5);

    // Job 与管道归单次调用所有；关闭最后一个 Job 句柄也终止后代，宿主异常退出时不遗留任务。
    struct Job(OwnedHandle);
    impl Job {
        fn new() -> Result<Self> {
            // SAFETY: 空属性创建不可继承的匿名 Job；返回句柄立即转为唯一所有者。
            let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if raw.is_null() {
                return Err(Error::new("harness_start_failed"));
            }
            // SAFETY: raw 是刚创建且非空的独占句柄。
            let job = Self(unsafe { OwnedHandle::from_raw_handle(raw) });
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: 信息指针、大小与所选结构匹配；调用期间 Job 与结构均存活。
            if unsafe {
                SetInformationJobObject(
                    job.0.as_raw_handle(),
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            } == 0
            {
                return Err(Error::new("harness_start_failed"));
            }
            Ok(job)
        }

        fn bind(&self, child: &Child) -> Result<()> {
            // SAFETY: 两个句柄均由本次调用持有；子进程仍挂起，不能在加入 Job 前产生后代。
            if unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), child.as_raw_handle()) }
                == 0
            {
                return Err(Error::new("harness_start_failed"));
            }
            Ok(())
        }

        fn stop(&self, deadline: Instant) -> Result<()> {
            // SAFETY: 只终止本次创建且持有句柄的 Job，不按进程名或重新查找的 PID 操作。
            if unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) } == 0 {
                return Err(Error::new("harness_stop_failed"));
            }
            loop {
                let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
                // SAFETY: 缓冲区为对应信息类型的有效可写结构；Job 仍由 self 持有。
                if unsafe {
                    QueryInformationJobObject(
                        self.0.as_raw_handle(),
                        JobObjectBasicAccountingInformation,
                        (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                        size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                        std::ptr::null_mut(),
                    )
                } == 0
                {
                    return Err(Error::new("harness_stop_failed"));
                }
                if accounting.ActiveProcesses == 0 {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Err(Error::new("harness_stop_failed"));
                }
                thread::sleep(POLL_INTERVAL);
            }
        }
    }

    struct Process {
        child: Child,
        job: Option<Job>,
    }
    impl Process {
        fn stop(&mut self, deadline: Instant) -> Result<()> {
            let stopped = match self.job.take() {
                Some(job) => job.stop(deadline),
                None => Ok(()),
            };
            // 即使显式终止失败，Job 已关闭；直属子进程与管道回收共用截止时间。
            let _ = self.child.kill();
            let waited = loop {
                match self.child.try_wait() {
                    Ok(Some(_)) => break Ok(()),
                    Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
                    _ => break Err(Error::new("harness_stop_failed")),
                }
            };
            stopped.and(waited)
        }
    }
    impl Drop for Process {
        fn drop(&mut self) {
            // Drop 只触发兜底终止，不执行阻塞等待；可报告的清理路径均显式调用有界 stop。
            self.job.take();
            let _ = self.child.kill();
        }
    }

    fn resume(child: &Child) -> Result<()> {
        // SAFETY: 快照不借用调用方内存；失败句柄不会转为 OwnedHandle。
        let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if raw == INVALID_HANDLE_VALUE {
            return Err(Error::new("harness_start_failed"));
        }
        // SAFETY: 快照是有效且新创建的独占句柄。
        let snapshot = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut entry = THREADENTRY32 {
            dwSize: size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut primary = None;
        // SAFETY: 快照有效，entry 已初始化且 dwSize 匹配。
        let mut found = unsafe { Thread32First(snapshot.as_raw_handle(), &mut entry) };
        while found != 0 {
            if entry.th32OwnerProcessID == child.id() {
                if primary.is_some() {
                    return Err(Error::new("harness_start_failed"));
                }
                primary = Some(entry.th32ThreadID);
            }
            entry.dwSize = size_of::<THREADENTRY32>() as u32;
            // SAFETY: 快照与输出结构在整个枚举期间有效。
            found = unsafe { Thread32Next(snapshot.as_raw_handle(), &mut entry) };
        }
        // SAFETY: 紧接失败的快照调用读取当前线程的错误码。
        if unsafe { GetLastError() } != ERROR_NO_MORE_FILES {
            return Err(Error::new("harness_start_failed"));
        }
        let id = primary.ok_or_else(|| Error::new("harness_start_failed"))?;
        // SAFETY: 只打开本次仍挂起的子进程的唯一线程；仅申请恢复所需权限。
        let raw = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, id) };
        if raw.is_null() {
            return Err(Error::new("harness_start_failed"));
        }
        // SAFETY: OpenThread 返回新建、非空的独占句柄。
        let primary = unsafe { OwnedHandle::from_raw_handle(raw) };
        // SAFETY: 已先加入 Job；恢复此调用创建且尚未运行的主线程。
        if unsafe { ResumeThread(primary.as_raw_handle()) } != 1 {
            return Err(Error::new("harness_start_failed"));
        }
        Ok(())
    }

    fn read_pipe(
        mut pipe: impl Read,
        is_stderr: bool,
        overflow: &AtomicBool,
        observer: &Observer,
    ) -> io::Result<Vec<u8>> {
        let mut output = Vec::new();
        let mut observed = 0;
        let limit = if is_stderr {
            MAX_STDERR_BYTES
        } else {
            MAX_STDOUT_BYTES
        };
        let mut buffer = [0; 8192];
        loop {
            let count = match pipe.read(&mut buffer) {
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                value => value?,
            };
            if count == 0 {
                return Ok(output);
            }
            if count > limit - observed {
                overflow.store(true, Ordering::Release);
            } else if !overflow.load(Ordering::Acquire) {
                observed += count;
                if !is_stderr {
                    output.extend_from_slice(&buffer[..count]);
                }
                // 回调可由两个读线程并发触发；它不持执行状态锁，且永远收不到超限数据。
                observer(is_stderr, &buffer[..count]);
            }
        }
    }

    fn join_before<T>(worker: thread::JoinHandle<T>, deadline: Instant) -> Result<T> {
        while !worker.is_finished() {
            if Instant::now() >= deadline {
                // 线程独占其管道、缓冲区和观察器；超时后脱离等待也不会访问调用方借用。
                return Err(Error::new("harness_stop_failed"));
            }
            thread::sleep(POLL_INTERVAL);
        }
        worker.join().map_err(|_| Error::new("harness_io_failed"))
    }

    fn cleanup_status(results: &[Result<()>]) -> Result<()> {
        if results.iter().any(|result| {
            result
                .as_ref()
                .is_err_and(|error| error.code == "harness_stop_failed")
        }) {
            return Err(Error::new("harness_stop_failed"));
        }
        Ok(())
    }

    // 与外层受控进程 API 一一对应，避免另建重复的执行参数对象。
    #[allow(clippy::too_many_arguments)]
    pub(super) fn run(
        executable: &Path,
        args: &[String],
        env: &[(OsString, OsString)],
        cwd: &Path,
        input: &[u8],
        cancel: &AtomicBool,
        timeout: Duration,
        observer: Observer,
    ) -> Result<Output> {
        let started = Instant::now();
        let job = Job::new()?;
        let child = Command::new(executable)
            .args(args)
            .env_clear()
            .envs(env.iter().cloned())
            .current_dir(cwd)
            .creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                Error::new(if error.kind() == io::ErrorKind::NotFound {
                    "harness_not_installed"
                } else {
                    "harness_start_failed"
                })
            })?;
        let mut process = Process {
            child,
            job: Some(job),
        };
        let streams = (|| {
            process
                .job
                .as_ref()
                .ok_or_else(|| Error::new("harness_start_failed"))?
                .bind(&process.child)?;
            resume(&process.child)?;
            let stdin = process
                .child
                .stdin
                .take()
                .ok_or_else(|| Error::new("harness_io_failed"))?;
            let stdout = process
                .child
                .stdout
                .take()
                .ok_or_else(|| Error::new("harness_io_failed"))?;
            let stderr = process
                .child
                .stderr
                .take()
                .ok_or_else(|| Error::new("harness_io_failed"))?;
            Ok::<_, Error>((stdin, stdout, stderr))
        })();
        let (mut stdin, stdout, stderr) = match streams {
            Ok(streams) => streams,
            Err(error) => {
                process.stop(Instant::now() + STOP_TIMEOUT)?;
                return Err(error);
            }
        };
        let overflow = Arc::new(AtomicBool::new(false));
        let output_limit = overflow.clone();
        let output_observer = observer.clone();
        let output = match thread::Builder::new()
            .spawn(move || read_pipe(stdout, false, &output_limit, &output_observer))
        {
            Ok(worker) => worker,
            Err(_) => {
                process.stop(Instant::now() + STOP_TIMEOUT)?;
                return Err(Error::new("harness_io_failed"));
            }
        };
        let error_limit = overflow.clone();
        let errors = match thread::Builder::new()
            .spawn(move || read_pipe(stderr, true, &error_limit, &observer))
        {
            Ok(worker) => worker,
            Err(_) => {
                let deadline = Instant::now() + STOP_TIMEOUT;
                let stopped = process.stop(deadline);
                let output = join_before(output, deadline).map(|_| ());
                cleanup_status(&[stopped, output])?;
                return Err(Error::new("harness_io_failed"));
            }
        };
        let input = input.to_vec();
        let writer = match thread::Builder::new().spawn(move || stdin.write_all(&input)) {
            Ok(worker) => worker,
            Err(_) => {
                let deadline = Instant::now() + STOP_TIMEOUT;
                let stopped = process.stop(deadline);
                let output = join_before(output, deadline).map(|_| ());
                let errors = join_before(errors, deadline).map(|_| ());
                cleanup_status(&[stopped, output, errors])?;
                return Err(Error::new("harness_io_failed"));
            }
        };
        let completion: Result<ExitStatus> = loop {
            if cancel.load(Ordering::Acquire) {
                break Err(Error::new("cancelled"));
            }
            if overflow.load(Ordering::Acquire) {
                break Err(Error::new("response_too_large"));
            }
            if started.elapsed() >= timeout {
                break Err(Error::new("timeout"));
            }
            match process.child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => thread::sleep(POLL_INTERVAL),
                Err(_) => break Err(Error::new("harness_execution_failed")),
            }
        };
        // 主进程成功退出也要结束遗留后代，否则继承管道的后台进程会阻止排空完成。
        let deadline = Instant::now() + STOP_TIMEOUT;
        let stopped = process.stop(deadline);
        let output = join_before(output, deadline);
        let errors = join_before(errors, deadline);
        let written = join_before(writer, deadline);
        cleanup_status(&[
            stopped,
            output
                .as_ref()
                .map(|_| ())
                .map_err(|error| Error::new(error.code)),
            errors
                .as_ref()
                .map(|_| ())
                .map_err(|error| Error::new(error.code)),
            written
                .as_ref()
                .map(|_| ())
                .map_err(|error| Error::new(error.code)),
        ])?;
        let status = completion?;
        if cancel.load(Ordering::Acquire) {
            return Err(Error::new("cancelled"));
        }
        if overflow.load(Ordering::Acquire) {
            return Err(Error::new("response_too_large"));
        }
        let stdout = output?.map_err(|_| Error::new("harness_io_failed"))?;
        errors?.map_err(|_| Error::new("harness_io_failed"))?;
        let written = written?;
        if status.success() {
            written.map_err(|_| Error::new("harness_io_failed"))?;
        }
        Ok(Output {
            stdout,
            success: status.success(),
        })
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{
        fs,
        io::{Read, Write},
        os::windows::{
            io::{AsRawHandle, FromRawHandle, OwnedHandle},
            process::CommandExt,
        },
        path::PathBuf,
        process::{Command, Stdio},
        sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc, Mutex,
        },
        thread,
        time::Instant,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, CREATE_NO_WINDOW, PROCESS_SYNCHRONIZE,
    };

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("shiroha-native-process-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn env(&self, mode: &str) -> Vec<(OsString, OsString)> {
            let mut env = vec![
                ("SHIROHA_PROCESS_FIXTURE_MODE".into(), mode.into()),
                (
                    "SHIROHA_PROCESS_FIXTURE_ROOT".into(),
                    self.0.as_os_str().to_owned(),
                ),
            ];
            if let Some(value) = std::env::var_os("SystemRoot") {
                env.push(("SystemRoot".into(), value));
            }
            env
        }
        fn run(
            &self,
            mode: &str,
            input: &[u8],
            cancel: &AtomicBool,
            timeout: Duration,
        ) -> Result<Output> {
            run(
                &std::env::current_exe().unwrap(),
                &fixture_args(),
                &self.env(mode),
                &self.0,
                input,
                cancel,
                timeout,
            )
        }
        fn run_observed(
            &self,
            mode: &str,
            input: &[u8],
            cancel: &AtomicBool,
            timeout: Duration,
            observer: Observer,
        ) -> Result<Output> {
            run_observed(
                &std::env::current_exe().unwrap(),
                &fixture_args(),
                &self.env(mode),
                &self.0,
                input,
                cancel,
                timeout,
                observer,
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn fixture_args() -> Vec<String> {
        [
            "--exact",
            "harness_process::tests::fixture_child",
            "--ignored",
            "--nocapture",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    }
    fn error_code(result: Result<Output>) -> &'static str {
        match result {
            Err(error) => error.code,
            Ok(_) => panic!("expected a safe process error"),
        }
    }

    #[test]
    fn captures_stdout_drains_stderr_and_does_not_inherit_environment() {
        let fixture = Fixture::new();
        let output = fixture
            .run(
                "duplex",
                &vec![b'i'; 512 * 1024],
                &AtomicBool::new(false),
                Duration::from_secs(10),
            )
            .unwrap();
        assert!(output.success);
        assert!(output.stdout.ends_with(b"input-bytes:524288"));
        assert!(!output
            .stdout
            .windows(13)
            .any(|value| value == b"stderr-secret"));
    }

    #[test]
    fn reports_nonzero_exit_without_returning_stderr() {
        let fixture = Fixture::new();
        let output = fixture
            .run(
                "failure",
                b"",
                &AtomicBool::new(false),
                Duration::from_secs(10),
            )
            .unwrap();
        assert!(!output.success);
        assert!(!output
            .stdout
            .windows(13)
            .any(|value| value == b"stderr-secret"));
    }

    #[test]
    fn rejects_large_input_and_pre_cancelled_requests_before_launch() {
        let fixture = Fixture::new();
        assert_eq!(
            error_code(fixture.run(
                "duplex",
                &vec![0; MAX_INPUT_BYTES + 1],
                &AtomicBool::new(false),
                Duration::from_secs(10)
            )),
            "invalid_input"
        );
        assert_eq!(
            error_code(fixture.run(
                "duplex",
                b"",
                &AtomicBool::new(true),
                Duration::from_secs(10)
            )),
            "cancelled"
        );
    }

    #[test]
    fn stdout_limit_stops_a_child_that_never_reads_stdin() {
        let fixture = Fixture::new();
        assert_eq!(
            error_code(fixture.run(
                "overflow",
                &vec![0; MAX_INPUT_BYTES],
                &AtomicBool::new(false),
                Duration::from_secs(10)
            )),
            "response_too_large"
        );
    }

    #[test]
    fn observes_both_pipes_before_the_child_completes() {
        let fixture = Fixture::new();
        let cancel = AtomicBool::new(false);
        let observed = Arc::new(Mutex::new((Vec::new(), Vec::new())));
        let captured = observed.clone();
        let (ready_tx, ready_rx) = mpsc::channel();
        let observer = Arc::new(move |is_stderr: bool, bytes: &[u8]| {
            let mut captured = captured.lock().unwrap();
            let buffer = if is_stderr {
                &mut captured.1
            } else {
                &mut captured.0
            };
            buffer.extend_from_slice(bytes);
            if captured
                .0
                .windows(18)
                .any(|value| value == b"auth-fixture-ready")
                && captured
                    .1
                    .windows(13)
                    .any(|value| value == b"stderr-secret")
            {
                let _ = ready_tx.send(());
            }
        });
        thread::scope(|scope| {
            let operation = scope.spawn(|| {
                fixture.run_observed("observed", b"", &cancel, Duration::from_secs(3), observer)
            });
            let delivered = ready_rx.recv_timeout(Duration::from_secs(2)).is_ok();
            let running = !operation.is_finished();
            fs::write(fixture.0.join("release"), b"ready").unwrap();
            let output = operation.join().unwrap().unwrap();
            assert!(
                delivered,
                "output was not observed while the child was running"
            );
            assert!(running);
            assert!(output.success);
            assert!(!output
                .stdout
                .windows(13)
                .any(|value| value == b"stderr-secret"));
        });
    }

    #[test]
    fn observers_cannot_bypass_either_pipe_limit() {
        let fixture = Fixture::new();
        for (mode, expected_stderr, limit) in [
            ("overflow", false, MAX_STDOUT_BYTES),
            ("stderr_overflow", true, MAX_STDERR_BYTES),
        ] {
            let count = Arc::new(AtomicUsize::new(0));
            let counted = count.clone();
            let result = fixture.run_observed(
                mode,
                &vec![0; MAX_INPUT_BYTES],
                &AtomicBool::new(false),
                Duration::from_secs(3),
                Arc::new(move |is_stderr, bytes| {
                    if is_stderr == expected_stderr {
                        counted.fetch_add(bytes.len(), Ordering::Relaxed);
                    }
                }),
            );
            assert_eq!(error_code(result), "response_too_large");
            assert!(count.load(Ordering::Relaxed) > 0);
            assert!(count.load(Ordering::Relaxed) <= limit);
        }
    }

    #[test]
    fn blocked_observer_cannot_make_cancellation_wait_forever() {
        let fixture = Fixture::new();
        let cancel = AtomicBool::new(false);
        let release = Arc::new(AtomicBool::new(false));
        let released = release.clone();
        let (observed_tx, observed_rx) = mpsc::channel();
        let observer = Arc::new(move |_: bool, _: &[u8]| {
            let _ = observed_tx.send(());
            while !released.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(10));
            }
        });
        let (result_tx, result_rx) = mpsc::channel();
        thread::scope(|scope| {
            scope.spawn(|| {
                let result = fixture.run_observed(
                    "wait",
                    &vec![0; MAX_INPUT_BYTES],
                    &cancel,
                    Duration::from_secs(10),
                    observer,
                );
                result_tx.send(result).unwrap();
            });
            let observed = observed_rx.recv_timeout(Duration::from_secs(2)).is_ok();
            cancel.store(true, Ordering::Release);
            let result = result_rx.recv_timeout(Duration::from_secs(6));
            release.store(true, Ordering::Release);
            assert!(observed, "observer was not called");
            assert_eq!(
                error_code(result.expect("cleanup exceeded its deadline")),
                "harness_stop_failed"
            );
        });
    }

    #[test]
    fn timeout_stops_a_child_with_a_blocked_stdin_writer() {
        let fixture = Fixture::new();
        assert_eq!(
            error_code(fixture.run(
                "wait",
                &vec![0; MAX_INPUT_BYTES],
                &AtomicBool::new(false),
                Duration::from_millis(250)
            )),
            "timeout"
        );
    }

    #[test]
    fn cancellation_waits_for_the_owned_descendant_to_exit() {
        let fixture = Fixture::new();
        let cancel = AtomicBool::new(false);
        thread::scope(|scope| {
            let operation = scope.spawn(|| {
                fixture.run(
                    "tree",
                    &vec![0; MAX_INPUT_BYTES],
                    &cancel,
                    Duration::from_secs(10),
                )
            });
            let marker = fixture.0.join("descendant.pid");
            let ready = fixture.0.join("descendant.ready");
            let deadline = Instant::now() + Duration::from_secs(8);
            while !ready.exists() {
                if operation.is_finished() {
                    match operation.join().unwrap() {
                        Ok(output) => panic!(
                            "fixture exited before readiness: {}",
                            String::from_utf8_lossy(&output.stdout)
                        ),
                        Err(error) => panic!("fixture failed before readiness: {}", error.code),
                    }
                }
                assert!(
                    Instant::now() < deadline,
                    "fixture descendant did not start"
                );
                thread::sleep(Duration::from_millis(10));
            }
            let pid = fs::read_to_string(marker).unwrap().parse::<u32>().unwrap();
            // SAFETY: The fixture recorded its own live PID; the retained handle prevents PID reuse from changing this assertion's target.
            let raw = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
            assert!(!raw.is_null());
            // SAFETY: OpenProcess returned a new owned, non-null process handle.
            let process = unsafe { OwnedHandle::from_raw_handle(raw) };
            cancel.store(true, Ordering::Release);
            assert_eq!(error_code(operation.join().unwrap()), "cancelled");
            // SAFETY: The process handle stays owned and open for the entire wait.
            assert_eq!(
                unsafe { WaitForSingleObject(process.as_raw_handle(), 2_000) },
                0
            );
        });
    }

    #[test]
    #[ignore = "仅由本模块测试以隔离环境启动的子进程入口"]
    fn fixture_child() {
        let Some(mode) = std::env::var_os("SHIROHA_PROCESS_FIXTURE_MODE") else {
            return;
        };
        std::panic::set_hook(Box::new(|info| println!("fixture panic: {info}")));
        assert!(std::env::var_os("PATH").is_none());
        match mode.to_str().unwrap() {
            "duplex" => {
                std::io::stdout()
                    .write_all(&vec![b'o'; 128 * 1024])
                    .unwrap();
                std::io::stderr()
                    .write_all(&vec![b'e'; 512 * 1024])
                    .unwrap();
                std::io::stderr().write_all(b"stderr-secret").unwrap();
                let mut input = Vec::new();
                std::io::stdin().read_to_end(&mut input).unwrap();
                write!(std::io::stdout(), "input-bytes:{}", input.len()).unwrap();
            }
            "failure" => {
                std::io::stderr().write_all(b"stderr-secret").unwrap();
                std::process::exit(23);
            }
            "overflow" => {
                std::io::stdout()
                    .write_all(&vec![b'x'; MAX_STDOUT_BYTES + 1])
                    .unwrap();
                loop {
                    thread::park();
                }
            }
            "stderr_overflow" => {
                std::io::stderr()
                    .write_all(&vec![b'e'; MAX_STDERR_BYTES + 1])
                    .unwrap();
                loop {
                    thread::park();
                }
            }
            "observed" => {
                std::io::stdout().write_all(b"auth-fixture-ready").unwrap();
                std::io::stdout().flush().unwrap();
                std::io::stderr().write_all(b"stderr-secret").unwrap();
                std::io::stderr().flush().unwrap();
                let root = PathBuf::from(std::env::var_os("SHIROHA_PROCESS_FIXTURE_ROOT").unwrap());
                while !root.join("release").exists() {
                    thread::sleep(Duration::from_millis(10));
                }
            }
            "tree" => {
                let root = PathBuf::from(std::env::var_os("SHIROHA_PROCESS_FIXTURE_ROOT").unwrap());
                let mut command = Command::new(std::env::current_exe().unwrap());
                command
                    .args(fixture_args())
                    .env_clear()
                    .env("SHIROHA_PROCESS_FIXTURE_MODE", "descendant")
                    .env("SHIROHA_PROCESS_FIXTURE_ROOT", root)
                    .creation_flags(CREATE_NO_WINDOW)
                    .stdin(Stdio::null())
                    .stdout(Stdio::inherit())
                    .stderr(Stdio::inherit());
                if let Some(value) = std::env::var_os("SystemRoot") {
                    command.env("SystemRoot", value);
                }
                let mut child = command.spawn().unwrap_or_else(|error| {
                    println!("fixture spawn failed: {:?}", error.kind());
                    std::process::exit(25);
                });
                std::process::exit(child.wait().unwrap().code().unwrap_or(24));
            }
            "descendant" => {
                let root = PathBuf::from(std::env::var_os("SHIROHA_PROCESS_FIXTURE_ROOT").unwrap());
                fs::write(root.join("descendant.pid"), std::process::id().to_string()).unwrap();
                fs::write(root.join("descendant.ready"), b"ready").unwrap();
                loop {
                    thread::park();
                }
            }
            "wait" => loop {
                thread::park();
            },
            _ => panic!("unknown fixture mode"),
        }
        std::process::exit(0);
    }
}
