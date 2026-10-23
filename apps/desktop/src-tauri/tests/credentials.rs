use shiroha_quiz_desktop::credentials::{Credentials, FakeProvider, SecretInput};
use std::sync::{Arc, Mutex};

#[cfg(windows)]
#[test]
#[ignore = "显式执行：仅在随机测试命名空间操作 Windows 假凭据"]
fn windows_provider_roundtrip_in_unique_namespace() {
    use shiroha_quiz_desktop::credentials::{Provider, WindowsProvider};
    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = WindowsProvider.delete(&self.0);
        }
    }
    let target = Cleanup(format!("shiroha-quiz-test-{}", uuid::Uuid::new_v4()));
    let mut provider = WindowsProvider;
    assert!(provider.read(&target.0).unwrap().is_none());
    provider.write(&target.0, "synthetic-first").unwrap();
    assert_eq!(
        provider.read(&target.0).unwrap().as_deref(),
        Some("synthetic-first")
    );
    provider.write(&target.0, "synthetic-replacement").unwrap();
    assert_eq!(
        provider.read(&target.0).unwrap().as_deref(),
        Some("synthetic-replacement")
    );
    provider.delete(&target.0).unwrap();
    assert!(provider.read(&target.0).unwrap().is_none());
}

#[test]
fn staged_replacement_can_rollback_without_exposing_or_losing_old_secret() {
    let provider = Arc::new(Mutex::new(FakeProvider::default()));
    let mut vault = Credentials::memory(provider.clone()).unwrap();
    let first = vault
        .stage("ai", "binding", SecretInput::Replace("old".into()), true)
        .unwrap();
    vault.commit(&first).unwrap();
    let replacement = vault
        .stage("ai", "binding", SecretInput::Replace("new".into()), true)
        .unwrap();
    assert_eq!(
        vault.secret("ai", "binding").unwrap_err().code,
        "credential_pending"
    );
    vault.rollback(&replacement).unwrap();
    assert_eq!(vault.secret("ai", "binding").unwrap(), "old");
    assert_eq!(provider.lock().unwrap().values.len(), 1);
}

#[test]
fn deletion_failure_does_not_report_cleared_and_can_be_retried() {
    let provider = Arc::new(Mutex::new(FakeProvider::default()));
    let mut vault = Credentials::memory(provider.clone()).unwrap();
    let id = vault
        .stage("ai", "binding", SecretInput::Replace("old".into()), true)
        .unwrap();
    vault.commit(&id).unwrap();
    let id = vault
        .stage("ai", "binding", SecretInput::Clear, false)
        .unwrap();
    provider.lock().unwrap().fail_delete = true;
    assert!(vault.commit(&id).is_err());
    assert_ne!(vault.status("ai", "binding").unwrap(), "missing");
    provider.lock().unwrap().fail_delete = false;
    vault.commit(&id).unwrap();
    assert_eq!(vault.status("ai", "binding").unwrap(), "missing");
}

#[test]
fn binding_restore_and_session_lifecycle_never_reuse_old_secrets() {
    let provider = Arc::new(Mutex::new(FakeProvider::default()));
    let mut vault = Credentials::memory(provider.clone()).unwrap();
    let id = vault
        .stage(
            "webdav",
            "original",
            SecretInput::Replace("password".into()),
            true,
        )
        .unwrap();
    vault.commit(&id).unwrap();
    assert!(vault.secret("webdav", "changed").is_err());
    assert!(vault
        .stage("webdav", "changed", SecretInput::Keep, true)
        .is_err());
    let id = vault
        .stage("webdav", "original", SecretInput::Keep, false)
        .unwrap();
    vault.commit(&id).unwrap();
    assert!(provider.lock().unwrap().values.is_empty());
    assert_eq!(vault.status("webdav", "original").unwrap(), "session");
    vault.invalidate().unwrap();
    assert!(vault.secret("webdav", "original").is_err());
}

#[test]
fn provider_write_failure_preserves_active_binding() {
    let provider = Arc::new(Mutex::new(FakeProvider::default()));
    let mut vault = Credentials::memory(provider.clone()).unwrap();
    let id = vault
        .stage("ai", "binding", SecretInput::Replace("old".into()), true)
        .unwrap();
    vault.commit(&id).unwrap();
    provider.lock().unwrap().fail_write = true;
    assert!(vault
        .stage("ai", "binding", SecretInput::Replace("new".into()), true)
        .is_err());
    assert_eq!(vault.secret("ai", "binding").unwrap(), "old");
}

#[test]
fn restore_revokes_staged_values_and_blocks_late_commit() {
    let provider = Arc::new(Mutex::new(FakeProvider::default()));
    let mut vault = Credentials::memory(provider).unwrap();
    let id = vault
        .stage(
            "ai",
            "same-endpoint",
            SecretInput::Replace("key".into()),
            true,
        )
        .unwrap();
    vault.invalidate().unwrap();
    assert_eq!(vault.commit(&id).unwrap_err().code, "binding_required");
    assert_eq!(vault.secret("ai", "same-endpoint").unwrap(), "");
}

#[test]
fn migration_receipt_allows_cleanup_retry_but_never_overwrites_a_changed_source() {
    let provider = Arc::new(Mutex::new(FakeProvider::default()));
    let mut vault = Credentials::memory(provider).unwrap();
    vault
        .migrate("ai", "binding", "legacy".into(), true)
        .unwrap();
    vault
        .migrate("ai", "binding", "legacy".into(), true)
        .unwrap();
    assert!(vault
        .migrate("ai", "binding", "new-source".into(), true)
        .is_err());
    assert_eq!(vault.secret("ai", "binding").unwrap(), "legacy");
    vault.invalidate().unwrap();
    assert!(vault
        .migrate("ai", "binding", "legacy".into(), true)
        .is_err());
}

#[test]
fn pending_credentials_survive_restart_until_data_receipt_is_reconciled() {
    let root = std::env::temp_dir().join(format!(
        "shiroha-native-credentials-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&root).unwrap();
    let provider = Arc::new(Mutex::new(FakeProvider::default()));
    let mut vault = Credentials::open(&root, provider.clone()).unwrap();
    let first = vault
        .stage("ai", "binding", SecretInput::Replace("old".into()), true)
        .unwrap();
    vault.commit(&first).unwrap();
    let staged = vault
        .stage("ai", "binding", SecretInput::Replace("new".into()), true)
        .unwrap();
    drop(vault);
    let mut reopened = Credentials::open(&root, provider).unwrap();
    assert_eq!(
        reopened.pending().unwrap(),
        vec![(staged.clone(), "staged".into())]
    );
    assert_eq!(
        reopened.secret("ai", "binding").unwrap_err().code,
        "credential_pending"
    );
    reopened.commit(&staged).unwrap();
    assert_eq!(reopened.secret("ai", "binding").unwrap(), "new");
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}
