use crate::error::{Error, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};

mod strict_json;

pub(crate) fn parse_business_json(source: &str) -> serde_json::Result<Value> {
    strict_json::parse(source)
}

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_EVENT_BYTES: usize = 2 * 1024 * 1024;
const MAX_EVENTS: usize = 16_384;
const UPSTREAM_REJECTED: &str = "codebuddy_upstream_unverified";
const UPSTREAM_LENGTH: &str = "codebuddy_upstream_length";
const UPSTREAM_FILTERED: &str = "codebuddy_upstream_content_filter";
const UPSTREAM_TOOL_CALL: &str = "codebuddy_upstream_tool_call";
const UPSTREAM_UNKNOWN_FIELD: &str = "codebuddy_upstream_unknown_field";
const UPSTREAM_INCOMPLETE: &str = "codebuddy_upstream_incomplete";
const CANDIDATE_REJECTED: &str = "codebuddy_candidate_rejected";

// 证明由宿主单次上游校验产生，不能反序列化或复制；采纳会消费其所有权。
// 取消、预算和任务 revision 由持有该证明的执行器控制，不能从 CLI 接收证明。
pub(crate) struct VerifiedResponse {
    text: String,
    digest: [u8; 32],
}

impl VerifiedResponse {
    #[cfg(any(test, feature = "codebuddy-prototype", not(feature = "native-test")))]
    pub(crate) fn relay_bytes(&self) -> Result<Vec<u8>> {
        // CLI 只能看见经完整终态证明的正文；上游推理和元数据不能成为工具事件。
        let mut source = String::new();
        for (delta, finish_reason) in [
            (serde_json::json!({"role":"assistant"}), Value::Null),
            (serde_json::json!({"content":self.text}), Value::Null),
            (serde_json::json!({}), serde_json::json!("stop")),
        ] {
            let payload = serde_json::json!({
                "id":"shiroha-codebuddy-response",
                "object":"chat.completion.chunk",
                "choices":[{"index":0,"delta":delta,"finish_reason":finish_reason}],
            });
            let encoded =
                serde_json::to_string(&payload).map_err(|_| Error::new(UPSTREAM_REJECTED))?;
            source.push_str("data: ");
            source.push_str(&encoded);
            source.push_str("\n\n");
        }
        source.push_str("data: [DONE]\n\n");
        require(source.len() <= MAX_RESPONSE_BYTES, "response_too_large")?;
        Ok(source.into_bytes())
    }
}

fn require(condition: bool, code: &'static str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(Error::new(code))
    }
}

fn absent_or_null(value: Option<&Value>) -> bool {
    value.is_none_or(Value::is_null)
}

fn optional_text(value: Option<&Value>) -> bool {
    value.is_none_or(|value| value.is_null() || value.is_string())
}

fn empty_legacy_function(value: Option<&Value>) -> bool {
    value.is_none_or(|value| {
        value.is_null()
            || value.as_object().is_some_and(|fields| {
                fields.len() == 2
                    && fields.get("name").and_then(Value::as_str) == Some("")
                    && fields.get("arguments").and_then(Value::as_str) == Some("")
            })
    })
}

fn optional_thinking_signature(value: Option<&Value>) -> bool {
    value.is_none_or(|value| {
        value.is_null()
            || value
                .as_object()
                .is_some_and(|fields| optional_text(fields.get("signature")))
    })
}

fn identifier<'a>(value: &'a Value, code: &'static str) -> Result<&'a str> {
    value
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| Error::new(code))
}

