use shiroha_quiz_desktop::files::Files;
use std::fs;

#[test]
fn grants_are_scoped_and_output_remains_untouched_until_finish() {
    let root = std::env::temp_dir().join(format!("shiroha-native-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let target = root.join("中文.json");
    fs::write(&target, b"original").unwrap();
    let mut files = Files::default();
    let token = files.authorize(&target, true).unwrap();
    assert!(files.read(&token.token, 0).is_err());
    assert!(files.append("forged", 0, b"bad").is_err());
    files.append(&token.token, 0, b"replacement").unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"original");
    files.finish(&token.token, 11).unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"replacement");
    assert!(files.append(&token.token, 11, b"late").is_err());
    let cancelled = files.authorize(&target, true).unwrap();
    files.append(&cancelled.token, 0, b"discard").unwrap();
    files.release(&cancelled.token).unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"replacement");
    let read = files.authorize(&target, false).unwrap();
    assert_eq!(files.read(&read.token, 0).unwrap(), b"replacement");
    files.release(&read.token).unwrap();
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_finalization_and_reordered_chunks_never_replace_target() {
    let root = std::env::temp_dir().join(format!("shiroha-native-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let target = root.join("backup.json");
    fs::write(&target, b"old").unwrap();
    let mut files = Files::default();
    let grant = files.authorize(&target, true).unwrap();
    assert!(files.append(&grant.token, 1, b"bad").is_err());
    files.append(&grant.token, 0, b"new").unwrap();
    assert!(files.finish(&grant.token, 100).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"old");
    files.release(&grant.token).unwrap();
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn corrupted_temporary_file_and_locked_target_preserve_original() {
    let root = std::env::temp_dir().join(format!("shiroha-native-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let target = root.join("备份.json");
    fs::write(&target, b"old").unwrap();
    let mut files = Files::default();
    let grant = files.authorize(&target, true).unwrap();
    files.append(&grant.token, 0, b"new").unwrap();
    let temporary = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.extension().is_some_and(|ext| ext == "tmp"))
        .unwrap();
    fs::write(&temporary, b"bad").unwrap();
    assert!(files.finish(&grant.token, 3).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"old");
    files.release(&grant.token).unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let grant = files.authorize(&target, true).unwrap();
        files.append(&grant.token, 0, b"new").unwrap();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&target)
            .unwrap();
        assert!(files.finish(&grant.token, 3).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old");
        drop(locked);
        files.release(&grant.token).unwrap();
    }
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn page_reinitialization_revokes_old_file_handles() {
    let root = std::env::temp_dir().join(format!("shiroha-native-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let target = root.join("backup.json");
    fs::write(&target, b"old").unwrap();
    let mut files = Files::default();
    let read = files.authorize(&target, false).unwrap();
    let write = files.authorize(&target, true).unwrap();
    files.append(&write.token, 0, b"partial").unwrap();
    files.reset().unwrap();
    assert!(files.read(&read.token, 0).is_err());
    assert!(files.finish(&write.token, 7).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"old");
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    drop(files);
    fs::remove_dir_all(root).unwrap();
}
