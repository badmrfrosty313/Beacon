//! Scripture reference parsing, validation, canonical formatting and chapter navigation.
//!
//! Pure and std-only: no database, no I/O. The TypeScript twin used by the browser demo
//! (`src/lib/scripture/reference.ts`) implements the same rules, and both are tested against the
//! shared vectors in `data/scripture/reference-vectors.json`.
//!
//! Grammar (after normalizing whitespace and Unicode dashes):
//!
//! ```text
//! Book                  first chapter of the book
//! Book C                a whole chapter            (single-chapter books: verse C)
//! Book C:V              one verse
//! Book C:V-V2           verses in one chapter
//! Book C:V-C2:V2        verses across chapters
//! Book C-C2             whole chapters             (single-chapter books: verses C-C2)
//! ```
//!
//! `Book` may be a full name or an alias, ignoring case, periods and spacing ("1 John", "1Jn",
//! "I John", "First John", "Rev.", "Song of Songs"). Anything else is rejected with a specific,
//! user-facing problem rather than guessed at.

use std::collections::HashMap;

use super::data::CanonBook;

/// Longest input accepted (characters). Longer text is rejected before any parsing.
pub const MAX_INPUT_CHARS: usize = 100;
/// Most verses a single lookup may return, so a request such as "Genesis 1-50" stays bounded.
pub const MAX_PASSAGE_VERSES: u32 = 500;

#[derive(Debug, Clone)]
pub struct Book {
    pub id: String,
    pub name: String,
    pub citation: String,
    pub order: u32,
    pub testament: String,
    /// Number of verses in each chapter; the length is the chapter count.
    pub verse_counts: Vec<u32>,
}

impl Book {
    pub fn chapter_count(&self) -> u32 {
        self.verse_counts.len() as u32
    }

    fn verses_in(&self, chapter: u32) -> u32 {
        self.verse_counts[chapter as usize - 1]
    }
}

/// A validated passage: always within the real bounds of its book.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resolved {
    pub book: usize,
    pub start_chapter: u32,
    pub start_verse: u32,
    pub end_chapter: u32,
    pub end_verse: u32,
}

/// Why a reference could not be used. `code` is a stable machine-readable identifier shared
/// with the frontend; `message` is safe to show to the user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
    pub code: &'static str,
    pub message: String,
}

fn problem(code: &'static str, message: impl Into<String>) -> Problem {
    Problem {
        code,
        message: message.into(),
    }
}

pub struct Structure {
    pub books: Vec<Book>,
    aliases: HashMap<String, usize>,
}

fn ordinal_digit(token: &str) -> Option<&'static str> {
    match token {
        "1" | "1st" | "i" | "first" => Some("1"),
        "2" | "2nd" | "ii" | "second" => Some("2"),
        "3" | "3rd" | "iii" | "third" => Some("3"),
        _ => None,
    }
}

/// Reduce a book name to its lookup key: lower case, no periods or spaces, a leading ordinal
/// ("I", "First", "1st") turned into a digit. `None` if it contains anything but letters and
/// digits afterwards.
pub fn normalize_book_name(raw: &str) -> Option<String> {
    let lowered = raw.to_lowercase();
    let cleaned: String = lowered.chars().filter(|c| *c != '.').collect();
    let mut tokens: Vec<&str> = cleaned.split(' ').filter(|t| !t.is_empty()).collect();
    if tokens.len() >= 2 {
        if let Some(digit) = ordinal_digit(tokens[0]) {
            tokens[0] = digit;
        }
    }
    let joined = tokens.concat();
    if !joined.is_empty() && joined.chars().all(|c| c.is_ascii_alphanumeric()) {
        Some(joined)
    } else {
        None
    }
}

