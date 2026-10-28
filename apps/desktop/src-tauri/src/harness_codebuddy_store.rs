use crate::credentials::Provider;
use crate::error::{Error, Result};
use crate::paths::reject_links;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const SCHEMA_VERSION: u32 = 1;
const CHUNK_BYTES: usize = 2048;
const MAX_CHUNKS: usize = 8;
const MAX_BLOB_BYTES: usize = 2560;
const DATABASE: &str = "codebuddy-account.sqlite3";
const REVOKED: &str = "codebuddy-account-revoked";

// 仅由原生认证层与存储层传递；不派生 Debug/Serialize，避免进入通用日志或 IPC。
pub(crate) struct SavedSession {
    pub(crate) access_token: String,
    pub(crate) uid: String,
    pub(crate) domain: String,
    pub(crate) expires_at_ms: u64,
    pub(crate) saved_at_ms: u64,
}

impl SavedSession {
    pub(crate) fn validate(&self) -> Result<()> {
        if !ascii_field(&self.access_token, CHUNK_BYTES * MAX_CHUNKS)
            || !ascii_field(&self.uid, 256)
            || !ascii_field(&self.domain, 256)
        {
            return Err(invalid());
        }
        let now = now_ms()?;
        if self.saved_at_ms > now || self.expires_at_ms <= now {
            return Err(Error::new("codebuddy_auth_expired"));
        }
        Ok(())
    }
}

pub(crate) fn now_ms() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|value| u64::try_from(value.as_millis()).ok())
        .ok_or_else(|| Error::new("codebuddy_auth_expired"))
}

