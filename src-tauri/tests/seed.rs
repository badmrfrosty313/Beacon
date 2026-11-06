//! SEED backup/restore (B-016/B-017/B-018): round trip into a fresh installation, repeat-import
//! safety, and rejection of corrupt, tampered, malicious and unsupported packages without
//! touching existing data. Synthetic content only.

use std::fs;
use std::path::Path;

use beacon_lib::db::migrations;
use beacon_lib::error::AppError;
use beacon_lib::research::{self, CollectionInput, ImportInput};
use beacon_lib::seed;
use beacon_lib::state::AppState;
use beacon_lib::watchtower::{
    self, ClaimInput, EventInput, HypothesisInput, LinkInput, SourceInput,
};
use beacon_lib::{documents, notes};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

struct Seeded {
    doc_original: Vec<u8>,
    research_original: Vec<u8>,
}

/// A representative synthetic library touching every table.
fn populate(state: &AppState) -> Seeded {
    let doc_original = b"# Synthetic archive page\n\nInvented text about a lighthouse.\n".to_vec();
    let research_original = b"Invented research notes about a made-up comet.\n".to_vec();
    state
        .with_db(|conn| {
            notes::create(
                conn,
                "Synthetic note",
                "See John 3:16 for the invented theme.",
            )?;
            let doc = documents::import(conn, state.data_dir(), "lighthouse.md", &doc_original)?;
            let collection = research::create_collection(
                conn,
                &CollectionInput {
                    name: "Synthetic collection".into(),
                    description: Some("Test only".into()),
                },
            )?;
            let rdoc = research::import(
                conn,
                state.data_dir(),
                &ImportInput {
                    name: "comet.txt".into(),
                    data: seed::encode_base64(&research_original),
                    collection_id: collection.id,
                    author: Some("A. Tester".into()),
                    ..Default::default()
                },
            )?;
            let event = watchtower::create_event(
                conn,
                &EventInput {
                    title: "Invented event".into(),
                    description: Some("Nothing real".into()),
                    event_date: Some("2026-03-04".into()),
                },
            )?;
            let source = watchtower::create_source(
                conn,
                &SourceInput {
                    title: "Invented source".into(),
                    author: Some("B. Writer".into()),
                    document_id: Some(doc.metadata.id),
                    ..Default::default()
                },
            )?;
            let claim = watchtower::create_claim(
                conn,
                &ClaimInput {
                    event_id: event.id,
                    source_id: Some(source.id),
                    kind: "observation".into(),
                    text: "A synthetic claim.".into(),
                    attribution: None,
                    scripture_reference: Some("John 3:16".into()),
                },
            )?;
            let hypothesis = watchtower::create_hypothesis(
                conn,
                &HypothesisInput {
                    title: "Invented hypothesis".into(),
                    statement: "A synthetic statement.".into(),
                    status: None,
                    scripture_reference: Some("Psalm 23:1".into()),
                },
            )?;
            watchtower::create_link(
                conn,
                &LinkInput {
                    hypothesis_id: hypothesis.id,
                    relation: "supports".into(),
                    claim_id: Some(claim.id),
                    explanation: "Because synthetic.".into(),
                    ..Default::default()
                },
            )?;
            research::link_source(conn, rdoc.summary.id, source.id)?;
            research::link_excerpt(conn, rdoc.summary.id, claim.id, Some("p. 1"))?;
            Ok(())
        })
        .unwrap();
    Seeded {
        doc_original,
        research_original,
    }
}

fn count(state: &AppState, table: &str) -> i64 {
    state
        .with_db(|conn| {
            Ok(conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?)
        })
        .unwrap()
}

const TABLES: [&str; 11] = [
    "notes",
    "documents",
    "research_collections",
    "research_documents",
    "watchtower_events",
    "watchtower_sources",
    "watchtower_claims",
    "watchtower_hypotheses",
    "watchtower_links",
    "research_source_links",
    "research_excerpts",
];

fn counts(state: &AppState) -> Vec<i64> {
    TABLES.iter().map(|t| count(state, t)).collect()
}

fn export(state: &AppState) -> Vec<u8> {
    let exported = state
        .with_db(|conn| seed::export(conn, state.data_dir()))
        .unwrap();
    assert!(exported.file_name.starts_with("beacon-seed-"));
    assert!(exported.file_name.ends_with(".beacon"));
    assert!(!exported.warnings.is_empty());
    let bytes = seed::decode_package(&exported.data).unwrap();
    assert_eq!(sha(&bytes), exported.package_sha256);
    bytes
}

