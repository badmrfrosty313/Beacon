//! SEED: portable, offline backup and restore (B-016/B-017/B-018, ADR-017).
//!
//! A `.beacon` package is ONE file:
//!
//! ```text
//! "BCNSEED1" | u32 LE manifest length | manifest JSON (UTF-8) | entry bytes, back to back
//! ```
//!
//! The manifest lists every entry (`path`, `size`, `sha256`) in storage order; offsets are the
//! running sum of sizes, so there is no offset field to forge. Entries are
//! `data/records.json` (every user record as JSON) plus the byte-for-byte originals under
//! `originals/<sha256>.<md|txt>` and `research_originals/<sha256>.<md|txt|pdf>`.
//!
//! SECURITY: SHA-256 digests detect corruption and edits relative to the manifest, which sits in
//! the same file, so they do NOT authenticate who made a package. Packages are neither encrypted
//! nor signed and may contain private research.
//!
//! Restore is additive: nothing existing is overwritten or deleted. A package record whose
//! *identity* already exists locally is skipped and mapped onto the existing record; everything
//! else is inserted with fresh local ids inside one SQLite transaction. The package is fully
//! parsed and every digest verified before the database or disk is touched.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use rusqlite::types::Value as SqlValue;
use rusqlite::{params_from_iter, Connection, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::db::migrations;
use crate::documents::{self, Stored};
use crate::error::{AppError, Result};
use crate::research;

pub const FORMAT_NAME: &str = "beacon-seed";
pub const FORMAT_VERSION: u32 = 1;
const MAGIC: &[u8; 8] = b"BCNSEED1";
const RECORDS_PATH: &str = "data/records.json";
const DOC_DIR: &str = "originals";
const RESEARCH_DIR: &str = "research_originals";

/// Whole-package ceiling (also bounds IPC payload and memory: the package is held in memory).
pub const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_RECORDS_BYTES: usize = 32 * 1024 * 1024;
const MAX_ROWS: usize = 50_000;
const MAX_ENTRIES: usize = 20_002;
const MAX_DOC_ORIGINAL: u64 = 1024 * 1024;
const MAX_RESEARCH_ORIGINAL: u64 = 20 * 1024 * 1024;

// ---- Table descriptions ------------------------------------------------------------------

struct Table {
    name: &'static str,
    /// Every column except `id`, in insert order.
    cols: &'static [&'static str],
    /// (column, parent table) foreign keys.
    fks: &'static [(&'static str, &'static str)],
    /// Columns that define a record's identity.
    key_cols: &'static [&'static str],
    /// Foreign keys that are part of the identity (resolved to the parent's identity).
    key_fks: &'static [&'static str],
    /// Key columns compared case-insensitively.
    lower: &'static [&'static str],
}