fn ascii_field(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn invalid() -> Error {
    Error::new("codebuddy_store_invalid")
}
fn unavailable() -> Error {
    Error::new("codebuddy_store_unavailable")
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    record_id: String,
    uid: String,
    domain: String,
    expires_at_ms: u64,
    saved_at_ms: u64,
    chunk_count: usize,
    token_bytes: usize,
    token_sha256: String,
}

pub(crate) struct Prepared {
    record_id: String,
    epoch: i64,
}

// 一个数据根只有一个存储所有者；锁随 Store 释放，未提交分片由下次启动补偿。
pub(crate) struct Store {
    db: Connection,
    provider: Box<dyn Provider>,
    namespace: String,
    root: PathBuf,
    _lock: File,
}

impl Store {
    pub(crate) fn open(root: &Path) -> Result<Self> {
        #[cfg(feature = "native-test")]
        let provider = SyntheticProvider::open(root)?;
        #[cfg(not(feature = "native-test"))]
        let provider = crate::credentials::WindowsProvider;
        Self::open_with(root, provider)
    }

    pub(crate) fn open_with(root: &Path, provider: impl Provider + 'static) -> Result<Self> {
        reject_links(root)?;
        fs::create_dir_all(root)?;
        for name in [
            DATABASE,
            "codebuddy-account.sqlite3-wal",
            "codebuddy-account.sqlite3-shm",
            "codebuddy-account.sqlite3-journal",
            "codebuddy-account.lock",
            REVOKED,
        ] {
            reject_links(&root.join(name))?;
        }
        let lock = lock_root(root)?;
        let existed = root.join(DATABASE).exists();
        let db = Connection::open(root.join(DATABASE)).map_err(|_| unavailable())?;
        db.busy_timeout(std::time::Duration::from_secs(2))?;
        let version: u32 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if existed && version != SCHEMA_VERSION {
            return Err(invalid());
        }
        db.execute_batch("PRAGMA synchronous=FULL;")?;
        if !existed {
            let namespace = Uuid::new_v4().to_string();
            db.execute_batch("BEGIN IMMEDIATE; CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1), namespace TEXT NOT NULL, epoch INTEGER NOT NULL, active TEXT); CREATE TABLE records(id TEXT PRIMARY KEY, chunks INTEGER NOT NULL); PRAGMA user_version=1;")?;
            db.execute("INSERT INTO meta VALUES(1,?,0,NULL)", [&namespace])?;
            db.execute_batch("COMMIT")?;
        }
        let namespace: String =
            db.query_row("SELECT namespace FROM meta WHERE id=1", [], |row| {
                row.get(0)
            })?;
        require_id(&namespace)?;
        Ok(Self {
            db,
            provider: Box::new(provider),
            namespace,
            root: root.to_owned(),
            _lock: lock,
        })
    }

    pub(crate) fn active(&self) -> Result<Option<String>> {
        let active: Option<String> =
            self.db
                .query_row("SELECT active FROM meta WHERE id=1", [], |row| row.get(0))?;
        if let Some(id) = &active {
            require_id(id)?;
        }
        Ok(active)
    }

    fn target(&self, record: &str, part: &str) -> Result<String> {
        require_id(record)?;
        let environment = if cfg!(feature = "native-test") {
            "native-test"
        } else if cfg!(debug_assertions) {
            "development"
        } else {
            "release"
        };
        Ok(format!(
            "shiroha-quiz-{environment}-codebuddy-{}-{record}-{part}",
            self.namespace
        ))
    }

    pub(crate) fn load(&mut self) -> Result<Option<SavedSession>> {
        let marker = self.root.join(REVOKED);
        reject_links(&marker)?;
        if marker.exists() {
            self.revoke()?;
        }
        self.cleanup()?;
        self.active()?.map(|id| self.read_record(&id)).transpose()
    }

    pub(crate) fn stage(&mut self, secret: &SavedSession) -> Result<Prepared> {
        secret.validate()?;
        self.cleanup()?;
        let id = Uuid::new_v4().to_string();
        let chunks = secret.access_token.len().div_ceil(CHUNK_BYTES);
        let epoch: i64 = self
            .db
            .query_row("SELECT epoch FROM meta WHERE id=1", [], |row| row.get(0))?;
        self.db.execute(
            "INSERT INTO records(id,chunks) VALUES(?,?)",
            params![id, chunks as u32],
        )?;
        let manifest = Manifest {
            schema_version: SCHEMA_VERSION,
            record_id: id.clone(),
            uid: secret.uid.clone(),
            domain: secret.domain.clone(),
            expires_at_ms: secret.expires_at_ms,
            saved_at_ms: secret.saved_at_ms,
            chunk_count: chunks,
            token_bytes: secret.access_token.len(),
            token_sha256: format!("{:x}", Sha256::digest(secret.access_token.as_bytes())),
        };
        let json = serde_json::to_string(&manifest).map_err(|_| invalid())?;
        if json.len() > MAX_BLOB_BYTES {
            return Err(invalid());
        }
        self.provider.write(&self.target(&id, "manifest")?, &json)?;
        for (index, chunk) in secret
            .access_token
            .as_bytes()
            .chunks(CHUNK_BYTES)
            .enumerate()
        {
            let value = std::str::from_utf8(chunk).map_err(|_| invalid())?;
            self.provider
                .write(&self.target(&id, &index.to_string())?, value)?;
        }
        let restored = self.read_record(&id)?;
        if restored.access_token != secret.access_token
            || restored.uid != secret.uid
            || restored.domain != secret.domain
            || restored.expires_at_ms != secret.expires_at_ms
            || restored.saved_at_ms != secret.saved_at_ms
        {
            return Err(invalid());
        }
        Ok(Prepared {
            record_id: id,
            epoch,
        })
    }

    pub(crate) fn commit(&mut self, record: &Prepared) -> Result<()> {
        reject_links(&self.root.join(REVOKED))?;
        if self.root.join(REVOKED).exists() {
            return Err(Error::new("codebuddy_login_stale"));
        }
        let changed = self.db.execute("UPDATE meta SET active=? WHERE id=1 AND epoch=? AND EXISTS(SELECT 1 FROM records WHERE id=?)", params![record.record_id, record.epoch, record.record_id])?;
        if changed != 1 {
            return Err(Error::new("codebuddy_login_stale"));
        }
        self.cleanup()
    }

    pub(crate) fn revoke(&mut self) -> Result<()> {
        let marker = self.root.join(REVOKED);
        reject_links(&marker)?;
        // 数据库故障时标记仍阻止重启恢复；两者都失败时由调用者保持清理屏障。
        let marker_result = Self::mark_revoked(&self.root);
        let changed = self.db.execute(
            "UPDATE meta SET active=NULL,epoch=epoch+1 WHERE id=1 AND epoch<9223372036854775807",
            [],
        );
        if !matches!(changed, Ok(1)) {
            return Err(unavailable());
        }
        self.cleanup()?;
        if marker.exists() {
            fs::remove_file(marker)?;
        }
        // SQLite 已持久撤销且清理完成时，标记写入失败不影响完成证明。
        drop(marker_result);
        Ok(())
    }

    pub(crate) fn mark_revoked(root: &Path) -> Result<()> {
        let marker = root.join(REVOKED);
        reject_links(&marker)?;
        let mut file = File::create(marker)?;
        file.write_all(b"revoked")?;
        file.sync_all()?;
        Ok(())
    }

    pub(crate) fn mark_revoked_without_store(root: &Path) -> Result<()> {
        // sidecar 损坏时仍可撤销，但必须先证明没有其他实例拥有该数据根。
        let _lock = lock_root(root)?;
        Self::mark_revoked(root)
    }

    pub(crate) fn cleanup(&mut self) -> Result<()> {
        let active = self.active()?;
        let records = {
            let mut query = self.db.prepare("SELECT id,chunks FROM records")?;
            let rows = query
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)? as usize))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        for (id, chunks) in records {
            require_id(&id)?;
            if !(1..=MAX_CHUNKS).contains(&chunks) {
                return Err(invalid());
            }
            if active.as_ref() == Some(&id) {
                continue;
            }
            self.provider.delete(&self.target(&id, "manifest")?)?;
            for index in 0..chunks {
                self.provider
                    .delete(&self.target(&id, &index.to_string())?)?;
            }
            self.db.execute("DELETE FROM records WHERE id=?", [&id])?;
        }
        Ok(())
    }

    fn read_record(&mut self, id: &str) -> Result<SavedSession> {
        let chunks = self
            .db
            .query_row("SELECT chunks FROM records WHERE id=?", [id], |row| {
                row.get::<_, u32>(0)
            })
            .optional()?
            .ok_or_else(invalid)? as usize;
        if !(1..=MAX_CHUNKS).contains(&chunks) {
            return Err(invalid());
        }
        let json = self
            .provider
            .read(&self.target(id, "manifest")?)?
            .ok_or_else(invalid)?;
        if json.len() > MAX_BLOB_BYTES {
            return Err(invalid());
        }
        let manifest: Manifest = serde_json::from_str(&json).map_err(|_| invalid())?;
        if manifest.schema_version != SCHEMA_VERSION
            || manifest.record_id != id
            || manifest.chunk_count != chunks
            || manifest.token_bytes == 0
            || manifest.token_bytes > CHUNK_BYTES * MAX_CHUNKS
            || manifest.token_bytes.div_ceil(CHUNK_BYTES) != chunks
        {
            return Err(invalid());
        }
        let mut token = String::with_capacity(manifest.token_bytes);
        for index in 0..chunks {
            let part = self
                .provider
                .read(&self.target(id, &index.to_string())?)?
                .ok_or_else(invalid)?;
            let expected = CHUNK_BYTES.min(manifest.token_bytes - index * CHUNK_BYTES);
            if part.len() != expected || !ascii_field(&part, CHUNK_BYTES) {
                return Err(invalid());
            }
            token.push_str(&part);
        }
        if format!("{:x}", Sha256::digest(token.as_bytes())) != manifest.token_sha256 {
            return Err(invalid());
        }
        let secret = SavedSession {
            access_token: token,
            uid: manifest.uid,
            domain: manifest.domain,
            expires_at_ms: manifest.expires_at_ms,
            saved_at_ms: manifest.saved_at_ms,
        };
        secret.validate()?;
        Ok(secret)
    }
}

