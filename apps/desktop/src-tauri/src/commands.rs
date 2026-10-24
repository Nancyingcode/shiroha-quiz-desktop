use crate::files::Files;
use crate::tasks::Tasks;
use crate::{
    error::{Error, Result},
    storage::Store,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub struct LocalFiles(pub Arc<Mutex<Files>>);
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Query {
    RecoverImport {
        snapshot: Value,
    },
    RecoverySnapshots,
    Recover {
        snapshot_id: String,
    },
    Hydrate {
        value: Value,
        revision: i64,
    },
    Summary,
    Details {
        collection: String,
        bank_id: String,
        ids: Vec<String>,
        revision: i64,
    },
    Page {
        collection: String,
        bank_id: String,
        cursor: Option<String>,
        limit: usize,
    },
    Snapshots,
    Restore {
        snapshot_id: String,
        operation_id: String,
        expected_revision: i64,
    },
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FileRequest {
    ChooseImport,
    ChooseExport {
        name: String,
    },
    Read {
        token: String,
        offset: u64,
    },
    Append {
        token: String,
        offset: u64,
        bytes: Vec<u8>,
    },
    Finish {
        token: String,
        size: u64,
    },
    Release {
        token: String,
    },
}

// 进程拥有连接及根锁，窗口重载不释放写入所有权；I/O 在阻塞线程上串行处理。
#[derive(Clone)]
pub struct LocalData(pub Arc<Mutex<Option<Store>>>, pub PathBuf);

pub(crate) fn authorize(window: &tauri::WebviewWindow) -> Result<()> {
    let url = window.url().map_err(|_| Error::new("permission_denied"))?;
    authorize_source(window.label(), &url)
}

fn authorize_source(label: &str, url: &url::Url) -> Result<()> {
    let packaged = url.port().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")));
    // CLI 开发服务使用固定端口；发行构建不能借此接受远程网页调用。
    // 兼容 CLI 实际使用的 IPv4 回环来源；取消该开发服务时同步移除此许可。
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(51736);
    if label != "main" || !(packaged || development) {
        return Err(Error::new("permission_denied"));
    }
    Ok(())
}
#[tauri::command]
pub async fn local_query(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalData>,
    services: tauri::State<'_, Arc<crate::services::Services>>,
    harness: tauri::State<'_, Arc<crate::harness::Harness>>,
    query: Query,
) -> Result<Value> {
    authorize(&window)?;
    let restore_guard = if matches!(
        query,
        Query::Recover { .. } | Query::RecoverImport { .. } | Query::Restore { .. }
    ) {
        let execution = harness.inner().clone();
        let guard = tauri::async_runtime::spawn_blocking(move || execution.begin_restore())
            .await
            .map_err(|_| Error::new("harness_unavailable"))??;
        services.invalidate()?;
        Some(guard)
    } else {
        None
    };
    if matches!(
        query,
        Query::RecoverySnapshots | Query::Recover { .. } | Query::RecoverImport { .. }
    ) {
        let state = state.inner().clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let _restore_guard = restore_guard;
            let mut current = state
                .0
                .lock()
                .map_err(|_| Error::new("storage_unavailable"))?;
            match query {
                Query::RecoverySnapshots => match current.as_ref() {
                    Some(store) => Ok(json!(store.snapshots()?)),
                    None => Ok(json!(Store::recovery_snapshots(&state.1)?)),
                },
                recovery @ (Query::Recover { .. } | Query::RecoverImport { .. }) => {
                    let existing = match current.take() {
                        Some(store) => Some(store),
                        None => Store::open(&state.1).ok(),
                    };
                    if let Some(store) = existing {
                        if store.read().is_ok() {
                            *current = Some(store);
                            return Err(Error::new("invalid_transition"));
                        }
                    }
                    match recovery {
                        Query::Recover { snapshot_id } => Store::recover(&state.1, &snapshot_id)?,
                        Query::RecoverImport { snapshot } => {
                            Store::recover_import(&state.1, &snapshot)?
                        }
                        _ => return Err(Error::new("invalid_input")),
                    }
                    *current = Some(Store::open(&state.1)?);
                    Ok(json!({"recovered":true}))
                }
                _ => Err(Error::new("invalid_input")),
            }
        })
        .await
        .map_err(|_| Error::new("storage_unavailable"))?;
    }
    run(state.inner().clone(), move |store| {
        let _restore_guard = restore_guard;
        match query {
            Query::RecoverySnapshots | Query::Recover { .. } | Query::RecoverImport { .. } => {
                Err(Error::new("invalid_input"))
            }
            Query::Hydrate { value, revision } => store.hydrate(value, revision),
            Query::Summary => Ok(json!({"revision":store.revision()?,"snapshot":store.summary()?})),
            Query::Details {
                collection,
                bank_id,
                ids,
                revision,
            } => Ok(json!(store.details(
                &collection,
                &bank_id,
                &ids,
                revision
            )?)),
            Query::Page {
                collection,
                bank_id,
                cursor,
                limit,
            } => store.page(&collection, &bank_id, cursor.as_deref(), limit),
            Query::Snapshots => Ok(json!(store.snapshots()?)),
            Query::Restore {
                snapshot_id,
                operation_id,
                expected_revision,
            } => {
                Ok(json!({"revision":store.restore(&snapshot_id,&operation_id,expected_revision)?}))
            }
        }
    })
    .await
}
pub(crate) async fn run<T: Send + 'static>(
    state: LocalData,
    action: impl FnOnce(&mut Store) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = state
            .0
            .lock()
            .map_err(|_| Error::new("storage_unavailable"))?;
        if store.is_none() {
            *store = Some(Store::open(&state.1)?);
        }
        action(store.as_mut().ok_or_else(|| Error::new("not_ready"))?)
    })
    .await
    .map_err(|_| Error::new("storage_unavailable"))?
}

