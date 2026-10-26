use crate::error::{Error, Result};
#[cfg(any(test, feature = "codebuddy-prototype", not(feature = "native-test")))]
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
#[cfg(any(test, feature = "codebuddy-prototype", not(feature = "native-test")))]
use std::io::{Read, Write};

// 管道只归本次宿主和 worker；帧上限也覆盖 JSON 转义后的完整 CLI 输出。
#[cfg(any(test, feature = "codebuddy-prototype", not(feature = "native-test")))]
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;

#[cfg(any(test, feature = "codebuddy-prototype", not(feature = "native-test")))]
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WorkerConfig {
    pub model: String,
    pub prompt: String,
    pub capability: String,
    pub bearer: String,
    pub timeout_ms: u64,
}

#[cfg(any(test, feature = "codebuddy-prototype", not(feature = "native-test")))]
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub(crate) enum HostFrame {
    Start { config: WorkerConfig },
    Response { status: u16, body: String },
}

#[cfg(any(test, feature = "codebuddy-prototype", not(feature = "native-test")))]
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub(crate) enum WorkerFrame {
    Ready { port: u16 },
    Request { body: Value },
    Complete { success: bool, stdout: String },
    Failed { code: String },
}

#[cfg(any(test, feature = "codebuddy-prototype", not(feature = "native-test")))]
pub(crate) fn read_frame<T: DeserializeOwned>(reader: &mut impl Read) -> Result<T> {
    let mut prefix = [0; 4];
    reader
        .read_exact(&mut prefix)
        .map_err(|_| Error::new("codebuddy_pipe_closed"))?;
    let length = u32::from_le_bytes(prefix) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err(Error::new("codebuddy_frame_invalid"));
    }
    let mut bytes = vec![0; length];
    reader
        .read_exact(&mut bytes)
        .map_err(|_| Error::new("codebuddy_pipe_closed"))?;
    serde_json::from_slice(&bytes).map_err(|_| Error::new("codebuddy_frame_invalid"))
}

#[cfg(any(test, feature = "codebuddy-prototype", not(feature = "native-test")))]
pub(crate) fn write_frame(writer: &mut impl Write, frame: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(frame).map_err(|_| Error::new("codebuddy_frame_invalid"))?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(Error::new("response_too_large"));
    }
    writer
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(&bytes))
        .and_then(|_| writer.flush())
        .map_err(|_| Error::new("codebuddy_pipe_closed"))
}

pub(crate) fn validate_request(body: &Value, model: &str) -> Result<()> {
    if serde_json::to_vec(body)
        .map_err(|_| Error::new("codebuddy_request_denied"))?
        .len()
        > MAX_REQUEST_BYTES
    {
        return Err(Error::new("response_too_large"));
    }
    let payload = body
        .as_object()
        .ok_or_else(|| Error::new("codebuddy_request_denied"))?;
    let no_tools = payload
        .get("tools")
        .is_none_or(|tools| tools.as_array().is_some_and(Vec::is_empty));
    if payload.get("model").and_then(Value::as_str) != Some(model)
        || payload.get("stream") != Some(&Value::Bool(true))
        || !payload.get("messages").is_some_and(Value::is_array)
        || !no_tools
        || ["functions", "function_call", "tool_choice"]
            .iter()
            .any(|key| payload.contains_key(*key))
    {
        return Err(Error::new("codebuddy_request_denied"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn frames_reject_truncation_oversize_and_unknown_fields() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &WorkerFrame::Ready { port: 8123 }).unwrap();
        assert!(matches!(
            read_frame::<WorkerFrame>(&mut bytes.as_slice()).unwrap(),
            WorkerFrame::Ready { port: 8123 }
        ));
        assert!(read_frame::<WorkerFrame>(&mut &bytes[..bytes.len() - 1]).is_err());
        assert!(read_frame::<WorkerFrame>(&mut &(u32::MAX.to_le_bytes())[..]).is_err());
        let mut invalid = Vec::new();
        write_frame(
            &mut invalid,
            &json!({"type":"Ready", "port":1, "token":"secret"}),
        )
        .unwrap();
        assert_eq!(
            read_frame::<WorkerFrame>(&mut invalid.as_slice())
                .err()
                .unwrap()
                .code,
            "codebuddy_frame_invalid"
        );
    }

    #[test]
    fn requests_reject_other_models_and_tools() {
        let valid = json!({"model":"default", "stream":true, "messages":[]});
        assert!(validate_request(&valid, "default").is_ok());
        assert!(validate_request(&valid, "other").is_err());
        for field in ["tools", "functions", "function_call", "tool_choice"] {
            let mut invalid = valid.clone();
            invalid[field] = json!([{"name":"Write"}]);
            assert!(validate_request(&invalid, "default").is_err());
        }
    }

    #[test]
    fn oversized_worker_request_cannot_reach_the_upstream_callback() {
        let oversized = json!({"model":"default", "stream":true, "messages":[{"role":"user", "content":"x".repeat(MAX_REQUEST_BYTES)}]});
        assert_eq!(
            validate_request(&oversized, "default").err().unwrap().code,
            "response_too_large"
        );
    }
}
