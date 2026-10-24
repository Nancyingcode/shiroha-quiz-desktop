use crate::{
    error::Result,
    harness::{failure, Message, Task},
};
use std::{
    path::Path,
    sync::{atomic::AtomicBool, Arc},
};

pub(crate) const VERSION: &str = "0.163.0";
const DEVICE_URL: &str = "https://auth.openai.com/codex/device";
const DEVICE_PROMPT_LIMIT: usize = 4096;
const STATUS_LIMIT: usize = 256;
#[cfg(any(test, not(feature = "native-test")))]
const LOGIN_ERROR_LIMIT: usize = 4096;
type Progress = Arc<dyn Fn(String, String) + Send + Sync>;

pub(crate) use implementation::{execute, inspect, login, logout, subscription};

pub(crate) fn inspect_cancellable(path: &Path, cancel: &AtomicBool) -> Result<()> {
    if cancel.load(std::sync::atomic::Ordering::Acquire) {
        return Err(failure("cancelled"));
    }
    implementation::inspect_cancellable(path, cancel)
}

fn device_code(bytes: &[u8]) -> Result<Option<String>> {
    if bytes.len() > DEVICE_PROMPT_LIMIT {
        return Err(failure("harness_auth"));
    }
    let mut clean = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            0x1b => {
                index += 1;
                if index == bytes.len() {
                    return Ok(None);
                }
                if bytes[index] != b'[' {
                    return Err(failure("harness_auth"));
                }
                index += 1;
                while index < bytes.len() && (bytes[index].is_ascii_digit() || bytes[index] == b';')
                {
                    index += 1;
                }
                if index == bytes.len() {
                    return Ok(None);
                }
                if bytes[index] != b'm' {
                    return Err(failure("harness_auth"));
                }
            }
            byte if byte < 0x20 && !matches!(byte, b'\r' | b'\n' | b'\t') || byte == 0x7f => {
                return Err(failure("harness_auth"))
            }
            byte => clean.push(byte),
        }
        index += 1;
    }
    let text = match std::str::from_utf8(&clean) {
        Ok(text) => text,
        Err(error) if error.error_len().is_none() => return Ok(None),
        Err(_) => return Err(failure("harness_auth")),
    };
    // 只检查已换行的完整行，避免管道分块把有效设备码的前缀误当成完整设备码。
    let Some(end) = text.rfind('\n') else {
        return Ok(None);
    };
    let lines: Vec<&str> = text[..end]
        .split('\n')
        .map(|line| line.trim_matches([' ', '\t', '\r']))
        .filter(|line| !line.is_empty())
        .collect();
    let mut code = None;
    for group in lines.windows(4) {
        if group[0] != "1. Open this link in your browser and sign in to your account"
            || group[1] != DEVICE_URL
            || group[2] != "2. Enter this one-time code (expires in 15 minutes)"
        {
            continue;
        }
        let value = group[3];
        if !(6..=16).contains(&value.len())
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err(failure("harness_auth"));
        }
        if code.is_some() {
            return Err(failure("harness_auth"));
        }
        code = Some(value.to_owned());
    }
    Ok(code)
}

fn subscription_status(bytes: &[u8], success: bool) -> Result<bool> {
    if bytes.len() > STATUS_LIMIT {
        return Err(failure("harness_auth"));
    }
    Ok(success
        && matches!(
            bytes,
            b"Logged in using ChatGPT"
                | b"Logged in using ChatGPT\n"
                | b"Logged in using ChatGPT\r\n"
        ))
}

#[cfg(any(test, not(feature = "native-test")))]
fn login_failure_code(bytes: &[u8]) -> &'static str {
    // 官方错误可能带服务端正文或令牌；只映射已知阶段，原文不进入 IPC、日志或持久化。
    if bytes.len() > LOGIN_ERROR_LIMIT {
        return "harness_auth";
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return "harness_auth";
    };
    let Some(detail) = text.strip_prefix("Error logging in with device code: ") else {
        return "harness_auth";
    };
    if detail.starts_with("failed to write OAuth tokens to keyring:")
        || detail.starts_with("failed to write OAuth tokens to encrypted auth storage:")
    {
        "harness_auth_storage"
    } else if detail.starts_with("device code exchange failed:") {
        "harness_auth_exchange"
    } else if detail.starts_with("error sending request for url ") {
        "harness_auth_network"
    } else if detail.trim_end_matches(['\r', '\n']) == "device auth timed out after 15 minutes" {
        "harness_auth_expired"
    } else {
        "harness_auth"
    }
}

