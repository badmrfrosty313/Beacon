//! B-014 / B-015: private research collections and local import of PDF, Markdown and text.
//!
//! # Model
//!
//! * The **original bytes** are the source of truth. Each is written once, unmodified, to
//!   `<data dir>/research_originals/<sha256>.<pdf|md|txt>`; the name comes from the hash, never
//!   from the user's file name.
//! * `research_documents.content` is **derivative** text. For `.md`/`.txt` the backend decodes
//!   it from the verified bytes itself. For a PDF the backend cannot read the format, so the
//!   frontend extracts the text locally (no network, no PDF scripting) and supplies it; the
//!   backend bounds and validates it, records the extraction method and says plainly that the
//!   text is derivative. Reading a document re-verifies the original's length and SHA-256.
//! * Everything is private. `visibility` is a column that can only hold `private`; there is no
//!   publish, sync or upload path.
//! * Mapping into Watchtower is explicit and separate: `research_source_links` ties a
//!   Watchtower source to the document it came from, and `research_excerpts` records that a
//!   claim's text is an excerpt the user chose. Neither creates facts, classifications or
//!   evidence by itself.
//!
//! # Failure recovery
//!
//! Same order as the Archive: stage and atomically rename the original, then insert the row.
//! A failed insert deliberately keeps the verified original (another process may have committed
//! a row for it). Importing the same bytes again reports a duplicate, changes nothing, and
//! restores the original if it was lost or damaged.

pub mod base64;
pub mod validation;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::documents::query;
use crate::documents::validation::{validate_content, Rejection};
use crate::documents::{self, Stored};
use crate::error::{AppError, Result};
use crate::watchtower::validation as wv;
use validation as v;

pub const LIST_LIMIT: i64 = 1000;
pub const SEARCH_LIMIT: i64 = 100;
pub const MAX_DOCUMENTS: i64 = 2000;
pub const MAX_COLLECTIONS: i64 = 200;
pub const MAX_LINKS: i64 = 5000;
const ORIGINALS_DIR: &str = "research_originals";
/// Control characters cannot occur in validated text, so they can never be confused with content.
const SNIPPET_ARGS: &str = "char(1), char(2), '…', 24";
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

fn invalid(message: impl Into<String>) -> AppError {
    AppError::Validation(message.into())
}

fn reject(rejection: Rejection) -> AppError {
    AppError::Validation(rejection.0.to_owned())
}

fn checked<T>(result: std::result::Result<T, String>) -> Result<T> {
    result.map_err(AppError::Validation)
}

// ---- Records ------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRecord {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub document_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchSummary {
    pub id: i64,
    pub collection_id: i64,
    pub title: String,
    pub original_name: String,
    pub format: String,
    pub sha256: String,
    pub byte_length: i64,
    pub page_count: Option<i64>,
    pub text_truncated: bool,
    pub extraction_method: String,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub published_date: Option<String>,
    pub imported_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchDocument {
    #[serde(flatten)]
    pub summary: ResearchSummary,
    pub attribution_note: Option<String>,
    pub rights_note: Option<String>,
    /// Derivative text for reading and search; not the original.
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: i64,
    pub collection_id: i64,
    pub title: String,
    pub format: String,
    pub snippet: String,
    pub imported_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    pub id: i64,
    pub research_document_id: i64,
    pub source_id: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Excerpt {
    pub id: i64,
    pub research_document_id: i64,
    pub claim_id: i64,
    pub location: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Links {
    pub source_links: Vec<SourceLink>,
    pub excerpts: Vec<Excerpt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateMatch {
    pub id: i64,
    pub title: String,
}

/// Where the same bytes already exist. Both may be set; neither blocks an import into a
/// collection from the *other* library, but a match in `research` always does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCheck {
    pub research: Option<DuplicateMatch>,
    pub archive: Option<DuplicateMatch>,
}

// ---- Inputs -------------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportInput {
    /// The file name as chosen (display only).
    pub name: String,
    /// The exact original bytes, standard base64.
    pub data: String,
    pub collection_id: i64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub published_date: Option<String>,
    #[serde(default)]
    pub attribution_note: Option<String>,
    #[serde(default)]
    pub rights_note: Option<String>,
    /// PDF only: text the frontend extracted locally. Ignored for `.md`/`.txt`.
    #[serde(default)]
    pub extracted_text: Option<String>,
    #[serde(default)]
    pub extraction_method: Option<String>,
    #[serde(default)]
    pub page_count: Option<i64>,
    #[serde(default)]
    pub text_truncated: Option<bool>,
}

/// The only fields a person may change after import. Hash, original and text are fixed.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataInput {
    pub collection_id: i64,
    pub title: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub published_date: Option<String>,
    #[serde(default)]
    pub attribution_note: Option<String>,
    #[serde(default)]
    pub rights_note: Option<String>,
}