/// Dependency order: parents before children.
const TABLES: &[Table] = &[
    Table {
        name: "notes",
        cols: &["title", "body", "created_at"],
        fks: &[],
        key_cols: &["title", "body", "created_at"],
        key_fks: &[],
        lower: &[],
    },
    Table {
        name: "documents",
        cols: &[
            "title",
            "original_name",
            "format",
            "sha256",
            "byte_length",
            "content",
            "imported_at",
        ],
        fks: &[],
        key_cols: &["sha256"],
        key_fks: &[],
        lower: &[],
    },
    Table {
        name: "research_collections",
        cols: &["name", "description", "created_at"],
        fks: &[],
        key_cols: &["name"],
        key_fks: &[],
        lower: &["name"],
    },
    Table {
        name: "research_documents",
        cols: &[
            "collection_id",
            "title",
            "original_name",
            "format",
            "sha256",
            "byte_length",
            "content",
            "extraction_method",
            "page_count",
            "text_truncated",
            "author",
            "publisher",
            "published_date",
            "attribution_note",
            "rights_note",
            "visibility",
            "imported_at",
            "updated_at",
        ],
        fks: &[("collection_id", "research_collections")],
        key_cols: &["sha256"],
        key_fks: &[],
        lower: &[],
    },
    Table {
        name: "watchtower_events",
        cols: &[
            "title",
            "description",
            "event_date",
            "date_precision",
            "event_sort",
            "created_at",
            "updated_at",
        ],
        fks: &[],
        key_cols: &[
            "title",
            "description",
            "event_date",
            "date_precision",
            "created_at",
        ],
        key_fks: &[],
        lower: &[],
    },
    Table {
        name: "watchtower_sources",
        cols: &[
            "title",
            "author",
            "publisher",
            "url",
            "published_date",
            "retrieved_date",
            "document_id",
            "note",
            "created_at",
            "updated_at",
        ],
        fks: &[("document_id", "documents")],
        key_cols: &[
            "title",
            "author",
            "publisher",
            "url",
            "published_date",
            "retrieved_date",
            "created_at",
        ],
        key_fks: &["document_id"],
        lower: &[],
    },
    Table {
        name: "watchtower_claims",
        cols: &[
            "event_id",
            "source_id",
            "kind",
            "text",
            "attribution",
            "scripture_reference",
            "created_at",
            "updated_at",
        ],
        fks: &[
            ("event_id", "watchtower_events"),
            ("source_id", "watchtower_sources"),
        ],
        key_cols: &["kind", "text", "attribution", "created_at"],
        key_fks: &["event_id", "source_id"],
        lower: &[],
    },
    Table {
        name: "watchtower_hypotheses",
        cols: &[
            "title",
            "statement",
            "status",
            "scripture_reference",
            "created_at",
            "updated_at",
        ],
        fks: &[],
        key_cols: &["title", "statement", "created_at"],
        key_fks: &[],
        lower: &[],
    },
    Table {
        name: "watchtower_links",
        cols: &[
            "hypothesis_id",
            "relation",
            "claim_id",
            "source_id",
            "event_id",
            "explanation",
            "created_at",
        ],
        fks: &[
            ("hypothesis_id", "watchtower_hypotheses"),
            ("claim_id", "watchtower_claims"),
            ("source_id", "watchtower_sources"),
            ("event_id", "watchtower_events"),
        ],
        key_cols: &["relation"],
        key_fks: &["hypothesis_id", "claim_id", "source_id", "event_id"],
        lower: &[],
    },
    Table {
        name: "research_source_links",
        cols: &["research_document_id", "source_id", "created_at"],
        fks: &[
            ("research_document_id", "research_documents"),
            ("source_id", "watchtower_sources"),
        ],
        key_cols: &[],
        key_fks: &["research_document_id", "source_id"],
        lower: &[],
    },
    Table {
        name: "research_excerpts",
        cols: &["research_document_id", "claim_id", "location", "created_at"],
        fks: &[
            ("research_document_id", "research_documents"),
            ("claim_id", "watchtower_claims"),
        ],
        key_cols: &[],
        // claim_id is UNIQUE in the schema, so the claim alone identifies the excerpt.
        key_fks: &["claim_id"],
        lower: &[],
    },
];

fn table_index(name: &str) -> Option<usize> {
    TABLES.iter().position(|t| t.name == name)
}

// ---- Public result types -----------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCount {
    pub table: String,
    pub total: usize,
    /// Records that would be (or were) inserted.
    pub added: usize,
    /// Records skipped because an identical record already exists locally.
    pub existing: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub format_version: u32,
    pub app_version: String,
    pub schema_version: i64,
    pub created_at: String,
    pub package_sha256: String,
    pub byte_length: usize,
    pub file_count: usize,
    pub tables: Vec<TableCount>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    pub file_name: String,
    /// Strict base64 of the whole `.beacon` file.
    pub data: String,
    pub byte_length: usize,
    pub package_sha256: String,
    pub tables: Vec<TableCount>,
    pub warnings: Vec<String>,
}

pub type RestoreReport = Preview;

pub const SENSITIVITY_WARNING: &str = "SEED packages are not encrypted or signed. Anyone who can read the file can read every note, document and research record inside it. Store it somewhere private.";

// ---- Helpers -------------------------------------------------------------------------------

fn sha_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn reject(message: impl Into<String>) -> AppError {
    AppError::Validation(format!("Invalid SEED package: {}", message.into()))
}