#[cfg(any(test, feature = "native-test"))]
mod implementation {
    use super::*;
    use crate::paths::reject_links;
    use serde_json::json;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::Ordering,
        thread,
        time::{Duration, Instant},
    };

    pub(crate) fn inspect(path: &Path) -> Result<()> {
        if path == Path::new("isolated-fake-codex.exe") {
            Ok(())
        } else {
            Err(failure("harness_runtime"))
        }
    }
    pub(crate) fn inspect_cancellable(path: &Path, _cancel: &AtomicBool) -> Result<()> {
        inspect(path)
    }
    fn marker(root: &Path) -> Result<PathBuf> {
        if !root.is_absolute() {
            return Err(failure("harness_unavailable"));
        }
        let marker = root.join("fake-subscription");
        reject_links(&marker).map_err(|_| failure("harness_unavailable"))?;
        Ok(marker)
    }
    fn delay(cancel: &AtomicBool) -> Result<()> {
        let started = Instant::now();
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err(failure("cancelled"));
            }
            if started.elapsed() >= Duration::from_millis(300) {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
    #[cfg(test)]
    fn auth_fixture(root: &Path, operation: &str, cancel: &AtomicBool) -> Result<()> {
        if root.join(format!("fake-{operation}-stop-failed")).is_file() {
            return Err(failure("harness_stop_failed"));
        }
        if root.join(format!("fake-{operation}-delay")).is_file() {
            delay(cancel)?;
        }
        Ok(())
    }
    pub(crate) fn subscription(root: &Path, path: &Path, cancel: &AtomicBool) -> Result<bool> {
        if cancel.load(Ordering::Acquire) {
            return Err(failure("cancelled"));
        }
        inspect(path)?;
        let marker = marker(root)?;
        #[cfg(test)]
        auth_fixture(root, "status", cancel)?;
        subscription_status(b"Logged in using ChatGPT\n", marker.is_file())
    }
    pub(crate) fn login(
        root: &Path,
        path: &Path,
        cancel: &AtomicBool,
        progress: Progress,
    ) -> Result<()> {
        inspect(path)?;
        if cancel.load(Ordering::Acquire) {
            return Err(failure("cancelled"));
        }
        let prompt=format!("1. Open this link in your browser and sign in to your account\n{DEVICE_URL}\n2. Enter this one-time code (expires in 15 minutes)\nABCD-1234\n");
        let code = device_code(prompt.as_bytes())?.ok_or_else(|| failure("harness_auth"))?;
        progress(DEVICE_URL.to_owned(), code);
        delay(cancel)?;
        fs::write(marker(root)?, b"isolated-test-subscription\n")
            .map_err(|_| failure("harness_auth"))?;
        // 真实 CLI 可能在取消被观察到前写入 keyring；该夹具只在单元测试中复现这一窗口。
        #[cfg(test)]
        if root.join("fake-login-cancel-after-store").is_file() {
            cancel.store(true, Ordering::Release);
            return Err(failure("cancelled"));
        }
        Ok(())
    }
    pub(crate) fn logout(root: &Path, path: &Path, cancel: &AtomicBool) -> Result<()> {
        if cancel.load(Ordering::Acquire) {
            return Err(failure("cancelled"));
        }
        inspect(path)?;
        let marker = marker(root)?;
        #[cfg(test)]
        auth_fixture(root, "logout", cancel)?;
        match fs::remove_file(marker) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(failure("harness_logout")),
        }
    }
    pub(crate) fn execute(
        root: &Path,
        path: &Path,
        model: &str,
        timeout_seconds: u64,
        task: Task,
        _messages: &[Message],
        cancel: &AtomicBool,
    ) -> Result<String> {
        if cancel.load(Ordering::Acquire) {
            return Err(failure("cancelled"));
        }
        inspect(path)?;
        if model != "gpt-6.1-sol" || !(10..=600).contains(&timeout_seconds) {
            return Err(failure("invalid_input"));
        }
        if !subscription(root, path, cancel)? {
            return Err(failure("harness_auth"));
        }
        delay(cancel)?;
        let content=match task{
            Task::ConnectionTest=>json!({"ok":true}),
            Task::QuestionAnalysis=>json!({"analysis":"隔离 Harness 测试解析。","suggestedAnswer":["A"],"matchesLocalAnswer":true,"confidence":"high","needsReview":true,"warning":"请人工核对 AI 生成内容。"}),
            Task::QuestionFollowup=>json!({"reply":"隔离 Harness 测试追问。","revisedAnalysis":"隔离 Harness 测试修订解析。","needsReview":true}),
            Task::ImportOrganize=>json!({"questions":[{"id":"isolated-question","type":"single","question":"隔离测试：1 + 1 = ?","options":["A. 2","B. 3"],"answer":["A"],"analysis":"隔离生成内容，请人工核对。"}]}),
            Task::BatchReview|Task::BatchAnalysis=>json!({"results":[]}),
        }.to_string();
        let events = [
            json!({"type":"thread.started","thread_id":"isolated-fixture"}),
            json!({"type":"turn.started"}),
            json!({"type":"item.completed","item":{"type":"agent_message","text":json!({"content":content}).to_string()}}),
            json!({"type":"turn.completed"}),
        ];
        let output = events
            .into_iter()
            .map(|event| format!("{event}\n"))
            .collect::<String>();
        crate::harness_protocol::parse_output(output.as_bytes(), true)
    }
}

