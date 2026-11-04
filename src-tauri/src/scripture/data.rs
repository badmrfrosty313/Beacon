//! The packaged Scripture data embedded in the application, and std-only parsers for it.
//!
//! OFFLINE: the text is compiled into the binary with `include_str!`; nothing is ever fetched.
//! The files are generated from the official eBible.org archive by
//! `scripts/scripture/build-web.mjs` (provenance and checksums are in `engwebp.meta.txt`).
//!
//! The parsers are strict. A dataset that is partial, reordered, has a gap in verse numbers, or
//! disagrees with its own recorded totals is rejected, so an incomplete Bible can never be
//! installed and pass as a complete one.

use std::collections::HashMap;

use sha2::{Digest, Sha256};

/// Canon definition (book order, names and aliases), shared with the TypeScript side.
pub const CANON_TEXT: &str = include_str!("../../../data/scripture/canon-protestant66.txt");
/// Provenance, license notice, checksums and totals for the packaged translation.
pub const META_TEXT: &str = include_str!("../../../data/scripture/engwebp.meta.txt");
/// The verse text itself.
pub const VERSES_TSV: &str = include_str!("../../../data/scripture/engwebp.tsv");

/// Identifier of the canon the packaged translation uses.
pub const CANON_ID: &str = "protestant66";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonBook {
    pub id: String,
    pub order: u32,
    pub testament: String,
    pub name: String,
    pub citation: String,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Meta(HashMap<String, String>);

impl Meta {
    pub fn get(&self, key: &str) -> Result<&str, String> {
        self.0
            .get(key)
            .map(String::as_str)
            .ok_or_else(|| format!("packaged Scripture metadata is missing `{key}`"))
    }

    pub fn number(&self, key: &str) -> Result<u64, String> {
        self.get(key)?
            .parse()
            .map_err(|_| format!("packaged Scripture metadata `{key}` is not a number"))
    }
}

pub fn parse_meta(text: &str) -> Meta {
    let mut map = HashMap::new();
    for line in text.split('\n') {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            map.insert(key.to_owned(), value.to_owned());
        }
    }
    Meta(map)
}

pub fn parse_canon(text: &str) -> Result<Vec<CanonBook>, String> {
    let mut books = Vec::new();
    for line in text.split('\n') {
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('|').collect();
        if fields.len() != 6 {
            return Err(format!("malformed canon line: {line}"));
        }
        let order: u32 = fields[1]
            .parse()
            .map_err(|_| format!("bad book order in canon line: {line}"))?;
        if fields[2] != "OT" && fields[2] != "NT" {
            return Err(format!("bad testament in canon line: {line}"));
        }
        books.push(CanonBook {
            id: fields[0].to_owned(),
            order,
            testament: fields[2].to_owned(),
            name: fields[3].to_owned(),
            citation: if fields[4].is_empty() {
                fields[3].to_owned()
            } else {
                fields[4].to_owned()
            },
            aliases: fields[5]
                .split(',')
                .filter(|alias| !alias.is_empty())
                .map(str::to_owned)
                .collect(),
        });
    }
    for (index, book) in books.iter().enumerate() {
        if book.order as usize != index + 1 {
            return Err(format!("canon order is not contiguous at {}", book.id));
        }
    }
    Ok(books)
}

/// One parsed chapter: its optional Psalm superscription and its verse texts (verse 1 first).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedChapter {
    pub book: usize,
    pub chapter: u32,
    pub superscription: String,
    pub verses: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedBible {
    pub chapters: Vec<ParsedChapter>,
}

impl ParsedBible {
    pub fn verse_total(&self) -> usize {
        self.chapters.iter().map(|c| c.verses.len()).sum()
    }
}

fn unescape(field: &str) -> Result<String, String> {
    let mut out = String::with_capacity(field.len());
    let mut chars = field.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('n') => out.push('\n'),
            other => return Err(format!("invalid escape in Scripture data: {other:?}")),
        }
    }
    Ok(out)
}