fn is_sha(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn original_extension_ok(dir: &str, format: &str) -> bool {
    match dir {
        DOC_DIR => matches!(format, "md" | "txt"),
        RESEARCH_DIR => matches!(format, "md" | "txt" | "pdf"),
        _ => false,
    }
}

/// Split an entry path into (directory, sha, extension) when it is exactly
/// `originals|research_originals/<64 hex>.<ext>`. Anything else (separators, `..`, absolute
/// paths, backslashes, drive letters, extra segments) is not an original.
fn parse_original_path(path: &str) -> Option<(&str, &str, &str)> {
    let (dir, file) = path.split_once('/')?;
    if dir != DOC_DIR && dir != RESEARCH_DIR {
        return None;
    }
    let (sha, ext) = file.split_once('.')?;
    if !is_sha(sha) || !original_extension_ok(dir, ext) {
        return None;
    }
    Some((dir, sha, ext))
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn encode_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            out.push(if i <= chunk.len() {
                B64[((n >> (18 - 6 * i)) & 63) as usize] as char
            } else {
                '='
            });
        }
    }
    out
}

pub fn decode_package(data: &str) -> Result<Vec<u8>> {
    research::base64::decode(data, MAX_PACKAGE_BYTES)
        .map_err(|message| AppError::Validation(message.to_owned()))
}

// ---- Reading rows ----------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Row {
    id: i64,
    values: Map<String, Value>,
}

fn read_table(conn: &Connection, table: &Table) -> Result<Vec<Row>> {
    // Names come from the static TABLES list, never from input.
    let sql = format!(
        "SELECT id, {} FROM {} ORDER BY id",
        table.cols.join(", "),
        table.name
    );
    let mut statement = conn.prepare(&sql)?;
    let mut rows = statement.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let mut values = Map::new();
        for (index, column) in table.cols.iter().enumerate() {
            let value = match row.get_ref(index + 1)? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => Value::from(n),
                rusqlite::types::ValueRef::Text(text) => {
                    Value::String(String::from_utf8(text.to_vec()).map_err(|_| AppError::Internal)?)
                }
                // No BEACON column holds floats or blobs; refuse rather than guess.
                _ => return Err(AppError::Internal),
            };
            values.insert((*column).to_owned(), value);
        }
        out.push(Row { id, values });
    }
    Ok(out)
}

fn text<'a>(row: &'a Row, column: &str) -> Option<&'a str> {
    row.values.get(column).and_then(Value::as_str)
}

type ParentIdentities = HashMap<(usize, i64), String>;

/// Identity hash of `row`: table + key columns + the identities (not the ids) of key parents, so
/// the same logical record has the same identity in every installation.
fn identity(
    table_index: usize,
    row: &Row,
    parents: &ParentIdentities,
) -> std::result::Result<String, String> {
    let table = &TABLES[table_index];
    let mut key = Vec::new();
    for column in table.key_cols {
        let mut value = row.values.get(*column).cloned().unwrap_or(Value::Null);
        if table.lower.contains(column) {
            if let Value::String(text) = &value {
                value = Value::String(text.to_lowercase());
            }
        }
        key.push(json!([column, value]));
    }
    let mut parent_part = Vec::new();
    for (column, parent_table) in table.fks {
        if !table.key_fks.contains(column) {
            continue;
        }
        let value = match row.values.get(*column) {
            Some(Value::Null) => Value::Null,
            Some(Value::Number(n)) => {
                let parent_id = n
                    .as_i64()
                    .ok_or_else(|| format!("{}.{column} is not an integer id", table.name))?;
                let parent_index = table_index_of(parent_table);
                let found = parents.get(&(parent_index, parent_id)).ok_or_else(|| {
                    format!(
                        "{} record {} points at a missing {parent_table} record",
                        table.name, row.id
                    )
                })?;
                Value::String(found.clone())
            }
            _ => return Err(format!("{}.{column} is not an integer id", table.name)),
        };
        parent_part.push(json!([column, value]));
    }
    let canonical = json!([table.name, key, parent_part]);
    Ok(sha_hex(canonical.to_string().as_bytes()))
}