fn plural(count: u32, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

/// A short, control-character-free echo of user input for error messages.
fn echo(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect::<String>()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tok {
    Num(u32),
    Colon,
    Dash,
}

fn is_tail_char(c: char) -> bool {
    c.is_ascii_digit() || matches!(c, ':' | '-' | ' ')
}

fn tokenize_tail(tail: &str) -> Result<Vec<Tok>, Problem> {
    let malformed = || {
        problem(
            "malformed",
            "Could not read that reference. Try a form like “John 3:16”, “Psalm 23” or “Rev 13:16-18”.",
        )
    };
    let mut tokens = Vec::new();
    let mut digits = String::new();
    let flush = |digits: &mut String, tokens: &mut Vec<Tok>| -> Result<(), Problem> {
        if digits.is_empty() {
            return Ok(());
        }
        // A number directly after another number can only mean digits separated by a space.
        if matches!(tokens.last(), Some(Tok::Num(_))) {
            return Err(malformed());
        }
        if digits.len() > 4 {
            return Err(malformed());
        }
        let value: u32 = digits.parse().map_err(|_| malformed())?;
        tokens.push(Tok::Num(value));
        digits.clear();
        Ok(())
    };
    for c in tail.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
        } else {
            flush(&mut digits, &mut tokens)?;
            match c {
                ':' => tokens.push(Tok::Colon),
                '-' => tokens.push(Tok::Dash),
                ' ' => {}
                _ => return Err(malformed()),
            }
        }
    }
    flush(&mut digits, &mut tokens)?;
    Ok(tokens)
}

/// Map the dash and whitespace variants people type or paste onto plain ASCII. The accepted
/// character set is deliberately tiny and identical in the TypeScript twin, so both parsers
/// treat every input the same way.
fn normalize_input(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            // En dash, em dash, figure dash, minus sign, non-breaking hyphen.
            '\u{2013}' | '\u{2014}' | '\u{2012}' | '\u{2212}' | '\u{2011}' => '-',
            // Tab, line breaks and no-break space.
            '\t' | '\n' | '\r' | '\u{a0}' => ' ',
            other => other,
        })
        .collect()
}

fn is_allowed(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | ':' | '-')
}

impl Structure {
    /// Build the lookup structure from the canon and the verse count of every chapter.
    pub fn new(canon: &[CanonBook], verse_counts: Vec<Vec<u32>>) -> Result<Self, String> {
        if canon.len() != verse_counts.len() {
            return Err("canon and verse counts disagree".to_owned());
        }
        let mut aliases: HashMap<String, usize> = HashMap::new();
        let mut books = Vec::with_capacity(canon.len());
        for (index, (book, counts)) in canon.iter().zip(verse_counts).enumerate() {
            if counts.is_empty() || counts.contains(&0) {
                return Err(format!("{} has an empty chapter", book.id));
            }
            let keys = std::iter::once(book.name.as_str())
                .chain(std::iter::once(book.citation.as_str()))
                .chain(book.aliases.iter().map(String::as_str));
            for raw in keys {
                let key = normalize_book_name(raw)
                    .ok_or_else(|| format!("unusable book alias `{raw}` for {}", book.id))?;
                if let Some(previous) = aliases.insert(key.clone(), index) {
                    if previous != index {
                        return Err(format!("ambiguous book alias `{key}`"));
                    }
                }
            }
            books.push(Book {
                id: book.id.clone(),
                name: book.name.clone(),
                citation: book.citation.clone(),
                order: book.order,
                testament: book.testament.clone(),
                verse_counts: counts,
            });
        }
        Ok(Self { books, aliases })
    }

    pub fn book_index(&self, id: &str) -> Option<usize> {
        self.books.iter().position(|book| book.id == id)
    }