pub(crate) fn validate_upstream(bytes: &[u8]) -> Result<VerifiedResponse> {
    require(bytes.len() <= MAX_RESPONSE_BYTES, "response_too_large")?;
    let source = std::str::from_utf8(bytes)
        .map_err(|_| Error::new(UPSTREAM_REJECTED))?
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    require(source.ends_with("\n\n"), UPSTREAM_INCOMPLETE)?;
    let mut text = String::new();
    let mut completion_id = None;
    let mut stopped = false;
    let mut done = false;
    for block in source.split("\n\n") {
        let mut data = Vec::new();
        for line in block
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with(':'))
        {
            let value = line
                .strip_prefix("data:")
                .ok_or_else(|| Error::new(UPSTREAM_REJECTED))?;
            data.push(value.strip_prefix(' ').unwrap_or(value));
        }
        if data.is_empty() {
            continue;
        }
        require(!done, UPSTREAM_REJECTED)?;
        let data = data.join("\n");
        if data == "[DONE]" {
            require(stopped, UPSTREAM_INCOMPLETE)?;
            done = true;
            continue;
        }
        let payload = strict_json::parse(&data).map_err(|_| Error::new(UPSTREAM_REJECTED))?;
        require(
            payload.is_object() && absent_or_null(payload.get("error")),
            UPSTREAM_REJECTED,
        )?;
        let id = identifier(&payload["id"], UPSTREAM_REJECTED)?;
        if let Some(expected) = &completion_id {
            require(id == expected, UPSTREAM_REJECTED)?;
        } else {
            completion_id = Some(id.to_owned());
        }
        let choices = payload["choices"]
            .as_array()
            .ok_or_else(|| Error::new(UPSTREAM_REJECTED))?;
        if choices.is_empty() {
            require(stopped && payload["usage"].is_object(), UPSTREAM_REJECTED)?;
            continue;
        }
        require(choices.len() == 1 && !stopped, UPSTREAM_REJECTED)?;
        let choice = &choices[0];
        require(choice["index"].as_u64() == Some(0), UPSTREAM_REJECTED)?;
        let delta = choice["delta"]
            .as_object()
            .ok_or_else(|| Error::new(UPSTREAM_REJECTED))?;
        require(
            delta.keys().all(|key| {
                matches!(
                    key.as_str(),
                    "role"
                        | "content"
                        | "reasoning_content"
                        | "reasoning"
                        | "redacted_thinking"
                        | "extra_fields"
                        | "tool_calls"
                        | "function_call"
                        | "refusal"
                )
            }),
            UPSTREAM_UNKNOWN_FIELD,
        )?;
        if let Some(fields) = delta.get("extra_fields").and_then(Value::as_object) {
            require(
                fields.keys().all(|key| key == "signature"),
                UPSTREAM_UNKNOWN_FIELD,
            )?;
        }
        let no_tool_calls = delta
            .get("tool_calls")
            .is_none_or(|value| value.is_null() || value.as_array().is_some_and(Vec::is_empty));
        let no_refusal = delta
            .get("refusal")
            .is_none_or(|value| value.is_null() || value.as_str() == Some(""));
        // 固定 2.175.0 的推理扩展仅按声明类型读取后丢弃，不得成为答案或完成证据。
        let text_only_reasoning = optional_text(delta.get("reasoning_content"))
            && optional_text(delta.get("reasoning"))
            && optional_text(delta.get("redacted_thinking"))
            && optional_thinking_signature(delta.get("extra_fields"));
        let nonempty_tool_calls = delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .is_some_and(|calls| !calls.is_empty());
        let nonempty_function_call = delta
            .get("function_call")
            .and_then(Value::as_object)
            .is_some_and(|fields| {
                ["name", "arguments"].iter().any(|key| {
                    fields
                        .get(*key)
                        .and_then(Value::as_str)
                        .is_some_and(|text| !text.is_empty())
                })
            });
        let call_rejection = if nonempty_tool_calls || nonempty_function_call {
            UPSTREAM_TOOL_CALL
        } else {
            UPSTREAM_REJECTED
        };
        // SDK 会忽略旧式调用；宿主只能接受确实没有名称和参数的精确空占位。
        require(
            no_tool_calls && empty_legacy_function(delta.get("function_call")),
            call_rejection,
        )?;
        require(no_refusal && text_only_reasoning, UPSTREAM_REJECTED)?;
        if let Some(role) = delta.get("role").filter(|value| !value.is_null()) {
            require(role.as_str() == Some("assistant"), UPSTREAM_REJECTED)?;
        }
        if let Some(content) = delta.get("content").filter(|value| !value.is_null()) {
            text.push_str(
                content
                    .as_str()
                    .ok_or_else(|| Error::new(UPSTREAM_REJECTED))?,
            );
        }
        if let Some(reason) = choice.get("finish_reason").filter(|value| !value.is_null()) {
            // 固定网关使用空字符串占位；升级协议时重新核对，不能把占位当作终态。
            match reason.as_str() {
                Some("") => {}
                Some("stop") => stopped = true,
                Some("length") => return Err(Error::new(UPSTREAM_LENGTH)),
                Some("content_filter") => return Err(Error::new(UPSTREAM_FILTERED)),
                Some("tool_calls" | "function_call") => return Err(Error::new(UPSTREAM_TOOL_CALL)),
                _ => return Err(Error::new(UPSTREAM_REJECTED)),
            }
        }
    }
    require(stopped && done, UPSTREAM_INCOMPLETE)?;
    require(!text.is_empty(), UPSTREAM_REJECTED)?;
    let digest = Sha256::digest(text.as_bytes()).into();
    Ok(VerifiedResponse { text, digest })
}