fn table_index_of(name: &str) -> usize {
    table_index(name).expect("static foreign-key table exists")
}

/// Identities for every row of every table, in dependency order.
fn identities(
    rows: &[Vec<Row>],
) -> std::result::Result<(Vec<Vec<String>>, ParentIdentities), String> {
    let mut per_table = Vec::new();
    let mut by_id: ParentIdentities = HashMap::new();
    for (index, table_rows) in rows.iter().enumerate() {
        let mut hashes = Vec::with_capacity(table_rows.len());
        for row in table_rows {
            let hash = identity(index, row, &by_id)?;
            by_id.insert((index, row.id), hash.clone());
            hashes.push(hash);
        }
        per_table.push(hashes);
    }
    Ok((per_table, by_id))
}

fn read_all(conn: &Connection) -> Result<Vec<Vec<Row>>> {
    TABLES.iter().map(|t| read_table(conn, t)).collect()
}

// ---- Export ----------------------------------------------------------------------------------

struct Entry {
    path: String,
    bytes: Vec<u8>,
}

fn read_original(data_dir: &Path, dir: &str, row: &Row) -> Result<Entry> {
    let (Some(sha), Some(format)) = (text(row, "sha256"), text(row, "format")) else {
        return Err(AppError::Internal);
    };
    let title = text(row, "title").unwrap_or("untitled");
    let bad = || {
        AppError::Validation(format!(
            "The archived original for \"{title}\" is missing or damaged, so it cannot be exported. Re-import that file, then export again."
        ))
    };
    if !is_sha(sha) || !original_extension_ok(dir, format) {
        return Err(bad());
    }
    let bytes = fs::read(data_dir.join(dir).join(format!("{sha}.{format}"))).map_err(|_| bad())?;
    if sha_hex(&bytes) != sha {
        return Err(bad());
    }
    Ok(Entry {
        path: format!("{dir}/{sha}.{format}"),
        bytes,
    })
}

fn counts_for(rows: &[Vec<Row>], added: Option<&[usize]>) -> Vec<TableCount> {
    TABLES
        .iter()
        .enumerate()
        .map(|(index, table)| {
            let total = rows[index].len();
            let added = added.map_or(total, |a| a[index]);
            TableCount {
                table: table.name.to_owned(),
                total,
                added,
                existing: total - added,
            }
        })
        .collect()
}

/// Build a package from the whole library. Read-only; nothing is changed.
pub fn export(conn: &Connection, data_dir: &Path) -> Result<Exported> {
    // One read transaction so every table comes from the same snapshot.
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Deferred)?;
    let rows = read_all(&tx)?;
    let created_at: String =
        tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
            row.get(0)
        })?;
    let schema_version = migrations::current_version(&tx)?;
    drop(tx);

    let mut tables = Map::new();
    for (index, table) in TABLES.iter().enumerate() {
        let list: Vec<Value> = rows[index]
            .iter()
            .map(|row| {
                let mut object = row.values.clone();
                object.insert("id".into(), Value::from(row.id));
                Value::Object(object)
            })
            .collect();
        tables.insert(table.name.to_owned(), Value::Array(list));
    }
    let records = json!({ "tables": tables }).to_string().into_bytes();

    let mut entries = vec![Entry {
        path: RECORDS_PATH.to_owned(),
        bytes: records,
    }];
    let documents_index = table_index_of("documents");
    let research_index = table_index_of("research_documents");
    for row in &rows[documents_index] {
        entries.push(read_original(data_dir, DOC_DIR, row)?);
    }
    for row in &rows[research_index] {
        entries.push(read_original(data_dir, RESEARCH_DIR, row)?);
    }
    entries[1..].sort_by(|a, b| a.path.cmp(&b.path));

    let manifest = json!({
        "format": FORMAT_NAME,
        "formatVersion": FORMAT_VERSION,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "schemaVersion": schema_version,
        "createdAt": created_at,
        "encrypted": false,
        "authenticated": false,
        "warning": SENSITIVITY_WARNING,
        "entries": entries.iter().map(|e| json!({
            "path": e.path,
            "size": e.bytes.len(),
            "sha256": sha_hex(&e.bytes),
        })).collect::<Vec<_>>(),
    })
    .to_string()
    .into_bytes();
    if manifest.len() > MAX_MANIFEST_BYTES {
        return Err(AppError::Validation(
            "The library has too many files for a v0.1 SEED package.".into(),
        ));
    }

    let payload: usize = entries.iter().map(|e| e.bytes.len()).sum();
    let total = MAGIC.len() + 4 + manifest.len() + payload;
    if total > MAX_PACKAGE_BYTES {
        return Err(AppError::Validation(format!(
            "The library is larger than the {} MiB limit of a v0.1 SEED package.",
            MAX_PACKAGE_BYTES / (1024 * 1024)
        )));
    }
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
    out.extend_from_slice(&manifest);
    for entry in &entries {
        out.extend_from_slice(&entry.bytes);
    }
    let file_name = format!(
        "beacon-seed-{}.beacon",
        created_at
            .chars()
            .filter(char::is_ascii_digit)
            .collect::<String>()
            .chars()
            .enumerate()
            .flat_map(|(i, c)| if i == 8 { vec!['-', c] } else { vec![c] })
            .collect::<String>()
    );
    Ok(Exported {
        file_name,
        package_sha256: sha_hex(&out),
        byte_length: out.len(),
        data: encode_base64(&out),
        tables: counts_for(&rows, None),
        warnings: vec![SENSITIVITY_WARNING.to_owned()],
    })
}

