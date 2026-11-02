# BEACON Task Queue

Updated: 2026-11-02. Unchecked work is not implemented. Code agents should update this file on completion and link their PR or commit.

## Sprint 001: First Light Foundation
**Objective:** Launch a working offline Windows app that can persist a simple record. Prefer a thin vertical slice over an elaborate scaffold.

> **Sprint 001 status: implemented, NOT yet verified.** Code for B-001 to B-005 is in <PR_URL>. It was written in an environment whose network policy blocked npm and crates.io and which had no Tauri system libraries, so it has **never been compiled as a Tauri app or launched**. Boxes below stay unchecked until the acceptance criteria are met on a networked Windows machine. Do not check them on the strength of the generated code alone.

- [ ] **B-001: Scaffold project.** Tauri 2 + Vite/React + TypeScript + Rust. Document prerequisites, scripts and how to start a dev build.
  - Accept: a clean checkout can build and open a working desktop window.
  - Status: scaffold, scripts and README instructions written. **Not run:** `npm install`, `vite build`, `cargo build`, `tauri dev`/`tauri build`. Acceptance **not met**.
- [ ] **B-002: Initialize SQLite.** OS-appropriate app-data directory, migration runner, minimal versioned schema, error handling.
  - Accept: database initializes at first launch, reopens without data loss, migration tests pass.
  - Status: Rust migration runner, app-data initialization and tests written (`src-tauri/src/db`, `src-tauri/tests/persistence.rs`). **Ran here:** the migration SQL file executed against real SQLite 3.53.1 (all schema, `CHECK`, `RETURNING`, ordering and close/reopen checks passed, via a throwaway Python script that is not committed); `rustfmt` parsed and formatted every Rust file. **Not run:** `cargo test` (the migration runner, rollback, newer-database refusal and restart-persistence tests have never been compiled or executed).
- [ ] **B-003: Offline smoke test.** Ensure first launch and basic navigation perform no required network or authentication calls.
  - Accept: manual airplane-mode verification and a documented reproducible test.
  - Status: static + runtime guard written (`src/test/offlineGuard.test.ts`, offline test in `src/App.test.tsx`); procedure in [docs/OFFLINE-VERIFICATION.md](docs/OFFLINE-VERIFICATION.md). **Ran here:** the real React UI, bundled with esbuild and run in headless Chromium under the production CSP with every non-local request blocked, against a _mock_ backend (throwaway harness, not committed): 20/20 checks passed, 0 external requests, 0 CSP violations. **Not run:** the guard in Vitest; the manual airplane-mode procedure on Windows. Acceptance **not met**.
- [ ] **B-004: Basic persistent record.** Create/list a local demo note or document metadata record using a Tauri command.
  - Accept: record persists through restart; input validation and failure behavior tested.
  - Status: notes create/list/get commands, UI and tests written. **Ran here:** the 10 Rust validation unit tests (standalone `rustc --test`, 10/10 passed); 19 frontend validation tests via a minimal shim (19/19 passed; not Vitest); UI create/view/validate/reload flow in Chromium against the mock backend. **Not run:** Rust integration/unit tests against SQLite, Vitest component tests, and persistence through a real app restart. Acceptance **not met**.
- [ ] **B-005: Foundation quality gates.** Formatting, linting, frontend unit tests, Rust tests, and CI compatible with actual project scripts.
  - Accept: checks documented and passing; mark unavailable platform tests clearly.
  - Status: scripts, ESLint/Prettier/Vitest/clippy configuration and `.github/workflows/ci.yml` written; commands documented in README. **Ran here:** `prettier --check .` (pass); `rustfmt --check` (pass); strict TypeScript check of production sources against approximate React type stubs (pass, with a negative control proving it catches errors). **Not run:** ESLint, real `tsc` with `@types/react`, Vitest, `cargo clippy`, `cargo test`, the CI workflow. Acceptance **not met**.

### Sprint 001 follow-ups (required before the boxes above can be checked)
1. On a networked Windows machine: `npm install`, fix any dependency-version mismatch (versions were chosen from memory, unverified), then **commit `package-lock.json` and `src-tauri/Cargo.lock`** and switch CI to `npm ci`.
2. Run `npm run check:all`; fix whatever fails (ESLint, clippy and Vitest have never run).
3. Run `npm run tauri dev`; confirm the window opens and a note survives closing and reopening.
4. Perform the manual airplane-mode procedure and record it in the results table in `docs/OFFLINE-VERIFICATION.md`.
5. Confirm the CI workflow passes on the PR. (Pushing workflow files may require extra GitHub App permission.)
6. Consider a cross-language contract test for command names and argument keys (see ADR-010).

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
