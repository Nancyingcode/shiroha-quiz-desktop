use crate::error::{Error, Result};
use crate::harness_codebuddy_wire::{
    read_frame, validate_request, write_frame, HostFrame, WorkerConfig, WorkerFrame,
    MAX_REQUEST_BYTES,
};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    io::{self, Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, TryRecvError},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_TIMEOUT_MS: u64 = 5 * 60 * 1000;
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const HTTP_INPUT_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_TIMEOUT: Duration = Duration::from_secs(6);
const REJECTED_BODY: &str = "{\"error\":{\"message\":\"request rejected\"}}";

pub(crate) fn run() -> Result<()> {
    #[cfg(windows)]
    if !crate::harness_codebuddy_container::is_app_container()? {
        return Err(Error::new("codebuddy_container_required"));
    }
    #[cfg(not(windows))]
    return Err(Error::new("harness_platform_unsupported"));

    #[cfg(windows)]
    {
        let result = run_inner();
        if let Err(error) = &result {
            // 错误只输出固定代码，不把 CLI stderr、凭据或请求正文写入宿主管道。
            let _ = write_frame(
                &mut io::stdout().lock(),
                &WorkerFrame::Failed {
                    code: error.code.to_owned(),
                },
            );
        }
        result
    }
}

fn run_inner() -> Result<()> {
    let HostFrame::Start { config } = read_frame(&mut io::stdin().lock())? else {
        return Err(Error::new("codebuddy_frame_invalid"));
    };
    validate_config(&config)?;
    let executable = std::env::current_exe().map_err(|_| Error::new("codebuddy_worker_path"))?;
    let root = executable
        .parent()
        .ok_or_else(|| Error::new("codebuddy_worker_path"))?;
    let cli_path = root.join("codebuddy.exe");
    let cwd = root.join("data").join("work");
    if !cli_path.is_file() || !cwd.is_dir() {
        return Err(Error::new("codebuddy_worker_path"));
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| Error::new("codebuddy_relay_start_failed"))?;
    listener
        .set_nonblocking(true)
        .map_err(|_| Error::new("codebuddy_relay_start_failed"))?;
    let port = listener
        .local_addr()
        .map_err(|_| Error::new("codebuddy_relay_start_failed"))?
        .port();
    let env = cli_environment(root, port, &config)?;
    let args = cli_arguments(&config.model);
    let input = config.prompt.as_bytes().to_vec();
    let timeout = Duration::from_millis(config.timeout_ms);
    let deadline = Instant::now() + timeout;
    let cancel = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let responses = host_responses()?;
    write_frame(&mut io::stdout().lock(), &WorkerFrame::Ready { port })?;
    let cli_cancel = cancel.clone();
    let cli_finished = finished.clone();
    let cli = thread::Builder::new()
        .spawn(move || {
            let result = crate::harness_process::run(
                &cli_path,
                &args,
                &env,
                &cwd,
                &input,
                &cli_cancel,
                timeout,
            );
            cli_finished.store(true, Ordering::Release);
            result
        })
        .map_err(|_| Error::new("harness_start_failed"))?;
    let served = serve(&listener, &config, &responses, &cancel, &finished, deadline);
    cancel.store(true, Ordering::Release);
    let stop_deadline = Instant::now() + STOP_TIMEOUT;
    while !cli.is_finished() {
        if Instant::now() >= stop_deadline {
            // 线程只拥有本任务数据；超时交由外层 Job 兜底，不进行无界 join。
            return Err(Error::new("harness_stop_failed"));
        }
        thread::sleep(POLL_INTERVAL);
    }
    let output = cli
        .join()
        .map_err(|_| Error::new("harness_execution_failed"))?;
    if let Err(error) = served {
        if error.code != "codebuddy_cli_finished" {
            return Err(error);
        }
    }
    let output = output?;
    let stdout =
        String::from_utf8(output.stdout).map_err(|_| Error::new("codebuddy_output_invalid"))?;
    write_frame(
        &mut io::stdout().lock(),
        &WorkerFrame::Complete {
            success: output.success,
            stdout,
        },
    )
}

