use crate::{
    error::{Error, Result},
    harness_process::windows::Job,
};
use std::{
    ffi::{OsStr, OsString},
    fs::{self, File},
    mem::size_of,
    os::windows::{
        ffi::OsStrExt,
        fs::MetadataExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Component, Path, PathBuf, Prefix},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{
        LocalFree, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        },
        CopySid, EqualSid, FreeSid, GetLengthSid, GetTokenInformation,
        Isolation::{CreateAppContainerProfile, DeleteAppContainerProfile},
        TokenAppContainerSid, TokenCapabilities, TokenIsAppContainer, TokenUser, PSID,
        SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES, TOKEN_APPCONTAINER_INFORMATION,
        TOKEN_INFORMATION_CLASS, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{CreateDirectoryW, FILE_ATTRIBUTE_REPARSE_POINT},
    System::{
        Pipes::CreatePipe,
        Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess, GetExitCodeProcess,
            InitializeProcThreadAttributeList, OpenProcessToken, ResumeThread, TerminateProcess,
            UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
            CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTF_USESTDHANDLES, STARTUPINFOEXW,
        },
    },
};

const MAX_ENV_UNITS: usize = 32_767;
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const ISOLATION_ERROR: &str = "codebuddy_isolation_failed";

// 每个 Profile 只属于一个任务；Child 的引用保证运行期间 SID/profile 不会提前删除。
struct ProfileInner {
    name: Vec<u16>,
    sid: Vec<usize>,
    root: Mutex<Option<PathBuf>>,
    active_children: AtomicUsize,
    deleted: AtomicBool,
}

impl ProfileInner {
    fn sid(&self) -> PSID {
        self.sid.as_ptr().cast_mut().cast()
    }

    fn delete(&self) -> Result<()> {
        if self.active_children.load(Ordering::Acquire) != 0 {
            return Err(Error::new("harness_stop_failed"));
        }
        if !self.deleted.load(Ordering::Acquire) {
            // SAFETY: name 是本任务创建且仍存活的 NUL 终止名称；所有所属子孙已退出。
            if unsafe { DeleteAppContainerProfile(self.name.as_ptr()) } < 0 {
                return Err(Error::new("codebuddy_profile_cleanup_failed"));
            }
            self.deleted.store(true, Ordering::Release);
        }
        Ok(())
    }
}

impl Drop for ProfileInner {
    fn drop(&mut self) {
        // 显式 close 报告失败；兜底路径保留仍有活动进程的 profile，不谎称隔离已释放。
        let _ = self.delete();
    }
}

pub(crate) struct Profile {
    inner: Arc<ProfileInner>,
}

impl Profile {
    pub(crate) fn create() -> Result<Self> {
        let name = wide(OsStr::new(&format!(
            "Shiroha.CodeBuddy.{}",
            uuid::Uuid::new_v4()
        )))?;
        let display = wide(OsStr::new("Shiroha CodeBuddy isolated task"))?;
        let mut sid = std::ptr::null_mut();
        // SAFETY: 名称缓冲区存活；能力列表为空，不赋予互联网或私网能力。
        let status = unsafe {
            CreateAppContainerProfile(
                name.as_ptr(),
                display.as_ptr(),
                display.as_ptr(),
                std::ptr::null(),
                0,
                &mut sid,
            )
        };
        if status < 0 || sid.is_null() {
            return Err(Error::new(ISOLATION_ERROR));
        }
        // SAFETY: 系统成功返回有效 SID；在复制完成后释放原始分配。
        let length = unsafe { GetLengthSid(sid) } as usize;
        let mut copy = vec![0usize; length.div_ceil(size_of::<usize>())];
        // SAFETY: copy 按机器字对齐且容量不少于系统报告的 SID 长度。
        let copied = unsafe { CopySid(length as u32, copy.as_mut_ptr().cast(), sid) };
        // SAFETY: sid 由 CreateAppContainerProfile 分配且仅此处释放。
        unsafe { FreeSid(sid) };
        if copied == 0 {
            // SAFETY: 该唯一名称已成功创建，尚未启动任何进程。
            unsafe { DeleteAppContainerProfile(name.as_ptr()) };
            return Err(Error::new(ISOLATION_ERROR));
        }
        Ok(Self {
            inner: Arc::new(ProfileInner {
                name,
                sid: copy,
                root: Mutex::new(None),
                active_children: AtomicUsize::new(0),
                deleted: AtomicBool::new(false),
            }),
        })
    }

