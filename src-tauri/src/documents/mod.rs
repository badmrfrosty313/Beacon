//! B-006 to B-008: bounded UTF-8 document import, preserved originals, FTS5 search, reading.
//!
//! # Storage model
//!
//! * The **original bytes** are the source of truth. Each is written once, unmodified, to
//!   `<data dir>/originals/<sha256>.<md|txt>`. The file name is derived from the content hash,
//!   never from the user's file name, so a hostile name cannot touch the filesystem.
//! * SQLite stores metadata plus a decoded copy of the text (`documents.content`) that FTS5
//!   indexes. Reading a document re-reads the original from disk and re-verifies its SHA-256,
//!   so tampering or bit rot is reported instead of displayed as trusted.
//!
//! # Failure recovery
//!
//! A filesystem write and a database insert cannot be one atomic operation, so the order and
//! the repair rules are explicit:
//!
//! 1. The original is staged to a temporary file, flushed, then renamed into place (an
//!    all-or-nothing step on the same volume).
//! 2. Only then is the row inserted (FTS5 is updated by trigger in the same SQLite transaction).
//! 3. If the insert fails, retain the verified original. Another BEACON process may have
//!    committed a row referencing that file while this import was in flight; deleting it
//!    could destroy a valid document. Leaving an orphan is the safe failure mode.
//! 4. A crash or failed insert between steps 1 and 2 may leave an *orphan* original. That is harmless:
//!    re-importing the same bytes reuses or atomically replaces it. Stale `*.tmp` files from an
//!    interrupted write are swept at startup ([`sweep_stale_temp_files`]).
//! 5. If a row exists but its original is missing or damaged, re-importing the same file
//!    restores the original (the new bytes are verified to hash to the recorded SHA-256).

pub mod query;
pub mod validation;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{AppError, Result};
use validation::{validate_content, validate_filename, Rejection};

pub use validation::MAX_DOCUMENT_BYTES;

pub const LIST_LIMIT: i64 = 1000;
pub const SEARCH_LIMIT: i64 = 100;
const ORIGINALS_DIR: &str = "originals";
/// Highlight markers in snippets. Control characters cannot occur in imported text (they are
/// rejected on import), so they can never be confused with document content.
const SNIPPET_ARGS: &str = "char(1), char(2), '…', 24";
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: i64,
    pub title: String,
    pub original_name: String,
    pub format: String,
    pub sha256: String,
    pub byte_length: i64,
    pub imported_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(flatten)]
    pub metadata: DocumentSummary,
    pub body: String,
}

/// A search result. `snippet` wraps matches in U+0001 … U+0002; the UI turns them into
/// highlights without ever interpreting the text as HTML.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: i64,
    pub title: String,
    pub format: String,
    pub snippet: String,
    pub imported_at: String,
}

fn reject(rejection: Rejection) -> AppError {
    AppError::Validation(rejection.0.to_owned())
}

fn read_summary(row: &Row<'_>) -> rusqlite::Result<DocumentSummary> {
    Ok(DocumentSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        original_name: row.get(2)?,
        format: row.get(3)?,
        sha256: row.get(4)?,
        byte_length: row.get(5)?,
        imported_at: row.get(6)?,
    })
}

const SUMMARY_COLUMNS: &str = "id, title, original_name, format, sha256, byte_length, imported_at";

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn originals_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(ORIGINALS_DIR)
}