fn restore(state: &AppState, bytes: &[u8]) -> Result<seed::Preview, AppError> {
    state.with_db(|conn| seed::restore(conn, state.data_dir(), bytes, &sha(bytes)))
}

fn inspect(state: &AppState, bytes: &[u8]) -> Result<seed::Preview, AppError> {
    state.with_db(|conn| seed::inspect(conn, bytes))
}

fn files_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// Assemble a package from raw parts, recomputing digests: used to forge hostile packages.
fn forge(manifest_patch: impl FnOnce(&mut Value), entries: Vec<(String, Vec<u8>)>) -> Vec<u8> {
    let mut manifest = json!({
        "format": "beacon-seed",
        "formatVersion": 1,
        "appVersion": "test",
        "schemaVersion": migrations::latest_version(),
        "createdAt": "2026-01-01T00:00:00Z",
        "entries": entries.iter().map(|(p, b)| json!({"path": p, "size": b.len(), "sha256": sha(b)})).collect::<Vec<_>>(),
    });
    manifest_patch(&mut manifest);
    let manifest = manifest.to_string().into_bytes();
    let mut out = b"BCNSEED1".to_vec();
    out.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
    out.extend_from_slice(&manifest);
    for (_, bytes) in &entries {
        out.extend_from_slice(bytes);
    }
    out
}

fn empty_records() -> Vec<u8> {
    let tables: serde_json::Map<String, Value> = TABLES
        .iter()
        .map(|t| ((*t).to_owned(), json!([])))
        .collect();
    json!({ "tables": tables }).to_string().into_bytes()
}

