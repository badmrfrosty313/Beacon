//! B-006 to B-008: bounded UTF-8 document import, preserved originals and FTS5.
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{AppError, Result};

pub const MAX_DOCUMENT_BYTES: usize = 1_048_576;
pub const LIST_LIMIT: i64 = 1000;
const SEARCH_LIMIT: i64 = 100;
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: i64,
    pub title: String,
    pub format: String,
    pub snippet: String,
    pub imported_at: String,
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

fn validate_filename(name: &str) -> Result<(String, String)> {
    if name.is_empty()
        || name.chars().any(char::is_control)
        || name.contains(['/', '\\', ':'])
        || name == "." || name == ".."
    {
        return Err(AppError::Validation("Choose a .md or .txt file with a plain filename.".to_owned()));
    }
    let (stem, ext) = name.rsplit_once('.').ok_or_else(|| {
        AppError::Validation("Only Markdown (.md) and text (.txt) files can be imported.".to_owned())
    })?;
    let format = ext.to_ascii_lowercase();
    if format != "md" && format != "txt" {
        return Err(AppError::Validation("Only Markdown (.md) and text (.txt) files can be imported.".to_owned()));
    }
    let title = stem.trim();
    if title.is_empty() || title.chars().count() > 200 || title.chars().any(char::is_control) {
        return Err(AppError::Validation("The filename must contain a title of 1–200 characters.".to_owned()));
    }
    Ok((title.to_owned(), format))
}

fn validate_content(bytes: &[u8]) -> Result<String> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::Validation("Files must be at most 1 MiB.".to_owned()));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| {
        AppError::Validation("The selected file is not valid UTF-8 text.".to_owned())
    })?;
    if text.chars().any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t' | '\u{feff}')) {
        return Err(AppError::Validation("The file contains unsupported control characters.".to_owned()));
    }
    Ok(text.trim_start_matches('\u{feff}').to_owned())
}

fn original_path(data_dir: &Path, sha256: &str, format: &str) -> PathBuf {
    data_dir.join("originals").join(format!("{sha256}.{format}"))
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Atomically stage an immutable original under a hash-derived filename.
/// A database insert failure removes a newly created file, but an interrupted process
/// may leave an orphaned original; re-import can safely reuse only matching bytes.
fn preserve_original(data_dir: &Path, sha256: &str, format: &str, bytes: &[u8]) -> Result<bool> {
    let target = original_path(data_dir, sha256, format);
    if target.exists() {
        return if fs::read(&target)? == bytes { Ok(false) } else { Err(AppError::Integrity) };
    }
    let parent = target.parent().ok_or(AppError::Internal)?;
    fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(
        "{sha256}.{}.{}.tmp",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| -> std::io::Result<()> {
        let mut out = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        out.write_all(bytes)?;
        out.sync_all()?;
        fs::rename(&tmp, &target)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&tmp);
        if target.exists() && fs::read(&target)? == bytes {
            return Ok(false);
        }
        return Err(AppError::Io(error));
    }
    Ok(true)
}

/// The caller holds the AppState DB mutex so simultaneous imports are serialized.
/// Original bytes are stored on disk, and the FTS index updates in the same SQLite
/// transaction as the document record by trigger.
pub fn import(conn: &Connection, data_dir: &Path, name: &str, bytes: &[u8]) -> Result<Document> {
    let (title, format) = validate_filename(name)?;
    let content = validate_content(bytes)?;
    let sha256 = hash(bytes);
    let duplicate: Option<i64> = conn
        .query_row("SELECT id FROM documents WHERE sha256 = ?1", params![sha256], |row| row.get(0))
        .optional()?;
    if duplicate.is_some() {
        return Err(AppError::Validation("This file has already been imported.".to_owned()));
    }

    let created = preserve_original(data_dir, &sha256, &format, bytes)?;
    let inserted = conn.query_row(
        "INSERT INTO documents (title, original_name, format, sha256, byte_length, content)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         RETURNING id, title, original_name, format, sha256, byte_length, imported_at",
        params![title, name, format, sha256, bytes.len() as i64, content],
        read_summary,
    );
    match inserted {
        Ok(metadata) => Ok(Document { metadata, body: content }),
        Err(error) => {
            if created {
                let _ = fs::remove_file(original_path(data_dir, &sha256, &format));
            }
            Err(AppError::Database(error))
        }
    }
}

pub fn list(conn: &Connection) -> Result<Vec<DocumentSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, original_name, format, sha256, byte_length, imported_at
         FROM documents ORDER BY imported_at DESC, id DESC LIMIT ?1"
    )?;
    let result = stmt.query_map(params![LIST_LIMIT], read_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(result)
}

