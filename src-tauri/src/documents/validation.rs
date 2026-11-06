//! Pure (std-only) validation for imported documents.
//!
//! Everything here treats the file name and bytes as untrusted. The name is only ever used for
//! display (title, format); stored originals get hash-derived names, so a hostile name can never
//! influence a filesystem path. The frontend mirrors these rules for early feedback
//! (`src/lib/documentValidation.ts`), but this module is authoritative.

pub const MAX_DOCUMENT_BYTES: usize = 1_048_576;
pub const MAX_FILENAME_BYTES: usize = 255;
pub const MAX_TITLE_CHARS: usize = 200;

/// A user-facing reason for rejecting an import or a search.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rejection(pub &'static str);

/// Bidirectional-override/isolate and zero-width characters let a name display as something it
/// is not (`evil\u{202E}txt.exe`), so they are refused alongside ordinary control characters.
pub(crate) fn is_deceptive_display_char(ch: char) -> bool {
    matches!(
        ch,
        '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}'
    )
}

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
            "Choose a .md or .txt file with a plain filename.",
        ));
    }
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return Err(Rejection(
            "Only Markdown (.md) and text (.txt) files can be imported.",
        ));
    };
    let format = ext.to_ascii_lowercase();
    if format != "md" && format != "txt" {
        return Err(Rejection(
            "Only Markdown (.md) and text (.txt) files can be imported.",
        ));
    }
    let title = stem.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(Rejection(
            "The filename must contain a title of 1–200 characters.",
        ));
    }
    Ok((title.to_owned(), format))
}

/// Validate file contents and return the text to index and display (a leading BOM removed).
/// The original bytes are stored untouched elsewhere; this is only the decoded view.
pub fn validate_content(bytes: &[u8]) -> Result<String, Rejection> {
    if bytes.is_empty() {
        return Err(Rejection("The selected file is empty."));
    }
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(Rejection("Files must be at most 1 MiB."));
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return Err(Rejection("The selected file is not valid UTF-8 text."));
    };
    if text
        .chars()
        .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    {
        return Err(Rejection(
            "The file contains unsupported control characters.",
        ));
    }
    Ok(text.strip_prefix('\u{feff}').unwrap_or(text).to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_md_and_txt_and_derives_title_and_format() {
        assert_eq!(
            validate_filename("Field notes.md"),
            Ok(("Field notes".to_owned(), "md".to_owned()))
        );
        assert_eq!(
            validate_filename("archive.v2.TXT"),
            Ok(("archive.v2".to_owned(), "txt".to_owned()))
        );
    }

    #[test]
    fn rejects_unsafe_or_unsupported_filenames() {
        let too_long = format!("{}.md", "a".repeat(300));
        let hostile = [
            "",
            ".",
            "..",
            ".md",
            "   .txt",
            "../escape.md",
            "..\\escape.md",
            "dir/file.txt",
            r"C:\secret.txt",
            "C:file.txt",
            "evil.pdf",
            "noextension",
            "tab\there.md",
            "nul\0.md",
            "line\nbreak.txt",
            "evil\u{202E}txt.md",
            "zero\u{200B}width.md",
            too_long.as_str(),
        ];
        for name in hostile {
            assert!(validate_filename(name).is_err(), "should reject {name:?}");
        }
    }

    #[test]
    fn rejects_titles_over_200_characters() {
        let name = format!("{}.md", "a".repeat(201));
        assert!(validate_filename(&name).is_err());
        let ok = format!("{}.md", "a".repeat(200));
        assert!(validate_filename(&ok).is_ok());
    }

    #[test]
    fn accepts_text_with_line_breaks_tabs_and_unicode() {
        let text = validate_content("# Titre\r\nligne\tdeux\n日本語\n".as_bytes()).unwrap();
        assert_eq!(text, "# Titre\r\nligne\tdeux\n日本語\n");
    }

    #[test]
    fn strips_one_leading_bom_from_the_decoded_view_only() {
        assert_eq!(validate_content(b"\xEF\xBB\xBFhello").unwrap(), "hello");
    }

    #[test]
    fn rejects_empty_oversized_non_utf8_and_binary_content() {
        assert!(validate_content(b"").is_err());
        assert!(validate_content(&vec![b'a'; MAX_DOCUMENT_BYTES + 1]).is_err());
        assert!(validate_content(&vec![b'a'; MAX_DOCUMENT_BYTES]).is_ok());
        assert!(validate_content(&[0xff, 0xfe, 0x00]).is_err());
        assert!(validate_content(b"abc\0def").is_err());
        assert!(validate_content(b"bell\x07").is_err());
        assert!(validate_content("c1\u{0085}control".as_bytes()).is_err());
    }
}