    /// Parse and validate a user-typed reference against the real bounds of the canon.
    pub fn parse(&self, input: &str) -> Result<Resolved, Problem> {
        if input.chars().count() > MAX_INPUT_CHARS {
            return Err(problem(
                "too_long",
                format!("References are limited to {MAX_INPUT_CHARS} characters."),
            ));
        }
        let text = normalize_input(input);
        let text = text.trim_matches(' ');
        if text.is_empty() {
            return Err(problem("empty", "Enter a reference such as “John 3:16”."));
        }
        if !text.chars().all(is_allowed) {
            return Err(problem(
                "malformed",
                "Use only letters A–Z, numbers, spaces, “:” and “-”, for example “John 3:16”.",
            ));
        }

        // Split the trailing chapter/verse expression from the book name.
        let chars: Vec<char> = text.chars().collect();
        let mut split = chars.len();
        while split > 0 && is_tail_char(chars[split - 1]) {
            split -= 1;
        }
        let book_part: String = chars[..split].iter().collect();
        let tail: String = chars[split..].iter().collect();
        let tail = tail.trim_matches(' ');
        let book_part = book_part.trim_matches(' ');

        if book_part.is_empty() {
            return Err(problem(
                "malformed",
                "Start with a book name, for example “John 3:16”.",
            ));
        }
        if !tail.is_empty() && !tail.starts_with(|c: char| c.is_ascii_digit()) {
            return Err(problem(
                "malformed",
                "Could not read that reference. Try a form like “John 3:16”, “Psalm 23” or “Rev 13:16-18”.",
            ));
        }

        let book = normalize_book_name(book_part)
            .and_then(|key| self.aliases.get(&key).copied())
            .ok_or_else(|| {
                problem(
                    "unknown_book",
                    format!("No book matches “{}”.", echo(book_part)),
                )
            })?;
        let info = &self.books[book];
        let tokens = tokenize_tail(tail)?;
        let single = info.chapter_count() == 1;

        // Interpret the number shapes; each arm yields (start chapter, start verse, end chapter,
        // end verse) where a verse of `None` means "whole chapter" at that end.
        use Tok::{Colon, Dash, Num};
        let (sc, sv, ec, ev): (u32, Option<u32>, u32, Option<u32>) = match tokens.as_slice() {
            [] => (1, None, 1, None),
            [Num(n)] if single => (1, Some(*n), 1, Some(*n)),
            [Num(c)] => (*c, None, *c, None),
            [Num(c), Colon, Num(v)] => (*c, Some(*v), *c, Some(*v)),
            [Num(c), Colon, Num(v), Dash, Num(v2)] => (*c, Some(*v), *c, Some(*v2)),
            [Num(c), Colon, Num(v), Dash, Num(c2), Colon, Num(v2)] => {
                (*c, Some(*v), *c2, Some(*v2))
            }
            [Num(a), Dash, Num(b)] if single => (1, Some(*a), 1, Some(*b)),
            [Num(a), Dash, Num(b)] => (*a, None, *b, None),
            _ => {
                return Err(problem(
                    "malformed",
                    "Could not read that reference. Try a form like “John 3:16”, “Psalm 23” or “Rev 13:16-18”.",
                ))
            }
        };

        for chapter in [sc, ec] {
            if chapter == 0 || chapter > info.chapter_count() {
                return Err(problem(
                    "out_of_range",
                    format!(
                        "{} has {}.",
                        info.citation,
                        plural(info.chapter_count(), "chapter", "chapters")
                    ),
                ));
            }
        }
        let check_verse = |chapter: u32, verse: u32| -> Result<(), Problem> {
            let max = info.verses_in(chapter);
            if verse == 0 || verse > max {
                let what = if single {
                    info.citation.clone()
                } else {
                    format!("{} {chapter}", info.citation)
                };
                return Err(problem(
                    "out_of_range",
                    format!("{what} has {}.", plural(max, "verse", "verses")),
                ));
            }
            Ok(())
        };
        let start_verse = match sv {
            Some(v) => {
                check_verse(sc, v)?;
                v
            }
            None => 1,
        };
        let end_verse = match ev {
            Some(v) => {
                check_verse(ec, v)?;
                v
            }
            None => info.verses_in(ec),
        };
        if (ec, end_verse) < (sc, start_verse) {
            return Err(problem(
                "invalid_range",
                "The end of the range comes before its start.",
            ));
        }

        let resolved = Resolved {
            book,
            start_chapter: sc,
            start_verse,
            end_chapter: ec,
            end_verse,
        };
        if self.verse_span(&resolved) > MAX_PASSAGE_VERSES {
            return Err(problem(
                "range_too_large",
                format!("Please request at most {MAX_PASSAGE_VERSES} verses at a time."),
            ));
        }
        Ok(resolved)
    }

