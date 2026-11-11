use super::{Attempt, Inner, Login, MemorySession, PersistenceState, Phase, Status};
use crate::error::{Error, Result};
use crate::harness_codebuddy_cli::{Snapshot, Source};
use std::path::Path;
use std::sync::{atomic::AtomicBool, Arc};
use std::time::{Duration, Instant};

const OBSERVE_INTERVAL: Duration = Duration::from_secs(1);
const CLI_MISSING: &str = "CodeBuddy CLI 尚未登录。请按下方步骤登录后刷新。";
const CLI_DETECTED: &str = "已检测到 CodeBuddy CLI 登录，请刷新核验后使用。";
const CLI_READY: &str = "已使用 CodeBuddy CLI 登录状态；登录与退出由 CLI 管理。";

// 来源和指纹归当前账户服务所有；只存内存，恢复屏障须由用户主动刷新解除。
pub(super) struct CliState {
    source: Result<Source>,
    fingerprint: Option<[u8; 32]>,
    pub(super) available: bool,
    next_check: Instant,
    pub(super) restore_blocked: bool,
}

impl Login {
    pub fn open_cli(root: &Path) -> Arc<Self> {
        Self::with_cli_source(root, Source::open(root))
    }

    fn with_cli_source(root: &Path, source: Result<Source>) -> Arc<Self> {
        let mut login = Self::new();
        login.root = Some(root.to_owned());
        if let Ok(state) = login.inner.get_mut() {
            state.cli = Some(CliState {
                source,
                fingerprint: None,
                available: false,
                next_check: Instant::now(),
                restore_blocked: false,
            });
        }
        let service = Arc::new(login);
        let _ = service.check_cli(true);
        service
    }

    pub(super) fn cli_enabled(&self) -> Result<bool> {
        Ok(self.inner.lock().map_err(|_| unavailable())?.cli.is_some())
    }

    pub(super) fn check_cli(&self, force: bool) -> Result<()> {
        let mut state = self.inner.lock().map_err(|_| unavailable())?;
        state.observe_cli(force)
    }

    pub(super) fn block_cli_for_restore(&self) -> Result<()> {
        let mut state = self.inner.lock().map_err(|_| unavailable())?;
        state.clear(Phase::SignedOut)?;
        if let Some(cli) = state.cli.as_mut() {
            cli.restore_blocked = true;
        }
        state.message = "题库恢复已停止 CodeBuddy 使用；CLI 账户仍保留，请主动刷新后重新接入。";
        Ok(())
    }

    fn begin_cli_refresh(
        &self,
        revision: u64,
        cancel: Arc<AtomicBool>,
        allow_after_restore: bool,
    ) -> Result<(Status, Option<(Attempt, Snapshot)>)> {
        let mut state = self.inner.lock().map_err(|_| unavailable())?;
        if revision != state.revision {
            return Err(Error::new("codebuddy_login_stale"));
        }
        if state.busy() {
            return Err(Error::new("codebuddy_login_busy"));
        }
        if state.cli.as_ref().is_some_and(|cli| cli.restore_blocked) && !allow_after_restore {
            return Err(Error::new("codebuddy_restore_required"));
        }
        let snapshot = state.cli.as_ref().ok_or_else(unavailable)?.read();
        let snapshot = match snapshot {
            Ok(Some(snapshot)) => snapshot,
            other => {
                state.apply_cli_observation(other)?;
                return Ok((state.snapshot(), None));
            }
        };
        state.clear(Phase::Restoring)?;
        state.cancel = Some(cancel.clone());
        state.message = "正在核验 CodeBuddy CLI 登录状态…";
        let cli = state.cli.as_mut().ok_or_else(unavailable)?;
        cli.fingerprint = Some(snapshot.fingerprint);
        cli.available = true;
        cli.restore_blocked = false;
        let attempt = Attempt {
            revision: state.revision,
            cancel,
        };
        let initial = state.snapshot();
        Ok((initial, Some((attempt, snapshot))))
    }