    pub(crate) fn prepare_directory(&self, root: &Path) -> Result<()> {
        let mut prepared = self
            .inner
            .root
            .lock()
            .map_err(|_| Error::new(ISOLATION_ERROR))?;
        if prepared.is_some() || self.inner.deleted.load(Ordering::Acquire) {
            return Err(Error::new(ISOLATION_ERROR));
        }
        validate_local_path(root)?;
        let parent = root.parent().ok_or_else(|| Error::new("invalid_input"))?;
        validate_existing_path(parent)?;
        if root.try_exists().map_err(|_| Error::new(ISOLATION_ERROR))? {
            return Err(Error::new("invalid_input"));
        }
        let owner = current_user_sid()?;
        let container = sid_string(self.inner.sid())?;
        // 根目录只允许容器读取/执行，防止 worker 或 CLI 修改同目录的受信二进制。
        create_directory(root, &owner, &container, "GRGX")?;
        let data = root.join("data");
        // 0x1301bf 是文件修改权限；不授 WRITE_DAC / WRITE_OWNER。
        create_directory(&data, &owner, &container, "0x1301bf")?;
        *prepared = Some(root.to_owned());
        Ok(())
    }

    pub(crate) fn spawn(
        &self,
        worker_path: &Path,
        cwd: &Path,
        env: &[(OsString, OsString)],
        cleanup_deadline: Arc<OnceLock<Instant>>,
    ) -> Result<Child> {
        self.spawn_with_command(
            worker_path,
            cwd,
            env,
            worker_command(worker_path)?,
            cleanup_deadline,
        )
    }

    fn spawn_with_command(
        &self,
        worker_path: &Path,
        cwd: &Path,
        env: &[(OsString, OsString)],
        mut command: Vec<u16>,
        cleanup_deadline: Arc<OnceLock<Instant>>,
    ) -> Result<Child> {
        let root = self
            .inner
            .root
            .lock()
            .map_err(|_| Error::new(ISOLATION_ERROR))?
            .clone()
            .ok_or_else(|| Error::new(ISOLATION_ERROR))?;
        if self.inner.deleted.load(Ordering::Acquire)
            || worker_path != root.join("worker.exe")
            || cwd != root.join("data").join("work")
        {
            return Err(Error::new("invalid_input"));
        }
        validate_existing_path(worker_path)?;
        validate_existing_path(cwd)?;
        if !worker_path.is_file() || !cwd.is_dir() {
            return Err(Error::new("invalid_input"));
        }
        let executable = wide(worker_path.as_os_str())?;
        let directory = wide(cwd.as_os_str())?;
        let environment = environment_block(env)?;
        let (child_stdin, parent_stdin) = pipe(false)?;
        let (child_stdout, parent_stdout) = pipe(true)?;
        let (child_stderr, parent_stderr) = pipe(true)?;
        let handles = [
            child_stdin.as_raw_handle(),
            child_stdout.as_raw_handle(),
            child_stderr.as_raw_handle(),
        ];
        let capabilities = SECURITY_CAPABILITIES {
            AppContainerSid: self.inner.sid(),
            Capabilities: std::ptr::null_mut(),
            CapabilityCount: 0,
            Reserved: 0,
        };
        let mut attributes = Attributes::new()?;
        attributes.set(
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
            (&capabilities as *const SECURITY_CAPABILITIES).cast(),
            size_of::<SECURITY_CAPABILITIES>(),
        )?;
        attributes.set(
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            handles.as_ptr().cast(),
            size_of_val(&handles),
        )?;
        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = handles[0];
        startup.StartupInfo.hStdOutput = handles[1];
        startup.StartupInfo.hStdError = handles[2];
        startup.lpAttributeList = attributes.raw();
        let job = Job::new()?;
        let mut information = PROCESS_INFORMATION::default();
        // SAFETY: 所有指针在调用期间有效；句柄列表只有三条子端管道，父端均不可继承。
        let created = unsafe {
            CreateProcessW(
                executable.as_ptr(),
                command.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                CREATE_NO_WINDOW
                    | CREATE_SUSPENDED
                    | CREATE_UNICODE_ENVIRONMENT
                    | EXTENDED_STARTUPINFO_PRESENT,
                environment.as_ptr().cast(),
                directory.as_ptr(),
                &startup.StartupInfo,
                &mut information,
            )
        };
        if created == 0 {
            #[cfg(test)]
            eprintln!(
                "container CreateProcessW failed: {}",
                std::io::Error::last_os_error()
            );
            return Err(Error::new(ISOLATION_ERROR));
        }
        // SAFETY: CreateProcessW 成功返回两个新的独占句柄。
        let process = unsafe { OwnedHandle::from_raw_handle(information.hProcess) };
        // SAFETY: 主线程仍挂起，该独占句柄在绑定 Job 与令牌核对后才恢复。
        let primary = unsafe { OwnedHandle::from_raw_handle(information.hThread) };
        self.inner.active_children.fetch_add(1, Ordering::Release);
        let mut child = Child {
            process,
            job: Some(job),
            stdin: Some(File::from(parent_stdin)),
            stdout: Some(File::from(parent_stdout)),
            stderr: Some(File::from(parent_stderr)),
            profile: self.inner.clone(),
            registered: true,
            cleanup_deadline,
        };
        let initialized = (|| {
            child
                .job
                .as_ref()
                .ok_or_else(|| Error::new(ISOLATION_ERROR))?
                .bind_handle(&child.process)?;
            verify_container(child.process.as_raw_handle(), self.inner.sid())?;
            // SAFETY: 所属 Job 已绑定并验证隔离令牌，只恢复本调用创建的唯一主线程。
            if unsafe { ResumeThread(primary.as_raw_handle()) } != 1 {
                return Err(Error::new(ISOLATION_ERROR));
            }
            Ok(())
        })();
        if let Err(error) = initialized {
            child.terminate_and_wait(CLEANUP_TIMEOUT)?;
            return Err(error);
        }
        Ok(child)
    }

