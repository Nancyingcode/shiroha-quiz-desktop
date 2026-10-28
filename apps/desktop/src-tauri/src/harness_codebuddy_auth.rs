use crate::error::{Error, Result};
use crate::harness_codebuddy_wire::validate_request;
use crate::harness_proxy::SystemProxy;
use reqwest::header::{HeaderValue, ACCEPT, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_TYPE};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::Value;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;
use uuid::Uuid;

const ORIGIN: &str = "https://copilot.tencent.com";
const DOMAIN: &str = "copilot.tencent.com";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const CANCEL_INTERVAL: Duration = Duration::from_millis(50);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const AUTH_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MODEL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_AUTH_BYTES: usize = 128 * 1024;
const MAX_MODEL_BYTES: usize = 1024 * 1024;
const MAX_TOKEN_BYTES: usize = 16 * 1024;
const TOKEN_PENDING: i64 = 11217;
const ACCOUNT_PENDING: i64 = 12151;

// 每个客户端与 challenge 只属于本次登录；仅受控存储可导出恢复所需凭据。
pub struct Client {
    id: Uuid,
    http: reqwest::Client,
    #[cfg(test)]
    mock_origin: Option<Url>,
}

pub struct Challenge {
    owner: Uuid,
    state: String,
    login_url: String,
    deadline: Instant,
}

impl Challenge {
    pub fn login_url(&self) -> &str {
        &self.login_url
    }
}

pub struct Session {
    owner: Uuid,
    token: Option<Token>,
    identity: PersonalIdentity,
}

// 登录与请求共享同一客户端所有者，避免保存会话后丢弃其请求生命周期。
pub struct AuthenticatedAccount {
    client: Client,
    session: Session,
}

#[cfg(any(test, not(feature = "native-test")))]
#[derive(Clone, Copy)]
pub(crate) struct SessionExpiry {
    deadline: Instant,
    expires_at_ms: u64,
}

#[cfg(any(test, not(feature = "native-test")))]
impl SessionExpiry {
    pub(crate) fn is_expired(&self) -> bool {
        match Clock::now() {
            Ok(clock) => clock.monotonic >= self.deadline || clock.unix_ms >= self.expires_at_ms,
            Err(_) => true,
        }
    }
}

impl AuthenticatedAccount {
    pub(crate) fn saved(&self) -> Result<crate::harness_codebuddy_store::SavedSession> {
        let token = self
            .session
            .token
            .as_ref()
            .ok_or_else(|| Error::new("codebuddy_auth_expired"))?;
        token.require_valid()?;
        let saved = crate::harness_codebuddy_store::SavedSession {
            access_token: token.access_token.clone(),
            uid: self.session.identity.uid.clone(),
            domain: token.domain.clone(),
            expires_at_ms: token.expires_at_ms,
            saved_at_ms: Clock::now()?.unix_ms,
        };
        saved.validate()?;
        Ok(saved)
    }

    pub async fn model(&mut self, body: Value, cancel: &AtomicBool) -> Result<Vec<u8>> {
        self.client.model(&mut self.session, body, cancel).await
    }

    pub fn is_expired(&self) -> bool {
        self.session.is_expired()
    }

    pub fn invalidate(&mut self) {
        self.session.invalidate();
    }

    #[cfg(any(test, not(feature = "native-test")))]
    pub(crate) fn expiration(&self) -> Result<SessionExpiry> {
        let token = self
            .session
            .token
            .as_ref()
            .ok_or_else(|| Error::new("codebuddy_auth_expired"))?;
        token.require_valid()?;
        Ok(SessionExpiry {
            deadline: token.deadline,
            expires_at_ms: token.expires_at_ms,
        })
    }
}

pub struct PersonalIdentity {
    pub uid: String,
    pub nickname: Option<String>,
}

impl Session {
    pub fn identity(&self) -> &PersonalIdentity {
        &self.identity
    }

    pub fn is_expired(&self) -> bool {
        match (&self.token, Clock::now()) {
            (Some(token), Ok(clock)) => token.expired(&clock),
            _ => true,
        }
    }

    pub fn invalidate(&mut self) {
        self.token = None;
    }
}

impl Client {
    pub(crate) async fn restore(
        self,
        saved: crate::harness_codebuddy_store::SavedSession,
        cancel: &AtomicBool,
    ) -> Result<AuthenticatedAccount> {
        saved.validate()?;
        let clock = Clock::now()?;
        let remaining = saved
            .expires_at_ms
            .checked_sub(clock.unix_ms)
            .filter(|value| *value > 0)
            .ok_or_else(|| Error::new("codebuddy_auth_expired"))?;
        let deadline = clock
            .monotonic
            .checked_add(Duration::from_millis(remaining))
            .ok_or_else(|| Error::new("codebuddy_auth_expired"))?;
        let token = Token {
            access_token: saved.access_token,
            domain: saved.domain,
            expires_at_ms: saved.expires_at_ms,
            deadline,
        };
        let request_deadline = deadline.min(clock.monotonic + AUTH_REQUEST_TIMEOUT);
        ensure_active(cancel, request_deadline, Instant::now())?;
        let response = self
            .send(
                self.request(Endpoint::Accounts, None, Some(&token))?,
                ResponseKind::Json,
                cancel,
                request_deadline,
            )
            .await?;
        require_success_status(response.status)?;
        let account = Account {
            uid: saved.uid,
            kind: "personal".to_owned(),
            enterprise_id: None,
            nickname: None,
            plugin_enabled: None,
        };
        let identity = personal_identity(account, &response.body)?;
        ensure_active(cancel, request_deadline, Instant::now())?;
        token.require_valid()?;
        // 新进程必须重新建立 owner，绝对期限保持原值，不续算旧 expiresIn。
        let session = Session {
            owner: self.id,
            token: Some(token),
            identity,
        };
        Ok(AuthenticatedAccount {
            client: self,
            session,
        })
    }

    pub fn new() -> Result<Self> {
        Ok(Self {
            id: Uuid::new_v4(),
            http: http_client(crate::harness_proxy::current()?, true)?,
            #[cfg(test)]
            mock_origin: None,
        })
    }

    /// 仅创建本次登录挑战；调用者丢弃 future 可取消，单次请求另有 20 秒上限。
    pub async fn begin(&self) -> Result<Challenge> {
        let started = Instant::now();
        let cancel = AtomicBool::new(false);
        let request = self.request(Endpoint::State, None, None)?.body("{}");
        let response = self
            .send(
                request,
                ResponseKind::Json,
                &cancel,
                started + LOGIN_TIMEOUT,
            )
            .await?;
        require_success_status(response.status)?;
        parse_challenge(&response.body, self.id, started)
    }

    pub async fn complete(&self, challenge: Challenge, cancel: &AtomicBool) -> Result<Session> {
        ensure_active(cancel, challenge.deadline, Instant::now())?;
        if challenge.owner != self.id {
            return Err(Error::new("codebuddy_auth_challenge"));
        }
        let token = loop {
            self.wait_for_poll(cancel, challenge.deadline).await?;
            let request = self.request(Endpoint::Token, Some(&challenge.state), None)?;
            let response = self
                .send(request, ResponseKind::Json, cancel, challenge.deadline)
                .await?;
            match parse_token(response.status, &response.body, Clock::now()?)? {
                Poll::Pending => {}
                Poll::Ready(token) => break token,
            }
        };
        let account = loop {
            token.require_valid()?;
            self.wait_for_poll(cancel, challenge.deadline.min(token.deadline))
                .await?;
            let request = self.request(Endpoint::Account, Some(&challenge.state), Some(&token))?;
            let response = self
                .send(
                    request,
                    ResponseKind::Json,
                    cancel,
                    challenge.deadline.min(token.deadline),
                )
                .await?;
            match parse_account(response.status, &response.body)? {
                Poll::Pending => {}
                Poll::Ready(account) => break account,
            }
        };
        token.require_valid()?;
        let request = self.request(Endpoint::Accounts, None, Some(&token))?;
        let response = self
            .send(
                request,
                ResponseKind::Json,
                cancel,
                challenge.deadline.min(token.deadline),
            )
            .await?;
        require_success_status(response.status)?;
        let identity = personal_identity(account, &response.body)?;
        ensure_active(cancel, challenge.deadline, Instant::now())?;
        token.require_valid()?;
        Ok(Session {
            owner: self.id,
            token: Some(token),
            identity,
        })
    }

