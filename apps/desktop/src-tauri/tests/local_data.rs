use serde_json::{json, Value};
use shiroha_quiz_desktop::storage::Store;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("shiroha-native-{}-{id}", std::process::id()));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn snapshot() -> Value {
    json!({"schemaVersion":1,"banks":[{"id":"a","name":"中文","extension":{"kept":true},"questions":[{"id":"q","type":"single","question":"内容","options":[],"answer":[],"rich":{"unknown":"preserved"}}]}, {"id":"b","name":"B","questions":[{"id":"q","type":"blank","question":"other","options":[],"answer":[]}]}], "activeBankId":"a", "wrongBook":{},"favorites":{},"records":[{"id":"r","snapshot":{"question":"history"}}],"settings":{},"crossPlatformMeta":{}})
}

#[test]
fn corrupt_database_recovery_switches_only_after_validation_and_keeps_original() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("one", 0, &snapshot()).unwrap();
    let checkpoint = store.checkpoint().unwrap();
    let name = checkpoint.file_name().unwrap().to_str().unwrap().to_owned();
    drop(store);
    fs::write(f.0.join("library.sqlite3"), b"corrupted original bytes").unwrap();
    assert!(Store::open(&f.0).is_err());
    assert!(Store::recover(&f.0, "../outside").is_err());
    assert!(!f.0.join("active.json").exists());
    Store::recover(&f.0, &name).unwrap();
    assert_eq!(
        fs::read(f.0.join("library.sqlite3")).unwrap(),
        b"corrupted original bytes"
    );
    let mut recovered = Store::open(&f.0).unwrap();
    assert_eq!(recovered.read().unwrap(), Some(snapshot()));
    recovered.write("after-repair", 1, &snapshot()).unwrap();
    drop(recovered);
    assert_eq!(Store::open(&f.0).unwrap().revision().unwrap(), 2);
}

#[test]
fn recovery_import_rejects_invalid_data_and_keeps_failed_source() {
    let f = Fixture::new();
    fs::write(f.0.join("library.sqlite3"), b"original broken database").unwrap();
    let mut invalid = snapshot();
    invalid["settings"]["apiKey"] = json!("fake-key");
    assert!(Store::recover_import(&f.0, &invalid).is_err());
    assert!(!f.0.join("active.json").exists());
    Store::recover_import(&f.0, &snapshot()).unwrap();
    assert_eq!(Store::open(&f.0).unwrap().read().unwrap(), Some(snapshot()));
    assert_eq!(
        fs::read(f.0.join("library.sqlite3")).unwrap(),
        b"original broken database"
    );
}

#[test]
fn summary_and_batch_details_preserve_scope_without_loading_bodies() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("initial", 0, &snapshot()).unwrap();
    let index = store.summary().unwrap().unwrap();
    assert_eq!(index["banks"][0]["questions"][0]["id"], "q");
    assert_eq!(index["banks"][0]["questions"][0]["question"], "");
    assert_eq!(index["banks"].as_array().unwrap().len(), 2);
    assert_eq!(
        store.details("questions", "b", &["q".into()], 1).unwrap()[0]["question"],
        "other"
    );
    assert!(store
        .details("questions", "a", &["missing".into()], 1)
        .is_err());
    assert!(store.details("questions", "a", &["q".into()], 0).is_err());
    use shiroha_quiz_desktop::changes::Change;
    store
        .commit(
            "rename",
            1,
            vec![Change::PutBankMetadata {
                bank: json!({"id":"a","name":"renamed","extension":{"kept":true}}),
            }],
        )
        .unwrap();
    assert_eq!(
        store.read().unwrap().unwrap()["banks"][0]["questions"],
        snapshot()["banks"][0]["questions"]
    );
}

#[test]
fn persists_rich_fields_and_deduplicates_operations_after_restart() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    assert!(store.read().unwrap().is_none());
    assert_eq!(store.write("one", 0, &snapshot()).unwrap(), 1);
    drop(store);
    let mut store = Store::open(&f.0).unwrap();
    assert_eq!(store.read().unwrap(), Some(snapshot()));
    assert_eq!(store.write("one", 0, &snapshot()).unwrap(), 1);
    let mut changed = snapshot();
    changed["banks"][0]["name"] = json!("changed");
    assert_eq!(
        store.write("one", 0, &changed).unwrap_err().code,
        "duplicate_operation"
    );
    assert_eq!(
        store.write("two", 0, &changed).unwrap_err().code,
        "revision_conflict"
    );
    assert_eq!(store.read().unwrap(), Some(snapshot()));
}

