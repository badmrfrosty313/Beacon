//! Sprint 001 demo record: plain-text local notes.
//!
//! Notes exist to prove the vertical slice (UI -> Tauri command -> SQLite -> restart).
//! They are not the Archive `Document` model from ARCHITECTURE.md; that arrives in Sprint 002.

mod validation;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::error::{AppError, Result};

pub use validation::{validate_note, ValidNote, ValidationError, MAX_BODY_BYTES, MAX_TITLE_CHARS};

/// Upper bound on notes returned by [`list`]. Prevents unbounded IPC payloads.
pub const LIST_LIMIT: i64 = 1000;

/// A full note, including its body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub body: String,
    pub created_at: String,
}

/// A note without its body. Listing returns summaries so a list of large notes stays small.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: i64,
    pub title: String,
    pub created_at: String,
}

fn note_from_row(row: &Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        created_at: row.get(3)?,
    })
}

fn summary_from_row(row: &Row<'_>) -> rusqlite::Result<NoteSummary> {
    Ok(NoteSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
    })
}

/// Validate and store a note. All SQL uses bound parameters.
pub fn create(conn: &Connection, title: &str, body: &str) -> Result<Note> {
    let valid = validate_note(title, body)?;
    let note = conn.query_row(
        "INSERT INTO notes (title, body) VALUES (?1, ?2)
         RETURNING id, title, body, created_at",
        params![valid.title, valid.body],
        note_from_row,
    )?;
    Ok(note)
}

/// List note summaries, newest first, up to [`LIST_LIMIT`].
pub fn list(conn: &Connection) -> Result<Vec<NoteSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, title, created_at FROM notes
         ORDER BY created_at DESC, id DESC
         LIMIT ?1",
    )?;
    let summaries = statement
        .query_map(params![LIST_LIMIT], summary_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(summaries)
}

/// Fetch one full note by id.
pub fn get(conn: &Connection, id: i64) -> Result<Note> {
    conn.query_row(
        "SELECT id, title, body, created_at FROM notes WHERE id = ?1",
        params![id],
        note_from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn conn() -> Connection {
        db::open_in_memory_migrated().expect("in-memory database should migrate")
    }

    #[test]
    fn create_then_get_round_trips_exactly() {
        let conn = conn();
        let created = create(&conn, "  Radio schedule  ", "net at 0900\n\tchannel 3").unwrap();
        assert_eq!(created.title, "Radio schedule");
        assert_eq!(created.body, "net at 0900\n\tchannel 3");
        assert!(created.id > 0);
        assert!(
            created.created_at.ends_with('Z') && created.created_at.contains('T'),
            "created_at should be ISO-8601 UTC, got {}",
            created.created_at
        );
        assert_eq!(get(&conn, created.id).unwrap(), created);
    }

    #[test]
    fn list_returns_summaries_newest_first() {
        let conn = conn();
        let first = create(&conn, "first", "a").unwrap();
        let second = create(&conn, "second", "b").unwrap();
        let third = create(&conn, "third", "c").unwrap();
        let ids: Vec<i64> = list(&conn).unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(ids, vec![third.id, second.id, first.id]);
    }

    #[test]
    fn list_is_empty_for_a_fresh_database() {
        assert!(list(&conn()).unwrap().is_empty());
    }

    #[test]
    fn list_is_capped() {
        let conn = conn();
        let tx = conn.unchecked_transaction().unwrap();
        for i in 0..(LIST_LIMIT + 5) {
            tx.execute(
                "INSERT INTO notes (title) VALUES (?1)",
                params![format!("n{i}")],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        assert_eq!(list(&conn).unwrap().len() as i64, LIST_LIMIT);
    }

    #[test]
    fn get_missing_note_is_not_found() {
        assert!(matches!(get(&conn(), 424242), Err(AppError::NotFound)));
    }

    #[test]
    fn invalid_input_is_rejected_and_nothing_is_stored() {
        let conn = conn();
        assert!(matches!(
            create(&conn, "   ", "body"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            create(&conn, "ok", "bad\0body"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            create(&conn, &"x".repeat(MAX_TITLE_CHARS + 1), ""),
            Err(AppError::Validation(_))
        ));
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn sql_metacharacters_are_stored_literally() {
        let conn = conn();
        let nasty = "Robert'); DROP TABLE notes;--";
        let created = create(&conn, nasty, nasty).unwrap();
        assert_eq!(get(&conn, created.id).unwrap().title, nasty);
        assert_eq!(
            list(&conn).unwrap().len(),
            1,
            "notes table must still exist"
        );
    }

    #[test]
    fn unicode_survives_storage() {
        let conn = conn();
        let created = create(&conn, "Señal 🔦 灯塔", "ملاحظة").unwrap();
        let fetched = get(&conn, created.id).unwrap();
        assert_eq!(fetched.title, "Señal 🔦 灯塔");
        assert_eq!(fetched.body, "ملاحظة");
    }

    #[test]
    fn schema_constraints_back_up_the_validator() {
        // Bypass the validator to prove the database itself refuses out-of-range data.
        let conn = conn();
        let too_long_title = "t".repeat(MAX_TITLE_CHARS + 1);
        assert!(conn
            .execute(
                "INSERT INTO notes (title) VALUES (?1)",
                params![too_long_title]
            )
            .is_err());
        assert!(conn
            .execute("INSERT INTO notes (title) VALUES ('')", [])
            .is_err());
        let too_long_body = "b".repeat(MAX_BODY_BYTES + 1);
        assert!(conn
            .execute(
                "INSERT INTO notes (title, body) VALUES ('t', ?1)",
                params![too_long_body]
            )
            .is_err());
    }

    #[test]
    fn serializes_with_camel_case_keys() {
        let conn = conn();
        let note = create(&conn, "t", "b").unwrap();
        let json = serde_json::to_value(&note).unwrap();
        assert!(json.get("createdAt").is_some());
        assert!(json.get("created_at").is_none());
        let summary = serde_json::to_value(&list(&conn).unwrap()[0]).unwrap();
        assert!(summary.get("createdAt").is_some());
        assert!(
            summary.get("body").is_none(),
            "summaries must not carry bodies"
        );
    }
}
