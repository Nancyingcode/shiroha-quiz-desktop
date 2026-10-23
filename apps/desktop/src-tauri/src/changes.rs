use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Change {
    PutBank {
        bank: Value,
    },
    PutBankMetadata {
        bank: Value,
    },
    QuestionOrder {
        bank_id: String,
        ids: Vec<String>,
    },
    DeleteBank {
        bank_id: String,
    },
    PutQuestion {
        bank_id: String,
        question: Value,
    },
    DeleteQuestion {
        bank_id: String,
        question_id: String,
    },
    PutRecord {
        record: Value,
    },
    DeleteRecord {
        record_id: String,
    },
    PutHeader {
        header: serde_json::Map<String, Value>,
    },
    BankOrder {
        ids: Vec<String>,
    },
    RecordOrder {
        ids: Vec<String>,
    },
}
fn items<'a>(value: &'a mut Value, key: &str) -> Result<&'a mut Vec<Value>> {
    value[key]
        .as_array_mut()
        .ok_or_else(|| Error::new("invalid_input"))
}
fn put(items: &mut Vec<Value>, value: Value) -> Result<()> {
    let id = value["id"]
        .as_str()
        .ok_or_else(|| Error::new("invalid_input"))?;
    if let Some(index) = items.iter().position(|item| item["id"] == id) {
        items[index] = value;
    } else {
        items.push(value);
    }
    Ok(())
}
fn order(items: &mut Vec<Value>, ids: &[String]) -> Result<()> {
    if items.len() != ids.len() {
        return Err(Error::new("invalid_input"));
    }
    let mut ordered = Vec::with_capacity(ids.len());
    for id in ids {
        if ordered.iter().any(|item: &Value| item["id"] == *id) {
            return Err(Error::new("invalid_input"));
        }
        ordered.push(
            items
                .iter()
                .find(|item| item["id"] == *id)
                .ok_or_else(|| Error::new("invalid_input"))?
                .clone(),
        );
    }
    *items = ordered;
    Ok(())
}
pub fn apply(snapshot: &mut Value, changes: Vec<Change>) -> Result<()> {
    for change in changes {
        match change {
            Change::PutBankMetadata { mut bank } => {
                let bank_id = bank["id"]
                    .as_str()
                    .ok_or_else(|| Error::new("invalid_input"))?
                    .to_owned();
                if bank.get("questions").is_some() {
                    return Err(Error::new("invalid_input"));
                }
                let previous = items(snapshot, "banks")?
                    .iter_mut()
                    .find(|item| item["id"] == bank_id)
                    .ok_or_else(|| Error::new("not_found"))?;
                bank["questions"] = previous["questions"].take();
                *previous = bank;
            }
            Change::QuestionOrder { bank_id, ids } => {
                let bank = items(snapshot, "banks")?
                    .iter_mut()
                    .find(|item| item["id"] == bank_id)
                    .ok_or_else(|| Error::new("not_found"))?;
                order(items(bank, "questions")?, &ids)?;
            }
            Change::PutBank { bank } => put(items(snapshot, "banks")?, bank)?,
            Change::DeleteBank { bank_id } => {
                items(snapshot, "banks")?.retain(|bank| bank["id"] != bank_id)
            }
            Change::PutQuestion { bank_id, question } => {
                let bank = items(snapshot, "banks")?
                    .iter_mut()
                    .find(|bank| bank["id"] == bank_id)
                    .ok_or_else(|| Error::new("not_found"))?;
                put(items(bank, "questions")?, question)?;
            }
            Change::DeleteQuestion {
                bank_id,
                question_id,
            } => {
                let bank = items(snapshot, "banks")?
                    .iter_mut()
                    .find(|bank| bank["id"] == bank_id)
                    .ok_or_else(|| Error::new("not_found"))?;
                items(bank, "questions")?.retain(|question| question["id"] != question_id);
            }
            Change::PutRecord { record } => put(items(snapshot, "records")?, record)?,
            Change::DeleteRecord { record_id } => {
                items(snapshot, "records")?.retain(|record| record["id"] != record_id)
            }
            Change::PutHeader { header } => {
                if header.contains_key("banks") || header.contains_key("records") {
                    return Err(Error::new("invalid_input"));
                }
                let object = snapshot
                    .as_object_mut()
                    .ok_or_else(|| Error::new("invalid_input"))?;
                object.retain(|key, _| key == "banks" || key == "records");
                object.extend(header);
            }
            Change::BankOrder { ids } => order(items(snapshot, "banks")?, &ids)?,
            Change::RecordOrder { ids } => order(items(snapshot, "records")?, &ids)?,
        }
    }
    Ok(())
}
