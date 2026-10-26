use super::*;
use serde_json::{json, Value};

const TEXT: &str = "{\"ok\":true,\"text\":\"白羽测试\"}";

fn chunk(delta: Value, finish_reason: Value) -> String {
    format!(
        "data: {}\n\n",
        json!({"id":"completion", "choices":[{"index":0,"delta":delta,"finish_reason":finish_reason}]})
    )
}

fn complete(text: &str) -> String {
    chunk(json!({"role":"assistant"}), Value::Null)
        + &chunk(json!({"content":text}), Value::Null)
        + &chunk(json!({}), json!("stop"))
        + "data: [DONE]\n\n"
}

fn events(text: &str) -> Vec<Value> {
    let streamed = |event| {
        json!({"session_id":"session", "_requestId":"request", "type":"stream_event",
            "_meta":{"codebuddy.ai/modelRequestId":"model-request"}, "event":event})
    };
    vec![
        json!({"type":"system","subtype":"init","session_id":"session","tools":["Write"]}),
        streamed(
            json!({"type":"message_start","message":{"id":"model-request","role":"assistant","content":[{"type":"text","text":""}],"stop_reason":null}}),
        ),
        streamed(
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        streamed(
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}}),
        ),
        streamed(json!({"type":"content_block_stop","index":0})),
        streamed(
            json!({"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null}}),
        ),
        streamed(json!({"type":"message_stop"})),
        json!({"session_id":"session","_requestId":"request","type":"assistant","message":{"id":"model-request","role":"assistant","content":[{"type":"text","text":text}],"stop_reason":null}}),
        json!({"session_id":"session","_requestId":"request","type":"result","subtype":"success","is_error":false,"result":text,"num_turns":2,"permission_denials":[]}),
    ]
}

fn output(events: &[Value]) -> Vec<u8> {
    events
        .iter()
        .map(|event| format!("{event}\n"))
        .collect::<String>()
        .into_bytes()
}

fn candidate(events: &[Value], text: &str) -> Result<String> {
    validate_candidate(
        &output(events),
        validate_upstream(complete(text).as_bytes())?,
    )
}

#[test]
fn sse_diagnostics_classify_unsuccessful_finish_without_accepting_partial_text() {
    for (finish, expected) in [
        ("length", "codebuddy_upstream_length"),
        ("content_filter", "codebuddy_upstream_content_filter"),
        ("tool_calls", "codebuddy_upstream_tool_call"),
        ("function_call", "codebuddy_upstream_tool_call"),
    ] {
        let source = chunk(json!({"content":TEXT}), json!(finish)) + "data: [DONE]\n\n";
        assert_eq!(
            validate_upstream(source.as_bytes()).err().unwrap().code,
            expected
        );
    }
}

#[test]
fn sse_diagnostics_classify_nonempty_calls_without_disclosing_content() {
    for delta in [
        json!({"tool_calls":[{"function":{"name":"private-tool-name","arguments":"private-arguments"}}]}),
        json!({"function_call":{"name":"private-tool-name","arguments":""}}),
        json!({"function_call":{"name":"","arguments":"private-arguments"}}),
        json!({"function_call":{"name":" ","arguments":""}}),
    ] {
        let source = chunk(delta, Value::Null) + &complete("private-answer");
        let error = validate_upstream(source.as_bytes()).err().unwrap();
        assert_eq!(error.code, "codebuddy_upstream_tool_call");
        let visible = serde_json::to_string(&error).unwrap();
        for secret in ["private-tool-name", "private-arguments", "private-answer"] {
            assert!(!visible.contains(secret));
        }
    }
}

#[test]
fn sse_diagnostics_classify_unknown_delta_without_disclosing_its_name() {
    let source = chunk(
        json!({"private-extension-name":"private-value"}),
        Value::Null,
    ) + &complete(TEXT);
    let error = validate_upstream(source.as_bytes()).err().unwrap();
    assert_eq!(error.code, "codebuddy_upstream_unknown_field");
    let visible = serde_json::to_string(&error).unwrap();
    assert!(!visible.contains("private-extension-name"));
    assert!(!visible.contains("private-value"));
}