    pub(crate) fn close(self) -> Result<()> {
        self.inner.delete()
    }
}

pub(crate) struct Child {
    process: OwnedHandle,
    job: Option<Job>,
    stdin: Option<File>,
    stdout: Option<File>,
    stderr: Option<File>,
    profile: Arc<ProfileInner>,
    registered: bool,
    // 宿主与子进程共享首次清理截止，启动失败和 Drop 也不能重新取得等待预算。
    cleanup_deadline: Arc<OnceLock<Instant>>,
}

impl Child {
    pub(crate) fn take_stdin(&mut self) -> Result<File> {
        self.stdin
            .take()
            .ok_or_else(|| Error::new("harness_io_failed"))
    }

    pub(crate) fn take_stdout(&mut self) -> Result<File> {
        self.stdout
            .take()
            .ok_or_else(|| Error::new("harness_io_failed"))
    }

    pub(crate) fn take_stderr(&mut self) -> Result<File> {
        self.stderr
            .take()
            .ok_or_else(|| Error::new("harness_io_failed"))
    }

    pub(crate) fn try_wait(&mut self) -> Result<Option<bool>> {
        // SAFETY: process 是本 Child 持有的有效进程句柄。
        match unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) } {
            WAIT_TIMEOUT => Ok(None),
            WAIT_OBJECT_0 => {
                let mut code = 0;
                // SAFETY: 进程句柄仍存活，code 是有效可写输出。
                if unsafe { GetExitCodeProcess(self.process.as_raw_handle(), &mut code) } == 0 {
                    return Err(Error::new("harness_execution_failed"));
                }
                Ok(Some(code == 0))
            }
            _ => Err(Error::new("harness_execution_failed")),
        }
    }

    pub(crate) fn terminate_and_wait(&mut self, timeout: Duration) -> Result<()> {
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or_else(|| Error::new("invalid_input"))?;
        self.terminate_before(deadline)
    }

    pub(crate) fn terminate_before(&mut self, deadline: Instant) -> Result<()> {
        if !self.registered && self.job.is_none() {
            return Ok(());
        }
        let deadline = deadline.min(*self.cleanup_deadline.get_or_init(|| deadline));
        let stopped = match self.job.as_ref() {
            Some(job) => job.stop(deadline),
            None => Ok(()),
        };
        // SAFETY: 仅终止本次创建的进程；Job 绑定失败时也必须回收挂起的直属进程。
        unsafe { TerminateProcess(self.process.as_raw_handle(), 1) };
        let waited = loop {
            match self.try_wait() {
                Ok(Some(_)) => break Ok(()),
                Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
                _ => break Err(Error::new("harness_stop_failed")),
            }
        };
        stopped.and(waited)?;
        self.job.take();
        if self.registered {
            self.profile.active_children.fetch_sub(1, Ordering::Release);
            self.registered = false;
        }
        Ok(())
    }
}

impl Drop for Child {
    fn drop(&mut self) {
        // 显式清理负责报告；兜底也等待所属进程退出后才允许 profile 删除。
        let _ = self.terminate_and_wait(CLEANUP_TIMEOUT);
    }
}

pub(crate) fn is_app_container() -> Result<bool> {
    // SAFETY: 返回当前进程伪句柄，仅借用，不关闭。
    let token = process_token(unsafe { GetCurrentProcess() })?;
    let information = token_information(&token, TokenIsAppContainer)?;
    Ok(information[0] as u32 != 0)
}

fn verify_container(process: HANDLE, expected: PSID) -> Result<()> {
    let token = process_token(process)?;
    let is_container = token_information(&token, TokenIsAppContainer)?;
    if is_container[0] as u32 != 1 {
        return Err(Error::new(ISOLATION_ERROR));
    }
    // 请求空能力之外还核对实际令牌；任何额外能力都需要重新评估出站边界。
    if capability_count(&token)? != 0 {
        return Err(Error::new(ISOLATION_ERROR));
    }
    let information = token_information(&token, TokenAppContainerSid)?;
    // SAFETY: 成功的查询返回对应类型，Vec<usize> 提供结构所需对齐。
    let actual = unsafe {
        &*information
            .as_ptr()
            .cast::<TOKEN_APPCONTAINER_INFORMATION>()
    };
    // SAFETY: 两个 SID 分别由令牌查询与当前 profile 持有且存活。
    if actual.TokenAppContainer.is_null()
        || unsafe { EqualSid(actual.TokenAppContainer, expected) } == 0
    {
        return Err(Error::new(ISOLATION_ERROR));
    }
    Ok(())
}

