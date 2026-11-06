use super::*;

#[test]
fn only_exact_content_addressed_original_paths_are_accepted() {
    let sha = "a".repeat(64);
    assert!(parse_original_path(&format!("originals/{sha}.md")).is_some());
    assert!(parse_original_path(&format!("research_originals/{sha}.pdf")).is_some());
    // PDFs are research-only.
    assert!(parse_original_path(&format!("originals/{sha}.pdf")).is_none());
    for bad in [
        "../originals/x.md".to_owned(),
        format!("originals/../{sha}.md"),
        format!("/originals/{sha}.md"),
        format!("originals\\{sha}.md"),
        format!("originals/{sha}.md/extra"),
        format!("originals/sub/{sha}.md"),
        format!("originals/{}.md", "A".repeat(64)),
        format!("originals/{}.md", "a".repeat(63)),
        format!("C:/originals/{sha}.md"),
        format!("originals/{sha}.md\0"),
        format!("elsewhere/{sha}.md"),
        String::new(),
    ] {
        assert!(parse_original_path(&bad).is_none(), "accepted {bad:?}");
    }
}

#[test]
fn base64_round_trips_through_the_shared_decoder() {
    for len in 0..40usize {
        let bytes: Vec<u8> = (0..len).map(|n| (n * 37 % 251) as u8).collect();
        let encoded = encode_base64(&bytes);
        assert_eq!(decode_package(&encoded).unwrap(), bytes);
    }
}

#[test]
fn garbage_is_rejected_without_panicking() {
    for input in [
        &b""[..],
        b"BCNSEED1",
        b"BCNSEED1\xff\xff\xff\xff",
        b"BCNSEED1\x02\x00\x00\x00{}",
        b"not a package at all",
    ] {
        assert!(matches!(parse(input), Err(AppError::Validation(_))));
    }
}

/// The same vector is asserted in src/lib/seed/format.test.ts: desktop and browser demo must
/// agree on record identity, or a package would never recognise the other platform's records.
#[test]
fn record_identity_matches_the_cross_platform_vector() {
    let mut values = Map::new();
    values.insert("title".into(), json!("T"));
    values.insert("body".into(), json!("B"));
    values.insert("created_at".into(), json!("2026-01-01T00:00:00.000Z"));
    let row = Row { id: 7, values };
    assert_eq!(
        identity(0, &row, &HashMap::new()).unwrap(),
        "ebd3675b71c2b6e8212091a463c4730966f7797e915f4c4957781072253f0d65"
    );
}