#[test]
fn round_trip_into_a_fresh_installation_preserves_everything() {
    let source_dir = tempfile::tempdir().unwrap();
    let source = AppState::initialize(source_dir.path().to_path_buf());
    let seeded = populate(&source);
    let package = export(&source);

    let target_dir = tempfile::tempdir().unwrap();
    let target = AppState::initialize(target_dir.path().to_path_buf());

    let preview = inspect(&target, &package).unwrap();
    assert_eq!(preview.format_version, 1);
    assert!(preview
        .tables
        .iter()
        .all(|t| t.total == t.added && t.existing == 0));
    assert_eq!(
        counts(&target),
        vec![0; 11],
        "inspect must not change anything"
    );

    let report = restore(&target, &package).unwrap();
    assert!(report.tables.iter().all(|t| t.total == t.added));
    assert_eq!(counts(&source), counts(&target));
    assert_eq!(counts(&target), vec![1; 11]);

    // Originals are byte-for-byte identical.
    let doc_sha = sha(&seeded.doc_original);
    let research_sha = sha(&seeded.research_original);
    assert_eq!(
        fs::read(target_dir.path().join(format!("originals/{doc_sha}.md"))).unwrap(),
        seeded.doc_original
    );
    assert_eq!(
        fs::read(
            target_dir
                .path()
                .join(format!("research_originals/{research_sha}.txt"))
        )
        .unwrap(),
        seeded.research_original
    );

    // Relationships survive remapping: the evidence link reaches the claim, event, source and
    // archived document, and the research excerpt points at the same claim.
    let joined: i64 = target
        .with_db(|conn| {
            Ok(conn.query_row(
                "SELECT count(*) FROM watchtower_links l
                 JOIN watchtower_claims c ON c.id = l.claim_id
                 JOIN watchtower_events e ON e.id = c.event_id
                 JOIN watchtower_sources s ON s.id = c.source_id
                 JOIN documents d ON d.id = s.document_id
                 JOIN research_excerpts x ON x.claim_id = c.id
                 JOIN research_source_links rl ON rl.source_id = s.id
                 JOIN research_documents r ON r.id = x.research_document_id
                 JOIN research_collections rc ON rc.id = r.collection_id
                 WHERE c.scripture_reference = 'John 3:16' AND rc.name = 'Synthetic collection'",
                [],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(joined, 1);

    // Search indexes work on restored data, and the app reads the restored originals.
    assert_eq!(
        target
            .with_db(|conn| documents::search(conn, "lighthouse"))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        target
            .with_db(|conn| research::search(conn, "comet", None))
            .unwrap()
            .len(),
        1
    );
    let id = target.with_db(documents::list).unwrap()[0].id;
    let doc = target
        .with_db(|conn| documents::get(conn, target.data_dir(), id))
        .unwrap();
    assert!(doc.body.contains("lighthouse"));

    // The restored library can itself be exported (originals present and intact).
    export(&target);
}

#[test]
fn repeated_and_same_library_imports_add_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::initialize(dir.path().to_path_buf());
    populate(&state);
    let package = export(&state);
    let before = counts(&state);

    // Restoring a library's own export into itself is a no-op.
    let preview = inspect(&state, &package).unwrap();
    assert!(preview
        .tables
        .iter()
        .all(|t| t.added == 0 && t.existing == t.total));
    let report = restore(&state, &package).unwrap();
    assert!(report.tables.iter().all(|t| t.added == 0));
    assert_eq!(counts(&state), before);

    // Same for a fresh installation restored twice.
    let other_dir = tempfile::tempdir().unwrap();
    let other = AppState::initialize(other_dir.path().to_path_buf());
    restore(&other, &package).unwrap();
    let once = counts(&other);
    let again = restore(&other, &package).unwrap();
    assert!(again.tables.iter().all(|t| t.added == 0));
    assert_eq!(counts(&other), once);
}

#[test]
fn restore_merges_into_an_existing_library_without_overwriting_it() {
    let source_dir = tempfile::tempdir().unwrap();
    let source = AppState::initialize(source_dir.path().to_path_buf());
    populate(&source);
    let package = export(&source);

    let dir = tempfile::tempdir().unwrap();
    let target = AppState::initialize(dir.path().to_path_buf());
    target
        .with_db(|conn| {
            notes::create(conn, "My own note", "Must survive.")?;
            // Same collection name (case-insensitive) already exists with different text.
            research::create_collection(
                conn,
                &CollectionInput {
                    name: "SYNTHETIC COLLECTION".into(),
                    description: Some("Local description".into()),
                },
            )?;
            Ok(())
        })
        .unwrap();
    restore(&target, &package).unwrap();

    assert_eq!(count(&target, "notes"), 2);
    assert_eq!(count(&target, "research_collections"), 1);
    let description: Option<String> = target
        .with_db(|conn| {
            Ok(
                conn.query_row("SELECT description FROM research_collections", [], |r| {
                    r.get(0)
                })?,
            )
        })
        .unwrap();
    assert_eq!(description.as_deref(), Some("Local description"));
    // The imported research document still landed in the existing collection.
    assert_eq!(count(&target, "research_documents"), 1);
}

#[test]
fn every_single_byte_flip_in_the_package_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::initialize(dir.path().to_path_buf());
    populate(&state);
    let package = export(&state);

    let victim_dir = tempfile::tempdir().unwrap();
    let victim = AppState::initialize(victim_dir.path().to_path_buf());
    victim
        .with_db(|conn| notes::create(conn, "Precious", "Keep me.").map(|_| ()))
        .unwrap();

    // Flip one byte at a spread of positions in the header and payload (records and originals).
    // The manifest's descriptive text (appVersion, createdAt, warning) is not covered by any
    // digest by design; entries, sizes and digests are, and are tested separately.
    let manifest_len = u32::from_le_bytes(package[8..12].try_into().unwrap()) as usize;
    let payload_start = 12 + manifest_len;
    let step = ((package.len() - payload_start) / 97).max(1);
    let positions = (0..12).chain((payload_start..package.len()).step_by(step));
    for position in positions {
        let mut damaged = package.clone();
        damaged[position] ^= 0x01;
        let result =
            victim.with_db(|conn| seed::restore(conn, victim.data_dir(), &damaged, &sha(&damaged)));
        if let Ok(report) = result {
            panic!("flip at {position} accepted: {report:?}");
        }
    }
    assert_eq!(count(&victim, "notes"), 1);
    assert_eq!(count(&victim, "documents"), 0);
    assert!(files_in(&victim_dir.path().join("originals")).is_empty());
}

#[test]
fn truncated_padded_and_foreign_files_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::initialize(dir.path().to_path_buf());
    populate(&state);
    let package = export(&state);
    let target = AppState::initialize(tempfile::tempdir().unwrap().path().to_path_buf());

    let mut padded = package.clone();
    padded.push(0);
    let truncated = package[..package.len() - 1].to_vec();
    for bad in [padded, truncated, Vec::new(), b"PK\x03\x04zip".to_vec()] {
        assert!(matches!(
            inspect(&target, &bad),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            restore(&target, &bad),
            Err(AppError::Validation(_))
        ));
    }
    assert_eq!(counts(&target), vec![0; 11]);
}

#[test]
fn unsupported_versions_and_malformed_manifests_are_rejected() {
    let target = AppState::initialize(tempfile::tempdir().unwrap().path().to_path_buf());
    let entries = || vec![("data/records.json".to_owned(), empty_records())];

    let ok = forge(|_| {}, entries());
    assert!(
        inspect(&target, &ok).is_ok(),
        "the forging helper must build valid packages"
    );

    let future = forge(|m| m["formatVersion"] = json!(2), entries());
    let newer_schema = forge(
        |m| m["schemaVersion"] = json!(migrations::latest_version() + 1),
        entries(),
    );
    let wrong_name = forge(|m| m["format"] = json!("something-else"), entries());
    let no_entries = forge(|m| m["entries"] = json!([]), entries());
    for bad in [future, newer_schema, wrong_name, no_entries] {
        assert!(matches!(
            inspect(&target, &bad),
            Err(AppError::Validation(_))
        ));
    }

    // A manifest that lies about a size or digest.
    let lying_size = forge(|m| m["entries"][0]["size"] = json!(1), entries());
    let lying_digest = forge(
        |m| m["entries"][0]["sha256"] = json!("0".repeat(64)),
        entries(),
    );
    for bad in [lying_size, lying_digest] {
        assert!(matches!(
            inspect(&target, &bad),
            Err(AppError::Validation(_))
        ));
    }

    // Garbage manifest JSON.
    let mut broken = b"BCNSEED1".to_vec();
    broken.extend_from_slice(&5u32.to_le_bytes());
    broken.extend_from_slice(b"{nope");
    assert!(matches!(
        inspect(&target, &broken),
        Err(AppError::Validation(_))
    ));
}

#[test]
fn malicious_paths_and_unreferenced_files_are_rejected_before_any_write() {
    let dir = tempfile::tempdir().unwrap();
    let target = AppState::initialize(dir.path().to_path_buf());
    let payload = b"owned".to_vec();
    let sha_payload = sha(&payload);
    for path in [
        "../escape.txt".to_owned(),
        "/etc/passwd".to_owned(),
        "..\\escape.txt".to_owned(),
        "originals/../../escape.md".to_owned(),
        format!("originals/{sha_payload}.exe"),
        format!("originals/{sha_payload}.md\0.txt"),
        "C:/Windows/evil.md".to_owned(),
        "data/records.json/../x".to_owned(),
    ] {
        let package = forge(
            |_| {},
            vec![
                ("data/records.json".to_owned(), empty_records()),
                (path.clone(), payload.clone()),
            ],
        );
        let result = restore(&target, &package);
        assert!(matches!(result, Err(AppError::Validation(_))), "{path:?}");
    }
    // A well-formed but unreferenced original is also refused (nothing hides in a package).
    let stray = forge(
        |_| {},
        vec![
            ("data/records.json".to_owned(), empty_records()),
            (format!("originals/{sha_payload}.md"), payload.clone()),
        ],
    );
    assert!(matches!(
        restore(&target, &stray),
        Err(AppError::Validation(_))
    ));
    // Duplicate entries.
    let duplicate = forge(
        |_| {},
        vec![
            ("data/records.json".to_owned(), empty_records()),
            ("data/records.json".to_owned(), empty_records()),
        ],
    );
    assert!(matches!(
        restore(&target, &duplicate),
        Err(AppError::Validation(_))
    ));
    assert!(!dir.path().join("escape.txt").exists());
    assert!(!dir.path().parent().unwrap().join("escape.txt").exists());
    assert!(files_in(&dir.path().join("originals")).is_empty());
}

#[test]
fn the_confirmation_digest_must_match_the_previewed_package() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::initialize(dir.path().to_path_buf());
    populate(&state);
    let package = export(&state);
    let target = AppState::initialize(tempfile::tempdir().unwrap().path().to_path_buf());
    let result =
        target.with_db(|conn| seed::restore(conn, target.data_dir(), &package, &"0".repeat(64)));
    assert!(matches!(result, Err(AppError::Validation(_))));
    assert_eq!(counts(&target), vec![0; 11]);
}