    pub(super) fn refresh_cli(self: &Arc<Self>, revision: u64) -> Result<Status> {
        let (initial, work) =
            self.begin_cli_refresh(revision, Arc::new(AtomicBool::new(false)), true)?;
        let Some((attempt, snapshot)) = work else {
            return Ok(initial);
        };
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let _ = service.complete_cli_refresh(attempt, snapshot).await;
        });
        Ok(initial)
    }

    pub(crate) async fn verify_cli_for_readiness(
        self: &Arc<Self>,
        cancel: Arc<AtomicBool>,
    ) -> Result<()> {
        let account = self.execution_status()?;
        if account.signed_in {
            return Ok(());
        }
        let (_, work) = self.begin_cli_refresh(account.revision, cancel, false)?;
        if let Some((attempt, snapshot)) = work {
            self.complete_cli_refresh(attempt, snapshot).await?;
        }
        Ok(())
    }

    async fn complete_cli_refresh(
        self: &Arc<Self>,
        attempt: Attempt,
        snapshot: Snapshot,
    ) -> Result<()> {
        let result = MemorySession::restore(snapshot.session, &attempt.cancel).await;
        let error_code = result.as_ref().err().map(|error| error.code);
        let accepted = self.finish_cli(&attempt, result)?;
        if accepted {
            let root = self.root.clone();
            let cleanup = tauri::async_runtime::spawn_blocking(move || {
                let Some(root) = root else {
                    return Ok(());
                };
                crate::harness_codebuddy_store::Store::retire_legacy(&root)
            })
            .await;
            let mut state = self.inner.lock().map_err(|_| unavailable())?;
            if state.persistence_state == PersistenceState::Clearing {
                let failed = !matches!(cleanup, Ok(Ok(())));
                state.persistence_state = if failed {
                    PersistenceState::CleanupRequired
                } else {
                    PersistenceState::None
                };
                state.persistence_error_code = failed.then_some("codebuddy_store_unavailable");
            }
        }
        if let Some(code) = error_code {
            return Err(Error::new(code));
        }
        Ok(())
    }

    fn finish_cli(&self, attempt: &Attempt, result: Result<MemorySession>) -> Result<bool> {
        self.check_cli(true)?;
        let mut state = self.inner.lock().map_err(|_| unavailable())?;
        let owns_cancelled_attempt = state.phase == Phase::Restoring
            && state.revision == attempt.revision
            && attempt.cancel.load(std::sync::atomic::Ordering::Acquire)
            && state
                .cancel
                .as_ref()
                .is_some_and(|cancel| Arc::ptr_eq(cancel, &attempt.cancel));
        if owns_cancelled_attempt {
            state.clear(Phase::SignedOut)?;
            state.message = CLI_DETECTED;
            return Ok(false);
        }
        let current = state.phase == Phase::Restoring
            && state.revision == attempt.revision
            && !attempt.cancel.load(std::sync::atomic::Ordering::Acquire)
            && state
                .cancel
                .as_ref()
                .is_some_and(|cancel| Arc::ptr_eq(cancel, &attempt.cancel));
        if !current {
            return Ok(false);
        }
        state.cancel = None;
        match result {
            Ok(session) if !session.is_expired() => {
                state.session = Some(session);
                state.phase = Phase::SignedIn;
                state.message = CLI_READY;
                state.persistence_state = PersistenceState::Clearing;
                Ok(true)
            }
            Ok(_) => {
                state.phase = Phase::Expired;
                state.message = cli_message("codebuddy_auth_expired");
                Ok(false)
            }
            Err(error) => {
                state.phase = if error.code == "codebuddy_auth_expired" {
                    Phase::Expired
                } else {
                    Phase::Failed
                };
                state.message = cli_message(error.code);
                Ok(false)
            }
        }
    }
}

impl CliState {
    fn read(&self) -> Result<Option<Snapshot>> {
        self.source
            .as_ref()
            .map_err(|error| Error::new(error.code))?
            .read()
    }
}

impl Inner {
    fn observe_cli(&mut self, force: bool) -> Result<()> {
        let Some(cli) = self.cli.as_mut() else {
            return Ok(());
        };
        if cli.restore_blocked || (!force && Instant::now() < cli.next_check) {
            return Ok(());
        }
        cli.next_check = Instant::now() + OBSERVE_INTERVAL;
        let snapshot = cli.read();
        self.apply_cli_observation(snapshot)
    }

    fn apply_cli_observation(&mut self, snapshot: Result<Option<Snapshot>>) -> Result<()> {
        let (fingerprint, phase, message) = match snapshot {
            Ok(Some(snapshot)) => (Some(snapshot.fingerprint), Phase::SignedOut, CLI_DETECTED),
            Ok(None) => (None, Phase::SignedOut, CLI_MISSING),
            Err(error) => (
                None,
                if error.code == "codebuddy_auth_expired" {
                    Phase::Expired
                } else {
                    Phase::Failed
                },
                cli_message(error.code),
            ),
        };
        let cli = self.cli.as_ref().ok_or_else(unavailable)?;
        let changed = fingerprint != cli.fingerprint;
        let invalidates = changed
            || fingerprint.is_none()
                && (self.session.is_some() || self.lease.is_some() || self.cancel.is_some());
        if invalidates {
            self.clear(phase)?;
        }
        let cli = self.cli.as_mut().ok_or_else(unavailable)?;
        cli.fingerprint = fingerprint;
        cli.available = fingerprint.is_some();
        if invalidates || fingerprint.is_none() || self.phase == Phase::SignedOut {
            self.phase = phase;
            self.message = message;
        }
        Ok(())
    }
}