// ---- Parsing and validation --------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    format_version: u32,
    app_version: String,
    schema_version: i64,
    created_at: String,
    entries: Vec<ManifestEntry>,
}

#[derive(Deserialize)]
struct ManifestEntry {
    path: String,
    size: u64,
    sha256: String,
}

struct Package {
    manifest: Manifest,
    package_sha256: String,
    byte_length: usize,
    /// Verified entry bytes by path.
    files: HashMap<String, Vec<u8>>,
    rows: Vec<Vec<Row>>,
}

fn short(text: &str) -> String {
    text.chars().take(80).collect()
}

fn parse(bytes: &[u8]) -> Result<Package> {
    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err(reject("the file is too large."));
    }
    if bytes.len() < MAGIC.len() + 4 || &bytes[..MAGIC.len()] != MAGIC {
        return Err(reject("this is not a BEACON SEED package."));
    }
    let manifest_len =
        u32::from_le_bytes(bytes[8..12].try_into().map_err(|_| AppError::Internal)?) as usize;
    if manifest_len == 0 || manifest_len > MAX_MANIFEST_BYTES || 12 + manifest_len > bytes.len() {
        return Err(reject("the manifest length is invalid."));
    }
    let manifest: Manifest = serde_json::from_slice(&bytes[12..12 + manifest_len])
        .map_err(|_| reject("the manifest is malformed."))?;
    if manifest.format != FORMAT_NAME {
        return Err(reject("this is not a BEACON SEED package."));
    }
    if manifest.format_version != FORMAT_VERSION {
        return Err(reject(format!(
            "format version {} is not supported by this version of BEACON (supports {FORMAT_VERSION}).",
            manifest.format_version
        )));
    }
    if manifest.schema_version > migrations::latest_version() || manifest.schema_version < 5 {
        return Err(reject(format!(
            "it was written for database schema {}, which this version cannot restore.",
            manifest.schema_version
        )));
    }
    if manifest.entries.is_empty() || manifest.entries.len() > MAX_ENTRIES {
        return Err(reject("the file list has an invalid size."));
    }

    // Declared sizes must account for every remaining byte exactly: no gaps, no trailing data.
    let mut declared: u64 = 0;
    for entry in &manifest.entries {
        declared = declared
            .checked_add(entry.size)
            .ok_or_else(|| reject("the declared sizes overflow."))?;
    }
    let payload_start = 12 + manifest_len;
    if declared != (bytes.len() - payload_start) as u64 {
        return Err(reject(
            "the declared file sizes do not match the package (truncated or padded).",
        ));
    }

    let mut files: HashMap<String, Vec<u8>> = HashMap::new();
    let mut offset = payload_start;
    for entry in &manifest.entries {
        let original = parse_original_path(&entry.path);
        if entry.path != RECORDS_PATH && original.is_none() {
            return Err(reject(format!(
                "unsafe or unknown path \"{}\".",
                short(&entry.path)
            )));
        }
        if !is_sha(&entry.sha256) {
            return Err(reject(format!(
                "bad digest for \"{}\".",
                short(&entry.path)
            )));
        }
        let limit = match original {
            Some((DOC_DIR, ..)) => MAX_DOC_ORIGINAL,
            Some(_) => MAX_RESEARCH_ORIGINAL,
            None => MAX_RECORDS_BYTES as u64,
        };
        if entry.size > limit {
            return Err(reject(format!(
                "\"{}\" exceeds its size limit.",
                short(&entry.path)
            )));
        }
        let end = offset + entry.size as usize; // bounded: size <= limit and sum checked above
        let data = &bytes[offset..end];
        offset = end;
        if sha_hex(data) != entry.sha256 {
            return Err(reject(format!(
                "\"{}\" failed its SHA-256 check (corrupt or altered).",
                short(&entry.path)
            )));
        }
        if let Some((_, sha, _)) = original {
            if sha != entry.sha256 {
                return Err(reject(format!(
                    "\"{}\" does not match its content-addressed name.",
                    short(&entry.path)
                )));
            }
        }
        if files.insert(entry.path.clone(), data.to_vec()).is_some() {
            return Err(reject(format!(
                "duplicate path \"{}\".",
                short(&entry.path)
            )));
        }
    }

    let records_bytes = files
        .get(RECORDS_PATH)
        .ok_or_else(|| reject("the records file is missing."))?;
    let rows = parse_records(records_bytes)?;
    check_originals(&rows, &files)?;
    Ok(Package {
        package_sha256: sha_hex(bytes),
        byte_length: bytes.len(),
        manifest,
        files,
        rows,
    })
}