fn capability_count(token: &OwnedHandle) -> Result<u32> {
    let information = token_information(token, TokenCapabilities)?;
    // TOKEN_GROUPS 的首字段是 DWORD GroupCount；Windows 为小端，空列表也包含该字段。
    Ok(information[0] as u32)
}

fn current_user_sid() -> Result<String> {
    // SAFETY: 当前进程伪句柄仅用于打开只读 token，不转移所有权。
    let token = process_token(unsafe { GetCurrentProcess() })?;
    let information = token_information(&token, TokenUser)?;
    // SAFETY: 查询类型为 TOKEN_USER，缓冲区按机器字对齐并在调用期间存活。
    let user = unsafe { &*information.as_ptr().cast::<TOKEN_USER>() };
    sid_string(user.User.Sid)
}

fn process_token(process: HANDLE) -> Result<OwnedHandle> {
    let mut raw = std::ptr::null_mut();
    // SAFETY: process 来自有效进程句柄；仅请求查询权，输出指针可写。
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw) } == 0 {
        return Err(Error::new(ISOLATION_ERROR));
    }
    // SAFETY: 成功返回新的独占 token 句柄。
    Ok(unsafe { OwnedHandle::from_raw_handle(raw) })
}

fn token_information(token: &OwnedHandle, kind: TOKEN_INFORMATION_CLASS) -> Result<Vec<usize>> {
    let mut required = 0;
    // SAFETY: 零长度查询只取得所需字节数，token 在调用期间存活。
    unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            kind,
            std::ptr::null_mut(),
            0,
            &mut required,
        )
    };
    if required == 0 || required > 65_536 {
        return Err(Error::new(ISOLATION_ERROR));
    }
    let mut buffer = vec![0usize; (required as usize).div_ceil(size_of::<usize>())];
    // SAFETY: 已按系统报告的大小分配并对齐，查询不会越界写入。
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            kind,
            buffer.as_mut_ptr().cast(),
            required,
            &mut required,
        )
    } == 0
    {
        return Err(Error::new(ISOLATION_ERROR));
    }
    Ok(buffer)
}

struct LocalAllocation(*mut std::ffi::c_void);
impl Drop for LocalAllocation {
    fn drop(&mut self) {
        // SAFETY: 仅包装由 Windows LocalAlloc 系列接口返回的独占分配。
        unsafe { LocalFree(self.0) };
    }
}

fn sid_string(sid: PSID) -> Result<String> {
    let mut pointer = std::ptr::null_mut();
    // SAFETY: SID 来自成功的系统调用，输出字符串由 LocalFree 负责释放。
    if unsafe { ConvertSidToStringSidW(sid, &mut pointer) } == 0 {
        return Err(Error::new(ISOLATION_ERROR));
    }
    let allocation = LocalAllocation(pointer.cast());
    let mut length = 0;
    // SAFETY: 系统保证返回 NUL 终止的 SID 字符串；每次读取都在该分配内。
    while unsafe { *pointer.add(length) } != 0 {
        length += 1;
    }
    // SAFETY: length 是上述终止符之前的有效 UTF-16 元素数。
    let result = String::from_utf16(unsafe { std::slice::from_raw_parts(pointer, length) })
        .map_err(|_| Error::new(ISOLATION_ERROR));
    drop(allocation);
    result
}

fn create_directory(path: &Path, owner: &str, container: &str, rights: &str) -> Result<()> {
    let descriptor = format!("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;{owner})(A;OICI;{rights};;;{container})S:(ML;OICI;NW;;;LW)");
    let descriptor = wide(OsStr::new(&descriptor))?;
    let mut raw = std::ptr::null_mut();
    // SAFETY: SDDL 仅含系统生成 SID 和内部固定权限，输入 NUL 终止且输出可写。
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            descriptor.as_ptr(),
            1,
            &mut raw,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(Error::new(ISOLATION_ERROR));
    }
    let allocation = LocalAllocation(raw);
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: raw,
        bInheritHandle: 0,
    };
    let path = wide(path.as_os_str())?;
    // SAFETY: 路径父目录已拒绝 reparse；CreateDirectoryW 不会覆盖既有目录或修改其 ACL。
    let created = unsafe { CreateDirectoryW(path.as_ptr(), &attributes) };
    drop(allocation);
    if created == 0 {
        return Err(Error::new(ISOLATION_ERROR));
    }
    Ok(())
}

fn validate_local_path(path: &Path) -> Result<()> {
    let mut components = path.components();
    let local_drive = matches!(components.next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)));
    if !path.is_absolute()
        || !local_drive
        || components.any(|value| matches!(value, Component::ParentDir | Component::CurDir))
    {
        return Err(Error::new("invalid_input"));
    }
    wide(path.as_os_str())?;
    Ok(())
}