fn unavailable() -> Error {
    Error::new("codebuddy_login_unavailable")
}

fn cli_message(code: &str) -> &'static str {
    match code {
        "codebuddy_auth_expired" => "CodeBuddy CLI 登录已过期。请在终端重新登录后刷新。",
        "codebuddy_auth_personal_required" => {
            "仅支持国内个人账户。请在 CodeBuddy CLI 切换账户后刷新。"
        }
        "codebuddy_cli_protected" => {
            "该凭据属于受管加密来源，当前无法只读复用。请使用独立 CodeBuddy CLI 登录。"
        }
        "codebuddy_cli_unsupported" => {
            "当前 CLI 来源或账户类型不兼容。请使用独立 CodeBuddy CLI 登录国内个人账户。"
        }
        "codebuddy_cli_invalid" => "CodeBuddy CLI 登录记录无法识别。请在 CLI 重新登录后刷新。",
        "codebuddy_cli_changed" => "CodeBuddy CLI 登录正在变化，旧任务已停止，请刷新后重试。",
        "codebuddy_cli_unavailable" => {
            "无法读取 CodeBuddy CLI 登录状态，请检查本机文件权限后刷新。"
        }
        _ => "CodeBuddy CLI 账户核验未完成，请检查网络并刷新；若已失效，请在 CLI 重新登录。",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::sync::atomic::Ordering;

    struct Fixture {
        root: std::path::PathBuf,
        file: std::path::PathBuf,
        service: Arc<Login>,
    }

    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("shiroha-cli-login-{}", uuid::Uuid::new_v4()));
            let directory = root.join("codebuddy-cli-fixture");
            fs::create_dir_all(&directory).unwrap();
            let file = directory.join("Tencent-Cloud.coding-copilot.info");
            let service = Login::open_cli(&root);
            Self {
                root,
                file,
                service,
            }
        }
        fn login_file(&self) {
            fs::write(&self.file,serde_json::to_vec(&json!({"auth":{"accessToken":"synthetic-memory-session","tokenType":"Bearer","domain":"copilot.tencent.com","expiresAt":crate::harness_codebuddy_store::now_ms().unwrap()+60_000},"account":{"uid":"synthetic-user","type":"personal"}})).unwrap()).unwrap();
        }
        fn authenticate(&self) -> u64 {
            self.login_file();
            let revision = self.service.status().unwrap().revision;
            self.service
                .control(super::super::Control::Refresh { revision })
                .unwrap();
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                let status = self.service.status().unwrap();
                if status.phase != Phase::Restoring && !status.busy {
                    assert_eq!(status.phase, Phase::SignedIn, "{}", status.message);
                    return status.revision;
                }
                assert!(Instant::now() < deadline);
                std::thread::yield_now();
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn missing_cli_guides_login_and_old_mutations_are_rejected() {
        let f = Fixture::new();
        let status = f.service.status().unwrap();
        assert_eq!(status.phase, Phase::SignedOut);
        assert!(status.message.contains("下方步骤"));
        let encoded = serde_json::to_value(status).unwrap();
        assert_eq!(encoded["authSource"], "cli");
        assert_eq!(encoded["cliLoginAvailable"], false);
        for request in [
            super::super::Control::Login {
                revision: 0,
                remember: true,
            },
            super::super::Control::Logout {},
            super::super::Control::SetRemember {
                revision: 0,
                remember: true,
            },
        ] {
            assert_eq!(
                f.service.control(request).err().unwrap().code,
                "codebuddy_cli_action_unsupported"
            );
        }
        assert!(!f.root.join("codebuddy-account.sqlite3").exists());
    }

    #[test]
    fn startup_cli_readiness_reuses_source_and_respects_restore_barrier() {
        let f = Fixture::new();
        f.login_file();
        let before = fs::read(&f.file).unwrap();
        tauri::async_runtime::block_on(
            f.service
                .verify_cli_for_readiness(Arc::new(AtomicBool::new(false))),
        )
        .unwrap();
        assert!(f.service.execution_status().unwrap().signed_in);
        assert_eq!(fs::read(&f.file).unwrap(), before);
        assert!(!f.root.join("codebuddy-account.sqlite3").exists());
        f.service.block_cli_for_restore().unwrap();
        let error = tauri::async_runtime::block_on(
            f.service
                .verify_cli_for_readiness(Arc::new(AtomicBool::new(false))),
        )
        .unwrap_err();
        assert_eq!(error.code, "codebuddy_restore_required");
        assert!(!f.service.execution_status().unwrap().signed_in);
    }

    #[test]
    fn cancelled_startup_cli_check_cannot_leave_a_restoring_account() {
        let f = Fixture::new();
        f.login_file();
        let error = tauri::async_runtime::block_on(
            f.service
                .verify_cli_for_readiness(Arc::new(AtomicBool::new(true))),
        )
        .unwrap_err();
        assert_eq!(error.code, "cancelled");
        let status = f.service.status().unwrap();
        assert_eq!(status.phase, Phase::SignedOut);
        assert!(!status.busy);
    }

    #[test]
    fn refresh_uses_cli_without_creating_application_credentials_and_survives_restart() {
        let f = Fixture::new();
        f.authenticate();
        assert!(!f.root.join("codebuddy-account.sqlite3").exists());
        let reopened = Login::open_cli(&f.root);
        let status = reopened.status().unwrap();
        assert_eq!(status.phase, Phase::SignedOut);
        assert_eq!(status.cli_login_available, Some(true));
        assert!(!status.remember_login);
        let encoded = serde_json::to_string(&status).unwrap();
        assert!(!encoded.contains("synthetic-user"));
        assert!(!encoded.contains("synthetic-memory-session"));
        reopened
            .control(super::super::Control::Refresh {
                revision: status.revision,
            })
            .unwrap();
    }

    #[test]
    fn cli_logout_cancels_the_lease_and_rejects_the_frozen_account() {
        let f = Fixture::new();
        let revision = f.authenticate();
        let cancel = Arc::new(AtomicBool::new(false));
        let lease = f.service.lease(revision, cancel.clone()).unwrap();
        fs::write(f.file.with_extension("info.logged-out"), "synthetic-logout").unwrap();
        assert_eq!(f.service.status().unwrap().phase, Phase::SignedOut);
        assert!(cancel.load(Ordering::Acquire));
        assert!(f.service.ensure_execution_current(revision).is_err());
        drop(lease);
        assert!(!f.service.execution_status().unwrap().signed_in);
    }

    #[test]
    fn rotation_and_invalid_source_cannot_keep_a_cached_account() {
        let f = Fixture::new();
        let revision = f.authenticate();
        f.login_file();
        let mut data: serde_json::Value =
            serde_json::from_slice(&fs::read(&f.file).unwrap()).unwrap();
        data["auth"]["accessToken"] = json!("synthetic-rotated-session");
        fs::write(&f.file, serde_json::to_vec(&data).unwrap()).unwrap();
        assert!(f.service.ensure_execution_current(revision).is_err());
        assert!(!f.service.execution_status().unwrap().signed_in);
        fs::write(&f.file, "{").unwrap();
        assert_eq!(f.service.status().unwrap().phase, Phase::Failed);
    }

    #[test]
    fn restore_barrier_requires_explicit_refresh_and_does_not_logout_cli() {
        let f = Fixture::new();
        f.authenticate();
        let before = fs::read(&f.file).unwrap();
        tauri::async_runtime::block_on(f.service.invalidate_for_restore()).unwrap();
        let status = f.service.status().unwrap();
        assert_eq!(status.phase, Phase::SignedOut);
        assert_eq!(status.cli_login_available, Some(false));
        assert_eq!(fs::read(&f.file).unwrap(), before);
        f.service
            .control(super::super::Control::Refresh {
                revision: status.revision,
            })
            .unwrap();
    }

    #[test]
    fn late_verification_cannot_revive_a_replaced_cli_source() {
        let f = Fixture::new();
        f.login_file();
        f.service.check_cli(true).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let attempt = {
            let mut state = f.service.inner.lock().unwrap();
            state.clear(Phase::Restoring).unwrap();
            state.cancel = Some(cancel.clone());
            Attempt {
                revision: state.revision,
                cancel,
            }
        };
        let snapshot = Source::open(&f.root).unwrap().read().unwrap().unwrap();
        let session = tauri::async_runtime::block_on(MemorySession::restore(
            snapshot.session,
            &attempt.cancel,
        ))
        .unwrap();
        fs::remove_file(&f.file).unwrap();
        assert!(!f.service.finish_cli(&attempt, Ok(session)).unwrap());
        assert!(!f.service.execution_status().unwrap().signed_in);
    }
}