fn parse_records(bytes: &[u8]) -> Result<Vec<Vec<Row>>> {
    let root: Value =
        serde_json::from_slice(bytes).map_err(|_| reject("the records file is malformed."))?;
    let tables = root
        .get("tables")
        .and_then(Value::as_object)
        .ok_or_else(|| reject("the records file has no tables."))?;
    if let Some(unknown) = tables.keys().find(|k| table_index(k).is_none()) {
        return Err(reject(format!("unknown table \"{}\".", short(unknown))));
    }
    let mut all = Vec::new();
    let mut total = 0usize;
    for table in TABLES {
        let list = tables
            .get(table.name)
            .and_then(Value::as_array)
            .ok_or_else(|| reject(format!("table \"{}\" is missing.", table.name)))?;
        total += list.len();
        if total > MAX_ROWS {
            return Err(reject("too many records."));
        }
        let mut seen = HashSet::new();
        let mut rows = Vec::with_capacity(list.len());
        for item in list {
            let object = item
                .as_object()
                .ok_or_else(|| reject(format!("a {} record is not an object.", table.name)))?;
            if object.len() != table.cols.len() + 1 {
                return Err(reject(format!(
                    "a {} record has the wrong fields.",
                    table.name
                )));
            }
            let id = object
                .get("id")
                .and_then(Value::as_i64)
                .filter(|id| *id > 0)
                .ok_or_else(|| reject(format!("a {} record has no valid id.", table.name)))?;
            if !seen.insert(id) {
                return Err(reject(format!("duplicate {} id {id}.", table.name)));
            }
            let mut values = Map::new();
            for column in table.cols {
                let value = object.get(*column).ok_or_else(|| {
                    reject(format!("a {} record lacks \"{column}\".", table.name))
                })?;
                match value {
                    Value::Null | Value::String(_) => {}
                    Value::Number(n) if n.is_i64() => {}
                    _ => {
                        return Err(reject(format!(
                            "{}.{column} has an unsupported value type.",
                            table.name
                        )))
                    }
                }
                values.insert((*column).to_owned(), value.clone());
            }
            rows.push(Row { id, values });
        }
        all.push(rows);
    }
    Ok(all)
}

