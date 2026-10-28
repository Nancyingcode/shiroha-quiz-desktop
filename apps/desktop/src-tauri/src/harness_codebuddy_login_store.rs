use super::{Attempt, Inner, Login, MemorySession, Phase, Status};
use crate::error::{Error, Result};
#[cfg(any(test, feature = "native-test"))]
use crate::harness_codebuddy_store::now_ms;
use crate::harness_codebuddy_store::{SavedSession, Store};
use serde::Serialize;
use std::path::Path;
use std::sync::{atomic::AtomicBool, mpsc, Arc, Weak};
#[cfg(any(test, feature = "native-test"))]
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum PersistenceState {
    None,
    Saving,
    Saved,
    Clearing,
    CleanupRequired,
    Error,
}

// 队列仅在进程内携带秘密；单一线程持有 Store，退出时通道关闭并释放数据根锁。
pub(super) enum Job {
    Load(Attempt),
    Save { revision: u64, secret: SavedSession },
    Revoke { revision: u64 },
    MarkRevoked(tokio::sync::oneshot::Sender<Result<()>>),
}

impl Login {
    pub fn open(root: &Path) -> Arc<Self> {
        let root = root.to_owned();
        Self::with_store(root.clone(), move || Store::open(&root))
    }

    #[cfg(test)]
    pub(super) fn open_with_provider(
        root: &Path,
        provider: impl crate::credentials::Provider + Clone + 'static,
    ) -> Arc<Self> {
        let root = root.to_owned();
        Self::with_store(root.clone(), move || {
            Store::open_with(&root, provider.clone())
        })
    }

    fn with_store(
        root: std::path::PathBuf,
        open: impl FnMut() -> Result<Store> + Send + 'static,
    ) -> Arc<Self> {
        let mut login = Self::new();
        login.root = Some(root);
        let (sender, receiver) = mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(state) = login.inner.get_mut() {
            state.store = Some(sender.clone());
            state.phase = Phase::Restoring;
            state.cancel = Some(cancel.clone());
        }
        let service = Arc::new(login);
        let weak = Arc::downgrade(&service);
        match std::thread::Builder::new()
            .name("codebuddy-account-store".into())
            .spawn(move || run_store(weak, receiver, open))
        {
            Ok(worker) => {
                if let Ok(mut slot) = service.worker.lock() {
                    *slot = Some(worker);
                }
                if sender
                    .send(Job::Load(Attempt {
                        revision: 0,
                        cancel,
                    }))
                    .is_err()
                {
                    service.store_failed(0, "codebuddy_store_unavailable");
                }
            }
            Err(_) => service.store_failed(0, "codebuddy_store_unavailable"),
        }
        service
    }

    #[cfg(test)]
    pub(super) fn close_store_for_test(&self) {
        self.inner.lock().unwrap().store = None;
        if let Some(worker) = self.worker.lock().unwrap().take() {
            worker.join().unwrap();
        }
    }

    pub(crate) async fn invalidate_for_restore(self: &Arc<Self>) -> Result<()> {
        if self.root.is_some() {
            let (completion, confirmed) = tokio::sync::oneshot::channel();
            self.inner
                .lock()
                .map_err(|_| unavailable())?
                .send(Job::MarkRevoked(completion))?;
            confirmed.await.map_err(|_| unavailable())??;
        }
        // 题库恢复不依赖凭据物理删除成功；持久撤销标记与内存屏障已覆盖重启。
        let mut state = self.inner.lock().map_err(|_| unavailable())?;
        let result = state.clear(Phase::SignedOut);
        let deferred_cleanup = self.root.is_some()
            && result
                .as_ref()
                .is_err_and(|error| error.code == "codebuddy_store_unavailable");
        if deferred_cleanup {
            Ok(())
        } else {
            result
        }
    }