/// Records that parse and verify but break a database rule must roll the whole restore back and
/// remove any original this call wrote.
#[test]
fn a_failure_halfway_through_restore_rolls_everything_back() {
    let dir = tempfile::tempdir().unwrap();
    let target = AppState::initialize(dir.path().to_path_buf());
    target
        .with_db(|conn| notes::create(conn, "Existing", "stays").map(|_| ()))
        .unwrap();

    let original = b"Synthetic text for the rollback test.\n".to_vec();
    let digest = sha(&original);
    let mut tables: serde_json::Map<String, Value> = TABLES
        .iter()
        .map(|t| ((*t).to_owned(), json!([])))
        .collect();
    tables["documents"] = json!([{
        "id": 1, "title": "Doc", "original_name": "d.md", "format": "md", "sha256": digest,
        "byte_length": original.len(), "content": "x", "imported_at": "2026-01-01T00:00:00.000Z"
    }]);
    // Inserted after the document, violates the title CHECK (empty), so the transaction fails.
    tables["notes"] = json!([
        {"id": 1, "title": "Fine note", "body": "ok", "created_at": "2026-01-01T00:00:00.000Z"},
        {"id": 2, "title": "", "body": "bad", "created_at": "2026-01-01T00:00:00.000Z"}
    ]);
    let package = forge(
        |_| {},
        vec![
            (
                "data/records.json".to_owned(),
                json!({ "tables": tables }).to_string().into_bytes(),
            ),
            (format!("originals/{digest}.md"), original),
        ],
    );
    assert!(restore(&target, &package).is_err());
    assert_eq!(count(&target, "notes"), 1);
    assert_eq!(count(&target, "documents"), 0);
    assert!(files_in(&dir.path().join("originals")).is_empty());

    // The library still works afterwards.
    target
        .with_db(|conn| notes::create(conn, "After", "still fine").map(|_| ()))
        .unwrap();
}

