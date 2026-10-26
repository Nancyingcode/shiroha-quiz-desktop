use crate::error::Result;
use crate::harness::failure;
use crate::harness_proxy::SystemProxy;
use crate::paths::reject_links;
use sha2::{Digest, Sha256};
use std::fs::{self, File, Metadata, OpenOptions, TryLockError};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use url::Url;

pub(crate) const VERSION: &str = "0.163.0";
pub(crate) const EXECUTABLE_BYTES: u64 = 341_270_320;
pub(crate) const EXECUTABLE_SHA256: &str =
    "2692c8c7bb2cf8b0aefe638741fc90236f4b824c59578ce84994f9de58200993";
pub(crate) const EXECUTABLE_URL: &str = "https://github.com/openai/codex/releases/download/rust-v0.163.0/codex-x86_64-pc-windows-msvc.exe";
const PREPARE_TIMEOUT: Duration = Duration::from_secs(300);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const CANCEL_POLL: Duration = Duration::from_millis(100);
const MAX_REDIRECTS: usize = 3;
const FILE_BUFFER_BYTES: usize = 64 * 1024;
const LICENSE_FILES: &[(&str, &[u8])] = &[
    ("LICENSE", include_bytes!("../../third-party/codex/LICENSE")),
    ("NOTICE", include_bytes!("../../third-party/codex/NOTICE")),
    (
        "README.md",
        include_bytes!("../../third-party/codex/README.md"),
    ),
];

#[cfg(windows)]
const FILE_LIST_DIRECTORY: u32 = 1;
#[cfg(windows)]
const FILE_SHARE_READ: u32 = 1;
#[cfg(windows)]
const FILE_SHARE_WRITE: u32 = 2;
#[cfg(windows)]
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
#[cfg(windows)]
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

struct Manifest {
    url: String,
    bytes: u64,
    sha256: String,
}

#[derive(Clone, Copy)]
pub(crate) enum Component {
    Codex,
    CodeBuddy,
}

impl Component {
    fn managed_path(self, root: &Path) -> PathBuf {
        match self {
            Self::Codex => root
                .join("runtime")
                .join("codex")
                .join(VERSION)
                .join("codex.exe"),
            Self::CodeBuddy => crate::harness_codebuddy_runtime::managed_path(root),
        }
    }

    fn executable_name(self) -> &'static str {
        match self {
            Self::Codex => "codex.exe",
            Self::CodeBuddy => "codebuddy.exe",
        }
    }

    fn licenses(self) -> &'static [(&'static str, &'static [u8])] {
        match self {
            Self::Codex => LICENSE_FILES,
            Self::CodeBuddy => crate::harness_codebuddy_runtime::LICENSE_FILES,
        }
    }

    fn user_agent(self) -> &'static str {
        match self {
            Self::Codex => "Shiroha-Quiz-Codex-Runtime",
            Self::CodeBuddy => "Shiroha-Quiz-CodeBuddy-Runtime",
        }
    }
}

struct Preparation<'a> {
    component: Component,
    download: &'a Manifest,
    executable: &'a Manifest,
    policy: &'a Policy,
}

pub(crate) async fn prepare_component(
    root: &Path,
    cancel: &AtomicBool,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
    component: Component,
) -> Result<PathBuf> {
    use crate::harness_codebuddy_runtime as codebuddy;
    let (download, executable, policy) = match component {
        Component::Codex => (
            Manifest {
                url: EXECUTABLE_URL.into(),
                bytes: EXECUTABLE_BYTES,
                sha256: EXECUTABLE_SHA256.into(),
            },
            Manifest {
                url: String::new(),
                bytes: EXECUTABLE_BYTES,
                sha256: EXECUTABLE_SHA256.into(),
            },
            Policy::Official,
        ),
        Component::CodeBuddy => (
            Manifest {
                url: codebuddy::ARCHIVE_URL.into(),
                bytes: codebuddy::ARCHIVE_BYTES,
                sha256: codebuddy::ARCHIVE_SHA256.into(),
            },
            Manifest {
                url: String::new(),
                bytes: codebuddy::EXECUTABLE_BYTES,
                sha256: codebuddy::EXECUTABLE_SHA256.into(),
            },
            Policy::CodeBuddy,
        ),
    };
    prepare_component_with(
        root,
        cancel,
        progress,
        &Preparation {
            component,
            download: &download,
            executable: &executable,
            policy: &policy,
        },
        PREPARE_TIMEOUT,
    )
    .await
}

async fn prepare_component_with(
    root: &Path,
    cancel: &AtomicBool,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
    preparation: &Preparation<'_>,
    timeout: Duration,
) -> Result<PathBuf> {
    // 取消和总时限覆盖等待响应、响应正文和本地校验；丢弃任务时临时文件 guard 同步回收。
    tokio::select! {
        biased;
        _ = cancellation(cancel) => Err(failure("cancelled")),
        _ = tokio::time::sleep(timeout) => Err(failure("timeout")),
        result = prepare_inner(root, cancel, progress, preparation) => result,
    }
}

enum Policy {
    Official,
    CodeBuddy,
    #[cfg(test)]
    MockOrigin(String),
    #[cfg(test)]
    MockProxy {
        origin: String,
        proxy: SystemProxy,
    },
}

#[cfg(test)]
fn managed_path(root: &Path) -> PathBuf {
    Component::Codex.managed_path(root)
}