#[tauri::command]
pub async fn local_initialize(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalData>,
    files: tauri::State<'_, LocalFiles>,
) -> Result<Value> {
    authorize(&window)?;
    files
        .0
        .lock()
        .map_err(|_| Error::new("storage_unavailable"))?
        .reset()?;
    run(state.inner().clone(), |store| {
        Ok(json!({"revision":store.revision()?,"hasData":store.has_data()?}))
    })
    .await
}
#[tauri::command]
pub async fn local_read(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalData>,
) -> Result<Option<Value>> {
    authorize(&window)?;
    run(state.inner().clone(), |store| store.read()).await
}
#[tauri::command]
pub async fn local_commit(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalData>,
    tasks: tauri::State<'_, Tasks>,
    operation_id: String,
    expected_revision: i64,
    changes: Vec<crate::changes::Change>,
) -> Result<Value> {
    authorize(&window)?;
    let known = run(state.inner().clone(), {
        let id = operation_id.clone();
        move |store| store.operation(&id)
    })
    .await?;
    if known.is_some() {
        return run(state.inner().clone(), move |store| {
            Ok(json!({"revision":store.commit(&operation_id,expected_revision,changes)?}))
        })
        .await;
    }
    tasks.begin(&operation_id)?;
    let progress = tasks.inner().clone();
    let id = operation_id.clone();
    let result = run(state.inner().clone(), move |store| {
        progress.committing(&id)?;
        Ok(json!({"revision":store.commit(&id,expected_revision,changes)?}))
    })
    .await;
    tasks.finish(&operation_id, result.is_ok())?;
    result
}
#[tauri::command]
pub async fn local_write(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalData>,
    tasks: tauri::State<'_, Tasks>,
    snapshot: Value,
    operation_id: String,
    expected_revision: i64,
) -> Result<Value> {
    authorize(&window)?;
    let known = run(state.inner().clone(), {
        let id = operation_id.clone();
        move |store| store.operation(&id)
    })
    .await?;
    if known.is_some() {
        return run(state.inner().clone(), move |store| {
            Ok(json!({"revision":store.write(&operation_id,expected_revision,&snapshot)?}))
        })
        .await;
    }
    tasks.begin(&operation_id)?;
    let progress = tasks.inner().clone();
    let id = operation_id.clone();
    let result = run(state.inner().clone(), move |store| {
        progress.committing(&id)?;
        Ok(json!({"revision":store.write(&id,expected_revision,&snapshot)?}))
    })
    .await;
    tasks.finish(&operation_id, result.is_ok())?;
    result
}

#[tauri::command]
pub fn local_task(
    window: tauri::WebviewWindow,
    tasks: tauri::State<'_, Tasks>,
    task_id: String,
    cancel: bool,
) -> Result<Value> {
    authorize(&window)?;
    if cancel {
        tasks.cancel(&task_id)
    } else {
        tasks.get(&task_id)
    }
}
#[tauri::command]
pub async fn local_operation(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalData>,
    operation_id: String,
) -> Result<Option<Value>> {
    authorize(&window)?;
    run(state.inner().clone(), move |store| {
        Ok(store
            .operation(&operation_id)?
            .map(|revision| json!({"revision":revision})))
    })
    .await
}
#[tauri::command]
pub async fn local_checkpoint(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalData>,
) -> Result<Value> {
    authorize(&window)?;
    run(state.inner().clone(), |store| {
        let snapshot = store.checkpoint()?;
        let name = snapshot
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| Error::new("storage_unavailable"))?;
        Ok(json!({"snapshotId":name}))
    })
    .await
}

