use crate::commands::authorize;
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, Weak,
};
use std::time::{Duration, Instant};
use uuid::Uuid;

const LOGIN_PREFIX: &str = "https://copilot.tencent.com/login?";
const SIGNED_OUT_MESSAGE: &str = "尚未登录 CodeBuddy。";
const PREPARING_MESSAGE: &str = "正在准备 CodeBuddy 登录页面…";
const WAITING_MESSAGE: &str = "请在浏览器中完成 CodeBuddy 登录。";
const SIGNED_IN_MESSAGE: &str = "CodeBuddy 已登录，可准备组件并使用当前订阅。";
const EXPIRED_MESSAGE: &str = "CodeBuddy 登录已过期，请重新登录。";
const CANCELLED_MESSAGE: &str = "已取消 CodeBuddy 登录。";
const FAILED_MESSAGE: &str = "CodeBuddy 登录未完成，请稍后重试。";
const OPEN_FAILED_MESSAGE: &str = "无法打开浏览器，请复制当前登录链接或重试打开。";
const CANCEL_INTERVAL: Duration = Duration::from_millis(50);
const MAX_LOGIN_URL_BYTES: usize = 1024;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Control {
    Status {},
    Login { revision: u64 },
    OpenLogin {},
    Cancel {},
    Logout {},
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    SignedOut,
    Authenticating,
    SignedIn,
    Expired,
    Failed,
    Cancelled,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    phase: Phase,
    revision: u64,
    login_url: String,
    message: String,
    browser_opened: bool,
    busy: bool,
}

// 状态、challenge 与会话只属于当前应用进程，退出/取消以 revision 失效旧任务。
pub struct Login {
    inner: Mutex<Inner>,
}

pub(crate) struct ExecutionStatus {
    pub(crate) revision: u64,
    pub(crate) signed_in: bool,
    pub(crate) busy: bool,
    pub(crate) message: &'static str,
}

struct Inner {
    phase: Phase,
    revision: u64,
    login_url: String,
    message: &'static str,
    browser_opened: bool,
    cancel: Option<Arc<AtomicBool>>,
    session: Option<MemorySession>,
    lease: Option<ActiveLease>,
}

struct ActiveLease {
    id: Uuid,
    cancel: Arc<AtomicBool>,
    expiration: MemoryExpiry,
}

// 租约由整次 CLI 任务持有；HTTP 返回后仍保留注销与任务取消的关联。
pub(crate) struct ExecutionLease {
    service: Arc<Login>,
    revision: u64,
    id: Uuid,
    cancel: Arc<AtomicBool>,
    session: Option<MemorySession>,
    requested: bool,
    in_flight: bool,
    watcher: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Clone, Copy)]
struct MemoryExpiry {
    #[cfg(all(windows, not(any(test, feature = "native-test"))))]
    real: crate::harness_codebuddy_auth::SessionExpiry,
    #[cfg(any(test, feature = "native-test"))]
    deadline: Instant,
}

struct Attempt {
    revision: u64,
    cancel: Arc<AtomicBool>,
}

struct MemorySession {
    #[cfg(all(windows, not(any(test, feature = "native-test"))))]
    real: crate::harness_codebuddy_auth::AuthenticatedAccount,
    #[cfg(any(test, feature = "native-test"))]
    expires_at: Instant,
    #[cfg(any(test, feature = "native-test"))]
    secret: String,
    #[cfg(any(test, feature = "native-test"))]
    model_response: Option<Vec<u8>>,
    #[cfg(test)]
    model_fixture: ModelFixture,
}

#[cfg(test)]
#[derive(Default)]
enum ModelFixture {
    #[default]
    Response,
    Unauthorized,
    Blocked {
        started: Arc<tokio::sync::Notify>,
        release: Arc<tokio::sync::Notify>,
    },
    UnauthorizedAfterCancel {
        started: Arc<tokio::sync::Notify>,
    },
}

impl Default for Login {
    fn default() -> Self {
        Self::new()
    }
}

