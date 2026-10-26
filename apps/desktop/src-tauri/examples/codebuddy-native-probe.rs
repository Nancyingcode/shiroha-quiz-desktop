#[cfg(windows)]
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--codebuddy-worker") {
        if shiroha_quiz_desktop::harness_codebuddy::run_worker().is_err() {
            std::process::exit(1);
        }
        return;
    }
    if let Err(code) = probe() {
        eprintln!("{code}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("仅支持 Windows 原生隔离探针");
    std::process::exit(1);
}

#[cfg(windows)]
fn probe() -> Result<(), &'static str> {
    use serde_json::json;
    use shiroha_quiz_desktop::harness_codebuddy::PrototypeOptions;
    use std::{
        path::PathBuf,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };
    let mut arguments: Vec<_> = std::env::args_os().skip(1).collect();
    if arguments.first().is_some_and(|value| value == "login") && arguments.len() == 1 {
        return login();
    }
    let live_mode = arguments
        .first()
        .and_then(|value| value.to_str())
        .filter(|value| matches!(*value, "live" | "live-connection"));
    if let Some(mode) = live_mode.filter(|_| arguments.len() == 3) {
        let cli =
            std::fs::canonicalize(PathBuf::from(&arguments[1])).map_err(|_| "runtime_missing")?;
        let parent = std::fs::canonicalize(PathBuf::from(&arguments[2]))
            .map_err(|_| "test_directory_missing")?;
        let scenarios: &[&str] = if mode == "live-connection" {
            &["connection"]
        } else {
            &["connection", "question", "followup"]
        };
        return live(cli, parent, scenarios);
    }
    if arguments
        .first()
        .is_some_and(|value| value == "offline-models")
    {
        if arguments.len() != 4 {
            return Err("用法：codebuddy-native-probe offline-models <正式 EXE> <固定 CodeBuddy EXE> <已有隔离测试目录>");
        }
        let worker =
            std::fs::canonicalize(PathBuf::from(&arguments[1])).map_err(|_| "worker_missing")?;
        let cli =
            std::fs::canonicalize(PathBuf::from(&arguments[2])).map_err(|_| "runtime_missing")?;
        let parent = std::fs::canonicalize(PathBuf::from(&arguments[3]))
            .map_err(|_| "test_directory_missing")?;
        return offline_models(&worker, &cli, &parent);
    }
    let worker = if arguments
        .first()
        .is_some_and(|value| value == "offline-worker")
    {
        if !matches!(arguments.len(), 4 | 5) {
            return Err("用法：codebuddy-native-probe offline-worker <正式 EXE> <固定 CodeBuddy EXE> <已有隔离测试目录> [离线场景]");
        }
        let worker =
            std::fs::canonicalize(PathBuf::from(&arguments[1])).map_err(|_| "worker_missing")?;
        arguments.drain(..2);
        Some(worker)
    } else {
        None
    };
    if arguments.len() < 2 || arguments.len() > 3 {
        return Err("用法：codebuddy-native-probe login；真实验证为 codebuddy-native-probe <live-connection|live> <固定 CodeBuddy EXE> <已有隔离测试目录>；离线验证为 codebuddy-native-probe <固定 CodeBuddy EXE> <已有隔离测试目录> [stop|reasoning|empty_fields|gateway_fields|terminal_delta|legacy_function|unknown_extension|duplicate_field|length|refusal|eof|tool|cancel|timeout|parallel|all]");
    }
    let cli = std::fs::canonicalize(PathBuf::from(&arguments[0])).map_err(|_| "runtime_missing")?;
    let parent = std::fs::canonicalize(PathBuf::from(&arguments[1]))
        .map_err(|_| "test_directory_missing")?;
    let selection = arguments
        .get(2)
        .and_then(|value| value.to_str())
        .unwrap_or("all");
    let cases = [
        "stop",
        "analysis",
        "followup",
        "reasoning",
        "empty_fields",
        "gateway_fields",
        "terminal_delta",
        "legacy_function",
        "unknown_extension",
        "duplicate_field",
        "length",
        "refusal",
        "eof",
        "tool",
        "cancel",
        "timeout",
    ];
    if selection != "all" && selection != "parallel" && !cases.contains(&selection) {
        return Err("unknown_scenario");
    }
    let mut failed = false;
    for scenario in cases
        .into_iter()
        .filter(|case| selection == "all" || selection == *case)
    {
        let cancel = Arc::new(AtomicBool::new(false));
        let callback_cancel = cancel.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let callback_calls = calls.clone();
        let expected = offline_candidate(scenario);
        let response_candidate = expected.clone();
        let output = run_offline_fixture(
            PrototypeOptions {
                cli: cli.clone(),
                parent: parent.clone(),
                model: "default".to_owned(),
                prompt: "Return the host-provided JSON answer verbatim. Do not call tools or add formatting.".to_owned(),
                timeout: Duration::from_secs(if scenario == "timeout" { 8 } else { 25 }),
            },
            worker.as_deref(),
            cancel,
            move |_, context| {
                callback_calls.fetch_add(1, Ordering::AcqRel);
                if scenario == "cancel" {
                    callback_cancel.store(true, Ordering::Release);
                }
                if matches!(scenario, "cancel" | "timeout") {
                    while !context.cancelled.load(Ordering::Acquire)
                        && std::time::Instant::now() < context.deadline
                    {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                }
                let chunk = |delta, finish| {
                    format!(
                        "data: {}\n\n",
                        json!({"id":"native-fixture", "choices":[{"index":0, "delta":delta, "finish_reason":finish}]})
                    )
                };
                let mut response = chunk(
                    json!({"role":"assistant","content":response_candidate}),
                    serde_json::Value::Null,
                );
                if scenario == "reasoning" {
                    response = chunk(
                        json!({"role":"assistant","content":null,"reasoning_content":"Synthetic reasoning must never enter the CLI answer.","tool_calls":null,"function_call":null,"refusal":null}),
                        serde_json::Value::Null,
                    );
                    response += &chunk(
                        json!({"role":null,"content":"{\"ok\":true}","reasoning_content":null,"tool_calls":[],"function_call":null,"refusal":""}),
                        serde_json::Value::Null,
                    );
                } else if scenario == "empty_fields" {
                    response = chunk(
                        json!({"role":"assistant","content":"{\"ok\":true}","reasoning_content":"","tool_calls":[],"function_call":null,"refusal":""}),
                        serde_json::Value::Null,
                    );
                } else if scenario == "gateway_fields" {
                    response = chunk(
                        json!({"role":"assistant","content":"","reasoning":"Synthetic private reasoning.","redacted_thinking":"synthetic-encrypted-data","extra_fields":{"signature":"synthetic-signature"},"tool_calls":[],"function_call":null,"refusal":""}),
                        json!(""),
                    );
                    response += &chunk(
                        json!({"content":"{\"ok\":true}","reasoning_content":"","function_call":{"name":"","arguments":""}}),
                        json!(""),
                    );
                } else if scenario == "terminal_delta" {
                    response = chunk(json!({"content":"{\"ok\":"}), json!(""));
                } else if scenario == "legacy_function" {
                    response += &chunk(
                        json!({"function_call":{"name":"Write","arguments":"{}"}}),
                        serde_json::Value::Null,
                    );
                } else if scenario == "unknown_extension" {
                    response += &chunk(
                        json!({"extra_fields":{"signature":"","_meta":null}}),
                        serde_json::Value::Null,
                    );
                } else if scenario == "duplicate_field" {
                    response += "data: {\"id\":\"native-fixture\",\"choices\":[{\"index\":0,\"delta\":{\"refusal\":\"Synthetic refusal\",\"refusal\":\"\"},\"finish_reason\":null}]}\n\n";
                }
                if scenario == "tool" {
                    response = chunk(
                        json!({"tool_calls":[{"index":0,"id":"fake-tool","type":"function","function":{"name":"Write","arguments":"{}"}}]}),
                        json!("tool_calls"),
                    );
                } else if scenario == "refusal" {
                    response += &chunk(json!({"refusal":"Synthetic refusal"}), json!("stop"));
                    response += "data: [DONE]\n\n";
                } else if scenario != "eof" {
                    response += &chunk(
                        if scenario == "terminal_delta" {
                            json!({"content":"true}"})
                        } else {
                            json!({"content":null})
                        },
                        json!(if scenario == "length" {
                            "length"
                        } else {
                            "stop"
                        }),
                    );
                    response += "data: [DONE]\n\n";
                }
                Ok(response.into_bytes())
            },
        );
        let requests = calls.load(Ordering::Acquire);
        let passed = match (scenario, &output) {
            (
                "stop" | "analysis" | "followup" | "reasoning" | "empty_fields" | "gateway_fields"
                | "terminal_delta",
                Ok(text),
            ) => text == &expected && requests == 1,
            ("eof", Err(error)) => error.code == "codebuddy_upstream_incomplete" && requests == 1,
            ("tool" | "legacy_function", Err(error)) => {
                error.code == "codebuddy_upstream_tool_call" && requests == 1
            }
            ("length", Err(error)) => error.code == "codebuddy_upstream_length" && requests == 1,
            ("unknown_extension", Err(error)) => {
                error.code == "codebuddy_upstream_unknown_field" && requests == 1
            }
            ("refusal" | "duplicate_field", Err(error)) => {
                error.code == "codebuddy_upstream_unverified" && requests == 1
            }
            ("cancel", Err(error)) => error.code == "cancelled" && requests == 1,
            ("timeout", Err(error)) => error.code == "timeout" && requests == 1,
            _ => false,
        };
        failed |= !passed;
        println!(
            "{}",
            json!({"scenario":scenario,"passed":passed,"upstreamRequests":requests,"candidateBytes":output.as_ref().ok().map(String::len),"error":output.as_ref().err().map(|error| error.code)})
        );
    }
    if matches!(selection, "all" | "parallel") {
        let mut workers = Vec::new();
        for text in ["{\"task\":\"first\"}", "{\"task\":\"second\"}"] {
            let cli = cli.clone();
            let parent = parent.clone();
            let worker = worker.clone();
            workers.push(std::thread::spawn(move || {
                run_offline_fixture(PrototypeOptions { cli, parent, model: "poc-model".into(), prompt: "Return the requested synthetic JSON.".into(), timeout: Duration::from_secs(25) }, worker.as_deref(), Arc::new(AtomicBool::new(false)), move |_, _| {
                    Ok(format!("data: {}\n\ndata: [DONE]\n\n", json!({"id":"parallel-fixture", "choices":[{"index":0, "delta":{"role":"assistant","content":text}, "finish_reason":"stop"}]})).into_bytes())
                }).is_ok_and(|output| output == text)
            }));
        }
        let mut passed = true;
        for worker in workers {
            passed &= worker.join().unwrap_or(false);
        }
        failed |= !passed;
        println!(
            "{}",
            json!({"scenario":"parallel", "passed":passed, "independentTasks":2})
        );
    }
    if failed {
        Err("native_probe_failed")
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn offline_models(
    worker: &std::path::Path,
    cli: &std::path::Path,
    parent: &std::path::Path,
) -> Result<(), &'static str> {
    use serde_json::json;
    use shiroha_quiz_desktop::{error::Error, harness_codebuddy::PrototypeOptions};
    use std::{
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    if offline_run_count(parent)? != 0 {
        return Err("offline_model_directory_busy");
    }
    for model in ["deepseek-v4.1-flash", "hy4-preview", "hy3", "default"] {
        let expected = json!({"ok":true,"model":model}).to_string();
        let response_candidate = expected.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let callback_calls = calls.clone();
        let model_matches = Arc::new(AtomicBool::new(false));
        let callback_model_matches = model_matches.clone();
        let output = run_offline_fixture(
            PrototypeOptions {
                cli: cli.to_path_buf(),
                parent: parent.to_path_buf(),
                model: model.to_owned(),
                prompt: "Return the host-provided JSON answer verbatim. Do not call tools or add formatting.".to_owned(),
                timeout: Duration::from_secs(25),
            },
            Some(worker),
            Arc::new(AtomicBool::new(false)),
            move |body, _| {
                callback_calls.fetch_add(1, Ordering::AcqRel);
                if body.get("model").and_then(serde_json::Value::as_str) != Some(model) {
                    return Err(Error::new("codebuddy_probe_model_mismatch"));
                }
                callback_model_matches.store(true, Ordering::Release);
                Ok(format!(
                    "data: {}\n\ndata: [DONE]\n\n",
                    json!({"id":"model-fixture","choices":[{"index":0,"delta":{"role":"assistant","content":response_candidate},"finish_reason":"stop"}]}),
                )
                .into_bytes())
            },
        );
        let requests = calls.load(Ordering::Acquire);
        let model_matches = model_matches.load(Ordering::Acquire);
        let remaining = offline_run_count(parent)?;
        let candidate_matches = output.as_ref().is_ok_and(|text| text == &expected);
        let passed = candidate_matches && model_matches && requests == 1 && remaining == 0;
        println!(
            "{}",
            json!({"scenario":"model-selection","model":model,"passed":passed,"requestModelMatches":model_matches,"candidateMatches":candidate_matches,"upstreamRequests":requests,"runDirectoriesRemaining":remaining,"candidateBytes":output.as_ref().ok().map(String::len),"error":output.as_ref().err().map(|error| error.code)})
        );
        if !passed {
            return Err("native_model_probe_failed");
        }
    }
    Ok(())
}

#[cfg(windows)]
fn offline_run_count(parent: &std::path::Path) -> Result<usize, &'static str> {
    let mut count = 0;
    for entry in std::fs::read_dir(parent).map_err(|_| "test_directory_unreadable")? {
        let entry = entry.map_err(|_| "test_directory_unreadable")?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("codebuddy-run-")
        {
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(windows)]
fn offline_candidate(scenario: &str) -> String {
    use serde_json::json;
    let analysis = "合成数学题：已知 x = 2，求 y = x² + 1。\n代入公式：\\[y = 2^2 + 1 = 5\\]。\n分式写作 \\frac{1}{2}，保留反斜线、中文标点和换行。\n".repeat(60);
    match scenario {
        "analysis" => json!({"analysis":analysis,"suggestedAnswer":"B","matchesLocalAnswer":true,"confidence":"HIGH","needsReview":true,"warning":"离线合成内容，待人工核对。"}).to_string(),
        "followup" => json!({"reply":"可以，逐步核对如下。\n\\[2^2+1=5\\]。\n".repeat(80),"revisedAnalysis":analysis,"confidence":"HIGH","needsReview":true,"warning":"保留旧稿，确认后才能采用新稿。"}).to_string(),
        _ => "{\"ok\":true}".into(),
    }
}

#[cfg(windows)]
fn run_offline_fixture<F>(
    options: shiroha_quiz_desktop::harness_codebuddy::PrototypeOptions,
    worker: Option<&std::path::Path>,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    upstream: F,
) -> shiroha_quiz_desktop::error::Result<String>
where
    F: FnOnce(
            serde_json::Value,
            shiroha_quiz_desktop::harness_codebuddy::RequestContext,
        ) -> shiroha_quiz_desktop::error::Result<Vec<u8>>
        + Send
        + 'static,
{
    match worker {
        Some(worker) => shiroha_quiz_desktop::harness_codebuddy::run_prototype_with_worker(
            options, worker, cancel, upstream,
        ),
        None => shiroha_quiz_desktop::harness_codebuddy::run_prototype(options, cancel, upstream),
    }
}

#[cfg(windows)]
const RUNTIME_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
#[cfg(windows)]
const MAX_LIVE_EXPLANATION_CHARS: usize = 60;
#[cfg(windows)]
const LIVE_CONNECTION_TOKENS: u64 = 1024;
#[cfg(windows)]
const LIVE_QUESTION_TOKENS: u64 = 2048;

#[cfg(windows)]
fn login() -> Result<(), &'static str> {
    use shiroha_quiz_desktop::harness_codebuddy_auth::Client;
    use std::sync::atomic::AtomicBool;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "runtime_start_failed")?;
    let outcome = runtime.block_on(async {
        let client = Client::new().map_err(|error| error.code)?;
        let challenge = client.begin().await.map_err(|error| error.code)?;
        println!(
            "请在浏览器完成个人账户登录（5 分钟内有效）：{}",
            challenge.login_url()
        );
        let mut session = client
            .complete_account(challenge, &AtomicBool::new(false))
            .await
            .map_err(|error| error.code)?;
        println!("个人账户登录已核对，未发起模型请求。退出时清除内存会话。");
        session.invalidate();
        Ok(())
    });
    runtime.shutdown_timeout(RUNTIME_SHUTDOWN_TIMEOUT);
    outcome
}

#[cfg(windows)]
fn live_request(scenario: &str, previous: Option<&str>) -> Option<serde_json::Value> {
    use serde_json::json;
    const QUESTION: &str = "合成练习：1+1=? A.1 B.2 C.3 D.4。仅输出JSON，含answer（正确选项字母）和explanation（不超过60字的中文解释）。";
    let mut messages = vec![
        json!({"role":"system","content":"你是练习讲解助手。仅返回要求的JSON，不加Markdown，不使用工具。"}),
    ];
    match scenario {
        "connection" => messages.push(json!({"role":"user","content":"仅输出JSON：{\"ok\":true}"})),
        "question" => messages.push(json!({"role":"user","content":QUESTION})),
        "followup" => {
            let previous = previous.filter(|text| live_candidate_matches("question", text))?;
            messages.push(json!({"role":"user","content":QUESTION}));
            messages.push(json!({"role":"assistant","content":previous}));
            messages.push(json!({"role":"user","content":"请再用一句话解释为什么A不正确。仅输出JSON，仍含answer（正确选项字母）和explanation（不超过60字）。"}));
        }
        _ => return None,
    }
    Some(
        json!({"model":"default","stream":true,"stream_options":{"include_usage":true},"max_tokens":if scenario == "connection" {LIVE_CONNECTION_TOKENS} else {LIVE_QUESTION_TOKENS},"messages":messages}),
    )
}

#[cfg(windows)]
fn live_candidate_matches(scenario: &str, candidate: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(candidate) else {
        return false;
    };
    if scenario == "connection" {
        return value == serde_json::json!({"ok":true});
    }
    matches!(scenario, "question" | "followup")
        && value.as_object().is_some_and(|object| object.len() == 2)
        && value["answer"] == "B"
        && value["explanation"].as_str().is_some_and(|text| {
            !text.trim().is_empty() && text.chars().count() <= MAX_LIVE_EXPLANATION_CHARS
        })
}

#[cfg(windows)]
fn live_report(
    scenario: &str,
    requests: usize,
    result: &Result<String, shiroha_quiz_desktop::error::Error>,
) -> (bool, serde_json::Value) {
    let passed = requests == 1
        && result
            .as_ref()
            .is_ok_and(|text| live_candidate_matches(scenario, text));
    let candidate = result.as_ref().ok().filter(|_| passed);
    (
        passed,
        serde_json::json!({"scenario":scenario,"passed":passed,"upstreamAttempts":requests,"candidate":candidate,"error":result.as_ref().err().map(|error| error.code)}),
    )
}

#[cfg(windows)]
fn shutdown_runtime(
    runtime: std::sync::Arc<tokio::runtime::Runtime>,
    timeout: std::time::Duration,
) {
    match std::sync::Arc::try_unwrap(runtime) {
        Ok(runtime) => runtime.shutdown_timeout(timeout),
        Err(runtime) => {
            // 仍有回调持有 driver 时不能通过 Arc 的默认 Drop 等待，进程是最后的回收边界。
            std::mem::forget(runtime);
            eprintln!("live_runtime_cleanup_failed");
            std::process::exit(1);
        }
    }
}

#[cfg(windows)]
fn live(
    cli: std::path::PathBuf,
    parent: std::path::PathBuf,
    scenarios: &[&'static str],
) -> Result<(), &'static str> {
    use shiroha_quiz_desktop::{
        error::Error,
        harness_codebuddy::{run_prototype, PrototypeOptions},
        harness_codebuddy_auth::Client,
    };
    use std::{
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc, Mutex,
        },
        time::{Duration, Instant},
    };
    let runtime = Arc::new(
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| "runtime_start_failed")?,
    );
    let outcome = (|| {
        let client = Client::new().map_err(|error| error.code)?;
        let session = runtime
            .block_on(async {
                let challenge = client.begin().await?;
                println!(
                    "请在浏览器登录；核对成功后最多进行 {} 项合成模型测试（连接 {} token，单题/追问各 {} token；失败即停止，不自动重试）：{}",
                    scenarios.len(),
                    LIVE_CONNECTION_TOKENS,
                    LIVE_QUESTION_TOKENS,
                    challenge.login_url()
                );
                client.complete_account(challenge, &AtomicBool::new(false)).await
            })
            .map_err(|error| error.code)?;
        println!("个人账户核对成功，开始受限真实链路测试。");
        let session = Arc::new(Mutex::new(session));
        let mut previous = None;
        let mut outcome = Ok(());
        let outcome = (|| {
            for &scenario in scenarios {
                let request =
                    live_request(scenario, previous.as_deref()).ok_or("live_context_invalid")?;
                let prompt = request["messages"]
                    .as_array()
                    .ok_or("live_context_invalid")?
                    .iter()
                    .map(|message| message["content"].as_str().unwrap_or_default())
                    .collect::<Vec<_>>()
                    .join("\n");
                let request_runtime = runtime.clone();
                let request_session = session.clone();
                let requests = Arc::new(AtomicUsize::new(0));
                let counted = requests.clone();
                let result = run_prototype(
                    PrototypeOptions {
                        cli: cli.clone(),
                        parent: parent.clone(),
                        model: "default".into(),
                        prompt,
                        timeout: Duration::from_secs(120),
                    },
                    Arc::new(AtomicBool::new(false)),
                    move |_, context| {
                        if context.cancelled.load(Ordering::Acquire) {
                            return Err(Error::new("cancelled"));
                        }
                        if Instant::now() >= context.deadline {
                            return Err(Error::new("timeout"));
                        }
                        let mut active = request_session
                            .try_lock()
                            .map_err(|_| Error::new("live_session_busy"))?;
                        counted.fetch_add(1, Ordering::AcqRel);
                        // 同一个 runtime 贯穿登录和请求，避免连接池绑定已销毁的 I/O driver。
                        let response = request_runtime.block_on(async {
                            tokio::time::timeout_at(
                                context.deadline.into(),
                                active.model(request, &context.cancelled),
                            )
                            .await
                            .map_err(|_| Error::new("timeout"))?
                        });
                        match &response {
                            Ok(bytes) => println!(
                                "{}",
                                serde_json::json!({"scenario":scenario,"upstream":live_sse_shape(bytes)})
                            ),
                            Err(error) => println!(
                                "{}",
                                serde_json::json!({"scenario":scenario,"upstreamError":error.code})
                            ),
                        }
                        response
                    },
                );
                let (passed, report) =
                    live_report(scenario, requests.load(Ordering::Acquire), &result);
                println!("{report}");
                if !passed {
                    outcome = Err("live_probe_failed");
                    break;
                }
                if scenario == "question" {
                    previous = result.ok();
                }
            }
            outcome
        })();
        // 回调失败退出也不能让主线程无限等待持有令牌的线程；进程结束是最后的回收边界。
        session
            .try_lock()
            .map_err(|_| "live_session_cleanup_failed")?
            .invalidate();
        println!("测试结束，内存会话已失效；未保存令牌。");
        outcome
    })();
    shutdown_runtime(runtime, RUNTIME_SHUTDOWN_TIMEOUT);
    outcome
}

