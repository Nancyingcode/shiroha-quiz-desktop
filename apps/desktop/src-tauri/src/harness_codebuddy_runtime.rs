use crate::error::Result;
use crate::harness::failure;
use flate2::{Decompress, FlushDecompress, Status};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) const VERSION: &str = "2.175.0";
pub(crate) const EXECUTABLE_BYTES: u64 = 182_874_624;
pub(crate) const EXECUTABLE_SHA256: &str =
    "bc404638e5e55af4030f93ed73dadc68a7ca2b7eb5df6613b07ab3510061b309";
pub(crate) const ARCHIVE_URL: &str = "https://acc-1258344699.cos.accelerate.myqcloud.com/@tencent-ai/codebuddy-code/releases/download/2.175.0/codebuddy-code_Windows_x86_64.zip";
pub(crate) const ARCHIVE_BYTES: u64 = 94_855_403;
pub(crate) const ARCHIVE_SHA256: &str =
    "0e9c39f1af4639d63f6aadccc5075233e6d8e4c571c3941c93f5fad81d33d4d4";
pub(crate) const LICENSE_FILES: &[(&str, &[u8])] = &[
    (
        "LICENSE.txt",
        include_bytes!("../../third-party/codebuddy/LICENSE.txt"),
    ),
    (
        "README.md",
        include_bytes!("../../third-party/codebuddy/README.md"),
    ),
];
const BUFFER_BYTES: usize = 64 * 1024;
const HEADER: &[u8] = b"PK\x03\x04\x14\0\x08\0\x08\0\x7c\x6e\x58\x5d\0\0\0\0\0\0\0\0\0\0\0\0\x0d\0\x09\0codebuddy.exeUT\x05\0\x01\xfd\xb7\xdc\x6a";

pub(crate) fn managed_path(root: &Path) -> PathBuf {
    root.join("runtime")
        .join("codebuddy")
        .join(VERSION)
        .join("codebuddy.exe")
}

pub(crate) async fn prepare(
    root: &Path,
    cancel: &AtomicBool,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> Result<PathBuf> {
    crate::harness_runtime::prepare_component(
        root,
        cancel,
        progress,
        crate::harness_runtime::Component::CodeBuddy,
    )
    .await
    .map_err(|error| {
        let code = match error.code {
            "harness_runtime_storage" => "codebuddy_runtime_storage",
            "harness_runtime_busy" => "codebuddy_runtime_busy",
            "harness_runtime_download" => "codebuddy_runtime_download",
            "harness_runtime_proxy" => "codebuddy_runtime_proxy",
            "harness_runtime_proxy_config" => "codebuddy_runtime_proxy_config",
            "harness_runtime_integrity" => "codebuddy_runtime_integrity",
            "harness_runtime_redirect" => "codebuddy_runtime_redirect",
            _ => return error,
        };
        failure(code)
    })
}

struct Entry<'a> {
    archive_bytes: u64,
    header_offset: u64,
    header: &'a [u8],
    compressed_bytes: u64,
    executable_bytes: u64,
    executable_sha256: &'a str,
    crc32: u32,
}

async fn unpack_entry(
    source: &mut (impl Read + Seek),
    destination: &mut impl Write,
    cancel: &AtomicBool,
    entry: &Entry<'_>,
) -> Result<()> {
    check_cancel(cancel)?;
    let integrity = || failure("harness_runtime_integrity");
    if source.seek(SeekFrom::End(0)).map_err(|_| integrity())? != entry.archive_bytes {
        return Err(integrity());
    }
    let data_offset = entry
        .header_offset
        .checked_add(entry.header.len() as u64)
        .ok_or_else(integrity)?;
    let descriptor_offset = data_offset
        .checked_add(entry.compressed_bytes)
        .ok_or_else(integrity)?;
    if descriptor_offset
        .checked_add(16)
        .is_none_or(|end| end > entry.archive_bytes)
    {
        return Err(integrity());
    }
    source
        .seek(SeekFrom::Start(entry.header_offset))
        .map_err(|_| integrity())?;
    let mut header = vec![0; entry.header.len()];
    source.read_exact(&mut header).map_err(|_| integrity())?;
    if header != entry.header {
        return Err(integrity());
    }

    // 整份归档已通过固定摘要校验；只解一个固定字节区间，不把任何 ZIP 路径交给文件系统。
    let mut reader = BufReader::with_capacity(BUFFER_BYTES, source.take(entry.compressed_bytes));
    let mut inflater = Decompress::new(false);
    let mut hash = Sha256::new();
    let mut output = [0; BUFFER_BYTES];
    loop {
        check_cancel(cancel)?;
        let before_in = inflater.total_in();
        let before_out = inflater.total_out();
        let status = inflater
            .decompress(
                reader.fill_buf().map_err(|_| integrity())?,
                &mut output,
                FlushDecompress::None,
            )
            .map_err(|_| integrity())?;
        let consumed = (inflater.total_in() - before_in) as usize;
        let produced = (inflater.total_out() - before_out) as usize;
        reader.consume(consumed);
        if inflater.total_out() > entry.executable_bytes {
            return Err(integrity());
        }
        destination
            .write_all(&output[..produced])
            .map_err(|_| failure("harness_runtime_storage"))?;
        hash.update(&output[..produced]);
        if status == Status::StreamEnd {
            break;
        }
        if consumed == 0 && produced == 0 {
            return Err(integrity());
        }
        tokio::task::yield_now().await;
    }
    check_cancel(cancel)?;
    // 必须遇到 DEFLATE 终态，普通 EOF 不能证明流完整；尾随压缩字节也不能被静默忽略。
    if inflater.total_in() != entry.compressed_bytes
        || inflater.total_out() != entry.executable_bytes
        || format!("{:x}", hash.finalize()) != entry.executable_sha256
    {
        return Err(integrity());
    }
    let source = reader.into_inner().into_inner();
    source
        .seek(SeekFrom::Start(descriptor_offset))
        .map_err(|_| integrity())?;
    let mut descriptor = [0; 16];
    source
        .read_exact(&mut descriptor)
        .map_err(|_| integrity())?;
    let compressed = u32::try_from(entry.compressed_bytes).map_err(|_| integrity())?;
    let executable = u32::try_from(entry.executable_bytes).map_err(|_| integrity())?;
    if &descriptor[..4] != b"PK\x07\x08"
        || descriptor[4..8] != entry.crc32.to_le_bytes()
        || descriptor[8..12] != compressed.to_le_bytes()
        || descriptor[12..16] != executable.to_le_bytes()
    {
        return Err(integrity());
    }
    check_cancel(cancel)
}

