//! Application error type shared by every Tauri command.
//!
//! Errors cross the IPC boundary as `{ "code": "...", "message": "..." }`. The message is
//! always safe to show to the user: database and filesystem failures are reported generically
//! so SQL text, file paths and user content never leak into the UI or logs.

use serde::{Serialize, Serializer};

use crate::notes::ValidationError;

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// The caller supplied invalid input. The message is user-facing.
    #[error("{0}")]
    Validation(String),
    /// A requested record does not exist.
    #[error("record not found")]
    NotFound,
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("migration error: {0}")]
    Migration(String),
    /// The database could not be opened or migrated at startup. Carries the initialization
    /// error text (which never contains user content).
    #[error("database unavailable: {0}")]
    Unavailable(String),
    #[error("internal error")]
    Internal,
    #[error("archived original failed its integrity check")]
    Integrity,
}

impl From<ValidationError> for AppError {
    fn from(error: ValidationError) -> Self {
        Self::Validation(error.to_string())
    }
}

impl AppError {
    /// Stable machine-readable code consumed by the frontend (`ApiErrorCode`).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "validation",
            Self::NotFound => "not_found",
            Self::Database(_) => "database",
            Self::Io(_) => "io",
            Self::Migration(_) => "migration",
            Self::Unavailable(_) => "unavailable",
            Self::Internal => "internal",
            Self::Integrity => "integrity",
        }
    }

    /// Message that is safe to display. Never includes SQL, paths or user content.
    pub fn user_message(&self) -> String {
        match self {
            Self::Validation(message) => message.clone(),
            Self::NotFound => "That note could not be found.".to_owned(),
            Self::Database(_) => {
                "BEACON could not read or write its local database. Your data was not changed by this action."
                    .to_owned()
            }
            Self::Io(_) => "BEACON could not access its local storage.".to_owned(),
            Self::Migration(_) => "BEACON could not update its local database.".to_owned(),
            Self::Unavailable(detail) => {
                format!("BEACON could not open its local database: {detail}")
            }
            Self::Internal => "BEACON hit an unexpected internal error.".to_owned(),
            Self::Integrity => "An archived original failed its SHA-256 integrity check.".to_owned(),
        }
    }
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    code: &'static str,
    message: &'a str,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        ErrorPayload {
            code: self.code(),
            message: &self.user_message(),
        }
        .serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_json(error: &AppError) -> serde_json::Value {
        serde_json::to_value(error).unwrap()
    }

    #[test]
    fn serializes_as_code_and_message() {
        let json = to_json(&AppError::NotFound);
        assert_eq!(json["code"], "not_found");
        assert_eq!(json["message"], "That note could not be found.");
    }

    #[test]
    fn validation_errors_keep_their_user_facing_message() {
        let error: AppError = ValidationError::TitleEmpty.into();
        let json = to_json(&error);
        assert_eq!(json["code"], "validation");
        assert_eq!(json["message"], "A title is required.");
    }

    #[test]
    fn database_errors_do_not_leak_sql_or_internals() {
        let sqlite_error = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
            Some("UNIQUE constraint failed: notes.secret_column".to_owned()),
        );
        let json = to_json(&AppError::Database(sqlite_error));
        assert_eq!(json["code"], "database");
        let message = json["message"].as_str().unwrap();
        assert!(!message.contains("secret_column"));
        assert!(!message.contains("UNIQUE"));
    }

    #[test]
    fn io_errors_do_not_leak_paths() {
        let io = std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            r"C:\Users\someone\AppData\private.db",
        );
        let json = to_json(&AppError::Io(io));
        assert!(!json["message"].as_str().unwrap().contains("someone"));
    }

    #[test]
    fn every_variant_has_a_distinct_code() {
        let codes = [
            AppError::Validation(String::new()).code(),
            AppError::NotFound.code(),
            AppError::Database(rusqlite::Error::QueryReturnedNoRows).code(),
            AppError::Io(std::io::Error::other("x")).code(),
            AppError::Migration(String::new()).code(),
            AppError::Unavailable(String::new()).code(),
            AppError::Internal.code(),
            AppError::Integrity.code(),
        ];
        let mut sorted = codes.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), codes.len());
    }
}