#[cfg(windows)]
fn diagnostic_fields(value: &serde_json::Value, allowed: &[&str]) -> serde_json::Value {
    let Some(object) = value.as_object() else {
        return serde_json::Value::Null;
    };
    let names: Vec<_> = allowed
        .iter()
        .copied()
        .filter(|name| object.contains_key(*name))
        .collect();
    serde_json::json!({"known": names, "unknownCount": object.len() - names.len()})
}

#[cfg(windows)]
fn diagnostic_value_kind(value: Option<&serde_json::Value>) -> &'static str {
    use serde_json::Value;
    match value {
        None => "absent",
        Some(Value::Null) => "null",
        Some(Value::String(value)) if value.is_empty() => "empty-string",
        Some(Value::String(_)) => "nonempty-string",
        Some(Value::Array(value)) if value.is_empty() => "empty-array",
        Some(Value::Array(_)) => "nonempty-array",
        Some(Value::Object(value)) if value.is_empty() => "empty-object",
        Some(Value::Object(_)) => "nonempty-object",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
    }
}

#[cfg(windows)]
fn diagnostic_finish_reason(value: Option<&serde_json::Value>) -> &'static str {
    match value.and_then(serde_json::Value::as_str) {
        Some("stop") => "stop",
        Some("length") => "length",
        Some("tool_calls") => "tool_calls",
        Some("") => "empty-string",
        Some(_) => "other-string",
        None => diagnostic_value_kind(value),
    }
}

