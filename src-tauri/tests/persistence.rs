//! Restart-persistence tests (B-002 / B-004 acceptance): data written by one "session" must be
//! readable by the next, using a real database file in a temporary application-data directory.

use beacon_lib::db::{self, migrations};
use beacon_lib::notes;
use beacon_lib::state::AppState;

#[test]
fn notes_persist_across_closing_and_reopening_the_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db::DB_FILE_NAME);

    // Session 1: first launch creates the database and stores two notes.
    let (first_id, second_id) = {
        let conn = db::open_and_migrate(&path).unwrap();
        let first =
            notes::create(&conn, "Evacuation routes", "Primary: north.\nAlt: east.").unwrap();
        let second = notes::create(&conn, "Contacts", "").unwrap();
        (first.id, second.id)
        // `conn` is dropped here: the "application closes".
    };

    // Session 2: relaunch re-runs migrations (a no-op) and must see exactly the same data.
    let conn = db::open_and_migrate(&path).unwrap();
    assert_eq!(
        migrations::current_version(&conn).unwrap(),
        migrations::latest_version()
    );
    let listed = notes::list(&conn).unwrap();
    assert_eq!(
        listed.iter().map(|n| n.id).collect::<Vec<_>>(),
        vec![second_id, first_id]
    );
    let first = notes::get(&conn, first_id).unwrap();
    assert_eq!(first.title, "Evacuation routes");
    assert_eq!(first.body, "Primary: north.\nAlt: east.");
}

#[test]
fn migrations_do_not_disturb_existing_data_on_relaunch() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db::DB_FILE_NAME);
    let id = {
        let conn = db::open_and_migrate(&path).unwrap();
        notes::create(&conn, "kept", "body").unwrap().id
    };
    for _ in 0..3 {
        let conn = db::open_and_migrate(&path).unwrap();
        assert_eq!(notes::get(&conn, id).unwrap().title, "kept");
        let applied: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(applied, migrations::MIGRATIONS.len() as i64);
    }
}

#[test]
fn app_state_survives_a_simulated_restart() {
    let dir = tempfile::tempdir().unwrap();

    let id = {
        let state = AppState::initialize(dir.path().to_path_buf());
        state
            .with_db(|conn| notes::create(conn, "Radio net", "0900 daily"))
            .unwrap()
            .id
    };

    let state = AppState::initialize(dir.path().to_path_buf());
    let note = state.with_db(|conn| notes::get(conn, id)).unwrap();
    assert_eq!(note.title, "Radio net");
    assert_eq!(state.info().database_error, None);
}

#[test]
fn a_database_from_a_newer_beacon_is_refused_and_left_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db::DB_FILE_NAME);
    {
        let conn = db::open_and_migrate(&path).unwrap();
        notes::create(&conn, "precious", "data").unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?1, 'future')",
            [migrations::latest_version() + 1],
        )
        .unwrap();
    }

    assert!(db::open_and_migrate(&path).is_err());

    // The refusal must not have modified the file: reading it directly still works.
    let raw = rusqlite_open_raw(&path);
    let titles: Vec<String> = raw
        .prepare("SELECT title FROM notes")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(titles, vec!["precious".to_owned()]);
}

fn rusqlite_open_raw(path: &std::path::Path) -> rusqlite::Connection {
    rusqlite::Connection::open(path).unwrap()
}
