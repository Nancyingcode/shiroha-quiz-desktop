use crate::{
    commands::authorize,
    error::{Error, Result},
    harness_codebuddy_execute as codebuddy,
    harness_codebuddy_login::Login,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PreparationPhase {
    Checking,
    Queued,
    Downloading,
    Verifying,
    Extracting,
}

pub(crate) struct PreparationContext<'a> {
    pub phase: &'a (dyn Fn(PreparationPhase) + Send + Sync),
    pub downloads: &'a tokio::sync::Mutex<()>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeSource {
    Managed,
    Custom,
}
fn legacy_runtime_source() -> RuntimeSource {
    RuntimeSource::Custom
}
fn default_codebuddy_model() -> String {
    codebuddy::DEFAULT_MODEL.into()
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
    #[serde(default = "default_codebuddy_model")]
    codebuddy_model: String,
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
            codebuddy_model: default_codebuddy_model(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    account_revision: Option<u64>,
    operation_busy: bool,
    component_tasks: Vec<ComponentTaskStatus>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentTaskStatus {
    adapter: String,
    id: String,
    phase: PreparationPhase,
    received: u64,
    total: u64,
}
// 组件任务归所属提供方，不随选择修订变化；恢复和取消通过独立令牌失效。
struct ComponentTask {
    operation: Operation,
    phase: PreparationPhase,
    received: u64,
    total: u64,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Control {
    Status,
    SelectAdapter {
        adapter: String,
        revision: u64,
    },
    SelectModel {
        model: String,
        revision: u64,
    },
    ChooseRuntime,
    PrepareRuntime {},
    CancelPreparation {
        adapter: String,
        id: String,
    },
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
    #[serde(rename = "accountRevision")]
    account_revision: Option<u64>,
}
struct Active {
    id: String,
    cancel: Arc<AtomicBool>,
    login: bool,
    readonly: bool,
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
    preparations: Vec<ComponentTask>,
    barrier: bool,
    restores: usize,
    cancel_waiters: usize,
    cancelled: HashSet<String>,
    subscription: bool,
    login_url: String,
    user_code: String,
    notice: String,
    codebuddy_login: Arc<Login>,
    codebuddy_runtime: CodeBuddyRuntime,
}
// 组件状态只归当前进程；重新准备会验证独立缓存，不改写 Codex 的持久设置。
struct CodeBuddyRuntime {
    path: PathBuf,
    state: RuntimeState,
    verified: bool,
    received: u64,
    total: u64,
    notice: String,
}
impl Default for CodeBuddyRuntime {
    fn default() -> Self {
        Self {
            path: PathBuf::new(),
            state: RuntimeState::Unprepared,
            verified: false,
            received: 0,
            total: 0,
            notice: String::new(),
        }
    }
}
#[derive(Clone)]
struct Operation {
    id: String,
    config: Config,
    root: PathBuf,
    cancel: Arc<AtomicBool>,
    codebuddy_login: Arc<Login>,
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

// 本进程拥有配置与唯一模型/授权任务；组件任务按提供方独立，取消等待所有目标任务退出。
pub struct Harness {
    inner: Mutex<Result<Inner>>,
    // 账户服务与执行配置独立，配置损坏时仍须完成题库恢复的账户屏障。
    codebuddy_login: Arc<Login>,
    idle: Condvar,
    downloads: tokio::sync::Mutex<()>,
}
impl Harness {
    pub fn open(root: &Path) -> Self {
        Self::open_with_codebuddy(root, Arc::new(Login::new()))
    }
    pub fn open_with_codebuddy(root: &Path, login: Arc<Login>) -> Self {
        Self {
            inner: Mutex::new(Inner::open(&root.join("ai-execution"), login.clone())),
            codebuddy_login: login,
            idle: Condvar::new(),
            downloads: tokio::sync::Mutex::new(()),
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
                state.codebuddy_runtime.verified = false;
                if state.codebuddy_runtime.state != RuntimeState::Preparing {
                    state.codebuddy_runtime.state = RuntimeState::Unprepared;
                }
                if state.runtime_state != RuntimeState::Preparing {
                    state.runtime_state = RuntimeState::Unprepared;
                }
            }
        }
        if id.is_none() {
            for task in &state.preparations {
                task.operation.cancel.store(true, Ordering::Release);
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
        loop {
            let state = lock.as_ref().map_err(|_| failure("harness_unavailable"))?;
            let active_pending = target.as_ref().is_some_and(|target| {
                state
                    .active
                    .as_ref()
                    .is_some_and(|active| &active.id == target)
            });
            let components_pending = id.is_none() && !state.preparations.is_empty();
            if state.barrier || (!active_pending && !components_pending) {
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
    pub(crate) async fn invalidate_codebuddy_for_restore(&self) -> Result<()> {
        self.codebuddy_login.invalidate_for_restore().await
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
            if result.as_ref().is_err_and(|error| {
                matches!(
                    error.code,
                    "harness_stop_failed"
                        | "codebuddy_cleanup_failed"
                        | "codebuddy_profile_cleanup_failed"
                )
            }) {
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
            if state.config.adapter != "codex"
                || state.busy()
                || !state.config.verified
                || state.config.logout_pending
            {
                return Ok(None);
            }
            let operation = state.start(uuid::Uuid::new_v4().to_string(), false)?;
            if let Some(active) = &mut state.active {
                active.readonly = true;
            }
            Ok(Some(operation))
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
    fn inspect_runtime(&self) -> Result<Status> {
        let (mut operation, candidate) = self.with(|state| {
            state.require_codex()?;
            let candidate = state.candidate.clone();
            let operation = state.start(uuid::Uuid::new_v4().to_string(), false)?;
            if let Some(active) = &mut state.active {
                active.readonly = true;
            }
            Ok((operation, candidate))
        })?;
        if let Some(path) = &candidate {
            operation.config.runtime_path = path.clone();
        }
        let checked = codex::inspect_cancellable(&operation.config.runtime_path, &operation.cancel);
        let result = checked.and_then(|()| {
            if candidate.is_some() || operation.config.logout_pending {
                return Ok(None);
            }
            codex::subscription(
                &operation.root,
                &operation.config.runtime_path,
                &operation.cancel,
            )
            .map(Some)
        });
        self.finish(&operation, result, |state, result| {
            let subscribed = result?;
            if candidate.is_none() {
                let mut config = state.config.clone();
                config.verified = true;
                config.revision += 1;
                state.persist(config)?;
            }
            state.runtime_state = RuntimeState::Ready;
            if !state.config.logout_pending {
                state.notice.clear();
            }
            if let Some(subscribed) = subscribed {
                state.update_subscription(subscribed)?;
            }
            Ok(state.status())
        })
    }
    fn control(self: &Arc<Self>, request: Control) -> Result<Status> {
        match request {
            Control::Status => self.with(|state| Ok(state.status())),
            Control::SelectAdapter { adapter, revision } => self.with(|state| {
                if state.barrier {
                    return Err(failure("harness_stopping"));
                }
                if state.operation_busy() || state.codebuddy_login.execution_status()?.busy {
                    return Err(failure("harness_busy"));
                }
                if revision != state.config.revision {
                    return Err(failure("harness_stale"));
                }
                if !is_supported_adapter(&adapter) {
                    return Err(failure("invalid_input"));
                }
                let mut config = state.config.clone();
                config.adapter = adapter;
                config.mode = "harness".into();
                config.revision = config
                    .revision
                    .checked_add(1)
                    .ok_or_else(|| failure("harness_unavailable"))?;
                // 选择执行方不检测或修改其他账户；Codex 组件和订阅状态仍归原账户所有。
                state.persist(config)?;
                Ok(state.status())
            }),
            Control::SelectModel { model, revision } => self.with(|state| {
                state.ensure_idle()?;
                if state.config.mode != "harness" || state.config.adapter != "codebuddy" {
                    return Err(failure("harness_provider_unavailable"));
                }
                if state.codebuddy_login.execution_status()?.busy {
                    return Err(failure("harness_busy"));
                }
                if revision != state.config.revision {
                    return Err(failure("harness_stale"));
                }
                if !codebuddy::supports_model(&model) {
                    return Err(failure("codebuddy_config_invalid"));
                }
                let mut config = state.config.clone();
                config.codebuddy_model = model;
                config.revision = config
                    .revision
                    .checked_add(1)
                    .ok_or_else(|| failure("harness_unavailable"))?;
                state.persist(config)?;
                Ok(state.status())
            }),
            Control::PrepareRuntime {} => self.start_preparation(false),
            Control::CancelPreparation { adapter, id } => self.cancel_preparation(&adapter, &id),
            Control::UseManagedRuntime {} => self.start_preparation(true),
            Control::CancelAll => self.cancel(None, false),
            Control::Cancel { id } => self.cancel(Some(&id), false),
            Control::ChooseRuntime => {
                self.with(|state| {
                    state.require_codex()?;
                    state.ensure_idle()
                })?;
                #[cfg(any(test, feature = "native-test"))]
                let selected = Some(PathBuf::from("isolated-fake-codex.exe"));
                #[cfg(not(any(test, feature = "native-test")))]
                let selected = rfd::FileDialog::new()
                    .set_title("选择 Codex 0.163.0 Windows x64 程序")
                    .add_filter("Codex 程序", &["exe"])
                    .pick_file();
                if let Some(path) = selected {
                    self.with(|state| {
                        state.require_codex()?;
                        state.ensure_idle()?;
                        codex::inspect(&path)?;
                        state.candidate = Some(path);
                        state.runtime_state = RuntimeState::Ready;
                        state.notice.clear();
                        Ok(state.status())
                    })
                } else {
                    self.refresh()
                }
            }
            Control::Inspect => self.inspect_runtime(),
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
                        || !is_supported_adapter(&adapter)
                        || !(MIN_TIMEOUT_SECONDS..=MAX_TIMEOUT_SECONDS).contains(&timeout_seconds)
                    {
                        return Err(failure("invalid_input"));
                    }
                    let mut config = state.config.clone();
                    config.mode = mode;
                    config.adapter = adapter;
                    config.revision += 1;
                    let saves_codex_settings =
                        config.mode == "harness" && config.adapter == "codex";
                    if saves_codex_settings {
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
                    if saves_codex_settings {
                        state.candidate = None;
                        state.notice.clear();
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
            if !matches!(state.config.adapter.as_str(), "codex" | "codebuddy") {
                return Err(failure("harness_provider_unavailable"));
            }
            if state.barrier {
                return Err(failure("harness_stopping"));
            }
            if state.operation_busy() {
                return Err(failure("harness_busy"));
            }
            let adapter = &state.config.adapter;
            if state
                .preparations
                .iter()
                .any(|task| &task.operation.config.adapter == adapter)
            {
                return Ok(None);
            }
            let already_ready = if adapter == "codebuddy" {
                state.codebuddy_runtime.verified
                    && state.codebuddy_runtime.state == RuntimeState::Ready
            } else {
                state.config.verified
                    && state.runtime_state == RuntimeState::Ready
                    && state.candidate.is_none()
            };
            if already_ready && !use_managed {
                return Ok(None);
            }
            let mut config = state.config.clone();
            if adapter == "codebuddy" || use_managed {
                config.runtime_source = RuntimeSource::Managed;
            } else if let Some(path) = &state.candidate {
                config.runtime_source = RuntimeSource::Custom;
                config.runtime_path = path.clone();
            }
            let operation = Operation {
                id: uuid::Uuid::new_v4().to_string(),
                config,
                root: state.root.clone(),
                cancel: Arc::new(AtomicBool::new(false)),
                codebuddy_login: state.codebuddy_login.clone(),
            };
            if adapter == "codebuddy" {
                state.codebuddy_runtime.state = RuntimeState::Preparing;
                state.codebuddy_runtime.notice.clear();
                state.codebuddy_runtime.received = 0;
                state.codebuddy_runtime.total = 0;
            } else {
                state.runtime_state = RuntimeState::Preparing;
                state.runtime_received_bytes = 0;
                state.runtime_total_bytes = 0;
                state.notice.clear();
            }
            state.preparations.push(ComponentTask {
                operation: operation.clone(),
                phase: PreparationPhase::Checking,
                received: 0,
                total: 0,
            });
            Ok(Some(operation))
        })?;
        let Some(operation) = operation else {
            return self.with(|state| Ok(state.status()));
        };
        let worker = self.clone();
        let worker_operation = operation.clone();
        let spawned = std::thread::Builder::new()
            .name("harness-runtime-preparation".into())
            .spawn(move || {
                let progress = |received, total| {
                    let _ = worker.with(|state| {
                        if let Some(task) = state
                            .preparations
                            .iter_mut()
                            .find(|task| task.operation.id == worker_operation.id)
                        {
                            if !task.operation.cancel.load(Ordering::Acquire) {
                                task.received = received;
                                task.total = total;
                                if task.operation.config.adapter == "codebuddy" {
                                    state.codebuddy_runtime.received = received;
                                    state.codebuddy_runtime.total = total;
                                } else {
                                    state.runtime_received_bytes = received;
                                    state.runtime_total_bytes = total;
                                }
                            }
                        }
                        Ok(())
                    });
                };
                let phase = |phase| {
                    let _ = worker.with(|state| {
                        if let Some(task) = state
                            .preparations
                            .iter_mut()
                            .find(|task| task.operation.id == worker_operation.id)
                        {
                            if !task.operation.cancel.load(Ordering::Acquire) {
                                task.phase = phase;
                            }
                        }
                        Ok(())
                    });
                };
                let context = PreparationContext {
                    phase: &phase,
                    downloads: &worker.downloads,
                };
                let result = prepare_component(&worker_operation, &progress, &context);
                let _ = worker.finish_preparation(&worker_operation, result);
            });
        if spawned.is_err() {
            self.finish_preparation(&operation, Err(failure("harness_unavailable")))?;
        }
        self.with(|state| Ok(state.status()))
    }
    fn finish_preparation(&self, operation: &Operation, result: Result<PathBuf>) -> Result<()> {
        let applied = self.with(|state| {
            let Some(index) = state
                .preparations
                .iter()
                .position(|task| task.operation.id == operation.id)
            else {
                return Ok(());
            };
            state.preparations.remove(index);
            let result = if operation.cancel.load(Ordering::Acquire)
                || state.restores > 0
                || state.barrier
            {
                Err(failure("cancelled"))
            } else {
                result
            };
            if operation.config.adapter == "codebuddy" {
                return state.finish_codebuddy_preparation(result);
            }
            let applied = result.and_then(|path| {
                // 只合并本提供方的组件字段，不能用下载开始时的快照覆盖当前选择和模型。
                let mut config = state.config.clone();
                config.runtime_path = path;
                config.runtime_source = operation.config.runtime_source;
                config.verified = true;
                if config.adapter == "codex" {
                    config.revision += 1;
                }
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
        self.idle.notify_all();
        applied
    }
    fn cancel_preparation(&self, adapter: &str, id: &str) -> Result<Status> {
        if !matches!(adapter, "codex" | "codebuddy") || uuid::Uuid::parse_str(id).is_err() {
            return Err(failure("invalid_input"));
        }
        let mut lock = self
            .inner
            .lock()
            .map_err(|_| failure("harness_unavailable"))?;
        let state = lock.as_mut().map_err(|_| failure("harness_unavailable"))?;
        if let Some(task) = state
            .preparations
            .iter()
            .find(|task| task.operation.id == id && task.operation.config.adapter == adapter)
        {
            task.operation.cancel.store(true, Ordering::Release);
        } else {
            return Ok(state.status());
        }
        let deadline = std::time::Instant::now() + STOP_WAIT_TIMEOUT;
        loop {
            let state = lock.as_mut().map_err(|_| failure("harness_unavailable"))?;
            if !state
                .preparations
                .iter()
                .any(|task| task.operation.id == id)
            {
                return Ok(state.status());
            }
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                state.poison();
                return Err(failure("harness_stopping"));
            }
            lock = self
                .idle
                .wait_timeout(lock, remaining)
                .map_err(|_| failure("harness_unavailable"))?
                .0;
        }
    }

    fn logout(&self, clear: bool) -> Result<Status> {
        self.with(|state| state.require_codex())?;
        self.cancel(None, false)?;
        let operation = self.with(|state| {
            state.require_codex()?;
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
                    codebuddy_model: state.config.codebuddy_model.clone(),
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
            state.require_codex()?;
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
            if state.config.adapter == "codebuddy" {
                if !codebuddy::supports(request.task) {
                    return Err(failure("harness_task_unavailable"));
                }
                let revision = request
                    .account_revision
                    .ok_or_else(|| failure("codebuddy_account_stale"))?;
                state.codebuddy_login.ensure_execution_current(revision)?;
            } else {
                state.require_codex()?;
            }
            if state.config.mode != "harness" || !state.status().ready {
                return Err(failure("harness_not_ready"));
            }
            state.start(request.id, false)
        })?;
        if operation.config.adapter == "codebuddy" {
            // 租约跨越协议校验与最终提交，退出登录直到 finish 结束仍能取消同一任务。
            let lease = request
                .account_revision
                .ok_or_else(|| failure("codebuddy_account_stale"))
                .and_then(|revision| {
                    operation
                        .codebuddy_login
                        .lease(revision, operation.cancel.clone())
                })
                .map(|lease| Arc::new(Mutex::new(lease)));
            let result = match &lease {
                Ok(lease) => codebuddy::execute(
                    &operation.root,
                    &operation.config.runtime_path,
                    &operation.config.codebuddy_model,
                    request.task,
                    &request.messages,
                    lease.clone(),
                    operation.cancel.clone(),
                ),
                Err(error) => Err(failure(error.code)),
            };
            let finished = self.finish(&operation, result, |_, result| {
                let content = result?;
                let revision = request
                    .account_revision
                    .ok_or_else(|| failure("codebuddy_account_stale"))?;
                operation
                    .codebuddy_login
                    .ensure_execution_current(revision)?;
                Ok(json!({"content":content}))
            });
            drop(lease);
            return finished.map_err(|error| failure(error.code));
        }
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
    context: &PreparationContext<'_>,
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
        let component = if operation.config.adapter == "codebuddy" {
            crate::harness_runtime::Component::CodeBuddy
        } else {
            crate::harness_runtime::Component::Codex
        };
        tauri::async_runtime::block_on(crate::harness_runtime::prepare_observed(
            &operation.root,
            &operation.cancel,
            progress,
            component,
            Some(context),
        ))
        .map_err(|error| {
            if operation.config.adapter == "codebuddy" {
                crate::harness_codebuddy_runtime::preparation_error(error)
            } else {
                error
            }
        })
    }
    #[cfg(any(test, feature = "native-test"))]
    {
        (context.phase)(PreparationPhase::Queued);
        let _download_slot = loop {
            if operation.cancel.load(Ordering::Acquire) {
                return Err(failure("cancelled"));
            }
            if let Ok(slot) = context.downloads.try_lock() {
                break slot;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        progress(0, 1);
        let wait_marker = operation.root.join("fake-prepare-wait");
        (context.phase)(PreparationPhase::Downloading);
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
        (context.phase)(PreparationPhase::Verifying);
        if operation.config.adapter == "codebuddy" {
            (context.phase)(PreparationPhase::Extracting);
        }
        Ok(PathBuf::from(if operation.config.adapter == "codebuddy" {
            "isolated-fake-codebuddy.exe"
        } else {
            "isolated-fake-codex.exe"
        }))
    }
}

impl Inner {
    fn open(root: &Path, codebuddy_login: Arc<Login>) -> Result<Self> {
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
            || !is_supported_adapter(&config.adapter)
            || !codebuddy::supports_model(&config.codebuddy_model)
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
            preparations: Vec::new(),
            barrier: false,
            restores: 0,
            cancel_waiters: 0,
            cancelled: HashSet::new(),
            subscription: false,
            login_url: String::new(),
            user_code: String::new(),
            notice: String::new(),
            codebuddy_login,
            codebuddy_runtime: CodeBuddyRuntime::default(),
        })
    }
    fn operation_busy(&self) -> bool {
        self.active.as_ref().is_some_and(|active| !active.readonly)
            || self.barrier
            || self.restores > 0
            || self.cancel_waiters > 0
    }
    fn busy(&self) -> bool {
        self.active.is_some()
            || self.operation_busy()
            || self
                .preparations
                .iter()
                .any(|task| task.operation.config.adapter == self.config.adapter)
    }
    fn component_tasks(&self) -> Vec<ComponentTaskStatus> {
        self.preparations
            .iter()
            .map(|task| ComponentTaskStatus {
                adapter: task.operation.config.adapter.clone(),
                id: task.operation.id.clone(),
                phase: task.phase,
                received: task.received,
                total: task.total,
            })
            .collect()
    }
    fn require_codex(&self) -> Result<()> {
        if self.config.adapter == "codex" {
            Ok(())
        } else {
            Err(failure("harness_provider_unavailable"))
        }
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
        self.codebuddy_runtime.verified = false;
        self.codebuddy_runtime.state = RuntimeState::Failed;
        self.login_url.clear();
        self.user_code.clear();
        self.notice = failure("harness_stopping").message.to_owned();
        if let Some(active) = &self.active {
            active.cancel.store(true, Ordering::Release);
        }
        for task in &self.preparations {
            task.operation.cancel.store(true, Ordering::Release);
        }
    }
    fn start(&mut self, id: String, login: bool) -> Result<Operation> {
        self.ensure_idle()?;
        let cancel = Arc::new(AtomicBool::new(false));
        self.active = Some(Active {
            id: id.clone(),
            cancel: cancel.clone(),
            login,
            readonly: false,
        });
        let mut config = self.config.clone();
        if config.adapter == "codebuddy" {
            config.runtime_path = self.codebuddy_runtime.path.clone();
            config.runtime_source = RuntimeSource::Managed;
        }
        Ok(Operation {
            id,
            config,
            root: self.root.clone(),
            cancel,
            codebuddy_login: self.codebuddy_login.clone(),
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
    fn finish_codebuddy_preparation(&mut self, result: Result<PathBuf>) -> Result<()> {
        let applied = result.and_then(|path| {
            let mut config = self.config.clone();
            if config.adapter == "codebuddy" {
                config.revision += 1;
            }
            self.persist(config)?;
            self.codebuddy_runtime.path = path;
            self.codebuddy_runtime.verified = true;
            Ok(())
        });
        match applied {
            Ok(()) => {
                self.codebuddy_runtime.state = RuntimeState::Ready;
                self.codebuddy_runtime.notice.clear();
            }
            Err(error) => {
                self.codebuddy_runtime.verified = false;
                self.codebuddy_runtime.state = if error.code == "cancelled" {
                    RuntimeState::Cancelled
                } else {
                    RuntimeState::Failed
                };
                self.codebuddy_runtime.notice = if error.code == "cancelled" {
                    "CodeBuddy 组件准备已取消，请主动重试。".into()
                } else {
                    failure(error.code).message.into()
                };
            }
        }
        Ok(())
    }
    fn codebuddy_status(&self) -> Status {
        let account = self.codebuddy_login.execution_status();
        let signed_in = account.as_ref().is_ok_and(|account| account.signed_in);
        let account_busy = account.as_ref().is_ok_and(|account| account.busy);
        let runtime = &self.codebuddy_runtime;
        let busy = self.busy() || account_busy;
        let ready = runtime.verified && runtime.state == RuntimeState::Ready && signed_in && !busy;
        let reason = if self.barrier {
            "CodeBuddy 停止状态尚未确认，请重新启动应用。"
        } else if self.restores > 0 {
            "数据恢复期间不能启动 CodeBuddy，请等待恢复完成后重新准备组件。"
        } else if runtime.state == RuntimeState::Preparing {
            "正在准备 CodeBuddy 组件，可取消；不会发起模型请求。"
        } else if !runtime.notice.is_empty() {
            &runtime.notice
        } else if !runtime.verified {
            "请准备 CodeBuddy 组件并完成账户登录。"
        } else if busy && signed_in {
            "CodeBuddy 任务正在执行，可停止任务。"
        } else if !signed_in {
            account
                .as_ref()
                .map(|account| account.message)
                .unwrap_or("CodeBuddy 账户状态不可用，请重新启动应用。")
        } else {
            "CodeBuddy 已就绪，可测试连接、生成单题解析和追问；执行会消耗账户用量。"
        };
        Status {
            mode: self.config.mode.clone(),
            adapter: self.config.adapter.clone(),
            model: self.config.codebuddy_model.clone(),
            timeout_seconds: codebuddy::TIMEOUT_SECONDS,
            credential_status: if signed_in {
                "subscription"
            } else if account_busy {
                "authenticating"
            } else {
                "missing"
            }
            .into(),
            runtime_path: runtime.path.display().to_string(),
            runtime_version: if runtime.verified {
                "2.175.0".into()
            } else {
                String::new()
            },
            runtime_source: RuntimeSource::Managed,
            runtime_state: runtime.state,
            runtime_received_bytes: runtime.received,
            runtime_total_bytes: runtime.total,
            ready,
            reason: reason.into(),
            revision: self.config.revision,
            busy,
            login_url: String::new(),
            user_code: String::new(),
            account_revision: account.as_ref().ok().map(|account| account.revision),
            operation_busy: self.operation_busy() || account_busy,
            component_tasks: self.component_tasks(),
        }
    }
    fn status(&self) -> Status {
        if self.config.adapter == "codebuddy" {
            return self.codebuddy_status();
        }
        let codex_selected = self.config.adapter == "codex";
        let authenticating = self.active.as_ref().is_some_and(|active| active.login);
        let ready = codex_selected
            && self.config.verified
            && self.runtime_state == RuntimeState::Ready
            && !self.config.logout_pending
            && self.subscription
            && !self.config.model.is_empty()
            && !self.busy();
        let reason = if self.config.adapter == "deepseek" {
            "DeepSeek 的 Harness 订阅执行尚未接入。"
        } else if self.barrier {
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
            adapter: self.config.adapter.clone(),
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
            account_revision: None,
            operation_busy: self.operation_busy(),
            component_tasks: self.component_tasks(),
        }
    }
}
fn is_supported_adapter(adapter: &str) -> bool {
    matches!(adapter, "codex" | "codebuddy" | "deepseek")
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
        "cancelled" => "AI 任务已停止。",
        "timeout" => "AI 执行超时，已停止本次任务；请主动重试。",
        "harness_busy" | "harness_stopping" => "AI 任务尚未停止，请等待停止完成后重试。",
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
        "harness_not_ready" => "所选 Harness 尚未就绪，请准备组件并完成订阅登录。",
        "harness_task_unavailable" => "CodeBuddy 当前支持连接测试、单题解析和追问；尚未开放批量与导入任务。",
        "codebuddy_account_stale" | "codebuddy_login_stale" => "CodeBuddy 账户已变化，请重新发起任务。",
        "codebuddy_auth_expired" | "codebuddy_auth_required" | "codebuddy_login_not_ready" => "CodeBuddy 登录已失效，请重新登录后再试。",
        "codebuddy_login_busy" => "CodeBuddy 账户正在使用中，请等待或停止当前任务。",
        "codebuddy_runtime_download" => "CodeBuddy 组件下载失败，请检查网络后重试。",
        "codebuddy_runtime_proxy" | "codebuddy_runtime_proxy_config" => "CodeBuddy 组件下载的系统代理不可用，请检查 Windows 代理配置后重试。",
        "codebuddy_runtime_integrity" => "CodeBuddy 组件完整性校验失败，文件未启用，请重新准备。",
        "codebuddy_runtime_redirect" => "CodeBuddy 组件下载地址未通过校验，下载已停止。",
        "codebuddy_runtime_busy" => "另一个进程正在准备 CodeBuddy 组件，请稍后重试。",
        "codebuddy_runtime_storage" => "CodeBuddy 组件无法写入本地缓存，请检查权限和可用空间后重试。",
        "codebuddy_auth_network" => "CodeBuddy 网络请求未完成，本次任务已停止；不会自动重试。",
        "codebuddy_request_denied" => "CodeBuddy 请求未通过受控请求校验，本次任务已停止。",
        "codebuddy_request_budget" | "codebuddy_model_already_requested" => "CodeBuddy 请求次数已达到本次任务上限，后续请求已阻止。",
        "codebuddy_upstream_length" => "CodeBuddy 模型响应达到输出上限，结果不完整，未被采纳；不会自动重试。",
        "codebuddy_upstream_content_filter" => "CodeBuddy 模型响应被服务端内容过滤，结果未被采纳。",
        "codebuddy_upstream_tool_call" => "CodeBuddy 模型响应包含不受支持的工具调用，结果未被采纳。",
        "codebuddy_upstream_unknown_field" => "CodeBuddy 模型响应包含尚未兼容的协议字段，结果未被采纳。",
        "codebuddy_upstream_incomplete" => "CodeBuddy 模型响应未确认完整结束，结果未被采纳；不会自动重试。",
        "codebuddy_upstream_unverified" => "CodeBuddy 模型响应未通过协议校验，结果未被采纳。",
        "codebuddy_candidate_rejected" | "codebuddy_output_invalid" => "CodeBuddy 组件输出未通过完整性校验，结果未被采纳。",
        "codebuddy_frame_invalid" | "codebuddy_pipe_closed" => "CodeBuddy 隔离进程通信异常，本次任务已停止。",
        "codebuddy_relay_start_failed" | "codebuddy_relay_io_failed" | "codebuddy_relay_peer_closed" => "CodeBuddy 隔离进程通信中断，本次任务已停止。",
        "codebuddy_isolation_failed" | "codebuddy_container_required" => "CodeBuddy 隔离环境未通过检查，本次任务已停止。",
        "codebuddy_worker_failed" | "codebuddy_worker_environment" | "codebuddy_worker_path" | "codebuddy_config_invalid" => "CodeBuddy 隔离组件未能完成执行，本次任务已停止。",
        "codebuddy_cleanup_failed" | "codebuddy_profile_cleanup_failed" => "CodeBuddy 隔离环境清理未完成，结果未被采纳。",
        "codebuddy_business_json" => "CodeBuddy 已返回模型响应，但正文不是单个完整有效的 JSON（或包含重复字段），结果未被采纳；不会自动重试。",
        "codebuddy_business_limit" => "CodeBuddy 返回的正文或业务文本超过长度限制，结果未被采纳；请缩小题目或追问范围。",
        "codebuddy_connection_result" => "CodeBuddy 已返回模型响应，但连接测试结果不符合 {\"ok\":true}，结果未被采纳。",
        "codebuddy_analysis_result" => "CodeBuddy 已返回 JSON，但缺少有效的 analysis 解析文本或附加字段类型不正确，结果未被采纳。",
        "codebuddy_followup_result" => "CodeBuddy 已返回 JSON，但缺少有效的 reply、revisedAnalysis 或附加字段类型不正确，结果未被采纳。",
        code if code.starts_with("codebuddy_") => "CodeBuddy 未确认任务成功，请检查组件、账户权限和连接后重试；不会自动重新生成。",
        "harness_provider_unavailable" => "当前所选 Harness 尚未开放模型执行，请查看对应提供方的说明。",
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
        .map_err(|error| failure(error.code))
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
            account_revision: None,
            messages: vec![Message {
                role: "user".into(),
                content: "synthetic".into(),
            }],
        }
    }
    fn wait_login(service: &Harness) {
        let start = std::time::Instant::now();
        while service
            .with(|state| Ok(state.active.is_some() || !state.preparations.is_empty()))
            .unwrap()
        {
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn select_adapter(service: &Arc<Harness>, adapter: &str, revision: u64) -> Result<Status> {
        let control = serde_json::from_value::<Control>(json!({
            "kind":"select_adapter", "adapter":adapter, "revision":revision
        }))?;
        service.control(control)
    }

    fn config_snapshot(service: &Harness) -> Value {
        service
            .with(|state| Ok(serde_json::to_value(&state.config)?))
            .unwrap()
    }

    fn select_model(service: &Arc<Harness>, model: &str, revision: u64) -> Result<Status> {
        let control = serde_json::from_value::<Control>(json!({
            "kind":"select_model", "model":model, "revision":revision
        }))?;
        service.control(control)
    }

    #[test]
    fn codebuddy_model_selection_persists_and_preserves_accounts_and_codex() {
        let (fixture, login, account_revision) = codebuddy_fixture();
        let service = &fixture.service;
        let initial = service.control(Control::Status).unwrap();
        assert_eq!(initial.model, "deepseek-v4.1-flash");
        let before = config_snapshot(service);
        let mut old_request = request(service);
        old_request.account_revision = Some(account_revision);
        let selected = select_model(service, "hy4-preview", initial.revision).unwrap();
        assert_eq!(selected.model, "hy4-preview");
        assert_eq!(selected.revision, initial.revision + 1);
        assert_eq!(selected.account_revision, Some(account_revision));
        assert!(selected.ready);
        let mut expected = before;
        expected["revision"] = json!(selected.revision);
        expected["codebuddyModel"] = json!("hy4-preview");
        assert_eq!(config_snapshot(service), expected);
        assert_eq!(
            service.execute(old_request).unwrap_err().code,
            "harness_stale"
        );
        assert!(login.execution_status().unwrap().signed_in);
        assert_eq!(login.execution_status().unwrap().revision, account_revision);

        let codex = select_adapter(service, "codex", selected.revision).unwrap();
        assert_eq!(codex.model, "gpt-6.1-sol");
        let returned = select_adapter(service, "codebuddy", codex.revision).unwrap();
        assert_eq!(returned.model, "hy4-preview");
        assert_eq!(returned.account_revision, Some(account_revision));
        let selected = select_model(service, "hy3", returned.revision).unwrap();
        let codex = select_adapter(service, "codex", selected.revision).unwrap();
        assert_eq!(codex.model, "gpt-6.1-sol");
        service.control(Control::Login).unwrap();
        wait_login(service);
        service.control(Control::Clear).unwrap();
        let cleared = service.control(Control::Status).unwrap();
        let returned = select_adapter(service, "codebuddy", cleared.revision).unwrap();
        assert_eq!(returned.model, "hy3");
        assert!(returned.ready);
        assert_eq!(returned.account_revision, Some(account_revision));
        let reopened = Arc::new(Harness::open(&fixture.root));
        assert_eq!(reopened.control(Control::Status).unwrap().model, "hy3");
    }

    #[test]
    fn codebuddy_model_selection_rejects_invalid_stale_busy_and_failed_save() {
        let (fixture, _, _) = codebuddy_fixture();
        let service = &fixture.service;
        let before = config_snapshot(service);
        let revision = before["revision"].as_u64().unwrap();
        for model in ["", "other", "deepseek-v4.1-flash-sg", " hy3"] {
            assert_eq!(
                select_model(service, model, revision).err().unwrap().code,
                "codebuddy_config_invalid"
            );
        }
        assert_eq!(
            select_model(service, "hy3", revision - 1)
                .err()
                .unwrap()
                .code,
            "harness_stale"
        );
        let operation = service
            .with(|state| state.start("model-selection-busy".into(), false))
            .unwrap();
        assert_eq!(
            select_model(service, "hy3", revision).err().unwrap().code,
            "harness_busy"
        );
        service
            .finish(&operation, Ok(()), |_, result| result)
            .unwrap();
        service
            .with(|state| {
                state.db.execute_batch("PRAGMA query_only=ON")?;
                Ok(())
            })
            .unwrap();
        assert!(select_model(service, "hy3", revision).is_err());
        assert_eq!(config_snapshot(service), before);
        service
            .with(|state| {
                state.db.execute_batch("PRAGMA query_only=OFF")?;
                Ok(())
            })
            .unwrap();
        let codex = select_adapter(service, "codex", revision).unwrap();
        assert_eq!(
            select_model(service, "hy3", codex.revision)
                .err()
                .unwrap()
                .code,
            "harness_provider_unavailable"
        );
    }

    #[test]
    fn codebuddy_model_missing_legacy_setting_defaults_without_replacing_codex() {
        let fixture = Fixture::new();
        let mut legacy = config_snapshot(&fixture.service);
        legacy.as_object_mut().unwrap().remove("codebuddyModel");
        fixture
            .service
            .with(|state| {
                state
                    .db
                    .execute("UPDATE config SET value=? WHERE id=1", [legacy.to_string()])?;
                Ok(())
            })
            .unwrap();
        let reopened = Arc::new(Harness::open(&fixture.root));
        let codex = reopened.control(Control::Status).unwrap();
        assert_eq!(codex.model, "gpt-6.1-sol");
        let codebuddy = select_adapter(&reopened, "codebuddy", codex.revision).unwrap();
        assert_eq!(codebuddy.model, "deepseek-v4.1-flash");
        assert_eq!(config_snapshot(&reopened)["model"], "gpt-6.1-sol");
    }

    #[test]
    fn codebuddy_model_invalid_persisted_setting_is_rejected_without_replacement() {
        let fixture = Fixture::new();
        let mut invalid = config_snapshot(&fixture.service);
        invalid["codebuddyModel"] = json!("unknown-model");
        fixture
            .service
            .with(|state| {
                state.db.execute(
                    "UPDATE config SET value=? WHERE id=1",
                    [invalid.to_string()],
                )?;
                Ok(())
            })
            .unwrap();
        let reopened = Arc::new(Harness::open(&fixture.root));
        assert_eq!(
            reopened.control(Control::Status).err().unwrap().code,
            "harness_unavailable"
        );
        assert_eq!(
            Inner::open(&fixture.root.join("ai-execution"), Arc::new(Login::new()))
                .err()
                .unwrap()
                .code,
            "invalid_input"
        );
        let stored = fixture
            .service
            .with(|state| {
                let raw: String =
                    state
                        .db
                        .query_row("SELECT value FROM config WHERE id=1", [], |row| row.get(0))?;
                Ok(serde_json::from_str::<Value>(&raw)?)
            })
            .unwrap();
        assert_eq!(stored, invalid);
    }

    #[test]
    fn codebuddy_execution_failures_explain_the_failed_stage_without_retrying() {
        for (code, stage) in [
            ("codebuddy_auth_network", "网络"),
            ("codebuddy_request_denied", "请求"),
            ("codebuddy_request_budget", "请求"),
            ("codebuddy_upstream_unverified", "模型响应"),
            ("codebuddy_candidate_rejected", "组件输出"),
            ("codebuddy_frame_invalid", "进程通信"),
            ("codebuddy_pipe_closed", "进程通信"),
            ("codebuddy_isolation_failed", "隔离"),
            ("codebuddy_cleanup_failed", "清理"),
        ] {
            let error = failure(code);
            assert_eq!(error.code, code);
            assert!(error.message.contains("CodeBuddy"));
            assert!(error.message.contains(stage), "{code}: {}", error.message);
            assert!(!error.retryable);
        }
    }

    #[test]
    fn codebuddy_preparation_preserves_codex_configuration() {
        let f = Fixture::new();
        let before = config_snapshot(&f.service);
        select_adapter(
            &f.service,
            "codebuddy",
            before["revision"].as_u64().unwrap(),
        )
        .unwrap();
        let prepared = f.service.control(Control::PrepareRuntime {}).unwrap();
        assert_eq!(prepared.runtime_source, RuntimeSource::Managed);
        wait_login(&f.service);
        let status = f.service.control(Control::Status).unwrap();
        assert_eq!(status.runtime_state, RuntimeState::Ready);
        assert_eq!(status.model, "deepseek-v4.1-flash");
        assert!(!status.ready);
        let after = config_snapshot(&f.service);
        for field in [
            "model",
            "timeoutSeconds",
            "runtimePath",
            "runtimeSource",
            "verified",
        ] {
            assert_eq!(before[field], after[field]);
        }
    }

    fn codebuddy_fixture() -> (Fixture, Arc<Login>, u64) {
        let fixture = Fixture::new();
        let service = &fixture.service;
        let revision = service.control(Control::Status).unwrap().revision;
        select_adapter(service, "codebuddy", revision).unwrap();
        service.control(Control::PrepareRuntime {}).unwrap();
        wait_login(service);
        let login = service
            .with(|state| Ok(state.codebuddy_login.clone()))
            .unwrap();
        let revision = login.execution_status().unwrap().revision;
        login
            .control(crate::harness_codebuddy_login::Control::Login {
                revision,
                remember: false,
            })
            .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !login.execution_status().unwrap().signed_in {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        let revision = login.execution_status().unwrap().revision;
        (fixture, login, revision)
    }

    #[test]
    fn codebuddy_question_and_followup_use_current_account_and_keep_codex_settings() {
        let (fixture, login, account_revision) = codebuddy_fixture();
        let before = config_snapshot(&fixture.service);
        assert!(fixture.service.control(Control::Status).unwrap().ready);
        for (task, field) in [
            (Task::ConnectionTest, "ok"),
            (Task::QuestionAnalysis, "analysis"),
            (Task::QuestionFollowup, "revisedAnalysis"),
        ] {
            let mut request = request(&fixture.service);
            request.task = task;
            request.account_revision = Some(account_revision);
            let response = fixture.service.execute(request).unwrap();
            let content: Value =
                serde_json::from_str(response["content"].as_str().unwrap()).unwrap();
            assert!(content.get(field).is_some());
            assert!(login.execution_status().unwrap().signed_in);
            assert!(!login.execution_status().unwrap().busy);
        }
        assert_eq!(before, config_snapshot(&fixture.service));
        assert!(!fixture.root.join("ai-execution/fake-subscription").exists());
    }

    #[test]
    fn codebuddy_rejects_unsupported_tasks_and_missing_or_old_accounts_before_start() {
        let (fixture, login, account_revision) = codebuddy_fixture();
        for task in [Task::ImportOrganize, Task::BatchReview, Task::BatchAnalysis] {
            let mut request = request(&fixture.service);
            request.task = task;
            request.account_revision = Some(account_revision);
            assert_eq!(
                fixture.service.execute(request).unwrap_err().code,
                "harness_task_unavailable"
            );
        }
        assert_eq!(
            fixture
                .service
                .execute(request(&fixture.service))
                .unwrap_err()
                .code,
            "codebuddy_account_stale"
        );
        let mut old = request(&fixture.service);
        old.account_revision = Some(account_revision);
        login
            .control(crate::harness_codebuddy_login::Control::Logout {})
            .unwrap();
        assert_eq!(
            fixture.service.execute(old).unwrap_err().code,
            "codebuddy_login_stale"
        );
        assert!(!fixture
            .service
            .with(|state| Ok(state.active.is_some()))
            .unwrap());
        assert!(!fixture.service.control(Control::Status).unwrap().ready);
    }

    #[test]
    fn codebuddy_logout_stops_execution_and_discards_the_result() {
        let (fixture, login, account_revision) = codebuddy_fixture();
        let marker = fixture.root.join("ai-execution/fake-codebuddy-wait");
        std::fs::write(&marker, b"fixture").unwrap();
        let mut request = request(&fixture.service);
        request.account_revision = Some(account_revision);
        let service = fixture.service.clone();
        let executing = std::thread::spawn(move || service.execute(request));
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while !login.execution_status().unwrap().busy {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        login
            .control(crate::harness_codebuddy_login::Control::Logout {})
            .unwrap();
        assert_eq!(executing.join().unwrap().unwrap_err().code, "cancelled");
        assert!(!fixture
            .service
            .with(|state| Ok(state.active.is_some()))
            .unwrap());
        assert!(!login.execution_status().unwrap().signed_in);
    }

    #[test]
    fn adapter_selection_preserves_codex_subscription_and_survives_restart() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        let before = config_snapshot(&f.service);
        let revision = before["revision"].as_u64().unwrap();
        let selected = select_adapter(&f.service, "codebuddy", revision).unwrap();
        assert_eq!(selected.adapter, "codebuddy");
        assert_eq!(selected.mode, "harness");
        assert!(!selected.ready);
        let after = config_snapshot(&f.service);
        for field in [
            "model",
            "timeoutSeconds",
            "runtimePath",
            "runtimeSource",
            "verified",
            "logoutPending",
        ] {
            assert_eq!(after[field], before[field], "selection changed {field}");
        }
        assert!(f.service.with(|state| Ok(state.subscription)).unwrap());
        assert!(f.root.join("ai-execution/fake-subscription").is_file());
        std::fs::write(
            f.root.join("ai-execution/fake-status-stop-failed"),
            b"fixture",
        )
        .unwrap();
        let reopened = Harness::open(&f.root);
        let restored = reopened.refresh().unwrap();
        assert_eq!(restored.adapter, "codebuddy");
        assert_eq!(restored.revision, selected.revision);
        assert!(!restored.ready);
        let deepseek = select_adapter(&f.service, "deepseek", selected.revision).unwrap();
        assert!(deepseek.reason.contains("DeepSeek"));
        let codex = select_adapter(&f.service, "codex", deepseek.revision).unwrap();
        assert!(
            codex.ready,
            "switching back must retain the confirmed subscription"
        );
        assert!(f.root.join("ai-execution/fake-subscription").is_file());
    }

    #[test]
    fn adapter_selection_needs_no_prepared_codex_component() {
        let root = std::env::temp_dir().join(format!(
            "shiroha-provider-selection-{}",
            uuid::Uuid::new_v4()
        ));
        let service = Arc::new(Harness::open(&root));
        let codebuddy = select_adapter(&service, "codebuddy", 0).unwrap();
        assert_eq!(codebuddy.mode, "harness");
        assert_eq!(codebuddy.runtime_state, RuntimeState::Unprepared);
        assert_eq!(codebuddy.model, "deepseek-v4.1-flash");
        let codex = select_adapter(&service, "codex", codebuddy.revision).unwrap();
        assert!(codex.model.is_empty());
        assert!(!codex.ready);
        assert!(!root.join("ai-execution/fake-subscription").exists());
    }

    #[test]
    fn selection_validates_revision_adapter_and_idle_without_mutating_previous_configuration() {
        let f = Fixture::new();
        let before = config_snapshot(&f.service);
        let revision = before["revision"].as_u64().unwrap();
        assert_eq!(
            select_adapter(&f.service, "codebuddy", revision - 1)
                .err()
                .unwrap()
                .code,
            "harness_stale"
        );
        assert_eq!(
            select_adapter(&f.service, "unknown", revision)
                .err()
                .unwrap()
                .code,
            "invalid_input"
        );
        for request in [
            json!({"kind":"select_adapter","adapter":"codebuddy","revision":revision,"token":"fixture"}),
            json!({"kind":"select_adapter","adapter":"codebuddy"}),
            json!({"kind":"select_adapter","adapter":"codebuddy","revision":"1"}),
        ] {
            assert!(serde_json::from_value::<Control>(request).is_err());
        }
        let operation = f
            .service
            .with(|state| state.start(uuid::Uuid::new_v4().to_string(), false))
            .unwrap();
        assert_eq!(
            select_adapter(&f.service, "codebuddy", revision)
                .err()
                .unwrap()
                .code,
            "harness_busy"
        );
        assert!(!operation.cancel.load(Ordering::Acquire));
        f.service
            .finish(&operation, Ok(()), |_, result| result)
            .unwrap();
        assert_eq!(config_snapshot(&f.service), before);
    }

    #[test]
    fn failed_selection_write_preserves_mode_provider_and_revision() {
        let f = Fixture::new();
        let before = config_snapshot(&f.service);
        f.service
            .with(|state| {
                state.db.execute_batch("PRAGMA query_only=ON;")?;
                Ok(())
            })
            .unwrap();
        assert!(select_adapter(
            &f.service,
            "codebuddy",
            before["revision"].as_u64().unwrap()
        )
        .is_err());
        assert_eq!(config_snapshot(&f.service), before);
        f.service
            .with(|state| {
                state.db.execute_batch("PRAGMA query_only=OFF;")?;
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn non_codex_selection_rejects_codex_controls_and_cannot_borrow_codex_login() {
        for adapter in ["codebuddy", "deepseek"] {
            let f = Fixture::new();
            f.service.control(Control::Login).unwrap();
            wait_login(&f.service);
            let old_request = request(&f.service);
            let selected = select_adapter(&f.service, adapter, old_request.revision).unwrap();
            let before = config_snapshot(&f.service);
            std::fs::write(
                f.root.join("ai-execution/fake-status-stop-failed"),
                b"fixture",
            )
            .unwrap();
            std::fs::write(f.root.join("ai-execution/fake-prepare-failed"), b"fixture").unwrap();
            assert!(!f.service.refresh().unwrap().ready);
            assert!(!f.service.control(Control::Status).unwrap().ready);
            assert_eq!(
                f.service.execute(old_request).unwrap_err().code,
                "harness_stale"
            );
            assert_eq!(
                f.service.execute(request(&f.service)).unwrap_err().code,
                if adapter == "codebuddy" {
                    "codebuddy_account_stale"
                } else {
                    "harness_provider_unavailable"
                }
            );
            for control in [
                Control::ChooseRuntime,
                Control::Inspect,
                Control::Login,
                Control::Logout,
                Control::Clear,
            ] {
                assert_eq!(
                    f.service.control(control).err().unwrap().code,
                    "harness_provider_unavailable"
                );
            }
            if adapter == "deepseek" {
                for control in [Control::PrepareRuntime {}, Control::UseManagedRuntime {}] {
                    assert_eq!(
                        f.service.control(control).err().unwrap().code,
                        "harness_provider_unavailable"
                    );
                }
            }
            assert_eq!(config_snapshot(&f.service), before);
            assert!(f.root.join("ai-execution/fake-subscription").is_file());
            assert!(f
                .service
                .with(|state| Ok(state.subscription && state.active.is_none()))
                .unwrap());
            assert_eq!(
                f.service.control(Control::Status).unwrap().revision,
                selected.revision
            );
        }
    }

    #[test]
    fn saving_non_codex_provider_or_api_preserves_codex_specific_configuration() {
        let f = Fixture::new();
        f.service.control(Control::Login).unwrap();
        wait_login(&f.service);
        let before = config_snapshot(&f.service);
        std::fs::write(
            f.root.join("ai-execution/fake-status-stop-failed"),
            b"fixture",
        )
        .unwrap();
        let mut revision = before["revision"].as_u64().unwrap();
        for (mode, adapter) in [
            ("harness", "codebuddy"),
            ("harness", "deepseek"),
            ("api", "deepseek"),
        ] {
            let saved = f
                .service
                .control(Control::Save {
                    mode: mode.into(),
                    adapter: adapter.into(),
                    model: "not-a-codex-model".into(),
                    timeout_seconds: 599,
                    revision,
                })
                .unwrap();
            revision = saved.revision;
            assert_eq!(saved.mode, mode);
            assert_eq!(saved.adapter, adapter);
            assert!(!saved.ready);
            let after = config_snapshot(&f.service);
            for field in [
                "model",
                "timeoutSeconds",
                "runtimePath",
                "runtimeSource",
                "verified",
                "logoutPending",
            ] {
                assert_eq!(after[field], before[field], "saving changed {field}");
            }
            assert!(f.service.with(|state| Ok(state.subscription)).unwrap());
            assert!(f.root.join("ai-execution/fake-subscription").is_file());
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
    fn switching_during_preparation_preserves_task_and_selected_provider() {
        let f = Fixture::new();
        let gate = f.root.join("ai-execution/fake-prepare-wait");
        std::fs::write(&gate, b"fixture").unwrap();
        let preparing = f.service.control(Control::UseManagedRuntime {}).unwrap();
        let selected = select_adapter(&f.service, "codebuddy", preparing.revision).unwrap();
        assert_eq!(selected.adapter, "codebuddy");
        std::fs::remove_file(gate).unwrap();
        wait_login(&f.service);
        let finished = f.service.control(Control::Status).unwrap();
        assert_eq!(finished.adapter, "codebuddy");
        let codex = select_adapter(&f.service, "codex", finished.revision).unwrap();
        assert_eq!(codex.runtime_state, RuntimeState::Ready);
        let reused = f.service.control(Control::PrepareRuntime {}).unwrap();
        assert_eq!(reused.runtime_state, RuntimeState::Ready);
        assert_eq!(reused.revision, codex.revision);
    }

    #[test]
    fn preparation_cancellation_is_scoped_and_duplicate_starts_join_the_task() {
        let f = Fixture::new();
        std::fs::write(f.root.join("ai-execution/fake-prepare-wait"), b"fixture").unwrap();
        let codex = f.service.control(Control::UseManagedRuntime {}).unwrap();
        let id = codex.component_tasks[0].id.clone();
        let duplicate = f.service.control(Control::PrepareRuntime {}).unwrap();
        assert_eq!(duplicate.component_tasks.len(), 1);
        assert_eq!(duplicate.component_tasks[0].id, id);
        select_adapter(&f.service, "codebuddy", codex.revision).unwrap();
        let buddy = f.service.control(Control::PrepareRuntime {}).unwrap();
        assert_eq!(buddy.component_tasks.len(), 2);
        let stopped = f
            .service
            .control(Control::CancelPreparation {
                adapter: "codex".into(),
                id,
            })
            .unwrap();
        assert_eq!(stopped.adapter, "codebuddy");
        assert_eq!(stopped.runtime_state, RuntimeState::Preparing);
        assert_eq!(stopped.component_tasks.len(), 1);
        assert_eq!(stopped.component_tasks[0].adapter, "codebuddy");
        f.service.control(Control::CancelAll).unwrap();
        assert!(f
            .service
            .control(Control::Status)
            .unwrap()
            .component_tasks
            .is_empty());
    }

    #[test]
    fn prepared_provider_can_execute_while_other_component_is_preparing() {
        let (f, _, account_revision) = codebuddy_fixture();
        let initial = f.service.control(Control::Status).unwrap();
        select_adapter(&f.service, "codex", initial.revision).unwrap();
        std::fs::write(f.root.join("ai-execution/fake-prepare-wait"), b"fixture").unwrap();
        let preparing = f.service.control(Control::UseManagedRuntime {}).unwrap();
        let selected = select_adapter(&f.service, "codebuddy", preparing.revision).unwrap();
        assert!(selected.ready);
        assert!(!selected.busy);
        let mut task = request(&f.service);
        task.account_revision = Some(account_revision);
        assert!(f.service.execute(task).is_ok());
        assert_eq!(
            f.service
                .control(Control::Status)
                .unwrap()
                .component_tasks
                .len(),
            1
        );
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
        tauri::async_runtime::block_on(f.service.invalidate_codebuddy_for_restore()).unwrap();
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

    fn wait_for_codebuddy_lease(login: &Login) {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while !login.execution_status().unwrap().busy {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn codebuddy_cancel_all_preserves_login_and_the_prepared_component() {
        let (fixture, login, account_revision) = codebuddy_fixture();
        let before = fixture.service.control(Control::Status).unwrap();
        let marker = fixture.root.join("ai-execution/fake-codebuddy-wait");
        std::fs::write(&marker, b"fixture").unwrap();
        let mut pending = request(&fixture.service);
        pending.account_revision = Some(account_revision);
        let service = Arc::clone(&fixture.service);
        let executing = std::thread::spawn(move || service.execute(pending));
        wait_for_codebuddy_lease(&login);

        fixture.service.control(Control::CancelAll).unwrap();
        assert_eq!(executing.join().unwrap().unwrap_err().code, "cancelled");
        std::fs::remove_file(&marker).unwrap();
        let account = login.execution_status().unwrap();
        assert!(account.signed_in);
        assert!(!account.busy);
        assert_eq!(account.revision, account_revision);
        let status = fixture.service.control(Control::Status).unwrap();
        assert!(status.ready);
        assert!(!status.busy);
        assert!(status.revision > before.revision);
        assert_eq!(status.runtime_state, RuntimeState::Ready);
        assert_eq!(status.runtime_path, before.runtime_path);
        assert!(!fixture
            .service
            .with(|state| Ok(state.active.is_some()))
            .unwrap());

        let mut retry = request(&fixture.service);
        retry.account_revision = Some(account_revision);
        assert!(fixture.service.execute(retry).is_ok());
    }

    #[test]
    fn codebuddy_restore_cancels_execution_and_requires_component_preparation_again() {
        let (fixture, login, account_revision) = codebuddy_fixture();
        let marker = fixture.root.join("ai-execution/fake-codebuddy-wait");
        std::fs::write(&marker, b"fixture").unwrap();
        let mut queued = request(&fixture.service);
        queued.account_revision = Some(account_revision);
        let mut pending = request(&fixture.service);
        pending.account_revision = Some(account_revision);
        let service = Arc::clone(&fixture.service);
        let executing = std::thread::spawn(move || service.execute(pending));
        wait_for_codebuddy_lease(&login);

        let restore = fixture.service.begin_restore().unwrap();
        assert_eq!(executing.join().unwrap().unwrap_err().code, "cancelled");
        std::fs::remove_file(&marker).unwrap();
        let status = fixture.service.control(Control::Status).unwrap();
        assert!(status.busy);
        assert!(!status.ready);
        assert_eq!(status.runtime_state, RuntimeState::Unprepared);
        assert_eq!(
            fixture
                .service
                .control(Control::PrepareRuntime {})
                .err()
                .unwrap()
                .code,
            "harness_busy"
        );
        assert!(login.execution_status().unwrap().signed_in);
        assert_eq!(login.execution_status().unwrap().revision, account_revision);
        drop(restore);

        let status = fixture.service.control(Control::Status).unwrap();
        assert!(!status.busy);
        assert!(!status.ready);
        assert_eq!(
            fixture.service.execute(queued).unwrap_err().code,
            "harness_stale"
        );
        let mut before_preparation = request(&fixture.service);
        before_preparation.account_revision = Some(account_revision);
        assert_eq!(
            fixture
                .service
                .execute(before_preparation)
                .unwrap_err()
                .code,
            "harness_not_ready"
        );
        fixture.service.control(Control::PrepareRuntime {}).unwrap();
        wait_login(&fixture.service);
        assert!(fixture.service.control(Control::Status).unwrap().ready);
        let mut after_preparation = request(&fixture.service);
        after_preparation.account_revision = Some(account_revision);
        assert!(fixture.service.execute(after_preparation).is_ok());
    }

    #[test]
    fn codebuddy_round_trip_selection_keeps_both_accounts_and_independent_runtimes() {
        let (fixture, login, account_revision) = codebuddy_fixture();
        let codebuddy = fixture.service.control(Control::Status).unwrap();
        let codex = select_adapter(&fixture.service, "codex", codebuddy.revision).unwrap();
        assert_eq!(codex.model, "gpt-6.1-sol");
        assert_eq!(codex.runtime_source, RuntimeSource::Custom);
        assert_ne!(codex.runtime_path, codebuddy.runtime_path);
        fixture.service.control(Control::Login).unwrap();
        wait_login(&fixture.service);
        let codex = fixture.service.control(Control::Status).unwrap();
        assert!(codex.ready);
        let codex_configuration = config_snapshot(&fixture.service);
        assert!(login.execution_status().unwrap().signed_in);
        assert_eq!(login.execution_status().unwrap().revision, account_revision);

        let selected = select_adapter(&fixture.service, "codebuddy", codex.revision).unwrap();
        assert!(selected.ready);
        assert_eq!(selected.model, "deepseek-v4.1-flash");
        assert_eq!(selected.runtime_source, RuntimeSource::Managed);
        assert_eq!(selected.runtime_state, RuntimeState::Ready);
        assert_eq!(selected.runtime_path, codebuddy.runtime_path);
        assert_eq!(selected.account_revision, Some(account_revision));
        let restored = config_snapshot(&fixture.service);
        for field in [
            "model",
            "timeoutSeconds",
            "runtimePath",
            "runtimeSource",
            "verified",
            "logoutPending",
        ] {
            assert_eq!(restored[field], codex_configuration[field]);
        }
        assert!(fixture
            .service
            .with(|state| Ok(state.subscription))
            .unwrap());
        assert!(fixture
            .root
            .join("ai-execution/fake-subscription")
            .is_file());
        let mut analysis = request(&fixture.service);
        analysis.task = Task::QuestionAnalysis;
        analysis.account_revision = Some(account_revision);
        assert!(fixture.service.execute(analysis).is_ok());
        assert!(login.execution_status().unwrap().signed_in);
        assert!(!login.execution_status().unwrap().busy);
    }
}