    pub async fn complete_account(
        self,
        challenge: Challenge,
        cancel: &AtomicBool,
    ) -> Result<AuthenticatedAccount> {
        let session = self.complete(challenge, cancel).await?;
        Ok(AuthenticatedAccount {
            client: self,
            session,
        })
    }

    pub async fn model(
        &self,
        session: &mut Session,
        body: Value,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>> {
        let deadline = Instant::now() + MODEL_TIMEOUT;
        ensure_active(cancel, deadline, Instant::now())?;
        let model = body
            .get("model")
            .and_then(Value::as_str)
            .filter(|model| crate::harness_codebuddy_execute::supports_model(model))
            .ok_or_else(|| Error::new("codebuddy_request_denied"))?;
        validate_request(&body, model)?;
        if session.owner != self.id {
            return Err(Error::new("codebuddy_auth_session"));
        }
        if session.is_expired() {
            session.invalidate();
            return Err(Error::new("codebuddy_auth_expired"));
        }
        let token = session
            .token
            .as_ref()
            .ok_or_else(|| Error::new("codebuddy_auth_expired"))?;
        let request = self
            .request(Endpoint::Model, None, Some(token))?
            .header("X-User-Id", &session.identity.uid)
            .json(&body);
        let invalidated = AtomicBool::new(false);
        let response = self
            .send(
                request,
                ResponseKind::EventStream(&invalidated),
                cancel,
                deadline.min(token.deadline),
            )
            .await;
        finish_model(session, response, &invalidated, cancel, deadline)
    }

    fn request(
        &self,
        endpoint: Endpoint,
        state: Option<&str>,
        token: Option<&Token>,
    ) -> Result<reqwest::RequestBuilder> {
        let mut url = Url::parse(ORIGIN).map_err(|_| Error::new("codebuddy_auth_url"))?;
        #[cfg(test)]
        if let Some(origin) = &self.mock_origin {
            url = origin.clone();
        }
        url.set_path(endpoint.path());
        match endpoint {
            Endpoint::State => {
                url.query_pairs_mut().append_pair("platform", "CLI");
            }
            Endpoint::Token | Endpoint::Account => {
                let state = state.ok_or_else(|| Error::new("codebuddy_auth_challenge"))?;
                url.query_pairs_mut().append_pair("state", state);
            }
            Endpoint::Accounts | Endpoint::Model => {}
        }
        let request = match endpoint {
            Endpoint::State | Endpoint::Model => self.http.post(url),
            Endpoint::Token | Endpoint::Account | Endpoint::Accounts => self.http.get(url),
        };
        let mut request = request
            .header(ACCEPT_ENCODING, "identity")
            .header(
                "X-Domain",
                token.map_or(DOMAIN, |token| token.domain.as_str()),
            )
            .header("X-No-User-Id", "true")
            .header("X-No-Enterprise-Id", "true")
            .header("X-No-Department-Info", "true")
            .header("X-No-Tenant-Id", "true");
        if let Some(token) = token {
            let mut authorization =
                HeaderValue::from_str(&format!("Bearer {}", token.access_token))
                    .map_err(|_| Error::new("codebuddy_auth_response"))?;
            authorization.set_sensitive(true);
            request = request.header(AUTHORIZATION, authorization);
        } else {
            request = request.header("X-No-Authorization", "true");
        }
        if matches!(endpoint, Endpoint::Model) {
            request = request
                .header(ACCEPT, "text/event-stream")
                .timeout(MODEL_TIMEOUT);
        } else {
            request = request
                .header(ACCEPT, "application/json")
                .timeout(AUTH_REQUEST_TIMEOUT);
        }
        if matches!(endpoint, Endpoint::State | Endpoint::Model) {
            request = request.header(CONTENT_TYPE, "application/json");
        }
        Ok(request)
    }

    async fn send(
        &self,
        request: reqwest::RequestBuilder,
        kind: ResponseKind<'_>,
        cancel: &AtomicBool,
        deadline: Instant,
    ) -> Result<Response> {
        guarded(
            async {
                let mut response = request.send().await.map_err(network_error)?;
                let status = response.status().as_u16();
                if matches!(status, 401 | 403) {
                    return Err(kind.expired());
                }
                require_safe_status(status)?;
                if matches!(kind, ResponseKind::EventStream(_)) {
                    require_success_status(status)?;
                }
                let content_type = response
                    .headers()
                    .get(CONTENT_TYPE)
                    .and_then(|header| header.to_str().ok())
                    .and_then(|header| header.split(';').next());
                let expected_type = content_type
                    .is_some_and(|value| value.trim().eq_ignore_ascii_case(kind.mime()));
                let model_error_json = matches!(kind, ResponseKind::EventStream(_))
                    && content_type
                        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
                if !expected_type && !model_error_json {
                    return Err(Error::new("codebuddy_auth_response"));
                }
                let limit = if model_error_json {
                    MAX_AUTH_BYTES
                } else {
                    kind.limit()
                };
                if response
                    .content_length()
                    .is_some_and(|length| length > limit as u64)
                {
                    return Err(Error::new("response_too_large"));
                }
                let mut body = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(network_error)? {
                    if chunk.len() > limit.saturating_sub(body.len()) {
                        return Err(Error::new("response_too_large"));
                    }
                    body.extend_from_slice(&chunk);
                }
                if model_error_json {
                    let error: AuthenticationError = serde_json::from_slice(&body)
                        .map_err(|_| Error::new("codebuddy_auth_response"))?;
                    return if matches!(error.code, Some(401 | 403)) {
                        Err(kind.expired())
                    } else {
                        Err(Error::new("codebuddy_auth_response"))
                    };
                }
                Ok(Response { status, body })
            },
            cancel,
            deadline,
        )
        .await
    }

    async fn wait_for_poll(&self, cancel: &AtomicBool, deadline: Instant) -> Result<()> {
        let interval = POLL_INTERVAL;
        #[cfg(test)]
        let interval = if self.mock_origin.is_some() {
            Duration::from_millis(1)
        } else {
            interval
        };
        guarded(
            async {
                tokio::time::sleep(interval).await;
                Ok(())
            },
            cancel,
            deadline,
        )
        .await
    }
}

struct Clock {
    monotonic: Instant,
    unix_ms: u64,
}

impl Clock {
    fn now() -> Result<Self> {
        let unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|duration| u64::try_from(duration.as_millis()).ok())
            .ok_or_else(|| Error::new("codebuddy_auth_expired"))?;
        Ok(Self {
            monotonic: Instant::now(),
            unix_ms,
        })
    }
}

struct Token {
    access_token: String,
    domain: String,
    expires_at_ms: u64,
    deadline: Instant,
}

