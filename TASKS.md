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
- [ ] **B-006:** Import bounded UTF-8 .md and .txt as untrusted files; preserve originals and SHA-256 hashes.
- [ ] **B-007:** Index text with SQLite FTS5; search by phrase and display a result snippet.
- [ ] **B-008:** Read originals, retain metadata, show import errors, and survive close/reopen.

## Sprint 003: Scripture Navigation
- [ ] **B-009:** Select a legally distributable content source and document its license.
- [ ] **B-010:** Offline book/chapter/verse lookup and references into user notes.

## Sprint 004: Watchtower
- [ ] **B-011:** Create event/source/hypothesis records with explicit provenance fields.
- [ ] **B-012:** Create supports/contradicts/context evidence links and a simple timeline.
- [ ] **B-013:** Explicitly label observation, attributed claim, interpretation and forecast.

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
