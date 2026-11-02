//! SQLite connection setup. All schema changes go through [`migrations`].

pub mod migrations;

use std::path::Path;

use rusqlite::Connection;

use crate::error::Result;

/// File name of the database inside the application data directory. A fixed constant:
/// no user-supplied text is ever used to build the database path.
pub const DB_FILE_NAME: &str = "beacon.db";

fn configure(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
    // WAL gives crash-safe, non-blocking writes. The pragma reports the resulting mode as a row
    // ("wal" on disk, "memory" for in-memory databases); either is acceptable.
    let _mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
    Ok(())
}

/// Open (creating if necessary) the database at `path` and apply pending migrations.
pub fn open_and_migrate(path: &Path) -> Result<Connection> {
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    migrations::migrate(&mut conn)?;
    Ok(conn)
}

/// A fully migrated in-memory database, for tests.
pub fn open_in_memory_migrated() -> Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrations::migrate(&mut conn)?;
    Ok(conn)
}