impl Token {
    fn expired(&self, clock: &Clock) -> bool {
        clock.monotonic >= self.deadline || clock.unix_ms >= self.expires_at_ms
    }

    fn require_valid(&self) -> Result<()> {
        if self.expired(&Clock::now()?) {
            Err(Error::new("codebuddy_auth_expired"))
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Copy)]
enum Endpoint {
    State,
    Token,
    Account,
    Accounts,
    Model,
}

impl Endpoint {
    fn path(self) -> &'static str {
        match self {
            Self::State => "/v2/plugin/auth/state",
            Self::Token => "/v2/plugin/auth/token",
            Self::Account => "/v2/plugin/login/account",
            Self::Accounts => "/v2/plugin/accounts",
            Self::Model => "/v2/chat/completions",
        }
    }
}

#[derive(Clone, Copy)]
enum ResponseKind<'a> {
    Json,
    EventStream(&'a AtomicBool),
}

impl ResponseKind<'_> {
    fn mime(self) -> &'static str {
        match self {
            Self::Json => "application/json",
            Self::EventStream(_) => "text/event-stream",
        }
    }

    fn limit(self) -> usize {
        match self {
            Self::Json => MAX_AUTH_BYTES,
            Self::EventStream(_) => MAX_MODEL_BYTES,
        }
    }

    fn expired(self) -> Error {
        if let Self::EventStream(invalidated) = self {
            // 已观察到的服务端失效不能被同时到达的取消结果覆盖。
            invalidated.store(true, Ordering::Release);
        }
        Error::new("codebuddy_auth_expired")
    }
}

struct Response {
    status: u16,
    body: Vec<u8>,
}

#[derive(Deserialize)]
struct AuthenticationError {
    code: Option<i64>,
}

fn finish_model(
    session: &mut Session,
    response: Result<Response>,
    invalidated: &AtomicBool,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<Vec<u8>> {
    let was_rejected = invalidated.load(Ordering::Acquire)
        || response
            .as_ref()
            .is_err_and(|error| error.code == "codebuddy_auth_expired");
    if was_rejected || session.is_expired() {
        session.invalidate();
        ensure_active(cancel, deadline, Instant::now())?;
        return Err(Error::new("codebuddy_auth_expired"));
    }
    ensure_active(cancel, deadline, Instant::now())?;
    Ok(response?.body)
}

enum Poll<T> {
    Pending,
    Ready(T),
}

#[derive(Deserialize)]
struct Envelope<T> {
    code: Option<i64>,
    data: Option<T>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateData {
    state: String,
    auth_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenData {
    access_token: String,
    domain: Option<String>,
    expires_at: Option<u64>,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    uid: String,
    #[serde(rename = "type")]
    kind: String,
    enterprise_id: Option<String>,
    nickname: Option<String>,
    plugin_enabled: Option<bool>,
}

#[derive(Deserialize)]
struct AccountsData {
    accounts: Vec<Account>,
}

fn parse_challenge(bytes: &[u8], owner: Uuid, started: Instant) -> Result<Challenge> {
    let data: StateData = success_data(bytes)?;
    let state_is_safe = !data.state.is_empty()
        && data.state.len() <= 256
        && data
            .state
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte));
    if !state_is_safe {
        return Err(Error::new("codebuddy_auth_response"));
    }
    let login_url = format!("{ORIGIN}/login?platform=CLI&state={}", data.state);
    let reordered = format!("{ORIGIN}/login?state={}&platform=CLI", data.state);
    // 仅接受匿名初始化已证实的登录页，不复用厂商对未知域原样放行的行为。
    if data.auth_url != login_url && data.auth_url != reordered {
        return Err(Error::new("codebuddy_auth_url"));
    }
    Ok(Challenge {
        owner,
        state: data.state,
        login_url,
        deadline: started + LOGIN_TIMEOUT,
    })
}

fn parse_token(status: u16, bytes: &[u8], clock: Clock) -> Result<Poll<Token>> {
    let data: TokenData = match poll_data(status, bytes, TOKEN_PENDING)? {
        Poll::Pending => return Ok(Poll::Pending),
        Poll::Ready(data) => data,
    };
    let token_is_safe = !data.access_token.is_empty()
        && data.access_token.len() <= MAX_TOKEN_BYTES
        && data
            .access_token
            .bytes()
            .all(|byte| byte.is_ascii_graphic());
    if !token_is_safe {
        return Err(Error::new("codebuddy_auth_token_shape"));
    }
    let domain = match data.domain {
        Some(domain) if !domain.is_empty() => domain,
        _ => DOMAIN.to_owned(),
    };
    // domain 是固定 TLS 服务返回的授权上下文头，不能选择目的 URL、代理或运行环境。
    if domain.len() > 256 || !domain.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(Error::new("codebuddy_auth_token_domain"));
    }
    let relative_expiry = match data.expires_in {
        Some(seconds) => Some(
            seconds
                .checked_mul(1000)
                .and_then(|duration| clock.unix_ms.checked_add(duration))
                .ok_or_else(|| Error::new("codebuddy_auth_response"))?,
        ),
        None => None,
    };
    // 两种期限同时出现时取较早者，避免墙上时钟调整或矛盾字段延长会话。
    let expires_at_ms = match (data.expires_at, relative_expiry) {
        (Some(absolute), Some(relative)) => absolute.min(relative),
        (Some(expiry), None) | (None, Some(expiry)) => expiry,
        (None, None) => return Err(Error::new("codebuddy_auth_token_expiry")),
    };
    let remaining = expires_at_ms
        .checked_sub(clock.unix_ms)
        .filter(|remaining| *remaining > 0)
        .ok_or_else(|| Error::new("codebuddy_auth_expired"))?;
    let deadline = clock
        .monotonic
        .checked_add(Duration::from_millis(remaining))
        .ok_or_else(|| Error::new("codebuddy_auth_response"))?;
    Ok(Poll::Ready(Token {
        access_token: data.access_token,
        domain,
        expires_at_ms,
        deadline,
    }))
}

fn parse_account(status: u16, bytes: &[u8]) -> Result<Poll<Account>> {
    let account = poll_data(status, bytes, ACCOUNT_PENDING)?;
    if let Poll::Ready(account) = &account {
        require_personal(account)?;
    }
    Ok(account)
}

fn personal_identity(account: Account, bytes: &[u8]) -> Result<PersonalIdentity> {
    require_personal(&account)?;
    let data: AccountsData = success_data(bytes)?;
    let mut matches = data.accounts.into_iter().filter(|candidate| {
        candidate.uid == account.uid
            && candidate.plugin_enabled == Some(true)
            && require_personal(candidate).is_ok()
    });
    let matching = matches
        .next()
        .ok_or_else(|| Error::new("codebuddy_auth_personal_required"))?;
    if matches.next().is_some() {
        return Err(Error::new("codebuddy_auth_personal_required"));
    }
    Ok(PersonalIdentity {
        uid: account.uid,
        nickname: matching.nickname.or(account.nickname),
    })
}

fn require_personal(account: &Account) -> Result<()> {
    let is_personal = account.kind.trim().eq_ignore_ascii_case("personal")
        && account
            .enterprise_id
            .as_deref()
            .is_none_or(|enterprise| enterprise.trim().is_empty());
    let uid_is_safe = !account.uid.is_empty()
        && account.uid.len() <= 256
        && account.uid.bytes().all(|byte| byte.is_ascii_graphic());
    let nickname_is_safe = account
        .nickname
        .as_deref()
        .is_none_or(|nickname| nickname.len() <= 1024 && !nickname.chars().any(char::is_control));
    if !is_personal || !uid_is_safe || !nickname_is_safe {
        return Err(Error::new("codebuddy_auth_personal_required"));
    }
    Ok(())
}

fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<Envelope<T>> {
    if bytes.len() > MAX_AUTH_BYTES {
        return Err(Error::new("response_too_large"));
    }
    let envelope: Envelope<T> =
        serde_json::from_slice(bytes).map_err(|_| Error::new("codebuddy_auth_response"))?;
    if matches!(envelope.code, Some(401 | 403)) {
        return Err(Error::new("codebuddy_auth_expired"));
    }
    Ok(envelope)
}

fn success_data<T: DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    let envelope = decode(bytes)?;
    if envelope.code.is_some_and(|code| code != 0) {
        return Err(Error::new("codebuddy_auth_response"));
    }
    envelope
        .data
        .ok_or_else(|| Error::new("codebuddy_auth_response"))
}

fn poll_data<T: DeserializeOwned>(status: u16, bytes: &[u8], pending: i64) -> Result<Poll<T>> {
    require_safe_status(status)?;
    let waiting: Envelope<Value> = decode(bytes)?;
    if waiting.code == Some(pending) {
        // 官方等待态可带空对象；成功字段只能在脱离等待态后严格反序列化。
        let has_no_result = waiting
            .data
            .as_ref()
            .is_none_or(|data| data.as_object().is_some_and(serde_json::Map::is_empty));
        return if has_no_result {
            Ok(Poll::Pending)
        } else {
            Err(Error::new("codebuddy_auth_response"))
        };
    }
    require_success_status(status)?;
    let envelope = decode(bytes)?;
    if envelope.code.is_some_and(|code| code != 0) {
        return Err(Error::new("codebuddy_auth_response"));
    }
    envelope
        .data
        .map(Poll::Ready)
        .ok_or_else(|| Error::new("codebuddy_auth_response"))
}

fn require_safe_status(status: u16) -> Result<()> {
    match status {
        401 | 403 => Err(Error::new("codebuddy_auth_expired")),
        300..=399 => Err(Error::new("codebuddy_auth_url")),
        _ => Ok(()),
    }
}

fn require_success_status(status: u16) -> Result<()> {
    require_safe_status(status)?;
    if status == 200 {
        Ok(())
    } else {
        Err(Error::new("codebuddy_auth_response"))
    }
}

fn ensure_active(cancel: &AtomicBool, deadline: Instant, now: Instant) -> Result<()> {
    if cancel.load(Ordering::Acquire) {
        return Err(Error::new("cancelled"));
    }
    if now >= deadline {
        return Err(Error::new("timeout"));
    }
    Ok(())
}

async fn guarded<T>(
    future: impl Future<Output = Result<T>>,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<T> {
    ensure_active(cancel, deadline, Instant::now())?;
    let cancelled = async {
        loop {
            if cancel.load(Ordering::Acquire) {
                return;
            }
            tokio::time::sleep(CANCEL_INTERVAL).await;
        }
    };
    // 取消先于截止和成功结果；离开 select 会丢弃 HTTP future，停止后续网络工作。
    let result = tokio::select! {
        biased;
        _ = cancelled => Err(Error::new("cancelled")),
        _ = tokio::time::sleep_until(deadline.into()) => Err(Error::new("timeout")),
        result = future => result,
    };
    ensure_active(cancel, deadline, Instant::now())?;
    result
}

fn http_client(proxy: SystemProxy, https_only: bool) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .https_only(https_only)
        // 路由只取本次系统静态代理快照，不采纳进程的代理环境变量。
        .no_proxy()
        .proxy(reqwest::Proxy::custom(move |url| proxy.for_url(url)))
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent("Shiroha-Quiz-CodeBuddy-Auth")
        .build()
        .map_err(network_error)
}

