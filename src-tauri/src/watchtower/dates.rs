//! Event and calendar dates for Watchtower.
//!
//! Std-only, so it is trivially testable and cannot be bypassed by another storage backend.
//! The TypeScript twin is `src/lib/watchtower/dates.ts`; both are tested against the shared
//! `data/watchtower/date-vectors.json`.
//!
//! An event date states *when the event happened*, at the precision the user actually knows:
//! `2026`, `2026-11`, `2026-11-05`, or an instant with an explicit zone,
//! `2026-11-05T14:30Z` / `2026-11-05T14:30-05:00`. Nothing is guessed: a time without a zone
//! is rejected, and a missing date stays missing (the event is "undated").
//!
//! ORDERING: every date maps to `sort`, minutes since 1970-01-01T00:00Z, taken at the START of
//! the stated period. Date-only values are read as UTC calendar dates. This is a stable
//! ordering key, not a claim that a year-precision event happened at midnight.

use std::fmt;

/// How much of the date the user stated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Precision {
    Year,
    Month,
    Day,
    Minute,
}

impl Precision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Year => "year",
            Self::Month => "month",
            Self::Day => "day",
            Self::Minute => "minute",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DateError {
    /// Not in one of the accepted shapes.
    Malformed,
    /// Right shape, impossible value (month 13, 30 February, hour 24, year 0000...).
    Invalid,
}

impl DateError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Malformed => "malformed",
            Self::Invalid => "invalid_date",
        }
    }
}

impl fmt::Display for DateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed => write!(
                f,
                "Use YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DDTHH:MM with a zone such as Z or -05:00."
            ),
            Self::Invalid => write!(f, "That date does not exist on the calendar."),
        }
    }
}

impl std::error::Error for DateError {}

/// A validated event date.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventDate {
    /// The date exactly as it will be stored (trimmed).
    pub text: String,
    pub precision: Precision,
    /// Minutes since 1970-01-01T00:00Z at the start of the stated period.
    pub sort: i64,
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if is_leap(year) {
                29
            } else {
                28
            }
        }
    }
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `bytes[range]` as a number; every byte must be an ASCII digit.
fn digits(bytes: &[u8], start: usize, len: usize) -> Result<i64, DateError> {
    let slice = bytes.get(start..start + len).ok_or(DateError::Malformed)?;
    if !slice.iter().all(u8::is_ascii_digit) {
        return Err(DateError::Malformed);
    }
    Ok(slice
        .iter()
        .fold(0_i64, |acc, d| acc * 10 + i64::from(d - b'0')))
}

fn expect(bytes: &[u8], at: usize, want: u8) -> Result<(), DateError> {
    if bytes.get(at) == Some(&want) {
        Ok(())
    } else {
        Err(DateError::Malformed)
    }
}

fn date_part(bytes: &[u8]) -> Result<(i64, i64, i64, Precision), DateError> {
    let year = digits(bytes, 0, 4)?;
    if bytes.len() == 4 {
        return finish(year, 1, 1, Precision::Year);
    }
    expect(bytes, 4, b'-')?;
    let month = digits(bytes, 5, 2)?;
    if bytes.len() == 7 {
        return finish(year, month, 1, Precision::Month);
    }
    expect(bytes, 7, b'-')?;
    let day = digits(bytes, 8, 2)?;
    if bytes.len() < 10 {
        return Err(DateError::Malformed);
    }
    finish(year, month, day, Precision::Day)
}

fn finish(
    year: i64,
    month: i64,
    day: i64,
    precision: Precision,
) -> Result<(i64, i64, i64, Precision), DateError> {
    if year < 1 || !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return Err(DateError::Invalid);
    }
    Ok((year, month, day, precision))
}

/// Parse a calendar date (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`). Used for publication and
/// retrieval dates, which are never given a time.
pub fn parse_calendar_date(input: &str) -> Result<EventDate, DateError> {
    let text = input.trim();
    let bytes = text.as_bytes();
    if !matches!(bytes.len(), 4 | 7 | 10) {
        return Err(DateError::Malformed);
    }
    let (y, m, d, precision) = date_part(bytes)?;
    Ok(EventDate {
        text: text.to_owned(),
        precision,
        sort: days_from_civil(y, m, d) * 1440,
    })
}