// ---- Helpers ------------------------------------------------------------------------------

fn originals_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(ORIGINALS_DIR)
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn exists(conn: &Connection, table: &'static str, id: i64) -> Result<bool> {
    let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1)");
    Ok(conn.query_row(&sql, params![id], |row| row.get(0))?)
}

fn require(conn: &Connection, table: &'static str, id: i64, message: &str) -> Result<()> {
    if exists(conn, table, id)? {
        Ok(())
    } else {
        Err(invalid(message))
    }
}

fn count(conn: &Connection, table: &'static str) -> Result<i64> {
    Ok(
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })?,
    )
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

fn note(label: &str, value: Option<&str>) -> Result<Option<String>> {
    let text = checked(wv::optional_text(label, value))?;
    if let Some(text) = &text {
        if text.chars().count() > v::MAX_NOTE_CHARS {
            return Err(invalid(format!(
                "{label} must be at most {} characters.",
                v::MAX_NOTE_CHARS
            )));
        }
    }
    Ok(text)
}

struct ValidMetadata {
    title: String,
    author: Option<String>,
    publisher: Option<String>,
    published_date: Option<String>,
    attribution_note: Option<String>,
    rights_note: Option<String>,
}

fn validate_metadata(
    title: &str,
    author: Option<&str>,
    publisher: Option<&str>,
    published_date: Option<&str>,
    attribution_note: Option<&str>,
    rights_note: Option<&str>,
) -> Result<ValidMetadata> {
    Ok(ValidMetadata {
        title: checked(wv::required_line("The title", title))?,
        author: checked(wv::optional_line("The author", author))?,
        publisher: checked(wv::optional_line("The publisher", publisher))?,
        published_date: checked(wv::optional_calendar_date("Published date", published_date))?,
        attribution_note: note("The attribution note", attribution_note)?,
        rights_note: note("The rights note", rights_note)?,
    })
}

const SUMMARY_COLUMNS: &str = "id, collection_id, title, original_name, format, sha256, \
     byte_length, page_count, text_truncated, extraction_method, author, publisher, \
     published_date, imported_at, updated_at";