#[cfg(windows)]
fn diagnostic_nested_fields(
    value: Option<&serde_json::Value>,
    allowed: &[&str],
) -> serde_json::Value {
    use serde_json::{json, Map, Value};
    let object = value.and_then(Value::as_object);
    let fields: Map<String, Value> = allowed
        .iter()
        .map(|key| {
            (
                (*key).to_owned(),
                json!(diagnostic_value_kind(
                    object.and_then(|object| object.get(*key))
                )),
            )
        })
        .collect();
    let unknown_count = object.map(|object| {
        object
            .keys()
            .filter(|key| !allowed.contains(&key.as_str()))
            .count()
    });
    json!({"kind":diagnostic_value_kind(value),"fields":fields,"unknownCount":unknown_count})
}

#[cfg(windows)]
fn diagnostic_choice(item: &serde_json::Value) -> serde_json::Value {
    use serde_json::{json, Map, Value};
    // 固定 2.175.0 的消费者另识别这些扩展；这里只观察类型，不改变协议接受规则。
    const DELTA_FIELDS: &[&str] = &[
        "role",
        "content",
        "reasoning_content",
        "tool_calls",
        "function_call",
        "refusal",
        "reasoning",
        "extra_fields",
        "redacted_thinking",
    ];
    let delta = &item["delta"];
    let delta_kinds: Map<String, Value> = DELTA_FIELDS
        .iter()
        .map(|key| {
            (
                (*key).to_owned(),
                json!(diagnostic_value_kind(delta.get(*key))),
            )
        })
        .collect();
    json!({
        "deltaFields":diagnostic_fields(delta, DELTA_FIELDS),
        "deltaKinds":delta_kinds,
        "contentNull":delta.get("content").is_some_and(Value::is_null),
        "contentBytes":delta.get("content").and_then(Value::as_str).map(str::len),
        "roleIsAssistant":delta.get("role").and_then(Value::as_str) == Some("assistant"),
        "functionCall":diagnostic_nested_fields(delta.get("function_call"), &["name", "arguments"]),
        "extraFields":diagnostic_nested_fields(delta.get("extra_fields"), &["signature"]),
        "finish":diagnostic_finish_reason(item.get("finish_reason")),
    })
}