fn validate_existing_path(path: &Path) -> Result<()> {
    validate_local_path(path)?;
    for ancestor in path.ancestors() {
        let metadata = fs::symlink_metadata(ancestor).map_err(|_| Error::new(ISOLATION_ERROR))?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(Error::new("invalid_input"));
        }
    }
    Ok(())
}

fn wide(value: &OsStr) -> Result<Vec<u16>> {
    let mut result: Vec<u16> = value.encode_wide().collect();
    if result.contains(&0) || result.len() >= MAX_ENV_UNITS {
        return Err(Error::new("invalid_input"));
    }
    result.push(0);
    Ok(result)
}

fn worker_command(path: &Path) -> Result<Vec<u16>> {
    validate_local_path(path)?;
    let value: Vec<u16> = path.as_os_str().encode_wide().collect();
    if value.contains(&(b'"' as u16))
        || !path
            .extension()
            .is_some_and(|part| part.eq_ignore_ascii_case("exe"))
    {
        return Err(Error::new("invalid_input"));
    }
    let mut command = vec![b'"' as u16];
    command.extend(value);
    command.extend("\" --codebuddy-worker\0".encode_utf16());
    if command.len() > MAX_ENV_UNITS {
        return Err(Error::new("invalid_input"));
    }
    Ok(command)
}

fn environment_block(values: &[(OsString, OsString)]) -> Result<Vec<u16>> {
    let mut entries = Vec::new();
    for (key, value) in values {
        let key = key.to_str().ok_or_else(|| Error::new("invalid_input"))?;
        if key.is_empty()
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err(Error::new("invalid_input"));
        }
        let value = wide(value)?;
        entries.push((key.to_ascii_uppercase(), key, value));
    }
    entries.sort_unstable_by(|left, right| left.0.cmp(&right.0));
    if entries.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err(Error::new("invalid_input"));
    }
    let mut result = Vec::new();
    for (_, key, value) in entries {
        result.extend(key.encode_utf16());
        result.push(b'=' as u16);
        result.extend(value);
        if result.len() >= MAX_ENV_UNITS {
            return Err(Error::new("invalid_input"));
        }
    }
    if result.is_empty() {
        result.push(0);
    }
    result.push(0);
    Ok(result)
}

fn pipe(parent_reads: bool) -> Result<(OwnedHandle, OwnedHandle)> {
    let mut read = std::ptr::null_mut();
    let mut write = std::ptr::null_mut();
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: 1,
    };
    // SAFETY: 输出指针可写，默认安全描述符只用于本调用的匿名管道。
    if unsafe { CreatePipe(&mut read, &mut write, &attributes, 0) } == 0 {
        return Err(Error::new(ISOLATION_ERROR));
    }
    // SAFETY: 两个句柄由成功的 CreatePipe 返回并分别转为唯一所有者。
    let read = unsafe { OwnedHandle::from_raw_handle(read) };
    // SAFETY: write 与 read 不同，是新的独占管道句柄。
    let write = unsafe { OwnedHandle::from_raw_handle(write) };
    let (child, parent) = if parent_reads {
        (write, read)
    } else {
        (read, write)
    };
    // SAFETY: 仅关闭当前父端的继承标志；子端稍后经显式 HANDLE_LIST 传入。
    if unsafe { SetHandleInformation(parent.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) } == 0 {
        return Err(Error::new(ISOLATION_ERROR));
    }
    Ok((child, parent))
}