#[test]
fn dangling_references_and_oversized_claims_are_rejected() {
    let target = AppState::initialize(tempfile::tempdir().unwrap().path().to_path_buf());
    let mut tables: serde_json::Map<String, Value> = TABLES
        .iter()
        .map(|t| ((*t).to_owned(), json!([])))
        .collect();
    tables["watchtower_claims"] = json!([{
        "id": 1, "event_id": 99, "source_id": null, "kind": "observation", "text": "x",
        "attribution": null, "scripture_reference": null,
        "created_at": "2026-01-01T00:00:00.000Z", "updated_at": "2026-01-01T00:00:00.000Z"
    }]);
    let dangling = forge(
        |_| {},
        vec![(
            "data/records.json".to_owned(),
            json!({ "tables": tables }).to_string().into_bytes(),
        )],
    );
    assert!(matches!(
        restore(&target, &dangling),
        Err(AppError::Validation(_))
    ));

    // A declared entry size beyond the per-file limit is refused without reading it.
    let huge = forge(
        |m| m["entries"][0]["size"] = json!(u64::MAX / 2),
        vec![("data/records.json".to_owned(), empty_records())],
    );
    assert!(matches!(
        inspect(&target, &huge),
        Err(AppError::Validation(_))
    ));
}

#[test]
fn export_refuses_when_an_archived_original_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::initialize(dir.path().to_path_buf());
    let seeded = populate(&state);
    let name = format!("originals/{}.md", sha(&seeded.doc_original));
    fs::remove_file(dir.path().join(name)).unwrap();
    let result = state.with_db(|conn| seed::export(conn, state.data_dir()));
    assert!(matches!(result, Err(AppError::Validation(_))));
}

#[test]
fn an_empty_library_exports_and_restores() {
    let dir = tempfile::tempdir().unwrap();
    let empty = AppState::initialize(dir.path().to_path_buf());
    let package = export(&empty);
    let other = AppState::initialize(tempfile::tempdir().unwrap().path().to_path_buf());
    restore(&other, &package).unwrap();
    assert_eq!(counts(&other), vec![0; 11]);
}