#[derive(PartialEq, Eq)]
enum Phase {
    Initial,
    Waiting,
    Started,
    Text,
    BlockStopped,
    MessageEnding,
    MessageStopped,
    Assistant,
    Finished,
}

struct Candidate {
    phase: Phase,
    session: String,
    request: Option<String>,
    model_request: Option<String>,
    initial_snapshot: String,
    text: String,
}

impl Candidate {
    fn new() -> Self {
        Self {
            phase: Phase::Initial,
            session: String::new(),
            request: None,
            model_request: None,
            initial_snapshot: String::new(),
            text: String::new(),
        }
    }

    fn consume(&mut self, event: &Value) -> Result<()> {
        require(self.phase != Phase::Finished, CANDIDATE_REJECTED)?;
        if self.phase == Phase::Initial {
            require(
                event["type"] == "system" && event["subtype"] == "init",
                CANDIDATE_REJECTED,
            )?;
            self.session = identifier(&event["session_id"], CANDIDATE_REJECTED)?.to_owned();
            self.phase = Phase::Waiting;
            return Ok(());
        }
        require(
            event["session_id"].as_str() == Some(self.session.as_str())
                && absent_or_null(event.get("parent_tool_use_id")),
            CANDIDATE_REJECTED,
        )?;
        let request = identifier(&event["_requestId"], CANDIDATE_REJECTED)?;
        if let Some(expected) = &self.request {
            require(request == expected, CANDIDATE_REJECTED)?;
        } else {
            self.request = Some(request.to_owned());
        }
        match event["type"].as_str() {
            Some("system") => require(event["subtype"] == "status", CANDIDATE_REJECTED)?,
            Some("stream_event") => {
                self.consume_stream(&event["event"])?;
                require(
                    event["_meta"]["codebuddy.ai/modelRequestId"].as_str()
                        == self.model_request.as_deref(),
                    CANDIDATE_REJECTED,
                )?;
            }
            Some("assistant") => {
                require(self.phase == Phase::MessageStopped, CANDIDATE_REJECTED)?;
                let message = &event["message"];
                require(
                    message["id"].as_str() == self.model_request.as_deref()
                        && message["role"] == "assistant"
                        && absent_or_null(message.get("stop_reason"))
                        && absent_or_null(message.get("stop_sequence")),
                    CANDIDATE_REJECTED,
                )?;
                require(
                    text_parts(&message["content"])? == self.text,
                    CANDIDATE_REJECTED,
                )?;
                self.phase = Phase::Assistant;
            }
            Some("result") => {
                let no_denials = event
                    .get("permission_denials")
                    .is_none_or(|value| value.as_array().is_some_and(Vec::is_empty));
                require(
                    self.phase == Phase::Assistant
                        && event["subtype"] == "success"
                        && event["is_error"].as_bool() == Some(false)
                        && absent_or_null(event.get("terminal_reason"))
                        && no_denials
                        && event["result"].as_str() == Some(self.text.as_str()),
                    CANDIDATE_REJECTED,
                )?;
                self.phase = Phase::Finished;
            }
            _ => return Err(Error::new(CANDIDATE_REJECTED)),
        }
        self.check_metadata(event)
    }