impl Login {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                phase: Phase::SignedOut,
                revision: 0,
                login_url: String::new(),
                message: SIGNED_OUT_MESSAGE,
                browser_opened: false,
                cancel: None,
                session: None,
                lease: None,
            }),
        }
    }

    pub(crate) fn control(self: &Arc<Self>, request: Control) -> Result<Status> {
        match request {
            Control::Status {} => self.status(),
            Control::Login { revision } => {
                let attempt = self.start(revision)?;
                let initial = self.status()?;
                let service = Arc::clone(self);
                tauri::async_runtime::spawn(async move {
                    let result = service.authenticate(&attempt).await;
                    let _ = service.finish(&attempt, result);
                });
                Ok(initial)
            }
            Control::OpenLogin {} => self.open_current(None),
            Control::Cancel {} => self.clear(Phase::Cancelled),
            Control::Logout {} => self.clear(Phase::SignedOut),
        }
    }

    fn status(&self) -> Result<Status> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        state.refresh_expiration()?;
        Ok(state.snapshot())
    }

    pub(crate) fn execution_status(&self) -> Result<ExecutionStatus> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        state.refresh_expiration()?;
        Ok(ExecutionStatus {
            revision: state.revision,
            signed_in: state.has_account(),
            busy: state.phase == Phase::Authenticating || state.lease.is_some(),
            message: state.message,
        })
    }

    pub(crate) fn ensure_execution_current(&self, expected_revision: u64) -> Result<()> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        state.refresh_expiration()?;
        if state.revision != expected_revision {
            return Err(Error::new("codebuddy_login_stale"));
        }
        if !state.has_account() {
            return Err(Error::new("codebuddy_login_not_ready"));
        }
        if state
            .lease
            .as_ref()
            .is_some_and(|lease| lease.cancel.load(Ordering::Acquire))
        {
            return Err(Error::new("cancelled"));
        }
        Ok(())
    }

    pub(crate) fn lease(
        self: &Arc<Self>,
        expected_account_revision: u64,
        task_cancel: Arc<AtomicBool>,
    ) -> Result<ExecutionLease> {
        if task_cancel.load(Ordering::Acquire) {
            return Err(Error::new("cancelled"));
        }
        let mut state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        state.refresh_expiration()?;
        if state.revision != expected_account_revision {
            return Err(Error::new("codebuddy_login_stale"));
        }
        if !state.has_account() {
            return Err(Error::new("codebuddy_login_not_ready"));
        }
        if state.lease.is_some() {
            return Err(Error::new("codebuddy_login_busy"));
        }
        let expiration = state
            .session
            .as_ref()
            .ok_or_else(|| Error::new("codebuddy_login_not_ready"))?
            .expiration()?;
        if task_cancel.load(Ordering::Acquire) {
            return Err(Error::new("cancelled"));
        }
        let session = state.session.take();
        let id = Uuid::new_v4();
        state.lease = Some(ActiveLease {
            id,
            cancel: Arc::clone(&task_cancel),
            expiration,
        });
        drop(state);
        let watcher = tauri::async_runtime::spawn(watch_expiration(
            Arc::downgrade(self),
            expected_account_revision,
            id,
            Arc::clone(&task_cancel),
        ));
        Ok(ExecutionLease {
            service: Arc::clone(self),
            revision: expected_account_revision,
            id,
            cancel: task_cancel,
            session,
            requested: false,
            in_flight: false,
            watcher: Some(watcher),
        })
    }

    fn start(&self, expected_revision: u64) -> Result<Attempt> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        // IPC 可能晚于取消/退出到达；只有前端已观察的当前 revision 可以创建新登录。
        if state.revision != expected_revision {
            return Err(Error::new("codebuddy_login_stale"));
        }
        state.clear(Phase::Authenticating)?;
        let cancel = Arc::new(AtomicBool::new(false));
        state.cancel = Some(Arc::clone(&cancel));
        Ok(Attempt {
            revision: state.revision,
            cancel,
        })
    }

    fn publish_challenge(&self, attempt: &Attempt, url: &str) -> Result<bool> {
        validate_login_url(url)?;
        let mut state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        if !state.owns(attempt) {
            return Ok(false);
        }
        state.login_url = url.to_owned();
        state.message = WAITING_MESSAGE;
        Ok(true)
    }

    fn finish(&self, attempt: &Attempt, result: Result<MemorySession>) -> Result<()> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        if !state.owns(attempt) {
            if let Ok(mut session) = result {
                session.invalidate();
            }
            return Ok(());
        }
        state.cancel = None;
        state.login_url.clear();
        state.browser_opened = false;
        match result {
            Ok(mut session) if session.is_expired() => {
                session.invalidate();
                state.phase = Phase::Expired;
                state.message = EXPIRED_MESSAGE;
            }
            Ok(session) => {
                state.phase = Phase::SignedIn;
                state.message = SIGNED_IN_MESSAGE;
                state.session = Some(session);
            }
            Err(error) => {
                state.phase = match error.code {
                    "codebuddy_auth_expired" | "codebuddy_auth_timeout" | "timeout" => {
                        Phase::Expired
                    }
                    "codebuddy_auth_cancelled" | "cancelled" => Phase::Cancelled,
                    _ => Phase::Failed,
                };
                state.message = message_for(state.phase);
            }
        }
        Ok(())
    }

    fn clear(&self, phase: Phase) -> Result<Status> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        state.clear(phase)?;
        Ok(state.snapshot())
    }

    fn open_current(&self, revision: Option<u64>) -> Result<Status> {
        self.open_current_with(revision, open_browser)
    }

    fn open_current_with(
        &self,
        revision: Option<u64>,
        opener: impl FnOnce(&str) -> Result<()>,
    ) -> Result<Status> {
        let state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        let active = state.phase == Phase::Authenticating
            && !state.login_url.is_empty()
            && state
                .cancel
                .as_ref()
                .is_some_and(|cancel| !cancel.load(Ordering::Acquire));
        if !active || revision.is_some_and(|revision| revision != state.revision) {
            return Err(Error::new("codebuddy_login_not_pending"));
        }
        validate_login_url(&state.login_url)?;
        let url = state.login_url.clone();
        let attempt = Attempt {
            revision: state.revision,
            cancel: Arc::clone(
                state
                    .cancel
                    .as_ref()
                    .ok_or_else(|| Error::new("codebuddy_login_not_pending"))?,
            ),
        };
        drop(state);
        require_active(&attempt)?;
        // 系统已经认领的打开请求可能在取消后显示页面；不得持状态锁等浏览器，
        // 取消/退出始终可立即清理会话，且迟到的派发结果不能恢复旧任务状态。
        let opened = opener(&url).is_ok();
        let mut state = self
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        if !state.owns(&attempt) {
            return Ok(state.snapshot());
        }
        state.browser_opened = opened;
        state.message = if state.browser_opened {
            WAITING_MESSAGE
        } else {
            OPEN_FAILED_MESSAGE
        };
        Ok(state.snapshot())
    }

    async fn show_challenge(self: &Arc<Self>, attempt: &Attempt, url: &str) -> Result<()> {
        if !self.publish_challenge(attempt, url)? {
            return Err(Error::new("cancelled"));
        }
        let service = Arc::clone(self);
        let revision = attempt.revision;
        // 系统浏览器派发可能阻塞，独立阻塞任务不占用网络轮询的运行线程。
        tauri::async_runtime::spawn_blocking(move || service.open_current(Some(revision)));
        Ok(())
    }

    #[cfg(all(windows, not(any(test, feature = "native-test"))))]
    async fn authenticate(self: &Arc<Self>, attempt: &Attempt) -> Result<MemorySession> {
        require_active(attempt)?;
        let client = crate::harness_codebuddy_auth::Client::new()?;
        let challenge = tokio::select! {
            biased;
            _ = wait_cancelled(&attempt.cancel) => return Err(Error::new("cancelled")),
            result = client.begin() => result?,
        };
        self.show_challenge(attempt, challenge.login_url()).await?;
        let real = client.complete_account(challenge, &attempt.cancel).await?;
        Ok(MemorySession { real })
    }

    #[cfg(any(test, feature = "native-test"))]
    async fn authenticate(self: &Arc<Self>, attempt: &Attempt) -> Result<MemorySession> {
        require_active(attempt)?;
        let url = format!("{LOGIN_PREFIX}platform=CLI&state={}", uuid::Uuid::new_v4());
        self.show_challenge(attempt, &url).await?;
        tokio::select! {
            biased;
            _ = wait_cancelled(&attempt.cancel) => return Err(Error::new("cancelled")),
            _ = tokio::time::sleep(Duration::from_millis(700)) => {}
        }
        require_active(attempt)?;
        Ok(MemorySession {
            expires_at: Instant::now() + Duration::from_secs(3600),
            secret: "synthetic-memory-session".to_owned(),
            model_response: None,
            #[cfg(test)]
            model_fixture: ModelFixture::Response,
        })
    }

    #[cfg(all(not(windows), not(any(test, feature = "native-test"))))]
    async fn authenticate(self: &Arc<Self>, _attempt: &Attempt) -> Result<MemorySession> {
        Err(Error::new("codebuddy_login_unsupported"))
    }
}

