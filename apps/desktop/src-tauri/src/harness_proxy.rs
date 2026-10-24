use crate::error::Result;
use crate::harness::failure;
use url::Url;

const MAX_SETTING_BYTES: usize = 128 * 1024;
#[cfg(windows)]
const MAX_SETTING_UTF16_UNITS: usize = 32 * 1024;

// 快照只属于一次下载客户端；重试重新读取系统设置，不缓存到配置或日志。
#[derive(Clone)]
pub(crate) struct SystemProxy {
    http: Option<Url>,
    https: Option<Url>,
    bypass: Vec<Bypass>,
}

pub(crate) fn current() -> Result<SystemProxy> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Networking::WinHttp::WinHttpGetIEProxyConfigForCurrentUser;
        let mut raw = WindowsSettings::default();
        // SAFETY: 结构体已初始化，唯一可写引用在调用期间有效；返回的缓冲区由 raw 负责释放。
        if unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut raw.0) } == 0 {
            // SAFETY: 紧邻失败的 WinHTTP 调用读取线程错误码，尚未运行可能覆盖它的其他 Win32 调用。
            return settings_error(unsafe { windows_sys::Win32::Foundation::GetLastError() });
        }
        // SAFETY: 成功的 WinHTTP 调用提供 NUL 结尾 UTF-16 或空指针，raw 在复制完成前一直持有它们。
        let (proxy, bypass, pac) = unsafe {
            (
                read_wide(raw.0.lpszProxy)?,
                read_wide(raw.0.lpszProxyBypass)?,
                read_wide(raw.0.lpszAutoConfigUrl)?,
            )
        };
        // 本轮只跟随静态代理，不执行自动发现或 PAC 脚本；显式 PAC 缺少 HTTPS 兜底会报错。
        parse_settings(&proxy, &bypass, &pac)
    }
    #[cfg(not(windows))]
    {
        Err(failure("harness_platform_unsupported"))
    }
}

#[cfg(windows)]
fn settings_error(code: u32) -> Result<SystemProxy> {
    // WinHTTP 用文件不存在表示该用户尚未创建 IE 代理配置，等价于未配置代理。
    if code == windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND {
        Ok(SystemProxy::direct())
    } else {
        Err(failure("harness_runtime_proxy_config"))
    }
}

impl SystemProxy {
    pub(crate) fn direct() -> Self {
        Self {
            http: None,
            https: None,
            bypass: Vec::new(),
        }
    }

    pub(crate) fn for_url(&self, url: &Url) -> Option<Url> {
        let proxy = match url.scheme() {
            "http" => self.http.as_ref(),
            "https" => self.https.as_ref(),
            _ => None,
        }?;
        if self.bypass.iter().any(|rule| rule.matches(url)) {
            None
        } else {
            Some(proxy.clone())
        }
    }

    #[cfg(test)]
    pub(crate) fn from_test_settings(
        proxy: Option<&str>,
        bypass: Option<&str>,
        pac: Option<&str>,
    ) -> Result<Self> {
        parse_settings(
            proxy.unwrap_or_default(),
            bypass.unwrap_or_default(),
            pac.unwrap_or_default(),
        )
    }
}

fn parse_settings(proxy: &str, bypass: &str, pac: &str) -> Result<SystemProxy> {
    if [proxy, bypass, pac]
        .iter()
        .any(|value| value.len() > MAX_SETTING_BYTES)
    {
        return Err(failure("harness_runtime_proxy_config"));
    }
    let proxy = proxy.trim();
    let pac = pac.trim();
    if proxy.is_empty() {
        return if pac.is_empty() {
            Ok(SystemProxy::direct())
        } else {
            Err(failure("harness_runtime_proxy_config"))
        };
    }
    let mut fallback = None;
    let mut http = None;
    let mut https = None;
    for entry in proxy
        .split(|c: char| c == ';' || c.is_ascii_whitespace())
        .filter(|entry| !entry.is_empty())
    {
        let (slot, value) = if let Some((scheme, value)) = entry.split_once('=') {
            match scheme.to_ascii_lowercase().as_str() {
                "http" => (&mut http, value),
                "https" => (&mut https, value),
                // 其他 Windows 协议映射不适用于本下载器，不能当作通用 HTTP 代理。
                "ftp" | "socks" => continue,
                _ => return Err(failure("harness_runtime_proxy_config")),
            }
        } else {
            (&mut fallback, entry)
        };
        if slot.is_some() {
            return Err(failure("harness_runtime_proxy_config"));
        }
        *slot = Some(parse_proxy_url(value)?);
    }
    let http = http.or_else(|| fallback.clone());
    let https = https.or(fallback);
    if (http.is_none() && https.is_none()) || (!pac.is_empty() && https.is_none()) {
        return Err(failure("harness_runtime_proxy_config"));
    }
    let bypass = bypass
        .split(|c: char| c == ';' || c.is_ascii_whitespace())
        .filter(|entry| !entry.is_empty())
        .map(Bypass::parse)
        .collect::<Result<Vec<_>>>()?;
    Ok(SystemProxy {
        http,
        https,
        bypass,
    })
}