pub(crate) async fn unpack_verified_zip(
    source: &mut File,
    destination: &mut File,
    cancel: &AtomicBool,
) -> Result<()> {
    unpack_entry(
        source,
        destination,
        cancel,
        &Entry {
            archive_bytes: ARCHIVE_BYTES,
            header_offset: 18_771_184,
            header: HEADER,
            compressed_bytes: 76_081_130,
            executable_bytes: EXECUTABLE_BYTES,
            executable_sha256: EXECUTABLE_SHA256,
            crc32: 0xa915_c39b,
        },
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

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::DeflateEncoder, Compression};
    use sha2::{Digest, Sha256};
    use std::io::Cursor;
    use std::sync::atomic::Ordering;

    struct Fixture {
        archive: Vec<u8>,
        header: Vec<u8>,
        compressed_bytes: u64,
        body: Vec<u8>,
        hash: String,
    }

    impl Fixture {
        fn new(body: Vec<u8>) -> Self {
            let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
            encoder.write_all(&body).unwrap();
            let compressed = encoder.finish().unwrap();
            let mut header = b"PK\x03\x04\x14\0\x08\0\x08\0".to_vec();
            header.extend_from_slice(&[0; 16]);
            header.extend_from_slice(&13u16.to_le_bytes());
            header.extend_from_slice(&0u16.to_le_bytes());
            header.extend_from_slice(b"codebuddy.exe");
            let mut archive = header.clone();
            archive.extend_from_slice(&compressed);
            archive.extend_from_slice(b"PK\x07\x08");
            archive.extend_from_slice(&0u32.to_le_bytes());
            archive.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
            archive.extend_from_slice(&(body.len() as u32).to_le_bytes());
            // 上层已经验证整份固定归档；这里仅模拟解码器不会访问的目录尾部。
            archive.extend_from_slice(b"synthetic central directory: never extract paths");
            Self {
                hash: format!("{:x}", Sha256::digest(&body)),
                compressed_bytes: compressed.len() as u64,
                archive,
                header,
                body,
            }
        }

        fn entry(&self) -> Entry<'_> {
            Entry {
                archive_bytes: self.archive.len() as u64,
                header_offset: 0,
                header: &self.header,
                compressed_bytes: self.compressed_bytes,
                executable_bytes: self.body.len() as u64,
                executable_sha256: &self.hash,
                crc32: 0,
            }
        }

        fn unpack(&self) -> Result<Vec<u8>> {
            let mut output = Vec::new();
            run(unpack_entry(
                &mut Cursor::new(&self.archive),
                &mut output,
                &AtomicBool::new(false),
                &self.entry(),
            ))?;
            Ok(output)
        }
    }

    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn fixed_member_is_inflated_without_extracting_archive_paths() {
        let fixture = Fixture::new(b"synthetic executable bytes, never execute".repeat(6000));
        assert_eq!(fixture.unpack().unwrap(), fixture.body);
    }

    #[test]
    fn wrong_header_descriptor_hash_and_size_are_rejected() {
        for mutation in 0..6 {
            let mut fixture = Fixture::new(b"synthetic runtime".repeat(500));
            match mutation {
                0 => fixture.archive[30] = b'/',
                1 => fixture.archive[6] |= 1,
                2 => fixture.archive[8] = 0,
                3 => fixture.hash = "0".repeat(64),
                4 => fixture.archive[fixture.header.len() + fixture.compressed_bytes as usize] = 0,
                _ => fixture.body.push(0),
            }
            assert_eq!(
                fixture.unpack().unwrap_err().code,
                "harness_runtime_integrity"
            );
        }
    }

    #[test]
    fn inflated_size_limit_stops_before_writing_excess_bytes() {
        let fixture = Fixture::new(vec![b'x'; 200_000]);
        let mut entry = fixture.entry();
        entry.executable_bytes = 100;
        let mut output = Vec::new();
        let result = run(unpack_entry(
            &mut Cursor::new(&fixture.archive),
            &mut output,
            &AtomicBool::new(false),
            &entry,
        ));
        assert_eq!(result.unwrap_err().code, "harness_runtime_integrity");
        assert!(output.len() <= 100);
    }

    #[test]
    fn truncated_or_trailing_compressed_bytes_are_rejected() {
        for adjustment in [-1i64, 1] {
            let fixture = Fixture::new(b"test bounded stream".repeat(2000));
            let mut entry = fixture.entry();
            entry.compressed_bytes = (entry.compressed_bytes as i64 + adjustment) as u64;
            let mut output = Vec::new();
            let result = run(unpack_entry(
                &mut Cursor::new(&fixture.archive),
                &mut output,
                &AtomicBool::new(false),
                &entry,
            ));
            assert_eq!(result.unwrap_err().code, "harness_runtime_integrity");
        }
    }

    #[test]
    fn cancellation_interrupts_inflation_after_a_bounded_write() {
        struct CancellingWriter<'a> {
            cancel: &'a AtomicBool,
            bytes: usize,
        }
        impl Write for CancellingWriter<'_> {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.bytes += bytes.len();
                self.cancel.store(true, Ordering::Release);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let fixture = Fixture::new(vec![b'x'; 1_000_000]);
        let cancel = AtomicBool::new(false);
        let mut output = CancellingWriter {
            cancel: &cancel,
            bytes: 0,
        };
        let result = run(unpack_entry(
            &mut Cursor::new(&fixture.archive),
            &mut output,
            &cancel,
            &fixture.entry(),
        ));
        assert_eq!(result.unwrap_err().code, "cancelled");
        assert!(output.bytes > 0 && output.bytes <= 64 * 1024);
    }

    #[test]
    fn pre_cancelled_prepare_does_not_touch_the_supplied_root() {
        let error = run(prepare(
            Path::new("not-an-absolute-root"),
            &AtomicBool::new(true),
            &|_, _| {},
        ))
        .unwrap_err();
        assert_eq!(error.code, "cancelled");
    }

    #[test]
    #[ignore = "需显式设置 SHIROHA_CODEBUDDY_TEST_ARCHIVE，仅读取已下载的固定官方 ZIP，不访问网络或执行 EXE"]
    fn verified_local_official_zip_matches_the_fixed_executable() {
        use std::fs::{self, OpenOptions};
        struct TemporaryOutput {
            path: PathBuf,
            file: Option<File>,
        }
        impl Drop for TemporaryOutput {
            fn drop(&mut self) {
                self.file.take();
                let _ = fs::remove_file(&self.path);
            }
        }
        let archive = PathBuf::from(
            std::env::var_os("SHIROHA_CODEBUDDY_TEST_ARCHIVE")
                .expect("set an absolute path to the previously downloaded official ZIP"),
        );
        assert!(archive.is_absolute());
        crate::paths::reject_links(&archive).unwrap();
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(1).custom_flags(0x0020_0000);
        }
        let mut source = options.open(archive).unwrap();
        assert_eq!(source.metadata().unwrap().len(), ARCHIVE_BYTES);
        let mut hash = Sha256::new();
        let mut buffer = [0; BUFFER_BYTES];
        loop {
            let count = source.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        assert_eq!(format!("{:x}", hash.finalize()), ARCHIVE_SHA256);
        let path = std::env::temp_dir().join(format!(
            "shiroha-codebuddy-unpack-{}.fixture",
            uuid::Uuid::new_v4()
        ));
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        let mut output = TemporaryOutput {
            path,
            file: Some(file),
        };
        let file = output.file.as_mut().unwrap();
        run(unpack_verified_zip(
            &mut source,
            file,
            &AtomicBool::new(false),
        ))
        .unwrap();
        assert_eq!(file.metadata().unwrap().len(), EXECUTABLE_BYTES);
        file.rewind().unwrap();
        let mut hash = Sha256::new();
        loop {
            let count = file.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        assert_eq!(format!("{:x}", hash.finalize()), EXECUTABLE_SHA256);
    }
}
