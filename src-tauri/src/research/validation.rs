//! Pure validation for research imports. Every name, byte and string is untrusted input.
//!
//! The file name is display metadata only. Originals are stored under a hash-derived name, so
//! a hostile name cannot influence a filesystem path. Rejections never echo the input.

use crate::documents::validation::{is_deceptive_display_char, Rejection};

/// Largest original accepted (any format). Text files are additionally limited to 1 MiB.
pub const MAX_ORIGINAL_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_FILENAME_BYTES: usize = 255;
pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_COLLECTION_NAME_CHARS: usize = 100;
pub const MAX_COLLECTION_DESCRIPTION_CHARS: usize = 1000;
pub const MAX_NOTE_CHARS: usize = 1000;
pub const MAX_LOCATION_CHARS: usize = 100;
/// The most text kept from one PDF. Anything longer must be flagged as truncated by the
/// extractor; the app never silently drops text.
pub const MAX_EXTRACTED_CHARS: usize = 3_000_000;
pub const MAX_PAGES: i64 = 100_000;
pub const MAX_EXTRACTION_METHOD_CHARS: usize = 100;
/// PDF readers tolerate a little junk before the header; so do we, but only this much.
const PDF_HEADER_WINDOW: usize = 1024;

pub const FORMATS: [&str; 3] = ["pdf", "md", "txt"];

/// Validate a plain file name (no directory) and derive `(title, format)`.
pub fn validate_filename(name: &str) -> Result<(String, String), Rejection> {
    if name.is_empty()
        || name.len() > MAX_FILENAME_BYTES
        || name
            .chars()
            .any(|ch| ch.is_control() || is_deceptive_display_char(ch))
        || name.contains(['/', '\\', ':'])
        || name == "."
        || name == ".."
    {
        return Err(Rejection(
            "Choose a .pdf, .md or .txt file with a plain filename.",
        ));
    }
    let unsupported =
        Rejection("Only PDF (.pdf), Markdown (.md) and text (.txt) files can be imported.");
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return Err(unsupported);
    };
    let format = ext.to_ascii_lowercase();
    if !FORMATS.contains(&format.as_str()) {
        return Err(unsupported);
    }
    let title = stem.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(Rejection(
            "The filename must contain a title of 1–200 characters.",
        ));
    }
    Ok((title.to_owned(), format))
}

/// A PDF must start with `%PDF-` within the first kilobyte. This is a sanity check on the
/// bytes that are preserved, not a parser: the text itself is extracted by the caller.
pub fn validate_pdf_header(bytes: &[u8]) -> Result<(), Rejection> {
    let window = &bytes[..bytes.len().min(PDF_HEADER_WINDOW)];
    if window.windows(5).any(|w| w == b"%PDF-") {
        Ok(())
    } else {
        Err(Rejection("That file does not look like a PDF."))
    }
}

/// Validate text a PDF extractor produced. It is derivative, so it is bounded and must not
/// contain control characters that could confuse display or search.
pub fn validate_extracted_text(text: &str) -> Result<(), Rejection> {
    if text.trim().is_empty() {
        return Err(Rejection(
            "No text could be read from this PDF. It may be a scanned image; BEACON does not do OCR.",
        ));
    }
    if text.chars().count() > MAX_EXTRACTED_CHARS {
        return Err(Rejection("The extracted text is too long."));
    }
    if text
        .chars()
        .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    {
        return Err(Rejection(
            "The extracted text contains unsupported control characters.",
        ));
    }
    Ok(())
}

/// A short label such as `pdfjs 4.10.38 (text layer)`.
pub fn validate_extraction_method(method: &str) -> Result<(), Rejection> {
    let ok = !method.is_empty()
        && method.chars().count() <= MAX_EXTRACTION_METHOD_CHARS
        && method.chars().all(|ch| {
            ch.is_ascii_alphanumeric()
                || matches!(ch, ' ' | '.' | '_' | ':' | '+' | '-' | '(' | ')')
        });
    if ok {
        Ok(())
    } else {
        Err(Rejection("The extraction method label is not valid."))
    }
}

pub fn validate_page_count(pages: i64) -> Result<(), Rejection> {
    if (1..=MAX_PAGES).contains(&pages) {
        Ok(())
    } else {
        Err(Rejection("The page count is not valid."))
    }
}

/// A collection name: 1 to 100 characters, no control characters, trimmed.
pub fn validate_collection_name(name: &str) -> Result<String, Rejection> {
    let text = name.trim();
    if text.is_empty() {
        return Err(Rejection("The collection name is required."));
    }
    if text.chars().count() > MAX_COLLECTION_NAME_CHARS {
        return Err(Rejection(
            "The collection name must be at most 100 characters.",
        ));
    }
    if text
        .chars()
        .any(|ch| ch.is_control() || is_deceptive_display_char(ch))
    {
        return Err(Rejection(
            "The collection name must not contain control characters.",
        ));
    }
    Ok(text.to_owned())
}

