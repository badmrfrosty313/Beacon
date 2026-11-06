//! Private research import (B-014/B-015): restart persistence, upgrades from every earlier schema
//! version, crash leftovers and the mapping rules, through the same entry points the app uses.

use std::fs;
use std::path::Path;

use beacon_lib::db::{self, migrations};
use beacon_lib::error::AppError;
use beacon_lib::notes;
use beacon_lib::research::{self, CollectionInput, ImportInput};
use beacon_lib::state::AppState;
use beacon_lib::watchtower::{self, ClaimInput, EventInput, SourceInput};
use rusqlite::Connection;

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode(bytes: &[u8]) -> String {
    let mut out = String::new();
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

fn text_import(name: &str, body: &str, collection_id: i64) -> ImportInput {
    ImportInput {
        name: name.into(),
        data: encode(body.as_bytes()),
        collection_id,
        ..Default::default()
    }
}

/// A real database at schema version `version`, built from the shipped migrations.
fn database_at(path: &Path, version: i64) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(
        "CREATE TABLE schema_migrations (
             version INTEGER PRIMARY KEY,
             name TEXT NOT NULL,
             applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         );",
    )
    .unwrap();
    for migration in migrations::MIGRATIONS
        .iter()
        .filter(|m| m.version <= version)
    {
        conn.execute_batch(migration.sql).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
            rusqlite::params![migration.version, migration.name],
        )
        .unwrap();
    }
}

#[test]
fn research_survives_an_application_restart() {
    let dir = tempfile::tempdir().unwrap();
    let body = "Invented research text about a synthetic comet.";
    let (collection, id) = {
        let state = AppState::initialize(dir.path().to_path_buf());
        let collection = state
            .with_db(|conn| {
                research::create_collection(
                    conn,
                    &CollectionInput {
                        name: "Test research".into(),
                        description: None,
                    },
                )
            })
            .unwrap();
        let doc = state
            .with_db(|conn| {
                research::import(
                    conn,
                    state.data_dir(),
                    &text_import("comet.md", body, collection.id),
                )
            })
            .unwrap();
        (collection.id, doc.summary.id)
    };

    let state = AppState::initialize(dir.path().to_path_buf());
    let doc = state
        .with_db(|conn| research::get(conn, state.data_dir(), id))
        .unwrap();
    assert_eq!(doc.body, body);
    assert_eq!(
        state
            .with_db(|conn| research::search(conn, "comet", Some(collection)))
            .unwrap()
            .len(),
        1
    );
    let again = state.with_db(|conn| {
        research::import(
            conn,
            state.data_dir(),
            &text_import("copy.md", body, collection),
        )
    });
    assert!(matches!(again, Err(AppError::Duplicate { .. })));
    assert_eq!(
        state
            .with_db(|conn| research::list(conn, None))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn every_earlier_schema_version_upgrades_and_keeps_its_data() {
    for from in 1..migrations::latest_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(db::DB_FILE_NAME);
        database_at(&path, from);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute(
                "INSERT INTO notes (title, body) VALUES ('Old note', 'kept')",
                [],
            )
            .unwrap();
            if from >= 4 {
                conn.execute(
                    "INSERT INTO watchtower_sources (title, author) VALUES ('Old source', 'A. Author')",
                    [],
                )
                .unwrap();
            }
        }

        let conn = db::open_and_migrate(&path).unwrap();
        assert_eq!(
            migrations::current_version(&conn).unwrap(),
            migrations::latest_version(),
            "upgrading from v{from}"
        );
        let listed = notes::list(&conn).unwrap();
        assert_eq!(listed.len(), 1, "upgrading from v{from}");
        assert_eq!(notes::get(&conn, listed[0].id).unwrap().body, "kept");

        // The new tables work on the upgraded database.
        let collection = research::create_collection(
            &conn,
            &CollectionInput {
                name: "After upgrade".into(),
                description: None,
            },
        )
        .unwrap();
        let doc = research::import(
            &conn,
            dir.path(),
            &text_import("new.md", "imported after the upgrade", collection.id),
        )
        .unwrap();
        assert_eq!(
            research::search(&conn, "upgrade", None).unwrap()[0].id,
            doc.summary.id
        );
        if from >= 4 {
            let snapshot = watchtower::snapshot(&conn).unwrap();
            assert_eq!(snapshot.sources.len(), 1);
            research::link_source(&conn, doc.summary.id, snapshot.sources[0].id).unwrap();
        }
    }
}

