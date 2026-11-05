//! Watchtower integration tests (B-011 to B-013): a real database file in a temporary
//! application-data directory, closed and reopened between "sessions" exactly as the desktop
//! app is, plus an upgrade from a genuine schema-version-3 database.

use beacon_lib::db::{self, migrations};
use beacon_lib::notes;
use beacon_lib::scripture;
use beacon_lib::state::AppState;
use beacon_lib::watchtower::{
    self, ClaimInput, EventInput, HypothesisInput, LinkInput, SourceInput,
};
use rusqlite::{params, Connection};

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn a_version_3_database_upgrades_keeping_notes_documents_and_scripture() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db::DB_FILE_NAME);

    // Build a genuine schema-version-3 database, as Sprint 003 builds shipped.
    {
        let mut conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
                 version INTEGER PRIMARY KEY,
                 name TEXT NOT NULL,
                 applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             );",
        )
        .unwrap();
        for migration in &migrations::MIGRATIONS[..3] {
            conn.execute_batch(migration.sql).unwrap();
            conn.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![migration.version, migration.name],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO notes (title, body) VALUES ('Sprint 001 note', 'written before the upgrade')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO documents (title, original_name, format, sha256, byte_length, content)
             VALUES ('Old document', 'old.txt', 'txt', ?1, 3, 'abc')",
            params!["b".repeat(64)],
        )
        .unwrap();
        scripture::install(&mut conn).unwrap();
        assert_eq!(migrations::current_version(&conn).unwrap(), 3);
    }

    // Opening with the current build upgrades it in place.
    let conn = db::open_and_migrate(&path).unwrap();
    assert_eq!(
        migrations::current_version(&conn).unwrap(),
        migrations::latest_version()
    );

    // Everything that existed is still there.
    let listed = notes::list(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        notes::get(&conn, listed[0].id).unwrap().body,
        "written before the upgrade"
    );
    assert_eq!(count(&conn, "documents"), 1);
    assert_eq!(count(&conn, "scripture_verses"), 31_103);
    assert_eq!(count(&conn, "scripture_translations"), 1);

    // The new tables exist, start empty, and work, including a link to the pre-existing document.
    assert!(watchtower::snapshot(&conn).unwrap().events.is_empty());
    let doc_id: i64 = conn
        .query_row("SELECT id FROM documents", [], |r| r.get(0))
        .unwrap();
    let source = watchtower::create_source(
        &conn,
        &SourceInput {
            title: "Preserved copy".to_owned(),
            document_id: Some(doc_id),
            ..SourceInput::default()
        },
    )
    .unwrap();
    assert_eq!(source.document_id, Some(doc_id));

    // Re-opening an already-upgraded database changes nothing.
    drop(conn);
    let conn = db::open_and_migrate(&path).unwrap();
    assert_eq!(migrations::current_version(&conn).unwrap(), 4);
    assert_eq!(watchtower::snapshot(&conn).unwrap().sources.len(), 1);
}

#[test]
fn research_records_and_links_survive_an_application_restart() {
    let dir = tempfile::tempdir().unwrap();

    // Session 1: the acceptance scenario, using only artificial example data.
    let before = {
        let state = AppState::initialize(dir.path().to_path_buf());
        state
            .with_db(|conn| {
                let event = watchtower::create_event(
                    conn,
                    &EventInput {
                        title: "Example event".to_owned(),
                        description: Some("An artificial example.".to_owned()),
                        event_date: Some("2026-11-05T09:30-05:00".to_owned()),
                    },
                )?;
                let undated = watchtower::create_event(
                    conn,
                    &EventInput {
                        title: "Undated example".to_owned(),
                        ..EventInput::default()
                    },
                )?;
                let source = watchtower::create_source(
                    conn,
                    &SourceInput {
                        title: "Example report".to_owned(),
                        publisher: Some("Example Press".to_owned()),
                        url: Some("https://example.org/report".to_owned()),
                        published_date: Some("2026-11-06".to_owned()),
                        retrieved_date: Some("2026-11-07".to_owned()),
                        note: Some("Metadata only; not an offline copy.".to_owned()),
                        ..SourceInput::default()
                    },
                )?;
                let attributed = watchtower::create_claim(
                    conn,
                    &ClaimInput {
                        event_id: event.id,
                        source_id: Some(source.id),
                        kind: "attributed_claim".to_owned(),
                        text: "The report says it happened.".to_owned(),
                        attribution: Some("Example Reporter".to_owned()),
                        ..ClaimInput::default()
                    },
                )?;
                let interpretation = watchtower::create_claim(
                    conn,
                    &ClaimInput {
                        event_id: event.id,
                        kind: "interpretation".to_owned(),
                        text: "My own reading.".to_owned(),
                        scripture_reference: Some("Revelation 13:18".to_owned()),
                        ..ClaimInput::default()
                    },
                )?;
                let hypothesis = watchtower::create_hypothesis(
                    conn,
                    &HypothesisInput {
                        title: "Example hypothesis".to_owned(),
                        statement: "A proposition under evaluation.".to_owned(),
                        ..HypothesisInput::default()
                    },
                )?;
                for (relation, claim_id) in [
                    ("supports", attributed.id),
                    ("contradicts", interpretation.id),
                ] {
                    watchtower::create_link(
                        conn,
                        &LinkInput {
                            hypothesis_id: hypothesis.id,
                            relation: relation.to_owned(),
                            claim_id: Some(claim_id),
                            explanation: format!("Example reason ({relation})"),
                            ..LinkInput::default()
                        },
                    )?;
                }
                watchtower::create_link(
                    conn,
                    &LinkInput {
                        hypothesis_id: hypothesis.id,
                        relation: "context".to_owned(),
                        source_id: Some(source.id),
                        event_id: Some(undated.id),
                        explanation: "Background only.".to_owned(),
                        ..LinkInput::default()
                    },
                )?;
                watchtower::snapshot(conn)
            })
            .unwrap()
    };
    assert_eq!(before.events.len(), 2);
    assert_eq!(before.claims.len(), 2);
    assert_eq!(before.links.len(), 3);

    // Session 2: a brand-new AppState over the same folder sees exactly the same records.
    let state = AppState::initialize(dir.path().to_path_buf());
    let after = state.with_db(watchtower::snapshot).unwrap();
    assert_eq!(after, before);
    assert_eq!(
        after.events[0].title, "Example event",
        "dated events come first"
    );
    assert_eq!(
        after.events[1].event_date, None,
        "undated events stay undated"
    );
    let relations: Vec<&str> = after.links.iter().map(|l| l.relation.as_str()).collect();
    assert_eq!(relations, ["supports", "contradicts", "context"]);
}