    /// Number of verses a passage covers.
    pub fn verse_span(&self, r: &Resolved) -> u32 {
        let info = &self.books[r.book];
        if r.start_chapter == r.end_chapter {
            return r.end_verse - r.start_verse + 1;
        }
        let mut total = info.verses_in(r.start_chapter) - r.start_verse + 1;
        for chapter in (r.start_chapter + 1)..r.end_chapter {
            total += info.verses_in(chapter);
        }
        total + r.end_verse
    }

    /// A resolved passage for a whole chapter (used by navigation).
    pub fn whole_chapter(&self, book: usize, chapter: u32) -> Option<Resolved> {
        let info = self.books.get(book)?;
        if chapter == 0 || chapter > info.chapter_count() {
            return None;
        }
        Some(Resolved {
            book,
            start_chapter: chapter,
            start_verse: 1,
            end_chapter: chapter,
            end_verse: info.verses_in(chapter),
        })
    }

    /// The canonical, re-parseable citation for a passage, e.g. `Revelation 13:16-18`,
    /// `Psalm 23`, `Genesis 1:31-2:3`, `Genesis 1-3`, `Jude 1:3`.
    pub fn canonical(&self, r: &Resolved) -> String {
        let info = &self.books[r.book];
        let name = &info.citation;
        let whole = r.start_verse == 1 && r.end_verse == info.verses_in(r.end_chapter);
        if r.start_chapter == r.end_chapter {
            if r.start_verse == r.end_verse {
                return format!("{name} {}:{}", r.start_chapter, r.start_verse);
            }
            if whole && info.chapter_count() > 1 {
                return format!("{name} {}", r.start_chapter);
            }
            return format!(
                "{name} {}:{}-{}",
                r.start_chapter, r.start_verse, r.end_verse
            );
        }
        if whole {
            return format!("{name} {}-{}", r.start_chapter, r.end_chapter);
        }
        format!(
            "{name} {}:{}-{}:{}",
            r.start_chapter, r.start_verse, r.end_chapter, r.end_verse
        )
    }

    /// The chapter before `(book, chapter)`, crossing into the previous book's last chapter.
    pub fn previous_chapter(&self, book: usize, chapter: u32) -> Option<(usize, u32)> {
        if chapter > 1 {
            Some((book, chapter - 1))
        } else if book > 0 {
            Some((book - 1, self.books[book - 1].chapter_count()))
        } else {
            None
        }
    }

    /// The chapter after `(book, chapter)`, crossing into the next book's first chapter.
    pub fn next_chapter(&self, book: usize, chapter: u32) -> Option<(usize, u32)> {
        if chapter < self.books[book].chapter_count() {
            Some((book, chapter + 1))
        } else if book + 1 < self.books.len() {
            Some((book + 1, 1))
        } else {
            None
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::scripture::data;
    use std::sync::OnceLock;

    /// The structure built from the real packaged data (parsed once for all tests).
    pub(crate) fn structure() -> &'static Structure {
        static STRUCTURE: OnceLock<Structure> = OnceLock::new();
        STRUCTURE.get_or_init(|| {
            let verified = data::load_verified().expect("packaged data must verify");
            let mut counts = vec![Vec::new(); verified.canon.len()];
            for chapter in &verified.bible.chapters {
                counts[chapter.book].push(chapter.verses.len() as u32);
            }
            Structure::new(&verified.canon, counts).unwrap()
        })
    }

    fn canonical(input: &str) -> String {
        let s = structure();
        let r = s.parse(input).unwrap_or_else(|p| panic!("{input}: {p:?}"));
        s.canonical(&r)
    }

    fn code(input: &str) -> &'static str {
        structure().parse(input).unwrap_err().code
    }