#[cfg(windows)]
fn live_sse_shape(bytes: &[u8]) -> serde_json::Value {
    use serde_json::{json, Value};
    use std::collections::BTreeSet;
    let mut shapes = BTreeSet::new();
    let mut done = false;
    let mut invalid = 0;
    let mut usage = json!({});
    let mut prior_content = String::new();
    let mut stop_frames = 0;
    let mut last_stop_content = Value::Null;
    let mut last_stop_shape = Value::Null;
    for line in String::from_utf8_lossy(bytes).lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        if data.trim() == "[DONE]" {
            done = true;
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(data.trim()) else {
            invalid += 1;
            continue;
        };
        if let Some(counts) = value.get("usage") {
            for key in ["prompt_tokens", "completion_tokens", "total_tokens"] {
                if let Some(count) = counts[key].as_u64() {
                    usage[key] = json!(count);
                }
            }
        }
        let top_fields = diagnostic_fields(
            &value,
            &[
                "id",
                "object",
                "created",
                "model",
                "choices",
                "usage",
                "system_fingerprint",
                "service_tier",
            ],
        );
        let choices = value["choices"].as_array().map(|items| {
            items
                .iter()
                .take(2)
                .map(diagnostic_choice)
                .collect::<Vec<_>>()
        });
        let detail = json!({"fields":top_fields,"choices":choices});
        if shapes.len() < 16 {
            shapes.insert(detail.to_string());
        }
        if let Some(choice) = value["choices"].as_array().and_then(|items| items.first()) {
            let content = choice["delta"]["content"].as_str();
            if choice["finish_reason"] == "stop" {
                stop_frames += 1;
                last_stop_content = json!({
                    "contentBytes":content.map(str::len),
                    "priorContentBytes":prior_content.len(),
                    "finalContentEqualsPrior":content.map(|text| text == prior_content),
                    "finalContentStartsWithPrior":content.map(|text| text.starts_with(&prior_content)),
                });
                // 长流的中间形状可能占满摘要；终态必须独立保留，不能因截断诊断而猜测。
                last_stop_shape = detail;
            } else if stop_frames == 0 {
                if let Some(content) = content {
                    prior_content.push_str(content);
                }
            }
        }
    }
    json!({"bytes":bytes.len(),"done":done,"invalidJson":invalid,"shapes":shapes,"usage":usage,
        "stopFrames":stop_frames,"lastStopContent":last_stop_content,"lastStopShape":last_stop_shape})
}

