# BEACON Architecture

Status: **Proposed v0.1 architecture; the Sprint 001 foundation (shell, SQLite migrations, notes demo) is implemented and CI-built/tested on Windows, but not yet manually launched or verified**. Last reviewed: 2026-11-02.

## Goals
1. Preserve and search user-owned knowledge with no network or login requirement.
2. Link claims, events and hypotheses to reviewable evidence.
3. Export a complete portable archive and restore it on another supported device.
4. Run on modest hardware (initial Windows target: 8 GB RAM laptop), with Android validation.
5. Minimize dependencies and favor robust, understandable recovery behavior.

## Non-goals for v0.1
Live web ingestion, automated geopolitical conclusions, peer-to-peer messaging, full-text indexing of arbitrary PDFs, AI agents, and emergency service dispatch.

## Proposed technology
| Layer | Choice | Rationale |
| --- | --- | --- |
| UI | React + TypeScript + Vite | Maintainable components and common web tooling |
| Shell | Tauri 2 | Desktop/mobile packaging with Rust-backed permissions |
| Core | Rust | Local file processing and application services |
| Persistence | SQLite | Zero-server, portable relational data |
| Search | SQLite FTS5 | On-device indexing of supported text |
| Content | UTF-8 Markdown/TXT plus separate original files | Human-readable archives; predictable v0.1 import |
| Validation | Rust tests, Vitest, Playwright, Android device checks | Match each layer to appropriate tests |

Install, run and test commands are in [README.md](README.md). Implementation decisions for the Sprint 001 scaffold are recorded in ADR-007 to ADR-012 in [DECISIONS.md](DECISIONS.md).

## Component boundaries
- **Archive:** import, metadata, viewing, search, tags, and document references.
- **Watchtower:** events, hypotheses, source claims, evidence relationships, review status, timelines. Research-only.
- **Seed:** export/import with manifest, versioning, hashes, validation and safe extraction.
- **Lifeline (later):** reviewed preparedness references, separated from speculative research.
- **Network (later):** integration feasibility study and local exchange; no promised mesh capability in 0.1.

### Storage model, proposed

Content originals reside under application-managed data directories, not in the frontend bundle. SQLite stores stable identifiers, searchable text, references and provenance. Use database migrations from the first implementation.

| Entity | Minimal fields |
| --- | --- |
| Document | id, title, relative content path, format, sha256, imported_at, source_id?, license_note? |
| Source | id, title, url?, author/publisher?, observed_at?, retrieved_at?, rights_note?, local_copy_document_id? |
| Event | id, title, event_date?, summary, status, created_at |
| Hypothesis | id, statement, category, status, created_at, updated_at |
| EvidenceLink | id, source_id, target_type, target_id, relationship (supports/contradicts/context), note |
| Relationship | id, from_type, from_id, to_type, to_id, relationship_type |
| ArchiveManifest | format_version, created_at, file entries with paths/byte sizes/sha256 |

These are conceptual contracts, not migration-ready SQL. Field nullability, normalized foreign keys, event-versus-report dates, and FTS sync mechanisms require implementation ADRs.

### Trust and evidence
- A source's assertion is distinct from a verified event. Store publisher/author and timestamps.
- Predictions and interpretations stay separate from observations. Evidence links are explicit and bidirectional in the UI.
- Display a warning when the original source content is not locally archived.
- When sources conflict, preserve both and make the conflict reviewable.
- Do not add automatic hypothesis probabilities until a documented calibration and evaluation method exists.

### Import rules
- For v0.1, accept UTF-8 .md and .txt, with input limits and clear errors for corrupt/oversized files.
- Copy original bytes into application-controlled storage without executing content.
- Hash originals and index normalized text; preserve original content and metadata.
- Avoid HTML interpretation unless safely sanitized; external URLs are not automatically fetched.
- Imports should be atomic or recoverable after interruption, and avoid duplicate document IDs.

### Seed archive format
- Versioned manifest plus portable document originals and metadata.
- On export, calculate per-file SHA-256 digests; on import, verify every digest and reject mismatches, invalid relative paths, decompression bombs or unsupported versions.
- Keep archive validation separate from any future digital-signature feature. Hashes alone do **not** authenticate origin.
- Export/import should be transactional where possible, with rollback or repair after interruption.

### Platform/security boundaries
- Use OS-appropriate application data directories and permission-scoped Tauri commands.
- Keep frontend access to local filesystem constrained by explicit capabilities.
- Never transmit user content by default; cloud AI support must be opt-in with clear boundaries.
- Local search, document viewing, Watchtower records and archive export must work without internet.
- Full database encryption and encrypted portable archives need a separately reviewed key-management design; **do not imply encryption currently exists**.
- Mobile packaging, import access and storage permissions must be proven on real Android hardware.

## Validation gates
1. Fresh install starts with airplane mode enabled, with no login or network error.
2. Import text, close app, reopen offline, search and open the same document.
3. Create an event, link it to a source, reopen and inspect the connection.
4. Export a Seed pack and import it to another clean installation; compare records and file hashes.
5. Alter a byte in an archive and demonstrate rejection.
6. Verify Windows and Android behavior separately, reporting unsupported features honestly.

Future decisions: [DECISIONS.md](DECISIONS.md).
