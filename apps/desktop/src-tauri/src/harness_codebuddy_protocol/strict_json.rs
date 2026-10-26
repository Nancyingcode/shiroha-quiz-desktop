use serde::{
    de::{self, MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer,
};
use serde_json::{Map, Number, Value};
use std::fmt;

pub(super) fn parse(source: &str) -> serde_json::Result<Value> {
    serde_json::from_str::<StrictValue>(source).map(|value| value.0)
}

struct StrictValue(Value);

impl<'de> Deserialize<'de> for StrictValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(ValueVisitor)
    }
}

struct ValueVisitor;

impl<'de> Visitor<'de> for ValueVisitor {
    type Value = StrictValue;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value with unique object keys")
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::Bool(value)))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::Number(value.into())))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::Number(value.into())))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
        Number::from_f64(value)
            .map(|number| StrictValue(Value::Number(number)))
            .ok_or_else(|| E::custom("invalid JSON number"))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::String(value.to_owned())))
    }

    fn visit_string<E: de::Error>(self, value: String) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::String(value)))
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(StrictValue(Value::Null))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element::<StrictValue>()? {
            values.push(value.0);
        }
        Ok(StrictValue(Value::Array(values)))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut object: A) -> Result<Self::Value, A::Error> {
        let mut values = Map::new();
        while let Some(key) = object.next_key::<String>()? {
            // 先比较解码后的键，避免转义别名或后值覆盖掩盖工具、拒答及异常终态。
            if values.contains_key(&key) {
                return Err(de::Error::custom("duplicate object key"));
            }
            let value = object.next_value::<StrictValue>()?;
            values.insert(key, value.0);
        }
        Ok(StrictValue(Value::Object(values)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_json_values_unicode_and_independent_object_keys() {
        for source in [
            "null",
            "true",
            "false",
            "-7",
            "18446744073709551615",
            "-9223372036854775808",
            "-0.0",
            "1.25e20",
            r#""白羽\uD83D\uDE00""#,
            r#"{"items":[null,true,7,{"name":"first"},{"name":"second"}],"name":"outer"}"#,
            r#"{"é":1,"e\u0301":2}"#,
            r#"{"text":"{\"name\":1,\"name\":2}"}"#,
            " \r\n [1, 2] \t ",
        ] {
            let expected: Value = serde_json::from_str(source).unwrap();
            assert_eq!(parse(source).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_duplicate_action_and_terminal_fields_at_every_object_depth() {
        for source in [
            r#"{"delta":{"tool_calls":[{"function":{"name":"synthetic-tool"}}],"tool_calls":null}}"#,
            r#"{"delta":{"refusal":"synthetic-refusal","refusal":""}}"#,
            r#"{"choices":[{"finish_reason":"length","finish_reason":"stop"}]}"#,
            r#"{"error":{"code":401},"error":null}"#,
            r#"{"choices":[1,2],"choices":[1]}"#,
            r#"{"delta":{"function_call":{"name":"synthetic-tool","name":"","arguments":""}}}"#,
            r#"[{"message":{"id":"old","id":"new"}}]"#,
            r#"{"metadata":{"same":1,"same":1}}"#,
            r#"{"terminal_reason":"aborted_streaming","terminal_reason":null}"#,
            r#"{"is_error":true,"is_error":false}"#,
        ] {
            assert!(
                parse(source).is_err(),
                "duplicate object keys must be rejected"
            );
        }
    }

    #[test]
    fn rejects_keys_that_are_equal_after_json_escape_decoding() {
        for source in [
            r#"{"name":"synthetic-tool","\u006eame":""}"#,
            r#"{"delta":{"tool_calls":[{}],"tool_\u0063alls":null}}"#,
            r#"{"😀":1,"\uD83D\uDE00":2}"#,
        ] {
            assert!(
                parse(source).is_err(),
                "escaped aliases must be treated as duplicates"
            );
        }
    }

    #[test]
    fn retains_invalid_document_and_trailing_input_checks() {
        for source in [
            "",
            "{}[]",
            "{} true",
            "nullx",
            "[1,]",
            r#"{"a":1,}"#,
            r#"{"a":1} trailing"#,
            r#""\uD800""#,
            "1e400",
        ] {
            assert!(serde_json::from_str::<Value>(source).is_err());
            assert!(parse(source).is_err());
        }
    }

    #[test]
    fn retains_the_default_nested_value_limit() {
        let ordinary = format!("{}0{}", "[".repeat(32), "]".repeat(32));
        assert_eq!(
            parse(&ordinary).unwrap(),
            serde_json::from_str::<Value>(&ordinary).unwrap()
        );
        for depth in [128, 256] {
            let nested = format!("{}0{}", "[".repeat(depth), "]".repeat(depth));
            assert!(serde_json::from_str::<Value>(&nested).is_err());
            assert!(parse(&nested).is_err());
        }
    }

    #[test]
    fn duplicate_errors_do_not_disclose_keys_or_values() {
        let source = r#"{"synthetic-sensitive-name":"synthetic-sensitive-value","synthetic-sensitive-name":null}"#;
        let error = parse(source).unwrap_err().to_string();
        assert!(!error.contains("synthetic-sensitive-name"));
        assert!(!error.contains("synthetic-sensitive-value"));
    }
}