fn host_responses() -> Result<Receiver<Result<HostFrame>>> {
    let (sender, receiver) = mpsc::sync_channel(1);
    // stdin 只由此线程读取，生命周期为单次 worker 进程；父 Job 退出时统一关闭。
    // 不等待可能阻塞在 ReadFile 的线程，避免在宿主取消时卡住清理。
    thread::Builder::new()
        .spawn(move || {
            let stdin = io::stdin();
            let mut input = stdin.lock();
            loop {
                let frame = read_frame(&mut input);
                let terminal = frame.is_err();
                if sender.send(frame).is_err() || terminal {
                    break;
                }
            }
        })
        .map_err(|_| Error::new("harness_io_failed"))?;
    Ok(receiver)
}

fn serve(
    listener: &TcpListener,
    config: &WorkerConfig,
    responses: &Receiver<Result<HostFrame>>,
    cancel: &AtomicBool,
    finished: &AtomicBool,
    deadline: Instant,
) -> Result<()> {
    while !finished.load(Ordering::Acquire) {
        ensure_running(cancel, finished, deadline)?;
        match responses.try_recv() {
            Ok(Err(error)) => return Err(error),
            Ok(Ok(_)) => return Err(Error::new("codebuddy_frame_invalid")),
            Err(TryRecvError::Disconnected) => return Err(Error::new("codebuddy_pipe_closed")),
            Err(TryRecvError::Empty) => {}
        }
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                stream
                    .set_nonblocking(true)
                    .map_err(|_| Error::new("codebuddy_relay_io_failed"))?;
                let request_deadline = deadline.min(Instant::now() + HTTP_INPUT_TIMEOUT);
                let request = read_request(&mut stream, config, cancel, finished, request_deadline);
                let body = match request {
                    Ok(body) => body,
                    Err(error) if error.code == "codebuddy_cli_finished" => continue,
                    Err(_) => {
                        let _ = write_response(
                            &mut stream,
                            422,
                            REJECTED_BODY,
                            cancel,
                            finished,
                            deadline.min(Instant::now() + HTTP_INPUT_TIMEOUT),
                        );
                        continue;
                    }
                };
                forward_request(
                    &mut io::stdout().lock(),
                    &stream,
                    body,
                    cancel,
                    finished,
                    deadline,
                )?;
                let (status, body) = wait_response(responses, &stream, cancel, finished, deadline)?;
                write_response(&mut stream, status, &body, cancel, finished, deadline)?;
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(POLL_INTERVAL);
            }
            Err(_) => return Err(Error::new("codebuddy_relay_io_failed")),
        }
    }
    Ok(())
}

fn ensure_running(cancel: &AtomicBool, finished: &AtomicBool, deadline: Instant) -> Result<()> {
    if cancel.load(Ordering::Acquire) {
        return Err(Error::new("cancelled"));
    }
    if finished.load(Ordering::Acquire) {
        return Err(Error::new("codebuddy_cli_finished"));
    }
    if Instant::now() >= deadline {
        return Err(Error::new("timeout"));
    }
    Ok(())
}

fn forward_request(
    output: &mut impl Write,
    stream: &TcpStream,
    body: serde_json::Value,
    cancel: &AtomicBool,
    finished: &AtomicBool,
    deadline: Instant,
) -> Result<()> {
    ensure_peer_active(stream, cancel, finished, deadline)?;
    write_frame(output, &WorkerFrame::Request { body })
}

fn ensure_peer_active(
    stream: &TcpStream,
    cancel: &AtomicBool,
    finished: &AtomicBool,
    deadline: Instant,
) -> Result<()> {
    loop {
        ensure_running(cancel, finished, deadline)?;
        let mut pending = [0; 1];
        match stream.peek(&mut pending) {
            // 固定 CLI 不使用半关闭请求或 HTTP pipeline；断连时通知宿主取消上游。
            Ok(_) => return Err(Error::new("codebuddy_relay_peer_closed")),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                return ensure_running(cancel, finished, deadline);
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(Error::new("codebuddy_relay_io_failed")),
        }
    }
}

