use crate::{
    error::{Error, Result},
    paths::reject_links,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path};

const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
const REFERENCE: &str = "shiroha-media:";
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn verify_references(value: &Value, root: &Path) -> Result<()> {
    match value {
        Value::Array(items) => {
            for item in items {
                verify_references(item, root)?;
            }
        }
        Value::Object(items) => {
            for item in items.values() {
                verify_references(item, root)?;
            }
        }
        Value::String(text) => {
            for rest in text.split(REFERENCE).skip(1) {
                let end = rest
                    .find(|c: char| !c.is_ascii_alphanumeric() && c != ':')
                    .unwrap_or(rest.len());
                let (hash, mime) = rest[..end]
                    .split_once(':')
                    .ok_or_else(|| Error::new("invalid_input"))?;
                if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
                    return Err(Error::new("invalid_input"));
                }
                let path = root.join(hash);
                reject_links(&path)?;
                if fs::metadata(&path)?.len() > MAX_IMAGE_BYTES as u64 {
                    return Err(Error::new("response_too_large"));
                }
                let bytes = fs::read(path)?;
                if digest(&bytes) != hash || !valid_image(mime, &bytes) {
                    return Err(Error::new("integrity_failed"));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn valid_image(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpeg" | "jpg" => bytes.starts_with(b"\xff\xd8\xff"),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        "bmp" => bytes.starts_with(b"BM"),
        _ => false,
    }
}

pub fn transform(value: &mut Value, root: &Path, hydrate: bool) -> Result<()> {
    transform_limited(value, root, hydrate, &mut (256 * 1024 * 1024))
}
pub(crate) fn transform_limited(
    value: &mut Value,
    root: &Path,
    hydrate: bool,
    remaining: &mut usize,
) -> Result<()> {
    match value {
        Value::Array(items) => {
            for item in items {
                transform_limited(item, root, hydrate, remaining)?;
            }
        }
        Value::Object(object) => {
            for item in object.values_mut() {
                transform_limited(item, root, hydrate, remaining)?;
            }
        }
        Value::String(text) => *text = transform_text(text, root, hydrate, remaining)?,
        _ => {}
    }
    Ok(())
}

fn append_bounded(output: &mut String, text: &str, remaining: &mut usize) -> Result<()> {
    *remaining = remaining
        .checked_sub(text.len())
        .ok_or_else(|| Error::new("response_too_large"))?;
    output.push_str(text);
    Ok(())
}
fn transform_text(text: &str, root: &Path, hydrate: bool, remaining: &mut usize) -> Result<String> {
    let marker = if hydrate { REFERENCE } else { "data:image/" };
    let mut rest = text;
    let mut output = String::new();
    while let Some(start) = rest.find(marker) {
        append_bounded(&mut output, &rest[..start], remaining)?;
        rest = &rest[start + marker.len()..];
        if hydrate {
            let end = rest
                .find(|c: char| !c.is_ascii_alphanumeric() && c != ':')
                .unwrap_or(rest.len());
            let token = &rest[..end];
            let (hash, mime) = token
                .split_once(':')
                .ok_or_else(|| Error::new("corrupt_data"))?;
            if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err(Error::new("invalid_input"));
            }
            let path = root.join(hash);
            reject_links(&path)?;
            if fs::metadata(&path)?.len() > MAX_IMAGE_BYTES as u64 {
                return Err(Error::new("response_too_large"));
            }
            let bytes = fs::read(path)?;
            if bytes.len() > MAX_IMAGE_BYTES || digest(&bytes) != hash || !valid_image(mime, &bytes)
            {
                return Err(Error::new("integrity_failed"));
            }
            let encoded_len = bytes.len().div_ceil(3) * 4 + mime.len() + 19;
            if encoded_len > *remaining {
                return Err(Error::new("response_too_large"));
            }
            append_bounded(
                &mut output,
                &format!("data:image/{mime};base64,{}", STANDARD.encode(bytes)),
                remaining,
            )?;
            rest = &rest[end..];
        } else {
            let Some((mime, body)) = rest.split_once(";base64,") else {
                return Err(Error::new("invalid_input"));
            };
            if mime.len() > 8 {
                return Err(Error::new("invalid_input"));
            }
            let end = body
                .find(|c: char| !c.is_ascii_alphanumeric() && c != '+' && c != '/' && c != '=')
                .unwrap_or(body.len());
            if end > MAX_IMAGE_BYTES * 4 / 3 + 4 {
                return Err(Error::new("response_too_large"));
            }
            let bytes = STANDARD
                .decode(&body[..end])
                .map_err(|_| Error::new("invalid_input"))?;
            if !valid_image(mime, &bytes) {
                return Err(Error::new("invalid_input"));
            }
            let hash = digest(&bytes);
            let destination = root.join(&hash);
            reject_links(&destination)?;
            if destination.exists() {
                if fs::read(&destination)? != bytes {
                    return Err(Error::new("integrity_failed"));
                }
            } else {
                // 单写入锁下先落地并刷新媒体，再提交引用；失败只留下未引用文件。
                let temporary = root.join(format!("{hash}.pending"));
                reject_links(&temporary)?;
                let mut file = fs::OpenOptions::new()
                    .create(true)
                    .truncate(true)
                    .write(true)
                    .open(&temporary)?;
                file.write_all(&bytes)?;
                file.sync_all()?;
                drop(file);
                if fs::read(&temporary)? != bytes {
                    return Err(Error::new("integrity_failed"));
                }
                fs::rename(temporary, destination)?;
            }
            append_bounded(&mut output, &format!("{REFERENCE}{hash}:{mime}"), remaining)?;
            rest = &body[end..];
        }
    }
    append_bounded(&mut output, rest, remaining)?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn output_budget_is_shared_across_nested_values() {
        let mut value = serde_json::json!({"a":["12345","67890"]});
        let mut budget = 9;
        assert_eq!(
            transform_limited(&mut value, Path::new("."), true, &mut budget)
                .unwrap_err()
                .code,
            "response_too_large"
        );
    }
}