impl Inner {
    fn has_account(&self) -> bool {
        self.phase == Phase::SignedIn && (self.session.is_some() || self.lease.is_some())
    }

    fn owns_lease(&self, revision: u64, id: Uuid) -> bool {
        self.phase == Phase::SignedIn
            && self.revision == revision
            && self.lease.as_ref().is_some_and(|lease| lease.id == id)
    }

    fn refresh_expiration(&mut self) -> Result<()> {
        let expired = self.session.as_ref().is_some_and(MemorySession::is_expired)
            || self
                .lease
                .as_ref()
                .is_some_and(|lease| lease.expiration.is_expired());
        if expired {
            self.clear(Phase::Expired)?;
        }
        Ok(())
    }

    fn owns(&self, attempt: &Attempt) -> bool {
        self.phase == Phase::Authenticating
            && self.revision == attempt.revision
            && !attempt.cancel.load(Ordering::Acquire)
            && self
                .cancel
                .as_ref()
                .is_some_and(|cancel| Arc::ptr_eq(cancel, &attempt.cancel))
    }

    fn clear(&mut self, phase: Phase) -> Result<()> {
        let revision = self
            .revision
            .checked_add(1)
            .ok_or_else(|| Error::new("codebuddy_login_unavailable"))?;
        if let Some(cancel) = self.cancel.take() {
            cancel.store(true, Ordering::Release);
        }
        if let Some(lease) = self.lease.take() {
            lease.cancel.store(true, Ordering::Release);
        }
        if let Some(mut session) = self.session.take() {
            session.invalidate();
        }
        self.revision = revision;
        self.phase = phase;
        self.message = message_for(phase);
        self.login_url.clear();
        self.browser_opened = false;
        Ok(())
    }

    fn snapshot(&self) -> Status {
        Status {
            phase: self.phase,
            revision: self.revision,
            login_url: self.login_url.clone(),
            message: self.message.to_owned(),
            browser_opened: self.browser_opened,
            busy: self.phase == Phase::Authenticating,
        }
    }
}

impl MemorySession {
    fn expiration(&self) -> Result<MemoryExpiry> {
        if self.is_expired() {
            return Err(Error::new("codebuddy_auth_expired"));
        }
        Ok(MemoryExpiry {
            #[cfg(all(windows, not(any(test, feature = "native-test"))))]
            real: self.real.expiration()?,
            #[cfg(any(test, feature = "native-test"))]
            deadline: self.expires_at,
        })
    }

    #[cfg(all(windows, not(any(test, feature = "native-test"))))]
    async fn model(&mut self, body: Value, cancel: &AtomicBool) -> Result<Vec<u8>> {
        self.real.model(body, cancel).await
    }

    #[cfg(any(test, feature = "native-test"))]
    async fn model(&mut self, _body: Value, cancel: &AtomicBool) -> Result<Vec<u8>> {
        #[cfg(test)]
        match &self.model_fixture {
            ModelFixture::Response => {}
            ModelFixture::Unauthorized => {
                self.invalidate();
                return Err(Error::new("codebuddy_auth_expired"));
            }
            ModelFixture::Blocked { started, release } => {
                started.notify_one();
                tokio::select! {
                    biased;
                    _ = wait_cancelled(cancel) => return Err(Error::new("cancelled")),
                    _ = release.notified() => {}
                }
            }
            ModelFixture::UnauthorizedAfterCancel { started } => {
                started.notify_one();
                wait_cancelled(cancel).await;
                self.invalidate();
                return Err(Error::new("codebuddy_auth_expired"));
            }
        }
        if cancel.load(Ordering::Acquire) {
            return Err(Error::new("cancelled"));
        }
        if self.is_expired() {
            return Err(Error::new("codebuddy_auth_expired"));
        }
        Ok(self.model_response.take().unwrap_or_else(|| {
            b"data: {\"id\":\"fixture\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"{\\\"ok\\\":true}\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n".to_vec()
        }))
    }

    #[cfg(all(not(windows), not(any(test, feature = "native-test"))))]
    async fn model(&mut self, _body: Value, _cancel: &AtomicBool) -> Result<Vec<u8>> {
        Err(Error::new("codebuddy_login_unsupported"))
    }

    fn is_expired(&self) -> bool {
        #[cfg(all(windows, not(any(test, feature = "native-test"))))]
        {
            self.real.is_expired()
        }
        #[cfg(any(test, feature = "native-test"))]
        {
            self.secret.is_empty() || Instant::now() >= self.expires_at
        }
        #[cfg(all(not(windows), not(any(test, feature = "native-test"))))]
        {
            true
        }
    }

    fn invalidate(&mut self) {
        #[cfg(all(windows, not(any(test, feature = "native-test"))))]
        self.real.invalidate();
        #[cfg(any(test, feature = "native-test"))]
        self.secret.clear();
    }
}

impl MemoryExpiry {
    fn is_expired(&self) -> bool {
        #[cfg(all(windows, not(any(test, feature = "native-test"))))]
        {
            self.real.is_expired()
        }
        #[cfg(any(test, feature = "native-test"))]
        {
            Instant::now() >= self.deadline
        }
        #[cfg(all(not(windows), not(any(test, feature = "native-test"))))]
        {
            true
        }
    }
}

impl ExecutionLease {
    #[cfg(any(test, feature = "native-test"))]
    pub(crate) async fn model(
        &mut self,
        body: Value,
        request_cancel: &AtomicBool,
    ) -> Result<Vec<u8>> {
        self.model_inner(body, request_cancel, None).await
    }