    pub(super) fn start_remembered(&self, revision: u64, remember: bool) -> Result<Attempt> {
        let mut state = self.inner.lock().map_err(|_| unavailable())?;
        if state.revision != revision {
            return Err(Error::new("codebuddy_login_stale"));
        }
        if state.busy()
            || state.phase == Phase::SignedIn
            || state.persistence_state != PersistenceState::None
        {
            return Err(Error::new("codebuddy_login_busy"));
        }
        state.clear(Phase::Authenticating)?;
        state.remember_login = remember;
        let cancel = Arc::new(AtomicBool::new(false));
        state.cancel = Some(cancel.clone());
        Ok(Attempt {
            revision: state.revision,
            cancel,
        })
    }

    pub(super) fn set_remember(&self, revision: u64, remember: bool) -> Result<Status> {
        let mut state = self.inner.lock().map_err(|_| unavailable())?;
        if state.revision != revision {
            return Err(Error::new("codebuddy_login_stale"));
        }
        let retry_cleanup = !remember
            && state.persistence_state == PersistenceState::CleanupRequired
            && state.phase == Phase::SignedIn;
        if !retry_cleanup && (state.busy() || !state.has_account()) {
            return Err(Error::new("codebuddy_login_busy"));
        }
        if remember && state.persistence_state == PersistenceState::Saved {
            return Ok(state.snapshot());
        }
        state.revision = state.revision.checked_add(1).ok_or_else(unavailable)?;
        state.remember_login = remember;
        if remember {
            state.schedule_save()?;
        } else {
            state.schedule_revoke()?;
        }
        Ok(state.snapshot())
    }

    pub(super) fn retry_restore(&self, revision: u64) -> Result<Status> {
        let mut state = self.inner.lock().map_err(|_| unavailable())?;
        if state.revision != revision {
            return Err(Error::new("codebuddy_login_stale"));
        }
        if state.busy() || !matches!(state.phase, Phase::Failed | Phase::Cancelled) {
            return Err(Error::new("codebuddy_login_not_ready"));
        }
        state.revision = state.revision.checked_add(1).ok_or_else(unavailable)?;
        state.phase = Phase::Restoring;
        state.persistence_error_code = None;
        let cancel = Arc::new(AtomicBool::new(false));
        state.cancel = Some(cancel.clone());
        let revision = state.revision;
        state.send(Job::Load(Attempt { revision, cancel }))?;
        Ok(state.snapshot())
    }

    fn store_failed(&self, revision: u64, code: &'static str) {
        if let Ok(mut state) = self.inner.lock() {
            if state.revision != revision {
                return;
            }
            state.phase = Phase::Failed;
            state.cancel = None;
            state.persistence_state = PersistenceState::Error;
            state.persistence_error_code = Some(store_code(code));
        }
    }

    fn loaded(self: &Arc<Self>, attempt: Attempt, loaded: Result<Option<SavedSession>>) {
        let mut state = match self.inner.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        if !restore_current(&state, &attempt) {
            return;
        }
        match loaded {
            Ok(None) => {
                state.phase = Phase::SignedOut;
                state.message = super::SIGNED_OUT_MESSAGE;
                state.persistence_state = PersistenceState::None;
                state.remember_login = false;
                state.cancel = None;
            }
            Ok(Some(secret)) => {
                state.remember_login = true;
                state.persistence_state = PersistenceState::Saved;
                let service = self.clone();
                tauri::async_runtime::spawn(async move {
                    let result = MemorySession::restore(secret, &attempt.cancel).await;
                    service.restored(&attempt, result);
                });
            }
            Err(error) => {
                state.cancel = None;
                state.phase = Phase::Failed;
                state.persistence_state = PersistenceState::CleanupRequired;
                state.persistence_error_code = Some(store_code(error.code));
                if error.code == "codebuddy_auth_expired" {
                    // 已知过期必须撤销；读取错误不能被误报为成功退出。
                    let _ = state.clear(Phase::Expired);
                }
            }
        }
    }