#[test]
fn invalid_or_secret_input_preserves_previous_data() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("one", 0, &snapshot()).unwrap();
    for secret in ["apiKey", "password", "credentialRef"] {
        let mut changed = snapshot();
        changed["settings"][secret] = json!("fake-secret");
        assert_eq!(
            store.write("two", 1, &changed).unwrap_err().code,
            "sensitive_data"
        );
    }
    let mut invalid = snapshot();
    invalid["banks"][1]["id"] = json!("a");
    assert!(store.write("two", 1, &invalid).is_err());
    assert_eq!(store.read().unwrap(), Some(snapshot()));
}

#[test]
fn dangling_media_reference_never_becomes_committed_data() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("initial", 0, &snapshot()).unwrap();
    let mut changed = snapshot();
    changed["banks"][0]["questions"][0]["images"] =
        json!([format!("shiroha-media:{}:png", "0".repeat(64))]);
    assert!(store.write("dangling", 1, &changed).is_err());
    assert_eq!(store.revision().unwrap(), 1);
    assert_eq!(store.read().unwrap(), Some(snapshot()));
}

#[test]
fn transaction_failure_and_future_schema_do_not_overwrite_data() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("one", 0, &snapshot()).unwrap();
    let db = rusqlite::Connection::open(f.0.join("library.sqlite3")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_write BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
    let mut changed = snapshot();
    changed["banks"][0]["name"] = json!("changed");
    assert!(store.write("two", 1, &changed).is_err());
    assert_eq!(store.read().unwrap(), Some(snapshot()));
    assert_eq!(store.revision().unwrap(), 1);
    drop(store);
    db.pragma_update(None, "user_version", 999).unwrap();
    drop(db);
    assert_eq!(Store::open(&f.0).err().unwrap().code, "unsupported_version");
}

#[test]
fn snapshot_includes_wal_and_media_and_blocks_on_missing_media() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    let mut data = snapshot();
    data["banks"][0]["questions"][0]["image"]=json!("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==");
    store.write("one", 0, &data).unwrap();
    assert_eq!(store.read().unwrap(), Some(data.clone()));
    let checkpoint = store.checkpoint().unwrap();
    let restored = Store::open(&checkpoint).unwrap();
    assert_eq!(restored.read().unwrap(), Some(data));
    drop(restored);
    let media = fs::read_dir(f.0.join("media"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::remove_file(media).unwrap();
    assert!(store.checkpoint().is_err());
}

#[test]
fn migration_is_idempotent_and_never_overwrites_an_existing_target() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    assert_eq!(store.migrate(&snapshot()).unwrap(), 1);
    let mut edited = snapshot();
    edited["banks"][0]["name"] = json!("edited after migration");
    store.write("edit", 1, &edited).unwrap();
    assert_eq!(store.migrate(&snapshot()).unwrap(), 1);
    assert_eq!(store.read().unwrap(), Some(edited.clone()));
    assert_eq!(
        store.migrate(&edited).unwrap_err().code,
        "revision_conflict"
    );
}

#[test]
fn overwrite_requires_valid_snapshot_and_reset_keeps_a_recovery_point() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("one", 0, &snapshot()).unwrap();
    let empty = json!({"schemaVersion":1,"banks":[],"activeBankId":"","wrongBook":{},"favorites":{},"records":[],"settings":{},"crossPlatformMeta":{}});
    store.replace("reset", 1, &empty).unwrap();
    assert_eq!(store.read().unwrap(), Some(empty));
    let checkpoints = fs::read_dir(f.0.join("snapshots"))
        .unwrap()
        .collect::<Vec<_>>();
    assert_eq!(checkpoints.len(), 1);
    let saved = Store::open(&checkpoints[0].as_ref().unwrap().path()).unwrap();
    assert_eq!(saved.read().unwrap(), Some(snapshot()));
}

#[test]
fn paginated_queries_keep_identity_and_reject_changed_revisions() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("one", 0, &snapshot()).unwrap();
    let page = store.page("banks", "", None, 1).unwrap();
    assert_eq!(page["items"][0]["id"], "a");
    assert_eq!(page["items"][0]["questionCount"], 1);
    assert!(page["items"][0].get("questions").is_none());
    let cursor = page["nextCursor"].as_str().unwrap();
    assert_eq!(
        store.page("banks", "", Some(cursor), 1).unwrap()["items"][0]["id"],
        "b"
    );
    assert_eq!(
        store.page("questions", "b", None, 1).unwrap()["items"][0]["question"],
        "other"
    );
    store.write("two", 1, &snapshot()).unwrap();
    assert_eq!(
        store.page("banks", "", Some(cursor), 1).unwrap_err().code,
        "revision_conflict"
    );
    assert!(store.page("sql", "", None, 1).is_err());
    assert!(store.page("banks", "", None, 0).is_err());
}

