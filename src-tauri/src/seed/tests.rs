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