fn lock_root(root: &Path) -> Result<File> {
    reject_links(root)?;
    let path = root.join("codebuddy-account.lock");
    reject_links(&path)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    lock.try_lock()
        .map_err(|_| Error::new("codebuddy_store_in_use"))?;
    Ok(lock)
}

fn require_id(id: &str) -> Result<()> {
    if Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id) {
        Ok(())
    } else {
        Err(invalid())
    }
}

#[cfg(feature = "native-test")]
struct SyntheticProvider {
    root: PathBuf,
}

#[cfg(feature = "native-test")]
impl SyntheticProvider {
    fn open(root: &Path) -> Result<Self> {
        crate::paths::test_root(root, &std::env::temp_dir())?;
        let root = root.join("codebuddy-synthetic-credentials");
        reject_links(&root)?;
        fs::create_dir_all(&root)?;
        Ok(Self { root })
    }
    fn file(&self, target: &str) -> Result<PathBuf> {
        let path = self
            .root
            .join(format!("{:x}.json", Sha256::digest(target.as_bytes())));
        reject_links(&path)?;
        Ok(path)
    }
    fn validate(value: &str) -> Result<()> {
        if value == "synthetic-memory-session" {
            return Ok(());
        }
        let manifest: Manifest = serde_json::from_str(value).map_err(|_| invalid())?;
        if value.len() > MAX_BLOB_BYTES
            || manifest.uid != "synthetic-user"
            || manifest.domain != "copilot.tencent.com"
            || manifest.chunk_count != 1
            || manifest.token_sha256 != format!("{:x}", Sha256::digest(b"synthetic-memory-session"))
        {
            return Err(invalid());
        }
        Ok(())
    }
}