    fn restored(&self, attempt: &Attempt, result: Result<MemorySession>) {
        let mut state = match self.inner.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        if !restore_current(&state, attempt) {
            return;
        }
        state.cancel = None;
        match result {
            Ok(session) if !session.is_expired() => {
                state.session = Some(session);
                state.phase = Phase::SignedIn;
                state.message = super::SIGNED_IN_MESSAGE;
            }
            Ok(_) => {
                let _ = state.clear(Phase::Expired);
            }
            Err(error)
                if matches!(
                    error.code,
                    "codebuddy_auth_expired" | "codebuddy_auth_personal_required"
                ) =>
            {
                let _ = state.clear(Phase::Expired);
            }
            Err(_) => {
                state.phase = Phase::Failed;
                state.message = "暂时无法核验已保存的 CodeBuddy 登录，请重试恢复或退出登录。";
            }
        }
    }
}

fn restore_current(state: &Inner, attempt: &Attempt) -> bool {
    state.phase == Phase::Restoring
        && state.revision == attempt.revision
        && !attempt.cancel.load(std::sync::atomic::Ordering::Acquire)
}

fn unavailable() -> Error {
    Error::new("codebuddy_store_unavailable")
}

fn store_code(code: &str) -> &'static str {
    match code {
        "codebuddy_store_invalid" => "codebuddy_store_invalid",
        "codebuddy_store_in_use" => "codebuddy_store_in_use",
        _ => "codebuddy_store_unavailable",
    }
}

fn run_store(
    service: Weak<Login>,
    receiver: mpsc::Receiver<Job>,
    mut open: impl FnMut() -> Result<Store>,
) {
    let mut store = open();
    while let Ok(job) = receiver.recv() {
        let Some(service) = service.upgrade() else {
            return;
        };
        if store.is_err() {
            store = open();
        }
        match job {
            Job::MarkRevoked(completion) => {
                // 锁所有权由存储线程确认，不能依据可能已过时的界面错误码写撤销标记。
                let result = service
                    .root
                    .as_ref()
                    .ok_or_else(unavailable)
                    .and_then(|root| {
                        if store.is_ok() {
                            Store::mark_revoked(root)
                        } else {
                            Store::mark_revoked_without_store(root)
                        }
                    });
                let _ = completion.send(result);
            }
            Job::Load(attempt) => {
                if let Err(error) = &store {
                    service.store_failed(attempt.revision, error.code);
                    continue;
                }
                let loaded = store
                    .as_mut()
                    .map_err(|_| unavailable())
                    .and_then(Store::load);
                service.loaded(attempt, loaded);
            }
            Job::Save { revision, secret } => {
                if !saving_current(&service, revision) {
                    continue;
                }
                let result = (|| {
                    let store = store.as_mut().map_err(|_| unavailable())?;
                    let prepared = store.stage(&secret)?;
                    if !saving_current(&service, revision) {
                        store.cleanup()?;
                        return Err(Error::new("codebuddy_login_stale"));
                    }
                    store.commit(&prepared)?;
                    // 撤销可能在持久提交期间到达；串行清理完成前绝不向界面发布成功。
                    if !saving_current(&service, revision) {
                        store.revoke()?;
                        return Err(Error::new("codebuddy_login_stale"));
                    }
                    Ok(())
                })();
                let cleanup_failed = result.is_err()
                    && store
                        .as_mut()
                        .map_or(true, |store| store.cleanup().is_err());
                if let Ok(mut state) = service.inner.lock() {
                    if state.revision != revision {
                        continue;
                    }
                    state.persistence_state = if result.is_ok() {
                        PersistenceState::Saved
                    } else if cleanup_failed {
                        PersistenceState::CleanupRequired
                    } else {
                        PersistenceState::Error
                    };
                    state.persistence_error_code = result.err().map(|error| store_code(error.code));
                }
            }
            Job::Revoke { revision } => {
                let current = service.inner.lock().is_ok_and(|state| {
                    state.revision == revision
                        && state.persistence_state == PersistenceState::Clearing
                });
                if !current {
                    continue;
                }
                let result = match &mut store {
                    Ok(store) => store.revoke(),
                    Err(error) => {
                        if error.code != "codebuddy_store_in_use" {
                            if let Some(root) = &service.root {
                                // 即使 sidecar 损坏也保留撤销意图；不能因此报告物理清理完成。
                                let _ = Store::mark_revoked_without_store(root);
                            }
                        }
                        Err(Error::new(store_code(error.code)))
                    }
                };
                if let Ok(mut state) = service.inner.lock() {
                    if state.revision != revision {
                        continue;
                    }
                    state.persistence_state = if result.is_ok() {
                        PersistenceState::None
                    } else {
                        PersistenceState::CleanupRequired
                    };
                    state.persistence_error_code = result.err().map(|error| store_code(error.code));
                }
            }
        }
    }
}

