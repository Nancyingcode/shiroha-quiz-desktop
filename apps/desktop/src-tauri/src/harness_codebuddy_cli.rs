use crate::error::{Error, Result};
use crate::harness_codebuddy_store::SavedSession;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::Read;
use std::path::{Path, PathBuf};

const AUTH_FILE: &str = "Tencent-Cloud.coding-copilot.info";
const MAX_AUTH_BYTES: u64 = 128 * 1024;

pub(super) struct Source {
    file: PathBuf,
}

pub(super) struct Snapshot {
    pub(super) session: SavedSession,
    pub(super) fingerprint: [u8; 32],
}

impl Source {
    pub(super) fn open(root: &Path) -> Result<Self> {
        #[cfg(any(test, feature = "native-test"))]
        {
            Ok(Self {
                file: root.join("codebuddy-cli-fixture").join(AUTH_FILE),
            })
        }
        #[cfg(not(any(test, feature = "native-test")))]
        {
            let _ = root;
            let custom_product = [
                "ACC_PRODUCT_CONFIG_PATH",
                "ACC_PRODUCT_CONFIG_V3",
                "ACC_PRODUCT_CONFIG_V2",
                "WORKBUDDY_AT_REST_ENCRYPTION",
            ]
            .iter()
            .any(|key| std::env::var_os(key).is_some_and(|value| !value.is_empty()));
            if custom_product {
                return Err(Error::new("codebuddy_cli_unsupported"));
            }
            let profile = std::env::var_os("USERPROFILE").ok_or_else(unavailable)?;
            let profile = PathBuf::from(profile);
            if !profile.is_absolute() || profile.to_string_lossy().starts_with(r"\\") {
                return Err(unavailable());
            }
            Ok(Self {
                file: profile
                    .join("AppData/Local/CodeBuddyExtension/Data/Public/auth")
                    .join(AUTH_FILE),
            })
        }
    }

    pub(super) fn read(&self) -> Result<Option<Snapshot>> {
        if self.logged_out()? {
            return Ok(None);
        }
        let Some(bytes) = read_bytes(&self.file)? else {
            return Ok(None);
        };
        let session = parse(&bytes)?;
        if self.logged_out()? {
            return Ok(None);
        }
        let stable = read_bytes(&self.file)?.is_some_and(|current| current == bytes);
        if !stable || self.logged_out()? {
            return Err(Error::new("codebuddy_cli_changed"));
        }
        Ok(Some(Snapshot {
            session,
            fingerprint: Sha256::digest(&bytes).into(),
        }))
    }

    fn logged_out(&self) -> Result<bool> {
        let marker = self.file.with_extension("info.logged-out");
        crate::paths::reject_links(&marker).map_err(|_| unavailable())?;
        match std::fs::symlink_metadata(marker) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err(unavailable()),
        }
    }
}

fn unavailable() -> Error {
    Error::new("codebuddy_cli_unavailable")
}
fn invalid() -> Error {
    Error::new("codebuddy_cli_invalid")
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>> {
    crate::paths::reject_links(path).map_err(|_| unavailable())?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(unavailable()),
    };
    let metadata = file.metadata().map_err(|_| unavailable())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(unavailable());
        }
    }
    if !metadata.is_file() || metadata.len() > MAX_AUTH_BYTES {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    file.take(MAX_AUTH_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable())?;
    if bytes.len() as u64 > MAX_AUTH_BYTES {
        return Err(invalid());
    }
    crate::paths::reject_links(path).map_err(|_| unavailable())?;
    Ok(Some(bytes))
}

#[derive(Deserialize)]
struct Record {
    auth: Auth,
    account: Account,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Auth {
    access_token: serde_json::Value,
    expires_at: u64,
    domain: Option<String>,
    token_type: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    uid: String,
    #[serde(rename = "type")]
    kind: String,
    enterprise_id: Option<String>,
}

fn parse(bytes: &[u8]) -> Result<SavedSession> {
    let record: Record = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    if record.auth.access_token.get("$wbEncrypted").is_some() {
        return Err(Error::new("codebuddy_cli_protected"));
    }
    let token = record.auth.access_token.as_str().ok_or_else(invalid)?;
    let domain = match record.auth.domain.as_deref() {
        None | Some("") | Some("copilot.tencent.com") => "copilot.tencent.com",
        Some("www.codebuddy.cn") => "www.codebuddy.cn",
        _ => return Err(Error::new("codebuddy_cli_unsupported")),
    };
    if record.auth.token_type != "Bearer" {
        return Err(Error::new("codebuddy_cli_unsupported"));
    }
    if record.account.kind != "personal"
        || record
            .account
            .enterprise_id
            .as_deref()
            .is_some_and(|id| !id.is_empty())
    {
        return Err(Error::new("codebuddy_auth_personal_required"));
    }
    let session = SavedSession {
        access_token: token.to_owned(),
        uid: record.account.uid,
        // CLI 允许省略 domain；仍须由现有固定国内账户接口核验，不能据此直接执行。
        domain: domain.to_owned(),
        expires_at_ms: record.auth.expires_at,
        saved_at_ms: crate::harness_codebuddy_store::now_ms()?,
    };
    session.validate().map_err(|error| {
        if error.code == "codebuddy_auth_expired" {
            error
        } else {
            invalid()
        }
    })?;
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::fs;

    struct Fixture {
        root: PathBuf,
        source: Source,
    }

    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("shiroha-cli-auth-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            let source = Source {
                file: root.join(AUTH_FILE),
            };
            Self { root, source }
        }