pub fn get(conn: &Connection, data_dir: &Path, id: i64) -> Result<Document> {
    let metadata = conn.query_row(
        "SELECT id, title, original_name, format, sha256, byte_length, imported_at
         FROM documents WHERE id = ?1",
        params![id], read_summary,
    ).optional()?.ok_or(AppError::NotFound)?;
    let bytes = fs::read(original_path(data_dir, &metadata.sha256, &metadata.format))?;
    if bytes.len() as i64 != metadata.byte_length || hash(&bytes) != metadata.sha256 {
        return Err(AppError::Integrity);
    }
    let body = validate_content(&bytes).map_err(|_| AppError::Integrity)?;
    Ok(Document { metadata, body })
}

/// The query is always a *literal phrase* in FTS5 syntax, not an expression.
/// Quotes are escaped and bound as a parameter to prevent MATCH operator injection.
pub fn search(conn: &Connection, query: &str) -> Result<Vec<SearchHit>> {
    let query = query.trim();
    if query.is_empty() { return Ok(Vec::new()); }
    if query.chars().count() > 200 || query.chars().any(char::is_control) {
        return Err(AppError::Validation("Search must contain 1–200 printable characters.".to_owned()));
    }
    let phrase = query.replace('"', "").trim().to_owned();
    if phrase.is_empty() { return Ok(Vec::new()); }
    let match_query = format!("\"{phrase}\"");
    let mut stmt = conn.prepare(
        "SELECT d.id, d.title, d.format,
                snippet(documents_fts, 1, '[', ']', '…', 18), d.imported_at
         FROM documents_fts
         JOIN documents d ON d.id = documents_fts.rowid
         WHERE documents_fts MATCH ?1
         ORDER BY bm25(documents_fts) LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![match_query, SEARCH_LIMIT], |row| {
        Ok(SearchHit {
            id: row.get(0)?,
            title: row.get(1)?,
            format: row.get(2)?,
            snippet: row.get(3)?,
            imported_at: row.get(4)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn importing_reopening_searching_and_retrieving_preserves_exact_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(db::DB_FILE_NAME);
        let raw = b"# Radio net\r\nSignal checks at 0900\r\n";
        let id = {
            let conn = db::open_and_migrate(&path).unwrap();
            let doc = import(&conn, dir.path(), "Radio.md", raw).unwrap();
            assert_eq!(doc.metadata.title, "Radio");
            assert_eq!(doc.metadata.sha256, hash(raw));
            assert_eq!(search(&conn, "signal checks").unwrap()[0].id, doc.metadata.id);
            doc.metadata.id
        };
        let conn = db::open_and_migrate(&path).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert_eq!(get(&conn, dir.path(), id).unwrap().body, std::str::from_utf8(raw).unwrap());
        assert_eq!(fs::read(original_path(dir.path(), &hash(raw), "md")).unwrap(), raw);
        assert!(matches!(import(&conn, dir.path(), "other.txt", raw), Err(AppError::Validation(_))));
    }

    #[test]
    fn malformed_files_are_rejected_before_storage() {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory_migrated().unwrap();
        for name in ["../escape.md", r"C:\\secret.txt", "evil.pdf", ".md", "a\0.md"] {
            assert!(matches!(import(&conn, dir.path(), name, b"safe"), Err(AppError::Validation(_))));
        }
        for bytes in [vec![0xff], vec![0u8], vec![b'a'; MAX_DOCUMENT_BYTES + 1]] {
            assert!(matches!(import(&conn, dir.path(), "file.txt", &bytes), Err(AppError::Validation(_))));
        }
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn fts_phrase_lookup_is_literal_and_preserves_conflicting_sources() {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory_migrated().unwrap();
        import(&conn, dir.path(), "one.txt", b"Reports mention north bridge").unwrap();
        import(&conn, dir.path(), "two.md", b"Reports deny north bridge").unwrap();
        assert_eq!(search(&conn, "north bridge").unwrap().len(), 2);
        assert_eq!(search(&conn, "nonexistent").unwrap().len(), 0);
        assert_eq!(search(&conn, "north OR bridge").unwrap().len(), 0);
        assert_eq!(search(&conn, "").unwrap().len(), 0);
        assert_eq!(search(&conn, "\"").unwrap().len(), 0);
    }

    #[test]
    fn tampering_is_detected_on_read() {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory_migrated().unwrap();
        let doc = import(&conn, dir.path(), "proof.txt", b"Original content").unwrap();
        let path = original_path(dir.path(), &doc.metadata.sha256, "txt");
        fs::write(path, b"Altered content").unwrap();
        assert!(matches!(get(&conn, dir.path(), doc.metadata.id), Err(AppError::Integrity)));
    }

    #[test]
    fn html_is_preserved_literally_not_interpreted() {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory_migrated().unwrap();
        let raw = b"<script>alert('x')</script>";
        let doc = import(&conn, dir.path(), "raw.md", raw).unwrap();
        assert_eq!(get(&conn, dir.path(), doc.metadata.id).unwrap().body, "<script>alert('x')</script>");
    }
}