fn saving_current(service: &Login, revision: u64) -> bool {
    service.inner.lock().is_ok_and(|state| {
        state.revision == revision
            && state.remember_login
            && state.persistence_state == PersistenceState::Saving
    })
}

impl Inner {
    pub(super) fn storage_blocked(&self) -> bool {
        matches!(
            self.persistence_state,
            PersistenceState::Saving
                | PersistenceState::Clearing
                | PersistenceState::CleanupRequired
        )
    }
    pub(super) fn busy(&self) -> bool {
        self.operation_busy() || self.persistence_state == PersistenceState::CleanupRequired
    }
    pub(super) fn operation_busy(&self) -> bool {
        // 清理失败仍拒绝本账户执行，但不把其他提供方永久锁在繁忙状态。
        matches!(self.phase, Phase::Authenticating | Phase::Restoring)
            || matches!(
                self.persistence_state,
                PersistenceState::Saving | PersistenceState::Clearing
            )
            || self.lease.is_some()
    }
    fn send(&mut self, job: Job) -> Result<()> {
        if self
            .store
            .as_ref()
            .is_none_or(|sender| sender.send(job).is_err())
        {
            self.persistence_state = PersistenceState::CleanupRequired;
            self.persistence_error_code = Some("codebuddy_store_unavailable");
            return Err(unavailable());
        }
        Ok(())
    }
    pub(super) fn schedule_save(&mut self) -> Result<()> {
        let secret = self.session.as_ref().ok_or_else(unavailable)?.saved()?;
        self.persistence_state = PersistenceState::Saving;
        self.persistence_error_code = None;
        self.send(Job::Save {
            revision: self.revision,
            secret,
        })
    }
    pub(super) fn schedule_revoke(&mut self) -> Result<()> {
        self.remember_login = false;
        self.persistence_state = PersistenceState::Clearing;
        self.persistence_error_code = None;
        self.send(Job::Revoke {
            revision: self.revision,
        })
    }
    pub(super) fn persistence_message(&self) -> &'static str {
        match self.persistence_state {
            PersistenceState::Saving => "已登录，正在保存 CodeBuddy 登录状态…",
            PersistenceState::Clearing => "正在清理此设备保存的 CodeBuddy 登录状态…",
            PersistenceState::CleanupRequired => "清理尚未完成，账户操作已暂停，请重试退出登录。",
            PersistenceState::Error if self.session.is_some() => {
                "已登录，但未能保存，下次启动需重新登录。请重试保存或关闭记住登录。"
            }
            PersistenceState::Error => {
                "无法读取此设备的 CodeBuddy 登录存储，请重试恢复或退出清理。"
            }
            PersistenceState::Saved if self.phase == Phase::SignedIn => {
                "CodeBuddy 已登录，已在此设备记住。"
            }
            _ if self.phase == Phase::Restoring => "正在恢复 CodeBuddy 登录…",
            _ if self.phase == Phase::SignedIn => "CodeBuddy 已登录，仅本次使用。",
            _ => self.message,
        }
    }
}

impl MemorySession {
    fn saved(&self) -> Result<SavedSession> {
        #[cfg(all(windows, not(any(test, feature = "native-test"))))]
        {
            self.real.saved()
        }
        #[cfg(any(test, feature = "native-test"))]
        {
            if self.is_expired() {
                return Err(Error::new("codebuddy_auth_expired"));
            }
            let now = now_ms()?;
            let remaining = u64::try_from(
                self.expires_at
                    .saturating_duration_since(Instant::now())
                    .as_millis(),
            )
            .map_err(|_| unavailable())?;
            Ok(SavedSession {
                access_token: self.secret.clone(),
                uid: "synthetic-user".into(),
                domain: "copilot.tencent.com".into(),
                expires_at_ms: now.checked_add(remaining).ok_or_else(unavailable)?,
                saved_at_ms: now,
            })
        }
        #[cfg(all(not(windows), not(any(test, feature = "native-test"))))]
        {
            Err(unavailable())
        }
    }