#[cfg(not(any(test, feature = "native-test")))]
mod implementation {
    use super::*;
    use crate::{
        error::Error,
        harness_process,
        harness_runtime::{EXECUTABLE_BYTES, EXECUTABLE_SHA256},
        paths::reject_links,
    };
    use sha2::{Digest, Sha256};
    use std::{
        ffi::OsString,
        fs::{self, File, OpenOptions},
        io::{Read, Write},
        path::PathBuf,
        sync::{atomic::Ordering, Mutex},
        time::Duration,
    };

    const CATALOG: &str = include_str!("harness_model_catalog.json");
    const FEATURES: &str = include_str!("harness_features.txt");
    const SCHEMA: &str = r#"{"type":"object","properties":{"content":{"type":"string"}},"required":["content"],"additionalProperties":false}"#;
    const AUTH_TIMEOUT: Duration = Duration::from_secs(30);
    const LOGIN_TIMEOUT: Duration = Duration::from_secs(15 * 60 + 30);
    type PipeObserver = Arc<dyn Fn(bool, &[u8]) + Send + Sync>;

    fn open_read_locked(path: &Path) -> Result<File> {
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // 只允许其他读者；禁止校验后修改、删除或替换同一文件，句柄持有到进程确认回收。
            OpenOptions::new()
                .read(true)
                .share_mode(1)
                .open(path)
                .map_err(|_| failure("harness_runtime"))
        }
        #[cfg(not(windows))]
        {
            let _ = path;
            Err(failure("harness_platform_unsupported"))
        }
    }
    fn verified_runtime(path: &Path, cancel: Option<&AtomicBool>) -> Result<(PathBuf, File)> {
        if !path.is_absolute()
            || !path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
        {
            return Err(failure("harness_runtime"));
        }
        reject_links(path).map_err(|_| failure("harness_runtime"))?;
        let canonical = fs::canonicalize(path).map_err(|_| failure("harness_runtime"))?;
        let mut file = open_read_locked(&canonical)?;
        reject_links(path).map_err(|_| failure("harness_runtime"))?;
        let metadata = file.metadata().map_err(|_| failure("harness_runtime"))?;
        if !metadata.is_file() || metadata.len() != EXECUTABLE_BYTES {
            return Err(failure("harness_runtime"));
        }
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            if cancel.is_some_and(|cancel| cancel.load(Ordering::Acquire)) {
                return Err(failure("cancelled"));
            }
            let count = file
                .read(&mut buffer)
                .map_err(|_| failure("harness_runtime"))?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        if format!("{:x}", hash.finalize()) != EXECUTABLE_SHA256 {
            return Err(failure("harness_runtime"));
        }
        Ok((canonical, file))
    }
    pub(crate) fn inspect(path: &Path) -> Result<()> {
        verified_runtime(path, None).map(|_| ())
    }
    pub(crate) fn inspect_cancellable(path: &Path, cancel: &AtomicBool) -> Result<()> {
        verified_runtime(path, Some(cancel)).map(|_| ())
    }

    // 认证 home 是稳定的 keyring 命名空间；每次调用的日志、数据库和用户目录均归独立 Run 所有。
    struct Session {
        executable: PathBuf,
        _runtime: File,
        profile: PathBuf,
        run: PathBuf,
        run_parent: PathBuf,
        env: Vec<(OsString, OsString)>,
        protected: Vec<File>,
        cleanup: bool,
    }
    impl Session {
        fn new(root: &Path, path: &Path, cancel: &AtomicBool) -> Result<Self> {
            let (executable, runtime) = verified_runtime(path, Some(cancel))?;
            if !root.is_absolute() {
                return Err(failure("harness_unavailable"));
            }
            reject_links(root).map_err(|_| failure("harness_unavailable"))?;
            let root = fs::canonicalize(root).map_err(|_| failure("harness_unavailable"))?;
            let profile = root.join("profile");
            let run_parent = root.join("runs");
            for path in [&profile, &run_parent] {
                reject_links(path).map_err(|_| failure("harness_unavailable"))?;
                fs::create_dir_all(path).map_err(|_| failure("harness_unavailable"))?;
            }
            check_profile(&profile)?;
            let run = run_parent.join(format!("run-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&run).map_err(|_| failure("harness_unavailable"))?;
            let mut session = Self {
                executable,
                _runtime: runtime,
                profile,
                run,
                run_parent,
                env: Vec::new(),
                protected: Vec::new(),
                cleanup: true,
            };
            let user = session.run.join("home");
            let roaming = user.join("AppData/Roaming");
            let local = user.join("AppData/Local");
            let temporary = session.run.join("temporary");
            for path in [
                &user,
                &roaming,
                &local,
                &temporary,
                &session.run.join("logs"),
                &session.run.join("database"),
            ] {
                fs::create_dir_all(path).map_err(|_| failure("harness_unavailable"))?;
            }
            let system = std::env::var_os("SystemRoot")
                .filter(|value| Path::new(value).is_absolute())
                .ok_or_else(|| failure("harness_unavailable"))?;
            session.env = vec![
                ("SystemRoot".into(), system.clone()),
                ("WINDIR".into(), system),
                ("CODEX_HOME".into(), session.profile.as_os_str().to_owned()),
                ("HOME".into(), user.as_os_str().to_owned()),
                ("USERPROFILE".into(), user.into_os_string()),
                ("APPDATA".into(), roaming.into_os_string()),
                ("LOCALAPPDATA".into(), local.into_os_string()),
                ("TEMP".into(), temporary.as_os_str().to_owned()),
                ("TMP".into(), temporary.into_os_string()),
            ];
            session.protect(".harness-root", b"Shiroha Quiz isolated Codex invocation\n")?;
            session.protect("model-catalog.json", CATALOG.as_bytes())?;
            session.protect("output-schema.json", SCHEMA.as_bytes())?;
            Ok(session)
        }
        fn protect(&mut self, name: &str, bytes: &[u8]) -> Result<()> {
            let path = self.run.join(name);
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|_| failure("harness_unavailable"))?;
            file.write_all(bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| failure("harness_unavailable"))?;
            drop(file);
            let mut file = open_read_locked(&path)?;
            let mut actual = Vec::new();
            (&mut file)
                .take(bytes.len() as u64 + 1)
                .read_to_end(&mut actual)
                .map_err(|_| failure("harness_unavailable"))?;
            if actual != bytes {
                return Err(failure("harness_unavailable"));
            }
            self.protected.push(file);
            Ok(())
        }
        fn arguments(&self, command: &[&str]) -> Result<Vec<String>> {
            let mut args: Vec<String> = command.iter().map(|value| (*value).to_owned()).collect();
            let mut overrides = vec![
                "model=\"gpt-6.1-sol\"".to_owned(),
                "model_provider=\"openai\"".to_owned(),
                format!(
                    "model_catalog_json={}",
                    toml_path(&self.run.join("model-catalog.json"))?
                ),
                "forced_login_method=\"chatgpt\"".into(),
                "analytics.enabled=false".into(),
                "feedback.enabled=false".into(),
                "agents.enabled=false".into(),
                "tools.experimental_request_user_input.enabled=false".into(),
                "tools.update_plan.enabled=false".into(),
                "history.persistence=\"none\"".into(),
                format!("log_dir={}", toml_path(&self.run.join("logs"))?),
                format!("sqlite_home={}", toml_path(&self.run.join("database"))?),
                "approval_policy=\"never\"".into(),
                "sandbox_mode=\"read-only\"".into(),
                "web_search=\"disabled\"".into(),
                "project_doc_max_bytes=0".into(),
                "project_doc_fallback_filenames=[]".into(),
                "project_root_markers=[\".harness-root\"]".into(),
                "cli_auth_credentials_store=\"keyring\"".into(),
                "mcp_servers={}".into(),
                "apps._default.enabled=false".into(),
            ];
            let mut skills = Vec::new();
            for name in [
                "imagegen",
                "openai-docs",
                "skill-creator",
                "skill-installer",
            ] {
                let path = self.profile.join("skills/.system").join(name);
                for path in [&path, &path.join("SKILL.md")] {
                    skills.push(format!("{{path={},enabled=false}}", toml_path(path)?));
                }
            }
            overrides.push(format!("skills.config=[{}]", skills.join(",")));
            // Windows 不能直接容纳较长的 OAuth JSON；官方加密存储仅把密钥放入系统凭据库。
            // 网络路由由官方组件跟随系统设置，清空继承环境后不会被启动器的代理变量覆盖。
            overrides.extend(FEATURES.lines().map(str::to_owned));
            for item in overrides {
                args.push("-c".into());
                args.push(item);
            }
            Ok(args)
        }
        fn run(
            &self,
            args: &[String],
            input: &[u8],
            cancel: &AtomicBool,
            timeout: Duration,
            observer: PipeObserver,
        ) -> Result<harness_process::Output> {
            check_profile(&self.profile)?;
            harness_process::run_observed(
                &self.executable,
                args,
                &self.env,
                &self.run,
                input,
                cancel,
                timeout,
                observer,
            )
        }
        fn status(&self, cancel: &AtomicBool) -> Result<bool> {
            let capture = Arc::new(Mutex::new(Capture::new(STATUS_LIMIT)));
            let observed = capture.clone();
            let result = self.run(
                &self.arguments(&["login", "status"])?,
                b"",
                cancel,
                AUTH_TIMEOUT,
                Arc::new(move |stderr, bytes| {
                    if stderr {
                        if let Ok(mut capture) = observed.lock() {
                            capture.push(bytes);
                        }
                    }
                }),
            )?;
            let capture = capture.lock().map_err(|_| failure("harness_auth"))?;
            if capture.exceeded {
                return Err(failure("harness_auth"));
            }
            subscription_status(&capture.bytes, result.success)
        }
        fn finish<T>(mut self, result: Result<T>) -> Result<T> {
            if result
                .as_ref()
                .is_err_and(|error| error.code == "harness_stop_failed")
            {
                // 上层进入停止未确认状态并要求重启；保留只读锁，不能让仍存活的任务改用另一程序或配置。
                self.cleanup = false;
                std::mem::forget(self);
                return result;
            }
            let profile = check_profile(&self.profile);
            self.protected.clear();
            self.remove_run()?;
            self.cleanup = false;
            profile?;
            result
        }
        fn remove_run(&self) -> Result<()> {
            reject_links(&self.run).map_err(|_| failure("harness_unavailable"))?;
            let canonical =
                fs::canonicalize(&self.run).map_err(|_| failure("harness_unavailable"))?;
            if canonical.parent() != Some(self.run_parent.as_path())
                || !canonical
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("run-"))
            {
                return Err(failure("harness_unavailable"));
            }
            fs::remove_dir_all(canonical).map_err(|_| failure("harness_unavailable"))
        }
    }
    impl Drop for Session {
        fn drop(&mut self) {
            if self.cleanup {
                self.protected.clear();
                let _ = self.remove_run();
            }
        }
    }
    fn toml_path(path: &Path) -> Result<String> {
        let path = path
            .to_str()
            .ok_or_else(|| failure("harness_unavailable"))?;
        serde_json::to_string(path).map_err(|_| failure("harness_unavailable"))
    }
    fn check_profile(profile: &Path) -> Result<()> {
        for name in ["config.toml", "auth.json"] {
            let path = profile.join(name);
            reject_links(&path).map_err(|_| failure("harness_auth"))?;
            match fs::symlink_metadata(&path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err(failure("harness_auth")),
            }
        }
        Ok(())
    }
    struct Capture {
        bytes: Vec<u8>,
        limit: usize,
        exceeded: bool,
    }
    impl Capture {
        fn new(limit: usize) -> Self {
            Self {
                bytes: Vec::new(),
                limit,
                exceeded: false,
            }
        }
        fn push(&mut self, bytes: &[u8]) {
            if self.exceeded {
                return;
            }
            if bytes.len() > self.limit - self.bytes.len() {
                self.exceeded = true;
            } else {
                self.bytes.extend_from_slice(bytes);
            }
        }
    }
    fn auth_error(error: Error, code: &'static str) -> Error {
        match error.code {
            "cancelled" | "timeout" | "harness_stop_failed" | "response_too_large" => {
                failure(error.code)
            }
            _ => failure(code),
        }
    }
    pub(crate) fn subscription(root: &Path, path: &Path, cancel: &AtomicBool) -> Result<bool> {
        if cancel.load(Ordering::Acquire) {
            return Err(failure("cancelled"));
        }
        let session = Session::new(root, path, cancel)?;
        let result = session.status(cancel);
        session.finish(result)
    }
    pub(crate) fn login(
        root: &Path,
        path: &Path,
        cancel: &AtomicBool,
        progress: Progress,
    ) -> Result<()> {
        if cancel.load(Ordering::Acquire) {
            return Err(failure("cancelled"));
        }
        let session = Session::new(root, path, cancel)?;
        let result = (|| {
            let capture = Arc::new(Mutex::new((
                Capture::new(DEVICE_PROMPT_LIMIT),
                None::<String>,
                false,
            )));
            let observed = capture.clone();
            let errors = Arc::new(Mutex::new(Capture::new(LOGIN_ERROR_LIMIT)));
            let observed_errors = errors.clone();
            let output = session
                .run(
                    &session.arguments(&["login", "--device-auth"])?,
                    b"",
                    cancel,
                    LOGIN_TIMEOUT,
                    Arc::new(move |stderr, bytes| {
                        if stderr {
                            if let Ok(mut errors) = observed_errors.lock() {
                                errors.push(bytes);
                            }
                            return;
                        }
                        let code = if let Ok(mut state) = observed.lock() {
                            state.0.push(bytes);
                            if state.0.exceeded {
                                state.2 = true;
                                None
                            } else {
                                match device_code(&state.0.bytes) {
                                    Ok(Some(code)) if state.1.is_none() => {
                                        state.1 = Some(code.clone());
                                        Some(code)
                                    }
                                    Err(_) => {
                                        state.2 = true;
                                        None
                                    }
                                    _ => None,
                                }
                            }
                        } else {
                            None
                        };
                        if let Some(code) = code {
                            progress(DEVICE_URL.to_owned(), code);
                        }
                    }),
                )
                .map_err(|error| auth_error(error, "harness_auth"))?;
            let captured = capture.lock().map_err(|_| failure("harness_auth"))?;
            if !output.success {
                let errors = errors.lock().map_err(|_| failure("harness_auth"))?;
                let code = if errors.exceeded {
                    "harness_auth"
                } else {
                    login_failure_code(&errors.bytes)
                };
                return Err(failure(code));
            }
            if captured.1.is_none() || captured.2 {
                return Err(failure("harness_auth"));
            }
            drop(captured);
            if !session.status(cancel)? {
                return Err(failure("harness_auth_verify"));
            }
            Ok(())
        })();
        session.finish(result)
    }
    pub(crate) fn logout(root: &Path, path: &Path, cancel: &AtomicBool) -> Result<()> {
        if cancel.load(Ordering::Acquire) {
            return Err(failure("cancelled"));
        }
        let session = Session::new(root, path, cancel)
            .map_err(|error| auth_error(error, "harness_logout"))?;
        let result = (|| {
            let output = session
                .run(
                    &session.arguments(&["logout"])?,
                    b"",
                    cancel,
                    AUTH_TIMEOUT,
                    Arc::new(|_, _| {}),
                )
                .map_err(|error| auth_error(error, "harness_logout"))?;
            if !output.success || session.status(cancel)? {
                return Err(failure("harness_logout"));
            }
            Ok(())
        })();
        session
            .finish(result)
            .map_err(|error| auth_error(error, "harness_logout"))
    }
    pub(crate) fn execute(
        root: &Path,
        path: &Path,
        model: &str,
        timeout_seconds: u64,
        task: Task,
        messages: &[Message],
        cancel: &AtomicBool,
    ) -> Result<String> {
        if cancel.load(Ordering::Acquire) {
            return Err(failure("cancelled"));
        }
        if model != "gpt-6.1-sol"
            || !(10..=600).contains(&timeout_seconds)
            || messages.is_empty()
            || messages.len() > 100
        {
            return Err(failure("invalid_input"));
        }
        if messages
            .iter()
            .map(|message| message.content.len())
            .sum::<usize>()
            > 512 * 1024
        {
            return Err(failure("payload_too_large"));
        }
        let session = Session::new(root, path, cancel)?;
        let result = (|| {
            if !session.status(cancel)? {
                return Err(failure("harness_auth"));
            }
            let mut args = session.arguments(&[
                "exec",
                "--ignore-user-config",
                "--ignore-rules",
                "--ephemeral",
                "--strict-config",
                "--skip-git-repo-check",
                "--json",
                "--color",
                "never",
            ])?;
            args.extend([
                "--output-schema".into(),
                session
                    .run
                    .join("output-schema.json")
                    .to_str()
                    .ok_or_else(|| failure("harness_unavailable"))?
                    .to_owned(),
                "-".into(),
            ]);
            let input=serde_json::to_vec(&serde_json::json!({"task":task,"messages":messages,"output_contract":"Return exactly one object with a content string. The content string contains the complete JSON object or array requested by the task messages. Do not invoke tools or include any extra envelope fields."})).map_err(|_|failure("invalid_input"))?;
            check_profile(&session.profile)?;
            let output = harness_process::run(
                &session.executable,
                &args,
                &session.env,
                &session.run,
                &input,
                cancel,
                Duration::from_secs(timeout_seconds),
            )?;
            crate::harness_protocol::parse_output(&output.stdout, output.success)
        })();
        session.finish(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelled_inspection_does_not_check_or_open_selected_program() {
        assert_eq!(
            inspect_cancellable(Path::new("not-a-runtime"), &AtomicBool::new(true))
                .unwrap_err()
                .code,
            "cancelled"
        );
    }
    #[test]
    fn runtime_manifest_matches_execution_protocol_version() {
        assert_eq!(VERSION, crate::harness_runtime::VERSION);
    }
    use std::{
        fs,
        path::PathBuf,
        sync::{atomic::Ordering, Mutex},
        thread,
        time::Duration,
    };

    const PROMPT: &str = "\nWelcome to Codex [v0.163.0]\nOpenAI's command-line coding agent\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   https://auth.openai.com/codex/device\n\n2. Enter this one-time code (expires in 15 minutes)\n   ABCD-1234\n\nContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\n\n";
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("shiroha-native-codex-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn executable(&self) -> &Path {
            Path::new("isolated-fake-codex.exe")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn device_code_requires_fixed_url_anchor_and_complete_code_line() {
        assert_eq!(
            device_code(PROMPT.as_bytes()).unwrap().as_deref(),
            Some("ABCD-1234")
        );
        let ansi = PROMPT.replace("ABCD-1234", "\u{1b}[1;32mABCD-1234\u{1b}[0m");
        assert_eq!(
            device_code(ansi.as_bytes()).unwrap().as_deref(),
            Some("ABCD-1234")
        );
        let code_end = ansi.find("ABCD-1234").unwrap() + "ABCD-1234".len();
        assert_eq!(device_code(&ansi.as_bytes()[..code_end]).unwrap(), None);
        for invalid in [
            PROMPT.replace(DEVICE_URL, "https://example.invalid/codex/device"),
            PROMPT.replace(
                "2. Enter this one-time code",
                "2. Enter this arbitrary code",
            ),
            PROMPT.replace("ABCD-1234", "abcd-1234"),
            PROMPT.replace("ABCD-1234", "ABCD-1234 /other"),
            PROMPT.replace("ABCD-1234", "ABCDE"),
            PROMPT.replace("ABCD-1234", "ABCDEFGHIJKLMNOPQ"),
            PROMPT.replace("ABCD-1234", "\u{1b}[2JABCD-1234"),
        ] {
            assert!(!matches!(device_code(invalid.as_bytes()), Ok(Some(_))));
        }
        assert!(device_code(&vec![b'x'; DEVICE_PROMPT_LIMIT + 1]).is_err());
    }

    #[test]
    fn credential_storage_and_system_proxy_do_not_enable_tools() {
        let enabled: Vec<_> = include_str!("harness_features.txt")
            .lines()
            .filter(|line| !line.ends_with("=false"))
            .collect();
        assert_eq!(
            enabled,
            [
                "features.respect_system_proxy=true",
                "features.secret_auth_storage=true"
            ]
        );
    }

    #[test]
    fn login_failure_reports_only_a_fixed_stage_without_provider_details() {
        for (detail, expected) in [
            (
                "failed to write OAuth tokens to keyring: secret-fixture",
                "harness_auth_storage",
            ),
            (
                "failed to write OAuth tokens to encrypted auth storage: secret-fixture",
                "harness_auth_storage",
            ),
            (
                "device code exchange failed: secret-fixture",
                "harness_auth_exchange",
            ),
            (
                "error sending request for url secret-fixture",
                "harness_auth_network",
            ),
            (
                "device auth timed out after 15 minutes",
                "harness_auth_expired",
            ),
            ("unknown secret-fixture", "harness_auth"),
            ("device code exchange failed: failed to write OAuth tokens to keyring: secret-fixture", "harness_auth_exchange"),
            ("unknown error sending request for url secret-fixture", "harness_auth"),
        ] {
            let code = login_failure_code(
                format!("Error logging in with device code: {detail}").as_bytes(),
            );
            assert_eq!(code, expected);
            assert!(!failure(code).message.contains("secret-fixture"));
        }
        assert_eq!(login_failure_code(&[0xff]), "harness_auth");
        assert_eq!(
            login_failure_code(b"warning: failed to write OAuth tokens to keyring: secret-fixture"),
            "harness_auth"
        );
        assert_eq!(
            login_failure_code(&vec![b'x'; LOGIN_ERROR_LIMIT + 1]),
            "harness_auth"
        );
    }

    #[test]
    fn subscription_accepts_only_exact_chatgpt_status_and_success() {
        for bytes in [
            b"Logged in using ChatGPT".as_slice(),
            b"Logged in using ChatGPT\n",
            b"Logged in using ChatGPT\r\n",
        ] {
            assert!(subscription_status(bytes, true).unwrap());
            assert!(!subscription_status(bytes, false).unwrap());
        }
        for bytes in [
            b"Logged in using an API key".as_slice(),
            b" Logged in using ChatGPT\n",
            b"Logged in using ChatGPT\n\n",
            b"warning\nLogged in using ChatGPT\n",
            b"Logged in using ChatGPT\0",
        ] {
            assert!(!subscription_status(bytes, true).unwrap());
        }
        assert!(subscription_status(&vec![b'x'; STATUS_LIMIT + 1], true).is_err());
    }

    #[test]
    fn test_build_only_accepts_fake_runtime_and_never_starts_a_program() {
        let fixture = Fixture::new();
        inspect(fixture.executable()).unwrap();
        for path in [
            Path::new("codex.exe"),
            Path::new("C:\\Windows\\System32\\cmd.exe"),
        ] {
            assert_eq!(inspect(path).unwrap_err().code, "harness_runtime");
            assert!(subscription(&fixture.0, path, &AtomicBool::new(false)).is_err());
        }
        assert!(!subscription(&fixture.0, fixture.executable(), &AtomicBool::new(false)).unwrap());
    }

    #[test]
    fn fake_login_execute_and_logout_use_only_isolated_marker_and_jsonl_parser() {
        let fixture = Fixture::new();
        let captured = Arc::new(Mutex::new(None));
        let progress = captured.clone();
        login(
            &fixture.0,
            fixture.executable(),
            &AtomicBool::new(false),
            Arc::new(move |url, code| *progress.lock().unwrap() = Some((url, code))),
        )
        .unwrap();
        assert_eq!(
            *captured.lock().unwrap(),
            Some((DEVICE_URL.to_owned(), "ABCD-1234".to_owned()))
        );
        assert!(subscription(&fixture.0, fixture.executable(), &AtomicBool::new(false)).unwrap());
        for task in [
            Task::ConnectionTest,
            Task::QuestionAnalysis,
            Task::QuestionFollowup,
            Task::ImportOrganize,
            Task::BatchReview,
            Task::BatchAnalysis,
        ] {
            let content = execute(
                &fixture.0,
                fixture.executable(),
                "gpt-6.1-sol",
                30,
                task,
                &[Message {
                    role: "user".into(),
                    content: "synthetic".into(),
                }],
                &AtomicBool::new(false),
            )
            .unwrap();
            let value: serde_json::Value = serde_json::from_str(&content).unwrap();
            assert!(value.is_object() || value.is_array());
        }
        logout(&fixture.0, fixture.executable(), &AtomicBool::new(false)).unwrap();
        assert!(!subscription(&fixture.0, fixture.executable(), &AtomicBool::new(false)).unwrap());
    }

    #[test]
    fn cancellation_prevents_fake_login_and_execution_completion() {
        let fixture = Fixture::new();
        let cancel = AtomicBool::new(false);
        thread::scope(|scope| {
            let pending = scope.spawn(|| {
                login(
                    &fixture.0,
                    fixture.executable(),
                    &cancel,
                    Arc::new(|_, _| {}),
                )
            });
            thread::sleep(Duration::from_millis(50));
            cancel.store(true, Ordering::Release);
            assert_eq!(pending.join().unwrap().unwrap_err().code, "cancelled");
        });
        assert!(!subscription(&fixture.0, fixture.executable(), &AtomicBool::new(false)).unwrap());
        assert_eq!(
            execute(
                &fixture.0,
                fixture.executable(),
                "gpt-6.1-sol",
                30,
                Task::ConnectionTest,
                &[],
                &cancel
            )
            .unwrap_err()
            .code,
            "cancelled"
        );
    }

    #[test]
    fn cancelled_status_and_logout_preserve_the_fake_subscription() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("fake-subscription"), b"isolated").unwrap();
        let cancel = AtomicBool::new(true);
        assert_eq!(
            subscription(&fixture.0, fixture.executable(), &cancel)
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert_eq!(
            logout(&fixture.0, fixture.executable(), &cancel)
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert!(fixture.0.join("fake-subscription").is_file());
    }

    #[test]
    fn cancelled_login_may_have_stored_auth_and_requires_explicit_cleanup() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("fake-login-cancel-after-store"), b"isolated").unwrap();
        let cancel = AtomicBool::new(false);
        assert_eq!(
            login(
                &fixture.0,
                fixture.executable(),
                &cancel,
                Arc::new(|_, _| {})
            )
            .unwrap_err()
            .code,
            "cancelled"
        );
        assert!(subscription(&fixture.0, fixture.executable(), &AtomicBool::new(false)).unwrap());
        logout(&fixture.0, fixture.executable(), &AtomicBool::new(false)).unwrap();
        assert!(!subscription(&fixture.0, fixture.executable(), &AtomicBool::new(false)).unwrap());
    }

    #[test]
    fn in_flight_fake_auth_commands_observe_cancellation() {
        for operation in ["status", "logout"] {
            let fixture = Fixture::new();
            fs::write(fixture.0.join("fake-subscription"), b"isolated").unwrap();
            fs::write(
                fixture.0.join(format!("fake-{operation}-delay")),
                b"isolated",
            )
            .unwrap();
            let cancel = AtomicBool::new(false);
            thread::scope(|scope| {
                let pending = scope.spawn(|| {
                    if operation == "status" {
                        subscription(&fixture.0, fixture.executable(), &cancel).map(|_| ())
                    } else {
                        logout(&fixture.0, fixture.executable(), &cancel)
                    }
                });
                thread::sleep(Duration::from_millis(50));
                cancel.store(true, Ordering::Release);
                assert_eq!(pending.join().unwrap().unwrap_err().code, "cancelled");
            });
            assert!(fixture.0.join("fake-subscription").is_file());
        }
    }
}