#[test]
fn incremental_changes_do_not_rewrite_unrelated_questions_or_lose_unloaded_records() {
    use shiroha_quiz_desktop::changes::Change;
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("one", 0, &snapshot()).unwrap();
    let db = rusqlite::Connection::open(f.0.join("library.sqlite3")).unwrap();
    db.execute_batch("CREATE TRIGGER protect_questions BEFORE UPDATE ON entries WHEN old.category LIKE 'questions:%' BEGIN SELECT RAISE(ABORT, 'unrelated question write'); END;").unwrap();
    let changes = vec![Change::PutRecord {
        record: json!({"id":"new","question":"new result"}),
    }];
    store.commit("delta", 1, changes).unwrap();
    assert_eq!(
        store.read().unwrap().unwrap()["records"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let duplicate = vec![Change::PutRecord {
        record: json!({"id":"new","question":"new result"}),
    }];
    assert_eq!(store.commit("delta", 1, duplicate).unwrap(), 2);
    assert_eq!(
        store
            .commit(
                "delta",
                1,
                vec![Change::DeleteRecord {
                    record_id: "r".into()
                }]
            )
            .unwrap_err()
            .code,
        "duplicate_operation"
    );
}

#[test]
fn interrupted_transaction_child() {
    let Some(root) = std::env::var_os("SHIROHA_CRASH_FIXTURE") else {
        return;
    };
    let root = PathBuf::from(root);
    assert!(root
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("shiroha-native-"));
    let db = rusqlite::Connection::open(root.join("library.sqlite3")).unwrap();
    db.execute_batch("BEGIN IMMEDIATE; UPDATE entries SET payload='{}' WHERE category='banks'; UPDATE metadata SET revision=99; INSERT INTO operations(id,digest,revision) VALUES('interrupted','fixture',99);").unwrap();
    std::process::exit(77);
}
#[test]
fn process_exit_mid_transaction_reopens_committed_state() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("committed", 0, &snapshot()).unwrap();
    drop(store);
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "interrupted_transaction_child", "--nocapture"])
        .env("SHIROHA_CRASH_FIXTURE", &f.0)
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(77));
    let store = Store::open(&f.0).unwrap();
    assert_eq!(store.read().unwrap(), Some(snapshot()));
    assert_eq!(store.revision().unwrap(), 1);
    assert_eq!(store.operation("interrupted").unwrap(), None);
    assert_eq!(store.operation("committed").unwrap(), Some(1));
}
#[test]
fn incomplete_and_invalid_recovery_never_activate() {
    let f = Fixture::new();
    let mut store = Store::open(&f.0).unwrap();
    store.write("one", 0, &snapshot()).unwrap();
    let point = store.checkpoint().unwrap();
    drop(store);
    fs::write(f.0.join("library.sqlite3"), b"broken source").unwrap();
    fs::write(point.join("library.sqlite3"), b"broken snapshot").unwrap();
    assert!(Store::recover(&f.0, point.file_name().unwrap().to_str().unwrap()).is_err());
    assert!(!f.0.join("active.json").exists());
    fs::remove_file(point.join("complete")).unwrap();
    assert!(Store::recovery_snapshots(&f.0).unwrap().is_empty());
    assert_eq!(
        fs::read(f.0.join("library.sqlite3")).unwrap(),
        b"broken source"
    );
}

#[test]
fn large_library_summary_and_details_keep_all_ids_without_bodies() {
    let f = Fixture::new();
    let mut data = snapshot();
    for bank in data["banks"].as_array_mut().unwrap() {
        bank["questions"]=json!((0..2500).map(|i|json!({"id":format!("q{i}"),"number":i+1,"type":"single","question":"fixture body ".repeat(100),"options":[],"answer":[],"extension":{"kept":true}})).collect::<Vec<_>>());
    }
    let mut store = Store::open(&f.0).unwrap();
    store.write("large", 0, &data).unwrap();
    let index = store.summary().unwrap().unwrap();
    assert_eq!(
        index["banks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["questions"].as_array().unwrap().len())
            .sum::<usize>(),
        5000
    );
    assert!(
        serde_json::to_vec(&index).unwrap().len() * 5 < serde_json::to_vec(&data).unwrap().len()
    );
    let ids = (2300..2500).map(|i| format!("q{i}")).collect::<Vec<_>>();
    let details = store.details("questions", "b", &ids, 1).unwrap();
    assert_eq!(details.len(), 200);
    assert_eq!(details[199], data["banks"][1]["questions"][2499]);
    assert_eq!(store.read().unwrap(), Some(data));
}