#[test]
fn sse_diagnostics_classify_unknown_nested_extension_without_changing_type_validation() {
    for extra_fields in [
        json!({"signature":"","_meta":null}),
        json!({"signature":"","private-extension-name":"private-value"}),
    ] {
        let source = chunk(json!({"extra_fields":extra_fields}), Value::Null) + &complete(TEXT);
        let error = validate_upstream(source.as_bytes()).err().unwrap();
        assert_eq!(error.code, "codebuddy_upstream_unknown_field");
        let visible = serde_json::to_string(&error).unwrap();
        for secret in ["_meta", "private-extension-name", "private-value"] {
            assert!(!visible.contains(secret));
        }
    }
    for extra_fields in [json!(false), json!([]), json!({"signature":false})] {
        let source = chunk(json!({"extra_fields":extra_fields}), Value::Null) + &complete(TEXT);
        assert_eq!(
            validate_upstream(source.as_bytes()).err().unwrap().code,
            "codebuddy_upstream_unverified"
        );
    }
}

#[test]
fn sse_diagnostics_classify_missing_terminal_and_truncated_record() {
    let text = chunk(json!({"content":TEXT}), Value::Null);
    for source in [
        text.clone(),
        text.clone() + "data: [DONE]\n\n",
        text + &chunk(json!({}), json!("stop")),
        complete(TEXT).trim_end().to_owned(),
    ] {
        assert_eq!(
            validate_upstream(source.as_bytes()).err().unwrap().code,
            "codebuddy_upstream_incomplete"
        );
    }
}

#[test]
fn sse_diagnostics_keep_malformed_and_ambiguous_input_generic() {
    for delta in [
        json!({"content":false}),
        json!({"tool_calls":false}),
        json!({"tool_calls":{}}),
        json!({"function_call":{}}),
        json!({"function_call":{"name":null,"arguments":""}}),
        json!({"refusal":"private-refusal"}),
    ] {
        let source = chunk(delta, Value::Null) + &complete(TEXT);
        assert_eq!(
            validate_upstream(source.as_bytes()).err().unwrap().code,
            "codebuddy_upstream_unverified"
        );
    }
    for source in [
        chunk(json!({"content":TEXT}), json!("error")) + "data: [DONE]\n\n",
        complete(TEXT) + "data: [DONE]\n\n",
        "data: {\"id\":\"completion\",\"choices\":[],\"choices\":[]}\n\n".to_owned(),
    ] {
        assert_eq!(
            validate_upstream(source.as_bytes()).err().unwrap().code,
            "codebuddy_upstream_unverified"
        );
    }
}

#[test]
fn complete_response_requires_matching_cli_text() {
    assert_eq!(candidate(&events(TEXT), TEXT).unwrap(), TEXT);
    assert!(candidate(&events("other"), TEXT).is_err());
}

#[test]
fn candidate_accepts_initial_text_snapshot_without_counting_it_twice() {
    for prefix in ["{", "{\"ok\":true,\"text\":\"白", TEXT] {
        let mut list = events(TEXT);
        list[1]["event"]["message"]["content"][0]["text"] = json!(prefix);
        let source = chunk(json!({"role":"assistant", "content":TEXT}), Value::Null)
            + &chunk(json!({}), json!("stop"))
            + "data: [DONE]\n\n";
        let proof = validate_upstream(source.as_bytes()).unwrap();
        assert_eq!(validate_candidate(&output(&list), proof).unwrap(), TEXT);
    }
}

#[test]
fn candidate_rejects_initial_snapshot_mismatch_and_nested_tools() {
    for prefix in [
        "different".to_owned(),
        format!("{TEXT}extra"),
        "白羽测试".to_owned(),
    ] {
        let mut list = events(TEXT);
        list[1]["event"]["message"]["content"][0]["text"] = json!(prefix);
        assert!(candidate(&list, TEXT).is_err());
    }
    let mut list = events(TEXT);
    list[1]["event"]["message"]["content"] = json!([
        {"type":"text", "text":TEXT},
        {"type":"tool_use", "name":"Write"},
    ]);
    assert!(candidate(&list, TEXT).is_err());
}