fn network_error(error: reqwest::Error) -> Error {
    Error::new(if error.is_timeout() {
        "timeout"
    } else {
        "codebuddy_auth_network"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{mpsc, Arc};
    use std::thread;

    const STATE: &str = "00000000-0000-4000-8000-000000000001";
    const NOW_MS: u64 = 1_700_000_000_000;

    fn clock() -> Clock {
        Clock {
            monotonic: Instant::now(),
            unix_ms: NOW_MS,
        }
    }

    fn bytes(value: Value) -> Vec<u8> {
        serde_json::to_vec(&value).unwrap()
    }

    fn failure_code<T>(result: Result<T>) -> &'static str {
        result.err().unwrap().code
    }

    fn account() -> Account {
        serde_json::from_value(json!({"uid":"fixture-user", "type":"personal"})).unwrap()
    }

    fn saved_session() -> crate::harness_codebuddy_store::SavedSession {
        let now = Clock::now().unwrap().unix_ms;
        crate::harness_codebuddy_store::SavedSession {
            access_token: "fixture-secret".into(),
            uid: "fixture-user".into(),
            domain: DOMAIN.into(),
            expires_at_ms: now + 60_000,
            saved_at_ms: now,
        }
    }

    #[test]
    fn restored_account_uses_one_identity_request_and_a_new_owner_without_extending_expiry() {
        let fixture = Fixture::new(vec![Reply::json(
            json!({"data":{"accounts":[{"uid":"fixture-user","type":"personal","pluginEnabled":true}]}}),
        )]);
        let client = mock_client(fixture.client.mock_origin.as_ref().unwrap().as_str());
        let owner = client.id;
        let saved = saved_session();
        let expiry = saved.expires_at_ms;
        let restored = run(client.restore(saved, &AtomicBool::new(false))).unwrap();
        assert_eq!(restored.session.owner, owner);
        assert_ne!(owner, fixture.client.id);
        assert_eq!(restored.saved().unwrap().expires_at_ms, expiry);
        let requests: Vec<_> = fixture.received.try_iter().collect();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET /v2/plugin/accounts "));
        assert!(!requests[0].contains("/chat/"));
    }

    #[test]
    fn restore_rejects_expiry_clock_rollback_and_cancellation_before_network() {
        let fixture = Fixture::new(vec![]);
        for (expired, rollback, cancelled) in [
            (true, false, false),
            (false, true, false),
            (false, false, true),
        ] {
            let client = mock_client(fixture.client.mock_origin.as_ref().unwrap().as_str());
            let mut saved = saved_session();
            if expired {
                saved.expires_at_ms = 0;
            }
            if rollback {
                saved.saved_at_ms += 120_000;
            }
            assert!(run(client.restore(saved, &AtomicBool::new(cancelled))).is_err());
        }
        assert_eq!(fixture.received.try_iter().count(), 0);
    }

    #[test]
    fn restore_requires_the_same_unique_enabled_personal_identity() {
        for accounts in [
            json!([]),
            json!([{"uid":"another","type":"personal","pluginEnabled":true}]),
            json!([{"uid":"fixture-user","type":"enterprise","pluginEnabled":true}]),
            json!([{"uid":"fixture-user","type":"personal","pluginEnabled":false}]),
            json!([{"uid":"fixture-user","type":"personal","pluginEnabled":true},{"uid":"fixture-user","type":"personal","pluginEnabled":true}]),
        ] {
            let fixture = Fixture::new(vec![Reply::json(json!({"data":{"accounts":accounts}}))]);
            let client = mock_client(fixture.client.mock_origin.as_ref().unwrap().as_str());
            assert_eq!(
                failure_code(run(client.restore(saved_session(), &AtomicBool::new(false)))),
                "codebuddy_auth_personal_required"
            );
        }
    }

    #[test]
    fn challenge_binds_only_the_observed_login_page_to_matching_state() {
        let owner = Uuid::new_v4();
        let started = Instant::now();
        let url = format!("{ORIGIN}/login?platform=CLI&state={STATE}");
        let payload = bytes(json!({"code":0,"data":{"state":STATE,"authUrl":url}}));
        let challenge = parse_challenge(&payload, owner, started).unwrap();
        assert_eq!(challenge.login_url(), url);
        assert_eq!(challenge.owner, owner);
        assert_eq!(challenge.state, STATE);
        assert_eq!(challenge.deadline, started + LOGIN_TIMEOUT);
    }

    #[test]
    fn login_url_rejects_unknown_authority_path_parameters_and_state() {
        let urls = [
            format!("https://www.workbuddy.cn/login?platform=CLI&state={STATE}"),
            format!("http://copilot.tencent.com/login?platform=CLI&state={STATE}"),
            format!("https://copilot.tencent.com:8443/login?platform=CLI&state={STATE}"),
            format!("https://user@copilot.tencent.com/login?platform=CLI&state={STATE}"),
            format!("{ORIGIN}/other/../login?platform=CLI&state={STATE}"),
            format!("{ORIGIN}/login/?platform=CLI&state={STATE}"),
            format!("{ORIGIN}/login?platform=CLI&state={STATE}#other"),
            format!("{ORIGIN}/login?platform=CLI&state={STATE}&redirect=https://example.invalid"),
            format!("{ORIGIN}/login?platform=CLI&platform=CLI&state={STATE}"),
            format!("{ORIGIN}/login?platform=WorkBuddy&state={STATE}"),
            format!("{ORIGIN}/login?platform=CLI&state={STATE}x"),
            format!("{ORIGIN}/login?%70latform=CLI&state={STATE}"),
        ];
        for url in urls {
            let payload = bytes(json!({"code":0,"data":{"state":STATE,"authUrl":url}}));
            assert_eq!(
                failure_code(parse_challenge(&payload, Uuid::new_v4(), Instant::now())),
                "codebuddy_auth_url"
            );
        }
    }

    #[test]
    fn malformed_or_duplicate_authentication_fields_never_become_a_challenge() {
        for payload in [
            br#"{"data":{"state":12,"authUrl":"https://copilot.tencent.com/login"}}"#.as_slice(),
            br#"{"code":0,"code":0,"data":null}"#.as_slice(),
            br#"{"data":{"state":"a","state":"b","authUrl":"x"}}"#.as_slice(),
            br#"{"code":11217,"data":null}"#.as_slice(),
        ] {
            assert!(parse_challenge(payload, Uuid::new_v4(), Instant::now()).is_err());
        }
        assert_eq!(
            failure_code(parse_challenge(
                &vec![b' '; MAX_AUTH_BYTES + 1],
                Uuid::new_v4(),
                Instant::now()
            )),
            "response_too_large"
        );
    }

    #[test]
    fn only_the_known_phase_specific_codes_keep_polling() {
        assert!(matches!(
            parse_token(200, br#"{"code":11217,"data":null}"#, clock()).unwrap(),
            Poll::Pending
        ));
        assert!(matches!(
            parse_token(400, br#"{"code":11217}"#, clock()).unwrap(),
            Poll::Pending
        ));
        assert!(matches!(
            parse_account(200, br#"{"code":12151}"#).unwrap(),
            Poll::Pending
        ));
        for status in [401, 403] {
            assert_eq!(
                failure_code(parse_token(status, br#"{"code":11217}"#, clock())),
                "codebuddy_auth_expired"
            );
            assert_eq!(
                failure_code(parse_account(status, br#"{"code":12151}"#)),
                "codebuddy_auth_expired"
            );
        }
        for body in [
            br#"{"code":12151}"#.as_slice(),
            br#"{"code":9}"#.as_slice(),
            br#"{"code":"11217"}"#.as_slice(),
            br#"{"code":11217,"data":{"accessToken":"fixture","expiresIn":60}}"#.as_slice(),
        ] {
            assert!(parse_token(200, body, clock()).is_err());
        }
    }

    #[test]
    fn auth_contract_allows_empty_waiting_data_without_weakening_success_fields() {
        assert!(matches!(
            parse_token(200, br#"{"code":11217,"data":{}}"#, clock()).unwrap(),
            Poll::Pending
        ));
        assert!(matches!(
            parse_account(200, br#"{"code":12151,"data":{}}"#).unwrap(),
            Poll::Pending
        ));
        assert!(parse_token(200, br#"{"code":0,"data":{}}"#, clock()).is_err());
        assert!(parse_account(200, br#"{"code":0,"data":{}}"#).is_err());
        assert!(parse_token(200, br#"{"code":12151,"data":{}}"#, clock()).is_err());
    }

    #[test]
    fn auth_contract_empty_domain_keeps_the_fixed_domestic_endpoint() {
        let payload = bytes(
            json!({"code":0,"data":{"accessToken":"fixture-secret","expiresIn":60,"domain":""}}),
        );
        let Poll::Ready(token) = parse_token(200, &payload, clock()).unwrap() else {
            panic!("expected usable token")
        };
        let client = mock_client("http://127.0.0.1:1");
        let request = client
            .request(Endpoint::Accounts, None, Some(&token))
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(request.headers()["X-Domain"], DOMAIN);
        assert_eq!(request.url().host_str(), Some("127.0.0.1"));
        for domain in [" ", "bad\r\nheader", "two words"] {
            let payload = bytes(
                json!({"data":{"accessToken":"fixture-secret","expiresIn":60,"domain":domain}}),
            );
            assert!(parse_token(200, &payload, clock()).is_err());
        }
    }

    #[test]
    fn authentication_domain_is_only_a_bounded_header_and_never_an_outbound_target() {
        let client = Client {
            id: Uuid::new_v4(),
            http: http_client(SystemProxy::direct(), true).unwrap(),
            mock_origin: None,
        };
        for domain in [
            "fixture-context.invalid",
            "https://metadata.invalid/context",
        ] {
            let payload = bytes(
                json!({"data":{"accessToken":"fixture-secret","expiresIn":60,"domain":domain}}),
            );
            let Poll::Ready(token) = parse_token(200, &payload, clock()).unwrap() else {
                panic!("expected token")
            };
            for (endpoint, path) in [
                (Endpoint::Accounts, "/v2/plugin/accounts"),
                (Endpoint::Model, "/v2/chat/completions"),
            ] {
                let request = client
                    .request(endpoint, None, Some(&token))
                    .unwrap()
                    .build()
                    .unwrap();
                assert_eq!(request.url().as_str(), format!("{ORIGIN}{path}"));
                assert_eq!(request.headers()["X-Domain"], domain);
            }
        }
        for domain in [
            " ".to_owned(),
            "context name".to_owned(),
            "x\r\nCookie: secret".to_owned(),
            "x\tname".to_owned(),
            "域名".to_owned(),
            "x".repeat(257),
        ] {
            let payload = bytes(
                json!({"data":{"accessToken":"fixture-secret","expiresIn":60,"domain":domain}}),
            );
            assert_eq!(
                failure_code(parse_token(200, &payload, clock())),
                "codebuddy_auth_token_domain"
            );
        }
    }

    #[test]
    fn token_lifetime_requires_bounded_valid_fields_and_never_defaults_to_infinite() {
        let now = clock();
        let monotonic = now.monotonic;
        let payload = bytes(
            json!({"code":0,"data":{"accessToken":"fixture-secret","domain":DOMAIN,"expiresIn":60}}),
        );
        let Poll::Ready(token) = parse_token(200, &payload, now).unwrap() else {
            panic!("expected usable token")
        };
        assert_eq!(token.expires_at_ms, NOW_MS + 60_000);
        assert_eq!(token.deadline, monotonic + Duration::from_secs(60));
        for fields in [
            json!({"accessToken":"fixture"}),
            json!({"accessToken":"fixture","expiresIn":0}),
            json!({"accessToken":"fixture","expiresIn":-1}),
            json!({"accessToken":"fixture","expiresIn":"60"}),
            json!({"accessToken":"fixture","expiresAt":NOW_MS}),
            json!({"accessToken":"fixture\r\nX-Other: secret","expiresIn":60}),
            json!({"accessToken":"fixture","expiresIn":60,"domain":"bad domain"}),
        ] {
            let payload = bytes(json!({"code":0,"data":fields}));
            assert!(parse_token(200, &payload, clock()).is_err());
        }
    }

    #[test]
    fn account_identity_must_match_one_enabled_personal_account() {
        let payload = bytes(
            json!({"code":0,"data":{"accounts":[{"uid":"fixture-user","type":"personal","pluginEnabled":true,"nickname":"测试用户"}]}}),
        );
        let identity = personal_identity(account(), &payload).unwrap();
        assert_eq!(identity.uid, "fixture-user");
        assert_eq!(identity.nickname.as_deref(), Some("测试用户"));
        for accounts in [
            json!([]),
            json!([{"uid":"other-user","type":"personal","pluginEnabled":true}]),
            json!([{"uid":"fixture-user","type":"personal","pluginEnabled":false}]),
            json!([{"uid":"fixture-user","type":"personal"}]),
            json!([{"uid":"fixture-user","type":"personal","enterpriseId":"enterprise","pluginEnabled":true}]),
            json!([{"uid":"fixture-user","type":"unknown","pluginEnabled":true}]),
            json!([{"uid":"fixture-user","type":"personal","pluginEnabled":true},{"uid":"fixture-user","type":"personal","pluginEnabled":true}]),
        ] {
            let payload = bytes(json!({"code":0,"data":{"accounts":accounts}}));
            assert_eq!(
                failure_code(personal_identity(account(), &payload)),
                "codebuddy_auth_personal_required"
            );
        }
        for kind in ["enterprise", "unknown", ""] {
            let mut selected = account();
            selected.kind = kind.to_owned();
            assert!(personal_identity(selected, &payload).is_err());
        }
    }

    #[test]
    fn cancellation_wins_over_timeout_and_cannot_be_replaced_by_success() {
        let now = Instant::now();
        let cancel = AtomicBool::new(false);
        assert!(ensure_active(&cancel, now + Duration::from_secs(1), now).is_ok());
        assert_eq!(failure_code(ensure_active(&cancel, now, now)), "timeout");
        cancel.store(true, Ordering::Release);
        assert_eq!(failure_code(ensure_active(&cancel, now, now)), "cancelled");
    }

    #[test]
    fn token_uses_the_earlier_expiry_and_either_clock_can_end_its_lifetime() {
        let clock = clock();
        let monotonic = clock.monotonic;
        let payload = bytes(
            json!({"data":{"accessToken":"fixture","expiresAt":NOW_MS+30_000,"expiresIn":60}}),
        );
        let Poll::Ready(token) = parse_token(200, &payload, clock).unwrap() else {
            panic!("expected token")
        };
        assert_eq!(token.deadline, monotonic + Duration::from_secs(30));
        assert!(token.expired(&Clock {
            monotonic,
            unix_ms: NOW_MS + 30_000,
        }));
        assert!(token.expired(&Clock {
            monotonic: monotonic + Duration::from_secs(30),
            unix_ms: NOW_MS - 1_000,
        }));
    }

    #[test]
    fn a_cancelled_success_and_an_expired_challenge_never_start_the_next_step() {
        let cancel = AtomicBool::new(false);
        let result = run(guarded(
            async {
                cancel.store(true, Ordering::Release);
                Ok(())
            },
            &cancel,
            Instant::now() + Duration::from_secs(1),
        ));
        assert_eq!(failure_code(result), "cancelled");
        let client = mock_client("http://127.0.0.1:1");
        let other_client = mock_client("http://127.0.0.1:1");
        let make_challenge = || Challenge {
            owner: client.id,
            state: STATE.to_owned(),
            login_url: format!("{ORIGIN}/login?platform=CLI&state={STATE}"),
            deadline: Instant::now() + LOGIN_TIMEOUT,
        };
        let not_cancelled = AtomicBool::new(false);
        assert_eq!(
            failure_code(run(other_client.complete(make_challenge(), &not_cancelled))),
            "codebuddy_auth_challenge"
        );
        let mut expired = make_challenge();
        expired.deadline = Instant::now();
        assert_eq!(
            failure_code(run(client.complete(expired, &not_cancelled))),
            "timeout"
        );
    }

    #[test]
    fn memory_login_polls_fixed_paths_and_returns_only_the_selected_personal_identity() {
        let fixture = Fixture::new(vec![
            Reply::json(
                json!({"code":0,"data":{"state":STATE,"authUrl":format!("{ORIGIN}/login?platform=CLI&state={STATE}")}}),
            ),
            Reply::json(json!({"code":11217,"data":{}})),
            Reply::json(
                json!({"code":0,"data":{"accessToken":"fixture-secret","expiresIn":60,"domain":"","refreshToken":"discarded-refresh"}}),
            ),
            Reply::json(json!({"code":12151,"data":{}})),
            Reply::json(json!({"code":0,"data":{"uid":"fixture-user","type":"personal"}})),
            Reply::json(
                json!({"code":0,"data":{"accounts":[{"uid":"fixture-user","type":"personal","pluginEnabled":true,"nickname":"合成账户"}]}}),
            ),
        ]);
        let mut session = run(async {
            let challenge = fixture.client.begin().await.unwrap();
            assert_eq!(
                challenge.login_url(),
                format!("{ORIGIN}/login?platform=CLI&state={STATE}")
            );
            fixture
                .client
                .complete(challenge, &AtomicBool::new(false))
                .await
                .unwrap()
        });
        assert_eq!(session.identity().uid, "fixture-user");
        assert_eq!(session.identity().nickname.as_deref(), Some("合成账户"));
        assert!(!session.is_expired());
        let requests: Vec<_> = fixture.received.try_iter().collect();
        assert_eq!(requests.len(), 6);
        assert!(requests[0].starts_with("POST /v2/plugin/auth/state?platform=CLI HTTP/1.1\r\n"));
        assert!(requests[0].ends_with("\r\n\r\n{}"));
        for request in &requests[1..3] {
            assert!(request.starts_with(&format!(
                "GET /v2/plugin/auth/token?state={STATE} HTTP/1.1\r\n"
            )));
        }
        for request in &requests[3..5] {
            assert!(request.starts_with(&format!(
                "GET /v2/plugin/login/account?state={STATE} HTTP/1.1\r\n"
            )));
        }
        assert!(requests[5].starts_with("GET /v2/plugin/accounts HTTP/1.1\r\n"));
        for (index, request) in requests.iter().enumerate() {
            let headers = request.to_ascii_lowercase();
            assert!(!headers.contains("\r\ncookie:"));
            assert!(!headers.contains("discarded-refresh"));
            assert!(!headers.contains("\r\nx-enterprise-id:"));
            assert!(!headers.contains("\r\nx-user-id:"));
            assert_eq!(
                headers.contains("\r\nauthorization: bearer fixture-secret\r\n"),
                index >= 3
            );
        }
        session.invalidate();
        assert!(session.token.is_none());
        assert!(session.is_expired());
    }

    #[test]
    fn account_expiration_tracks_both_clocks_without_borrowing_the_account() {
        let client = mock_client("http://127.0.0.1:1");
        let session = test_session(client.id);
        let mut account = AuthenticatedAccount { client, session };
        let expiration = account.expiration().unwrap();
        assert!(!expiration.is_expired());
        let mut monotonic_expired = expiration;
        monotonic_expired.deadline = Instant::now();
        assert!(monotonic_expired.is_expired());
        let mut wall_clock_expired = expiration;
        wall_clock_expired.expires_at_ms = 0;
        assert!(wall_clock_expired.is_expired());
        account.invalidate();
        assert_eq!(failure_code(account.expiration()), "codebuddy_auth_expired");
    }

    #[test]
    fn account_ownership_keeps_the_login_client_for_model_requests() {
        let sse = "data: {\"id\":\"fixture\",\"choices\":[{\"delta\":{\"content\":\"test\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        let mut replies = account_login_replies();
        replies.push(Reply::http(200, "text/event-stream", sse));
        let fixture = Fixture::new(replies);
        let client = mock_client(fixture.client.mock_origin.as_ref().unwrap().as_str());
        run(async {
            let cancel = AtomicBool::new(false);
            let challenge = client.begin().await.unwrap();
            let mut account = client.complete_account(challenge, &cancel).await.unwrap();
            assert!(!account.is_expired());
            assert_eq!(
                account.model(model_body(), &cancel).await.unwrap(),
                sse.as_bytes()
            );
            account.invalidate();
            assert!(account.is_expired());
            assert_eq!(
                failure_code(account.model(model_body(), &cancel).await),
                "codebuddy_auth_expired"
            );
        });
        let requests: Vec<_> = fixture.received.try_iter().collect();
        assert_eq!(requests.len(), 5);
        assert!(requests[4].starts_with("POST /v2/chat/completions HTTP/1.1\r\n"));
        let headers = requests[4].to_ascii_lowercase();
        assert!(headers.contains("\r\nauthorization: bearer fixture-secret\r\n"));
        assert!(headers.contains("\r\nx-user-id: fixture-user\r\n"));
    }

    #[test]
    fn account_ownership_invalidates_after_an_unauthorized_model_response() {
        for reply in [
            Reply::http(401, "application/json", "{}"),
            Reply::json(json!({"code":403,"data":{}})),
        ] {
            let mut replies = account_login_replies();
            replies.push(reply);
            let fixture = Fixture::new(replies);
            let client = mock_client(fixture.client.mock_origin.as_ref().unwrap().as_str());
            run(async {
                let cancel = AtomicBool::new(false);
                let challenge = client.begin().await.unwrap();
                let mut account = client.complete_account(challenge, &cancel).await.unwrap();
                for _ in 0..2 {
                    assert_eq!(
                        failure_code(account.model(model_body(), &cancel).await),
                        "codebuddy_auth_expired"
                    );
                }
                assert!(account.is_expired());
            });
            assert_eq!(fixture.received.try_iter().count(), 5);
        }
    }

    #[test]
    fn account_ownership_still_rejects_a_completed_session_used_by_another_client() {
        let fixture = Fixture::new(account_login_replies());
        let other = mock_client(fixture.client.mock_origin.as_ref().unwrap().as_str());
        run(async {
            let cancel = AtomicBool::new(false);
            let challenge = fixture.client.begin().await.unwrap();
            let mut session = fixture.client.complete(challenge, &cancel).await.unwrap();
            assert_eq!(
                failure_code(other.model(&mut session, model_body(), &cancel).await),
                "codebuddy_auth_session"
            );
            assert!(!session.is_expired());
        });
        assert_eq!(fixture.received.try_iter().count(), 4);
    }

    fn account_login_replies() -> Vec<Reply> {
        vec![
            Reply::json(
                json!({"code":0,"data":{"state":STATE,"authUrl":format!("{ORIGIN}/login?platform=CLI&state={STATE}")}}),
            ),
            Reply::json(
                json!({"code":0,"data":{"accessToken":"fixture-secret","expiresIn":60,"domain":""}}),
            ),
            Reply::json(json!({"code":0,"data":{"uid":"fixture-user","type":"personal"}})),
            Reply::json(
                json!({"code":0,"data":{"accounts":[{"uid":"fixture-user","type":"personal","pluginEnabled":true}]}}),
            ),
        ]
    }

    #[test]
    fn model_uses_one_fixed_request_and_keeps_the_raw_sse_for_host_verification() {
        let sse = "data: {\"id\":\"fixture\",\"choices\":[{\"delta\":{\"content\":\"test\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        for model in ["deepseek-v4.1-flash", "hy4-preview", "hy3", "default"] {
            let fixture = Fixture::new(vec![Reply::http(
                200,
                "text/event-stream; charset=utf-8",
                sse,
            )]);
            let mut session = test_session(fixture.client.id);
            let mut body = model_body();
            body["model"] = json!(model);
            let result =
                run(fixture
                    .client
                    .model(&mut session, body.clone(), &AtomicBool::new(false)))
                .unwrap();
            assert_eq!(result, sse.as_bytes());
            let request = fixture.received.try_recv().unwrap();
            assert!(request.starts_with("POST /v2/chat/completions HTTP/1.1\r\n"));
            let (headers, payload) = request.split_once("\r\n\r\n").unwrap();
            let headers = headers.to_ascii_lowercase();
            assert!(headers.contains("authorization: bearer fixture-secret\r\n"));
            assert!(headers.contains("x-user-id: fixture-user\r\n"));
            assert!(!headers.contains("x-enterprise-id:"));
            assert_eq!(serde_json::from_str::<Value>(payload).unwrap(), body);
            assert!(fixture.received.try_recv().is_err());
        }
    }

    #[test]
    fn fixture_waits_for_request_bytes_after_accepting_a_connection() {
        let fixture = Fixture::new(vec![Reply::json(json!({"code":0}))]);
        let port = fixture.client.mock_origin.as_ref().unwrap().port().unwrap();
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(100)))
            .unwrap();
        let probe = stream.read(&mut [0]);
        assert!(
            matches!(probe, Err(ref error) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut)),
            "fixture closed an accepted connection before receiving a request: {probe:?}"
        );
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        stream
            .write_all(b"GET /fixture HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        assert!(response.starts_with(b"HTTP/1.1 200 "));
    }

    #[test]
    fn redirects_invalid_media_types_and_oversized_streams_are_rejected() {
        let replies = [
            (
                Reply::raw("HTTP/1.1 302 Found\r\nLocation: /unexpected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
                "codebuddy_auth_url",
            ),
            (
                Reply::http(200, "text/event-stream-untrusted", "fixture"),
                "codebuddy_auth_response",
            ),
            (
                Reply::raw(&format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", MAX_MODEL_BYTES + 1)),
                "response_too_large",
            ),
            (
                Reply::raw(&format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n", MAX_MODEL_BYTES + 1, "x".repeat(MAX_MODEL_BYTES + 1))),
                "response_too_large",
            ),
        ];
        for (reply, expected) in replies {
            let fixture = Fixture::new(vec![reply]);
            let mut session = test_session(fixture.client.id);
            assert_eq!(
                failure_code(run(fixture.client.model(
                    &mut session,
                    model_body(),
                    &AtomicBool::new(false)
                ))),
                expected
            );
        }
    }

    #[test]
    fn unauthorized_model_response_clears_the_session_and_cannot_retry_it() {
        let fixture = Fixture::new(vec![Reply::http(401, "application/json", "{}")]);
        let mut session = test_session(fixture.client.id);
        let cancel = AtomicBool::new(false);
        for _ in 0..2 {
            assert_eq!(
                failure_code(run(fixture.client.model(
                    &mut session,
                    model_body(),
                    &cancel
                ))),
                "codebuddy_auth_expired"
            );
        }
        assert!(session.is_expired());
        assert!(session.token.is_none());
        assert_eq!(fixture.received.try_iter().count(), 1);
    }

    #[test]
    fn model_json_unauthorized_response_clears_the_session() {
        for code in [401, 403] {
            let fixture = Fixture::new(vec![Reply::json(json!({"code":code,"data":{}}))]);
            let mut session = test_session(fixture.client.id);
            assert_eq!(
                failure_code(run(fixture.client.model(
                    &mut session,
                    model_body(),
                    &AtomicBool::new(false)
                ))),
                "codebuddy_auth_expired"
            );
            assert!(session.token.is_none());
        }
    }

    #[test]
    fn observed_unauthorized_response_invalidates_even_when_cancellation_wins() {
        let mut session = test_session(Uuid::new_v4());
        let invalidated = AtomicBool::new(false);
        let cancel = AtomicBool::new(false);
        let deadline = Instant::now() + Duration::from_secs(1);
        let response = run(guarded(
            async {
                let error = ResponseKind::EventStream(&invalidated).expired();
                cancel.store(true, Ordering::Release);
                Err(error)
            },
            &cancel,
            deadline,
        ));
        assert_eq!(
            failure_code(finish_model(
                &mut session,
                response,
                &invalidated,
                &cancel,
                deadline
            )),
            "cancelled"
        );
        assert!(session.token.is_none());
    }

    #[test]
    fn an_in_flight_model_request_cancels_without_waiting_for_the_server() {
        let fixture = Fixture::new(vec![Reply::Stall]);
        let mut session = test_session(fixture.client.id);
        let cancel = AtomicBool::new(false);
        let result = run(async {
            let cancel_after_dispatch = async {
                tokio::time::timeout(Duration::from_secs(2), async {
                    while fixture.received.try_recv().is_err() {
                        tokio::time::sleep(Duration::from_millis(1)).await;
                    }
                })
                .await
                .unwrap();
                cancel.store(true, Ordering::Release);
            };
            let (result, ()) = tokio::join!(
                fixture.client.model(&mut session, model_body(), &cancel),
                cancel_after_dispatch
            );
            result
        });
        assert_eq!(failure_code(result), "cancelled");
    }

    #[test]
    fn wrong_model_tools_expired_or_other_client_session_never_reach_the_network() {
        let client = mock_client("http://127.0.0.1:1");
        let cancel = AtomicBool::new(false);
        let mut session = test_session(client.id);
        let mut wrong_model = model_body();
        wrong_model["model"] = json!("other");
        let mut tools = model_body();
        tools["tools"] = json!([{"type":"function","function":{"name":"Write"}}]);
        for body in [wrong_model, tools] {
            assert_eq!(
                failure_code(run(client.model(&mut session, body, &cancel))),
                "codebuddy_request_denied"
            );
        }
        session.owner = Uuid::new_v4();
        assert_eq!(
            failure_code(run(client.model(&mut session, model_body(), &cancel))),
            "codebuddy_auth_session"
        );
        session.owner = client.id;
        session.token.as_mut().unwrap().deadline = Instant::now();
        assert_eq!(
            failure_code(run(client.model(&mut session, model_body(), &cancel))),
            "codebuddy_auth_expired"
        );
        assert!(session.token.is_none());
    }

    fn run<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn mock_client(origin: &str) -> Client {
        Client {
            id: Uuid::new_v4(),
            http: http_client(SystemProxy::direct(), false).unwrap(),
            mock_origin: Some(Url::parse(origin).unwrap()),
        }
    }

    fn test_session(owner: Uuid) -> Session {
        let now = Clock::now().unwrap();
        Session {
            owner,
            token: Some(Token {
                access_token: "fixture-secret".to_owned(),
                domain: DOMAIN.to_owned(),
                expires_at_ms: now.unix_ms + 60_000,
                deadline: now.monotonic + Duration::from_secs(60),
            }),
            identity: PersonalIdentity {
                uid: "fixture-user".to_owned(),
                nickname: None,
            },
        }
    }

    fn model_body() -> Value {
        json!({"model":"default","stream":true,"messages":[{"role":"user","content":"synthetic fixture"}]})
    }

    enum Reply {
        Bytes(Vec<u8>),
        Stall,
    }

    impl Reply {
        fn json(value: Value) -> Self {
            Self::http(200, "application/json", &value.to_string())
        }

        fn http(status: u16, mime: &str, body: &str) -> Self {
            Self::raw(&format!("HTTP/1.1 {status} Fixture\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nSet-Cookie: discarded=fixture\r\nConnection: close\r\n\r\n{body}", body.len()))
        }

        fn raw(value: &str) -> Self {
            Self::Bytes(value.as_bytes().to_vec())
        }
    }

    struct Fixture {
        client: Client,
        received: mpsc::Receiver<String>,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl Fixture {
        fn new(replies: Vec<Reply>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let address = listener.local_addr().unwrap();
            let (sent, received) = mpsc::channel();
            let stop = Arc::new(AtomicBool::new(false));
            let server_stop = stop.clone();
            let worker = thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(5);
                for reply in replies {
                    let mut stream = loop {
                        if server_stop.load(Ordering::Acquire) || Instant::now() >= deadline {
                            return;
                        }
                        match listener.accept() {
                            Ok((stream, _)) => break stream,
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                thread::sleep(Duration::from_millis(1));
                            }
                            Err(error) => panic!("fixture accept failed: {error}"),
                        }
                    };
                    // Windows 接受的 socket 继承监听器模式，先恢复阻塞读写才能应用超时。
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_millis(500)))
                        .unwrap();
                    stream
                        .set_write_timeout(Some(Duration::from_millis(500)))
                        .unwrap();
                    let mut request = Vec::new();
                    loop {
                        let mut chunk = [0; 4096];
                        let Ok(count) = stream.read(&mut chunk) else {
                            return;
                        };
                        if count == 0 || request.len() > 2 * 1024 * 1024 {
                            return;
                        }
                        request.extend_from_slice(&chunk[..count]);
                        if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n")
                        {
                            let headers =
                                String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                            let length = headers
                                .lines()
                                .find_map(|line| line.strip_prefix("content-length:"))
                                .map(|value| value.trim().parse::<usize>().unwrap())
                                .unwrap_or(0);
                            if request.len() >= end + 4 + length {
                                break;
                            }
                        }
                    }
                    sent.send(String::from_utf8(request).unwrap()).unwrap();
                    match reply {
                        Reply::Bytes(bytes) => {
                            let _ = stream.write_all(&bytes);
                        }
                        Reply::Stall => {
                            while !server_stop.load(Ordering::Acquire) && Instant::now() < deadline
                            {
                                thread::sleep(Duration::from_millis(1));
                            }
                        }
                    }
                }
            });
            Self {
                client: mock_client(&format!("http://{address}")),
                received,
                stop,
                worker: Some(worker),
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            // 测试 accept/读写均有界，停止信号会唤醒 Stall，join 不等待远端结束。
            if let Some(worker) = self.worker.take() {
                worker.join().unwrap();
            }
        }
    }
}