pub(crate) async fn prepare(
    root: &Path,
    cancel: &AtomicBool,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> Result<PathBuf> {
    prepare_component(root, cancel, progress, Component::Codex).await
}

#[cfg(test)]
async fn prepare_with(
    root: &Path,
    cancel: &AtomicBool,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
    manifest: &Manifest,
    policy: &Policy,
    timeout: Duration,
) -> Result<PathBuf> {
    prepare_component_with(
        root,
        cancel,
        progress,
        &Preparation {
            component: Component::Codex,
            download: manifest,
            executable: manifest,
            policy,
        },
        timeout,
    )
    .await
}

fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Acquire) {
        Err(failure("cancelled"))
    } else {
        Ok(())
    }
}

async fn cancellation(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Acquire) {
        tokio::time::sleep(CANCEL_POLL).await;
    }
}

fn storage_error(_: std::io::Error) -> crate::error::Error {
    failure("harness_runtime_storage")
}

fn validate_target(target: &Url, policy: &Policy) -> Result<()> {
    let permitted = match policy {
        Policy::Official => {
            target.scheme() == "https"
                && matches!(
                    target.host_str(),
                    Some("github.com" | "release-assets.githubusercontent.com")
                )
                && target.port_or_known_default() == Some(443)
        }
        Policy::CodeBuddy => {
            target.scheme() == "https"
                && target.host_str() == Some("acc-1258344699.cos.accelerate.myqcloud.com")
                && target.port_or_known_default() == Some(443)
                && target.path() == "/@tencent-ai/codebuddy-code/releases/download/2.175.0/codebuddy-code_Windows_x86_64.zip"
                && target.query().is_none()
        }
        #[cfg(test)]
        Policy::MockOrigin(origin) | Policy::MockProxy { origin, .. } => {
            target.scheme() == "http"
                && target.host_str() == Some("127.0.0.1")
                && target.origin().ascii_serialization() == *origin
        }
    };
    if permitted
        && target.username().is_empty()
        && target.password().is_none()
        && target.fragment().is_none()
    {
        Ok(())
    } else {
        Err(failure("harness_runtime_redirect"))
    }
}

fn ordinary_metadata(metadata: &Metadata) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(failure("harness_runtime_storage"));
        }
    }
    if metadata.is_symlink() {
        return Err(failure("harness_runtime_storage"));
    }
    Ok(())
}

fn pin_directory(path: &Path) -> Result<File> {
    reject_links(path).map_err(storage_error)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // 目录读访问参与 Windows 共享冲突判断；只读属性的句柄不能阻止重命名。
        options
            .access_mode(FILE_LIST_DIRECTORY)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let directory = options.open(path).map_err(storage_error)?;
    let metadata = directory.metadata().map_err(storage_error)?;
    ordinary_metadata(&metadata)?;
    if !metadata.is_dir() {
        return Err(failure("harness_runtime_storage"));
    }
    Ok(directory)
}

#[cfg(test)]
fn install_directory(
    root: &Path,
    before_canonicalize: Option<&dyn Fn()>,
) -> Result<(PathBuf, Vec<File>)> {
    install_component_directory(root, Component::Codex, before_canonicalize)
}

fn install_component_directory(
    root: &Path,
    component: Component,
    #[cfg(test)] before_canonicalize: Option<&dyn Fn()>,
) -> Result<(PathBuf, Vec<File>)> {
    if !root.is_absolute()
        || root
            .components()
            .any(|part| part == std::path::Component::ParentDir)
    {
        return Err(failure("harness_runtime_storage"));
    }
    reject_links(root).map_err(storage_error)?;
    let mut protected = Vec::new();
    // 先固定原始路径的父目录再打开子目录，避免规范化期间被 junction 换成另一处边界。
    let ancestors: Vec<_> = root.ancestors().collect();
    for ancestor in ancestors.into_iter().rev() {
        protected.push(pin_directory(ancestor)?);
    }
    #[cfg(test)]
    if let Some(before_canonicalize) = before_canonicalize {
        before_canonicalize();
    }
    let canonical_root = fs::canonicalize(root).map_err(storage_error)?;
    let mut directory = canonical_root.clone();
    let target = component.managed_path(&canonical_root);
    let relative = target
        .parent()
        .and_then(|parent| parent.strip_prefix(&canonical_root).ok())
        .ok_or_else(|| failure("harness_runtime_storage"))?;
    for part in relative {
        directory.push(part);
        reject_links(&directory).map_err(storage_error)?;
        match fs::create_dir(&directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(storage_error(error)),
        }
        protected.push(pin_directory(&directory)?);
    }
    let canonical = fs::canonicalize(&directory).map_err(storage_error)?;
    if canonical != directory || !canonical.starts_with(canonical_root) {
        return Err(failure("harness_runtime_storage"));
    }
    Ok((canonical, protected))
}

fn preparation_lock(directory: &Path) -> Result<File> {
    let path = directory.join("prepare.lock");
    reject_links(&path).map_err(storage_error)?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let lock = options.open(&path).map_err(storage_error)?;
    let metadata = lock.metadata().map_err(storage_error)?;
    ordinary_metadata(&metadata)?;
    if !metadata.is_file() {
        return Err(failure("harness_runtime_storage"));
    }
    lock.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => failure("harness_runtime_busy"),
        TryLockError::Error(error) => storage_error(error),
    })?;
    Ok(lock)
}

