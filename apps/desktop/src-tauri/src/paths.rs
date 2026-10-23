use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

// 数据根锁由进程上下文持有至退出；数据库、迁移和媒体共享同一写入所有权。
pub struct DataRoot {
    pub path: PathBuf,
    _lock: File,
}

pub fn reject_links(path: &Path) -> std::io::Result<()> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err(std::io::Error::other("linked data path"));
                    }
                }
                if metadata.is_symlink() {
                    return Err(std::io::Error::other("linked data path"));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

impl DataRoot {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        reject_links(path)?;
        fs::create_dir_all(path)?;
        let path = fs::canonicalize(path)?;
        let lock_path = path.join("writer.lock");
        reject_links(&lock_path)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        lock.try_lock()
            .map_err(|_| std::io::Error::other("data root already in use"))?;
        for name in ["media", "temporary", "snapshots", "logs"] {
            let directory = path.join(name);
            reject_links(&directory)?;
            fs::create_dir_all(directory)?;
        }
        Ok(Self { path, _lock: lock })
    }
}

#[cfg(any(test, feature = "native-test"))]
pub fn test_root(path: &Path, temporary: &Path) -> std::io::Result<PathBuf> {
    reject_links(path)?;
    let root = fs::canonicalize(path)?;
    let temporary = fs::canonicalize(temporary)?;
    reject_links(&root.join("test-isolation"))?;
    if root.parent() != Some(temporary.as_path())
        || !root
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("shiroha-native-"))
        || fs::read_to_string(root.join("test-isolation"))? != "fake-credentials\nnetwork-denied\n"
    {
        return Err(std::io::Error::other("invalid test isolation"));
    }
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory() -> PathBuf {
        let id = uuid::Uuid::new_v4();
        let path = std::env::temp_dir().join(format!("shiroha-native-{}-{id}", std::process::id()));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn rejects_missing_manifest_and_outside_test_root() {
        let path = directory();
        assert!(test_root(&path, &std::env::temp_dir()).is_err());
        fs::write(
            path.join("test-isolation"),
            "fake-credentials\nnetwork-denied\n",
        )
        .unwrap();
        assert_eq!(
            test_root(&path, &std::env::temp_dir()).unwrap(),
            fs::canonicalize(&path).unwrap()
        );
        assert!(test_root(&path, &path).is_err());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn only_one_writer_until_owner_drops() {
        let path = directory();
        let owner = DataRoot::open(&path).unwrap();
        assert_eq!(owner.path, fs::canonicalize(&path).unwrap());
        assert!(DataRoot::open(&path).is_err());
        drop(owner);
        drop(DataRoot::open(&path).unwrap());
        fs::remove_dir_all(path).unwrap();
    }
}