        fn write(&self, value: &Value) {
            fs::write(&self.source.file, serde_json::to_vec(value).unwrap()).unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    fn session() -> Value {
        json!({"auth":{"accessToken":"synthetic-memory-session","tokenType":"Bearer","domain":"copilot.tencent.com","expiresAt":crate::harness_codebuddy_store::now_ms().unwrap()+60_000},"account":{"uid":"synthetic-user","type":"personal"}})
    }

    #[test]
    fn reads_cli_account_without_rewriting_or_copying_credentials() {
        let f = Fixture::new();
        f.write(&session());
        let before = fs::read(&f.source.file).unwrap();
        let snapshot = f.source.read().unwrap().unwrap();
        assert_eq!(snapshot.session.uid, "synthetic-user");
        assert_eq!(snapshot.session.access_token, "synthetic-memory-session");
        assert_eq!(fs::read(&f.source.file).unwrap(), before);
        assert_eq!(fs::read_dir(&f.root).unwrap().count(), 1);
    }

    #[test]
    fn logout_marker_overrides_a_still_present_account() {
        let f = Fixture::new();
        f.write(&session());
        fs::write(
            f.source.file.with_extension("info.logged-out"),
            "synthetic-logout",
        )
        .unwrap();
        assert!(f.source.read().unwrap().is_none());
    }

    #[test]
    fn missing_account_does_not_create_a_directory_or_file() {
        let f = Fixture::new();
        assert!(f.source.read().unwrap().is_none());
        assert_eq!(fs::read_dir(&f.root).unwrap().count(), 0);
    }

    #[test]
    fn rejects_protected_managed_credentials_without_exposing_the_envelope() {
        let f = Fixture::new();
        let mut value = session();
        value["auth"]["accessToken"] =
            json!({"$wbEncrypted":1,"envelope":"synthetic-encrypted-value"});
        f.write(&value);
        assert_eq!(
            f.source.read().err().unwrap().code,
            "codebuddy_cli_protected"
        );
    }

    #[test]
    fn rejects_expired_api_key_foreign_and_enterprise_accounts() {
        let f = Fixture::new();
        for (field, value, code) in [
            ("expiry", json!(1), "codebuddy_auth_expired"),
            ("tokenType", json!("ApiKey"), "codebuddy_cli_unsupported"),
            (
                "domain",
                json!("www.codebuddy.ai"),
                "codebuddy_cli_unsupported",
            ),
            (
                "type",
                json!("enterprise"),
                "codebuddy_auth_personal_required",
            ),
        ] {
            let mut data = session();
            match field {
                "expiry" => data["auth"]["expiresAt"] = value,
                "type" => data["account"]["type"] = value,
                _ => data["auth"][field] = value,
            }
            f.write(&data);
            assert_eq!(f.source.read().err().unwrap().code, code, "{field}");
        }
    }

    #[test]
    fn rejects_truncated_oversized_and_invalid_fields() {
        let f = Fixture::new();
        fs::write(&f.source.file, "{").unwrap();
        assert_eq!(f.source.read().err().unwrap().code, "codebuddy_cli_invalid");
        fs::write(&f.source.file, vec![b' '; MAX_AUTH_BYTES as usize + 1]).unwrap();
        assert_eq!(f.source.read().err().unwrap().code, "codebuddy_cli_invalid");
        for value in [json!(null), json!(""), json!("bad\r\nsecret")] {
            let mut data = session();
            data["auth"]["accessToken"] = value;
            f.write(&data);
            assert_eq!(f.source.read().err().unwrap().code, "codebuddy_cli_invalid");
        }
    }

    #[test]
    fn fingerprint_changes_when_the_cli_rotates_the_token() {
        let f = Fixture::new();
        let mut value = session();
        f.write(&value);
        let before = f.source.read().unwrap().unwrap().fingerprint;
        value["auth"]["accessToken"] = json!("synthetic-rotated-session");
        f.write(&value);
        assert_ne!(f.source.read().unwrap().unwrap().fingerprint, before);
    }

    #[test]
    fn optional_cli_domain_uses_the_fixed_domestic_verification_context() {
        let f = Fixture::new();
        for domain in [serde_json::Value::Null, json!("")] {
            let mut value = session();
            value["auth"]["domain"] = domain;
            f.write(&value);
            assert_eq!(
                f.source.read().unwrap().unwrap().session.domain,
                "copilot.tencent.com"
            );
        }
    }
}
