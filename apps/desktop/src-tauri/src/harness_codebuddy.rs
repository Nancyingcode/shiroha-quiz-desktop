//! 原生隔离执行核心；产品仅通过受控 Harness 入口调用，探针复用同一协议与容器。

use crate::error::{Error, Result};
use crate::harness_codebuddy_container::{Child, Profile};
use crate::harness_codebuddy_protocol::{validate_candidate, validate_upstream, VerifiedResponse};
use crate::harness_codebuddy_wire::{
    read_frame, validate_request, write_frame, HostFrame, WorkerConfig, WorkerFrame,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

const CLI_SHA256: &str = "bc404638e5e55af4030f93ed73dadc68a7ca2b7eb5df6613b07ab3510061b309";
const POLL: Duration = Duration::from_millis(10);
const CLEANUP: Duration = Duration::from_secs(5);
const MAX_STDERR: u64 = 1024 * 1024;

/// 宿主参数；父目录必须由调用方授权并预建，单次隔离运行目录由本模块生成。
pub struct PrototypeOptions {
    pub cli: PathBuf,
    pub parent: PathBuf,
    pub model: String,
    pub prompt: String,
    pub timeout: Duration,
}

/// 上游回调必须遵守取消与截止时间；生产网络实现不能由 CLI 选择 URL。
pub struct RequestContext {
    pub cancelled: Arc<AtomicBool>,
    pub deadline: Instant,
}

/// worker 只从固定进程角色入口进入，不开放给 WebView。
pub fn run_worker() -> Result<()> {
    crate::harness_codebuddy_worker::run()
}

// 证明只归一个宿主调用所有；不从管道反序列化，也不在多个任务间缓存。
enum Evidence {
    Unused,
    Pending,
    Verified(VerifiedResponse),
    Rejected,
    Cancelled,
}

impl Evidence {
    fn cancel(&mut self) {
        *self = Self::Cancelled;
    }

    fn reserve(&mut self) -> Result<()> {
        if !matches!(self, Self::Unused) {
            *self = Self::Rejected;
            return Err(Error::new("codebuddy_request_budget"));
        }
        *self = Self::Pending;
        Ok(())
    }

    fn receive(&mut self, bytes: &[u8]) -> Result<Vec<u8>> {
        if !matches!(self, Self::Pending) {
            return Err(Error::new("codebuddy_upstream_unverified"));
        }
        match validate_upstream(bytes) {
            Ok(proof) => {
                let relay = proof.relay_bytes()?;
                *self = Self::Verified(proof);
                Ok(relay)
            }
            Err(error) => {
                *self = Self::Rejected;
                Err(error)
            }
        }
    }

    fn accept(self, stdout: &[u8]) -> Result<String> {
        match self {
            Self::Verified(proof) => validate_candidate(stdout, proof),
            Self::Cancelled => Err(Error::new("cancelled")),
            _ => Err(Error::new("codebuddy_upstream_unverified")),
        }
    }
}

fn upstream_frame(evidence: &mut Evidence, response: Result<Vec<u8>>) -> Result<HostFrame> {
    let verified = match response {
        Ok(bytes) => evidence.receive(&bytes),
        Err(error) => {
            *evidence = Evidence::Rejected;
            Err(error)
        }
    };
    // 宿主已知失败立即进入统一清理，不让 CLI 重写成另一种终态或再次请求上游。
    let bytes = verified.map_err(|error| Error::new(error.code))?;
    Ok(HostFrame::Response {
        status: 200,
        body: String::from_utf8(bytes).map_err(|_| Error::new("codebuddy_upstream_unverified"))?,
    })
}

fn worker_failure(code: &str) -> Error {
    const KNOWN_CODES: &[&str] = &[
        "cancelled",
        "timeout",
        "codebuddy_config_invalid",
        "codebuddy_container_required",
        "codebuddy_frame_invalid",
        "codebuddy_output_invalid",
        "codebuddy_pipe_closed",
        "codebuddy_relay_io_failed",
        "codebuddy_relay_peer_closed",
        "codebuddy_relay_start_failed",
        "codebuddy_request_denied",
        "codebuddy_worker_environment",
        "codebuddy_worker_path",
    ];
    let known = match code {
        "harness_stop_failed" => "codebuddy_cleanup_failed",
        "harness_io_failed" => "codebuddy_pipe_closed",
        "harness_not_installed" => "codebuddy_worker_path",
        "response_too_large" => "codebuddy_output_invalid",
        _ => KNOWN_CODES
            .iter()
            .copied()
            .find(|known| *known == code)
            .unwrap_or("codebuddy_worker_failed"),
    };
    Error::new(known)
}

/// 运行固定 CLI；回调只拿模型请求正文，不接受子进程指定的出站地址。
pub fn run_prototype<F>(
    options: PrototypeOptions,
    cancel: Arc<AtomicBool>,
    upstream: F,
) -> Result<String>
where
    F: FnOnce(Value, RequestContext) -> Result<Vec<u8>> + Send + 'static,
{
    run_with_worker(options, None, cancel, upstream)
}

/// 离线验证正式 EXE 的 worker 角色；不注册生产 IPC，也不改变生产的 current_exe 来源。
#[cfg(any(test, feature = "codebuddy-prototype"))]
pub fn run_prototype_with_worker<F>(
    options: PrototypeOptions,
    worker: &Path,
    cancel: Arc<AtomicBool>,
    upstream: F,
) -> Result<String>
where
    F: FnOnce(Value, RequestContext) -> Result<Vec<u8>> + Send + 'static,
{
    run_with_worker(options, Some(worker), cancel, upstream)
}

fn run_with_worker<F>(
    options: PrototypeOptions,
    worker: Option<&Path>,
    cancel: Arc<AtomicBool>,
    upstream: F,
) -> Result<String>
where
    F: FnOnce(Value, RequestContext) -> Result<Vec<u8>> + Send + 'static,
{
    if cancel.load(Ordering::Acquire) {
        return Err(Error::new("cancelled"));
    }
    if options.timeout.is_zero()
        || options.timeout > Duration::from_secs(120)
        || options.model.is_empty()
        || options.model.len() > 128
        || !options
            .model
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_./".contains(&byte))
        || options.prompt.is_empty()
        || options.prompt.len() > 1024 * 1024
    {
        return Err(Error::new("invalid_input"));
    }
    if worker.is_some_and(|path| !path.is_absolute() || !path.is_file()) {
        return Err(Error::new("invalid_input"));
    }
    let mut session = Session::new(&options, worker, &cancel)?;
    let stop = Arc::new(AtomicBool::new(false));
    let result = session.execute(options, &cancel, stop.clone(), upstream);
    stop.store(true, Ordering::Release);
    let cleaned = session.close();
    cleaned?;
    if cancel.load(Ordering::Acquire) {
        return Err(Error::new("cancelled"));
    }
    result
}

struct Session {
    root: PathBuf,
    profile: Option<Profile>,
    child: Option<Child>,
    locks: Vec<File>,
    // 一次任务的所有清理阶段共用截止；子进程初始化失败也会启动同一个预算。
    cleanup_deadline: Arc<OnceLock<Instant>>,
    closed: bool,
}

impl Session {
    fn new(options: &PrototypeOptions, worker: Option<&Path>, cancel: &AtomicBool) -> Result<Self> {
        crate::paths::reject_links(&options.parent)?;
        if !options.parent.is_absolute() || !options.parent.is_dir() {
            return Err(Error::new("invalid_input"));
        }
        let parent = fs::canonicalize(&options.parent)?;
        let root = parent.join(format!("codebuddy-run-{}", uuid::Uuid::new_v4()));
        let profile = Profile::create()?;
        let mut session = Self {
            root,
            profile: Some(profile),
            child: None,
            locks: Vec::new(),
            cleanup_deadline: Arc::new(OnceLock::new()),
            closed: false,
        };
        let preparation = (|| {
            session
                .profile
                .as_ref()
                .ok_or_else(|| Error::new("codebuddy_isolation_failed"))?
                .prepare_directory(&session.root)?;
            for name in [
                "work",
                "home",
                "config",
                "temp",
                "appdata",
                "localappdata",
                "data",
            ] {
                fs::create_dir(session.root.join("data").join(name))?;
            }
            let cli = copy_locked(
                &options.cli,
                &session.root.join("codebuddy.exe"),
                Some(CLI_SHA256),
                cancel,
            )?;
            session.locks.push(cli);
            let worker_source = match worker {
                Some(path) => path.to_path_buf(),
                None => std::env::current_exe()?,
            };
            let worker = copy_locked(
                &worker_source,
                &session.root.join("worker.exe"),
                None,
                cancel,
            )?;
            session.locks.push(worker);
            Ok(())
        })();
        if let Err(error) = preparation {
            session.close()?;
            return Err(error);
        }
        Ok(session)
    }

    fn execute<F>(
        &mut self,
        options: PrototypeOptions,
        cancel: &Arc<AtomicBool>,
        stop: Arc<AtomicBool>,
        upstream: F,
    ) -> Result<String>
    where
        F: FnOnce(Value, RequestContext) -> Result<Vec<u8>> + Send + 'static,
    {
        let deadline = Instant::now() + options.timeout;
        if cancel.load(Ordering::Acquire) {
            return Err(Error::new("cancelled"));
        }
        let mut environment = Vec::new();
        for name in ["SystemRoot", "WINDIR"] {
            if let Some(value) = std::env::var_os(name) {
                environment.push((OsString::from(name), value));
            }
        }
        for (key, directory) in [
            ("TEMP", "temp"),
            ("TMP", "temp"),
            ("LOCALAPPDATA", "localappdata"),
            ("APPDATA", "appdata"),
            ("USERPROFILE", "home"),
            ("HOME", "home"),
        ] {
            environment.push((
                key.into(),
                self.root.join("data").join(directory).into_os_string(),
            ));
        }
        if let Some(system) = std::env::var_os("SystemRoot") {
            environment.push((
                "PATH".into(),
                Path::new(&system).join("System32").into_os_string(),
            ));
        }
        self.child = Some(
            self.profile
                .as_ref()
                .ok_or_else(|| Error::new("codebuddy_isolation_failed"))?
                .spawn(
                    &self.root.join("worker.exe"),
                    &self.root.join("data/work"),
                    &environment,
                    self.cleanup_deadline.clone(),
                )?,
        );
        let child = self
            .child
            .as_mut()
            .ok_or_else(|| Error::new("codebuddy_isolation_failed"))?;
        let mut stdin = child.take_stdin()?;
        let mut stdout = child.take_stdout()?;
        let stderr = child.take_stderr()?;
        let (incoming, received) = mpsc::sync_channel(4);
        let (outgoing, write_queue) = mpsc::sync_channel(2);
        let reader = thread::Builder::new()
            .spawn(move || loop {
                let frame = read_frame::<WorkerFrame>(&mut stdout);
                let finished = match &frame {
                    Ok(frame) => matches!(
                        frame,
                        WorkerFrame::Complete { .. } | WorkerFrame::Failed { .. }
                    ),
                    Err(_) => true,
                };
                if incoming.send(frame).is_err() || finished {
                    break;
                }
            })
            .map_err(|_| Error::new("harness_start_failed"))?;
        let writer = thread::Builder::new()
            .spawn(move || {
                while let Ok(frame) = write_queue.recv() {
                    write_frame(&mut stdin, &frame)?;
                }
                Ok::<_, Error>(())
            })
            .map_err(|_| Error::new("harness_start_failed"))?;
        let stderr_stop = stop.clone();
        let error_reader = thread::Builder::new()
            .spawn(move || {
                let mut bytes = 0;
                let mut source = stderr.take(MAX_STDERR + 1);
                let mut chunk = [0; 8192];
                while let Ok(count) = source.read(&mut chunk) {
                    if count == 0 {
                        break;
                    }
                    bytes += count;
                    if bytes as u64 > MAX_STDERR {
                        stderr_stop.store(true, Ordering::Release);
                        break;
                    }
                }
            })
            .map_err(|_| Error::new("harness_start_failed"))?;
        let config = WorkerConfig {
            model: options.model.clone(),
            prompt: options.prompt,
            capability: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
            bearer: uuid::Uuid::new_v4().simple().to_string(),
            timeout_ms: options.timeout.as_millis() as u64,
        };
        let mut upstream = Some(upstream);
        let mut upstream_thread = None;
        let (response_sender, response_receiver) = mpsc::sync_channel::<Result<Vec<u8>>>(1);
        let mut evidence = Evidence::Unused;
        let mut ready = false;
        let result = (|| {
            outgoing
                .send(HostFrame::Start { config })
                .map_err(|_| Error::new("codebuddy_pipe_closed"))?;
            loop {
                if let Err(error) = ensure_active(cancel, &stop, deadline) {
                    evidence.cancel();
                    return Err(error);
                }
                if let Ok(response) = response_receiver.try_recv() {
                    let frame = upstream_frame(&mut evidence, response)?;
                    outgoing
                        .send(frame)
                        .map_err(|_| Error::new("codebuddy_pipe_closed"))?;
                }
                let frame = received.recv_timeout(POLL);
                // 等待与解析都可能跨过取消/截止点；每次可产生副作用的动作前重查。
                ensure_active(cancel, &stop, deadline)?;
                match frame {
                    Ok(Ok(WorkerFrame::Ready { port })) if !ready && port != 0 => ready = true,
                    Ok(Ok(WorkerFrame::Request { body })) if ready => {
                        validate_request(&body, &options.model)?;
                        ensure_active(cancel, &stop, deadline)?;
                        evidence.reserve()?;
                        let callback = upstream
                            .take()
                            .ok_or_else(|| Error::new("codebuddy_request_budget"))?;
                        let sender = response_sender.clone();
                        let context = RequestContext {
                            cancelled: stop.clone(),
                            deadline,
                        };
                        let external_cancel = cancel.clone();
                        upstream_thread = Some(
                            thread::Builder::new()
                                .spawn(move || {
                                    let permitted = ensure_active(
                                        &external_cancel,
                                        &context.cancelled,
                                        context.deadline,
                                    );
                                    let response = permitted.and_then(|()| callback(body, context));
                                    let _ = sender.send(response);
                                })
                                .map_err(|_| Error::new("harness_start_failed"))?,
                        );
                    }
                    Ok(Ok(WorkerFrame::Complete {
                        success: true,
                        stdout,
                    })) if ready => {
                        let candidate = evidence.accept(stdout.as_bytes())?;
                        ensure_active(cancel, &stop, deadline)?;
                        return Ok(candidate);
                    }
                    Ok(Ok(WorkerFrame::Complete { success: false, .. })) => {
                        return Err(worker_failure("harness_execution_failed"))
                    }
                    Ok(Ok(WorkerFrame::Failed { code })) => return Err(worker_failure(&code)),
                    Ok(Err(error)) => return Err(error),
                    Ok(_) => return Err(Error::new("codebuddy_frame_invalid")),
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if child.try_wait()?.is_some() && reader.is_finished() {
                            return Err(Error::new("codebuddy_pipe_closed"));
                        }
                    }
                    Err(_) => return Err(Error::new("codebuddy_pipe_closed")),
                }
            }
        })();
        stop.store(true, Ordering::Release);
        let cleanup_deadline = *self
            .cleanup_deadline
            .get_or_init(|| Instant::now() + CLEANUP);
        let stopped = child.terminate_before(cleanup_deadline);
        drop(received);
        drop(outgoing);
        drop(response_receiver);
        let reader_done = join_before(reader, cleanup_deadline);
        let writer_done = join_before(writer, cleanup_deadline);
        let errors_done = join_before(error_reader, cleanup_deadline);
        let upstream_done = match upstream_thread {
            Some(worker) => join_before(worker, cleanup_deadline),
            None => Ok(()),
        };
        stopped?;
        reader_done?;
        writer_done??;
        errors_done?;
        upstream_done?;
        if cancel.load(Ordering::Acquire) {
            return Err(Error::new("cancelled"));
        }
        if result.is_ok() && Instant::now() >= deadline {
            return Err(Error::new("timeout"));
        }
        result
    }

    fn close(&mut self) -> Result<()> {
        if self.closed {
            return Ok(());
        }
        let cleanup_deadline = *self
            .cleanup_deadline
            .get_or_init(|| Instant::now() + CLEANUP);
        if let Some(mut child) = self.child.take() {
            child.terminate_before(cleanup_deadline)?;
        }
        self.locks.clear();
        if let Some(profile) = self.profile.take() {
            profile.close()?;
        }
        remove_run_directory(
            &self.root,
            cleanup_deadline.min(Instant::now() + Duration::from_secs(3)),
        )?;
        self.closed = true;
        Ok(())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

fn remove_run_directory(root: &Path, deadline: Instant) -> Result<()> {
    if !root.is_absolute()
        || !root
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("codebuddy-run-"))
    {
        return Err(Error::new("codebuddy_cleanup_failed"));
    }
    loop {
        crate::paths::reject_links(root)?;
        match fs::remove_dir_all(root) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                // Windows 的进程终止与映射/扫描句柄释放并非同一时刻；只对短暂占用有界重试。
                let transient = matches!(error.raw_os_error(), Some(5 | 32 | 33 | 145));
                if !transient || Instant::now() >= deadline {
                    return Err(Error::new("codebuddy_cleanup_failed"));
                }
                thread::sleep(POLL);
            }
        }
    }
}