    #[test]
    fn the_required_inputs_resolve() {
        assert_eq!(canonical("Genesis 1:1"), "Genesis 1:1");
        assert_eq!(canonical("John 3:16"), "John 3:16");
        assert_eq!(canonical("Psalm 23"), "Psalm 23");
        assert_eq!(canonical("Revelation 13:16-18"), "Revelation 13:16-18");
        assert_eq!(canonical("Rev 13:18"), "Revelation 13:18");
        assert_eq!(canonical("1 John 4:1"), "1 John 4:1");
        assert_eq!(canonical("3 John 1:2"), "3 John 1:2");
    }

    #[test]
    fn aliases_spacing_case_punctuation_and_ordinals() {
        for input in [
            "1john 4:1",
            "1 Jn 4:1",
            "I John 4:1",
            "First John 4:1",
            "1st John 4:1",
            "  1 JOHN   4 : 1  ",
            "1Jn4:1",
        ] {
            assert_eq!(canonical(input), "1 John 4:1", "{input}");
        }
        assert_eq!(canonical("Rev. 13:18"), "Revelation 13:18");
        assert_eq!(canonical("Song of Songs 2:1"), "Song of Solomon 2:1");
        assert_eq!(canonical("Ps 23:1"), "Psalm 23:1");
        assert_eq!(canonical("Psalms 23"), "Psalm 23");
    }

    #[test]
    fn unicode_dashes_are_ranges() {
        assert_eq!(canonical("Rev 13:16\u{2013}18"), "Revelation 13:16-18");
        assert_eq!(canonical("Rev 13:16\u{2014}18"), "Revelation 13:16-18");
    }

    #[test]
    fn ranges_across_verses_chapters_and_whole_chapters() {
        assert_eq!(canonical("Genesis 1:31-2:3"), "Genesis 1:31-2:3");
        assert_eq!(canonical("Genesis 1-3"), "Genesis 1-3");
        assert_eq!(canonical("Genesis 1:1-31"), "Genesis 1");
        assert_eq!(canonical("Genesis"), "Genesis 1");
        assert_eq!(canonical("Psalm 119"), "Psalm 119");
    }

    #[test]
    fn single_chapter_books_treat_a_lone_number_as_a_verse() {
        assert_eq!(canonical("Jude 3"), "Jude 1:3");
        assert_eq!(canonical("Jude 1:3"), "Jude 1:3");
        assert_eq!(canonical("Jude 3-5"), "Jude 1:3-5");
        assert_eq!(canonical("3 John 2"), "3 John 1:2");
        assert_eq!(canonical("Jude"), "Jude 1:1-25");
        assert_eq!(canonical("Obadiah 1:21"), "Obadiah 1:21");
    }

    #[test]
    fn invalid_input_is_rejected_with_specific_codes() {
        assert_eq!(code(""), "empty");
        assert_eq!(code("   "), "empty");
        assert_eq!(code(&"x".repeat(101)), "too_long");
        assert_eq!(code("Hezekiah 1:1"), "unknown_book");
        assert_eq!(code("3:16"), "malformed");
        assert_eq!(code("John 3:"), "malformed");
        assert_eq!(code("John :16"), "malformed");
        assert_eq!(code("John 3:16:1"), "malformed");
        assert_eq!(code("John 3 16"), "malformed");
        assert_eq!(code("John 3,16"), "malformed");
        assert_eq!(code("G\u{e9}nesis 1:1"), "malformed");
        assert_eq!(code("x'; DROP TABLE notes;--"), "malformed");
        assert_eq!(code("John 99999"), "malformed");
        assert_eq!(code("Revelation 23"), "out_of_range");
        assert_eq!(code("Revelation 0"), "out_of_range");
        assert_eq!(code("Revelation 13:19"), "out_of_range");
        assert_eq!(code("Revelation 13:0"), "out_of_range");
        assert_eq!(code("Jude 26"), "out_of_range");
        assert_eq!(code("Jude 2:1"), "out_of_range");
        assert_eq!(code("John 3:18-16"), "invalid_range");
        assert_eq!(code("John 3-2"), "invalid_range");
        assert_eq!(code("Genesis 2:1-1:5"), "invalid_range");
        assert_eq!(code("Genesis 1-50"), "range_too_large");
        assert_eq!(code("John 3\u{0}:16"), "malformed");
    }

