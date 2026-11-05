//! Watchtower: private, local research records with explicit provenance.
//!
//! Five record types: events, sources, claims, hypotheses and evidence links.
//!
//! * An **event** says what happened and (optionally) WHEN it happened. That time is kept apart
//!   from when a source was published, when the user retrieved it, and when the record was
//!   created; none of them is ever guessed from another.
//! * A **source** carries provenance as data. A URL is metadata only; it is never fetched and
//!   is not an offline copy. A source may point at an Archive document the user preserved.
//! * A **claim** is a classified statement about an event: an observation, an attributed claim,
//!   an interpretation or a forecast. The class is mandatory and never inferred.
//! * A **hypothesis** is a proposition under evaluation, never a verified fact. Its status is set
//!   by the user only; there is no score or probability.
//! * An **evidence link** says that a claim or a source supports, contradicts or gives context
//!   for a hypothesis, with a short explanation. Conflicting links are kept side by side.
//!
//! Everything validates here first (see [`validation`]); the SQL CHECKs and foreign keys in
//! migration 0004 are the backstop. All SQL uses bound parameters. There are no deletes in this
//! release; edits overwrite the current values and bump `updated_at` (no revision history yet).

pub mod dates;
pub mod validation;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use validation as v;

/// Most rows of each kind. Bounds the snapshot that crosses IPC.
pub const MAX_RECORDS_PER_TABLE: i64 = 5000;

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

fn invalid(message: impl Into<String>) -> AppError {
    AppError::Validation(message.into())
}

fn checked<T>(result: std::result::Result<T, String>) -> Result<T> {
    result.map_err(AppError::Validation)
}

