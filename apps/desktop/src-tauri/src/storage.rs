use crate::{
    error::{Error, Result},
    media,
    paths::{reject_links, DataRoot},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const SCHEMA_VERSION: u32 = 1;
const MAX_SNAPSHOT_BYTES: usize = 256 * 1024 * 1024;
type Entries = BTreeMap<(String, String), String>;
pub struct Store {
    connection: Connection,
    root: DataRoot,
    data: PathBuf,
}

pub fn validate(value: &Value) -> Result<()> {
    fn inspect(value: &Value, depth: usize) -> Result<()> {
        if depth > 100 {
            return Err(Error::new("invalid_input"));
        }
        match value {
            Value::Object(object) => {
                for (key, item) in object {
                    let normalized: String = key
                        .chars()
                        .filter(char::is_ascii_alphanumeric)
                        .flat_map(char::to_lowercase)
                        .collect();
                    if [
                        "apikey",
                        "aikey",
                        "aiapikey",
                        "minerutoken",
                        "accesstoken",
                        "refreshtoken",
                        "password",
                        "webdavpassword",
                        "secret",
                        "clientsecret",
                        "authorization",
                        "credentials",
                        "credential",
                        "credentialref",
                        "credentialreference",
                        "credentialid",
                        "credentialtarget",
                    ]
                    .contains(&normalized.as_str())
                    {
                        return Err(Error::new("sensitive_data"));
                    }
                    if ["__proto__", "constructor", "prototype"].contains(&key.as_str()) {
                        return Err(Error::new("invalid_input"));
                    }
                    inspect(item, depth + 1)?;
                }
            }
            Value::Array(items) => {
                for item in items {
                    inspect(item, depth + 1)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    inspect(value, 0)?;
    if value["schemaVersion"] != 1 {
        return Err(Error::new("unsupported_version"));
    }
    for field in ["wrongBook", "favorites", "settings", "crossPlatformMeta"] {
        if !value[field].is_object() {
            return Err(Error::new("invalid_input"));
        }
    }
    if !value["activeBankId"].is_string() {
        return Err(Error::new("invalid_input"));
    }
    let banks = value["banks"]
        .as_array()
        .ok_or_else(|| Error::new("invalid_input"))?;
    let records = value["records"]
        .as_array()
        .ok_or_else(|| Error::new("invalid_input"))?;
    unique_ids(banks)?;
    unique_ids(records)?;
    for bank in banks {
        if !bank["name"].is_string() {
            return Err(Error::new("invalid_input"));
        }
        let questions = bank["questions"]
            .as_array()
            .ok_or_else(|| Error::new("invalid_input"))?;
        unique_ids(questions)?;
        for question in questions {
            if !question["type"].is_string()
                || !question["question"].is_string()
                || !question["options"].is_array()
                || !question["answer"]
                    .as_array()
                    .is_some_and(|answers| answers.iter().all(Value::is_string))
            {
                return Err(Error::new("invalid_input"));
            }
        }
    }
    Ok(())
}
fn unique_ids(items: &[Value]) -> Result<()> {
    let mut ids = HashSet::new();
    for item in items {
        if !ids.insert(id(item)?.to_owned()) {
            return Err(Error::new("invalid_input"));
        }
    }
    Ok(())
}
fn id(item: &Value) -> Result<&str> {
    item["id"]
        .as_str()
        .filter(|id| !id.trim().is_empty() && id.len() <= 1024)
        .ok_or_else(|| Error::new("invalid_input"))
}

fn flatten(snapshot: &Value) -> Result<Entries> {
    let mut entries = Entries::new();
    let mut header = snapshot.clone();
    let object = header
        .as_object_mut()
        .ok_or_else(|| Error::new("invalid_input"))?;
    let banks = object
        .remove("banks")
        .ok_or_else(|| Error::new("invalid_input"))?;
    let records = object
        .remove("records")
        .ok_or_else(|| Error::new("invalid_input"))?;
    let mut bank_order = Vec::new();
    for bank in banks
        .as_array()
        .ok_or_else(|| Error::new("invalid_input"))?
    {
        let bank_id = id(bank)?.to_owned();
        bank_order.push(json!(bank_id));
        let mut metadata = bank.clone();
        let questions = metadata
            .as_object_mut()
            .ok_or_else(|| Error::new("invalid_input"))?
            .remove("questions")
            .ok_or_else(|| Error::new("invalid_input"))?;
        let mut order = Vec::new();
        for question in questions
            .as_array()
            .ok_or_else(|| Error::new("invalid_input"))?
        {
            let question_id = id(question)?;
            order.push(json!(question_id));
            entries.insert(
                (format!("questions:{bank_id}"), question_id.to_owned()),
                serde_json::to_string(question)?,
            );
        }
        entries.insert(
            ("question_order".into(), bank_id.clone()),
            serde_json::to_string(&order)?,
        );
        entries.insert(("banks".into(), bank_id), serde_json::to_string(&metadata)?);
    }
    let mut record_order = Vec::new();
    for record in records
        .as_array()
        .ok_or_else(|| Error::new("invalid_input"))?
    {
        let record_id = id(record)?;
        record_order.push(json!(record_id));
        entries.insert(
            ("records".into(), record_id.to_owned()),
            serde_json::to_string(record)?,
        );
    }
    entries.insert(
        ("order".into(), "banks".into()),
        serde_json::to_string(&bank_order)?,
    );
    entries.insert(
        ("order".into(), "records".into()),
        serde_json::to_string(&record_order)?,
    );
    for (key, value) in header
        .as_object()
        .ok_or_else(|| Error::new("invalid_input"))?
    {
        entries.insert(("state".into(), key.clone()), serde_json::to_string(value)?);
    }
    Ok(entries)
}

fn active_data(root: &Path) -> Result<PathBuf> {
    let marker = root.join("active.json");
    reject_links(&marker)?;
    if !marker.exists() {
        return Ok(root.to_owned());
    }
    if fs::metadata(&marker)?.len() > 128 {
        return Err(Error::new("corrupt_data"));
    }
    let generation: String = serde_json::from_slice(&fs::read(marker)?)?;
    if uuid::Uuid::parse_str(&generation).is_err() || generation.len() != 36 {
        return Err(Error::new("corrupt_data"));
    }
    let path = root.join("generations").join(generation);
    reject_links(&path)?;
    if !path.join("library.sqlite3").is_file() {
        return Err(Error::new("corrupt_data"));
    }
    Ok(path)
}
fn snapshot_names(root: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(root.join("snapshots"))? {
        let entry = entry?;
        reject_links(&entry.path())?;
        reject_links(&entry.path().join("complete"))?;
        if entry.file_type()?.is_dir() && entry.path().join("complete").is_file() {
            names.push(
                entry
                    .file_name()
                    .to_str()
                    .ok_or_else(|| Error::new("corrupt_data"))?
                    .to_owned(),
            );
        }
    }
    names.sort();
    Ok(names)
}

fn activate_generation(root: &Path, destination: &Path, generation: &str) -> Result<()> {
    use std::io::Write;
    let active = root.join("active.json");
    reject_links(&active)?;
    if active.exists() {
        fs::copy(&active, destination.join("previous-active.json"))?;
    }
    // 原始数据库/WAL 不移动不删除；只有完整恢复副本通过校验后才原子切换活动代。
    let temporary = root.join(format!("active-{generation}.pending"));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(serde_json::to_string(&generation)?.as_bytes())?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, active)?;
    Ok(())
}

impl Store {
    pub fn hydrate(&self, mut value: Value, revision: i64) -> Result<Value> {
        if revision != self.revision()? {
            return Err(Error::new("revision_conflict"));
        }
        if serde_json::to_vec(&value)?.len() > MAX_SNAPSHOT_BYTES {
            return Err(Error::new("response_too_large"));
        }
        media::transform(&mut value, &self.data.join("media"), true)?;
        Ok(value)
    }
    pub fn summary(&self) -> Result<Option<Value>> {
        let Some(mut snapshot) = self.read_raw()? else {
            return Ok(None);
        };
        for bank in snapshot["banks"]
            .as_array_mut()
            .ok_or_else(|| Error::new("corrupt_data"))?
        {
            for question in bank["questions"]
                .as_array_mut()
                .ok_or_else(|| Error::new("corrupt_data"))?
            {
                *question = json!({"id":question["id"],"type":question["type"],"number":question["number"],"question":"","options":[],"answer":[]});
            }
        }
        for record in snapshot["records"]
            .as_array_mut()
            .ok_or_else(|| Error::new("corrupt_data"))?
        {
            let source = record
                .as_object()
                .ok_or_else(|| Error::new("corrupt_data"))?;
            let mut summary = Map::new();
            for key in [
                "id",
                "mode",
                "name",
                "bankName",
                "date",
                "total",
                "answered",
                "correct",
                "wrong",
                "accuracy",
                "score",
                "totalScore",
                "passScore",
                "passed",
                "duration",
                "scopeType",
            ] {
                if let Some(value) = source.get(key) {
                    summary.insert(key.into(), value.clone());
                }
            }
            *record = Value::Object(summary);
        }
        Ok(Some(snapshot))
    }
    pub fn details(
        &self,
        collection: &str,
        bank_id: &str,
        ids: &[String],
        revision: i64,
    ) -> Result<Vec<Value>> {
        if revision != self.revision()? {
            return Err(Error::new("revision_conflict"));
        }
        if ids.is_empty() || ids.len() > 200 {
            return Err(Error::new("invalid_input"));
        }
        let category = match collection {
            "questions" => format!("questions:{bank_id}"),
            "records" => "records".into(),
            _ => return Err(Error::new("invalid_input")),
        };
        let mut result = Vec::new();
        let mut remaining = MAX_SNAPSHOT_BYTES;
        for id in ids {
            let mut item = self.entry(&category, id)?;
            media::transform_limited(&mut item, &self.data.join("media"), true, &mut remaining)?;
            result.push(item);
        }
        Ok(result)
    }
    pub fn has_data(&self) -> Result<bool> {
        Ok(self
            .connection
            .query_row("SELECT EXISTS(SELECT 1 FROM entries)", [], |row| row.get(0))?)
    }
    fn entry(&self, category: &str, id: &str) -> Result<Value> {
        let encoded: String = self.connection.query_row(
            "SELECT payload FROM entries WHERE category=?1 AND id=?2",
            params![category, id],
            |row| row.get(0),
        )?;
        Ok(serde_json::from_str(&encoded)?)
    }
    pub fn page(
        &self,
        kind: &str,
        bank_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<Value> {
        if !(1..=200).contains(&limit) {
            return Err(Error::new("invalid_input"));
        }
        let revision = self.revision()?;
        let offset = if let Some(cursor) = cursor {
            let (version, offset) = cursor
                .split_once(':')
                .ok_or_else(|| Error::new("invalid_input"))?;
            if version
                .parse::<i64>()
                .map_err(|_| Error::new("invalid_input"))?
                != revision
            {
                return Err(Error::new("revision_conflict"));
            }
            offset
                .parse::<usize>()
                .map_err(|_| Error::new("invalid_input"))?
        } else {
            0
        };
        let (order, category) = match kind {
            "banks" => (self.entry("order", "banks")?, "banks".to_owned()),
            "records" => (self.entry("order", "records")?, "records".to_owned()),
            "questions" => (
                self.entry("question_order", bank_id)?,
                format!("questions:{bank_id}"),
            ),
            _ => return Err(Error::new("invalid_input")),
        };
        let order = order.as_array().ok_or_else(|| Error::new("corrupt_data"))?;
        if offset > order.len() {
            return Err(Error::new("invalid_input"));
        }
        let mut items = Vec::new();
        for id in order.iter().skip(offset).take(limit) {
            let id = id.as_str().ok_or_else(|| Error::new("corrupt_data"))?;
            let mut item = self.entry(&category, id)?;
            if kind == "banks" {
                item["questionCount"] = json!(self
                    .entry("question_order", id)?
                    .as_array()
                    .ok_or_else(|| Error::new("corrupt_data"))?
                    .len());
            } else {
                media::transform(&mut item, &self.data.join("media"), true)?;
            }
            items.push(item);
        }
        let next = offset + items.len();
        Ok(
            json!({"revision":revision,"items":items,"nextCursor":if next<order.len(){Some(format!("{revision}:{next}"))}else{None}}),
        )
    }
    pub fn snapshots(&self) -> Result<Vec<String>> {
        snapshot_names(&self.root.path)
    }
    pub fn recovery_snapshots(path: &Path) -> Result<Vec<String>> {
        let root = DataRoot::open(path)?;
        snapshot_names(&root.path)
    }
    pub fn recover(path: &Path, snapshot_id: &str) -> Result<()> {
        let root = DataRoot::open(path)?;
        if !snapshot_names(&root.path)?
            .iter()
            .any(|name| name == snapshot_id)
        {
            return Err(Error::new("permission_denied"));
        }
        let source = Store::open(&root.path.join("snapshots").join(snapshot_id))?;
        let expected = source.read()?.ok_or_else(|| Error::new("corrupt_data"))?;
        let generations = root.path.join("generations");
        reject_links(&generations)?;
        fs::create_dir_all(&generations)?;
        let generation = uuid::Uuid::new_v4().to_string();
        let destination = generations.join(&generation);
        fs::create_dir(&destination)?;
        fs::create_dir(destination.join("media"))?;
        let mut database = Connection::open(destination.join("library.sqlite3"))?;
        {
            let backup = rusqlite::backup::Backup::new(&source.connection, &mut database)?;
            backup.run_to_completion(128, Duration::from_millis(1), None)?;
        }
        drop(database);
        for entry in fs::read_dir(source.data.join("media"))? {
            let entry = entry?;
            reject_links(&entry.path())?;
            if entry.file_type()?.is_file() && entry.file_name().to_string_lossy().len() == 64 {
                fs::copy(
                    entry.path(),
                    destination.join("media").join(entry.file_name()),
                )?;
            }
        }
        let check = Store::open(&destination)?;
        if check.read()? != Some(expected) {
            return Err(Error::new("integrity_failed"));
        }
        drop(check);
        activate_generation(&root.path, &destination, &generation)
    }
    pub fn recover_import(path: &Path, snapshot: &Value) -> Result<()> {
        validate(snapshot)?;
        let root = DataRoot::open(path)?;
        let generations = root.path.join("generations");
        reject_links(&generations)?;
        fs::create_dir_all(&generations)?;
        let generation = uuid::Uuid::new_v4().to_string();
        let destination = generations.join(&generation);
        let mut store = Store::open(&destination)?;
        store.write("recovery-import", 0, snapshot)?;
        if store.read()?.as_ref() != Some(snapshot) {
            return Err(Error::new("integrity_failed"));
        }
        drop(store);
        activate_generation(&root.path, &destination, &generation)
    }
    pub fn restore(
        &mut self,
        snapshot_id: &str,
        operation: &str,
        expected_revision: i64,
    ) -> Result<i64> {
        if !self.snapshots()?.iter().any(|name| name == snapshot_id) {
            return Err(Error::new("permission_denied"));
        }
        let source = Store::open(&self.root.path.join("snapshots").join(snapshot_id))?;
        let snapshot = source.read()?.ok_or_else(|| Error::new("corrupt_data"))?;
        drop(source);
        self.replace(operation, expected_revision, &snapshot)
    }
    pub fn migrate(&mut self, source: &Value) -> Result<i64> {
        validate(source)?;
        let bytes = serde_json::to_vec(source)?;
        let hash = media::digest(&bytes);
        let operation = format!("migration-{hash}");
        if let Some(revision) = self.operation(&operation)? {
            return Ok(revision);
        }
        if self.read_raw()?.is_some() || self.revision()? != 0 {
            return Err(Error::new("revision_conflict"));
        }
        let recovery = self
            .root
            .path
            .join("snapshots")
            .join(format!("migration-{hash}.json"));
        reject_links(&recovery)?;
        if recovery.exists() {
            if fs::read(&recovery)? != bytes {
                return Err(Error::new("integrity_failed"));
            }
        } else {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&recovery)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }
        // 来源摘要即持久操作标记，与业务数据同事务提交；秘密不进入恢复副本。
        self.write(&operation, 0, source)
    }
    pub fn replace(
        &mut self,
        operation: &str,
        expected_revision: i64,
        snapshot: &Value,
    ) -> Result<i64> {
        validate(snapshot)?;
        if self.operation(operation)?.is_some() {
            return self.write(operation, expected_revision, snapshot);
        }
        if self.revision()? != expected_revision {
            return Err(Error::new("revision_conflict"));
        }
        self.checkpoint()?;
        self.write(operation, expected_revision, snapshot)
    }
    pub fn open(path: &Path) -> Result<Self> {
        let root = DataRoot::open(path)?;
        let data = active_data(&root.path)?;
        let file = data.join("library.sqlite3");
        for suffix in [
            "library.sqlite3",
            "library.sqlite3-wal",
            "library.sqlite3-shm",
        ] {
            reject_links(&data.join(suffix))?;
        }
        let connection = Connection::open(file)?;
        connection.busy_timeout(Duration::from_secs(2))?;
        let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(Error::new("unsupported_version"));
        }
        let integrity: String =
            connection.pragma_query_value(None, "quick_check", |row| row.get(0))?;
        if integrity != "ok" {
            return Err(Error::new("corrupt_data"));
        }
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        if version == 0 {
            let count: i64 = connection.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'",
                [],
                |row| row.get(0),
            )?;
            if count != 0 {
                return Err(Error::new("corrupt_data"));
            }
            connection.execute_batch(include_str!("../migrations/001.sql"))?;
        }
        Ok(Self {
            connection,
            root,
            data,
        })
    }
    pub fn revision(&self) -> Result<i64> {
        Ok(self
            .connection
            .query_row("SELECT revision FROM metadata WHERE id=1", [], |row| {
                row.get(0)
            })?)
    }
    pub fn has_legacy_migration(&self) -> Result<bool> {
        Ok(self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM operations WHERE id LIKE 'migration-%')",
            [],
            |row| row.get(0),
        )?)
    }
    pub fn operation(&self, operation: &str) -> Result<Option<i64>> {
        Ok(self
            .connection
            .query_row(
                "SELECT revision FROM operations WHERE id=?1",
                [operation],
                |row| row.get(0),
            )
            .optional()?)
    }
    fn entries(&self) -> Result<Entries> {
        let mut statement = self
            .connection
            .prepare("SELECT category,id,payload FROM entries")?;
        let rows = statement.query_map([], |row| Ok(((row.get(0)?, row.get(1)?), row.get(2)?)))?;
        Ok(rows.collect::<std::result::Result<Entries, _>>()?)
    }
    fn read_raw(&self) -> Result<Option<Value>> {
        let entries = self.entries()?;
        if entries.is_empty() {
            return Ok(None);
        }
        let get = |category: &str, id: &str| -> Result<Value> {
            Ok(serde_json::from_str(
                entries
                    .get(&(category.to_owned(), id.to_owned()))
                    .ok_or_else(|| Error::new("corrupt_data"))?,
            )?)
        };
        let mut state = Map::new();
        for ((category, id), payload) in &entries {
            if category == "state" {
                state.insert(id.clone(), serde_json::from_str(payload)?);
            }
        }
        let mut banks = Vec::new();
        for bank_id in get("order", "banks")?
            .as_array()
            .ok_or_else(|| Error::new("corrupt_data"))?
        {
            let bank_id = bank_id.as_str().ok_or_else(|| Error::new("corrupt_data"))?;
            let mut bank = get("banks", bank_id)?;
            let mut questions = Vec::new();
            for question_id in get("question_order", bank_id)?
                .as_array()
                .ok_or_else(|| Error::new("corrupt_data"))?
            {
                questions.push(get(
                    &format!("questions:{bank_id}"),
                    question_id
                        .as_str()
                        .ok_or_else(|| Error::new("corrupt_data"))?,
                )?);
            }
            bank["questions"] = json!(questions);
            banks.push(bank);
        }
        let mut records = Vec::new();
        for record_id in get("order", "records")?
            .as_array()
            .ok_or_else(|| Error::new("corrupt_data"))?
        {
            records.push(get(
                "records",
                record_id
                    .as_str()
                    .ok_or_else(|| Error::new("corrupt_data"))?,
            )?);
        }
        state.insert("banks".into(), json!(banks));
        state.insert("records".into(), json!(records));
        Ok(Some(Value::Object(state)))
    }
    pub fn read(&self) -> Result<Option<Value>> {
        let mut value = self.read_raw()?;
        if let Some(value) = &mut value {
            media::transform(value, &self.data.join("media"), true)?;
            validate(value)?;
        }
        Ok(value)
    }
    pub fn write(
        &mut self,
        operation: &str,
        expected_revision: i64,
        snapshot: &Value,
    ) -> Result<i64> {
        self.write_digest(operation, expected_revision, snapshot, None)
    }
    pub fn commit(
        &mut self,
        operation: &str,
        expected_revision: i64,
        changes: Vec<crate::changes::Change>,
    ) -> Result<i64> {
        if changes.is_empty() || changes.len() > 100_000 {
            return Err(Error::new("invalid_input"));
        }
        let encoded = serde_json::to_vec(&changes)?;
        if encoded.len() > MAX_SNAPSHOT_BYTES {
            return Err(Error::new("response_too_large"));
        }
        let hash = format!("changes:{}:{}", expected_revision, media::digest(&encoded));
        let previous: Option<(String, i64)> = self
            .connection
            .query_row(
                "SELECT digest,revision FROM operations WHERE id=?1",
                [operation],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((stored, revision)) = previous {
            return if stored == hash {
                Ok(revision)
            } else {
                Err(Error::new("duplicate_operation"))
            };
        }
        if self.revision()? != expected_revision {
            return Err(Error::new("revision_conflict"));
        }
        let mut snapshot = self.read_raw()?.ok_or_else(|| Error::new("not_ready"))?;
        crate::changes::apply(&mut snapshot, changes)?;
        self.write_digest(operation, expected_revision, &snapshot, Some(hash))
    }
    fn write_digest(
        &mut self,
        operation: &str,
        expected_revision: i64,
        snapshot: &Value,
        request_digest: Option<String>,
    ) -> Result<i64> {
        validate(snapshot)?;
        let encoded = serde_json::to_vec(snapshot)?;
        if encoded.len() > MAX_SNAPSHOT_BYTES || operation.is_empty() || operation.len() > 256 {
            return Err(Error::new("invalid_input"));
        }
        let hash = request_digest
            .unwrap_or_else(|| format!("snapshot:{expected_revision}:{}", media::digest(&encoded)));
        let prior: Option<(String, i64)> = self
            .connection
            .query_row(
                "SELECT digest,revision FROM operations WHERE id=?1",
                [operation],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((old, revision)) = prior {
            return if old == hash {
                Ok(revision)
            } else {
                Err(Error::new("duplicate_operation"))
            };
        }
        if self.revision()? != expected_revision {
            return Err(Error::new("revision_conflict"));
        }
        let mut stored = snapshot.clone();
        media::transform(&mut stored, &self.data.join("media"), false)?;
        media::verify_references(&stored, &self.data.join("media"))?;
        let next = flatten(&stored)?;
        let previous = self.entries()?;
        // 同一原生 mutex 和根锁覆盖媒体落地、差量更新、修订及操作回执。
        let transaction = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        for ((category, id), payload) in &next {
            if previous.get(&(category.clone(), id.clone())) != Some(payload) {
                transaction.execute("INSERT INTO entries(category,id,payload) VALUES(?1,?2,?3) ON CONFLICT(category,id) DO UPDATE SET payload=excluded.payload", params![category,id,payload])?;
            }
        }
        for (category, id) in previous.keys() {
            if !next.contains_key(&(category.clone(), id.clone())) {
                transaction.execute(
                    "DELETE FROM entries WHERE category=?1 AND id=?2",
                    params![category, id],
                )?;
            }
        }
        let revision = expected_revision
            .checked_add(1)
            .ok_or_else(|| Error::new("invalid_input"))?;
        transaction.execute(
            "UPDATE metadata SET revision=?1 WHERE id=1 AND revision=?2",
            params![revision, expected_revision],
        )?;
        transaction.execute(
            "INSERT INTO operations(id,digest,revision) VALUES(?1,?2,?3)",
            params![operation, hash, revision],
        )?;
        transaction.commit()?;
        Ok(revision)
    }
    pub fn checkpoint(&self) -> Result<PathBuf> {
        let before = self.read()?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::new("storage_unavailable"))?
            .as_nanos();
        let destination = self
            .root
            .path
            .join("snapshots")
            .join(format!("revision-{}-{timestamp}", self.revision()?));
        reject_links(&destination)?;
        fs::create_dir(&destination)?;
        fs::create_dir(destination.join("media"))?;
        // SQLite backup API 包含 WAL 中已提交内容；快照不做自动回收。
        let mut database = Connection::open(destination.join("library.sqlite3"))?;
        {
            let backup = rusqlite::backup::Backup::new(&self.connection, &mut database)?;
            backup.run_to_completion(128, Duration::from_millis(1), None)?;
        }
        drop(database);
        for file in fs::read_dir(self.data.join("media"))? {
            let file = file?;
            reject_links(&file.path())?;
            if file.file_type()?.is_file() && file.file_name().to_string_lossy().len() == 64 {
                fs::copy(
                    file.path(),
                    destination.join("media").join(file.file_name()),
                )?;
            }
        }
        let check = Store::open(&destination)?;
        if check.read()? != before {
            return Err(Error::new("integrity_failed"));
        }
        drop(check);
        fs::write(destination.join("complete"), b"1")?;
        Ok(destination)
    }
}

#[cfg(test)]
mod fault_tests {
    use super::*;
    #[test]
    fn sqlite_full_and_read_only_preserve_revision_and_receipts() {
        let root = std::env::temp_dir().join(format!("shiroha-native-{}", uuid::Uuid::new_v4()));
        let mut store = Store::open(&root).unwrap();
        let original = json!({"schemaVersion":1,"banks":[],"records":[],"activeBankId":"","wrongBook":{},"favorites":{},"settings":{},"crossPlatformMeta":{}});
        store.write("initial", 0, &original).unwrap();
        let pages: i64 = store
            .connection
            .pragma_query_value(None, "page_count", |row| row.get(0))
            .unwrap();
        store
            .connection
            .pragma_update(None, "max_page_count", pages)
            .unwrap();
        let mut huge = original.clone();
        huge["settings"]["fixture"] = json!("x".repeat(1024 * 1024));
        assert!(store.write("full", 1, &huge).is_err());
        assert_eq!(store.revision().unwrap(), 1);
        assert_eq!(store.operation("full").unwrap(), None);
        assert_eq!(store.read().unwrap(), Some(original.clone()));
        store
            .connection
            .pragma_update(None, "query_only", true)
            .unwrap();
        assert!(store.write("readonly", 1, &original).is_err());
        assert_eq!(store.operation("readonly").unwrap(), None);
        assert_eq!(store.read().unwrap(), Some(original.clone()));
        drop(store);
        assert_eq!(Store::open(&root).unwrap().read().unwrap(), Some(original));
        fs::remove_dir_all(root).unwrap();
    }
}
