//! Turn what a person types into a *safe* SQLite FTS5 MATCH expression.
//!
//! Search input is untrusted. FTS5 has its own operator syntax (`OR`, `NOT`, `NEAR`, `*`, `^`,
//! `col:`, parentheses), so passing text through unchanged would let a query change what is
//! searched or raise syntax errors. Instead every word or quoted phrase becomes one FTS5
//! *string literal*, which is always matched literally, and the literals are combined with an
//! implicit AND.
//!
//! * `north bridge`      -> documents containing both `north` and `bridge`
//! * `"north bridge"`    -> documents containing that exact consecutive phrase
//! * `north OR bridge`   -> documents containing `north`, `or` and `bridge` (OR is just a word)
//!
//! The browser demo mirrors the parsing in `src/lib/searchQuery.ts`.

use super::validation::Rejection;

pub const MAX_QUERY_CHARS: usize = 200;
pub const MAX_QUERY_UNITS: usize = 8;

fn flush(current: &mut String, units: &mut Vec<String>) {
    let unit = current.trim();
    // A unit with no letters or digits has no searchable tokens (FTS5 would see an empty
    // phrase), so punctuation-only fragments are ignored.
    if unit.chars().any(char::is_alphanumeric) {
        units.push(unit.to_owned());
    }
    current.clear();
}

/// Split a query into words and quoted phrases. An empty vector means "nothing to search".
pub fn parse(query: &str) -> Result<Vec<String>, Rejection> {
    let query = query.trim();
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(Rejection("Search must be at most 200 characters."));
    }
    if query.chars().any(char::is_control) {
        return Err(Rejection("Search must not contain control characters."));
    }
    let mut units = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    for ch in query.chars() {
        if ch == '"' {
            flush(&mut current, &mut units);
            in_quote = !in_quote;
        } else if !in_quote && ch.is_whitespace() {
            flush(&mut current, &mut units);
        } else {
            current.push(ch);
        }
    }
    flush(&mut current, &mut units);
    if units.len() > MAX_QUERY_UNITS {
        return Err(Rejection("Use at most 8 words or phrases in one search."));
    }
    Ok(units)
}

/// Build the MATCH expression: each unit becomes an FTS5 string literal (`"` doubled).
pub fn to_match_expression(units: &[String]) -> String {
    units
        .iter()
        .map(|unit| format!("\"{}\"", unit.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn units(query: &str) -> Vec<String> {
        parse(query).unwrap()
    }

    #[test]
    fn splits_words_and_keeps_quoted_phrases_together() {
        assert_eq!(units("north bridge"), vec!["north", "bridge"]);
        assert_eq!(units("\"north bridge\""), vec!["north bridge"]);
        assert_eq!(
            units("radio \"signal checks\" 0900"),
            vec!["radio", "signal checks", "0900"]
        );
    }

    #[test]
    fn empty_blank_and_punctuation_only_queries_search_nothing() {
        assert!(units("").is_empty());
        assert!(units("   \t ").is_empty());
        assert!(units("\"").is_empty());
        assert!(units("\"\"").is_empty());
        assert!(units("*** --- ()").is_empty());
    }

    #[test]
    fn an_unterminated_quote_is_treated_as_a_phrase_to_the_end() {
        assert_eq!(units("\"north bridge"), vec!["north bridge"]);
    }

    #[test]
    fn fts_operators_become_literal_text() {
        let expr = to_match_expression(&units("north OR bridge NOT x NEAR(a b"));
        assert_eq!(
            expr,
            "\"north\" \"OR\" \"bridge\" \"NOT\" \"x\" \"NEAR(a\" \"b\""
        );
        let expr = to_match_expression(&units("col:foo a* ^b -c {d}"));
        assert_eq!(expr, "\"col:foo\" \"a*\" \"^b\" \"-c\" \"{d}\"");
        // Every unit is a quoted literal, so there is no bare operator in the expression.
        assert!(expr
            .split(' ')
            .all(|part| part.starts_with('"') && part.ends_with('"')));
    }

    #[test]
    fn quotes_are_escaped_by_doubling_if_one_ever_reaches_the_builder() {
        assert_eq!(
            to_match_expression(&["say \"hi\"".to_owned()]),
            "\"say \"\"hi\"\"\""
        );
    }

    #[test]
    fn rejects_overlong_control_and_too_many_term_queries() {
        assert!(parse(&"a".repeat(201)).is_err());
        assert!(parse(&"a".repeat(200)).is_ok());
        assert!(parse("bad\u{0}query").is_err());
        assert!(parse("two\nlines").is_err());
        assert!(parse("a b c d e f g h i").is_err());
        assert!(parse("a b c d e f g h").is_ok());
    }
}