fn read_request(
    stream: &mut TcpStream,
    config: &WorkerConfig,
    cancel: &AtomicBool,
    finished: &AtomicBool,
    deadline: Instant,
) -> Result<serde_json::Value> {
    let mut bytes = Vec::new();
    let mut expected = None;
    let mut header_end = 0;
    let mut buffer = [0; 4096];
    loop {
        ensure_running(cancel, finished, deadline)?;
        let count = match stream.read(&mut buffer) {
            Ok(0) => return Err(Error::new("codebuddy_request_denied")),
            Ok(count) => count,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(POLL_INTERVAL);
                continue;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(Error::new("codebuddy_relay_io_failed")),
        };
        bytes.extend_from_slice(&buffer[..count]);
        if expected.is_none() {
            if let Some(index) = bytes.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                header_end = index + 4;
                let length = parse_headers(&bytes[..header_end], config)?;
                expected = Some(header_end + length);
            } else if bytes.len() > MAX_HEADER_BYTES {
                return Err(Error::new("codebuddy_request_denied"));
            }
        }
        if let Some(expected) = expected {
            if bytes.len() > expected {
                return Err(Error::new("codebuddy_request_denied"));
            }
            if bytes.len() == expected {
                let body = serde_json::from_slice(&bytes[header_end..])
                    .map_err(|_| Error::new("codebuddy_request_denied"))?;
                validate_request(&body, &config.model)?;
                return Ok(body);
            }
        }
    }
}

fn parse_headers(head: &[u8], config: &WorkerConfig) -> Result<usize> {
    let denied = || Error::new("codebuddy_request_denied");
    if head.len() > MAX_HEADER_BYTES || !head.is_ascii() || !head.ends_with(b"\r\n\r\n") {
        return Err(denied());
    }
    let text = std::str::from_utf8(&head[..head.len() - 4]).map_err(|_| denied())?;
    let mut lines = text.split("\r\n");
    if lines.next() != Some("POST /chat/completions HTTP/1.1") {
        return Err(denied());
    }
    let mut headers = BTreeMap::new();
    for line in lines {
        let (name, value) = line.split_once(':').ok_or_else(denied)?;
        let valid_name = !name.is_empty()
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte));
        if !valid_name || !value.bytes().all(|byte| (b' '..=b'~').contains(&byte)) {
            return Err(denied());
        }
        if headers
            .insert(name.to_ascii_lowercase(), value.trim())
            .is_some()
        {
            return Err(denied());
        }
    }
    let bearer = format!("Bearer {}", config.bearer);
    let authorized = headers.get("authorization").copied() == Some(bearer.as_str())
        && headers.get("x-shiroha-run").copied() == Some(config.capability.as_str());
    let loopback_host = headers
        .get("host")
        .and_then(|host| host.strip_prefix("127.0.0.1:"))
        .and_then(|port| port.parse::<u16>().ok())
        .is_some_and(|port| port != 0);
    if !authorized
        || !loopback_host
        || headers.contains_key("transfer-encoding")
        || headers.get("content-type").copied() != Some("application/json")
    {
        return Err(denied());
    }
    let raw_length = headers.get("content-length").ok_or_else(denied)?;
    let length = raw_length.parse::<usize>().map_err(|_| denied())?;
    if length == 0 || length > MAX_REQUEST_BYTES || length.to_string() != *raw_length {
        return Err(denied());
    }
    Ok(length)
}

fn wait_response(
    responses: &Receiver<Result<HostFrame>>,
    stream: &TcpStream,
    cancel: &AtomicBool,
    finished: &AtomicBool,
    deadline: Instant,
) -> Result<(u16, String)> {
    loop {
        ensure_peer_active(stream, cancel, finished, deadline)?;
        match responses.recv_timeout(POLL_INTERVAL) {
            Ok(Ok(HostFrame::Response { status, body })) => return response_body(status, body),
            Ok(Ok(HostFrame::Start { .. })) => return Err(Error::new("codebuddy_frame_invalid")),
            Ok(Err(error)) => return Err(error),
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return Err(Error::new("codebuddy_pipe_closed")),
        }
    }
}