fn join_before<T>(worker: thread::JoinHandle<T>, deadline: Instant) -> Result<T> {
    while !worker.is_finished() {
        if Instant::now() >= deadline {
            return Err(Error::new("harness_stop_failed"));
        }
        thread::sleep(POLL);
    }
    worker.join().map_err(|_| Error::new("harness_io_failed"))
}

fn ensure_active(cancel: &AtomicBool, stop: &AtomicBool, deadline: Instant) -> Result<()> {
    if cancel.load(Ordering::Acquire) || stop.load(Ordering::Acquire) {
        return Err(Error::new("cancelled"));
    }
    if Instant::now() >= deadline {
        return Err(Error::new("timeout"));
    }
    Ok(())
}

fn copy_locked(
    source: &Path,
    destination: &Path,
    expected: Option<&str>,
    cancel: &AtomicBool,
) -> Result<File> {
    crate::paths::reject_links(source)?;
    let mut input = OpenOptions::new().read(true).share_mode(1).open(source)?;
    if !input.metadata()?.is_file() {
        return Err(Error::new("harness_untrusted_binary"));
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let mut source_hasher = Sha256::new();
    let mut chunk = [0; 64 * 1024];
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err(Error::new("cancelled"));
        }
        let count = input.read(&mut chunk)?;
        if count == 0 {
            break;
        }
        output.write_all(&chunk[..count])?;
        source_hasher.update(&chunk[..count]);
    }
    let source_hash = format!("{:x}", source_hasher.finalize());
    output.sync_all()?;
    drop(output);
    let mut locked = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(destination)?;
    let mut hasher = Sha256::new();
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err(Error::new("cancelled"));
        }
        let count = locked.read(&mut chunk)?;
        if count == 0 {
            break;
        }
        hasher.update(&chunk[..count]);
    }
    let hash = format!("{:x}", hasher.finalize());
    if source_hash != hash || expected.is_some_and(|expected| expected != hash) {
        return Err(Error::new("harness_untrusted_binary"));
    }
    Ok(locked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upstream_failure_keeps_fixed_code_and_never_becomes_a_retryable_cli_response() {
        let mut evidence = Evidence::Unused;
        evidence.reserve().unwrap();
        let error = upstream_frame(
            &mut evidence,
            Err(Error {
                code: "codebuddy_auth_network",
                message: "synthetic-secret-must-not-propagate",
                retryable: true,
            }),
        )
        .err()
        .expect("upstream failure must stop the host immediately");
        assert_eq!(error.code, "codebuddy_auth_network");
        assert!(!error.message.contains("synthetic-secret"));
        assert!(!error.retryable);
        assert!(evidence.reserve().is_err());
    }

    #[test]
    fn invalid_upstream_proof_stops_before_sending_a_response_to_the_cli() {
        let mut evidence = Evidence::Unused;
        evidence.reserve().unwrap();
        let error = upstream_frame(&mut evidence, Ok(b"data: {invalid json}\n\n".to_vec()))
            .err()
            .expect("unverified upstream cannot be converted to a CLI response");
        assert_eq!(error.code, "codebuddy_upstream_unverified");
        assert!(evidence.accept(b"{}").is_err());
    }

    #[test]
    fn worker_failure_uses_only_known_static_codes() {
        for code in [
            "codebuddy_relay_start_failed",
            "codebuddy_worker_path",
            "codebuddy_frame_invalid",
        ] {
            assert_eq!(worker_failure(code).code, code);
        }
        for code in [
            "https://secret.invalid/token",
            "codebuddy_secret_dynamic",
            "codebuddy_relay_start_failed\nsecret",
        ] {
            let error = worker_failure(code);
            assert_eq!(error.code, "codebuddy_worker_failed");
            assert!(!error.message.contains(code));
        }
    }

    fn cleanup_only_session(root: PathBuf) -> Session {
        Session {
            root,
            profile: None,
            child: None,
            locks: Vec::new(),
            cleanup_deadline: Arc::new(OnceLock::new()),
            closed: false,
        }
    }

    #[test]
    fn repeated_cleanup_does_not_restart_the_task_budget() {
        let root = std::env::temp_dir().join(format!("codebuddy-run-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let file = root.join("owned.fixture");
        fs::write(&file, b"synthetic").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(file)
            .unwrap();
        let mut session = cleanup_only_session(root.clone());
        let started = Instant::now();
        let result = session.close();
        drop(session);
        let elapsed = started.elapsed();
        let preserved = root.exists();
        drop(lock);
        remove_run_directory(&root, Instant::now() + Duration::from_secs(1)).unwrap();
        assert_eq!(result.err().unwrap().code, "codebuddy_cleanup_failed");
        assert!(
            preserved,
            "locked task data must remain available after cleanup failure"
        );
        assert!(
            elapsed < CLEANUP + Duration::from_millis(500),
            "explicit cleanup and Drop restarted the budget: {elapsed:?}"
        );
    }

    #[test]
    fn completed_cleanup_does_not_touch_a_recreated_directory() {
        let root = std::env::temp_dir().join(format!("codebuddy-run-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let mut session = cleanup_only_session(root.clone());
        session.close().unwrap();
        fs::create_dir(&root).unwrap();
        let sentinel = root.join("new-owner.fixture");
        fs::write(&sentinel, b"keep").unwrap();
        drop(session);
        let preserved = fs::read(&sentinel).ok();
        remove_run_directory(&root, Instant::now() + Duration::from_secs(1)).unwrap();
        assert_eq!(preserved.as_deref(), Some(b"keep".as_slice()));
    }

    #[test]
    fn cleanup_reports_a_locked_file_and_succeeds_after_its_owner_releases_it() {
        let root = std::env::temp_dir().join(format!("codebuddy-run-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let file = root.join("owned.fixture");
        fs::write(&file, b"synthetic").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(file)
            .unwrap();
        assert_eq!(
            remove_run_directory(&root, Instant::now())
                .err()
                .unwrap()
                .code,
            "codebuddy_cleanup_failed"
        );
        drop(lock);
        remove_run_directory(&root, Instant::now() + Duration::from_secs(1)).unwrap();
        assert!(!root.exists());
        assert!(remove_run_directory(Path::new("unowned"), Instant::now()).is_err());
    }

    #[test]
    fn deadline_and_cancellation_after_a_wait_prevent_dispatch_and_acceptance() {
        let cancel = AtomicBool::new(false);
        let stop = AtomicBool::new(false);
        let expired = Instant::now();
        assert_eq!(
            ensure_active(&cancel, &stop, expired).err().unwrap().code,
            "timeout"
        );
        cancel.store(true, Ordering::Release);
        assert_eq!(
            ensure_active(&cancel, &stop, expired).err().unwrap().code,
            "cancelled"
        );
    }

    #[test]
    fn cancellation_and_invalid_input_never_open_selected_executable() {
        let options = || PrototypeOptions {
            cli: PathBuf::from("untrusted.exe"),
            parent: PathBuf::from("missing"),
            model: "default".into(),
            prompt: "fixture".into(),
            timeout: Duration::ZERO,
        };
        assert_eq!(
            run_prototype(options(), Arc::new(AtomicBool::new(true)), |_, _| panic!(
                "no upstream"
            ))
            .err()
            .unwrap()
            .code,
            "cancelled"
        );
        assert_eq!(
            run_prototype(options(), Arc::new(AtomicBool::new(false)), |_, _| panic!(
                "no upstream"
            ))
            .err()
            .unwrap()
            .code,
            "invalid_input"
        );
    }

    #[test]
    fn request_budget_is_spent_before_response_and_never_released_on_failure() {
        let mut evidence = Evidence::Unused;
        evidence.reserve().unwrap();
        assert!(evidence.receive(b"incomplete").is_err());
        assert!(evidence.reserve().is_err());
        assert!(evidence.accept(b"{}").is_err());
        let mut cancelled = Evidence::Cancelled;
        assert!(cancelled.receive(b"data: [DONE]\n\n").is_err());
    }

    #[test]
    fn relay_contains_only_verified_answer_and_cannot_be_reused() {
        let chunk = serde_json::json!({"id":"fixture", "choices":[{
            "index":0,
            "delta":{"content":"{\"ok\":true}","reasoning_content":"synthetic-private-reasoning","tool_calls":null,"refusal":null},
            "finish_reason":"stop"
        }]});
        let upstream = format!("data: {chunk}\n\ndata: [DONE]\n\n");
        let mut evidence = Evidence::Unused;
        evidence.reserve().unwrap();
        let relay = evidence.receive(upstream.as_bytes()).unwrap();
        let source = std::str::from_utf8(&relay).unwrap();
        assert!(!source.contains("synthetic-private-reasoning"));
        assert!(!source.contains("reasoning_content"));
        assert!(!source.contains("tool_calls"));
        assert!(validate_upstream(&relay).is_ok());
        assert!(matches!(evidence, Evidence::Verified(_)));
        assert!(evidence.receive(upstream.as_bytes()).is_err());
        assert!(evidence.reserve().is_err());
        assert!(evidence.accept(b"{}").is_err());
    }
}
