# BEACON Task Queue

Updated: 2026-11-02. Unchecked work is not implemented. Code agents should update this file on completion and link their PR or commit.

## Sprint 001: First Light Foundation
**Objective:** Launch a working offline Windows app that can persist a simple record. Prefer a thin vertical slice over an elaborate scaffold.

> **Sprint 001 status (2026-11-02): Windows launch and saved-note restart persistence MANUALLY CONFIRMED by the owner.** Both [Sprint 001 PR #1](https://github.com/badmrfrosty313/Beacon/pull/1) and [browser harness PR #3](https://github.com/badmrfrosty313/Beacon/pull/3) are merged. The owner ran the unsigned native executable from [successful Windows CI run 41550072221](https://github.com/badmrfrosty313/Beacon/actions/runs/41550072221) (commit `a5f0766`) and reported that the application works and a saved note survives restarting it. The hosted browser demo also passed owner-confirmed create/save/reload persistence. **Not explicitly confirmed:** the manual disconnected-network / airplane-mode test, a clean app-data-folder cold start, and specific validation/navigation checks. Do not treat those as passed until separately reported.

- [x] **B-001: Scaffold project.** Tauri 2 + Vite/React + TypeScript + Rust.
  - Windows CI builds the native release binary; owner confirmed the downloaded executable opens as a desktop app. `tauri dev` itself was not separately tested by the owner.
- [x] **B-002: Initialize SQLite.** OS-appropriate app-data directory, migration runner, versioned schema and error handling.
  - Automated Rust migration/persistence tests passed (35 unit + 4 integration). User-confirmed native note persistence indicates working database storage. Exact displayed app-data folder and clean first-launch migration remain unobserved.
- [ ] **B-003: Offline smoke test.** No required network or authentication on initial launch, navigation or note save.
  - Static/jsdom offline tests pass, but owner has **not explicitly confirmed disconnecting from the network** for the native test. Complete [docs/OFFLINE-VERIFICATION.md](docs/OFFLINE-VERIFICATION.md) to close this gate.
- [x] **B-004: Basic persistent record.** Create/list and reopen a local note via Tauri IPC and SQLite.
  - Owner confirmed save and persistence after restarting the native Windows app downloaded from CI; validation/failure behavior additionally covered by automated tests. This is distinct from browser IndexedDB testing.
- [x] **B-005: Foundation quality gates.** Formatting, linting, TypeScript, frontend tests, Rust tests and Windows binary compile.
  - [Windows CI run 41550072221](https://github.com/badmrfrosty313/Beacon/actions/runs/41550072221) passed and published a test EXE plus SHA-256 checksum. **Follow-up:** package/Cargo lockfiles are not yet committed and CI still uses `npm install` rather than `npm ci`.

### Sprint 001 follow-ups
1. **Confirm the native airplane-mode test** on Windows and record its result in [docs/OFFLINE-VERIFICATION.md](docs/OFFLINE-VERIFICATION.md). This is the last major hands-on Week 1 gate, not implied by a successful online launch.
2. Commit `package-lock.json` and `src-tauri/Cargo.lock`, then switch CI to `npm ci` for reproducible dependency resolution.
3. Document a clean app-data-folder first launch and the schema/version shown in native Settings.
4. Consider a cross-language IPC contract test (ADR-010).
5. Update GitHub-owned Node 20 actions to v5 when confirmed.

## Sprint 002: Archive
> **Sprint 002 status: implemented; previous CI green on `235002a`. Codex's two P2 findings have code fixes on `2340c3b` (150 frontend tests, 71 unit + 8 integration Rust tests passed); a final formatting-only adjustment and fully green CI are pending. Manual acceptance remains pending.** [CI run 41704038453](https://github.com/badmrfrosty313/Beacon/actions/runs/41704038453) (Windows) and [Browser Demo run 41704038425](https://github.com/badmrfrosty313/Beacon/actions/runs/41704038425) passed: Prettier, ESLint, `tsc`, Vitest (148 tests in 9 files, using a fake backend and fake-indexeddb), `cargo fmt`, `cargo test` (70 unit + 4 + 4 integration, covering restart persistence, v1→v2 migration keeping notes, tamper detection/repair), `clippy -D warnings`, and the Windows release build. **Nobody has launched this build or used the file picker, FTS5 search or reader by hand.** Boxes stay unchecked until the owner has performed the native Windows and hosted-browser acceptance tests (steps in README.md and docs/BROWSER-DEMO.md). The two earlier commits on this branch (`84762ed`, `9280aea`) were reviewed critically and substantially reworked; see ADR-013.

- [ ] **B-006:** Import bounded UTF-8 .md and .txt as untrusted files; preserve originals and SHA-256 hashes.
  - Implemented: file picker (`<input type=file>`, no plugin), 1 MiB / UTF-8 / control-character / filename validation, exact original bytes under `originals/<sha256>.<ext>`, duplicate detection by hash, atomic write + safe orphan retention on failed inserts + restore-on-reimport + stale-temp sweep. A deterministic two-connection regression proves losing an insert race cannot delete a committed original.
- [ ] **B-007:** Index text with SQLite FTS5; search by phrase and display a result snippet.
  - Implemented: migration 0002 (external-content FTS5 + trigger), safe query parser (all input becomes literal terms/phrases), parameter-bound, 100-result cap, highlighted snippets rendered as text.
- [ ] **B-008:** Read originals, retain metadata, show import errors, and survive close/reopen.
  - Implemented: reader re-verifies the stored original's SHA-256 on every open; shows file name, format, size, time, fingerprint; per-file import errors; failed readers refresh after re-import/repair and offer manual Retry; Rust restart tests reopen the database and originals.
- [ ] **Browser demo (IndexedDB) parity:** import/list/read/search with a clearly labeled non-FTS5 word search; existing notes preserved by an in-place v1→v2 schema upgrade.

## Sprint 003: Scripture Navigation
> **Sprint 003 status: implemented on `feature/sprint-003-scripture` (PR #5, draft); automated CI green on `ae7e036`; manual acceptance pending.** CI (Windows `ci.yml` and Ubuntu `browser-demo.yml`) passed: Prettier, ESLint, `tsc`, Vitest, `npm run scripture:verify` (rebuild from the pinned official ZIP), `cargo fmt`, `cargo test` (102 unit + integration, including complete-dataset install, v2→v3 upgrade keeping notes, tamper rejection), `clippy -D warnings`, the Windows release build, the desktop-bundle-has-no-Scripture check and the demo build. The first Windows run caught a borrow error in a Rust test and a stale schema-version assertion; both were fixed. Codex's P2 finding (stale reference reopened after leaving Scripture) was fixed with a regression test. **Nobody has launched the app or done the Revelation 13:18 workflow, close/reopen or airplane-mode checks by hand**; the Android real-device check is Sprint 007.

- [ ] **B-009:** Select a legally distributable content source and document its license.
  - Implemented: World English Bible, Protestant edition (`engwebp`, 66 books, 1,189 chapters, 31,103 verses) from the official eBible.org USFM ZIP (SHA-256 `a93df557…fdba`, 2,908,558 bytes, kept unmodified in `data/scripture/source/`). Public-domain and trademark terms recorded from the archive's own `copr.htm`; 70/70 manifest entries and the PGP signature were verified (key not trust-anchored; see ADR-014). `scripts/scripture/build-web.mjs` regenerates the packaged files and `--check` compares them with the committed copies. Five verses are footnote-only in the source and are kept empty and labelled, never filled in. Strong's numbers, footnotes, cross-references and headings are excluded. See ADR-014.
- [ ] **B-010:** Offline book/chapter/verse lookup and references into user notes.
  - Implemented: Scripture module (book/chapter pickers, verse-by-verse reader, previous/next across book boundaries, reference lookup with aliases and ranges, copyable canonical references, verse/range selection), migration 0003 (read-only, sealed Scripture tables; notes and documents untouched), Rust and TypeScript parsers tested against one shared vector file, "Create note from reference", and note → passage links. Browser demo serves the same data from a lazily loaded local chunk.
  - Open: native Windows acceptance (Revelation 13:18 workflow, close/reopen, airplane mode), hosted-demo acceptance, Android real-device check (Sprint 007).

## Sprint 004: Watchtower
> **Sprint 004 status: implemented on `feature/sprint-004-watchtower` (draft PR); CI results and the manual checks below are recorded only after they have actually run.** Nothing here has been launched or tried by a person. Verification is labelled below as **CI-verified** (a named GitHub Actions run), **locally verified** (run in the author's sandbox, which has no Rust crates or npm packages and so could not build the app or run Vitest) or **manually verified** (a person did it). At the time of writing the author had locally run only the pure TypeScript logic (date parsing against the shared vectors, validation, derived views) and the Rust date/validation logic compiled in isolation; the full Rust crate and every React/IndexedDB test await CI.

- [ ] **B-011:** Create event/source/hypothesis records with explicit provenance fields.
  - Implemented: migration 0004 (five tables, CHECK/FK/unique constraints, restricted deletes), typed Rust create/update with transactions and validation, nine IPC commands, browser IndexedDB equivalents, create/edit forms. Four distinct times are never synthesised; a URL-only source is labelled metadata-only; an Archive document link is the only "preserved copy". See ADR-015.
- [ ] **B-012:** Create supports/contradicts/context evidence links and a simple timeline.
  - Implemented: links tie a hypothesis to a claim or a source (optional event) with a required explanation; no orphans; hypothesis, event and source detail panes with navigation between them; timeline ordered by event date with undated events listed separately; filters by statement class and hypothesis status; Scripture and Archive navigation.
- [ ] **B-013:** Explicitly label observation, attributed claim, interpretation and forecast.
  - Implemented: mandatory class per statement, attribution required for attributed claims, distinct badges (label + glyph + border), hypotheses kept as a separate proposition type, no confidence or probability field, conflicting sources kept side by side.
- [ ] **Browser demo (IndexedDB) parity:** database version 3 adds `wt_*` stores; upgrade from version 2 keeps notes and documents.
  - Open (CI): Rust unit and integration tests (including the version-3 to 4 upgrade and restart), Vitest suites (`dates`, `validation`, `model`, `browserWatchtower`, `WatchtowerView`, `App`), Windows release build.
  - Open (manual): native Windows acceptance and browser-demo acceptance (procedures in this file and docs/BROWSER-DEMO.md). Browser parity can only be checked on GitHub Pages after merge.
  - Known limitations: no delete, no revision history, claims and links are append-only, no source licence/permission field, no export, no Android validation (Sprint 007), snapshot capped at 5,000 records per table.

**Manual native acceptance (Windows, not yet done by anyone):** launch the EXE with the network off; create `Test bridge closure` dated `2026-03-10` and `Test earlier event` dated `2025-12`; create a source with a publisher, address and dates; add an observation, an attributed claim (with attribution), an interpretation and a forecast; create a hypothesis; link one statement as Supports and another as Contradicts with reasons; check the Timeline lists the 2025-12 event first and each statement kind has its own badge; Set aside then Reopen the hypothesis; close and reopen the app and confirm everything is still there. Use invented data only.

## Sprint 005: Research Import
- [ ] **B-014:** Define owner-approved import mapping from Project E; do not automatically publish private or copyrighted materials.
- [ ] **B-015:** Preserve original document text and source provenance; detect duplicate imports.

## Sprint 006: Seed
- [ ] **B-016:** Versioned manifest and export archive preserving originals and metadata.
- [ ] **B-017:** Verified import, restore to clean instance, safe path handling and rollback.
- [ ] **B-018:** Corruption/tampering/oversized archive rejection tests.

## Sprint 007–008: Mobile and Release
- [ ] **B-019:** Android package and real-device offline test.
- [ ] **B-020:** Accessibility pass, threat review, limitations, release instructions and First Light build.

## Operating rules
- Owner approves changes to intended feature scope.
- Prefer feature branch -> pull request -> review -> merge.
- Claude and Codex should not concurrently edit the same branch.
- Report exactly what was changed, tested, and blocked; do not mark tasks done just because code was generated.
- Update [DECISIONS.md](DECISIONS.md) when a major technical decision changes.

## Developer UX: Browser Harness (issue #2)
- [x] **DEV-001: Browser demo** via explicit Vite browser-demo mode, separate IndexedDB API and prominent warning.
- [x] **DEV-002: CI + GitHub Pages preview** built and deployed successfully at https://badmrfrosty313.github.io/Beacon/ .
- [x] **DEV-003: Browser persistence test.** Owner confirmed a saved demo note survived refreshing the page.
- Scope: development/testing convenience only. Browser IndexedDB persistence is distinct from the separately confirmed native SQLite restart persistence. Full offline testing is still pending.
