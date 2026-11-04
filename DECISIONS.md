# Architecture Decision Log (ADRs)

Last reviewed: 2026-11-02.

Each decision records its status, rationale and tradeoffs. A **proposed** choice should not be described as implemented.

## ADR-001: Offline-first product
**Status:** Accepted (design decision).

Core archive, research records and portable export/import must not require connectivity, remote authentication or hosted AI. Future online enrichment is opt-in and additive.

**Tradeoffs:** Limited live information; explicit update/backup processes are needed.

## ADR-002: Proposed application stack
**Status:** Accepted as planned direction. A scaffold following it is implemented in the Sprint 001 pull request, and has been built and automatically tested on a Windows CI runner but **not manually launched** (see TASKS.md).

Use Tauri 2, React/TypeScript/Vite, Rust, and SQLite with FTS5. Optimize for a modest Windows laptop, and verify mobile rather than presuming feature parity.

**Tradeoffs:** Rust/Tauri integration complexity and mobile permission differences.

## ADR-003: Originals are not solely in SQLite
**Status:** Accepted (design decision).

Keep original user documents in an application-controlled, exportable file store and index their text/provenance in SQLite.

**Tradeoffs:** Need consistency, deduplication and backup coordination.

## ADR-004: Evidence is distinct from interpretation
**Status:** Accepted (design decision).

The Watchtower models events, sources, attributed claims, hypotheses and evidence links separately. Biblical interpretation and geopolitical forecasting belong to an optional research domain, not practical emergency instructions.

**Tradeoffs:** More explicit modeling and manual review, less automated certainty.

## ADR-005: Pack integrity versus authenticity
**Status:** Accepted (design decision).

The first portable archive design will include a versioned manifest and SHA-256 checks for files. This detects mismatches against a trusted manifest; it does not verify authorship or protect a manifest from substitution. Authenticated signatures require a separate key-management proposal and review.

## ADR-006: One repository, independent code agents
**Status:** Accepted (collaboration process).

Claude and Codex may implement on separate branches. README, ARCHITECTURE, ROADMAP, TASKS, and this log remain the shared state. Review and test changes before merging. Do not use chat memory as the only artifact of a decision.

## ADR-007: Sprint 001 project layout and tooling
**Status:** Accepted (implemented; builds and tests pass in Windows CI)
**Date:** 2026-11-02

**Context:** ADR-002 fixes the stack but not the repository layout, package manager or quality gates. Sprint 001 needs a runnable scaffold and checks that CI can run unchanged.

**Decision:**
- npm as the only package manager; one `tsconfig.json` (strict, `noUncheckedIndexedAccess`); Vite and Vitest share `vite.config.ts`; ESLint 9 flat config; Prettier for code and config (Markdown is excluded so existing prose docs are not reflowed).
- Rust package `beacon` with a library crate `beacon_lib` (`staticlib`, `cdylib`, `rlib`) and a thin `main.rs` that calls `beacon_lib::run()`. `run()` carries Tauri's mobile entry-point attribute so the same code can be packaged for Android later.
- Windows is the only CI target (`windows-latest`); only GitHub-owned actions are used.
- All checks are exposed as npm scripts (`check`, `check:rust`, `check:all`) so documentation and CI cannot drift apart.

**Alternatives:** pnpm/yarn (extra tool for no gain); a binary-only crate (blocks the Tauri mobile entry point); a Linux CI job (needs WebKitGTK system packages and tests a platform that is not the first target).

**Consequences:** Dependency versions were chosen as caret ranges from memory because the authoring environment could not reach the registries, and no lockfiles exist yet. The first networked install may need version adjustments; commit `package-lock.json` and `Cargo.lock` immediately afterwards and move CI to `npm ci`.

## ADR-008: SQLite through rusqlite with SQL-file migrations
**Status:** Accepted (implemented; Rust build and tests pass in Windows CI)
**Date:** 2026-11-02

**Context:** B-002 requires an OS-appropriate database location, a migration runner, a minimal versioned schema and safe error handling.

**Decision:**
- `rusqlite` with the `bundled` feature, so every platform (including Android) uses the same SQLite build and FTS5 will be available in Sprint 002.
- Migrations are plain `.sql` files in `src-tauri/migrations/`, embedded with `include_str!`. Applied versions are recorded in `schema_migrations (version, name, applied_at)`.
- Each migration and its bookkeeping row commit in a single transaction, so a failing migration leaves the database exactly as before. Migrations are forward-only and must not contain `BEGIN`/`COMMIT`.
- A database whose recorded version is newer than the build knows about is **refused**, never opened, to prevent an older BEACON from damaging data written by a newer one.
- Connection pragmas: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. One connection behind a `Mutex`.
- The database file name is a constant (`beacon.db`) inside Tauri's `app_data_dir()`; no user input builds a path.