fn response_body(status: u16, body: String) -> Result<(u16, String)> {
    match status {
        200 if !body.is_empty() && body.len() <= MAX_RESPONSE_BYTES => Ok((200, body)),
        422 => Ok((422, REJECTED_BODY.to_owned())),
        _ => Err(Error::new("codebuddy_frame_invalid")),
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    body: &str,
    cancel: &AtomicBool,
    finished: &AtomicBool,
    deadline: Instant,
) -> Result<()> {
    let (reason, content_type) = if status == 200 {
        ("OK", "text/event-stream")
    } else {
        ("Unprocessable Entity", "application/json")
    };
    let bytes = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    ).into_bytes();
    let mut written = 0;
    while written < bytes.len() {
        ensure_running(cancel, finished, deadline)?;
        match stream.write(&bytes[written..]) {
            Ok(0) => return Err(Error::new("codebuddy_relay_io_failed")),
            Ok(count) => written += count,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(POLL_INTERVAL),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(Error::new("codebuddy_relay_io_failed")),
        }
    }
    Ok(())
}

fn validate_config(config: &WorkerConfig) -> Result<()> {
    let valid_capability = config.capability.len() == 64
        && config
            .capability
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit());
    let valid_bearer = (16..=256).contains(&config.bearer.len())
        && config
            .bearer
            .bytes()
            .all(|byte| (b'!'..=b'~').contains(&byte));
    let valid_model = !config.model.is_empty()
        && config.model.len() <= 128
        && config
            .model
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_./:".contains(&byte));
    if !valid_capability
        || !valid_bearer
        || !valid_model
        || config.prompt.is_empty()
        || config.prompt.len() > MAX_REQUEST_BYTES
        || config.timeout_ms == 0
        || config.timeout_ms > MAX_TIMEOUT_MS
    {
        return Err(Error::new("codebuddy_config_invalid"));
    }
    Ok(())
}

