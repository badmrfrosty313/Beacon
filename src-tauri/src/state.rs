//! Process-wide application state: the data directory and the single SQLite connection.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;

use crate::db::{self, migrations};
use crate::documents;
use crate::error::{AppError, Result};
use crate::scripture;

/// Temporary files younger than this may belong to a write still in progress.
const STALE_TEMP_FILE_AGE: Duration = Duration::from_secs(300);

pub struct AppState {
    data_dir: PathBuf,
    /// `Err` holds the (user-content-free) reason initialization failed. The app still starts
    /// so the UI can explain the problem; a GUI process has no visible stderr on Windows.
    db: std::result::Result<Mutex<Connection>, String>,
    /// The verified Scripture index, or why Scripture is unavailable. A Scripture failure never
    /// takes notes and documents down with it.
    scripture: std::result::Result<scripture::Index, String>,
}

/// Facts about the running app, shown on the Settings screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_version: String,
    pub data_dir: String,
    pub schema_version: Option<i64>,
    pub database_error: Option<String>,
}

impl AppState {
    /// Create the data directory, open the database and apply migrations. Never panics and
    /// never fails: a failure is remembered and reported through every later call.
    pub fn initialize(data_dir: PathBuf) -> Self {
        let opened = std::fs::create_dir_all(&data_dir)
            .map_err(AppError::from)
            .and_then(|()| db::open_and_migrate(&data_dir.join(db::DB_FILE_NAME)));
        let (db, scripture) = match opened {
            Ok(mut conn) => {
                // Remove half-written files from an interrupted import (best effort).
                documents::sweep_stale_temp_files(&data_dir, STALE_TEMP_FILE_AGE);
                crate::research::sweep_stale_temp_files(&data_dir, STALE_TEMP_FILE_AGE);
                // Install (first run) or verify the packaged, read-only Scripture text.
                let scripture = scripture::install(&mut conn)
                    .and_then(|()| scripture::Index::load(&conn))
                    .map_err(|error| {
                        eprintln!("BEACON: Scripture data unavailable: {error}");
                        match error {
                            AppError::ScriptureUnavailable(detail) => detail,
                            other => other.to_string(),
                        }
                    });
                (Ok(Mutex::new(conn)), scripture)
            }
            Err(error) => {
                // Initialization errors mention files and SQL, never note content.
                eprintln!("BEACON: database initialization failed: {error}");
                (Err(error.to_string()), Err(error.to_string()))
            }
        };
        Self {
            data_dir,
            db,
            scripture,
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Run `operation` with exclusive access to the connection.
    pub fn with_db<T>(&self, operation: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        match &self.db {
            Ok(mutex) => {
                let guard = mutex.lock().map_err(|_| AppError::Internal)?;
                operation(&guard)
            }
            Err(reason) => Err(AppError::Unavailable(reason.clone())),
        }
    }

    /// Run `operation` against the database and the verified Scripture index.
    pub fn with_scripture<T>(
        &self,
        operation: impl FnOnce(&Connection, &scripture::Index) -> Result<T>,
    ) -> Result<T> {
        self.with_db(|conn| match &self.scripture {
            Ok(index) => operation(conn, index),
            Err(reason) => Err(AppError::ScriptureUnavailable(reason.clone())),
        })
    }

    pub fn info(&self) -> AppInfo {
        AppInfo {
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            data_dir: self.data_dir.display().to_string(),
            schema_version: self.with_db(migrations::current_version).ok(),
            database_error: self.db.as_ref().err().cloned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes;

    #[test]
    fn initializes_creates_the_data_dir_and_database_file() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("nested").join("beacon-data");
        let state = AppState::initialize(data_dir.clone());

        assert!(data_dir.join(db::DB_FILE_NAME).is_file());
        let info = state.info();
        assert_eq!(info.schema_version, Some(migrations::latest_version()));
        assert_eq!(info.database_error, None);
        assert_eq!(info.app_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(state.data_dir(), data_dir);
    }

    #[test]
    fn with_db_runs_operations_against_the_migrated_database() {
        let root = tempfile::tempdir().unwrap();
        let state = AppState::initialize(root.path().to_path_buf());
        let created = state
            .with_db(|conn| notes::create(conn, "hello", "world"))
            .unwrap();
        let listed = state.with_db(notes::list).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
    }

    #[test]
    fn a_failed_initialization_is_reported_not_fatal() {
        let root = tempfile::tempdir().unwrap();
        // A regular file where the data directory should be makes create_dir_all fail.
        let blocker = root.path().join("not-a-directory");
        std::fs::write(&blocker, b"x").unwrap();
        let state = AppState::initialize(blocker);

        assert!(matches!(
            state.with_db(notes::list),
            Err(AppError::Unavailable(_))
        ));
        let info = state.info();
        assert_eq!(info.schema_version, None);
        assert!(info.database_error.is_some());
    }
}