fn open_read_locked(path: &Path) -> Result<Option<File>> {
    reject_links(path).map_err(storage_error)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // 校验期间拒绝其他写入和删除句柄，保证计算摘要的字节来自同一个不变文件。
        options
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(storage_error(error)),
    };
    let metadata = file.metadata().map_err(storage_error)?;
    ordinary_metadata(&metadata)?;
    if !metadata.is_file() {
        return Err(failure("harness_runtime_storage"));
    }
    Ok(Some(file))
}

async fn valid_cache(path: &Path, manifest: &Manifest, cancel: &AtomicBool) -> Result<bool> {
    let Some(mut file) = open_read_locked(path)? else {
        return Ok(false);
    };
    if file.metadata().map_err(storage_error)?.len() != manifest.bytes {
        return Ok(false);
    }
    let mut hash = Sha256::new();
    let mut buffer = [0; FILE_BUFFER_BYTES];
    let mut bytes = 0u64;
    loop {
        check_cancel(cancel)?;
        let count = file.read(&mut buffer).map_err(storage_error)?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > manifest.bytes {
            return Ok(false);
        }
        hash.update(&buffer[..count]);
        tokio::task::yield_now().await;
    }
    check_cancel(cancel)?;
    Ok(bytes == manifest.bytes && format!("{:x}", hash.finalize()) == manifest.sha256)
}

// 每个准备操作仅拥有自己创建的随机文件；失败、取消和 future 被丢弃都使用同一清理路径。
struct Pending {
    path: PathBuf,
    file: Option<File>,
}

impl Pending {
    fn new(directory: &Path) -> Result<Self> {
        let path = directory.join(format!("runtime-{}.pending", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options
                .share_mode(0)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        let file = options.open(&path).map_err(storage_error)?;
        Ok(Self {
            path,
            file: Some(file),
        })
    }

    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.file_mut()?.write_all(bytes).map_err(storage_error)
    }

    fn file_mut(&mut self) -> Result<&mut File> {
        self.file
            .as_mut()
            .ok_or_else(|| failure("harness_runtime_storage"))
    }

    fn install(mut self, target: &Path, cancel: &AtomicBool) -> Result<()> {
        check_cancel(cancel)?;
        let file = self
            .file
            .take()
            .ok_or_else(|| failure("harness_runtime_storage"))?;
        file.sync_all().map_err(storage_error)?;
        drop(file);
        reject_links(target).map_err(storage_error)?;
        reject_links(&self.path).map_err(storage_error)?;
        check_cancel(cancel)?;
        // 同目录替换保持原子性；从不提前删除旧文件，失败仍保留用户上次可用的组件。
        fs::rename(&self.path, target).map_err(storage_error)
    }
}

impl Drop for Pending {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.path);
    }
}

fn install_licenses(directory: &Path, cancel: &AtomicBool, component: Component) -> Result<()> {
    for (name, bytes) in component.licenses() {
        check_cancel(cancel)?;
        let target = directory.join(name);
        let matches = if let Some(mut existing) = open_read_locked(&target)? {
            if existing.metadata().map_err(storage_error)?.len() == bytes.len() as u64 {
                let mut current = Vec::with_capacity(bytes.len());
                existing.read_to_end(&mut current).map_err(storage_error)?;
                current == *bytes
            } else {
                false
            }
        } else {
            false
        };
        if !matches {
            let mut pending = Pending::new(directory)?;
            pending.write(bytes)?;
            pending.install(&target, cancel)?;
        }
    }
    Ok(())
}

fn download_client(proxy: SystemProxy) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        // 系统开关决定本次下载路由，启动器继承的代理环境变量不能覆盖用户选择。
        .no_proxy()
        .proxy(reqwest::Proxy::custom(move |url| proxy.for_url(url)))
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|_| failure("harness_runtime_download"))
}

async fn prepare_inner(
    root: &Path,
    cancel: &AtomicBool,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
    preparation: &Preparation<'_>,
) -> Result<PathBuf> {
    check_cancel(cancel)?;
    let (directory, _protected_directories) = install_component_directory(
        root,
        preparation.component,
        #[cfg(test)]
        None,
    )?;
    let _lock = preparation_lock(&directory)?;
    let target = directory.join(preparation.component.executable_name());
    install_licenses(&directory, cancel, preparation.component)?;
    let manifest = preparation.download;
    progress(0, manifest.bytes);
    if valid_cache(&target, preparation.executable, cancel).await? {
        progress(manifest.bytes, manifest.bytes);
        return Ok(target);
    }
    let mut pending = download(&directory, cancel, progress, preparation).await?;
    match preparation.component {
        Component::Codex => pending.install(&target, cancel)?,
        Component::CodeBuddy => {
            let mut executable = Pending::new(&directory)?;
            crate::harness_codebuddy_runtime::unpack_verified_zip(
                pending.file_mut()?,
                executable.file_mut()?,
                cancel,
            )
            .await?;
            executable.install(&target, cancel)?;
        }
    }
    progress(manifest.bytes, manifest.bytes);
    Ok(target)
}