#[cfg(feature = "native-test")]
impl Provider for SyntheticProvider {
    fn read(&mut self, target: &str) -> Result<Option<String>> {
        use std::io::Read;
        let file = self.file(target)?;
        let mut value = String::new();
        match File::open(file) {
            Ok(file) => {
                file.take((MAX_BLOB_BYTES + 1) as u64)
                    .read_to_string(&mut value)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }
        Self::validate(&value)?;
        Ok(Some(value))
    }
    fn write(&mut self, target: &str, secret: &str) -> Result<()> {
        Self::validate(secret)?;
        let mut file = File::create(self.file(target)?)?;
        file.write_all(secret.as_bytes())?;
        file.sync_all()?;
        Ok(())
    }
    fn delete(&mut self, target: &str) -> Result<()> {
        match fs::remove_file(self.file(target)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::FakeProvider;
    use std::sync::{Arc, Mutex};

    fn fixture() -> (std::path::PathBuf, Arc<Mutex<FakeProvider>>) {
        (
            std::env::temp_dir().join(format!("shiroha-codebuddy-store-{}", uuid::Uuid::new_v4())),
            Arc::new(Mutex::new(FakeProvider::default())),
        )
    }

    fn secret(size: usize) -> SavedSession {
        SavedSession {
            access_token: "x".repeat(size),
            uid: "synthetic-user".into(),
            domain: "copilot.tencent.com".into(),
            expires_at_ms: now_ms().unwrap() + 60_000,
            saved_at_ms: now_ms().unwrap(),
        }
    }

    #[test]
    fn remembers_full_tokens_only_after_commit_and_restores_after_reopen() {
        for size in [1, 2048, 2049, 16 * 1024] {
            let (root, provider) = fixture();
            let mut store = Store::open_with(&root, provider.clone()).unwrap();
            assert!(store.load().unwrap().is_none());
            let record = store.stage(&secret(size)).unwrap();
            assert!(store.active().unwrap().is_none());
            store.commit(&record).unwrap();
            drop(store);
            let mut reopened = Store::open_with(&root, provider.clone()).unwrap();
            assert_eq!(reopened.load().unwrap().unwrap().access_token.len(), size);
            assert!(provider
                .lock()
                .unwrap()
                .values
                .values()
                .all(|value| value.len() <= 2560));
            reopened.revoke().unwrap();
            assert!(provider.lock().unwrap().values.is_empty());
            drop(reopened);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn interrupted_save_is_cleaned_without_becoming_an_account() {
        let (root, provider) = fixture();
        let mut store = Store::open_with(&root, provider.clone()).unwrap();
        store.stage(&secret(3000)).unwrap();
        drop(store);
        let mut reopened = Store::open_with(&root, provider.clone()).unwrap();
        assert!(reopened.load().unwrap().is_none());
        assert!(provider.lock().unwrap().values.is_empty());
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_delete_cannot_restore_a_revoked_account_after_restart() {
        let (root, provider) = fixture();
        let mut store = Store::open_with(&root, provider.clone()).unwrap();
        let record = store.stage(&secret(3000)).unwrap();
        store.commit(&record).unwrap();
        provider.lock().unwrap().fail_delete = true;
        assert!(store.revoke().is_err());
        drop(store);
        let mut reopened = Store::open_with(&root, provider.clone()).unwrap();
        assert!(reopened.active().unwrap().is_none());
        assert!(reopened.load().is_err());
        provider.lock().unwrap().fail_delete = false;
        assert!(reopened.load().unwrap().is_none());
        assert!(provider.lock().unwrap().values.is_empty());
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn incomplete_or_changed_credentials_are_rejected_and_can_be_forgotten() {
        for corruption in ["missing", "changed", "manifest", "version"] {
            let (root, provider) = fixture();
            let mut store = Store::open_with(&root, provider.clone()).unwrap();
            let record = store.stage(&secret(3000)).unwrap();
            store.commit(&record).unwrap();
            let part = store.target(&record.record_id, "1").unwrap();
            let manifest = store.target(&record.record_id, "manifest").unwrap();
            {
                let mut values = provider.lock().unwrap();
                match corruption {
                    "missing" => {
                        values.values.remove(&part);
                    }
                    "changed" => {
                        values.values.insert(part, "y".repeat(952));
                    }
                    "manifest" => {
                        values
                            .values
                            .insert(manifest, "x".repeat(MAX_BLOB_BYTES + 1));
                    }
                    _ => {
                        let mut value: serde_json::Value =
                            serde_json::from_str(&values.values[&manifest]).unwrap();
                        value["schemaVersion"] = 99.into();
                        values.values.insert(manifest, value.to_string());
                    }
                }
            }
            assert!(store.load().is_err());
            store.revoke().unwrap();
            assert!(provider.lock().unwrap().values.is_empty());
            drop(store);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn rejects_oversize_and_unsafe_secrets_without_writing_credentials() {
        let (root, provider) = fixture();
        let mut store = Store::open_with(&root, provider.clone()).unwrap();
        for value in [
            secret(0),
            secret(16 * 1024 + 1),
            SavedSession {
                access_token: "bad\nheader".into(),
                ..secret(1)
            },
            SavedSession {
                saved_at_ms: u64::MAX,
                ..secret(1)
            },
        ] {
            assert!(store.stage(&value).is_err());
        }
        assert!(provider.lock().unwrap().values.is_empty());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_replacement_preserves_old_account_and_revoke_rejects_stale_commit() {
        let (root, provider) = fixture();
        let mut store = Store::open_with(&root, provider.clone()).unwrap();
        let first = store.stage(&secret(10)).unwrap();
        store.commit(&first).unwrap();
        provider.lock().unwrap().fail_write = true;
        assert!(store.stage(&secret(20)).is_err());
        provider.lock().unwrap().fail_write = false;
        assert_eq!(store.load().unwrap().unwrap().access_token.len(), 10);
        let replacement = store.stage(&secret(20)).unwrap();
        store.revoke().unwrap();
        assert!(store.commit(&replacement).is_err());
        assert!(store.load().unwrap().is_none());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lock_is_exclusive_and_database_never_contains_credentials() {
        let (root, provider) = fixture();
        let mut store = Store::open_with(&root, provider.clone()).unwrap();
        assert_eq!(
            Store::open_with(&root, provider).err().unwrap().code,
            "codebuddy_store_in_use"
        );
        let mut saved = secret(3000);
        saved.access_token = "synthetic-secret-not-in-database".into();
        let record = store.stage(&saved).unwrap();
        store.commit(&record).unwrap();
        let bytes = fs::read(root.join(DATABASE)).unwrap();
        for forbidden in [
            saved.access_token.as_bytes(),
            saved.uid.as_bytes(),
            saved.domain.as_bytes(),
        ] {
            assert!(!bytes
                .windows(forbidden.len())
                .any(|window| window == forbidden));
        }
        store.revoke().unwrap();
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn persistent_revocation_marker_overrides_an_old_active_record() {
        let (root, provider) = fixture();
        let mut store = Store::open_with(&root, provider.clone()).unwrap();
        let record = store.stage(&secret(3000)).unwrap();
        store.commit(&record).unwrap();
        Store::mark_revoked(&root).unwrap();
        drop(store);
        let mut store = Store::open_with(&root, provider.clone()).unwrap();
        assert!(store.load().unwrap().is_none());
        assert!(provider.lock().unwrap().values.is_empty());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "显式 Windows 系统凭据验证；只使用随机命名空间和合成令牌"]
    fn windows_fake_credentials_roundtrip_and_cleanup() {
        let (root, _) = fixture();
        let mut store = Store::open_with(&root, crate::credentials::WindowsProvider).unwrap();
        let verified = (|| -> Result<bool> {
            let record = store.stage(&secret(16 * 1024))?;
            store.commit(&record)?;
            Ok(store
                .load()?
                .is_some_and(|value| value.access_token == "x".repeat(16 * 1024)))
        })();
        // 即使验证失败仍清理本测试登记的准确目标，不枚举或操作其他凭据。
        let cleanup = store.revoke();
        drop(store);
        fs::remove_dir_all(root).unwrap();
        cleanup.unwrap();
        assert!(verified.unwrap());
    }
}
