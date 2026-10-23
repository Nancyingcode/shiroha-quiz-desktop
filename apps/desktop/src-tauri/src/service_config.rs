use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    Ai,
    Webdav,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceConfig {
    pub service: Service,
    pub endpoint: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub remote_dir: String,
}

pub struct NormalizedConfig {
    pub service: Service,
    pub endpoint: Url,
    pub username: String,
    pub directory: Url,
}

fn invalid() -> Error {
    Error::new("invalid_service_config")
}

// 拒绝编码分隔符和多重编码，避免 URL 解析器与远端服务器对目录范围理解不一致。
fn safe_path(path: &str) -> bool {
    !path.contains(['\\', '?', '#', '%'])
        && !path.chars().any(char::is_control)
        && !path.split('/').any(|part| part == "." || part == "..")
}

impl ServiceConfig {
    pub fn normalize(&self) -> Result<NormalizedConfig> {
        if self.endpoint.len() > 4096
            || self.username.len() > 512
            || self.username.contains(':')
            || self.username.chars().any(char::is_control)
            || !safe_path(&self.remote_dir)
            || self.remote_dir.len() > 1024
            || self.remote_dir.starts_with('/')
        {
            return Err(invalid());
        }
        let raw = self.endpoint.trim();
        let raw_path = raw
            .split_once("://")
            .ok_or_else(invalid)?
            .1
            .split_once('/')
            .map(|(_, path)| path)
            .unwrap_or("");
        if !safe_path(raw_path) {
            return Err(invalid());
        }
        let mut endpoint = Url::parse(raw).map_err(|_| invalid())?;
        if !matches!(endpoint.scheme(), "http" | "https")
            || endpoint.host_str().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(invalid());
        }
        if self.service == Service::Webdav {
            let path = format!("{}/", endpoint.path().trim_end_matches('/'));
            endpoint.set_path(&path);
        }
        let mut directory = endpoint.clone();
        if self.service == Service::Webdav {
            let mut segments = directory.path_segments_mut().map_err(|_| invalid())?;
            segments.pop_if_empty();
            for part in self.remote_dir.split('/').filter(|part| !part.is_empty()) {
                segments.push(part);
            }
            segments.push("");
        }
        Ok(NormalizedConfig {
            service: self.service,
            endpoint,
            username: self.username.clone(),
            directory,
        })
    }
}

impl NormalizedConfig {
    pub fn binding(&self) -> String {
        let service = match self.service {
            Service::Ai => "ai",
            Service::Webdav => "webdav",
        };
        let bytes = serde_json::to_vec(&(
            service,
            self.endpoint.as_str(),
            &self.username,
            self.directory.as_str(),
        ))
        .expect("string tuple serialization");
        format!("{service}-{:x}", Sha256::digest(bytes))
    }
    pub fn object(&self, path: &str) -> Result<Url> {
        if path.is_empty()
            || path.len() > 1024
            || path.starts_with('/')
            || path.contains(':')
            || !safe_path(path)
        {
            return Err(invalid());
        }
        let mut target = self.directory.clone();
        target
            .path_segments_mut()
            .map_err(|_| invalid())?
            .pop_if_empty()
            .extend(path.split('/'));
        self.check_target(&target)?;
        Ok(target)
    }
    pub fn check_target(&self, target: &Url) -> Result<()> {
        if target.origin() != self.endpoint.origin()
            || !target.username().is_empty()
            || target.password().is_some()
            || target.query().is_some()
            || target.fragment().is_some()
            || (self.service == Service::Webdav
                && !target.path().starts_with(self.directory.path()))
        {
            return Err(Error::new("network_scope_denied"));
        }
        Ok(())
    }
    pub fn redirect(&self, from: &Url, location: &str) -> Result<Url> {
        if location.contains('%')
            || location.contains('\\')
            || location.chars().any(char::is_control)
        {
            return Err(Error::new("network_scope_denied"));
        }
        let target = from.join(location).map_err(|_| invalid())?;
        self.check_target(&target)?;
        Ok(target)
    }
}
