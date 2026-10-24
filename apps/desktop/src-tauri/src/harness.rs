use crate::{
    commands::authorize,
    error::{Error, Result},
    harness_codex as codex,
    paths::reject_links,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};

const MAX_CANCELLED_REQUESTS: usize = 1024;
const STOP_WAIT_TIMEOUT: Duration = Duration::from_secs(7);
const MAX_MESSAGES: usize = 100;
const MAX_MESSAGE_BYTES: usize = 512 * 1024;
const MIN_TIMEOUT_SECONDS: u64 = 10;
const MAX_TIMEOUT_SECONDS: u64 = 600;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeSource {
    Managed,
    Custom,
}
fn legacy_runtime_source() -> RuntimeSource {
    RuntimeSource::Custom
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeState {
    Unprepared,
    Preparing,
    Ready,
    Failed,
    Cancelled,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    schema: u8,
    revision: u64,
    mode: String,
    adapter: String,
    model: String,
    timeout_seconds: u64,
    runtime_path: PathBuf,
    #[serde(default = "legacy_runtime_source")]
    runtime_source: RuntimeSource,
    verified: bool,
    logout_pending: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            schema: 1,
            revision: 0,
            mode: "api".into(),
            adapter: "codex".into(),
            model: String::new(),
            timeout_seconds: 120,
            runtime_path: PathBuf::new(),
            runtime_source: RuntimeSource::Managed,
            verified: false,
            logout_pending: false,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    mode: String,
    adapter: String,
    model: String,
    timeout_seconds: u64,
    credential_status: String,
    runtime_path: String,
    runtime_version: String,
    runtime_source: RuntimeSource,
    runtime_state: RuntimeState,
    runtime_received_bytes: u64,
    runtime_total_bytes: u64,
    ready: bool,
    reason: String,
    revision: u64,
    busy: bool,
    login_url: String,
    user_code: String,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Control {
    Status,
    ChooseRuntime,
    PrepareRuntime {},
    UseManagedRuntime {},
    Inspect,
    CancelAll,
    Cancel {
        id: String,
    },
    Clear,
    Login,
    Logout,
    #[serde(rename_all = "camelCase")]
    Save {
        mode: String,
        adapter: String,
        model: String,
        timeout_seconds: u64,
        revision: u64,
    },
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Task {
    ConnectionTest,
    ImportOrganize,
    BatchReview,
    BatchAnalysis,
    QuestionAnalysis,
    QuestionFollowup,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    pub(crate) role: String,
    pub(crate) content: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    id: String,
    revision: u64,
    task: Task,
    messages: Vec<Message>,
}
struct Active {
    id: String,
    cancel: Arc<AtomicBool>,
    login: bool,
}
struct Inner {
    root: PathBuf,
    db: Connection,
    config: Config,
    candidate: Option<PathBuf>,
    // 准备状态仅属于当前进程；成功路径和来源随配置持久化，重启不恢复下载。
    runtime_state: RuntimeState,
    runtime_received_bytes: u64,
    runtime_total_bytes: u64,
    active: Option<Active>,
    barrier: bool,
    restores: usize,
    cancel_waiters: usize,
    cancelled: HashSet<String>,
    subscription: bool,
    login_url: String,
    user_code: String,
    notice: String,
}
#[derive(Clone)]
struct Operation {
    id: String,
    config: Config,
    root: PathBuf,
    cancel: Arc<AtomicBool>,
}

// 恢复令牌随阻塞存储操作所有权移动，异步调用被丢弃也不能提前解除屏障。
pub(crate) struct RestoreGuard {
    harness: Option<Arc<Harness>>,
}
impl Drop for RestoreGuard {
    fn drop(&mut self) {
        if let Some(harness) = &self.harness {
            let _ = harness.with(|state| {
                state.restores -= 1;
                Ok(())
            });
            harness.idle.notify_all();
        }
    }
}

// 本应用进程拥有执行配置与唯一活动任务；配置锁不跨越任务进程等待，取消等待任务确认退出。
pub struct Harness {
    inner: Mutex<Result<Inner>>,
    idle: Condvar,
}
impl Harness {
    pub fn open(root: &Path) -> Self {
        Self {
            inner: Mutex::new(Inner::open(&root.join("ai-execution"))),
            idle: Condvar::new(),
        }
    }
    fn with<T>(&self, action: impl FnOnce(&mut Inner) -> Result<T>) -> Result<T> {
        let mut lock = self
            .inner
            .lock()
            .map_err(|_| failure("harness_unavailable"))?;
        action(lock.as_mut().map_err(|_| failure("harness_unavailable"))?)
    }
    fn cancel(&self, id: Option<&str>, invalidate: bool) -> Result<Status> {
        let mut lock = self
            .inner
            .lock()
            .map_err(|_| failure("harness_unavailable"))?;
        let state = lock.as_mut().map_err(|_| failure("harness_unavailable"))?;
        if state.barrier {
            return Err(failure("harness_stopping"));
        }
        if let Some(id) = id {
            if uuid::Uuid::parse_str(id).is_err() {
                return Err(failure("invalid_input"));
            }
            if !state.active.as_ref().is_some_and(|active| active.id == id)
                && !state.cancelled.contains(id)
            {
                if state.cancelled.len() >= MAX_CANCELLED_REQUESTS {
                    // 容量轮换必须同时失效旧 revision，不能遗忘标记后允许排队请求重新启动。
                    let mut config = state.config.clone();
                    config.revision += 1;
                    state.persist(config)?;
                    state.cancelled.clear();
                }
                // cancel IPC 可能先于 execute 的阻塞队列运行，保留标记避免已取消请求之后才启动。
                state.cancelled.insert(id.to_owned());
            }
        } else {
            state.cancel_waiters += 1;
            if let Some(active) = &state.active {
                active.cancel.store(true, Ordering::Release);
            }
            let mut config = state.config.clone();
            config.revision += 1;
            if invalidate {
                config.verified = false;
            }
            if let Err(error) = state.persist(config) {
                state.cancel_waiters -= 1;
                state.poison();
                return Err(error);
            }
            if invalidate {
                state.candidate = None;
                if state.runtime_state != RuntimeState::Preparing {
                    state.runtime_state = RuntimeState::Unprepared;
                }
            }
        }
        let target = state
            .active
            .as_ref()
            .filter(|active| id.is_none() || id == Some(active.id.as_str()))
            .map(|active| {
                active.cancel.store(true, Ordering::Release);
                active.id.clone()
            });
        let deadline = std::time::Instant::now() + STOP_WAIT_TIMEOUT;
        let mut timed_out = false;
        while let Some(target) = &target {
            let state = lock.as_ref().map_err(|_| failure("harness_unavailable"))?;
            if state.barrier
                || !state
                    .active
                    .as_ref()
                    .is_some_and(|active| &active.id == target)
            {
                break;
            }
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                timed_out = true;
                break;
            }
            let (next, wait) = self
                .idle
                .wait_timeout(lock, remaining)
                .map_err(|_| failure("harness_unavailable"))?;
            lock = next;
            if wait.timed_out() {
                timed_out = true;
                break;
            }
        }
        let state = lock.as_mut().map_err(|_| failure("harness_unavailable"))?;
        if id.is_none() {
            state.cancel_waiters -= 1;
        }
        if timed_out {
            state.poison();
        }
        if state.barrier {
            return Err(failure("harness_stopping"));
        }
        if id.is_none() {
            state.cancelled.clear();
        }
        Ok(state.status())
    }
    pub(crate) fn begin_restore(self: &Arc<Self>) -> Result<RestoreGuard> {
        // 独立执行配置损坏时没有可启动的 Harness，不能阻断题库自身的恢复路径。
        let enabled = {
            let mut lock = self
                .inner
                .lock()
                .map_err(|_| failure("harness_unavailable"))?;
            match lock.as_mut() {
                Ok(state) => {
                    if state.barrier {
                        return Err(failure("harness_stopping"));
                    }
                    state.restores += 1;
                    true
                }
                Err(_) => false,
            }
        };
        let guard = RestoreGuard {
            harness: enabled.then(|| self.clone()),
        };
        if enabled {
            self.cancel(None, true)?;
        }
        Ok(guard)
    }
    #[cfg(test)]
    fn invalidate(&self) -> Result<()> {
        self.cancel(None, true).map(|_| ())
    }
    fn finish<T, R>(
        &self,
        operation: &Operation,
        result: Result<T>,
        apply: impl FnOnce(&mut Inner, Result<T>) -> Result<R>,
    ) -> Result<R> {
        let result = self.with(|state| {
            if result
                .as_ref()
                .is_err_and(|error| error.code == "harness_stop_failed")
            {
                state.poison();
                return Err(failure("harness_stopping"));
            }
            if !state
                .active
                .as_ref()
                .is_some_and(|active| active.id == operation.id)
            {
                state.poison();
                return Err(failure("harness_stopping"));
            }
            state.active = None;
            state.cancelled.remove(&operation.id);
            let result = if operation.cancel.load(Ordering::Acquire) {
                Err(failure("cancelled"))
            } else if operation.config.revision != state.config.revision {
                Err(failure("harness_stale"))
            } else {
                result
            };
            apply(state, result)
        });
        self.idle.notify_all();
        result
    }
    fn refresh(&self) -> Result<Status> {
        let operation = self.with(|state| {
            if state.busy() || !state.config.verified || state.config.logout_pending {
                return Ok(None);
            }
            state
                .start(uuid::Uuid::new_v4().to_string(), false)
                .map(Some)
        })?;
        let Some(operation) = operation else {
            return self.with(|state| Ok(state.status()));
        };
        let result = codex::subscription(
            &operation.root,
            &operation.config.runtime_path,
            &operation.cancel,
        );
        self.finish(&operation, result, |state, result| {
            let subscribed = match result {
                Ok(value) => value,
                Err(error) => {
                    state.update_subscription(false)?;
                    return Err(error);
                }
            };
            state.update_subscription(subscribed)?;
            Ok(state.status())
        })
    }
    fn control(self: &Arc<Self>, request: Control) -> Result<Status> {
        match request {
            Control::Status => self.with(|state| Ok(state.status())),
            Control::PrepareRuntime {} => self.start_preparation(false),
            Control::UseManagedRuntime {} => self.start_preparation(true),
            Control::CancelAll => self.cancel(None, false),
            Control::Cancel { id } => self.cancel(Some(&id), false),
            Control::ChooseRuntime => {
                self.with(|state| state.ensure_idle())?;
                #[cfg(any(test, feature = "native-test"))]
                let selected = Some(PathBuf::from("isolated-fake-codex.exe"));
                #[cfg(not(any(test, feature = "native-test")))]
                let selected = rfd::FileDialog::new()
                    .set_title("选择 Codex 0.163.0 Windows x64 程序")
                    .add_filter("Codex 程序", &["exe"])
                    .pick_file();
                if let Some(path) = selected {
                    codex::inspect(&path)?;
                    self.with(|state| {
                        state.ensure_idle()?;
                        state.candidate = Some(path);
                        state.runtime_state = RuntimeState::Ready;
                        state.notice.clear();
                        Ok(state.status())
                    })
                } else {
                    self.refresh()
                }
            }
            Control::Inspect => {
                self.with(|state| {
                    state.ensure_idle()?;
                    codex::inspect(
                        state
                            .candidate
                            .as_ref()
                            .unwrap_or(&state.config.runtime_path),
                    )?;
                    if state.candidate.is_none() {
                        let mut config = state.config.clone();
                        config.verified = true;
                        config.revision += 1;
                        state.persist(config)?;
                    }
                    state.runtime_state = RuntimeState::Ready;
                    if !state.config.logout_pending {
                        state.notice.clear();
                    }
                    Ok(())
                })?;
                self.refresh()
            }
            Control::Save {
                mode,
                adapter,
                model,
                timeout_seconds,
                revision,
            } => {
                self.with(|state| {
                    state.ensure_idle()?;
                    if revision != state.config.revision {
                        return Err(failure("harness_stale"));
                    }
                    if !matches!(mode.as_str(), "api" | "harness")
                        || adapter != "codex"
                        || !(MIN_TIMEOUT_SECONDS..=MAX_TIMEOUT_SECONDS).contains(&timeout_seconds)
                    {
                        return Err(failure("invalid_input"));
                    }
                    let mut config = state.config.clone();
                    config.mode = mode;
                    config.revision += 1;
                    if config.mode == "harness" {
                        if model != "gpt-6.1-sol" {
                            return Err(failure("invalid_input"));
                        }
                        if let Some(path) = &state.candidate {
                            config.runtime_path = path.clone();
                            config.runtime_source = RuntimeSource::Custom;
                        }
                        codex::inspect(&config.runtime_path)?;
                        config.verified = true;
                        config.model = model;
                        config.timeout_seconds = timeout_seconds;
                    }
                    state.persist(config)?;
                    state.candidate = None;
                    state.notice.clear();
                    if state.config.mode == "harness" {
                        state.runtime_state = RuntimeState::Ready;
                    }
                    Ok(())
                })?;
                self.refresh()
            }
            Control::Login => self.start_login(),
            Control::Logout | Control::Clear => self.logout(matches!(request, Control::Clear)),
        }
    }
    fn start_preparation(self: &Arc<Self>, use_managed: bool) -> Result<Status> {
        let operation = self.with(|state| {
            state.ensure_idle()?;
            let mut operation = state.start(uuid::Uuid::new_v4().to_string(), false)?;
            if use_managed {
                operation.config.runtime_source = RuntimeSource::Managed;
            } else if let Some(path) = &state.candidate {
                operation.config.runtime_source = RuntimeSource::Custom;
                operation.config.runtime_path = path.clone();
            }
            state.runtime_state = RuntimeState::Preparing;
            state.runtime_received_bytes = 0;
            state.runtime_total_bytes = 0;
            state.notice.clear();
            Ok(operation)
        })?;
        let worker = self.clone();
        let worker_operation = operation.clone();
        let spawned = std::thread::Builder::new()
            .name("codex-runtime-preparation".into())
            .spawn(move || {
                let result = prepare_component(&worker_operation, &|received, total| {
                    let _ = worker.with(|state| {
                        let owns_preparation = state.active.as_ref().is_some_and(|active| {
                            active.id == worker_operation.id
                                && !active.cancel.load(Ordering::Acquire)
                                && state.config.revision == worker_operation.config.revision
                        });
                        if owns_preparation {
                            state.runtime_received_bytes = received;
                            state.runtime_total_bytes = total;
                        }
                        Ok(())
                    });
                });
                let _ = worker.finish(&worker_operation, result, |state, result| {
                    let applied = result.and_then(|path| {
                        let mut config = state.config.clone();
                        config.runtime_path = path;
                        config.runtime_source = worker_operation.config.runtime_source;
                        config.verified = true;
                        config.revision += 1;
                        state.persist(config)?;
                        state.candidate = None;
                        Ok(())
                    });
                    match applied {
                        Ok(()) => {
                            state.runtime_state = RuntimeState::Ready;
                            state.notice.clear();
                        }
                        Err(error) => {
                            state.runtime_state = if error.code == "cancelled" {
                                RuntimeState::Cancelled
                            } else {
                                RuntimeState::Failed
                            };
                            state.notice = if error.code == "cancelled" {
                                "Codex 组件准备已取消，请主动重试。".into()
                            } else {
                                failure(error.code).message.into()
                            };
                        }
                    }
                    Ok(())
                });
            });
        if spawned.is_err() {
            self.finish(
                &operation,
                Err::<(), _>(failure("harness_unavailable")),
                |state, result| {
                    state.runtime_state = RuntimeState::Failed;
                    state.notice = failure("harness_unavailable").message.into();
                    result
                },
            )?;
        }
        self.with(|state| Ok(state.status()))
    }

    fn logout(&self, clear: bool) -> Result<Status> {
        self.cancel(None, false)?;
        let operation = self.with(|state| {
            state.ensure_idle()?;
            let mut config = state.config.clone();
            config.logout_pending = true;
            config.revision += 1;
            state.persist(config)?;
            state.subscription = false;
            state.login_url.clear();
            state.user_code.clear();
            state.start(uuid::Uuid::new_v4().to_string(), false)
        })?;
        let result = codex::logout(
            &operation.root,
            &operation.config.runtime_path,
            &operation.cancel,
        );
        self.finish(&operation, result, |state, result| {
            result?;
            let mut config = if clear {
                Config {
                    mode: state.config.mode.clone(),
                    revision: state.config.revision + 1,
                    ..Config::default()
                }
            } else {
                let mut config = state.config.clone();
                config.revision += 1;
                config
            };
            config.logout_pending = false;
            state.persist(config)?;
            state.candidate = None;
            if clear {
                state.runtime_state = RuntimeState::Unprepared;
                state.runtime_received_bytes = 0;
                state.runtime_total_bytes = 0;
            }
            state.notice.clear();
            Ok(state.status())
        })
    }
    fn start_login(self: &Arc<Self>) -> Result<Status> {
        self.refresh()?;
        let operation = self.with(|state| {
            state.ensure_idle()?;
            if !state.config.verified {
                return Err(failure("harness_not_ready"));
            }
            if state.config.logout_pending {
                return Err(failure("harness_auth_cleanup"));
            }
            if state.subscription {
                return Err(failure("harness_already_authenticated"));
            }
            // CLI 可能在退出或取消确认前写入凭据；开始授权即持久停用，只有完整成功才能解除。
            let mut config = state.config.clone();
            config.logout_pending = true;
            config.revision += 1;
            state.persist(config)?;
            state.subscription = false;
            state.login_url.clear();
            state.user_code.clear();
            state.notice.clear();
            state.start(uuid::Uuid::new_v4().to_string(), true)
        })?;
        let state = self.clone();
        let progress = self.clone();
        let progress_id = operation.id.clone();
        let worker_operation = operation.clone();
        let spawned = std::thread::Builder::new()
            .name("codex-subscription-login".into())
            .spawn(move || {
                let result = codex::login(
                    &worker_operation.root,
                    &worker_operation.config.runtime_path,
                    &worker_operation.cancel,
                    Arc::new(move |url, code| {
                        let _ = progress.with(|inner| {
                            if inner.active.as_ref().is_some_and(|active| {
                                active.id == progress_id
                                    && active.login
                                    && !active.cancel.load(Ordering::Acquire)
                            }) {
                                inner.login_url = url;
                                inner.user_code = code;
                            }
                            Ok(())
                        });
                    }),
                );
                let _ = state.finish(&worker_operation, result, |inner, result| {
                    inner.login_url.clear();
                    inner.user_code.clear();
                    inner.notice = result
                        .as_ref()
                        .err()
                        .map(|error| failure(error.code).message.to_owned())
                        .unwrap_or_default();
                    let mut config = inner.config.clone();
                    config.revision += 1;
                    if result.is_ok() {
                        config.logout_pending = false;
                    }
                    if let Err(error) = inner.persist(config) {
                        inner.subscription = false;
                        inner.config.verified = false;
                        inner.notice = failure(error.code).message.into();
                        return Err(error);
                    }
                    inner.subscription = result.is_ok();
                    result
                });
            });
        if spawned.is_err() {
            return self.finish(
                &operation,
                Err::<(), _>(failure("harness_unavailable")),
                |_, result| result.and_then(|_| Err(failure("harness_unavailable"))),
            );
        }
        self.with(|state| Ok(state.status()))
    }
    fn execute(&self, request: Request) -> Result<Value> {
        validate_request(&request)?;
        let operation = self.with(|state| {
            if state.cancelled.remove(&request.id) {
                return Err(failure("cancelled"));
            }
            state.ensure_idle()?;
            if request.revision != state.config.revision {
                return Err(failure("harness_stale"));
            }
            if state.config.mode != "harness" || !state.status().ready {
                return Err(failure("harness_not_ready"));
            }
            state.start(request.id, false)
        })?;
        let result = codex::execute(
            &operation.root,
            &operation.config.runtime_path,
            &operation.config.model,
            operation.config.timeout_seconds,
            request.task,
            &request.messages,
            &operation.cancel,
        );
        self.finish(&operation, result, |_, result| {
            result.map(|content| json!({"content":content}))
        })
        .map_err(|error| failure(error.code))
    }
}

fn prepare_component(
    operation: &Operation,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> Result<PathBuf> {
    if operation.cancel.load(Ordering::Acquire) {
        return Err(failure("cancelled"));
    }
    if operation.config.runtime_source == RuntimeSource::Custom {
        codex::inspect_cancellable(&operation.config.runtime_path, &operation.cancel)?;
        return Ok(operation.config.runtime_path.clone());
    }
    #[cfg(not(any(test, feature = "native-test")))]
    {
        tauri::async_runtime::block_on(crate::harness_runtime::prepare(
            &operation.root,
            &operation.cancel,
            progress,
        ))
    }
    #[cfg(any(test, feature = "native-test"))]
    {
        progress(0, 1);
        let wait_marker = operation.root.join("fake-prepare-wait");
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while wait_marker.exists() {
            if operation.cancel.load(Ordering::Acquire) {
                return Err(failure("cancelled"));
            }
            if std::time::Instant::now() >= deadline {
                return Err(failure("timeout"));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if operation.cancel.load(Ordering::Acquire) {
            return Err(failure("cancelled"));
        }
        if operation.root.join("fake-prepare-failed").exists() {
            return Err(failure("harness_runtime_download"));
        }
        progress(1, 1);
        Ok(PathBuf::from("isolated-fake-codex.exe"))
    }
}

impl Inner {
    fn open(root: &Path) -> Result<Self> {
        reject_links(root)?;
        std::fs::create_dir_all(root)?;
        for name in [
            "execution.sqlite3",
            "execution.sqlite3-journal",
            "execution.sqlite3-wal",
            "execution.sqlite3-shm",
        ] {
            reject_links(&root.join(name))?;
        }
        let db = Connection::open(root.join("execution.sqlite3"))?;
        db.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS config(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);")?;
        let raw: Option<String> = db
            .query_row("SELECT value FROM config WHERE id=1", [], |row| row.get(0))
            .optional()?;
        let mut config: Config = match raw {
            Some(raw) => serde_json::from_str(&raw)?,
            None => Config::default(),
        };
        if config.runtime_path.as_os_str().is_empty() {
            config.runtime_source = RuntimeSource::Managed;
        }
        if config.schema != 1
            || !matches!(config.mode.as_str(), "api" | "harness")
            || config.adapter != "codex"
        {
            return Err(failure("invalid_input"));
        }
        let runtime_state = if config.verified {
            RuntimeState::Ready
        } else {
            RuntimeState::Unprepared
        };
        Ok(Self {
            root: root.to_path_buf(),
            db,
            config,
            candidate: None,
            runtime_state,
            runtime_received_bytes: 0,
            runtime_total_bytes: 0,
            active: None,
            barrier: false,
            restores: 0,
            cancel_waiters: 0,
            cancelled: HashSet::new(),
            subscription: false,
            login_url: String::new(),
            user_code: String::new(),
            notice: String::new(),
        })
    }
    fn busy(&self) -> bool {
        self.active.is_some() || self.barrier || self.restores > 0 || self.cancel_waiters > 0
    }
    fn ensure_idle(&self) -> Result<()> {
        if self.barrier {
            Err(failure("harness_stopping"))
        } else if self.busy() {
            Err(failure("harness_busy"))
        } else {
            Ok(())
        }
    }
    fn poison(&mut self) {
        // 停止未确认必须保持到进程重启，普通 cancelAll 和恢复令牌都不能解除。
        self.barrier = true;
        self.subscription = false;
        self.config.verified = false;
        self.runtime_state = RuntimeState::Failed;
        self.login_url.clear();
        self.user_code.clear();
        self.notice = failure("harness_stopping").message.to_owned();
        if let Some(active) = &self.active {
            active.cancel.store(true, Ordering::Release);
        }
    }
    fn start(&mut self, id: String, login: bool) -> Result<Operation> {
        self.ensure_idle()?;
        let cancel = Arc::new(AtomicBool::new(false));
        self.active = Some(Active {
            id: id.clone(),
            cancel: cancel.clone(),
            login,
        });
        Ok(Operation {
            id,
            config: self.config.clone(),
            root: self.root.clone(),
            cancel,
        })
    }
    fn update_subscription(&mut self, subscribed: bool) -> Result<()> {
        if self.subscription != subscribed {
            let mut config = self.config.clone();
            config.revision += 1;
            if let Err(error) = self.persist(config) {
                self.subscription = false;
                self.config.verified = false;
                return Err(error);
            }
            self.subscription = subscribed;
        }
        Ok(())
    }
    fn persist(&mut self, config: Config) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO config VALUES(1,?)",
            [serde_json::to_string(&config)?],
        )?;
        self.config = config;
        Ok(())
    }
    fn status(&self) -> Status {
        let authenticating = self.active.as_ref().is_some_and(|active| active.login);
        let ready = self.config.verified
            && self.runtime_state == RuntimeState::Ready
            && !self.config.logout_pending
            && self.subscription
            && !self.config.model.is_empty()
            && !self.busy();
        let reason = if self.barrier {
            "Codex 停止状态尚未确认，请重新启动应用。"
        } else if self.restores > 0 {
            "数据恢复期间不能启动 Codex，请等待恢复完成后重新检测。"
        } else if self.runtime_state == RuntimeState::Preparing {
            "正在准备 Codex 组件，可取消；不会发起模型请求。"
        } else if !self.notice.is_empty() {
            &self.notice
        } else if authenticating {
            "请打开官方登录地址，输入设备码完成订阅登录。"
        } else if !self.config.verified {
            "请准备 Codex 组件后登录订阅；恢复数据后需重新检测。"
        } else if self.config.logout_pending {
            failure("harness_auth_cleanup").message
        } else if !self.subscription {
            "请单独登录 ChatGPT 订阅；不会读取其他 Codex 应用的登录状态。"
        } else {
            "已登录订阅；测试连接会使用所选模型并消耗订阅用量。"
        };
        Status {
            mode: self.config.mode.clone(),
            adapter: "codex".into(),
            model: self.config.model.clone(),
            timeout_seconds: self.config.timeout_seconds,
            credential_status: if authenticating {
                "authenticating"
            } else if self.subscription {
                "subscription"
            } else {
                "missing"
            }
            .into(),
            runtime_path: self
                .candidate
                .as_ref()
                .unwrap_or(&self.config.runtime_path)
                .display()
                .to_string(),
            runtime_version: if self.config.verified || self.candidate.is_some() {
                codex::VERSION.into()
            } else {
                String::new()
            },
            runtime_source: if self.candidate.is_some() {
                RuntimeSource::Custom
            } else {
                self.config.runtime_source
            },
            runtime_state: self.runtime_state,
            runtime_received_bytes: self.runtime_received_bytes,
            runtime_total_bytes: self.runtime_total_bytes,
            ready,
            reason: reason.into(),
            revision: self.config.revision,
            busy: self.busy(),
            login_url: self.login_url.clone(),
            user_code: self.user_code.clone(),
        }
    }
}
fn validate_request(request: &Request) -> Result<()> {
    if uuid::Uuid::parse_str(&request.id).is_err()
        || request.messages.is_empty()
        || request.messages.len() > MAX_MESSAGES
    {
        return Err(failure("invalid_input"));
    }
    let mut size = 0;
    for message in &request.messages {
        if !matches!(message.role.as_str(), "system" | "user" | "assistant") {
            return Err(failure("invalid_input"));
        }
        size += message.content.len();
    }
    if size > MAX_MESSAGE_BYTES {
        return Err(failure("payload_too_large"));
    }
    Ok(())
}
pub(crate) fn failure(code: &'static str) -> Error {
    let message = match code {
        "cancelled" => "Codex 任务已停止。",
        "timeout" => "Codex 执行超时，已停止本次任务；请主动重试。",
        "harness_busy" | "harness_stopping" => "Codex 任务尚未停止，请等待停止完成后重试。",
        "harness_stale" => "AI 执行配置已变化，请重新发起任务。",
        "harness_runtime" => {
            "Codex 组件未通过校验，请重新准备；高级设置仅支持已验证的 0.163.0 Windows x64 程序。"
        }
        "harness_runtime_download" => "Codex 组件下载失败，请检查网络后重试。",
        "harness_runtime_proxy" => {
            "通过系统代理下载 Codex 组件失败，请确认代理正在运行并可访问 GitHub 后重试。"
        }
        "harness_runtime_proxy_config" => {
            "无法读取或解析系统代理设置。当前支持 Windows 手动 HTTP/HTTPS 代理，请检查配置后重试。"
        }
        "harness_runtime_integrity" => "Codex 组件完整性校验失败，文件未启用，请重新准备。",
        "harness_runtime_redirect" => "Codex 组件下载地址未通过校验，下载已停止。",
        "harness_runtime_busy" => "另一个进程正在准备 Codex 组件，请稍后重试。",
        "harness_runtime_storage" => "Codex 组件无法写入本地缓存，请检查权限和可用空间后重试。",
        "harness_not_ready" => "Codex 尚未就绪，请准备组件并完成订阅登录。",
        "harness_auth" => {
            "订阅登录未完成，请先退出订阅登录清理本次授权，再重试。不会切换到 API Key。"
        }
        "harness_auth_storage" => "网页授权后未能安全保存登录凭据，请检查 Windows 凭据服务与本地存储权限，退出订阅登录后重试。",
        "harness_auth_exchange" => "网页授权后未能换取登录凭据，请检查网络连接，退出订阅登录后重试。",
        "harness_auth_network" => "订阅登录请求未能连接到认证服务，请检查网络连接，退出订阅登录后重试。",
        "harness_auth_expired" => "设备码已过期，请先退出订阅登录，再获取新的设备码。",
        "harness_auth_verify" => "组件已结束授权，但应用尚未确认订阅登录，请先退出订阅登录后重试。",
        "harness_auth_cleanup" => "上次授权流程未完成，请先点击「退出订阅登录」清理，再重新登录。",
        "harness_already_authenticated" => "请先完成退出登录，再登录另一个订阅账户。",
        "harness_logout" => "退出登录尚未完成，当前授权已停用，请重试退出登录。",
        "invalid_input" => "Codex 配置或请求不正确，请核对模型、超时和设置。",
        "harness_protocol" | "harness_tool_denied" => {
            "Codex 返回内容不符合受控任务协议，结果未被采纳。"
        }
        "outcome_unknown" | "harness_failed" => {
            "Codex 未确认任务成功，请核对订阅、模型权限和连接；不会自动重新生成。"
        }
        "payload_too_large" | "response_too_large" => "Codex 输入或响应超过限制，请缩小处理范围。",
        _ => "Codex 执行环境暂不可用，请检查程序、系统凭据和本地存储。",
    };
    Error {
        code,
        message,
        retryable: false,
    }
}
#[tauri::command]
pub async fn harness_control(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<Harness>>,
    request: Control,
) -> Result<Status> {
    authorize(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.control(request))
        .await
        .map_err(|_| failure("harness_unavailable"))?
        .map_err(|error| failure(error.code))
}
#[tauri::command]
pub async fn harness_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<Harness>>,
    request: Request,
) -> Result<Value> {
    authorize(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.execute(request))
        .await
        .map_err(|_| failure("harness_unavailable"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        service: Arc<Harness>,
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("shiroha-native-harness-{}", uuid::Uuid::new_v4()));
            let service = Arc::new(Harness::open(&root));
            service.control(Control::ChooseRuntime).unwrap();
            service
                .control(Control::Save {
                    mode: "harness".into(),
                    adapter: "codex".into(),
                    model: "gpt-6.1-sol".into(),
                    timeout_seconds: 30,
                    revision: 0,
                })
                .unwrap();
            Self { service, root }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.service.cancel(None, false);
        }
    }
    fn request(service: &Harness) -> Request {
        Request {
            id: uuid::Uuid::new_v4().to_string(),
            revision: service.with(|state| Ok(state.config.revision)).unwrap(),
            task: Task::ConnectionTest,
            messages: vec![Message {
                role: "user".into(),
                content: "synthetic".into(),
            }],
        }
    }
    fn wait_login(service: &Harness) {
        let start = std::time::Instant::now();
        while service.with(|state| Ok(state.active.is_some())).unwrap() {
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    #[test]
    fn managed_preparation_needs_no_picker_and_keeps_api_mode_until_saved() {
        let root =
            std::env::temp_dir().join(format!("shiroha-native-harness-{}", uuid::Uuid::new_v4()));
        let service = Arc::new(Harness::open(&root));
        let request = serde_json::from_value::<Control>(json!({"kind":"prepare_runtime"}));
        assert!(request.is_ok(), "受管组件准备入口缺失");
        service.control(request.unwrap()).unwrap();
        wait_login(&service);
        let status = serde_json::to_value(service.refresh().unwrap()).unwrap();
        assert_eq!(status["runtimeSource"], "managed");
        assert_eq!(status["runtimeState"], "ready");
        assert_eq!(status["runtimePath"], "isolated-fake-codex.exe");
        assert_eq!(status["mode"], "api");
        assert_eq!(status["credentialStatus"], "missing");
        assert_eq!(status["ready"], false);
        assert!(!root.join("ai-execution/fake-subscription").exists());
    }

    #[test]
    fn legacy_runtime_paths_keep_custom_selection() {
        let f = Fixture::new();
        f.service
            .with(|state| {
                let mut old = serde_json::to_value(&state.config)?;
                old.as_object_mut().unwrap().remove("runtimeSource");
                state
                    .db
                    .execute("UPDATE config SET value=? WHERE id=1", [old.to_string()])?;
                Ok(())
            })
            .unwrap();
        let reopened = Harness::open(&f.root);
        let status = serde_json::to_value(reopened.refresh().unwrap()).unwrap();
        assert_eq!(status["runtimeSource"], "custom");
        assert_eq!(status["runtimePath"], "isolated-fake-codex.exe");
    }

    #[test]
    fn cancelled_preparation_preserves_custom_runtime_and_subscription() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        let queued = request(&f.service);
        std::fs::write(f.root.join("ai-execution/fake-prepare-wait"), b"fixture").unwrap();
        f.service.control(Control::UseManagedRuntime {}).unwrap();
        let status = f.service.control(Control::CancelAll).unwrap();
        assert_eq!(status.runtime_state, RuntimeState::Cancelled);
        assert_eq!(status.runtime_source, RuntimeSource::Custom);
        assert_eq!(status.runtime_path, "isolated-fake-codex.exe");
        assert!(!status.busy);
        assert!(f.root.join("ai-execution/fake-subscription").is_file());
        assert_eq!(f.service.execute(queued).unwrap_err().code, "harness_stale");
        std::fs::remove_file(f.root.join("ai-execution/fake-prepare-wait")).unwrap();
        f.service.control(Control::UseManagedRuntime {}).unwrap();
        wait_login(&f.service);
        let status = f.service.control(Control::Status).unwrap();
        assert_eq!(status.runtime_source, RuntimeSource::Managed);
        assert!(status.ready);
    }

    #[test]
    fn failed_preparation_does_not_retry_on_status_and_can_be_retried_explicitly() {
        let f = Fixture::new();
        std::fs::write(f.root.join("ai-execution/fake-prepare-failed"), b"fixture").unwrap();
        f.service.control(Control::UseManagedRuntime {}).unwrap();
        wait_login(&f.service);
        std::fs::remove_file(f.root.join("ai-execution/fake-prepare-failed")).unwrap();
        for _ in 0..3 {
            let status = f.service.control(Control::Status).unwrap();
            assert_eq!(status.runtime_state, RuntimeState::Failed);
            assert_eq!(status.runtime_source, RuntimeSource::Custom);
            assert!(!status.busy);
        }
        f.service.control(Control::UseManagedRuntime {}).unwrap();
        wait_login(&f.service);
        let status = f.service.control(Control::Status).unwrap();
        assert_eq!(status.runtime_state, RuntimeState::Ready);
        assert_eq!(status.runtime_source, RuntimeSource::Managed);
    }

    #[test]
    fn restore_cancels_preparation_and_discards_unsaved_candidate() {
        let f = Fixture::new();
        f.service.control(Control::ChooseRuntime).unwrap();
        std::fs::write(f.root.join("ai-execution/fake-prepare-wait"), b"fixture").unwrap();
        f.service.control(Control::UseManagedRuntime {}).unwrap();
        let guard = f.service.begin_restore().unwrap();
        assert!(f
            .service
            .with(|state| Ok(state.candidate.is_none()))
            .unwrap());
        let status = f.service.control(Control::Status).unwrap();
        assert_eq!(status.runtime_source, RuntimeSource::Custom);
        assert_eq!(status.runtime_state, RuntimeState::Cancelled);
        assert!(!status.ready);
        assert_eq!(
            f.service
                .control(Control::PrepareRuntime {})
                .err()
                .unwrap()
                .code,
            "harness_busy"
        );
        drop(guard);
        assert!(!f.service.control(Control::Status).unwrap().busy);
    }

    #[test]
    fn status_is_a_snapshot_and_does_not_start_authentication() {
        let f = Fixture::new();
        std::fs::write(
            f.root.join("ai-execution/fake-status-stop-failed"),
            b"fixture",
        )
        .unwrap();
        assert!(!f.service.control(Control::Status).unwrap().busy);
        assert!(!f.service.control(Control::Status).unwrap().ready);
        assert_eq!(
            f.service.control(Control::Inspect).err().unwrap().code,
            "harness_stopping"
        );
    }

    #[test]
    fn custom_preparation_never_downloads_and_client_cannot_supply_a_url() {
        let f = Fixture::new();
        std::fs::write(f.root.join("ai-execution/fake-prepare-failed"), b"fixture").unwrap();
        f.service.control(Control::PrepareRuntime {}).unwrap();
        wait_login(&f.service);
        assert_eq!(
            f.service.control(Control::Status).unwrap().runtime_state,
            RuntimeState::Ready
        );
        for field in ["url", "path", "sha256", "version"] {
            let mut value = json!({"kind":"prepare_runtime"});
            value[field] = "untrusted".into();
            assert!(serde_json::from_value::<Control>(value).is_err());
        }
    }

    #[test]
    fn subscription_only_and_no_automatic_api_fallback() {
        let f = Fixture::new();
        assert!(!f.service.refresh().unwrap().ready);
        assert_eq!(
            f.service.execute(request(&f.service)).unwrap_err().code,
            "harness_not_ready"
        );
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        assert!(f.service.refresh().unwrap().ready);
        let status = f.service.control(Control::Clear).unwrap();
        assert_eq!(status.mode, "harness");
        assert!(!status.ready);
        assert!(f.root.join("ai-execution/execution.sqlite3").is_file());
    }
    #[test]
    fn early_cancel_prevents_late_start() {
        let f = Fixture::new();
        let request = request(&f.service);
        f.service.cancel(Some(&request.id), false).unwrap();
        assert_eq!(f.service.execute(request).unwrap_err().code, "cancelled");
    }
    #[test]
    fn reset_invalidates_queued_revision_and_requires_inspect() {
        let f = Fixture::new();
        let request = request(&f.service);
        f.service.invalidate().unwrap();
        assert_eq!(
            f.service.execute(request).unwrap_err().code,
            "harness_stale"
        );
        assert!(!f.service.refresh().unwrap().ready);
    }
    #[test]
    fn failed_save_retains_previous_mode_and_revision() {
        let f = Fixture::new();
        let before = f.service.refresh().unwrap();
        f.service
            .with(|state| {
                state.db.execute_batch("PRAGMA query_only=ON;")?;
                Ok(())
            })
            .unwrap();
        assert!(f
            .service
            .control(Control::Save {
                mode: "api".into(),
                adapter: "codex".into(),
                model: String::new(),
                timeout_seconds: 30,
                revision: before.revision
            })
            .is_err());
        let after = f.service.refresh().unwrap();
        assert_eq!(after.mode, before.mode);
        assert_eq!(after.revision, before.revision);
        f.service
            .with(|state| {
                state.db.execute_batch("PRAGMA query_only=OFF;")?;
                Ok(())
            })
            .unwrap();
    }
    #[test]
    fn active_task_blocks_settings_and_invalidate_waits_for_stop() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        f.service.refresh().unwrap();
        let request = request(&f.service);
        let revision = request.revision;
        let service = f.service.clone();
        let worker = std::thread::spawn(move || service.execute(request));
        let start = std::time::Instant::now();
        while !f.service.with(|state| Ok(state.active.is_some())).unwrap() {
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(
            f.service
                .control(Control::Save {
                    mode: "api".into(),
                    adapter: "codex".into(),
                    model: String::new(),
                    timeout_seconds: 30,
                    revision
                })
                .err()
                .unwrap()
                .code,
            "harness_busy"
        );
        f.service.invalidate().unwrap();
        assert_eq!(worker.join().unwrap().unwrap_err().code, "cancelled");
        assert!(!f.service.refresh().unwrap().ready);
        assert!(!f.service.refresh().unwrap().busy);
    }
    #[test]
    fn rejects_api_credentials_and_arbitrary_tasks() {
        assert!(serde_json::from_value::<Control>(json!({"kind":"save","mode":"harness","adapter":"codex","model":"gpt-5.1-codex","timeoutSeconds":30,"revision":0,"secret":{"kind":"replace","value":"forbidden"}})).is_err());
        assert!(serde_json::from_value::<Request>(
            json!({"id":"fake","revision":0,"task":"shell","messages":[]})
        )
        .is_err());
    }
    #[test]
    fn duplicate_cancel_remains_idempotent_when_tombstones_are_full() {
        let f = Fixture::new();
        let first = uuid::Uuid::new_v4().to_string();
        f.service.cancel(Some(&first), false).unwrap();
        for _ in 1..1024 {
            f.service
                .cancel(Some(&uuid::Uuid::new_v4().to_string()), false)
                .unwrap();
        }
        assert!(f.service.cancel(Some(&first), false).is_ok());
        assert!(f
            .service
            .cancel(Some(&uuid::Uuid::new_v4().to_string()), false)
            .is_ok());
    }
    #[test]
    fn cancelled_login_does_not_adopt_credentials_written_before_exit() {
        let f = Fixture::new();
        std::fs::write(
            f.root.join("ai-execution/fake-login-cancel-after-store"),
            b"fixture",
        )
        .unwrap();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        assert!(f.root.join("ai-execution/fake-subscription").is_file());
        assert!(!f.service.refresh().unwrap().ready);
        assert!(f
            .service
            .with(|state| Ok(state.config.logout_pending))
            .unwrap());
        let restarted = Harness::open(&f.root);
        assert!(!restarted.refresh().unwrap().ready);
        f.service.control(Control::Logout).unwrap();
        assert!(!f
            .service
            .with(|state| Ok(state.config.logout_pending))
            .unwrap());
    }
    #[test]
    fn status_process_is_cancellable_without_holding_state_lock() {
        let f = Fixture::new();
        std::fs::write(f.root.join("ai-execution/fake-status-delay"), b"fixture").unwrap();
        let service = f.service.clone();
        let worker = std::thread::spawn(move || service.refresh());
        std::thread::sleep(Duration::from_millis(50));
        f.service.cancel(None, false).unwrap();
        assert_eq!(worker.join().unwrap().err().unwrap().code, "cancelled");
    }
    #[test]
    fn logout_process_is_cancellable_and_keeps_pending_until_cleanup() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        std::fs::write(f.root.join("ai-execution/fake-logout-delay"), b"fixture").unwrap();
        let service = f.service.clone();
        let worker = std::thread::spawn(move || service.control(Control::Logout));
        std::thread::sleep(Duration::from_millis(50));
        f.service.cancel(None, false).unwrap();
        assert_eq!(worker.join().unwrap().err().unwrap().code, "cancelled");
        assert!(f
            .service
            .with(|state| Ok(state.config.logout_pending))
            .unwrap());
        assert!(!f.service.refresh().unwrap().ready);
    }
    #[test]
    fn completed_active_cancellation_does_not_consume_tombstone_capacity() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        let request = request(&f.service);
        let id = request.id.clone();
        let service = f.service.clone();
        let worker = std::thread::spawn(move || service.execute(request));
        let start = std::time::Instant::now();
        while !f.service.with(|state| Ok(state.active.is_some())).unwrap() {
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(1));
        }
        f.service.cancel(Some(&id), false).unwrap();
        assert_eq!(worker.join().unwrap().unwrap_err().code, "cancelled");
        assert!(f
            .service
            .with(|state| Ok(state.cancelled.is_empty()))
            .unwrap());
    }
    #[test]
    fn restore_guard_spans_store_work_and_cancel_all_cannot_release_it() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        let queued = request(&f.service);
        let guard = f.service.begin_restore().unwrap();
        assert_eq!(
            f.service.control(Control::Inspect).err().unwrap().code,
            "harness_busy"
        );
        assert!(f.service.refresh().unwrap().busy);
        assert!(!f.service.refresh().unwrap().ready);
        let other = f.service.begin_restore().unwrap();
        f.service.cancel(None, false).unwrap();
        drop(guard);
        assert_eq!(
            f.service.control(Control::Inspect).err().unwrap().code,
            "harness_busy"
        );
        drop(other);
        assert_eq!(f.service.execute(queued).unwrap_err().code, "harness_stale");
        assert!(!f.service.refresh().unwrap().busy);
        assert!(!f.service.refresh().unwrap().ready);
        assert!(f.service.control(Control::Inspect).unwrap().ready);
    }
    #[test]
    fn restore_guard_survives_failed_storage_operation_and_corrupt_harness() {
        let f = Fixture::new();
        let failed = (|| -> Result<()> {
            let _guard = f.service.begin_restore()?;
            Err(failure("storage_unavailable"))
        })();
        assert!(failed.is_err());
        assert!(!f.service.refresh().unwrap().busy);
        *f.service.inner.lock().unwrap() = Err(failure("storage_unavailable"));
        assert!(f.service.begin_restore().is_ok());
    }
    #[test]
    fn status_queries_do_not_invalidate_frozen_configuration_when_auth_is_unchanged() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        let queued = request(&f.service);
        let revision = queued.revision;
        assert_eq!(f.service.refresh().unwrap().revision, revision);
        assert_eq!(f.service.refresh().unwrap().revision, revision);
        assert!(f.service.execute(queued).is_ok());
    }
    #[test]
    fn tombstone_rotation_invalidates_forgotten_requests_without_unbounded_growth() {
        let f = Fixture::new();
        let queued = request(&f.service);
        f.service.cancel(Some(&queued.id), false).unwrap();
        for _ in 0..MAX_CANCELLED_REQUESTS {
            f.service
                .cancel(Some(&uuid::Uuid::new_v4().to_string()), false)
                .unwrap();
        }
        assert!(f
            .service
            .with(|state| Ok(state.cancelled.len() <= MAX_CANCELLED_REQUESTS))
            .unwrap());
        assert_eq!(f.service.execute(queued).unwrap_err().code, "harness_stale");
    }
    #[test]
    fn status_stop_failure_permanently_blocks_all_start_paths() {
        let f = Fixture::new();
        std::fs::write(
            f.root.join("ai-execution/fake-status-stop-failed"),
            b"fixture",
        )
        .unwrap();
        assert_eq!(f.service.refresh().err().unwrap().code, "harness_stopping");
        for operation in [
            Control::CancelAll,
            Control::Inspect,
            Control::Login,
            Control::Logout,
            Control::ChooseRuntime,
            Control::PrepareRuntime {},
            Control::UseManagedRuntime {},
        ] {
            assert_eq!(
                f.service.control(operation).err().unwrap().code,
                "harness_stopping"
            );
        }
        assert_eq!(
            f.service.execute(request(&f.service)).unwrap_err().code,
            "harness_stopping"
        );
        assert!(f.service.begin_restore().is_err());
        assert!(!f.service.refresh().unwrap().ready);
        assert!(f.service.refresh().unwrap().busy);
    }
    #[test]
    fn logout_stop_failure_retains_persistent_pending_auth_and_poison() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        std::fs::write(
            f.root.join("ai-execution/fake-logout-stop-failed"),
            b"fixture",
        )
        .unwrap();
        assert_eq!(
            f.service.control(Control::Logout).err().unwrap().code,
            "harness_stopping"
        );
        assert!(f
            .service
            .with(|state| Ok(state.config.logout_pending))
            .unwrap());
        assert_eq!(
            f.service.cancel(None, false).err().unwrap().code,
            "harness_stopping"
        );
        let reopened = Harness::open(&f.root);
        assert!(!reopened.refresh().unwrap().ready);
    }
    #[test]
    fn login_pending_is_persistent_before_authorization_completes() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        assert!(f
            .service
            .with(|state| Ok(state.config.logout_pending))
            .unwrap());
        let reopened = Harness::open(&f.root);
        assert!(!reopened.refresh().unwrap().ready);
        f.service.cancel(None, false).unwrap();
        assert!(f
            .service
            .with(|state| Ok(state.config.logout_pending))
            .unwrap());
        assert_eq!(
            f.service.control(Control::Login).err().unwrap().code,
            "harness_auth_cleanup"
        );
        f.service.control(Control::Logout).unwrap();
        assert!(!f
            .service
            .with(|state| Ok(state.config.logout_pending))
            .unwrap());
    }

    #[test]
    fn inspecting_failed_login_preserves_the_failure_stage_and_pending_barrier() {
        let f = Fixture::new();
        f.service
            .with(|state| {
                let mut config = state.config.clone();
                config.logout_pending = true;
                state.persist(config)?;
                state.notice = failure("harness_auth_storage").message.into();
                Ok(())
            })
            .unwrap();
        let status = f.service.control(Control::Inspect).unwrap();
        assert!(!status.ready);
        assert_eq!(status.reason, failure("harness_auth_storage").message);
        assert_eq!(
            f.service.control(Control::Login).err().unwrap().code,
            "harness_auth_cleanup"
        );
        let reopened = Harness::open(&f.root);
        assert_eq!(
            reopened.refresh().unwrap().reason,
            failure("harness_auth_cleanup").message
        );
    }
}