fn summary_row(row: &Row<'_>) -> rusqlite::Result<ResearchSummary> {
    Ok(ResearchSummary {
        id: row.get(0)?,
        collection_id: row.get(1)?,
        title: row.get(2)?,
        original_name: row.get(3)?,
        format: row.get(4)?,
        sha256: row.get(5)?,
        byte_length: row.get(6)?,
        page_count: row.get(7)?,
        text_truncated: row.get::<_, i64>(8)? != 0,
        extraction_method: row.get(9)?,
        author: row.get(10)?,
        publisher: row.get(11)?,
        published_date: row.get(12)?,
        imported_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn find_by_hash(conn: &Connection, sha256: &str) -> Result<Option<ResearchSummary>> {
    Ok(conn
        .query_row(
            &format!("SELECT {SUMMARY_COLUMNS} FROM research_documents WHERE sha256 = ?1"),
            params![sha256],
            summary_row,
        )
        .optional()?)
}

fn duplicate(existing: &ResearchSummary, restored: bool) -> AppError {
    AppError::Duplicate {
        title: existing.title.clone(),
        restored,
    }
}

// ---- Collections --------------------------------------------------------------------------

pub fn create_collection(conn: &Connection, input: &CollectionInput) -> Result<CollectionRecord> {
    let name = v::validate_collection_name(&input.name).map_err(reject)?;
    let description = checked(wv::optional_text(
        "The description",
        input.description.as_deref(),
    ))?;
    if let Some(text) = &description {
        if text.chars().count() > v::MAX_COLLECTION_DESCRIPTION_CHARS {
            return Err(invalid("The description must be at most 1000 characters."));
        }
    }
    let tx = conn.unchecked_transaction()?;
    if count(&tx, "research_collections")? >= MAX_COLLECTIONS {
        return Err(invalid(format!(
            "You already have the maximum of {MAX_COLLECTIONS} collections."
        )));
    }
    let inserted = tx.query_row(
        "INSERT INTO research_collections (name, description) VALUES (?1, ?2)
         RETURNING id, name, description, created_at",
        params![name, description],
        |row| {
            Ok(CollectionRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
                document_count: 0,
            })
        },
    );
    match inserted {
        Ok(record) => {
            tx.commit()?;
            Ok(record)
        }
        Err(error) if is_unique_violation(&error) => {
            Err(invalid("A collection with that name already exists."))
        }
        Err(error) => Err(AppError::Database(error)),
    }
}

pub fn list_collections(conn: &Connection) -> Result<Vec<CollectionRecord>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.description, c.created_at,
                (SELECT COUNT(*) FROM research_documents d WHERE d.collection_id = c.id)
         FROM research_collections c
         ORDER BY lower(c.name), c.id
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![MAX_COLLECTIONS], |row| {
            Ok(CollectionRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
                document_count: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ---- Import -------------------------------------------------------------------------------

struct Derived {
    content: String,
    method: String,
    page_count: Option<i64>,
    truncated: bool,
}

fn derive_text(bytes: &[u8]) -> Result<Derived> {
    Ok(Derived {
        content: validate_content(bytes).map_err(reject)?,
        method: "utf8-text".to_owned(),
        page_count: None,
        truncated: false,
    })
}

fn derive_pdf(bytes: &[u8], input: &ImportInput) -> Result<Derived> {
    v::validate_pdf_header(bytes).map_err(reject)?;
    let text = input.extracted_text.clone().unwrap_or_default();
    v::validate_extracted_text(&text).map_err(reject)?;
    let method = input.extraction_method.clone().unwrap_or_default();
    v::validate_extraction_method(&method).map_err(reject)?;
    let Some(pages) = input.page_count else {
        return Err(invalid("The page count is required for a PDF."));
    };
    v::validate_page_count(pages).map_err(reject)?;
    Ok(Derived {
        content: text,
        method,
        page_count: Some(pages),
        truncated: input.text_truncated.unwrap_or(false),
    })
}

/// Import one file into a collection. Returns [`AppError::Duplicate`], changing nothing, when
/// identical bytes were imported before.
pub fn import(conn: &Connection, data_dir: &Path, input: &ImportInput) -> Result<ResearchDocument> {
    let (default_title, format) = v::validate_filename(&input.name).map_err(reject)?;
    let bytes = base64::decode(&input.data, v::MAX_ORIGINAL_BYTES)
        .map_err(|message| invalid(message.to_owned()))?;
    if bytes.is_empty() {
        return Err(invalid("The selected file is empty."));
    }
    let derived = if format == "pdf" {
        derive_pdf(&bytes, input)?
    } else {
        derive_text(&bytes)?
    };
    let meta = validate_metadata(
        input.title.as_deref().unwrap_or(&default_title),
        input.author.as_deref(),
        input.publisher.as_deref(),
        input.published_date.as_deref(),
        input.attribution_note.as_deref(),
        input.rights_note.as_deref(),
    )?;
    require(
        conn,
        "research_collections",
        input.collection_id,
        "Choose a collection that exists.",
    )?;
    let sha256 = hash(&bytes);
    let dir = originals_dir(data_dir);

    if let Some(existing) = find_by_hash(conn, &sha256)? {
        // The same bytes are already catalogued. If the archived original went missing or was
        // damaged, these hash-verified bytes safely restore it.
        let stored = documents::store_original(&dir, &existing.sha256, &existing.format, &bytes)?;
        return Err(duplicate(&existing, stored != Stored::AlreadyPresent));
    }
    if count(conn, "research_documents")? >= MAX_DOCUMENTS {
        return Err(invalid(format!(
            "You already have the maximum of {MAX_DOCUMENTS} imported documents."
        )));
    }

    // Content-addressed: never unlink on a failed insert; another process may have committed
    // a row for the same hash in the meantime.
    documents::store_original(&dir, &sha256, &format, &bytes)?;
    let inserted = conn.query_row(
        &format!(
            "INSERT INTO research_documents
               (collection_id, title, original_name, format, sha256, byte_length, content,
                extraction_method, page_count, text_truncated, author, publisher,
                published_date, attribution_note, rights_note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             RETURNING {SUMMARY_COLUMNS}"
        ),
        params![
            input.collection_id,
            meta.title,
            input.name,
            format,
            sha256,
            bytes.len() as i64,
            derived.content,
            derived.method,
            derived.page_count,
            i64::from(derived.truncated),
            meta.author,
            meta.publisher,
            meta.published_date,
            meta.attribution_note,
            meta.rights_note
        ],
        summary_row,
    );
    match inserted {
        Ok(summary) => Ok(ResearchDocument {
            summary,
            attribution_note: meta.attribution_note,
            rights_note: meta.rights_note,
            body: derived.content,
        }),
        Err(error) => {
            if is_unique_violation(&error) {
                if let Some(existing) = find_by_hash(conn, &sha256)? {
                    return Err(duplicate(&existing, false));
                }
            }
            Err(AppError::Database(error))
        }
    }
}

/// Report where the same bytes already exist, before anything is imported.
pub fn check_duplicate(conn: &Connection, sha256: &str) -> Result<DuplicateCheck> {
    v::validate_sha256(sha256).map_err(reject)?;
    let find = |table: &'static str| -> Result<Option<DuplicateMatch>> {
        Ok(conn
            .query_row(
                &format!("SELECT id, title FROM {table} WHERE sha256 = ?1"),
                params![sha256],
                |row| {
                    Ok(DuplicateMatch {
                        id: row.get(0)?,
                        title: row.get(1)?,
                    })
                },
            )
            .optional()?)
    };
    Ok(DuplicateCheck {
        research: find("research_documents")?,
        archive: find("documents")?,
    })
}

// ---- Read ---------------------------------------------------------------------------------

pub fn list(conn: &Connection, collection_id: Option<i64>) -> Result<Vec<ResearchSummary>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUMMARY_COLUMNS} FROM research_documents
         WHERE (?1 IS NULL OR collection_id = ?1)
         ORDER BY imported_at DESC, id DESC
         LIMIT ?2"
    ))?;
    let rows = stmt
        .query_map(params![collection_id, LIST_LIMIT], summary_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Read a document, verifying its preserved original first. A missing, resized or altered
/// original is reported as an integrity failure rather than shown as trusted.
pub fn get(conn: &Connection, data_dir: &Path, id: i64) -> Result<ResearchDocument> {
    let (summary, attribution_note, rights_note, content) = conn
        .query_row(
            &format!(
                "SELECT {SUMMARY_COLUMNS}, attribution_note, rights_note, content
                 FROM research_documents WHERE id = ?1"
            ),
            params![id],
            |row| Ok((summary_row(row)?, row.get(15)?, row.get(16)?, row.get(17)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    let path = originals_dir(data_dir).join(format!("{}.{}", summary.sha256, summary.format));
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::Integrity)
        }
        Err(error) => return Err(AppError::Io(error)),
    };
    if bytes.len() as i64 != summary.byte_length || hash(&bytes) != summary.sha256 {
        return Err(AppError::Integrity);
    }
    let body = if summary.format == "pdf" {
        content
    } else {
        validate_content(&bytes).map_err(|_| AppError::Integrity)?
    };
    Ok(ResearchDocument {
        summary,
        attribution_note,
        rights_note,
        body,
    })
}

fn is_fts_syntax_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(_, Some(message)) if message.starts_with("fts5:")
    )
}

