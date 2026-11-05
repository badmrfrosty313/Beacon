//! Field validation for Watchtower records.
//!
//! Std-only (plus the sibling `dates` module). The backend is the authority; the TypeScript
//! mirror in `src/lib/watchtower/validation.ts` exists only for faster feedback and for the
//! browser demo, which has no Rust. Messages are user-facing and never echo the input.

use super::dates::{self, EventDate};

pub const MAX_SHORT_CHARS: usize = 200;
pub const MAX_TEXT_CHARS: usize = 5000;
pub const MAX_EXPLANATION_CHARS: usize = 2000;
pub const MAX_URL_CHARS: usize = 2048;
pub const MAX_SCRIPTURE_REFERENCE_CHARS: usize = 100;

pub const CLAIM_KINDS: [&str; 4] = [
    "observation",
    "attributed_claim",
    "interpretation",
    "forecast",
];
pub const HYPOTHESIS_STATUSES: [&str; 3] = ["open", "under_review", "set_aside"];
pub const LINK_RELATIONS: [&str; 3] = ["supports", "contradicts", "context"];

type Check<T> = Result<T, String>;

fn chars(text: &str) -> usize {
    text.chars().count()
}

/// Trimmed single-line text. Empty input is `None` (an absent optional field).
fn single_line(label: &str, value: Option<&str>, max: usize) -> Check<Option<String>> {
    let Some(raw) = value else { return Ok(None) };
    let text = raw.trim();
    if text.is_empty() {
        return Ok(None);
    }
    if chars(text) > max {
        return Err(format!("{label} must be at most {max} characters."));
    }
    if text.chars().any(char::is_control) {
        return Err(format!("{label} must not contain control characters."));
    }
    Ok(Some(text.to_owned()))
}

pub fn required_line(label: &str, value: &str) -> Check<String> {
    single_line(label, Some(value), MAX_SHORT_CHARS)?.ok_or_else(|| format!("{label} is required."))
}

pub fn optional_line(label: &str, value: Option<&str>) -> Check<Option<String>> {
    single_line(label, value, MAX_SHORT_CHARS)
}

/// Trimmed multi-line text: line breaks and tabs are allowed, other control characters are not.
fn multi_line(label: &str, value: Option<&str>, max: usize) -> Check<Option<String>> {
    let Some(raw) = value else { return Ok(None) };
    let text = raw.trim();
    if text.is_empty() {
        return Ok(None);
    }
    if chars(text) > max {
        return Err(format!("{label} must be at most {max} characters."));
    }
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(format!(
            "{label} must not contain control characters other than line breaks and tabs."
        ));
    }
    Ok(Some(text.to_owned()))
}

pub fn required_text(label: &str, value: &str, max: usize) -> Check<String> {
    multi_line(label, Some(value), max)?.ok_or_else(|| format!("{label} is required."))
}

pub fn optional_text(label: &str, value: Option<&str>) -> Check<Option<String>> {
    multi_line(label, value, MAX_TEXT_CHARS)
}

/// A web address kept as data. It is never fetched. Credentials in the address are refused so a
/// pasted link cannot smuggle a password into the database.
pub fn optional_url(value: Option<&str>) -> Check<Option<String>> {
    let Some(raw) = value else { return Ok(None) };
    let text = raw.trim();
    if text.is_empty() {
        return Ok(None);
    }
    if chars(text) > MAX_URL_CHARS {
        return Err(format!(
            "The source URL must be at most {MAX_URL_CHARS} characters."
        ));
    }
    if text.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("The source URL must not contain spaces or control characters.".to_owned());
    }
    let lower = text.to_ascii_lowercase();
    let rest = if lower.starts_with("https://") {
        &text["https://".len()..]
    } else if lower.starts_with("http://") {
        &text["http://".len()..]
    } else {
        return Err("The source URL must start with http:// or https://.".to_owned());
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err("The source URL needs a host name.".to_owned());
    }
    if authority.contains('@') {
        return Err("The source URL must not contain a user name or password.".to_owned());
    }
    Ok(Some(text.to_owned()))
}

/// A plain Scripture reference such as `Revelation 13:18`. Only characters the reference
/// grammar allows are accepted; whether it exists is checked by the reader when it is opened.
pub fn optional_scripture_reference(value: Option<&str>) -> Check<Option<String>> {
    let Some(raw) = value else { return Ok(None) };
    let text = raw.trim();
    if text.is_empty() {
        return Ok(None);
    }
    if chars(text) > MAX_SCRIPTURE_REFERENCE_CHARS {
        return Err(format!(
            "The Scripture reference must be at most {MAX_SCRIPTURE_REFERENCE_CHARS} characters."
        ));
    }
    if !text
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | ':' | '-'))
    {
        return Err(
            "The Scripture reference may only contain letters, numbers, spaces, '.', ':' and '-'."
                .to_owned(),
        );
    }
    Ok(Some(text.to_owned()))
}