    #[test]
    fn error_messages_are_user_safe_and_bounded() {
        let long_book = format!("{} 1:1", "a".repeat(60));
        let problem = structure().parse(&long_book).unwrap_err();
        assert_eq!(problem.code, "unknown_book");
        assert!(problem.message.chars().count() < 100);
        let bell = structure().parse("John\u{7} 3:16").unwrap_err();
        assert_eq!(bell.code, "malformed");
        assert!(!bell.message.contains('\u{7}'));
        let out = structure().parse("Revelation 23").unwrap_err();
        assert_eq!(out.message, "Revelation has 22 chapters.");
        let verse = structure().parse("Psalm 23:7").unwrap_err();
        assert_eq!(verse.message, "Psalm 23 has 6 verses.");
    }

    #[test]
    fn pasted_whitespace_variants_are_accepted() {
        assert_eq!(canonical("John\t3:16"), "John 3:16");
        assert_eq!(canonical("John\u{a0}3:16\n"), "John 3:16");
    }

    #[test]
    fn every_canonical_reference_round_trips() {
        let s = structure();
        for (book, info) in s.books.iter().enumerate() {
            for chapter in 1..=info.chapter_count() {
                let whole = s.whole_chapter(book, chapter).unwrap();
                let text = s.canonical(&whole);
                assert_eq!(s.parse(&text).unwrap(), whole, "{text}");
                let last = s.books[book].verses_in(chapter);
                let single = Resolved {
                    end_verse: 1,
                    ..whole
                };
                assert_eq!(s.parse(&s.canonical(&single)).unwrap(), single);
                if last > 1 {
                    let tail = Resolved {
                        start_verse: last,
                        ..whole
                    };
                    assert_eq!(s.parse(&s.canonical(&tail)).unwrap(), tail);
                }
            }
        }
    }

    #[test]
    fn navigation_crosses_chapter_and_book_boundaries() {
        let s = structure();
        let book = |id: &str| s.book_index(id).unwrap();
        assert_eq!(s.previous_chapter(book("GEN"), 1), None);
        assert_eq!(s.next_chapter(book("GEN"), 1), Some((book("GEN"), 2)));
        assert_eq!(s.next_chapter(book("GEN"), 50), Some((book("EXO"), 1)));
        assert_eq!(s.previous_chapter(book("EXO"), 1), Some((book("GEN"), 50)));
        // Old Testament to New Testament.
        assert_eq!(s.next_chapter(book("MAL"), 4), Some((book("MAT"), 1)));
        assert_eq!(s.previous_chapter(book("MAT"), 1), Some((book("MAL"), 4)));
        // Single-chapter books and the end of the canon.
        assert_eq!(s.next_chapter(book("3JN"), 1), Some((book("JUD"), 1)));
        assert_eq!(s.next_chapter(book("JUD"), 1), Some((book("REV"), 1)));
        assert_eq!(s.next_chapter(book("REV"), 22), None);
        assert_eq!(s.previous_chapter(book("REV"), 1), Some((book("JUD"), 1)));
    }

    #[test]
    fn aliases_are_unambiguous_and_every_book_name_resolves() {
        let s = structure();
        for (index, info) in s.books.iter().enumerate() {
            let r = s.parse(&info.name).unwrap();
            assert_eq!(r.book, index, "{}", info.name);
            let r = s.parse(&format!("{} 1", info.citation)).unwrap();
            assert_eq!(r.book, index);
        }
    }

    #[test]
    fn ambiguous_aliases_are_rejected_at_build_time() {
        let book = |id: &str, alias: &str, order: u32| CanonBook {
            id: id.to_owned(),
            order,
            testament: "OT".to_owned(),
            name: id.to_owned(),
            citation: id.to_owned(),
            aliases: vec![alias.to_owned()],
        };
        let canon = vec![book("AAA", "x", 1), book("BBB", "x", 2)];
        assert!(Structure::new(&canon, vec![vec![1], vec![1]]).is_err());
    }
}
