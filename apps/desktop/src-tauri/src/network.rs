use crate::{
    error::{Error, Result},
    service_config::{NormalizedConfig, Service},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use url::Url;

const AI_RESPONSE_LIMIT: usize = 8 * 1024 * 1024;
const BACKUP_RESPONSE_LIMIT: usize = 256 * 1024 * 1024;
const DIRECTORY_RESPONSE_LIMIT: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_SECONDS: u64 = 120;
const MAX_REDIRECTS: usize = 5;

#[derive(Clone)]
pub enum OutboundPolicy {
    Deny,
    Loopback,
    Configured,
    MockOrigin(String),
}

pub struct Network {
    client: Client,
    policy: OutboundPolicy,
}
#[derive(Serialize)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DavOperation {
    Probe,
    List,
    EnsureDirectory { depth: usize },
    Download { name: String },
    Upload { name: String, body: String },
}

fn backup_name(name: &str) -> bool {
    name == "latest.json"
        || (name.starts_with("shiroha-web-backup-")
            && name.ends_with(".json")
            && name.len() < 100
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-.".contains(&byte)))
}
fn network_error(error: reqwest::Error) -> Error {
    Error::new(if error.is_timeout() {
        "timeout"
    } else {
        "network_unavailable"
    })
}
impl Network {
    pub fn new(policy: OutboundPolicy) -> Result<Self> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(network_error)?;
        Ok(Self { client, policy })
    }
    fn outbound(&self, target: &Url) -> Result<()> {
        let allowed = match &self.policy {
            OutboundPolicy::Deny => false,
            // 使用字面 IP，避免测试主机名解析或代理把 mock 请求送到外部。
            OutboundPolicy::Loopback => {
                target.scheme() == "http"
                    && matches!(target.host(),Some(url::Host::Ipv4(ip)) if ip.is_loopback())
            }
            OutboundPolicy::Configured => true,
            OutboundPolicy::MockOrigin(origin) => target.origin().ascii_serialization() == *origin,
        };
        if allowed {
            Ok(())
        } else {
            Err(Error::new("network_denied"))
        }
    }
    pub async fn ai(
        &self,
        config: &NormalizedConfig,
        secret: &str,
        payload: Value,
    ) -> Result<Response> {
        if config.service != Service::Ai
            || !payload.is_object()
            || payload.get("stream").is_some_and(|v| v != false)
            || !payload["messages"].is_array()
        {
            return Err(Error::new("invalid_input"));
        }
        let body = serde_json::to_string(&payload)?;
        if body.len() > AI_RESPONSE_LIMIT {
            return Err(Error::new("payload_too_large"));
        }
        self.request(
            config,
            secret,
            Method::POST,
            config.endpoint.clone(),
            Some(body),
            AI_RESPONSE_LIMIT,
            None,
        )
        .await
    }
    pub async fn webdav(
        &self,
        config: &NormalizedConfig,
        secret: &str,
        operation: DavOperation,
    ) -> Result<Response> {
        if config.service != Service::Webdav {
            return Err(Error::new("invalid_input"));
        }
        let (method, target, body, limit, depth) = match operation {
            DavOperation::Probe => (
                Method::from_bytes(b"PROPFIND").expect("constant method"),
                config.directory.clone(),
                None,
                DIRECTORY_RESPONSE_LIMIT,
                Some("0"),
            ),
            DavOperation::List => (
                Method::from_bytes(b"PROPFIND").expect("constant method"),
                config.directory.clone(),
                None,
                DIRECTORY_RESPONSE_LIMIT,
                Some("1"),
            ),
            DavOperation::EnsureDirectory { depth } => {
                let relative = config
                    .directory
                    .path()
                    .strip_prefix(config.endpoint.path())
                    .ok_or_else(|| Error::new("invalid_input"))?;
                let parts: Vec<_> = relative
                    .trim_end_matches('/')
                    .split('/')
                    .filter(|s| !s.is_empty())
                    .collect();
                if depth == 0 || depth > parts.len() {
                    return Err(Error::new("invalid_input"));
                }
                let target = config
                    .endpoint
                    .join(&format!("{}/", parts[..depth].join("/")))
                    .map_err(|_| Error::new("invalid_input"))?;
                (
                    Method::from_bytes(b"MKCOL").expect("constant method"),
                    target,
                    None,
                    DIRECTORY_RESPONSE_LIMIT,
                    None,
                )
            }
            DavOperation::Download { name } => {
                if !backup_name(&name) {
                    return Err(Error::new("invalid_input"));
                }
                (
                    Method::GET,
                    config.object(&name)?,
                    None,
                    BACKUP_RESPONSE_LIMIT,
                    None,
                )
            }
            DavOperation::Upload { name, body } => {
                if !backup_name(&name) || body.len() > BACKUP_RESPONSE_LIMIT {
                    return Err(Error::new("invalid_input"));
                }
                let value: Value = serde_json::from_str(&body)?;
                if !value.is_object() {
                    return Err(Error::new("invalid_input"));
                }
                if name != "latest.json" {
                    // 历史文件不可盲目覆盖；回包丢失后的重试先确认远端内容。
                    let previous = self
                        .request(
                            config,
                            secret,
                            Method::GET,
                            config.object(&name)?,
                            None,
                            BACKUP_RESPONSE_LIMIT,
                            None,
                        )
                        .await?;
                    if previous.status == 200 {
                        if previous.body == body {
                            return Ok(Response {
                                status: 200,
                                body: String::new(),
                            });
                        }
                        return Err(Error::new("remote_conflict"));
                    }
                    if previous.status != 404 {
                        return Ok(previous);
                    }
                }
                (
                    Method::PUT,
                    config.object(&name)?,
                    Some(body),
                    DIRECTORY_RESPONSE_LIMIT,
                    None,
                )
            }
        };
        let listing = depth.is_some();
        let writing = method == Method::PUT;
        let response = self
            .request(config, secret, method, target, body, limit, depth)
            .await
            .map_err(|error| {
                if writing && matches!(error.code, "timeout" | "network_unavailable") {
                    Error::new("result_unknown")
                } else {
                    error
                }
            })?;
        if listing && response.status == 207 {
            validate_hrefs(config, &response.body)?;
        }
        Ok(response)
    }
    #[allow(clippy::too_many_arguments)] // 固定业务操作在入口决定方法、体积与目录，页面不能直接构造此请求。
    async fn request(
        &self,
        config: &NormalizedConfig,
        secret: &str,
        method: Method,
        mut target: Url,
        body: Option<String>,
        limit: usize,
        depth: Option<&str>,
    ) -> Result<Response> {
        let work = async {
            for hop in 0..=MAX_REDIRECTS {
                self.outbound(&target)?;
                let mut request = self.client.request(method.clone(), target.clone());
                if !secret.is_empty() {
                    request = if config.service == Service::Ai {
                        request.bearer_auth(secret)
                    } else {
                        request.basic_auth(&config.username, Some(secret))
                    };
                }
                if let Some(depth) = depth {
                    request=request.header("Depth",depth).header("Content-Type","application/xml; charset=utf-8").body("<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:getlastmodified/><d:getcontentlength/><d:getetag/><d:resourcetype/></d:prop></d:propfind>");
                } else if let Some(body) = &body {
                    request = request
                        .header("Content-Type", "application/json; charset=utf-8")
                        .body(body.clone());
                }
                let mut response = request.send().await.map_err(network_error)?;
                let status = response.status().as_u16();
                if response.status().is_redirection() {
                    // 写入/收费请求只允许保持方法的明确重定向，不做隐式重试或 POST→GET 改写。
                    if hop == MAX_REDIRECTS || !matches!(status, 307 | 308) {
                        return Err(Error::new("redirect_denied"));
                    }
                    let location = response
                        .headers()
                        .get("location")
                        .and_then(|v| v.to_str().ok())
                        .ok_or_else(|| Error::new("redirect_denied"))?;
                    target = config.redirect(&target, location)?;
                    continue;
                }
                if response
                    .content_length()
                    .is_some_and(|size| size > limit as u64)
                {
                    return Err(Error::new("response_too_large"));
                }
                let mut bytes = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(network_error)? {
                    if bytes.len().saturating_add(chunk.len()) > limit {
                        return Err(Error::new("response_too_large"));
                    }
                    bytes.extend_from_slice(&chunk);
                }
                // 保留格式降级所需错误语义，同时清除服务可能回显的秘密。
                let body = {
                    let text =
                        String::from_utf8(bytes).map_err(|_| Error::new("invalid_response"))?;
                    if secret.is_empty()
                        || (config.service == Service::Webdav && (200..300).contains(&status))
                    {
                        text
                    } else {
                        text.replace(
                            &STANDARD.encode(format!("{}:{secret}", config.username)),
                            "[REDACTED]",
                        )
                        .replace(secret, "[REDACTED]")
                    }
                };
                return Ok(Response { status, body });
            }
            Err(Error::new("redirect_denied"))
        };
        tokio::time::timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS), work)
            .await
            .map_err(|_| Error::new("timeout"))?
    }
}

fn validate_hrefs(config: &NormalizedConfig, xml: &str) -> Result<()> {
    use quick_xml::{events::Event, Reader};
    let mut reader = Reader::from_str(xml);
    loop {
        match reader
            .read_event()
            .map_err(|_| Error::new("invalid_response"))?
        {
            Event::Start(element) if element.local_name().as_ref() == "href" => {
                let raw = reader
                    .read_text(element.name())
                    .map_err(|_| Error::new("invalid_response"))?;
                let href = quick_xml::escape::unescape(&raw)
                    .map_err(|_| Error::new("invalid_response"))?;
                config.redirect(&config.directory, &href)?;
            }
            Event::DocType(_) => return Err(Error::new("invalid_response")),
            Event::Eof => return Ok(()),
            _ => {}
        }
    }
}