fn original_path(data_dir: &Path, sha256: &str, format: &str) -> PathBuf {
    originals_dir(data_dir).join(format!("{sha256}.{format}"))
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Stored {
    /// No file existed; this call created it. Do not unlink on INSERT failure: another
    /// process may already have committed a row pointing at the same hash.
    Created,
    /// An identical file was already present.
    AlreadyPresent,
    /// A file existed with different bytes (damaged or planted); it was atomically replaced.
    Replaced,
}

/// Atomically ensure `<sha256>.<format>` contains exactly `bytes`.
fn ensure_original(data_dir: &Path, sha256: &str, format: &str, bytes: &[u8]) -> Result<Stored> {
    store_original(&originals_dir(data_dir), sha256, format, bytes)
}

/// Same guarantee for any content-addressed directory (also used by the research importer).
pub(crate) fn store_original(
    dir: &Path,
    sha256: &str,
    format: &str,
    bytes: &[u8],
) -> Result<Stored> {
    let target = dir.join(format!("{sha256}.{format}"));
    let existed = target.exists();
    if existed {
        if let Ok(current) = fs::read(&target) {
            if current == bytes {
                return Ok(Stored::AlreadyPresent);
            }
        }
    }
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        "{sha256}.{}.{}.tmp",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let written = (|| -> std::io::Result<()> {
        let mut out = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        out.write_all(bytes)?;
        out.sync_all()?;
        // Same directory, so this is an atomic replace on Windows and POSIX alike.
        fs::rename(&tmp, &target)
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&tmp);
        return Err(AppError::Io(error));
    }
    Ok(if existed {
        Stored::Replaced
    } else {
        Stored::Created
    })
}

/// Remove temporary files left behind by an interrupted write. Best effort: only files older
/// than `min_age` are touched, so a write in progress in another process is never disturbed.
pub fn sweep_stale_temp_files(data_dir: &Path, min_age: Duration) -> usize {
    sweep_stale_temp_files_in(&originals_dir(data_dir), min_age)
}

/// As [`sweep_stale_temp_files`], for any content-addressed directory.
pub(crate) fn sweep_stale_temp_files_in(dir: &Path, min_age: Duration) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let now = SystemTime::now();
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_tmp = path.extension().is_some_and(|ext| ext == "tmp");
        let old_enough = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .map(|modified| now.duration_since(modified).unwrap_or_default() >= min_age)
            .unwrap_or(false);
        if is_tmp && old_enough && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn find_by_hash(conn: &Connection, sha256: &str) -> Result<Option<DocumentSummary>> {
    Ok(conn
        .query_row(
            &format!("SELECT {SUMMARY_COLUMNS} FROM documents WHERE sha256 = ?1"),
            params![sha256],
            read_summary,
        )
        .optional()?)
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

fn duplicate(existing: &DocumentSummary, restored: bool) -> AppError {
    AppError::Duplicate {
        title: existing.title.clone(),
        restored,
    }
}

/// Import one file. The caller holds the `AppState` database mutex, which only serializes
/// imports *within one process*. Distinct running BEACON processes may share the same database.
///
/// Returns [`AppError::Duplicate`] (without changing any existing record) when identical bytes
/// were imported before.
pub fn import(conn: &Connection, data_dir: &Path, name: &str, bytes: &[u8]) -> Result<Document> {
    import_with_before_insert(conn, data_dir, name, bytes, || {})
}

/// The callback enables a deterministic test of the multi-process interleaving after an
/// original is written, but before this connection inserts its metadata row.
fn import_with_before_insert(
    conn: &Connection,
    data_dir: &Path,
    name: &str,
    bytes: &[u8],
    before_insert: impl FnOnce(),
) -> Result<Document> {
    let (title, format) = validate_filename(name).map_err(reject)?;
    let content = validate_content(bytes).map_err(reject)?;
    let sha256 = hash(bytes);

    if let Some(existing) = find_by_hash(conn, &sha256)? {
        // Same bytes are already catalogued. If the archived original went missing or was
        // damaged, these (hash-verified) bytes can safely restore it.
        let stored = ensure_original(data_dir, &existing.sha256, &existing.format, bytes)?;
        return Err(duplicate(&existing, stored != Stored::AlreadyPresent));
    }

    // The original is content-addressed. Never unlink it if the SQL insert fails:
    // a second process can commit its own row between this write and our INSERT.
    ensure_original(data_dir, &sha256, &format, bytes)?;
    before_insert();
    let inserted = conn.query_row(
        &format!(
            "INSERT INTO documents (title, original_name, format, sha256, byte_length, content)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             RETURNING {SUMMARY_COLUMNS}"
        ),
        params![title, name, format, sha256, bytes.len() as i64, content],
        read_summary,
    );
    match inserted {
        Ok(metadata) => Ok(Document {
            metadata,
            body: content,
        }),
        Err(error) => {
            // Deliberately retain the original, even if we created it. We cannot safely
            // determine whether a different process committed a row referring to it.
            if is_unique_violation(&error) {
                if let Some(existing) = find_by_hash(conn, &sha256)? {
                    return Err(duplicate(&existing, false));
                }
            }
            Err(AppError::Database(error))
        }
    }
}

pub fn list(conn: &Connection) -> Result<Vec<DocumentSummary>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUMMARY_COLUMNS} FROM documents ORDER BY imported_at DESC, id DESC LIMIT ?1"
    ))?;
    let rows = stmt
        .query_map(params![LIST_LIMIT], read_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Read a document from its preserved original, verifying length and SHA-256 first.
pub fn get(conn: &Connection, data_dir: &Path, id: i64) -> Result<Document> {
    let metadata = conn
        .query_row(
            &format!("SELECT {SUMMARY_COLUMNS} FROM documents WHERE id = ?1"),
            params![id],
            read_summary,
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    let bytes = match fs::read(original_path(data_dir, &metadata.sha256, &metadata.format)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::Integrity)
        }
        Err(error) => return Err(AppError::Io(error)),
    };
    if bytes.len() as i64 != metadata.byte_length || hash(&bytes) != metadata.sha256 {
        return Err(AppError::Integrity);
    }
    let body = validate_content(&bytes).map_err(|_| AppError::Integrity)?;
    Ok(Document { metadata, body })
}