fn cli_arguments(model: &str) -> Vec<String> {
    [
        "-p",
        "--input-format",
        "text",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        "{\"mcpServers\":{}}",
        "--setting-sources",
        "none",
        "--no-plugin-management",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--max-turns",
        "1",
        "--model",
        model,
        "--system-prompt",
        "Return the requested JSON.",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

fn cli_environment(
    root: &Path,
    port: u16,
    config: &WorkerConfig,
) -> Result<Vec<(OsString, OsString)>> {
    let system_root =
        std::env::var_os("SystemRoot").ok_or_else(|| Error::new("codebuddy_worker_environment"))?;
    let data = root.join("data");
    let mut env = vec![
        (OsString::from("SystemRoot"), system_root.clone()),
        (OsString::from("WINDIR"), system_root.clone()),
        (
            OsString::from("PATH"),
            Path::new(&system_root).join("System32").into_os_string(),
        ),
    ];
    for (key, directory) in [
        ("HOME", "home"),
        ("USERPROFILE", "home"),
        ("APPDATA", "appdata"),
        ("LOCALAPPDATA", "localappdata"),
        ("TEMP", "temp"),
        ("TMP", "temp"),
        ("TMPDIR", "temp"),
        ("BUN_TMPDIR", "temp"),
        ("CODEBUDDY_CONFIG_DIR", "config"),
    ] {
        let directory = data.join(directory);
        if !directory.is_dir() {
            return Err(Error::new("codebuddy_worker_path"));
        }
        env.push((key.into(), directory.into_os_string()));
    }
    env.push(("CODEBUDDY_DATA_ROOT".into(), data.into_os_string()));
    for (key, value) in [
        ("CODEBUDDY_CREDENTIALS_IN_MEMORY", "1"),
        ("DISABLE_AUTOUPDATER", "1"),
        ("DISABLE_TELEMETRY", "1"),
        ("DISABLE_ERROR_REPORTING", "1"),
        ("CODEBUDDY_SKIP_BUILTIN_MARKETPLACE", "1"),
        ("CODEBUDDY_DISABLE_PLUGIN_INSTALLS", "1"),
        ("CODEBUDDY_API_KEY_HELPER_DISABLED", "1"),
        ("CODEBUDDY_DISABLE_PARENT_MEMORY", "1"),
        ("CODEBUDDY_DISABLE_AUTO_MEMORY", "1"),
        ("CODEBUDDY_CODE_DISABLE_AUTO_MEMORY", "1"),
        ("CODEBUDDY_DISABLE_SYSTEM_REMINDER_MD", "1"),
        ("CODEBUDDY_MEMORY_RELEVANCE_DISABLED", "1"),
        ("CODEBUDDY_MEMORY_EXTRACTION_DISABLED", "1"),
        ("CBC_ENABLE_FUNCTION_HOOKS", "0"),
        ("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS", "0"),
        ("CODEBUDDY_CODE_DISABLE_SESSION_SUMMARY", "1"),
        ("CODEBUDDY_CODE_DISABLE_TERMINAL_TITLE", "1"),
        ("CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS", "1"),
        ("CODEBUDDY_DISABLE_TRACE_COLLECTOR", "1"),
        ("CODEBUDDY_DISABLE_SHELL_SNAPSHOT", "1"),
        ("CODEBUDDY_CODE_MAX_TURNS", "1"),
        ("CODEBUDDY_MAX_RETRIES", "0"),
        ("CODEBUDDY_REMOTE_CONFIG_DISABLED", "1"),
        ("BUN_RUNTIME_TRANSPILER_CACHE_PATH", "0"),
        ("HTTP_PROXY", "http://127.0.0.1:9"),
        ("HTTPS_PROXY", "http://127.0.0.1:9"),
        ("ALL_PROXY", "http://127.0.0.1:9"),
        ("NO_PROXY", "127.0.0.1,localhost"),
        ("LANG", "zh_CN.UTF-8"),
        ("NO_COLOR", "1"),
    ] {
        env.push((key.into(), value.into()));
    }
    env.extend([
        (
            "CODEBUDDY_BASE_URL".into(),
            format!("http://127.0.0.1:{port}").into(),
        ),
        ("CODEBUDDY_AUTH_TOKEN".into(), config.bearer.clone().into()),
        (
            "CODEBUDDY_CUSTOM_HEADERS".into(),
            format!("x-shiroha-run: {}", config.capability).into(),
        ),
    ]);
    Ok(env)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> WorkerConfig {
        WorkerConfig {
            model: "default".to_owned(),
            prompt: "合成测试".to_owned(),
            capability: "a".repeat(64),
            bearer: "synthetic-bearer-never-real".to_owned(),
            timeout_ms: 25_000,
        }
    }

    fn head(extra: &str) -> Vec<u8> {
        format!(
            "POST /chat/completions HTTP/1.1\r\nHost: 127.0.0.1:1234\r\nContent-Type: application/json\r\nContent-Length: 2\r\nAuthorization: Bearer synthetic-bearer-never-real\r\nx-shiroha-run: {}\r\n{extra}\r\n",
            "a".repeat(64)
        )
        .into_bytes()
    }

    #[test]
    fn authenticated_request_accepts_exact_route_and_length() {
        assert_eq!(parse_headers(&head(""), &config()).unwrap(), 2);
        let mixed_case = String::from_utf8(head(""))
            .unwrap()
            .replace("Content-Length", "cOnTeNt-LeNgTh");
        assert_eq!(parse_headers(mixed_case.as_bytes(), &config()).unwrap(), 2);
    }

    #[test]
    fn requests_reject_transfer_encoding_and_duplicate_critical_headers() {
        for extra in [
            "Transfer-Encoding: chunked\r\n",
            "Content-Length: 2\r\n",
            "authorization: Bearer synthetic-bearer-never-real\r\n",
            "X-Shiroha-Run: another\r\n",
            "Host: other\r\n",
            "Content-Type: application/json\r\n",
        ] {
            assert!(parse_headers(&head(extra), &config()).is_err(), "{extra}");
        }
    }

    #[test]
    fn requests_reject_smuggling_and_other_routes() {
        let valid = String::from_utf8(head("")).unwrap();
        for replacement in [
            "GET /chat/completions HTTP/1.1",
            "POST /chat/completions?x=1 HTTP/1.1",
            "POST http://127.0.0.1/chat/completions HTTP/1.1",
            "CONNECT example.com:443 HTTP/1.1",
        ] {
            let malformed = valid.replace("POST /chat/completions HTTP/1.1", replacement);
            assert!(parse_headers(malformed.as_bytes(), &config()).is_err());
        }
        for replacement in ["-1", "+2", "2, 2", "2097153", "0", "02"] {
            let malformed = valid.replace(
                "Content-Length: 2",
                &format!("Content-Length: {replacement}"),
            );
            assert!(parse_headers(malformed.as_bytes(), &config()).is_err());
        }
        assert!(parse_headers(&head(" folded: value\r\n"), &config()).is_err());
        assert!(parse_headers(&head("Invalid Header: value\r\n"), &config()).is_err());
        assert!(parse_headers(&head("Invalid: a\0b\r\n"), &config()).is_err());
        assert!(parse_headers(&valid.replace("\r\n", "\n").into_bytes(), &config()).is_err());
        assert!(parse_headers(
            &head(&format!("X-Large: {}\r\n", "a".repeat(MAX_HEADER_BYTES))),
            &config()
        )
        .is_err());
    }

    #[test]
    fn requests_require_matching_bearer_and_capability() {
        let valid = String::from_utf8(head("")).unwrap();
        assert!(parse_headers(
            valid
                .replace("synthetic-bearer-never-real", "wrong")
                .as_bytes(),
            &config()
        )
        .is_err());
        assert!(parse_headers(
            valid.replace(&"a".repeat(64), &"b".repeat(64)).as_bytes(),
            &config()
        )
        .is_err());
        assert!(parse_headers(
            valid
                .replace("Authorization: Bearer synthetic-bearer-never-real\r\n", "")
                .as_bytes(),
            &config()
        )
        .is_err());
    }

    #[test]
    fn config_requires_bounded_non_injectable_values() {
        assert!(validate_config(&config()).is_ok());
        let mut invalid = config();
        invalid.capability.push('\n');
        assert!(validate_config(&invalid).is_err());
        let mut invalid = config();
        invalid.bearer = "bad\r\nInjected: value".to_owned();
        assert!(validate_config(&invalid).is_err());
        let mut invalid = config();
        invalid.model = "bad\0model".to_owned();
        assert!(validate_config(&invalid).is_err());
        let mut invalid = config();
        invalid.timeout_ms = 0;
        assert!(validate_config(&invalid).is_err());
    }

    #[test]
    fn host_responses_only_return_sse_or_fixed_rejection() {
        let sse = "data: [DONE]\n\n".to_owned();
        assert_eq!(response_body(200, sse.clone()).unwrap(), (200, sse));
        let (status, body) = response_body(422, "potential-secret".to_owned()).unwrap();
        assert_eq!(status, 422);
        assert!(!body.contains("potential-secret"));
        assert!(response_body(302, "https://example.com".to_owned()).is_err());
        assert!(response_body(200, "x".repeat(1024 * 1024 + 1)).is_err());
    }

    fn socket_request(bytes: Vec<u8>, cancelled: bool, expired: bool) -> Result<serde_json::Value> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_nonblocking(true).unwrap();
        client.write_all(&bytes).unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let deadline = if expired {
            Instant::now()
        } else {
            Instant::now() + Duration::from_secs(1)
        };
        read_request(
            &mut stream,
            &config(),
            &AtomicBool::new(cancelled),
            &AtomicBool::new(false),
            deadline,
        )
    }

    fn model_request() -> Vec<u8> {
        let body = r#"{"model":"default","stream":true,"messages":[]}"#;
        let head = String::from_utf8(head("")).unwrap().replace(
            "Content-Length: 2",
            &format!("Content-Length: {}", body.len()),
        );
        [head.as_bytes(), body.as_bytes()].concat()
    }

    #[test]
    fn socket_requires_complete_bounded_json_and_model_contract() {
        let valid = model_request();
        assert_eq!(
            socket_request(valid.clone(), false, false).unwrap()["model"],
            "default"
        );
        assert!(socket_request(valid[..valid.len() - 1].to_vec(), false, false).is_err());
        let other_model = String::from_utf8(valid)
            .unwrap()
            .replace("default", "unknown");
        assert!(socket_request(other_model.into_bytes(), false, false).is_err());
    }

    #[test]
    fn socket_cancel_and_deadline_win_before_reading_available_data() {
        assert_eq!(
            socket_request(model_request(), true, false)
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert_eq!(
            socket_request(model_request(), false, true)
                .unwrap_err()
                .code,
            "timeout"
        );
    }

    fn parsed_request() -> (TcpStream, TcpStream, serde_json::Value) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_nonblocking(true).unwrap();
        client.write_all(&model_request()).unwrap();
        let body = read_request(
            &mut stream,
            &config(),
            &AtomicBool::new(false),
            &AtomicBool::new(false),
            Instant::now() + Duration::from_secs(1),
        )
        .unwrap();
        (client, stream, body)
    }

    #[test]
    fn request_is_not_forwarded_when_state_changes_after_parsing() {
        for expected in ["cancelled", "codebuddy_cli_finished", "timeout"] {
            let (_client, stream, body) = parsed_request();
            let cancel = AtomicBool::new(expected == "cancelled");
            let finished = AtomicBool::new(expected == "codebuddy_cli_finished");
            let deadline = if expected == "timeout" {
                Instant::now()
            } else {
                Instant::now() + Duration::from_secs(1)
            };
            let mut frames = Vec::new();
            let result = forward_request(&mut frames, &stream, body, &cancel, &finished, deadline);
            assert_eq!(result.unwrap_err().code, expected);
            assert!(frames.is_empty());
        }
    }

    #[test]
    fn request_is_not_forwarded_after_peer_closes_or_pipelines() {
        for close in [true, false] {
            let (mut client, stream, body) = parsed_request();
            if close {
                client.shutdown(std::net::Shutdown::Both).unwrap();
            } else {
                client.write_all(b"unexpected-pipeline").unwrap();
            }
            // 等到内核已交付 FIN 或额外字节，避免把本机调度时序当成协议断言。
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            assert_eq!(stream.peek(&mut [0; 1]).unwrap(), usize::from(!close));
            stream.set_nonblocking(true).unwrap();
            let mut frames = Vec::new();
            let result = forward_request(
                &mut frames,
                &stream,
                body,
                &AtomicBool::new(false),
                &AtomicBool::new(false),
                Instant::now() + Duration::from_secs(1),
            );
            assert_eq!(result.unwrap_err().code, "codebuddy_relay_peer_closed");
            assert!(frames.is_empty());
        }
    }

    #[test]
    fn active_request_is_forwarded_as_one_frame() {
        let (_client, stream, body) = parsed_request();
        let mut frames = Vec::new();
        forward_request(
            &mut frames,
            &stream,
            body.clone(),
            &AtomicBool::new(false),
            &AtomicBool::new(false),
            Instant::now() + Duration::from_secs(1),
        )
        .unwrap();
        let mut bytes = frames.as_slice();
        let WorkerFrame::Request { body: forwarded } = read_frame(&mut bytes).unwrap() else {
            panic!("expected one model request")
        };
        assert_eq!(forwarded, body);
        assert!(bytes.is_empty());
    }

    #[test]
    fn disconnected_host_and_unsolicited_start_cannot_supply_response() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let _client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (stream, _) = listener.accept().unwrap();
        stream.set_nonblocking(true).unwrap();
        let (sender, receiver) = mpsc::channel();
        assert!(sender
            .send(Ok(HostFrame::Start { config: config() }))
            .is_ok());
        assert_eq!(
            wait_response(
                &receiver,
                &stream,
                &AtomicBool::new(false),
                &AtomicBool::new(false),
                Instant::now() + Duration::from_secs(1)
            )
            .unwrap_err()
            .code,
            "codebuddy_frame_invalid"
        );
        drop(sender);
        assert_eq!(
            wait_response(
                &receiver,
                &stream,
                &AtomicBool::new(false),
                &AtomicBool::new(false),
                Instant::now() + Duration::from_secs(1)
            )
            .unwrap_err()
            .code,
            "codebuddy_pipe_closed"
        );
    }

    #[test]
    fn downstream_close_ends_wait_before_upstream_reply() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (stream, _) = listener.accept().unwrap();
        stream.set_nonblocking(true).unwrap();
        client.shutdown(std::net::Shutdown::Both).unwrap();
        let (_sender, receiver) = mpsc::channel();
        let result = wait_response(
            &receiver,
            &stream,
            &AtomicBool::new(false),
            &AtomicBool::new(false),
            Instant::now() + Duration::from_secs(1),
        );
        assert_eq!(result.unwrap_err().code, "codebuddy_relay_peer_closed");
    }

    #[test]
    fn completed_cli_does_not_wait_for_more_connections_or_host_frames() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let (sender, receiver) = mpsc::channel();
        drop(sender);
        assert!(serve(
            &listener,
            &config(),
            &receiver,
            &AtomicBool::new(false),
            &AtomicBool::new(true),
            Instant::now() + Duration::from_secs(1),
        )
        .is_ok());
    }
}