    #[cfg(any(test, not(feature = "native-test")))]
    pub(crate) async fn model_before(
        &mut self,
        body: Value,
        request_cancel: &AtomicBool,
        deadline: Instant,
    ) -> Result<Vec<u8>> {
        self.model_inner(body, request_cancel, Some(deadline)).await
    }

    async fn model_inner(
        &mut self,
        body: Value,
        request_cancel: &AtomicBool,
        deadline: Option<Instant>,
    ) -> Result<Vec<u8>> {
        if self.requested {
            return Err(Error::new("codebuddy_model_already_requested"));
        }
        self.requested = true;
        self.service.ensure_execution_current(self.revision)?;
        if let Some(reason) = model_stop_reason(&self.cancel, request_cancel, deadline) {
            return Err(Error::new(reason));
        }
        // 宿主清理和截止只中止本次HTTP；共享标记仅表达用户取消、注销或账户失效。
        let network_cancel = AtomicBool::new(false);
        self.in_flight = true;
        let (result, stopped) = {
            let session = self
                .session
                .as_mut()
                .ok_or_else(|| Error::new("codebuddy_login_not_ready"))?;
            let request = session.model(body, &network_cancel);
            tokio::pin!(request);
            tokio::select! {
                biased;
                reason = wait_model_stop(&self.cancel, request_cancel, deadline) => {
                    network_cancel.store(true, Ordering::Release);
                    // 让认证层观察取消并完成401失效锁存，避免丢弃future绕过会话清理。
                    (request.await, Some(reason))
                }
                result = &mut request => (result, None),
            }
        };
        self.in_flight = false;
        let mut state = self
            .service
            .inner
            .lock()
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?;
        if !state.owns_lease(self.revision, self.id) {
            return Err(Error::new("cancelled"));
        }
        let cancelled = self.cancel.load(Ordering::Acquire);
        let expired = self.session.as_ref().is_none_or(MemorySession::is_expired);
        if expired {
            state.clear(Phase::Expired)?;
            return Err(Error::new(if cancelled {
                "cancelled"
            } else {
                "codebuddy_auth_expired"
            }));
        }
        if let Some(reason) = model_stop_reason(&self.cancel, request_cancel, deadline).or(stopped)
        {
            return Err(Error::new(reason));
        }
        result
    }

    #[cfg(any(test, feature = "native-test"))]
    pub(crate) async fn model_fixture(
        &mut self,
        body: Value,
        response_sse: Vec<u8>,
        request_cancel: &AtomicBool,
    ) -> Result<Vec<u8>> {
        if self.requested {
            return Err(Error::new("codebuddy_model_already_requested"));
        }
        self.session
            .as_mut()
            .ok_or_else(|| Error::new("codebuddy_login_not_ready"))?
            .model_response = Some(response_sse);
        self.model(body, request_cancel).await
    }
}

fn model_stop_reason(
    task_cancel: &AtomicBool,
    request_cancel: &AtomicBool,
    deadline: Option<Instant>,
) -> Option<&'static str> {
    if task_cancel.load(Ordering::Acquire) {
        return Some("cancelled");
    }
    // 宿主截止时也会发出stop，保留截止原因以免正常超时显示成用户取消。
    if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
        return Some("timeout");
    }
    request_cancel
        .load(Ordering::Acquire)
        .then_some("cancelled")
}

async fn wait_model_stop(
    task_cancel: &AtomicBool,
    request_cancel: &AtomicBool,
    deadline: Option<Instant>,
) -> &'static str {
    loop {
        if let Some(reason) = model_stop_reason(task_cancel, request_cancel, deadline) {
            return reason;
        }
        let interval = deadline.map_or(CANCEL_INTERVAL, |deadline| {
            CANCEL_INTERVAL.min(deadline.saturating_duration_since(Instant::now()))
        });
        tokio::time::sleep(interval).await;
    }
}

impl Drop for ExecutionLease {
    fn drop(&mut self) {
        if let Some(watcher) = self.watcher.take() {
            watcher.abort();
        }
        let Some(mut session) = self.session.take() else {
            return;
        };
        // 被调用方直接丢弃的请求可能尚未完成401清理，不能把不确定会话归还。
        if self.in_flight {
            session.invalidate();
        }
        let Ok(mut state) = self.service.inner.lock() else {
            self.cancel.store(true, Ordering::Release);
            session.invalidate();
            return;
        };
        if !state.owns_lease(self.revision, self.id) {
            session.invalidate();
            return;
        }
        if session.is_expired() {
            session.invalidate();
            // Drop不能返回错误；即使revision耗尽，已失效账户也不会归还。
            if state.clear(Phase::Expired).is_err() {
                self.cancel.store(true, Ordering::Release);
                state.lease = None;
            }
        } else {
            state.lease = None;
            state.session = Some(session);
        }
    }
}

async fn watch_expiration(service: Weak<Login>, revision: u64, id: Uuid, cancel: Arc<AtomicBool>) {
    loop {
        tokio::time::sleep(CANCEL_INTERVAL).await;
        let Some(service) = service.upgrade() else {
            cancel.store(true, Ordering::Release);
            return;
        };
        let Ok(mut state) = service.inner.lock() else {
            cancel.store(true, Ordering::Release);
            return;
        };
        if !state.owns_lease(revision, id) || cancel.load(Ordering::Acquire) {
            return;
        }
        if state.refresh_expiration().is_err() {
            cancel.store(true, Ordering::Release);
            return;
        }
        if !state.owns_lease(revision, id) {
            return;
        }
    }
}

fn message_for(phase: Phase) -> &'static str {
    match phase {
        Phase::SignedOut => SIGNED_OUT_MESSAGE,
        Phase::Authenticating => PREPARING_MESSAGE,
        Phase::SignedIn => SIGNED_IN_MESSAGE,
        Phase::Expired => EXPIRED_MESSAGE,
        Phase::Failed => FAILED_MESSAGE,
        Phase::Cancelled => CANCELLED_MESSAGE,
    }
}

