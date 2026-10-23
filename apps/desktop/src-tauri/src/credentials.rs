use crate::{
    error::{Error, Result},
    paths::reject_links,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};

pub trait Provider: Send {
    fn read(&mut self, target: &str) -> Result<Option<String>>;
    fn write(&mut self, target: &str, secret: &str) -> Result<()>;
    fn delete(&mut self, target: &str) -> Result<()>;
}
#[derive(Default)]
pub struct FakeProvider {
    pub values: HashMap<String, String>,
    pub fail_write: bool,
    pub fail_delete: bool,
}
impl Provider for Arc<Mutex<FakeProvider>> {
    fn read(&mut self, target: &str) -> Result<Option<String>> {
        Ok(self
            .lock()
            .map_err(|_| unavailable())?
            .values
            .get(target)
            .cloned())
    }
    fn write(&mut self, target: &str, secret: &str) -> Result<()> {
        let mut state = self.lock().map_err(|_| unavailable())?;
        if state.fail_write {
            return Err(unavailable());
        }
        state.values.insert(target.into(), secret.into());
        Ok(())
    }
    fn delete(&mut self, target: &str) -> Result<()> {
        let mut state = self.lock().map_err(|_| unavailable())?;
        if state.fail_delete {
            return Err(unavailable());
        }
        state.values.remove(target);
        Ok(())
    }
}
fn unavailable() -> Error {
    Error::new("credential_unavailable")
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum SecretInput {
    Keep,
    Replace(String),
    Clear,
}

// 私有数据库只存绑定和补偿日志；秘密由系统 provider 或当前进程持有，不能导出到交换快照。
pub struct Credentials {
    db: Connection,
    provider: Box<dyn Provider>,
    sessions: HashMap<String, String>,
    namespace: String,
}
type Binding = (String, String, bool);
impl Credentials {
    pub fn memory(provider: impl Provider + 'static) -> Result<Self> {
        Self::with_connection(Connection::open_in_memory()?, provider, "test".into())
    }
    pub fn open(root: &Path, provider: impl Provider + 'static) -> Result<Self> {
        let file = root.join("service-bindings.sqlite3");
        for suffix in [
            "service-bindings.sqlite3",
            "service-bindings.sqlite3-wal",
            "service-bindings.sqlite3-shm",
        ] {
            reject_links(&root.join(suffix))?;
        }
        Self::with_connection(
            Connection::open(file)?,
            provider,
            format!(
                "shiroha-quiz-{}",
                if cfg!(debug_assertions) {
                    "development"
                } else {
                    "release"
                }
            ),
        )
    }
    fn with_connection(
        db: Connection,
        provider: impl Provider + 'static,
        namespace: String,
    ) -> Result<Self> {
        db.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS bindings(service TEXT PRIMARY KEY,binding TEXT NOT NULL,target TEXT NOT NULL,remember INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,service TEXT NOT NULL,binding TEXT NOT NULL,target TEXT NOT NULL,remember INTEGER NOT NULL,old_target TEXT NOT NULL,old_remember INTEGER NOT NULL,phase TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS migration(source TEXT PRIMARY KEY,binding TEXT NOT NULL); CREATE TABLE IF NOT EXISTS flags(name TEXT PRIMARY KEY);")?;
        Ok(Self {
            db,
            provider: Box::new(provider),
            sessions: HashMap::new(),
            namespace,
        })
    }
    fn binding(&self, service: &str) -> Result<Option<Binding>> {
        Ok(self
            .db
            .query_row(
                "SELECT binding,target,remember FROM bindings WHERE service=?",
                [service],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?)
    }
    pub fn status(&mut self, service: &str, binding: &str) -> Result<&'static str> {
        let cleanup: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM pending WHERE service=? AND phase='committed')",
            [service],
            |r| r.get(0),
        )?;
        if cleanup {
            return Ok("unavailable");
        }
        let Some((active, target, remember)) = self.binding(service)? else {
            return Ok("missing");
        };
        if active != binding {
            return Ok("binding_required");
        }
        let secret = if remember {
            self.provider.read(&target)?
        } else {
            self.sessions.get(&target).cloned()
        };
        Ok(if secret.is_none() {
            "missing"
        } else if remember {
            "remembered"
        } else {
            "session"
        })
    }
    pub fn secret(&mut self, service: &str, binding: &str) -> Result<String> {
        let pending: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM pending WHERE service=? AND phase!='revoked')",
            [service],
            |r| r.get(0),
        )?;
        if pending {
            return Err(Error::new("credential_pending"));
        }
        let Some((active, target, remember)) = self.binding(service)? else {
            return Ok(String::new());
        };
        if active != binding {
            return Err(Error::new("binding_required"));
        }
        let value = if remember {
            self.provider.read(&target)?
        } else {
            self.sessions.get(&target).cloned()
        };
        value.ok_or_else(|| Error::new("credential_missing"))
    }
    pub fn stage(
        &mut self,
        service: &str,
        binding: &str,
        input: SecretInput,
        remember: bool,
    ) -> Result<String> {
        if !matches!(service, "ai" | "webdav") || binding.is_empty() {
            return Err(Error::new("invalid_input"));
        }
        let busy: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM pending WHERE service=? AND phase!='revoked')",
            [service],
            |r| r.get(0),
        )?;
        if busy {
            return Err(Error::new("credential_pending"));
        }
        let secret = match input {
            SecretInput::Keep => self.secret(service, binding)?,
            SecretInput::Replace(value) => value,
            SecretInput::Clear => String::new(),
        };
        if secret.len() > 2560 || secret.contains(['\r', '\n', '\0']) {
            return Err(Error::new("invalid_input"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let target = if secret.is_empty() {
            String::new()
        } else {
            format!("{}-{id}", self.namespace)
        };
        let (_, old_target, old_remember) = self.binding(service)?.unwrap_or_default();
        // 先登记清理责任，再写系统凭据；崩溃不会留下无法定位的暂存秘密。
        self.db.execute(
            "INSERT INTO pending VALUES(?,?,?,?,?,?,?,'staged')",
            params![
                id,
                service,
                binding,
                target,
                remember,
                old_target,
                old_remember
            ],
        )?;
        if !target.is_empty() {
            let result = if remember {
                self.provider.write(&target, &secret).and_then(|()| {
                    if self.provider.read(&target)?.as_deref() == Some(&secret) {
                        Ok(())
                    } else {
                        Err(unavailable())
                    }
                })
            } else {
                self.sessions.insert(target.clone(), secret);
                Ok(())
            };
            if let Err(error) = result {
                self.rollback(&id)?;
                return Err(error);
            }
        }
        Ok(id)
    }
    pub fn commit(&mut self, id: &str) -> Result<()> {
        let receipt: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM receipts WHERE id=?)",
            [id],
            |r| r.get(0),
        )?;
        if receipt {
            return Ok(());
        }
        let (service,binding,target,remember,old,old_remember,phase):(String,String,String,bool,String,bool,String)=self.db.query_row("SELECT service,binding,target,remember,old_target,old_remember,phase FROM pending WHERE id=?",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)))?;
        if phase == "revoked" {
            return Err(Error::new("binding_required"));
        }
        if phase == "staged" {
            // 先原子激活新绑定并登记清理责任，避免数据库失败时已删除旧秘密。
            let tx = self.db.transaction()?;
            if target.is_empty() {
                tx.execute("DELETE FROM bindings WHERE service=?", [&service])?;
            } else {
                tx.execute(
                    "INSERT OR REPLACE INTO bindings VALUES(?,?,?,?)",
                    params![service, binding, target, remember],
                )?;
            }
            tx.execute("UPDATE pending SET phase='committed' WHERE id=?", [id])?;
            tx.commit()?;
        }
        // 清除旧副本成功后才报告完成；失败保留日志并允许同一 id 重试。
        if !old.is_empty() {
            if old_remember {
                self.provider.delete(&old)?;
                if self.provider.read(&old)?.is_some() {
                    return Err(unavailable());
                }
            } else {
                self.sessions.remove(&old);
            }
        }
        let tx = self.db.transaction()?;
        tx.execute("INSERT OR IGNORE INTO receipts VALUES(?)", [id])?;
        tx.execute("DELETE FROM pending WHERE id=?", [id])?;
        tx.commit()?;
        Ok(())
    }
    pub fn rollback(&mut self, id: &str) -> Result<()> {
        let row: Option<(String, bool, String)> = self
            .db
            .query_row(
                "SELECT target,remember,phase FROM pending WHERE id=?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((target, remember, phase)) = row else {
            return Ok(());
        };
        if phase != "staged" {
            return Err(Error::new("credential_committed"));
        }
        if !target.is_empty() {
            if remember {
                self.provider.delete(&target)?;
            } else {
                self.sessions.remove(&target);
            }
        }
        self.db.execute("DELETE FROM pending WHERE id=?", [id])?;
        Ok(())
    }
    pub fn invalidate(&mut self) -> Result<()> {
        let tx = self.db.transaction()?;
        tx.execute("UPDATE bindings SET binding='revoked'", [])?;
        tx.execute("UPDATE pending SET phase='revoked'", [])?;
        tx.execute(
            "INSERT OR IGNORE INTO flags VALUES('migration_revoked')",
            [],
        )?;
        tx.commit()?;
        self.sessions.clear();
        Ok(())
    }
    pub fn pending(&self) -> Result<Vec<(String, String)>> {
        let mut statement = self
            .db
            .prepare("SELECT id,phase FROM pending WHERE phase!='revoked'")?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    pub fn migrate(
        &mut self,
        service: &str,
        binding: &str,
        secret: String,
        remember: bool,
    ) -> Result<()> {
        let revoked: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM flags WHERE name='migration_revoked')",
            [],
            |r| r.get(0),
        )?;
        if revoked {
            return Err(Error::new("binding_required"));
        }
        let source = format!("{service}-{}", if remember { "local" } else { "session" });
        let previous: Option<String> = self
            .db
            .query_row(
                "SELECT binding FROM migration WHERE source=?",
                [&source],
                |r| r.get(0),
            )
            .optional()?;
        if previous.is_some() {
            if previous.as_deref() != Some(binding) || self.secret(service, binding)? != secret {
                return Err(Error::new("migration_changed"));
            }
            return Ok(());
        }
        if self.binding(service)?.is_some() {
            if self.secret(service, binding)? != secret {
                return Err(Error::new("migration_changed"));
            }
        } else {
            let id = self.stage(service, binding, SecretInput::Replace(secret), remember)?;
            self.commit(&id)?;
        }
        self.db.execute(
            "INSERT INTO migration VALUES(?,?)",
            params![source, binding],
        )?;
        Ok(())
    }
}