**Alternatives:** `sqlx` (async, heavier, wants compile-time database access); `diesel` (ORM weight); `tauri-plugin-sql` (puts SQL access in the frontend, which breaks the command-only capability boundary in ADR-010); `PRAGMA user_version` alone (no audit trail of what ran and when).

**Consequences:** Simple and portable. A single connection is adequate for Sprint 001; revisit when bulk import and FTS indexing arrive. This implements the migration part of OD-001; the document schema and FTS update strategy remain open.

## ADR-009: Plain-text notes as the Sprint 001 demo record
**Status:** Accepted (implemented; Rust build and tests pass in Windows CI)
**Date:** 2026-11-02

**Context:** B-004 asks for a persistent demo note or document-metadata record, without pre-empting the Archive `Document` model that Sprint 002 will design (OD-002).

**Decision:** Table `notes (id, title, body, created_at)`. Plain text only: nothing interprets Markdown or HTML, and the UI renders note text as a text node. Title is trimmed, 1 to 200 characters, no control characters. Body is at most 100,000 UTF-8 bytes; control characters other than `\n`, `\r` and `\t` (including NUL) are rejected. Listing returns summaries (no body), newest first, capped at 1,000. Validation is authoritative in a dependency-free Rust module, mirrored in TypeScript for immediate feedback, and backed by SQL `CHECK` constraints as defence in depth. All SQL uses bound parameters.

**Alternatives:** storing documents now (scope creep into Sprint 002); Markdown rendering (needs a sanitization design first).

**Consequences:** The limits live in three places (Rust constants, SQL `CHECK`, TypeScript constants). Changing one requires changing all and adding a migration for the `CHECK`. The notes table is a demo and may be migrated into, or retired in favour of, the Document model in Sprint 002. No edit or delete exists yet.

## ADR-010: Frontend/backend boundary
**Status:** Accepted (implemented; builds in Windows CI)
**Date:** 2026-11-02

**Context:** The task requires frontend components to be separate from database operations, and SECURITY.md requires least-privilege IPC.

**Decision:** Components depend only on a `BeaconApi` interface supplied through React context. `createTauriApi` is the single place that calls `invoke`. The Rust side exposes four commands (`app_info`, `create_note`, `list_notes`, `get_note`), the only IPC surface. Errors cross as `{ code, message }`; database, filesystem and migration failures carry generic, user-safe messages so SQL text, file paths and user content never reach the UI or logs. The main window capability grants `core:default` only: no filesystem, shell, HTTP or opener permissions.

**Alternatives:** components calling `invoke` directly (untestable without mocking Tauri internals); `tauri-plugin-sql` or `tauri-plugin-fs` (broader frontend authority).

**Consequences:** Easy to test with an in-memory fake. Command names and argument keys are duplicated between Rust and `tauriApi.ts`; TypeScript tests pin the names, but there is no automated cross-language contract test, so a Rust-side rename would only be caught at runtime. A generated-bindings approach is a candidate follow-up.

## ADR-011: Layered offline enforcement
**Status:** Accepted (guard passes in Vitest in Windows CI; manual airplane-mode procedure not yet performed)
**Date:** 2026-11-02

**Context:** ADR-001 and B-003 require that the first launch and navigation need no network or authentication, with a reproducible test.

**Decision:** Defence in layers: (1) no networking dependencies and no Tauri plugins, enforced by an allowlist test over `Cargo.toml` and `package.json`; (2) a strict production CSP whose `connect-src` is limited to Tauri IPC; (3) a capability file that grants only `core:` permissions; (4) ESLint bans `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon` in application code; (5) a runtime test proving the UI never calls those APIs; (6) a documented manual airplane-mode procedure (`docs/OFFLINE-VERIFICATION.md`). Bundled fonts or other remote assets are not used; the UI uses system fonts.

**Alternatives:** relying on manual testing only (regressions go unnoticed); OS-level firewall tests in CI (high cost for Sprint 001).

**Consequences:** Adding any plugin, crate or permission is a deliberate, reviewed act that requires updating the guard. The static checks cannot observe traffic from the OS, the WebView2 runtime or an installer, which is why the manual procedure remains required.

## ADR-012: A failed database start does not abort the application
**Status:** Accepted (implemented; Rust build and tests pass in Windows CI)
**Date:** 2026-11-02

**Context:** A release build on Windows is a GUI-subsystem process: if startup panics or returns an error, the user sees nothing at all.

**Decision:** `AppState::initialize` never panics or fails. If the data directory or database cannot be opened or migrated, the reason is stored and returned as an `unavailable` error by every data command and in `app_info`, and the Settings and Archive screens show it. A database from a newer BEACON is refused and left untouched.