/// Parse an event date: a calendar date, or `YYYY-MM-DDTHH:MM` plus `Z` or `+HH:MM`/`-HH:MM`.
pub fn parse_event_date(input: &str) -> Result<EventDate, DateError> {
    let text = input.trim();
    let bytes = text.as_bytes();
    match bytes.len() {
        4 | 7 | 10 => return parse_calendar_date(text),
        17 | 22 => {}
        _ => return Err(DateError::Malformed),
    }

    let (y, m, d, _) = date_part(bytes.get(..10).ok_or(DateError::Malformed)?)?;
    expect(bytes, 10, b'T')?;
    let hour = digits(bytes, 11, 2)?;
    expect(bytes, 13, b':')?;
    let minute = digits(bytes, 14, 2)?;

    let offset = if bytes.len() == 17 {
        expect(bytes, 16, b'Z')?;
        0
    } else {
        // 16 is the sign, then HH:MM.
        let sign = match bytes.get(16) {
            Some(b'+') => 1,
            Some(b'-') => -1,
            _ => return Err(DateError::Malformed),
        };
        let off_hour = digits(bytes, 17, 2)?;
        expect(bytes, 19, b':')?;
        let off_minute = digits(bytes, 20, 2)?;
        if off_hour > 23 || off_minute > 59 {
            return Err(DateError::Invalid);
        }
        sign * (off_hour * 60 + off_minute)
    };
    if hour > 23 || minute > 59 {
        return Err(DateError::Invalid);
    }

    Ok(EventDate {
        text: text.to_owned(),
        precision: Precision::Minute,
        sort: days_from_civil(y, m, d) * 1440 + hour * 60 + minute - offset,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_and_known_days() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(1, 1, 1), -719_162);
    }

    #[test]
    fn parses_each_precision() {
        let year = parse_event_date("2026").unwrap();
        assert_eq!(
            (year.precision, year.text.as_str()),
            (Precision::Year, "2026")
        );
        assert_eq!(
            parse_event_date("2026-11").unwrap().precision,
            Precision::Month
        );
        assert_eq!(
            parse_event_date("2026-11-05").unwrap().precision,
            Precision::Day
        );
        assert_eq!(
            parse_event_date("2026-11-05T14:30Z").unwrap().precision,
            Precision::Minute
        );
    }

    #[test]
    fn zones_change_the_instant_but_not_the_text() {
        let utc = parse_event_date("2026-11-05T14:30Z").unwrap();
        let east = parse_event_date("2026-11-05T19:30+05:00").unwrap();
        let west = parse_event_date("2026-11-05T09:30-05:00").unwrap();
        assert_eq!(utc.sort, east.sort);
        assert_eq!(utc.sort, west.sort);
        assert_eq!(west.text, "2026-11-05T09:30-05:00");
    }

    #[test]
    fn a_coarser_date_sorts_at_the_start_of_its_period() {
        let year = parse_event_date("2026").unwrap().sort;
        let month = parse_event_date("2026-01").unwrap().sort;
        let day = parse_event_date("2026-01-01").unwrap().sort;
        assert_eq!(year, month);
        assert_eq!(month, day);
        assert!(parse_event_date("2026-01-02").unwrap().sort > day);
    }

    #[test]
    fn rejects_bad_shapes_and_impossible_values() {
        for (input, error) in [
            ("", DateError::Malformed),
            ("abc", DateError::Malformed),
            ("2026-1-5", DateError::Malformed),
            ("2026-11-05T14:30", DateError::Malformed),
            ("2026-11-05 14:30Z", DateError::Malformed),
            ("2026-11-05t14:30z", DateError::Malformed),
            ("12345", DateError::Malformed),
            ("2026-13", DateError::Invalid),
            ("2023-02-29", DateError::Invalid),
            ("1900-02-29", DateError::Invalid),
            ("0000", DateError::Invalid),
            ("2026-11-05T24:00Z", DateError::Invalid),
            ("2026-11-05T14:60Z", DateError::Invalid),
            ("2026-11-05T14:30+24:00", DateError::Invalid),
        ] {
            assert_eq!(parse_event_date(input), Err(error), "{input:?}");
        }
        assert!(parse_event_date("2024-02-29").is_ok());
        assert!(parse_event_date("2000-02-29").is_ok());
    }

    #[test]
    fn non_ascii_digits_are_not_digits() {
        assert_eq!(parse_event_date("２０２６"), Err(DateError::Malformed));
    }

    #[test]
    fn calendar_dates_never_carry_a_time() {
        assert!(parse_calendar_date("2026-11-05").is_ok());
        assert_eq!(
            parse_calendar_date("2026-11-05T14:30Z"),
            Err(DateError::Malformed)
        );
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        assert_eq!(parse_event_date(" 2026-11-05 ").unwrap().text, "2026-11-05");
    }
}