    fn consume_stream(&mut self, event: &Value) -> Result<()> {
        match event["type"].as_str() {
            Some("message_start") => {
                require(self.phase == Phase::Waiting, CANDIDATE_REJECTED)?;
                let message = &event["message"];
                require(
                    message["role"] == "assistant"
                        && absent_or_null(message.get("stop_reason"))
                        && absent_or_null(message.get("stop_sequence")),
                    CANDIDATE_REJECTED,
                )?;
                // 固定 2.175.0 会重复首段快照；只累计 delta，并核对快照前缀。
                // 升级 CLI 且确认不再重复首段时，移除此兼容。
                self.initial_snapshot = text_parts(&message["content"])?;
                self.model_request =
                    Some(identifier(&message["id"], CANDIDATE_REJECTED)?.to_owned());
                self.phase = Phase::Started;
            }
            Some("content_block_start") => {
                require(
                    self.phase == Phase::Started
                        && event["index"].as_u64() == Some(0)
                        && event["content_block"]["type"] == "text"
                        && event["content_block"]["text"] == "",
                    CANDIDATE_REJECTED,
                )?;
                self.phase = Phase::Text;
            }
            Some("content_block_delta") => {
                require(
                    self.phase == Phase::Text
                        && event["index"].as_u64() == Some(0)
                        && event["delta"]["type"] == "text_delta",
                    CANDIDATE_REJECTED,
                )?;
                let text = event["delta"]["text"]
                    .as_str()
                    .ok_or_else(|| Error::new(CANDIDATE_REJECTED))?;
                require(
                    self.text.len() + text.len() <= MAX_RESPONSE_BYTES,
                    "response_too_large",
                )?;
                self.text.push_str(text);
            }
            Some("content_block_stop") => {
                require(
                    self.phase == Phase::Text && event["index"].as_u64() == Some(0),
                    CANDIDATE_REJECTED,
                )?;
                self.phase = Phase::BlockStopped;
            }
            Some("message_delta") => {
                require(
                    self.phase == Phase::BlockStopped
                        && event["delta"]["stop_reason"] == "end_turn"
                        && absent_or_null(event["delta"].get("stop_sequence")),
                    CANDIDATE_REJECTED,
                )?;
                self.phase = Phase::MessageEnding;
            }
            Some("message_stop") => {
                require(self.phase == Phase::MessageEnding, CANDIDATE_REJECTED)?;
                self.phase = Phase::MessageStopped;
            }
            _ => return Err(Error::new(CANDIDATE_REJECTED)),
        }
        Ok(())
    }

    fn check_metadata(&self, event: &Value) -> Result<()> {
        let meta = &event["_meta"];
        for (value, expected) in [
            (event.get("_messageId"), self.model_request.as_deref()),
            (
                meta.get("codebuddy.ai/modelRequestId"),
                self.model_request.as_deref(),
            ),
            (
                meta.get("codebuddy.ai/llmMessageId"),
                self.model_request.as_deref(),
            ),
            (
                meta.get("codebuddy.ai/conversationRequestId"),
                self.request.as_deref(),
            ),
        ] {
            if let Some(value) = value {
                require(
                    expected.is_some() && value.as_str() == expected,
                    CANDIDATE_REJECTED,
                )?;
            }
        }
        Ok(())
    }
}

fn text_parts(value: &Value) -> Result<String> {
    let parts = value
        .as_array()
        .ok_or_else(|| Error::new(CANDIDATE_REJECTED))?;
    let mut text = String::new();
    for part in parts {
        require(part["type"] == "text", CANDIDATE_REJECTED)?;
        text.push_str(
            part["text"]
                .as_str()
                .ok_or_else(|| Error::new(CANDIDATE_REJECTED))?,
        );
    }
    Ok(text)
}

pub(crate) fn validate_candidate(stdout: &[u8], proof: VerifiedResponse) -> Result<String> {
    require(stdout.len() <= MAX_STDOUT_BYTES, "response_too_large")?;
    let source = std::str::from_utf8(stdout).map_err(|_| Error::new(CANDIDATE_REJECTED))?;
    let mut candidate = Candidate::new();
    for (index, line) in source
        .lines()
        .filter(|line| !line.trim().is_empty())
        .enumerate()
    {
        require(
            line.len() <= MAX_EVENT_BYTES && index < MAX_EVENTS,
            "response_too_large",
        )?;
        let event = strict_json::parse(line).map_err(|_| Error::new(CANDIDATE_REJECTED))?;
        candidate.consume(&event)?;
    }
    let digest: [u8; 32] = Sha256::digest(candidate.text.as_bytes()).into();
    require(
        candidate.phase == Phase::Finished
            && candidate.text.starts_with(&candidate.initial_snapshot)
            && candidate.text == proof.text
            && digest == proof.digest,
        CANDIDATE_REJECTED,
    )?;
    Ok(candidate.text)
}

#[cfg(test)]
#[path = "harness_codebuddy_protocol/tests.rs"]
mod tests;