#[cfg(all(test, windows))]
mod live_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn live_request_is_bounded_and_contains_only_host_owned_synthetic_messages() {
        for scenario in ["connection", "question", "followup"] {
            let previous = "{\"answer\":\"B\",\"explanation\":\"两个一相加得到二。\"}";
            let body = live_request(scenario, Some(previous)).unwrap();
            assert_eq!(body["model"], "default");
            assert_eq!(body["stream"], true);
            assert_eq!(
                body["max_tokens"],
                if scenario == "connection" {
                    LIVE_CONNECTION_TOKENS
                } else {
                    LIVE_QUESTION_TOKENS
                }
            );
            assert!(body.get("tools").is_none());
            assert!(serde_json::to_vec(&body).unwrap().len() < 4096);
            let messages = body["messages"].as_array().unwrap();
            assert_eq!(messages.len(), if scenario == "followup" { 4 } else { 2 });
            assert!(messages
                .iter()
                .all(|message| message["content"].is_string()));
        }
        assert!(live_request("followup", None).is_none());
        assert!(live_request("followup", Some("unverified text")).is_none());
        assert!(live_request("unknown", None).is_none());
    }

    #[test]
    fn live_business_validation_rejects_wrong_or_extra_fields_and_unbounded_text() {
        assert!(live_candidate_matches("connection", "{\"ok\":true}"));
        assert!(!live_candidate_matches("connection", "{\"ok\":false}"));
        assert!(!live_candidate_matches(
            "connection",
            "{\"ok\":true,\"extra\":1}"
        ));
        let valid = json!({"answer":"B", "explanation":"两个一相加得到二。"}).to_string();
        assert!(live_candidate_matches("question", &valid));
        assert!(live_candidate_matches("followup", &valid));
        for invalid in [
            json!({"answer":"A","explanation":"错误选项"}),
            json!({"answer":"B","explanation":""}),
            json!({"answer":"B","explanation":"中".repeat(61)}),
            json!({"answer":"B","explanation":"说明","extra":true}),
        ] {
            assert!(!live_candidate_matches("question", &invalid.to_string()));
        }
        assert!(!live_candidate_matches("unknown", &valid));
        assert!(live_candidate_matches(
            "question",
            &json!({"answer":"B","explanation":"中".repeat(60)}).to_string()
        ));
    }

    #[test]
    fn sse_shape_never_prints_untrusted_field_names_or_text() {
        let payload = json!({
            "id": "private-completion-id",
            "untrusted-top-secret": "private-top-value",
            "choices": [{"delta": {"content": "private-body", "untrusted-delta-secret": "private-delta-value"}, "finish_reason":"stop"}],
            "usage": {"prompt_tokens": 7, "untrusted-usage-secret": 3}
        });
        let response = format!("data: {payload}\n\ndata: [DONE]\n\n");
        let shape = live_sse_shape(response.as_bytes());
        let printed = shape.to_string();
        for sensitive in [
            "untrusted-top-secret",
            "untrusted-delta-secret",
            "private-body",
            "private-completion-id",
            "private-top-value",
            "private-delta-value",
            "untrusted-usage-secret",
        ] {
            assert!(
                !printed.contains(sensitive),
                "diagnostic leaked {sensitive}"
            );
        }
        assert_eq!(shape["usage"]["prompt_tokens"], 7);
        assert_eq!(shape["done"], true);
        let detail: serde_json::Value =
            serde_json::from_str(shape["shapes"][0].as_str().unwrap()).unwrap();
        assert_eq!(detail["fields"]["unknownCount"], 1);
        assert_eq!(detail["choices"][0]["deltaFields"]["unknownCount"], 1);
    }

    #[test]
    fn sse_diagnostic_distinguishes_empty_fields_without_printing_values() {
        let payload = json!({
            "id":"synthetic-private-id",
            "choices":[{"delta":{
                "role":"assistant",
                "content":null,
                "reasoning_content":"synthetic-private-reasoning",
                "tool_calls":[],
                "function_call":null,
                "refusal":""
            },"finish_reason":"length"}]
        });
        let response = format!("data: {payload}\n\ndata: [DONE]\n\n");
        let shape = live_sse_shape(response.as_bytes());
        let printed = shape.to_string();
        assert!(!printed.contains("synthetic-private"));
        let detail: serde_json::Value =
            serde_json::from_str(shape["shapes"][0].as_str().unwrap()).unwrap();
        let kinds = &detail["choices"][0]["deltaKinds"];
        assert_eq!(kinds["content"], "null");
        assert_eq!(kinds["reasoning_content"], "nonempty-string");
        assert_eq!(kinds["tool_calls"], "empty-array");
        assert_eq!(kinds["function_call"], "null");
        assert_eq!(kinds["refusal"], "empty-string");
        assert_eq!(detail["choices"][0]["finish"], "length");
        for (value, expected) in [
            (json!({}), "empty-object"),
            (json!({"private":"value"}), "nonempty-object"),
            (json!(["private"]), "nonempty-array"),
            (json!(true), "boolean"),
            (json!(9), "number"),
        ] {
            assert_eq!(diagnostic_value_kind(Some(&value)), expected);
        }
        assert_eq!(diagnostic_value_kind(None), "absent");
    }

    #[test]
    fn sse_diagnostic_distinguishes_finish_states_without_printing_unknown_values() {
        for (finish, expected) in [
            (None, "absent"),
            (Some(json!(null)), "null"),
            (Some(json!("")), "empty-string"),
            (Some(json!("stop")), "stop"),
            (Some(json!("length")), "length"),
            (Some(json!("tool_calls")), "tool_calls"),
            (Some(json!("private-finish-value")), "other-string"),
            (Some(json!(false)), "boolean"),
            (Some(json!(42)), "number"),
            (Some(json!([])), "empty-array"),
            (
                Some(json!({"private-key":"private-value"})),
                "nonempty-object",
            ),
        ] {
            let mut choice = json!({"delta":{"content":"private-content"}});
            if let Some(value) = finish {
                choice["finish_reason"] = value;
            }
            let response = format!("data: {}\n\n", json!({"choices":[choice]}));
            let shape = live_sse_shape(response.as_bytes());
            let detail: serde_json::Value =
                serde_json::from_str(shape["shapes"][0].as_str().unwrap()).unwrap();
            assert_eq!(detail["choices"][0]["finish"], expected);
            assert!(!shape.to_string().contains("private-"));
        }
    }

    #[test]
    fn sse_diagnostic_reports_only_fixed_nested_field_kinds_and_role_match() {
        for (role, assistant) in [("assistant", true), ("private-role", false)] {
            let response = format!(
                "data: {}\n\n",
                json!({"choices":[{"delta":{
                "role":role,
                "content":"private-content",
                "reasoning":"private-reasoning",
                "function_call":{"name":"", "arguments":"", "private-function-key":"private-function-value"},
                "extra_fields":{"signature":"private-signature", "private-extra-key":"private-extra-value"},
                "redacted_thinking":"private-redacted-thinking",
                "private-delta-key":"private-delta-value"
            },"finish_reason":"stop"}]})
            );
            let shape = live_sse_shape(response.as_bytes());
            let detail: serde_json::Value =
                serde_json::from_str(shape["shapes"][0].as_str().unwrap()).unwrap();
            let choice = &detail["choices"][0];
            assert_eq!(choice["roleIsAssistant"], assistant);
            assert_eq!(choice["deltaFields"]["unknownCount"], 1);
            assert_eq!(choice["deltaKinds"]["reasoning"], "nonempty-string");
            assert_eq!(choice["deltaKinds"]["redacted_thinking"], "nonempty-string");
            assert_eq!(choice["functionCall"]["kind"], "nonempty-object");
            assert_eq!(choice["functionCall"]["fields"]["name"], "empty-string");
            assert_eq!(
                choice["functionCall"]["fields"]["arguments"],
                "empty-string"
            );
            assert_eq!(choice["functionCall"]["unknownCount"], 1);
            assert_eq!(
                choice["extraFields"]["fields"]["signature"],
                "nonempty-string"
            );
            assert_eq!(choice["extraFields"]["unknownCount"], 1);
            assert!(!shape.to_string().contains("private-"));
        }
    }

    #[test]
    fn sse_diagnostic_compares_terminal_content_without_exposing_or_deduplicating_text() {
        let prior = "合成正文";
        for (final_content, equal, prefix) in [
            (prior.to_owned(), true, true),
            (format!("{prior}后续"), false, true),
            ("不同正文".to_owned(), false, false),
        ] {
            let response = format!(
                "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                json!({"choices":[{"delta":{"content":prior},"finish_reason":""}]}),
                json!({"choices":[{"delta":{"content":final_content},"finish_reason":"stop"}]}),
            );
            let shape = live_sse_shape(response.as_bytes());
            assert_eq!(shape["stopFrames"], 1);
            assert_eq!(
                shape["lastStopContent"]["contentBytes"],
                final_content.len()
            );
            assert_eq!(shape["lastStopContent"]["priorContentBytes"], prior.len());
            assert_eq!(shape["lastStopContent"]["finalContentEqualsPrior"], equal);
            assert_eq!(
                shape["lastStopContent"]["finalContentStartsWithPrior"],
                prefix
            );
            assert!(!shape.to_string().contains(prior));
            assert!(!shape.to_string().contains(&final_content));
        }
    }

    #[test]
    fn sse_diagnostic_keeps_terminal_shape_after_the_shape_limit() {
        let mut response = String::new();
        for size in 1..=20 {
            response.push_str(&format!(
                "data: {}\n\n",
                json!({"choices":[{"delta":{"content":"x".repeat(size)},"finish_reason":""}]})
            ));
        }
        let terminal = format!(
            "data: {}\n\n",
            json!({"choices":[{"delta":{
            "content":"private-final-content", "function_call":{"name":"private-name", "arguments":""}
        },"finish_reason":"stop"}]})
        );
        response.push_str(&terminal);
        response.push_str(&terminal);
        response.push_str("data: [DONE]\n\n");
        let shape = live_sse_shape(response.as_bytes());
        assert_eq!(shape["shapes"].as_array().unwrap().len(), 16);
        assert_eq!(shape["stopFrames"], 2);
        assert_eq!(shape["lastStopShape"]["choices"][0]["finish"], "stop");
        assert_eq!(
            shape["lastStopShape"]["choices"][0]["functionCall"]["fields"]["name"],
            "nonempty-string"
        );
        assert_eq!(shape["lastStopContent"]["priorContentBytes"], 210);
        assert!(!shape.to_string().contains("private-"));
    }

    #[test]
    fn failed_business_validation_never_prints_candidate() {
        let invalid = Ok("private-invalid-output".to_owned());
        let (passed, report) = live_report("question", 1, &invalid);
        assert!(!passed);
        assert!(report["candidate"].is_null());
        assert!(!report.to_string().contains("private-invalid-output"));
        let valid = Ok("{\"ok\":true}".to_owned());
        assert!(live_report("connection", 2, &valid).1["candidate"].is_null());
        let (passed, report) = live_report("connection", 1, &valid);
        assert!(passed);
        assert_eq!(report["candidate"], "{\"ok\":true}");
    }

    #[test]
    fn runtime_cleanup_is_bounded_even_when_a_blocking_task_has_not_finished() {
        use std::{
            sync::{mpsc, Arc},
            time::{Duration, Instant},
        };
        let runtime = Arc::new(
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap(),
        );
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker = runtime.spawn_blocking(move || {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let before = Instant::now();
        shutdown_runtime(runtime, Duration::from_millis(50));
        let elapsed = before.elapsed();
        release_tx.send(()).unwrap();
        assert!(
            elapsed < Duration::from_secs(1),
            "runtime cleanup exceeded its bound"
        );
        let deadline = Instant::now() + Duration::from_secs(1);
        while !worker.is_finished() && Instant::now() < deadline {
            std::thread::yield_now();
        }
        assert!(worker.is_finished());
    }

    #[test]
    fn shared_runtime_fails_and_exits_without_waiting_for_callbacks() {
        use std::{
            os::windows::process::CommandExt,
            process::{Command, Stdio},
            time::{Duration, Instant},
        };
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "live_tests::shared_runtime_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env_clear()
            .env("SHIROHA_SHARED_RUNTIME_FIXTURE", "1")
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if let Some(system) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", system);
        }
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        let completed = loop {
            if child.try_wait().unwrap().is_some() {
                break true;
            }
            if Instant::now() >= deadline {
                break false;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        if !completed {
            child.kill().unwrap();
        }
        let output = child.wait_with_output().unwrap();
        assert!(completed, "shared runtime cleanup did not exit promptly");
        assert_eq!(output.status.code(), Some(1));
        assert!(String::from_utf8_lossy(&output.stderr).contains("live_runtime_cleanup_failed"));
    }

    #[test]
    #[ignore = "仅供本模块测试启动的子进程验证退出兜底"]
    fn shared_runtime_fixture() {
        if std::env::var("SHIROHA_SHARED_RUNTIME_FIXTURE").as_deref() != Ok("1") {
            return;
        }
        let runtime = std::sync::Arc::new(
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap(),
        );
        let retained = runtime.clone();
        shutdown_runtime(runtime, std::time::Duration::from_millis(50));
        drop(retained);
        panic!("shared runtime must fail closed by ending this fixture process");
    }
}