fn parse_proxy_url(value: &str) -> Result<Url> {
    let address = if value.contains("://") {
        value.to_owned()
    } else {
        format!("http://{value}")
    };
    let url = Url::parse(&address).map_err(|_| failure("harness_runtime_proxy_config"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port() == Some(0)
    {
        return Err(failure("harness_runtime_proxy_config"));
    }
    Ok(url)
}

#[derive(Clone)]
enum Bypass {
    Local,
    Host {
        scheme: Option<String>,
        pattern: String,
        port: Option<u16>,
    },
}

impl Bypass {
    fn parse(value: &str) -> Result<Self> {
        if value.eq_ignore_ascii_case("<local>") {
            return Ok(Self::Local);
        }
        let (scheme, authority) = if let Some((scheme, authority)) = value.split_once("://") {
            if !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https") {
                return Err(failure("harness_runtime_proxy_config"));
            }
            (Some(scheme.to_ascii_lowercase()), authority)
        } else {
            (None, value)
        };
        if authority.is_empty()
            || authority
                .chars()
                .any(|c| matches!(c, '/' | '\\' | '?' | '#' | '@'))
        {
            return Err(failure("harness_runtime_proxy_config"));
        }
        let (host, port) = if let Some(bracketed) = authority.strip_prefix('[') {
            let (host, rest) = bracketed
                .split_once(']')
                .ok_or_else(|| failure("harness_runtime_proxy_config"))?;
            let port = if rest.is_empty() {
                None
            } else {
                Some(parse_port(
                    rest.strip_prefix(':')
                        .ok_or_else(|| failure("harness_runtime_proxy_config"))?,
                )?)
            };
            (host, port)
        } else if let Some((host, port)) = authority.rsplit_once(':') {
            (host, Some(parse_port(port)?))
        } else {
            (authority, None)
        };
        if host.is_empty() {
            return Err(failure("harness_runtime_proxy_config"));
        }
        let pattern = if host.contains('*') {
            host.trim_end_matches('.').to_ascii_lowercase()
        } else if let Ok(ip) = host.parse::<std::net::IpAddr>() {
            ip.to_string()
        } else {
            let url = Url::parse(&format!("http://{host}"))
                .map_err(|_| failure("harness_runtime_proxy_config"))?;
            if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
                return Err(failure("harness_runtime_proxy_config"));
            }
            url.host_str()
                .ok_or_else(|| failure("harness_runtime_proxy_config"))?
                .trim_end_matches('.')
                .to_ascii_lowercase()
        };
        Ok(Self::Host {
            scheme,
            pattern,
            port,
        })
    }

    fn matches(&self, url: &Url) -> bool {
        match self {
            Self::Local => {
                matches!(url.host(), Some(url::Host::Domain(host)) if !host.contains('.'))
            }
            Self::Host {
                scheme,
                pattern,
                port,
            } => {
                if scheme.as_ref().is_some_and(|scheme| scheme != url.scheme())
                    || port.is_some_and(|port| Some(port) != url.port_or_known_default())
                {
                    return false;
                }
                let host = match url.host() {
                    Some(url::Host::Domain(host)) => {
                        host.trim_end_matches('.').to_ascii_lowercase()
                    }
                    Some(url::Host::Ipv4(ip)) => ip.to_string(),
                    Some(url::Host::Ipv6(ip)) => ip.to_string(),
                    None => return false,
                };
                wildcard_matches(pattern.as_bytes(), host.as_bytes())
            }
        }
    }
}

fn parse_port(value: &str) -> Result<u16> {
    value
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
        .ok_or_else(|| failure("harness_runtime_proxy_config"))
}

