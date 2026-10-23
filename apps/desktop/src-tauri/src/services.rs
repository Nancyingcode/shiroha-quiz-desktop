use crate::{
    commands::authorize,
    credentials::{Credentials, SecretInput},
    error::{Error, Result},
    network::{DavOperation, Network, OutboundPolicy, Response},
    service_config::{Service, ServiceConfig},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

// 服务上下文与主进程同寿命；请求结束移除取消句柄，秘密不进入 Tasks 的可序列化状态。
pub struct Services {
    root: std::path::PathBuf,
    vault: Mutex<Result<Credentials>>,
    coordination: Mutex<()>,
    network: Network,
    running: Mutex<HashMap<String, watch::Sender<bool>>>,
}
impl Services {
    pub fn open(root: &Path) -> Result<Self> {
        let prepare = || -> Result<()> {
            crate::paths::reject_links(root)?;
            std::fs::create_dir_all(root)?;
            Ok(())
        };
        #[cfg(feature = "native-test")]
        let vault = prepare().and_then(|()| {
            Credentials::open(
                root,
                Arc::new(Mutex::new(crate::credentials::FakeProvider::default())),
            )
        });
        #[cfg(not(feature = "native-test"))]
        let vault =
            prepare().and_then(|()| Credentials::open(root, crate::credentials::WindowsProvider));
        let policy = if cfg!(feature = "native-test") {
            let file = root.join("network-mock-origin");
            crate::paths::reject_links(&file)?;
            if file.exists() {
                let text = std::fs::read_to_string(file)?;
                let origin =
                    url::Url::parse(text.trim()).map_err(|_| Error::new("network_denied"))?;
                if origin.scheme() != "http"
                    || !matches!(origin.host(),Some(url::Host::Ipv4(ip)) if ip.is_loopback())
                    || origin.port().is_none()
                    || origin.path() != "/"
                    || origin.query().is_some()
                    || origin.fragment().is_some()
                    || !origin.username().is_empty()
                    || origin.password().is_some()
                {
                    return Err(Error::new("network_denied"));
                }
                OutboundPolicy::MockOrigin(origin.origin().ascii_serialization())
            } else {
                OutboundPolicy::Deny
            }
        } else {
            OutboundPolicy::Configured
        };
        Ok(Self {
            root: root.to_owned(),
            vault: Mutex::new(vault),
            coordination: Mutex::new(()),
            network: Network::new(policy)?,
            running: Mutex::new(HashMap::new()),
        })
    }
    fn with_vault<T>(&self, action: impl FnOnce(&mut Credentials) -> Result<T>) -> Result<T> {
        let mut vault = self
            .vault
            .lock()
            .map_err(|_| Error::new("credential_unavailable"))?;
        let marker = self.root.join("credentials-revoked");
        crate::paths::reject_links(&marker)?;
        if marker.exists() {
            vault
                .as_mut()
                .map_err(|_| Error::new("credential_unavailable"))?
                .invalidate()?;
            std::fs::remove_file(&marker)?;
        }
        action(
            vault
                .as_mut()
                .map_err(|_| Error::new("credential_unavailable"))?,
        )
    }
    pub fn invalidate(&self) -> Result<()> {
        let _guard = self
            .coordination
            .lock()
            .map_err(|_| Error::new("network_unavailable"))?;
        self.cancel_all()?;
        // sidecar 损坏不能阻断题库修复；先持久记录撤销，服务修复前继续拒绝凭据访问。
        let marker = self.root.join("credentials-revoked");
        crate::paths::reject_links(&marker)?;
        {
            use std::io::Write;
            let mut file = std::fs::File::create(&marker)?;
            file.write_all(b"revoked")?;
            file.sync_all()?;
        }
        match self.with_vault(|_| Ok(())) {
            Ok(()) => Ok(()),
            Err(error) if error.code == "credential_unavailable" => Ok(()),
            Err(error) => Err(error),
        }
    }
    fn cancel_all(&self) -> Result<()> {
        for sender in self
            .running
            .lock()
            .map_err(|_| Error::new("network_unavailable"))?
            .values()
        {
            let _ = sender.send(true);
        }
        Ok(())
    }
    pub fn busy(&self) -> bool {
        self.running
            .lock()
            .map(|requests| !requests.is_empty())
            .unwrap_or(true)
    }
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CredentialCommand {
    Status {
        config: ServiceConfig,
    },
    Stage {
        config: ServiceConfig,
        input: SecretInput,
        remember: bool,
    },
    Migrate {
        config: ServiceConfig,
        secret: String,
        remember: bool,
    },
    Commit {
        id: String,
    },
    Rollback {
        id: String,
    },
    Invalidate,
    Reconcile,
    CancelAll,
    Cancel {
        request_id: String,
    },
}
fn name(service: Service) -> &'static str {
    match service {
        Service::Ai => "ai",
        Service::Webdav => "webdav",
    }
}

#[tauri::command]
pub async fn service_credential(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<Services>>,
    data: tauri::State<'_, crate::commands::LocalData>,
    request: CredentialCommand,
) -> Result<Value> {
    authorize(&window)?;
    if let CredentialCommand::Migrate {
        config, remember, ..
    } = &request
    {
        let submitted = config.normalize()?.binding();
        let service = config.service;
        let remember = *remember;
        crate::commands::run(data.inner().clone(), move |store| {
            if !store.has_legacy_migration()? {
                return Err(Error::new("migration_required"));
            }
            let snapshot = store
                .summary()?
                .ok_or_else(|| Error::new("migration_required"))?;
            let current = match service {
                Service::Ai => &snapshot["settings"]["aiImportV99"],
                Service::Webdav => &snapshot["serviceConfigurations"]["webdav"],
            };
            let remember_field = if service == Service::Ai {
                "rememberKey"
            } else {
                "rememberPassword"
            };
            if current[remember_field].as_bool().unwrap_or(false) != remember {
                return Err(Error::new("binding_required"));
            }
            let current = ServiceConfig {
                service,
                endpoint: current["endpoint"].as_str().unwrap_or("").into(),
                username: current["username"].as_str().unwrap_or("").into(),
                remote_dir: if service == Service::Webdav {
                    current["remoteDir"]
                        .as_str()
                        .unwrap_or("ShirohaQuiz/Web")
                        .into()
                } else {
                    String::new()
                },
            };
            if current.normalize()?.binding() != submitted {
                return Err(Error::new("binding_required"));
            }
            Ok(())
        })
        .await?;
    }
    if matches!(request, CredentialCommand::Reconcile) {
        let pending = state.with_vault(|vault| vault.pending())?;
        for (id, phase) in pending {
            let operation = format!("credential-{id}");
            let committed = crate::commands::run(data.inner().clone(), move |store| {
                Ok(store.operation(&operation)?.is_some())
            })
            .await?;
            state.with_vault(|vault| {
                if committed || phase == "committed" {
                    vault.commit(&id)
                } else {
                    vault.rollback(&id)
                }
            })?;
        }
        return Ok(Value::Null);
    }
    if let CredentialCommand::Commit { id } = &request {
        let operation = format!("credential-{id}");
        if !crate::commands::run(data.inner().clone(), move |store| {
            Ok(store.operation(&operation)?.is_some())
        })
        .await?
        {
            return Err(Error::new("configuration_not_committed"));
        }
    }
    match request {
        CredentialCommand::CancelAll => {
            state.cancel_all()?;
            Ok(Value::Null)
        }
        CredentialCommand::Reconcile => Ok(Value::Null),
        CredentialCommand::Cancel { request_id } => {
            let requests = state
                .running
                .lock()
                .map_err(|_| Error::new("network_unavailable"))?;
            let accepted = requests
                .get(&request_id)
                .is_some_and(|sender| sender.send(true).is_ok());
            Ok(json!({"accepted":accepted}))
        }
        CredentialCommand::Invalidate => {
            state.invalidate()?;
            Ok(Value::Null)
        }
        CredentialCommand::Stage {
            config,
            input,
            remember,
        } => {
            let _guard = state
                .coordination
                .lock()
                .map_err(|_| Error::new("network_unavailable"))?;
            state.cancel_all()?;
            let config = config.normalize()?;
            let id = state.with_vault(|vault| {
                vault.stage(name(config.service), &config.binding(), input, remember)
            })?;
            Ok(json!({"id":id}))
        }
        CredentialCommand::Migrate {
            config,
            secret,
            remember,
        } => {
            let config = config.normalize()?;
            state.with_vault(|vault| {
                vault.migrate(name(config.service), &config.binding(), secret, remember)
            })?;
            Ok(json!({"allowCleanup":true}))
        }
        CredentialCommand::Status { config } => {
            let config = config.normalize()?;
            let status =
                state.with_vault(|vault| vault.status(name(config.service), &config.binding()))?;
            Ok(json!({"state":status}))
        }
        CredentialCommand::Commit { id } => {
            state.with_vault(|vault| vault.commit(&id))?;
            Ok(json!({"state":"committed"}))
        }
        CredentialCommand::Rollback { id } => {
            state.with_vault(|vault| vault.rollback(&id))?;
            Ok(Value::Null)
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NetworkCommand {
    Ai { payload: Value },
    Webdav { operation: DavOperation },
}

#[tauri::command]
pub async fn service_request(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<Services>>,
    request_id: String,
    config: ServiceConfig,
    secret: Option<String>,
    request: NetworkCommand,
) -> Result<Response> {
    authorize(&window)?;
    if request_id.is_empty() || request_id.len() > 128 {
        return Err(Error::new("invalid_input"));
    }
    let config = config.normalize()?;
    let (secret, mut cancellation) = {
        let _guard = state
            .coordination
            .lock()
            .map_err(|_| Error::new("network_unavailable"))?;
        let secret = match secret {
            Some(value) => {
                if value.len() > 2560 || value.contains(['\r', '\n', '\0']) {
                    return Err(Error::new("invalid_input"));
                }
                value
            }
            None => {
                state.with_vault(|vault| vault.secret(name(config.service), &config.binding()))?
            }
        };
        let (sender, cancellation) = watch::channel(false);
        {
            let mut requests = state
                .running
                .lock()
                .map_err(|_| Error::new("network_unavailable"))?;
            if requests.contains_key(&request_id) {
                return Err(Error::new("duplicate_operation"));
            }
            requests.insert(request_id.clone(), sender);
        }
        (secret, cancellation)
    };
    let uploading = matches!(
        &request,
        NetworkCommand::Webdav {
            operation: DavOperation::Upload { .. }
        }
    );
    let execute = async {
        match request {
            NetworkCommand::Ai { payload } => state.network.ai(&config, &secret, payload).await,
            NetworkCommand::Webdav { operation } => {
                state.network.webdav(&config, &secret, operation).await
            }
        }
    };
    let result = tokio::select! {biased;_=cancellation.changed()=>Err(Error::new(if uploading{"result_unknown"}else{"cancelled"})),result=execute=>result};
    state
        .running
        .lock()
        .map_err(|_| Error::new("network_unavailable"))?
        .remove(&request_id);
    if *cancellation.borrow() {
        Err(Error::new(if uploading {
            "result_unknown"
        } else {
            "cancelled"
        }))
    } else {
        result
    }
}