// ---- Records (what leaves the backend) ---------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    /// When the event happened, as stated by the user; `None` means undated.
    pub event_date: Option<String>,
    /// `year`, `month`, `day` or `minute`; `None` exactly when `event_date` is `None`.
    pub date_precision: Option<String>,
    /// Ordering key (minutes since 1970-01-01T00:00Z at the start of the period).
    pub event_sort: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecord {
    pub id: i64,
    pub title: String,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub url: Option<String>,
    pub published_date: Option<String>,
    pub retrieved_date: Option<String>,
    pub document_id: Option<i64>,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRecord {
    pub id: i64,
    pub event_id: i64,
    pub source_id: Option<i64>,
    pub kind: String,
    pub text: String,
    pub attribution: Option<String>,
    pub scripture_reference: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HypothesisRecord {
    pub id: i64,
    pub title: String,
    pub statement: String,
    pub status: String,
    pub scripture_reference: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRecord {
    pub id: i64,
    pub hypothesis_id: i64,
    pub relation: String,
    pub claim_id: Option<i64>,
    pub source_id: Option<i64>,
    pub event_id: Option<i64>,
    pub explanation: String,
    pub created_at: String,
}

/// Every Watchtower record. Derived views (timeline, detail panels) are computed from this by
/// the same frontend code for both storage backends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub events: Vec<EventRecord>,
    pub sources: Vec<SourceRecord>,
    pub claims: Vec<ClaimRecord>,
    pub hypotheses: Vec<HypothesisRecord>,
    pub links: Vec<LinkRecord>,
}

// ---- Inputs (what the frontend sends) ----------------------------------------------------

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub event_date: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInput {
    pub title: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub published_date: Option<String>,
    #[serde(default)]
    pub retrieved_date: Option<String>,
    #[serde(default)]
    pub document_id: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimInput {
    pub event_id: i64,
    #[serde(default)]
    pub source_id: Option<i64>,
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub attribution: Option<String>,
    #[serde(default)]
    pub scripture_reference: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HypothesisInput {
    pub title: String,
    pub statement: String,
    /// Defaults to `open` when creating; unchanged-if-absent is not supported, send the status.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub scripture_reference: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInput {
    pub hypothesis_id: i64,
    pub relation: String,
    #[serde(default)]
    pub claim_id: Option<i64>,
    #[serde(default)]
    pub source_id: Option<i64>,
    #[serde(default)]
    pub event_id: Option<i64>,
    pub explanation: String,
}

// ---- Row mapping --------------------------------------------------------------------------

const EVENT_COLUMNS: &str =
    "id, title, description, event_date, date_precision, event_sort, created_at, updated_at";
const SOURCE_COLUMNS: &str = "id, title, author, publisher, url, published_date, retrieved_date, \
                              document_id, note, created_at, updated_at";
const CLAIM_COLUMNS: &str =
    "id, event_id, source_id, kind, text, attribution, scripture_reference, created_at, updated_at";
const HYPOTHESIS_COLUMNS: &str =
    "id, title, statement, status, scripture_reference, created_at, updated_at";
const LINK_COLUMNS: &str =
    "id, hypothesis_id, relation, claim_id, source_id, event_id, explanation, created_at";

fn event_row(row: &Row<'_>) -> rusqlite::Result<EventRecord> {
    Ok(EventRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        event_date: row.get(3)?,
        date_precision: row.get(4)?,
        event_sort: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn source_row(row: &Row<'_>) -> rusqlite::Result<SourceRecord> {
    Ok(SourceRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        author: row.get(2)?,
        publisher: row.get(3)?,
        url: row.get(4)?,
        published_date: row.get(5)?,
        retrieved_date: row.get(6)?,
        document_id: row.get(7)?,
        note: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn claim_row(row: &Row<'_>) -> rusqlite::Result<ClaimRecord> {
    Ok(ClaimRecord {
        id: row.get(0)?,
        event_id: row.get(1)?,
        source_id: row.get(2)?,
        kind: row.get(3)?,
        text: row.get(4)?,
        attribution: row.get(5)?,
        scripture_reference: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn hypothesis_row(row: &Row<'_>) -> rusqlite::Result<HypothesisRecord> {
    Ok(HypothesisRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        statement: row.get(2)?,
        status: row.get(3)?,
        scripture_reference: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn link_row(row: &Row<'_>) -> rusqlite::Result<LinkRecord> {
    Ok(LinkRecord {
        id: row.get(0)?,
        hypothesis_id: row.get(1)?,
        relation: row.get(2)?,
        claim_id: row.get(3)?,
        source_id: row.get(4)?,
        event_id: row.get(5)?,
        explanation: row.get(6)?,
        created_at: row.get(7)?,
    })
}

// ---- Shared helpers -----------------------------------------------------------------------

/// The tables a record id may refer to. A closed set, so no SQL text ever comes from input.
#[derive(Clone, Copy)]
enum Table {
    Events,
    Sources,
    Claims,
    Hypotheses,
    Links,
    Documents,
}

impl Table {
    fn name(self) -> &'static str {
        match self {
            Self::Events => "watchtower_events",
            Self::Sources => "watchtower_sources",
            Self::Claims => "watchtower_claims",
            Self::Hypotheses => "watchtower_hypotheses",
            Self::Links => "watchtower_links",
            Self::Documents => "documents",
        }
    }
}

fn exists(conn: &Connection, table: Table, id: i64) -> Result<bool> {
    let sql = format!(
        "SELECT EXISTS(SELECT 1 FROM {} WHERE id = ?1)",
        table.name()
    );
    Ok(conn.query_row(&sql, params![id], |row| row.get(0))?)
}

fn require(conn: &Connection, table: Table, id: i64, message: &str) -> Result<()> {
    if exists(conn, table, id)? {
        Ok(())
    } else {
        Err(invalid(message))
    }
}

fn ensure_room(conn: &Connection, table: Table, limit: i64) -> Result<()> {
    let sql = format!("SELECT COUNT(*) FROM {}", table.name());
    let count: i64 = conn.query_row(&sql, [], |row| row.get(0))?;
    if count >= limit {
        return Err(invalid(format!(
            "This workspace already holds the maximum of {limit} records of this kind."
        )));
    }
    Ok(())
}

// ---- Events -------------------------------------------------------------------------------

struct ValidEvent {
    title: String,
    description: Option<String>,
    date: Option<dates::EventDate>,
}

fn validate_event(input: &EventInput) -> Result<ValidEvent> {
    Ok(ValidEvent {
        title: checked(v::required_line("The title", &input.title))?,
        description: checked(v::optional_text(
            "The description",
            input.description.as_deref(),
        ))?,
        date: checked(v::optional_event_date(input.event_date.as_deref()))?,
    })
}

pub fn create_event(conn: &Connection, input: &EventInput) -> Result<EventRecord> {
    let valid = validate_event(input)?;
    let tx = conn.unchecked_transaction()?;
    ensure_room(&tx, Table::Events, MAX_RECORDS_PER_TABLE)?;
    let (date, precision, sort) = split_date(&valid.date);
    let record = tx.query_row(
        &format!(
            "INSERT INTO watchtower_events (title, description, event_date, date_precision, event_sort)
             VALUES (?1, ?2, ?3, ?4, ?5) RETURNING {EVENT_COLUMNS}"
        ),
        params![valid.title, valid.description, date, precision, sort],
        event_row,
    )?;
    tx.commit()?;
    Ok(record)
}

pub fn update_event(conn: &Connection, id: i64, input: &EventInput) -> Result<EventRecord> {
    let valid = validate_event(input)?;
    let tx = conn.unchecked_transaction()?;
    let (date, precision, sort) = split_date(&valid.date);
    let record = tx
        .query_row(
            &format!(
                "UPDATE watchtower_events
                 SET title = ?2, description = ?3, event_date = ?4, date_precision = ?5,
                     event_sort = ?6, updated_at = {NOW}
                 WHERE id = ?1 RETURNING {EVENT_COLUMNS}"
            ),
            params![id, valid.title, valid.description, date, precision, sort],
            event_row,
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    tx.commit()?;
    Ok(record)
}

fn split_date(
    date: &Option<dates::EventDate>,
) -> (Option<&str>, Option<&'static str>, Option<i64>) {
    match date {
        Some(d) => (
            Some(d.text.as_str()),
            Some(d.precision.as_str()),
            Some(d.sort),
        ),
        None => (None, None, None),
    }
}

// ---- Sources ------------------------------------------------------------------------------

struct ValidSource {
    title: String,
    author: Option<String>,
    publisher: Option<String>,
    url: Option<String>,
    published_date: Option<String>,
    retrieved_date: Option<String>,
    document_id: Option<i64>,
    note: Option<String>,
}

fn validate_source(conn: &Connection, input: &SourceInput) -> Result<ValidSource> {
    let valid = ValidSource {
        title: checked(v::required_line("The title", &input.title))?,
        author: checked(v::optional_line("The author", input.author.as_deref()))?,
        publisher: checked(v::optional_line(
            "The publisher",
            input.publisher.as_deref(),
        ))?,
        url: checked(v::optional_url(input.url.as_deref()))?,
        published_date: checked(v::optional_calendar_date(
            "Published date",
            input.published_date.as_deref(),
        ))?,
        retrieved_date: checked(v::optional_calendar_date(
            "Retrieved date",
            input.retrieved_date.as_deref(),
        ))?,
        document_id: input.document_id,
        note: checked(v::optional_text("The note", input.note.as_deref()))?,
    };
    if valid.author.is_none()
        && valid.publisher.is_none()
        && valid.url.is_none()
        && valid.document_id.is_none()
    {
        return Err(invalid(
            "Give at least one way to identify the source: an author, a publisher, a URL or an Archive document.",
        ));
    }
    if let Some(document_id) = valid.document_id {
        require(
            conn,
            Table::Documents,
            document_id,
            "That Archive document does not exist.",
        )?;
    }
    Ok(valid)
}

pub fn create_source(conn: &Connection, input: &SourceInput) -> Result<SourceRecord> {
    let tx = conn.unchecked_transaction()?;
    let valid = validate_source(&tx, input)?;
    ensure_room(&tx, Table::Sources, MAX_RECORDS_PER_TABLE)?;
    let record = tx.query_row(
        &format!(
            "INSERT INTO watchtower_sources
               (title, author, publisher, url, published_date, retrieved_date, document_id, note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING {SOURCE_COLUMNS}"
        ),
        params![
            valid.title,
            valid.author,
            valid.publisher,
            valid.url,
            valid.published_date,
            valid.retrieved_date,
            valid.document_id,
            valid.note
        ],
        source_row,
    )?;
    tx.commit()?;
    Ok(record)
}

pub fn update_source(conn: &Connection, id: i64, input: &SourceInput) -> Result<SourceRecord> {
    let tx = conn.unchecked_transaction()?;
    let valid = validate_source(&tx, input)?;
    let record = tx
        .query_row(
            &format!(
                "UPDATE watchtower_sources
                 SET title = ?2, author = ?3, publisher = ?4, url = ?5, published_date = ?6,
                     retrieved_date = ?7, document_id = ?8, note = ?9, updated_at = {NOW}
                 WHERE id = ?1 RETURNING {SOURCE_COLUMNS}"
            ),
            params![
                id,
                valid.title,
                valid.author,
                valid.publisher,
                valid.url,
                valid.published_date,
                valid.retrieved_date,
                valid.document_id,
                valid.note
            ],
            source_row,
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    tx.commit()?;
    Ok(record)
}

// ---- Claims -------------------------------------------------------------------------------

pub fn create_claim(conn: &Connection, input: &ClaimInput) -> Result<ClaimRecord> {
    let kind = checked(v::one_of("The record type", &input.kind, &v::CLAIM_KINDS))?;
    let text = checked(v::required_text(
        "The statement",
        &input.text,
        v::MAX_TEXT_CHARS,
    ))?;
    let attribution = checked(v::optional_line(
        "The attribution",
        input.attribution.as_deref(),
    ))?;
    let scripture = checked(v::optional_scripture_reference(
        input.scripture_reference.as_deref(),
    ))?;
    if kind == "attributed_claim" && attribution.is_none() {
        return Err(invalid(
            "An attributed claim must say who made the claim. Fill in the attribution.",
        ));
    }

    let tx = conn.unchecked_transaction()?;
    require(
        &tx,
        Table::Events,
        input.event_id,
        "That event does not exist.",
    )?;
    if let Some(source_id) = input.source_id {
        require(
            &tx,
            Table::Sources,
            source_id,
            "That source does not exist.",
        )?;
    }
    ensure_room(&tx, Table::Claims, MAX_RECORDS_PER_TABLE)?;
    let record = tx.query_row(
        &format!(
            "INSERT INTO watchtower_claims
               (event_id, source_id, kind, text, attribution, scripture_reference)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING {CLAIM_COLUMNS}"
        ),
        params![
            input.event_id,
            input.source_id,
            kind,
            text,
            attribution,
            scripture
        ],
        claim_row,
    )?;
    tx.commit()?;
    Ok(record)
}

// ---- Hypotheses ---------------------------------------------------------------------------

struct ValidHypothesis {
    title: String,
    statement: String,
    status: String,
    scripture_reference: Option<String>,
}

fn validate_hypothesis(input: &HypothesisInput) -> Result<ValidHypothesis> {
    let status = match input.status.as_deref() {
        None | Some("") => "open".to_owned(),
        Some(value) => checked(v::one_of("The status", value, &v::HYPOTHESIS_STATUSES))?,
    };
    Ok(ValidHypothesis {
        title: checked(v::required_line("The title", &input.title))?,
        statement: checked(v::required_text(
            "The statement",
            &input.statement,
            v::MAX_TEXT_CHARS,
        ))?,
        status,
        scripture_reference: checked(v::optional_scripture_reference(
            input.scripture_reference.as_deref(),
        ))?,
    })
}

pub fn create_hypothesis(conn: &Connection, input: &HypothesisInput) -> Result<HypothesisRecord> {
    let valid = validate_hypothesis(input)?;
    let tx = conn.unchecked_transaction()?;
    ensure_room(&tx, Table::Hypotheses, MAX_RECORDS_PER_TABLE)?;
    let record = tx.query_row(
        &format!(
            "INSERT INTO watchtower_hypotheses (title, statement, status, scripture_reference)
             VALUES (?1, ?2, ?3, ?4) RETURNING {HYPOTHESIS_COLUMNS}"
        ),
        params![
            valid.title,
            valid.statement,
            valid.status,
            valid.scripture_reference
        ],
        hypothesis_row,
    )?;
    tx.commit()?;
    Ok(record)
}

pub fn update_hypothesis(
    conn: &Connection,
    id: i64,
    input: &HypothesisInput,
) -> Result<HypothesisRecord> {
    let valid = validate_hypothesis(input)?;
    let tx = conn.unchecked_transaction()?;
    let record = tx
        .query_row(
            &format!(
                "UPDATE watchtower_hypotheses
                 SET title = ?2, statement = ?3, status = ?4, scripture_reference = ?5,
                     updated_at = {NOW}
                 WHERE id = ?1 RETURNING {HYPOTHESIS_COLUMNS}"
            ),
            params![
                id,
                valid.title,
                valid.statement,
                valid.status,
                valid.scripture_reference
            ],
            hypothesis_row,
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    tx.commit()?;
    Ok(record)
}

// ---- Evidence links -----------------------------------------------------------------------

pub fn create_link(conn: &Connection, input: &LinkInput) -> Result<LinkRecord> {
    let relation = checked(v::one_of(
        "The relationship",
        &input.relation,
        &v::LINK_RELATIONS,
    ))?;
    let explanation = checked(v::required_text(
        "The explanation",
        &input.explanation,
        v::MAX_EXPLANATION_CHARS,
    ))?;
    if input.claim_id.is_none() && input.source_id.is_none() {
        return Err(invalid("Choose the evidence: a claim, a source, or both."));
    }
    if input.claim_id.is_some() && input.event_id.is_some() {
        return Err(invalid(
            "A claim already belongs to an event. Choose the claim or an event, not both.",
        ));
    }

    let tx = conn.unchecked_transaction()?;
    require(
        &tx,
        Table::Hypotheses,
        input.hypothesis_id,
        "That hypothesis does not exist.",
    )?;
    if let Some(claim_id) = input.claim_id {
        require(&tx, Table::Claims, claim_id, "That claim does not exist.")?;
    }
    if let Some(source_id) = input.source_id {
        require(
            &tx,
            Table::Sources,
            source_id,
            "That source does not exist.",
        )?;
    }
    if let Some(event_id) = input.event_id {
        require(&tx, Table::Events, event_id, "That event does not exist.")?;
    }
    let duplicate: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM watchtower_links
           WHERE hypothesis_id = ?1 AND relation = ?2 AND claim_id IS ?3
             AND source_id IS ?4 AND event_id IS ?5)",
        params![
            input.hypothesis_id,
            relation,
            input.claim_id,
            input.source_id,
            input.event_id
        ],
        |row| row.get(0),
    )?;
    if duplicate {
        return Err(invalid(
            "This evidence is already linked to that hypothesis with the same relationship.",
        ));
    }
    ensure_room(&tx, Table::Links, MAX_RECORDS_PER_TABLE)?;
    let record = tx.query_row(
        &format!(
            "INSERT INTO watchtower_links
               (hypothesis_id, relation, claim_id, source_id, event_id, explanation)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING {LINK_COLUMNS}"
        ),
        params![
            input.hypothesis_id,
            relation,
            input.claim_id,
            input.source_id,
            input.event_id,
            explanation
        ],
        link_row,
    )?;
    tx.commit()?;
    Ok(record)
}

// ---- Reading ------------------------------------------------------------------------------

fn collect<T>(
    conn: &Connection,
    sql: &str,
    map: fn(&Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>> {
    let mut statement = conn.prepare(sql)?;
    let rows = statement
        .query_map(params![MAX_RECORDS_PER_TABLE], map)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// All records, read in one transaction so the five lists agree with each other.
/// Events come dated-first by event time (oldest first), then undated ones in creation order.
pub fn snapshot(conn: &Connection) -> Result<Snapshot> {
    let tx = conn.unchecked_transaction()?;
    let snapshot = Snapshot {
        events: collect(
            &tx,
            &format!(
                "SELECT {EVENT_COLUMNS} FROM watchtower_events
                 ORDER BY event_sort IS NULL, event_sort, id LIMIT ?1"
            ),
            event_row,
        )?,
        sources: collect(
            &tx,
            &format!("SELECT {SOURCE_COLUMNS} FROM watchtower_sources ORDER BY id LIMIT ?1"),
            source_row,
        )?,
        claims: collect(
            &tx,
            &format!("SELECT {CLAIM_COLUMNS} FROM watchtower_claims ORDER BY id LIMIT ?1"),
            claim_row,
        )?,
        hypotheses: collect(
            &tx,
            &format!("SELECT {HYPOTHESIS_COLUMNS} FROM watchtower_hypotheses ORDER BY id LIMIT ?1"),
            hypothesis_row,
        )?,
        links: collect(
            &tx,
            &format!("SELECT {LINK_COLUMNS} FROM watchtower_links ORDER BY id LIMIT ?1"),
            link_row,
        )?,
    };
    tx.commit()?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn conn() -> Connection {
        db::open_in_memory_migrated().expect("in-memory database should migrate")
    }

    fn event(conn: &Connection, title: &str, date: Option<&str>) -> EventRecord {
        create_event(
            conn,
            &EventInput {
                title: title.to_owned(),
                description: None,
                event_date: date.map(str::to_owned),
            },
        )
        .unwrap()
    }

    fn source(conn: &Connection, title: &str) -> SourceRecord {
        create_source(
            conn,
            &SourceInput {
                title: title.to_owned(),
                publisher: Some("Example Press".to_owned()),
                ..SourceInput::default()
            },
        )
        .unwrap()
    }

    fn claim(conn: &Connection, event_id: i64, kind: &str) -> ClaimRecord {
        create_claim(
            conn,
            &ClaimInput {
                event_id,
                kind: kind.to_owned(),
                text: "Example statement".to_owned(),
                attribution: Some("Example Reporter".to_owned()),
                ..ClaimInput::default()
            },
        )
        .unwrap()
    }

    fn hypothesis(conn: &Connection, title: &str) -> HypothesisRecord {
        create_hypothesis(
            conn,
            &HypothesisInput {
                title: title.to_owned(),
                statement: "Example proposition".to_owned(),
                ..HypothesisInput::default()
            },
        )
        .unwrap()
    }

    fn link(conn: &Connection, h: i64, relation: &str, claim_id: i64) -> Result<LinkRecord> {
        create_link(
            conn,
            &LinkInput {
                hypothesis_id: h,
                relation: relation.to_owned(),
                claim_id: Some(claim_id),
                explanation: "Because of the example".to_owned(),
                ..LinkInput::default()
            },
        )
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    fn is_validation<T: std::fmt::Debug>(result: Result<T>) -> bool {
        matches!(result, Err(AppError::Validation(_)))
    }

    // ---- events and dates -----------------------------------------------------------------

    #[test]
    fn an_event_round_trips_with_its_date_precision() {
        let conn = conn();
        let created = create_event(
            &conn,
            &EventInput {
                title: "  Example event  ".to_owned(),
                description: Some("What happened.\nSecond line.".to_owned()),
                event_date: Some("2026-11-05T14:30-05:00".to_owned()),
            },
        )
        .unwrap();
        assert_eq!(created.title, "Example event");
        assert_eq!(
            created.description.as_deref(),
            Some("What happened.\nSecond line.")
        );
        assert_eq!(
            created.event_date.as_deref(),
            Some("2026-11-05T14:30-05:00")
        );
        assert_eq!(created.date_precision.as_deref(), Some("minute"));
        assert!(created.created_at.ends_with('Z') && created.created_at.contains('T'));
        assert_eq!(snapshot(&conn).unwrap().events, vec![created]);
    }

    #[test]
    fn a_missing_date_stays_missing() {
        let conn = conn();
        let undated = event(&conn, "Undated", None);
        assert_eq!(undated.event_date, None);
        assert_eq!(undated.date_precision, None);
        assert_eq!(undated.event_sort, None);
        // A blank date is the same as no date; it is never defaulted to "now".
        let blank = event(&conn, "Blank", Some("   "));
        assert_eq!(blank.event_date, None);
    }

    #[test]
    fn events_are_ordered_by_event_date_not_by_creation() {
        let conn = conn();
        event(&conn, "created first, happened last", Some("2026-11-05"));
        event(&conn, "undated A", None);
        event(&conn, "happened first", Some("1999"));
        event(&conn, "undated B", None);
        event(&conn, "middle", Some("2024-06"));
        let titles: Vec<String> = snapshot(&conn)
            .unwrap()
            .events
            .into_iter()
            .map(|e| e.title)
            .collect();
        assert_eq!(
            titles,
            [
                "happened first",
                "middle",
                "created first, happened last",
                "undated A",
                "undated B"
            ]
        );
    }

    #[test]
    fn an_explicit_zone_decides_the_order_within_a_day() {
        let conn = conn();
        // 09:30-05:00 is 14:30Z, which is later than 14:00Z even though 09:30 < 14:00 as text.
        event(&conn, "later", Some("2026-11-05T09:30-05:00"));
        event(&conn, "earlier", Some("2026-11-05T14:00Z"));
        let titles: Vec<String> = snapshot(&conn)
            .unwrap()
            .events
            .into_iter()
            .map(|e| e.title)
            .collect();
        assert_eq!(titles, ["earlier", "later"]);
    }

    #[test]
    fn invalid_event_input_is_rejected_and_stores_nothing() {
        let conn = conn();
        for (title, date) in [
            ("", None),
            ("   ", None),
            ("ok", Some("yesterday")),
            ("ok", Some("2026-02-30")),
            ("ok", Some("2026-11-05T14:30")),
        ] {
            let result = create_event(
                &conn,
                &EventInput {
                    title: title.to_owned(),
                    event_date: date.map(str::to_owned),
                    ..EventInput::default()
                },
            );
            assert!(is_validation(result), "{title:?} {date:?}");
        }
        assert!(is_validation(create_event(
            &conn,
            &EventInput {
                title: "x".repeat(201),
                ..EventInput::default()
            }
        )));
        assert_eq!(count(&conn, "watchtower_events"), 0);
    }

    #[test]
    fn editing_an_event_keeps_its_identity_and_creation_time() {
        let conn = conn();
        let original = event(&conn, "Before", Some("2020"));
        let edited = update_event(
            &conn,
            original.id,
            &EventInput {
                title: "After".to_owned(),
                description: Some("Now described".to_owned()),
                event_date: Some("2021-03-04".to_owned()),
            },
        )
        .unwrap();
        assert_eq!(edited.id, original.id);
        assert_eq!(edited.created_at, original.created_at);
        assert!(edited.updated_at >= original.updated_at);
        assert_eq!(edited.event_date.as_deref(), Some("2021-03-04"));
        assert_eq!(edited.date_precision.as_deref(), Some("day"));
        assert_ne!(edited.event_sort, original.event_sort);

        // An invalid edit changes nothing; a date can be removed; a missing id is not found.
        assert!(is_validation(update_event(
            &conn,
            original.id,
            &EventInput {
                title: "Bad".to_owned(),
                event_date: Some("nope".to_owned()),
                ..EventInput::default()
            }
        )));
        assert_eq!(snapshot(&conn).unwrap().events, vec![edited.clone()]);
        let cleared = update_event(
            &conn,
            original.id,
            &EventInput {
                title: "After".to_owned(),
                ..EventInput::default()
            },
        )
        .unwrap();
        assert_eq!(cleared.event_date, None);
        assert_eq!(cleared.event_sort, None);
        assert!(matches!(
            update_event(
                &conn,
                9999,
                &EventInput {
                    title: "x".into(),
                    ..EventInput::default()
                }
            ),
            Err(AppError::NotFound)
        ));
    }

    #[test]
    fn unicode_survives_a_round_trip() {
        let conn = conn();
        let title = "Événement «ｅｘａｍｐｌｅ» — 事件 🌍";
        let created = event(&conn, title, None);
        assert_eq!(snapshot(&conn).unwrap().events[0].title, created.title);
        assert_eq!(created.title, title);
    }

    // ---- sources and provenance -----------------------------------------------------------

    #[test]
    fn a_source_keeps_four_different_times_apart() {
        let conn = conn();
        let ev = event(&conn, "Event", Some("2020-01-01"));
        let src = create_source(
            &conn,
            &SourceInput {
                title: "Report".to_owned(),
                author: Some("A. Writer".to_owned()),
                url: Some("https://example.org/report".to_owned()),
                published_date: Some("2026-11".to_owned()),
                retrieved_date: Some("2026-11-05".to_owned()),
                note: Some("My own note".to_owned()),
                ..SourceInput::default()
            },
        )
        .unwrap();
        assert_eq!(src.published_date.as_deref(), Some("2026-11"));
        assert_eq!(src.retrieved_date.as_deref(), Some("2026-11-05"));
        assert_eq!(src.url.as_deref(), Some("https://example.org/report"));
        // The event time is untouched by anything about the source.
        assert_eq!(snapshot(&conn).unwrap().events[0].event_date, ev.event_date);
        assert!(src.created_at.ends_with('Z'));
    }

    #[test]
    fn absent_source_dates_are_not_synthesized() {
        let conn = conn();
        let src = source(&conn, "Bare");
        assert_eq!(src.published_date, None);
        assert_eq!(src.retrieved_date, None);
        assert_eq!(src.url, None);
        assert_eq!(src.document_id, None);
    }

    #[test]
    fn a_source_needs_some_way_to_identify_it() {
        let conn = conn();
        let result = create_source(
            &conn,
            &SourceInput {
                title: "Only a title".to_owned(),
                note: Some("n".to_owned()),
                ..SourceInput::default()
            },
        );
        assert!(is_validation(result));
        assert_eq!(count(&conn, "watchtower_sources"), 0);
    }

    #[test]
    fn unsafe_urls_and_dates_are_rejected() {
        let conn = conn();
        for url in [
            "javascript:alert(1)",
            "https://user:secret@example.org/",
            "https://exa mple.org",
            "example.org",
        ] {
            let result = create_source(
                &conn,
                &SourceInput {
                    title: "S".to_owned(),
                    url: Some(url.to_owned()),
                    ..SourceInput::default()
                },
            );
            assert!(is_validation(result), "{url}");
        }
        for (published, retrieved) in [
            (Some("2026-13"), None),
            (None, Some("not a date")),
            (Some("2026-11-05T10:00Z"), None),
        ] {
            let result = create_source(
                &conn,
                &SourceInput {
                    title: "S".to_owned(),
                    publisher: Some("P".to_owned()),
                    published_date: published.map(str::to_owned),
                    retrieved_date: retrieved.map(str::to_owned),
                    ..SourceInput::default()
                },
            );
            assert!(is_validation(result), "{published:?} {retrieved:?}");
        }
        assert_eq!(count(&conn, "watchtower_sources"), 0);
    }

    #[test]
    fn a_source_can_point_at_an_archive_document_but_not_a_missing_one() {
        let conn = conn();
        conn.execute(
            "INSERT INTO documents (title, original_name, format, sha256, byte_length, content)
             VALUES ('Saved page', 'page.txt', 'txt', ?1, 4, 'text')",
            params!["a".repeat(64)],
        )
        .unwrap();
        let doc_id: i64 = conn
            .query_row("SELECT id FROM documents", [], |r| r.get(0))
            .unwrap();
        let linked = create_source(
            &conn,
            &SourceInput {
                title: "Local copy".to_owned(),
                document_id: Some(doc_id),
                ..SourceInput::default()
            },
        )
        .unwrap();
        assert_eq!(linked.document_id, Some(doc_id));
        assert_eq!(linked.url, None, "a document is not a URL");

        let missing = create_source(
            &conn,
            &SourceInput {
                title: "Ghost".to_owned(),
                document_id: Some(doc_id + 100),
                ..SourceInput::default()
            },
        );
        assert!(is_validation(missing));
        assert_eq!(count(&conn, "watchtower_sources"), 1);
    }

    #[test]
    fn editing_a_source_changes_it_in_place() {
        let conn = conn();
        let original = source(&conn, "Before");
        let edited = update_source(
            &conn,
            original.id,
            &SourceInput {
                title: "After".to_owned(),
                author: Some("New Author".to_owned()),
                url: Some("https://example.org/new".to_owned()),
                ..SourceInput::default()
            },
        )
        .unwrap();
        assert_eq!(edited.id, original.id);
        assert_eq!(edited.created_at, original.created_at);
        assert_eq!(edited.title, "After");
        assert_eq!(
            edited.publisher, None,
            "an omitted field is cleared by an edit"
        );
        assert!(matches!(
            update_source(
                &conn,
                999,
                &SourceInput {
                    title: "x".into(),
                    author: Some("a".into()),
                    ..SourceInput::default()
                }
            ),
            Err(AppError::NotFound)
        ));
    }

    // ---- claims: the four epistemic classes -----------------------------------------------

    #[test]
    fn all_four_classes_are_stored_distinctly() {
        let conn = conn();
        let ev = event(&conn, "Event", None);
        for kind in [
            "observation",
            "attributed_claim",
            "interpretation",
            "forecast",
        ] {
            assert_eq!(claim(&conn, ev.id, kind).kind, kind);
        }
        let kinds: Vec<String> = snapshot(&conn)
            .unwrap()
            .claims
            .into_iter()
            .map(|c| c.kind)
            .collect();
        assert_eq!(
            kinds,
            [
                "observation",
                "attributed_claim",
                "interpretation",
                "forecast"
            ]
        );
    }

    #[test]
    fn the_class_is_mandatory_and_never_inferred() {
        let conn = conn();
        let ev = event(&conn, "Event", None);
        for kind in ["", "fact", "verified", "Observation"] {
            let result = create_claim(
                &conn,
                &ClaimInput {
                    event_id: ev.id,
                    kind: kind.to_owned(),
                    text: "t".to_owned(),
                    ..ClaimInput::default()
                },
            );
            assert!(is_validation(result), "{kind:?}");
        }
        assert_eq!(count(&conn, "watchtower_claims"), 0);
    }

    #[test]
    fn an_attributed_claim_must_name_who_made_it() {
        let conn = conn();
        let ev = event(&conn, "Event", None);
        let result = create_claim(
            &conn,
            &ClaimInput {
                event_id: ev.id,
                kind: "attributed_claim".to_owned(),
                text: "Someone said so".to_owned(),
                attribution: Some("   ".to_owned()),
                ..ClaimInput::default()
            },
        );
        assert!(is_validation(result));
        // An observation does not need one.
        let ok = create_claim(
            &conn,
            &ClaimInput {
                event_id: ev.id,
                kind: "observation".to_owned(),
                text: "I saw it".to_owned(),
                ..ClaimInput::default()
            },
        )
        .unwrap();
        assert_eq!(ok.attribution, None);
    }

    #[test]
    fn claims_must_reference_real_records() {
        let conn = conn();
        let ev = event(&conn, "Event", None);
        let missing_event = create_claim(
            &conn,
            &ClaimInput {
                event_id: 999,
                kind: "observation".to_owned(),
                text: "t".to_owned(),
                ..ClaimInput::default()
            },
        );
        assert!(is_validation(missing_event));
        let missing_source = create_claim(
            &conn,
            &ClaimInput {
                event_id: ev.id,
                source_id: Some(999),
                kind: "observation".to_owned(),
                text: "t".to_owned(),
                ..ClaimInput::default()
            },
        );
        assert!(is_validation(missing_source));
        assert_eq!(count(&conn, "watchtower_claims"), 0);
    }

    #[test]
    fn a_claim_can_carry_a_plain_scripture_reference() {
        let conn = conn();
        let ev = event(&conn, "Event", None);
        let ok = create_claim(
            &conn,
            &ClaimInput {
                event_id: ev.id,
                kind: "interpretation".to_owned(),
                text: "My reading".to_owned(),
                scripture_reference: Some(" Revelation 13:18 ".to_owned()),
                ..ClaimInput::default()
            },
        )
        .unwrap();
        assert_eq!(ok.scripture_reference.as_deref(), Some("Revelation 13:18"));
        let bad = create_claim(
            &conn,
            &ClaimInput {
                event_id: ev.id,
                kind: "interpretation".to_owned(),
                text: "x".to_owned(),
                scripture_reference: Some("<b>".to_owned()),
                ..ClaimInput::default()
            },
        );
        assert!(is_validation(bad));
    }

    // ---- hypotheses -----------------------------------------------------------------------

    #[test]
    fn a_new_hypothesis_is_open_and_is_not_a_fact() {
        let conn = conn();
        let h = hypothesis(&conn, "Example hypothesis");
        assert_eq!(h.status, "open");
        assert!(is_validation(create_hypothesis(
            &conn,
            &HypothesisInput {
                title: "t".to_owned(),
                statement: "s".to_owned(),
                status: Some("proven".to_owned()),
                ..HypothesisInput::default()
            }
        )));
    }

    #[test]
    fn only_the_user_changes_a_hypothesis_status() {
        let conn = conn();
        let h = hypothesis(&conn, "H");
        let e = event(&conn, "E", None);
        let c = claim(&conn, e.id, "observation");
        source(&conn, "S");
        link(&conn, h.id, "supports", c.id).unwrap();
        link(&conn, h.id, "contradicts", c.id).unwrap();
        // Evidence in either direction never changes the status by itself.
        assert_eq!(snapshot(&conn).unwrap().hypotheses[0].status, "open");

        let reviewed = update_hypothesis(
            &conn,
            h.id,
            &HypothesisInput {
                title: "H".to_owned(),
                statement: "Revised proposition".to_owned(),
                status: Some("under_review".to_owned()),
                scripture_reference: Some("Psalm 23".to_owned()),
            },
        )
        .unwrap();
        assert_eq!(reviewed.status, "under_review");
        assert_eq!(reviewed.statement, "Revised proposition");
        assert_eq!(reviewed.created_at, h.created_at);
        assert!(matches!(
            update_hypothesis(
                &conn,
                999,
                &HypothesisInput {
                    title: "t".into(),
                    statement: "s".into(),
                    ..HypothesisInput::default()
                }
            ),
            Err(AppError::NotFound)
        ));
    }

    // ---- evidence links -------------------------------------------------------------------

    #[test]
    fn supports_contradicts_and_context_can_coexist_for_the_same_claim() {
        let conn = conn();
        let h = hypothesis(&conn, "H");
        let e = event(&conn, "E", None);
        let c = claim(&conn, e.id, "attributed_claim");
        for relation in ["supports", "contradicts", "context"] {
            assert_eq!(
                link(&conn, h.id, relation, c.id).unwrap().relation,
                relation
            );
        }
        assert_eq!(snapshot(&conn).unwrap().links.len(), 3);
    }

    #[test]
    fn the_same_evidence_cannot_be_linked_twice_with_the_same_relation() {
        let conn = conn();
        let h = hypothesis(&conn, "H");
        let e = event(&conn, "E", None);
        let c = claim(&conn, e.id, "observation");
        link(&conn, h.id, "supports", c.id).unwrap();
        assert!(is_validation(link(&conn, h.id, "supports", c.id)));
        assert_eq!(count(&conn, "watchtower_links"), 1);
    }

    #[test]
    fn a_link_needs_evidence_and_valid_references() {
        let conn = conn();
        let h = hypothesis(&conn, "H");
        let e = event(&conn, "E", None);
        let c = claim(&conn, e.id, "observation");
        let s = source(&conn, "S");
        let base = LinkInput {
            hypothesis_id: h.id,
            relation: "supports".to_owned(),
            claim_id: Some(c.id),
            explanation: "why".to_owned(),
            ..LinkInput::default()
        };
        // No evidence at all.
        assert!(is_validation(create_link(
            &conn,
            &LinkInput {
                claim_id: None,
                ..base.clone()
            }
        )));
        // Unknown records on every reference.
        assert!(is_validation(create_link(
            &conn,
            &LinkInput {
                hypothesis_id: 999,
                ..base.clone()
            }
        )));
        assert!(is_validation(create_link(
            &conn,
            &LinkInput {
                claim_id: Some(999),
                ..base.clone()
            }
        )));
        assert!(is_validation(create_link(
            &conn,
            &LinkInput {
                claim_id: None,
                source_id: Some(999),
                ..base.clone()
            }
        )));
        assert!(is_validation(create_link(
            &conn,
            &LinkInput {
                claim_id: None,
                source_id: Some(s.id),
                event_id: Some(999),
                ..base.clone()
            }
        )));
        // Bad relation / empty or oversized explanation.
        assert!(is_validation(create_link(
            &conn,
            &LinkInput {
                relation: "proves".to_owned(),
                ..base.clone()
            }
        )));
        assert!(is_validation(create_link(
            &conn,
            &LinkInput {
                explanation: "  ".to_owned(),
                ..base.clone()
            }
        )));
        assert!(is_validation(create_link(
            &conn,
            &LinkInput {
                explanation: "x".repeat(2001),
                ..base.clone()
            }
        )));
        // A claim already belongs to one event.
        assert!(is_validation(create_link(
            &conn,
            &LinkInput {
                event_id: Some(e.id),
                ..base.clone()
            }
        )));
        assert_eq!(
            count(&conn, "watchtower_links"),
            0,
            "failed writes leave nothing behind"
        );

        // Source-only evidence for an event is fine.
        let ok = create_link(
            &conn,
            &LinkInput {
                claim_id: None,
                source_id: Some(s.id),
                event_id: Some(e.id),
                ..base
            },
        )
        .unwrap();
        assert_eq!(
            (ok.claim_id, ok.source_id, ok.event_id),
            (None, Some(s.id), Some(e.id))
        );
    }

    // ---- database-level backstops and limits ----------------------------------------------

    #[test]
    fn the_database_itself_refuses_orphans_and_bad_values() {
        let conn = conn();
        let e = event(&conn, "E", None);
        claim(&conn, e.id, "observation");
        let h = hypothesis(&conn, "H");
        // Foreign keys are enforced.
        assert!(conn
            .execute(
                "INSERT INTO watchtower_claims (event_id, kind, text) VALUES (999, 'observation', 't')",
                []
            )
            .is_err());
        // Referenced rows cannot be deleted out from under their children.
        assert!(conn
            .execute("DELETE FROM watchtower_events WHERE id = ?1", params![e.id])
            .is_err());
        // CHECKs backstop the application.
        assert!(conn
            .execute(
                "INSERT INTO watchtower_claims (event_id, kind, text) VALUES (?1, 'rumor', 't')",
                params![e.id]
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO watchtower_links (hypothesis_id, relation, explanation) VALUES (?1, 'supports', 'x')",
                params![h.id]
            )
            .is_err());
        assert_eq!(count(&conn, "watchtower_claims"), 1);
    }

    #[test]
    fn record_limits_are_enforced() {
        let conn = conn();
        event(&conn, "one", None);
        event(&conn, "two", None);
        assert!(is_validation(ensure_room(&conn, Table::Events, 2)));
        assert!(ensure_room(&conn, Table::Events, 3).is_ok());
    }

    #[test]
    fn the_snapshot_is_empty_on_a_fresh_database() {
        let snap = snapshot(&conn()).unwrap();
        assert!(snap.events.is_empty() && snap.sources.is_empty() && snap.claims.is_empty());
        assert!(snap.hypotheses.is_empty() && snap.links.is_empty());
    }

    #[test]
    fn serialized_records_use_camel_case_keys() {
        let conn = conn();
        event(&conn, "E", Some("2026"));
        let json = serde_json::to_value(snapshot(&conn).unwrap()).unwrap();
        let first = &json["events"][0];
        assert!(first.get("eventDate").is_some() && first.get("datePrecision").is_some());
        assert!(first.get("createdAt").is_some());
        assert!(json.get("hypotheses").is_some() && json.get("links").is_some());
    }

    // ---- shared date vectors (also run by the TypeScript parser) --------------------------

    #[test]
    fn date_parsing_matches_the_shared_vectors() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../../../data/watchtower/date-vectors.json"))
                .unwrap();
        type Parser = fn(&str) -> std::result::Result<dates::EventDate, dates::DateError>;
        let parsers: [(&str, Parser); 2] = [
            ("event", dates::parse_event_date),
            ("calendar", dates::parse_calendar_date),
        ];
        for (key, parse) in parsers {
            let cases = vectors[key].as_array().unwrap();
            assert!(cases.len() >= 9, "{key} vectors missing");
            for case in cases {
                let input = case["input"].as_str().unwrap();
                match parse(input) {
                    Ok(date) => {
                        assert_eq!(case["ok"], true, "{key} {input:?} should be rejected");
                        assert_eq!(date.text, case["text"].as_str().unwrap(), "{input:?}");
                        assert_eq!(date.precision.as_str(), case["precision"].as_str().unwrap());
                        assert_eq!(date.sort, case["sort"].as_i64().unwrap(), "{input:?}");
                    }
                    Err(error) => {
                        assert_eq!(case["ok"], false, "{key} {input:?} should be accepted");
                        assert_eq!(error.code(), case["code"].as_str().unwrap(), "{input:?}");
                    }
                }
            }
        }
    }
}