    async fn restore(secret: SavedSession, cancel: &AtomicBool) -> Result<Self> {
        #[cfg(all(windows, not(any(test, feature = "native-test"))))]
        {
            Ok(Self {
                real: crate::harness_codebuddy_auth::Client::new()?
                    .restore(secret, cancel)
                    .await?,
            })
        }
        #[cfg(any(test, feature = "native-test"))]
        {
            secret.validate()?;
            if cancel.load(std::sync::atomic::Ordering::Acquire) {
                return Err(Error::new("cancelled"));
            }
            if secret.uid != "synthetic-user" || secret.access_token != "synthetic-memory-session" {
                return Err(Error::new("codebuddy_auth_personal_required"));
            }
            let remaining = secret
                .expires_at_ms
                .checked_sub(now_ms()?)
                .ok_or_else(unavailable)?;
            Ok(Self {
                expires_at: Instant::now()
                    .checked_add(Duration::from_millis(remaining))
                    .ok_or_else(unavailable)?,
                secret: secret.access_token,
                model_response: None,
                #[cfg(test)]
                model_fixture: super::ModelFixture::Response,
            })
        }
        #[cfg(all(not(windows), not(any(test, feature = "native-test"))))]
        {
            let _ = (secret, cancel);
            Err(unavailable())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    fn restoring() -> (Arc<Login>, Attempt, mpsc::Receiver<Job>) {
        let login = Arc::new(Login::new());
        let (sender, receiver) = mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut state = login.inner.lock().unwrap();
            state.phase = Phase::Restoring;
            state.remember_login = true;
            state.persistence_state = PersistenceState::Saved;
            state.cancel = Some(cancel.clone());
            state.store = Some(sender);
        }
        (
            login,
            Attempt {
                revision: 0,
                cancel,
            },
            receiver,
        )
    }

    fn session() -> MemorySession {
        MemorySession {
            expires_at: Instant::now() + Duration::from_secs(60),
            secret: "synthetic-memory-session".into(),
            model_response: None,
            model_fixture: super::super::ModelFixture::Response,
        }
    }

    #[test]
    fn restore_completion_after_cancel_or_logout_cannot_publish_an_account() {
        for phase in [Phase::Cancelled, Phase::SignedOut] {
            let (login, attempt, _receiver) = restoring();
            let cleared = login.clear(phase).unwrap();
            assert!(attempt.cancel.load(Ordering::Acquire));
            login.restored(&attempt, Ok(session()));
            let status = login.status().unwrap();
            assert_eq!(status.phase, phase);
            assert_eq!(status.revision, cleared.revision);
            assert!(!login.execution_status().unwrap().signed_in);
        }
    }

    #[test]
    fn temporary_restore_failure_keeps_saved_record_but_identity_failure_revokes() {
        for code in [
            "request_failed",
            "codebuddy_auth_expired",
            "codebuddy_auth_personal_required",
        ] {
            let (login, attempt, receiver) = restoring();
            login.restored(&attempt, Err(Error::new(code)));
            let status = login.status().unwrap();
            if code == "request_failed" {
                assert_eq!(status.phase, Phase::Failed);
                assert_eq!(status.persistence_state, PersistenceState::Saved);
                assert!(receiver.try_recv().is_err());
            } else {
                assert_eq!(status.phase, Phase::Expired);
                assert_eq!(status.persistence_state, PersistenceState::Clearing);
                assert!(matches!(receiver.try_recv(), Ok(Job::Revoke { .. })));
            }
            assert!(!login.execution_status().unwrap().signed_in);
        }
    }
}