**Alternatives:** panic or fail `setup` (silent failure on Windows); automatically recreating the database (risks destroying data).

**Consequences:** The user gets an explanation instead of a blank or vanished window. BEACON does not attempt repair, backup or recovery; that is future work and must not delete or overwrite an unreadable database automatically.

## ADR-013: Document import, originals and FTS5 (Sprint 002)
**Status:** Accepted (implemented in the Sprint 002 PR; see TASKS.md for what CI and the owner have verified)
**Date:** 2026-11-03

**Context:** B-006 to B-008 need a document library that preserves untrusted files exactly, finds them offline, and survives a restart, without adding network capability or weakening ADR-003 (originals are not solely in SQLite).

**Decision:**
- **Originals on disk, content-addressed.** Each import is written once, unmodified, to `<app data>/originals/<sha256>.<md|txt>`. The user's file name is never part of a path; it is stored only as display metadata (`original_name`, `title`), so path traversal through a name is structurally impossible. Names are additionally validated (plain name, no separators, controls, bidi/zero-width characters, 255 bytes).
- **SQLite holds metadata plus a decoded text copy** (`documents.content`, migration 0002) that an external-content FTS5 table indexes via an insert trigger. Reading a document re-reads the original from disk and re-verifies length and SHA-256; a mismatch or a missing file returns an `integrity` error rather than text.
- **Write order and recovery.** Stage to a temporary file, flush, atomically rename into place, then insert the row (the FTS update rides the same SQLite transaction). If the insert fails, its verified original is deliberately retained because another BEACON process may have committed a row referencing it before the failed insert. A failed insert or a crash between the two steps can leave an orphan original, which is safer than risking cross-process data loss and is reused or atomically replaced on the next import of the same bytes. Re-importing identical bytes when the archived original is missing or damaged restores it (the new bytes are verified to hash to the recorded SHA-256). Stale `*.tmp` files older than 5 minutes are removed at startup. Directory-level fsync is not performed (documented limitation).
- **Duplicates** are detected by SHA-256 (unique column). A duplicate import changes nothing and is reported with the existing title.
- **Limits:** 1 MiB, UTF-8 only, control characters (other than `\n \r \t`) rejected, empty files rejected, `.md`/`.txt` only. Markdown is shown as source text, never rendered, so there is no HTML or script path at all.
- **Search input is never FTS5 syntax.** The query is parsed into words and quoted phrases; each becomes one FTS5 string literal and they are ANDed. `OR`, `NOT`, `NEAR`, `*`, `^`, `col:` and parentheses are therefore ordinary text. The expression is bound as a parameter, length-limited (200 chars, 8 terms), results are capped at 100, and snippets mark matches with control characters that cannot occur in imported text; the UI turns them into `<mark>` text nodes.
- **File picker without a plugin.** The UI uses a standard `<input type="file">` and `FileReader`; the bytes cross IPC as an array (at most 1 MiB, so JSON overhead is acceptable). This avoids adding the Tauri dialog/fs plugins and their permissions, preserving ADR-011 (no plugins, core-only capability).
- **Browser demo parity, clearly labeled.** The hosted demo implements the same `BeaconApi` over IndexedDB (database version 2 adds a `documents` store; existing notes are untouched by the upgrade). Its search is a simple accent- and case-insensitive word scan and is **not** FTS5; the UI says so beside the search box, and the native app never falls back to it. A pure-TypeScript SHA-256 (checked against Node's crypto) is used so the demo does not depend on `crypto.subtle`.

**Alternatives:** storing originals as SQLite BLOBs only (violates ADR-003, harder to recover); using the user's file name on disk (path-handling risk); passing raw user text to `MATCH` (operator injection and syntax errors); Tauri dialog/fs plugins (new permissions); rendering Markdown (needs a sanitizer; out of scope).

**Consequences:** A new dependency, `sha2` (pure Rust, no networking), was added to the allowlist test. Documents cannot yet be deleted or exported (Seed, Sprint 006), so imported originals and rows accumulate. Two app instances may still race on the same data directory (no single-instance guard; SQLite serialises the row insert and unique hash), but a failed import never unlinks a content-addressed original that another committed row might reference. Unreferenced originals may accumulate after failures; safe garbage collection requires explicit coordination and is deferred. Content hashing detects accidental or local tampering relative to the stored SHA-256; it does not authenticate who wrote a file (ADR-005).

## ADR-014: Scripture text: licensing, packaging and reference model (Sprint 003)
**Status:** Accepted (implemented in the Sprint 003 PR; see TASKS.md for what has and has not been verified)
**Date:** 2026-11-04

**Context:** B-009/B-010 need a Bible that can be redistributed in a public repository, works offline from a cold start, and can later coexist with other translations and canons. CLAUDE.md forbids bundling text whose license is unverified.

**Decision:**
- **Source and license.** The World English Bible, Protestant edition (`engwebp`), from the official eBible.org USFM archive (`https://eBible.org/Scriptures/engwebp_usfm.zip`, 2020 stable text, files dated 2026-10-30, retrieved 2026-11-04). The archive's own `copr.htm` states the text is Public Domain and that the name "World English Bible" is a trademark of eBible.org: if the text is changed the result must not be called the WEB. BEACON packages the words unchanged and records both statements. The ZIP (SHA-256 `a93df5571009fed56f77e3ac1d3ce71c9a3a3df1486f7570cc7a8f823192fdba`) and `copr.htm` are committed unmodified. A SHA-256 manifest inside the archive covers 70 files and all matched; the embedded PGP signature verified against the key shipped in the same archive. That key is not anchored in any independent trust root, so this establishes consistency, not authorship. BEACON makes no signed-distribution claim.
- **Packaged format.** Verses are generated by `scripts/scripture/build-web.mjs` into `data/scripture/engwebp.tsv` (one `V`/`D` row per verse/superscription), with `engwebp.meta.txt` (provenance, 70 source-file hashes, totals, the hash of the TSV) and `canon-protestant66.txt` (book order, citation names, aliases). `--check` rebuilds in memory and fails on any difference. The parser rejects unknown markers rather than guessing.
- **Content kept and excluded.** Kept: verse text, poetry line breaks within a verse, Psalm titles (stored separately from numbered verses), typographic punctuation. Excluded: Strong's numbers, footnotes, cross-references, section headings, glossary. Five verses (Luke 17:36, Acts 8:37, 15:34, 24:7, Romans 16:25) are footnote-only in this edition; they stay empty and the reader says so. No text is invented or merged.
- **Runtime verification.** Both the Rust and TypeScript loaders refuse the dataset unless its SHA-256, 66/1,189/31,103 totals, order and verse contiguity match the recorded values, so a partial or altered Bible cannot pass as complete.
- **Data model.** `scripture_canons`, `scripture_books`, `scripture_translations`, `scripture_chapters`, `scripture_verses` (migration 0003), keyed by translation so other translations/canons can be added. Rows are inserted in one transaction, the translation row last, after which triggers block UPDATE/DELETE everywhere and INSERT into a sealed translation. Scripture lives apart from the editable `notes`/`documents` tables, which the migration does not touch. Failure to install is non-fatal (`scripture_unavailable`): notes and documents keep working.
- **References.** One grammar (`Book`, `Book C`, `C:V`, `C:V-V2`, `C:V-C2:V2`, `C-C2`), ASCII-only input, 100-character and 500-verse limits, aliases validated unique at build time. Rust and TypeScript parsers are both tested against `data/scripture/reference-vectors.json`. Canonical forms are re-parseable.
- **Notes.** "Create note from reference" prefills an ordinary note whose first line is `Scripture reference: <canonical> (WEB)`. No schema change: the reference is plain text the user can edit, and the note shows "Open … in Scripture" links parsed from it. Scripture text is not copied into notes and no commentary is generated.
- **Browser demo.** The same files are imported with `?raw` in a lazy chunk (same origin, no service worker), verified on load, and dropped from the desktop bundle by a build-mode guard; CI checks both. IndexedDB is unchanged.

**Alternatives:** shipping the source USFM (heavier, needs a runtime parser); a copyrighted translation (license risk); runtime download (violates offline-first); storing references in a new column (schema change for no benefit now).

**Consequences:** About 4.4 MB of text is embedded in the executable and served by the demo. Footnotes and Strong's data are not available until a later, deliberate decision. Adding a translation means a new build script run and a new row set, not a schema change. Resolves OD-004 for this translation; other sources need their own review.

## Open decisions
- **OD-001:** Final SQLite schema beyond the Sprint 001 notes table, and the FTS update strategy. (The migration mechanism itself is decided in ADR-008.)
- **OD-002:** Exact document file layout, IDs, duplicate-detection behavior and storage limits.
- **OD-003:** Archive container format, version migration and import transaction semantics.
- **OD-004:** Safe Bible/source licensing and packaging model. (Decided for the WEB in ADR-014; any other translation needs its own review.)
- **OD-005:** Android file import/export UX and permission handling.
- **OD-006:** Whether private at-rest encryption is feasible in v0.1 or deferred with explicit limitations.

### New ADR template
```md
## ADR-00X: Title
**Status:** Proposed | Accepted | Superseded
**Date:** YYYY-MM-DD

**Context:** Problem and constraints.
**Decision:** Specific choice.
**Alternatives:** What was considered.
**Consequences:** Benefits, costs, risks.
```