async fn download(
    directory: &Path,
    cancel: &AtomicBool,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
    preparation: &Preparation<'_>,
) -> Result<Pending> {
    let manifest = preparation.download;
    let policy = preparation.policy;
    let proxy = match policy {
        Policy::Official | Policy::CodeBuddy => crate::harness_proxy::current()?,
        #[cfg(test)]
        Policy::MockOrigin(_) => SystemProxy::direct(),
        #[cfg(test)]
        Policy::MockProxy { proxy, .. } => proxy.clone(),
    };
    let client = download_client(proxy.clone())?;
    let mut url = Url::parse(&manifest.url).map_err(|_| failure("harness_runtime_redirect"))?;
    let mut redirects = 0;
    let (mut response, download_error) = loop {
        check_cancel(cancel)?;
        validate_target(&url, policy)?;
        let download_error = if proxy.for_url(&url).is_some() {
            "harness_runtime_proxy"
        } else {
            "harness_runtime_download"
        };
        let response = client
            .get(url.clone())
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .header(
                reqwest::header::USER_AGENT,
                preparation.component.user_agent(),
            )
            .send()
            .await
            .map_err(|_| failure(download_error))?;
        if response.status().is_redirection() {
            if redirects == MAX_REDIRECTS {
                return Err(failure("harness_runtime_redirect"));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| failure("harness_runtime_redirect"))?;
            url = url
                .join(location)
                .map_err(|_| failure("harness_runtime_redirect"))?;
            validate_target(&url, policy)?;
            redirects += 1;
            continue;
        }
        if response.status() != reqwest::StatusCode::OK {
            return Err(failure(download_error));
        }
        break (response, download_error);
    };
    if response
        .content_length()
        .is_some_and(|bytes| bytes != manifest.bytes)
    {
        return Err(failure("harness_runtime_integrity"));
    }
    let mut pending = Pending::new(directory)?;
    let mut hash = Sha256::new();
    let mut bytes = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| failure(download_error))?
    {
        check_cancel(cancel)?;
        bytes = bytes
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| failure("harness_runtime_integrity"))?;
        if bytes > manifest.bytes {
            return Err(failure("harness_runtime_integrity"));
        }
        for part in chunk.chunks(FILE_BUFFER_BYTES) {
            check_cancel(cancel)?;
            pending.write(part)?;
            hash.update(part);
            tokio::task::yield_now().await;
        }
        progress(bytes, manifest.bytes);
    }
    if bytes != manifest.bytes || format!("{:x}", hash.finalize()) != manifest.sha256 {
        return Err(failure("harness_runtime_integrity"));
    }
    check_cancel(cancel)?;
    Ok(pending)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs::{self, OpenOptions};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Instant;

    const BODY: &[u8] = b"isolated synthetic runtime: never execute";

    #[test]
    fn codebuddy_cache_and_lock_are_independent_of_codex() {
        let fixture = Fixture::new();
        let codex = fixture.write_cache(b"keep Codex runtime");
        let lock = preparation_lock(codex.parent().unwrap()).unwrap();
        let codebuddy = crate::harness_codebuddy_runtime::managed_path(&fixture.0);
        fs::create_dir_all(codebuddy.parent().unwrap()).unwrap();
        fs::write(&codebuddy, BODY).unwrap();
        let server = Server::new(|_| panic!("verified CodeBuddy cache must not download"));
        let manifest = server.manifest();
        let result = run(prepare_component_with(
            &fixture.0,
            &AtomicBool::new(false),
            &|_, _| {},
            &Preparation {
                component: Component::CodeBuddy,
                download: &manifest,
                executable: &manifest,
                policy: &Policy::MockOrigin(server.origin.clone()),
            },
            Duration::from_secs(5),
        ));
        drop(lock);
        let installed = result.unwrap();
        assert_eq!(
            fs::canonicalize(installed).unwrap(),
            fs::canonicalize(&codebuddy).unwrap()
        );
        for (name, expected) in crate::harness_codebuddy_runtime::LICENSE_FILES {
            assert_eq!(
                fs::read(codebuddy.parent().unwrap().join(name)).unwrap(),
                *expected
            );
        }
        assert!(!codebuddy.parent().unwrap().join("NOTICE").exists());
        assert_eq!(fs::read(codex).unwrap(), b"keep Codex runtime");
        assert_eq!(server.hits.load(Ordering::Acquire), 0);
    }

    #[test]
    fn codebuddy_archive_must_not_be_installed_as_an_executable() {
        let fixture = Fixture::new();
        let server = Server::new(|_| Reply::body(BODY));
        let archive = server.manifest();
        let executable = Manifest {
            url: String::new(),
            bytes: 100,
            sha256: "0".repeat(64),
        };
        let result = run(prepare_component_with(
            &fixture.0,
            &AtomicBool::new(false),
            &|_, _| {},
            &Preparation {
                component: Component::CodeBuddy,
                download: &archive,
                executable: &executable,
                policy: &Policy::MockOrigin(server.origin.clone()),
            },
            Duration::from_secs(5),
        ));
        assert_eq!(result.unwrap_err().code, "harness_runtime_integrity");
        assert!(!crate::harness_codebuddy_runtime::managed_path(&fixture.0).exists());
        assert!(!managed_path(&fixture.0).exists());
        assert!(fs::read_dir(
            crate::harness_codebuddy_runtime::managed_path(&fixture.0)
                .parent()
                .unwrap()
        )
        .unwrap()
        .all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".pending")));
    }

    #[test]
    fn codebuddy_download_policy_is_independent_and_fixed_to_the_reviewed_asset() {
        let url = crate::harness_codebuddy_runtime::ARCHIVE_URL;
        validate_target(&Url::parse(url).unwrap(), &Policy::CodeBuddy).unwrap();
        for invalid in [
            EXECUTABLE_URL.to_string(),
            url.replace("https://", "http://"),
            url.replace("https://", "https://user:password@"),
            url.replace("myqcloud.com/", "myqcloud.com:8443/"),
            url.replace("myqcloud.com/", "myqcloud.com.evil.invalid/"),
            url.replace("2.175.0", "latest"),
            format!("{url}?other=asset"),
            format!("{url}#fragment"),
        ] {
            assert_eq!(
                validate_target(&Url::parse(&invalid).unwrap(), &Policy::CodeBuddy)
                    .unwrap_err()
                    .code,
                "harness_runtime_redirect"
            );
        }
        assert!(validate_target(&Url::parse(url).unwrap(), &Policy::Official).is_err());
    }

    #[test]
    fn codebuddy_invalid_archive_preserves_both_existing_runtimes() {
        for bad_hash in [false, true] {
            let fixture = Fixture::new();
            let codex = fixture.write_cache(b"original Codex");
            let target = crate::harness_codebuddy_runtime::managed_path(&fixture.0);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(&target, b"original CodeBuddy").unwrap();
            let server = Server::new(|_| Reply::body(BODY));
            let mut archive = server.manifest();
            if bad_hash {
                archive.sha256 = "0".repeat(64);
            }
            let executable = Manifest {
                url: String::new(),
                bytes: 100,
                sha256: "0".repeat(64),
            };
            let error = run(prepare_component_with(
                &fixture.0,
                &AtomicBool::new(false),
                &|_, _| {},
                &Preparation {
                    component: Component::CodeBuddy,
                    download: &archive,
                    executable: &executable,
                    policy: &Policy::MockOrigin(server.origin.clone()),
                },
                Duration::from_secs(5),
            ))
            .unwrap_err();
            assert_eq!(error.code, "harness_runtime_integrity");
            assert_eq!(fs::read(codex).unwrap(), b"original Codex");
            assert_eq!(fs::read(&target).unwrap(), b"original CodeBuddy");
            assert!(fs::read_dir(target.parent().unwrap())
                .unwrap()
                .all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".pending")));
        }
    }

    #[test]
    fn codebuddy_cancelled_download_preserves_cache_and_cleans_its_pending_file() {
        let fixture = Fixture::new();
        let target = crate::harness_codebuddy_runtime::managed_path(&fixture.0);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"original CodeBuddy").unwrap();
        let server = Server::new(|_| Reply {
            status: 200,
            headers: format!("Content-Length: {}\r\n", BODY.len()),
            body: BODY[..3].into(),
            stall: true,
        });
        let cancel = AtomicBool::new(false);
        let progress = |received, _| {
            if received > 0 {
                cancel.store(true, Ordering::Release);
            }
        };
        let archive = server.manifest();
        let error = run(prepare_component_with(
            &fixture.0,
            &cancel,
            &progress,
            &Preparation {
                component: Component::CodeBuddy,
                download: &archive,
                executable: &archive,
                policy: &Policy::MockOrigin(server.origin.clone()),
            },
            Duration::from_secs(5),
        ))
        .unwrap_err();
        assert_eq!(error.code, "cancelled");
        assert_eq!(fs::read(&target).unwrap(), b"original CodeBuddy");
        assert!(fs::read_dir(target.parent().unwrap())
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".pending")));
    }

    #[test]
    fn configured_system_proxy_receives_download_and_origin_is_not_contacted() {
        let origin = Server::new(|_| Reply::body(BODY));
        let proxy = Server::new(|_| Reply::body(BODY));
        let settings = SystemProxy::from_test_settings(Some(&proxy.origin), None, None).unwrap();
        let fixture = Fixture::new();
        let path = run(prepare_with(
            &fixture.0,
            &AtomicBool::new(false),
            &|_, _| {},
            &origin.manifest(),
            &Policy::MockProxy {
                origin: origin.origin.clone(),
                proxy: settings,
            },
            Duration::from_secs(5),
        ))
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), BODY);
        assert_eq!(proxy.hits.load(Ordering::Acquire), 1);
        assert_eq!(origin.hits.load(Ordering::Acquire), 0);
        assert!(proxy.requests.lock().unwrap()[0]
            .starts_with(&format!("GET {}/runtime ", origin.origin)));
    }

    #[test]
    fn no_system_proxy_and_bypassed_targets_connect_directly() {
        let origin = Server::new(|_| Reply::body(BODY));
        let proxy = Server::new(|_| Reply::body(BODY));
        for settings in [
            SystemProxy::direct(),
            SystemProxy::from_test_settings(Some(&proxy.origin), Some("127.0.0.1"), None).unwrap(),
        ] {
            let client = download_client(settings).unwrap();
            let response = run(async {
                client
                    .get(format!("{}/runtime", origin.origin))
                    .send()
                    .await
                    .unwrap()
                    .bytes()
                    .await
                    .unwrap()
            });
            assert_eq!(response.as_ref(), BODY);
        }
        assert_eq!(origin.hits.load(Ordering::Acquire), 2);
        assert_eq!(proxy.hits.load(Ordering::Acquire), 0);
    }

    #[test]
    fn proxy_failure_never_falls_back_to_direct_download() {
        let origin = Server::new(|_| Reply::body(BODY));
        let proxy = Server::new(|_| Reply {
            status: 502,
            headers: "Content-Length: 0\r\n".into(),
            body: vec![],
            stall: false,
        });
        let settings = SystemProxy::from_test_settings(Some(&proxy.origin), None, None).unwrap();
        let fixture = Fixture::new();
        let cache = fixture.write_cache(b"previous component remains");
        let error = run(prepare_with(
            &fixture.0,
            &AtomicBool::new(false),
            &|_, _| {},
            &origin.manifest(),
            &Policy::MockProxy {
                origin: origin.origin.clone(),
                proxy: settings,
            },
            Duration::from_secs(5),
        ))
        .unwrap_err();
        assert_eq!(error.code, "harness_runtime_proxy");
        assert_eq!(fs::read(cache).unwrap(), b"previous component remains");
        fixture.assert_no_pending();
        assert_eq!(origin.hits.load(Ordering::Acquire), 0);
        assert_eq!(proxy.hits.load(Ordering::Acquire), 1);
    }

    #[test]
    fn https_download_uses_proxy_connect_without_disabling_tls() {
        let proxy = Server::new(|_| Reply {
            status: 502,
            headers: "Content-Length: 0\r\n".into(),
            body: vec![],
            stall: false,
        });
        let settings = SystemProxy::from_test_settings(Some(&proxy.origin), None, None).unwrap();
        let client = download_client(settings).unwrap();
        assert!(run(client.get("https://127.0.0.1:1/runtime").send()).is_err());
        assert_eq!(proxy.hits.load(Ordering::Acquire), 1);
        assert!(proxy.requests.lock().unwrap()[0].starts_with("CONNECT 127.0.0.1:1 "));
    }

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("shiroha-runtime-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn write_cache(&self, bytes: &[u8]) -> PathBuf {
            let path = managed_path(&self.0);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path
        }

        fn assert_no_pending(&self) {
            let parent = managed_path(&self.0).parent().unwrap().to_owned();
            if parent.exists() {
                assert!(fs::read_dir(parent).unwrap().all(|entry| {
                    !entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .ends_with(".pending")
                }));
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    struct Reply {
        status: u16,
        headers: String,
        body: Vec<u8>,
        stall: bool,
    }

    impl Reply {
        fn body(body: &[u8]) -> Self {
            Self {
                status: 200,
                headers: format!("Content-Length: {}\r\n", body.len()),
                body: body.into(),
                stall: false,
            }
        }

        fn redirect(location: &str) -> Self {
            Self {
                status: 302,
                headers: format!("Location: {location}\r\nContent-Length: 0\r\n"),
                body: Vec::new(),
                stall: false,
            }
        }
    }

    struct Server {
        origin: String,
        stop: Arc<AtomicBool>,
        hits: Arc<AtomicUsize>,
        requests: Arc<Mutex<Vec<String>>>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl Server {
        fn new(reply: impl Fn(&str) -> Reply + Send + 'static) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            let stop = Arc::new(AtomicBool::new(false));
            let hits = Arc::new(AtomicUsize::new(0));
            let requests = Arc::new(Mutex::new(Vec::new()));
            let worker_stop = stop.clone();
            let worker_hits = hits.clone();
            let worker_requests = requests.clone();
            let worker = thread::spawn(move || {
                while !worker_stop.load(Ordering::Acquire) {
                    let Ok((mut stream, _)) = listener.accept() else {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    };
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    stream
                        .set_write_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut request = Vec::new();
                    let mut buffer = [0; 1024];
                    while !request.windows(4).any(|value| value == b"\r\n\r\n") {
                        match stream.read(&mut buffer) {
                            Ok(0) | Err(_) => break,
                            Ok(count) => request.extend_from_slice(&buffer[..count]),
                        }
                        assert!(request.len() <= 8192);
                    }
                    let request = String::from_utf8(request).unwrap();
                    let path = request.split_whitespace().nth(1).unwrap_or("/");
                    let reply = reply(path);
                    worker_requests.lock().unwrap().push(request);
                    worker_hits.fetch_add(1, Ordering::Release);
                    let header = format!(
                        "HTTP/1.1 {} Test\r\n{}Connection: close\r\n\r\n",
                        reply.status, reply.headers
                    );
                    let _ = stream.write_all(header.as_bytes());
                    let _ = stream.write_all(&reply.body);
                    while reply.stall && !worker_stop.load(Ordering::Acquire) {
                        thread::sleep(Duration::from_millis(5));
                    }
                }
            });
            Self {
                origin,
                stop,
                hits,
                requests,
                worker: Some(worker),
            }
        }

        fn manifest(&self) -> Manifest {
            Manifest {
                url: format!("{}/runtime", self.origin),
                bytes: BODY.len() as u64,
                sha256: format!("{:x}", Sha256::digest(BODY)),
            }
        }
    }

    impl Drop for Server {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            self.worker.take().unwrap().join().unwrap();
        }
    }

    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn fetch(fixture: &Fixture, server: &Server, cancel: &AtomicBool) -> Result<PathBuf> {
        run(prepare_with(
            &fixture.0,
            cancel,
            &|_, _| {},
            &server.manifest(),
            &Policy::MockOrigin(server.origin.clone()),
            Duration::from_secs(5),
        ))
    }

    #[test]
    fn production_manifest_matches_executor_and_precancelled_prepare_never_downloads() {
        assert_eq!(VERSION, crate::harness_codex::VERSION);
        assert_eq!(EXECUTABLE_BYTES, 341_270_320);
        assert_eq!(EXECUTABLE_SHA256.len(), 64);
        let fixture = Fixture::new();
        assert_eq!(
            run(prepare(&fixture.0, &AtomicBool::new(true), &|_, _| {}))
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
    }

    #[test]
    fn valid_cache_is_fully_verified_and_reused_without_network() {
        let fixture = Fixture::new();
        fixture.write_cache(BODY);
        let server = Server::new(|_| panic!("valid cache must not request network"));
        let path = fetch(&fixture, &server, &AtomicBool::new(false)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), BODY);
        assert_eq!(
            fs::read(path.parent().unwrap().join("LICENSE")).unwrap(),
            include_bytes!("../../third-party/codex/LICENSE")
        );
        assert_eq!(
            fs::read(path.parent().unwrap().join("NOTICE")).unwrap(),
            include_bytes!("../../third-party/codex/NOTICE")
        );
        assert_eq!(
            fs::read(path.parent().unwrap().join("README.md")).unwrap(),
            include_bytes!("../../third-party/codex/README.md")
        );
        assert_eq!(server.hits.load(Ordering::Acquire), 0);
    }

    #[test]
    fn same_size_corrupt_cache_is_replaced_only_after_full_hash_verification() {
        let fixture = Fixture::new();
        fixture.write_cache(&vec![b'x'; BODY.len()]);
        let server = Server::new(|_| Reply::body(BODY));
        let path = fetch(&fixture, &server, &AtomicBool::new(false)).unwrap();
        assert_eq!(fs::read(path).unwrap(), BODY);
        assert_eq!(server.hits.load(Ordering::Acquire), 1);
    }

    #[test]
    fn installs_only_verified_bytes_and_reports_progress_without_secrets() {
        let fixture = Fixture::new();
        let server = Server::new(|_| Reply::body(BODY));
        let progress = Mutex::new(Vec::new());
        let path = run(prepare_with(
            &fixture.0,
            &AtomicBool::new(false),
            &|done, total| progress.lock().unwrap().push((done, total)),
            &server.manifest(),
            &Policy::MockOrigin(server.origin.clone()),
            Duration::from_secs(5),
        ))
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), BODY);
        assert_eq!(
            progress.lock().unwrap().last(),
            Some(&(BODY.len() as u64, BODY.len() as u64))
        );
        for request in server.requests.lock().unwrap().iter() {
            let request = request.to_ascii_lowercase();
            assert!(!request.contains("authorization:"));
            assert!(!request.contains("cookie:"));
        }
        fixture.assert_no_pending();
    }

    #[test]
    fn size_and_hash_failures_preserve_previous_file_and_remove_pending() {
        for body in [
            b"short".to_vec(),
            vec![b'x'; BODY.len()],
            vec![b'x'; BODY.len() + 1],
        ] {
            let fixture = Fixture::new();
            let previous = fixture.write_cache(b"previous incomplete cache");
            let server = Server::new(move |_| Reply::body(&body));
            assert_eq!(
                fetch(&fixture, &server, &AtomicBool::new(false))
                    .unwrap_err()
                    .code,
                "harness_runtime_integrity"
            );
            assert_eq!(fs::read(previous).unwrap(), b"previous incomplete cache");
            fixture.assert_no_pending();
        }
    }

    #[test]
    fn redirect_policy_rejects_untrusted_hosts_credentials_schemes_and_ports() {
        for valid in [
            EXECUTABLE_URL,
            "https://release-assets.githubusercontent.com/file?signature=synthetic",
        ] {
            validate_target(&Url::parse(valid).unwrap(), &Policy::Official).unwrap();
        }
        for invalid in [
            "http://github.com/file",
            "https://github.com.evil.invalid/file",
            "https://example.com/file",
            "https://user:password@github.com/file",
            "https://github.com:8443/file",
            "https://github.com/file#fragment",
        ] {
            assert_eq!(
                validate_target(&Url::parse(invalid).unwrap(), &Policy::Official)
                    .unwrap_err()
                    .code,
                "harness_runtime_redirect"
            );
        }
    }

    #[test]
    fn follows_allowed_redirect_but_rejects_escape_and_fourth_hop() {
        let fixture = Fixture::new();
        let server = Server::new(|path| {
            if path == "/runtime" {
                Reply::redirect("/file")
            } else {
                Reply::body(BODY)
            }
        });
        fetch(&fixture, &server, &AtomicBool::new(false)).unwrap();
        assert_eq!(server.hits.load(Ordering::Acquire), 2);
        for location in ["http://127.0.0.1:1/escape", "/loop"] {
            let fixture = Fixture::new();
            let server = Server::new(move |_| Reply::redirect(location));
            assert_eq!(
                fetch(&fixture, &server, &AtomicBool::new(false))
                    .unwrap_err()
                    .code,
                "harness_runtime_redirect"
            );
            assert!(server.hits.load(Ordering::Acquire) <= 4);
            fixture.assert_no_pending();
        }
    }

    #[test]
    fn cancellation_drops_stalled_body_within_one_second_and_preserves_cache() {
        let fixture = Fixture::new();
        let previous = fixture.write_cache(b"previous cache");
        let server = Server::new(|_| Reply {
            status: 200,
            headers: format!("Content-Length: {}\r\n", BODY.len()),
            body: BODY[..3].into(),
            stall: true,
        });
        let cancel = AtomicBool::new(false);
        thread::scope(|scope| {
            let worker = scope.spawn(|| fetch(&fixture, &server, &cancel));
            let deadline = Instant::now() + Duration::from_secs(3);
            let has_pending = || {
                fs::read_dir(previous.parent().unwrap())
                    .unwrap()
                    .any(|entry| {
                        entry
                            .unwrap()
                            .file_name()
                            .to_string_lossy()
                            .ends_with(".pending")
                    })
            };
            while (server.hits.load(Ordering::Acquire) == 0 || !has_pending())
                && Instant::now() < deadline
            {
                thread::sleep(Duration::from_millis(5));
            }
            assert_eq!(server.hits.load(Ordering::Acquire), 1);
            assert!(has_pending());
            let started = Instant::now();
            cancel.store(true, Ordering::Release);
            assert_eq!(worker.join().unwrap().unwrap_err().code, "cancelled");
            assert!(started.elapsed() < Duration::from_secs(1));
        });
        assert_eq!(fs::read(previous).unwrap(), b"previous cache");
        fixture.assert_no_pending();
    }

    #[test]
    fn overall_timeout_cleans_stalled_download() {
        let fixture = Fixture::new();
        let server = Server::new(|_| Reply {
            status: 200,
            headers: format!("Content-Length: {}\r\n", BODY.len()),
            body: Vec::new(),
            stall: true,
        });
        let result = run(prepare_with(
            &fixture.0,
            &AtomicBool::new(false),
            &|_, _| {},
            &server.manifest(),
            &Policy::MockOrigin(server.origin.clone()),
            Duration::from_millis(150),
        ));
        assert_eq!(result.unwrap_err().code, "timeout");
        fixture.assert_no_pending();
    }

    #[test]
    fn concurrent_prepare_is_rejected_and_cancelled_cache_is_not_reused() {
        let fixture = Fixture::new();
        let path = fixture.write_cache(BODY);
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.parent().unwrap().join("prepare.lock"))
            .unwrap();
        lock.try_lock().unwrap();
        let server = Server::new(|_| panic!("must not use network"));
        assert_eq!(
            fetch(&fixture, &server, &AtomicBool::new(false))
                .unwrap_err()
                .code,
            "harness_runtime_busy"
        );
        drop(lock);
        assert_eq!(
            fetch(&fixture, &server, &AtomicBool::new(true))
                .unwrap_err()
                .code,
            "cancelled"
        );
    }

    #[test]
    fn streamed_size_is_checked_without_content_length_and_http_errors_preserve_cache() {
        for (status, body) in [
            (200, b"short".to_vec()),
            (200, vec![b'x'; BODY.len() + 1]),
            (503, BODY.to_vec()),
        ] {
            let fixture = Fixture::new();
            let previous = fixture.write_cache(b"keep old bytes");
            let server = Server::new(move |_| Reply {
                status,
                headers: String::new(),
                body: body.clone(),
                stall: false,
            });
            let expected = if status == 200 {
                "harness_runtime_integrity"
            } else {
                "harness_runtime_download"
            };
            assert_eq!(
                fetch(&fixture, &server, &AtomicBool::new(false))
                    .unwrap_err()
                    .code,
                expected
            );
            assert_eq!(fs::read(previous).unwrap(), b"keep old bytes");
            fixture.assert_no_pending();
        }
    }

    #[cfg(windows)]
    #[test]
    fn junction_cannot_redirect_component_writes_outside_root() {
        use std::os::windows::process::CommandExt;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        let junction = fixture.0.join("runtime");
        let output = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside.0)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        let server = Server::new(|_| panic!("linked path must not reach network"));
        let result = fetch(&fixture, &server, &AtomicBool::new(false));
        fs::remove_dir(&junction).unwrap();
        assert_eq!(result.unwrap_err().code, "harness_runtime_storage");
        assert_eq!(fs::read_dir(&outside.0).unwrap().count(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn cache_verification_handle_denies_mutation_and_failed_install_preserves_old_file() {
        let fixture = Fixture::new();
        let previous = fixture.write_cache(b"previous file in use");
        let reader = open_read_locked(&previous).unwrap().unwrap();
        assert!(OpenOptions::new().write(true).open(&previous).is_err());
        assert!(fs::remove_file(&previous).is_err());
        let server = Server::new(|_| Reply::body(BODY));
        assert_eq!(
            fetch(&fixture, &server, &AtomicBool::new(false))
                .unwrap_err()
                .code,
            "harness_runtime_storage"
        );
        assert_eq!(fs::read(&previous).unwrap(), b"previous file in use");
        fixture.assert_no_pending();
        drop(reader);
        fetch(&fixture, &server, &AtomicBool::new(false)).unwrap();
        assert_eq!(fs::read(previous).unwrap(), BODY);
    }

    #[cfg(windows)]
    #[test]
    fn original_root_cannot_be_replaced_by_junction_before_canonicalization() {
        use std::os::windows::process::CommandExt;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        let root = fixture.0.join("ai-execution");
        let moved = fixture.0.join("moved-ai-execution");
        fs::create_dir(&root).unwrap();
        let replaced = AtomicBool::new(false);
        let result = install_directory(
            &root,
            Some(&|| {
                if fs::rename(&root, &moved).is_ok() {
                    replaced.store(true, Ordering::Release);
                    let output = std::process::Command::new("cmd.exe")
                        .args(["/D", "/C", "mklink", "/J"])
                        .arg(&root)
                        .arg(&outside.0)
                        .creation_flags(0x08000000)
                        .output()
                        .unwrap();
                    assert!(output.status.success(), "{output:?}");
                }
            }),
        );
        let succeeded = result.is_ok();
        drop(result);
        if replaced.load(Ordering::Acquire) {
            fs::remove_dir(&root).unwrap();
            fs::rename(&moved, &root).unwrap();
        }
        assert!(!replaced.load(Ordering::Acquire));
        assert!(succeeded);
        assert_eq!(fs::read_dir(&outside.0).unwrap().count(), 0);
        assert!(managed_path(&root).parent().unwrap().is_dir());
    }
}
