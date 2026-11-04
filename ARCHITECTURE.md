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
- **Network / private messages (future):** transport-independent, opt-in, end-to-end encrypted person-to-person messaging, with a prioritized feasibility and threat-model spike. No active messaging implementation, security guarantee, or mesh coverage promise in v0.1. See [docs/NETWORK-MESSAGING.md](docs/NETWORK-MESSAGING.md).

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

## High-priority research track: offline-capable private messaging

**Status:** Proposed design, **not implemented**. Product owner priority: investigate ASAP without blocking completion, review, or acceptance of Sprint 003. Network delivery is independent of core offline Archive/Scripture/Watchtower behavior.

**Goal:** Two people with separate BEACON installations can exchange private messages with no BEACON account or central messaging server. Connectivity may be direct local Wi-Fi/LAN, Bluetooth if platform APIs permit, an offline file/USB transfer, or a later store-and-forward transport. Internet access must **not be a requirement**, but a message still needs an actual physical/data path between sender and recipient; disconnected devices cannot receive instantly.

**Architecture boundaries:**
- **Identity and trust:** Each installation has locally generated messaging identity keys. Public-key fingerprints or QR pairing support out-of-band verification. Never silently trust an unverified key or upload a contact list. Define backup, loss, recovery and key rotation policies before deployment.
- **End-to-end security:** Choose established, independently scrutinized cryptographic protocols/libraries and vetted serialization. Do **not** invent encryption, a key exchange, ratchet, anonymous routing, or a new messaging protocol. Maintain confidentiality, integrity, authenticated peers, replay defenses and forward-secrecy requirements in a threat model. No cryptographic guarantees are claimed until implementation and review.
- **Transport independence:** Encryption and message validation sit above interchangeable transports. Begin with signed/encrypted envelope exchange through local files or LAN in a prototype; separately evaluate Android Bluetooth/Wi-Fi and Windows support. A transport adapter cannot decrypt messages or silently change recipient identity.
- **Delayed delivery:** Queued encrypted envelopes may be forwarded by relays that cannot read message bodies. Specify expiration, deduplication, replay prevention, bounded queues and storage, deletion, acknowledgments and failure UX before deploying store-and-forward. No guarantee of delivery time, ordering, anonymity, or reachability.
- **External radio:** Evaluate interoperability with existing projects (e.g., Meshtastic/LoRa) only after checking their actual protocol security, device compatibility, licensing, payload limits, radio regulations and Android/Windows integration. Do not describe hypothetical radio routing as implemented.
- **Private data separation:** Messaging key material, private conversations and contacts are local user data. Never package them into public releases, publisher Dispatch content, public knowledge packs or default diagnostics. Seed backup/export of keys or messages requires separate, explicit threat-reviewed consent and secure recovery design.
- **User control:** Explicit peer pairing, sender verification, blocking, deletion and opt-in transport discovery. Do not advertise undelivered messages as sent. Indicate offline, queued, relayed and delivered states accurately.
- **Security limits:** End-to-end encryption does not conceal all metadata or protect a compromised/unlocked endpoint. Bluetooth/LAN proximity and radio activity may expose device presence. Threat model covers spoofing, key substitution, device loss, replay, message flooding, relay abuse and metadata leakage.

**First deliverable:** A small, separate, non-production feasibility/spike document and prototype plan covering a realistic Windows-to-Android path, platform limitations, public-key verification, transport choices, a reviewable threat model and acceptance tests. Do not ship a chat UI or security promises until the spike's design gates pass.

**Release guard:** V0.1 remains fully useful without Network. No networking permissions, dependencies, telemetry or runtime services should be added to v0.1 merely for this proposal. An explicit ADR, security review, dependency/permission review and real-device verification are required before accepting network capability.

More detail: [docs/NETWORK-MESSAGING.md](docs/NETWORK-MESSAGING.md).

## Validation gates
1. Fresh install starts with airplane mode enabled, with no login or network error.
2. Import text, close app, reopen offline, search and open the same document.
3. Create an event, link it to a source, reopen and inspect the connection.
4. Export a Seed pack and import it to another clean installation; compare records and file hashes.
5. Alter a byte in an archive and demonstrate rejection.
6. Verify Windows and Android behavior separately, reporting unsupported features honestly.

Future decisions: [DECISIONS.md](DECISIONS.md).