/// Search imported research text. Input is parsed into literal words and phrases exactly as in
/// the Archive search, bound as a parameter, and capped at [`SEARCH_LIMIT`] hits.
pub fn search(conn: &Connection, text: &str, collection_id: Option<i64>) -> Result<Vec<SearchHit>> {
    let units = query::parse(text).map_err(reject)?;
    if units.is_empty() {
        return Ok(Vec::new());
    }
    let expression = query::to_match_expression(&units);
    let sql = format!(
        "SELECT d.id, d.collection_id, d.title, d.format,
                snippet(research_documents_fts, -1, {SNIPPET_ARGS}), d.imported_at
         FROM research_documents_fts
         JOIN research_documents d ON d.id = research_documents_fts.rowid
         WHERE research_documents_fts MATCH ?1 AND (?3 IS NULL OR d.collection_id = ?3)
         ORDER BY bm25(research_documents_fts), d.id DESC
         LIMIT ?2"
    );
    let run = || -> rusqlite::Result<Vec<SearchHit>> {
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![expression, SEARCH_LIMIT, collection_id], |row| {
                Ok(SearchHit {
                    id: row.get(0)?,
                    collection_id: row.get(1)?,
                    title: row.get(2)?,
                    format: row.get(3)?,
                    snippet: row.get(4)?,
                    imported_at: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    };
    run().map_err(|error| {
        if is_fts_syntax_error(&error) {
            invalid("That search could not be understood.")
        } else {
            AppError::Database(error)
        }
    })
}

// ---- Metadata -----------------------------------------------------------------------------

/// Change only the user-controlled metadata. The original, hash, extracted text and import
/// time are never touched.
pub fn update_metadata(
    conn: &Connection,
    id: i64,
    input: &MetadataInput,
) -> Result<ResearchSummary> {
    let meta = validate_metadata(
        &input.title,
        input.author.as_deref(),
        input.publisher.as_deref(),
        input.published_date.as_deref(),
        input.attribution_note.as_deref(),
        input.rights_note.as_deref(),
    )?;
    let tx = conn.unchecked_transaction()?;
    require(
        &tx,
        "research_collections",
        input.collection_id,
        "Choose a collection that exists.",
    )?;
    let summary = tx
        .query_row(
            &format!(
                "UPDATE research_documents
                 SET collection_id = ?2, title = ?3, author = ?4, publisher = ?5,
                     published_date = ?6, attribution_note = ?7, rights_note = ?8,
                     updated_at = {NOW}
                 WHERE id = ?1 RETURNING {SUMMARY_COLUMNS}"
            ),
            params![
                id,
                input.collection_id,
                meta.title,
                meta.author,
                meta.publisher,
                meta.published_date,
                meta.attribution_note,
                meta.rights_note
            ],
            summary_row,
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    tx.commit()?;
    Ok(summary)
}

// ---- Watchtower mapping -------------------------------------------------------------------

/// Record that a Watchtower source was created from an imported document. Idempotent.
pub fn link_source(conn: &Connection, document_id: i64, source_id: i64) -> Result<SourceLink> {
    let tx = conn.unchecked_transaction()?;
    require(
        &tx,
        "research_documents",
        document_id,
        "That imported document does not exist.",
    )?;
    require(
        &tx,
        "watchtower_sources",
        source_id,
        "That source does not exist.",
    )?;
    if count(&tx, "research_source_links")? >= MAX_LINKS {
        return Err(invalid(format!(
            "This workspace already holds the maximum of {MAX_LINKS} links of this kind."
        )));
    }
    tx.execute(
        "INSERT INTO research_source_links (research_document_id, source_id) VALUES (?1, ?2)
         ON CONFLICT (research_document_id, source_id) DO NOTHING",
        params![document_id, source_id],
    )?;
    let link = tx.query_row(
        "SELECT id, research_document_id, source_id, created_at FROM research_source_links
         WHERE research_document_id = ?1 AND source_id = ?2",
        params![document_id, source_id],
        |row| {
            Ok(SourceLink {
                id: row.get(0)?,
                research_document_id: row.get(1)?,
                source_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )?;
    tx.commit()?;
    Ok(link)
}

/// Record that a Watchtower claim's text is an excerpt the user chose from an imported
/// document. The claim's own source must already be linked to the same document, so an
/// excerpt can never point at a document the claim does not cite.
pub fn link_excerpt(
    conn: &Connection,
    document_id: i64,
    claim_id: i64,
    location: Option<&str>,
) -> Result<Excerpt> {
    let location = match location {
        Some(text) => v::validate_location(text).map_err(reject)?,
        None => None,
    };
    let tx = conn.unchecked_transaction()?;
    require(
        &tx,
        "research_documents",
        document_id,
        "That imported document does not exist.",
    )?;
    require(
        &tx,
        "watchtower_claims",
        claim_id,
        "That statement does not exist.",
    )?;
    let cites_document: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM watchtower_claims c
           JOIN research_source_links l ON l.source_id = c.source_id
           WHERE c.id = ?1 AND l.research_document_id = ?2)",
        params![claim_id, document_id],
        |row| row.get(0),
    )?;
    if !cites_document {
        return Err(invalid(
            "The statement's source must be a source created from this document.",
        ));
    }
    if exists_excerpt(&tx, claim_id)? {
        return Err(invalid("That statement is already recorded as an excerpt."));
    }
    if count(&tx, "research_excerpts")? >= MAX_LINKS {
        return Err(invalid(format!(
            "This workspace already holds the maximum of {MAX_LINKS} links of this kind."
        )));
    }
    let excerpt = tx.query_row(
        "INSERT INTO research_excerpts (research_document_id, claim_id, location)
         VALUES (?1, ?2, ?3)
         RETURNING id, research_document_id, claim_id, location, created_at",
        params![document_id, claim_id, location],
        excerpt_row,
    )?;
    tx.commit()?;
    Ok(excerpt)
}

fn exists_excerpt(conn: &Connection, claim_id: i64) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM research_excerpts WHERE claim_id = ?1)",
        params![claim_id],
        |row| row.get(0),
    )?)
}

fn excerpt_row(row: &Row<'_>) -> rusqlite::Result<Excerpt> {
    Ok(Excerpt {
        id: row.get(0)?,
        research_document_id: row.get(1)?,
        claim_id: row.get(2)?,
        location: row.get(3)?,
        created_at: row.get(4)?,
    })
}

/// Every mapping link, in one consistent read.
pub fn links(conn: &Connection) -> Result<Links> {
    let tx = conn.unchecked_transaction()?;
    let source_links = {
        let mut stmt = tx.prepare(
            "SELECT id, research_document_id, source_id, created_at
             FROM research_source_links ORDER BY id LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![MAX_LINKS], |row| {
                Ok(SourceLink {
                    id: row.get(0)?,
                    research_document_id: row.get(1)?,
                    source_id: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let excerpts = {
        let mut stmt = tx.prepare(
            "SELECT id, research_document_id, claim_id, location, created_at
             FROM research_excerpts ORDER BY id LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![MAX_LINKS], excerpt_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    tx.commit()?;
    Ok(Links {
        source_links,
        excerpts,
    })
}

/// Remove temporary files left by an interrupted write (best effort, old files only).
pub fn sweep_stale_temp_files(data_dir: &Path, min_age: Duration) -> usize {
    documents::sweep_stale_temp_files_in(&originals_dir(data_dir), min_age)
}

#[cfg(test)]
mod tests;