#[test]
fn startup_removes_stale_research_temp_files_but_keeps_originals() {
    let dir = tempfile::tempdir().unwrap();
    let kept = {
        let state = AppState::initialize(dir.path().to_path_buf());
        let collection = state
            .with_db(|conn| {
                research::create_collection(
                    conn,
                    &CollectionInput {
                        name: "C".into(),
                        description: None,
                    },
                )
            })
            .unwrap();
        state
            .with_db(|conn| {
                research::import(
                    conn,
                    state.data_dir(),
                    &text_import("keep.txt", "keep me", collection.id),
                )
            })
            .unwrap()
            .summary
            .id
    };
    let stale = dir.path().join("research_originals").join("0000.1.1.tmp");
    fs::write(&stale, b"half written").unwrap();
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
        .with_db(|conn| research::get(conn, state.data_dir(), kept))
        .is_ok());
}

#[test]
fn an_original_lost_after_restart_is_reported_and_restored_by_reimport() {
    let dir = tempfile::tempdir().unwrap();
    let body = "Trustworthy original text";
    let (collection, id, sha) = {
        let state = AppState::initialize(dir.path().to_path_buf());
        let collection = state
            .with_db(|conn| {
                research::create_collection(
                    conn,
                    &CollectionInput {
                        name: "C".into(),
                        description: None,
                    },
                )
            })
            .unwrap();
        let doc = state
            .with_db(|conn| {
                research::import(
                    conn,
                    state.data_dir(),
                    &text_import("t.txt", body, collection.id),
                )
            })
            .unwrap();
        (collection.id, doc.summary.id, doc.summary.sha256)
    };
    let original = dir
        .path()
        .join("research_originals")
        .join(format!("{sha}.txt"));
    fs::write(&original, b"Tampered text").unwrap();

    let state = AppState::initialize(dir.path().to_path_buf());
    assert!(matches!(
        state.with_db(|conn| research::get(conn, state.data_dir(), id)),
        Err(AppError::Integrity)
    ));
    let reimport = state.with_db(|conn| {
        research::import(
            conn,
            state.data_dir(),
            &text_import("t.txt", body, collection),
        )
    });
    assert!(matches!(
        reimport,
        Err(AppError::Duplicate { restored: true, .. })
    ));
    assert_eq!(
        state
            .with_db(|conn| research::get(conn, state.data_dir(), id))
            .unwrap()
            .body,
        body
    );
}

#[test]
fn excerpt_mapping_requires_a_source_from_the_same_document() {
    let conn = db::open_in_memory_migrated().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let collection = research::create_collection(
        &conn,
        &CollectionInput {
            name: "C".into(),
            description: None,
        },
    )
    .unwrap();
    let doc =
        research::import(&conn, dir.path(), &text_import("a.md", "x", collection.id)).unwrap();
    let event = watchtower::create_event(
        &conn,
        &EventInput {
            title: "Synthetic event".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let source = watchtower::create_source(
        &conn,
        &SourceInput {
            title: "Synthetic source".into(),
            author: Some("A. Author".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let claim = watchtower::create_claim(
        &conn,
        &ClaimInput {
            event_id: event.id,
            source_id: Some(source.id),
            kind: "interpretation".into(),
            text: "Invented excerpt".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(research::link_excerpt(&conn, doc.summary.id, claim.id, None).is_err());
    research::link_source(&conn, doc.summary.id, source.id).unwrap();
    assert!(research::link_excerpt(&conn, doc.summary.id, claim.id, Some("p. 2")).is_ok());
}