/// A page or section label such as `p. 12` or `Part 2, section 3`.
pub fn validate_location(location: &str) -> Result<Option<String>, Rejection> {
    let text = location.trim();
    if text.is_empty() {
        return Ok(None);
    }
    if text.chars().count() > MAX_LOCATION_CHARS {
        return Err(Rejection("The location must be at most 100 characters."));
    }
    if text.chars().any(char::is_control) {
        return Err(Rejection(
            "The location must not contain control characters.",
        ));
    }
    Ok(Some(text.to_owned()))
}

/// Lowercase hexadecimal SHA-256, 64 characters.
pub fn validate_sha256(hash: &str) -> Result<(), Rejection> {
    if hash.len() == 64 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        Ok(())
    } else {
        Err(Rejection("That checksum is not valid."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_pdf_md_txt_and_derives_title_and_format() {
        assert_eq!(
            validate_filename("Synthetic Report.PDF"),
            Ok(("Synthetic Report".to_owned(), "pdf".to_owned()))
        );
        assert_eq!(
            validate_filename("notes.v2.md"),
            Ok(("notes.v2".to_owned(), "md".to_owned()))
        );
        assert_eq!(
            validate_filename("a.txt"),
            Ok(("a".to_owned(), "txt".to_owned()))
        );
    }

    #[test]
    fn rejects_unsafe_or_unsupported_filenames() {
        let too_long = format!("{}.pdf", "a".repeat(300));
        let hostile = [
            "",
            ".",
            "..",
            ".pdf",
            "   .txt",
            "../escape.pdf",
            "..\\escape.pdf",
            "dir/file.pdf",
            r"C:\secret.pdf",
            "C:file.pdf",
            "macro.docx",
            "evil.exe",
            "noextension",
            "tab\there.md",
            "nul\0.pdf",
            "line\nbreak.txt",
            "evil\u{202E}fdp.pdf",
            "zero\u{200B}width.md",
            too_long.as_str(),
        ];
        for name in hostile {
            assert!(validate_filename(name).is_err(), "should reject {name:?}");
        }
        assert!(validate_filename(&format!("{}.pdf", "a".repeat(201))).is_err());
        assert!(validate_filename(&format!("{}.pdf", "a".repeat(200))).is_ok());
    }

    #[test]
    fn checks_the_pdf_header() {
        assert!(validate_pdf_header(b"%PDF-1.7\n%...").is_ok());
        assert!(validate_pdf_header(b"junk\r\n%PDF-1.4").is_ok());
        assert!(validate_pdf_header(b"").is_err());
        assert!(validate_pdf_header(b"PK\x03\x04 not a pdf").is_err());
        let late = [vec![b' '; 2000], b"%PDF-1.4".to_vec()].concat();
        assert!(validate_pdf_header(&late).is_err());
    }

    #[test]
    fn validates_extracted_text() {
        assert!(validate_extracted_text("Page one\nPage two\t").is_ok());
        assert!(validate_extracted_text("日本語 and émigré").is_ok());
        assert!(validate_extracted_text("").is_err());
        assert!(validate_extracted_text("  \n\t ").is_err());
        assert!(validate_extracted_text("bell\u{7}").is_err());
        assert!(validate_extracted_text("nul\0").is_err());
        assert!(validate_extracted_text(&"x".repeat(MAX_EXTRACTED_CHARS)).is_ok());
        assert!(validate_extracted_text(&"x".repeat(MAX_EXTRACTED_CHARS + 1)).is_err());
    }

    #[test]
    fn the_empty_text_rejection_explains_scanned_pdfs() {
        let Err(Rejection(message)) = validate_extracted_text("") else {
            panic!("expected a rejection");
        };
        assert!(message.contains("scanned"));
        assert!(message.contains("OCR"));
    }

    #[test]
    fn validates_labels_pages_collections_locations_and_hashes() {
        assert!(validate_extraction_method("pdfjs 4.10.38 (text layer)").is_ok());
        assert!(validate_extraction_method("utf8-text").is_ok());
        assert!(validate_extraction_method("").is_err());
        assert!(validate_extraction_method("bad/method").is_err());
        assert!(validate_extraction_method(&"a".repeat(101)).is_err());

        assert!(validate_page_count(1).is_ok());
        assert!(validate_page_count(MAX_PAGES).is_ok());
        assert!(validate_page_count(0).is_err());
        assert!(validate_page_count(MAX_PAGES + 1).is_err());

        assert_eq!(validate_collection_name("  General  ").unwrap(), "General");
        assert!(validate_collection_name("   ").is_err());
        assert!(validate_collection_name(&"a".repeat(101)).is_err());
        assert!(validate_collection_name(&"a".repeat(100)).is_ok());
        assert!(validate_collection_name("bad\nname").is_err());
        assert!(validate_collection_name("zero\u{200B}width").is_err());

        assert_eq!(
            validate_location("  p. 12 ").unwrap(),
            Some("p. 12".to_owned())
        );
        assert_eq!(validate_location("   ").unwrap(), None);
        assert!(validate_location("a\nb").is_err());
        assert!(validate_location(&"a".repeat(101)).is_err());

        assert!(validate_sha256(&"a".repeat(64)).is_ok());
        assert!(validate_sha256(&"A".repeat(64)).is_err());
        assert!(validate_sha256(&"a".repeat(63)).is_err());
        assert!(validate_sha256(&format!("{}g", "a".repeat(63))).is_err());
    }
}