/// Parse the verse TSV against the canon. Requires books in canon order, chapters and verses
/// ascending with no gaps, and rejects anything else.
pub fn parse_tsv(text: &str, canon: &[CanonBook]) -> Result<ParsedBible, String> {
    let mut lines = text.split('\n');
    if lines.next() != Some("#BEACON-SCRIPTURE-TSV 1") {
        return Err("unrecognized Scripture data format".to_owned());
    }
    let index_of: HashMap<&str, usize> = canon
        .iter()
        .enumerate()
        .map(|(i, b)| (b.id.as_str(), i))
        .collect();

    let mut chapters: Vec<ParsedChapter> = Vec::new();
    for (line_number, line) in lines.enumerate() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fail = |what: &str| format!("Scripture data line {}: {what}", line_number + 2);
        let fields: Vec<&str> = line.splitn(5, '\t').collect();
        if fields.len() != 5 {
            return Err(fail("expected 5 fields"));
        }
        let book = *index_of
            .get(fields[1])
            .ok_or_else(|| fail("unknown book"))?;
        let chapter_number: u32 = fields[2].parse().map_err(|_| fail("bad chapter"))?;
        let text = unescape(fields[4]).map_err(|e| fail(&e))?;

        // Locate (or start) the chapter this row belongs to, enforcing canonical order.
        let same_chapter = chapters
            .last()
            .is_some_and(|c| c.book == book && c.chapter == chapter_number);
        if !same_chapter {
            let ordered = match chapters.last() {
                None => book == 0 && chapter_number == 1,
                Some(last) if last.book == book => chapter_number == last.chapter + 1,
                Some(last) => book == last.book + 1 && chapter_number == 1,
            };
            if !ordered {
                return Err(fail("book or chapter out of order"));
            }
            chapters.push(ParsedChapter {
                book,
                chapter: chapter_number,
                superscription: String::new(),
                verses: Vec::new(),
            });
        }
        let current = chapters.last_mut().expect("chapter was just ensured");
        match fields[0] {
            "D" => {
                if !fields[3].is_empty() || !current.verses.is_empty() {
                    return Err(fail("misplaced superscription"));
                }
                current.superscription = text;
            }
            "V" => {
                let verse: usize = fields[3].parse().map_err(|_| fail("bad verse"))?;
                if verse != current.verses.len() + 1 {
                    return Err(fail("verse numbers must be contiguous from 1"));
                }
                current.verses.push(text);
            }
            _ => return Err(fail("unknown row kind")),
        }
    }

    let last = chapters.last().ok_or("Scripture data is empty")?;
    if last.book + 1 != canon.len() {
        return Err("Scripture data does not cover every book of the canon".to_owned());
    }
    // Every book needs at least one chapter and no chapter may be empty.
    let mut seen_books = vec![false; canon.len()];
    for chapter in &chapters {
        if chapter.verses.is_empty() {
            return Err(format!(
                "{} {} has no verses",
                canon[chapter.book].id, chapter.chapter
            ));
        }
        seen_books[chapter.book] = true;
    }
    if seen_books.iter().any(|seen| !seen) {
        return Err("Scripture data is missing a book".to_owned());
    }
    Ok(ParsedBible { chapters })
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Everything the installer needs, verified: the canon, the metadata and the parsed text,
/// checked against the recorded SHA-256 and totals.
pub struct VerifiedData {
    pub canon: Vec<CanonBook>,
    pub meta: Meta,
    pub bible: ParsedBible,
    pub data_sha256: String,
}

pub fn load_verified() -> Result<VerifiedData, String> {
    verify(CANON_TEXT, META_TEXT, VERSES_TSV)
}

pub(crate) fn verify(canon_text: &str, meta_text: &str, tsv: &str) -> Result<VerifiedData, String> {
    let canon = parse_canon(canon_text)?;
    let meta = parse_meta(meta_text);

    let actual = sha256_hex(tsv.as_bytes());
    if actual != meta.get("data.sha256")? {
        return Err("packaged Scripture text does not match its recorded SHA-256".to_owned());
    }
    let bible = parse_tsv(tsv, &canon)?;
    if canon.len() as u64 != meta.number("data.books")?
        || bible.chapters.len() as u64 != meta.number("data.chapters")?
        || bible.verse_total() as u64 != meta.number("data.verses")?
    {
        return Err("packaged Scripture text does not match its recorded totals".to_owned());
    }
    Ok(VerifiedData {
        canon,
        meta,
        bible,
        data_sha256: actual,
    })
}
