use crate::error::{Error, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

// 任务进度属于本进程，重启后的持久结果由 storage.operations 查询。
#[derive(Clone, Default)]
pub struct Tasks(Arc<Mutex<HashMap<String, Value>>>);
impl Tasks {
    pub fn begin(&self, id: &str) -> Result<()> {
        if id.is_empty() || id.len() > 256 {
            return Err(Error::new("invalid_input"));
        }
        let mut tasks = self
            .0
            .lock()
            .map_err(|_| Error::new("storage_unavailable"))?;
        if tasks.contains_key(id) {
            return Err(Error::new("duplicate_operation"));
        }
        tasks.insert(
            id.into(),
            json!({"taskId":id,"state":"running","phase":"staging"}),
        );
        Ok(())
    }
    pub fn committing(&self, id: &str) -> Result<()> {
        let mut tasks = self
            .0
            .lock()
            .map_err(|_| Error::new("storage_unavailable"))?;
        let task = tasks.get_mut(id).ok_or_else(|| Error::new("not_found"))?;
        if task["state"] == "cancelled" {
            return Err(Error::new("cancelled"));
        }
        if task["state"] != "running" {
            return Err(Error::new("invalid_transition"));
        }
        task["phase"] = json!("committing");
        Ok(())
    }
    pub fn finish(&self, id: &str, success: bool) -> Result<()> {
        let mut tasks = self
            .0
            .lock()
            .map_err(|_| Error::new("storage_unavailable"))?;
        let task = tasks.get_mut(id).ok_or_else(|| Error::new("not_found"))?;
        if task["state"] == "cancelled" {
            return Ok(());
        }
        if task["state"] != "running" {
            return Err(Error::new("invalid_transition"));
        }
        *task = if success {
            json!({"taskId":id,"state":"succeeded"})
        } else {
            json!({"taskId":id,"state":"failed","error":Error::new("storage_unavailable")})
        };
        Ok(())
    }
    pub fn get(&self, id: &str) -> Result<Value> {
        self.0
            .lock()
            .map_err(|_| Error::new("storage_unavailable"))?
            .get(id)
            .cloned()
            .ok_or_else(|| Error::new("not_found"))
    }
    pub fn cancel(&self, id: &str) -> Result<Value> {
        let mut tasks = self
            .0
            .lock()
            .map_err(|_| Error::new("storage_unavailable"))?;
        let task = tasks.get_mut(id).ok_or_else(|| Error::new("not_found"))?;
        let accepted = task["state"] == "running" && task["phase"] != "committing";
        if accepted {
            *task = json!({"taskId":id,"state":"cancelled"});
        }
        Ok(json!({"accepted":accepted,"state":task}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_never_reverses_commit_or_terminal_state() {
        let tasks = Tasks::default();
        tasks.begin("one").unwrap();
        assert_eq!(tasks.cancel("one").unwrap()["accepted"], true);
        assert_eq!(tasks.committing("one").unwrap_err().code, "cancelled");
        tasks.finish("one", true).unwrap();
        assert_eq!(tasks.get("one").unwrap()["state"], "cancelled");
        tasks.begin("two").unwrap();
        tasks.committing("two").unwrap();
        assert_eq!(tasks.cancel("two").unwrap()["accepted"], false);
        tasks.finish("two", true).unwrap();
        assert_eq!(tasks.cancel("two").unwrap()["accepted"], false);
        assert!(tasks.begin("two").is_err());
        assert!(tasks.cancel("unknown").is_err());
    }
}