fn validate_login_url(value: &str) -> Result<()> {
    let invalid = || Error::new("codebuddy_login_url");
    if value.len() > MAX_LOGIN_URL_BYTES {
        return Err(invalid());
    }
    let query = value.strip_prefix(LOGIN_PREFIX).ok_or_else(invalid)?;
    let fields: Vec<_> = query.split('&').collect();
    if fields.len() != 2 {
        return Err(invalid());
    }
    let state = match fields.as_slice() {
        ["platform=CLI", state] | [state, "platform=CLI"] => {
            state.strip_prefix("state=").ok_or_else(invalid)?
        }
        _ => return Err(invalid()),
    };
    // auth 模块已将 state 绑定本次 challenge；此边界再次拒绝编码、附加参数与非官方页面。
    if state.is_empty()
        || state.len() > 256
        || !state
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(invalid());
    }
    Ok(())
}

fn require_active(attempt: &Attempt) -> Result<()> {
    if attempt.cancel.load(Ordering::Acquire) {
        return Err(Error::new("cancelled"));
    }
    Ok(())
}

async fn wait_cancelled(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Acquire) {
        tokio::time::sleep(CANCEL_INTERVAL).await;
    }
}

#[cfg(any(test, feature = "native-test"))]
fn open_browser(_url: &str) -> Result<()> {
    Ok(())
}

#[cfg(all(not(windows), not(any(test, feature = "native-test"))))]
fn open_browser(_url: &str) -> Result<()> {
    Err(Error::new("codebuddy_login_unsupported"))
}

#[cfg(all(windows, not(any(test, feature = "native-test"))))]
fn open_browser(url: &str) -> Result<()> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    // SAFETY: target 是已验证官方 URL 的 NUL 结尾 UTF-16，指针存活到同步调用结束；
    // 其余可选窗口、参数、工作目录均为空，固定 open 动词不经过命令行解释器。
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            windows_sys::w!("open"),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err(Error::new("codebuddy_login_browser"));
    }
    Ok(())
}

