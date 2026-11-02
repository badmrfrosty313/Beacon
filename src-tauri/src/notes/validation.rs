//! Input validation for notes.
//!
//! This module intentionally depends on `std` only (no database, no framework) so it is
//! trivially testable and cannot be bypassed by a different storage backend later.
//! The backend is the authority on validity; the frontend mirrors these rules only to give
//! faster feedback (see `src/lib/validation.ts`).

use std::fmt;

/// Maximum title length, counted in Unicode scalar values (matches SQLite `length(TEXT)`).
pub const MAX_TITLE_CHARS: usize = 200;
/// Maximum body size in UTF-8 bytes (matches `length(CAST(body AS BLOB))` in the schema).
pub const MAX_BODY_BYTES: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidationError {
    TitleEmpty,
    TitleTooLong,
    TitleHasControlChars,
    BodyTooLong,
    BodyHasControlChars,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TitleEmpty => write!(f, "A title is required."),
            Self::TitleTooLong => {
                write!(f, "The title must be at most {MAX_TITLE_CHARS} characters.")
            }
            Self::TitleHasControlChars => {
                write!(f, "The title must not contain control characters.")
            }
            Self::BodyTooLong => write!(f, "The note must be at most {MAX_BODY_BYTES} bytes."),
            Self::BodyHasControlChars => write!(
                f,
                "The note must not contain control characters other than line breaks and tabs."
            ),
        }
    }
}

impl std::error::Error for ValidationError {}

/// A note that has passed validation. The title is trimmed; the body is preserved exactly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidNote {
    pub title: String,
    pub body: String,
}

/// Validate user-supplied note fields.
///
/// * Title: trimmed, 1..=200 characters, no control characters.
/// * Body: at most 100,000 bytes; control characters other than `\n`, `\r`, `\t` are rejected
///   (this also rejects NUL, which must never reach a SQLite TEXT column).
///
/// Notes are plain text. Nothing here interprets Markdown or HTML.
pub fn validate_note(title: &str, body: &str) -> Result<ValidNote, ValidationError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(ValidationError::TitleEmpty);
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(ValidationError::TitleTooLong);
    }
    if title.chars().any(char::is_control) {
        return Err(ValidationError::TitleHasControlChars);
    }
    if body.len() > MAX_BODY_BYTES {
        return Err(ValidationError::BodyTooLong);
    }
    if body
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(ValidationError::BodyHasControlChars);
    }
    Ok(ValidNote {
        title: title.to_owned(),
        body: body.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_normal_note_and_trims_only_the_title() {
        let note = validate_note("  Water plan \t", "  line one\nline two\t(tabbed)\r\n").unwrap();
        assert_eq!(note.title, "Water plan");
        assert_eq!(note.body, "  line one\nline two\t(tabbed)\r\n");
    }

    #[test]
    fn allows_an_empty_body() {
        assert_eq!(validate_note("Title", "").unwrap().body, "");
    }

    #[test]
    fn rejects_empty_and_whitespace_only_titles() {
        assert_eq!(validate_note("", "x"), Err(ValidationError::TitleEmpty));
        assert_eq!(
            validate_note(" \n\t ", "x"),
            Err(ValidationError::TitleEmpty)
        );
    }

    #[test]
    fn title_limit_is_inclusive_and_counts_characters_not_bytes() {
        let at_limit = "é".repeat(MAX_TITLE_CHARS); // 2 bytes each, 200 chars
        assert!(validate_note(&at_limit, "").is_ok());
        let over = "é".repeat(MAX_TITLE_CHARS + 1);
        assert_eq!(validate_note(&over, ""), Err(ValidationError::TitleTooLong));
    }

    #[test]
    fn astral_characters_count_as_one_character() {
        let at_limit = "🔦".repeat(MAX_TITLE_CHARS);
        assert!(validate_note(&at_limit, "").is_ok());
    }

    #[test]
    fn rejects_control_characters_in_titles() {
        for bad in ["a\0b", "a\nb", "a\tb", "a\u{7f}b", "a\u{1b}[31mb"] {
            assert_eq!(
                validate_note(bad, ""),
                Err(ValidationError::TitleHasControlChars),
                "title {bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn body_limit_is_in_bytes_and_inclusive() {
        let at_limit = "a".repeat(MAX_BODY_BYTES);
        assert!(validate_note("t", &at_limit).is_ok());
        let over = "a".repeat(MAX_BODY_BYTES + 1);
        assert_eq!(validate_note("t", &over), Err(ValidationError::BodyTooLong));
        // 3 bytes per char: 33,334 chars = 100,002 bytes > limit even though chars < limit.
        let multibyte = "€".repeat(33_334);
        assert_eq!(
            validate_note("t", &multibyte),
            Err(ValidationError::BodyTooLong)
        );
    }

    #[test]
    fn rejects_nul_and_other_control_characters_in_bodies() {
        for bad in ["a\0b", "a\u{7}b", "a\u{1b}b", "a\u{7f}b", "a\u{85}b"] {
            assert_eq!(
                validate_note("t", bad),
                Err(ValidationError::BodyHasControlChars),
                "body {bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn stores_markup_as_inert_text() {
        let body = "<script>alert(1)</script> ' OR 1=1; DROP TABLE notes; --";
        assert_eq!(validate_note("t", body).unwrap().body, body);
    }

    #[test]
    fn error_messages_are_user_facing() {
        assert_eq!(
            ValidationError::TitleEmpty.to_string(),
            "A title is required."
        );
        assert!(ValidationError::TitleTooLong.to_string().contains("200"));
        assert!(ValidationError::BodyTooLong.to_string().contains("100000"));
    }
}