#[test]
fn sse_accepts_crlf_comments_and_final_usage() {
    let source = complete(TEXT).replace(
        "data: [DONE]",
        "data: {\"id\":\"completion\",\"choices\":[],\"usage\":{\"output_tokens\":1}}\n\ndata: [DONE]",
    );
    for source in [
        source.clone(),
        source.replace('\n', "\r\n"),
        format!(": keepalive\n\n{source}"),
    ] {
        let proof = validate_upstream(source.as_bytes()).unwrap();
        assert_eq!(
            validate_candidate(&output(&events(TEXT)), proof).unwrap(),
            TEXT
        );
    }
}

#[test]
fn sse_empty_finish_reason_continues_until_a_complete_stop() {
    let source = chunk(json!({"role":"assistant","content":""}), json!(""))
        + &chunk(json!({"content":TEXT}), json!(""))
        + &chunk(json!({}), json!("stop"))
        + "data: [DONE]\n\n";
    let proof = validate_upstream(source.as_bytes()).unwrap();
    assert_eq!(
        validate_candidate(&output(&events(TEXT)), proof).unwrap(),
        TEXT
    );
}

#[test]
fn sse_empty_finish_reason_cannot_replace_or_follow_the_terminal() {
    let body = chunk(json!({"content":TEXT}), json!(""));
    for source in [
        body.clone(),
        body.clone() + "data: [DONE]\n\n",
        body.clone() + &chunk(json!({}), json!("stop")),
        body + &chunk(json!({}), json!("stop")) + &chunk(json!({}), json!("")) + "data: [DONE]\n\n",
    ] {
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
    for reason in [
        json!(" "),
        json!(false),
        json!(0),
        json!([]),
        json!({}),
        json!("error"),
    ] {
        let source = chunk(json!({"content":TEXT}), reason) + &complete(TEXT);
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
}

#[test]
fn sse_accepts_only_the_exact_empty_legacy_function_placeholder() {
    for finish in [Value::Null, json!("stop")] {
        let mut source = chunk(
            json!({"content":TEXT,"function_call":{"name":"","arguments":""}}),
            finish.clone(),
        );
        if finish.is_null() {
            source += &chunk(json!({}), json!("stop"));
        }
        source += "data: [DONE]\n\n";
        let proof = validate_upstream(source.as_bytes()).unwrap();
        assert!(!String::from_utf8(proof.relay_bytes().unwrap())
            .unwrap()
            .contains("function_call"));
        assert_eq!(
            validate_candidate(&output(&events(TEXT)), proof).unwrap(),
            TEXT
        );
    }
}

#[test]
fn sse_rejects_ambiguous_or_nonempty_legacy_function_shapes() {
    for function in [
        json!({}),
        json!({"name":""}),
        json!({"arguments":""}),
        json!({"name":null,"arguments":""}),
        json!({"name":"","arguments":null}),
        json!({"name":"Write","arguments":""}),
        json!({"name":"","arguments":"{}"}),
        json!({"name":" ","arguments":""}),
        json!({"name":"","arguments":" "}),
        json!({"name":"","arguments":"","unknown":null}),
        json!({"name":false,"arguments":""}),
        json!({"name":"","arguments":{}}),
    ] {
        for finish in [Value::Null, json!("stop")] {
            let mut source = chunk(
                json!({"content":TEXT,"function_call":function}),
                finish.clone(),
            );
            if finish.is_null() {
                source += &chunk(json!({}), json!("stop"));
            }
            source += "data: [DONE]\n\n";
            assert!(validate_upstream(source.as_bytes()).is_err(), "{function}");
        }
    }
    for finish in [
        "function_call",
        "tool_calls",
        "length",
        "content_filter",
        "error",
    ] {
        let source = chunk(
            json!({"content":TEXT,"function_call":{"name":"","arguments":""}}),
            json!(finish),
        ) + "data: [DONE]\n\n";
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
    let source = chunk(
        json!({"function_call":{"name":"Write","arguments":""}}),
        Value::Null,
    ) + &chunk(
        json!({"content":TEXT,"function_call":{"name":"","arguments":""}}),
        json!("stop"),
    ) + "data: [DONE]\n\n";
    assert!(validate_upstream(source.as_bytes()).is_err());
}

#[test]
fn sse_strips_typed_vendor_reasoning_extensions_from_verified_text() {
    for delta in [
        json!({"reasoning":null}),
        json!({"reasoning":""}),
        json!({"reasoning":"private-reasoning"}),
        json!({"redacted_thinking":null}),
        json!({"redacted_thinking":""}),
        json!({"redacted_thinking":"private-redacted"}),
        json!({"extra_fields":null}),
        json!({"extra_fields":{}}),
        json!({"extra_fields":{"signature":null}}),
        json!({"extra_fields":{"signature":""}}),
        json!({"extra_fields":{"signature":"private-signature"}}),
        json!({"reasoning":"private-reasoning","redacted_thinking":"private-redacted","extra_fields":{"signature":"private-signature"}}),
    ] {
        let source = chunk(delta, Value::Null) + &complete(TEXT);
        let proof = validate_upstream(source.as_bytes()).unwrap();
        let relay = String::from_utf8(proof.relay_bytes().unwrap()).unwrap();
        for private in [
            "private-",
            "reasoning",
            "signature",
            "extra_fields",
            "redacted_thinking",
        ] {
            assert!(!relay.contains(private));
        }
        assert_eq!(
            validate_candidate(&output(&events(TEXT)), proof).unwrap(),
            TEXT
        );
    }
}

#[test]
fn sse_extensions_cannot_supply_an_answer_or_hide_refusal_or_tools() {
    let metadata = chunk(
        json!({"reasoning":"private-reasoning","redacted_thinking":"private-redacted","extra_fields":{"signature":"private-signature"}}),
        Value::Null,
    );
    for source in [
        metadata.clone() + &complete(""),
        metadata.clone() + &chunk(json!({"content":TEXT}), Value::Null) + "data: [DONE]\n\n",
        metadata.clone() + &chunk(json!({"refusal":"refused"}), Value::Null) + &complete(TEXT),
        metadata.clone()
            + &chunk(
                json!({"function_call":{"name":"Write","arguments":""}}),
                Value::Null,
            )
            + &complete(TEXT),
        metadata.clone()
            + &chunk(
                json!({"tool_calls":[{"function":{"name":"Write"}}]}),
                Value::Null,
            )
            + &complete(TEXT),
    ] {
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
    for finish in [
        "length",
        "content_filter",
        "tool_calls",
        "function_call",
        "error",
    ] {
        let source =
            metadata.clone() + &chunk(json!({"content":TEXT}), json!(finish)) + "data: [DONE]\n\n";
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
    for delta in [
        json!({"reasoning":{ "content":"private-reasoning" }}),
        json!({"reasoning":[]}),
        json!({"reasoning":false}),
        json!({"reasoning":1}),
        json!({"redacted_thinking":{}}),
        json!({"redacted_thinking":[]}),
        json!({"redacted_thinking":false}),
        json!({"redacted_thinking":1}),
        json!({"extra_fields":""}),
        json!({"extra_fields":[]}),
        json!({"extra_fields":false}),
        json!({"extra_fields":1}),
        json!({"extra_fields":{"signature":{}}}),
        json!({"extra_fields":{"signature":[]}}),
        json!({"extra_fields":{"signature":false}}),
        json!({"extra_fields":{"signature":1}}),
        json!({"extra_fields":{"_meta":null}}),
        json!({"extra_fields":{"signature":"","reasoning_detail":null}}),
        json!({"unknown":null}),
    ] {
        assert!(
            validate_upstream((chunk(delta, Value::Null) + &complete(TEXT)).as_bytes()).is_err()
        );
    }
}

#[test]
fn sse_terminal_content_remains_a_delta_even_when_it_matches_prior_text() {
    let source = chunk(json!({"content":TEXT}), Value::Null)
        + &chunk(json!({"content":TEXT}), json!("stop"))
        + "data: [DONE]\n\n";
    let proof = validate_upstream(source.as_bytes()).unwrap();
    let twice = format!("{TEXT}{TEXT}");
    assert_eq!(
        validate_candidate(&output(&events(&twice)), proof).unwrap(),
        twice
    );
    assert!(validate_candidate(
        &output(&events(TEXT)),
        validate_upstream(source.as_bytes()).unwrap()
    )
    .is_err());
}

#[test]
fn sse_rejects_duplicate_keys_that_mask_tools_refusal_or_terminal() {
    for raw in [
        r#"{"id":"completion","choices":[{"index":0,"delta":{"content":"ok","tool_calls":[{"function":{"name":"Write"}}],"tool_calls":null},"finish_reason":"stop"}]}"#,
        r#"{"id":"completion","choices":[{"index":0,"delta":{"content":"ok","refusal":"refused","refusal":""},"finish_reason":"stop"}]}"#,
        r#"{"id":"completion","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"tool_calls","finish_reason":"stop"}]}"#,
        r#"{"id":"completion","choices":[{"index":0,"delta":{"content":"ok","function_call":{"name":"Write","name":"","arguments":""}},"finish_reason":"stop"}]}"#,
        r#"{"id":"completion","choices":[{"index":0,"delta":{"content":"ok","refusal":"refused","ref\u0075sal":""},"finish_reason":"stop"}]}"#,
    ] {
        let source = format!("data: {raw}\n\ndata: [DONE]\n\n");
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
}

#[test]
fn candidate_rejects_duplicate_keys_that_mask_errors_or_text() {
    for (search, replacement) in [
        ("\"is_error\":false", "\"is_error\":true,\"is_error\":false"),
        (
            "\"type\":\"text_delta\"",
            "\"type\":\"tool_call\",\"type\":\"text_delta\"",
        ),
        (
            "\"subtype\":\"success\"",
            "\"subtype\":\"error\",\"subtype\":\"success\"",
        ),
        (
            "\"is_error\":false",
            "\"is_error\":false,\"terminal_reason\":\"cancelled\",\"terminal_reason\":null",
        ),
    ] {
        let original = String::from_utf8(output(&events(TEXT))).unwrap();
        assert!(original.contains(search));
        let ambiguous = original.replace(search, replacement);
        let proof = validate_upstream(complete(TEXT).as_bytes()).unwrap();
        assert!(validate_candidate(ambiguous.as_bytes(), proof).is_err());
    }
}

#[test]
fn sse_accepts_nullable_metadata_and_reasoning_without_changing_visible_text() {
    for delta in [
        json!({"role":null}),
        json!({"content":null}),
        json!({"reasoning_content":null}),
        json!({"reasoning_content":""}),
        json!({"reasoning_content":"synthetic-private-reasoning"}),
        json!({"tool_calls":null}),
        json!({"tool_calls":[]}),
        json!({"function_call":null}),
        json!({"refusal":null}),
        json!({"refusal":""}),
        json!({"role":null,"content":null,"reasoning_content":"synthetic-private-reasoning","tool_calls":[],"function_call":null,"refusal":""}),
    ] {
        let source = chunk(delta, Value::Null) + &complete(TEXT);
        let proof = validate_upstream(source.as_bytes()).unwrap();
        assert_eq!(
            validate_candidate(&output(&events(TEXT)), proof).unwrap(),
            TEXT
        );
    }
}

#[test]
fn relay_bytes_preserve_text_without_copying_reasoning_or_upstream_metadata() {
    let source = (chunk(
        json!({"role":"assistant","content":null,"reasoning_content":"synthetic-private-reasoning","tool_calls":[],"function_call":null,"refusal":null}),
        Value::Null,
    ) + &complete(TEXT))
        .replace("\"completion\"", "\"synthetic-private-completion\"")
        .replace("\"choices\":", "\"synthetic-private-field\":\"synthetic-private-value\",\"choices\":");
    let proof = validate_upstream(source.as_bytes()).unwrap();
    let bytes = proof.relay_bytes().unwrap();
    let relay = std::str::from_utf8(&bytes).unwrap();
    for private in [
        "reasoning_content",
        "tool_calls",
        "function_call",
        "refusal",
        "synthetic-private-reasoning",
        "synthetic-private-completion",
        "synthetic-private-field",
        "synthetic-private-value",
    ] {
        assert!(!relay.contains(private), "relay contains {private}");
    }
    let normalized = validate_upstream(&bytes).unwrap();
    assert_eq!(
        validate_candidate(&output(&events(TEXT)), normalized).unwrap(),
        TEXT
    );
    assert_eq!(
        validate_candidate(&output(&events(TEXT)), proof).unwrap(),
        TEXT
    );
}

#[test]
fn relay_bytes_preserve_json_escaping_and_complete_terminal() {
    let text = "引号\"、反斜杠\\与换行\ndata: [DONE]\n\n后续正文";
    let proof = validate_upstream(complete(text).as_bytes()).unwrap();
    let relay = proof.relay_bytes().unwrap();
    assert_eq!(
        std::str::from_utf8(&relay)
            .unwrap()
            .lines()
            .filter(|line| *line == "data: [DONE]")
            .count(),
        1
    );
    let normalized = validate_upstream(&relay).unwrap();
    assert_eq!(
        validate_candidate(&output(&events(text)), normalized).unwrap(),
        text
    );
    assert_eq!(
        validate_candidate(&output(&events(text)), proof).unwrap(),
        text
    );
}

#[test]
fn sse_rejects_wrong_types_nonempty_actions_and_unknown_delta_fields() {
    for delta in [
        json!({"role":false}),
        json!({"role":"user"}),
        json!({"content":false}),
        json!({"content":0}),
        json!({"content":{}}),
        json!({"reasoning_content":false}),
        json!({"reasoning_content":0}),
        json!({"reasoning_content":[]}),
        json!({"reasoning_content":{}}),
        json!({"tool_calls":false}),
        json!({"tool_calls":""}),
        json!({"tool_calls":{}}),
        json!({"tool_calls":[null]}),
        json!({"tool_calls":[{}]}),
        json!({"function_call":{}}),
        json!({"function_call":[]}),
        json!({"function_call":""}),
        json!({"function_call":false}),
        json!({"refusal":" "}),
        json!({"refusal":false}),
        json!({"refusal":[]}),
        json!({"refusal":{}}),
        json!({"unknown":null}),
        json!({"reasoning":{"content":"synthetic-private-reasoning"}}),
    ] {
        let source = chunk(delta, Value::Null) + &complete(TEXT);
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
}

#[test]
fn reasoning_cannot_replace_the_answer_or_hide_unsuccessful_terminal() {
    let reasoning = chunk(
        json!({"reasoning_content":"synthetic-private-reasoning","content":null}),
        Value::Null,
    );
    for source in [
        reasoning.clone() + &complete(""),
        reasoning.clone() + &chunk(json!({"content":TEXT}), Value::Null),
        reasoning.clone() + &chunk(json!({"content":TEXT}), Value::Null) + "data: [DONE]\n\n",
    ] {
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
    for finish in ["length", "content_filter", "tool_calls", "function_call"] {
        let source =
            reasoning.clone() + &chunk(json!({"content":TEXT}), json!(finish)) + "data: [DONE]\n\n";
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
    let source = reasoning + &complete(TEXT);
    let proof = validate_upstream(source.as_bytes()).unwrap();
    assert!(validate_candidate(&output(&events("synthetic-private-reasoning")), proof).is_err());
}

#[test]
fn sse_rejects_incomplete_or_unsuccessful_terminal() {
    let text = chunk(json!({"content":TEXT}), Value::Null);
    for source in [
        text.clone(),
        text.clone() + "data: [DONE]\n\n",
        text.clone() + &chunk(json!({}), json!("stop")),
        text.clone() + &chunk(json!({}), json!("length")) + "data: [DONE]\n\n",
        text + &chunk(json!({}), json!("content_filter")) + "data: [DONE]\n\n",
        complete(TEXT).trim_end().to_owned(),
    ] {
        assert!(validate_upstream(source.as_bytes()).is_err(), "{source}");
    }
}

#[test]
fn sse_rejects_tools_refusal_and_non_text_delta() {
    for delta in [
        json!({"tool_calls":[{"function":{"name":"Write"}}]}),
        json!({"function_call":{"name":"Write"}}),
        json!({"refusal":"refused"}),
        json!({"role":"tool"}),
        json!({"content":42}),
        json!({"content":[{"type":"text","text":TEXT}]}),
        json!([]),
    ] {
        let source = chunk(delta, Value::Null) + &complete(TEXT);
        assert!(validate_upstream(source.as_bytes()).is_err(), "{source}");
    }
}

#[test]
fn sse_rejects_extra_choices_changed_id_and_error() {
    for prefix in [
        "data: {\"id\":\"completion\",\"choices\":[{\"index\":0,\"delta\":{}},{\"index\":1,\"delta\":{}}]}\n\n",
        "data: {\"id\":\"changed\",\"choices\":[{\"index\":0,\"delta\":{}}]}\n\n",
        "data: {\"id\":\"completion\",\"choices\":[{\"index\":1,\"delta\":{}}]}\n\n",
        "data: {\"id\":\"completion\",\"choices\":[],\"usage\":{}}\n\n",
        "data: {\"error\":{\"message\":\"failed\"}}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{}}]}\n\n",
    ] {
        assert!(validate_upstream((prefix.to_owned() + &complete(TEXT)).as_bytes()).is_err());
    }
}

#[test]
fn sse_rejects_duplicate_terminal_late_data_and_unknown_fields() {
    for source in [
        complete(TEXT) + "data: [DONE]\n\n",
        complete(TEXT) + &chunk(json!({"content":"late"}), Value::Null),
        complete(TEXT).replace("data: [DONE]", "data: {broken"),
        format!("event: message\n{}", complete(TEXT)),
        chunk(json!({"content":TEXT}), json!("stop"))
            + &chunk(json!({}), json!("stop"))
            + "data: [DONE]\n\n",
        complete(""),
    ] {
        assert!(validate_upstream(source.as_bytes()).is_err());
    }
}

#[test]
fn sse_rejects_invalid_utf8_and_bounded_response_overflow() {
    assert!(validate_upstream(&[0xff]).is_err());
    assert_eq!(
        validate_upstream(&vec![b' '; 1024 * 1024 + 1])
            .err()
            .unwrap()
            .code,
        "response_too_large"
    );
}

#[test]
fn candidate_accepts_status_and_optional_matching_metadata() {
    let mut list = events(TEXT);
    for event in &mut list[1..8] {
        event["_messageId"] = json!("model-request");
        event["_meta"]["codebuddy.ai/conversationRequestId"] = json!("request");
        event["_meta"]["codebuddy.ai/modelRequestId"] = json!("model-request");
        event["_meta"]["codebuddy.ai/llmMessageId"] = json!("model-request");
    }
    list.insert(1, json!({"type":"system","subtype":"status","session_id":"session","_requestId":"request","status":null}));
    assert_eq!(candidate(&list, TEXT).unwrap(), TEXT);
}

#[test]
fn candidate_rejects_missing_and_duplicate_terminal() {
    let list = events(TEXT);
    for end in 0..list.len() {
        assert!(candidate(&list[..end], TEXT).is_err());
    }
    for extra in [
        &list[8],
        &list[4],
        &json!({"type":"system","subtype":"status"}),
    ] {
        let mut duplicate = list.clone();
        duplicate.push(extra.clone());
        assert!(candidate(&duplicate, TEXT).is_err());
    }
}

#[test]
fn candidate_rejects_text_inconsistency() {
    for index in [3, 7, 8] {
        let mut list = events(TEXT);
        match index {
            3 => list[3]["event"]["delta"]["text"] = json!("other"),
            7 => list[7]["message"]["content"][0]["text"] = json!("refusal"),
            _ => list[8]["result"] = json!("other"),
        }
        assert!(candidate(&list, TEXT).is_err());
    }
}

#[test]
fn candidate_rejects_cross_session_request_and_model_identity() {
    for index in 1..9 {
        for field in ["session_id", "_requestId"] {
            let mut list = events(TEXT);
            list[index][field] = json!("other");
            assert!(candidate(&list, TEXT).is_err(), "{field} at {index}");
        }
    }
    for field in [
        "codebuddy.ai/modelRequestId",
        "codebuddy.ai/conversationRequestId",
        "codebuddy.ai/llmMessageId",
    ] {
        let mut list = events(TEXT);
        list[4]["_meta"][field] = json!("other");
        assert!(candidate(&list, TEXT).is_err(), "{field}");
    }
    let mut list = events(TEXT);
    list[7]["message"]["id"] = json!("other");
    assert!(candidate(&list, TEXT).is_err());
    let mut list = events(TEXT);
    list[7]["_messageId"] = json!("other");
    assert!(candidate(&list, TEXT).is_err());
}

#[test]
fn candidate_rejects_nested_tools_and_parent_tool_context() {
    for index in [1, 7] {
        let mut list = events(TEXT);
        let message = if index == 1 {
            &mut list[1]["event"]["message"]
        } else {
            &mut list[7]["message"]
        };
        message["content"] = json!([{"type":"tool_use","name":"Write"}]);
        assert!(candidate(&list, TEXT).is_err());
    }
    let mut list = events(TEXT);
    list[2]["event"]["content_block"]["type"] = json!("tool_use");
    assert!(candidate(&list, TEXT).is_err());
    let mut list = events(TEXT);
    list[4]["parent_tool_use_id"] = json!("tool-parent");
    assert!(candidate(&list, TEXT).is_err());
}

#[test]
fn candidate_rejects_additional_model_round_and_out_of_order_events() {
    for index in [1, 2, 4, 6, 7] {
        let mut list = events(TEXT);
        list.insert(7, list[index].clone());
        assert!(candidate(&list, TEXT).is_err());
    }
    let mut list = events(TEXT);
    list.swap(4, 5);
    assert!(candidate(&list, TEXT).is_err());
}

#[test]
fn candidate_rejects_terminal_errors_cancellation_and_permissions() {
    for (field, value) in [
        ("subtype", json!("error_during_execution")),
        ("is_error", json!(true)),
        ("terminal_reason", json!("aborted_streaming")),
        ("terminal_reason", json!(false)),
        ("terminal_reason", json!(0)),
        ("permission_denials", json!([{"tool":"Write"}])),
        ("permission_denials", json!({})),
    ] {
        let mut list = events(TEXT);
        list[8][field] = value;
        assert!(candidate(&list, TEXT).is_err(), "{field}");
    }
    for index in [1, 7] {
        let mut list = events(TEXT);
        if index == 1 {
            list[1]["event"]["message"]["stop_reason"] = json!("tool_use");
        } else {
            list[7]["message"]["stop_reason"] = json!("tool_use");
        }
        assert!(candidate(&list, TEXT).is_err());
    }
}

#[test]
fn candidate_rejects_stop_sequences_and_non_text_terminators() {
    for index in [1, 5, 7] {
        let mut list = events(TEXT);
        match index {
            1 => list[1]["event"]["message"]["stop_sequence"] = json!("boundary"),
            5 => list[5]["event"]["delta"]["stop_sequence"] = json!("boundary"),
            _ => list[7]["message"]["stop_sequence"] = json!("boundary"),
        }
        assert!(candidate(&list, TEXT).is_err());
    }
    for reason in [json!("tool_use"), json!("max_tokens"), Value::Null] {
        let mut list = events(TEXT);
        list[5]["event"]["delta"]["stop_reason"] = reason;
        assert!(candidate(&list, TEXT).is_err());
    }
}

#[test]
fn candidate_rejects_excessive_event_count_and_single_line_size() {
    let mut list = events(TEXT);
    let status =
        json!({"type":"system","subtype":"status","session_id":"session","_requestId":"request"});
    list.splice(1..1, std::iter::repeat_n(status, MAX_EVENTS));
    assert_eq!(
        candidate(&list, TEXT).unwrap_err().code,
        "response_too_large"
    );

    let mut list = events(TEXT);
    list[0]["extra"] = json!("a".repeat(MAX_EVENT_BYTES));
    assert_eq!(
        candidate(&list, TEXT).unwrap_err().code,
        "response_too_large"
    );
}

#[test]
fn candidate_rejects_invalid_utf8_json_and_output_overflow() {
    for bytes in [
        vec![0xff],
        b"{broken}\n".to_vec(),
        vec![b' '; 4 * 1024 * 1024 + 1],
    ] {
        let proof = validate_upstream(complete(TEXT).as_bytes()).unwrap();
        assert!(validate_candidate(&bytes, proof).is_err());
    }
}

#[test]
fn candidate_rejects_missing_id_and_unknown_events() {
    for value in [Value::Null, json!(""), json!(42)] {
        let mut list = events(TEXT);
        list[0]["session_id"] = value.clone();
        assert!(candidate(&list, TEXT).is_err());
        let mut list = events(TEXT);
        list[1]["event"]["message"]["id"] = value;
        assert!(candidate(&list, TEXT).is_err());
    }
    for kind in ["tool_result", "user", "error", "control_request"] {
        let mut list = events(TEXT);
        list.insert(
            4,
            json!({"type":kind,"session_id":"session","_requestId":"request"}),
        );
        assert!(candidate(&list, TEXT).is_err());
    }
}