/// Each document row needs its original (right hash and length); no original may be unreferenced.
fn check_originals(rows: &[Vec<Row>], files: &HashMap<String, Vec<u8>>) -> Result<()> {
    let mut referenced: HashSet<String> = HashSet::new();
    for (table, dir) in [("documents", DOC_DIR), ("research_documents", RESEARCH_DIR)] {
        for row in &rows[table_index_of(table)] {
            let (Some(sha), Some(format)) = (text(row, "sha256"), text(row, "format")) else {
                return Err(reject(format!(
                    "a {table} record lacks its hash or format."
                )));
            };
            if !is_sha(sha) || !original_extension_ok(dir, format) {
                return Err(reject(format!(
                    "a {table} record has an invalid hash or format."
                )));
            }
            let path = format!("{dir}/{sha}.{format}");
            let data = files
                .get(&path)
                .ok_or_else(|| reject(format!("the original for a {table} record is missing.")))?;
            if row.values.get("byte_length").and_then(Value::as_i64) != Some(data.len() as i64) {
                return Err(reject(format!(
                    "a {table} record has the wrong byte length."
                )));
            }
            referenced.insert(path);
        }
    }
    for path in files.keys() {
        if path != RECORDS_PATH && !referenced.contains(path) {
            return Err(reject(format!("unreferenced file \"{}\".", short(path))));
        }
    }
    Ok(())
}

// ---- Inspect and restore -------------------------------------------------------------------------

fn to_preview(package: &Package, tables: Vec<TableCount>) -> Preview {
    let mut warnings = vec![SENSITIVITY_WARNING.to_owned()];
    if package.manifest.schema_version < migrations::latest_version() {
        warnings.push(
            "This package was written by an older BEACON; its records are restored as they are."
                .into(),
        );
    }
    Preview {
        format_version: package.manifest.format_version,
        app_version: package.manifest.app_version.clone(),
        schema_version: package.manifest.schema_version,
        created_at: package.manifest.created_at.clone(),
        package_sha256: package.package_sha256.clone(),
        byte_length: package.byte_length,
        file_count: package.files.len() - 1,
        tables,
        warnings,
    }
}

/// Which package rows already exist locally (`Some(local id)`), per table.
type Plan = Vec<Vec<Option<i64>>>;

fn plan(conn: &Connection, package: &Package) -> Result<(Plan, Vec<Vec<String>>)> {
    let local = read_all(conn)?;
    let (local_hashes, _) = identities(&local).map_err(reject)?;
    let (package_hashes, _) = identities(&package.rows).map_err(reject)?;
    let mut plan = Vec::new();
    for index in 0..TABLES.len() {
        let existing: HashMap<&str, i64> = local_hashes[index]
            .iter()
            .zip(&local[index])
            .map(|(hash, row)| (hash.as_str(), row.id))
            .collect();
        plan.push(
            package_hashes[index]
                .iter()
                .map(|hash| existing.get(hash.as_str()).copied())
                .collect(),
        );
    }
    Ok((plan, package_hashes))
}

fn summarize(plan: &Plan, package: &Package, hashes: &[Vec<String>]) -> Vec<TableCount> {
    // Records repeated inside the package count as existing after their first copy.
    TABLES
        .iter()
        .enumerate()
        .map(|(index, table)| {
            let mut seen = HashSet::new();
            let mut added = 0;
            for (slot, hash) in plan[index].iter().zip(&hashes[index]) {
                if slot.is_none() && seen.insert(hash.as_str()) {
                    added += 1;
                }
            }
            let total = package.rows[index].len();
            TableCount {
                table: table.name.to_owned(),
                total,
                added,
                existing: total - added,
            }
        })
        .collect()
}

/// Validate a package and report what restoring it would do. Changes nothing.
pub fn inspect(conn: &Connection, bytes: &[u8]) -> Result<Preview> {
    let package = parse(bytes)?;
    let (plan, hashes) = plan(conn, &package)?;
    let tables = summarize(&plan, &package, &hashes);
    Ok(to_preview(&package, tables))
}

