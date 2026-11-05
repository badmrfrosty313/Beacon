use super::*;
use crate::db;
use crate::watchtower::{self, ClaimInput, EventInput, SourceInput};

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(B64[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn fixture() -> (tempfile::TempDir, Connection, i64) {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open_in_memory_migrated().unwrap();
    let c = create_collection(
        &conn,
        &CollectionInput {
            name: "Synthetic research".into(),
            description: None,
        },
    )
    .unwrap();
    (dir, conn, c.id)
}

fn text_input(name: &str, body: &str, collection_id: i64) -> ImportInput {
    ImportInput {
        name: name.into(),
        data: encode(body.as_bytes()),
        collection_id,
        ..Default::default()
    }
}

fn pdf_input(collection_id: i64, bytes: &[u8], text: &str) -> ImportInput {
    ImportInput {
        name: "synthetic.pdf".into(),
        data: encode(bytes),
        collection_id,
        extracted_text: Some(text.into()),
        extraction_method: Some("pdfjs-text-layer".into()),
        page_count: Some(2),
        ..Default::default()
    }
}

const PDF: &[u8] = b"%PDF-1.4\nsynthetic fixture bytes\n%%EOF";

fn originals(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(originals_dir(dir))
        .map(|e| {
            e.flatten()
                .map(|f| f.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[test]
fn encode_helper_round_trips_through_decoder() {
    for len in 0..8usize {
        let bytes: Vec<u8> = (0..len as u8).collect();
        assert_eq!(base64::decode(&encode(&bytes), 100).unwrap(), bytes);
    }
}

#[test]
fn imports_markdown_exactly_and_keeps_original() {
    let (dir, conn, cid) = fixture();
    let body = "# Synthetic\n\nInvented line α.\n";
    let doc = import(&conn, dir.path(), &text_input("notes.md", body, cid)).unwrap();
    assert_eq!(doc.body, body);
    assert_eq!(doc.summary.format, "md");
    assert_eq!(doc.summary.extraction_method, "utf8-text");
    assert_eq!(doc.summary.title, "notes");
    assert_eq!(doc.summary.sha256, hash(body.as_bytes()));
    let stored = originals_dir(dir.path()).join(format!("{}.md", doc.summary.sha256));
    assert_eq!(fs::read(stored).unwrap(), body.as_bytes());
    let again = get(&conn, dir.path(), doc.summary.id).unwrap();
    assert_eq!(again.body, body);
}

#[test]
fn imports_pdf_with_derivative_text_and_method() {
    let (dir, conn, cid) = fixture();
    let doc = import(
        &conn,
        dir.path(),
        &pdf_input(cid, PDF, "Invented page text"),
    )
    .unwrap();
    assert_eq!(doc.summary.format, "pdf");
    assert_eq!(doc.summary.page_count, Some(2));
    assert_eq!(doc.summary.extraction_method, "pdfjs-text-layer");
    assert!(!doc.summary.text_truncated);
    assert_eq!(
        get(&conn, dir.path(), doc.summary.id).unwrap().body,
        "Invented page text"
    );
    assert_eq!(
        fs::read(originals_dir(dir.path()).join(format!("{}.pdf", doc.summary.sha256))).unwrap(),
        PDF
    );
}

#[test]
fn rejects_bad_pdfs_and_text() {
    let (dir, conn, cid) = fixture();
    let bad = [
        pdf_input(cid, b"not a pdf at all", "text"),
        pdf_input(cid, PDF, "   "),
        ImportInput {
            page_count: None,
            ..pdf_input(cid, PDF, "t")
        },
        ImportInput {
            page_count: Some(0),
            ..pdf_input(cid, PDF, "t")
        },
        ImportInput {
            extraction_method: None,
            ..pdf_input(cid, PDF, "t")
        },
        text_input("a.md", "bad \u{0}", cid),
        text_input("a.exe", "x", cid),
        text_input("../evil.md", "x", cid),
        text_input("a.md", "", cid),
        ImportInput {
            data: "***".into(),
            ..text_input("a.md", "x", cid)
        },
        text_input("a.md", "x", cid + 99),
    ];
    for input in bad {
        assert!(matches!(
            import(&conn, dir.path(), &input),
            Err(AppError::Validation(_))
        ));
    }
    assert!(originals(dir.path()).is_empty());
    assert_eq!(count(&conn, "research_documents").unwrap(), 0);
}

#[test]
fn oversized_data_is_refused_before_decoding() {
    let (dir, conn, cid) = fixture();
    let input = ImportInput {
        data: "A".repeat(v::MAX_ORIGINAL_BYTES / 3 * 4 + 8),
        ..text_input("a.md", "x", cid)
    };
    assert!(matches!(
        import(&conn, dir.path(), &input),
        Err(AppError::Validation(_))
    ));
}

#[test]
fn duplicate_import_changes_nothing_and_restores_original() {
    let (dir, conn, cid) = fixture();
    let first = import(&conn, dir.path(), &text_input("a.txt", "same bytes", cid)).unwrap();
    match import(
        &conn,
        dir.path(),
        &text_input("renamed.txt", "same bytes", cid),
    ) {
        Err(AppError::Duplicate { title, restored }) => {
            assert_eq!(title, "a");
            assert!(!restored);
        }
        other => panic!("expected duplicate, got {other:?}"),
    }
    assert_eq!(count(&conn, "research_documents").unwrap(), 1);
    let path = originals_dir(dir.path()).join(format!("{}.txt", first.summary.sha256));
    fs::remove_file(&path).unwrap();
    assert!(matches!(
        get(&conn, dir.path(), first.summary.id),
        Err(AppError::Integrity)
    ));
    assert!(matches!(
        import(&conn, dir.path(), &text_input("a.txt", "same bytes", cid)),
        Err(AppError::Duplicate { restored: true, .. })
    ));
    assert!(get(&conn, dir.path(), first.summary.id).is_ok());
}

#[test]
fn tampered_original_is_an_integrity_failure() {
    let (dir, conn, cid) = fixture();
    let doc = import(&conn, dir.path(), &text_input("a.md", "original", cid)).unwrap();
    let path = originals_dir(dir.path()).join(format!("{}.md", doc.summary.sha256));
    fs::write(&path, "tampered").unwrap();
    assert!(matches!(
        get(&conn, dir.path(), doc.summary.id),
        Err(AppError::Integrity)
    ));
}

#[test]
fn reports_duplicates_in_both_libraries() {
    let (dir, conn, cid) = fixture();
    let bytes = b"shared bytes";
    documents::import(&conn, dir.path(), "arch.md", bytes).unwrap();
    let sha = hash(bytes);
    let check = check_duplicate(&conn, &sha).unwrap();
    assert!(check.archive.is_some() && check.research.is_none());
    import(&conn, dir.path(), &text_input("r.md", "shared bytes", cid)).unwrap();
    let check = check_duplicate(&conn, &sha).unwrap();
    assert!(check.archive.is_some() && check.research.is_some());
    assert!(check_duplicate(&conn, "xyz").is_err());
}

#[test]
fn search_finds_text_and_treats_operators_as_text() {
    let (dir, conn, cid) = fixture();
    import(
        &conn,
        dir.path(),
        &text_input("a.md", "The invented comet orbit AND more", cid),
    )
    .unwrap();
    assert_eq!(search(&conn, "comet", None).unwrap().len(), 1);
    assert_eq!(search(&conn, "comet", Some(cid + 1)).unwrap().len(), 0);
    assert_eq!(search(&conn, "AND", None).unwrap().len(), 1);
    assert!(search(&conn, "   ", None).unwrap().is_empty());
    assert!(search(&conn, "\"unbalanced OR (", None).is_ok());
}

#[test]
fn metadata_update_reindexes_title_and_keeps_bytes() {
    let (dir, conn, cid) = fixture();
    let doc = import(&conn, dir.path(), &text_input("a.md", "body words", cid)).unwrap();
    let other = create_collection(
        &conn,
        &CollectionInput {
            name: "Astronomy".into(),
            description: Some("d".into()),
        },
    )
    .unwrap();
    let updated = update_metadata(
        &conn,
        doc.summary.id,
        &MetadataInput {
            collection_id: other.id,
            title: "Zebrafish ledger".into(),
            author: Some("A. Synthetic".into()),
            published_date: Some("2001-05".into()),
            rights_note: Some("private use only".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(updated.sha256, doc.summary.sha256);
    assert_eq!(updated.imported_at, doc.summary.imported_at);
    assert_eq!(updated.collection_id, other.id);
    assert_eq!(search(&conn, "zebrafish", None).unwrap().len(), 1);
    assert_eq!(search(&conn, "body", None).unwrap().len(), 1);
    let read = get(&conn, dir.path(), doc.summary.id).unwrap();
    assert_eq!(read.body, "body words");
    assert_eq!(read.rights_note.as_deref(), Some("private use only"));
    assert!(update_metadata(
        &conn,
        999,
        &MetadataInput {
            collection_id: other.id,
            title: "x".into(),
            ..Default::default()
        }
    )
    .is_err());
    assert!(update_metadata(
        &conn,
        doc.summary.id,
        &MetadataInput {
            collection_id: 999,
            title: "x".into(),
            ..Default::default()
        }
    )
    .is_err());
}

#[test]
fn collections_are_unique_case_insensitively_and_counted() {
    let (dir, conn, cid) = fixture();
    assert!(create_collection(
        &conn,
        &CollectionInput {
            name: "synthetic RESEARCH".into(),
            description: None
        }
    )
    .is_err());
    assert!(create_collection(
        &conn,
        &CollectionInput {
            name: "  ".into(),
            description: None
        }
    )
    .is_err());
    import(&conn, dir.path(), &text_input("a.md", "x1", cid)).unwrap();
    let listed = list_collections(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].document_count, 1);
}

#[test]
fn everything_is_private_in_the_data() {
    let (dir, conn, cid) = fixture();
    let doc = import(&conn, dir.path(), &text_input("a.md", "x", cid)).unwrap();
    let vis: String = conn
        .query_row(
            "SELECT visibility FROM research_documents WHERE id = ?1",
            params![doc.summary.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(vis, "private");
    assert!(conn
        .execute("UPDATE research_documents SET visibility = 'public'", [])
        .is_err());
}

fn source_and_claim(conn: &Connection, with_source: Option<i64>) -> (i64, i64) {
    let event = watchtower::create_event(
        conn,
        &EventInput {
            title: "Synthetic event".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let source = watchtower::create_source(
        conn,
        &SourceInput {
            title: "Synthetic source".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let claim = watchtower::create_claim(
        conn,
        &ClaimInput {
            event_id: event.id,
            source_id: Some(with_source.unwrap_or(source.id)),
            kind: "interpretation".into(),
            text: "Invented excerpt".into(),
            ..Default::default()
        },
    )
    .unwrap();
    (source.id, claim.id)
}

#[test]
fn mapping_links_follow_the_rules() {
    let (dir, conn, cid) = fixture();
    let doc = import(&conn, dir.path(), &text_input("a.md", "x", cid)).unwrap();
    let other = import(&conn, dir.path(), &text_input("b.md", "y", cid)).unwrap();
    let (source_id, claim_id) = source_and_claim(&conn, None);
    // Excerpt before the source is linked is refused.
    assert!(link_excerpt(&conn, doc.summary.id, claim_id, None).is_err());
    let l1 = link_source(&conn, doc.summary.id, source_id).unwrap();
    let l2 = link_source(&conn, doc.summary.id, source_id).unwrap();
    assert_eq!(l1.id, l2.id);
    assert!(link_source(&conn, 999, source_id).is_err());
    assert!(link_source(&conn, doc.summary.id, 999).is_err());
    // A different document cannot claim the excerpt.
    assert!(link_excerpt(&conn, other.summary.id, claim_id, None).is_err());
    assert!(link_excerpt(&conn, doc.summary.id, claim_id, Some(""))
        .unwrap()
        .location
        .is_none());
    assert!(link_excerpt(&conn, doc.summary.id, claim_id, Some("p. 2")).is_err());
    let all = links(&conn).unwrap();
    assert_eq!((all.source_links.len(), all.excerpts.len()), (1, 1));
    // Linked documents cannot be orphaned.
    assert!(conn
        .execute(
            "DELETE FROM research_documents WHERE id = ?1",
            params![doc.summary.id]
        )
        .is_err());
}

#[test]
fn excerpt_location_is_validated() {
    let (dir, conn, cid) = fixture();
    let doc = import(&conn, dir.path(), &text_input("a.md", "x", cid)).unwrap();
    let (source_id, claim_id) = source_and_claim(&conn, None);
    link_source(&conn, doc.summary.id, source_id).unwrap();
    assert!(link_excerpt(&conn, doc.summary.id, claim_id, Some(&"x".repeat(101))).is_err());
    let e = link_excerpt(&conn, doc.summary.id, claim_id, Some("page 3")).unwrap();
    assert_eq!(e.location.as_deref(), Some("page 3"));
}

#[test]
fn sweep_removes_only_temp_files() {
    let dir = tempfile::tempdir().unwrap();
    let od = originals_dir(dir.path());
    fs::create_dir_all(&od).unwrap();
    fs::write(od.join("half.tmp"), "x").unwrap();
    fs::write(od.join("keep.md"), "x").unwrap();
    assert_eq!(sweep_stale_temp_files(dir.path(), Duration::ZERO), 1);
    assert_eq!(originals(dir.path()), vec!["keep.md".to_owned()]);
}
