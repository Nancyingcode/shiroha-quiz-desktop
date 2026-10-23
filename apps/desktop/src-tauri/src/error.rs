use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Error {
    pub code: &'static str,
    pub message: &'static str,
    pub retryable: bool,
}
pub type Result<T> = std::result::Result<T, Error>;
impl Error {
    pub fn new(code: &'static str) -> Self {
        Self {
            code,
            message: "本地操作未完成，原数据已保留。请检查数据、权限和剩余空间后重试。",
            retryable: false,
        }
    }
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::new("storage_unavailable")
    }
}
impl From<rusqlite::Error> for Error {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("storage_unavailable")
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::new("corrupt_data")
    }
}