fn sql_value(value: &Value) -> Result<SqlValue> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::String(text) => Ok(SqlValue::Text(text.clone())),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .ok_or_else(|| reject("a number is not an integer.")),
        _ => Err(reject("an unsupported value type.")),
    }
}

/// Restore `bytes`. `confirm_sha256` must equal the package digest shown by [`inspect`], so only
/// the package the user reviewed can be restored. All-or-nothing: on any error neither the
/// database nor the originals directories change (files created by this call are removed).
pub fn restore(
    conn: &Connection,
    data_dir: &Path,
    bytes: &[u8],
    confirm_sha256: &str,
) -> Result<RestoreReport> {
    let package = parse(bytes)?;
    if confirm_sha256 != package.package_sha256 {
        return Err(AppError::Validation(
            "The package does not match the one that was previewed. Preview it again before restoring."
                .into(),
        ));
    }
    let mut created_files: Vec<std::path::PathBuf> = Vec::new();
    let outcome = restore_inner(conn, data_dir, &package, &mut created_files);
    if outcome.is_err() {
        for path in &created_files {
            let _ = fs::remove_file(path);
        }
    }
    outcome
}

fn restore_inner(
    conn: &Connection,
    data_dir: &Path,
    package: &Package,
    created_files: &mut Vec<std::path::PathBuf>,
) -> Result<RestoreReport> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let (plan, hashes) = plan(&tx, package)?;
    let summary = summarize(&plan, package, &hashes);

    // Local ids by identity, updated as rows are inserted so repeats inside the package merge.
    let mut known: Vec<HashMap<String, i64>> = vec![HashMap::new(); TABLES.len()];
    let mut id_map: HashMap<(usize, i64), i64> = HashMap::new();
    for (index, table) in TABLES.iter().enumerate() {
        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({})",
            table.name,
            table.cols.join(", "),
            (1..=table.cols.len())
                .map(|n| format!("?{n}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let mut insert = tx.prepare(&sql)?;
        for (position, row) in package.rows[index].iter().enumerate() {
            let hash = &hashes[index][position];
            let local_id = if let Some(existing) = plan[index][position] {
                existing
            } else if let Some(already) = known[index].get(hash) {
                *already
            } else {
                let mut params = Vec::with_capacity(table.cols.len());
                for column in table.cols {
                    let value = &row.values[*column];
                    let fk = table.fks.iter().find(|(c, _)| c == column);
                    params.push(match (fk, value) {
                        (Some((_, parent)), Value::Number(n)) => {
                            let parent_id = n.as_i64().ok_or_else(|| reject("a bad reference."))?;
                            let mapped = id_map
                                .get(&(table_index_of(parent), parent_id))
                                .ok_or_else(|| reject("a record points at a missing parent."))?;
                            SqlValue::Integer(*mapped)
                        }
                        _ => sql_value(value)?,
                    });
                }
                insert.execute(params_from_iter(params))?;
                tx.last_insert_rowid()
            };
            known[index].insert(hash.clone(), local_id);
            id_map.insert((index, row.id), local_id);
        }
    }

    // Originals: content-addressed, atomic, idempotent. Existing records get a damaged or
    // missing original repaired from the (verified) package bytes.
    for (table, dir) in [("documents", DOC_DIR), ("research_documents", RESEARCH_DIR)] {
        let target_dir = data_dir.join(dir);
        for row in &package.rows[table_index_of(table)] {
            let sha = row.values["sha256"].as_str().ok_or(AppError::Internal)?;
            let format = row.values["format"].as_str().ok_or(AppError::Internal)?;
            let data = &package.files[&format!("{dir}/{sha}.{format}")];
            let stored = documents::store_original(&target_dir, sha, format, data)?;
            if stored == Stored::Created {
                created_files.push(target_dir.join(format!("{sha}.{format}")));
            }
        }
    }
    tx.commit()?;
    Ok(to_preview(package, summary))
}

#[cfg(test)]
mod tests;