#[tauri::command]
pub async fn codebuddy_control(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<Login>>,
    request: Control,
) -> Result<Status> {
    authorize(&window)?;
    let service = state.inner().clone();
    if matches!(request, Control::OpenLogin {}) {
        let revision = service.status()?.revision;
        tauri::async_runtime::spawn_blocking(move || service.open_current(Some(revision)))
            .await
            .map_err(|_| Error::new("codebuddy_login_unavailable"))?
    } else {
        // 短状态转移在命令入口完成，避免线程池重排先登录、后取消两个操作。
        service.control(request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const FIXTURE_URL: &str = "https://copilot.tencent.com/login?platform=CLI&state=fixture-state";

    fn signed_in_service() -> (Arc<Login>, u64) {
        let service = Arc::new(Login::new());
        let attempt = service.start(0).unwrap();
        service.finish(&attempt, Ok(session())).unwrap();
        (service, attempt.revision)
    }

    #[test]
    fn execution_lease_requires_the_current_account_and_stays_exclusive_until_drop() {
        let empty = Arc::new(Login::new());
        assert_eq!(
            empty
                .lease(0, Arc::new(AtomicBool::new(false)))
                .err()
                .unwrap()
                .code,
            "codebuddy_login_not_ready"
        );
        let (service, revision) = signed_in_service();
        let cancelled = Arc::new(AtomicBool::new(true));
        assert_eq!(
            service.lease(revision, cancelled).err().unwrap().code,
            "cancelled"
        );
        assert_eq!(
            service
                .lease(revision - 1, Arc::new(AtomicBool::new(false)))
                .err()
                .unwrap()
                .code,
            "codebuddy_login_stale"
        );
        let lease = service
            .lease(revision, Arc::new(AtomicBool::new(false)))
            .unwrap();
        let execution = service.execution_status().unwrap();
        assert!(execution.signed_in);
        assert!(execution.busy);
        assert_eq!(execution.revision, revision);
        assert_eq!(service.status().unwrap().phase, Phase::SignedIn);
        assert!(!service.status().unwrap().busy);
        assert_eq!(
            service
                .lease(revision, Arc::new(AtomicBool::new(false)))
                .err()
                .unwrap()
                .code,
            "codebuddy_login_busy"
        );
        drop(lease);
        let execution = service.execution_status().unwrap();
        assert!(execution.signed_in);
        assert!(!execution.busy);
        assert_eq!(execution.revision, revision);
    }

    #[test]
    fn execution_lease_cancelled_by_the_task_returns_the_current_account() {
        let (service, revision) = signed_in_service();
        let cancel = Arc::new(AtomicBool::new(false));
        let lease = service.lease(revision, Arc::clone(&cancel)).unwrap();
        cancel.store(true, Ordering::Release);
        drop(lease);
        assert!(service.execution_status().unwrap().signed_in);
        assert!(service
            .lease(revision, Arc::new(AtomicBool::new(false)))
            .is_ok());
    }

    #[test]
    fn execution_lease_logout_and_new_login_cancel_old_ownership_without_restoring_it() {
        for next in [Phase::SignedOut, Phase::Authenticating] {
            let (service, revision) = signed_in_service();
            let cancel = Arc::new(AtomicBool::new(false));
            let lease = service.lease(revision, Arc::clone(&cancel)).unwrap();
            if next == Phase::SignedOut {
                service.clear(next).unwrap();
            } else {
                let attempt = service.start(revision).unwrap();
                let mut replacement = session();
                replacement.secret = "replacement-fixture".to_owned();
                service.finish(&attempt, Ok(replacement)).unwrap();
            }
            assert!(cancel.load(Ordering::Acquire));
            assert!(service.ensure_execution_current(revision).is_err());
            drop(lease);
            let state = service.inner.lock().unwrap();
            if next == Phase::SignedOut {
                assert!(state.session.is_none());
                assert_eq!(state.phase, Phase::SignedOut);
            } else {
                assert_eq!(
                    state.session.as_ref().unwrap().secret,
                    "replacement-fixture"
                );
                assert_eq!(state.phase, Phase::SignedIn);
            }
        }
    }

    #[test]
    fn execution_lease_status_expires_an_account_even_while_it_is_borrowed() {
        let (service, revision) = signed_in_service();
        let cancel = Arc::new(AtomicBool::new(false));
        let lease = service.lease(revision, Arc::clone(&cancel)).unwrap();
        service
            .inner
            .lock()
            .unwrap()
            .lease
            .as_mut()
            .unwrap()
            .expiration
            .deadline = Instant::now();
        assert_eq!(service.status().unwrap().phase, Phase::Expired);
        assert!(cancel.load(Ordering::Acquire));
        assert!(service.execution_status().unwrap().revision > revision);
        drop(lease);
        assert!(!service.execution_status().unwrap().signed_in);
    }

    #[test]
    fn execution_lease_expiration_watcher_cancels_without_a_status_poll() {
        let (service, revision) = signed_in_service();
        let cancel = Arc::new(AtomicBool::new(false));
        let mut lease = service.lease(revision, Arc::clone(&cancel)).unwrap();
        let watcher = lease.watcher.take().unwrap();
        service
            .inner
            .lock()
            .unwrap()
            .lease
            .as_mut()
            .unwrap()
            .expiration
            .deadline = Instant::now();
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(2), watcher)
                .await
                .unwrap()
                .unwrap();
        });
        assert!(cancel.load(Ordering::Acquire));
        assert_eq!(service.inner.lock().unwrap().phase, Phase::Expired);
        drop(lease);
    }

    #[test]
    fn execution_lease_expiration_watcher_exits_after_an_unused_lease_is_returned() {
        let (service, revision) = signed_in_service();
        let mut lease = service
            .lease(revision, Arc::new(AtomicBool::new(false)))
            .unwrap();
        let watcher = lease.watcher.take().unwrap();
        drop(lease);
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(2), watcher)
                .await
                .unwrap()
                .unwrap();
        });
        assert!(service.execution_status().unwrap().signed_in);
        assert!(!service.execution_status().unwrap().busy);
    }

    #[test]
    fn execution_lease_does_not_return_a_session_after_its_request_future_is_abandoned() {
        let (service, revision) = signed_in_service();
        let started = Arc::new(tokio::sync::Notify::new());
        service
            .inner
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .model_fixture = ModelFixture::Blocked {
            started: Arc::clone(&started),
            release: Arc::new(tokio::sync::Notify::new()),
        };
        let mut lease = service
            .lease(revision, Arc::new(AtomicBool::new(false)))
            .unwrap();
        tauri::async_runtime::block_on(async {
            let request_cancel = AtomicBool::new(false);
            let request = lease.model(json!({}), &request_cancel);
            tokio::pin!(request);
            tokio::select! {
                _ = started.notified() => {},
                result = &mut request => panic!("unexpected completion: {result:?}"),
                _ = tokio::time::sleep(Duration::from_secs(2)) => panic!("fixture did not start"),
            }
        });
        drop(lease);
        assert_eq!(service.status().unwrap().phase, Phase::Expired);
    }

    #[test]
    fn execution_lease_model_is_single_use_and_keeps_ownership_after_http_completes() {
        let (service, revision) = signed_in_service();
        let mut lease = service
            .lease(revision, Arc::new(AtomicBool::new(false)))
            .unwrap();
        tauri::async_runtime::block_on(async {
            let cancel = AtomicBool::new(false);
            let result = lease
                .model_fixture(json!({}), b"synthetic-sse".to_vec(), &cancel)
                .await
                .unwrap();
            assert_eq!(result, b"synthetic-sse");
            assert!(service.execution_status().unwrap().busy);
            assert_eq!(
                lease
                    .model_fixture(json!({}), Vec::new(), &cancel)
                    .await
                    .unwrap_err()
                    .code,
                "codebuddy_model_already_requested"
            );
        });
        drop(lease);
        assert!(!service.execution_status().unwrap().busy);
    }

    #[test]
    fn execution_lease_unauthorized_response_expires_the_account() {
        let (service, revision) = signed_in_service();
        service
            .inner
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .model_fixture = ModelFixture::Unauthorized;
        let mut lease = service
            .lease(revision, Arc::new(AtomicBool::new(false)))
            .unwrap();
        let result =
            tauri::async_runtime::block_on(lease.model(json!({}), &AtomicBool::new(false)));
        assert_eq!(result.unwrap_err().code, "codebuddy_auth_expired");
        assert_eq!(service.status().unwrap().phase, Phase::Expired);
        drop(lease);
        assert!(!service.execution_status().unwrap().signed_in);
    }

    #[test]
    fn execution_lease_network_wait_does_not_block_logout_or_accept_a_late_result() {
        let (service, revision) = signed_in_service();
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        service
            .inner
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .model_fixture = ModelFixture::Blocked {
            started: Arc::clone(&started),
            release: Arc::clone(&release),
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let mut lease = service.lease(revision, Arc::clone(&cancel)).unwrap();
        tauri::async_runtime::block_on(async {
            let pending = tauri::async_runtime::spawn(async move {
                lease.model(json!({}), &AtomicBool::new(false)).await
            });
            tokio::time::timeout(Duration::from_secs(2), started.notified())
                .await
                .unwrap();
            let cleared = service.clear(Phase::SignedOut).unwrap();
            assert_eq!(cleared.phase, Phase::SignedOut);
            assert!(cancel.load(Ordering::Acquire));
            release.notify_one();
            let result = tokio::time::timeout(Duration::from_secs(2), pending)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(result.unwrap_err().code, "cancelled");
        });
        assert!(!service.execution_status().unwrap().signed_in);
    }

    #[test]
    fn execution_lease_host_stop_aborts_http_without_cancelling_the_shared_task() {
        let (service, revision) = signed_in_service();
        let started = Arc::new(tokio::sync::Notify::new());
        service
            .inner
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .model_fixture = ModelFixture::Blocked {
            started: Arc::clone(&started),
            release: Arc::new(tokio::sync::Notify::new()),
        };
        let task_cancel = Arc::new(AtomicBool::new(false));
        let request_cancel = Arc::new(AtomicBool::new(false));
        let observed_stop = Arc::clone(&request_cancel);
        let mut lease = service.lease(revision, Arc::clone(&task_cancel)).unwrap();
        tauri::async_runtime::block_on(async {
            let pending =
                tauri::async_runtime::spawn(
                    async move { lease.model(json!({}), &observed_stop).await },
                );
            tokio::time::timeout(Duration::from_secs(2), started.notified())
                .await
                .unwrap();
            request_cancel.store(true, Ordering::Release);
            let result = tokio::time::timeout(Duration::from_secs(2), pending)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(result.unwrap_err().code, "cancelled");
        });
        assert!(!task_cancel.load(Ordering::Acquire));
        assert!(service.execution_status().unwrap().signed_in);
        assert!(!service.execution_status().unwrap().busy);
    }

    #[test]
    fn execution_lease_deadline_aborts_http_without_cancelling_the_shared_task() {
        let (service, revision) = signed_in_service();
        let started = Arc::new(tokio::sync::Notify::new());
        service
            .inner
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .model_fixture = ModelFixture::Blocked {
            started: Arc::clone(&started),
            release: Arc::new(tokio::sync::Notify::new()),
        };
        let task_cancel = Arc::new(AtomicBool::new(false));
        let mut lease = service.lease(revision, Arc::clone(&task_cancel)).unwrap();
        tauri::async_runtime::block_on(async {
            let request_cancel = AtomicBool::new(false);
            let request = lease.model_before(
                json!({}),
                &request_cancel,
                Instant::now() + Duration::from_millis(100),
            );
            tokio::pin!(request);
            tokio::select! {
                _ = started.notified() => {},
                result = &mut request => panic!("unexpected completion: {result:?}"),
                _ = tokio::time::sleep(Duration::from_secs(2)) => panic!("fixture did not start"),
            }
            let result = tokio::time::timeout(Duration::from_secs(2), request)
                .await
                .unwrap();
            assert_eq!(result.unwrap_err().code, "timeout");
        });
        assert!(!task_cancel.load(Ordering::Acquire));
        assert!(service.execution_status().unwrap().busy);
        drop(lease);
        let status = service.execution_status().unwrap();
        assert!(status.signed_in);
        assert!(!status.busy);
        assert_eq!(status.revision, revision);
    }

    #[test]
    fn execution_lease_elapsed_deadline_prevents_starting_http() {
        let (service, revision) = signed_in_service();
        service
            .inner
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .model_fixture = ModelFixture::Unauthorized;
        let task_cancel = Arc::new(AtomicBool::new(false));
        let mut lease = service.lease(revision, Arc::clone(&task_cancel)).unwrap();
        let result = tauri::async_runtime::block_on(lease.model_before(
            json!({}),
            &AtomicBool::new(false),
            Instant::now(),
        ));
        assert_eq!(result.unwrap_err().code, "timeout");
        assert!(!task_cancel.load(Ordering::Acquire));
        drop(lease);
        assert!(service.execution_status().unwrap().signed_in);
    }

    #[test]
    fn execution_lease_host_stop_waits_for_unauthorized_session_invalidation() {
        let (service, revision) = signed_in_service();
        let started = Arc::new(tokio::sync::Notify::new());
        service
            .inner
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .model_fixture = ModelFixture::UnauthorizedAfterCancel {
            started: Arc::clone(&started),
        };
        let request_cancel = Arc::new(AtomicBool::new(false));
        let observed_stop = Arc::clone(&request_cancel);
        let mut lease = service
            .lease(revision, Arc::new(AtomicBool::new(false)))
            .unwrap();
        tauri::async_runtime::block_on(async {
            let pending =
                tauri::async_runtime::spawn(
                    async move { lease.model(json!({}), &observed_stop).await },
                );
            tokio::time::timeout(Duration::from_secs(2), started.notified())
                .await
                .unwrap();
            request_cancel.store(true, Ordering::Release);
            assert!(tokio::time::timeout(Duration::from_secs(2), pending)
                .await
                .unwrap()
                .unwrap()
                .is_err());
        });
        assert_eq!(service.status().unwrap().phase, Phase::Expired);
        assert!(!service.execution_status().unwrap().signed_in);
    }

    #[test]
    fn a_login_delivered_after_cancel_cannot_start_a_new_attempt() {
        let service = Arc::new(Login::new());
        let pending_login = Control::Login {
            revision: service.status().unwrap().revision,
        };
        let cancelled = service.control(Control::Cancel {}).unwrap();
        assert!(service.control(pending_login).is_err());
        let status = service.status().unwrap();
        assert_eq!(status.revision, cancelled.revision);
        assert_eq!(status.phase, Phase::Cancelled);
        assert!(status.login_url.is_empty());
        assert!(service.inner.lock().unwrap().cancel.is_none());
    }

    #[test]
    fn a_blocked_browser_dispatch_does_not_delay_cancel_or_logout() {
        use std::sync::mpsc;
        for phase in [Phase::Cancelled, Phase::SignedOut] {
            let service = Arc::new(Login::new());
            let attempt = service.start(0).unwrap();
            service.publish_challenge(&attempt, FIXTURE_URL).unwrap();
            let (started_tx, started_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let opening = Arc::clone(&service);
            let opener = std::thread::spawn(move || {
                opening.open_current_with(None, |_| {
                    started_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok(())
                })
            });
            started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            let (cleared_tx, cleared_rx) = mpsc::channel();
            let clearing = Arc::clone(&service);
            let clearer =
                std::thread::spawn(move || cleared_tx.send(clearing.clear(phase)).unwrap());
            let result = cleared_rx.recv_timeout(Duration::from_millis(500));
            release_tx.send(()).unwrap();
            opener.join().unwrap().unwrap();
            clearer.join().unwrap();
            assert!(result.is_ok(), "browser dispatch blocked cancellation");
            let status = service.status().unwrap();
            assert_eq!(status.phase, phase);
            assert!(!status.browser_opened);
            assert!(status.login_url.is_empty());
            assert!(attempt.cancel.load(Ordering::Acquire));
        }
    }

    #[test]
    fn challenge_timeout_is_expired_and_browser_failure_remains_retryable() {
        let service = Login::new();
        let attempt = service.start(0).unwrap();
        service.publish_challenge(&attempt, FIXTURE_URL).unwrap();
        let status = service
            .open_current_with(None, |_| Err(Error::new("fixture_browser")))
            .unwrap();
        assert_eq!(status.phase, Phase::Authenticating);
        assert_eq!(status.message, OPEN_FAILED_MESSAGE);
        assert!(!status.browser_opened);
        assert_eq!(status.login_url, FIXTURE_URL);
        assert!(service.open_current(None).unwrap().browser_opened);
        service
            .finish(&attempt, Err(Error::new("timeout")))
            .unwrap();
        assert_eq!(service.status().unwrap().phase, Phase::Expired);
    }

    #[test]
    fn synthetic_login_returns_pending_then_completes_without_network_or_browser() {
        let service = Arc::new(Login::new());
        assert_eq!(
            service
                .control(Control::Login { revision: 0 })
                .unwrap()
                .phase,
            Phase::Authenticating
        );
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(service.status().unwrap().phase, Phase::Authenticating);
        let deadline = Instant::now() + Duration::from_secs(3);
        while service.status().unwrap().busy && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(service.status().unwrap().phase, Phase::SignedIn);
        assert_eq!(
            service.control(Control::Logout {}).unwrap().phase,
            Phase::SignedOut
        );
    }

    #[test]
    fn cancelling_synthetic_background_login_cannot_resurrect_it() {
        let service = Arc::new(Login::new());
        service.control(Control::Login { revision: 0 }).unwrap();
        let cancelled = service.control(Control::Cancel {}).unwrap();
        std::thread::sleep(Duration::from_millis(800));
        let status = service.status().unwrap();
        assert_eq!(status.revision, cancelled.revision);
        assert_eq!(status.phase, Phase::Cancelled);
        assert!(!status.busy);
        assert!(status.login_url.is_empty());
    }

    fn session() -> MemorySession {
        MemorySession {
            expires_at: Instant::now() + Duration::from_secs(60),
            secret: "fixture-private-access-token".to_owned(),
            model_response: None,
            model_fixture: ModelFixture::Response,
        }
    }

    #[test]
    fn starts_signed_out_and_serializes_only_the_declared_status_fields() {
        let service = Login::new();
        let status = serde_json::to_value(service.status().unwrap()).unwrap();
        assert_eq!(
            status,
            json!({"phase":"signed_out","revision":0,"loginUrl":"","message":SIGNED_OUT_MESSAGE,"browserOpened":false,"busy":false})
        );
    }

    #[test]
    fn ipc_rejects_unknown_actions_extra_fields_urls_and_tokens() {
        for request in [
            json!({"kind":"login","revision":0,"url":"https://example.invalid"}),
            json!({"kind":"login"}),
            json!({"kind":"login","revision":"0"}),
            json!({"kind":"status","token":"fixture-secret"}),
            json!({"kind":"model"}),
            json!({"kind":"open_login","revision":1}),
            json!({"kind":"logout","path":"C:/fixture"}),
        ] {
            assert!(serde_json::from_value::<Control>(request).is_err());
        }
        for kind in ["status", "open_login", "cancel", "logout"] {
            assert!(serde_json::from_value::<Control>(json!({"kind":kind})).is_ok());
        }
        assert!(serde_json::from_value::<Control>(json!({"kind":"login","revision":0})).is_ok());
    }

    #[test]
    fn cancellation_and_logout_prevent_late_credentials_or_browser_opens() {
        for phase in [Phase::Cancelled, Phase::SignedOut] {
            let service = Login::new();
            let attempt = service.start(0).unwrap();
            service.publish_challenge(&attempt, FIXTURE_URL).unwrap();
            let cancelled = service.clear(phase).unwrap();
            assert!(attempt.cancel.load(Ordering::Acquire));
            assert!(cancelled.revision > attempt.revision);
            service.finish(&attempt, Ok(session())).unwrap();
            assert!(!service.publish_challenge(&attempt, FIXTURE_URL).unwrap());
            assert!(service.open_current(Some(attempt.revision)).is_err());
            let current = service.status().unwrap();
            assert_eq!(current.phase, phase);
            assert!(current.login_url.is_empty());
            assert!(!current.busy);
            assert!(service.inner.lock().unwrap().session.is_none());
        }
    }

    #[test]
    fn a_new_login_owns_its_result_and_old_failure_cannot_replace_it() {
        let service = Login::new();
        let old = service.start(0).unwrap();
        let current = service.start(old.revision).unwrap();
        assert!(old.cancel.load(Ordering::Acquire));
        service.publish_challenge(&current, FIXTURE_URL).unwrap();
        service.finish(&current, Ok(session())).unwrap();
        service
            .finish(&old, Err(Error::new("codebuddy_auth_network")))
            .unwrap();
        let status = service.status().unwrap();
        assert_eq!(status.phase, Phase::SignedIn);
        assert_eq!(status.revision, current.revision);
        assert!(status.login_url.is_empty());
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            json!({"phase":"signed_in","revision":current.revision,"loginUrl":"","message":SIGNED_IN_MESSAGE,"browserOpened":false,"busy":false})
        );
        let serialized = serde_json::to_string(&status).unwrap();
        for forbidden in [
            "accessToken",
            "nickname",
            "uid",
            "fixture-private",
            "state=",
            "token",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn status_discards_expired_memory_session_and_restart_has_no_identity() {
        let service = Login::new();
        let attempt = service.start(0).unwrap();
        service.finish(&attempt, Ok(session())).unwrap();
        service
            .inner
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .expires_at = Instant::now();
        let expired = service.status().unwrap();
        assert_eq!(expired.phase, Phase::Expired);
        assert!(expired.revision > attempt.revision);
        assert!(service.inner.lock().unwrap().session.is_none());
        assert_eq!(Login::new().status().unwrap().phase, Phase::SignedOut);
    }

    #[test]
    fn startup_failure_has_a_fixed_message_and_clears_pending_state() {
        let service = Login::new();
        let attempt = service.start(0).unwrap();
        service
            .finish(&attempt, Err(Error::new("codebuddy_auth_network")))
            .unwrap();
        let status = service.status().unwrap();
        assert_eq!(status.phase, Phase::Failed);
        assert_eq!(status.message, FAILED_MESSAGE);
        assert!(!status.busy);
        assert!(status.login_url.is_empty());
    }

    #[test]
    fn only_the_current_verified_login_page_can_be_opened() {
        let service = Login::new();
        assert!(service.open_current(None).is_err());
        let attempt = service.start(0).unwrap();
        for url in [
            "https://example.invalid/login",
            "file:///C:/fixture",
            "https://copilot.tencent.com/login?platform=CLI&state=x&extra=1",
        ] {
            assert!(service.publish_challenge(&attempt, url).is_err());
        }
        service.publish_challenge(&attempt, FIXTURE_URL).unwrap();
        assert!(service.open_current(None).unwrap().browser_opened);
        let value: Value = serde_json::to_value(service.status().unwrap()).unwrap();
        assert_eq!(value["loginUrl"], FIXTURE_URL);
    }
}
