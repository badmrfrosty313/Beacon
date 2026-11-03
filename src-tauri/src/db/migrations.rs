//! Versioned, forward-only schema migrations.
//!
//! Each migration is a plain `.sql` file under `src-tauri/migrations/`, embedded at compile
//! time. Applied versions are recorded in the `schema_migrations` table. Every migration runs
//! in its own transaction together with its bookkeeping row, so a failure leaves the database
//! exactly as it was before that migration started.
//!
//! A database whose recorded version is *newer* than this build knows about is refused rather
//! than opened, so an older BEACON can never silently corrupt data written by a newer one.

use rusqlite::{params, Connection};

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

/// All known migrations, in order. Versions must start at 1 and increase by exactly 1.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "create_notes",
        sql: include_str!("../../migrations/0001_create_notes.sql"),
    },
    Migration {
        version: 2,
        name: "create_documents_fts",
        sql: include_str!("../../migrations/0002_create_documents.sql"),
    },
];

/// The schema version this build of BEACON expects.
pub fn latest_version() -> i64 {
    MIGRATIONS.last().map_or(0, |m| m.version)
}

/// Apply every pending migration. Returns the resulting schema version.
pub fn migrate(conn: &mut Connection) -> Result<i64> {
    apply(conn, MIGRATIONS)
}

/// The highest applied migration version (0 if none). Requires [`migrate`] to have run.
pub fn current_version(conn: &Connection) -> Result<i64> {
    let version = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    Ok(version)
}

fn validate_sequence(migrations: &[Migration]) -> Result<()> {
    for (index, migration) in migrations.iter().enumerate() {
        let expected = index as i64 + 1;
        if migration.version != expected {
            return Err(AppError::Migration(format!(
                "migration list is malformed: expected version {expected}, found {}",
                migration.version
            )));
        }
    }
    Ok(())
}

pub(crate) fn apply(conn: &mut Connection, migrations: &[Migration]) -> Result<i64> {
    validate_sequence(migrations)?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
             version    INTEGER PRIMARY KEY,
             name       TEXT NOT NULL,
             applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         )",
    )?;

    let current = current_version(conn)?;
    let latest = migrations.last().map_or(0, |m| m.version);
    if current > latest {
        return Err(AppError::Migration(format!(
            "database schema version {current} is newer than this version of BEACON supports \
             ({latest}); please update BEACON"
        )));
    }

    for migration in migrations.iter().filter(|m| m.version > current) {
        let fail = |e: rusqlite::Error| {
            AppError::Migration(format!(
                "migration {} ({}) failed: {e}",
                migration.version, migration.name
            ))
        };
        // Dropping `tx` without committing (any early return below) rolls everything back.
        let tx = conn.transaction().map_err(fail)?;
        tx.execute_batch(migration.sql).map_err(fail)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
            params![migration.version, migration.name],
        )
        .map_err(fail)?;
        tx.commit().map_err(fail)?;
    }

    current_version(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    #[test]
    fn shipped_migrations_are_well_formed() {
        validate_sequence(MIGRATIONS).unwrap();
        assert_eq!(latest_version(), MIGRATIONS.len() as i64);
        for migration in MIGRATIONS {
            // Comment lines legitimately mention BEGIN/COMMIT (the migration header explains
            // the rule), so only inspect statements.
            let sql = migration
                .sql
                .lines()
                .filter(|line| !line.trim_start().starts_with("--"))
                .collect::<Vec<_>>()
                .join("\n")
                .to_uppercase();
            assert!(
                !sql.contains("BEGIN") && !sql.contains("COMMIT"),
                "migration {} must not manage its own transaction",
                migration.version
            );
        }
    }

    #[test]
    fn fresh_database_is_migrated_to_latest() {
        let mut conn = memory();
        let version = migrate(&mut conn).unwrap();
        assert_eq!(version, latest_version());
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        assert!(table_exists(&conn, "notes"));
        assert!(table_exists(&conn, "schema_migrations"));
        let name: String = conn
            .query_row(
                "SELECT name FROM schema_migrations WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "create_notes");
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let mut conn = memory();
        migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO notes (title) VALUES ('keep me')", [])
            .unwrap();
        migrate(&mut conn).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, MIGRATIONS.len() as i64);
        let notes: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(notes, 1, "re-running migrations must not touch data");
    }

    #[test]
    fn refuses_a_database_from_a_newer_version() {
        let mut conn = memory();
        migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?1, 'from_the_future')",
            params![latest_version() + 1],
        )
        .unwrap();
        match migrate(&mut conn) {
            Err(AppError::Migration(message)) => assert!(message.contains("newer")),
            other => panic!("expected a Migration error, got {other:?}"),
        }
    }

    #[test]
    fn a_failing_migration_rolls_back_completely() {
        let mut conn = memory();
        let migrations = [
            Migration {
                version: 1,
                name: "good",
                sql: "CREATE TABLE good (id INTEGER PRIMARY KEY);",
            },
            Migration {
                version: 2,
                name: "half_bad",
                sql: "CREATE TABLE half_applied (id INTEGER PRIMARY KEY);
                      THIS IS NOT VALID SQL;",
            },
        ];
        let result = apply(&mut conn, &migrations);
        assert!(matches!(result, Err(AppError::Migration(_))));
        assert!(table_exists(&conn, "good"), "migration 1 was committed");
        assert!(
            !table_exists(&conn, "half_applied"),
            "partial effects of the failed migration must be rolled back"
        );
        assert_eq!(current_version(&conn).unwrap(), 1);
    }

    #[test]
    fn upgrades_incrementally_from_an_older_database() {
        let mut conn = memory();
        let v1 = [Migration {
            version: 1,
            name: "one",
            sql: "CREATE TABLE one (id INTEGER PRIMARY KEY); INSERT INTO one VALUES (7);",
        }];
        assert_eq!(apply(&mut conn, &v1).unwrap(), 1);
        let v2 = [
            v1[0],
            Migration {
                version: 2,
                name: "two",
                sql: "CREATE TABLE two (id INTEGER PRIMARY KEY);",
            },
        ];
        assert_eq!(apply(&mut conn, &v2).unwrap(), 2);
        assert!(table_exists(&conn, "two"));
        let preserved: i64 = conn
            .query_row("SELECT id FROM one", [], |r| r.get(0))
            .unwrap();
        assert_eq!(preserved, 7, "existing data survives an upgrade");
    }

    #[test]
    fn rejects_a_malformed_migration_list() {
        let mut conn = memory();
        let gap = [Migration {
            version: 2,
            name: "skips_one",
            sql: "SELECT 1;",
        }];
        assert!(matches!(
            apply(&mut conn, &gap),
            Err(AppError::Migration(_))
        ));
    }
}