/// Publication / retrieval date: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Never defaulted.
pub fn optional_calendar_date(label: &str, value: Option<&str>) -> Check<Option<String>> {
    let Some(raw) = value else { return Ok(None) };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    dates::parse_calendar_date(raw)
        .map(|date| Some(date.text))
        .map_err(|error| format!("{label}: {error}"))
}

pub fn optional_event_date(value: Option<&str>) -> Check<Option<EventDate>> {
    let Some(raw) = value else { return Ok(None) };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    dates::parse_event_date(raw)
        .map(Some)
        .map_err(|error| format!("Event date: {error}"))
}

pub fn one_of(label: &str, value: &str, allowed: &[&str]) -> Check<String> {
    let text = value.trim();
    if allowed.contains(&text) {
        Ok(text.to_owned())
    } else {
        Err(format!("{label} must be one of: {}.", allowed.join(", ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_trimmed_bounded_and_control_free() {
        assert_eq!(
            required_line("Title", "  Example event ").unwrap(),
            "Example event"
        );
        assert!(required_line("Title", "   ").is_err());
        assert!(required_line("Title", &"x".repeat(201)).is_err());
        assert!(required_line("Title", "bad\u{0}title").is_err());
        assert!(required_line("Title", "two\nlines").is_err());
        assert_eq!(optional_line("Author", Some("  ")).unwrap(), None);
        assert_eq!(optional_line("Author", None).unwrap(), None);
    }

    #[test]
    fn text_allows_line_breaks_but_not_other_controls() {
        assert_eq!(
            required_text("Claim", " a\nb\tc ", MAX_TEXT_CHARS).unwrap(),
            "a\nb\tc"
        );
        assert!(required_text("Claim", "a\u{0}b", MAX_TEXT_CHARS).is_err());
        assert!(required_text("Claim", &"x".repeat(5001), MAX_TEXT_CHARS).is_err());
        assert!(required_text("Why", &"x".repeat(2001), MAX_EXPLANATION_CHARS).is_err());
        assert!(required_text("Claim", "", MAX_TEXT_CHARS).is_err());
    }

    #[test]
    fn urls_are_http_without_credentials_and_never_fetched() {
        assert_eq!(
            optional_url(Some(" https://example.org/a?b=1#c ")).unwrap(),
            Some("https://example.org/a?b=1#c".to_owned())
        );
        assert!(optional_url(Some("HTTP://Example.org")).unwrap().is_some());
        for bad in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "ftp://example.org",
            "example.org",
            "https://",
            "https:///path",
            "https://user:pass@example.org/",
            "https://exa mple.org",
            "https://example.org/\u{7}",
        ] {
            assert!(optional_url(Some(bad)).is_err(), "{bad:?} must be rejected");
        }
        assert!(optional_url(Some(&format!("https://e.org/{}", "a".repeat(2048)))).is_err());
        assert_eq!(optional_url(None).unwrap(), None);
    }

    #[test]
    fn scripture_references_use_only_reference_characters() {
        assert_eq!(
            optional_scripture_reference(Some(" Revelation 13:16-18 ")).unwrap(),
            Some("Revelation 13:16-18".to_owned())
        );
        assert!(optional_scripture_reference(Some("<script>")).is_err());
        assert!(optional_scripture_reference(Some(&"a".repeat(101))).is_err());
    }

    #[test]
    fn calendar_and_event_dates_are_validated_never_defaulted() {
        assert_eq!(
            optional_calendar_date("Published", Some("2026-11")).unwrap(),
            Some("2026-11".to_owned())
        );
        assert_eq!(optional_calendar_date("Published", Some("")).unwrap(), None);
        assert!(optional_calendar_date("Published", Some("2026-02-30")).is_err());
        assert!(optional_calendar_date("Published", Some("2026-11-05T10:00Z")).is_err());
        assert!(optional_event_date(Some("2026-11-05T10:00Z"))
            .unwrap()
            .is_some());
        assert!(optional_event_date(Some("  ")).unwrap().is_none());
        assert!(optional_event_date(Some("yesterday")).is_err());
    }

    #[test]
    fn enumerations_are_exact() {
        assert!(one_of("Kind", "observation", &CLAIM_KINDS).is_ok());
        assert!(one_of("Kind", "fact", &CLAIM_KINDS).is_err());
        assert!(one_of("Relation", "supports", &LINK_RELATIONS).is_ok());
        assert!(one_of("Relation", "proves", &LINK_RELATIONS).is_err());
        assert!(one_of("Status", "set_aside", &HYPOTHESIS_STATUSES).is_ok());
    }
}
