use crate::error::{Error, Result};
use serde_json::Value;

pub(crate) fn parse_output(bytes: &[u8], success: bool) -> Result<String> {
    if !success {
        return Err(Error::new("outcome_unknown"));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Error::new("harness_protocol"))?;
    let mut started = false;
    let mut completed = false;
    let mut content = None;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        if line.len() > 1024 * 1024 || completed {
            return Err(Error::new("harness_protocol"));
        }
        let event: Value =
            serde_json::from_str(line).map_err(|_| Error::new("harness_protocol"))?;
        match event["type"].as_str() {
            Some("thread.started") if !started => {}
            Some("turn.started") if !started => started = true,
            Some("turn.completed") if started => completed = true,
            Some("turn.failed" | "error") => return Err(Error::new("harness_failed")),
            Some("item.started" | "item.updated" | "item.completed") => {
                let item = &event["item"];
                match item["type"].as_str() {
                    Some("reasoning" | "error") => {}
                    Some("agent_message") if event["type"] == "item.completed" && started => {
                        content = item["text"].as_str().map(str::to_owned);
                    }
                    Some("agent_message") => {}
                    _ => return Err(Error::new("harness_tool_denied")),
                }
            }
            _ => return Err(Error::new("harness_protocol")),
        }
    }
    if !completed {
        return Err(Error::new("outcome_unknown"));
    }
    let envelope: Value =
        serde_json::from_str(&content.ok_or_else(|| Error::new("harness_protocol"))?)
            .map_err(|_| Error::new("harness_protocol"))?;
    if envelope.as_object().map(|value| value.len()) != Some(1) {
        return Err(Error::new("harness_protocol"));
    }
    let content = envelope["content"]
        .as_str()
        .ok_or_else(|| Error::new("harness_protocol"))?;
    let business: Value =
        serde_json::from_str(content).map_err(|_| Error::new("harness_protocol"))?;
    if !business.is_object() && !business.is_array() {
        return Err(Error::new("harness_protocol"));
    }
    Ok(content.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn output(items: &[Value]) -> Vec<u8> {
        items
            .iter()
            .map(|item| format!("{item}\n"))
            .collect::<String>()
            .into_bytes()
    }
    fn completed(content: &str) -> Vec<Value> {
        vec![
            json!({"type":"thread.started","thread_id":"fixture"}),
            json!({"type":"turn.started"}),
            json!({"type":"item.completed","item":{"type":"agent_message","text":json!({"content":content}).to_string()}}),
            json!({"type":"turn.completed"}),
        ]
    }
    #[test]
    fn only_complete_success_returns_business_content() {
        let items = completed("{\"ok\":true}");
        assert_eq!(
            parse_output(&output(&items), true).unwrap(),
            "{\"ok\":true}"
        );
        assert_eq!(
            parse_output(&output(&items), false).unwrap_err().code,
            "outcome_unknown"
        );
        assert!(parse_output(&output(&items[..3]), true).is_err());
    }
    #[test]
    fn rejects_tool_activity_invalid_schema_and_duplicate_terminal() {
        for item_type in [
            "command_execution",
            "file_change",
            "mcp_tool_call",
            "web_search",
            "unknown",
        ] {
            let mut items = completed("{\"ok\":true}");
            items.insert(
                2,
                json!({"type":"item.completed","item":{"type":item_type}}),
            );
            assert!(parse_output(&output(&items), true).is_err());
        }
        for content in ["", "not JSON", "null", "123"] {
            assert!(parse_output(&output(&completed(content)), true).is_err());
        }
        let mut items = completed("{}");
        items.push(json!({"type":"turn.completed"}));
        assert!(parse_output(&output(&items), true).is_err());
        assert!(parse_output(&[0xff], true).is_err());
    }
}