#[tauri::command]
pub async fn local_migrate(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalData>,
    snapshot: Value,
) -> Result<Value> {
    authorize(&window)?;
    run(state.inner().clone(), move |store| {
        Ok(json!({"revision":store.migrate(&snapshot)?,"credentials":"pending"}))
    })
    .await
}
#[tauri::command]
pub async fn local_replace(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalData>,
    services: tauri::State<'_, Arc<crate::services::Services>>,
    harness: tauri::State<'_, Arc<crate::harness::Harness>>,
    snapshot: Value,
    operation_id: String,
    expected_revision: i64,
) -> Result<Value> {
    authorize(&window)?;
    let execution = harness.inner().clone();
    let restore_guard = tauri::async_runtime::spawn_blocking(move || execution.begin_restore())
        .await
        .map_err(|_| Error::new("harness_unavailable"))??;
    services.invalidate()?;
    run(state.inner().clone(), move |store| {
        let _restore_guard = restore_guard;
        Ok(json!({"revision":store.replace(&operation_id,expected_revision,&snapshot)?}))
    })
    .await
}

#[tauri::command]
pub async fn local_file(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LocalFiles>,
    request: FileRequest,
) -> Result<Value> {
    authorize(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = state
            .0
            .lock()
            .map_err(|_| Error::new("storage_unavailable"))?;
        match request {
            FileRequest::ChooseImport => {
                let path = rfd::FileDialog::new()
                    .set_title("选择题库、文档或备份")
                    .pick_file();
                match path {
                    Some(path) => Ok(serde_json::to_value(files.authorize(&path, false)?)?),
                    None => Ok(Value::Null),
                }
            }
            FileRequest::ChooseExport { name } => {
                if name.is_empty()
                    || name.len() > 180
                    || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
                {
                    return Err(Error::new("invalid_input"));
                }
                let path = rfd::FileDialog::new()
                    .set_title("保存导出文件")
                    .set_file_name(name)
                    .save_file();
                match path {
                    Some(path) => Ok(serde_json::to_value(files.authorize(&path, true)?)?),
                    None => Ok(Value::Null),
                }
            }
            FileRequest::Read { token, offset } => Ok(json!(files.read(&token, offset)?)),
            FileRequest::Append {
                token,
                offset,
                bytes,
            } => {
                files.append(&token, offset, &bytes)?;
                Ok(Value::Null)
            }
            FileRequest::Finish { token, size } => {
                files.finish(&token, size)?;
                Ok(Value::Null)
            }
            FileRequest::Release { token } => {
                files.release(&token)?;
                Ok(Value::Null)
            }
        }
    })
    .await
    .map_err(|_| Error::new("storage_unavailable"))?
}

#[cfg(test)]
mod authorization_tests {
    use super::*;

    fn check(label: &str, source: &str) -> Result<()> {
        authorize_source(label, &url::Url::parse(source).unwrap())
    }

    #[test]
    fn development_origins_require_debug_build() {
        for source in [
            "http://localhost:51736/",
            "http://127.0.0.1:51736/",
            "http://127.0.0.1:51736/index.html?test=1#dashboard",
        ] {
            assert_eq!(
                check("main", source).is_ok(),
                cfg!(debug_assertions),
                "{source}"
            );
        }
    }

    #[test]
    fn packaged_origins_remain_available() {
        for source in [
            "tauri://localhost/",
            "http://tauri.localhost/",
            "https://tauri.localhost/",
        ] {
            assert!(check("main", source).is_ok(), "{source}");
        }
    }

    #[test]
    fn other_windows_cannot_call_native_commands() {
        for label in ["", "secondary", "MAIN"] {
            for source in [
                "tauri://localhost/",
                "http://tauri.localhost/",
                "http://localhost:51736/",
                "http://127.0.0.1:51736/",
            ] {
                assert_eq!(
                    check(label, source).unwrap_err().code,
                    "permission_denied",
                    "{label}: {source}"
                );
            }
        }
    }

    #[test]
    fn unapproved_origins_are_denied() {
        for source in [
            "http://127.0.0.1/",
            "http://localhost/",
            "http://127.0.0.1:51737/",
            "http://localhost:51737/",
            "https://127.0.0.1:51736/",
            "https://localhost:51736/",
            "http://127.0.0.2:51736/",
            "http://[::1]:51736/",
            "http://192.168.1.2:51736/",
            "http://example.com:51736/",
            "http://localhost.example.com:51736/",
            "http://127.0.0.1.example.com:51736/",
            "http://tauri.localhost:51736/",
            "tauri://localhost:51736/",
            "tauri://127.0.0.1/",
            "file:///index.html",
            "data:text/html,test",
        ] {
            assert_eq!(
                check("main", source).unwrap_err().code,
                "permission_denied",
                "{source}"
            );
        }
    }
}