fn wildcard_matches(pattern: &[u8], host: &[u8]) -> bool {
    let (mut pattern_index, mut host_index) = (0, 0);
    let (mut star, mut retry_from) = (None, 0);
    while host_index < host.len() {
        if pattern.get(pattern_index) == Some(&b'*') {
            star = Some(pattern_index);
            pattern_index += 1;
            retry_from = host_index;
        } else if pattern.get(pattern_index) == host.get(host_index) {
            pattern_index += 1;
            host_index += 1;
        } else if let Some(star) = star {
            retry_from += 1;
            host_index = retry_from;
            pattern_index = star + 1;
        } else {
            return false;
        }
    }
    while pattern.get(pattern_index) == Some(&b'*') {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}

#[cfg(windows)]
#[derive(Default)]
struct WindowsSettings(
    windows_sys::Win32::Networking::WinHttp::WINHTTP_CURRENT_USER_IE_PROXY_CONFIG,
);

#[cfg(windows)]
impl Drop for WindowsSettings {
    fn drop(&mut self) {
        for pointer in [
            self.0.lpszProxy,
            self.0.lpszProxyBypass,
            self.0.lpszAutoConfigUrl,
        ] {
            if !pointer.is_null() {
                // SAFETY: 每个非空字段均由 WinHTTP 单独分配且只归此 guard 所有，按 API 契约用 GlobalFree 释放一次。
                unsafe {
                    windows_sys::Win32::Foundation::GlobalFree(pointer.cast());
                }
            }
        }
    }
}

#[cfg(windows)]
unsafe fn read_wide(pointer: *const u16) -> Result<String> {
    if pointer.is_null() {
        return Ok(String::new());
    }
    for length in 0..MAX_SETTING_UTF16_UNITS {
        // SAFETY: 调用方保证指针来自有效的 NUL 结尾 WinHTTP 缓冲区；遍历不超过首个 NUL 或配置长度上限。
        if unsafe { *pointer.add(length) } == 0 {
            // SAFETY: 已逐项检查该长度内存可读，且所有权 guard 在复制期间保持存活。
            let units = unsafe { std::slice::from_raw_parts(pointer, length) };
            return String::from_utf16(units).map_err(|_| failure("harness_runtime_proxy_config"));
        }
    }
    Err(failure("harness_runtime_proxy_config"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    fn settings(proxy: &str, bypass: &str) -> SystemProxy {
        SystemProxy::from_test_settings(Some(proxy), Some(bypass), None).unwrap()
    }

    #[test]
    fn disabled_system_proxy_is_direct_even_with_stale_bypass() {
        let direct =
            SystemProxy::from_test_settings(None, Some("*.example.com;<local>"), None).unwrap();
        for direct in [direct, SystemProxy::direct(), settings("", "")] {
            assert!(direct.for_url(&target("https://github.com/file")).is_none());
            assert!(direct.for_url(&target("http://example.com/file")).is_none());
        }
        let _read_only_entry: fn() -> Result<SystemProxy> = current;
    }

    #[test]
    fn unified_static_proxy_handles_https_http_and_ipv6_without_env_lookup() {
        for address in [
            "127.0.0.1:7890",
            "http://127.0.0.1:7890",
            "https://proxy.example:8443",
            "[::1]:7890",
        ] {
            let proxy = settings(address, "");
            let expected = if address.contains("://") {
                address.to_owned()
            } else {
                format!("http://{address}")
            };
            let expected = target(&expected);
            assert_eq!(
                proxy.for_url(&target("https://github.com/file")),
                Some(expected.clone())
            );
            assert_eq!(
                proxy.for_url(&target("http://example.com/file")),
                Some(expected)
            );
            assert!(proxy.for_url(&target("file:///C:/fixture")).is_none());
        }
    }

    #[test]
    fn per_scheme_proxy_uses_correct_entry_and_does_not_apply_http_to_https() {
        let proxy = settings(
            "http=first.example:8080; HTTPS=http://second.example:7890",
            "",
        );
        assert_eq!(
            proxy.for_url(&target("https://github.com/file")),
            Some(target("http://second.example:7890"))
        );
        assert_eq!(
            proxy.for_url(&target("http://example.com/file")),
            Some(target("http://first.example:8080"))
        );
        let http_only = settings("http=first.example:8080", "");
        assert!(http_only
            .for_url(&target("https://github.com/file"))
            .is_none());
        let fallback = settings("default.example:8080 https=secure.example:7890", "");
        assert_eq!(
            fallback.for_url(&target("https://github.com/file")),
            Some(target("http://secure.example:7890"))
        );
        assert_eq!(
            fallback.for_url(&target("http://example.com/file")),
            Some(target("http://default.example:8080"))
        );
    }

    #[test]
    fn bypass_patterns_cover_exact_hosts_wildcards_and_local_names() {
        let proxy = settings(
            "127.0.0.1:7890",
            "github.com; *.example.com;127.*;192.168.*;[::1];<local>",
        );
        for bypassed in [
            "https://github.com",
            "https://API.EXAMPLE.COM/file",
            "http://127.0.0.1",
            "http://192.168.1.8",
            "http://[::1]",
            "http://printer",
            "http://INTRANET:8080",
        ] {
            assert!(proxy.for_url(&target(bypassed)).is_none(), "{bypassed}");
        }
        for proxied in [
            "https://api.github.com",
            "https://example.com",
            "https://notexample.com",
            "http://128.0.0.1",
            "http://8.8.8.8",
            "http://server.company",
        ] {
            assert!(proxy.for_url(&target(proxied)).is_some(), "{proxied}");
        }
        assert!(settings("localhost:7890", "*")
            .for_url(&target("https://github.com"))
            .is_none());
    }

    #[test]
    fn bypass_can_limit_scheme_and_port_without_matching_wrong_host() {
        let proxy = settings("localhost:7890", "https://github.com:443;example.com:8443");
        assert!(proxy.for_url(&target("https://github.com/path")).is_none());
        assert!(proxy.for_url(&target("http://github.com/path")).is_some());
        assert!(proxy
            .for_url(&target("https://github.com:8443/path"))
            .is_some());
        assert!(proxy
            .for_url(&target("https://example.com:8443/path"))
            .is_none());
        assert!(proxy.for_url(&target("https://example.com/path")).is_some());
    }

    #[test]
    fn explicit_pac_requires_static_fallback_and_does_not_become_silent_direct() {
        assert_eq!(
            SystemProxy::from_test_settings(None, None, Some("https://proxy.example/config.pac"))
                .err()
                .unwrap()
                .code,
            "harness_runtime_proxy_config"
        );
        let fallback = SystemProxy::from_test_settings(
            Some("localhost:7890"),
            None,
            Some("https://proxy.example/config.pac"),
        )
        .unwrap();
        assert!(fallback.for_url(&target("https://github.com")).is_some());
        assert_eq!(
            SystemProxy::from_test_settings(
                Some("http=localhost:7890"),
                None,
                Some("https://proxy.example/config.pac")
            )
            .err()
            .unwrap()
            .code,
            "harness_runtime_proxy_config"
        );
    }

    #[test]
    fn malformed_or_unsupported_static_proxy_fails_without_exposing_values() {
        for value in [
            "http://user:secret@localhost:7890",
            "socks5://localhost:7890",
            "https://proxy.example/path",
            "http://proxy.example?token=secret",
            "http://proxy.example#secret",
            "localhost:0",
            "localhost:65536",
            "http=one:80;http=two:80",
            "first:80;second:80",
        ] {
            let error = SystemProxy::from_test_settings(Some(value), None, None)
                .err()
                .unwrap();
            assert_eq!(error.code, "harness_runtime_proxy_config");
            assert!(!error.message.contains(value));
            assert!(!error.message.contains("secret"));
        }
    }

    #[test]
    fn malformed_bypass_and_oversized_settings_fail_with_fixed_error() {
        for bypass in [
            "http://user@github.com",
            "github.com:0",
            "github.com:65536",
            "[::1",
            "github.com/path",
            "github.com\\other.example",
        ] {
            assert_eq!(
                SystemProxy::from_test_settings(Some("localhost:7890"), Some(bypass), None)
                    .err()
                    .unwrap()
                    .code,
                "harness_runtime_proxy_config"
            );
        }
        let oversized = "x".repeat(MAX_SETTING_BYTES + 1);
        assert_eq!(
            SystemProxy::from_test_settings(Some(&oversized), None, None)
                .err()
                .unwrap()
                .code,
            "harness_runtime_proxy_config"
        );
    }

    #[cfg(windows)]
    #[test]
    fn wide_config_copy_handles_null_and_rejects_invalid_or_oversized_utf16() {
        let valid: Vec<_> = "localhost:7890".encode_utf16().chain([0]).collect();
        let invalid = [0xd800, 0];
        let mut oversized = vec![b'x' as u16; MAX_SETTING_UTF16_UNITS];
        oversized.push(0);
        // SAFETY: 所有非空指针都指向本测试持有的 NUL 结尾缓冲区，长度检查期间不会释放或修改。
        unsafe {
            assert_eq!(read_wide(std::ptr::null()).unwrap(), "");
            assert_eq!(read_wide(valid.as_ptr()).unwrap(), "localhost:7890");
            assert_eq!(
                read_wide(invalid.as_ptr()).err().unwrap().code,
                "harness_runtime_proxy_config"
            );
            assert_eq!(
                read_wide(oversized.as_ptr()).err().unwrap().code,
                "harness_runtime_proxy_config"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn absent_windows_configuration_is_direct_but_other_read_errors_are_not() {
        use windows_sys::Win32::Foundation::{
            ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, ERROR_INVALID_DATA,
        };
        assert!(settings_error(ERROR_FILE_NOT_FOUND)
            .unwrap()
            .for_url(&target("https://github.com/file"))
            .is_none());
        for error in [ERROR_ACCESS_DENIED, ERROR_INVALID_DATA, 0] {
            assert_eq!(
                settings_error(error).err().unwrap().code,
                "harness_runtime_proxy_config"
            );
        }
    }
}
