use crate::{
    error::{Error, Result},
    paths::reject_links,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
const CHUNK_BYTES: usize = 256 * 1024;
const GRANT_LIFETIME: Duration = Duration::from_secs(600);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub token: String,
    pub name: String,
    pub size_bytes: u64,
}
struct AuthorizedFile {
    file: File,
    destination: PathBuf,
    temporary: Option<PathBuf>,
    created: Instant,
    size: u64,
    digest: Sha256,
}
// 授权表只属于主窗口的本次进程；文件句柄避免读取期间路径替换改变数据来源。
#[derive(Default)]
pub struct Files {
    grants: HashMap<String, AuthorizedFile>,
}
impl Files {
    pub fn reset(&mut self) -> Result<()> {
        let tokens: Vec<_> = self.grants.keys().cloned().collect();
        for token in tokens {
            self.release(&token)?;
        }
        Ok(())
    }

    pub fn authorize(&mut self, path: &Path, export: bool) -> Result<Grant> {
        self.prune()?;
        if self.grants.len() >= 8 {
            return Err(Error::new("operation_busy"));
        }
        reject_links(path)?;
        let parent = path.parent().ok_or_else(|| Error::new("invalid_input"))?;
        let destination = fs::canonicalize(parent)?.join(
            path.file_name()
                .ok_or_else(|| Error::new("invalid_input"))?,
        );
        let token = uuid::Uuid::new_v4().to_string();
        let temporary = export
            .then(|| destination.with_file_name(format!(".shiroha-{}.tmp", uuid::Uuid::new_v4())));
        let file = if let Some(temporary) = &temporary {
            OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .open(temporary)?
        } else {
            File::open(&destination)?
        };
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
            return Err(Error::new("response_too_large"));
        }
        let name = destination
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| Error::new("invalid_input"))?
            .to_owned();
        let size = metadata.len();
        self.grants.insert(
            token.clone(),
            AuthorizedFile {
                file,
                destination,
                temporary,
                created: Instant::now(),
                size,
                digest: Sha256::new(),
            },
        );
        Ok(Grant {
            token,
            name,
            size_bytes: size,
        })
    }
    fn prune(&mut self) -> Result<()> {
        let expired: Vec<_> = self
            .grants
            .iter()
            .filter(|(_, grant)| grant.created.elapsed() > GRANT_LIFETIME)
            .map(|(token, _)| token.clone())
            .collect();
        for token in expired {
            self.release(&token)?;
        }
        Ok(())
    }
    fn grant(&mut self, token: &str, export: bool) -> Result<&mut AuthorizedFile> {
        self.prune()?;
        self.grants
            .get_mut(token)
            .filter(|g| g.temporary.is_some() == export)
            .ok_or_else(|| Error::new("permission_denied"))
    }
    pub fn read(&mut self, token: &str, offset: u64) -> Result<Vec<u8>> {
        let grant = self.grant(token, false)?;
        if offset > grant.size || grant.file.metadata()?.len() != grant.size {
            return Err(Error::new("integrity_failed"));
        }
        grant.file.seek(SeekFrom::Start(offset))?;
        let mut bytes = vec![0; ((grant.size - offset).min(CHUNK_BYTES as u64)) as usize];
        grant.file.read_exact(&mut bytes)?;
        Ok(bytes)
    }
    pub fn append(&mut self, token: &str, offset: u64, bytes: &[u8]) -> Result<()> {
        let grant = self.grant(token, true)?;
        if offset != grant.size
            || bytes.len() > CHUNK_BYTES
            || offset + bytes.len() as u64 > MAX_FILE_BYTES
        {
            return Err(Error::new("invalid_input"));
        }
        grant.file.write_all(bytes)?;
        grant.digest.update(bytes);
        grant.size += bytes.len() as u64;
        Ok(())
    }
    pub fn finish(&mut self, token: &str, size: u64) -> Result<()> {
        let grant = self.grant(token, true)?;
        if grant.size != size || grant.file.metadata()?.len() != size {
            return Err(Error::new("integrity_failed"));
        }
        grant.file.sync_all()?;
        grant.file.seek(SeekFrom::Start(0))?;
        let mut digest = Sha256::new();
        let mut buffer = vec![0; CHUNK_BYTES];
        loop {
            let read = grant.file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }
        if digest.finalize() != grant.digest.clone().finalize() {
            return Err(Error::new("integrity_failed"));
        }
        reject_links(&grant.destination)?;
        let temporary = grant
            .temporary
            .as_ref()
            .ok_or_else(|| Error::new("permission_denied"))?
            .clone();
        reject_links(&temporary)?;
        // 同目录 rename 在 Windows 使用替换语义；被占用或权限失败时原目标保留。
        fs::rename(&temporary, &grant.destination)?;
        self.grants.remove(token);
        Ok(())
    }
    pub fn release(&mut self, token: &str) -> Result<()> {
        if let Some(grant) = self.grants.remove(token) {
            drop(grant.file);
            if let Some(temporary) = grant.temporary {
                reject_links(&temporary)?;
                if temporary.exists() {
                    fs::remove_file(temporary)?;
                }
            }
        }
        Ok(())
    }
}
impl Drop for Files {
    fn drop(&mut self) {
        let tokens: Vec<_> = self.grants.keys().cloned().collect();
        for token in tokens {
            // 退出清理失败仅遗留临时副本，不尝试删除用户目标或影响其他会话。
            let _ = self.release(&token);
        }
    }
}
