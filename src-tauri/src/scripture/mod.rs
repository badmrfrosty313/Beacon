//! Read-only Scripture reference data: installation, lookup by reference, chapter navigation.
//!
//! Scripture is *reference data*, never user data. The text ships inside the application (see
//! [`data`]), is verified against its recorded SHA-256 and totals, and is installed into
//! `scripture_*` tables inside one transaction. Triggers make those tables immutable once
//! installed. User-authored notes live in `notes` and never share a table or a write path with
//! Scripture.
//!
//! OFFLINE: nothing here touches the network or the filesystem beyond SQLite.

pub mod data;
pub mod reference;

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, Result};
use reference::{Problem, Resolved, Structure};

/// The translation packaged with this build.
pub const TRANSLATION_ID: &str = "engwebp";

fn unavailable(detail: impl std::fmt::Display) -> AppError {
    AppError::ScriptureUnavailable(detail.to_string())
}

// ---------------------------------------------------------------------------------------------
// Types returned to the frontend (mirrored in src/api/types.ts)
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationInfo {
    pub id: String,
    pub abbreviation: String,
    pub name: String,
    pub edition: String,
    pub language: String,
    pub license_status: String,
    pub license_notice: String,
    pub source_url: String,
    pub source_sha256: String,
    pub retrieved_on: String,
    pub verse_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSummary {
    pub id: String,
    pub name: String,
    pub citation_name: String,
    pub testament: String,
    pub order: u32,
    pub chapter_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptureOverview {
    pub translation: TranslationInfo,
    pub books: Vec<BookSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptureVerse {
    pub chapter: u32,
    pub verse: u32,
    /// Empty only for the few verses the source provides as a number plus a footnote.
    pub text: String,
}

/// One chapter touched by a passage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageChapter {
    pub chapter: u32,
    pub verse_count: u32,
    /// Psalm title, kept apart from the numbered verses; empty when there is none (and for a
    /// passage that starts partway into the chapter, which does not include the title).
    pub superscription: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavTarget {
    pub book_id: String,
    pub book_name: String,
    pub chapter: u32,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScripturePassage {
    pub translation_id: String,
    pub translation_abbreviation: String,
    pub book_id: String,
    pub book_name: String,
    /// Name used in citations ("Psalm" for the book of Psalms).
    pub citation_name: String,
    pub book_chapter_count: u32,
    /// Canonical, re-parseable citation, e.g. `Revelation 13:16-18`.
    pub canonical: String,
    pub start_chapter: u32,
    pub start_verse: u32,
    pub end_chapter: u32,
    pub end_verse: u32,
    pub verses: Vec<ScriptureVerse>,
    pub chapters: Vec<PassageChapter>,
    pub previous: Option<NavTarget>,
    pub next: Option<NavTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReferenceProblem {
    pub code: String,
    pub message: String,
}

impl From<Problem> for ReferenceProblem {
    fn from(problem: Problem) -> Self {
        Self {
            code: problem.code.to_owned(),
            message: problem.message,
        }
    }
}

/// The result of typing a reference. An unusable reference is an expected outcome, not a
/// failure, so it is reported as data (`ok: false`) rather than as an error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LookupResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passage: Option<ScripturePassage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<ReferenceProblem>,
}

// ---------------------------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------------------------

/// Make sure the packaged translation is installed, verified and complete. Idempotent.
///
/// A fresh database gets the full text in a single transaction. An existing install is checked
/// against the packaged checksum and verse total; any disagreement is reported rather than
/// patched, because the tables are immutable by design.
pub fn install(conn: &mut Connection) -> Result<()> {
    let meta = data::parse_meta(data::META_TEXT);
    let recorded = meta.get("data.sha256").map_err(unavailable)?;
    if data::sha256_hex(data::VERSES_TSV.as_bytes()) != recorded {
        return Err(unavailable(
            "the packaged text does not match its recorded SHA-256",
        ));
    }

    let installed: Option<(String, i64)> = conn
        .query_row(
            "SELECT data_sha256, verse_count FROM scripture_translations WHERE id = ?1",
            [TRANSLATION_ID],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    if let Some((sha, verse_count)) = installed {
        let actual: i64 = conn.query_row(
            "SELECT COUNT(*) FROM scripture_verses WHERE translation_id = ?1",
            [TRANSLATION_ID],
            |r| r.get(0),
        )?;
        let expected = meta.number("data.verses").map_err(unavailable)? as i64;
        if sha != recorded || verse_count != expected || actual != expected {
            return Err(unavailable(
                "the installed Scripture text does not match this version of BEACON",
            ));
        }
        return Ok(());
    }

    let verified = data::load_verified().map_err(unavailable)?;
    install_verified(conn, &verified)
}

pub(crate) fn install_verified(conn: &mut Connection, verified: &data::VerifiedData) -> Result<()> {
    let meta = &verified.meta;
    let canon_id = data::CANON_ID;
    let tx = conn.transaction()?;

    let canon_exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM scripture_canons WHERE id = ?1",
        [canon_id],
        |row| row.get(0),
    )?;
    if canon_exists == 0 {
        tx.execute(
            "INSERT INTO scripture_canons (id, name) VALUES (?1, ?2)",
            params![canon_id, "Protestant canon (66 books)"],
        )?;
        let mut chapter_counts = vec![0u32; verified.canon.len()];
        for chapter in &verified.bible.chapters {
            chapter_counts[chapter.book] += 1;
        }
        let mut insert = tx.prepare(
            "INSERT INTO scripture_books
                 (canon_id, id, sort_order, testament, name, citation_name, chapter_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for (book, count) in verified.canon.iter().zip(chapter_counts) {
            insert.execute(params![
                canon_id,
                book.id,
                book.order,
                book.testament,
                book.name,
                book.citation,
                count
            ])?;
        }
    }

    {
        let mut insert_chapter = tx.prepare(
            "INSERT INTO scripture_chapters (translation_id, book_id, chapter, verse_count, superscription)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        let mut insert_verse = tx.prepare(
            "INSERT INTO scripture_verses (translation_id, book_id, chapter, verse, text)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for chapter in &verified.bible.chapters {
            let book_id = &verified.canon[chapter.book].id;
            insert_chapter.execute(params![
                TRANSLATION_ID,
                book_id,
                chapter.chapter,
                chapter.verses.len() as i64,
                chapter.superscription
            ])?;
            for (index, text) in chapter.verses.iter().enumerate() {
                insert_verse.execute(params![
                    TRANSLATION_ID,
                    book_id,
                    chapter.chapter,
                    index as i64 + 1,
                    text
                ])?;
            }
        }
    }

    // The translation row is written last: its existence marks the install as complete and
    // seals the chapter and verse tables against further inserts (see migration 0003).
    let license_notice = format!(
        "{} Text from {} (retrieved {}); SHA-256 of the source archive {}.",
        meta.get("license.trademark").map_err(unavailable)?,
        meta.get("source.url").map_err(unavailable)?,
        meta.get("source.retrieved").map_err(unavailable)?,
        meta.get("source.zip.sha256").map_err(unavailable)?,
    );
    tx.execute(
        "INSERT INTO scripture_translations
             (id, abbreviation, name, edition, language, canon_id, license_status, license_notice,
              source_url, source_sha256, retrieved_on, data_sha256, verse_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            meta.get("translation.id").map_err(unavailable)?,
            meta.get("translation.abbreviation").map_err(unavailable)?,
            meta.get("translation.name").map_err(unavailable)?,
            meta.get("translation.edition").map_err(unavailable)?,
            meta.get("translation.language").map_err(unavailable)?,
            canon_id,
            meta.get("license.status").map_err(unavailable)?,
            license_notice,
            meta.get("source.url").map_err(unavailable)?,
            meta.get("source.zip.sha256").map_err(unavailable)?,
            meta.get("source.retrieved").map_err(unavailable)?,
            verified.data_sha256,
            verified.bible.verse_total() as i64,
        ],
    )?;
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Index: the in-memory structure used to validate references
// ---------------------------------------------------------------------------------------------

/// Chapter/verse structure of the installed translation plus its descriptive metadata. Loaded
/// once at startup; lookups validate against it before touching the database.
pub struct Index {
    structure: Structure,
    translation: TranslationInfo,
}

impl Index {
    pub fn load(conn: &Connection) -> Result<Self> {
        let translation = conn
            .query_row(
                "SELECT id, abbreviation, name, edition, language, license_status, license_notice,
                        source_url, source_sha256, retrieved_on, verse_count
                 FROM scripture_translations WHERE id = ?1",
                [TRANSLATION_ID],
                |row| {
                    Ok(TranslationInfo {
                        id: row.get(0)?,
                        abbreviation: row.get(1)?,
                        name: row.get(2)?,
                        edition: row.get(3)?,
                        language: row.get(4)?,
                        license_status: row.get(5)?,
                        license_notice: row.get(6)?,
                        source_url: row.get(7)?,
                        source_sha256: row.get(8)?,
                        retrieved_on: row.get(9)?,
                        verse_count: row.get(10)?,
                    })
                },
            )
            .map_err(|_| unavailable("the Scripture text is not installed"))?;

        // Verse counts per chapter come from the database; names and aliases come from the
        // packaged canon definition (they are parsing configuration, not text).
        let canon = data::parse_canon(data::CANON_TEXT).map_err(unavailable)?;
        let mut counts: HashMap<String, Vec<(u32, u32)>> = HashMap::new();
        {
            let mut statement = conn.prepare(
                "SELECT book_id, chapter, verse_count FROM scripture_chapters
                 WHERE translation_id = ?1",
            )?;
            let rows = statement.query_map([TRANSLATION_ID], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, u32>(2)?,
                ))
            })?;
            for row in rows {
                let (book, chapter, verses) = row?;
                counts.entry(book).or_default().push((chapter, verses));
            }
        }
        let mut verse_counts = Vec::with_capacity(canon.len());
        for book in &canon {
            let mut chapters = counts
                .remove(&book.id)
                .ok_or_else(|| unavailable(format!("{} is missing", book.id)))?;
            chapters.sort_unstable();
            for (index, (chapter, _)) in chapters.iter().enumerate() {
                if *chapter as usize != index + 1 {
                    return Err(unavailable(format!("{} has a missing chapter", book.id)));
                }
            }
            verse_counts.push(chapters.into_iter().map(|(_, verses)| verses).collect());
        }
        if !counts.is_empty() {
            return Err(unavailable("unexpected extra books are installed"));
        }
        let structure = Structure::new(&canon, verse_counts).map_err(unavailable)?;
        Ok(Self {
            structure,
            translation,
        })
    }

    pub fn structure(&self) -> &Structure {
        &self.structure
    }
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

pub fn overview(index: &Index) -> ScriptureOverview {
    ScriptureOverview {
        translation: index.translation.clone(),
        books: index
            .structure
            .books
            .iter()
            .map(|book| BookSummary {
                id: book.id.clone(),
                name: book.name.clone(),
                citation_name: book.citation.clone(),
                testament: book.testament.clone(),
                order: book.order,
                chapter_count: book.chapter_count(),
            })
            .collect(),
    }
}

fn nav_target(structure: &Structure, target: Option<(usize, u32)>) -> Option<NavTarget> {
    target.map(|(book, chapter)| {
        let info = &structure.books[book];
        NavTarget {
            book_id: info.id.clone(),
            book_name: info.name.clone(),
            chapter,
            label: format!("{} {chapter}", info.citation),
        }
    })
}

fn fetch(conn: &Connection, index: &Index, resolved: &Resolved) -> Result<ScripturePassage> {
    let structure = &index.structure;
    let book = &structure.books[resolved.book];

    let mut verses = Vec::new();
    {
        let mut statement = conn.prepare_cached(
            "SELECT chapter, verse, text FROM scripture_verses
             WHERE translation_id = ?1 AND book_id = ?2
               AND (chapter, verse) >= (?3, ?4) AND (chapter, verse) <= (?5, ?6)
             ORDER BY chapter, verse",
        )?;
        let rows = statement.query_map(
            params![
                TRANSLATION_ID,
                book.id,
                resolved.start_chapter,
                resolved.start_verse,
                resolved.end_chapter,
                resolved.end_verse
            ],
            |row| {
                Ok(ScriptureVerse {
                    chapter: row.get(0)?,
                    verse: row.get(1)?,
                    text: row.get(2)?,
                })
            },
        )?;
        for row in rows {
            verses.push(row?);
        }
    }
    // Never present a partial passage as complete: the stored text must cover exactly the
    // verses the structure says exist.
    if verses.len() as u32 != structure.verse_span(resolved) {
        return Err(AppError::Integrity);
    }

    let mut chapters = Vec::new();
    {
        let mut statement = conn.prepare_cached(
            "SELECT chapter, verse_count, superscription FROM scripture_chapters
             WHERE translation_id = ?1 AND book_id = ?2 AND chapter BETWEEN ?3 AND ?4
             ORDER BY chapter",
        )?;
        let rows = statement.query_map(
            params![
                TRANSLATION_ID,
                book.id,
                resolved.start_chapter,
                resolved.end_chapter
            ],
            |row| {
                Ok(PassageChapter {
                    chapter: row.get(0)?,
                    verse_count: row.get(1)?,
                    superscription: row.get(2)?,
                })
            },
        )?;
        for row in rows {
            let mut item = row?;
            // A passage that starts partway into a chapter does not include its title.
            if item.chapter == resolved.start_chapter && resolved.start_verse != 1 {
                item.superscription.clear();
            }
            chapters.push(item);
        }
    }

    Ok(ScripturePassage {
        translation_id: index.translation.id.clone(),
        translation_abbreviation: index.translation.abbreviation.clone(),
        book_id: book.id.clone(),
        book_name: book.name.clone(),
        citation_name: book.citation.clone(),
        book_chapter_count: book.chapter_count(),
        canonical: structure.canonical(resolved),
        start_chapter: resolved.start_chapter,
        start_verse: resolved.start_verse,
        end_chapter: resolved.end_chapter,
        end_verse: resolved.end_verse,
        verses,
        chapters,
        previous: nav_target(
            structure,
            structure.previous_chapter(resolved.book, resolved.start_chapter),
        ),
        next: nav_target(
            structure,
            structure.next_chapter(resolved.book, resolved.end_chapter),
        ),
    })
}

/// Resolve and fetch a user-typed reference. Unusable input yields `ok: false` with a specific,
/// user-facing problem; only genuine storage failures are errors.
pub fn lookup(conn: &Connection, index: &Index, input: &str) -> Result<LookupResult> {
    match index.structure.parse(input) {
        Ok(resolved) => Ok(LookupResult {
            ok: true,
            passage: Some(fetch(conn, index, &resolved)?),
            problem: None,
        }),
        Err(problem) => Ok(LookupResult {
            ok: false,
            passage: None,
            problem: Some(problem.into()),
        }),
    }
}

/// Fetch a whole chapter by book id and chapter number (used by the book/chapter pickers and
/// previous/next navigation).
pub fn chapter(
    conn: &Connection,
    index: &Index,
    book_id: &str,
    chapter: u32,
) -> Result<ScripturePassage> {
    let book = index
        .structure
        .book_index(book_id)
        .ok_or(AppError::NotFound)?;
    let resolved = index
        .structure
        .whole_chapter(book, chapter)
        .ok_or(AppError::NotFound)?;
    fetch(conn, index, &resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{self, Migration, MIGRATIONS};
    use reference::Book;

    /// Expected chapter count of each of the 66 books of the Protestant canon, in order.
    const CHAPTERS: [(&str, u32); 66] = [
        ("GEN", 50),
        ("EXO", 40),
        ("LEV", 27),
        ("NUM", 36),
        ("DEU", 34),
        ("JOS", 24),
        ("JDG", 21),
        ("RUT", 4),
        ("1SA", 31),
        ("2SA", 24),
        ("1KI", 22),
        ("2KI", 25),
        ("1CH", 29),
        ("2CH", 36),
        ("EZR", 10),
        ("NEH", 13),
        ("EST", 10),
        ("JOB", 42),
        ("PSA", 150),
        ("PRO", 31),
        ("ECC", 12),
        ("SNG", 8),
        ("ISA", 66),
        ("JER", 52),
        ("LAM", 5),
        ("EZK", 48),
        ("DAN", 12),
        ("HOS", 14),
        ("JOL", 3),
        ("AMO", 9),
        ("OBA", 1),
        ("JON", 4),
        ("MIC", 7),
        ("NAM", 3),
        ("HAB", 3),
        ("ZEP", 3),
        ("HAG", 2),
        ("ZEC", 14),
        ("MAL", 4),
        ("MAT", 28),
        ("MRK", 16),
        ("LUK", 24),
        ("JHN", 21),
        ("ACT", 28),
        ("ROM", 16),
        ("1CO", 16),
        ("2CO", 13),
        ("GAL", 6),
        ("EPH", 6),
        ("PHP", 4),
        ("COL", 4),
        ("1TH", 5),
        ("2TH", 3),
        ("1TI", 6),
        ("2TI", 4),
        ("TIT", 3),
        ("PHM", 1),
        ("HEB", 13),
        ("JAS", 5),
        ("1PE", 5),
        ("2PE", 3),
        ("1JN", 5),
        ("2JN", 1),
        ("3JN", 1),
        ("JUD", 1),
        ("REV", 22),
    ];

    /// A migrated, Scripture-installed in-memory database (installs the whole packaged Bible).
    fn installed() -> (Connection, Index) {
        let mut conn = crate::db::open_in_memory_migrated().unwrap();
        install(&mut conn).unwrap();
        let index = Index::load(&conn).unwrap();
        (conn, index)
    }

    fn passage(conn: &Connection, index: &Index, input: &str) -> ScripturePassage {
        let result = lookup(conn, index, input).unwrap();
        assert!(result.ok, "{input}: {:?}", result.problem);
        result.passage.unwrap()
    }

    #[test]
    fn installs_the_complete_bible_and_is_idempotent() {
        let (mut conn, index) = installed();
        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM scripture_books"), 66);
        assert_eq!(count("SELECT COUNT(*) FROM scripture_chapters"), 1189);
        assert_eq!(count("SELECT COUNT(*) FROM scripture_verses"), 31103);
        assert_eq!(count("SELECT COUNT(*) FROM scripture_translations"), 1);
        assert_eq!(index.translation.verse_count, 31103);

        install(&mut conn).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM scripture_verses"), 31103);
    }

    #[test]
    fn every_book_has_the_expected_number_of_chapters() {
        let (_, index) = installed();
        let books = &index.structure.books;
        assert_eq!(books.len(), 66);
        for (book, (id, chapters)) in books.iter().zip(CHAPTERS) {
            assert_eq!(book.id, id);
            assert_eq!(book.chapter_count(), chapters, "{id}");
        }
        let total: u32 = books.iter().map(Book::chapter_count).sum();
        assert_eq!(total, 1189);
        let old: u32 = books
            .iter()
            .filter(|b| b.testament == "OT")
            .map(Book::chapter_count)
            .sum();
        assert_eq!((old, total - old), (929, 260));
        assert_eq!(books.iter().filter(|b| b.testament == "OT").count(), 39);
    }

    #[test]
    fn verse_boundaries_of_key_chapters() {
        let (conn, index) = installed();
        let last = |input: &str| passage(&conn, &index, input).verses.len();
        assert_eq!(last("Genesis 1"), 31);
        assert_eq!(last("Genesis 50"), 26);
        assert_eq!(last("Psalm 23"), 6);
        assert_eq!(last("Psalm 117"), 2);
        assert_eq!(last("Psalm 119"), 176);
        assert_eq!(last("John 3"), 36);
        assert_eq!(last("John 21"), 25);
        assert_eq!(last("Revelation 13"), 18);
        assert_eq!(last("Revelation 22"), 21);
        assert_eq!(last("3 John"), 14);
        assert_eq!(last("Jude"), 25);
    }

    #[test]
    fn exact_text_of_known_verses_is_preserved() {
        let (conn, index) = installed();
        let text = |input: &str| passage(&conn, &index, input).verses[0].text.clone();
        assert_eq!(
            text("Genesis 1:1"),
            "In the beginning, God created the heavens and the earth."
        );
        assert_eq!(
            text("John 3:16"),
            "For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life."
        );
        assert_eq!(
            text("Revelation 13:18"),
            "Here is wisdom. He who has understanding, let him calculate the number of the beast, for it is the number of a man. His number is six hundred sixty-six."
        );
        assert_eq!(
            text("3 John 1:2"),
            "Beloved, I pray that you may prosper in all things and be healthy, even as your soul prospers."
        );
        // Typographic apostrophe (U+2019), curly quotes and poetry line breaks are kept.
        assert_eq!(
            text("Psalm 23:1"),
            "The LORD is my shepherd;\nI shall lack nothing."
        );
        assert!(text("Psalm 1:1").contains("doesn\u{2019}t"));
        assert!(text("1 John 4:1").contains("don\u{2019}t"));
        assert!(
            text("Genesis 3:1").contains('\u{201c}') || text("Genesis 3:1").contains('\u{2019}')
        );
    }

    #[test]
    fn ranges_return_verses_in_order() {
        let (conn, index) = installed();
        let rev = passage(&conn, &index, "Revelation 13:16-18");
        assert_eq!(rev.canonical, "Revelation 13:16-18");
        let numbers: Vec<u32> = rev.verses.iter().map(|v| v.verse).collect();
        assert_eq!(numbers, vec![16, 17, 18]);
        assert!(rev.verses[0].text.starts_with("He causes all"));

        let across = passage(&conn, &index, "Genesis 1:30-2:2");
        let pairs: Vec<(u32, u32)> = across.verses.iter().map(|v| (v.chapter, v.verse)).collect();
        assert_eq!(pairs, vec![(1, 30), (1, 31), (2, 1), (2, 2)]);

        let chapters = passage(&conn, &index, "Genesis 1-2");
        assert_eq!(chapters.verses.len(), 31 + 25);
        assert!(chapters
            .verses
            .windows(2)
            .all(|w| (w[0].chapter, w[0].verse) < (w[1].chapter, w[1].verse)));
    }

    #[test]
    fn verses_without_main_text_are_kept_not_dropped() {
        let (conn, index) = installed();
        for (input, count) in [
            ("Luke 17:35-37", 3),
            ("Acts 8:36-38", 3),
            ("Acts 15:33-35", 3),
            ("Acts 24:6-8", 3),
            ("Romans 16:24-25", 2),
        ] {
            let p = passage(&conn, &index, input);
            assert_eq!(p.verses.len(), count, "{input}");
            let empty: Vec<_> = p.verses.iter().filter(|v| v.text.is_empty()).collect();
            assert_eq!(empty.len(), 1, "{input} has exactly one empty verse");
        }
        let empties: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scripture_verses WHERE text = ''",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(empties, 5, "no other verse may be empty");
    }

    #[test]
    fn psalm_superscriptions_are_separate_from_verse_text() {
        let (conn, index) = installed();
        let psalm3 = passage(&conn, &index, "Psalm 3");
        assert_eq!(
            psalm3.chapters,
            vec![PassageChapter {
                chapter: 3,
                verse_count: 8,
                superscription: "A Psalm by David, when he fled from Absalom his son.".to_owned(),
            }]
        );
        assert_eq!(psalm3.verses.len(), 8);
        assert!(!psalm3.verses[0].text.contains("Absalom"));
        // A range that starts after verse 1 does not repeat the title, but still reports counts.
        let partial = passage(&conn, &index, "Psalm 3:2-3");
        assert_eq!(partial.chapters[0].superscription, "");
        assert_eq!(partial.chapters[0].verse_count, 8);
        assert_eq!(
            passage(&conn, &index, "John 3").chapters[0].superscription,
            ""
        );
        // Multi-chapter passages list every chapter they touch.
        let two = passage(&conn, &index, "Genesis 1:30-2:2");
        let counts: Vec<(u32, u32)> = two
            .chapters
            .iter()
            .map(|c| (c.chapter, c.verse_count))
            .collect();
        assert_eq!(counts, vec![(1, 31), (2, 25)]);
        assert_eq!(
            (two.citation_name.as_str(), two.book_chapter_count),
            ("Genesis", 50)
        );
        assert_eq!(passage(&conn, &index, "Psalm 23").citation_name, "Psalm");
        assert_eq!(passage(&conn, &index, "Psalm 23").book_name, "Psalms");
    }

    #[test]
    fn previous_and_next_cross_chapter_and_book_boundaries() {
        let (conn, index) = installed();
        let rev13 = passage(&conn, &index, "Revelation 13");
        assert_eq!(rev13.previous.as_ref().unwrap().label, "Revelation 12");
        assert_eq!(rev13.next.as_ref().unwrap().label, "Revelation 14");
        let gen50 = passage(&conn, &index, "Genesis 50");
        assert_eq!(gen50.next.as_ref().unwrap().label, "Exodus 1");
        assert!(passage(&conn, &index, "Genesis 1").previous.is_none());
        assert!(passage(&conn, &index, "Revelation 22").next.is_none());
        let mal = passage(&conn, &index, "Malachi 4");
        assert_eq!(mal.next.as_ref().unwrap().book_id, "MAT");
        let jude = passage(&conn, &index, "Jude");
        assert_eq!(jude.previous.as_ref().unwrap().label, "3 John 1");
        assert_eq!(jude.next.as_ref().unwrap().label, "Revelation 1");
        // Navigation from a multi-chapter range steps from its ends.
        let range = passage(&conn, &index, "Genesis 2-3");
        assert_eq!(range.previous.as_ref().unwrap().chapter, 1);
        assert_eq!(range.next.as_ref().unwrap().chapter, 4);
    }

    #[test]
    fn chapter_lookup_by_id_and_bad_ids() {
        let (conn, index) = installed();
        let p = chapter(&conn, &index, "REV", 13).unwrap();
        assert_eq!(p.canonical, "Revelation 13");
        assert_eq!(p.verses.len(), 18);
        assert!(matches!(
            chapter(&conn, &index, "REV", 23),
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            chapter(&conn, &index, "REV", 0),
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            chapter(&conn, &index, "XXX", 1),
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            chapter(&conn, &index, "rev'; DROP TABLE notes;--", 1),
            Err(AppError::NotFound)
        ));
    }

    #[test]
    fn unusable_references_are_data_not_errors() {
        let (conn, index) = installed();
        let result = lookup(&conn, &index, "Revelation 23").unwrap();
        assert!(!result.ok);
        assert!(result.passage.is_none());
        assert_eq!(result.problem.as_ref().unwrap().code, "out_of_range");
        let injected = lookup(&conn, &index, "x'; DROP TABLE notes;--").unwrap();
        assert!(!injected.ok);
        let notes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'notes'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(notes, 1);
    }

    #[test]
    fn the_overview_describes_the_translation_and_all_books() {
        let (_, index) = installed();
        let overview = overview(&index);
        assert_eq!(overview.books.len(), 66);
        assert_eq!(overview.translation.abbreviation, "WEB");
        assert_eq!(overview.translation.name, "World English Bible");
        assert!(overview
            .translation
            .license_status
            .contains("Public Domain"));
        assert!(overview.translation.license_notice.contains("trademark"));
        assert_eq!(overview.translation.source_sha256.len(), 64);
        let psalms = &overview.books[18];
        assert_eq!(
            (psalms.name.as_str(), psalms.citation_name.as_str()),
            ("Psalms", "Psalm")
        );
        assert_eq!(overview.books[65].chapter_count, 22);
        let json = serde_json::to_value(&overview).unwrap();
        assert!(json["books"][0].get("chapterCount").is_some());
    }

    #[test]
    fn scripture_tables_are_read_only() {
        let (conn, _) = installed();
        for sql in [
            "UPDATE scripture_verses SET text = 'changed' WHERE book_id = 'GEN'",
            "DELETE FROM scripture_verses WHERE book_id = 'GEN'",
            "INSERT INTO scripture_verses VALUES ('engwebp', 'GEN', 1, 99, 'extra')",
            "UPDATE scripture_chapters SET superscription = 'x'",
            "DELETE FROM scripture_chapters",
            "UPDATE scripture_books SET name = 'x'",
            "DELETE FROM scripture_books",
            "INSERT INTO scripture_books VALUES ('protestant66','XXX',99,'OT','X','X',1)",
            "UPDATE scripture_translations SET name = 'x'",
            "DELETE FROM scripture_translations",
            "UPDATE scripture_canons SET name = 'x'",
            "DELETE FROM scripture_canons",
        ] {
            let error = conn.execute(sql, []).unwrap_err().to_string();
            assert!(error.contains("read-only"), "{sql}: {error}");
        }
        let verses: i64 = conn
            .query_row("SELECT COUNT(*) FROM scripture_verses", [], |r| r.get(0))
            .unwrap();
        assert_eq!(verses, 31103);
    }

    #[test]
    fn a_second_translation_can_be_added_without_touching_the_first() {
        let (conn, _) = installed();
        // Rows for a new translation insert fine until its translation row exists; this
        // demonstrates that the model is translation-ready rather than hard-wired.
        conn.execute_batch(
            "BEGIN;
             INSERT INTO scripture_chapters VALUES ('demo', 'GEN', 1, 1, '');
             INSERT INTO scripture_verses VALUES ('demo', 'GEN', 1, 1, 'demo text');
             INSERT INTO scripture_translations VALUES
               ('demo','DEMO','Demo','Demo','en','protestant66','test','test','x',
                '0000000000000000000000000000000000000000000000000000000000000000',
                '2026-01-01',
                '0000000000000000000000000000000000000000000000000000000000000000', 1);
             COMMIT;",
        )
        .unwrap();
        let first: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scripture_verses WHERE translation_id = 'engwebp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(first, 31103);
    }

    #[test]
    fn existing_notes_and_documents_survive_the_upgrade() {
        // Build a database exactly as Sprint 002 left it (schema version 2) with user data.
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let v2: Vec<Migration> = MIGRATIONS
            .iter()
            .copied()
            .filter(|m| m.version <= 2)
            .collect();
        migrations::apply(&mut conn, &v2).unwrap();
        conn.execute(
            "INSERT INTO notes (title, body) VALUES ('Existing note', 'my own interpretation')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO documents (title, original_name, format, sha256, byte_length, content)
             VALUES ('Doc', 'doc.md', 'md', ?1, 5, 'hello')",
            ["a".repeat(64)],
        )
        .unwrap();

        // Upgrade to the current schema and install Scripture.
        assert_eq!(
            migrations::migrate(&mut conn).unwrap(),
            migrations::latest_version()
        );
        install(&mut conn).unwrap();

        let note: (String, String) = conn
            .query_row("SELECT title, body FROM notes", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(
            note,
            (
                "Existing note".to_owned(),
                "my own interpretation".to_owned()
            )
        );
        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM documents_fts WHERE documents_fts MATCH 'hello'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1, "the document and its search index are untouched");
    }

    #[test]
    fn a_partial_or_altered_dataset_is_rejected() {
        let canon = data::CANON_TEXT;
        let meta = data::META_TEXT;
        let tsv = data::VERSES_TSV;
        assert!(data::verify(canon, meta, tsv).is_ok());

        // Truncated (a "partial Bible"): checksum and totals both disagree.
        let cut = tsv.rfind("V\tREV\t22\t21\t").unwrap();
        assert!(data::verify(canon, meta, &tsv[..cut]).is_err());

        // One altered word.
        let altered = tsv.replacen("In the beginning,", "In the Beginning,", 1);
        assert!(data::verify(canon, meta, &altered).is_err());

        // Even with a matching checksum, structural checks catch a missing book / a gap.
        let without_jude: String = tsv
            .split('\n')
            .filter(|l| !l.starts_with("V\tJUD\t"))
            .collect::<Vec<_>>()
            .join("\n");
        let canon_books = data::parse_canon(canon).unwrap();
        assert!(data::parse_tsv(&without_jude, &canon_books).is_err());
        let gap = tsv.replacen("V\tGEN\t1\t2\t", "V\tGEN\t1\t3\t", 1);
        assert!(data::parse_tsv(&gap, &canon_books).is_err());
        let reordered = tsv.replacen("V\tGEN\t1\t1\t", "V\tEXO\t1\t1\t", 1);
        assert!(data::parse_tsv(&reordered, &canon_books).is_err());
    }

    #[test]
    fn a_tampered_installation_is_reported() {
        let (mut conn, _) = installed();
        // Triggers block normal edits; simulate on-disk damage by dropping one and deleting.
        conn.execute_batch("DROP TRIGGER scripture_verses_no_delete;")
            .unwrap();
        conn.execute(
            "DELETE FROM scripture_verses WHERE book_id = 'JUD' AND chapter = 1 AND verse = 25",
            [],
        )
        .unwrap();
        assert!(matches!(
            install(&mut conn),
            Err(AppError::ScriptureUnavailable(_))
        ));
    }

    #[test]
    fn packaged_data_matches_its_provenance_record() {
        let verified = data::load_verified().unwrap();
        let meta = &verified.meta;
        assert_eq!(meta.get("translation.id").unwrap(), TRANSLATION_ID);
        assert_eq!(
            meta.get("source.zip.sha256").unwrap(),
            "a93df5571009fed56f77e3ac1d3ce71c9a3a3df1486f7570cc7a8f823192fdba"
        );
        assert_eq!(meta.get("source.retrieved").unwrap(), "2026-11-04");
        assert_eq!(meta.number("data.books").unwrap(), 66);
        assert_eq!(meta.number("data.chapters").unwrap(), 1189);
        assert_eq!(meta.number("data.verses").unwrap(), 31103);
        assert!(meta
            .get("license.status")
            .unwrap()
            .contains("Public Domain"));
        assert!(meta.get("license.trademark").unwrap().contains("trademark"));
        // 70 source-file checksums recorded.
        let recorded = data::META_TEXT
            .lines()
            .filter(|l| l.starts_with("source.file.") && l.contains(".sha256="))
            .count();
        assert_eq!(recorded, 70);
    }

    #[test]
    fn shared_reference_vectors_agree_with_the_parser() {
        // The same file drives the TypeScript parser tests (browser-demo parity).
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../data/scripture/reference-vectors.json"
        ))
        .unwrap();
        let structure = reference::tests::structure();
        let cases = vectors["cases"].as_array().unwrap();
        assert!(cases.len() >= 40);
        for case in cases {
            let input = case["input"].as_str().unwrap();
            match structure.parse(input) {
                Ok(r) => {
                    assert_eq!(case["ok"], true, "{input}");
                    assert_eq!(case["canonical"], structure.canonical(&r), "{input}");
                    assert_eq!(case["bookId"], structure.books[r.book].id, "{input}");
                    assert_eq!(
                        case["range"],
                        serde_json::json!([
                            r.start_chapter,
                            r.start_verse,
                            r.end_chapter,
                            r.end_verse
                        ]),
                        "{input}"
                    );
                }
                Err(p) => {
                    assert_eq!(case["ok"], false, "{input}");
                    assert_eq!(case["code"], p.code, "{input}");
                }
            }
        }
    }
}