fn is_fts_syntax_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(_, Some(message)) if message.starts_with("fts5:")
    )
}

/// Search imported documents. Input is parsed into literal words/phrases (see [`query`]), the
/// resulting expression is bound as a parameter, and at most [`SEARCH_LIMIT`] hits are returned.
pub fn search(conn: &Connection, text: &str) -> Result<Vec<SearchHit>> {
    let units = query::parse(text).map_err(reject)?;
    if units.is_empty() {
        return Ok(Vec::new());
    }
    let expression = query::to_match_expression(&units);
    let sql = format!(
        "SELECT d.id, d.title, d.format, snippet(documents_fts, -1, {SNIPPET_ARGS}), d.imported_at
         FROM documents_fts
         JOIN documents d ON d.id = documents_fts.rowid
         WHERE documents_fts MATCH ?1
         ORDER BY bm25(documents_fts), d.id DESC
         LIMIT ?2"
    );
    let run = || -> rusqlite::Result<Vec<SearchHit>> {
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![expression, SEARCH_LIMIT], |row| {
                Ok(SearchHit {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    format: row.get(2)?,
                    snippet: row.get(3)?,
                    imported_at: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    };
    run().map_err(|error| {
        if is_fts_syntax_error(&error) {
            AppError::Validation("That search could not be understood.".to_owned())
        } else {
            AppError::Database(error)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn fixture() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory_migrated().unwrap();
        (dir, conn)
    }

    fn originals(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(originals_dir(dir))
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    #[test]
    fn import_stores_exact_bytes_hash_and_metadata() {
        let (dir, conn) = fixture();
        let raw = b"\xEF\xBB\xBF# Radio net\r\nSignal checks at 0900\r\n";
        let doc = import(&conn, dir.path(), "Radio.MD", raw).unwrap();
        assert_eq!(doc.metadata.title, "Radio");
        assert_eq!(doc.metadata.format, "md");
        assert_eq!(doc.metadata.original_name, "Radio.MD");
        assert_eq!(doc.metadata.byte_length, raw.len() as i64);
        assert_eq!(doc.metadata.sha256, hash(raw));
        assert_eq!(doc.metadata.sha256.len(), 64);
        // The decoded view drops the BOM and keeps CRLF line breaks.
        assert_eq!(doc.body, "# Radio net\r\nSignal checks at 0900\r\n");
        // The original on disk is byte-for-byte what was supplied, BOM included.
        assert_eq!(
            fs::read(original_path(dir.path(), &hash(raw), "md")).unwrap(),
            raw
        );
        assert_eq!(get(&conn, dir.path(), doc.metadata.id).unwrap(), doc);
    }

    #[test]
    fn documents_searchability_and_originals_survive_reopening_the_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(db::DB_FILE_NAME);
        let raw = b"Evacuation plan: meet at the north bridge.";
        let id = {
            let conn = db::open_and_migrate(&path).unwrap();
            import(&conn, dir.path(), "plan.txt", raw)
                .unwrap()
                .metadata
                .id
        };
        let conn = db::open_and_migrate(&path).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
        let hits = search(&conn, "\"north bridge\"").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, id);
        assert_eq!(
            get(&conn, dir.path(), id).unwrap().body,
            std::str::from_utf8(raw).unwrap()
        );
    }

    #[test]
    fn invalid_files_are_rejected_before_anything_is_stored() {
        let (dir, conn) = fixture();
        for name in [
            "../escape.md",
            r"C:\secret.txt",
            "evil.pdf",
            ".md",
            "a\0.md",
        ] {
            assert!(
                matches!(
                    import(&conn, dir.path(), name, b"safe"),
                    Err(AppError::Validation(_))
                ),
                "{name:?}"
            );
        }
        for bytes in [
            vec![],
            vec![0xff],
            vec![0u8],
            vec![b'a'; MAX_DOCUMENT_BYTES + 1],
        ] {
            assert!(matches!(
                import(&conn, dir.path(), "file.txt", &bytes),
                Err(AppError::Validation(_))
            ));
        }
        assert!(list(&conn).unwrap().is_empty());
        assert!(originals(dir.path()).is_empty());
    }

    #[test]
    fn a_file_of_exactly_one_mebibyte_is_accepted() {
        let (dir, conn) = fixture();
        let bytes = vec![b'a'; MAX_DOCUMENT_BYTES];
        let doc = import(&conn, dir.path(), "big.txt", &bytes).unwrap();
        assert_eq!(doc.metadata.byte_length, MAX_DOCUMENT_BYTES as i64);
    }

    #[test]
    fn hostile_names_never_influence_where_originals_are_written() {
        let (dir, conn) = fixture();
        let doc = import(&conn, dir.path(), "weird name (1).txt", b"hello").unwrap();
        let names = originals(dir.path());
        assert_eq!(names, vec![format!("{}.txt", doc.metadata.sha256)]);
        // Nothing else was created next to or above the data directory.
        let top: Vec<_> = fs::read_dir(dir.path()).unwrap().flatten().collect();
        assert_eq!(top.len(), 1);
    }

    #[test]
    fn duplicates_are_reported_and_leave_existing_records_untouched() {
        let (dir, conn) = fixture();
        let first = import(&conn, dir.path(), "one.txt", b"same bytes").unwrap();
        let before = list(&conn).unwrap();
        for name in ["one.txt", "renamed.md", "copy.txt"] {
            match import(&conn, dir.path(), name, b"same bytes") {
                Err(AppError::Duplicate { title, restored }) => {
                    assert_eq!(title, "one");
                    assert!(!restored);
                }
                other => panic!("expected Duplicate, got {other:?}"),
            }
        }
        assert_eq!(list(&conn).unwrap(), before);
        assert_eq!(originals(dir.path()).len(), 1);
        assert_eq!(get(&conn, dir.path(), first.metadata.id).unwrap(), first);
    }

    #[test]
    fn different_content_with_the_same_name_is_a_separate_document() {
        let (dir, conn) = fixture();
        import(&conn, dir.path(), "notes.txt", b"version one").unwrap();
        import(&conn, dir.path(), "notes.txt", b"version two").unwrap();
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn reimporting_restores_a_missing_original() {
        let (dir, conn) = fixture();
        let doc = import(&conn, dir.path(), "proof.txt", b"Original content").unwrap();
        let path = original_path(dir.path(), &doc.metadata.sha256, "txt");
        fs::remove_file(&path).unwrap();
        assert!(matches!(
            get(&conn, dir.path(), doc.metadata.id),
            Err(AppError::Integrity)
        ));
        match import(&conn, dir.path(), "proof.txt", b"Original content") {
            Err(AppError::Duplicate { restored, .. }) => assert!(restored),
            other => panic!("expected Duplicate, got {other:?}"),
        }
        assert_eq!(get(&conn, dir.path(), doc.metadata.id).unwrap(), doc);
    }

    #[test]
    fn reimporting_repairs_a_tampered_original() {
        let (dir, conn) = fixture();
        let doc = import(&conn, dir.path(), "proof.txt", b"Original content").unwrap();
        let path = original_path(dir.path(), &doc.metadata.sha256, "txt");
        fs::write(&path, b"Altered content!").unwrap();
        assert!(matches!(
            get(&conn, dir.path(), doc.metadata.id),
            Err(AppError::Integrity)
        ));
        assert!(matches!(
            import(&conn, dir.path(), "proof.txt", b"Original content"),
            Err(AppError::Duplicate { restored: true, .. })
        ));
        assert_eq!(fs::read(&path).unwrap(), b"Original content");
        assert!(get(&conn, dir.path(), doc.metadata.id).is_ok());
    }

    #[test]
    fn tampering_with_length_or_bytes_is_detected_on_read() {
        let (dir, conn) = fixture();
        let doc = import(&conn, dir.path(), "proof.txt", b"Original content").unwrap();
        let path = original_path(dir.path(), &doc.metadata.sha256, "txt");
        fs::write(&path, b"Original content, extended").unwrap();
        assert!(matches!(
            get(&conn, dir.path(), doc.metadata.id),
            Err(AppError::Integrity)
        ));
    }

    #[test]
    fn get_reports_not_found_for_unknown_ids() {
        let (dir, conn) = fixture();
        assert!(matches!(
            get(&conn, dir.path(), 42),
            Err(AppError::NotFound)
        ));
    }

    #[test]
    fn a_failed_insert_preserves_an_orphan_for_safe_reimport() {
        let (dir, conn) = fixture();
        let bytes = b"will not be recorded";
        // Force INSERT to fail after the content-addressed file has been written.
        conn.execute_batch(
            "CREATE TRIGGER fail_insert BEFORE INSERT ON documents
             BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;",
        )
        .unwrap();
        let result = import(&conn, dir.path(), "x.txt", bytes);
        assert!(matches!(result, Err(AppError::Database(_))));
        assert!(list(&conn).unwrap().is_empty());
        assert_eq!(originals(dir.path()), vec![format!("{}.txt", hash(bytes))]);
        // The retained bytes remain reusable after the database problem is fixed.
        conn.execute_batch("DROP TRIGGER fail_insert").unwrap();
        let imported = import(&conn, dir.path(), "x.txt", bytes).unwrap();
        assert_eq!(
            get(&conn, dir.path(), imported.metadata.id).unwrap().body,
            "will not be recorded"
        );
    }

    #[test]
    fn two_connections_importing_the_same_bytes_cannot_delete_a_committed_original() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join(db::DB_FILE_NAME);
        let first = db::open_and_migrate(&db_path).unwrap();
        let second = db::open_and_migrate(&db_path).unwrap();
        let bytes = b"shared content, only one committed document";
        let mut committed_id = None;

        // Simulate two distinct app processes deterministically:
        // A stages the file, B sees the same file and commits its own row,
        // A's INSERT then collides with the UNIQUE sha256 constraint.
        let raced = import_with_before_insert(&first, dir.path(), "instance-a.txt", bytes, || {
            let doc = import(&second, dir.path(), "instance-b.txt", bytes).unwrap();
            committed_id = Some(doc.metadata.id);
        });

        assert!(matches!(
            raced,
            Err(AppError::Duplicate {
                restored: false,
                ..
            })
        ));
        let committed_id = committed_id.expect("second connection committed a document");
        assert_eq!(list(&second).unwrap().len(), 1);
        assert_eq!(
            get(&second, dir.path(), committed_id).unwrap().body,
            "shared content, only one committed document"
        );
        assert_eq!(
            fs::read(original_path(dir.path(), &hash(bytes), "txt")).unwrap(),
            bytes,
            "a failed competing insert must never delete another connection's original"
        );
    }

    #[test]
    fn an_orphaned_original_from_a_crash_is_reused_on_import() {
        let (dir, conn) = fixture();
        let bytes = b"written just before a crash";
        // Simulate: file landed, process died before the row was inserted.
        ensure_original(dir.path(), &hash(bytes), "txt", bytes).unwrap();
        let doc = import(&conn, dir.path(), "late.txt", bytes).unwrap();
        assert_eq!(doc.body, "written just before a crash");
        assert_eq!(originals(dir.path()).len(), 1);
    }

    #[test]
    fn an_orphan_with_wrong_bytes_is_replaced_atomically() {
        let (dir, conn) = fixture();
        let bytes = b"the real content";
        let bogus = original_path(dir.path(), &hash(bytes), "txt");
        fs::create_dir_all(bogus.parent().unwrap()).unwrap();
        fs::write(&bogus, b"planted").unwrap();
        let doc = import(&conn, dir.path(), "real.txt", bytes).unwrap();
        assert_eq!(fs::read(&bogus).unwrap(), bytes);
        assert_eq!(
            get(&conn, dir.path(), doc.metadata.id).unwrap().body,
            "the real content"
        );
    }

    #[test]
    fn stale_temp_files_are_swept_and_originals_are_kept() {
        let (dir, conn) = fixture();
        let doc = import(&conn, dir.path(), "keep.txt", b"keep me").unwrap();
        let stale = originals_dir(dir.path()).join("abc.1.2.tmp");
        fs::write(&stale, b"half written").unwrap();
        // A fresh file is left alone when a minimum age is required...
        assert_eq!(
            sweep_stale_temp_files(dir.path(), Duration::from_secs(3600)),
            0
        );
        assert!(stale.exists());
        // ...and removed when old enough. Real originals are never touched.
        assert_eq!(sweep_stale_temp_files(dir.path(), Duration::ZERO), 1);
        assert!(!stale.exists());
        assert!(get(&conn, dir.path(), doc.metadata.id).is_ok());
    }

    #[test]
    fn search_finds_words_and_exact_phrases_with_highlighted_snippets() {
        let (dir, conn) = fixture();
        import(
            &conn,
            dir.path(),
            "one.txt",
            b"Reports mention the north bridge crossing",
        )
        .unwrap();
        import(
            &conn,
            dir.path(),
            "two.md",
            b"Reports deny that the bridge is north",
        )
        .unwrap();

        let phrase = search(&conn, "\"north bridge\"").unwrap();
        assert_eq!(phrase.len(), 1);
        assert_eq!(phrase[0].title, "one");
        assert!(phrase[0].snippet.contains("\u{1}north bridge\u{2}"));

        let both_words = search(&conn, "north bridge").unwrap();
        assert_eq!(both_words.len(), 2);
        assert_eq!(search(&conn, "nonexistent").unwrap().len(), 0);
        // Case-insensitive.
        assert_eq!(search(&conn, "REPORTS").unwrap().len(), 2);
    }

    #[test]
    fn search_matches_titles_too() {
        let (dir, conn) = fixture();
        import(&conn, dir.path(), "Contingency plan.md", b"body text").unwrap();
        assert_eq!(search(&conn, "contingency").unwrap().len(), 1);
    }

    #[test]
    fn hostile_and_malformed_queries_are_safe() {
        let (dir, conn) = fixture();
        import(&conn, dir.path(), "a.txt", b"alpha beta gamma OR delta").unwrap();
        let queries = [
            "alpha OR",
            "OR",
            "NOT",
            "NEAR(alpha beta)",
            "alpha*",
            "^alpha",
            "title:alpha",
            "{alpha beta}",
            "(alpha",
            "alpha)",
            "\"",
            "\"\"\"",
            "'; DROP TABLE documents; --",
            "alpha\" OR \"beta",
            "-alpha",
            "",
            "   ",
            "*",
        ];
        for q in queries {
            let result = search(&conn, q);
            assert!(result.is_ok(), "query {q:?} should not error: {result:?}");
        }
        // The table survived the injection attempt, and operators were literal.
        assert_eq!(list(&conn).unwrap().len(), 1);
        // `OR` is an ordinary word here, not an operator: if it were one, this would match.
        assert_eq!(search(&conn, "alpha OR zzz").unwrap().len(), 0);
        assert_eq!(search(&conn, "gamma OR delta").unwrap().len(), 1);
        assert_eq!(search(&conn, "\"gamma OR delta\"").unwrap().len(), 1);
        assert!(matches!(
            search(&conn, "bad\u{0}query"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            search(&conn, &"x".repeat(500)),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn search_results_are_bounded() {
        let (dir, conn) = fixture();
        for i in 0..(SEARCH_LIMIT + 20) {
            let body = format!("common token number {i}");
            import(&conn, dir.path(), &format!("doc{i}.txt"), body.as_bytes()).unwrap();
        }
        assert_eq!(
            search(&conn, "common").unwrap().len(),
            SEARCH_LIMIT as usize
        );
    }

    #[test]
    fn html_and_scripts_are_preserved_literally() {
        let (dir, conn) = fixture();
        let raw = b"<script>alert('x')</script> <b>bold</b>";
        let doc = import(&conn, dir.path(), "raw.md", raw).unwrap();
        let read = get(&conn, dir.path(), doc.metadata.id).unwrap();
        assert_eq!(read.body, "<script>alert('x')</script> <b>bold</b>");
    }

    #[test]
    fn the_fts_index_stays_consistent_with_the_documents_table() {
        let (dir, conn) = fixture();
        import(&conn, dir.path(), "a.txt", b"alpha").unwrap();
        import(&conn, dir.path(), "b.txt", b"beta").unwrap();
        conn.execute(
            "INSERT INTO documents_fts(documents_fts) VALUES ('integrity-check')",
            [],
        )
        .unwrap();
    }
}
