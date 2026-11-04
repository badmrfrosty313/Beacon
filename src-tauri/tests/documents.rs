//! Document-library integration tests (B-006 to B-008): a real database file and a real
//! originals folder in a temporary application-data directory, closed and reopened between
//! "sessions" exactly as the desktop app is.

use std::fs;

use beacon_lib::db::{self, migrations};
use beacon_lib::documents;
use beacon_lib::error::AppError;
use beacon_lib::notes;
use beacon_lib::state::AppState;
use rusqlite::Connection;

const V1_SQL: &str = include_str!("../migrations/0001_create_notes.sql");

#[test]
fn imported_documents_search_and_originals_survive_an_application_restart() {
    let dir = tempfile::tempdir().unwrap();
    let raw =
        b"# Water plan\r\nStore two litres per person per day.\r\nSee the north bridge map.\r\n";

    // Session 1: import through the same AppState the Tauri commands use.
    let id = {
        let state = AppState::initialize(dir.path().to_path_buf());
        let doc = state
            .with_db(|conn| documents::import(conn, state.data_dir(), "Water plan.md", raw))
            .unwrap();
        doc.metadata.id
    };

    // Session 2: a brand-new AppState over the same folder.
    let state = AppState::initialize(dir.path().to_path_buf());
    let listed = state.with_db(documents::list).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].title, "Water plan");

    let hits = state
        .with_db(|conn| documents::search(conn, "\"north bridge\""))
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, id);
    assert!(hits[0].snippet.contains('\u{1}'));

    let doc = state
        .with_db(|conn| documents::get(conn, state.data_dir(), id))
        .unwrap();
    assert_eq!(doc.body.as_bytes(), raw);
    assert_eq!(doc.metadata.byte_length, raw.len() as i64);

    // Importing the same bytes again after a restart is a reported duplicate, not a second row.
    let again = state.with_db(|conn| documents::import(conn, state.data_dir(), "again.md", raw));
    assert!(matches!(again, Err(AppError::Duplicate { .. })));
    assert_eq!(state.with_db(documents::list).unwrap().len(), 1);
}

#[test]
fn existing_notes_survive_the_migration_that_adds_documents() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db::DB_FILE_NAME);

    // Build a genuine schema-version-1 database, as Sprint 001 builds shipped.
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(V1_SQL).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
                 version INTEGER PRIMARY KEY,
                 name TEXT NOT NULL,
                 applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             );
             INSERT INTO schema_migrations (version, name) VALUES (1, 'create_notes');
             INSERT INTO notes (title, body) VALUES ('Sprint 001 note', 'written before the upgrade');",
        )
        .unwrap();
    }

    // Opening with the current build upgrades it in place.
    let conn = db::open_and_migrate(&path).unwrap();
    // v2 added documents, v3 adds the read-only Scripture tables; notes must survive both.
    assert_eq!(migrations::current_version(&conn).unwrap(), 3);
    let listed = notes::list(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    let note = notes::get(&conn, listed[0].id).unwrap();
    assert_eq!(note.title, "Sprint 001 note");
    assert_eq!(note.body, "written before the upgrade");

    // And the new tables work on the upgraded database.
    let doc = documents::import(
        &conn,
        dir.path(),
        "after.txt",
        b"imported after the upgrade",
    )
    .unwrap();
    assert_eq!(
        documents::search(&conn, "upgrade").unwrap()[0].id,
        doc.metadata.id
    );
    assert_eq!(notes::list(&conn).unwrap().len(), 1);
}

#[test]
fn startup_removes_stale_temp_files_but_keeps_originals() {
    let dir = tempfile::tempdir().unwrap();
    let kept_id = {
        let state = AppState::initialize(dir.path().to_path_buf());
        state
            .with_db(|conn| documents::import(conn, state.data_dir(), "keep.txt", b"keep me"))
            .unwrap()
            .metadata
            .id
    };
    let originals = dir.path().join("originals");
    let stale = originals.join("0000.1.1.tmp");
    fs::write(&stale, b"half written").unwrap();
    // Age the file past the startup threshold.
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    fs::OpenOptions::new()
        .write(true)
        .open(&stale)
        .unwrap()
        .set_modified(old)
        .unwrap();

    let state = AppState::initialize(dir.path().to_path_buf());
    assert!(!stale.exists());
    assert!(state
        .with_db(|conn| documents::get(conn, state.data_dir(), kept_id))
        .is_ok());
}

#[test]
fn a_tampered_original_is_reported_after_restart_and_repaired_by_reimport() {
    let dir = tempfile::tempdir().unwrap();
    let raw = b"Trustworthy original text";
    let (id, sha) = {
        let state = AppState::initialize(dir.path().to_path_buf());
        let doc = state
            .with_db(|conn| documents::import(conn, state.data_dir(), "t.txt", raw))
            .unwrap();
        (doc.metadata.id, doc.metadata.sha256)
    };
    let original = dir.path().join("originals").join(format!("{sha}.txt"));
    fs::write(&original, b"Tampered text").unwrap();

    let state = AppState::initialize(dir.path().to_path_buf());
    let read = state.with_db(|conn| documents::get(conn, state.data_dir(), id));
    assert!(matches!(read, Err(AppError::Integrity)));

    let repaired = state.with_db(|conn| documents::import(conn, state.data_dir(), "t.txt", raw));
    assert!(matches!(
        repaired,
        Err(AppError::Duplicate { restored: true, .. })
    ));
    assert_eq!(fs::read(&original).unwrap(), raw);
    assert!(state
        .with_db(|conn| documents::get(conn, state.data_dir(), id))
        .is_ok());
}