#[cfg(windows)]
pub struct WindowsProvider;
#[cfg(windows)]
impl Provider for WindowsProvider {
    fn read(&mut self, target: &str) -> Result<Option<String>> {
        use windows_sys::Win32::{
            Foundation::{GetLastError, ERROR_NOT_FOUND},
            Security::Credentials::*,
        };
        let target: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        let mut credential = std::ptr::null_mut();
        // SAFETY: target 以 NUL 结尾；系统分配的凭据仅在 CredFree 前读取。
        unsafe {
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err(unavailable())
                };
            }
            let value = &*credential;
            let result = if value.CredentialBlobSize > 2560 {
                Err(unavailable())
            } else if value.CredentialBlobSize == 0 {
                Ok(Some(String::new()))
            } else {
                String::from_utf8(
                    std::slice::from_raw_parts(
                        value.CredentialBlob,
                        value.CredentialBlobSize as usize,
                    )
                    .to_vec(),
                )
                .map(Some)
                .map_err(|_| unavailable())
            };
            CredFree(credential.cast());
            result
        }
    }
    fn write(&mut self, target: &str, secret: &str) -> Result<()> {
        use windows_sys::Win32::Security::Credentials::*;
        let mut target: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        let mut bytes = secret.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        // SAFETY: 所有缓冲区在同步 CredWriteW 返回前有效，长度已经由业务入口限制。
        let result = unsafe { CredWriteW(&credential, 0) };
        bytes.fill(0);
        if result == 0 {
            Err(unavailable())
        } else {
            Ok(())
        }
    }
    fn delete(&mut self, target: &str) -> Result<()> {
        use windows_sys::Win32::{
            Foundation::{GetLastError, ERROR_NOT_FOUND},
            Security::Credentials::*,
        };
        let target: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        // SAFETY: 仅删除应用生成的、以 NUL 结尾的准确凭据目标。
        unsafe {
            if CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) != 0
                || GetLastError() == ERROR_NOT_FOUND
            {
                Ok(())
            } else {
                Err(unavailable())
            }
        }
    }
}