struct Attributes {
    storage: Vec<usize>,
}
impl Attributes {
    fn new() -> Result<Self> {
        let mut bytes = 0;
        // SAFETY: 零缓冲区查询两个属性所需大小。
        unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), 2, 0, &mut bytes) };
        if bytes == 0 || bytes > 65_536 {
            return Err(Error::new(ISOLATION_ERROR));
        }
        let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        // SAFETY: storage 对齐且具有查询要求的容量，构造成功后 Drop 才清理列表。
        if unsafe {
            InitializeProcThreadAttributeList(storage.as_mut_ptr().cast(), 2, 0, &mut bytes)
        } == 0
        {
            return Err(Error::new(ISOLATION_ERROR));
        }
        Ok(Self { storage })
    }
    fn raw(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.storage.as_mut_ptr().cast()
    }
    fn set(
        &mut self,
        attribute: usize,
        value: *const std::ffi::c_void,
        bytes: usize,
    ) -> Result<()> {
        // SAFETY: 调用方只提供本 spawn 栈上的能力结构或句柄数组，直到 CreateProcessW 返回均存活。
        if unsafe {
            UpdateProcThreadAttribute(
                self.raw(),
                0,
                attribute,
                value,
                bytes,
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        } == 0
        {
            return Err(Error::new(ISOLATION_ERROR));
        }
        Ok(())
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: 只对成功初始化且仍由本对象持有的列表调用清理。
        unsafe { DeleteProcThreadAttributeList(self.raw()) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, ToSocketAddrs},
        sync::mpsc,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE};

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                root: std::env::temp_dir().join(format!(
                    "shiroha-codebuddy-container-{}",
                    uuid::Uuid::new_v4()
                )),
            }
        }

        fn spawn(&self, profile: &Profile, mode: &str, host_port: u16) -> Child {
            profile.prepare_directory(&self.root).unwrap();
            let cwd = self.root.join("data/work");
            fs::create_dir(&cwd).unwrap();
            let worker = self.root.join("worker.exe");
            fs::copy(std::env::current_exe().unwrap(), &worker).unwrap();
            let mut env = vec![
                ("SystemRoot".into(), std::env::var_os("SystemRoot").unwrap()),
                ("SHIROHA_CONTAINER_FIXTURE".into(), mode.into()),
                (
                    "SHIROHA_CONTAINER_ROOT".into(),
                    self.root.as_os_str().to_owned(),
                ),
                (
                    "SHIROHA_CONTAINER_HOST_PORT".into(),
                    host_port.to_string().into(),
                ),
            ];
            let system_root = std::env::var_os("SystemRoot").unwrap();
            env.push(("WINDIR".into(), system_root.clone()));
            env.push((
                "PATH".into(),
                Path::new(&system_root).join("System32").into(),
            ));
            for key in [
                "TEMP",
                "TMP",
                "LOCALAPPDATA",
                "APPDATA",
                "USERPROFILE",
                "HOME",
            ] {
                env.push((key.into(), self.root.join("data").into()));
            }
            let command = wide(OsStr::new(&format!("\"{}\" --exact harness_codebuddy_container::tests::fixture_child --ignored --nocapture", worker.display()))).unwrap();
            profile
                .spawn_with_command(&worker, &cwd, &env, command, Arc::new(OnceLock::new()))
                .unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            // root 为本测试生成的绝对 UUID 路径；只在所属 Child 先退出后删除。
            if self.root.exists() {
                validate_existing_path(&self.root).unwrap();
                fs::remove_dir_all(&self.root).unwrap();
            }
        }
    }

    #[test]
    fn rejects_ambiguous_environment_before_process_creation() {
        for values in [
            vec![("PATH".into(), "one".into()), ("Path".into(), "two".into())],
            vec![("BAD=KEY".into(), "value".into())],
            vec![("KEY".into(), "embedded\0value".into())],
        ] {
            assert!(environment_block(&values).is_err());
        }
    }

    #[test]
    fn explicit_environment_is_sorted_and_double_terminated() {
        let values = [("Z".into(), "last".into()), ("A".into(), "first".into())];
        assert_eq!(
            environment_block(&values).unwrap(),
            "A=first\0Z=last\0\0".encode_utf16().collect::<Vec<_>>()
        );
        assert_eq!(environment_block(&[]).unwrap(), vec![0, 0]);
    }

    #[test]
    fn worker_arguments_cannot_inject_an_extra_command() {
        let path = Path::new(r"C:\Program Files\Shiroha\worker.exe");
        assert_eq!(
            worker_command(path).unwrap(),
            "\"C:\\Program Files\\Shiroha\\worker.exe\" --codebuddy-worker\0"
                .encode_utf16()
                .collect::<Vec<_>>()
        );
        assert!(worker_command(Path::new("relative.exe")).is_err());
        assert!(worker_command(Path::new("C:\\bad\".exe")).is_err());
        assert!(worker_command(Path::new("C:\\bad\0.exe")).is_err());
    }

    #[test]
    fn refuses_existing_directories_and_parent_traversal() {
        let profile = Profile::create().unwrap();
        assert!(profile.prepare_directory(&std::env::temp_dir()).is_err());
        assert!(validate_local_path(Path::new(r"C:\data\..\escape")).is_err());
        assert!(validate_local_path(Path::new(r"\\server\share\task")).is_err());
        profile.close().unwrap();
    }

    #[test]
    fn container_enforces_directory_and_loopback_boundary() {
        let fixture = Fixture::new();
        let profile = Profile::create().unwrap();
        let host = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let mut child = fixture.spawn(&profile, "isolation", host.local_addr().unwrap().port());
        let mut stdin = child.take_stdin().unwrap();
        let stdout = child.take_stdout().unwrap();
        let mut stderr = child.take_stderr().unwrap();
        let (ready_tx, ready_rx) = mpsc::channel();
        let reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let line = line.unwrap();
                if let Some(json) = line.strip_prefix("CONTAINER_READY:") {
                    ready_tx
                        .send(serde_json::from_str::<serde_json::Value>(json).unwrap())
                        .unwrap();
                }
            }
        });
        let errors = thread::spawn(move || {
            let mut bytes = Vec::new();
            stderr.read_to_end(&mut bytes).unwrap();
            bytes
        });
        let ready = ready_rx.recv_timeout(Duration::from_secs(15));
        if ready.is_err() {
            child.terminate_and_wait(CLEANUP_TIMEOUT).unwrap();
            reader.join().unwrap();
            panic!(
                "container worker did not become ready: {}",
                String::from_utf8_lossy(&errors.join().unwrap())
            );
        }
        let ready = ready.unwrap();
        assert_eq!(ready["container"], true);
        assert_eq!(ready["capabilityCount"], 0);
        assert_eq!(ready["rootWriteDenied"], true);
        assert_eq!(ready["dataWriteAllowed"], true);
        assert_eq!(ready["hostOutboundDenied"], true);
        let port = ready["port"].as_u64().unwrap() as u16;
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        assert!(TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_err());
        stdin.write_all(b"release").unwrap();
        drop(stdin);
        let deadline = Instant::now() + Duration::from_secs(5);
        while child.try_wait().unwrap().is_none() {
            assert!(Instant::now() < deadline);
            thread::sleep(POLL_INTERVAL);
        }
        assert_eq!(child.try_wait().unwrap(), Some(true));
        child.terminate_and_wait(CLEANUP_TIMEOUT).unwrap();
        reader.join().unwrap();
        assert!(errors.join().unwrap().is_empty());
        drop(child);
        profile.close().unwrap();
    }

    #[test]
    fn profile_cleanup_requires_all_owned_processes_to_stop() {
        let fixture = Fixture::new();
        let profile = Profile::create().unwrap();
        let mut child = fixture.spawn(&profile, "wait", 0);
        assert!(profile.inner.delete().is_err());
        child.terminate_and_wait(CLEANUP_TIMEOUT).unwrap();
        assert_eq!(child.try_wait().unwrap(), Some(false));
        profile.close().unwrap();
    }

    #[test]
    fn successful_worker_exit_does_not_leave_an_owned_descendant() {
        let fixture = Fixture::new();
        let profile = Profile::create().unwrap();
        let mut child = fixture.spawn(&profile, "tree", 0);
        let mut stdin = child.take_stdin().unwrap();
        let stdout = child.take_stdout().unwrap();
        let (ready_tx, ready_rx) = mpsc::channel();
        let reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let line = line.unwrap();
                if let Some(pid) = line.strip_prefix("DESCENDANT:") {
                    ready_tx.send(pid.parse::<u32>().unwrap()).unwrap();
                }
            }
        });
        let pid = ready_rx.recv_timeout(Duration::from_secs(15)).unwrap();
        // SAFETY: PID 来自本次存活的测试子孙；保留句柄避免 PID 复用影响断言。
        let raw = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        assert!(!raw.is_null());
        // SAFETY: OpenProcess 返回独占的有效句柄。
        let descendant = unsafe { OwnedHandle::from_raw_handle(raw) };
        stdin.write_all(b"release").unwrap();
        drop(stdin);
        let deadline = Instant::now() + Duration::from_secs(5);
        while child.try_wait().unwrap().is_none() {
            assert!(Instant::now() < deadline);
            thread::sleep(POLL_INTERVAL);
        }
        assert_eq!(child.try_wait().unwrap(), Some(true));
        child.terminate_and_wait(CLEANUP_TIMEOUT).unwrap();
        // SAFETY: 句柄保持存活，仅查询本任务明确记录的进程是否已经退出。
        assert_eq!(
            unsafe { WaitForSingleObject(descendant.as_raw_handle(), 2_000) },
            WAIT_OBJECT_0
        );
        reader.join().unwrap();
        profile.close().unwrap();
    }

    fn public_ipv4(address: IpAddr) -> bool {
        let IpAddr::V4(address) = address else {
            return false;
        };
        let [first, second, third, _] = address.octets();
        let reserved = matches!(first, 0 | 10 | 127 | 224..=255)
            || (first == 100 && (64..=127).contains(&second))
            || (first == 169 && second == 254)
            || (first == 172 && (16..=31).contains(&second))
            || (first == 192
                && (second == 168 || (second == 0 && third <= 2) || (second == 88 && third == 99)))
            || (first == 198 && (matches!(second, 18 | 19) || (second == 51 && third == 100)))
            || (first == 203 && second == 0 && third == 113);
        !reserved
    }

    #[test]
    fn public_probe_rejects_private_documentation_and_proxy_fake_addresses() {
        for address in [
            "0.0.0.0",
            "10.1.2.3",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.1.2",
            "172.16.0.1",
            "192.168.1.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.19.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.1.2.3",
            "255.255.255.255",
            "::1",
        ] {
            assert!(!public_ipv4(address.parse().unwrap()), "{address}");
        }
        assert!(public_ipv4("8.8.8.8".parse().unwrap()));
    }

    #[test]
    #[ignore = "显式公网 IPv4 验收：只对固定官方域名解析地址做零载荷 TCP 443 对照"]
    fn public_egress_is_denied() {
        const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);
        let targets: Vec<_> = ("www.codebuddy.cn", 443)
            .to_socket_addrs()
            .expect("官方域名 DNS 解析失败，公网隔离未验收")
            .filter(|address| public_ipv4(address.ip()))
            .take(4)
            .collect();
        let target = targets
            .into_iter()
            .find(|address| TcpStream::connect_timeout(address, CONNECT_TIMEOUT).is_ok())
            .expect("没有宿主可达的官方公网 IPv4 443 地址，公网隔离未验收");
        let fixture = Fixture::new();
        let profile = Profile::create().unwrap();
        let mut child = fixture.spawn(&profile, &format!("public:{target}"), 0);
        drop(child.take_stdin().unwrap());
        let stdout = child.take_stdout().unwrap();
        let (report_tx, report_rx) = mpsc::channel();
        let reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let line = line.unwrap();
                if let Some(json) = line.strip_prefix("PUBLIC_EGRESS:") {
                    report_tx
                        .send(serde_json::from_str::<serde_json::Value>(json).unwrap())
                        .unwrap();
                }
            }
        });
        let report = report_rx.recv_timeout(Duration::from_secs(10));
        child.terminate_and_wait(CLEANUP_TIMEOUT).unwrap();
        reader.join().unwrap();
        profile.close().unwrap();
        let report = report.expect("容器未返回公网探针结果，公网隔离未验收");
        let host_after = TcpStream::connect_timeout(&target, CONNECT_TIMEOUT).is_ok();
        println!(
            "{}",
            serde_json::json!({ "host": "www.codebuddy.cn", "target": target.to_string(), "family": "IPv4", "hostBefore": true, "hostAfter": host_after, "container": report, "applicationBytesSent": 0 })
        );
        assert!(host_after, "宿主后置对照不可达，公网隔离未验收");
        assert_eq!(report["capabilityCount"], 0);
        assert_eq!(report["connected"], false);
        assert_eq!(
            report["error"], 10013,
            "只有 WSAEACCES 明确拒绝才通过，超时不算隔离证据"
        );
    }

    #[test]
    #[ignore = "只由本模块的隔离子进程测试调用"]
    fn fixture_child() {
        let Some(mode) = std::env::var_os("SHIROHA_CONTAINER_FIXTURE") else {
            return;
        };
        if mode == "wait" {
            loop {
                thread::park();
            }
        }
        if mode == "tree" {
            let child = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "harness_codebuddy_container::tests::fixture_child",
                    "--ignored",
                    "--nocapture",
                ])
                .env("SHIROHA_CONTAINER_FIXTURE", "wait")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .unwrap();
            println!("DESCENDANT:{}", child.id());
            std::io::stdout().flush().unwrap();
            let mut input = Vec::new();
            std::io::stdin().read_to_end(&mut input).unwrap();
            assert_eq!(input, b"release");
            // 测试刻意让直属 worker 先成功退出，由宿主 Job 收敛仍在运行的子孙。
            std::process::exit(0);
        }
        if let Some(address) = mode.to_string_lossy().strip_prefix("public:") {
            let address: SocketAddr = address.parse().unwrap();
            assert!(public_ipv4(address.ip()) && address.port() == 443);
            // SAFETY: 当前进程伪句柄只用于只读查询，不关闭该伪句柄。
            let token = process_token(unsafe { GetCurrentProcess() }).unwrap();
            let connection = TcpStream::connect_timeout(&address, Duration::from_millis(1500));
            let report = serde_json::json!({ "connected": connection.is_ok(), "error": connection.as_ref().err().and_then(std::io::Error::raw_os_error), "capabilityCount": capability_count(&token).unwrap() });
            println!("PUBLIC_EGRESS:{report}");
            std::io::stdout().flush().unwrap();
            std::process::exit(0);
        }
        assert_eq!(mode, "isolation");
        let root = PathBuf::from(std::env::var_os("SHIROHA_CONTAINER_ROOT").unwrap());
        let host_port = std::env::var("SHIROHA_CONTAINER_HOST_PORT")
            .unwrap()
            .parse::<u16>()
            .unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, host_port));
        // SAFETY: 当前进程伪句柄只用于只读查询，不关闭该伪句柄。
        let token = process_token(unsafe { GetCurrentProcess() }).unwrap();
        let report = serde_json::json!({
            "container": is_app_container().unwrap(),
            "capabilityCount": capability_count(&token).unwrap(),
            "rootWriteDenied": fs::write(root.join("forbidden.txt"), b"synthetic").is_err(),
            "dataWriteAllowed": fs::write(root.join("data/allowed.txt"), b"synthetic").is_ok(),
            "hostOutboundDenied": TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_err(),
            "port": listener.local_addr().unwrap().port(),
        });
        println!("CONTAINER_READY:{report}");
        std::io::stdout().flush().unwrap();
        let mut input = Vec::new();
        std::io::stdin().read_to_end(&mut input).unwrap();
        assert_eq!(input, b"release");
        std::process::exit(0);
    }
}
